/**
 * Saved data samples (backlog saved-data-samples).
 *
 * An update has to open every workspace and every other piece of saved
 * data a released build wrote. Each folder under
 * src/test/fixtures/saved-data/ holds what one release wrote, made by
 * running that release's own code (scripts/saved-data/generate.mjs):
 *
 *   workspaces-db.json            raw dump of its Discrub-workspaces database
 *   workspace.discrub-workspace   a workspace file it exported
 *   keyval-dbs.json               raw dumps of its settings, state and presets
 *   expected.json                 what that release read back through its own API
 *
 * Every test here puts a dump back into a fresh IndexedDB at the version
 * it was dumped at, with the same stores and indexes, and then reads it
 * with the current code, so the current upgrade path runs. The versions
 * come from the folder names: a new folder is covered without a change
 * to this file.
 *
 * A failure here means the current code cannot read what a release
 * wrote. Fix the code (carry the data over), never the sample.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import type { Message } from 'discrub-core/types/discord-types';
import { applyRefineCriteria } from '@features/message/messageFiltering';
import { toMessageRow } from '@features/message/messageRows';
import type { Conversation, WorkspaceMeta, WorkspaceRecord } from '@features/workspace/workspaceTypes';
import {
  WORKSPACE_DB_VERSION,
  closeWorkspaceDatabase,
  commitStagedWorkspace,
  countRows,
  createWorkspaceId,
  ensureDefaultWorkspace,
  getConversation,
  getMessages,
  getMeta,
  getReactionDetail,
  getSelection,
  getWorkspace,
  installStagedWorkspace,
  isWorkspaceOpenable,
  listWorkspaces,
  openWorkspaceDatabase,
  readAuthors,
  readRows,
  readWindow,
} from './workspaceStore';
import { importWorkspaceFile, readWorkspaceManifest, type WorkspaceManifest } from './workspaceArchive';

const SAMPLES_DIR = path.resolve(__dirname, '../test/fixtures/saved-data');
const WORKSPACES_DB = 'workspaces-db.json';
const WORKSPACE_FILE = 'workspace.discrub-workspace';
const KEYVAL_DBS = 'keyval-dbs.json';
const EXPECTED = 'expected.json';

/* ─────────────────── Sample shapes ─────────────────── */

interface IndexDump { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }
interface StoreDump {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IndexDump[];
  records: Array<{ key: unknown; value: unknown }>;
}
interface DatabaseDump { name: string; version: number; stores: StoreDump[] }

interface ExpectedMessage {
  id: string;
  content: string;
  attachments?: string[];
  reactions?: Array<[string, number]>;
  hash: string;
}
interface ExpectedConversation {
  conversation: unknown;
  count: number;
  messages: ExpectedMessage[];
  rowIds: string[];
  refinedIds?: string[] | null;
  selection: string[] | null;
  reactionDetail: unknown;
}
interface ExpectedWorkspace {
  wid: string;
  name: string;
  openable: boolean;
  record: unknown;
  authorIds: string[];
  conversations: Record<string, ExpectedConversation>;
}
interface Expected {
  tag: string;
  appVersion: string;
  coreVersion: string;
  workspaceDatabase: { meta: WorkspaceMeta; workspaces: ExpectedWorkspace[] };
  workspaceFile?: {
    downloadName: string;
    manifest: WorkspaceManifest;
    record: WorkspaceRecord;
    conversations: Record<string, ExpectedMessage[]>;
  };
  keyval?: {
    written: Record<string, unknown>;
    settings: Record<string, unknown>;
    presets: Record<string, unknown>;
  };
}

/* ─────────────────── Decoding ─────────────────── */

const fromBase64 = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, 'base64'));

/** The mirror of `encode` in scripts/saved-data/generator.ts. */
function decode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const object = value as Record<string, unknown>;
  if (typeof object.$type !== 'string') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(object)) out[key] = decode(inner);
    return out;
  }
  switch (object.$type) {
    case 'undefined':
      return undefined;
    case 'number':
      return Number(object.value);
    case 'bigint':
      return BigInt(object.value as string);
    case 'Date':
      return new Date(object.value === null ? NaN : (object.value as string));
    case 'ArrayBuffer': {
      const bytes = fromBase64(object.base64 as string);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    case 'Uint8Array':
      return fromBase64(object.base64 as string);
    case 'Map':
      return new Map((object.entries as Array<[unknown, unknown]>).map(([k, v]) => [decode(k), decode(v)]));
    case 'Set':
      return new Set((object.values as unknown[]).map(decode));
    default:
      throw new Error(`saved data sample: this test cannot decode a ${object.$type}`);
  }
}

/** The generator's hash, over the encoded form so both sides see the same text. */
function encodeForHash(value: unknown): unknown {
  if (value === undefined) return { $type: 'undefined' };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(encodeForHash);
  if (value instanceof Date) return { $type: 'Date', value: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = encodeForHash(inner);
  return out;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hashOf = (value: unknown): string => createHash('sha256').update(stableStringify(encodeForHash(value))).digest('hex').slice(0, 16);

/* ─────────────────── Restoring a dump ─────────────────── */

/** Recreates a dumped database: same version, stores, key paths, indexes and records. */
async function restoreDatabase(dump: DatabaseDump): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dump.name, dump.version);
    request.onupgradeneeded = () => {
      for (const store of dump.stores) {
        const created = request.result.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
        for (const index of store.indexes) created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (dump.stores.length === 0) return;
    const tx = db.transaction(dump.stores.map((store) => store.name), 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    for (const store of dump.stores) {
      const target = tx.objectStore(store.name);
      for (const record of store.records) {
        if (store.keyPath === null) target.put(decode(record.value), decode(record.key) as IDBValidKey);
        else target.put(decode(record.value));
      }
    }
    await done;
  } finally {
    db.close();
  }
}

/* ─────────────────── Samples on disk ─────────────────── */

const compareVersions = (a: string, b: string): number => {
  const [pa, pb] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const versions = existsSync(SAMPLES_DIR)
  ? readdirSync(SAMPLES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersions)
  : [];

const sampleFile = (version: string, name: string): string => path.join(SAMPLES_DIR, version, name);
const hasSample = (version: string, name: string): boolean => existsSync(sampleFile(version, name));
const readSample = <T,>(version: string, name: string): T => JSON.parse(readFileSync(sampleFile(version, name), 'utf8')) as T;

/** The stored message for each id of a dumped conversation, as the old build wrote it. */
function dumpedMessages(dump: DatabaseDump, wid: string, cid: string): Map<string, Message> {
  const rows = dump.stores.find((store) => store.name === 'rows')?.records ?? [];
  const byId = new Map<string, Message>();
  for (const record of rows) {
    const row = decode(record.value) as { wid: string; cid: string; message: Message };
    if (row.wid === wid && row.cid === cid) byId.set(row.message.id, row.message);
  }
  return byId;
}

const asc = { direction: 'asc' } as const;

beforeEach(() => {
  // Each test gets an IndexedDB nothing has written to.
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(async () => {
  await closeWorkspaceDatabase();
  vi.unstubAllGlobals();
});

describe('saved data samples', () => {
  it('has a sample from at least one release', () => {
    expect(versions.length).toBeGreaterThan(0);
  });

  it.each(versions)('the %s sample has a workspace database and what it should read as', (version) => {
    expect(hasSample(version, WORKSPACES_DB)).toBe(true);
    expect(hasSample(version, EXPECTED)).toBe(true);
    expect(readSample<Expected>(version, EXPECTED).appVersion).toBe(version);
  });
});

describe.each(versions)('saved data written by %s', (version) => {
  const loadWorkspaces = async (): Promise<{ dump: DatabaseDump; expected: Expected }> => {
    const dump = readSample<DatabaseDump>(version, WORKSPACES_DB);
    await restoreDatabase(dump);
    return { dump, expected: readSample<Expected>(version, EXPECTED) };
  };

  it(`opens a workspace database written by ${version}`, async () => {
    const { dump, expected } = await loadWorkspaces();
    const want = expected.workspaceDatabase;

    const db = await openWorkspaceDatabase();
    expect(dump.version).toBeLessThanOrEqual(WORKSPACE_DB_VERSION);
    expect(db.version).toBe(WORKSPACE_DB_VERSION);

    const listed = await listWorkspaces();
    expect(listed.map((w) => [w.wid, w.name])).toEqual(want.workspaces.map((w) => [w.wid, w.name]));
    for (const record of listed) expect(isWorkspaceOpenable(record), `${record.name} opens`).toBe(true);
    expect(await getMeta()).toMatchObject(want.meta);

    // Boot finds the Default that is there and does not make a second one.
    const boot = await ensureDefaultWorkspace();
    expect(boot.wid).toBe(want.meta.defaultWid);
    expect((await listWorkspaces()).length).toBe(want.workspaces.length);

    for (const workspace of want.workspaces) {
      expect(await getWorkspace(workspace.wid), `workspace ${workspace.name}`).toMatchObject(decode(workspace.record) as object);
    }
  });

  it(`reads every conversation and message of a workspace database written by ${version}`, async () => {
    const { dump, expected } = await loadWorkspaces();
    let read = 0;

    for (const workspace of expected.workspaceDatabase.workspaces) {
      const record = await getWorkspace(workspace.wid);
      expect(Object.keys(record!.conversations).sort()).toEqual(Object.keys(workspace.conversations).sort());
      expect(Object.keys(await readAuthors(workspace.wid)).sort()).toEqual(workspace.authorIds);

      for (const [cid, want] of Object.entries(workspace.conversations)) {
        const label = `${workspace.name} / ${cid}`;
        expect(await getConversation(workspace.wid, cid), label).toMatchObject(decode(want.conversation) as object);
        expect(await countRows(workspace.wid, cid), label).toBe(want.count);

        const messages = await readWindow(workspace.wid, cid, asc);
        expect(messages.map((m) => m.id), label).toEqual(want.messages.map((m) => m.id));
        const stored = dumpedMessages(dump, workspace.wid, cid);
        messages.forEach((message, i) => {
          const wanted = want.messages[i];
          const where = `${label} / message ${wanted.id}`;
          // Against the stored object first, so a difference prints as a diff.
          expect(message, where).toEqual(stored.get(wanted.id));
          expect(message.content, where).toBe(wanted.content);
          expect((message.attachments ?? []).map((a) => a.filename), where).toEqual(wanted.attachments ?? []);
          expect((message.reactions ?? []).map((r) => [r.emoji.name, r.count]), where).toEqual(wanted.reactions ?? []);
          expect(hashOf(message), where).toBe(wanted.hash);
          read += 1;
        });

        // By id, the way the message cache fills.
        const ids = want.messages.map((m) => m.id);
        expect((await getMessages(workspace.wid, cid, ids)).map((m) => m && hashOf(m)), label).toEqual(want.messages.map((m) => m.hash));

        // The rows an open reads, and each one is the row today's code builds for its message.
        const rows = await readRows(workspace.wid, cid, asc);
        expect(rows.map((r) => r.id), label).toEqual(want.rowIds);
        rows.forEach((row, i) => expect(row, `${label} / row ${row.id}`).toEqual(toMessageRow(messages[i])));
      }
    }
    expect(read).toBeGreaterThan(0);
  });

  it(`reads the selections and saved conversation state of a workspace database written by ${version}`, async () => {
    const { expected } = await loadWorkspaces();
    const kept: string[] = [];

    for (const workspace of expected.workspaceDatabase.workspaces) {
      for (const [cid, want] of Object.entries(workspace.conversations)) {
        const label = `${workspace.name} / ${cid}`;
        expect(await getSelection(workspace.wid, cid), `${label} selection`).toEqual(want.selection);
        expect(await getReactionDetail(workspace.wid, cid), `${label} reaction detail`).toEqual(decode(want.reactionDetail));

        const wanted = decode(want.conversation) as Conversation;
        const conversation = (await getConversation(workspace.wid, cid))!;
        for (const field of ['searchCriteria', 'refineCriteria', 'order', 'pagination', 'scrollAnchorId', 'threadTabs', 'activeTab', 'action', 'enrichment', 'complete'] as const) {
          expect(conversation[field], `${label} ${field}`).toEqual(wanted[field]);
        }
        // Saved filters still let the same messages through.
        if (want.refinedIds) {
          const messages = await readWindow(workspace.wid, cid, asc);
          expect(applyRefineCriteria(messages, conversation.refineCriteria).map((m) => m.id), `${label} filtered messages`).toEqual(want.refinedIds);
          kept.push(`${cid} filters`);
        }
        if (want.selection) kept.push(`${cid} selection`);
        if (want.reactionDetail) kept.push(`${cid} reaction detail`);
        if (wanted.action) kept.push(`${cid} action`);
      }
      const record = (await getWorkspace(workspace.wid))!;
      const wantedRecord = decode(workspace.record) as WorkspaceRecord;
      expect(record.scope, `${workspace.name} scope`).toEqual(wantedRecord.scope);
      expect(record.bulk, `${workspace.name} bulk run`).toEqual(wantedRecord.bulk);
      expect(record.authors, `${workspace.name} authors`).toEqual(wantedRecord.authors);
      expect(record.guilds, `${workspace.name} server names`).toEqual(wantedRecord.guilds);
    }
    // The sample is only worth something while it carries this state.
    expect(kept.length).toBeGreaterThan(0);
  });

  it.runIf(hasSample(version, WORKSPACE_FILE))(`imports a workspace file written by ${version}`, async () => {
    const want = readSample<Expected>(version, EXPECTED).workspaceFile!;
    // Through the test realm's Uint8Array: the zip reader checks the type.
    const bytes = new Uint8Array(readFileSync(sampleFile(version, WORKSPACE_FILE)));

    await ensureDefaultWorkspace();
    const manifest = await readWorkspaceManifest(bytes);
    expect(manifest).toEqual(want.manifest);

    // The way the app imports: into a staged workspace, then swapped in.
    const wid = createWorkspaceId();
    const result = await importWorkspaceFile(bytes, { wid, name: manifest.name, color: manifest.color }, installStagedWorkspace);
    await commitStagedWorkspace(wid, null);
    expect(result.messages).toBe(want.manifest.messages);

    const listed = await listWorkspaces();
    const imported = listed.find((w) => w.wid === wid);
    expect(imported, 'the imported workspace is listed').toBeDefined();
    expect(isWorkspaceOpenable(imported!)).toBe(true);
    // The size is that of the conversations the file carries; a Bulk run's rows stay out of it.
    const carriedBytes = Object.keys(want.conversations).reduce((sum, cid) => sum + want.record.conversations[cid].bytes, 0);
    expect(imported).toMatchObject({ name: want.record.name, color: want.record.color, scope: want.record.scope, guilds: want.record.guilds, bytes: carriedBytes });
    // authors.json is its own entry in the file; the import has to put it back.
    expect(imported!.authors).toEqual(want.record.authors);

    expect(Object.keys(want.conversations).length).toBeGreaterThan(0);
    for (const [cid, messages] of Object.entries(want.conversations)) {
      const read = await readWindow(wid, cid, asc);
      expect(read.map((m) => m.id), cid).toEqual(messages.map((m) => m.id));
      read.forEach((message, i) => {
        expect(message.content, `${cid} / message ${message.id}`).toBe(messages[i].content);
        expect(hashOf(message), `${cid} / message ${message.id}`).toBe(messages[i].hash);
      });
      expect(await getConversation(wid, cid), cid).toMatchObject(want.record.conversations[cid]);
    }
  });

  it.runIf(hasSample(version, KEYVAL_DBS))(`loads the settings and presets written by ${version}`, async () => {
    const want = readSample<Expected>(version, EXPECTED).keyval!;
    for (const dump of readSample<DatabaseDump[]>(version, KEYVAL_DBS)) await restoreDatabase(dump);

    // The storage module keeps its connections; a fresh copy opens the restored databases.
    vi.resetModules();
    const { loadSettings } = await import('@features/app/appSlice');
    const { loadPresets } = await import('@features/presets/presetsSlice');
    const dispatch = ((action: unknown) => action) as never;
    const getState = (() => ({})) as never;

    const settings = await loadSettings()(dispatch, getState, undefined);
    expect(settings.meta.requestStatus).toBe('fulfilled');
    // Every value the release saved, then everything its own load answered.
    expect(settings.payload).toMatchObject(want.written);
    expect(settings.payload).toMatchObject(want.settings);

    const presets = await loadPresets()(dispatch, getState, undefined);
    expect(presets.meta.requestStatus).toBe('fulfilled');
    expect(presets.payload).toEqual(want.presets);
  });
});
