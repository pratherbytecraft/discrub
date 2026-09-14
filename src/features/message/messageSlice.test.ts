import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';

// A status-less failure only counts as "the network" while the browser is
// offline; online it is a refused request and stops instead of pausing.
const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
};
afterEach(() => setOnline(true));

import messageReducer, {
  messagesEdited,
  setThreadRefineCriteria,
  setMessages,
  setFilteredMessages,
  setSelectedMessages,
  toggleMessageSelection,
  selectAllMessages,
  deselectAllMessages,
  setSearchCriteria,
  setOrder,
  clearMessages,
  resetPagination,
  deleteMessage,
  deleteMessages,
  messagesRemoved,
  DELETE_BATCH_SIZE,
  editMessage,
  editMessages,
  fetchReactingUsers,
  deleteReaction,
  deleteAllReactions,
  bulkDeleteAllReactions,
  bulkDeleteReactionsForEmoji,
  batchRemoveReactions,
  batchAddReactions,
  deleteAttachment,
  deleteAllAttachments,
  fetchMessages,
  fetchMoreMessages,
  searchMessages,
  fetchAllMessages,
  selectMessage,
  selectMessages,
  selectFilteredMessages,
  selectSelectedMessages,
  selectSearchCriteria,
  selectMessageOrder,
  selectMessageLoading,
  selectMessageDeleting,
  selectMessageError,
  selectPagination,
  setActiveTab,
  addThreadTab,
  removeThreadTab,
  setThreadMessages,
  setThreadFilteredMessages,
  toggleThreadMessageSelection,
  selectAllThreadMessages,
  deselectAllThreadMessages,
  setThreadOrder,
  setThreadSearchCriteria,
  setThreadLoading,
  setThreadError,
  updateThreadPagination,
  selectActiveTab,
  selectThreadTabs,
  selectThreadTab,
  selectActiveMessages,
  selectActiveFilteredMessages,
  selectActiveSelectedMessages,
  selectActiveSearchCriteria,
  selectActiveOrder,
  selectActiveLoading,
  selectActiveError,
  selectActivePagination,
  openThreadTab,
  fetchMoreThreadMessages,
  fetchAllThreadMessages,
  searchThreadMessages,
  loadAllSearchResults,
  navigateToMessage,
  setHighlightedMessageId,
  selectHighlightedMessageId,
  applyUserFilter,
  cancelLoadAll,
  dismissLoadAllCancelled,
} from './messageSlice';
import { initialMessageState } from './messageTypes';
import * as discordService from '@services/discordService';
import { DiscordService } from 'discrub-core/discord-service';
import { createMockMessages, createMockMessage, createMockAttachment, createMockReaction, createMockUser } from '@/test/fixtures';
import type { Message } from 'discrub-core/types/discord-types';
import { SortDirection } from 'discrub-core/common-enum';
import { addStatusEntry, showToast } from '@features/status/statusSlice';

// Mock dependencies
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));

vi.mock('discrub-core/discrub-utils', () => ({
  getSortedMessages: vi.fn((messages) => messages),
}));

vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({
    delayMs: 0,
    delaySec: 0,
    baseDelay: 0,
    modifier: 0,
    randomComponent: 0,
  })),
}));

vi.mock('@/utils/operationLoopUtils', async () => {
  const actual = await vi.importActual<typeof import('@/utils/operationLoopUtils')>(
    '@/utils/operationLoopUtils',
  );
  return {
    ...actual,
    // Pace stubs keep the bulk of the suite fast. Tests that need real
    // pause/cancel state-awareness (e.g. #185 pause-on-exhaustion) override
    // these mocks per-test with `.mockImplementation(...)`.
    waitWhilePaused: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockReturnValue(false),
    cancellableDelay: vi.fn().mockResolvedValue(false),
    // Instant fake of withTransientRetry — runs the same retry+predicate
    // contract as the real helper but skips the exponential backoff sleep.
    // Real backoff timing is covered by operationLoopUtils.test.ts; consumer
    // tests only care that the helper retries the right number of times,
    // invokes onRetry, and surfaces the final response.
    withTransientRetry: vi.fn(async (fn: () => Promise<any>, opts: any) => {
      const maxRetries = opts.maxRetries ?? 5;
      const shouldRetry = opts.shouldRetry ?? actual.isTransientApiFailure;
      let lastResponse: any = { success: false };
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        lastResponse = await fn();
        if (lastResponse.success || !shouldRetry(lastResponse, attempt)) return lastResponse;
        if (attempt === maxRetries) return lastResponse;
        opts.onRetry?.(attempt + 1, 1000, lastResponse);
      }
      return lastResponse;
    }),
  };
});

vi.mock('@features/status/statusSlice', () => ({
  addStatusEntry: vi.fn((payload) => ({ type: 'status/addStatusEntry', payload })),
  showOperationTip: vi.fn((message) => ({ type: 'status/showOperationTip', payload: message })),
  showToast: vi.fn((payload) => ({ type: 'status/showToast', payload })),
}));

vi.mock('discrub-core/discord-enum', async (importOriginal) => {
  // Spread the real enum so module-eval consumers (e.g. systemMessageGroups
  // building its bucket list from MessageType) resolve, while keeping the
  // explicit ReactionType/IsPinnedType overrides this suite relies on.
  const actual = await importOriginal<typeof import('discrub-core/discord-enum')>();
  return {
    ...actual,
    ReactionType: { NORMAL: 0, BURST: 1 },
    IsPinnedType: { UNSET: 0, YES: 1, NO: 2 },
  };
});

vi.mock('@services/reactionEnrichmentService', () => ({
  reactionEnrichmentService: {
    enrichMessages: vi.fn().mockImplementation(async (messages) => messages),
  },
}));

// #208: loadAllSearchResults now delegates pagination to the lib's real
// `iterateSearchResults` generator (always-cap-shift convergence) instead of
// hand-rolling offset pagination. These tests still want to drive behavior by
// mocking the low-level `fetchSearchMessageData`, so build a REAL DiscordService
// instance and override only that method — the genuine generator then runs over
// the mocked fetch, exercising the actual convergence logic in-process.
const makeSearchService = (overrides: Record<string, unknown>) => {
  const svc = new DiscordService();
  Object.assign(svc, overrides);
  return svc as unknown as ReturnType<typeof discordService.getDiscordService>;
};

describe('messageSlice', () => {
  let store: TestStore;

  const mockMessages: Message[] = createMockMessages(5);

  beforeEach(() => {
    store = createTestStore({ message: messageReducer });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = store.getState();
      expect(state.message).toEqual(initialMessageState);
      expect(state.message.messages).toEqual([]);
      expect(state.message.filteredMessages).toEqual([]);
      expect(state.message.selectedMessages).toEqual([]);
      expect(state.message.searchCriteria).toBeNull();
      expect(state.message.isLoading).toBe(false);
      expect(state.message.error).toBeNull();
    });
  });

  describe('reducers', () => {
    describe('setMessages', () => {
      it('should set messages', () => {
        store.dispatch(setMessages(mockMessages));

        const state = store.getState().message;
        expect(state.messages).toEqual(mockMessages);
      });

      it('should replace existing messages', () => {
        store.dispatch(setMessages(mockMessages));
        const newMessages = createMockMessages(3);
        store.dispatch(setMessages(newMessages));

        const state = store.getState().message;
        expect(state.messages).toEqual(newMessages);
        expect(state.messages).toHaveLength(3);
      });
    });

    describe('setFilteredMessages', () => {
      it('should set filtered messages', () => {
        const filtered = [mockMessages[0], mockMessages[1]];
        store.dispatch(setFilteredMessages(filtered));

        const state = store.getState().message;
        expect(state.filteredMessages).toEqual(filtered);
      });

      it('should allow empty filtered messages', () => {
        store.dispatch(setFilteredMessages([]));

        const state = store.getState().message;
        expect(state.filteredMessages).toEqual([]);
      });
    });

    describe('setSelectedMessages', () => {
      it('should set selected messages', () => {
        const selected = [mockMessages[0]];
        store.dispatch(setSelectedMessages(selected));

        const state = store.getState().message;
        expect(state.selectedMessages).toEqual(selected);
      });
    });

    describe('toggleMessageSelection', () => {
      it('should add message to selection if not selected', () => {
        store.dispatch(toggleMessageSelection(mockMessages[0]));

        const state = store.getState().message;
        expect(state.selectedMessages).toContainEqual(mockMessages[0]);
      });

      it('should remove message from selection if already selected', () => {
        store.dispatch(setSelectedMessages([mockMessages[0]]));
        store.dispatch(toggleMessageSelection(mockMessages[0]));

        const state = store.getState().message;
        expect(state.selectedMessages).not.toContainEqual(mockMessages[0]);
      });

      it('should handle multiple toggles', () => {
        store.dispatch(toggleMessageSelection(mockMessages[0]));
        expect(store.getState().message.selectedMessages).toHaveLength(1);

        store.dispatch(toggleMessageSelection(mockMessages[1]));
        expect(store.getState().message.selectedMessages).toHaveLength(2);

        store.dispatch(toggleMessageSelection(mockMessages[0]));
        expect(store.getState().message.selectedMessages).toHaveLength(1);
      });
    });

    describe('selectAllMessages', () => {
      it('should select all filtered messages', () => {
        store.dispatch(setFilteredMessages(mockMessages));
        store.dispatch(selectAllMessages());

        const state = store.getState().message;
        expect(state.selectedMessages).toEqual(mockMessages);
      });

      it('should handle empty filtered messages', () => {
        store.dispatch(setFilteredMessages([]));
        store.dispatch(selectAllMessages());

        const state = store.getState().message;
        expect(state.selectedMessages).toEqual([]);
      });

      it('should replace previous selection', () => {
        store.dispatch(setSelectedMessages([mockMessages[0]]));
        store.dispatch(setFilteredMessages(mockMessages));
        store.dispatch(selectAllMessages());

        const state = store.getState().message;
        expect(state.selectedMessages).toHaveLength(mockMessages.length);
      });
    });

    describe('deselectAllMessages', () => {
      it('should clear selected messages', () => {
        store.dispatch(setSelectedMessages(mockMessages));
        store.dispatch(deselectAllMessages());

        const state = store.getState().message;
        expect(state.selectedMessages).toEqual([]);
      });

      it('should be idempotent', () => {
        store.dispatch(deselectAllMessages());
        const state1 = store.getState().message.selectedMessages;

        store.dispatch(deselectAllMessages());
        const state2 = store.getState().message.selectedMessages;

        expect(state1).toEqual(state2);
        expect(state2).toEqual([]);
      });
    });

    describe('setSearchCriteria', () => {
      it('should set search criteria', () => {
        const criteria = { content: 'test', author_id: 'user-1' } as any;
        store.dispatch(setSearchCriteria(criteria));

        const state = store.getState().message;
        expect(state.searchCriteria).toEqual(criteria);
      });

      it('should clear search criteria with null', () => {
        store.dispatch(setSearchCriteria({ content: 'test' } as any));
        store.dispatch(setSearchCriteria(null));

        const state = store.getState().message;
        expect(state.searchCriteria).toBeNull();
      });
    });

    describe('setOrder', () => {
      it('should set message order', () => {
        const order = { order: SortDirection.ASCENDING } as any;
        store.dispatch(setOrder(order));

        const state = store.getState().message;
        expect(state.order.order).toBe(SortDirection.ASCENDING);
      });

      it('should re-sort messages when order changes', () => {
        store.dispatch(setFilteredMessages(mockMessages));
        store.dispatch(setOrder({ order: SortDirection.DESCENDING } as any));

        // getSortedMessages is mocked to return messages as-is for testing
        const state = store.getState().message;
        expect(state.filteredMessages).toBeDefined();
      });
    });

    describe('clearMessages', () => {
      it('should clear all messages and reset state', () => {
        // Set up state
        store.dispatch(setMessages(mockMessages));
        store.dispatch(setFilteredMessages(mockMessages));
        store.dispatch(setSelectedMessages([mockMessages[0]]));
        store.dispatch(setSearchCriteria({ content: 'test' } as any));

        // Clear
        store.dispatch(clearMessages());

        const state = store.getState().message;
        expect(state.messages).toEqual([]);
        expect(state.filteredMessages).toEqual([]);
        expect(state.selectedMessages).toEqual([]);
        expect(state.searchCriteria).toBeNull();
        expect(state.isLoading).toBe(false);
        expect(state.error).toBeNull();
      });

      it('should reset pagination state', () => {
        store = createTestStore({ message: messageReducer }, {
          message: {
            ...initialMessageState,
            pagination: {
              ...initialMessageState.pagination,
              hasMore: true,
              lastMessageId: 'msg-123',
            },
          },
        });

        store.dispatch(clearMessages());

        const state = store.getState().message;
        expect(state.pagination).toEqual(initialMessageState.pagination);
      });

      it('should clear all thread tabs and reset active tab', () => {
        store.dispatch(setMessages(mockMessages));
        store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Thread 1' }));
        store.dispatch(addThreadTab({ threadId: 'thread-2', threadName: 'Thread 2' }));
        expect(store.getState().message.activeTab).toBe('thread-2');
        expect(Object.keys(store.getState().message.threadTabs)).toHaveLength(2);

        store.dispatch(clearMessages());

        const state = store.getState().message;
        expect(state.activeTab).toBeNull();
        expect(state.threadTabs).toEqual({});
      });

      // #226: a refine surviving navigation silently filters the NEXT
      // channel's messages (every data-arrival reducer re-applies
      // state.refineCriteria), so clearMessages must drop it.
      it('should clear refine criteria so it cannot filter the next channel (#226)', async () => {
        const { setRefineCriteria } = await import('./messageSlice');
        store.dispatch(setMessages(mockMessages));
        store.dispatch(setRefineCriteria({ userIds: ['user-1'] } as any));
        expect(store.getState().message.refineCriteria).not.toBeNull();

        store.dispatch(clearMessages());

        const state = store.getState().message;
        expect(state.refineCriteria).toBeNull();

        // New pages arriving after the switch must not be refine-filtered.
        store.dispatch(setMessages(mockMessages));
        expect(store.getState().message.filteredMessages).toHaveLength(mockMessages.length);
      });
    });

    describe('resetPagination', () => {
      it('should reset pagination state', () => {
        store = createTestStore({ message: messageReducer }, {
          message: {
            ...initialMessageState,
            pagination: {
              ...initialMessageState.pagination,
              hasMore: true,
              lastMessageId: 'msg-123',
            },
          },
        });

        store.dispatch(resetPagination());

        const state = store.getState().message;
        expect(state.pagination).toEqual(initialMessageState.pagination);
      });

      it('should not affect other state', () => {
        store.dispatch(setMessages(mockMessages));
        store.dispatch(resetPagination());

        const state = store.getState().message;
        expect(state.messages).toEqual(mockMessages);
      });
    });
  });

  describe('deleteMessage async thunk', () => {
    it('should delete a message successfully', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteMessage({
          messageId: 'msg-1',
          channelId: 'channel-1',
          token: 'token',
        })
      );

      expect(result.type).toBe('message/deleteMessage/fulfilled');
      expect(result.payload).toBe('msg-1');
      expect(mockDiscordService.deleteMessage).toHaveBeenCalledWith('token', 'msg-1', 'channel-1');
    });

    it('should handle delete failure', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: false }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteMessage({
          messageId: 'msg-1',
          channelId: 'channel-1',
          token: 'token',
        })
      );

      expect(result.type).toBe('message/deleteMessage/rejected');
    });

    it('surfaces the HTTP status from a failed delete in the rejected value (#212)', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: false, status: 403 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteMessage({ messageId: 'msg-1', channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteMessage/rejected');
      expect(result.payload).toBe('Failed to delete message (HTTP 403)');
    });

    it('falls back to "(HTTP unknown)" when the failure carries no status (#212)', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: false }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteMessage({ messageId: 'msg-1', channelId: 'channel-1', token: 'token' })
      );

      expect(result.payload).toBe('Failed to delete message (HTTP unknown)');
    });

    it('should handle network error', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteMessage({
          messageId: 'msg-1',
          channelId: 'channel-1',
          token: 'token',
        })
      );

      expect(result.type).toBe('message/deleteMessage/rejected');
      expect(result.payload).toBe('Network error');
    });
  });

  describe('deleteMessages async thunk', () => {
    it('should set isDeleting when pending', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const appStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [createMockMessage({ id: 'msg-1' })],
        selectedMessages: [createMockMessage({ id: 'msg-1' })],
      });

      appStore.dispatch(
        deleteMessages({ messages: [createMockMessage({ id: 'msg-1' })], channelId: 'ch-1', token: 'token' })
      );

      expect(appStore.getState().message.isDeleting).toBe(true);
      expect(appStore.getState().message.isLoading).toBe(false);
    });

    it('should clear isDeleting and selectedMessages on fulfilled', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [createMockMessage({ id: 'msg-1' })];
      const appStore = await createStoreWithApp({
        ...initialMessageState,
        messages,
        selectedMessages: messages,
      });

      await appStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      expect(appStore.getState().message.isDeleting).toBe(false);
      expect(appStore.getState().message.selectedMessages).toEqual([]);
    });

    it('should set error and clear isDeleting on rejection', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockRejectedValue(new Error('Delete failed')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [createMockMessage({ id: 'msg-1' })];
      const appStore = await createStoreWithApp({
        ...initialMessageState,
        messages,
        selectedMessages: messages,
      });

      await appStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      expect(appStore.getState().message.isDeleting).toBe(false);
    });

    it('should dispatch showOperationTip when starting', async () => {
      const { showOperationTip } = await import('@features/status/statusSlice');
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [createMockMessage({ id: 'msg-1' })];
      const appStore = await createStoreWithApp({
        ...initialMessageState,
        messages,
        selectedMessages: messages,
      });

      await appStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      expect(showOperationTip).toHaveBeenCalled();
    });

    it('logs a per-message warning with the HTTP status when a bulk delete fails (#212)', async () => {
      vi.mocked(addStatusEntry).mockClear();
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: false, status: 404 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [createMockMessage({ id: 'msg-1' })];
      const appStore = await createStoreWithApp({
        ...initialMessageState,
        messages,
        selectedMessages: messages,
      });

      await appStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      // The individual failure (previously only console.error'd) must now land
      // in the status log a user can screenshot, carrying the HTTP status.
      const warning = vi.mocked(addStatusEntry).mock.calls.find(
        ([p]) => p.level === 'warning' && /Couldn't delete message msg-1.*HTTP 404/.test(p.message),
      );
      expect(warning).toBeTruthy();
    });
  });

  describe('#263 plain-array reducers', () => {
    it('toggleMessageSelection adds then removes the same message and never mutates the previous array', () => {
      const msgs = createMockMessages(3);
      store.dispatch(setMessages(msgs));
      store.dispatch(toggleMessageSelection(msgs[1]));
      const afterAdd = store.getState().message.selectedMessages;
      expect(afterAdd.map((m: Message) => m.id)).toEqual(['msg-2']);

      store.dispatch(toggleMessageSelection(msgs[0]));
      const afterSecond = store.getState().message.selectedMessages;
      expect(afterSecond.map((m: Message) => m.id)).toEqual(['msg-2', 'msg-1']);
      expect(afterAdd.map((m: Message) => m.id)).toEqual(['msg-2']);

      store.dispatch(toggleMessageSelection(msgs[1]));
      expect(store.getState().message.selectedMessages.map((m: Message) => m.id)).toEqual(['msg-1']);
    });

    it('selectAllMessages copies filteredMessages instead of sharing the array', () => {
      const msgs = createMockMessages(3);
      store.dispatch(setMessages(msgs));
      store.dispatch(setFilteredMessages([msgs[0], msgs[2]]));
      store.dispatch(selectAllMessages());
      const state = store.getState().message;
      expect(state.selectedMessages.map((m: Message) => m.id)).toEqual(['msg-1', 'msg-3']);
      expect(state.selectedMessages).not.toBe(state.filteredMessages);
    });

    it('toggleThreadMessageSelection adds then removes inside the thread tab only', () => {
      const msgs = createMockMessages(2);
      store.dispatch(setMessages(msgs));
      store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Thread 1' }));
      const tmsg = createMockMessage({ id: 'tmsg-1' });
      store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [tmsg] }));

      store.dispatch(toggleThreadMessageSelection({ threadId: 'thread-1', message: tmsg }));
      expect(store.getState().message.threadTabs['thread-1'].selectedMessages.map((m: Message) => m.id)).toEqual(['tmsg-1']);
      expect(store.getState().message.selectedMessages).toEqual([]);

      store.dispatch(toggleThreadMessageSelection({ threadId: 'thread-1', message: tmsg }));
      expect(store.getState().message.threadTabs['thread-1'].selectedMessages).toEqual([]);
    });

    it('messagesEdited replaces the given ids in messages, filteredMessages, and selectedMessages', () => {
      const msgs = createMockMessages(3);
      store.dispatch(setMessages(msgs));
      store.dispatch(setFilteredMessages([msgs[1], msgs[2]]));
      store.dispatch(setSelectedMessages([msgs[1]]));
      const edited = { ...msgs[1], content: 'edited' };

      store.dispatch(messagesEdited({ messages: [edited, createMockMessage({ id: 'unknown' })], containerId: null }));

      const state = store.getState().message;
      expect(state.messages.map((m: Message) => m.content)).toEqual(['Test message 1', 'edited', 'Test message 3']);
      expect(state.filteredMessages.map((m: Message) => m.content)).toEqual(['edited', 'Test message 3']);
      expect(state.selectedMessages.map((m: Message) => m.content)).toEqual(['edited']);
      expect(state.messages).toHaveLength(3);
    });

    it('messagesEdited targets the thread container named in the payload', () => {
      store.dispatch(setMessages(createMockMessages(1)));
      store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Thread 1' }));
      const tmsg = createMockMessage({ id: 'tmsg-1', content: 'before' });
      store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [tmsg] }));

      store.dispatch(messagesEdited({ messages: [{ ...tmsg, content: 'after' }], containerId: 'thread-1' }));

      const state = store.getState().message;
      expect(state.threadTabs['thread-1'].messages[0].content).toBe('after');
      expect(state.messages[0].content).toBe('Test message 1');
    });

    it('setThreadRefineCriteria filters the tab from its raw messages and clears back to all', () => {
      store.dispatch(setMessages(createMockMessages(1)));
      store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Thread 1' }));
      const a = createMockMessage({ id: 'ta', author: createMockUser({ id: 'user-a' }) });
      const b = createMockMessage({ id: 'tb', author: createMockUser({ id: 'user-b' }) });
      store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [a, b] }));

      store.dispatch(setThreadRefineCriteria({ threadId: 'thread-1', criteria: { userIds: ['user-b'] } as any }));
      expect(store.getState().message.threadTabs['thread-1'].filteredMessages.map((m: Message) => m.id)).toEqual(['tb']);
      expect(store.getState().message.threadTabs['thread-1'].messages).toHaveLength(2);

      store.dispatch(setThreadRefineCriteria({ threadId: 'thread-1', criteria: null }));
      expect(store.getState().message.threadTabs['thread-1'].filteredMessages.map((m: Message) => m.id)).toEqual(['ta', 'tb']);
    });

    it('setThreadRefineCriteria ignores a thread tab that does not exist', () => {
      const before = store.getState().message;
      store.dispatch(setThreadRefineCriteria({ threadId: 'nope', criteria: { userIds: ['x'] } as any }));
      expect(store.getState().message).toBe(before);
    });
  });


  describe('messagesRemoved reducer (#183)', () => {
    it('removes exactly the given ids from messages, filteredMessages, and selectedMessages in one dispatch', () => {
      const msgs = createMockMessages(5);
      store.dispatch(setMessages(msgs));
      store.dispatch(setFilteredMessages([msgs[0], msgs[1], msgs[3]]));
      store.dispatch(setSelectedMessages([msgs[1], msgs[3], msgs[4]]));

      store.dispatch(messagesRemoved({ ids: ['msg-2', 'msg-4'], containerId: null }));

      const state = store.getState().message;
      expect(state.messages.map((m: Message) => m.id)).toEqual(['msg-1', 'msg-3', 'msg-5']);
      expect(state.filteredMessages.map((m: Message) => m.id)).toEqual(['msg-1']);
      expect(state.selectedMessages.map((m: Message) => m.id)).toEqual(['msg-5']);
    });

    it('ignores unknown ids and leaves other messages intact', () => {
      const msgs = createMockMessages(3);
      store.dispatch(setMessages(msgs));

      store.dispatch(messagesRemoved({ ids: ['not-a-real-id', 'msg-2'], containerId: null }));

      const state = store.getState().message;
      expect(state.messages.map((m: Message) => m.id)).toEqual(['msg-1', 'msg-3']);
    });

    it('is a no-op (same array identities) for an empty payload', () => {
      store.dispatch(setMessages(createMockMessages(3)));
      const before = store.getState().message;

      store.dispatch(messagesRemoved({ ids: [], containerId: null }));

      const after = store.getState().message;
      expect(after.messages).toBe(before.messages);
      expect(after.filteredMessages).toBe(before.filteredMessages);
      expect(after.selectedMessages).toBe(before.selectedMessages);
    });

    it('targets the container named in the payload, not the main arrays', () => {
      const mainMsgs = createMockMessages(2);
      const threadMsgs = [
        createMockMessage({ id: 'tmsg-1' }),
        createMockMessage({ id: 'tmsg-2' }),
      ];
      store.dispatch(setMessages(mainMsgs));
      store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
      store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: threadMsgs }));
      store.dispatch(setActiveTab('thread-1'));

      store.dispatch(messagesRemoved({ ids: ['tmsg-1', 'msg-1'], containerId: 'thread-1' }));

      const state = store.getState().message;
      expect(state.threadTabs['thread-1'].messages.map((m: Message) => m.id)).toEqual(['tmsg-2']);
      expect(state.threadTabs['thread-1'].filteredMessages.map((m: Message) => m.id)).toEqual(['tmsg-2']);
      // Main arrays untouched — the batch was addressed to the thread tab.
      expect(state.messages.map((m: Message) => m.id)).toEqual(['msg-1', 'msg-2']);
    });

    it('F14: routes by the captured containerId even when the active tab has changed', () => {
      const mainMsgs = createMockMessages(2);
      store.dispatch(setMessages(mainMsgs));
      store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
      store.dispatch(setThreadMessages({
        threadId: 'thread-1',
        messages: [createMockMessage({ id: 'tmsg-1' })],
      }));
      // A batch captured against the MAIN container flushes while a
      // thread tab is active (the user switched mid-delete) — pre-fix,
      // an active-tab lookup silently filtered the wrong arrays.
      store.dispatch(setActiveTab('thread-1'));

      store.dispatch(messagesRemoved({ ids: ['msg-1'], containerId: null }));

      const state = store.getState().message;
      expect(state.messages.map((m: Message) => m.id)).toEqual(['msg-2']);
      expect(state.threadTabs['thread-1'].messages.map((m: Message) => m.id)).toEqual(['tmsg-1']);
    });

    it('F14: is a safe no-op when the captured thread tab no longer exists', () => {
      const mainMsgs = createMockMessages(2);
      store.dispatch(setMessages(mainMsgs));

      store.dispatch(messagesRemoved({ ids: ['msg-1'], containerId: 'closed-thread' }));

      expect(store.getState().message.messages).toHaveLength(2);
    });
  });

  describe('deleteMessages batching (#183)', () => {
    // Store with an action recorder so tests can assert on the dispatch
    // pattern (how many array-rewriting updates a bulk delete produced).
    const createRecordingStoreWithApp = async (
      messageState = initialMessageState,
      appOverrides: Record<string, unknown> = {},
    ) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const actionTypes: string[] = [];

      const recorder: import('@reduxjs/toolkit').Middleware =
        () => (next) => (action) => {
          const type = (action as { type?: string })?.type;
          if (type) actionTypes.push(type);
          return next(action);
        };

      const recordingStore = configureStore({
        reducer: {
          message: messageReducer,
          app: appReducer,
        },
        middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(recorder),
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
            previewThemeId: null,
            ...appOverrides,
          },
          message: messageState,
        },
      });
      return { recordingStore, actionTypes };
    };

    it('applies all deletions in DELETE_BATCH_SIZE batches and matches the sequential end-state', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const count = DELETE_BATCH_SIZE * 2 + 10; // 60: two full batches + final flush
      const messages = createMockMessages(count);
      const { recordingStore, actionTypes } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      const result = await recordingStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteMessages/fulfilled');
      expect(result.payload).toHaveLength(count);
      const state = recordingStore.getState().message;
      expect(state.messages).toHaveLength(0);
      expect(state.filteredMessages).toHaveLength(0);
      expect(state.selectedMessages).toHaveLength(0);

      const flushes = actionTypes.filter((t) => t === 'message/messagesRemoved');
      expect(flushes).toHaveLength(Math.ceil(count / DELETE_BATCH_SIZE));
    });

    it('does not dispatch per-message array-rewriting fulfilled updates (regression)', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = createMockMessages(10);
      const { recordingStore, actionTypes } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      await recordingStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      // The freeze mechanic: N per-message deleteMessage.fulfilled reducers,
      // each rewriting all three arrays. The batched path must produce zero
      // of them — a sub-batch run collapses to a single final flush.
      expect(actionTypes.filter((t) => t.startsWith('message/deleteMessage/'))).toHaveLength(0);
      expect(actionTypes.filter((t) => t === 'message/messagesRemoved')).toHaveLength(1);
      expect(recordingStore.getState().message.messages).toHaveLength(0);
    });

    it('still lands all confirmed deletions when cancelled mid-run', async () => {
      const { checkCancelled } = await import('@/utils/operationLoopUtils');
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const confirmedBeforeCancel = DELETE_BATCH_SIZE + 5; // 30: one flushed batch + 5 pending
      let iterations = 0;
      vi.mocked(checkCancelled).mockImplementation(() => ++iterations > confirmedBeforeCancel);

      const messages = createMockMessages(40);
      const { recordingStore, actionTypes } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      await recordingStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );
      vi.mocked(checkCancelled).mockReturnValue(false);

      // Every confirmed deletion (including the partial pending batch at the
      // moment of cancellation) must be reflected in state.
      const state = recordingStore.getState().message;
      expect(state.messages).toHaveLength(40 - confirmedBeforeCancel);
      expect(state.messages[0].id).toBe(`msg-${confirmedBeforeCancel + 1}`);
      expect(actionTypes.filter((t) => t === 'message/messagesRemoved')).toHaveLength(2);
    });

    it('still lands confirmed deletions around a mid-run failure', async () => {
      vi.mocked(addStatusEntry).mockClear();
      const mockDiscordService = {
        deleteMessage: vi.fn().mockImplementation((_token: string, messageId: string) =>
          Promise.resolve(messageId === 'msg-3' ? { success: false, status: 403 } : { success: true })
        ),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = createMockMessages(5);
      const { recordingStore } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      const result = await recordingStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      // The failed message survives in state; every confirmed one is gone.
      const state = recordingStore.getState().message;
      expect(state.messages.map((m: Message) => m.id)).toEqual(['msg-3']);
      expect(state.filteredMessages.map((m: Message) => m.id)).toEqual(['msg-3']);
      expect(result.payload).toEqual(['msg-1', 'msg-2', 'msg-4', 'msg-5']);

      // #212 warning contract survives the direct-service-call refactor.
      const warning = vi.mocked(addStatusEntry).mock.calls.find(
        ([p]) => p.level === 'warning' && /Couldn't delete message msg-3.*HTTP 403/.test(p.message),
      );
      expect(warning).toBeTruthy();
    });

    it('flushes pending confirmed deletions before parking on pause', async () => {
      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      // waitWhilePaused is mocked to resolve immediately, so a paused run
      // still progresses — what matters is that each iteration flushes the
      // pending batch before the pause wait, so state never lags reality
      // while the user is paused.
      const messages = createMockMessages(3);
      const { recordingStore, actionTypes } = await createRecordingStoreWithApp(
        {
          ...initialMessageState,
          messages,
          filteredMessages: messages,
          selectedMessages: messages,
        },
        { discrubPaused: true },
      );

      await recordingStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      const state = recordingStore.getState().message;
      expect(state.messages).toHaveLength(0);
      // Pre-pause flushes for iterations 2 and 3, plus the final flush —
      // every confirmed deletion lands without waiting for a full batch.
      expect(actionTypes.filter((t) => t === 'message/messagesRemoved')).toHaveLength(3);
    });

    it('F14: a mid-run tab switch does not misroute the flush', async () => {
      const messages = createMockMessages(3);
      const { recordingStore } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      // The user opens and switches to a thread tab while the delete is
      // in flight; the final flush (in `finally`) must still hit the MAIN
      // container the operation started against.
      let deletions = 0;
      const mockDiscordService = {
        deleteMessage: vi.fn().mockImplementation(() => {
          deletions++;
          if (deletions === 2) {
            recordingStore.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'T' }));
            recordingStore.dispatch(setThreadMessages({
              threadId: 'thread-1',
              messages: [createMockMessage({ id: 'tmsg-1' })],
            }));
            recordingStore.dispatch(setActiveTab('thread-1'));
          }
          return Promise.resolve({ success: true });
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await recordingStore.dispatch(
        deleteMessages({ messages, channelId: 'ch-1', token: 'token' })
      );

      const state = recordingStore.getState().message;
      // All three deletions landed in the main arrays despite the flush
      // arriving while the thread tab was active…
      expect(state.messages).toHaveLength(0);
      // …and the thread tab's arrays were not touched.
      expect(state.threadTabs['thread-1'].messages.map((m: Message) => m.id)).toEqual(['tmsg-1']);
    });
  });

  describe('editMessages batching (F13, #183 follow-up)', () => {
    const createRecordingStoreWithApp = async (
      messageState = initialMessageState,
      appOverrides: Record<string, unknown> = {},
    ) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const actionTypes: string[] = [];

      const recorder: import('@reduxjs/toolkit').Middleware =
        () => (next) => (action) => {
          const type = (action as { type?: string })?.type;
          if (type) actionTypes.push(type);
          return next(action);
        };

      const recordingStore = configureStore({
        reducer: {
          message: messageReducer,
          app: appReducer,
        },
        middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(recorder),
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
            previewThemeId: null,
            ...appOverrides,
          },
          message: messageState,
        },
      });
      return { recordingStore, actionTypes };
    };

    it('applies edits in batches with zero per-message editMessage dispatches', async () => {
      const mockDiscordService = {
        editMessage: vi.fn().mockImplementation((_token: string, messageId: string) =>
          Promise.resolve({
            success: true,
            data: { ...createMockMessage({ id: messageId }), content: 'redacted' },
          })
        ),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const count = DELETE_BATCH_SIZE + 5; // 30: one full batch + final flush
      const messages = createMockMessages(count);
      const { recordingStore, actionTypes } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      const result = await recordingStore.dispatch(
        editMessages({ messages, channelId: 'ch-1', content: 'redacted', token: 'token' })
      );

      expect(result.type).toBe('message/editMessages/fulfilled');
      expect(result.payload).toHaveLength(count);

      // The freeze mechanic was N editMessage.fulfilled reducers, each
      // rewriting all three arrays — the batched path produces zero.
      expect(actionTypes.filter((t) => t.startsWith('message/editMessage/'))).toHaveLength(0);
      expect(actionTypes.filter((t) => t === 'message/messagesEdited')).toHaveLength(2);

      const state = recordingStore.getState().message;
      expect(state.messages.every((m: Message) => m.content === 'redacted')).toBe(true);
      expect(state.filteredMessages.every((m: Message) => m.content === 'redacted')).toBe(true);
      expect(state.selectedMessages.every((m: Message) => m.content === 'redacted')).toBe(true);
    });

    it('holds isEditing stable for the whole run and lands partial edits on failure', async () => {
      const mockDiscordService = {
        editMessage: vi.fn().mockImplementation((_token: string, messageId: string) =>
          Promise.resolve(
            messageId === 'msg-2'
              ? { success: false, status: 403 }
              : {
                  success: true,
                  data: { ...createMockMessage({ id: messageId }), content: 'redacted' },
                }
          )
        ),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = createMockMessages(3);
      const { recordingStore } = await createRecordingStoreWithApp({
        ...initialMessageState,
        messages,
        filteredMessages: messages,
        selectedMessages: messages,
      });

      const dispatchPromise = recordingStore.dispatch(
        editMessages({ messages, channelId: 'ch-1', content: 'redacted', token: 'token' })
      );
      expect(recordingStore.getState().message.isEditing).toBe(true);
      const result = await dispatchPromise;

      expect(recordingStore.getState().message.isEditing).toBe(false);
      expect(result.payload).toHaveLength(2); // msg-2 failed

      const state = recordingStore.getState().message;
      const contentById = new Map(state.messages.map((m: Message) => [m.id, m.content]));
      expect(contentById.get('msg-1')).toBe('redacted');
      expect(contentById.get('msg-2')).not.toBe('redacted');
      expect(contentById.get('msg-3')).toBe('redacted');
    });
  });

  describe('fetchMessages async thunk', () => {
    it('should set loading state when pending', () => {
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      const state = store.getState().message;
      expect(state.isLoading).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should fetch messages successfully', async () => {
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: mockMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      const state = store.getState().message;
      expect(state.isLoading).toBe(false);
      expect(state.messages).toEqual(mockMessages);
      expect(state.filteredMessages).toEqual(mockMessages);
      expect(state.error).toBeNull();
    });

    it('should set hasMore to true if got 100 messages', async () => {
      const hundredMessages = createMockMessages(100);
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: hundredMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      const state = store.getState().message;
      expect(state.pagination.hasMore).toBe(true);
    });

    it('should set hasMore to false if got less than 100 messages', async () => {
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: mockMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      const state = store.getState().message;
      expect(state.pagination.hasMore).toBe(false);
    });

    it('should handle fetch failure', async () => {
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: false,
          data: null,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      const state = store.getState().message;
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Failed to fetch messages');
    });

    it('should clear selected messages on fetch', async () => {
      store.dispatch(setSelectedMessages([mockMessages[0]]));

      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: mockMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      const state = store.getState().message;
      expect(state.selectedMessages).toEqual([]);
    });

    it('should dispatch status entry with message count on success', async () => {
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: mockMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      await store.dispatch(fetchMessages({ channelId: 'channel-1', token: 'token' }));

      expect(vi.mocked(addStatusEntry)).toHaveBeenCalledWith({
        level: 'info',
        message: `Loaded ${mockMessages.length} messages`,
      });
    });
  });

  describe('fetchMoreMessages async thunk', () => {
    it('should set isLoadingMore when pending', () => {
      store = createTestStore({ message: messageReducer }, {
        message: {
          ...initialMessageState,
          pagination: {
            ...initialMessageState.pagination,
            lastMessageId: 'msg-5',
          },
        },
      });

      const mockDiscordService = {
        fetchMessageData: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(fetchMoreMessages({ channelId: 'channel-1', token: 'token', lastMessageId: 'msg-5' }));

      const state = store.getState().message;
      expect(state.pagination.isLoadingMore).toBe(true);
    });

    it('should append new messages to existing messages', async () => {
      const initialMessages = createMockMessages(5);
      store = createTestStore({ message: messageReducer }, {
        message: {
          ...initialMessageState,
          messages: initialMessages,
          filteredMessages: initialMessages,
          pagination: {
            ...initialMessageState.pagination,
            lastMessageId: 'msg-5',
          },
        },
      });

      const newMessages = createMockMessages(3);
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: newMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchMoreMessages({ channelId: 'channel-1', token: 'token', lastMessageId: 'msg-5' }));

      const state = store.getState().message;
      expect(state.messages).toHaveLength(8);
      expect(state.pagination.isLoadingMore).toBe(false);
    });

    it('should use lastMessageId when fetching more', async () => {
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: mockMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(
        fetchMoreMessages({
          channelId: 'channel-1',
          token: 'token',
          lastMessageId: 'msg-100',
        })
      );

      expect(mockDiscordService.fetchMessageData).toHaveBeenCalledWith(
        'token',
        'msg-100',
        'channel-1'
      );
    });

    it('should dispatch status entry with message count on success', async () => {
      const newMessages = createMockMessages(3);
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: newMessages,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      await store.dispatch(fetchMoreMessages({ channelId: 'channel-1', token: 'token', lastMessageId: 'msg-5' }));

      expect(vi.mocked(addStatusEntry)).toHaveBeenCalledWith({
        level: 'info',
        message: 'Loaded 3 more messages',
      });
    });
  });

  describe('searchMessages async thunk', () => {
    it('warns when Discord returns nothing while still indexing the conversation (#216)', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      // statusSlice is module-mocked in this file — assert on the mocked
      // action creator rather than a real status store.
      const { addStatusEntry } = await import('@features/status/statusSlice');
      vi.mocked(addStatusEntry).mockClear();

      const testStore = configureStore({
        reducer: {
          message: messageReducer,
          app: appReducer,
        },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
            previewThemeId: null,
          },
          message: initialMessageState,
        },
      });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [], total_results: 0, doing_deep_historical_index: true },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { content: 'test' } as any,
        })
      );

      const warned = vi.mocked(addStatusEntry).mock.calls.some(
        ([entry]: any[]) =>
          entry?.level === 'warning' && entry?.message?.includes('still indexing'),
      );
      expect(warned).toBe(true);
    });

    // #262: the initial channel search had no 202 wait or transient
    // retry, and its failure line never carried the HTTP status.
    const searchStore = async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      return configureStore({
        reducer: { message: messageReducer, app: appReducer },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
            previewThemeId: null,
          },
          message: initialMessageState,
        },
      });
    };

    it('waits out a 202 on the initial search and shows the page that follows (#262)', async () => {
      const fetchSearchMessageData = vi.fn()
        .mockResolvedValueOnce({ success: true, status: 202 })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { messages: [createMockMessages(2)], total_results: 2 },
        });
      vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);
      vi.mocked(addStatusEntry).mockClear();

      const testStore = await searchStore();
      const result = await testStore.dispatch(
        searchMessages({ channelId: 'channel-1', token: 'token', searchCriteria: {} as any })
      );

      expect(result.type).toBe('message/searchMessages/fulfilled');
      expect(fetchSearchMessageData).toHaveBeenCalledTimes(2);
      expect(testStore.getState().message.messages).toHaveLength(2);
      const waits = vi.mocked(addStatusEntry).mock.calls.filter(
        ([entry]: any[]) => entry?.level === 'warning' && /still indexing, retrying in 1s \(attempt 1\/5\)/.test(entry.message)
      );
      expect(waits).toHaveLength(1);
    }, 10000);

    it('rejects with the HTTP status when Discord refuses the initial search (#262)', async () => {
      const fetchSearchMessageData = vi.fn().mockResolvedValue({ success: false, status: 403 });
      vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

      const testStore = await searchStore();
      const result = await testStore.dispatch(
        searchMessages({ channelId: 'channel-1', token: 'token', searchCriteria: {} as any })
      );

      expect(result.type).toBe('message/searchMessages/rejected');
      expect(result.payload).toBe('Failed to search messages (HTTP 403)');
      expect(testStore.getState().message.error).toBe('Failed to search messages (HTTP 403)');
      expect(fetchSearchMessageData).toHaveBeenCalledTimes(1);
    });

    it('gives up after five 202 answers and says Discord is still indexing (#262)', async () => {
      const fetchSearchMessageData = vi.fn().mockResolvedValue({ success: true, status: 202 });
      vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

      const testStore = await searchStore();
      const result = await testStore.dispatch(
        searchMessages({ channelId: 'channel-1', token: 'token', searchCriteria: {} as any })
      );

      expect(result.type).toBe('message/searchMessages/rejected');
      expect(result.payload).toMatch(/^Failed to search messages\. Discord is still indexing/);
      expect(fetchSearchMessageData).toHaveBeenCalledTimes(6);
    }, 30000);

    it('should search messages with criteria', async () => {
      // searchMessages requires app state for delay settings
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');

      const testStore = configureStore({
        reducer: {
          message: messageReducer,
          app: appReducer,
        },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
            previewThemeId: null,
          },
          message: initialMessageState,
        },
      });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: {
            messages: [mockMessages],
            total_results: 5,
          },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const criteria = { content: 'test' } as any;
      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: criteria,
        })
      );

      expect(mockDiscordService.fetchSearchMessageData).toHaveBeenCalled();
    });

    it('should set pagination mode to search', async () => {
      // searchMessages requires app state for delay settings
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');

      const testStore = configureStore({
        reducer: {
          message: messageReducer,
          app: appReducer,
        },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
            previewThemeId: null,
          },
          message: initialMessageState,
        },
      });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: {
            messages: [mockMessages],
            total_results: 5,
          },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { content: 'test' } as any,
        })
      );

      const state = testStore.getState().message;
      expect(state.pagination.mode).toBe('search');
    });

    it('should dispatch starting and completion status entries', async () => {
      const testStore = await createStoreWithApp();

      const searchResults = createMockMessages(3);
      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: {
            messages: [searchResults],
            total_results: 3,
          },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      const startCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.message === 'Search: Starting...'
      );
      expect(startCalls).toHaveLength(1);

      const successCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.level === 'success'
      );
      expect(successCalls).toHaveLength(1);
      expect(successCalls[0][0].message).toBe('Search: found 3 of 3 results');
    });

    it('should not dispatch info status entries below milestone threshold', async () => {
      const testStore = await createStoreWithApp();

      const searchResults = createMockMessages(3);
      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: {
            messages: [searchResults],
            total_results: 3,
          },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      const infoCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.level === 'info' && payload.message.includes('fetched')
      );
      expect(infoCalls).toHaveLength(0);
    });

    it('fetches only page 1 and sets hasMore/searchOffset/totalCount for more-available case', async () => {
      const testStore = await createStoreWithApp();

      // 25 results returned (full page) + total_results 200 → more to fetch
      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [createMockMessages(25)], total_results: 200 },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      // Only one call — the eager loop is gone
      expect(mockDiscordService.fetchSearchMessageData).toHaveBeenCalledTimes(1);

      const state = testStore.getState().message;
      expect(state.messages).toHaveLength(25);
      expect(state.pagination.mode).toBe('search');
      expect(state.pagination.hasMore).toBe(true);
      expect(state.pagination.searchOffset).toBe(25);
      expect(state.pagination.totalCount).toBe(200);
    });

    it('sets hasMore=false when Discord returns fewer than a full page', async () => {
      const testStore = await createStoreWithApp();

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [createMockMessages(7)], total_results: 7 },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      const state = testStore.getState().message;
      expect(state.pagination.hasMore).toBe(false);
      expect(state.pagination.totalCount).toBe(7);
    });

    it('keeps hasMore=true on a short (<25) page when results remain (#208 sibling)', async () => {
      const testStore = await createStoreWithApp();

      // Discord returns a spuriously short page (20 < 25) mid-stream, but
      // total_results says there are far more. The old `=== SEARCH_PAGE_SIZE`
      // gate hid "Load More" here; hasMore must stay true.
      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [createMockMessages(20)], total_results: 200 },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      const state = testStore.getState().message;
      expect(state.pagination.hasMore).toBe(true);
      expect(state.pagination.totalCount).toBe(200);
    });
  });

  describe('fetchNextSearchPage async thunk', () => {
    it('appends results and advances searchOffset', async () => {
      const testStore = await createStoreWithApp();

      // Seed state with a page-1 result first
      const firstPage = createMockMessages(25);
      const mockDiscordService = {
        fetchSearchMessageData: vi.fn()
          .mockResolvedValueOnce({
            success: true,
            data: { messages: [firstPage], total_results: 50 },
          })
          .mockResolvedValueOnce({
            success: true,
            data: {
              messages: [
                createMockMessages(25).map((m, i) =>
                  createMockMessage({ ...m, id: `p2-${i}` }),
                ),
              ],
              total_results: 50,
            },
          }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      const { fetchNextSearchPage } = await import('./messageSlice');
      await testStore.dispatch(
        fetchNextSearchPage({ channelId: 'channel-1', token: 'token' })
      );

      const state = testStore.getState().message;
      expect(state.messages).toHaveLength(50);
      expect(state.pagination.searchOffset).toBe(50);
      expect(state.pagination.hasMore).toBe(false);
    });

    it('does nothing when mode is not search', async () => {
      const testStore = await createStoreWithApp();
      const mockDiscordService = {
        fetchSearchMessageData: vi.fn(),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const { fetchNextSearchPage } = await import('./messageSlice');
      const result = await testStore.dispatch(
        fetchNextSearchPage({ channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/fetchNextSearchPage/rejected');
      expect(mockDiscordService.fetchSearchMessageData).not.toHaveBeenCalled();
    });

    // #264: Load More gets the #262 retries. A By User filter Discord has
    // not indexed yet answers 202 on page 2, and the old raw call gave up
    // at the first 25 results with a generic failure and no retry.
    it('waits out a 202 on the next page and appends the page that follows (#264)', async () => {
      const testStore = await createStoreWithApp();
      const page2 = createMockMessages(25).map((m, i) => createMockMessage({ ...m, id: `p2-${i}` }));
      const fetchSearchMessageData = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { messages: [createMockMessages(25)], total_results: 50 },
        })
        .mockResolvedValueOnce({ success: true, status: 202 })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { messages: [page2], total_results: 50 },
        });
      vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);
      vi.mocked(addStatusEntry).mockClear();

      await testStore.dispatch(
        searchMessages({ channelId: 'channel-1', token: 'token', searchCriteria: { userIds: ['u1'] } as any })
      );
      const { fetchNextSearchPage } = await import('./messageSlice');
      const result = await testStore.dispatch(
        fetchNextSearchPage({ channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/fetchNextSearchPage/fulfilled');
      expect(fetchSearchMessageData).toHaveBeenCalledTimes(3);
      const state = testStore.getState().message;
      expect(state.messages).toHaveLength(50);
      expect(state.pagination.searchOffset).toBe(50);
      expect(state.pagination.hasMore).toBe(false);
      const waits = vi.mocked(addStatusEntry).mock.calls.filter(
        ([entry]: any[]) => entry?.level === 'warning' && /still indexing, retrying in 1s \(attempt 1\/5\)/.test(entry.message)
      );
      expect(waits).toHaveLength(1);
    }, 10000);

    it('rejects with the HTTP status when the next page is refused and keeps Load More available (#264)', async () => {
      const testStore = await createStoreWithApp();
      const fetchSearchMessageData = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { messages: [createMockMessages(25)], total_results: 50 },
        })
        .mockResolvedValue({ success: false, status: 403 });
      vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

      await testStore.dispatch(
        searchMessages({ channelId: 'channel-1', token: 'token', searchCriteria: { userIds: ['u1'] } as any })
      );
      const { fetchNextSearchPage } = await import('./messageSlice');
      const result = await testStore.dispatch(
        fetchNextSearchPage({ channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/fetchNextSearchPage/rejected');
      expect(result.payload).toBe('Failed to search messages (HTTP 403)');
      const state = testStore.getState().message;
      expect(state.messages).toHaveLength(25);
      expect(state.pagination.searchOffset).toBe(25);
      expect(state.pagination.hasMore).toBe(true);
      expect(state.pagination.isLoadingMore).toBe(false);
    });

    it('dedupes by message id when a page overlaps with existing results', async () => {
      const testStore = await createStoreWithApp();

      const overlappingMessage = createMockMessage({ id: 'shared-1' });
      const firstPage = [overlappingMessage, ...createMockMessages(24)];
      const secondPage = [overlappingMessage, ...createMockMessages(24).map((m, i) =>
        createMockMessage({ ...m, id: `new-${i}` })
      )];

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn()
          .mockResolvedValueOnce({
            success: true,
            data: { messages: [firstPage], total_results: 50 },
          })
          .mockResolvedValueOnce({
            success: true,
            data: { messages: [secondPage], total_results: 50 },
          }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        searchMessages({
          channelId: 'channel-1',
          token: 'token',
          searchCriteria: { searchContent: 'test' } as any,
        })
      );

      const { fetchNextSearchPage } = await import('./messageSlice');
      await testStore.dispatch(
        fetchNextSearchPage({ channelId: 'channel-1', token: 'token' })
      );

      const state = testStore.getState().message;
      // 25 unique from page 1 + 24 new from page 2 (one dupe removed) = 49
      expect(state.messages).toHaveLength(49);
    });
  });

  describe('refineCriteria persistence across data arrival', () => {
    it('keeps refine applied when fetchMoreMessages appends new messages', async () => {
      const testStore = await createStoreWithApp();

      // Seed: 3 messages with content matching "important", 2 not matching
      const seedMessages = [
        createMockMessage({ id: 's1', content: 'important note 1' }),
        createMockMessage({ id: 's2', content: 'unrelated 1' }),
        createMockMessage({ id: 's3', content: 'important note 2' }),
      ];
      testStore.dispatch({ type: 'message/setMessages', payload: seedMessages });

      // Apply refine for "important"
      const { setRefineCriteria } = await import('./messageSlice');
      testStore.dispatch(
        setRefineCriteria({
          searchMessageContents: ['important'],
        } as any),
      );

      expect(testStore.getState().message.filteredMessages).toHaveLength(2);

      // Now fetch more messages — 5 new, 2 match "important"
      const newPage = [
        createMockMessage({ id: 'n1', content: 'unrelated 2' }),
        createMockMessage({ id: 'n2', content: 'important note 3' }),
        createMockMessage({ id: 'n3', content: 'important note 4' }),
        createMockMessage({ id: 'n4', content: 'unrelated 3' }),
        createMockMessage({ id: 'n5', content: 'unrelated 4' }),
      ];
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: newPage,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const { fetchMoreMessages } = await import('./messageSlice');
      await testStore.dispatch(
        fetchMoreMessages({
          channelId: 'channel-1',
          token: 'token',
          lastMessageId: 's3',
        }),
      );

      const state = testStore.getState().message;
      expect(state.messages).toHaveLength(8); // 3 seed + 5 new
      // Refine still applied: 4 total important messages (2 seed + 2 new)
      expect(state.filteredMessages).toHaveLength(4);
      expect(
        state.filteredMessages.every((m) => m.content?.includes('important')),
      ).toBe(true);
    });

    it('keeps refine applied when fetchNextSearchPage appends search results', async () => {
      const testStore = await createStoreWithApp();

      const firstPage = createMockMessages(25).map((m, i) =>
        createMockMessage({
          ...m,
          id: `p1-${i}`,
          content: i % 5 === 0 ? `match-${i}` : `nomatch-${i}`,
        }),
      );
      const secondPage = createMockMessages(25).map((m, i) =>
        createMockMessage({
          ...m,
          id: `p2-${i}`,
          content: i % 5 === 0 ? `match-${i}` : `nomatch-${i}`,
        }),
      );

      const mockDiscordService = {
        fetchSearchMessageData: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            data: { messages: [firstPage], total_results: 50 },
          })
          .mockResolvedValueOnce({
            success: true,
            data: { messages: [secondPage], total_results: 50 },
          }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const { searchMessages, setRefineCriteria, fetchNextSearchPage } =
        await import('./messageSlice');
      await testStore.dispatch(
        searchMessages({
          channelId: 'c',
          token: 't',
          searchCriteria: { searchContent: 'x' } as any,
        }),
      );
      // Apply refine restricting to "match"
      testStore.dispatch(
        setRefineCriteria({ searchMessageContents: ['match'] } as any),
      );

      const beforeFiltered = testStore.getState().message.filteredMessages.length;

      await testStore.dispatch(
        fetchNextSearchPage({ channelId: 'c', token: 't' }),
      );

      const state = testStore.getState().message;
      expect(state.messages).toHaveLength(50);
      // Refine still active and applied to combined set
      expect(
        state.filteredMessages.every((m) => m.content?.includes('match')),
      ).toBe(true);
      expect(state.filteredMessages.length).toBeGreaterThan(beforeFiltered);
    });

    it('emits a status entry when fetchMoreMessages produces zero refine matches', async () => {
      const testStore = await createStoreWithApp();
      testStore.dispatch({
        type: 'message/setMessages',
        payload: [createMockMessage({ id: 's1', content: 'rare-match' })],
      });

      const { setRefineCriteria, fetchMoreMessages } = await import('./messageSlice');
      testStore.dispatch(
        setRefineCriteria({ searchMessageContents: ['rare-match'] } as any),
      );

      // 5 new messages, none match "rare-match"
      const newPage = createMockMessages(5).map((m, i) =>
        createMockMessage({ ...m, id: `n${i}`, content: `nothing here ${i}` }),
      );
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: newPage }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      await testStore.dispatch(
        fetchMoreMessages({
          channelId: 'c',
          token: 't',
          lastMessageId: 's1',
        }),
      );

      const phantomCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.message?.includes?.('0 matched the active refine'),
      );
      expect(phantomCalls).toHaveLength(1);
      expect(phantomCalls[0][0].message).toContain('5');
    });

    it('does NOT emit phantom-load entry when refine yields ≥1 match in the new page', async () => {
      const testStore = await createStoreWithApp();
      testStore.dispatch({
        type: 'message/setMessages',
        payload: [createMockMessage({ id: 's1', content: 'match' })],
      });

      const { setRefineCriteria, fetchMoreMessages } = await import('./messageSlice');
      testStore.dispatch(
        setRefineCriteria({ searchMessageContents: ['match'] } as any),
      );

      const newPage = [
        createMockMessage({ id: 'n1', content: 'no' }),
        createMockMessage({ id: 'n2', content: 'has match here' }),
      ];
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: newPage }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      await testStore.dispatch(
        fetchMoreMessages({
          channelId: 'c',
          token: 't',
          lastMessageId: 's1',
        }),
      );

      const phantomCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.message?.includes?.('0 matched the active refine'),
      );
      expect(phantomCalls).toHaveLength(0);
    });

    it('does NOT emit phantom-load entry when no refine is active', async () => {
      const testStore = await createStoreWithApp();
      testStore.dispatch({
        type: 'message/setMessages',
        payload: [createMockMessage({ id: 's1' })],
      });

      const newPage = createMockMessages(5).map((m, i) =>
        createMockMessage({ ...m, id: `n${i}` }),
      );
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: newPage }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      const { fetchMoreMessages } = await import('./messageSlice');
      await testStore.dispatch(
        fetchMoreMessages({
          channelId: 'c',
          token: 't',
          lastMessageId: 's1',
        }),
      );

      const phantomCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.message?.includes?.('0 matched the active refine'),
      );
      expect(phantomCalls).toHaveLength(0);
    });

    it('clearRefineCriteria restores filteredMessages to full raw list', async () => {
      const testStore = await createStoreWithApp();
      testStore.dispatch({
        type: 'message/setMessages',
        payload: [
          createMockMessage({ id: 's1', content: 'match' }),
          createMockMessage({ id: 's2', content: 'other' }),
        ],
      });

      const { setRefineCriteria, clearRefineCriteria } = await import('./messageSlice');
      testStore.dispatch(
        setRefineCriteria({ searchMessageContents: ['match'] } as any),
      );
      expect(testStore.getState().message.filteredMessages).toHaveLength(1);

      testStore.dispatch(clearRefineCriteria());
      const state = testStore.getState().message;
      expect(state.refineCriteria).toBeNull();
      expect(state.filteredMessages).toHaveLength(2);
    });
  });

  describe('fetchAllMessages async thunk', () => {
    it('should dispatch starting and completion status entries', async () => {
      const batch = createMockMessages(50);
      const mockDiscordService = {
        fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: batch }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        fetchAllMessages({ channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/fetchAllMessages/fulfilled');

      const startCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.message === 'Load All: Starting...'
      );
      expect(startCalls).toHaveLength(1);

      const successCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.level === 'success'
      );
      expect(successCalls).toHaveLength(1);
      expect(successCalls[0][0].message).toBe('Load All complete: 50 messages');
    });

    it('should not dispatch info entries below 500-message milestone', async () => {
      const batch1 = createMockMessages(100);
      const batch2 = createMockMessages(50).map((m, i) =>
        createMockMessage({ ...m, id: `batch2-msg-${i + 1}` })
      );
      const mockDiscordService = {
        fetchMessageData: vi.fn()
          .mockResolvedValueOnce({ success: true, data: batch1 })
          .mockResolvedValueOnce({ success: true, data: batch2 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        fetchAllMessages({ channelId: 'channel-1', token: 'token' })
      );

      const infoCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.level === 'info' && payload.message.includes('messages fetched')
      );
      expect(infoCalls).toHaveLength(0);
    });

    it('should dispatch milestone info entries every 500 messages', async () => {
      // 6 batches of 100 = 600 messages, should trigger 1 milestone at 500
      const makeBatch = (prefix: string) =>
        createMockMessages(100).map((m, i) => createMockMessage({ ...m, id: `${prefix}-${i}` }));

      const mockDiscordService = {
        fetchMessageData: vi.fn()
          .mockResolvedValueOnce({ success: true, data: makeBatch('b1') })
          .mockResolvedValueOnce({ success: true, data: makeBatch('b2') })
          .mockResolvedValueOnce({ success: true, data: makeBatch('b3') })
          .mockResolvedValueOnce({ success: true, data: makeBatch('b4') })
          .mockResolvedValueOnce({ success: true, data: makeBatch('b5') })
          .mockResolvedValueOnce({ success: true, data: makeBatch('b6').slice(0, 50) }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      vi.mocked(addStatusEntry).mockClear();

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        fetchAllMessages({ channelId: 'channel-1', token: 'token' })
      );

      const infoCalls = vi.mocked(addStatusEntry).mock.calls.filter(
        ([payload]) => payload.level === 'info' && payload.message.includes('messages fetched')
      );
      expect(infoCalls).toHaveLength(1);
      expect(infoCalls[0][0].message).toBe('Load All: 500 messages fetched');
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      store = createTestStore({ message: messageReducer }, {
        message: {
          ...initialMessageState,
          messages: mockMessages,
          filteredMessages: [mockMessages[0], mockMessages[1]],
          selectedMessages: [mockMessages[0]],
          searchCriteria: { content: 'test' },
          order: { order: SortDirection.ASCENDING },
          isLoading: false,
          error: 'Test error',
        },
      });
    });

    it('selectMessage should return entire message state', () => {
      const messageState = selectMessage(store.getState());
      expect(messageState).toHaveProperty('messages');
      expect(messageState).toHaveProperty('filteredMessages');
      expect(messageState).toHaveProperty('selectedMessages');
    });

    it('selectMessages should return messages array', () => {
      const messages = selectMessages(store.getState());
      expect(messages).toEqual(mockMessages);
    });

    it('selectFilteredMessages should return filtered messages', () => {
      const filtered = selectFilteredMessages(store.getState());
      expect(filtered).toHaveLength(2);
    });

    it('selectSelectedMessages should return selected messages', () => {
      const selected = selectSelectedMessages(store.getState());
      expect(selected).toHaveLength(1);
      expect(selected[0]).toEqual(mockMessages[0]);
    });

    it('selectSearchCriteria should return search criteria', () => {
      const criteria = selectSearchCriteria(store.getState());
      expect(criteria).toEqual({ content: 'test' });
    });

    it('selectMessageOrder should return order', () => {
      const order = selectMessageOrder(store.getState());
      expect(order.order).toBe(SortDirection.ASCENDING);
    });

    it('selectMessageLoading should return loading status', () => {
      expect(selectMessageLoading(store.getState())).toBe(false);
    });

    it('selectMessageDeleting should return deleting status', () => {
      expect(selectMessageDeleting(store.getState())).toBe(false);
    });

    it('selectMessageError should return error', () => {
      expect(selectMessageError(store.getState())).toBe('Test error');
    });

    it('selectPagination should return pagination state', () => {
      const pagination = selectPagination(store.getState());
      expect(pagination).toHaveProperty('mode');
      expect(pagination).toHaveProperty('hasMore');
      expect(pagination).toHaveProperty('lastMessageId');
    });
  });

  // Helper to create a store with app reducer for thunks that read delay settings
  const createStoreWithApp = async (messageState = initialMessageState) => {
    const { configureStore } = await import('@reduxjs/toolkit');
    const appReducer = (await import('@features/app/appSlice')).default;
    const { defaultSettings } = await import('@features/app/appSlice');

    return configureStore({
      reducer: {
        message: messageReducer,
        app: appReducer,
      },
      preloadedState: {
        app: {
          discrubPaused: false,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle' as const, message: '' },
          settings: defaultSettings,
          previewThemeId: null,
        },
        message: messageState,
      },
    });
  };

  describe('editMessage async thunk', () => {
    it('should edit a message successfully', async () => {
      const updatedMsg = createMockMessage({ id: 'msg-1', content: 'edited content' });
      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([createMockMessage({ id: 'msg-1', content: 'original' })]));

      const result = await store.dispatch(
        editMessage({ messageId: 'msg-1', channelId: 'channel-1', content: 'edited content', token: 'token' })
      );

      expect(result.type).toBe('message/editMessage/fulfilled');
      expect(result.payload).toEqual(updatedMsg);
      expect(mockDiscordService.editMessage).toHaveBeenCalledWith('token', 'msg-1', { content: 'edited content' }, 'channel-1');
    });

    it('should update message in state on success', async () => {
      const original = createMockMessage({ id: 'msg-1', content: 'original' });
      const updated = createMockMessage({ id: 'msg-1', content: 'edited' });
      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: true, data: updated }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([original]));
      store.dispatch(setFilteredMessages([original]));

      await store.dispatch(
        editMessage({ messageId: 'msg-1', channelId: 'channel-1', content: 'edited', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].content).toBe('edited');
      expect(state.filteredMessages[0].content).toBe('edited');
    });

    it('should handle edit failure and surface the HTTP status (#212)', async () => {
      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: false, data: null, status: 403 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        editMessage({ messageId: 'msg-1', channelId: 'channel-1', content: 'test', token: 'token' })
      );

      expect(result.type).toBe('message/editMessage/rejected');
      expect(result.payload).toBe('Failed to edit message (HTTP 403)');
    });

    it('should handle network error', async () => {
      const mockDiscordService = {
        editMessage: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        editMessage({ messageId: 'msg-1', channelId: 'channel-1', content: 'test', token: 'token' })
      );

      expect(result.type).toBe('message/editMessage/rejected');
      expect(result.payload).toBe('Network error');
    });
  });

  describe('editMessages async thunk', () => {
    it('should edit multiple messages successfully', async () => {
      const msgs = createMockMessages(2);
      const editedMsgs = msgs.map((m) => createMockMessage({ id: m.id, content: 'bulk edited' }));
      const mockDiscordService = {
        editMessage: vi.fn()
          .mockResolvedValueOnce({ success: true, data: editedMsgs[0] })
          .mockResolvedValueOnce({ success: true, data: editedMsgs[1] }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: msgs,
        filteredMessages: msgs,
      });

      const result = await testStore.dispatch(
        editMessages({ messages: msgs, channelId: 'channel-1', content: 'bulk edited', token: 'token' })
      );

      expect(result.type).toBe('message/editMessages/fulfilled');
      expect(mockDiscordService.editMessage).toHaveBeenCalledTimes(2);
    });

    it('should update messages in state on success', async () => {
      const msgs = createMockMessages(2);
      const editedMsgs = msgs.map((m) => createMockMessage({ id: m.id, content: 'new content' }));
      const mockDiscordService = {
        editMessage: vi.fn()
          .mockResolvedValueOnce({ success: true, data: editedMsgs[0] })
          .mockResolvedValueOnce({ success: true, data: editedMsgs[1] }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: msgs,
        filteredMessages: msgs,
      });

      await testStore.dispatch(
        editMessages({ messages: msgs, channelId: 'channel-1', content: 'new content', token: 'token' })
      );

      const state = testStore.getState().message;
      expect(state.messages[0].content).toBe('new content');
      expect(state.messages[1].content).toBe('new content');
      expect(state.selectedMessages).toEqual([]);
    });

    it('should handle error from editMessages', async () => {
      const mockDiscordService = {
        editMessage: vi.fn().mockRejectedValue(new Error('Edit failed')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp();

      const msgs = createMockMessages(1);
      const result = await testStore.dispatch(
        editMessages({ messages: msgs, channelId: 'channel-1', content: 'test', token: 'token' })
      );

      // Individual failures are caught inside the loop, so the thunk still fulfills
      expect(result.type).toBe('message/editMessages/fulfilled');
    });

    it('should dispatch showOperationTip when starting', async () => {
      const { showOperationTip } = await import('@features/status/statusSlice');
      const msgs = createMockMessages(2);
      const editedMsgs = msgs.map((m) => createMockMessage({ id: m.id, content: 'tip test' }));
      const mockDiscordService = {
        editMessage: vi.fn()
          .mockResolvedValueOnce({ success: true, data: editedMsgs[0] })
          .mockResolvedValueOnce({ success: true, data: editedMsgs[1] }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: msgs,
        filteredMessages: msgs,
      });

      await testStore.dispatch(
        editMessages({ messages: msgs, channelId: 'channel-1', content: 'tip test', token: 'token' })
      );

      expect(showOperationTip).toHaveBeenCalled();
    });
  });

  describe('fetchReactingUsers async thunk', () => {
    it('should fetch reacting users successfully', async () => {
      const users = [
        createMockUser({ id: 'user-1', username: 'Alice' }),
        createMockUser({ id: 'user-2', username: 'Bob' }),
      ];
      const mockDiscordService = {
        getReactions: vi.fn().mockResolvedValue({ success: true, data: users }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const appStore = await createStoreWithApp();
      const result = await appStore.dispatch(
        fetchReactingUsers({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      expect(result.type).toBe('message/fetchReactingUsers/fulfilled');
      expect(result.payload).toEqual({
        messageId: 'msg-1',
        emoji: '👍',
        users,
      });
      expect(mockDiscordService.getReactions).toHaveBeenCalledWith(
        'token', 'channel-1', 'msg-1', '👍', 0, null
      );
    });

    it('should paginate through all reacting users, pacing between pages (#241)', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) =>
        createMockUser({ id: `user-${i}`, username: `User${i}` })
      );
      const secondPage = [
        createMockUser({ id: 'user-100', username: 'User100' }),
      ];
      const mockDiscordService = {
        getReactions: vi.fn()
          .mockResolvedValueOnce({ success: true, data: firstPage })
          .mockResolvedValueOnce({ success: true, data: secondPage }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      const { cancellableDelay } = await import('@/utils/operationLoopUtils');
      vi.mocked(cancellableDelay).mockClear();

      const appStore = await createStoreWithApp();
      const result = await appStore.dispatch(
        fetchReactingUsers({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      expect(result.type).toBe('message/fetchReactingUsers/fulfilled');
      const payload = result.payload as { users: any[] };
      expect(payload.users).toHaveLength(101);
      expect(mockDiscordService.getReactions).toHaveBeenCalledTimes(2);
      // Second call should use the last user's ID from the first page
      expect(mockDiscordService.getReactions).toHaveBeenCalledWith(
        'token', 'channel-1', 'msg-1', '👍', 0, 'user-99'
      );
      // The service no longer self-delays, so the loop paces between
      // pages itself: one delay for two pages (none after the last).
      expect(cancellableDelay).toHaveBeenCalledTimes(1);
    });

    it('should handle API failure', async () => {
      const mockDiscordService = {
        getReactions: vi.fn().mockResolvedValue({ success: false, data: null }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const appStore = await createStoreWithApp();
      const result = await appStore.dispatch(
        fetchReactingUsers({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      // The thunk returns an empty users array when the API fails (it breaks out of the loop)
      expect(result.type).toBe('message/fetchReactingUsers/fulfilled');
      const payload = result.payload as { users: any[] };
      expect(payload.users).toEqual([]);
    });

    it('should handle network error', async () => {
      const mockDiscordService = {
        getReactions: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const appStore = await createStoreWithApp();
      const result = await appStore.dispatch(
        fetchReactingUsers({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      expect(result.type).toBe('message/fetchReactingUsers/rejected');
      expect(result.payload).toBe('Network error');
    });
  });

  describe('deleteReaction async thunk', () => {
    it('should delete a reaction successfully', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteReaction({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', userId: 'user-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteReaction/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1', emoji: '👍', userId: 'user-1' });
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledWith(
        'token', 'channel-1', 'msg-1', '👍', 'user-1'
      );
    });

    it('should decrement reaction count in state on success', async () => {
      const reaction = createMockReaction({ count: 3, emoji: { id: null, name: '👍' } });
      const msgWithReaction = createMockMessage({ id: 'msg-1', reactions: [reaction] });

      store.dispatch(setMessages([msgWithReaction]));
      store.dispatch(setFilteredMessages([msgWithReaction]));

      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(
        deleteReaction({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', userId: 'user-1', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].reactions![0].count).toBe(2);
    });

    it('should remove reaction entirely when count reaches zero', async () => {
      const reaction = createMockReaction({ count: 1, emoji: { id: null, name: '👍' } });
      const msgWithReaction = createMockMessage({ id: 'msg-1', reactions: [reaction] });

      store.dispatch(setMessages([msgWithReaction]));
      store.dispatch(setFilteredMessages([msgWithReaction]));

      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(
        deleteReaction({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', userId: 'user-1', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].reactions).toHaveLength(0);
    });

    it('should handle delete reaction failure and surface the HTTP status (#212)', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: false, status: 429 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteReaction({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', userId: 'user-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteReaction/rejected');
      expect(result.payload).toBe('Failed to delete reaction (HTTP 429)');
    });
  });

  describe('deleteAllReactions async thunk', () => {
    it('should delete all reactions for an emoji', async () => {
      const reaction = createMockReaction({ count: 2, emoji: { id: null, name: '👍' } });
      const msgWithReaction = createMockMessage({ id: 'msg-1', reactions: [reaction] });

      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msgWithReaction],
        filteredMessages: [msgWithReaction],
      });

      const result = await testStore.dispatch(
        deleteAllReactions({
          channelId: 'channel-1',
          messageId: 'msg-1',
          emoji: '👍',
          userIds: ['user-1', 'user-2'],
          token: 'token',
        })
      );

      expect(result.type).toBe('message/deleteAllReactions/fulfilled');
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledTimes(2);
    });

    it('should remove emoji from reactions in state', async () => {
      const thumbsUp = createMockReaction({ count: 2, emoji: { id: null, name: '👍' } });
      const heart = createMockReaction({ count: 1, emoji: { id: null, name: '❤️' } });
      const msgWithReactions = createMockMessage({ id: 'msg-1', reactions: [thumbsUp, heart] });

      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msgWithReactions],
        filteredMessages: [msgWithReactions],
      });

      await testStore.dispatch(
        deleteAllReactions({
          channelId: 'channel-1',
          messageId: 'msg-1',
          emoji: '👍',
          userIds: ['user-1', 'user-2'],
          token: 'token',
        })
      );

      const state = testStore.getState().message;
      // The 👍 reaction should be removed entirely, ❤️ should remain
      expect(state.messages[0].reactions).toHaveLength(1);
      expect(state.messages[0].reactions![0].emoji.name).toBe('❤️');
    });

    it('should handle partial failures gracefully', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn()
          .mockResolvedValueOnce({ success: true })
          .mockResolvedValueOnce({ success: false }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp();

      const result = await testStore.dispatch(
        deleteAllReactions({
          channelId: 'channel-1',
          messageId: 'msg-1',
          emoji: '👍',
          userIds: ['user-1', 'user-2'],
          token: 'token',
        })
      );

      // Thunk still fulfills; individual failures are caught inside the loop
      expect(result.type).toBe('message/deleteAllReactions/fulfilled');
    });
  });

  describe('bulkDeleteAllReactions async thunk', () => {
    it('should call deleteAllReactionsFromMessage endpoint', async () => {
      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        bulkDeleteAllReactions({ channelId: 'channel-1', messageId: 'msg-1', token: 'token' })
      );

      expect(result.type).toBe('message/bulkDeleteAllReactions/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1' });
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledWith(
        'token', 'channel-1', 'msg-1'
      );
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledTimes(1);
    });

    it('should clear all reactions from message in state', async () => {
      const reaction1 = createMockReaction({ count: 3, emoji: { id: null, name: '👍' } });
      const reaction2 = createMockReaction({ count: 2, emoji: { id: null, name: '❤️' } });
      const msg = createMockMessage({ id: 'msg-1', reactions: [reaction1, reaction2] });

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(
        bulkDeleteAllReactions({ channelId: 'channel-1', messageId: 'msg-1', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].reactions).toEqual([]);
    });

    it('should reject on API failure', async () => {
      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: false }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        bulkDeleteAllReactions({ channelId: 'channel-1', messageId: 'msg-1', token: 'token' })
      );

      expect(result.type).toBe('message/bulkDeleteAllReactions/rejected');
    });
  });

  describe('bulkDeleteReactionsForEmoji async thunk', () => {
    it('should call deleteAllReactionsForEmoji endpoint', async () => {
      const mockDiscordService = {
        deleteAllReactionsForEmoji: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        bulkDeleteReactionsForEmoji({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      expect(result.type).toBe('message/bulkDeleteReactionsForEmoji/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1', emoji: '👍' });
      expect(mockDiscordService.deleteAllReactionsForEmoji).toHaveBeenCalledWith(
        'token', 'channel-1', 'msg-1', '👍'
      );
      expect(mockDiscordService.deleteAllReactionsForEmoji).toHaveBeenCalledTimes(1);
    });

    it('should remove only the targeted emoji from state', async () => {
      const thumbsUp = createMockReaction({ count: 3, emoji: { id: null, name: '👍' } });
      const heart = createMockReaction({ count: 2, emoji: { id: null, name: '❤️' } });
      const msg = createMockMessage({ id: 'msg-1', reactions: [thumbsUp, heart] });

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      const mockDiscordService = {
        deleteAllReactionsForEmoji: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(
        bulkDeleteReactionsForEmoji({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].reactions).toHaveLength(1);
      expect(state.messages[0].reactions![0].emoji.name).toBe('❤️');
    });

    it('should reject on API failure and surface the HTTP status (#212)', async () => {
      const mockDiscordService = {
        deleteAllReactionsForEmoji: vi.fn().mockResolvedValue({ success: false, status: 403 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        bulkDeleteReactionsForEmoji({ channelId: 'channel-1', messageId: 'msg-1', emoji: '👍', token: 'token' })
      );

      expect(result.type).toBe('message/bulkDeleteReactionsForEmoji/rejected');
      expect(result.payload).toBe('Failed to delete reactions for emoji (HTTP 403)');
    });
  });

  describe('batchRemoveReactions async thunk', () => {
    const createStoreWithApp = async (messageState = initialMessageState) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      return configureStore({
        reducer: { message: messageReducer, app: appReducer },
        preloadedState: {
          app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const, task: { status: 'idle' as const, message: '' }, settings: defaultSettings, previewThemeId: null },
          message: messageState,
        },
      });
    };

    it('should call deleteAllReactionsFromMessage for each message in "all" mode', async () => {
      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-2', reactions: [{ emoji: { id: null, name: '❤️' }, count: 2 }] },
        { id: 'msg-3', reactions: [{ emoji: { id: null, name: '🔥' }, count: 3 }] },
      ];

      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'all', token: 'token' })
      );

      expect(result.type).toBe('message/batchRemoveReactions/fulfilled');
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledTimes(3);
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledWith('token', 'ch-1', 'msg-1');
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledWith('token', 'ch-1', 'msg-2');
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledWith('token', 'ch-1', 'msg-3');
    });

    it('should call deleteAllReactionsForEmoji for each message in "emoji" mode', async () => {
      const mockDiscordService = {
        deleteAllReactionsForEmoji: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 2 }] },
      ];

      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'emoji', emojis: ['👍'], token: 'token' })
      );

      expect(result.type).toBe('message/batchRemoveReactions/fulfilled');
      expect(mockDiscordService.deleteAllReactionsForEmoji).toHaveBeenCalledTimes(2);
      expect(mockDiscordService.deleteAllReactionsForEmoji).toHaveBeenCalledWith('token', 'ch-1', 'msg-1', '👍');
    });

    describe('per-emoji pacing (2.1.3 pacing audit)', () => {
      afterEach(async () => {
        const { cancellableDelay } = await import('@/utils/operationLoopUtils');
        vi.mocked(cancellableDelay).mockReset().mockResolvedValue(false);
      });
      const recorder = async () => {
        const events: string[] = [];
        const { cancellableDelay } = await import('@/utils/operationLoopUtils');
        vi.mocked(cancellableDelay).mockImplementation(async () => { events.push('delay'); return false; });
        const { calculateRandomDelay } = await import('@/utils/delayUtils');
        vi.mocked(calculateRandomDelay).mockClear();
        return { events, bases: () => vi.mocked(calculateRandomDelay).mock.calls.map((c) => c[0]) };
      };
      const backToBack = (events: string[]) =>
        events.some((e, i) => e === 'delete' && events[i + 1] === 'delete');

      it('emoji mode sleeps between emojis on one message', async () => {
        const { events, bases } = await recorder();
        const mockDiscordService = {
          deleteAllReactionsForEmoji: vi.fn().mockImplementation(async () => { events.push('delete'); return { success: true }; }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        const messages = [{ id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 1 },
          { emoji: { id: null, name: '🔥' }, count: 1 },
          { emoji: { id: null, name: '❤️' }, count: 1 },
        ] }];
        const testStore = await createStoreWithApp();
        await testStore.dispatch(
          batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'emoji', emojis: ['👍', '🔥', '❤️'], token: 'token' })
        );
        expect(events).toEqual(['delete', 'delay', 'delete', 'delay', 'delete']);
        expect(bases()).toEqual([2, 2]); // delete delay (default 2s)
      });

      it('emoji mode never fires two deletes back to back across messages', async () => {
        const { events } = await recorder();
        const mockDiscordService = {
          deleteAllReactionsForEmoji: vi.fn().mockImplementation(async () => { events.push('delete'); return { success: true }; }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        const reactions = [{ emoji: { id: null, name: '👍' }, count: 1 }, { emoji: { id: null, name: '🔥' }, count: 1 }];
        const messages = [{ id: 'msg-1', reactions }, { id: 'msg-2', reactions }];
        const testStore = await createStoreWithApp();
        await testStore.dispatch(
          batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'emoji', emojis: ['👍', '🔥'], token: 'token' })
        );
        expect(events.filter((e) => e === 'delete')).toHaveLength(4);
        expect(backToBack(events)).toBe(false);
        expect(events.filter((e) => e === 'delay')).toHaveLength(3);
      });

      it('user mode sleeps between the emojis a user reacted with', async () => {
        const { events } = await recorder();
        const mockDiscordService = {
          deleteReaction: vi.fn().mockImplementation(async () => { events.push('delete'); return { success: true }; }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        const messages = [{ id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 2 },
          { emoji: { id: null, name: '❤️' }, count: 1 },
          { emoji: { id: null, name: '🔥' }, count: 1, me: false },
        ] }];
        const testStore = await createStoreWithApp();
        await testStore.dispatch(
          batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'user', userId: 'user-1', token: 'token' })
        );
        expect(events).toEqual(['delete', 'delay', 'delete']);
      });

      it('all mode is one request per message, paced per message', async () => {
        const { events } = await recorder();
        const mockDiscordService = {
          deleteAllReactionsFromMessage: vi.fn().mockImplementation(async () => { events.push('delete'); return { success: true }; }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        const messages = [
          { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
          { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        ];
        const testStore = await createStoreWithApp();
        await testStore.dispatch(
          batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'all', token: 'token' })
        );
        expect(events).toEqual(['delete', 'delay', 'delete']);
      });

      it('a cancel during the per-emoji sleep stops the batch', async () => {
        const { events } = await recorder();
        const { cancellableDelay } = await import('@/utils/operationLoopUtils');
        vi.mocked(cancellableDelay).mockImplementation(async () => { events.push('delay'); return true; });
        const mockDiscordService = {
          deleteAllReactionsForEmoji: vi.fn().mockImplementation(async () => { events.push('delete'); return { success: true }; }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        const messages = [{ id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 1 },
          { emoji: { id: null, name: '🔥' }, count: 1 },
        ] }, { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] }];
        const testStore = await createStoreWithApp();
        await testStore.dispatch(
          batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'emoji', emojis: ['👍', '🔥'], token: 'token' })
        );
        expect(events.filter((e) => e === 'delete')).toHaveLength(1);
      });
    });

    it('should call deleteReaction per emoji in "user" mode', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 2 },
          { emoji: { id: null, name: '❤️' }, count: 1 },
        ] },
      ];

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'user', userId: 'user-1', token: 'token' })
      );

      // 2 emojis on msg-1, user mode deletes per emoji
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledTimes(2);
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledWith('token', 'ch-1', 'msg-1', '👍', 'user-1');
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledWith('token', 'ch-1', 'msg-1', '❤️', 'user-1');
    });

    it('should update state correctly for "all" mode', async () => {
      const reaction = createMockReaction({ count: 3, emoji: { id: null, name: '👍' } });
      const msg = createMockMessage({ id: 'msg-1', reactions: [reaction] });

      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msg],
        filteredMessages: [msg],
      });

      await testStore.dispatch(
        batchRemoveReactions({
          channelId: 'ch-1',
          messages: [{ id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 3 }] }],
          mode: 'all',
          token: 'token',
        })
      );

      const state = testStore.getState().message;
      expect(state.messages[0].reactions).toEqual([]);
    });

    it('should update state correctly for "emoji" mode — remove only targeted emojis', async () => {
      const thumbsUp = createMockReaction({ count: 3, emoji: { id: null, name: '👍' } });
      const heart = createMockReaction({ count: 2, emoji: { id: null, name: '❤️' } });
      const fire = createMockReaction({ count: 1, emoji: { id: null, name: '🔥' } });
      const msg = createMockMessage({ id: 'msg-1', reactions: [thumbsUp, heart, fire] });

      const mockDiscordService = {
        deleteAllReactionsForEmoji: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msg],
        filteredMessages: [msg],
      });

      await testStore.dispatch(
        batchRemoveReactions({
          channelId: 'ch-1',
          messages: [{ id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 3 }, { emoji: { id: null, name: '🔥' }, count: 1 }] }],
          mode: 'emoji',
          emojis: ['👍', '🔥'],
          token: 'token',
        })
      );

      const state = testStore.getState().message;
      // Only ❤️ should remain
      expect(state.messages[0].reactions).toHaveLength(1);
      expect(state.messages[0].reactions![0].emoji.name).toBe('❤️');
      // 2 emojis × 1 message = 2 API calls
      expect(mockDiscordService.deleteAllReactionsForEmoji).toHaveBeenCalledTimes(2);
    });

    it('should update state correctly for "user" mode — decrement counts', async () => {
      const thumbsUp = createMockReaction({ count: 3, emoji: { id: null, name: '👍' } });
      const heart = createMockReaction({ count: 1, emoji: { id: null, name: '❤️' } });
      const msg = createMockMessage({ id: 'msg-1', reactions: [thumbsUp, heart] });

      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msg],
        filteredMessages: [msg],
      });

      await testStore.dispatch(
        batchRemoveReactions({
          channelId: 'ch-1',
          messages: [{ id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 3 }, { emoji: { id: null, name: '❤️' }, count: 1 }] }],
          mode: 'user',
          userId: 'user-1',
          token: 'token',
        })
      );

      const state = testStore.getState().message;
      // 👍 decremented 3→2, ❤️ decremented 1→0 (removed)
      expect(state.messages[0].reactions).toHaveLength(1);
      expect(state.messages[0].reactions![0].emoji.name).toBe('👍');
      expect(state.messages[0].reactions![0].count).toBe(2);
    });

    it('should stop when cancelled', async () => {
      const { checkCancelled } = await import('@/utils/operationLoopUtils');
      // Cancel after first message
      vi.mocked(checkCancelled)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-3', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
      ];

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'all', token: 'token' })
      );

      // Should only process 1 message before cancel check stops it
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledTimes(1);

      // Reset mock
      vi.mocked(checkCancelled).mockReturnValue(false);
    });

    it('should skip messages where user has not reacted (me=false) in "user" mode', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 3, me: true },
          { emoji: { id: null, name: '❤️' }, count: 2, me: false },
        ] },
        { id: 'msg-2', reactions: [
          { emoji: { id: null, name: '👍' }, count: 1, me: false },
        ] },
        { id: 'msg-3', reactions: [
          { emoji: { id: null, name: '🔥' }, count: 5, me: true },
        ] },
      ];

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'user', userId: 'user-1', token: 'token' })
      );

      // msg-1: only 👍 (me=true), skip ❤️ (me=false) → 1 call
      // msg-2: skip entirely (me=false on all) → 0 calls
      // msg-3: 🔥 (me=true) → 1 call
      // Total: 2 API calls instead of 4
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledTimes(2);
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledWith('token', 'ch-1', 'msg-1', '👍', 'user-1');
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledWith('token', 'ch-1', 'msg-3', '🔥', 'user-1');
    });

    it('should still attempt deletion when me field is undefined (backwards compat)', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 2 }, // no me field
        ] },
      ];

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'user', userId: 'user-1', token: 'token' })
      );

      // Without me field, should still attempt deletion (not skip)
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledTimes(1);
    });

    it('should skip entire message when all reactions have me=false in "user" mode', async () => {
      const mockDiscordService = {
        deleteReaction: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [
          { emoji: { id: null, name: '👍' }, count: 5, me: false },
          { emoji: { id: null, name: '❤️' }, count: 3, me: false },
        ] },
      ];

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'user', userId: 'user-1', token: 'token' })
      );

      // All me=false, entire message skipped, 0 API calls
      expect(mockDiscordService.deleteReaction).toHaveBeenCalledTimes(0);
    });

    it('should continue on partial failure in "all" mode', async () => {
      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn()
          .mockRejectedValueOnce(new Error('API error'))
          .mockResolvedValueOnce({ success: true })
          .mockResolvedValueOnce({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-3', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
      ];

      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'all', token: 'token' })
      );

      expect(result.type).toBe('message/batchRemoveReactions/fulfilled');
      // All 3 were attempted despite first failing
      expect(mockDiscordService.deleteAllReactionsFromMessage).toHaveBeenCalledTimes(3);
    });

    it('should continue on partial failure in "emoji" mode', async () => {
      const mockDiscordService = {
        deleteAllReactionsForEmoji: vi.fn()
          .mockRejectedValueOnce(new Error('API error'))
          .mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
      ];

      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'emoji', emojis: ['👍'], token: 'token' })
      );

      expect(result.type).toBe('message/batchRemoveReactions/fulfilled');
      expect(mockDiscordService.deleteAllReactionsForEmoji).toHaveBeenCalledTimes(2);
    });

    it('should set isRemovingReactions on pending and clear on fulfilled', async () => {
      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp();

      // Check pending sets the flag
      const dispatchPromise = testStore.dispatch(
        batchRemoveReactions({
          channelId: 'ch-1',
          messages: [{ id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] }],
          mode: 'all',
          token: 'token',
        })
      );

      await dispatchPromise;

      // After fulfilled, flag should be cleared
      expect(testStore.getState().message.isRemovingReactions).toBe(false);
    });

    it('should call cancellableDelay between messages', async () => {
      const { cancellableDelay } = await import('@/utils/operationLoopUtils');
      vi.mocked(cancellableDelay).mockResolvedValue(false);

      const mockDiscordService = {
        deleteAllReactionsFromMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [
        { id: 'msg-1', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
        { id: 'msg-2', reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }] },
      ];

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchRemoveReactions({ channelId: 'ch-1', messages, mode: 'all', token: 'token' })
      );

      // Delay called between msg-1 and msg-2 (not after last message)
      expect(cancellableDelay).toHaveBeenCalledTimes(1);
    });
  });

  describe('batchAddReactions async thunk (Backlog #202)', () => {
    const createStoreWithApp = async (messageState = initialMessageState) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      return configureStore({
        reducer: { message: messageReducer, app: appReducer },
        preloadedState: {
          app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const, task: { status: 'idle' as const, message: '' }, settings: defaultSettings, previewThemeId: null },
          message: messageState,
        },
      });
    };

    it('fans out one addReaction per (message × emoji) pair', async () => {
      const mockDiscordService = {
        addReaction: vi.fn().mockResolvedValue({ success: true, status: 204 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [{ id: 'msg-1' }, { id: 'msg-2' }, { id: 'msg-3' }];
      const emojis = [{ name: '👍' }, { id: '123', name: 'pepe', animated: false }];

      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages, emojis, token: 'tok' })
      );

      expect(result.type).toBe('message/batchAddReactions/fulfilled');
      // 3 messages × 2 emojis = 6 calls
      expect(mockDiscordService.addReaction).toHaveBeenCalledTimes(6);
      // Unicode emoji passed raw, custom emoji passed as name:id
      expect(mockDiscordService.addReaction).toHaveBeenCalledWith('tok', 'ch-1', 'msg-1', '👍');
      expect(mockDiscordService.addReaction).toHaveBeenCalledWith('tok', 'ch-1', 'msg-1', 'pepe:123');
      expect((result.payload as any).added).toBe(6);
    });

    it('buckets failures by HTTP status without aborting the run', async () => {
      const mockDiscordService = {
        addReaction: vi
          .fn()
          .mockResolvedValueOnce({ success: true, status: 204 }) // added
          .mockResolvedValueOnce({ success: false, status: 403 }) // no permission
          .mockResolvedValueOnce({ success: false, status: 400 }) // emoji rejected
          .mockResolvedValueOnce({ success: false, status: 404 }) // message gone
          .mockResolvedValueOnce({ success: false, status: 500 }), // failed
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }, { id: 'm5' }];
      const testStore = await createStoreWithApp();
      const result = await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages, emojis: [{ name: '👍' }], token: 'tok' })
      );

      expect(mockDiscordService.addReaction).toHaveBeenCalledTimes(5);
      expect((result.payload as any).added).toBe(1);
      // Plain-language summary names each non-zero bucket
      expect(vi.mocked(addStatusEntry)).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('no permission'),
        })
      );
    });

    it('optimistically merges added reactions into the feed', async () => {
      const msg = createMockMessage({ id: 'msg-1', reactions: [] });
      const mockDiscordService = {
        addReaction: vi.fn().mockResolvedValue({ success: true, status: 204 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msg],
        filteredMessages: [msg],
      });
      await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages: [{ id: 'msg-1' }], emojis: [{ name: '🔥' }], token: 'tok' })
      );

      const state = testStore.getState().message;
      expect(state.messages[0].reactions).toHaveLength(1);
      expect(state.messages[0].reactions![0].emoji.name).toBe('🔥');
      expect(state.messages[0].reactions![0].count).toBe(1);
      expect(state.messages[0].reactions![0].me).toBe(true);
    });

    it('bumps the count of an existing reaction (idempotent on me)', async () => {
      const existing = createMockReaction({ count: 2, me: false, emoji: { id: null, name: '🔥' } });
      const msg = createMockMessage({ id: 'msg-1', reactions: [existing] });
      const mockDiscordService = {
        addReaction: vi.fn().mockResolvedValue({ success: true, status: 204 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        messages: [msg],
      });
      await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages: [{ id: 'msg-1' }], emojis: [{ name: '🔥' }], token: 'tok' })
      );

      const state = testStore.getState().message;
      expect(state.messages[0].reactions).toHaveLength(1);
      expect(state.messages[0].reactions![0].count).toBe(3);
      expect(state.messages[0].reactions![0].me).toBe(true);
    });

    it('no-ops with a status entry when nothing is selected', async () => {
      const mockDiscordService = { addReaction: vi.fn() };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages: [], emojis: [{ name: '👍' }], token: 'tok' })
      );
      expect(mockDiscordService.addReaction).not.toHaveBeenCalled();

      await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages: [{ id: 'm1' }], emojis: [], token: 'tok' })
      );
      expect(mockDiscordService.addReaction).not.toHaveBeenCalled();
    });

    it('stops mid-run when cancelled', async () => {
      const { checkCancelled } = await import('@/utils/operationLoopUtils');
      // Allow the first call, cancel before the second.
      vi.mocked(checkCancelled).mockReturnValueOnce(false).mockReturnValueOnce(true);

      const mockDiscordService = {
        addReaction: vi.fn().mockResolvedValue({ success: true, status: 204 }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const messages = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
      const testStore = await createStoreWithApp();
      await testStore.dispatch(
        batchAddReactions({ channelId: 'ch-1', messages, emojis: [{ name: '👍' }], token: 'tok' })
      );

      expect(mockDiscordService.addReaction).toHaveBeenCalledTimes(1);
      vi.mocked(checkCancelled).mockReturnValue(false);
    });
  });

  describe('deleteAttachment async thunk', () => {
    it('should remove an attachment by editing the message', async () => {
      const attachment1 = createMockAttachment({ id: 'att-1', filename: 'file1.png' });
      const attachment2 = createMockAttachment({ id: 'att-2', filename: 'file2.png' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: 'has attachments',
        attachments: [attachment1, attachment2],
      });
      const updatedMsg = createMockMessage({
        id: 'msg-1',
        content: 'has attachments',
        attachments: [attachment2],
      });

      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      const result = await store.dispatch(
        deleteAttachment({ message: msg, attachment: attachment1, channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteAttachment/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1', deleted: false, updatedMessage: updatedMsg });
      // Should call editMessage with remaining attachments
      expect(mockDiscordService.editMessage).toHaveBeenCalledWith(
        'token', 'msg-1', { attachments: [attachment2] }, 'channel-1'
      );
    });

    it('should update attachment array in state after removal', async () => {
      const attachment1 = createMockAttachment({ id: 'att-1', filename: 'file1.png' });
      const attachment2 = createMockAttachment({ id: 'att-2', filename: 'file2.png' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: 'has attachments',
        attachments: [attachment1, attachment2],
      });
      const updatedMsg = createMockMessage({
        id: 'msg-1',
        content: 'has attachments',
        attachments: [attachment2],
      });

      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      await store.dispatch(
        deleteAttachment({ message: msg, attachment: attachment1, channelId: 'channel-1', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].attachments).toHaveLength(1);
      expect(state.messages[0].attachments[0].id).toBe('att-2');
    });

    it('should delete entire message when last attachment removed and no content', async () => {
      const attachment = createMockAttachment({ id: 'att-1' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: '',
        attachments: [attachment],
      });

      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      const result = await store.dispatch(
        deleteAttachment({ message: msg, attachment, channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteAttachment/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1', deleted: true });
      expect(mockDiscordService.deleteMessage).toHaveBeenCalledWith('token', 'msg-1', 'channel-1');

      // Message should be removed from state
      const state = store.getState().message;
      expect(state.messages).toHaveLength(0);
    });

    it('should handle edit failure', async () => {
      const attachment = createMockAttachment({ id: 'att-1' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: 'some content',
        attachments: [attachment],
      });

      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: false, data: null }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteAttachment({ message: msg, attachment, channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteAttachment/rejected');
    });
  });

  describe('deleteAllAttachments async thunk', () => {
    it('should remove all attachments by editing the message', async () => {
      const attachment1 = createMockAttachment({ id: 'att-1' });
      const attachment2 = createMockAttachment({ id: 'att-2' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: 'has content',
        attachments: [attachment1, attachment2],
      });
      const updatedMsg = createMockMessage({
        id: 'msg-1',
        content: 'has content',
        attachments: [],
      });

      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      const result = await store.dispatch(
        deleteAllAttachments({ message: msg, channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteAllAttachments/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1', deleted: false, updatedMessage: updatedMsg });
      expect(mockDiscordService.editMessage).toHaveBeenCalledWith(
        'token', 'msg-1', { attachments: [] }, 'channel-1'
      );
    });

    it('should update state to reflect removed attachments', async () => {
      const attachment1 = createMockAttachment({ id: 'att-1' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: 'has content',
        attachments: [attachment1],
      });
      const updatedMsg = createMockMessage({
        id: 'msg-1',
        content: 'has content',
        attachments: [],
      });

      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      await store.dispatch(
        deleteAllAttachments({ message: msg, channelId: 'channel-1', token: 'token' })
      );

      const state = store.getState().message;
      expect(state.messages[0].attachments).toHaveLength(0);
    });

    it('should delete entire message when no content remains', async () => {
      const attachment = createMockAttachment({ id: 'att-1' });
      const msg = createMockMessage({
        id: 'msg-1',
        content: '',
        attachments: [attachment],
      });

      const mockDiscordService = {
        deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(setMessages([msg]));
      store.dispatch(setFilteredMessages([msg]));

      const result = await store.dispatch(
        deleteAllAttachments({ message: msg, channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteAllAttachments/fulfilled');
      expect(result.payload).toEqual({ messageId: 'msg-1', deleted: true });

      const state = store.getState().message;
      expect(state.messages).toHaveLength(0);
    });

    it('should handle edit failure', async () => {
      const msg = createMockMessage({
        id: 'msg-1',
        content: 'has content',
        attachments: [createMockAttachment()],
      });

      const mockDiscordService = {
        editMessage: vi.fn().mockResolvedValue({ success: false, data: null }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(
        deleteAllAttachments({ message: msg, channelId: 'channel-1', token: 'token' })
      );

      expect(result.type).toBe('message/deleteAllAttachments/rejected');
    });
  });

  describe('Thread tab reducers', () => {
    const threadMessages = createMockMessages(3).map((m, i) =>
      createMockMessage({ ...m, id: `thread-msg-${i + 1}`, channel_id: 'thread-100' })
    );

    describe('addThreadTab', () => {
      it('should create a new thread tab with loading state', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        const state = store.getState().message;
        expect(state.threadTabs['thread-100']).toBeDefined();
        expect(state.threadTabs['thread-100'].threadName).toBe('My Thread');
        expect(state.threadTabs['thread-100'].isLoading).toBe(true);
        expect(state.threadTabs['thread-100'].messages).toEqual([]);
        expect(state.activeTab).toBe('thread-100');
      });

      it('should not overwrite existing tab, but should switch to it', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
        store.dispatch(setActiveTab(null));

        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'Different Name' }));
        const state = store.getState().message;
        expect(state.threadTabs['thread-100'].threadName).toBe('My Thread');
        expect(state.threadTabs['thread-100'].messages).toEqual(threadMessages);
        expect(state.activeTab).toBe('thread-100');
      });
    });

    describe('removeThreadTab', () => {
      it('should remove a thread tab', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(removeThreadTab('thread-100'));
        const state = store.getState().message;
        expect(state.threadTabs['thread-100']).toBeUndefined();
      });

      it('should switch to main tab if removed tab was active', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        expect(store.getState().message.activeTab).toBe('thread-100');
        store.dispatch(removeThreadTab('thread-100'));
        expect(store.getState().message.activeTab).toBeNull();
      });

      it('should not change active tab if removed tab was not active', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'Thread 1' }));
        store.dispatch(addThreadTab({ threadId: 'thread-200', threadName: 'Thread 2' }));
        expect(store.getState().message.activeTab).toBe('thread-200');
        store.dispatch(removeThreadTab('thread-100'));
        expect(store.getState().message.activeTab).toBe('thread-200');
      });
    });

    describe('setActiveTab', () => {
      it('should switch to main tab with null', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setActiveTab(null));
        expect(store.getState().message.activeTab).toBeNull();
      });

      it('should switch to a thread tab', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setActiveTab(null));
        store.dispatch(setActiveTab('thread-100'));
        expect(store.getState().message.activeTab).toBe('thread-100');
      });
    });

    describe('setThreadMessages', () => {
      it('should set messages and filteredMessages for a thread tab', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.messages).toEqual(threadMessages);
        expect(tab.filteredMessages).toEqual(threadMessages);
      });

      it('should no-op for non-existent thread', () => {
        store.dispatch(setThreadMessages({ threadId: 'nonexistent', messages: threadMessages }));
        expect(store.getState().message.threadTabs['nonexistent']).toBeUndefined();
      });
    });

    describe('setThreadFilteredMessages', () => {
      it('should set filtered messages independently from messages', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
        const filtered = [threadMessages[0]];
        store.dispatch(setThreadFilteredMessages({ threadId: 'thread-100', messages: filtered }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.messages).toEqual(threadMessages);
        expect(tab.filteredMessages).toEqual(filtered);
      });
    });

    describe('thread message selection', () => {
      beforeEach(() => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
      });

      it('should toggle message selection on', () => {
        store.dispatch(toggleThreadMessageSelection({ threadId: 'thread-100', message: threadMessages[0] }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.selectedMessages).toHaveLength(1);
        expect(tab.selectedMessages[0].id).toBe(threadMessages[0].id);
      });

      it('should toggle message selection off', () => {
        store.dispatch(toggleThreadMessageSelection({ threadId: 'thread-100', message: threadMessages[0] }));
        store.dispatch(toggleThreadMessageSelection({ threadId: 'thread-100', message: threadMessages[0] }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.selectedMessages).toHaveLength(0);
      });

      it('should select all messages', () => {
        store.dispatch(selectAllThreadMessages('thread-100'));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.selectedMessages).toHaveLength(3);
      });

      it('should deselect all messages', () => {
        store.dispatch(selectAllThreadMessages('thread-100'));
        store.dispatch(deselectAllThreadMessages('thread-100'));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.selectedMessages).toHaveLength(0);
      });
    });

    describe('setThreadOrder', () => {
      it('should update order for a thread tab', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        const newOrder = { order: SortDirection.ASCENDING, orderBy: 'timestamp' as keyof Message };
        store.dispatch(setThreadOrder({ threadId: 'thread-100', order: newOrder }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.order.order).toBe(SortDirection.ASCENDING);
      });
    });

    describe('setThreadSearchCriteria', () => {
      it('should set search criteria for a thread tab', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        const criteria = { searchContent: 'test' } as any;
        store.dispatch(setThreadSearchCriteria({ threadId: 'thread-100', criteria }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.searchCriteria).toEqual(criteria);
      });

      it('should clear search criteria with null', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadSearchCriteria({ threadId: 'thread-100', criteria: { searchContent: 'test' } as any }));
        store.dispatch(setThreadSearchCriteria({ threadId: 'thread-100', criteria: null }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.searchCriteria).toBeNull();
      });
    });

    describe('setThreadLoading and setThreadError', () => {
      it('should set loading state', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadLoading({ threadId: 'thread-100', isLoading: false }));
        expect(store.getState().message.threadTabs['thread-100'].isLoading).toBe(false);
      });

      it('should set error state', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(setThreadError({ threadId: 'thread-100', error: 'Something went wrong' }));
        expect(store.getState().message.threadTabs['thread-100'].error).toBe('Something went wrong');
      });
    });

    describe('updateThreadPagination', () => {
      it('should partially update pagination', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(updateThreadPagination({
          threadId: 'thread-100',
          pagination: { hasMore: false, lastMessageId: 'last-1' },
        }));
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.pagination.hasMore).toBe(false);
        expect(tab.pagination.lastMessageId).toBe('last-1');
        expect(tab.pagination.mode).toBe('paginated'); // unchanged
      });
    });

    describe('clearMessages clears thread tabs', () => {
      it('should clear all thread tabs and activeTab', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
        store.dispatch(addThreadTab({ threadId: 'thread-200', threadName: 'Thread 2' }));
        store.dispatch(clearMessages());
        const state = store.getState().message;
        expect(state.threadTabs).toEqual({});
        expect(state.activeTab).toBeNull();
      });
    });
  });

  describe('Active-tab-aware selectors', () => {
    const mainMessages = createMockMessages(2);
    const threadMessages = [
      createMockMessage({ id: 'thread-msg-1', content: 'Thread message 1', channel_id: 'thread-100' }),
      createMockMessage({ id: 'thread-msg-2', content: 'Thread message 2', channel_id: 'thread-100' }),
    ];

    beforeEach(() => {
      store.dispatch(setMessages(mainMessages));
      store.dispatch(setFilteredMessages(mainMessages));
    });

    it('should return main tab data when activeTab is null', () => {
      const state = store.getState();
      expect(selectActiveMessages(state)).toEqual(mainMessages);
      expect(selectActiveFilteredMessages(state)).toEqual(mainMessages);
      expect(selectActiveSelectedMessages(state)).toEqual([]);
      expect(selectActiveSearchCriteria(state)).toBeNull();
      expect(selectActiveOrder(state)).toEqual(state.message.order);
      expect(selectActiveLoading(state)).toBe(false);
      expect(selectActiveError(state)).toBeNull();
      expect(selectActivePagination(state)).toEqual(state.message.pagination);
    });

    it('should return thread tab data when a thread tab is active', () => {
      store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
      store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
      store.dispatch(setThreadLoading({ threadId: 'thread-100', isLoading: false }));

      const state = store.getState();
      expect(selectActiveTab(state)).toBe('thread-100');
      expect(selectActiveMessages(state)).toEqual(threadMessages);
      expect(selectActiveFilteredMessages(state)).toEqual(threadMessages);
      expect(selectActiveSelectedMessages(state)).toEqual([]);
      expect(selectActiveLoading(state)).toBe(false);
    });

    it('should switch between main and thread tab data', () => {
      store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
      store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));

      // Active tab is thread
      expect(selectActiveMessages(store.getState())).toEqual(threadMessages);

      // Switch to main
      store.dispatch(setActiveTab(null));
      expect(selectActiveMessages(store.getState())).toEqual(mainMessages);

      // Switch back to thread
      store.dispatch(setActiveTab('thread-100'));
      expect(selectActiveMessages(store.getState())).toEqual(threadMessages);
    });

    it('should return main tab data if activeTab points to non-existent thread', () => {
      store.dispatch(setActiveTab('nonexistent'));
      const state = store.getState();
      expect(selectActiveMessages(state)).toEqual(mainMessages);
      expect(selectActiveFilteredMessages(state)).toEqual(mainMessages);
    });

    // #190 Phase 3: reference-stability regression guards. The selector
    // must return the SAME array reference across dispatches that don't
    // touch filteredMessages — otherwise every MessageFeed re-renders
    // when an unrelated state change (status-log append, progress tick,
    // settings update) fires. Pinned so a future refactor that introduces
    // derived work (a .map(), a filter(), a new Array spread) breaks
    // visibly here instead of silently regressing scroll perf.
    it('selectActiveFilteredMessages returns the same reference across unrelated state changes (main tab)', () => {
      const before = selectActiveFilteredMessages(store.getState());
      // Trigger an unrelated state change — settings update doesn't touch
      // state.message.filteredMessages.
      store.dispatch({ type: 'app/updateSetting/fulfilled', payload: {} as any });
      const after = selectActiveFilteredMessages(store.getState());
      expect(after).toBe(before);
    });

    it('selectActiveFilteredMessages returns the same reference across unrelated state changes (thread tab)', () => {
      store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
      store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
      const before = selectActiveFilteredMessages(store.getState());
      store.dispatch({ type: 'app/updateSetting/fulfilled', payload: {} as any });
      const after = selectActiveFilteredMessages(store.getState());
      expect(after).toBe(before);
    });

    it('selectActiveFilteredMessages returns a NEW reference when filteredMessages actually changes', () => {
      const before = selectActiveFilteredMessages(store.getState());
      store.dispatch(setFilteredMessages([...mainMessages, createMockMessage({ id: 'new-1' })]));
      const after = selectActiveFilteredMessages(store.getState());
      expect(after).not.toBe(before);
    });

    it('selectActiveFilteredMessages returns the same reference when activeTab toggles between equivalent main states', () => {
      // Set active tab to a nonexistent thread (falls back to main),
      // then back to null (still main). Both states should return the
      // same main filteredMessages reference.
      const beforeMain = selectActiveFilteredMessages(store.getState());
      store.dispatch(setActiveTab('nonexistent'));
      const afterToggle = selectActiveFilteredMessages(store.getState());
      store.dispatch(setActiveTab(null));
      const backToMain = selectActiveFilteredMessages(store.getState());
      expect(afterToggle).toBe(beforeMain);
      expect(backToMain).toBe(beforeMain);
    });

    it('selectThreadTabs returns all thread tabs', () => {
      store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'Thread 1' }));
      store.dispatch(addThreadTab({ threadId: 'thread-200', threadName: 'Thread 2' }));
      const tabs = selectThreadTabs(store.getState());
      expect(Object.keys(tabs)).toEqual(['thread-100', 'thread-200']);
    });

    it('selectThreadTab returns a specific tab or null', () => {
      store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'Thread 1' }));
      expect(selectThreadTab(store.getState(), 'thread-100')).toBeDefined();
      expect(selectThreadTab(store.getState(), 'nonexistent')).toBeNull();
    });
  });

  describe('Thread tab state isolation', () => {
    const mainMessages = createMockMessages(3);
    const threadMessages = [
      createMockMessage({ id: 'thread-msg-1', content: 'Thread 1', channel_id: 'thread-100' }),
      createMockMessage({ id: 'thread-msg-2', content: 'Thread 2', channel_id: 'thread-100' }),
    ];

    beforeEach(() => {
      store.dispatch(setMessages(mainMessages));
      store.dispatch(setFilteredMessages(mainMessages));
      store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'My Thread' }));
      store.dispatch(setThreadMessages({ threadId: 'thread-100', messages: threadMessages }));
    });

    it('should not affect thread filteredMessages when main filter changes', () => {
      const singleMsg = [mainMessages[0]];
      store.dispatch(setFilteredMessages(singleMsg));

      const state = store.getState().message;
      expect(state.filteredMessages).toEqual(singleMsg);
      expect(state.threadTabs['thread-100'].filteredMessages).toEqual(threadMessages);
    });

    it('should not leak thread searchCriteria to main', () => {
      const criteria = { searchContent: 'thread-only' } as any;
      store.dispatch(setThreadSearchCriteria({ threadId: 'thread-100', criteria }));

      const state = store.getState().message;
      expect(state.threadTabs['thread-100'].searchCriteria).toEqual(criteria);
      expect(state.searchCriteria).toBeNull();
    });

    it('should preserve thread filter state after switching tabs', () => {
      const filtered = [threadMessages[0]];
      store.dispatch(setThreadFilteredMessages({ threadId: 'thread-100', messages: filtered }));

      // Switch away to main
      store.dispatch(setActiveTab(null));
      expect(selectActiveFilteredMessages(store.getState())).toEqual(mainMessages);

      // Switch back to thread — filtered subset should still be preserved
      store.dispatch(setActiveTab('thread-100'));
      expect(selectActiveFilteredMessages(store.getState())).toEqual(filtered);
    });
  });

  describe('Thread tab async thunks', () => {
    const threadMsgs = createMockMessages(3);

    describe('openThreadTab', () => {
      it('should create tab, fetch messages, and populate state', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: threadMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const result = await store.dispatch(
          openThreadTab({ threadId: 'thread-100', threadName: 'My Thread', token: 'token' })
        );

        expect(result.type).toBe('message/openThreadTab/fulfilled');
        expect(result.payload).toEqual({ threadId: 'thread-100', alreadyOpen: false });

        const state = store.getState().message;
        expect(state.activeTab).toBe('thread-100');
        expect(state.threadTabs['thread-100'].messages).toHaveLength(3);
        expect(state.threadTabs['thread-100'].isLoading).toBe(false);
        expect(state.threadTabs['thread-100'].pagination.hasMore).toBe(false); // <100 messages
        expect(mockDiscordService.fetchMessageData).toHaveBeenCalledWith('token', '', 'thread-100');
      });

      it('should just switch tab if already open', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: threadMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        // Open it once
        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'My Thread', token: 'token' }));
        store.dispatch(setActiveTab(null));

        // Open again — should not re-fetch
        mockDiscordService.fetchMessageData.mockClear();
        const result = await store.dispatch(
          openThreadTab({ threadId: 'thread-100', threadName: 'My Thread', token: 'token' })
        );

        expect(result.payload).toEqual({ threadId: 'thread-100', alreadyOpen: true });
        expect(mockDiscordService.fetchMessageData).not.toHaveBeenCalled();
        expect(store.getState().message.activeTab).toBe('thread-100');
      });

      it('should set hasMore=true when 100 messages returned', async () => {
        const hundredMsgs = createMockMessages(100);
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: hundredMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'Thread', token: 'token' }));

        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.pagination.hasMore).toBe(true);
        expect(tab.messages).toHaveLength(100);
      });

      it('should remove tab on fetch failure and return to main tab', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: false }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const result = await store.dispatch(
          openThreadTab({ threadId: 'thread-100', threadName: 'Thread', token: 'token' })
        );

        expect(result.type).toBe('message/openThreadTab/rejected');
        // Tab should be removed (not left in error state)
        expect(store.getState().message.threadTabs['thread-100']).toBeUndefined();
        // Active tab should be reset to main
        expect(store.getState().message.activeTab).toBeNull();
      });

      it('should remove tab on network error and return to main tab', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockRejectedValue(new Error('Network error')),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const result = await store.dispatch(
          openThreadTab({ threadId: 'thread-200', threadName: 'Thread', token: 'token' })
        );

        expect(result.type).toBe('message/openThreadTab/rejected');
        expect(store.getState().message.threadTabs['thread-200']).toBeUndefined();
        expect(store.getState().message.activeTab).toBeNull();
      });

      it('should dispatch status entry on successful thread load', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: threadMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        vi.mocked(addStatusEntry).mockClear();

        await store.dispatch(
          openThreadTab({ threadId: 'thread-300', threadName: 'My Thread', token: 'token' })
        );

        expect(vi.mocked(addStatusEntry)).toHaveBeenCalledWith({
          level: 'info',
          message: `Thread loaded: ${threadMsgs.length} messages`,
        });
      });

      it('should not dispatch status entry when switching to existing tab', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: threadMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(openThreadTab({ threadId: 'thread-400', threadName: 'Thread', token: 'token' }));
        store.dispatch(setActiveTab(null));
        vi.mocked(addStatusEntry).mockClear();

        await store.dispatch(openThreadTab({ threadId: 'thread-400', threadName: 'Thread', token: 'token' }));

        const threadLoadCalls = vi.mocked(addStatusEntry).mock.calls.filter(
          ([payload]) => payload.message.includes('Thread loaded')
        );
        expect(threadLoadCalls).toHaveLength(0);
      });
    });

    describe('fetchMoreThreadMessages', () => {
      it('should append messages to existing thread tab', async () => {
        const initialMsgs = createMockMessages(2);
        const moreMsgs = [
          createMockMessage({ id: 'more-1', content: 'More 1' }),
          createMockMessage({ id: 'more-2', content: 'More 2' }),
        ];

        const mockDiscordService = {
          fetchMessageData: vi.fn()
            .mockResolvedValueOnce({ success: true, data: initialMsgs })
            .mockResolvedValueOnce({ success: true, data: moreMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'Thread', token: 'token' }));

        const result = await store.dispatch(
          fetchMoreThreadMessages({ threadId: 'thread-100', token: 'token', lastMessageId: 'msg-2' })
        );

        expect(result.type).toBe('message/fetchMoreThreadMessages/fulfilled');
        const tab = store.getState().message.threadTabs['thread-100'];
        expect(tab.messages).toHaveLength(4);
        expect(tab.pagination.isLoadingMore).toBe(false);
      });

      it('should handle fetch failure', async () => {
        // First set up a tab
        const mockDiscordService = {
          fetchMessageData: vi.fn()
            .mockResolvedValueOnce({ success: true, data: createMockMessages(2) })
            .mockResolvedValueOnce({ success: false }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'Thread', token: 'token' }));

        const result = await store.dispatch(
          fetchMoreThreadMessages({ threadId: 'thread-100', token: 'token', lastMessageId: 'msg-2' })
        );

        expect(result.type).toBe('message/fetchMoreThreadMessages/rejected');
        expect(store.getState().message.threadTabs['thread-100'].pagination.isLoadingMore).toBe(false);
      });

      it('should dispatch status entry with message count on success', async () => {
        const initialMsgs = createMockMessages(2);
        const moreMsgs = [
          createMockMessage({ id: 'more-a', content: 'More A' }),
          createMockMessage({ id: 'more-b', content: 'More B' }),
          createMockMessage({ id: 'more-c', content: 'More C' }),
        ];

        const mockDiscordService = {
          fetchMessageData: vi.fn()
            .mockResolvedValueOnce({ success: true, data: initialMsgs })
            .mockResolvedValueOnce({ success: true, data: moreMsgs }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'Thread', token: 'token' }));
        vi.mocked(addStatusEntry).mockClear();

        await store.dispatch(
          fetchMoreThreadMessages({ threadId: 'thread-100', token: 'token', lastMessageId: 'msg-2' })
        );

        expect(vi.mocked(addStatusEntry)).toHaveBeenCalledWith({
          level: 'info',
          message: 'Loaded 3 more messages',
        });
      });
    });

    describe('fetchAllThreadMessages', () => {
      it('should fetch all messages across multiple batches', async () => {
        const batch1 = createMockMessages(100);
        const batch2 = createMockMessages(50).map((m, i) =>
          createMockMessage({ ...m, id: `batch2-msg-${i + 1}` })
        );

        const mockDiscordService = {
          fetchMessageData: vi.fn()
            .mockResolvedValueOnce({ success: true, data: batch1 })
            .mockResolvedValueOnce({ success: true, data: batch2 }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        // Set up a store with an existing thread tab
        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const result = await testStore.dispatch(
          fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' })
        );

        expect(result.type).toBe('message/fetchAllThreadMessages/fulfilled');
        const tab = testStore.getState().message.threadTabs['thread-100'];
        expect(tab.messages).toHaveLength(150);
        expect(tab.pagination.hasMore).toBe(false);
        expect(tab.pagination.isLoadingAll).toBe(false);
        expect(tab.pagination.loadAllProgress).toBeNull();
      });

      it('should dispatch starting and completion status entries on success', async () => {
        const batch = createMockMessages(50);
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: batch }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        await testStore.dispatch(
          fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' })
        );

        const startCalls = vi.mocked(addStatusEntry).mock.calls.filter(
          ([payload]) => payload.message === 'Load All: Starting...'
        );
        expect(startCalls).toHaveLength(1);

        const successCalls = vi.mocked(addStatusEntry).mock.calls.filter(
          ([payload]) => payload.level === 'success'
        );
        expect(successCalls).toHaveLength(1);
        expect(successCalls[0][0].message).toBe('Load All complete: 50 messages');
      });
    });

    describe('searchThreadMessages', () => {
      it('should search and populate thread tab with results', async () => {
        const searchResults = createMockMessages(2);
        const mockDiscordService = {
          fetchSearchMessageData: vi.fn().mockResolvedValue({
            success: true,
            data: {
              messages: [searchResults],
              total_results: 2,
            },
          }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        // Set up a store with an existing thread tab
        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const result = await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-100',
            token: 'token',
            searchCriteria: { searchContent: 'test' } as any,
          })
        );

        expect(result.type).toBe('message/searchThreadMessages/fulfilled');
        const tab = testStore.getState().message.threadTabs['thread-100'];
        expect(tab.messages).toHaveLength(2);
        expect(tab.isLoading).toBe(false);
        expect(tab.pagination.mode).toBe('search');
        expect(tab.pagination.hasMore).toBe(false);
      });

      // #264: Discord's search returns spuriously short pages mid-stream
      // (index lag). The thread walk used to stop on any page under 25 and
      // then advanced the offset by a fixed 25, so a short page ended the
      // search early and skipped results. Now it keeps paging until
      // total_results is reached and advances by what came back.
      it('keeps paging after a short page and advances the offset by the page size (#264)', async () => {
        const page1 = createMockMessages(20);
        const page2 = createMockMessages(20).map((m, i) => createMockMessage({ ...m, id: `p2-${i}` }));
        const fetchSearchMessageData = vi.fn()
          .mockResolvedValueOnce({ success: true, status: 200, data: { messages: [page1], total_results: 40 } })
          .mockResolvedValueOnce({ success: true, status: 200, data: { messages: [page2], total_results: 40 } });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const result = await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-100',
            token: 'token',
            searchCriteria: { userIds: ['u1'] } as any,
          })
        );

        expect(result.type).toBe('message/searchThreadMessages/fulfilled');
        expect(fetchSearchMessageData).toHaveBeenCalledTimes(2);
        // Second page starts where the short first page ended, not at 25.
        expect(fetchSearchMessageData.mock.calls[1][1]).toBe(20);
        expect(testStore.getState().message.threadTabs['thread-100'].messages).toHaveLength(40);
      });

      it('stops at total_results even when the last page is short (#264)', async () => {
        const fetchSearchMessageData = vi.fn()
          .mockResolvedValueOnce({ success: true, status: 200, data: { messages: [createMockMessages(25)], total_results: 30 } })
          .mockResolvedValueOnce({
            success: true,
            status: 200,
            data: { messages: [createMockMessages(5).map((m, i) => createMockMessage({ ...m, id: `p2-${i}` }))], total_results: 30 },
          });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        await testStore.dispatch(
          searchThreadMessages({ threadId: 'thread-100', token: 'token', searchCriteria: {} as any })
        );

        expect(fetchSearchMessageData).toHaveBeenCalledTimes(2);
        expect(testStore.getState().message.threadTabs['thread-100'].messages).toHaveLength(30);
      });

      it('should dispatch starting and completion status entries on success', async () => {
        const searchResults = createMockMessages(4);
        const mockDiscordService = {
          fetchSearchMessageData: vi.fn().mockResolvedValue({
            success: true,
            data: {
              messages: [searchResults],
              total_results: 4,
            },
          }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-100',
            token: 'token',
            searchCriteria: { searchContent: 'test' } as any,
          })
        );

        const startCalls = vi.mocked(addStatusEntry).mock.calls.filter(
          ([payload]) => payload.message === 'Search: Starting...'
        );
        expect(startCalls).toHaveLength(1);

        const successCalls = vi.mocked(addStatusEntry).mock.calls.filter(
          ([payload]) => payload.level === 'success'
        );
        expect(successCalls).toHaveLength(1);
        expect(successCalls[0][0].message).toBe('Search complete: 4 results found');
      });

      // #262: thread search used to treat a 202 (Discord still indexing)
      // as a failure and never said what Discord answered.
      const threadTabState = () => ({
        ...initialMessageState,
        activeTab: 'thread-100',
        threadTabs: {
          'thread-100': {
            threadId: 'thread-100',
            threadName: 'Thread',
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null, refineCriteria: null,
            order: initialMessageState.order,
            isLoading: false,
            error: null,
            pagination: { ...initialMessageState.pagination },
          },
        },
      });

      it('waits out a 202 and fills the tab from the page that follows (#262)', async () => {
        const searchResults = createMockMessages(3);
        const fetchSearchMessageData = vi.fn()
          .mockResolvedValueOnce({ success: true, status: 202 })
          .mockResolvedValueOnce({
            success: true,
            status: 200,
            data: { messages: [searchResults], total_results: 3 },
          });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp(threadTabState());
        const result = await testStore.dispatch(
          searchThreadMessages({ threadId: 'thread-100', token: 'token', searchCriteria: {} as any })
        );

        expect(result.type).toBe('message/searchThreadMessages/fulfilled');
        expect(fetchSearchMessageData).toHaveBeenCalledTimes(2);
        expect(testStore.getState().message.threadTabs['thread-100'].messages).toHaveLength(3);
        const waits = vi.mocked(addStatusEntry).mock.calls.filter(
          ([entry]) => entry.level === 'warning' && /still indexing, retrying in 1s \(attempt 1\/5\)/.test(entry.message)
        );
        expect(waits).toHaveLength(1);
      }, 10000);

      it('rejects with the HTTP status when Discord refuses the thread search (#262)', async () => {
        const fetchSearchMessageData = vi.fn().mockResolvedValue({ success: false, status: 403 });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

        const testStore = await createStoreWithApp(threadTabState());
        const result = await testStore.dispatch(
          searchThreadMessages({ threadId: 'thread-100', token: 'token', searchCriteria: {} as any })
        );

        expect(result.type).toBe('message/searchThreadMessages/rejected');
        expect(result.payload).toBe('Failed to search thread messages (HTTP 403)');
        expect(fetchSearchMessageData).toHaveBeenCalledTimes(1);
        const tab = testStore.getState().message.threadTabs['thread-100'];
        expect(tab.isLoading).toBe(false);
        expect(tab.pagination.loadAllProgress).toBeNull();
      });

      it('retries a transient 503 on the thread search and completes (#262)', async () => {
        const searchResults = createMockMessages(1);
        const fetchSearchMessageData = vi.fn()
          .mockResolvedValueOnce({ success: false, status: 503 })
          .mockResolvedValueOnce({
            success: true,
            status: 200,
            data: { messages: [searchResults], total_results: 1 },
          });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp(threadTabState());
        const result = await testStore.dispatch(
          searchThreadMessages({ threadId: 'thread-100', token: 'token', searchCriteria: {} as any })
        );

        expect(result.type).toBe('message/searchThreadMessages/fulfilled');
        expect(fetchSearchMessageData).toHaveBeenCalledTimes(2);
        const retries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([entry]) => entry.level === 'warning' && /^Search: connection failed, retrying in 1s \(attempt 1\/5\)/.test(entry.message)
        );
        expect(retries).toHaveLength(1);
      }, 10000);

      it('says when the request never got an answer, after the online quick retries (#262)', async () => {
        // No status = the fetch threw. Online, that gets ONLINE_NETWORK_RETRIES
        // quick retries (1s, 2s) and then counts as permanent.
        const fetchSearchMessageData = vi.fn().mockResolvedValue({ success: false });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchSearchMessageData } as any);

        const testStore = await createStoreWithApp(threadTabState());
        const result = await testStore.dispatch(
          searchThreadMessages({ threadId: 'thread-100', token: 'token', searchCriteria: {} as any })
        );

        expect(result.type).toBe('message/searchThreadMessages/rejected');
        expect(result.payload).toMatch(/^Failed to search thread messages\. Discord did not answer/);
        expect(fetchSearchMessageData).toHaveBeenCalledTimes(3);
      }, 15000);
    });
  });

  describe('operations on thread tabs (Phase 7)', () => {
    const threadMessages = [
      createMockMessage({ id: 'tmsg-1', content: 'thread msg 1' }),
      createMockMessage({ id: 'tmsg-2', content: 'thread msg 2' }),
      createMockMessage({ id: 'tmsg-3', content: 'thread msg 3' }),
    ];
    const mainMessages = [
      createMockMessage({ id: 'main-1', content: 'main msg 1' }),
      createMockMessage({ id: 'main-2', content: 'main msg 2' }),
    ];

    const setupThreadTabStore = () => {
      // Set up main messages
      store.dispatch(setMessages(mainMessages));
      store.dispatch(setFilteredMessages(mainMessages));
      // Set up thread tab with messages
      store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
      store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: threadMessages }));
      store.dispatch(setActiveTab('thread-1'));
      return store;
    };

    describe('deleteMessage on active thread tab', () => {
      it('should remove message from thread tab arrays, not main arrays', async () => {
        const testStore = setupThreadTabStore();
        const mockDiscordService = {
          deleteMessage: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await testStore.dispatch(deleteMessage({ messageId: 'tmsg-1', channelId: 'thread-1', token: 'token' }));

        const state = testStore.getState().message;
        // Thread tab should have message removed
        expect(state.threadTabs['thread-1'].messages).toHaveLength(2);
        expect(state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1')).toBeUndefined();
        expect(state.threadTabs['thread-1'].filteredMessages).toHaveLength(2);
        // Main messages should be untouched
        expect(state.messages).toHaveLength(2);
        expect(state.messages[0].id).toBe('main-1');
      });
    });

    describe('deleteMessages on active thread tab', () => {
      it('should clear selected messages on thread tab after bulk delete', async () => {
        const mockDiscordService = {
          deleteMessage: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          messages: mainMessages,
          filteredMessages: mainMessages,
          activeTab: 'thread-1',
          threadTabs: {
            'thread-1': {
              threadId: 'thread-1',
              threadName: 'Test Thread',
              messages: threadMessages,
              filteredMessages: threadMessages,
              selectedMessages: [threadMessages[0]],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        await testStore.dispatch(
          deleteMessages({ messages: [threadMessages[0]], channelId: 'thread-1', token: 'token' })
        );

        const state = testStore.getState().message;
        // Thread tab selected messages should be cleared
        expect(state.threadTabs['thread-1'].selectedMessages).toHaveLength(0);
        // Thread tab messages should have the deleted one removed (via deleteMessage.fulfilled)
        expect(state.threadTabs['thread-1'].messages).toHaveLength(2);
        // Main messages should be untouched
        expect(state.messages).toEqual(mainMessages);
      });
    });

    describe('editMessage on active thread tab', () => {
      it('should update message in thread tab arrays, not main arrays', async () => {
        const testStore = setupThreadTabStore();
        const editedMsg = createMockMessage({ id: 'tmsg-2', content: 'edited content' });
        const mockDiscordService = {
          editMessage: vi.fn().mockResolvedValue({ success: true, data: editedMsg }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await testStore.dispatch(
          editMessage({ messageId: 'tmsg-2', channelId: 'thread-1', content: 'edited content', token: 'token' })
        );

        const state = testStore.getState().message;
        // Thread tab should have updated message
        expect(state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-2')?.content).toBe('edited content');
        expect(state.threadTabs['thread-1'].filteredMessages.find((m: Message) => m.id === 'tmsg-2')?.content).toBe('edited content');
        // Main messages should be untouched
        expect(state.messages).toHaveLength(2);
        expect(state.messages.find((m: Message) => m.id === 'tmsg-2')).toBeUndefined();
      });
    });

    describe('editMessages on active thread tab', () => {
      it('should update messages in thread tab and clear thread tab selections', async () => {
        const testStore = await createStoreWithApp({
          ...initialMessageState,
          messages: mainMessages,
          filteredMessages: mainMessages,
          activeTab: 'thread-1',
          threadTabs: {
            'thread-1': {
              threadId: 'thread-1',
              threadName: 'Test Thread',
              messages: threadMessages,
              filteredMessages: threadMessages,
              selectedMessages: [threadMessages[0], threadMessages[1]],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const editedMsg1 = createMockMessage({ id: 'tmsg-1', content: 'bulk edited' });
        const editedMsg2 = createMockMessage({ id: 'tmsg-2', content: 'bulk edited' });
        const mockDiscordService = {
          editMessage: vi.fn()
            .mockResolvedValueOnce({ success: true, data: editedMsg1 })
            .mockResolvedValueOnce({ success: true, data: editedMsg2 }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await testStore.dispatch(
          editMessages({
            messages: [threadMessages[0], threadMessages[1]],
            channelId: 'thread-1',
            content: 'bulk edited',
            token: 'token',
          })
        );

        const state = testStore.getState().message;
        expect(state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1')?.content).toBe('bulk edited');
        expect(state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-2')?.content).toBe('bulk edited');
        expect(state.threadTabs['thread-1'].selectedMessages).toHaveLength(0);
        // Main messages untouched
        expect(state.messages).toEqual(mainMessages);
      });
    });

    describe('deleteReaction on active thread tab', () => {
      it('should decrement reaction count in thread tab messages', async () => {
        const reaction = createMockReaction({ emoji: { name: '👍', id: null as any }, count: 2 });
        const msgWithReaction = createMockMessage({ id: 'tmsg-1', reactions: [reaction] });
        store.dispatch(setMessages(mainMessages));
        store.dispatch(setFilteredMessages(mainMessages));
        store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [msgWithReaction, threadMessages[1]] }));
        store.dispatch(setActiveTab('thread-1'));

        const mockDiscordService = {
          deleteReaction: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(
          deleteReaction({ channelId: 'thread-1', messageId: 'tmsg-1', emoji: '👍', userId: 'user-1', token: 'token' })
        );

        const state = store.getState().message;
        const threadMsg = state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1');
        expect(threadMsg?.reactions?.[0].count).toBe(1);
        // Main messages untouched
        expect(state.messages).toEqual(mainMessages);
      });
    });

    describe('deleteAllReactions on active thread tab', () => {
      it('should remove emoji reactions from thread tab messages', async () => {
        const reaction = createMockReaction({ emoji: { name: '👍', id: null as any }, count: 3 });
        const msgWithReaction = createMockMessage({ id: 'tmsg-1', reactions: [reaction] });

        const mockDiscordService = {
          deleteReaction: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          messages: mainMessages,
          filteredMessages: mainMessages,
          activeTab: 'thread-1',
          threadTabs: {
            'thread-1': {
              threadId: 'thread-1',
              threadName: 'Test Thread',
              messages: [msgWithReaction],
              filteredMessages: [msgWithReaction],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        await testStore.dispatch(
          deleteAllReactions({ channelId: 'thread-1', messageId: 'tmsg-1', emoji: '👍', userIds: ['u1', 'u2', 'u3'], token: 'token' })
        );

        const state = testStore.getState().message;
        const threadMsg = state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1');
        expect(threadMsg?.reactions).toHaveLength(0);
        // Main messages untouched
        expect(state.messages).toEqual(mainMessages);
      });
    });

    describe('deleteAttachment on active thread tab', () => {
      it('should update message in thread tab when attachment is removed', async () => {
        const attachment = createMockAttachment({ id: 'att-1' });
        const msgWithAttachment = createMockMessage({ id: 'tmsg-1', content: 'has content', attachments: [attachment] });
        const updatedMsg = createMockMessage({ id: 'tmsg-1', content: 'has content', attachments: [] });

        store.dispatch(setMessages(mainMessages));
        store.dispatch(setFilteredMessages(mainMessages));
        store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [msgWithAttachment, threadMessages[1]] }));
        store.dispatch(setActiveTab('thread-1'));

        const mockDiscordService = {
          editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(
          deleteAttachment({ message: msgWithAttachment, attachment, channelId: 'thread-1', token: 'token' })
        );

        const state = store.getState().message;
        const threadMsg = state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1');
        expect(threadMsg?.attachments).toHaveLength(0);
        // Main messages untouched
        expect(state.messages).toEqual(mainMessages);
      });

      it('should delete message from thread tab when last attachment removed with no content', async () => {
        const attachment = createMockAttachment({ id: 'att-1' });
        const msgWithAttachment = createMockMessage({ id: 'tmsg-1', content: '', attachments: [attachment] });

        store.dispatch(setMessages(mainMessages));
        store.dispatch(setFilteredMessages(mainMessages));
        store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [msgWithAttachment, threadMessages[1]] }));
        store.dispatch(setActiveTab('thread-1'));

        const mockDiscordService = {
          deleteMessage: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(
          deleteAttachment({ message: msgWithAttachment, attachment, channelId: 'thread-1', token: 'token' })
        );

        const state = store.getState().message;
        expect(state.threadTabs['thread-1'].messages).toHaveLength(1);
        expect(state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1')).toBeUndefined();
        // Main messages untouched
        expect(state.messages).toEqual(mainMessages);
      });
    });

    describe('deleteAllAttachments on active thread tab', () => {
      it('should update message in thread tab when all attachments removed', async () => {
        const att1 = createMockAttachment({ id: 'att-1' });
        const att2 = createMockAttachment({ id: 'att-2' });
        const msgWithAttachments = createMockMessage({ id: 'tmsg-1', content: 'has content', attachments: [att1, att2] });
        const updatedMsg = createMockMessage({ id: 'tmsg-1', content: 'has content', attachments: [] });

        store.dispatch(setMessages(mainMessages));
        store.dispatch(setFilteredMessages(mainMessages));
        store.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'Test Thread' }));
        store.dispatch(setThreadMessages({ threadId: 'thread-1', messages: [msgWithAttachments] }));
        store.dispatch(setActiveTab('thread-1'));

        const mockDiscordService = {
          editMessage: vi.fn().mockResolvedValue({ success: true, data: updatedMsg }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await store.dispatch(
          deleteAllAttachments({ message: msgWithAttachments, channelId: 'thread-1', token: 'token' })
        );

        const state = store.getState().message;
        const threadMsg = state.threadTabs['thread-1'].messages.find((m: Message) => m.id === 'tmsg-1');
        expect(threadMsg?.attachments).toHaveLength(0);
        // Main messages untouched
        expect(state.messages).toEqual(mainMessages);
      });
    });

    describe('Thread thunk cancellation and edge cases', () => {
      it('should handle fetchAllThreadMessages failure gracefully', async () => {
        // A permanent 4xx: rejects without retry (transient failures are
        // covered by the #245 cases below).
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: false, status: 403 }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const result = await testStore.dispatch(
          fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' })
        );

        expect(result.type).toBe('message/fetchAllThreadMessages/rejected');

        const tab = testStore.getState().message.threadTabs['thread-100'];
        expect(tab.pagination.isLoadingAll).toBe(false);
        expect(tab.pagination.loadAllProgress).toBeNull();
      });

      const threadTabState = () => ({
        ...initialMessageState,
        activeTab: 'thread-100',
        threadTabs: {
          'thread-100': {
            threadId: 'thread-100',
            threadName: 'Thread',
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null, refineCriteria: null,
            order: initialMessageState.order,
            isLoading: false,
            error: null,
            pagination: { ...initialMessageState.pagination },
          },
        },
      });

      it('#245: retries transient failures then completes the thread Load All', async () => {
        setOnline(false);
        const batch = createMockMessages(10);
        const fetchSpy = vi.fn()
          .mockResolvedValueOnce({ success: false, status: undefined })
          .mockResolvedValueOnce({ success: false, status: 503 })
          .mockResolvedValueOnce({ success: true, data: batch });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchMessageData: fetchSpy } as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp(threadTabState());
        const result = await testStore.dispatch(
          fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' })
        );

        expect(result.type).toBe('message/fetchAllThreadMessages/fulfilled');
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(testStore.getState().message.threadTabs['thread-100'].messages).toHaveLength(10);
        const retryEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /retrying in/.test(p.message),
        );
        expect(retryEntries).toHaveLength(2);
        expect(testStore.getState().app.discrubPaused).toBe(false);
      });

      it('#266: the thread Load All retry line says what Discord answered', async () => {
        setOnline(false);
        const batch = createMockMessages(3);
        const fetchSpy = vi.fn()
          .mockResolvedValueOnce({ success: false, status: 503 })
          .mockResolvedValueOnce({ success: false, status: undefined })
          .mockResolvedValueOnce({ success: true, data: batch });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchMessageData: fetchSpy } as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp(threadTabState());
        await testStore.dispatch(fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' }));

        const lines = vi.mocked(addStatusEntry).mock.calls
          .map(([p]) => p.message)
          .filter((m) => /retrying in/.test(m));
        expect(lines).toEqual([
          'Load All: Discord answered HTTP 503, retrying in 1s (attempt 1/5)',
          'Load All: Discord did not answer, retrying in 1s (attempt 2/5)',
        ]);
      });

      it('#266: a refused thread Load All rejects with the HTTP status', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({ success: false, status: 403 });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchMessageData: fetchSpy } as any);

        const testStore = await createStoreWithApp(threadTabState());
        const result = await testStore.dispatch(fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' }));

        expect(result.type).toBe('message/fetchAllThreadMessages/rejected');
        expect(result.payload).toBe('Failed to fetch all thread messages (HTTP 403)');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it('#245: pauses the thread Load All after retries are exhausted, preserves partial progress', async () => {
        setOnline(false);
        const { waitWhilePaused, checkCancelled } = await import('@/utils/operationLoopUtils');
        vi.mocked(checkCancelled).mockImplementation(
          (getState: any) => getState().app.discrubCancelled,
        );
        vi.mocked(waitWhilePaused).mockImplementation(async (getState: any) => {
          while (getState().app.discrubPaused) {
            await new Promise((r) => setTimeout(r, 10));
            if (getState().app.discrubCancelled) return;
          }
        });
        const { setDiscrubCancelled } = await import('@features/app/appSlice');

        const batch = createMockMessages(100);
        const fetchSpy = vi.fn()
          .mockResolvedValueOnce({ success: true, data: batch })
          .mockResolvedValue({ success: false, status: undefined });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchMessageData: fetchSpy } as any);
        vi.mocked(addStatusEntry).mockClear();

        const testStore = await createStoreWithApp(threadTabState());
        const pending = testStore.dispatch(
          fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' })
        );
        for (let i = 0; i < 200 && !testStore.getState().app.discrubPaused; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(testStore.getState().app.discrubPaused).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(7);

        testStore.dispatch(setDiscrubCancelled(true));
        const result = await pending;
        expect(result.type).toBe('message/fetchAllThreadMessages/fulfilled');
        expect(testStore.getState().message.threadTabs['thread-100'].messages).toHaveLength(100);

        const pauseEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /paused after 5 failed retries/.test(p.message),
        );
        expect(pauseEntries.length).toBeGreaterThanOrEqual(1);
        expect(pauseEntries[0][0].message).toContain('from 100 loaded');

        vi.mocked(checkCancelled).mockReturnValue(false);
        vi.mocked(waitWhilePaused).mockResolvedValue(undefined);
      }, 10000);

      it('should handle searchThreadMessages failure gracefully', async () => {
        const mockDiscordService = {
          fetchSearchMessageData: vi.fn().mockResolvedValue({ success: false }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const testStore = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const result = await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-100',
            token: 'token',
            searchCriteria: { searchContent: 'test' } as any,
          })
        );

        expect(result.type).toBe('message/searchThreadMessages/rejected');

        const tab = testStore.getState().message.threadTabs['thread-100'];
        expect(tab.isLoading).toBe(false);
      });

      it('should reject fetchMoreThreadMessages when tab removed mid-fetch', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn()
            .mockResolvedValueOnce({ success: true, data: createMockMessages(2) })
            .mockImplementation(async () => {
              // Remove the tab before resolving
              store.dispatch(removeThreadTab('thread-100'));
              return { success: true, data: createMockMessages(1) };
            }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        // Open the thread first
        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'Thread', token: 'token' }));

        const result = await store.dispatch(
          fetchMoreThreadMessages({ threadId: 'thread-100', token: 'token', lastMessageId: 'msg-2' })
        );

        expect(result.type).toBe('message/fetchMoreThreadMessages/rejected');
      });

      it('should reject fetchAllThreadMessages when tab removed mid-fetch', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn()
            .mockResolvedValueOnce({ success: true, data: createMockMessages(100) })
            .mockImplementation(async () => {
              // Remove the tab during second batch, return < 100 to end loop
              testStore.dispatch(removeThreadTab('thread-100'));
              return { success: true, data: createMockMessages(10) };
            }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const testStore: any = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        const result = await testStore.dispatch(
          fetchAllThreadMessages({ threadId: 'thread-100', token: 'token' })
        );

        expect(result.type).toBe('message/fetchAllThreadMessages/rejected');
      });
    });

    describe('Thread edge cases - round 2', () => {
      it('should reject searchThreadMessages when tab removed mid-fetch', async () => {
        const mockDiscordService = {
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            // Remove the tab before resolving
            testStore.dispatch(removeThreadTab('thread-100'));
            return {
              success: true,
              data: { messages: [createMockMessages(2)], total_results: 2 },
            };
          }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        const testStore: any = await createStoreWithApp({
          ...initialMessageState,
          activeTab: 'thread-100',
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null, refineCriteria: null,
              order: initialMessageState.order,
              isLoading: false,
              error: null,
              pagination: { ...initialMessageState.pagination },
            },
          },
        });

        await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-100',
            token: 'token',
            searchCriteria: { searchContent: 'test' } as any,
          })
        );

        // After tab removal, the thunk should still complete (tab was removed by the mock)
        // The tab no longer exists in state
        expect(testStore.getState().message.threadTabs['thread-100']).toBeUndefined();
      });

      it('should re-focus existing tab when opening thread that already exists', async () => {
        const mockDiscordService = {
          fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: createMockMessages(3) }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        // Open the thread
        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'My Thread', token: 'token' }));
        expect(store.getState().message.activeTab).toBe('thread-100');

        // Switch away
        store.dispatch(setActiveTab(null));
        expect(store.getState().message.activeTab).toBeNull();

        // Open same thread again — should just re-focus
        mockDiscordService.fetchMessageData.mockClear();
        await store.dispatch(openThreadTab({ threadId: 'thread-100', threadName: 'My Thread', token: 'token' }));

        expect(store.getState().message.activeTab).toBe('thread-100');
        // Should not have re-fetched
        expect(mockDiscordService.fetchMessageData).not.toHaveBeenCalled();
        // Should still have exactly one thread tab
        expect(Object.keys(store.getState().message.threadTabs)).toHaveLength(1);
      });

      it('should no-op removeThreadTab on non-existent tab', () => {
        const stateBefore = store.getState().message;
        store.dispatch(removeThreadTab('nonexistent'));
        const stateAfter = store.getState().message;
        expect(stateAfter.threadTabs).toEqual(stateBefore.threadTabs);
        expect(stateAfter.activeTab).toEqual(stateBefore.activeTab);
      });

      it('should clear all thread tabs on clearMessages', () => {
        store.dispatch(addThreadTab({ threadId: 'thread-100', threadName: 'Thread 1' }));
        store.dispatch(addThreadTab({ threadId: 'thread-200', threadName: 'Thread 2' }));
        expect(Object.keys(store.getState().message.threadTabs)).toHaveLength(2);

        store.dispatch(clearMessages());

        const state = store.getState().message;
        expect(state.threadTabs).toEqual({});
        expect(state.activeTab).toBeNull();
      });
    });

    describe('operations on main tab with thread tabs open', () => {
      it('should update main arrays when activeTab is null even if thread tabs exist', async () => {
        // Set up thread tab but switch back to main
        const testStore = setupThreadTabStore();
        testStore.dispatch(setActiveTab(null));

        const mockDiscordService = {
          deleteMessage: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

        await testStore.dispatch(deleteMessage({ messageId: 'main-1', channelId: 'ch-1', token: 'token' }));

        const state = testStore.getState().message;
        // Main messages should have the deleted message removed
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0].id).toBe('main-2');
        // Thread tab should be untouched
        expect(state.threadTabs['thread-1'].messages).toHaveLength(3);
      });
    });
  });

  // ── Deep-link navigation (#123 Phase 1) ────────────────────────────────

  describe('navigateToMessage', () => {
    it('sets highlightedMessageId when the target is in the loaded main-channel feed', async () => {
      const testStore = createTestStore({ message: messageReducer });
      const msgs = [
        createMockMessage({ id: 'a' }),
        createMockMessage({ id: 'b' }),
        createMockMessage({ id: 'target' }),
      ];
      testStore.dispatch(setMessages(msgs));

      await testStore.dispatch(navigateToMessage({ messageId: 'target' }));

      expect(selectHighlightedMessageId(testStore.getState())).toBe('target');
    });

    it('dispatches a toast hint (no highlight) when the target is not in the current view', async () => {
      const testStore = createTestStore({ message: messageReducer });
      testStore.dispatch(setMessages([createMockMessage({ id: 'a' })]));

      (showToast as unknown as Mock).mockClear();
      await testStore.dispatch(navigateToMessage({ messageId: 'not-here' }));

      expect(selectHighlightedMessageId(testStore.getState())).toBeNull();
      const toastCalls = (showToast as unknown as Mock).mock.calls;
      expect(toastCalls.some(([payload]) =>
        payload?.message?.includes("isn't in the current view"),
      )).toBe(true);
    });

    it('treats refine-hidden messages as "not in the current view" (no silent dead-click)', async () => {
      const testStore = createTestStore({ message: messageReducer });
      // Target exists in messages but not in filteredMessages (simulating
      // an active refine that filtered it out). Ensures the Phase 1
      // visibility check prevents the "highlight set but nothing scrolls"
      // dead-click bug.
      testStore.dispatch(setMessages([createMockMessage({ id: 'visible' })]));
      testStore.dispatch(
        setFilteredMessages([createMockMessage({ id: 'visible' })]),
      );
      // Now add a message to raw `messages` only
      testStore.dispatch(
        setMessages([
          createMockMessage({ id: 'visible' }),
          createMockMessage({ id: 'hidden-by-refine' }),
        ]),
      );
      testStore.dispatch(
        setFilteredMessages([createMockMessage({ id: 'visible' })]),
      );

      (showToast as unknown as Mock).mockClear();
      await testStore.dispatch(navigateToMessage({ messageId: 'hidden-by-refine' }));

      expect(selectHighlightedMessageId(testStore.getState())).toBeNull();
      const toastCalls = (showToast as unknown as Mock).mock.calls;
      expect(toastCalls.length).toBeGreaterThan(0);
    });

    it('reads from the active thread tab instead of main messages when a thread is active', async () => {
      const testStore = createTestStore({ message: messageReducer });
      // Main feed does NOT contain the target — only the thread does.
      testStore.dispatch(setMessages([createMockMessage({ id: 'main-only' })]));
      testStore.dispatch(addThreadTab({ threadId: 'thread-1', threadName: 'T' }));
      testStore.dispatch(
        setThreadMessages({
          threadId: 'thread-1',
          messages: [createMockMessage({ id: 'thread-target' })],
        }),
      );
      testStore.dispatch(setActiveTab('thread-1'));

      await testStore.dispatch(navigateToMessage({ messageId: 'thread-target' }));

      expect(selectHighlightedMessageId(testStore.getState())).toBe('thread-target');
    });

    it('setHighlightedMessageId(null) clears the highlight', () => {
      const testStore = createTestStore({ message: messageReducer });
      testStore.dispatch(setHighlightedMessageId('x'));
      expect(selectHighlightedMessageId(testStore.getState())).toBe('x');
      testStore.dispatch(setHighlightedMessageId(null));
      expect(selectHighlightedMessageId(testStore.getState())).toBeNull();
    });
  });

  // ── Inline filter-by-user (#129) ───────────────────────────────────────

  describe('applyUserFilter thunk', () => {
    // Identity reducer slices for auth/channel/guild/dm — `applyUserFilter`
    // reads these via casts so we don't need their real reducers, just
    // their shape. Identity reducer keeps the preloaded state stable.
    const identity = (initial: any) => (state = initial) => state;

    async function makeStore(opts: {
      token?: string | null;
      channelId?: string | null;
      guildId?: string | null;
      activeTab?: string | null;
    } = {}) {
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');

      const baseAppState = {
        discrubPaused: false,
        discrubCancelled: false,
        isMinimized: false,
        focusedView: false,
        kofiOverlayOpen: false,
        sidebarView: 'server' as const,
        task: { status: 'idle' as const, message: '' },
        previewThemeId: null,
        settings: defaultSettings,
      };

      const messageState = {
        ...initialMessageState,
        activeTab: opts.activeTab ?? null,
        searchCriteria: {
          searchAfterDate: new Date('2026-01-01'),
          searchBeforeDate: null,
          searchMessageContents: ['hello'],
          selectedHasTypes: [],
          userIds: ['old-user'],
          mentionIds: ['old-mention'],
          channelIds: [],
          isPinned: 0,
          authorType: null,
        } as any,
        threadTabs: opts.activeTab
          ? {
              [opts.activeTab]: {
                threadId: opts.activeTab,
                threadName: 'thread',
                messages: [],
                filteredMessages: [],
                selectedMessages: [],
                searchCriteria: {
                  searchAfterDate: null,
                  searchBeforeDate: null,
                  searchMessageContents: ['thread-content'],
                  selectedHasTypes: [],
                  userIds: ['thread-old-user'],
                  mentionIds: [],
                  channelIds: [],
                  isPinned: 0,
                  authorType: null,
                } as any,
                refineCriteria: null,
                order: { order: SortDirection.DESCENDING, orderBy: 'timestamp' as keyof Message },
                isLoading: false,
                error: null,
                pagination: { lastMessageId: null, hasMore: true, totalCount: null, isLoadingMore: false, isLoadingAll: false, loadAllProgress: null, mode: 'paginated' as const, searchOffset: 0 },
              },
            }
          : {},
      };

      const auth = { token: opts.token === undefined ? 'tok' : opts.token };
      const channel = opts.channelId
        ? { selectedChannel: { id: opts.channelId } }
        : { selectedChannel: null };
      const guild = opts.guildId
        ? { selectedGuild: { id: opts.guildId } }
        : { selectedGuild: null };
      const dm = { selectedDm: null };

      return createTestStore(
        {
          message: messageReducer,
          app: appReducer,
          auth: identity(auth),
          channel: identity(channel),
          guild: identity(guild),
          dm: identity(dm),
        },
        {
          app: baseAppState,
          message: messageState,
          auth,
          channel,
          guild,
          dm,
        },
      );
    }

    beforeEach(() => {
      (showToast as unknown as Mock).mockClear();
    });

    it('mode=author replaces userIds with [target] and preserves other filters on main channel', async () => {
      const testStore: any = await makeStore({ channelId: 'ch-1', guildId: 'g-1' });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [], total_results: 0 },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        applyUserFilter({ userId: 'target-user', displayName: 'Alice', mode: 'author' }),
      );

      expect(mockDiscordService.fetchSearchMessageData).toHaveBeenCalledTimes(1);
      const call = mockDiscordService.fetchSearchMessageData.mock.calls[0];
      const criteriaUsed = call[4];
      expect(criteriaUsed.userIds).toEqual(['target-user']);
      // Other filter fields preserved
      expect(criteriaUsed.searchMessageContents).toEqual(['hello']);
      expect(criteriaUsed.searchAfterDate).toEqual(new Date('2026-01-01'));
      // mentionIds untouched in author mode
      expect(criteriaUsed.mentionIds).toEqual(['old-mention']);
    });

    it('mode=mentions replaces mentionIds with [target] and preserves userIds', async () => {
      const testStore: any = await makeStore({ channelId: 'ch-1', guildId: 'g-1' });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [], total_results: 0 },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        applyUserFilter({ userId: 'target-user', displayName: 'Alice', mode: 'mentions' }),
      );

      const criteriaUsed = mockDiscordService.fetchSearchMessageData.mock.calls[0][4];
      expect(criteriaUsed.mentionIds).toEqual(['target-user']);
      // userIds preserved in mentions mode
      expect(criteriaUsed.userIds).toEqual(['old-user']);
    });

    it('routes through the active thread tab criteria when activeTab is set', async () => {
      const testStore: any = await makeStore({ activeTab: 'thread-1', channelId: null });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: { messages: [], total_results: 0 },
        }),
        fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await testStore.dispatch(
        applyUserFilter({ userId: 'target-user', displayName: 'Alice', mode: 'author' }),
      );

      // Thread search uses the thread's existing criteria — searchMessageContent='thread-content' should survive
      const criteriaUsed = mockDiscordService.fetchSearchMessageData.mock.calls[0][4];
      expect(criteriaUsed.searchMessageContents).toEqual(['thread-content']);
      expect(criteriaUsed.userIds).toEqual(['target-user']);
    });

    it('dispatches showToast with author-style copy when mode=author', async () => {
      const testStore: any = await makeStore({ channelId: 'ch-1' });

      vi.mocked(discordService.getDiscordService).mockReturnValue({
        fetchSearchMessageData: vi.fn().mockResolvedValue({ success: true, data: { messages: [], total_results: 0 } }),
      } as any);

      await testStore.dispatch(
        applyUserFilter({ userId: 'u', displayName: 'Alice', mode: 'author' }),
      );

      const toastCalls = (showToast as unknown as Mock).mock.calls;
      const authorCall = toastCalls.find((c) => c[0]?.message?.includes('from Alice'));
      expect(authorCall).toBeDefined();
    });

    it('dispatches showToast with mentions-style copy when mode=mentions', async () => {
      const testStore: any = await makeStore({ channelId: 'ch-1' });

      vi.mocked(discordService.getDiscordService).mockReturnValue({
        fetchSearchMessageData: vi.fn().mockResolvedValue({ success: true, data: { messages: [], total_results: 0 } }),
      } as any);

      await testStore.dispatch(
        applyUserFilter({ userId: 'u', displayName: 'Alice', mode: 'mentions' }),
      );

      const toastCalls = (showToast as unknown as Mock).mock.calls;
      const mentionsCall = toastCalls.find((c) => c[0]?.message?.includes('mentioning Alice'));
      expect(mentionsCall).toBeDefined();
    });

    it('skips when token is missing', async () => {
      const testStore: any = await makeStore({ token: null, channelId: 'ch-1' });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn(),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await testStore.dispatch(
        applyUserFilter({ userId: 'u', displayName: 'A', mode: 'author' }),
      );

      expect(result.payload).toEqual({ skipped: 'no-token' });
      expect(mockDiscordService.fetchSearchMessageData).not.toHaveBeenCalled();
    });

    it('skips when no channel/DM is selected (and no thread)', async () => {
      const testStore: any = await makeStore({ channelId: null });

      const mockDiscordService = {
        fetchSearchMessageData: vi.fn(),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await testStore.dispatch(
        applyUserFilter({ userId: 'u', displayName: 'A', mode: 'author' }),
      );

      expect(result.payload).toEqual({ skipped: 'no-channel' });
      expect(mockDiscordService.fetchSearchMessageData).not.toHaveBeenCalled();
    });
  });

  // ── #148: searchThreadMessages cap-shift uses searchBeforeDate ──
  describe('searchThreadMessages cap-shift (#148)', () => {
    const createStoreWithApp = async (messageState: any) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      return configureStore({
        reducer: { message: messageReducer, app: appReducer },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            previewThemeId: null,
            settings: defaultSettings,
          } as any,
          message: messageState,
        },
      });
    };

    it('cap-shifts via searchBeforeDate (max_id) when a batch hits maxPerBatch=5000', async () => {
      // Inner loop accumulates messages until batchMessages.length >= 5000.
      // Returning 5000 in a single call satisfies that on iteration 1;
      // the outer cap-shift then fires for the second batch.
      const oldestTs = '2025-03-15T00:00:00.000Z';
      const fullBatch = Array.from({ length: 5000 }, (_, i) => ({
        id: `t${i}`,
        timestamp: oldestTs,
      }));

      const criteriaCalls: any[] = [];
      const mockDiscordService = {
        fetchSearchMessageData: vi
          .fn()
          .mockImplementation(
            (
              _token: string,
              _offset: number,
              _channelId: string | null,
              _guildId: string | null,
              criteria: any,
            ) => {
              criteriaCalls.push({ ...criteria });
              if (criteriaCalls.length === 1) {
                // First batch: 5000 messages, total_results > 5000 so
                // cap-shift will be needed.
                return Promise.resolve({
                  success: true,
                  data: { messages: fullBatch.map((m) => [m]), total_results: 6000 },
                });
              }
              // Second batch (after cap-shift): empty → terminate.
              return Promise.resolve({
                success: true,
                data: { messages: [], total_results: 0 },
              });
            },
          ),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const testStore = await createStoreWithApp({
        ...initialMessageState,
        activeTab: 'thread-cap',
        threadTabs: {
          'thread-cap': {
            threadId: 'thread-cap',
            threadName: 'Cap-shift thread',
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null,
            refineCriteria: null,
            order: initialMessageState.order,
            isLoading: false,
            error: null,
            pagination: { ...initialMessageState.pagination },
          },
        },
      });

      await testStore.dispatch(
        searchThreadMessages({
          threadId: 'thread-cap',
          token: 'token',
          searchCriteria: {
            searchAfterDate: null,
            searchBeforeDate: null,
            searchMessageContents: ['foo'],
            selectedHasTypes: [],
            userIds: [],
            mentionIds: [],
            channelIds: [],
            isPinned: 0,
            authorType: null,
          } as any,
        }),
      );

      // First call: clean criteria, no bounds.
      expect(criteriaCalls[0].searchBeforeDate).toBeNull();
      expect(criteriaCalls[0].searchAfterDate).toBeNull();

      // Second call: cap-shifted. searchBeforeDate (= max_id) must be
      // tightened to the oldest message's timestamp; searchAfterDate
      // (= min_id) must NOT be touched.
      expect(criteriaCalls[1].searchBeforeDate).toBeInstanceOf(Date);
      expect(
        (criteriaCalls[1].searchBeforeDate as Date).toISOString(),
      ).toBe(oldestTs);
      expect(criteriaCalls[1].searchAfterDate).toBeNull();
    });
  });

  // ── #148: cap-shift uses searchBeforeDate (max_id), NOT searchAfterDate ──
  describe('loadAllSearchResults always-cap-shift (#148/#208)', () => {
    // #208: pagination now runs through the lib's real iterateSearchResults
    // generator (built via makeSearchService over a mocked fetch), so these
    // assert the consumer-visible convergence guarantees end-to-end.
    const baseCriteria = {
      searchAfterDate: null,
      searchBeforeDate: null,
      searchMessageContents: ['foo'],
      selectedHasTypes: [],
      userIds: [],
      mentionIds: [],
      channelIds: [],
      isPinned: 0,
      authorType: null,
    };

    const mkPage = (prefix: string, n: number, ts: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, timestamp: ts }));

    const makeStore = async (searchCriteria: any, messages: any[] = []) => {
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      return createTestStore(
        { message: messageReducer, app: appReducer },
        {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            previewThemeId: null,
            settings: defaultSettings,
          } as any,
          message: {
            ...initialMessageState,
            messages,
            searchCriteria,
            pagination: {
              ...initialMessageState.pagination,
              mode: 'search' as const,
              searchOffset: 0,
              totalCount: 100,
            },
          },
        },
      ) as any;
    };

    it('continues past a short (<25) page mid-stream instead of stopping early (#208)', async () => {
      const page1 = mkPage('a', 25, '2025-03-01T00:00:00.000Z');
      const page2 = mkPage('b', 5, '2025-02-01T00:00:00.000Z'); // short page MID-stream
      const page3 = mkPage('c', 25, '2025-01-01T00:00:00.000Z');
      let call = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) return { success: true, data: { messages: page1.map((m) => [m]), total_results: 55 } };
        if (call === 2) return { success: true, data: { messages: page2.map((m) => [m]), total_results: 55 } };
        if (call === 3) return { success: true, data: { messages: page3.map((m) => [m]), total_results: 55 } };
        return { success: true, data: { messages: [], total_results: 55 } };
      });
      vi.mocked(discordService.getDiscordService).mockReturnValue(
        makeSearchService({ fetchSearchMessageData: fetchMock }),
      );

      const testStore = await makeStore({ ...baseCriteria });
      const result: any = await testStore.dispatch(
        loadAllSearchResults({ channelId: 'ch1', token: 'token' }),
      );

      expect(result.type).toBe('message/loadAllSearchResults/fulfilled');
      // The 5-message short page in the MIDDLE must not have terminated the
      // walk — the exact #208 bug. All three pages aggregate to 55.
      expect(result.payload.messages).toHaveLength(55);
    });

    it('freezes the live progress total at the initial total as cap-shift windows shrink (#221)', async () => {
      // 25 already loaded by the initial search, which reported total 100.
      const initialMsgs = mkPage('init', 25, '2025-12-01T00:00:00.000Z');
      const page1 = mkPage('a', 25, '2025-09-01T00:00:00.000Z');
      const page2 = mkPage('b', 25, '2025-06-01T00:00:00.000Z');
      const page3 = mkPage('c', 25, '2025-03-01T00:00:00.000Z');

      // Capture the live progress denominator the moment before each fetch —
      // by then the prior page's updateLoadAllProgress has run. (Same
      // mid-walk snapshot trick the #181 append test uses.)
      const progress: Array<{ current: number; total: number }> = [];
      let call = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        const p = testStore.getState().message.pagination.loadAllProgress;
        if (p) progress.push({ current: p.current, total: p.total });
        call += 1;
        // total_results counts DOWN as the iterator cap-shifts max_id: the
        // window [min,max] shrinks (75 → 50 → 25), falling below both the
        // initial total (100) and what we ultimately load (100).
        if (call === 1) return { success: true, data: { messages: page1.map((m) => [m]), total_results: 75 } };
        if (call === 2) return { success: true, data: { messages: page2.map((m) => [m]), total_results: 50 } };
        if (call === 3) return { success: true, data: { messages: page3.map((m) => [m]), total_results: 25 } };
        return { success: true, data: { messages: [], total_results: 25 } };
      });
      vi.mocked(discordService.getDiscordService).mockReturnValue(
        makeSearchService({ fetchSearchMessageData: fetchMock }),
      );

      const testStore: any = await makeStore({ ...baseCriteria }, initialMsgs);
      const result: any = await testStore.dispatch(
        loadAllSearchResults({ channelId: 'ch1', token: 'token' }),
      );

      expect(result.type).toBe('message/loadAllSearchResults/fulfilled');
      expect(result.payload.messages).toHaveLength(100); // 25 initial + 75 fresh

      // Every live progress reading must keep the total frozen at 100 (never
      // the shrinking 75/50/25) so "loaded" never overtakes "total" and the
      // header's "(total - loaded) remaining" can't go negative — the #221 bug.
      expect(progress.length).toBeGreaterThan(1);
      for (const p of progress) {
        expect(p.total).toBe(100);
        expect(p.total).toBeGreaterThanOrEqual(p.current);
      }
      // And the deepest walk point really did pass the shrunk windows:
      expect(Math.max(...progress.map((p) => p.current))).toBeGreaterThan(25);
    });

    it('cap-shifts searchBeforeDate to the oldest seen each page, narrowing not widening, never touching searchAfterDate (#148)', async () => {
      const userBefore = new Date('2025-12-31T00:00:00.000Z');
      const page1 = mkPage('a', 25, '2025-06-15T00:00:00.000Z');
      const page2 = mkPage('b', 25, '2025-03-15T00:00:00.000Z');
      const criteriaCalls: any[] = [];
      const fetchMock = vi.fn().mockImplementation(
        (_t: string, _o: number, _c: string | null, _g: string | null, criteria: any) => {
          criteriaCalls.push({ ...criteria });
          if (criteriaCalls.length === 1) return Promise.resolve({ success: true, data: { messages: page1.map((m) => [m]), total_results: 50 } });
          if (criteriaCalls.length === 2) return Promise.resolve({ success: true, data: { messages: page2.map((m) => [m]), total_results: 50 } });
          return Promise.resolve({ success: true, data: { messages: [], total_results: 50 } });
        },
      );
      vi.mocked(discordService.getDiscordService).mockReturnValue(
        makeSearchService({ fetchSearchMessageData: fetchMock }),
      );

      const testStore = await makeStore({ ...baseCriteria, searchBeforeDate: userBefore });
      await testStore.dispatch(loadAllSearchResults({ channelId: 'ch1', token: 'token' }));

      // First fetch carries the user's bound unchanged.
      expect((criteriaCalls[0].searchBeforeDate as Date).toISOString()).toBe(userBefore.toISOString());
      // Second fetch is cap-shifted to the oldest message from page 1 —
      // strictly older than the user's bound (narrows, never widens).
      expect((criteriaCalls[1].searchBeforeDate as Date).toISOString()).toBe('2025-06-15T00:00:00.000Z');
      expect((criteriaCalls[1].searchBeforeDate as Date).getTime()).toBeLessThan(userBefore.getTime());
      // searchAfterDate (min_id) must never be mutated by cap-shift.
      expect(criteriaCalls.every((c) => c.searchAfterDate === null)).toBe(true);
    });
  });

  describe('Pass 1 reaction enrichment contract (#163)', () => {
    // Search-loaded messages arrive from Discord with `reactions` undefined.
    // The four search thunks must run Pass 1 enrichment before storing
    // messages in state, otherwise the live UI shows no reaction badges,
    // the Remove Reactions button stays disabled, and exports of any format
    // drop reactions for search-loaded sets.

    const buildStoreWithReactions = async (reactionsEnabled: boolean, messageState = initialMessageState) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const { DiscrubSetting } = await import('discrub-core/discrub-enum');

      return configureStore({
        reducer: { message: messageReducer, app: appReducer },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            previewThemeId: null,
            settings: {
              ...defaultSettings,
              [DiscrubSetting.REACTIONS_ENABLED]: reactionsEnabled ? 'true' : 'false',
            },
          },
          message: messageState,
        },
      });
    };

    /**
     * Build messages as Discord's search endpoint actually returns them:
     * `reactions` field absent. Pass 1 must populate it.
     */
    const searchShapedMessages = (count: number): Message[] =>
      Array.from({ length: count }, (_, i) => createMockMessage({
        id: `search-${i + 1}`,
        reactions: undefined as any,
      }));

    /**
     * Mock helper response — every input message gets a single thumbs-up
     * reaction. Pinned post-fix: stored messages have non-undefined
     * reactions for any thunk that ran Pass 1.
     */
    const mockEnrichedReturn = (msgs: Message[]) =>
      msgs.map((m) => ({
        ...m,
        reactions: [{ emoji: { id: null, name: '👍' }, count: 1 }],
      }));

    let reactionEnrichmentService: any;

    beforeEach(async () => {
      reactionEnrichmentService = (await import('@services/reactionEnrichmentService')).reactionEnrichmentService;
      const { DiscrubSetting } = await import('discrub-core/discrub-enum');
      vi.mocked(reactionEnrichmentService.enrichMessages).mockReset();
      // The real helper short-circuits when REACTIONS_ENABLED !== 'true'.
      // Mirror that here so the contract tests can assert user-visible
      // behavior (unenriched messages in state) regardless of whether
      // the consumer chose to gate at call site or rely on the helper.
      vi.mocked(reactionEnrichmentService.enrichMessages).mockImplementation(
        async (msgs: Message[], _token: string, settings: any) => {
          if (settings?.[DiscrubSetting.REACTIONS_ENABLED] !== 'true') return msgs;
          return mockEnrichedReturn(msgs);
        }
      );
    });

    describe('searchMessages thunk', () => {
      it('runs Pass 1 enrichment when REACTIONS_ENABLED is true', async () => {
        const testStore = await buildStoreWithReactions(true);
        const apiMessages = searchShapedMessages(3);

        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchSearchMessageData: vi.fn().mockResolvedValue({
            success: true,
            data: { messages: [apiMessages], total_results: 3 },
          }),
        } as any);

        await testStore.dispatch(
          searchMessages({
            channelId: 'ch-1',
            token: 'token',
            searchCriteria: { content: 'x' } as any,
          })
        );

        expect(reactionEnrichmentService.enrichMessages).toHaveBeenCalledOnce();
        const [calledMessages] = vi.mocked(reactionEnrichmentService.enrichMessages).mock.calls[0];
        expect(calledMessages).toHaveLength(3);
        expect(calledMessages.every((m: Message) => m.reactions === undefined)).toBe(true);

        const state = testStore.getState().message;
        expect(state.messages).toHaveLength(3);
        expect(state.messages.every((m) =>
          Array.isArray(m.reactions) && m.reactions!.length > 0
        )).toBe(true);
      });

      it('does not enrich when REACTIONS_ENABLED is false (helper short-circuits internally)', async () => {
        const testStore = await buildStoreWithReactions(false);
        const apiMessages = searchShapedMessages(3);

        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchSearchMessageData: vi.fn().mockResolvedValue({
            success: true,
            data: { messages: [apiMessages], total_results: 3 },
          }),
        } as any);

        await testStore.dispatch(
          searchMessages({
            channelId: 'ch-1',
            token: 'token',
            searchCriteria: { content: 'x' } as any,
          })
        );

        const state = testStore.getState().message;
        expect(state.messages).toHaveLength(3);
        expect(state.messages.every((m) => m.reactions === undefined)).toBe(true);
      });
    });

    describe('fetchNextSearchPage thunk', () => {
      const seedSearchActive = (): typeof initialMessageState => ({
        ...initialMessageState,
        searchCriteria: { content: 'x' } as any,
        pagination: {
          ...initialMessageState.pagination,
          mode: 'search' as const,
          searchOffset: 25,
          totalCount: 100,
          hasMore: true,
        },
      });

      it('runs Pass 1 enrichment on the next page when REACTIONS_ENABLED is true', async () => {
        const testStore = await buildStoreWithReactions(true, seedSearchActive());
        const nextPage = searchShapedMessages(25);

        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchSearchMessageData: vi.fn().mockResolvedValue({
            success: true,
            data: { messages: [nextPage], total_results: 100 },
          }),
        } as any);

        const { fetchNextSearchPage } = await import('./messageSlice');
        await testStore.dispatch(
          fetchNextSearchPage({ channelId: 'ch-1', token: 'token' })
        );

        expect(reactionEnrichmentService.enrichMessages).toHaveBeenCalledOnce();
        const state = testStore.getState().message;
        expect(state.messages).toHaveLength(25);
        expect(state.messages.every((m) =>
          Array.isArray(m.reactions) && m.reactions!.length > 0
        )).toBe(true);
      });

      it('does not enrich when REACTIONS_ENABLED is false (helper short-circuits internally)', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive());

        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchSearchMessageData: vi.fn().mockResolvedValue({
            success: true,
            data: { messages: [searchShapedMessages(25)], total_results: 100 },
          }),
        } as any);

        const { fetchNextSearchPage } = await import('./messageSlice');
        await testStore.dispatch(
          fetchNextSearchPage({ channelId: 'ch-1', token: 'token' })
        );

        const state = testStore.getState().message;
        expect(state.messages).toHaveLength(25);
        expect(state.messages.every((m) => m.reactions === undefined)).toBe(true);
      });
    });

    describe('loadAllSearchResults thunk', () => {
      const seedSearchActive = (): typeof initialMessageState => ({
        ...initialMessageState,
        searchCriteria: { content: 'x' } as any,
        pagination: {
          ...initialMessageState.pagination,
          mode: 'search' as const,
          searchOffset: 0,
          totalCount: 25,
          hasMore: true,
        },
      });

      it('runs Pass 1 enrichment on the aggregated load when REACTIONS_ENABLED is true', async () => {
        const testStore = await buildStoreWithReactions(true, seedSearchActive());
        const page = searchShapedMessages(25);

        // Two pages then end-of-results.
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
              return { success: true, data: { messages: [page], total_results: 25 } };
            }
            return { success: true, data: { messages: [[]], total_results: 25 } };
          }),
        } as any));

        await testStore.dispatch(
          loadAllSearchResults({ channelId: 'ch-1', token: 'token' })
        );

        expect(reactionEnrichmentService.enrichMessages).toHaveBeenCalled();
        const state = testStore.getState().message;
        expect(state.messages).toHaveLength(25);
        expect(state.messages.every((m) =>
          Array.isArray(m.reactions) && m.reactions!.length > 0
        )).toBe(true);
      });

      it('does not enrich when REACTIONS_ENABLED is false (helper short-circuits internally)', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive());

        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
              return { success: true, data: { messages: [searchShapedMessages(25)], total_results: 25 } };
            }
            return { success: true, data: { messages: [[]], total_results: 25 } };
          }),
        } as any));

        await testStore.dispatch(
          loadAllSearchResults({ channelId: 'ch-1', token: 'token' })
        );

        const state = testStore.getState().message;
        expect(state.messages).toHaveLength(25);
        expect(state.messages.every((m) => m.reactions === undefined)).toBe(true);
      });
    });

    describe('searchThreadMessages thunk', () => {
      const seedThreadActive = (): typeof initialMessageState => ({
        ...initialMessageState,
        activeTab: 'thread-1',
        threadTabs: {
          'thread-1': {
            threadId: 'thread-1',
            threadName: 'Thread',
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null,
            refineCriteria: null,
            order: initialMessageState.order,
            isLoading: false,
            error: null,
            pagination: { ...initialMessageState.pagination },
          },
        },
      });

      it('runs Pass 1 enrichment per batch when REACTIONS_ENABLED is true', async () => {
        const testStore = await buildStoreWithReactions(true, seedThreadActive());
        const batch = searchShapedMessages(5);

        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
              return { success: true, data: { messages: [batch], total_results: 5 } };
            }
            return { success: true, data: { messages: [[]], total_results: 5 } };
          }),
        } as any);

        await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-1',
            token: 'token',
            searchCriteria: { content: 'x' } as any,
          })
        );

        expect(reactionEnrichmentService.enrichMessages).toHaveBeenCalled();
        const tab = testStore.getState().message.threadTabs['thread-1'];
        expect(tab.messages).toHaveLength(5);
        expect(tab.messages.every((m) =>
          Array.isArray(m.reactions) && m.reactions!.length > 0
        )).toBe(true);
      });

      it('does not enrich when REACTIONS_ENABLED is false (helper short-circuits internally)', async () => {
        const testStore = await buildStoreWithReactions(false, seedThreadActive());
        const batch = searchShapedMessages(5);

        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
              return { success: true, data: { messages: [batch], total_results: 5 } };
            }
            return { success: true, data: { messages: [[]], total_results: 5 } };
          }),
        } as any);

        await testStore.dispatch(
          searchThreadMessages({
            threadId: 'thread-1',
            token: 'token',
            searchCriteria: { content: 'x' } as any,
          })
        );

        const tab = testStore.getState().message.threadTabs['thread-1'];
        expect(tab.messages).toHaveLength(5);
        expect(tab.messages.every((m) => m.reactions === undefined)).toBe(true);
      });
    });

    describe('#178 Load All UX clarity bundle', () => {
      const seedSearchActive = (criteria: Record<string, unknown>): typeof initialMessageState => ({
        ...initialMessageState,
        searchCriteria: criteria as any,
        pagination: {
          ...initialMessageState.pagination,
          mode: 'search' as const,
          searchOffset: 0,
          totalCount: 25,
          hasMore: true,
        },
      });

      const drainStatusMessages = (): string[] =>
        vi.mocked(addStatusEntry).mock.calls.map((c) => (c[0] as any).message);

      const mockTwoPageThenEmpty = (perPage: number) => {
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
              return {
                success: true,
                data: { messages: [searchShapedMessages(perPage)], total_results: perPage },
              };
            }
            return { success: true, data: { messages: [[]], total_results: perPage } };
          }),
        } as any));
      };

      it('emits an unfiltered opening status entry when searchCriteria has no active filters', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive({}));
        mockTwoPageThenEmpty(5);
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const messages = drainStatusMessages();
        expect(messages).toContain('Loading all messages…');
        expect(messages.some((m) => /Loading all filtered/.test(m))).toBe(false);
      });

      it('emits a filtered opening status entry with a filter count when criteria are active', async () => {
        const testStore = await buildStoreWithReactions(
          false,
          seedSearchActive({ searchMessageContents: ['hi'], userIds: ['u1', 'u2'] }),
        );
        mockTwoPageThenEmpty(5);
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const messages = drainStatusMessages();
        expect(messages).toContain('Loading all filtered messages (3 filters active)…');
      });

      it('uses singular wording when exactly one filter is active', async () => {
        const testStore = await buildStoreWithReactions(
          false,
          seedSearchActive({ searchMessageContents: ['hi'] }),
        );
        mockTwoPageThenEmpty(5);
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const messages = drainStatusMessages();
        expect(messages).toContain('Loading all filtered messages (1 filter active)…');
      });

      it('emits a filtered completion entry when filters are active', async () => {
        const testStore = await buildStoreWithReactions(
          false,
          seedSearchActive({ searchMessageContents: ['hi'] }),
        );
        mockTwoPageThenEmpty(5);
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const messages = drainStatusMessages();
        expect(messages).toContain('Loaded 5 filtered messages');
        expect(messages).not.toContain('Loaded 5 messages');
      });

      it('emits an unfiltered completion entry when no filters are active', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive({}));
        mockTwoPageThenEmpty(5);
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const messages = drainStatusMessages();
        expect(messages).toContain('Loaded 5 messages');
      });

      it('throttles per-batch reaction enrichment status entries to a milestone ladder', async () => {
        const testStore = await buildStoreWithReactions(true, seedSearchActive({}));

        // Override the parent mock with one that actually invokes onWillEnrich
        // — that's the hook we're testing the cadence of.
        vi.mocked(reactionEnrichmentService.enrichMessages).mockImplementation(
          async (msgs: Message[], _token: string, _settings: any, cbs: any) => {
            cbs?.onWillEnrich?.(msgs.length);
            return mockEnrichedReturn(msgs);
          },
        );

        // Six pages of 25 messages each, then end-of-results. Pre-throttle,
        // this would emit six near-identical "fetching reaction data for 25
        // messages…" entries. After #178 only the first batch + milestone
        // crossings emit.
        const totalPages = 6;
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call <= totalPages) {
              return {
                success: true,
                data: {
                  messages: [searchShapedMessages(25)],
                  total_results: totalPages * 25,
                },
              };
            }
            return { success: true, data: { messages: [[]], total_results: totalPages * 25 } };
          }),
        } as any));
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const reactionEntries = drainStatusMessages().filter((m) =>
          /reaction data|enriched reactions/i.test(m),
        );
        // Floor: the opening "fetching reaction data for 25 messages…" and
        // the final total. Ceiling: well under one-per-batch.
        expect(reactionEntries.length).toBeGreaterThanOrEqual(2);
        expect(reactionEntries.length).toBeLessThan(totalPages);
        expect(reactionEntries[0]).toMatch(/fetching reaction data for 25 message/);
        expect(reactionEntries[reactionEntries.length - 1]).toMatch(
          /enriched reactions for \d+ messages? total/,
        );
      });

      it('does not emit any reaction enrichment entries when REACTIONS_ENABLED is false', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive({}));
        mockTwoPageThenEmpty(25);
        vi.mocked(addStatusEntry).mockClear();

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const reactionEntries = drainStatusMessages().filter((m) =>
          /reaction data|enriched reactions/i.test(m),
        );
        expect(reactionEntries).toEqual([]);
      });
    });

    describe('#193 Cancelled Load All is distinct from errored state', () => {
      it('cancelLoadAll keeps state.messages intact and state.error null', () => {
        const seeded = {
          ...initialMessageState,
          messages: createMockMessages(5),
          pagination: { ...initialMessageState.pagination, isLoadingAll: true },
        };
        const next = messageReducer(seeded, cancelLoadAll());
        expect(next.messages).toHaveLength(5);
        expect(next.pagination.isLoadingAll).toBe(false);
        expect(next.pagination.loadAllProgress).toBeNull();
        expect(next.error).toBeNull();
      });

      it('cancelLoadAll sets pagination.loadAllCancelled = true', () => {
        const seeded = { ...initialMessageState };
        const next = messageReducer(seeded, cancelLoadAll());
        expect(next.pagination.loadAllCancelled).toBe(true);
      });

      it('loadAllSearchResults.rejected with cancel payload does NOT set state.error and FLIPS loadAllCancelled', () => {
        // The thunk's cancellableDelay polling fires rejectWithValue with
        // this exact sentinel string. The handler must recognize it even
        // when cancelLoadAll was NOT separately dispatched (the real
        // cancel flow goes through setDiscrubCancelled in the app slice,
        // not cancelLoadAll in the message slice).
        const seeded = {
          ...initialMessageState,
          pagination: { ...initialMessageState.pagination, isLoadingAll: true },
        };
        const action = {
          type: loadAllSearchResults.rejected.type,
          payload: 'Load all cancelled',
          error: { message: 'Rejected' },
        };
        const next = messageReducer(seeded, action as any);
        expect(next.error).toBeNull();
        expect(next.pagination.isLoadingAll).toBe(false);
        expect(next.pagination.loadAllCancelled).toBe(true);
      });

      it('loadAllSearchResults.rejected with real error payload still sets state.error', () => {
        const seeded = { ...initialMessageState };
        const action = {
          type: loadAllSearchResults.rejected.type,
          payload: 'Network failure',
          error: { message: 'Rejected' },
        };
        const next = messageReducer(seeded, action as any);
        expect(next.error).toBe('Network failure');
        expect(next.pagination.loadAllCancelled).toBe(false);
      });

      it('fetchAllMessages.rejected with cancel payload does NOT set state.error and FLIPS loadAllCancelled', () => {
        // fetchAllMessages uses the slightly different sentinel 'Load
        // cancelled' (without 'all'). Both must be recognized.
        const seeded = {
          ...initialMessageState,
          pagination: { ...initialMessageState.pagination, isLoadingAll: true },
        };
        const action = {
          type: fetchAllMessages.rejected.type,
          payload: 'Load cancelled',
          error: { message: 'Rejected' },
        };
        const next = messageReducer(seeded, action as any);
        expect(next.error).toBeNull();
        expect(next.pagination.loadAllCancelled).toBe(true);
      });

      it('loadAllSearchResults.pending resets loadAllCancelled to false', () => {
        const seeded = {
          ...initialMessageState,
          pagination: { ...initialMessageState.pagination, loadAllCancelled: true },
        };
        const action = { type: loadAllSearchResults.pending.type };
        const next = messageReducer(seeded, action as any);
        expect(next.pagination.loadAllCancelled).toBe(false);
      });

      it('loadAllSearchResults.fulfilled keeps loadAllCancelled false', () => {
        const seeded = { ...initialMessageState };
        const action = {
          type: loadAllSearchResults.fulfilled.type,
          payload: { totalResults: 0 },
        };
        const next = messageReducer(seeded, action as any);
        expect(next.pagination.loadAllCancelled).toBe(false);
      });

      it('dismissLoadAllCancelled clears the cancelled flag without touching anything else', () => {
        const seeded = {
          ...initialMessageState,
          messages: createMockMessages(3),
          pagination: { ...initialMessageState.pagination, loadAllCancelled: true },
        };
        const next = messageReducer(seeded, dismissLoadAllCancelled());
        expect(next.pagination.loadAllCancelled).toBe(false);
        expect(next.messages).toHaveLength(3);
      });
    });

    describe('#181 Load All live message rendering', () => {
      const seedSearchActive = (): typeof initialMessageState => ({
        ...initialMessageState,
        searchCriteria: { content: 'x' } as any,
        pagination: {
          ...initialMessageState.pagination,
          mode: 'search' as const,
          searchOffset: 0,
          totalCount: 0,
          hasMore: true,
        },
      });

      it('appends loadAllSearchResults pages to state.messages between page fetches', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive());

        // Pages must be SEARCH_PAGE_SIZE (25) to keep the iterator looping.
        const page1 = searchShapedMessages(25).map((m, i) => ({ ...m, id: `p1-${i}` }));
        const page2 = searchShapedMessages(25).map((m, i) => ({ ...m, id: `p2-${i}` }));
        const snapshots: number[] = [];
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            // Capture state's message count BEFORE returning the next page.
            // After page 1 the snapshot should already be 25 — proving
            // appendLoadAllPage ran live, not at fulfilled.
            snapshots.push(testStore.getState().message.messages.length);
            call += 1;
            if (call === 1) {
              return { success: true, data: { messages: [page1], total_results: 50 } };
            }
            if (call === 2) {
              return { success: true, data: { messages: [page2], total_results: 50 } };
            }
            return { success: true, data: { messages: [[]], total_results: 50 } };
          }),
        } as any));

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        expect(snapshots[0]).toBe(0);
        expect(snapshots[1]).toBe(25);
        expect(testStore.getState().message.messages).toHaveLength(50);
      });

      // #263: each Load All page used to re-sort (and copy) the whole list;
      // now a page in order is merged at one end and, with no refine
      // active, filteredMessages is the same array rather than a copy.
      it('appendLoadAllPage keeps DESC order across pages and shares filteredMessages when no refine is active', () => {
        const at = (id: string, secondsAgo: number) => createMockMessage({ id, timestamp: new Date(Date.UTC(2026, 0, 1) - secondsAgo * 1000).toISOString() });
        const appendLoadAllPage = (payload: { messages: Message[] }) => ({ type: 'message/appendLoadAllPage', payload });
        // getSortedMessages is an identity mock in this file, so pages arrive
        // already in page order (as Discord sends them); the out-of-order
        // fallback is covered in messageOrdering.test.ts against the real sort.
        let state = messageReducer(initialMessageState, appendLoadAllPage({ messages: [at('a', 0), at('b', 10)] }));
        state = messageReducer(state, appendLoadAllPage({ messages: [at('c', 20), at('d', 30)] }));
        expect(state.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(state.filteredMessages).toBe(state.messages);
        expect(state.messages[0]).toBe(state.messages[0]);
      });

      it('appendLoadAllPage keeps ASC order when the feed is sorted oldest first', () => {
        const at = (id: string, secondsAgo: number) => createMockMessage({ id, timestamp: new Date(Date.UTC(2026, 0, 1) - secondsAgo * 1000).toISOString() });
        const appendLoadAllPage = (payload: { messages: Message[] }) => ({ type: 'message/appendLoadAllPage', payload });
        const asc = { ...initialMessageState, order: { ...initialMessageState.order, order: SortDirection.ASCENDING } };
        let state = messageReducer(asc, appendLoadAllPage({ messages: [at('b', 10), at('a', 0)] }));
        state = messageReducer(state, appendLoadAllPage({ messages: [at('d', 30), at('c', 20)] }));
        expect(state.messages.map((m) => m.id)).toEqual(['d', 'c', 'b', 'a']);
      });

      it('dedupes overlapping ids across appendLoadAllPage dispatches', async () => {
        const testStore = await buildStoreWithReactions(false, seedSearchActive());

        const page1 = searchShapedMessages(25).map((m, i) => ({ ...m, id: `m-${i}` }));
        // page2 overlaps two messages of page1 (m-23, m-24) — should dedupe.
        const page2 = [
          { ...searchShapedMessages(1)[0], id: 'm-23' },
          { ...searchShapedMessages(1)[0], id: 'm-24' },
          ...Array.from({ length: 23 }, (_, i) => ({
            ...searchShapedMessages(1)[0],
            id: `m-${25 + i}`,
          })),
        ];
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) return { success: true, data: { messages: [page1], total_results: 48 } };
            if (call === 2) return { success: true, data: { messages: [page2], total_results: 48 } };
            return { success: true, data: { messages: [[]], total_results: 48 } };
          }),
        } as any));

        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        const ids = testStore.getState().message.messages.map((m) => m.id);
        // 25 from page1 + 23 net-new from page2 = 48 unique.
        expect(ids).toHaveLength(48);
        expect(new Set(ids).size).toBe(48);
      });

      it('appends fetchAllMessages pages live (channel-mode Load All)', async () => {
        const testStore = await buildStoreWithReactions(false, initialMessageState);

        const batch1 = Array.from({ length: 100 }, (_, i) =>
          createMockMessage({ id: `b1-${i}`, reactions: undefined as any }),
        );
        const batch2 = Array.from({ length: 50 }, (_, i) =>
          createMockMessage({ id: `b2-${i}`, reactions: undefined as any }),
        );
        const snapshots: number[] = [];
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchMessageData: vi.fn().mockImplementation(async () => {
            snapshots.push(testStore.getState().message.messages.length);
            call += 1;
            if (call === 1) return { success: true, data: batch1 };
            return { success: true, data: batch2 };
          }),
        } as any));

        await testStore.dispatch(fetchAllMessages({ channelId: 'ch-1', token: 'token' }));

        expect(snapshots[0]).toBe(0);
        expect(snapshots[1]).toBe(100);
        expect(testStore.getState().message.messages).toHaveLength(150);
      });

      it('routes each appended page through getSortedMessages so the live view stays sorted', async () => {
        const { getSortedMessages } = await import('discrub-core/discrub-utils');
        const testStore = await buildStoreWithReactions(false, seedSearchActive());

        const page = searchShapedMessages(25);
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) return { success: true, data: { messages: [page], total_results: 25 } };
            return { success: true, data: { messages: [[]], total_results: 25 } };
          }),
        } as any));

        vi.mocked(getSortedMessages).mockClear();
        await testStore.dispatch(loadAllSearchResults({ channelId: 'ch-1', token: 'token' }));

        // appendLoadAllPage in the reducer + the fulfilled defensive sort
        // = at least 2 calls under the active order.
        const orderCalls = vi.mocked(getSortedMessages).mock.calls.map((c) => c[1]);
        expect(orderCalls.length).toBeGreaterThanOrEqual(2);
        expect(orderCalls.every((o) => o === 'desc')).toBe(true);
      });
    });
  });

  describe('#185 Bug A: transient retry on Load All thunks', () => {
    beforeEach(() => setOnline(false));
    afterEach(() => setOnline(true));

    // Pause-on-exhaustion + 4xx fail-fast contract for the two Load All
    // sites (channel + search). Mocks return controlled fail/success
    // sequences; pause behavior is verified via app.discrubPaused state.

    const buildStore = async (messageState = initialMessageState) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings, setDiscrubPaused, setDiscrubCancelled } =
        await import('@features/app/appSlice');
      const store = configureStore({
        reducer: { message: messageReducer, app: appReducer },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            previewThemeId: null,
            settings: defaultSettings,
          },
          message: messageState,
        },
      });
      return { store, setDiscrubPaused, setDiscrubCancelled };
    };

    const seedSearchActive = (): typeof initialMessageState => ({
      ...initialMessageState,
      searchCriteria: { content: 'x' } as any,
      pagination: {
        ...initialMessageState.pagination,
        mode: 'search' as const,
        searchOffset: 0,
        totalCount: 0,
        hasMore: true,
      },
    });

    describe('fetchAllMessages (Site 1)', () => {
      it('retries transient failures then completes with all messages', async () => {
        const batch = createMockMessages(10);
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchMessageData: vi
            .fn()
            .mockResolvedValueOnce({ success: false, status: undefined })
            .mockResolvedValueOnce({ success: false, status: 503 })
            .mockResolvedValueOnce({ success: true, data: batch }),
        } as any);
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore();
        const result = await store.dispatch(
          fetchAllMessages({ channelId: 'ch-1', token: 'token' }),
        );

        expect(result.type).toBe('message/fetchAllMessages/fulfilled');
        expect((result.payload as any).messages).toHaveLength(10);

        const retryEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /retrying in/.test(p.message),
        );
        expect(retryEntries).toHaveLength(2);
      });

      it('#266: the retry lines say what Discord answered', async () => {
        setOnline(false);
        const batch = createMockMessages(10);
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchMessageData: vi
            .fn()
            .mockResolvedValueOnce({ success: false, status: undefined })
            .mockResolvedValueOnce({ success: false, status: 503 })
            .mockResolvedValueOnce({ success: true, data: batch }),
        } as any);
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore();
        await store.dispatch(fetchAllMessages({ channelId: 'ch-1', token: 'token' }));

        const lines = vi.mocked(addStatusEntry).mock.calls
          .map(([p]) => p.message)
          .filter((m) => /retrying in/.test(m));
        expect(lines).toEqual([
          'Load All: Discord did not answer, retrying in 1s (attempt 1/5)',
          'Load All: Discord answered HTTP 503, retrying in 1s (attempt 2/5)',
        ]);
      });

      it('#266: the paused line names the last answer', async () => {
        setOnline(false);
        const { waitWhilePaused, checkCancelled } = await import('@/utils/operationLoopUtils');
        vi.mocked(checkCancelled).mockImplementation((getState: any) => getState().app.discrubCancelled);
        vi.mocked(waitWhilePaused).mockImplementation(async (getState: any) => {
          while (getState().app.discrubPaused) {
            await new Promise((r) => setTimeout(r, 10));
            if (getState().app.discrubCancelled) return;
          }
        });
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchMessageData: vi.fn().mockResolvedValue({ success: false, status: 502 }),
        } as any);
        vi.mocked(addStatusEntry).mockClear();

        const { store, setDiscrubCancelled } = await buildStore();
        const pending = store.dispatch(fetchAllMessages({ channelId: 'ch-1', token: 'token' }));
        for (let i = 0; i < 400 && !store.getState().app.discrubPaused; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(store.getState().app.discrubPaused).toBe(true);
        const paused = vi.mocked(addStatusEntry).mock.calls.map(([p]) => p.message).find((m) => /paused after/.test(m));
        expect(paused).toBe('Load All: paused after 5 failed retries. Discord answered HTTP 502. Wait a bit, then Resume to continue from 0 loaded.');
        store.dispatch(setDiscrubCancelled(true));
        await pending;
      }, 20000);

      it('#266: a refused Load All rejects with the HTTP status', async () => {
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchMessageData: vi.fn().mockResolvedValue({ success: false, status: 403 }),
        } as any);

        const { store } = await buildStore();
        const result = await store.dispatch(fetchAllMessages({ channelId: 'ch-1', token: 'token' }));

        expect(result.type).toBe('message/fetchAllMessages/rejected');
        expect(result.payload).toBe('Failed to fetch all messages (HTTP 403)');
        expect(store.getState().message.error).toBe('Failed to fetch all messages (HTTP 403)');
      });

      it('online: a status-less failure stops after two quick retries instead of pausing (GH #14)', async () => {
        setOnline(true);
        const batch = createMockMessages(100);
        const fetchMessageData = vi
          .fn()
          .mockResolvedValueOnce({ success: true, data: batch })
          .mockResolvedValue({ success: false, status: undefined });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchMessageData } as any);
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore();
        const result = await store.dispatch(fetchAllMessages({ channelId: 'ch-1', token: 'token' }));

        // One page, then the failing page plus ONLINE_NETWORK_RETRIES retries, then out.
        expect(fetchMessageData).toHaveBeenCalledTimes(1 + 1 + 2);
        expect(store.getState().app.discrubPaused).toBe(false);
        expect(result.type).toBe('message/fetchAllMessages/rejected');
        const messages = vi.mocked(addStatusEntry).mock.calls.map(([p]: any) => p.message);
        expect(messages.some((m: string) => /paused after 5 failed retries/.test(m))).toBe(false);
      });

      it('pauses the operation after retries are exhausted, preserves partial progress', async () => {
        const { waitWhilePaused, checkCancelled } = await import('@/utils/operationLoopUtils');
        // Real-state-aware overrides for this test only — the file-wide stubs
        // would otherwise make waitWhilePaused a no-op + checkCancelled always
        // false, which would let the post-pause loop spin forever.
        vi.mocked(checkCancelled).mockImplementation(
          (getState: any) => getState().app.discrubCancelled,
        );
        vi.mocked(waitWhilePaused).mockImplementation(async (getState: any) => {
          while (getState().app.discrubPaused) {
            await new Promise((r) => setTimeout(r, 10));
            if (getState().app.discrubCancelled) return;
          }
        });

        const batch = createMockMessages(100);
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchMessageData: vi
            .fn()
            .mockResolvedValueOnce({ success: true, data: batch })
            .mockResolvedValue({ success: false, status: undefined }),
        } as any);
        vi.mocked(addStatusEntry).mockClear();

        const { store, setDiscrubCancelled } = await buildStore();
        const pendingDispatch = store.dispatch(
          fetchAllMessages({ channelId: 'ch-1', token: 'token' }),
        );

        const waitForPause = async () => {
          for (let i = 0; i < 200; i++) {
            if (store.getState().app.discrubPaused) return;
            await new Promise((r) => setTimeout(r, 20));
          }
        };
        await waitForPause();
        expect(store.getState().app.discrubPaused).toBe(true);

        store.dispatch(setDiscrubCancelled(true));
        const result = await pendingDispatch;

        // After cancel, fetchAllMessages breaks the loop and fulfills with
        // whatever partial allMessages it had — that's the trust signal.
        expect(result.type).toBe('message/fetchAllMessages/fulfilled');
        expect((result.payload as any).messages).toHaveLength(100);

        const pauseEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /paused after 5 failed retries/.test(p.message),
        );
        expect(pauseEntries.length).toBeGreaterThanOrEqual(1);
        expect(pauseEntries[0][0].message).toContain('from 100 loaded');

        // Reset overrides so other tests see the default stubs.
        vi.mocked(checkCancelled).mockReturnValue(false);
        vi.mocked(waitWhilePaused).mockResolvedValue(undefined);
      }, 10000);

      it('rejects immediately on permanent 4xx without any retry', async () => {
        const fetchSpy = vi
          .fn()
          .mockResolvedValue({ success: false, status: 404 });
        vi.mocked(discordService.getDiscordService).mockReturnValue({
          fetchMessageData: fetchSpy,
        } as any);
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore();
        const result = await store.dispatch(
          fetchAllMessages({ channelId: 'ch-1', token: 'token' }),
        );

        expect(result.type).toBe('message/fetchAllMessages/rejected');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(store.getState().app.discrubPaused).toBe(false);

        const retryEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /retrying in/.test(p.message),
        );
        expect(retryEntries).toHaveLength(0);
      });
    });

    describe('loadAllSearchResults (Site 2)', () => {
      it('retries transient failures then completes with all messages', async () => {
        const page = createMockMessages(25);
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi
            .fn()
            .mockResolvedValueOnce({ success: false, status: 502 })
            .mockResolvedValueOnce({ success: true, data: { messages: [page], total_results: 25 } })
            .mockResolvedValue({ success: true, data: { messages: [[]], total_results: 25 } }),
        } as any));
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore(seedSearchActive());
        const result = await store.dispatch(
          loadAllSearchResults({ channelId: 'ch-1', token: 'token' }),
        );

        expect(result.type).toBe('message/loadAllSearchResults/fulfilled');
        expect(store.getState().message.messages).toHaveLength(25);

        const retryEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /Search Load All: Discord answered HTTP 502, retrying/.test(p.message),
        );
        expect(retryEntries).toHaveLength(1);
      });

      it('waits the Retry wait setting before the first retry (#265)', async () => {
        const page = createMockMessages(25);
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi
            .fn()
            .mockResolvedValueOnce({ success: false, status: 502 })
            .mockResolvedValueOnce({ success: false, status: 502 })
            .mockResolvedValueOnce({ success: true, data: { messages: [page], total_results: 25 } })
            .mockResolvedValue({ success: true, data: { messages: [[]], total_results: 25 } }),
        } as any));
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore(seedSearchActive());
        const { setSettings, defaultSettings } = await import('@features/app/appSlice');
        const { DiscrubSetting } = await import('discrub-core/discrub-enum');
        store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.RETRY_WAIT]: '2' }));
        const result = await store.dispatch(
          loadAllSearchResults({ channelId: 'ch-1', token: 'token' }),
        );

        expect(result.type).toBe('message/loadAllSearchResults/fulfilled');
        const retryMessages = vi.mocked(addStatusEntry).mock.calls
          .map(([p]) => p.message)
          .filter((m) => /Search Load All: Discord answered HTTP 502, retrying/.test(m));
        expect(retryMessages).toEqual([
          'Search Load All: Discord answered HTTP 502, retrying in 2s (attempt 1/5)',
          'Search Load All: Discord answered HTTP 502, retrying in 4s (attempt 2/5)',
        ]);
      });

      it('pauses the operation after retries are exhausted, preserves partial progress', async () => {
        const { waitWhilePaused, checkCancelled } = await import('@/utils/operationLoopUtils');
        vi.mocked(checkCancelled).mockImplementation(
          (getState: any) => getState().app.discrubCancelled,
        );
        vi.mocked(waitWhilePaused).mockImplementation(async (getState: any) => {
          while (getState().app.discrubPaused) {
            await new Promise((r) => setTimeout(r, 10));
            if (getState().app.discrubCancelled) return;
          }
        });

        const page = createMockMessages(25);
        let call = 0;
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: vi.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
              return { success: true, data: { messages: [page], total_results: 100 } };
            }
            return { success: false, status: undefined };
          }),
        } as any));
        vi.mocked(addStatusEntry).mockClear();

        const { store, setDiscrubCancelled } = await buildStore(seedSearchActive());
        const pendingDispatch = store.dispatch(
          loadAllSearchResults({ channelId: 'ch-1', token: 'token' }),
        );

        const waitForPause = async () => {
          for (let i = 0; i < 200; i++) {
            if (store.getState().app.discrubPaused) return;
            await new Promise((r) => setTimeout(r, 20));
          }
        };
        await waitForPause();
        expect(store.getState().app.discrubPaused).toBe(true);

        store.dispatch(setDiscrubCancelled(true));
        const result = await pendingDispatch;

        expect(result.type).toBe('message/loadAllSearchResults/rejected');
        expect(store.getState().message.messages).toHaveLength(25);

        const pauseEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /Search Load All: paused after 5 failed retries/.test(p.message),
        );
        expect(pauseEntries.length).toBeGreaterThanOrEqual(1);
        expect(pauseEntries[0][0].message).toContain('from 25 loaded');

        vi.mocked(checkCancelled).mockReturnValue(false);
        vi.mocked(waitWhilePaused).mockResolvedValue(undefined);
      }, 10000);

      it('rejects immediately on permanent 4xx without any retry', async () => {
        const fetchSpy = vi
          .fn()
          .mockResolvedValue({ success: false, status: 401 });
        vi.mocked(discordService.getDiscordService).mockReturnValue(makeSearchService({
          fetchSearchMessageData: fetchSpy,
        } as any));
        vi.mocked(addStatusEntry).mockClear();

        const { store } = await buildStore(seedSearchActive());
        const result = await store.dispatch(
          loadAllSearchResults({ channelId: 'ch-1', token: 'token' }),
        );

        expect(result.type).toBe('message/loadAllSearchResults/rejected');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(store.getState().app.discrubPaused).toBe(false);

        const retryEntries = vi.mocked(addStatusEntry).mock.calls.filter(
          ([p]) => p.level === 'warning' && /retrying in/.test(p.message),
        );
        expect(retryEntries).toHaveLength(0);
      });
    });
  });


  describe('feeds the package deleted cache (#271)', () => {
    const buildStore = async (channelIds: string[]) => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const packageReducer = (await import('@features/package/packageSlice')).default;
      const { initialPackageState } = await import('@features/package/packageSlice');
      const { storage } = await import('@/extension/storage');
      await storage.package.clear();
      return configureStore({
        reducer: { message: messageReducer, app: appReducer, package: packageReducer },
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: { ...defaultSettings, deleteDelay2: '0' },
            previewThemeId: null,
          } as never,
          package: {
            ...initialPackageState,
            parsed: {
              user: { id: 'pkg-user', username: 'tester', globalName: null, avatarHash: null },
              guilds: [],
              channels: channelIds.map((id) => ({ id, type: 0, name: id, guildId: 'g', guildName: 'g', messageCount: 3, isOrphan: false })),
              totalMessages: 3,
              packageSizeBytes: 1,
            } as never,
          },
          message: initialMessageState,
        },
      });
    };

    it('deleteMessages records confirmed deletions for a held channel', async () => {
      const { storage } = await import('@/extension/storage');
      const mockDiscordService = {
        deleteMessage: vi.fn().mockImplementation(async (_t: string, id: string) => ({ success: id !== 'm2' })),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      const appStore = await buildStore(['ch-1']);

      await appStore.dispatch(
        deleteMessages({
          messages: [createMockMessage({ id: 'm1' }), createMockMessage({ id: 'm2' }), createMockMessage({ id: 'm3' })],
          channelId: 'ch-1',
          token: 'token',
        }),
      );

      expect(appStore.getState().package.deletedMessageIds['ch-1']).toEqual(['m1', 'm3']);
      expect(await storage.package.get('deleted:pkg-user')).toEqual({ 'ch-1': ['m1', 'm3'] });
    });

    it('deleteMessage records a single deletion for a held channel and ignores others', async () => {
      const mockDiscordService = { deleteMessage: vi.fn().mockResolvedValue({ success: true }) };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
      const appStore = await buildStore(['ch-1']);

      await appStore.dispatch(deleteMessage({ messageId: 'm9', channelId: 'ch-1', token: 'token' }));
      await appStore.dispatch(deleteMessage({ messageId: 'm10', channelId: 'elsewhere', token: 'token' }));

      expect(appStore.getState().package.deletedMessageIds).toEqual({ 'ch-1': ['m9'] });
    });
  });
});
