import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage, createMockChannel, createMockDmChannel } from '@/test/fixtures';
import { createBaseState } from '@/test/state-factories';
import type { RootState } from '@/app/store';
import { LEGACY_DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import {
  countRows,
  deleteWorkspaceDatabase,
  getConversation,
  getMessages,
  getSelection,
  setSelection,
  updateConversation,
  writePage,
} from '@services/workspaceStore';
import { getCachedMessage } from './messageCache';
import * as operationLoopUtils from '@/utils/operationLoopUtils';
import {
  conversationSeedFromState,
  paginationRecord,
  persistConversation,
  persistPage,
  persistRowDeletes,
  persistRowPatches,
  persistRowUpdates,
  persistSelection,
  resetPersistenceWarnings,
  restoreConversation,
  threadSeedFromState,
} from './messagePersistence';
import { initialWorkspaceState } from '@features/workspace/workspaceSlice';

vi.mock('@/utils/operationLoopUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/operationLoopUtils')>();
  return { ...actual, waitWhilePaused: vi.fn().mockResolvedValue(undefined), checkCancelled: vi.fn().mockReturnValue(false) };
});

const CID = '1000';
const seed = { kind: 'channel' as const, guildId: '42', name: 'general' };
const msg = (id: string, overrides: Partial<Message> = {}): Message => createMockMessage({ id, channel_id: CID, ...overrides });

const readyState = (overrides: Partial<RootState> = {}): RootState =>
  createBaseState({ workspace: { ...initialWorkspaceState, currentWid: LEGACY_DEFAULT_WORKSPACE_ID, ready: true }, ...overrides });

const apiFor = (state: RootState) => {
  const dispatch = vi.fn();
  return { api: { dispatch, getState: () => state }, dispatch };
};

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
  resetPersistenceWarnings();
  vi.mocked(operationLoopUtils.checkCancelled).mockReturnValue(false);
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('seeds', () => {
  it('describes the selected channel with its guild', () => {
    const state = createBaseState({
      channel: { ...createBaseState().channel, selectedChannel: createMockChannel({ id: CID, name: 'general', guild_id: '42' }) },
      guild: { ...createBaseState().guild, selectedGuild: { id: '42', name: 'Guild' } as never },
    });
    expect(conversationSeedFromState(state, CID)).toEqual({ kind: 'channel', guildId: '42', name: 'general', guildName: 'Guild' });
    expect(conversationSeedFromState(state, 'other')).toBeNull();
  });

  it('describes the selected DM by its recipients', () => {
    const state = createBaseState({
      dm: { ...createBaseState().dm, selectedDm: createMockDmChannel({ id: '2000' }) },
    });
    const dmSeed = conversationSeedFromState(state, '2000');
    expect(dmSeed?.kind).toBe('dm');
    expect(dmSeed?.guildId).toBeNull();
    expect(dmSeed?.name).toBeTruthy();
  });

  it('describes an open thread tab', () => {
    const base = createBaseState();
    const state = createBaseState({
      message: { ...base.message, threadTabs: { t1: { ...base.message, threadId: 't1', threadName: 'Plans', rows: [], filteredRows: [], selectedIds: [], contentMatchIds: null, searchCriteria: null, refineCriteria: null, order: base.message.order, isLoading: false, error: null, pagination: base.message.pagination } } },
      guild: { ...base.guild, selectedGuild: { id: '42', name: 'Guild' } as never },
    });
    expect(threadSeedFromState(state, 't1')).toEqual({ kind: 'thread', guildId: '42', name: 'Plans', guildName: 'Guild', parentName: null });
    expect(threadSeedFromState(state, 'nope')).toBeNull();
  });
});

describe('paginationRecord', () => {
  it('fills the fields a thunk does not know', () => {
    expect(paginationRecord({ mode: 'search', totalCount: 9 })).toEqual({
      mode: 'search', lastMessageId: null, hasMore: true, totalCount: 9, searchOffset: 0, searchBeforeDate: null,
    });
  });
});

describe('persistPage', () => {
  it('skips while workspaces are not ready', async () => {
    const { api } = apiFor(createBaseState());
    expect(await persistPage(api, CID, [msg('1')], { seed })).toBe('skipped');
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(0);
  });

  it('writes the page, seeds the record and merges the record fields', async () => {
    const { api } = apiFor(readyState());
    const outcome = await persistPage(api, CID, [msg('2'), msg('1')], {
      seed,
      record: { pagination: paginationRecord({ mode: 'paginated', lastMessageId: '1', hasMore: true }) },
    });
    expect(outcome).toBe('written');
    const conversation = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(conversation).toMatchObject({ name: 'general', count: 2, oldestId: '1', newestId: '2' });
    expect(conversation?.pagination.lastMessageId).toBe('1');
  });

  it('writes the backfill first only when the record does not exist yet', async () => {
    const { api } = apiFor(readyState());
    await persistPage(api, CID, [msg('3')], { seed, backfill: [msg('5'), msg('4')] });
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(3);
    await persistPage(api, CID, [msg('2')], { seed, backfill: [msg('9')] });
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(4);
  });

  it('refuses silently for a conversation without a seed or record, once', async () => {
    const { api, dispatch } = apiFor(readyState());
    expect(await persistPage(api, CID, [msg('1')])).toBe('failed');
    expect(await persistPage(api, CID, [msg('1')])).toBe('failed');
    const warnings = dispatch.mock.calls.filter(([a]) => (a as { payload?: { level?: string } }).payload?.level === 'warning');
    expect(warnings).toHaveLength(1);
  });

  it('pauses the run with the storageFull hold on a quota failure and retries after resume', async () => {
    const { api, dispatch } = apiFor(readyState());
    const original = IDBObjectStore.prototype.put;
    let failures = 1;
    IDBObjectStore.prototype.put = function put(this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
      if (failures > 0) {
        failures--;
        throw new DOMException('full', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
    try {
      const outcome = await persistPage(api, CID, [msg('1')], { seed, loaded: 48200 });
      expect(outcome).toBe('written');
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const actions = dispatch.mock.calls.map(([a]) => a as { type: string; payload?: unknown });
    expect(actions.some((a) => a.type === 'app/setDiscrubPaused' && a.payload === true)).toBe(true);
    expect(actions.some((a) => a.type === 'app/setOperationHold' && (a.payload as { kind?: string; loaded?: number })?.loaded === 48199)).toBe(true);
    expect(operationLoopUtils.waitWhilePaused).toHaveBeenCalled();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(1);
  });

  it('answers cancelled when the user stops while paused on a full disk', async () => {
    const { api } = apiFor(readyState());
    vi.mocked(operationLoopUtils.checkCancelled).mockReturnValue(true);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put() {
      throw new DOMException('full', 'QuotaExceededError');
    };
    try {
      expect(await persistPage(api, CID, [msg('1')], { seed, loaded: 0 })).toBe('cancelled');
    } finally {
      IDBObjectStore.prototype.put = original;
    }
  });

  it('keeps a single page in memory on a full disk with one warning, no pause', async () => {
    const { api, dispatch } = apiFor(readyState());
    vi.mocked(operationLoopUtils.waitWhilePaused).mockClear();
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put() {
      throw new DOMException('full', 'QuotaExceededError');
    };
    try {
      expect(await persistPage(api, CID, [msg('1')], { seed })).toBe('failed');
      expect(await persistPage(api, CID, [msg('2')], { seed })).toBe('failed');
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const actions = dispatch.mock.calls.map(([a]) => a as { type: string; payload?: { message?: string } });
    expect(actions.some((a) => a.type === 'app/setDiscrubPaused')).toBe(false);
    expect(actions.some((a) => a.type === 'app/setOperationHold')).toBe(false);
    expect(actions.filter((a) => a.payload?.message === 'Browser storage is full, messages loaded now are not saved')).toHaveLength(1);
    expect(operationLoopUtils.waitWhilePaused).not.toHaveBeenCalled();
  });
});

describe('records, patches and deletes', () => {
  it('persistConversation merges fields and stays quiet for a record nobody wrote', async () => {
    const { api, dispatch } = apiFor(readyState());
    expect(await persistConversation(api, CID, { selectedIds: ['1'] })).toBe('skipped');
    expect(dispatch).not.toHaveBeenCalled();
    expect(await persistConversation(api, CID, { selectedIds: ['1'] }, seed)).toBe('written');
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.selectedIds).toEqual(['1']);
  });

  it('persistRowPatches and persistRowDeletes reach the rows', async () => {
    const { api } = apiFor(readyState());
    await persistPage(api, CID, [msg('1'), msg('2')], { seed });
    expect(await persistRowPatches(api, CID, [{ id: '1', patch: { content: 'edited' } }])).toBe('written');
    expect(await persistRowDeletes(api, CID, ['2'])).toBe('written');
    const restored = await restoreConversation(api, CID);
    expect(restored?.rows.map((r) => r.id)).toEqual(['1']);
    expect(restored?.newest.map((m) => [m.id, m.content])).toEqual([['1', 'edited']]);
    expect(await persistRowPatches(api, CID, [])).toBe('skipped');
  });
});

describe('restoreConversation', () => {
  it('answers null for a conversation without rows', async () => {
    const { api } = apiFor(readyState());
    expect(await restoreConversation(api, CID)).toBeNull();
    await persistConversation(api, CID, {}, seed);
    expect(await restoreConversation(api, CID)).toBeNull();
  });

  it('reads every saved row oldest first across windows', async () => {
    const { api } = apiFor(readyState());
    const many = Array.from({ length: 2500 }, (_, i) => msg(String(100000 + i)));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, many, seed);
    const restored = await restoreConversation(api, CID);
    expect(restored?.rows).toHaveLength(2500);
    expect(restored?.rows[0].id).toBe('100000');
    expect(restored?.rows[2499].id).toBe('102499');
    expect(restored?.conversation.count).toBe(2500);
    expect(restored?.cid).toBe(CID);
    expect(restored?.wid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
  });

  // 2.2.5 W1: a restore keeps rows and authors for every message but full
  // objects for the newest window only.
  it('keeps full objects for the newest window only, topped up from the window before', async () => {
    const { api } = apiFor(readyState());
    const many = Array.from({ length: 4500 }, (_, i) => msg(String(100000 + i), {
      author: { id: `u${i % 3}`, username: `user${i % 3}` } as Message['author'],
    }));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, many, seed);
    const restored = await restoreConversation(api, CID);
    expect(restored?.rows).toHaveLength(4500);
    expect(restored?.newest).toHaveLength(2000);
    expect(restored?.newest[0].id).toBe('102500');
    expect(restored?.newest[1999].id).toBe('104499');
    expect(Object.keys(restored?.authors ?? {}).sort()).toEqual(['u0', 'u1', 'u2']);
    expect(restored?.rows[7].authorId).toBe('u1');
  });

  // 2.2.5 W2: rows come from the slim store and authors from the authors
  // store, so an author seen only in old messages still comes back.
  it('brings back authors of messages outside the newest window', async () => {
    const { api } = apiFor(readyState());
    const many = Array.from({ length: 2600 }, (_, i) => msg(String(100000 + i), {
      author: { id: i === 0 ? 'old-author' : 'regular', username: i === 0 ? 'old' : 'reg' } as Message['author'],
    }));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, many, seed);
    const restored = await restoreConversation(api, CID);
    expect(restored?.newest.some((m) => m.author.id === 'old-author')).toBe(false);
    expect(restored?.authors['old-author']?.username).toBe('old');
    expect(restored?.rows[0].authorId).toBe('old-author');
  });

  it('answers the saved selection from its own key', async () => {
    const { api } = apiFor(readyState());
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1'), msg('2')], seed);
    expect((await restoreConversation(api, CID))?.selectedIds).toEqual([]);
    await setSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID, ['2']);
    expect((await restoreConversation(api, CID))?.selectedIds).toEqual(['2']);
  });

  it('moves a selection saved in the record to its own key and drops the field', async () => {
    const { api } = apiFor(readyState());
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1'), msg('2')], seed);
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => { c.selectedIds = ['1']; });
    expect((await restoreConversation(api, CID))?.selectedIds).toEqual(['1']);
    expect(await getSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toEqual(['1']);
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.selectedIds).toBeUndefined();
  });
});

describe('selection and row updates (2.2.5 W1)', () => {
  it('persistSelection writes only for a saved conversation, and an empty selection clears the key', async () => {
    const { api } = apiFor(readyState());
    expect(await persistSelection(api, CID, ['1'])).toBe('skipped');
    expect(await getSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], seed);
    expect(await persistSelection(api, CID, ['1'])).toBe('written');
    expect(await getSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toEqual(['1']);
    expect(await persistSelection(api, CID, [])).toBe('written');
    expect(await getSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();
  });

  it('persistRowUpdates changes messages the cache does not hold and answers them', async () => {
    const { api } = apiFor(readyState());
    const reacted = msg('1', { reactions: [{ count: 1, me: true, emoji: { name: 'x' } }] as Message['reactions'] });
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [reacted, msg('2')], seed);
    expect(getCachedMessage('main', '1')).toBeUndefined();
    const changed = await persistRowUpdates(api, CID, ['1', '2', '9'], (m) => (m.reactions?.length ? { ...m, reactions: [] } : m));
    expect(changed.map((m) => m.id)).toEqual(['1']);
    const [stored] = await getMessages(LEGACY_DEFAULT_WORKSPACE_ID, CID, ['1']);
    expect(stored?.reactions).toEqual([]);
  });
});
