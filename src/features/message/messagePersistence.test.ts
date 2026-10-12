import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage, createMockChannel, createMockDmChannel } from '@/test/fixtures';
import { createBaseState } from '@/test/state-factories';
import type { RootState } from '@/app/store';
import { DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import {
  countRows,
  deleteWorkspaceDatabase,
  ensureDefaultWorkspace,
  getConversation,
  writePage,
} from '@services/workspaceStore';
import * as operationLoopUtils from '@/utils/operationLoopUtils';
import {
  conversationSeedFromState,
  paginationRecord,
  persistConversation,
  persistPage,
  persistRowDeletes,
  persistRowPatches,
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
  createBaseState({ workspace: { ...initialWorkspaceState, currentWid: DEFAULT_WORKSPACE_ID, ready: true }, ...overrides });

const apiFor = (state: RootState) => {
  const dispatch = vi.fn();
  return { api: { dispatch, getState: () => state }, dispatch };
};

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureDefaultWorkspace();
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
    expect(conversationSeedFromState(state, CID)).toEqual({ kind: 'channel', guildId: '42', name: 'general' });
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
    expect(threadSeedFromState(state, 't1')).toEqual({ kind: 'thread', guildId: '42', name: 'Plans' });
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
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(0);
  });

  it('writes the page, seeds the record and merges the record fields', async () => {
    const { api } = apiFor(readyState());
    const outcome = await persistPage(api, CID, [msg('2'), msg('1')], {
      seed,
      record: { pagination: paginationRecord({ mode: 'paginated', lastMessageId: '1', hasMore: true }) },
    });
    expect(outcome).toBe('written');
    const conversation = await getConversation(DEFAULT_WORKSPACE_ID, CID);
    expect(conversation).toMatchObject({ name: 'general', count: 2, oldestId: '1', newestId: '2' });
    expect(conversation?.pagination.lastMessageId).toBe('1');
  });

  it('writes the backfill first only when the record does not exist yet', async () => {
    const { api } = apiFor(readyState());
    await persistPage(api, CID, [msg('3')], { seed, backfill: [msg('5'), msg('4')] });
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(3);
    await persistPage(api, CID, [msg('2')], { seed, backfill: [msg('9')] });
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(4);
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
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(1);
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
    expect(await persistConversation(api, CID, { selectedIds: ['1'] })).toBe('failed');
    expect(dispatch).not.toHaveBeenCalled();
    expect(await persistConversation(api, CID, { selectedIds: ['1'] }, seed)).toBe('written');
    expect((await getConversation(DEFAULT_WORKSPACE_ID, CID))?.selectedIds).toEqual(['1']);
  });

  it('persistRowPatches and persistRowDeletes reach the rows', async () => {
    const { api } = apiFor(readyState());
    await persistPage(api, CID, [msg('1'), msg('2')], { seed });
    expect(await persistRowPatches(api, CID, [{ id: '1', patch: { content: 'edited' } }])).toBe('written');
    expect(await persistRowDeletes(api, CID, ['2'])).toBe('written');
    const restored = await restoreConversation(api, CID);
    expect(restored?.messages.map((m) => [m.id, m.content])).toEqual([['1', 'edited']]);
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
    await writePage(DEFAULT_WORKSPACE_ID, CID, many, seed);
    const restored = await restoreConversation(api, CID);
    expect(restored?.messages).toHaveLength(2500);
    expect(restored?.messages[0].id).toBe('100000');
    expect(restored?.messages[2499].id).toBe('102499');
    expect(restored?.conversation.count).toBe(2500);
  });
});
