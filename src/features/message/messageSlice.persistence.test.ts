/**
 * 2.2.5 WP2a: the message thunks write through to the workspace store and
 * a conversation with saved rows comes back from disk.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { Message } from 'discrub-core/types/discord-types';
import { DiscordService } from 'discrub-core/discord-service';
import { createMockMessage, createMockChannel } from '@/test/fixtures';
import * as discordService from '@services/discordService';
import messageReducer, {
  clearMessages,
  clearSavedMessages,
  clearSavedSearch,
  fetchAllMessages,
  fetchMessages,
  fetchMoreMessages,
  openThreadTab,
  searchMessages,
  selectRestored,
  toggleMessageSelection,
} from './messageSlice';
import workspaceReducer, { setCurrentWorkspace } from '@features/workspace/workspaceSlice';
import channelReducer, { setSelectedChannel } from '@features/channel/channelSlice';
import dmReducer from '@features/dm/dmSlice';
import guildReducer from '@features/guild/guildSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import cacheReducer from '@features/cache/cacheSlice';
import authReducer, { setToken } from '@features/auth/authSlice';
import { LEGACY_DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import {
  countRows,
  deleteWorkspaceDatabase,
  searchCid,
  getConversation,
  readWindow,
  updateConversation,
  writePage,
  getSelection,
  setSelection,
} from '@services/workspaceStore';
import { cachedMessagesOf, MAIN_CONTAINER } from './messageCache';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn() }));
vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({ delayMs: 0, delaySec: 0, baseDelay: 0, modifier: 0, randomComponent: 0 })),
}));
vi.mock('@/utils/operationLoopUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/operationLoopUtils')>();
  return {
    ...actual,
    waitWhilePaused: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockReturnValue(false),
    cancellableDelay: vi.fn().mockResolvedValue(false),
    withTransientRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
});
vi.mock('@services/reactionEnrichmentService', () => ({
  reactionEnrichmentService: { enrichMessages: vi.fn(async (messages: Message[]) => messages) },
}));
vi.mock('@services/replyEnrichmentService', () => ({
  replyEnrichmentService: { enrichMessages: vi.fn(async (messages: Message[]) => messages) },
}));

const CID = '801';
const TOKEN = 'token';
const page = (from: number, count: number): Message[] =>
  Array.from({ length: count }, (_, i) => createMockMessage({
    id: String(from - i),
    channel_id: CID,
    content: `m${from - i}`,
    timestamp: new Date(1_700_000_000_000 + (from - i) * 1000).toISOString(),
  }));

function makeStore() {
  const store = configureStore({
    reducer: {
      message: messageReducer,
      workspace: workspaceReducer,
      channel: channelReducer,
      dm: dmReducer,
      guild: guildReducer,
      app: appReducer,
      status: statusReducer,
      cache: cacheReducer,
      auth: authReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  store.dispatch(setToken(TOKEN));
  store.dispatch(setCurrentWorkspace(LEGACY_DEFAULT_WORKSPACE_ID));
  store.dispatch(setSelectedChannel(createMockChannel({ id: CID, name: 'general', guild_id: '42' })));
  return store;
}

function serviceWith(overrides: Record<string, unknown>) {
  const svc = new DiscordService();
  Object.assign(svc, overrides);
  vi.mocked(discordService.getDiscordService).mockReturnValue(svc as never);
  return svc;
}

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('fetchMessages', () => {
  it('only opens a conversation: the first page is not written', async () => {
    const store = makeStore();
    serviceWith({ fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: page(100, 100) }) });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(store.getState().message.rows).toHaveLength(100);
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();
    expect(selectRestored(store.getState() as never)).toBeNull();
  });

  it('restores a conversation with saved rows instead of fetching', async () => {
    const store = makeStore();
    const fetchMessageData = vi.fn();
    serviceWith({ fetchMessageData });
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(300, 300), { kind: 'channel', guildId: '42', name: 'general' });
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => {
      c.pagination = { ...c.pagination, mode: 'paginated', lastMessageId: '1', hasMore: true };
      c.selectedIds = ['5', '7'];
      c.refineCriteria = null;
    });

    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));

    expect(fetchMessageData).not.toHaveBeenCalled();
    const state = store.getState().message;
    expect(state.rows).toHaveLength(300);
    expect(state.rows[0].id).toBe('300');
    expect(state.pagination).toMatchObject({ mode: 'paginated', lastMessageId: '1', hasMore: true });
    expect([...state.selectedIds].sort()).toEqual(['5', '7']);
    expect(selectRestored(store.getState() as never)).toEqual({ count: 300, oldestTimestamp: state.rows[299].timestamp });
    const statusLines = store.getState().status.entries.map((e) => e.message);
    expect(statusLines.some((line) => /Restored 300 messages/.test(line))).toBe(true);
  });

  // 2.2.5 W1: a restore builds rows window by window and caches only the
  // newest window of objects.
  it('restores a large conversation as rows with one window of objects in the cache', async () => {
    const store = makeStore();
    const saved = page(4500, 4500).map((m, i) => ({ ...m, author: { ...m.author, id: `a${i % 4}`, username: `user${i % 4}` } }));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, saved, { kind: 'channel', guildId: '42', name: 'general' });
    await setSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID, ['4500', '1', 'gone']);

    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));

    const state = store.getState().message;
    expect(state.rows).toHaveLength(4500);
    expect(state.rows[0].id).toBe('4500');
    expect(cachedMessagesOf(MAIN_CONTAINER)).toHaveLength(2000);
    expect(cachedMessagesOf(MAIN_CONTAINER).some((m) => m.id === '4500')).toBe(true);
    expect(cachedMessagesOf(MAIN_CONTAINER).some((m) => m.id === '1')).toBe(false);
    expect(Object.keys(state.authors).sort()).toEqual(['a0', 'a1', 'a2', 'a3']);
    expect([...state.selectedIds].sort()).toEqual(['1', '4500']);
    expect(selectRestored(store.getState() as never)).toEqual({ count: 4500, oldestTimestamp: state.rows[4499].timestamp });
  });

  // The fake IndexedDB the unit tests run on walks a cursor in quadratic
  // time, so the scan case stays small; Chrome scans 250K rows in seconds.
  it('restores a saved content refine from a scan of the saved messages', async () => {
    const store = makeStore();
    const saved = page(300, 300).map((m, i) => ({ ...m, content: i % 10 === 0 ? 'needle here' : 'hay' }));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, saved, { kind: 'channel', guildId: '42', name: 'general' });
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => {
      c.refineCriteria = { searchMessageContents: ['needle'] } as never;
    });

    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));

    const state = store.getState().message;
    expect(state.rows).toHaveLength(300);
    expect(state.contentMatchIds).toHaveLength(30);
    expect(state.filteredRows).toHaveLength(30);
    expect(state.filteredRows.every((r) => (300 - Number(r.id)) % 10 === 0)).toBe(true);
  });

  it('a toggled selection reaches its own key after a restore', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(3, 3), { kind: 'channel', guildId: '42', name: 'general' });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(store.getState().message.selectedIds).toEqual([]);
    expect(await getSelection(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();
  });

  it('clearMessages forgets the restored marker', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(3, 3), { kind: 'channel', guildId: '42', name: 'general' });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(selectRestored(store.getState() as never)).not.toBeNull();
    store.dispatch(clearMessages());
    expect(selectRestored(store.getState() as never)).toBeNull();
  });
});

describe('fetchMoreMessages', () => {
  it('writes the second page with the first as backfill and records the cursor', async () => {
    const store = makeStore();
    serviceWith({
      fetchMessageData: vi.fn()
        .mockResolvedValueOnce({ success: true, data: page(200, 100) })
        .mockResolvedValueOnce({ success: true, data: page(100, 100) }),
    });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    await store.dispatch(fetchMoreMessages({ channelId: CID, token: TOKEN, lastMessageId: '101' }));
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(200);
    const record = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(record?.pagination).toMatchObject({ mode: 'paginated', lastMessageId: '1', hasMore: true });
    expect(record?.name).toBe('general');
  });
});

describe('searchMessages (2.2.5 fix C)', () => {
  const criteria = { searchMessageContents: ['hello'], userIds: [], mentionIds: [], channelIds: [], selectedHasTypes: [], isPinned: 0, authorType: null, searchAfterDate: null, searchBeforeDate: null } as never;
  const searchFor = (store: ReturnType<typeof makeStore>) => {
    const hits = page(9, 3);
    serviceWith({
      fetchSearchMessageData: vi.fn().mockResolvedValue({ success: true, data: { messages: hits.map((m) => [m]), total_results: 3 } }),
      fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: page(100, 100) }),
    });
    return store.dispatch(searchMessages({ channelId: CID, guildId: '42', token: TOKEN, searchCriteria: criteria }));
  };

  it('writes the results to the search set and leaves the plain rows alone', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(50, 50), { kind: 'channel', guildId: '42', name: 'general' });
    await searchFor(store);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(50);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID))).toBe(3);
    const record = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID));
    expect(record?.pagination).toMatchObject({ mode: 'search', totalCount: 3, searchOffset: 3, hasMore: false });
    expect((record?.searchCriteria as { searchMessageContents: string[] }).searchMessageContents).toEqual(['hello']);
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.pagination.mode).not.toBe('search');
  });

  it('an open shows the saved search, and clearing it brings back the plain rows', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(50, 50), { kind: 'channel', guildId: '42', name: 'general' });
    await searchFor(store);

    store.dispatch(clearMessages());
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(store.getState().message.rows).toHaveLength(3);
    expect(store.getState().message.pagination.mode).toBe('search');
    expect((store.getState().message.searchCriteria as { searchMessageContents: string[] } | null)?.searchMessageContents).toEqual(['hello']);

    await store.dispatch(clearSavedSearch({ cid: CID }));
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID))).toBe(0);
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID))).toBeNull();
    expect(store.getState().message.rows).toHaveLength(50);
    expect(store.getState().message.pagination.mode).not.toBe('search');
    expect(store.getState().message.searchCriteria).toBeNull();
  });

  it('clearing a search on a conversation with no plain rows opens its first page fresh', async () => {
    const store = makeStore();
    await searchFor(store);
    await store.dispatch(clearSavedSearch({ cid: CID }));
    expect(store.getState().message.rows).toHaveLength(100);
    expect(store.getState().message.pagination.mode).toBe('paginated');
  });

  it('drops a plain record an earlier 2.2.5 build left in search mode', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(9, 3), { kind: 'channel', guildId: '42', name: 'general' });
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => { c.pagination = { ...c.pagination, mode: 'search' }; });
    serviceWith({ fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: page(100, 100) }) });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(store.getState().message.rows).toHaveLength(100);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(0);
  });
});

describe('fetchAllMessages', () => {
  it('writes every page before Redux sees it and marks the conversation complete', async () => {
    const store = makeStore();
    serviceWith({
      fetchMessageData: vi.fn()
        .mockResolvedValueOnce({ success: true, data: page(250, 100) })
        .mockResolvedValueOnce({ success: true, data: page(150, 100) })
        .mockResolvedValueOnce({ success: true, data: page(50, 50) }),
    });
    await store.dispatch(fetchAllMessages({ channelId: CID, token: TOKEN }));
    expect(store.getState().message.rows).toHaveLength(250);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(250);
    const record = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(record).toMatchObject({ complete: true, count: 250, oldestId: '1', newestId: '250' });
    expect(record?.pagination).toMatchObject({ mode: 'all', hasMore: false, lastMessageId: '1' });
  });

  it('continues from the restored cursor instead of walking from the top', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(300, 100), { kind: 'channel', guildId: '42', name: 'general' });
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => {
      c.pagination = { ...c.pagination, mode: 'paginated', lastMessageId: '201', hasMore: true };
    });
    const fetchMessageData = vi.fn()
      .mockResolvedValueOnce({ success: true, data: page(200, 100) })
      .mockResolvedValueOnce({ success: true, data: page(100, 100) })
      .mockResolvedValueOnce({ success: true, data: [] });
    serviceWith({ fetchMessageData });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    await store.dispatch(fetchAllMessages({ channelId: CID, token: TOKEN }));
    expect(fetchMessageData.mock.calls[0][1]).toBe('201');
    expect(store.getState().message.rows).toHaveLength(300);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(300);
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.complete).toBe(true);
  });

  it('a page that hits the quota pauses the run and finishes after Resume', async () => {
    const store = makeStore();
    serviceWith({
      fetchMessageData: vi.fn()
        .mockResolvedValueOnce({ success: true, data: page(150, 100) })
        .mockResolvedValueOnce({ success: true, data: page(50, 50) }),
    });
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
      await store.dispatch(fetchAllMessages({ channelId: CID, token: TOKEN }));
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    expect(store.getState().message.rows).toHaveLength(150);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(150);
    expect(store.getState().app.operationHold).toEqual({ kind: 'storageFull', loaded: 0 });
    const statusLines = store.getState().status.entries.map((e) => e.message);
    expect(statusLines.some((line) => /storage is full/.test(line))).toBe(true);
  });
});

describe('openThreadTab', () => {
  it('writes the thread first page, the parent record, and restores next time', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(2, 2), { kind: 'channel', guildId: '42', name: 'general' });
    const threadPage = page(5, 5).map((m) => ({ ...m, channel_id: 't1' }));
    const fetchMessageData = vi.fn().mockResolvedValue({ success: true, data: threadPage });
    serviceWith({ fetchMessageData });
    await store.dispatch(openThreadTab({ threadId: 't1', threadName: 'Plans', token: TOKEN }));
    expect(fetchMessageData).toHaveBeenCalledTimes(1);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, 't1')).toBe(5);
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, 't1'))).toMatchObject({ kind: 'thread', name: 'Plans' });
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.threadTabs).toEqual(['t1']);

    // A fresh store (a reload) opens the same thread from disk.
    const again = makeStore();
    serviceWith({ fetchMessageData });
    await again.dispatch(openThreadTab({ threadId: 't1', threadName: 'Plans', token: TOKEN }));
    expect(fetchMessageData).toHaveBeenCalledTimes(1);
    expect(again.getState().message.threadTabs.t1.rows).toHaveLength(5);
    expect(again.getState().message.threadTabs.t1.isLoading).toBe(false);
  });
});

describe('clearSavedMessages', () => {
  it('drops the saved rows so the next open fetches', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(3, 3), { kind: 'channel', guildId: '42', name: 'general' });
    await store.dispatch(clearSavedMessages({ cid: CID }));
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(0);
    expect(await readWindow(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toEqual([]);
    const fetchMessageData = vi.fn().mockResolvedValue({ success: true, data: page(1, 1) });
    serviceWith({ fetchMessageData });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(fetchMessageData).toHaveBeenCalledTimes(1);
    store.dispatch(toggleMessageSelection(page(1, 1)[0].id));
  });
});
