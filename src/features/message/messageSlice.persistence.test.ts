/**
 * 2.2.5 WP2a: the message thunks write through to the workspace store and
 * a conversation with saved rows comes back from disk.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { Message } from 'discrub-core/types/discord-types';
import { DiscordService } from 'discrub-core/discord-service';
import { createMockMessage, createMockChannel } from '@/test/fixtures';
import * as discordService from '@services/discordService';
import messageReducer, {
  clearMessages,
  clearSavedMessages,
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
import { DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import {
  countRows,
  deleteWorkspaceDatabase,
  ensureDefaultWorkspace,
  getConversation,
  readWindow,
  updateConversation,
  writePage,
} from '@services/workspaceStore';

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
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  store.dispatch(setCurrentWorkspace(DEFAULT_WORKSPACE_ID));
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
  await ensureDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('fetchMessages', () => {
  it('only opens a conversation: the first page is not written', async () => {
    const store = makeStore();
    serviceWith({ fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: page(100, 100) }) });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(store.getState().message.messages).toHaveLength(100);
    expect(await getConversation(DEFAULT_WORKSPACE_ID, CID)).toBeNull();
    expect(selectRestored(store.getState() as never)).toBeNull();
  });

  it('restores a conversation with saved rows instead of fetching', async () => {
    const store = makeStore();
    const fetchMessageData = vi.fn();
    serviceWith({ fetchMessageData });
    await writePage(DEFAULT_WORKSPACE_ID, CID, page(300, 300), { kind: 'channel', guildId: '42', name: 'general' });
    await updateConversation(DEFAULT_WORKSPACE_ID, CID, (c) => {
      c.pagination = { ...c.pagination, mode: 'paginated', lastMessageId: '1', hasMore: true };
      c.selectedIds = ['5', '7'];
      c.refineCriteria = null;
    });

    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));

    expect(fetchMessageData).not.toHaveBeenCalled();
    const state = store.getState().message;
    expect(state.messages).toHaveLength(300);
    expect(state.messages[0].id).toBe('300');
    expect(state.pagination).toMatchObject({ mode: 'paginated', lastMessageId: '1', hasMore: true });
    expect(state.selectedMessages.map((m) => m.id).sort()).toEqual(['5', '7']);
    expect(selectRestored(store.getState() as never)).toEqual({ count: 300, oldestTimestamp: state.messages[299].timestamp });
    const statusLines = store.getState().status.entries.map((e) => e.message);
    expect(statusLines.some((line) => /Restored 300 messages/.test(line))).toBe(true);
  });

  it('clearMessages forgets the restored marker', async () => {
    const store = makeStore();
    await writePage(DEFAULT_WORKSPACE_ID, CID, page(3, 3), { kind: 'channel', guildId: '42', name: 'general' });
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
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(200);
    const record = await getConversation(DEFAULT_WORKSPACE_ID, CID);
    expect(record?.pagination).toMatchObject({ mode: 'paginated', lastMessageId: '1', hasMore: true });
    expect(record?.name).toBe('general');
  });
});

describe('searchMessages', () => {
  it('replaces the saved rows with the results and keeps the criteria', async () => {
    const store = makeStore();
    await writePage(DEFAULT_WORKSPACE_ID, CID, page(50, 50), { kind: 'channel', guildId: '42', name: 'general' });
    const hits = page(9, 3);
    serviceWith({
      fetchSearchMessageData: vi.fn().mockResolvedValue({ success: true, data: { messages: hits.map((m) => [m]), total_results: 3 } }),
    });
    const criteria = { searchMessageContents: ['hello'], userIds: [], mentionIds: [], channelIds: [], selectedHasTypes: [], isPinned: 0, authorType: null, searchAfterDate: null, searchBeforeDate: null } as never;
    await store.dispatch(searchMessages({ channelId: CID, guildId: '42', token: TOKEN, searchCriteria: criteria }));
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(3);
    const record = await getConversation(DEFAULT_WORKSPACE_ID, CID);
    expect(record?.pagination).toMatchObject({ mode: 'search', totalCount: 3, searchOffset: 3, hasMore: false });
    expect((record?.searchCriteria as { searchMessageContents: string[] }).searchMessageContents).toEqual(['hello']);
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
    expect(store.getState().message.messages).toHaveLength(250);
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(250);
    const record = await getConversation(DEFAULT_WORKSPACE_ID, CID);
    expect(record).toMatchObject({ complete: true, count: 250, oldestId: '1', newestId: '250' });
    expect(record?.pagination).toMatchObject({ mode: 'all', hasMore: false, lastMessageId: '1' });
  });

  it('continues from the restored cursor instead of walking from the top', async () => {
    const store = makeStore();
    await writePage(DEFAULT_WORKSPACE_ID, CID, page(300, 100), { kind: 'channel', guildId: '42', name: 'general' });
    await updateConversation(DEFAULT_WORKSPACE_ID, CID, (c) => {
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
    expect(store.getState().message.messages).toHaveLength(300);
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(300);
    expect((await getConversation(DEFAULT_WORKSPACE_ID, CID))?.complete).toBe(true);
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
    expect(store.getState().message.messages).toHaveLength(150);
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(150);
    expect(store.getState().app.operationHold).toEqual({ kind: 'storageFull', loaded: 100 });
    const statusLines = store.getState().status.entries.map((e) => e.message);
    expect(statusLines.some((line) => /storage is full/.test(line))).toBe(true);
  });
});

describe('openThreadTab', () => {
  it('writes the thread first page, the parent record, and restores next time', async () => {
    const store = makeStore();
    await writePage(DEFAULT_WORKSPACE_ID, CID, page(2, 2), { kind: 'channel', guildId: '42', name: 'general' });
    const threadPage = page(5, 5).map((m) => ({ ...m, channel_id: 't1' }));
    const fetchMessageData = vi.fn().mockResolvedValue({ success: true, data: threadPage });
    serviceWith({ fetchMessageData });
    await store.dispatch(openThreadTab({ threadId: 't1', threadName: 'Plans', token: TOKEN }));
    expect(fetchMessageData).toHaveBeenCalledTimes(1);
    expect(await countRows(DEFAULT_WORKSPACE_ID, 't1')).toBe(5);
    expect((await getConversation(DEFAULT_WORKSPACE_ID, 't1'))).toMatchObject({ kind: 'thread', name: 'Plans' });
    expect((await getConversation(DEFAULT_WORKSPACE_ID, CID))?.threadTabs).toEqual(['t1']);

    // A fresh store (a reload) opens the same thread from disk.
    const again = makeStore();
    serviceWith({ fetchMessageData });
    await again.dispatch(openThreadTab({ threadId: 't1', threadName: 'Plans', token: TOKEN }));
    expect(fetchMessageData).toHaveBeenCalledTimes(1);
    expect(again.getState().message.threadTabs.t1.messages).toHaveLength(5);
    expect(again.getState().message.threadTabs.t1.isLoading).toBe(false);
  });
});

describe('clearSavedMessages', () => {
  it('drops the saved rows so the next open fetches', async () => {
    const store = makeStore();
    await writePage(DEFAULT_WORKSPACE_ID, CID, page(3, 3), { kind: 'channel', guildId: '42', name: 'general' });
    await store.dispatch(clearSavedMessages({ cid: CID }));
    expect(await countRows(DEFAULT_WORKSPACE_ID, CID)).toBe(0);
    expect(await readWindow(DEFAULT_WORKSPACE_ID, CID)).toEqual([]);
    const fetchMessageData = vi.fn().mockResolvedValue({ success: true, data: page(1, 1) });
    serviceWith({ fetchMessageData });
    await store.dispatch(fetchMessages({ channelId: CID, token: TOKEN }));
    expect(fetchMessageData).toHaveBeenCalledTimes(1);
    store.dispatch(toggleMessageSelection(page(1, 1)[0]));
  });
});
