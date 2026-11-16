/**
 * Saved data sample generator (backlog saved-data-samples).
 *
 * This file is not run from here. `generate.mjs` copies it into a git
 * worktree of a release tag as `src/services/savedDataGenerator.test.ts`
 * and runs it there with vitest, so the data is written by that release's
 * own workspaceStore, workspaceArchive, storage and slices, not by HEAD's.
 *
 * To regenerate a sample:      node scripts/saved-data/generate.mjs v2.2.9
 * To add the next release:     node scripts/saved-data/generate.mjs v2.2.10
 * (after the tag exists). The sample lands in
 * src/test/fixtures/saved-data/<version>/ and
 * src/services/savedDataSamples.test.ts picks the folder up by itself.
 *
 * If a later release changes an API this file calls, adjust the call
 * here. A sample already in the fixtures folder is never edited by hand.
 *
 * Output, per version:
 *   workspaces-db.json            raw dump of the Discrub-workspaces database
 *   workspace.discrub-workspace   the named workspace, exported by exportWorkspaceFile
 *   keyval-dbs.json               raw dumps of Discrub-settings, -state and -presets
 *   expected.json                 what the release's own API read back
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Message } from 'discrub-core/types/discord-types';
import { HasType, IsPinnedType } from 'discrub-core/discord-enum';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { SortDirection } from 'discrub-core/common-enum';
import * as workspaceStore from './workspaceStore';
import * as workspaceArchive from './workspaceArchive';
import { applyRefineCriteria } from '@features/message/messageFiltering';
import { storage, migrateAllStorage } from '@/extension/storage';
import { defaultSettings, loadSettings, updateAllSettings } from '@features/app/appSlice';
import { loadPresets, savePreset } from '@features/presets/presetsSlice';

vi.mock('drip-fs', () => ({ createStreamingDownload: vi.fn() }));

const OUT_DIR = process.env.SAVED_DATA_OUT ?? '';
const TAG = process.env.SAVED_DATA_TAG ?? '';

/** Every clock read in the run starts here: 2026-10-20T12:00:00Z. */
const START = Date.UTC(2026, 9, 20, 12, 0, 0);
const DISCORD_EPOCH = 1420070400000;

/* ─────────────────── Encoding ─────────────────── */

/**
 * JSON with the values IndexedDB keeps and JSON does not. A tagged value
 * is `{ $type, ... }`; the test's decoder is the mirror of this function.
 * Anything it does not know stops the run, so nothing is dropped silently.
 */
function encode(value: unknown): unknown {
  if (value === undefined) return { $type: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { $type: 'number', value: String(value) };
  }
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const time = (value as Date).getTime();
    return { $type: 'Date', value: Number.isNaN(time) ? null : new Date(time).toISOString() };
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    return { $type: Object.prototype.toString.call(value).slice(8, -1), base64: bytes.toString('base64') };
  }
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object ArrayBuffer]') return { $type: 'ArrayBuffer', base64: Buffer.from(value as ArrayBuffer).toString('base64') };
  if (tag === '[object Map]') return { $type: 'Map', entries: [...(value as Map<unknown, unknown>)].map(([k, v]) => [encode(k), encode(v)]) };
  if (tag === '[object Set]') return { $type: 'Set', values: [...(value as Set<unknown>)].map(encode) };
  if (tag !== '[object Object]') throw new Error(`saved data sample: cannot encode ${tag}`);
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$type') throw new Error('saved data sample: a stored object uses the $type key');
    out[key] = encode(inner);
  }
  return out;
}

/** Sorted keys, so the hash does not depend on property order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hashOf = (value: unknown): string => createHash('sha256').update(stableStringify(encode(value))).digest('hex').slice(0, 16);

/* ─────────────────── Raw database dump ─────────────────── */

interface IndexDump { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }
interface StoreDump {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IndexDump[];
  records: Array<{ key: unknown; value: unknown }>;
}
interface DatabaseDump { name: string; version: number; stores: StoreDump[] }

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Reads a database as it is on disk, at the version it is on, without the app's code. */
async function dumpDatabase(name: string): Promise<DatabaseDump> {
  const db = await request(indexedDB.open(name));
  try {
    const stores: StoreDump[] = [];
    for (const storeName of [...db.objectStoreNames].sort()) {
      const store = db.transaction(storeName, 'readonly').objectStore(storeName);
      const indexes: IndexDump[] = [...store.indexNames].sort().map((indexName) => {
        const index = store.index(indexName);
        return { name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
      });
      const records: StoreDump['records'] = [];
      await new Promise<void>((resolve, reject) => {
        const cursorRequest = store.openCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return resolve();
          records.push({ key: encode(cursor.primaryKey), value: encode(cursor.value) });
          cursor.continue();
        };
      });
      stores.push({ name: storeName, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records });
    }
    return { name: db.name, version: db.version, stores };
  } finally {
    db.close();
  }
}

/** One record per line: small on disk and still readable in a diff. */
function dumpToJson(dump: DatabaseDump): string {
  const stores = dump.stores.map((store) => {
    const { records, ...shape } = store;
    const head = JSON.stringify(shape).slice(0, -1);
    const lines = records.map((record) => `      ${JSON.stringify(record)}`).join(',\n');
    return `    ${head},"records":[${records.length > 0 ? `\n${lines}\n    ` : ''}]}`;
  });
  return `{\n  "name": ${JSON.stringify(dump.name)},\n  "version": ${dump.version},\n  "stores": [\n${stores.join(',\n')}\n  ]\n}\n`;
}

/** Indented for the first `depth` levels and one line below that. */
function layeredJson(value: unknown, depth: number, indent = ''): string {
  if (depth === 0 || value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  const parts = Array.isArray(value)
    ? value.map((item) => layeredJson(item, depth - 1, inner))
    : Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => `${JSON.stringify(key)}: ${layeredJson(item, depth - 1, inner)}`);
  if (parts.length === 0) return Array.isArray(value) ? '[]' : '{}';
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${parts.map((part) => `${inner}${part}`).join(',\n')}\n${indent}${close}`;
}

function writeOut(name: string, content: string | Uint8Array): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, name), content);
}

/* ─────────────────── The data ─────────────────── */

/** A snowflake for a moment `minutes` after the start, so ids and timestamps agree. */
const snowflake = (minutes: number, n = 0): string =>
  ((BigInt(START - 90 * 24 * 3600_000 + minutes * 60_000 - DISCORD_EPOCH) << 22n) + BigInt(n)).toString();
const timestampOf = (id: string): string => new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH).toISOString().replace('Z', '000+00:00');

const GUILD = '811000000000000001';
const GENERAL = '811000000000000100';
const RAIDS = '811000000000000200';
const BANK = '811000000000000300';
const THREAD = snowflake(40, 7);
const DM = '822000000000000001';

const user = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
  id,
  username,
  global_name: username[0].toUpperCase() + username.slice(1),
  discriminator: '0',
  avatar: `a${id.slice(-6)}`,
  public_flags: 0,
  ...extra,
});
const JORDAN = user('700000000000000001', 'jordan');
const ASHLEY = user('700000000000000002', 'ashley');
const BOT = user('700000000000000003', 'scour', { bot: true, global_name: null });
const HOOK = user('700000000000000004', 'Deploys', { bot: true, global_name: null, avatar: null });
const AUTHORS = [JORDAN, ASHLEY, BOT];

const attachment = (id: string, channel: string, filename: string, contentType: string, extra: Record<string, unknown> = {}) => ({
  id,
  filename,
  size: 48_213,
  url: `https://cdn.discordapp.com/attachments/${channel}/${id}/${filename}?ex=6712&is=6711&hm=abc`,
  proxy_url: `https://media.discordapp.net/attachments/${channel}/${id}/${filename}?ex=6712&is=6711&hm=abc`,
  content_type: contentType,
  ...extra,
});

/** The parts of a Discord message every row carries; `extra` adds the rest. */
function message(channel: string, minutes: number, n: number, extra: Record<string, unknown> = {}): Message {
  const id = snowflake(minutes, n);
  return {
    id,
    channel_id: channel,
    author: AUTHORS[n % 2],
    content: `Message ${n} in ${channel.slice(-3)}`,
    timestamp: timestampOf(id),
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
    flags: 0,
    components: [],
    ...extra,
  } as unknown as Message;
}

/** One of each shape the feed, the filters and the exports treat differently. */
function variety(channel: string, base: number): Message[] {
  const first = message(channel, base, 1, { content: 'Selling 400 runite ore, see https://example.com/ore', pinned: true });
  return [
    first,
    message(channel, base + 1, 2, {
      content: 'Screenshot of the trade',
      attachments: [attachment(snowflake(base + 1, 90), channel, 'trade.png', 'image/png', { width: 800, height: 600 })],
      reactions: [
        { emoji: { id: null, name: '👍' }, count: 3, count_details: { burst: 0, normal: 3 }, me: true, me_burst: false, burst_colors: [] },
        { emoji: { id: '833000000000000001', name: 'runite', animated: false }, count: 1, count_details: { burst: 1, normal: 0 }, me: false, me_burst: false, burst_colors: ['#5865f2'] },
      ],
    }),
    message(channel, base + 2, 3, {
      content: 'Sounds good',
      type: 19,
      message_reference: { type: 0, message_id: first.id, channel_id: channel, guild_id: GUILD },
      referenced_message: first,
      mentions: [JORDAN],
    }),
    message(channel, base + 3, 4, {
      content: '',
      attachments: [
        attachment(snowflake(base + 3, 91), channel, 'kill.mp4', 'video/mp4', { width: 1280, height: 720 }),
        attachment(snowflake(base + 3, 92), channel, 'voice note.ogg', 'audio/ogg', { duration_secs: 4.2, waveform: 'AAAA' }),
        attachment(snowflake(base + 3, 93), channel, 'drops.csv', 'text/csv; charset=utf-8'),
      ],
    }),
    message(channel, base + 4, 5, {
      author: BOT,
      content: '',
      embeds: [{
        type: 'rich',
        title: 'Price check',
        description: 'Runite ore is at 11.2k',
        url: 'https://example.com/price',
        color: 5793266,
        fields: [{ name: 'High', value: '11.4k', inline: true }, { name: 'Low', value: '11.0k', inline: true }],
        footer: { text: 'Scour' },
        thumbnail: { url: 'https://example.com/ore.png', width: 64, height: 64 },
      }],
    }),
    message(channel, base + 5, 6, {
      content: '',
      message_reference: { type: 1, message_id: '811000000000009999', channel_id: BANK, guild_id: GUILD },
      message_snapshots: [{ message: { content: 'Bank is closed on Sunday', timestamp: timestampOf(snowflake(base - 60, 1)), attachments: [], embeds: [], type: 0, flags: 0 } }],
    }),
    message(channel, base + 6, 7, { content: '', sticker_items: [{ id: '844000000000000001', name: 'Wave', format_type: 1 }] }),
    message(channel, base + 7, 8, {
      content: '',
      poll: {
        question: { text: 'Raid tonight?' },
        answers: [{ answer_id: 1, poll_media: { text: 'Yes' } }, { answer_id: 2, poll_media: { text: 'No' } }],
        expiry: timestampOf(snowflake(base + 1440, 0)),
        allow_multiselect: false,
        layout_type: 1,
        results: { is_finalized: false, answer_counts: [{ id: 1, count: 4, me_voted: true }] },
      },
    }),
    message(channel, base + 8, 9, { content: 'Edited once', edited_timestamp: timestampOf(snowflake(base + 9, 0)) }),
    message(channel, base + 9, 10, { author: HOOK, webhook_id: '855000000000000001', content: 'Deploy finished' }),
    message(channel, base + 10, 11, { type: 7, content: '' }),
    message(channel, base + 11, 12, { content: 'Größe: 5 ✔ 日本語 "quoted" \\ back\nsecond line' }),
  ];
}

const plain = (channel: string, base: number, count: number, from = 20): Message[] =>
  Array.from({ length: count }, (_, i) => message(channel, base + i, from + i));

const seed = (name: string, kind: 'channel' | 'dm' | 'thread' = 'channel', extra: Record<string, unknown> = {}) => ({
  kind,
  guildId: kind === 'dm' ? null : GUILD,
  guildName: kind === 'dm' ? null : 'Runite Mining Co',
  name,
  ...extra,
});

const criteria = (extra: Record<string, unknown> = {}) => ({
  searchBeforeDate: null,
  searchAfterDate: null,
  searchMessageContents: [],
  selectedHasTypes: [],
  userIds: [],
  mentionIds: [],
  channelIds: [],
  isPinned: IsPinnedType.UNSET,
  ...extra,
});

const workspaceAuthor = (u: typeof JORDAN) => ({
  id: u.id,
  username: u.username,
  globalName: (u.global_name as string | null) ?? null,
  nickname: u.id === JORDAN.id ? 'Jord' : null,
  avatar: (u.avatar as string | null) ?? null,
  bot: (u as { bot?: boolean }).bot === true,
});

/* ─────────────────── Run ─────────────────── */

let uuidCount = 0;
let files: Map<string, number[]>;
let minute = 0;
/** Moves the clock a minute, so records written in order carry different times. */
const tick = (): void => {
  minute += 1;
  vi.setSystemTime(START + minute * 60_000);
};

const expected: Record<string, unknown> = {};

beforeAll(async () => {
  if (!OUT_DIR) throw new Error('SAVED_DATA_OUT is not set. Run this through scripts/saved-data/generate.mjs');
  vi.useFakeTimers({ toFake: ['Date'], now: START });
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, '0')}`,
  });
  // The zip writer reads file bodies through Node's Response, which needs Node's Blob.
  vi.stubGlobal('Blob', NodeBlob);
  files = new Map();
  const { createStreamingDownload } = await import('drip-fs');
  vi.mocked(createStreamingDownload).mockImplementation(async (name: string) => {
    const bytes: number[] = [];
    files.set(name, bytes);
    return {
      write: async (chunk: Uint8Array) => {
        for (let i = 0; i < chunk.length; i += 1) bytes.push(chunk[i]);
      },
      close: async () => {},
      abort: async () => {},
      bytesWritten: 0,
    } as never;
  });
  await workspaceStore.deleteWorkspaceDatabase();
});

afterAll(() => {
  const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
  const core = JSON.parse(readFileSync(path.resolve(process.cwd(), 'node_modules/discrub-core/package.json'), 'utf8')) as { version: string };
  writeOut('expected.json', `${layeredJson({ tag: TAG, appVersion: pkg.version, coreVersion: core.version, ...expected }, 7)}\n`);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe(`saved data sample ${TAG}`, () => {
  it('writes the workspace database and a workspace file', async () => {
    const s = workspaceStore;

    // Boot: Default is made the way the app makes it.
    const defaultRecord = await s.ensureDefaultWorkspace();
    const dw = defaultRecord.wid;

    // A Server Channel, loaded in two pages, with a Load All that did not finish.
    const general = [...variety(GENERAL, 100), ...plain(GENERAL, 200, 8)];
    tick();
    await s.writePage(dw, GENERAL, general.slice(12), seed('general'));
    tick();
    await s.writePage(dw, GENERAL, general.slice(0, 12), seed('general'));
    await s.updateConversation(dw, GENERAL, (c) => {
      c.refineCriteria = criteria({
        searchAfterDate: new Date(START - 120 * 24 * 3600_000),
        selectedHasTypes: [HasType.IMAGE, HasType.FORWARD],
        systemMessageGroups: ['members'],
        systemMessageMode: 'hide',
      }) as never;
      c.order = { order: SortDirection.ASCENDING, orderBy: 'timestamp' };
      c.pagination = { mode: 'all', lastMessageId: general[0].id, hasMore: true, totalCount: null, searchOffset: 0, searchBeforeDate: null };
      c.action = { kind: 'loadAll', settings: { startedAt: START, loaded: general.length } };
      c.scrollAnchorId = general[5].id;
      c.threadTabs = [THREAD];
      c.activeTab = THREAD;
      c.enrichment = { reactions: 'done', replies: 'running', names: 'off' };
    });
    await s.setSelection(dw, GENERAL, [general[1].id, general[3].id, general[13].id, general[19].id]);

    // A thread opened as a tab of that Channel.
    tick();
    await s.writePage(dw, THREAD, plain(THREAD, 300, 4, 40), seed('ore prices', 'thread', { parentName: 'general' }));

    // A search on the same Channel, kept beside its plain rows.
    tick();
    const searchKey = s.searchCid(GENERAL);
    await s.writePage(dw, searchKey, [general[0], general[1], general[5], general[14], general[18]], seed('general'));
    await s.updateConversation(dw, searchKey, (c) => {
      c.searchCriteria = criteria({
        searchBeforeDate: new Date(START),
        searchMessageContents: ['runite'],
        userIds: [JORDAN.id],
        isPinned: IsPinnedType.UNSET,
        authorType: null,
        attachmentExtensions: ['png'],
      }) as never;
      c.pagination = { mode: 'search', lastMessageId: null, hasMore: true, totalCount: 31, searchOffset: 25, searchBeforeDate: timestampOf(general[0].id) };
    });

    // A DM, read to the end.
    tick();
    const dm = [...variety(DM, 400).slice(0, 4), ...plain(DM, 500, 4, 60)];
    await s.writePage(dw, DM, dm, seed('ashley', 'dm'));
    await s.updateConversation(dw, DM, (c) => {
      c.complete = true;
      c.pagination = { ...c.pagination, mode: 'all', hasMore: false, lastMessageId: dm[0].id };
      c.enrichment = { reactions: 'done', replies: 'done', names: 'done' };
    });
    await s.setSelection(dw, DM, [dm[2].id, dm[5].id, dm[7].id]);

    await s.updateWorkspace(dw, (record) => {
      record.scope = { tab: 'channels', guildId: GUILD, channelId: GENERAL, dmId: null };
      record.authors = Object.fromEntries([JORDAN, ASHLEY, BOT].map((u) => [u.id, workspaceAuthor(u)])) as never;
    });

    // A named workspace with one Channel and a Bulk Export that stopped part way.
    tick();
    const raid = await s.createWorkspace({ name: 'Raid: Größe #2', color: '#3ba55d' });
    const rw = raid.wid;
    const raids = [...variety(RAIDS, 600).slice(0, 5), ...plain(RAIDS, 700, 2, 80)];
    await s.writePage(rw, RAIDS, raids, seed('raids'));
    await s.updateConversation(rw, RAIDS, (c) => {
      c.searchCriteria = criteria({ searchMessageContents: ['trade'] }) as never;
      c.scrollAnchorId = raids[2].id;
    });
    const runKey = s.bulkRunCid(BANK);
    const bank = plain(BANK, 800, 3, 90);
    await s.writePage(rw, runKey, bank, seed('bank'));
    await s.setReactionDetail(rw, runKey, {
      [bank[0].id]: { '👍': [{ id: ASHLEY.id, burst: false }], 'runite:833000000000000001': [{ id: JORDAN.id, burst: true }] },
    });
    await s.updateWorkspace(rw, (record) => {
      record.scope = { tab: 'channels', guildId: GUILD, channelId: RAIDS, dmId: null };
      record.authors = Object.fromEntries([JORDAN, ASHLEY].map((u) => [u.id, workspaceAuthor(u)])) as never;
      record.bulk = {
        kind: 'bulkExport',
        mode: 'channels',
        guildId: GUILD,
        settings: { snapshot: { format: 'html', messagesPerPage: 500, separateThreads: true }, searchCriteria: null },
        queue: [RAIDS, BANK, GENERAL],
        done: [RAIDS],
        inHand: BANK,
        total: 3,
        doneCount: 1,
      } as never;
    });
    tick();
    await s.setLastWorkspace(rw);
    await s.touchWorkspace(rw);

    // What this release reads back, through its own API.
    const records = await s.listWorkspaces();
    const workspaces = [];
    for (const record of records) {
      const conversations: Record<string, unknown> = {};
      for (const cid of Object.keys(record.conversations)) {
        const messages = await s.readWindow(record.wid, cid, { direction: 'asc' });
        const rows = await s.readRows(record.wid, cid, { direction: 'asc' });
        expect(messages.length).toBe(record.conversations[cid].count);
        const refine = record.conversations[cid].refineCriteria;
        conversations[cid] = {
          conversation: encode(await s.getConversation(record.wid, cid)),
          count: await s.countRows(record.wid, cid),
          messages: messages.map((m) => ({
            id: m.id,
            content: m.content,
            attachments: (m.attachments ?? []).map((a) => a.filename),
            reactions: (m.reactions ?? []).map((r) => [r.emoji.name, r.count]),
            hash: hashOf(m),
          })),
          rowIds: rows.map((r) => r.id),
          // Which messages the saved filters let through in this release.
          refinedIds: refine ? applyRefineCriteria(messages, refine).map((m) => m.id) : null,
          selection: await s.getSelection(record.wid, cid),
          reactionDetail: encode(await s.getReactionDetail(record.wid, cid)),
        };
      }
      workspaces.push({
        wid: record.wid,
        name: record.name,
        openable: s.isWorkspaceOpenable(record),
        record: encode(await s.getWorkspace(record.wid)),
        authorIds: Object.keys(await s.readAuthors(record.wid)).sort(),
        conversations,
      });
    }
    expect(workspaces.map((w) => w.name)).toEqual(['Default', 'Raid: Größe #2']);
    expected.workspaceDatabase = { meta: await s.getMeta(), workspaces };

    // The workspace file, before the dump so the dump is the state the export saw.
    tick();
    const manifest = await workspaceArchive.exportWorkspaceFile(rw, { partSize: 5 });
    expect([...files.keys()].length).toBe(1);
    const [fileName] = [...files.keys()];
    writeOut('workspace.discrub-workspace', Uint8Array.from(files.get(fileName)!));
    const filed: Record<string, unknown> = {};
    for (const cid of Object.keys((await s.getWorkspace(rw))!.conversations)) {
      if (s.isRunCid(cid)) continue;
      filed[cid] = (await s.readWindow(rw, cid, { direction: 'asc' })).map((m) => ({ id: m.id, content: m.content, hash: hashOf(m) }));
    }
    expected.workspaceFile = {
      downloadName: fileName,
      manifest,
      // The record as the file carries it: JSON, so a Date is a string.
      record: JSON.parse(JSON.stringify(await s.getWorkspace(rw))),
      conversations: filed,
    };

    await s.closeWorkspaceDatabase();
    writeOut('workspaces-db.json', dumpToJson(await dumpDatabase(s.WORKSPACE_DB_NAME)));
  });

  it('writes the settings, state and presets databases', async () => {
    const dispatch = ((action: unknown) => action) as never;
    const getState = (() => ({ app: { settings: defaultSettings } })) as never;

    await Promise.all([storage.settings.clear(), storage.state.clear(), storage.presets.clear()]);
    // Boot runs the migration once and leaves its marker.
    await migrateAllStorage();
    const changed = {
      ...defaultSettings,
      [DiscrubSetting.SEARCH_DELAY]: '3',
      [DiscrubSetting.DELETE_DELAY]: '4',
      [DiscrubSetting.APP_LANGUAGE]: 'de',
      [DiscrubSetting.APP_LAYOUT]: 'native',
      [DiscrubSetting.APP_THEME_MODE]: 'dark',
      [DiscrubSetting.EXPORT_FORMAT]: 'json',
      [DiscrubSetting.EXPORT_MESSAGES_PER_PAGE]: '250',
      [DiscrubSetting.PURGE_RETAIN_ATTACHED_MEDIA]: 'true',
      [DiscrubSetting.REST_BREAKS]: 'false',
      [DiscrubSetting.CACHED_ANNOUNCEMENT_REV]: '24',
    };
    const saved = await updateAllSettings(changed as never)(dispatch, getState, undefined);
    expect(saved.meta.requestStatus).toBe('fulfilled');

    const preset = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      id,
      name,
      isBuiltIn: false,
      format: 'html',
      messagesPerPage: 250,
      separateThreads: true,
      includeMedia: true,
      mediaConfig: { images: true, videos: false, audio: true, other: false },
      artistMode: false,
      sortOrder: 'ascending',
      previewMedia: true,
      ...extra,
    });
    for (const p of [
      preset('preset-weekly', 'Weekly backup', { category: 'Backup' }),
      preset('preset-text', 'Plain text, März', { format: 'text', includeMedia: false, maxZipPartBytes: null, dateRange: { after: '2026-01-01T00:00:00.000Z', before: null } }),
    ]) {
      const result = await savePreset(p as never)(dispatch, getState, undefined);
      expect(result.meta.requestStatus).toBe('fulfilled');
    }

    const loaded = await loadSettings()(dispatch, getState, undefined);
    const presets = await loadPresets()(dispatch, getState, undefined);
    expect(loaded.meta.requestStatus).toBe('fulfilled');
    expect(presets.meta.requestStatus).toBe('fulfilled');
    expected.keyval = { written: changed, settings: loaded.payload, presets: presets.payload };

    const dumps = [];
    for (const name of ['Discrub-settings', 'Discrub-state', 'Discrub-presets']) dumps.push(dumpToJson(await dumpDatabase(name)).trimEnd());
    writeOut('keyval-dbs.json', `[\n${dumps.join(',\n')}\n]\n`);
  });
});
