/**
 * Workspace store (2.2.5 WP1). Backed by `fake-indexeddb/auto` from
 * src/test/setup.ts; every test starts from a deleted database.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage, createMockUser } from '@/test/fixtures';
import {
  LEGACY_DEFAULT_WORKSPACE_ID,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceRecord,
} from '@features/workspace/workspaceTypes';
import {
  WORKSPACE_DB_NAME,
  WorkspaceQuotaError,
  WorkspaceStoreError,
  acquireWorkspaceLock,
  clearConversation,
  clearWorkspaceMessages,
  countRows,
  createWorkspace,
  deleteConversation,
  deleteRows,
  deleteWorkspace,
  deleteWorkspaceDatabase,
  duplicateWorkspace,
  ensureDefaultWorkspace,
  getDefaultWid,
  estimateMessageBytes,
  getConversation,
  getMessages,
  getMeta,
  getWorkspace,
  holdsWorkspaceLock,
  isQuotaExceededError,
  isWorkspaceHeldElsewhere,
  isWorkspaceOpenable,
  listWorkspaces,
  onWorkspaceStoreChange,
  refreshConversationNames,
  openWorkspaceDatabase,
  padSnowflake,
  patchRows,
  readAuthorIds,
  readStorageEstimate,
  readWindow,
  releaseWorkspaceLock,
  renameWorkspace,
  scan,
  setLastWorkspace,
  setWorkspaceOrder,
  unpadSnowflake,
  updateConversation,
  updateWorkspace,
  writePage,
} from './workspaceStore';

const WID = LEGACY_DEFAULT_WORKSPACE_ID;
const CID = '1000';
const seed = { kind: 'channel' as const, guildId: '42', name: 'general' };

const msg = (id: string, overrides: Partial<Message> = {}): Message =>
  createMockMessage({ id, channel_id: CID, content: `message ${id}`, ...overrides });

/** Snowflake ids of three different lengths; numeric order is 9 < 10 < 123456789012345678. */
const SHORT = '9';
const MID = '10';
const LONG = '123456789012345678';

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
  vi.unstubAllGlobals();
});

describe('ids and estimates', () => {
  it('pads to 20 digits and unpads back', () => {
    expect(padSnowflake('9')).toBe('00000000000000000009');
    expect(padSnowflake(LONG)).toHaveLength(20);
    expect(unpadSnowflake(padSnowflake(LONG))).toBe(LONG);
    expect(unpadSnowflake('00000000000000000000')).toBe('0');
  });

  it('estimates bytes as the serialized length', () => {
    const m = msg('1');
    expect(estimateMessageBytes(m)).toBe(JSON.stringify(m).length);
  });

  it('recognises quota errors by name, code and message', () => {
    expect(isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError(new Error('Failed to execute put: exceeded the quota.'))).toBe(true);
    expect(isQuotaExceededError(new Error('nope'))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });
});

describe('database', () => {
  it('creates the three stores and the author index', async () => {
    const db = await openWorkspaceDatabase();
    expect(db.name).toBe(WORKSPACE_DB_NAME);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['meta', 'rows', 'workspaces']);
    const tx = db.transaction('rows', 'readonly');
    expect(Array.from(tx.objectStore('rows').indexNames)).toEqual(['byAuthor']);
  });

  it('hands out the same connection twice', async () => {
    const a = await openWorkspaceDatabase();
    const b = await openWorkspaceDatabase();
    expect(a).toBe(b);
  });
});

describe('workspaces and meta', () => {
  it('ensureDefaultWorkspace creates Default once under a generated id and sets it as last and as Default', async () => {
    await deleteWorkspaceDatabase();
    const first = await ensureDefaultWorkspace();
    expect(first.name).toBe('Default');
    expect(first.wid).not.toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    const again = await ensureDefaultWorkspace();
    expect(again.wid).toBe(first.wid);
    expect(await getMeta()).toMatchObject({ lastWid: first.wid, order: [first.wid], defaultWid: first.wid });
    expect(await getDefaultWid()).toBe(first.wid);
  });

  it('ensureDefaultWorkspace adopts a Default written under the fixed id (ws-default-id)', async () => {
    // beforeEach made one under the legacy id and adopted it.
    expect((await getMeta()).defaultWid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect((await ensureDefaultWorkspace()).wid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect((await listWorkspaces()).map((w) => w.wid)).toEqual([LEGACY_DEFAULT_WORKSPACE_ID]);
  });
  it('creates, lists in meta order, reorders and renames', async () => {
    const a = await createWorkspace({ name: 'Raid archive', color: '#ff0000' });
    const b = await createWorkspace({ name: 'Mod logs' });
    expect((await listWorkspaces()).map((w) => w.name)).toEqual(['Default', 'Raid archive', 'Mod logs']);
    await setWorkspaceOrder([b.wid, a.wid, WID]);
    expect((await listWorkspaces()).map((w) => w.name)).toEqual(['Mod logs', 'Raid archive', 'Default']);
    await renameWorkspace(a.wid, 'Raid archive 2');
    expect((await getWorkspace(a.wid))?.name).toBe('Raid archive 2');
    expect((await getWorkspace(a.wid))?.color).toBe('#ff0000');
  });

  it('refuses a duplicate wid', async () => {
    await expect(createWorkspace({ wid: WID, name: 'again' })).rejects.toBeInstanceOf(WorkspaceStoreError);
  });

  it('updateWorkspace is a read modify write', async () => {
    const updated = await updateWorkspace(WID, (w) => {
      w.scope = { tab: 'channel', guildId: '42', channelId: CID, dmId: null };
    });
    expect(updated.scope.channelId).toBe(CID);
    expect((await getWorkspace(WID))?.scope.channelId).toBe(CID);
    await expect(updateWorkspace('missing', () => undefined)).rejects.toBeInstanceOf(WorkspaceStoreError);
  });

  it('setLastWorkspace changes the boot target', async () => {
    const a = await createWorkspace({ name: 'A' });
    await setLastWorkspace(a.wid);
    expect((await getMeta()).lastWid).toBe(a.wid);
  });

  it('deleteWorkspace removes rows, record and order, and falls back to Default as last', async () => {
    const a = await createWorkspace({ name: 'A' });
    await writePage(a.wid, CID, [msg('1'), msg('2')], seed);
    await setLastWorkspace(a.wid);
    await deleteWorkspace(a.wid);
    expect(await getWorkspace(a.wid)).toBeNull();
    expect(await countRows(a.wid, CID)).toBe(0);
    expect(await getMeta()).toEqual({ lastWid: WID, order: [WID], defaultWid: WID });
  });

  it('refuses to delete Default', async () => {
    await expect(deleteWorkspace(WID)).rejects.toBeInstanceOf(WorkspaceStoreError);
  });

  it('isWorkspaceOpenable keeps a newer schema row on disk but closed', async () => {
    const newer = await updateWorkspace(WID, (w) => {
      w.schema = WORKSPACE_SCHEMA_VERSION + 1;
    });
    expect(isWorkspaceOpenable(newer)).toBe(false);
    const stored = (await getWorkspace(WID)) as WorkspaceRecord;
    expect(stored.schema).toBe(WORKSPACE_SCHEMA_VERSION + 1);
    expect((await listWorkspaces()).map((w) => w.wid)).toContain(WID);
  });
});

describe('writePage', () => {
  it('round trips a page and seeds the conversation record', async () => {
    const page = [msg('3'), msg('1'), msg('2')];
    const result = await writePage(WID, CID, page, seed);
    expect(result).toEqual({
      added: 3,
      bytes: page.reduce((sum, m) => sum + estimateMessageBytes(m), 0),
      count: 3,
    });
    const conversation = await getConversation(WID, CID);
    expect(conversation).toMatchObject({ cid: CID, kind: 'channel', guildId: '42', name: 'general', count: 3, oldestId: '1', newestId: '3' });
    expect(conversation?.bytes).toBe(result.bytes);
    expect((await getWorkspace(WID))?.bytes).toBe(result.bytes);
    expect(await getMessages(WID, CID, ['1', '2', '3'])).toEqual([msg('1'), msg('2'), msg('3')]);
  });

  it('a later seed brings the names up to date and fills the guilds map (ws-conv-names)', async () => {
    await writePage(WID, CID, [msg('1')], { ...seed, guildName: 'Sandbox' });
    expect((await getWorkspace(WID))?.guilds).toEqual({ '42': 'Sandbox' });
    await writePage(WID, CID, [msg('2')], { ...seed, name: 'general-chat', guildName: 'Sandbox 2' });
    expect(await getConversation(WID, CID)).toMatchObject({ name: 'general-chat', count: 2 });
    expect((await getWorkspace(WID))?.guilds).toEqual({ '42': 'Sandbox 2' });
    await updateConversation(WID, CID, () => undefined, { ...seed, name: 'general' });
    expect((await getConversation(WID, CID))?.name).toBe('general');
  });

  it('refuses a page for an unseeded conversation', async () => {
    await expect(writePage(WID, CID, [msg('1')])).rejects.toBeInstanceOf(WorkspaceStoreError);
    expect(await getConversation(WID, CID)).toBeNull();
  });

  it('writing the same page twice adds nothing to count or bytes', async () => {
    const first = await writePage(WID, CID, [msg('1'), msg('2')], seed);
    const second = await writePage(WID, CID, [msg('1'), msg('2')]);
    expect(second).toEqual({ added: 0, bytes: 0, count: 2 });
    expect((await getConversation(WID, CID))?.bytes).toBe(first.bytes);
  });

  it('keeps key order across snowflake lengths', async () => {
    await writePage(WID, CID, [msg(LONG), msg(SHORT), msg(MID)], seed);
    expect((await readWindow(WID, CID)).map((m) => m.id)).toEqual([SHORT, MID, LONG]);
    expect((await readWindow(WID, CID, { direction: 'desc' })).map((m) => m.id)).toEqual([LONG, MID, SHORT]);
    const conversation = await getConversation(WID, CID);
    expect(conversation?.oldestId).toBe(SHORT);
    expect(conversation?.newestId).toBe(LONG);
  });

  it('keeps conversations and workspaces apart', async () => {
    const other = await createWorkspace({ name: 'Other' });
    await writePage(WID, CID, [msg('1')], seed);
    await writePage(WID, '2000', [msg('1'), msg('2')], { ...seed, name: 'random' });
    await writePage(other.wid, CID, [msg('5')], seed);
    expect(await countRows(WID, CID)).toBe(1);
    expect(await countRows(WID, '2000')).toBe(2);
    expect(await countRows(other.wid, CID)).toBe(1);
    expect((await getWorkspace(WID))?.bytes).toBe(
      estimateMessageBytes(msg('1')) * 2 + estimateMessageBytes(msg('2')),
    );
  });

  it('maps a quota failure to WorkspaceQuotaError and leaves the record untouched', async () => {
    await writePage(WID, CID, [msg('1')], seed);
    const before = await getConversation(WID, CID);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put() {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    try {
      const failure = writePage(WID, CID, [msg('2')]);
      await expect(failure).rejects.toBeInstanceOf(WorkspaceQuotaError);
      await expect(failure).rejects.toMatchObject({ wid: WID, cid: CID });
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    expect(await getConversation(WID, CID)).toEqual(before);
    expect(await countRows(WID, CID)).toBe(1);
  });
});

describe('refreshConversationNames (ws-conv-names)', () => {
  it('renames channels, DMs, thread parents and servers from a list, and writes nothing when nothing changed', async () => {
    await writePage(WID, CID, [msg('1')], { ...seed, guildName: 'Old' });
    await writePage(WID, '2000', [msg('5', { channel_id: '2000' })], { kind: 'dm', guildId: null, name: 'sam' });
    await writePage(WID, '3000', [msg('6', { channel_id: '3000' })], { kind: 'thread', guildId: '42', name: 'patch', parentName: 'general' });
    await updateConversation(WID, CID, (c) => { c.threadTabs = ['3000']; });
    const writes = vi.fn();
    const off = onWorkspaceStoreChange(writes);
    expect(await refreshConversationNames(WID, { guilds: { '42': 'Old' }, channels: { [CID]: 'general', '9': 'other' } })).toBe(false);
    expect(await refreshConversationNames(WID, { guilds: { '42': 'Sandbox' }, channels: { [CID]: 'general-chat' }, dms: { '2000': 'sam, alex' } })).toBe(true);
    off();
    const record = await getWorkspace(WID);
    expect(record?.guilds).toEqual({ '42': 'Sandbox' });
    expect(record?.conversations[CID].name).toBe('general-chat');
    expect(record?.conversations['2000'].name).toBe('sam, alex');
    expect(record?.conversations['3000'].parentName).toBe('general-chat');
    expect(record?.conversations['3000'].name).toBe('patch');
  });

  it('a record written before the guilds map reads as an empty map', async () => {
    await updateWorkspace(WID, (r) => { delete (r as Partial<typeof r>).guilds; });
    expect((await getWorkspace(WID))?.guilds).toEqual({});
    expect((await listWorkspaces())[0].guilds).toEqual({});
  });
});

describe('reads', () => {
  beforeEach(async () => {
    await writePage(
      WID,
      CID,
      Array.from({ length: 10 }, (_, i) => msg(String(i + 1))),
      seed,
    );
  });

  it('readWindow walks both ends with exclusive cursors and a limit', async () => {
    expect((await readWindow(WID, CID, { limit: 3 })).map((m) => m.id)).toEqual(['1', '2', '3']);
    expect((await readWindow(WID, CID, { afterId: '3', limit: 3 })).map((m) => m.id)).toEqual(['4', '5', '6']);
    expect((await readWindow(WID, CID, { beforeId: '3' })).map((m) => m.id)).toEqual(['1', '2']);
    expect((await readWindow(WID, CID, { direction: 'desc', limit: 2 })).map((m) => m.id)).toEqual(['10', '9']);
    expect((await readWindow(WID, CID, { direction: 'desc', beforeId: '9', limit: 2 })).map((m) => m.id)).toEqual(['8', '7']);
    expect((await readWindow(WID, CID, { afterId: '4', beforeId: '6' })).map((m) => m.id)).toEqual(['5']);
    expect(await readWindow(WID, CID, { afterId: '10' })).toEqual([]);
  });

  it('getMessages answers in the order asked with undefined for a missing id', async () => {
    const found = await getMessages(WID, CID, ['5', '99', '1']);
    expect(found.map((m) => m?.id)).toEqual(['5', undefined, '1']);
    expect(await getMessages(WID, CID, [])).toEqual([]);
  });

  it('readAuthorIds uses the index', async () => {
    const alice = createMockUser({ id: 'alice' });
    await writePage(WID, CID, [msg('11', { author: alice }), msg('12', { author: alice }), msg('13')]);
    expect(await readAuthorIds(WID, CID, 'alice')).toEqual(['11', '12']);
    expect(await readAuthorIds(WID, CID, 'nobody')).toEqual([]);
    expect(await readAuthorIds(WID, '2000', 'alice')).toEqual([]);
  });

  it('scan collects matches, reports progress and can stop early', async () => {
    await writePage(
      WID,
      CID,
      Array.from({ length: 1200 }, (_, i) => msg(String(100 + i), { content: i % 2 ? 'odd' : 'even' })),
    );
    const progress: number[] = [];
    const full = await scan(WID, CID, (m) => m.content === 'odd', { onProgress: (seen) => progress.push(seen) });
    expect(full.complete).toBe(true);
    expect(full.total).toBe(1210);
    expect(full.ids).toHaveLength(600);
    expect(progress).toEqual([500, 1000, 1210]);

    const stopped = await scan(WID, CID, () => true, { shouldStop: () => true });
    expect(stopped.complete).toBe(false);
    expect(stopped.seen).toBe(500);
    expect(stopped.ids).toHaveLength(500);
  });
});

describe('patch, delete and clear', () => {
  beforeEach(async () => {
    await writePage(WID, CID, [msg('1'), msg('2'), msg('3')], seed);
  });

  it('patchRows merges into stored messages and skips unknown ids', async () => {
    const patched = await patchRows(WID, CID, [
      { id: '2', patch: { content: 'edited', reactions: [] } },
      { id: '99', patch: { content: 'nope' } },
    ]);
    expect(patched).toBe(1);
    const [two] = await getMessages(WID, CID, ['2']);
    expect(two?.content).toBe('edited');
    expect(two?.channel_id).toBe(CID);
    expect(await patchRows(WID, CID, [])).toBe(0);
  });

  it('patchRows follows an author change into the index', async () => {
    await patchRows(WID, CID, [{ id: '3', patch: { author: createMockUser({ id: 'bob' }) } }]);
    expect(await readAuthorIds(WID, CID, 'bob')).toEqual(['3']);
  });

  it('deleteRows takes bytes off and moves the ends', async () => {
    const before = (await getConversation(WID, CID))!;
    const removed = await deleteRows(WID, CID, ['1', '3', '99']);
    expect(removed).toBe(2);
    const after = (await getConversation(WID, CID))!;
    expect(after.count).toBe(1);
    expect(after.oldestId).toBe('2');
    expect(after.newestId).toBe('2');
    expect(after.bytes).toBe(before.bytes - estimateMessageBytes(msg('1')) - estimateMessageBytes(msg('3')));
    expect((await getWorkspace(WID))?.bytes).toBe(after.bytes);
    await deleteRows(WID, CID, ['2']);
    expect((await getConversation(WID, CID))).toMatchObject({ count: 0, bytes: 0, oldestId: null, newestId: null });
  });

  it('clearConversation drops rows and keeps the filters', async () => {
    await updateConversation(WID, CID, (c) => {
      c.refineCriteria = { pinned: true } as never;
    });
    const cleared = await clearConversation(WID, CID);
    expect(cleared).toMatchObject({ count: 0, bytes: 0, oldestId: null, newestId: null, complete: false });
    expect(cleared?.refineCriteria).toEqual({ pinned: true });
    expect(await countRows(WID, CID)).toBe(0);
    expect((await getWorkspace(WID))?.bytes).toBe(0);
    expect(await clearConversation(WID, 'missing')).toBeNull();
  });

  it('deleteConversation drops rows and the record', async () => {
    await deleteConversation(WID, CID);
    expect(await getConversation(WID, CID)).toBeNull();
    expect(await countRows(WID, CID)).toBe(0);
    expect((await getWorkspace(WID))?.bytes).toBe(0);
  });

  it('clearWorkspaceMessages empties every conversation and keeps the records', async () => {
    await writePage(WID, '2000', [msg('7')], { ...seed, name: 'random' });
    const record = await clearWorkspaceMessages(WID);
    expect(record.bytes).toBe(0);
    expect(Object.keys(record.conversations).sort()).toEqual([CID, '2000']);
    expect(record.conversations[CID].count).toBe(0);
    expect(await countRows(WID, CID)).toBe(0);
    expect(await countRows(WID, '2000')).toBe(0);
  });

  it('updateConversation seeds a missing record only when told to', async () => {
    await expect(updateConversation(WID, '3000', () => undefined)).rejects.toBeInstanceOf(WorkspaceStoreError);
    const created = await updateConversation(
      WID,
      '3000',
      (c) => {
        c.selectedIds = ['1'];
      },
      { kind: 'dm', guildId: null, name: 'alice' },
    );
    expect(created).toMatchObject({ cid: '3000', kind: 'dm', selectedIds: ['1'] });
  });
});

describe('duplicateWorkspace', () => {
  it('copies the record and every row under a new wid', async () => {
    await writePage(WID, CID, [msg('1'), msg('2')], seed);
    await updateWorkspace(WID, (w) => {
      w.authors.alice = { id: 'alice', username: 'alice', globalName: null, nickname: null, avatar: null, bot: false };
    });
    const copy = await duplicateWorkspace(WID, 'Default copy', 123);
    expect(copy.wid).not.toBe(WID);
    expect(copy).toMatchObject({ name: 'Default copy', createdAt: 123, lastOpened: 123 });
    expect(copy.conversations[CID].count).toBe(2);
    expect(copy.authors.alice.username).toBe('alice');
    expect((await readWindow(copy.wid, CID)).map((m) => m.id)).toEqual(['1', '2']);
    expect(await countRows(WID, CID)).toBe(2);
    expect((await getMeta()).order).toEqual([WID, copy.wid]);
  });
});

describe('workspace lock', () => {
  afterEach(() => {
    releaseWorkspaceLock('w1');
    releaseWorkspaceLock('w2');
  });

  /** A tiny Locks API: exclusive only, honours ifAvailable, one origin, query() lists what is held. */
  function fakeLocks() {
    const held = new Set<string>();
    return {
      request: vi.fn(async (name: string, options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => unknown) => {
        if (held.has(name)) {
          if (options.ifAvailable) return callback(null);
          throw new Error('would block');
        }
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
        }
      }),
      query: vi.fn(async () => ({ held: [...held].map((name) => ({ name, mode: 'exclusive' })), pending: [] })),
      held,
    };
  }

  it('assumes one window when the Locks API is missing', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
    expect(await acquireWorkspaceLock('w1')).toBe(true);
    expect(holdsWorkspaceLock('w1')).toBe(true);
    expect(await isWorkspaceHeldElsewhere('w2')).toBe(false);
  });

  it('takes and releases the exclusive lock, refusing a second holder', async () => {
    const locks = fakeLocks();
    vi.stubGlobal('navigator', { ...navigator, locks });
    expect(await acquireWorkspaceLock('w1')).toBe(true);
    expect(locks.held.has('discrub-workspace-w1')).toBe(true);
    expect(await acquireWorkspaceLock('w1')).toBe(true);
    expect(await isWorkspaceHeldElsewhere('w1')).toBe(false);

    // Another window: our module no longer records the hold, the API still does.
    releaseWorkspaceLock('w1');
    await Promise.resolve();
    expect(locks.held.has('discrub-workspace-w1')).toBe(false);
    locks.held.add('discrub-workspace-w1');
    expect(await acquireWorkspaceLock('w1')).toBe(false);
    expect(holdsWorkspaceLock('w1')).toBe(false);
    expect(await isWorkspaceHeldElsewhere('w1')).toBe(true);
  });

  it('asks about another window without taking the lock', async () => {
    const locks = fakeLocks();
    vi.stubGlobal('navigator', { ...navigator, locks });
    expect(await isWorkspaceHeldElsewhere('w2')).toBe(false);
    expect(locks.request).not.toHaveBeenCalled();
    expect(await acquireWorkspaceLock('w2')).toBe(true);
  });
});

describe('readStorageEstimate', () => {
  it('returns null without the API', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    expect(await readStorageEstimate()).toBeNull();
  });

  it('reports usage, quota and remaining', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: { estimate: async () => ({ usage: 400, quota: 1000 }) } });
    expect(await readStorageEstimate()).toEqual({ usage: 400, quota: 1000, remaining: 600 });
  });

  it('never reports negative remaining and swallows a refusal', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: { estimate: async () => ({ usage: 1200, quota: 1000 }) } });
    expect((await readStorageEstimate())?.remaining).toBe(0);
    vi.stubGlobal('navigator', { ...navigator, storage: { estimate: async () => { throw new Error('no'); } } });
    expect(await readStorageEstimate()).toBeNull();
  });
});
