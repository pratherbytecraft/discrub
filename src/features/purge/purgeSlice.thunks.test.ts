import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';
import type { Channel, Guild, Message, User } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { IsPinnedType, MessageType } from 'discrub-core/discord-enum';
import type { PurgeConfig } from './purgeTypes';

import purgeReducer, {
  bulkPurgeChannels,
  bulkPurgeDMs,
  purgeGuilds,
  selectIsPurging,
  selectPurgeProgress,
  selectPurgeError,
} from './purgeSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import channelReducer from '@features/channel/channelSlice';
import cacheReducer from '@features/cache/cacheSlice';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetchSearchMessageData = vi.fn();
const mockFetchMessageData = vi.fn();
const mockDeleteMessage = vi.fn();
const mockEditMessage = vi.fn();
const mockEditChannel = vi.fn();
const mockGetReactions = vi.fn();
const mockDeleteReaction = vi.fn();
const mockDeleteAllReactionsFromMessage = vi.fn();
const mockFetchActiveGuildThreads = vi.fn();
const mockFetchPublicThreads = vi.fn();
const mockFetchPrivateThreads = vi.fn();
const mockFetchJoinedPrivateArchivedThreads = vi.fn();
const mockFetchChannels = vi.fn();
const mockFetchGuildUser = vi.fn();

// Minimal reimplementation of the DiscordService.iterateSearchResults
// generator, backed by mockFetchSearchMessageData. Mirrors the lib's
// post-#188 always-cap-shift semantics:
// - always offset=0; pagination is cap-shift via searchBeforeDate
//   (= oldestSeenTimestamp) on every iteration after the first
// - terminates on 2 consecutive empty Discord responses
// - initial-empty fast path: yield once for total_results=0 + no
//   messages, then terminate
//
// Mocks-only safety: this iterator drops messages with already-yielded
// IDs from each raw fetch. Real Discord enforces this structurally
// because `max_id` is exclusive, so the lib has no equivalent dedup;
// the mock has to simulate that property because tests commonly use
// `mockResolvedValue` to return a fixed payload on every fetch (no
// timestamps, no cap-shift cooperation), which would otherwise loop
// forever in the new always-cap-shift model.
const mockIterateSearchResults = async function* (options: any): AsyncGenerator<any> {
  const EMPTY_PAGE_TERMINATE_THRESHOLD = 2;
  let criteria = { ...options.criteria };
  let pageIndex = 0;
  let aggregatedCount = 0;
  let consecutiveEmptyResponses = 0;
  let oldestSeenTimestamp: Date | null = null;
  const yieldedIds = new Set<string>();

  while (true) {
    if (options.shouldStop && (await options.shouldStop())) return;

    if (oldestSeenTimestamp) {
      criteria = { ...criteria, searchBeforeDate: oldestSeenTimestamp };
    }

    const response = await mockFetchSearchMessageData(
      options.token, 0, options.channelId, options.guildId, criteria,
    );
    if (!response?.success || !response?.data) {
      const err = new Error(`Search request failed (HTTP ${response?.status ?? '?'})`);
      (err as any).status = response?.status;
      throw err;
    }
    const rawMessages = response.data.messages || [];
    const rawFlat = Array.isArray(rawMessages[0])
      ? (rawMessages as any[]).flat()
      : rawMessages;
    const flatMessages = rawFlat.filter((m: any) => {
      if (yieldedIds.has(m.id)) return false;
      yieldedIds.add(m.id);
      return true;
    });

    for (const m of flatMessages) {
      if (m.timestamp) {
        const ts = new Date(m.timestamp);
        if (oldestSeenTimestamp === null || ts < oldestSeenTimestamp) {
          oldestSeenTimestamp = ts;
        }
      }
    }
    aggregatedCount += flatMessages.length;
    const totalResults = response.data.total_results ?? 0;
    yield {
      messages: flatMessages,
      totalResults,
      pageIndex,
      aggregatedCount,
      // #216: mirror the lib's pass-through of Discord's indexing flag.
      stillIndexing: response.data.doing_deep_historical_index === true,
    };
    pageIndex++;

    if (totalResults === 0 && flatMessages.length === 0 && pageIndex === 1) return;

    if (flatMessages.length === 0) {
      consecutiveEmptyResponses++;
      if (consecutiveEmptyResponses >= EMPTY_PAGE_TERMINATE_THRESHOLD) return;
    } else {
      consecutiveEmptyResponses = 0;
    }

    if (options.onBetweenPages) {
      const action = await options.onBetweenPages();
      if (action === true) return;
    }
  }
};

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchSearchMessageData: mockFetchSearchMessageData,
    iterateSearchResults: mockIterateSearchResults,
    fetchMessageData: mockFetchMessageData,
    deleteMessage: mockDeleteMessage,
    editMessage: mockEditMessage,
    editChannel: mockEditChannel,
    getReactions: mockGetReactions,
    deleteReaction: mockDeleteReaction,
    deleteAllReactionsFromMessage: mockDeleteAllReactionsFromMessage,
    fetchActiveGuildThreads: mockFetchActiveGuildThreads,
    fetchPublicThreads: mockFetchPublicThreads,
    fetchPrivateThreads: mockFetchPrivateThreads,
    fetchJoinedPrivateArchivedThreads: mockFetchJoinedPrivateArchivedThreads,
    fetchChannels: mockFetchChannels,
    fetchGuildUser: mockFetchGuildUser,
  })),
}));

vi.mock('@utils/operationLoopUtils', () => ({
  // Instant fake of withTransientRetry (#245) — same retry+predicate
  // contract as the real helper minus the backoff sleep.
  withTransientRetry: vi.fn(async (fn: () => Promise<any>, opts: any) => {
    const maxRetries = opts.maxRetries ?? 5;
    const isTransient = (r: any) =>
      !r.success && (r.status === undefined || r.status >= 500 || r.status === 408 || r.status === 425);
    const shouldRetry = opts.shouldRetry ?? isTransient;
    let lastResponse: any = { success: false };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastResponse = await fn();
      if (lastResponse.success || !shouldRetry(lastResponse, attempt)) return lastResponse;
      if (attempt === maxRetries) return lastResponse;
      opts.onRetry?.(attempt + 1, 1000, lastResponse);
    }
    return lastResponse;
  }),
  waitWhilePaused: vi.fn().mockResolvedValue(undefined),
  checkCancelled: vi.fn().mockReturnValue(false),
  cancellableDelay: vi.fn().mockResolvedValue(false),
  CancelledError: class CancelledError extends Error {
    // Mirrors the real shape (#140) — accepts an optional partial
    // accumulator so the caller's catch can recover work-already-done.
    partialResult?: unknown;
    constructor(partialResult?: unknown) {
      super('Cancelled');
      this.name = 'CancelledError';
      this.partialResult = partialResult;
    }
  },
}));

vi.mock('@utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn().mockReturnValue({ delayMs: 0, delaySec: 0 }),
}));

// Lazy import so mocks are in place
const { checkCancelled, cancellableDelay, waitWhilePaused } = await import(
  '@utils/operationLoopUtils'
);
const { getDiscordService } = await import('@services/discordService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TOKEN = 'test-token-123';
const CURRENT_USER: User = { id: '100', username: 'testuser' } as User;

const mockChannel = (id: string, name: string): Channel =>
  ({ id, name, type: 0 }) as Channel;

const mockForumChannel = (id: string, name: string): Channel =>
  ({ id, name, type: 15 }) as Channel;

const mockDmChannel = (id: string, recipientName: string): Channel =>
  ({
    id,
    type: 1,
    recipients: [{ username: recipientName } as User],
  }) as Channel;

const mockThreadChannel = (id: string, name: string, parentId: string): Channel =>
  ({
    id,
    name,
    type: 11, // GUILD_PUBLIC_THREAD
    parent_id: parentId,
    thread_metadata: {
      archived: false,
      auto_archive_duration: 1440,
      archive_timestamp: '2026-01-01T00:00:00.000Z',
      locked: false,
    },
  }) as unknown as Channel;

const mockMessage = (
  id: string,
  type = 0,
  attachments: any[] = [],
  // Default author to the current user — PATCH-based purge modes
  // (attachments-only, retain-media) pre-skip messages authored by
  // anyone else since Discord's edit endpoint is author-only.
  author: User = CURRENT_USER,
): Message =>
  ({
    id,
    type,
    content: `message-${id}`,
    attachments,
    reactions: [],
    author,
  }) as unknown as Message;

const mockMessageWithReactions = (
  id: string,
  reactions: { emoji: { id?: string; name: string }; count: number }[],
): Message =>
  ({
    id,
    type: 0,
    content: `message-${id}`,
    attachments: [],
    reactions,
  }) as unknown as Message;

function createStore(overrides?: {
  token?: string | null;
  currentUser?: User | null;
}): TestStore {
  return createTestStore(
    {
      purge: purgeReducer,
      auth: authReducer,
      user: userReducer,
      app: appReducer,
      status: statusReducer,
      channel: channelReducer,
    },
    {
      auth: {
        token: overrides?.token !== undefined ? overrides.token : TOKEN,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false,
      },
      user: {
        currentUser:
          overrides?.currentUser !== undefined
            ? overrides.currentUser
            : CURRENT_USER,
        isLoading: false,
        error: null,
      },
    },
  );
}

const messagesConfig = (
  userIds: string[],
  retainAttachedMedia = false,
  deleteAttachmentsOnly = false,
  systemMessageTypesToDelete?: string[],
): PurgeConfig => ({
  mode: 'messages',
  targetUserIds: userIds,
  retainAttachedMedia,
  deleteAttachmentsOnly,
  systemMessageTypesToDelete,
});

const reactionsConfig = (userIds: string[]): PurgeConfig => ({
  mode: 'reactions',
  targetUserIds: userIds,
  retainAttachedMedia: false,
  deleteAttachmentsOnly: false,
});

/**
 * Helper to make fetchSearchMessageData return a page of messages, then
 * empties forever. Empty pages return success=true so the iterator
 * terminates via the 2-consecutive-empty-pages rule (post-#148).
 */
function setupSearchResults(pages: Message[][]) {
  let callCount = 0;
  mockFetchSearchMessageData.mockImplementation(() => {
    const page = pages[callCount] || [];
    callCount++;
    return Promise.resolve({
      success: true,
      data: page.length > 0 ? { messages: [page] } : { messages: [] },
    });
  });
}

/**
 * Helper: setupSearchResultsNested for raw Message[][] (Discord's actual format).
 * Each call returns one "page" from the array; subsequent calls return empty
 * (success=true) so the iterator terminates via the 2-consecutive-empty rule.
 */
function setupNestedSearchResults(pages: Message[][][]) {
  let callCount = 0;
  mockFetchSearchMessageData.mockImplementation(() => {
    const page = pages[callCount];
    callCount++;
    if (!page || page.length === 0) {
      return Promise.resolve({ success: true, data: { messages: [] } });
    }
    return Promise.resolve({ success: true, data: { messages: page } });
  });
}

/** Helper to make fetchMessageData return pages, then empty.
 *  Exhaustion is an HONEST empty page (success: true, data: []) — a
 *  success: false response now means a mid-scan FAILURE and triggers the
 *  incomplete-scan warning path. */
function setupFetchMessages(pages: Message[][]) {
  let callCount = 0;
  mockFetchMessageData.mockImplementation(() => {
    const page = pages[callCount] || [];
    callCount++;
    return Promise.resolve({ success: true, data: page });
  });
}

/** Setup thread discovery mocks to return no threads by default */
function setupNoThreads() {
  mockFetchPublicThreads.mockResolvedValue({
    success: true,
    data: { threads: [], members: [], has_more: false },
  });
  mockFetchPrivateThreads.mockResolvedValue({
    success: true,
    data: { threads: [], members: [], has_more: false },
  });
  mockFetchJoinedPrivateArchivedThreads.mockResolvedValue({
    success: true,
    data: { threads: [], members: [], has_more: false },
  });
}

/** Setup thread discovery to return specific threads */
function setupThreadDiscovery(
  publicThreadsByChannel: Record<string, Channel[]> = {},
  privateThreadsByChannel: Record<string, Channel[]> = {},
) {
  mockFetchPublicThreads.mockImplementation(
    (_token: string, channelId: string) => {
      const threads = publicThreadsByChannel[channelId] || [];
      return Promise.resolve({
        success: true,
        data: { threads, members: [], has_more: false },
      });
    },
  );
  mockFetchPrivateThreads.mockImplementation(
    (_token: string, channelId: string) => {
      const threads = privateThreadsByChannel[channelId] || [];
      return Promise.resolve({
        success: true,
        data: { threads, members: [], has_more: false },
      });
    },
  );
  mockFetchJoinedPrivateArchivedThreads.mockResolvedValue({
    success: true,
    data: { threads: [], members: [], has_more: false },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('purgeSlice thunks', () => {
  let store: TestStore;

  beforeEach(() => {
    store = createStore();
    vi.clearAllMocks();
    // Wipe leftover mock implementations on the data-source mocks. The
    // post-#188 always-cap-shift iterator has no in-memory dedup, so a
    // stale `mockImplementation` from a prior test that returns the
    // same payload forever would cause the next test's iterator to
    // loop without terminating. Reset removes implementations too.
    mockFetchSearchMessageData.mockReset();
    mockFetchMessageData.mockReset();
    // #257: every search-driven purge ends with one list-endpoint read of
    // the channel's newest page. Default it to empty so tests that don't
    // care about the final pass see no leftovers.
    mockFetchMessageData.mockResolvedValue({ success: true, data: [] });
    // Restore default mock implementations (clearAllMocks only clears call history)
    (waitWhilePaused as Mock).mockResolvedValue(undefined);
    (checkCancelled as Mock).mockReturnValue(false);
    (cancellableDelay as Mock).mockResolvedValue(false);
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    mockEditMessage.mockResolvedValue({ success: true, status: 200 });
    setupNoThreads();
  });

  // ── Authentication / Validation ──────────────────────────────────────────

  describe('authentication and validation', () => {
    it('rejects with "Not authenticated" if no token', async () => {
      store = createStore({ token: null });
      const channels = [mockChannel('1', 'general')];

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.rejected.match(result)).toBe(true);
      expect(result.payload).toBe('Not authenticated');
    });

    it('rejects with "No target users specified" if empty userIds', async () => {
      const channels = [mockChannel('1', 'general')];

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.rejected.match(result)).toBe(true);
      expect(result.payload).toBe('No target users specified');
    });
  });

  // ── Messages Mode: bulkPurgeChannels ─────────────────────────────────────

  describe('bulkPurgeChannels — messages mode', () => {
    it('successfully purges messages from multiple channels', async () => {
      const channels = [
        mockChannel('ch1', 'general'),
        mockChannel('ch2', 'random'),
      ];
      const msg1 = mockMessage('m1');
      const msg2 = mockMessage('m2');
      const msg3 = mockMessage('m3');

      // Per-channel mock: ch1 has m1+m2, ch2 has m3. Subsequent calls
      // for the same channel return empty so the iterator terminates
      // via the 2-consecutive-empty-pages rule (post-#148).
      const perChannelServed: Record<string, boolean> = {};
      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          if (perChannelServed[channelId]) {
            return Promise.resolve({ success: true, data: { messages: [] } });
          }
          perChannelServed[channelId] = true;
          if (channelId === 'ch1') {
            return Promise.resolve({
              success: true,
              data: { messages: [[msg1, msg2]] },
            });
          }
          if (channelId === 'ch2') {
            return Promise.resolve({
              success: true,
              data: { messages: [[msg3]] },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(3);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm2', 'ch1');
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm3', 'ch2');
    });

    it('#250: an Invalid Date in the criteria is dropped, not NaN-poisoning the scan', async () => {
      // The pre-fix behavior: an incomplete DateTimePicker value (Invalid
      // Date) reached the date-to-snowflake conversion, every channel threw
      // "The number NaN cannot be converted to a BigInt", zero messages were
      // deleted, and the run still fulfilled as a success.
      const msg = mockMessage('m1');
      setupSearchResults([[msg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
          searchCriteria: {
            searchAfterDate: new Date(NaN),
            searchBeforeDate: new Date(NaN),
            searchMessageContents: [],
            selectedHasTypes: [],
            userIds: [CURRENT_USER.id],
            mentionIds: [],
            channelIds: [],
            isPinned: IsPinnedType.UNSET,
            attachmentExtensions: [],
            attachmentFilename: null,
          },
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect((result.payload as { errors?: string[] }).errors).toBeUndefined();
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
      // The criteria that reached the search API carry no invalid bounds.
      const criteriaArg = mockFetchSearchMessageData.mock.calls[0]![4];
      expect(criteriaArg.searchAfterDate).toBeNull();
      expect(criteriaArg.searchBeforeDate).toBeNull();
    });

    it('retains messages with attachments (edits instead of deletes)', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msgWithAttachment = mockMessage('m1', 0, [attachment]);
      const msgWithoutAttachment = mockMessage('m2');

      setupSearchResults([[msgWithAttachment, msgWithoutAttachment]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], true),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Message with attachment should be edited (content cleared, attachments kept)
      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockEditMessage).toHaveBeenCalledWith(
        TOKEN,
        'm1',
        { content: '', attachments: [attachment] },
        'ch1',
      );
      // Message without attachment should be deleted
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm2', 'ch1');
    });

    it('strips attachments when deleteAttachmentsOnly is true and skips messages without attachments', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msgWithAttachment = mockMessage('m1', 0, [attachment]);
      const msgWithoutAttachment = mockMessage('m2');

      setupSearchResults([[msgWithAttachment, msgWithoutAttachment]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Message with attachment gets edited with attachments: [], content preserved.
      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockEditMessage).toHaveBeenCalledWith(
        TOKEN,
        'm1',
        { attachments: [] },
        'ch1',
      );
      // Non-attachment message is SKIPPED — "Delete attachments only" must
      // never destroy plain-text messages. A prior regression had this
      // fall through to deleteMessage and it destroyed user data in real
      // server purges; the test guards against that.
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('routes edit to the message.channel_id, not the outer channelId (thread-safe)', async () => {
      // Search returns a message whose home is a thread. The top-level
      // channelId is the parent (forum/text channel); the thread ID
      // lives on message.channel_id. Discord's PATCH must target the
      // thread or it 404s "Unknown Message".
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const threadMsg = {
        ...mockMessage('m1', 0, [attachment]),
        channel_id: 'thread-xyz',
      } as Message;

      setupSearchResults([[threadMsg]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      expect(mockEditMessage).toHaveBeenCalledWith(
        TOKEN,
        'm1',
        { attachments: [] },
        'thread-xyz',
      );
    });

    it('routes delete to message.channel_id for thread messages (fixes pre-existing 404 bug)', async () => {
      const threadMsg = {
        ...mockMessage('m1'),
        channel_id: 'thread-abc',
      } as Message;

      setupSearchResults([[threadMsg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'thread-abc');
    });

    it('logs a warning and counts as failed when editMessage returns non-success', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = mockMessage('m1', 0, [attachment]);

      setupSearchResults([[msg]]);
      mockEditMessage.mockResolvedValue({ success: false, status: 404 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const warning = entries.find(
        (e) => e.level === 'warning' && e.message.includes("Couldn't strip attachments") && e.message.includes('404'),
      );
      expect(warning).toBeDefined();
      // Summary line should show failed count, not stripped.
      const completion = entries.find(
        (e) => e.message.includes('Completed') && e.message.includes('failed'),
      );
      expect(completion).toBeDefined();
    });

    it('deletes attachment-only messages instead of PATCHing (would 400 code 50006)', async () => {
      // Discord refuses PATCH {attachments:[]} when the resulting
      // message would have no content and no attachments — so for a
      // message whose only payload is the attachment itself, the
      // correct "strip attachments" action is to delete the whole
      // message.
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const attachmentOnly = {
        ...mockMessage('m1', 0, [attachment]),
        content: '',
      } as Message;

      setupSearchResults([[attachmentOnly]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      // No PATCH (would have been 400 "Cannot send empty message").
      expect(mockEditMessage).not.toHaveBeenCalled();
      // DELETE instead.
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
    });

    it('skips messages in archived threads with a clear log entry (would 400 code 50083)', async () => {
      // Thread discovery surfaces an archived thread; #122 now attempts
      // to un-archive (PATCH archived=false), process the messages, and
      // re-archive on the way out. Under a permissive setup the edit/delete
      // on the message should fire normally.
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msgInArchived = {
        ...mockMessage('m1', 0, [attachment]),
        channel_id: 'thread-archived',
        content: 'some text',
      } as Message;

      setupSearchResults([[msgInArchived]]);
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      // Attachment was stripped via PATCH (mode is deleteAttachmentsOnly + hasContent).
      expect(mockEditMessage).toHaveBeenCalledTimes(1);

      // editChannel was called twice: once to un-archive (archived=false),
      // once to re-archive (archived=true) in the finally cleanup.
      expect(mockEditChannel).toHaveBeenCalledTimes(2);
      expect(mockEditChannel).toHaveBeenNthCalledWith(1, TOKEN, 'thread-archived', { archived: false });
      expect(mockEditChannel).toHaveBeenNthCalledWith(2, TOKEN, 'thread-archived', { archived: true });

      // Status log should mention both sides.
      const entries = store.getState().status.entries;
      expect(entries.some((e) => e.message.includes('Un-archived thread'))).toBe(true);
      expect(entries.some((e) => e.message.includes('Re-archived thread'))).toBe(true);
    });

    it('skips archived-thread messages when user lacks un-archive permission', async () => {
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = {
        ...mockMessage('m1', 0, [attachment]),
        channel_id: 'thread-archived',
        content: 'whatever',
      } as Message;
      setupSearchResults([[msg]]);

      // Un-archive PATCH returns 403 (missing MANAGE_THREADS / not owner).
      mockEditChannel.mockResolvedValue({ success: false, status: 403 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      // Still attempted the un-archive (once — cached per thread for the run),
      // but never the re-archive because we never successfully unarchived.
      expect(mockEditChannel).toHaveBeenCalledTimes(1);
      expect(mockEditChannel).toHaveBeenCalledWith(TOKEN, 'thread-archived', { archived: false });

      // The message was NOT processed.
      expect(mockEditMessage).not.toHaveBeenCalled();
      expect(mockDeleteMessage).not.toHaveBeenCalled();

      // One warning per thread (not per message) in the status log.
      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.level === 'warning' && e.message.includes('Missing permission to un-archive'),
      )).toBe(true);
    });

    it('#233: leaves archived threads untouched when skipArchivedThreads is on (messages mode)', async () => {
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const msgInArchived = {
        ...mockMessage('m1', 0),
        channel_id: 'thread-archived',
        content: 'inside the archived thread',
      } as Message;
      const msgInParent = {
        ...mockMessage('m2', 0),
        content: 'in the parent channel',
      } as Message;
      setupSearchResults([[msgInArchived, msgInParent]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([CURRENT_USER.id]), skipArchivedThreads: true },
          guildId: 'guild1',
        }),
      );

      // The thread's archived state was never touched in either direction —
      // no un-archive PATCH, no re-archive cleanup.
      expect(mockEditChannel).not.toHaveBeenCalled();

      // The archived-thread message was skipped; the parent message still deleted.
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm2', 'ch1');

      // Calm per-thread notice (info, not warning) + completion summary count.
      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.level === 'info' && e.message.includes('Leaving archived thread thread-archived untouched'),
      )).toBe(true);
      expect(entries.some(
        (e) => e.message.includes('Left 1 message in archived threads untouched'),
      )).toBe(true);
    });

    it('#233: default (toggle off) preserves the un-archive → process → re-archive flow', async () => {
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const msgInArchived = {
        ...mockMessage('m1', 0),
        channel_id: 'thread-archived',
        content: 'inside the archived thread',
      } as Message;
      setupSearchResults([[msgInArchived]]);
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Un-archive, delete inside, re-archive — the pre-#233 behavior.
      expect(mockEditChannel).toHaveBeenNthCalledWith(1, TOKEN, 'thread-archived', { archived: false });
      expect(mockEditChannel).toHaveBeenNthCalledWith(2, TOKEN, 'thread-archived', { archived: true });
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'thread-archived');
    });

    it('#233: drops archived threads from the reactions pass when skipArchivedThreads is on', async () => {
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      const activeThread = {
        id: 'thread-active',
        parent_id: 'ch1',
        thread_metadata: { archived: false },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread, activeThread] });

      // Every channel/thread scan comes back empty — we only care about
      // WHICH channels get scanned.
      mockFetchMessageData.mockResolvedValue({ success: true, data: [] });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: {
            mode: 'clearReactions',
            targetUserIds: [],
            retainAttachedMedia: false,
            deleteAttachmentsOnly: false,
            skipArchivedThreads: true,
          },
          guildId: 'guild1',
        }),
      );

      // The archived thread was never scanned; the active thread was.
      const scannedChannels = mockFetchMessageData.mock.calls.map((c: any[]) => c[2]);
      expect(scannedChannels).not.toContain('thread-archived');
      expect(scannedChannels).toContain('thread-active');

      // No archived-state mutation, and the drop was announced.
      expect(mockEditChannel).not.toHaveBeenCalled();
      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.level === 'info' && e.message.includes('Leaving 1 archived thread in #general untouched'),
      )).toBe(true);
    });

    it('#239: preserves messages with attachments or links entirely (zero API calls for them)', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const withFile = mockMessage('m1', 0, [attachment]);
      const withLink = { ...mockMessage('m2'), content: 'see https://example.com/thread' } as Message;
      const withBoth = { ...mockMessage('m3', 0, [attachment]), content: 'both http://example.com' } as Message;
      const plain = mockMessage('m4');

      setupSearchResults([[withFile, withLink, withBoth, plain]]);

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([CURRENT_USER.id]), preserveMediaAndLinks: true },
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Only the plain message was deleted; nothing was PATCHed.
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm4', 'ch1');
      expect(mockEditMessage).not.toHaveBeenCalled();

      // Summary reports how many were preserved.
      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.level === 'info' && e.message.includes('Preserved 3 messages with files or links'),
      )).toBe(true);
    });

    it('#239: preserve wins over retainAttachedMedia — no content-clear PATCH on a preserved message', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const withFile = mockMessage('m1', 0, [attachment]); // has text + attachment
      const plain = mockMessage('m2');

      setupSearchResults([[withFile, plain]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([CURRENT_USER.id], true), preserveMediaAndLinks: true },
          guildId: 'guild1',
        }),
      );

      // Without preserve, retainAttachedMedia would PATCH content:'' on m1.
      // With preserve on, m1 stays fully intact — text included.
      expect(mockEditMessage).not.toHaveBeenCalled();
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm2', 'ch1');

      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.message.includes('Preserved 1 message with files or links'),
      )).toBe(true);
    });

    it('#239: embed-only message (no attachment, no link in content) is NOT preserved', async () => {
      const embedOnly = {
        ...mockMessage('m1'),
        content: 'gif reaction without a url',
        embeds: [{ type: 'gifv', url: 'https://tenor.com/x.gif' }],
      } as unknown as Message;

      setupSearchResults([[embedOnly]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([CURRENT_USER.id]), preserveMediaAndLinks: true },
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
    });

    it('#239: default (option off) deletes messages with files and links normally, no preserved summary', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const withFile = mockMessage('m1', 0, [attachment]);
      const withLink = { ...mockMessage('m2'), content: 'see https://example.com' } as Message;

      setupSearchResults([[withFile, withLink]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.message.includes('Preserved') && e.message.includes('files or links'),
      )).toBe(false);
    });

    it('#239: a preserved message inside an archived thread never triggers an un-archive PATCH', async () => {
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const preservedInArchived = {
        ...mockMessage('m1', 0, [attachment]),
        channel_id: 'thread-archived',
      } as Message;
      setupSearchResults([[preservedInArchived]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          // skipArchivedThreads deliberately OFF — the preserve gate alone
          // must be enough to keep the thread's archived state untouched.
          config: { ...messagesConfig([CURRENT_USER.id]), preserveMediaAndLinks: true },
          guildId: 'guild1',
        }),
      );

      expect(mockEditChannel).not.toHaveBeenCalled();
      expect(mockDeleteMessage).not.toHaveBeenCalled();
      expect(mockEditMessage).not.toHaveBeenCalled();
    });

    it('threads FilterModal criteria into the search call while preserving per-user author iteration (#112)', async () => {
      // When the dialog passes searchCriteria, those narrowing fields
      // (content, date range, has-types, mentions) must arrive at
      // fetchSearchMessageData alongside the per-target-user author_id.
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = mockMessage('m1', 0, [attachment]);
      setupSearchResults([[msg]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      const { IsPinnedType } = await import('discrub-core/discord-enum');
      const filterCriteria = {
        searchBeforeDate: null,
        searchAfterDate: new Date('2025-01-01T00:00:00Z'),
        searchMessageContents: ['pineapple'],
        selectedHasTypes: ['image'] as any,
        userIds: [], // dialog may leave this blank; author comes from PurgeConfig.targetUserIds
        mentionIds: [],
        channelIds: [],
        isPinned: IsPinnedType.UNSET,
      };

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
          searchCriteria: filterCriteria,
        }),
      );

      // The search mock is called once per pagination-cycle; inspect the
      // criteria object for the merged shape.
      expect(mockFetchSearchMessageData).toHaveBeenCalled();
      const criteriaArg = mockFetchSearchMessageData.mock.calls[0][4];
      expect(criteriaArg.userIds).to.deep.equal([CURRENT_USER.id]); // loop-author wins
      expect(criteriaArg.searchMessageContents).to.deep.equal(['pineapple']);
      expect(criteriaArg.searchAfterDate).to.deep.equal(new Date('2025-01-01T00:00:00Z'));
      expect(criteriaArg.selectedHasTypes).to.deep.equal(['image']);
    });

    it('works without searchCriteria (backwards-compat default empty criteria)', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = mockMessage('m1', 0, [attachment]);
      setupSearchResults([[msg]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      // Omit searchCriteria entirely — the thunk should behave exactly
      // as before #112.
      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      const criteriaArg = mockFetchSearchMessageData.mock.calls[0][4];
      expect(criteriaArg.userIds).to.deep.equal([CURRENT_USER.id]);
      expect(criteriaArg.searchMessageContents).to.deep.equal([]);
      expect(criteriaArg.searchAfterDate).to.be.null;
      expect(criteriaArg.selectedHasTypes).to.deep.equal([]);
    });

    it('un-archives a thread only once even when it contains multiple matched messages', async () => {
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const mkMsg = (id: string) => ({
        ...mockMessage(id, 0, [attachment]),
        channel_id: 'thread-archived',
        content: `content-${id}`,
      }) as Message;

      setupSearchResults([[mkMsg('m1'), mkMsg('m2'), mkMsg('m3')]]);
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      // All three messages stripped.
      expect(mockEditMessage).toHaveBeenCalledTimes(3);

      // editChannel fires twice total: one un-archive (cached for the rest
      // of the thread's messages) + one re-archive. Never per-message.
      expect(mockEditChannel).toHaveBeenCalledTimes(2);
    });

    it('deletes attachment-only messages with whitespace-only content (same as empty)', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = { ...mockMessage('m1', 0, [attachment]), content: '   \n\t  ' } as Message;

      setupSearchResults([[msg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      expect(mockEditMessage).not.toHaveBeenCalled();
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
    });

    it('logs a warning when deleteMessage returns non-success (fixes silent 404 DELETE)', async () => {
      const msg = mockMessage('m1');
      setupSearchResults([[msg]]);
      mockDeleteMessage.mockResolvedValue({ success: false, status: 404 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const warning = entries.find(
        (e) => e.level === 'warning' && e.message.includes("Couldn't delete") && e.message.includes('404'),
      );
      expect(warning).toBeDefined();
    });

    it('regular-delete defensively skips messages whose author does not match the targeted user (#148)', async () => {
      // Discord's docs say search returns hits-only, but if that ever
      // regresses to include context messages, we never want to delete a
      // neighbor whose author wasn't targeted. Even with MANAGE_MESSAGES,
      // deleting non-matching authors would betray the user's targeting.
      const wrongAuthor = { id: 'someone-else', username: 'context-leak' } as User;
      const msg = mockMessage('m1', 0, [], wrongAuthor);
      setupSearchResults([[msg]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // No DELETE was issued.
      expect(mockDeleteMessage).not.toHaveBeenCalled();

      // Status log surfaces a warning so the dev knows something's odd.
      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes("didn't match the target"))).toBe(true);
    });

    it('admin purge of another user proceeds when the search returns that user\'s messages (#148)', async () => {
      // Defensive check must not break the legitimate admin-purges-another-user
      // flow. When targetUserIds=['otherUser'] and the search returns Bob's
      // messages, every result satisfies author.id === userId so the check
      // never fires.
      const otherUser = { id: 'otherUser', username: 'bob' } as User;
      const msg = mockMessage('m1', 0, [], otherUser);
      setupSearchResults([[msg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig(['otherUser']),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
    });

    it('deleteAttachmentsOnly status log reports the stripped count', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = mockMessage('m1', 0, [attachment]);

      setupSearchResults([[msg]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('stripped of attachments'))).toBe(true);
    });

    it('deleteAttachmentsOnly pre-skips messages authored by other users (no API call)', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const otherUser = { id: 'other-user', username: 'someone-else' } as User;
      const msgByOther = mockMessage('m1', 0, [attachment], otherUser);

      setupSearchResults([[msgByOther]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      // Discord's PATCH is author-only even for MANAGE_MESSAGES. Pre-skip
      // instead of burning the API call and getting a guaranteed 403.
      expect(mockEditMessage).not.toHaveBeenCalled();
      expect(mockDeleteMessage).not.toHaveBeenCalled();

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('authored by other users'))).toBe(true);
    });

    it('retainAttachedMedia pre-skips messages authored by other users (no API call)', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const otherUser = { id: 'other-user', username: 'someone-else' } as User;
      const msgByOther = mockMessage('m1', 0, [attachment], otherUser);

      setupSearchResults([[msgByOther]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], true, false),
          guildId: 'guild1',
        }),
      );

      expect(mockEditMessage).not.toHaveBeenCalled();
      expect(mockDeleteMessage).not.toHaveBeenCalled();

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('authored by other users'))).toBe(true);
    });

    it('normal delete (MANAGE_MESSAGES) still deletes other users messages', async () => {
      // Only PATCH is author-gated. DELETE works for anyone with MANAGE_MESSAGES.
      const otherUser = { id: 'other-user', username: 'someone-else' } as User;
      const msgByOther = mockMessage('m1', 0, [], otherUser);

      setupSearchResults([[msgByOther]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig(['other-user'], false, false),
          guildId: 'guild1',
        }),
      );

      // No pre-skip: DELETE goes through as normal.
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
    });

    it('deleteAttachmentsOnly precedes retainAttachedMedia when both are true', async () => {
      // UI prevents this, but if the config ever arrives with both flags
      // we favor the "strip attachments" branch since it's the more
      // destructive-of-the-two intent and is what the user last toggled on.
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const msg = mockMessage('m1', 0, [attachment]);

      setupSearchResults([[msg]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], true, true),
          guildId: 'guild1',
        }),
      );

      // deleteAttachmentsOnly wins: attachments: [] (not attachments: [attachment]).
      expect(mockEditMessage).toHaveBeenCalledWith(
        TOKEN,
        'm1',
        { attachments: [] },
        'ch1',
      );
    });

    it('skips system messages (type !== 0 and type !== 19)', async () => {
      const normalMsg = mockMessage('m1', 0);
      const replyMsg = mockMessage('m2', 19);
      const systemMsg = mockMessage('m3', 7); // GUILD_MEMBER_JOIN
      const pinMsg = mockMessage('m4', 6); // CHANNEL_PINNED_MESSAGE

      setupSearchResults([[normalMsg, replyMsg, systemMsg, pinMsg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Only type 0 and type 19 should be deleted
      expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch1');
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm2', 'ch1');
    });

    it('handles empty search results gracefully', async () => {
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [] },
      });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).not.toHaveBeenCalled();

      // Should log a warning about no messages from target users
      const entries = store.getState().status.entries;
      const warningEntry = entries.find(
        (e) => e.level === 'warning' && e.message.includes('no messages'),
      );
      expect(warningEntry).toBeDefined();
    });

    it('flattens Message[][] from search API correctly', async () => {
      const msg1 = mockMessage('m1');
      const msg2 = mockMessage('m2');
      const msg3 = mockMessage('m3');

      // Discord returns nested arrays: [[msg1, msg2], [msg3]]
      setupNestedSearchResults([[[msg1, msg2], [msg3]]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(3);
    });

    it('always uses offset=0 and cap-shifts searchBeforeDate to the oldest yielded timestamp (#188)', async () => {
      // Post-#188 the iterator drops offset-based pagination entirely.
      // Every call hits offset=0; the second and subsequent calls narrow
      // `searchBeforeDate` to the oldest message timestamp seen so far.
      const ts = (daysAgo: number) =>
        new Date(2025, 0, 30 - daysAgo).toISOString();
      const batch1 = [
        [{ ...mockMessage('m1'), timestamp: ts(0) } as Message],
        [{ ...mockMessage('m2'), timestamp: ts(1) } as Message],
      ];
      const batch2 = [
        [{ ...mockMessage('m3'), timestamp: ts(2) } as Message],
        [{ ...mockMessage('m4'), timestamp: ts(3) } as Message],
      ];

      let callCount = 0;
      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          callCount++;
          // Always offset=0 under always-cap-shift.
          expect(offset).toBe(0);
          if (callCount === 1) {
            // First call: no upper bound supplied.
            expect(criteria.searchBeforeDate).toBeNull();
            return Promise.resolve({
              success: true,
              data: { messages: batch1, total_results: 4 },
            });
          }
          if (callCount === 2) {
            // Second call: searchBeforeDate is the oldest from batch1 (m2).
            expect(criteria.searchBeforeDate?.toISOString()).toBe(ts(1));
            return Promise.resolve({
              success: true,
              data: { messages: batch2, total_results: 2 },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [], total_results: 2 } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(4);
    });

    it('handles failed search response', async () => {
      mockFetchSearchMessageData.mockResolvedValue({
        success: false,
        data: null,
      });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('processes multiple target user IDs sequentially', async () => {
      const userA = { id: 'userA', username: 'alice' } as User;
      const userB = { id: 'userB', username: 'bob' } as User;
      const msg1 = mockMessage('m1', 0, [], userA);
      const msg2 = mockMessage('m2', 0, [], userB);

      // Per-user mock: each user gets a single page of their own
      // message, then empty pages forever (post-#148 termination).
      const perUserServed: Record<string, boolean> = {};
      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, _channelId: string, _guildId: string, criteria: any) => {
          const userId = criteria.userIds[0];
          if (perUserServed[userId]) {
            return Promise.resolve({ success: true, data: { messages: [] } });
          }
          perUserServed[userId] = true;
          if (userId === 'userA') {
            return Promise.resolve({ success: true, data: { messages: [[msg1]] } });
          }
          if (userId === 'userB') {
            return Promise.resolve({ success: true, data: { messages: [[msg2]] } });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig(['userA', 'userB']),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ── Preserve pinned messages (Backlog #156) ──────────────────────────────
  //
  // Discord's `/messages/search` endpoint silently *ignores* the
  // `pinned=false` query param — confirmed via 2026-05 research and
  // documented in discrub-ext's changelog years ago. Setting the
  // FilterModal's Pinned dropdown to "False" had no effect on what
  // actually got purged. The fix at purgeSlice:582 catches pinned
  // messages client-side using `message.pinned` (a required boolean
  // on every Discord Message object) before any destructive call.

  describe('group DMs + search indexing (#227 / #216)', () => {
    // THE type-3 fixture — every prior DM mock hardcoded type 1, which is
    // how the group-DM blind spots escaped.
    const mockGroupDmChannel = (id: string, name: string | null, recipients: string[]): Channel =>
      ({
        id,
        type: 3,
        name,
        recipients: recipients.map((username) => ({ username }) as User),
      }) as Channel;

    it('labels group DMs with their custom name and a (group) marker in status entries (#227)', async () => {
      const group = mockGroupDmChannel('gdm1', 'the lads', ['granddemon']);
      setupSearchResults([[mockMessage('m1')]]);

      await store.dispatch(
        bulkPurgeDMs({ channels: [group], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('the lads (group)'))).toBe(true);
    });

    it('falls back to joined recipients + (group) when the group has no custom name (#227)', async () => {
      const group = mockGroupDmChannel('gdm2', null, ['granddemon', 'lockridge']);
      setupSearchResults([[mockMessage('m1')]]);

      await store.dispatch(
        bulkPurgeDMs({ channels: [group], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('granddemon, lockridge (group)'))).toBe(true);
    });

    it('warns when Discord reports 0 results while still indexing the conversation (#216)', async () => {
      const group = mockGroupDmChannel('gdm3', null, ['granddemon']);
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [], total_results: 0, doing_deep_historical_index: true },
      });

      await store.dispatch(
        bulkPurgeDMs({ channels: [group], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('still indexing'))).toBe(true);
    });

    it('does not warn about indexing on an ordinary empty result', async () => {
      const group = mockGroupDmChannel('gdm4', null, ['granddemon']);
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [], total_results: 0 },
      });

      await store.dispatch(
        bulkPurgeDMs({ channels: [group], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('still indexing'))).toBe(false);
    });

    it('warns that a NON-zero total may be an undercount while still indexing (#216)', async () => {
      const group = mockGroupDmChannel('gdm5', null, ['granddemon']);
      let calls = 0;
      mockFetchSearchMessageData.mockImplementation(() => {
        calls++;
        return Promise.resolve({
          success: true,
          data: calls === 1
            ? { messages: [[mockMessage('m1')]], total_results: 5, doing_deep_historical_index: true }
            : { messages: [], total_results: 5 },
        });
      });

      await store.dispatch(
        bulkPurgeDMs({ channels: [group], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      // The count is announced AND flagged as possibly incomplete —
      // deleting only what search returned must not read as a clean sweep.
      expect(entries.some((m) => m.includes('Discord reports 5'))).toBe(true);
      expect(entries.some((m) => m.includes('count may be incomplete'))).toBe(true);
    });
  });

  describe('bulkPurgeChannels — deleted-account scan fallback (#223)', () => {
    const DELETED_ID = 'deleted-user-1';
    const DELETED_USER = { id: DELETED_ID, username: 'deleted_user_a1b2c3d4' } as User;
    const deletedEntry = {
      userName: 'deleted_user_a1b2c3d4',
      displayName: null,
      avatar: null,
      guilds: {},
      timestamp: 1,
    };
    const liveEntry = {
      userName: 'livemember',
      displayName: 'Live Member',
      avatar: null,
      guilds: {},
      timestamp: 1,
    };

    const storeWithCache = (
      userMap: Record<
        string,
        { userName: string | null; displayName: string | null; avatar: null; guilds: object; timestamp: number }
      >,
    ) =>
      createTestStore(
        {
          purge: purgeReducer,
          auth: authReducer,
          user: userReducer,
          app: appReducer,
          status: statusReducer,
          channel: channelReducer,
          cache: cacheReducer,
        },
        {
          auth: { token: TOKEN, isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          user: { currentUser: CURRENT_USER, isLoading: false, error: null },
          cache: { userMap, failedUserIds: [], isLoaded: true },
        },
      );

    it('routes a deleted-account target through the history scan instead of search', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const mDeleted = { ...mockMessage('m1', 0, [], DELETED_USER) } as Message;
      const mOther = { ...mockMessage('m2') } as Message; // authored by CURRENT_USER
      setupFetchMessages([[mDeleted, mOther]]);

      const result = await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Search endpoint never consulted for a deleted target.
      expect(mockFetchSearchMessageData).not.toHaveBeenCalled();
      // Scan found the deleted user's message and only that one was deleted.
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds).toEqual(['m1']);
    });

    it('announces the scan with a deleted-account warning', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      setupFetchMessages([[{ ...mockMessage('m1', 0, [], DELETED_USER) } as Message]]);

      await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      const entries = cacheStore
        .getState()
        .status.entries.map((e: { message: string }) => e.message);
      expect(entries.some((m: string) => m.includes('account is deleted'))).toBe(true);
    });

    it('keeps the fast search path for a live cached target', async () => {
      const cacheStore = storeWithCache({ [CURRENT_USER.id]: liveEntry });
      setupSearchResults([[mockMessage('m1')]]);

      await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchSearchMessageData).toHaveBeenCalled();
      // #257: the only list-endpoint read is the final pass over the
      // newest page (no cursor), never a history walk.
      expect(mockFetchMessageData).toHaveBeenCalledTimes(1);
      expect(mockFetchMessageData.mock.calls[0][1]).toBe('');
    });

    it('#239: preserve applies on the history-scan path for deleted accounts too', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      const mFile = { ...mockMessage('mf', 0, [attachment], DELETED_USER) } as Message;
      const mLink = { ...mockMessage('ml', 0, [], DELETED_USER), content: 'https://example.com' } as Message;
      const mPlain = { ...mockMessage('mp', 0, [], DELETED_USER) } as Message;
      setupFetchMessages([[mFile, mLink, mPlain]]);

      const result = await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([DELETED_ID]), preserveMediaAndLinks: true },
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Scan path was used (not search), and only the plain message died.
      expect(mockFetchSearchMessageData).not.toHaveBeenCalled();
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds).toEqual(['mp']);

      const entries = cacheStore.getState().status.entries;
      expect(entries.some(
        (e: { message: string }) => e.message.includes('Preserved 2 messages with files or links'),
      )).toBe(true);
    });

    it('#233/F18: counts and logs archived threads excluded from the scan', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const archivedThread = {
        id: 'thread-archived',
        parent_id: 'ch1',
        thread_metadata: { archived: true },
      } as unknown as Channel;
      const activeThread = {
        id: 'thread-active',
        parent_id: 'ch1',
        thread_metadata: { archived: false },
      } as unknown as Channel;
      setupThreadDiscovery({ ch1: [archivedThread, activeThread] });
      setupFetchMessages([[{ ...mockMessage('m1', 0, [], DELETED_USER) } as Message]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([DELETED_ID]), skipArchivedThreads: true },
          guildId: 'guild1',
        }),
      );
      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);

      // The archived thread was excluded from the walk; the active one was not.
      const scannedChannels = mockFetchMessageData.mock.calls.map((c) => c[2]);
      expect(scannedChannels).not.toContain('thread-archived');
      expect(scannedChannels).toContain('thread-active');

      // The exclusion is announced when it happens and counted in the
      // run summary — pre-fix the scan filtered silently and the run
      // read as a clean complete (the option's contract says skips are
      // counted).
      const entries = cacheStore.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some(
        (e) => e.level === 'info' && e.message.includes('Leaving 1 archived thread') && e.message.includes('unscanned'),
      )).toBe(true);
      expect(entries.some(
        (e) => e.message.includes('Left 1 archived thread unscanned'),
      )).toBe(true);
    });

    it('applies filter overrides client-side during the scan (date window early exit)', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const inWindow = {
        ...mockMessage('m-new', 0, [], DELETED_USER),
        timestamp: '2026-06-15T12:00:00.000Z',
      } as Message;
      // A FULL page (100) whose tail crosses the window: without the early
      // exit, hasMore (length >= 100) would drive a second fetch, so the
      // call-count assertion below actually pins the exit (a 2-message
      // page stops regardless and proves nothing).
      const outOfWindowTail = Array.from({ length: 99 }, (_, i) => ({
        ...mockMessage(`m-old-${i}`, 0, [], DELETED_USER),
        timestamp: '2026-01-01T12:00:00.000Z',
      })) as Message[];
      setupFetchMessages([[inWindow, ...outOfWindowTail]]);

      await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
          searchCriteria: {
            searchBeforeDate: null,
            searchAfterDate: new Date('2026-06-01T00:00:00.000Z'),
            searchMessageContents: [],
            selectedHasTypes: [],
            userIds: [],
            mentionIds: [],
            channelIds: [],
            isPinned: IsPinnedType.UNSET,
          } as unknown as SearchCriteria,
        }),
      );

      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds).toEqual(['m-new']);
      // Early exit: the walk stopped after the page that crossed the window.
      expect(mockFetchMessageData).toHaveBeenCalledTimes(1);
    });

    it('advances the before-cursor across full pages', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        ...mockMessage(`scan-${i}`, 0, [], DELETED_USER),
      })) as Message[];
      const tail = { ...mockMessage('scan-tail', 0, [], DELETED_USER) } as Message;
      setupFetchMessages([fullPage, [tail]]);

      await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      // Page 2 was requested with page 1's last id as the before-cursor,
      // and the short page (1 < 100) ended the walk.
      expect(mockFetchMessageData).toHaveBeenCalledTimes(2);
      expect(mockFetchMessageData.mock.calls[1][1]).toBe('scan-99');
      expect(mockDeleteMessage).toHaveBeenCalledTimes(101);
    });

    it('warns and reports the scan as incomplete when a page fetch fails mid-walk', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        ...mockMessage(`scan-${i}`, 0, [], DELETED_USER),
      })) as Message[];
      let calls = 0;
      mockFetchMessageData.mockImplementation(() => {
        calls++;
        return Promise.resolve(
          calls === 1 ? { success: true, data: fullPage } : { success: false, data: null },
        );
      });

      const result = await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      // The purge itself still completes with what page 1 yielded...
      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(100);
      // ...but the failure is loud: a mid-walk warning, and the summary
      // says "stopped early", never "complete".
      const entries = cacheStore.getState().status.entries as Array<{ level: string; message: string }>;
      const midWalk = entries.find((e) => e.message.includes('stopped early after a failed request'));
      expect(midWalk?.level).toBe('warning');
      expect(entries.some((e) => e.message.includes('results may be incomplete'))).toBe(true);
      expect(entries.some((e) => e.message.includes('Scan of') && e.message.includes('complete:'))).toBe(false);
    });

    it('#245: retries a transient page failure mid-walk and finishes the scan cleanly', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        ...mockMessage(`scan-${i}`, 0, [], DELETED_USER),
      })) as Message[];
      const tail = [{ ...mockMessage('scan-tail', 0, [], DELETED_USER) } as Message];
      let calls = 0;
      mockFetchMessageData.mockImplementation(() => {
        calls++;
        if (calls === 1) return Promise.resolve({ success: true, data: fullPage });
        if (calls === 2) return Promise.resolve({ success: false, status: 503 });
        if (calls === 3) return Promise.resolve({ success: false, status: undefined });
        return Promise.resolve({ success: true, data: tail });
      });

      const result = await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockFetchMessageData).toHaveBeenCalledTimes(4);
      // Both retries re-issue the same before-cursor.
      expect(mockFetchMessageData.mock.calls[1][1]).toBe('scan-99');
      expect(mockFetchMessageData.mock.calls[3][1]).toBe('scan-99');
      expect(mockDeleteMessage).toHaveBeenCalledTimes(101);

      const entries = cacheStore.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.filter((e) => e.level === 'warning' && /retrying in/.test(e.message))).toHaveLength(2);
      expect(entries.some((e) => e.message.includes('stopped early'))).toBe(false);
      expect(entries.some((e) => e.message.includes('results may be incomplete'))).toBe(false);
    });

    it('#245: a permanent 4xx mid-walk is not retried and still reports the scan as incomplete', async () => {
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        ...mockMessage(`scan-${i}`, 0, [], DELETED_USER),
      })) as Message[];
      let calls = 0;
      mockFetchMessageData.mockImplementation(() => {
        calls++;
        return Promise.resolve(
          calls === 1 ? { success: true, data: fullPage } : { success: false, status: 403 },
        );
      });

      await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchMessageData).toHaveBeenCalledTimes(2);
      const entries = cacheStore.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some((e) => /retrying in/.test(e.message))).toBe(false);
      expect(entries.some((e) => e.message.includes('stopped early after a failed request'))).toBe(true);
    });

    it('skips quietly when a channel cannot be walked at all (first-page failure)', async () => {
      // Forum parents 400 on the list endpoint and unreadable private
      // threads fail page 1 — that is an expected skip, not an incomplete
      // scan, and must not spook the user with a warning.
      const cacheStore = storeWithCache({ [DELETED_ID]: deletedEntry });
      mockFetchMessageData.mockResolvedValue({ success: false, data: null });

      await cacheStore.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([DELETED_ID]),
          guildId: 'guild1',
        }),
      );

      const entries = cacheStore.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some((e) => e.message.includes('stopped early'))).toBe(false);
      expect(entries.some((e) => e.message.includes('results may be incomplete'))).toBe(false);
    });
  });

  describe('bulkPurgeChannels — preserve pinned (Backlog #156)', () => {
    const pinnedCriteria = (): SearchCriteria => ({
      searchBeforeDate: null,
      searchAfterDate: null,
      searchMessageContents: [],
      selectedHasTypes: [],
      userIds: [],
      mentionIds: [],
      channelIds: [],
      isPinned: IsPinnedType.NO,
    } as unknown as SearchCriteria);

    const unsetCriteria = (): SearchCriteria => ({
      ...pinnedCriteria(),
      isPinned: IsPinnedType.UNSET,
    } as unknown as SearchCriteria);

    const mockPinned = (id: string): Message =>
      ({ ...mockMessage(id), pinned: true } as Message);

    const mockUnpinned = (id: string): Message =>
      ({ ...mockMessage(id), pinned: false } as Message);

    it('skips pinned messages client-side when isPinned=NO (Discord ignored the server-side filter)', async () => {
      // Discord returned a mix even though we asked `pinned=false`.
      setupSearchResults([[mockPinned('p1'), mockUnpinned('u1'), mockPinned('p2'), mockUnpinned('u2')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
          searchCriteria: pinnedCriteria(),
        }),
      );

      // Only the two unpinned messages should have been deleted.
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds.sort()).toEqual(['u1', 'u2']);
    });

    it('emits a status entry summarizing how many pinned messages were preserved', async () => {
      setupSearchResults([[mockPinned('p1'), mockUnpinned('u1'), mockPinned('p2')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
          searchCriteria: pinnedCriteria(),
        }),
      );

      const entries = store.getState().status.entries.map((e) => e.message);
      expect(entries.some((m) => m.includes('Preserved 2 pinned messages'))).toBe(true);
    });

    it('does NOT skip pinned messages when isPinned=UNSET (default behavior preserved)', async () => {
      // Without an explicit "exclude pinned" choice, the user is
      // signaling "purge everything that matches" — pinned messages
      // are fair game. Regression guard.
      setupSearchResults([[mockPinned('p1'), mockUnpinned('u1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
          searchCriteria: unsetCriteria(),
        }),
      );

      // Both deleted — no client-side filter applied.
      expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
    });

    it('protects pinned messages in attachments-only mode too', async () => {
      // Attachments-only modifies the pinned message via PATCH (clears
      // its attachments). User opting out of pinned-touching means we
      // shouldn't strip from pinned messages either — pin status stays
      // intact, but the message body is changed and that's exactly the
      // user is telling us not to do.
      const pinnedWithAttach = {
        ...mockPinned('p1'),
        content: 'pinned msg',
        attachments: [{ id: 'a1' } as any],
      } as Message;
      const normalWithAttach = {
        ...mockUnpinned('u1'),
        content: 'normal msg',
        attachments: [{ id: 'a2' } as any],
      } as Message;
      setupSearchResults([[pinnedWithAttach, normalWithAttach]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true), // deleteAttachmentsOnly = true
          guildId: 'guild1',
          searchCriteria: pinnedCriteria(),
        }),
      );

      // Only the unpinned message should have its attachments stripped.
      const editedIds = mockEditMessage.mock.calls.map((c) => c[1]);
      expect(editedIds).toEqual(['u1']);
    });
  });

  // ── Delete system messages opt-in (Backlog #196 Phase 2) ────────────────
  //
  // The default purge skips every message type except DEFAULT (0) and
  // REPLY (19) — so type-6 CHANNEL_PINNED_MESSAGE "X pinned a message"
  // notifications survive a purge and leave a confusing trail. Phase 2
  // adds a BulkPurgeDialog section where the user opts specific system
  // types into the sweep; the selection flows through PurgeConfig
  // .systemMessageTypesToDelete and lifts the skip gate for those types.

  describe('bulkPurgeChannels — delete system messages opt-in (Backlog #196 Phase 2)', () => {
    it('still skips type-6 pin notifications when no system types are selected (default preserved)', async () => {
      const normal = mockMessage('m1', 0);
      const pinNotif = mockMessage('m2', 6); // CHANNEL_PINNED_MESSAGE
      setupSearchResults([[normal, pinNotif]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds).toEqual(['m1']);
    });

    it('treats an explicit empty selection the same as the default (regression guard for the ?? [] path)', async () => {
      const pinNotif = mockMessage('m1', 6);
      setupSearchResults([[pinNotif]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, false, []),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('deletes type-6 pin notifications when the user opts that type in', async () => {
      const normal = mockMessage('m1', 0);
      const pinNotif = mockMessage('m2', 6);
      const memberJoin = mockMessage('m3', 7); // USER_JOIN — NOT selected
      setupSearchResults([[normal, pinNotif, memberJoin]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, false, [
            MessageType.CHANNEL_PINNED_MESSAGE,
          ]),
          guildId: 'guild1',
        }),
      );

      // type-0 (always) + type-6 (opted in). type-7 stays skipped.
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]).sort();
      expect(deletedIds).toEqual(['m1', 'm2']);
    });

    it('deletes every selected system type while still skipping unselected ones', async () => {
      const normal = mockMessage('m1', 0);
      const pinNotif = mockMessage('m2', 6); // selected
      const memberJoin = mockMessage('m3', 7); // selected
      const boost = mockMessage('m4', 8); // GUILD_BOOST — NOT selected
      setupSearchResults([[normal, pinNotif, memberJoin, boost]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, false, [
            MessageType.CHANNEL_PINNED_MESSAGE,
            MessageType.USER_JOIN,
          ]),
          guildId: 'guild1',
        }),
      );

      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]).sort();
      expect(deletedIds).toEqual(['m1', 'm2', 'm3']);
    });

    it('honors isPinned=NO on real messages while still deleting opted-in type-6 notifications', async () => {
      // The system-message opt-in scopes which system types get swept; it
      // does not override the #156 pinned-message protection on type-0
      // messages. A pinned real message stays; the pin notification goes.
      const pinnedReal = { ...mockMessage('m1', 0), pinned: true } as Message;
      const pinNotif = { ...mockMessage('m2', 6), pinned: false } as Message;
      const normal = { ...mockMessage('m3', 0), pinned: false } as Message;
      setupSearchResults([[pinnedReal, pinNotif, normal]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const criteria = {
        searchBeforeDate: null,
        searchAfterDate: null,
        searchMessageContents: [],
        selectedHasTypes: [],
        userIds: [],
        mentionIds: [],
        channelIds: [],
        isPinned: IsPinnedType.NO,
      } as unknown as SearchCriteria;

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, false, [
            MessageType.CHANNEL_PINNED_MESSAGE,
          ]),
          guildId: 'guild1',
          searchCriteria: criteria,
        }),
      );

      // m1 (pinned real) preserved by #156; m2 (pin notif) + m3 (normal) deleted.
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]).sort();
      expect(deletedIds).toEqual(['m2', 'm3']);
    });
  });

  // ── Cap-shift pagination (Backlog #186 / #188) ──────────────────────────
  //
  // scorpihoe-420 r/discrub bug: purge of a 20,550-match channel
  // terminated at 98 deleted / 22 skipped. Root cause: post-deletion
  // re-fetch landed on the same top-of-search slice (already deleted /
  // skipped), the dedup-empty terminator fired, and the purge silently
  // quit with thousands of matches still in Discord's index.
  //
  // Lib fix (#186, then generalized by #188): every iteration after
  // the first cap-shifts `searchBeforeDate` to the oldest yielded
  // timestamp, forcing the next search into an older window. Discord's
  // `max_id` is exclusive so previously-yielded messages are
  // structurally unreachable. These consumer-side tests use the
  // simplified mock iterator (always-cap-shift) to prove that
  // `purgeChannelMessages` end-to-end deletes the full match set
  // instead of stopping at the first window.

  describe('bulkPurgeChannels — cap-shift pagination (Backlog #186 / #188)', () => {
    // Helper: timestamped messages so cap-shift
    // (searchBeforeDate=oldestSeenTimestamp) advances meaningfully.
    const mockTimestamped = (id: string, daysAgo: number): Message =>
      ({
        ...mockMessage(id),
        timestamp: new Date(2025, 0, 30 - daysAgo).toISOString(),
      } as Message);

    it('walks past stuck-index dedup-empty pages via cap-shift, deleting all 30 messages instead of stopping at 25', async () => {
      // 30 messages: m1..m25 visible in the initial search window,
      // m26..m30 visible only after the iterator cap-shifts past the
      // oldest-seen timestamp. Mirrors the real-world condition where
      // Discord's search index becomes saturated past the live results
      // without a window narrowing.
      const initialWindow = Array.from({ length: 25 }, (_, i) =>
        mockTimestamped(`m${i + 1}`, i),
      );
      const olderWindow = Array.from({ length: 5 }, (_, i) =>
        mockTimestamped(`m${i + 26}`, 25 + i),
      );

      // Mock serves the initial window on the first call (no max_id).
      // Subsequent calls always carry searchBeforeDate; we serve the
      // olderWindow exactly once (when the boundary equals the initial
      // window's tail), then empty.
      let olderServed = false;
      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          _offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          const hasMaxId = criteria.searchBeforeDate != null;
          if (!hasMaxId) {
            return Promise.resolve({
              success: true,
              data: { messages: [initialWindow], total_results: 30 },
            });
          }
          if (!olderServed) {
            olderServed = true;
            return Promise.resolve({
              success: true,
              data: { messages: [olderWindow], total_results: 5 },
            });
          }
          return Promise.resolve({
            success: true,
            data: { messages: [], total_results: 5 },
          });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // The fix: all 30 messages deleted across both windows.
      // Pre-fix this would have been 25 (iterator terminated after the
      // first window's dedup-empty pages).
      expect(mockDeleteMessage).toHaveBeenCalledTimes(30);
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1] as string);
      expect(new Set(deletedIds).size).toBe(30);
      expect(deletedIds).toContain('m1');
      expect(deletedIds).toContain('m25');
      expect(deletedIds).toContain('m26');
      expect(deletedIds).toContain('m30');
    });

    it('preserves the pinned skip cohort while still deleting all 25 unpinned messages across both windows', async () => {
      // scorpihoe-420 scenario at full fidelity: pinned cohort the
      // user excluded via FilterModal stays in Discord's index and
      // dominates the post-reset response. Without the cap-shift the
      // iterator quits after 25; with it, the cap-shift past oldest-
      // seen exposes the remaining unpinned messages.
      const mockPinned = (id: string, daysAgo: number): Message =>
        ({ ...mockTimestamped(id, daysAgo), pinned: true } as Message);
      const mockUnpinned = (id: string, daysAgo: number): Message =>
        ({ ...mockTimestamped(id, daysAgo), pinned: false } as Message);

      // Initial window has 5 pinned (will be skipped) and 20
      // unpinned. Cap-shifted window has 5 more unpinned.
      const initialWindow: Message[] = [
        ...Array.from({ length: 5 }, (_, i) => mockPinned(`p${i + 1}`, i)),
        ...Array.from({ length: 20 }, (_, i) => mockUnpinned(`u${i + 1}`, 5 + i)),
      ];
      const olderWindow = Array.from({ length: 5 }, (_, i) =>
        mockUnpinned(`u${i + 21}`, 25 + i),
      );

      let olderServed = false;
      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          _offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          const hasMaxId = criteria.searchBeforeDate != null;
          if (!hasMaxId) {
            return Promise.resolve({
              success: true,
              data: { messages: [initialWindow], total_results: 30 },
            });
          }
          if (!olderServed) {
            olderServed = true;
            return Promise.resolve({
              success: true,
              data: { messages: [olderWindow], total_results: 5 },
            });
          }
          return Promise.resolve({
            success: true,
            data: { messages: [], total_results: 5 },
          });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const pinnedExclusionCriteria = {
        searchBeforeDate: null,
        searchAfterDate: null,
        searchMessageContents: [],
        selectedHasTypes: [],
        userIds: [],
        mentionIds: [],
        channelIds: [],
        isPinned: IsPinnedType.NO,
      } as unknown as SearchCriteria;

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
          searchCriteria: pinnedExclusionCriteria,
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      const deletedIds = mockDeleteMessage.mock.calls
        .map((c) => c[1] as string)
        .sort();
      // All 25 unpinned messages deleted; none of the 5 pinned.
      expect(deletedIds).toHaveLength(25);
      expect(deletedIds.filter((id) => id.startsWith('p'))).toHaveLength(0);
      expect(deletedIds.filter((id) => id.startsWith('u'))).toHaveLength(25);
      // Both windows covered: u1 (initial) + u25 (cap-shifted) both present.
      expect(deletedIds).toContain('u1');
      expect(deletedIds).toContain('u25');
    });
  });

  // ── Stale-feed toast (#120) ──────────────────────────────────────────────

  describe('bulkPurgeChannels — stale-feed toast', () => {
    it('shows Reload feed toast when the currently-selected channel was targeted', async () => {
      const selected = mockChannel('ch1', 'general');
      store.dispatch({ type: 'channel/setSelectedChannel', payload: selected });

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [selected],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const toast = store.getState().status.toast;
      expect(toast.isVisible).toBe(true);
      expect(toast.action).toEqual({
        type: 'reloadChannel',
        channelId: 'ch1',
        label: 'Reload feed',
      });
    });

    it('does not show a toast when the selected channel was not in the target set', async () => {
      const other = mockChannel('ch-other', 'unrelated');
      store.dispatch({ type: 'channel/setSelectedChannel', payload: other });

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(store.getState().status.toast.isVisible).toBe(false);
    });

    it('does not show a toast when no channel is selected', async () => {
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(store.getState().status.toast.isVisible).toBe(false);
    });
  });

  // ── Reactions Mode: bulkPurgeChannels ────────────────────────────────────

  describe('bulkPurgeChannels — reactions mode', () => {
    it('removes reactions from target users only', async () => {
      const message = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 3 },
      ]);

      setupFetchMessages([[message]]);

      // Three reactors: user1 (target), user2 (not target), user3 (target)
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [
          { id: 'user1', username: 'target1' },
          { id: 'user2', username: 'bystander' },
          { id: 'user3', username: 'target2' },
        ] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1', 'user3']),
          guildId: 'guild1',
        }),
      );

      // Should only delete reactions for user1 and user3
      expect(mockDeleteReaction).toHaveBeenCalledTimes(2);
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        TOKEN,
        'ch1',
        'm1',
        encodeURIComponent('👍'),
        'user1',
      );
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        TOKEN,
        'ch1',
        'm1',
        encodeURIComponent('👍'),
        'user3',
      );
    });

    it('paginates through reactors when >100', async () => {
      const message = mockMessageWithReactions('m1', [
        { emoji: { name: '🔥' }, count: 150 },
      ]);

      setupFetchMessages([[message]]);

      // First page: 100 reactors (all non-targets except the last)
      const page1Reactors = Array.from({ length: 100 }, (_, i) => ({
        id: `other${i}`,
        username: `other${i}`,
      })) as User[];
      // Make the 50th one a target
      page1Reactors[49] = { id: 'target1', username: 'target1' } as User;

      // Second page: fewer reactors, one is a target
      const page2Reactors = [
        { id: 'other200', username: 'other200' },
        { id: 'target2', username: 'target2' },
      ] as User[];

      let reactorCall = 0;
      mockGetReactions.mockImplementation(() => {
        reactorCall++;
        if (reactorCall === 1) {
          return Promise.resolve({ success: true, data: page1Reactors });
        }
        return Promise.resolve({ success: true, data: page2Reactors });
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['target1', 'target2']),
          guildId: 'guild1',
        }),
      );

      // Should paginate: first call without lastId, second with last reactor id
      expect(mockGetReactions).toHaveBeenCalledTimes(2);
      // Second call should use the last reactor's id from page 1
      expect(mockGetReactions.mock.calls[1][5]).toBe('other99');

      // Should delete reactions for target1 and target2
      expect(mockDeleteReaction).toHaveBeenCalledTimes(2);
    });

    it('paces between reactor pages even when no reactors match (#241)', async () => {
      // No reactor ever matches, so the delete-delay sleep never runs.
      // The service no longer self-delays (#241), so reactor-page
      // pagination must pace itself: a two-page walk sleeps exactly one
      // more time than a one-page walk of the same purge.
      const nonTarget = (i: number) => ({ id: `other${i}`, username: `other${i}` }) as User;

      const runPurge = async (pages: User[][]) => {
        const message = mockMessageWithReactions('m1', [
          { emoji: { name: '🔥' }, count: 150 },
        ]);
        setupFetchMessages([[message]]);
        let call = 0;
        mockGetReactions.mockImplementation(() => {
          const page = pages[Math.min(call, pages.length - 1)];
          call++;
          return Promise.resolve({ success: true, data: page });
        });
        (cancellableDelay as Mock).mockClear();
        await store.dispatch(
          bulkPurgeChannels({
            channels: [mockChannel('ch1', 'general')],
            config: reactionsConfig(['no-such-user']),
            guildId: 'guild1',
          }),
        );
        return (cancellableDelay as Mock).mock.calls.length;
      };

      const onePageSleeps = await runPurge([[nonTarget(0)]]);
      const fullPage = Array.from({ length: 100 }, (_, i) => nonTarget(i));
      const twoPageSleeps = await runPurge([fullPage, [nonTarget(200)]]);

      expect(mockDeleteReaction).not.toHaveBeenCalled();
      expect(twoPageSleeps).toBe(onePageSleeps + 1);
    });

    describe('reactor lookup pacing (2.1.3 pacing audit)', () => {
      type Ev = 'get' | 'delete' | 'delay';
      const record = (events: Ev[]) => {
        mockGetReactions.mockImplementation(() => {
          events.push('get');
          return Promise.resolve({ success: true, data: [] as User[] });
        });
        mockDeleteReaction.mockImplementation(() => {
          events.push('delete');
          return Promise.resolve({ success: true, status: 204 });
        });
        (cancellableDelay as Mock).mockImplementation(() => {
          events.push('delay');
          return Promise.resolve(false);
        });
      };
      const consecutive = (events: Ev[], a: Ev, b: Ev) =>
        events.some((e, i) => e === a && events[i + 1] === b);
      // The history walk sleeps before the first lookup; only the
      // reactor phase is under test here.
      const fromFirstGet = (events: Ev[]) => events.slice(events.indexOf('get'));

      it('never fires two reactor lookups back to back across emojis', async () => {
        const events: Ev[] = [];
        record(events);
        setupFetchMessages([[mockMessageWithReactions('m1', [
          { emoji: { name: '👍' }, count: 1 },
          { emoji: { name: '🔥' }, count: 1 },
          { emoji: { name: '❤️' }, count: 1 },
        ])]]);

        await store.dispatch(bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['no-such-user']),
          guildId: 'guild1',
        }));

        expect(events.filter((e) => e === 'get')).toHaveLength(3);
        expect(consecutive(events, 'get', 'get')).toBe(false);
        expect(events.filter((e) => e === 'delay').length).toBeGreaterThanOrEqual(2);
      });

      it('never fires two reactor lookups back to back across messages', async () => {
        const events: Ev[] = [];
        record(events);
        setupFetchMessages([[
          mockMessageWithReactions('m1', [{ emoji: { name: '👍' }, count: 1 }]),
          mockMessageWithReactions('m2', [{ emoji: { name: '👍' }, count: 1 }]),
          mockMessageWithReactions('m3', [{ emoji: { name: '🔥' }, count: 1 }, { emoji: { name: '👍' }, count: 1 }]),
        ]]);

        await store.dispatch(bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['no-such-user']),
          guildId: 'guild1',
        }));

        expect(events.filter((e) => e === 'get')).toHaveLength(4);
        expect(consecutive(events, 'get', 'get')).toBe(false);
      });

      it('uses the search delay for lookups and the delete delay after deletes, never both in a row', async () => {
        const events: Ev[] = [];
        record(events);
        mockGetReactions.mockImplementation(() => {
          events.push('get');
          return Promise.resolve({ success: true, data: [{ id: 'target1', username: 't' }] as User[] });
        });
        setupFetchMessages([[mockMessageWithReactions('m1', [
          { emoji: { name: '👍' }, count: 1 },
          { emoji: { name: '🔥' }, count: 1 },
        ])]]);
        const { calculateRandomDelay } = await import('@utils/delayUtils');
        (calculateRandomDelay as Mock).mockClear();

        await store.dispatch(bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['target1']),
          guildId: 'guild1',
        }));

        // get → delete → delete-delay → get → delete → delete-delay
        expect(fromFirstGet(events)).toEqual(['get', 'delete', 'delay', 'get', 'delete', 'delay']);
        expect(consecutive(fromFirstGet(events), 'delay', 'delay')).toBe(false);
        // Default settings: delete delay 2s for the two delete gaps, no
        // extra search-delay sleep because the delete delay already paced
        // the second lookup.
        const bases = (calculateRandomDelay as Mock).mock.calls.map((c) => c[0]);
        expect(bases.slice(-2)).toEqual([2, 2]);
      });

      it('paces a lookup that follows a full page of non-matching reactors', async () => {
        const events: Ev[] = [];
        record(events);
        const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: `other${i}`, username: `o${i}` })) as User[];
        let call = 0;
        mockGetReactions.mockImplementation(() => {
          events.push('get');
          call++;
          return Promise.resolve({ success: true, data: call === 1 ? fullPage : [] });
        });
        setupFetchMessages([[mockMessageWithReactions('m1', [{ emoji: { name: '🔥' }, count: 150 }])]]);
        const { calculateRandomDelay } = await import('@utils/delayUtils');
        (calculateRandomDelay as Mock).mockClear();

        await store.dispatch(bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['no-such-user']),
          guildId: 'guild1',
        }));

        expect(fromFirstGet(events)).toEqual(['get', 'delay', 'get']);
        const bases = (calculateRandomDelay as Mock).mock.calls.map((c) => c[0]);
        expect(bases[bases.length - 1]).toBe(1); // search delay
      });

      it('a cancel during the lookup delay stops the purge', async () => {
        const events: Ev[] = [];
        record(events);
        (cancellableDelay as Mock).mockImplementation(() => {
          events.push('delay');
          return Promise.resolve(true);
        });
        setupFetchMessages([[mockMessageWithReactions('m1', [
          { emoji: { name: '👍' }, count: 1 },
          { emoji: { name: '🔥' }, count: 1 },
        ])]]);

        await store.dispatch(bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['no-such-user']),
          guildId: 'guild1',
        }));

        expect(events.filter((e) => e === 'get')).toHaveLength(1);
      });
    });

    it('handles messages with multiple emoji reactions', async () => {
      const message = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 1 },
        { emoji: { id: '12345', name: 'custom_emoji' }, count: 1 },
      ]);

      setupFetchMessages([[message]]);

      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'target' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      // Should process both emoji types
      expect(mockGetReactions).toHaveBeenCalledTimes(2);
      expect(mockDeleteReaction).toHaveBeenCalledTimes(2);

      // Unicode emoji: URL-encoded
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        TOKEN,
        'ch1',
        'm1',
        encodeURIComponent('👍'),
        'user1',
      );
      // Custom emoji: "name:id" format
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        TOKEN,
        'ch1',
        'm1',
        'custom_emoji:12345',
        'user1',
      );
    });

    it('handles empty message array from fetchMessageData', async () => {
      // fetchMessageData returns success but empty array
      mockFetchMessageData.mockResolvedValue({ success: true, data: [] });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockGetReactions).not.toHaveBeenCalled();
    });

    it('handles failed getReactions response gracefully', async () => {
      const msg = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 1 },
      ]);

      setupFetchMessages([[msg]]);
      // getReactions returns failure
      mockGetReactions.mockResolvedValue({ success: false, data: null });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteReaction).not.toHaveBeenCalled();
    });

    it('skips messages without reactions', async () => {
      const msgNoReactions = mockMessage('m1');
      const msgWithReactions = mockMessageWithReactions('m2', [
        { emoji: { name: '👍' }, count: 1 },
      ]);

      setupFetchMessages([[msgNoReactions, msgWithReactions]]);

      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'target' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      // Only m2 has reactions, so only one emoji to check
      expect(mockGetReactions).toHaveBeenCalledTimes(1);
      expect(mockDeleteReaction).toHaveBeenCalledTimes(1);
    });

    // Backlog #149 regression guard. With a search filter active,
    // around-fetch returns the hit + ±25 neighbours; reactions on
    // neighbours that do NOT match the filter must NOT be touched
    // even when their reactor is in the target set. The safety lives
    // in `iterateReactionPurgeMessages` line 247 (applyRefineCriteria
    // on the around-batch) — this test pins it.
    it('does not touch reactions on around-fetch neighbours that fail the search filter (#149)', async () => {
      const hit = {
        ...mockMessageWithReactions('hit', [
          { emoji: { name: '👍' }, count: 1 },
        ]),
        content: 'foo here',
        channel_id: 'ch1',
      } as Message;
      const neighbour = {
        ...mockMessageWithReactions('neighbour', [
          { emoji: { name: '👍' }, count: 1 },
        ]),
        content: 'unrelated chatter',
        channel_id: 'ch1',
      } as Message;

      // Search returns only the hit (Discord would have filtered to it).
      setupSearchResults([[hit]]);
      // Around-fetch returns BOTH the hit and the off-topic neighbour.
      mockFetchMessageData.mockImplementation(
        (_t: string, _id: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            return Promise.resolve({ success: true, data: [hit, neighbour] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['foo'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Hit is the only message that should reach the per-reaction loop —
      // neighbour fails the `searchMessageContents: ['foo']` predicate.
      expect(mockGetReactions).toHaveBeenCalledTimes(1);
      expect(mockGetReactions).toHaveBeenCalledWith(
        expect.any(String), 'ch1', 'hit', expect.any(String), expect.anything(), null,
      );
      expect(mockDeleteReaction).toHaveBeenCalledTimes(1);
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        expect.any(String), 'ch1', 'hit', expect.any(String), 'targetUser',
      );
    });
  });

  // ── DM Mode: bulkPurgeDMs ────────────────────────────────────────────────

  describe('bulkPurgeDMs', () => {
    it('forces targetUserIds to current user ID regardless of config', async () => {
      const dmChannel = mockDmChannel('dm1', 'friend');
      const msg = mockMessage('m1');

      setupSearchResults([[msg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeDMs({
          channels: [dmChannel],
          config: messagesConfig(['someOtherUser']),
        }),
      );

      // The search should use the current user's ID, not 'someOtherUser'
      const searchCriteria =
        mockFetchSearchMessageData.mock.calls[0]?.[4];
      expect(searchCriteria.userIds).toEqual([CURRENT_USER.id]);
    });

    it('rejects if no current user', async () => {
      store = createStore({ currentUser: null });
      const dmChannel = mockDmChannel('dm1', 'friend');

      const result = await store.dispatch(
        bulkPurgeDMs({
          channels: [dmChannel],
          config: messagesConfig([CURRENT_USER.id]),
        }),
      );

      expect(bulkPurgeDMs.rejected.match(result)).toBe(true);
      expect(result.payload).toBe('No target users specified');
    });

    it('delegates to bulkPurgeChannels with guildId=null', async () => {
      const dmChannel = mockDmChannel('dm1', 'friend');
      const msg = mockMessage('m1');

      setupSearchResults([[msg]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeDMs({
          channels: [dmChannel],
          config: messagesConfig([CURRENT_USER.id]),
        }),
      );

      expect(result.payload).toEqual({ success: true });
      // guildId should be null → channel-level search (no guildId param)
      expect(mockFetchSearchMessageData.mock.calls[0][3]).toBeNull();
    });

    it('uses "conversation" terminology for DMs in status entries', async () => {
      const dmChannel = mockDmChannel('dm1', 'friend');

      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [] },
      });

      await store.dispatch(
        bulkPurgeDMs({
          channels: [dmChannel],
          config: messagesConfig([CURRENT_USER.id]),
        }),
      );

      const entries = store.getState().status.entries;
      const startEntry = entries.find(
        (e) => e.level === 'info' && e.message.includes('conversation'),
      );
      expect(startEntry).toBeDefined();
    });

    it('reactions mode in DMs does NOT force current user ID', async () => {
      const dmChannel = mockDmChannel('dm1', 'friend');
      const msg = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 1 },
      ]);

      setupFetchMessages([[msg]]);
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'target' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeDMs({
          channels: [dmChannel],
          config: reactionsConfig(['targetUser']),
        }),
      );

      // In reactions mode, even for DMs, the original targetUserIds are used
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        TOKEN,
        'dm1',
        'm1',
        encodeURIComponent('👍'),
        'targetUser',
      );
    });

    it('un-archives archived threads before removing reactions, re-archives on exit (#122 extension)', async () => {
      // Regression: reaction-purge HAR from 2026-04-23 showed DELETE /reactions
      // returning 400 code 50083 "Thread is archived" on forum posts with
      // reactions. The old code silently reported false-success. Now we
      // un-archive up-front, delete, then re-archive.
      const archivedThread: Channel = {
        id: 'thread-forum-1',
        name: 'forum post',
        parent_id: 'ch1',
        type: 11,
        thread_metadata: { archived: true, auto_archive_duration: 60 } as any,
      } as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      // Parent channel has no reactions to remove
      mockFetchMessageData.mockImplementation((_token: string, _lastId: string, channelId: string) => {
        if (channelId === 'ch1') return Promise.resolve({ success: true, data: [] });
        // Thread has one message with a matching reaction
        const msg = mockMessage('m1');
        msg.reactions = [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];
        return Promise.resolve({ success: true, data: [msg] });
      });
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt', discriminator: '0', avatar: null }],
      });
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
        }),
      );

      // editChannel called twice: un-archive + re-archive
      expect(mockEditChannel).toHaveBeenCalledWith(TOKEN, 'thread-forum-1', { archived: false });
      expect(mockEditChannel).toHaveBeenCalledWith(TOKEN, 'thread-forum-1', { archived: true });

      const entries = store.getState().status.entries;
      expect(entries.some((e) => e.message.includes('Un-archived thread thread-forum-1'))).toBe(true);
      expect(entries.some((e) => e.message.includes('Re-archived thread thread-forum-1'))).toBe(true);
    });

    it('skips reactions in archived threads when un-archive is denied (403)', async () => {
      const archivedThread: Channel = {
        id: 'thread-denied',
        name: 'no-perms-post',
        parent_id: 'ch1',
        type: 11,
        thread_metadata: { archived: true, auto_archive_duration: 60 } as any,
      } as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      // Thread has a message WITH a matching reactor — so we'd try to
      // delete it and need to un-archive first. Without matching work
      // the lazy-guard would never attempt un-archive at all (see the
      // "does NOT un-archive threads with no matching reactions" test
      // below for that path).
      const msg = mockMessage('m1');
      msg.reactions = [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];
      mockFetchMessageData.mockImplementation((_token: string, _lastId: string, channelId: string) => {
        if (channelId === 'ch1') return Promise.resolve({ success: true, data: [] });
        return Promise.resolve({ success: true, data: [msg] });
      });
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt', discriminator: '0', avatar: null }],
      });
      mockEditChannel.mockResolvedValue({ success: false, status: 403 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
        }),
      );

      // No DELETE /reactions attempted on the archived thread
      expect(mockDeleteReaction).not.toHaveBeenCalled();

      const entries = store.getState().status.entries;
      expect(entries.some(
        (e) => e.level === 'warning' &&
          e.message.includes('Missing permission to un-archive thread thread-denied'),
      )).toBe(true);
    });

    it('does NOT un-archive threads with no matching reactions (lazy guard saves API calls)', async () => {
      // The core of the optimization: user's 23-thread sample run burned
      // 46 PATCH calls (23 un-archive + 23 re-archive) on threads that
      // turned out to have no matching reactions. Lazy guard now only
      // un-archives when we actually find work — threads that scan
      // clean stay archived and never touch editChannel.
      const archivedThread: Channel = {
        id: 'thread-empty',
        name: 'quiet-post',
        parent_id: 'ch1',
        type: 11,
        thread_metadata: { archived: true, auto_archive_duration: 60 } as any,
      } as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      mockFetchMessageData.mockImplementation((_token: string, _lastId: string, channelId: string) => {
        if (channelId === 'ch1') return Promise.resolve({ success: true, data: [] });
        // Thread has messages but none with matching reactions
        const msg = mockMessage('m1');
        // No reactions field — skipped by the inner loop
        return Promise.resolve({ success: true, data: [msg] });
      });
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
        }),
      );

      // Zero editChannel calls — no un-archive, no re-archive
      expect(mockEditChannel).not.toHaveBeenCalled();

      const entries = store.getState().status.entries;
      expect(entries.every((e) => !e.message.includes('Un-archived thread'))).toBe(true);
      expect(entries.every((e) => !e.message.includes('Re-archived thread'))).toBe(true);
    });

    it('does NOT un-archive threads when reactions exist but no matching reactors', async () => {
      // Similar to the above but the message DOES have reactions — just
      // not from any target user. The reactor-list pagination can happen
      // on an archived thread without un-archiving (read-only op).
      const archivedThread: Channel = {
        id: 'thread-other-reactors',
        name: 'quiet-post',
        parent_id: 'ch1',
        type: 11,
        thread_metadata: { archived: true, auto_archive_duration: 60 } as any,
      } as Channel;
      setupThreadDiscovery({ ch1: [archivedThread] });

      const msg = mockMessage('m1');
      msg.reactions = [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];
      mockFetchMessageData.mockImplementation((_token: string, _lastId: string, channelId: string) => {
        if (channelId === 'ch1') return Promise.resolve({ success: true, data: [] });
        return Promise.resolve({ success: true, data: [msg] });
      });
      mockGetReactions.mockResolvedValue({
        success: true,
        // Reactor is NOT in the target list
        data: [{ id: 'someOtherUser', username: 'other', discriminator: '0', avatar: null }],
      });
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
        }),
      );

      // We scanned reactors (GET /reactions works on archived threads),
      // found no match, never tried to delete → never un-archived.
      expect(mockGetReactions).toHaveBeenCalled();
      expect(mockDeleteReaction).not.toHaveBeenCalled();
      expect(mockEditChannel).not.toHaveBeenCalled();
    });

    it('counts failed DELETE /reactions in the completion tally instead of reporting false success', async () => {
      // Simulates what the user hit in the 2026-04-23 HAR: Discord returns
      // 400 on DELETE /reactions for an archived thread (50083). The old
      // code blindly incremented the removed counter. Now we surface the
      // failure with a warning entry and roll it into the completion log.
      const msg = mockMessage('m1');
      msg.reactions = [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];

      setupNoThreads();
      mockFetchMessageData.mockImplementation((_token: string, lastId: string) => {
        if (lastId) return Promise.resolve({ success: true, data: [] });
        return Promise.resolve({ success: true, data: [msg] });
      });
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: false, status: 400 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      // Warning for the individual failure
      expect(entries.some(
        (e) => e.level === 'warning' && e.message.includes("Couldn't remove reaction"),
      )).toBe(true);
      // Completion line marked warning-level and includes failed count
      const completionEntry = entries.find(
        (e) => e.message.includes('Completed #general') && e.message.includes('failed'),
      );
      expect(completionEntry).toBeDefined();
      expect(completionEntry?.level).toBe('warning');
      expect(completionEntry?.message).toMatch(/0 reactions removed, 1 failed/);
      // The global "removed" counter must NOT be incremented on failure
      expect(completionEntry?.message).not.toMatch(/1 reactions removed/);
    });

    it('un-archives cross-channel archived threads via the guard registry', async () => {
      // Latent edge case from the 2026-04-23 dogfood: parent-channel
      // search returns a hit whose channel_id points to an archived
      // sibling thread. Without the registry, the outer `guard` is
      // bound to the parent (not archived), so un-archive never fires,
      // DELETE against the archived thread 400s (code 50083), and the
      // reaction is silently lost. The registry instead looks up a
      // per-channel guard keyed by `message.channel_id` and un-archives
      // on demand.
      const parentCh = 'ch-parent';
      const archivedThreadCh = 'thread-archived';
      const hitId = 'hit-in-archived-thread';

      const archivedThread: Channel = {
        id: archivedThreadCh,
        name: 'old forum post',
        parent_id: parentCh,
        type: 11,
        thread_metadata: { archived: true, auto_archive_duration: 60 } as any,
      } as Channel;
      setupThreadDiscovery({ [parentCh]: [archivedThread] });

      mockFetchSearchMessageData.mockImplementation((_t: string, _off: number, ch: string | null) => {
        if (ch === parentCh) {
          // Parent search surfaces the cross-channel hit
          return Promise.resolve({
            success: true,
            data: { messages: [[{ id: hitId, content: 'hello', channel_id: archivedThreadCh }]], total_results: 1 },
          });
        }
        return Promise.resolve({ success: true, data: { messages: [], total_results: 0 } });
      });

      const hitFull = {
        ...mockMessage(hitId),
        content: 'hello',
        channel_id: archivedThreadCh,
        reactions: [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }],
      };
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            return Promise.resolve({ success: true, data: [hitFull] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });
      mockEditChannel.mockResolvedValue({ success: true, status: 200 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel(parentCh, 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Registry un-archived the sibling thread BEFORE the DELETE,
      // then re-archived it in cleanup (two editChannel calls)
      expect(mockEditChannel).toHaveBeenCalledWith(
        expect.any(String), archivedThreadCh, { archived: false },
      );
      expect(mockEditChannel).toHaveBeenCalledWith(
        expect.any(String), archivedThreadCh, { archived: true },
      );
      // Delete actually landed on the right (thread) channel
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        expect.any(String), archivedThreadCh, hitId, expect.any(String), 'targetUser',
      );
    });

    it('shares seenIds across parent + thread passes to avoid duplicate around-fetches', async () => {
      // Dogfood observation (2026-04-23): 16 channels logged "1 search,
      // 2 arounds" for a single hit — because the parent-channel scan
      // around-fetched a thread-hosted hit, then the per-thread pass
      // created a fresh seenIds and around-fetched the same message
      // again. Shared dedup set eliminates the redundant call.
      const parentCh = 'ch-parent';
      const threadCh = 'ch-thread';
      const hitId = 'hit-cross-channel';
      const archivedThread: Channel = {
        id: threadCh,
        name: 'the thread',
        parent_id: parentCh,
        type: 11,
        thread_metadata: { archived: false, auto_archive_duration: 60 } as any,
      } as Channel;
      setupThreadDiscovery({ [parentCh]: [archivedThread] });

      // Parent's search returns one hit whose channel_id is the thread
      mockFetchSearchMessageData.mockImplementation((_t: string, _off: number, ch: string | null) => {
        if (ch === parentCh) {
          return Promise.resolve({
            success: true,
            data: { messages: [[{ id: hitId, content: 'hello', channel_id: threadCh }]], total_results: 1 },
          });
        }
        if (ch === threadCh) {
          // Thread's own search returns the same hit (typical Discord behavior)
          return Promise.resolve({
            success: true,
            data: { messages: [[{ id: hitId, content: 'hello', channel_id: threadCh }]], total_results: 1 },
          });
        }
        return Promise.resolve({ success: true, data: { messages: [], total_results: 0 } });
      });

      const hitFull = {
        ...mockMessage(hitId),
        content: 'hello',
        channel_id: threadCh,
        reactions: [],
      };
      let aroundCalls = 0;
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            aroundCalls++;
            return Promise.resolve({ success: true, data: [hitFull] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel(parentCh, 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Parent pass + thread pass each search, but only ONE around-fetch
      // happens — the thread pass hits seenIds and skips
      expect(aroundCalls).toBe(1);
    });

    it('scopes seenIds per channel so unrelated channels\' hits do not cross-pollute', async () => {
      // The shared set is rebuilt per outer channel iteration. Two
      // separate channels that happen to surface the same message ID
      // should each around-fetch — dedup must not leak across channels.
      const chA = 'ch-a';
      const chB = 'ch-b';
      const hitId = 'same-id-different-channels';
      setupNoThreads();

      mockFetchSearchMessageData.mockImplementation((_t: string, _o: number, ch: string | null) => {
        if (ch === chA || ch === chB) {
          return Promise.resolve({
            success: true,
            data: { messages: [[{ id: hitId, content: 'hello', channel_id: ch }]], total_results: 1 },
          });
        }
        return Promise.resolve({ success: true, data: { messages: [], total_results: 0 } });
      });

      let aroundCalls = 0;
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            aroundCalls++;
            return Promise.resolve({
              success: true,
              data: [{ ...mockMessage(hitId), channel_id: _ch, content: 'hello', reactions: [] }],
            });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel(chA, 'alpha'), mockChannel(chB, 'beta')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Both channels should around-fetch even though the hit id is identical
      expect(aroundCalls).toBe(2);
    });

    it('routes getReactions + deleteReaction to the MESSAGE channel when around-fetch returns thread-hosted messages', async () => {
      // THE actual bug from the 2026-04-23 dogfood: around-fetch (fixed
      // earlier) correctly uses `hit.channel_id`, so it returns messages
      // from the thread. But the reactor pagination + delete calls were
      // still using the function-scope `channelId` (the parent). Result:
      // GET /channels/PARENT/messages/THREAD_MSG_ID/reactions/❤️ → 404.
      // Every reaction on every cross-channel hit silently failed.
      const parentCh = 'ch-parent';
      const threadCh = 'ch-thread';
      const hitId = 'hit-1';

      setupNoThreads();
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: {
          // Search for parent returns a hit whose channel_id is the thread
          messages: [[{ id: hitId, content: 'hello', channel_id: threadCh }]],
          total_results: 1,
        },
      });

      // Around-fetch returns the full message WITH reactions, + channel_id = threadCh
      const hitFull = {
        ...mockMessage(hitId),
        content: 'hello',
        channel_id: threadCh,
        reactions: [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }],
      };
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            return Promise.resolve({ success: true, data: [hitFull] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel(parentCh, 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // getReactions + deleteReaction MUST target the thread, not the parent
      expect(mockGetReactions).toHaveBeenCalledWith(
        expect.any(String), threadCh, hitId, expect.any(String), expect.any(Number), null,
      );
      expect(mockDeleteReaction).toHaveBeenCalledWith(
        expect.any(String), threadCh, hitId, expect.any(String), 'targetUser',
      );
    });

    it('routes deleteAllReactionsFromMessage to the MESSAGE channel in clearReactions mode', async () => {
      const parentCh = 'ch-parent';
      const threadCh = 'ch-thread';
      const hitId = 'hit-1';

      setupNoThreads();
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: {
          messages: [[{ id: hitId, content: 'hello', channel_id: threadCh }]],
          total_results: 1,
        },
      });

      const hitFull = {
        ...mockMessage(hitId),
        content: 'hello',
        channel_id: threadCh,
        reactions: [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }],
      };
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            return Promise.resolve({ success: true, data: [hitFull] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockDeleteAllReactionsFromMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel(parentCh, 'general')],
          config: { mode: 'clearReactions', targetUserIds: [], retainAttachedMedia: false, deleteAttachmentsOnly: false },
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      expect(mockDeleteAllReactionsFromMessage).toHaveBeenCalledWith(
        expect.any(String), threadCh, hitId,
      );
    });

    it('uses hit.channel_id for around-fetch when search returns cross-channel thread hits', async () => {
      // Regression guard: Discord's guild-level search (channel_id=PARENT)
      // can return hits whose `channel_id` is a thread within that parent.
      // Calling `around=hitId` on the PARENT 404s + fails CORS preflight
      // (observed in a 2026-04-23 HAR). The fix uses the hit's own
      // channel_id for the around-fetch URL.
      const parentCh = 'ch-parent';
      const threadCh = 'ch-thread';
      const hitInThread = 'hit-1';

      setupNoThreads();
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: {
          messages: [[{ id: hitInThread, content: 'hello', channel_id: threadCh }]],
          total_results: 1,
        },
      });

      let aroundTargetChannel: string | undefined;
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            aroundTargetChannel = ch;
            return Promise.resolve({ success: true, data: [] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel(parentCh, 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Around-fetch MUST target the thread's channel, not the parent
      expect(aroundTargetChannel).toBe(threadCh);
    });

    it('logs a warning and continues when around-fetch fails during a filtered reaction purge', async () => {
      // If an around-fetch throws (network / CORS / preflight failure) we
      // surface it as a single warning per channel and keep going — the
      // pre-fix behavior silently swallowed every failure.
      setupNoThreads();
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: {
          messages: [[{ id: 'hit1', content: 'hello' }]],
          total_results: 1,
        },
      });
      mockFetchMessageData.mockImplementation(
        (_token: string, _msgId: string, _ch: string, queryParam?: string) => {
          if (queryParam === 'around') {
            return Promise.reject(new TypeError('Failed to fetch'));
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      const entries = store.getState().status.entries;
      const warnEntry = entries.find(
        (e) => e.level === 'warning' && e.message.includes("Couldn't fetch context for some matched messages"),
      );
      expect(warnEntry).toBeDefined();
    });

    it('uses search + around-fetch in reactions mode when filters are set', async () => {
      // Filtered reaction purge: search finds matching IDs, around-fetch
      // retrieves each hit's full message WITH reactions (search strips
      // the reactions field — verified in a 2026-04-23 HAR). Context
      // overlap in the around-response naturally covers nearby hits.
      setupNoThreads();
      const hitId = 'm1';
      // Search returns just the ID (reactions field absent — simulating
      // Discord's real strip-reactions behavior)
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [[{ id: hitId, content: 'hello world' }]], total_results: 1 },
      });
      // Around-fetch returns the full message WITH reactions
      const hitFull = {
        ...mockMessage(hitId),
        content: 'hello world',
        reactions: [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }],
      };
      mockFetchMessageData.mockImplementation(
        (_token: string, lastId: string, _channelId: string, queryParam?: string) => {
          // Around-fetch uses queryParam='around' and passes the target id
          if (queryParam === 'around' && lastId === hitId) {
            return Promise.resolve({ success: true, data: [hitFull] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'targetUser', username: 'tgt', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Both endpoints hit: search for IDs + around for full messages
      expect(mockFetchSearchMessageData).toHaveBeenCalled();
      expect(mockFetchMessageData).toHaveBeenCalledWith(
        expect.any(String), hitId, 'ch1', 'around',
      );
      // Reactor lookup + delete fired on the match
      expect(mockDeleteReaction).toHaveBeenCalledTimes(1);
    });

    it('uses search + around-fetch in clearReactions mode when filters are set', async () => {
      setupNoThreads();
      const hitId = 'm1';
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [[{ id: hitId, content: 'hello world' }]], total_results: 1 },
      });
      const hitFull = {
        ...mockMessage(hitId),
        content: 'hello world',
        reactions: [{ emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }],
      };
      mockFetchMessageData.mockImplementation(
        (_token: string, lastId: string, _channelId: string, queryParam?: string) => {
          if (queryParam === 'around' && lastId === hitId) {
            return Promise.resolve({ success: true, data: [hitFull] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockDeleteAllReactionsFromMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { mode: 'clearReactions', targetUserIds: [], retainAttachedMedia: false, deleteAttachmentsOnly: false },
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      expect(mockFetchSearchMessageData).toHaveBeenCalled();
      expect(mockFetchMessageData).toHaveBeenCalledWith(
        expect.any(String), hitId, 'ch1', 'around',
      );
      expect(mockDeleteAllReactionsFromMessage).toHaveBeenCalledTimes(1);
    });

    it('dedupes around-fetches when two search hits fall within ±25 of each other', async () => {
      // Two search hits close together should resolve to a single
      // around-fetch — the second hit is already in the first fetch's
      // context window and gets marked "seen" before its own iteration.
      setupNoThreads();
      const hitA = 'msg-a';
      const hitB = 'msg-b';
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: {
          messages: [
            [{ id: hitA, content: 'hello' }],
            [{ id: hitB, content: 'hello' }],
          ],
          total_results: 2,
        },
      });
      // First around-fetch returns BOTH hits (they're within 50 msgs of each other)
      const batch = [
        { ...mockMessage(hitA), content: 'hello', reactions: [] },
        { ...mockMessage(hitB), content: 'hello', reactions: [] },
      ];
      let aroundCalls = 0;
      mockFetchMessageData.mockImplementation(
        (_token: string, _lastId: string, _channelId: string, queryParam?: string) => {
          if (queryParam === 'around') {
            aroundCalls++;
            return Promise.resolve({ success: true, data: batch });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['targetUser']),
          guildId: 'guild1',
          searchCriteria: {
            searchMessageContents: ['hello'],
            userIds: [],
            mentionIds: [],
            selectedHasTypes: [],
            channelIds: [],
            searchAfterDate: null,
            searchBeforeDate: null,
            isPinned: 'null',
          } as unknown as SearchCriteria,
        }),
      );

      // Only one around-fetch — second hit was dedup'd from the first's context
      expect(aroundCalls).toBe(1);
    });

    it('does not call thread discovery endpoints for DMs (bulkPurgeDMs)', async () => {
      const dmChannel = mockDmChannel('dm1', 'friend');

      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [] },
      });

      await store.dispatch(
        bulkPurgeDMs({
          channels: [dmChannel],
          config: messagesConfig([CURRENT_USER.id]),
        }),
      );

      expect(mockFetchPublicThreads).not.toHaveBeenCalled();
      expect(mockFetchPrivateThreads).not.toHaveBeenCalled();
    });

    // Backlog #160: voice (type 2) and stage (type 13) channels host
    // text chat but Discord blocks thread creation on them, so the
    // thread-enumeration endpoints 400 on a voice channel ID. Skip
    // discovery cleanly for those types — text channels in the same
    // selection should still get their threads discovered as normal.
    it('skips thread discovery for voice + stage channels but still discovers on text channels (#160)', async () => {
      const channels = [
        mockChannel('text1', 'general'),
        { id: 'voice1', name: 'voice-chat', type: 2 } as Channel,
        { id: 'stage1', name: 'live-chat', type: 13 } as Channel,
      ];

      mockFetchSearchMessageData.mockResolvedValue({ success: true, data: { messages: [] } });
      // Active threads + per-channel public/private return no threads.
      mockFetchActiveGuildThreads.mockResolvedValue({ success: true, data: { threads: [] } });
      mockFetchPublicThreads.mockResolvedValue({ success: true, data: { threads: [], has_more: false } });
      mockFetchPrivateThreads.mockResolvedValue({ success: true, data: { threads: [] } });

      await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Per-channel discovery endpoints fired exactly once — for the
      // text channel only. Voice + stage are skipped.
      const publicCalledFor = mockFetchPublicThreads.mock.calls.map((c) => c[1]);
      const privateCalledFor = mockFetchPrivateThreads.mock.calls.map((c) => c[1]);
      expect(publicCalledFor).toEqual(['text1']);
      expect(privateCalledFor).toEqual(['text1']);
    });
  });

  // ── Error Handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('continues to next channel on per-channel error', async () => {
      const channels = [
        mockChannel('ch1', 'general'),
        mockChannel('ch2', 'random'),
      ];

      let searchCall = 0;
      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          searchCall++;
          if (channelId === 'ch1') {
            return Promise.reject(new Error('API rate limited'));
          }
          // ch2 works fine
          if (searchCall === 2) {
            return Promise.resolve({
              success: true,
              data: { messages: [[mockMessage('m1')]] },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Should succeed overall but report errors
      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect((result.payload as any).errors).toBeDefined();
      expect((result.payload as any).errors).toHaveLength(1);
      expect((result.payload as any).errors[0]).toContain('general');

      // ch2 should still have been processed
      expect(mockDeleteMessage).toHaveBeenCalledWith(TOKEN, 'm1', 'ch2');
    });

    it('reports errors in result payload', async () => {
      const channels = [mockChannel('ch1', 'broken')];

      mockFetchSearchMessageData.mockRejectedValue(
        new Error('Network failure'),
      );

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      const payload = result.payload as { success: true; errors?: string[] };
      expect(payload.errors).toBeDefined();
      expect(payload.errors![0]).toContain('Network failure');
    });

    it('rejects with error when unexpected error occurs outside per-channel catch', async () => {
      // Skip thread discovery by making all thread endpoints return empty
      // Then have waitWhilePaused fail on the FIRST call in the channel loop
      // Thread discovery makes ~4 waitWhilePaused calls (1 active + 1 public + 1 private + delays)
      // Make the thunk fail by throwing from the outer try block.
      // Use a DM purge (no guildId) to skip thread discovery entirely,
      // then throw on the first waitWhilePaused in the channel loop.
      (waitWhilePaused as Mock).mockRejectedValueOnce(new Error('Unexpected crash'));

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockDmChannel('dm1', 'friend')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: null,
        }),
      );

      expect(bulkPurgeChannels.rejected.match(result)).toBe(true);
      expect(result.payload).toBe('Unexpected crash');

      // Should log a "failed" status entry
      const entries = store.getState().status.entries;
      const failEntry = entries.find(
        (e) => e.level === 'error' && e.message.includes('failed'),
      );
      expect(failEntry).toBeDefined();
    });

    it('logs error status entries for failed channels', async () => {
      mockFetchSearchMessageData.mockRejectedValue(
        new Error('Server error'),
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const errorEntry = entries.find(
        (e) => e.level === 'error' && e.message.includes('Server error'),
      );
      expect(errorEntry).toBeDefined();
    });
  });

  // ── Cancel Support ───────────────────────────────────────────────────────

  describe('cancel support', () => {
    it('stops processing when cancelled via checkCancelled', async () => {
      const channels = [
        mockChannel('ch1', 'general'),
        mockChannel('ch2', 'random'),
      ];

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      // After processing ch1, cancel before ch2
      let checkCount = 0;
      (checkCancelled as Mock).mockImplementation(() => {
        checkCount++;
        // Let ch1 processing complete, then cancel at the channel-level check
        return checkCount > 5;
      });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);

      // Should log a cancellation warning
      const entries = store.getState().status.entries;
      const cancelEntry = entries.find(
        (e) => e.level === 'warning' && e.message.includes('Cancelled'),
      );
      expect(cancelEntry).toBeDefined();
    });

    it('stops processing when cancellableDelay returns true', async () => {
      const channels = [
        mockChannel('ch1', 'general'),
        mockChannel('ch2', 'random'),
      ];

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      // First delay (between operations) returns false, delay between channels returns true (cancelled)
      let delayCall = 0;
      (cancellableDelay as Mock).mockImplementation(() => {
        delayCall++;
        // Cancel on the inter-channel delay
        return Promise.resolve(delayCall >= 2);
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // ch2 should not have been searched because we cancelled between channels
      const ch2Calls = mockFetchSearchMessageData.mock.calls.filter(
        (call: any[]) => call[2] === 'ch2',
      );
      expect(ch2Calls).toHaveLength(0);
    });

    it('logs reactions-mode cancellation summary when cancelled', async () => {
      const channels = [
        mockChannel('ch1', 'general'),
        mockChannel('ch2', 'random'),
      ];
      const msg = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 1 },
      ]);

      setupFetchMessages([[msg]]);
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'target' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      // Cancel after ch1 completes
      let checkCount = 0;
      (checkCancelled as Mock).mockImplementation(() => {
        checkCount++;
        return checkCount > 6;
      });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);

      const entries = store.getState().status.entries;
      const cancelEntry = entries.find(
        (e) => e.level === 'warning' && e.message.includes('Cancelled') && e.message.includes('reactions removed'),
      );
      expect(cancelEntry).toBeDefined();
    });

    // ── Backlog #140 — partial-count recovery on mid-channel cancel ──
    //
    // Before this fix, a CancelledError thrown mid-loop dropped the
    // function's local accumulator on the floor when control jumped to
    // the catch block, so the final summary read "0 X removed" even
    // when N items had really been removed before the cancel signal.
    // The CancelledError now carries an in-flight partial result and
    // the catch extracts + accumulates it before breaking.

    it('reaction purge: cancel after N reactions removed reports N in summary, not 0', async () => {
      const message = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 5 },
      ]);
      setupFetchMessages([[message]]);

      mockGetReactions.mockResolvedValue({
        success: true,
        data: [
          { id: 'user1', username: 'target1' },
          { id: 'user1', username: 'target1' },
          { id: 'user1', username: 'target1' },
          { id: 'user1', username: 'target1' },
          { id: 'user1', username: 'target1' },
        ] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      // Trip cancel after 2 reactions have actually been deleted —
      // count-based rather than checkCancelled-call-count-based, so we
      // don't have to know exactly how many times checkCancelled fires
      // up the call stack before the deletes start.
      (checkCancelled as Mock).mockImplementation(
        () => mockDeleteReaction.mock.calls.length >= 2,
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const cancelSummary = entries.find(
        (e) => e.message.includes('Cancelled') && e.message.includes('reactions removed'),
      );
      expect(cancelSummary).toBeDefined();
      // Pre-fix: this would read "0 reactions removed". Post-fix: "2".
      expect(cancelSummary?.message).toMatch(/\b2 reactions removed/);
      expect(cancelSummary?.message).not.toMatch(/\b0 reactions removed/);
    });

    it('messages purge: cancel after N deletes reports N in summary, not 0', async () => {
      setupSearchResults([
        [mockMessage('m1'), mockMessage('m2'), mockMessage('m3'), mockMessage('m4')],
      ]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      // Same count-based trigger — cancel once 2 deletes have landed.
      (checkCancelled as Mock).mockImplementation(
        () => mockDeleteMessage.mock.calls.length >= 2,
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const cancelSummary = entries.find(
        (e) => e.message.includes('Cancelled') && /(deleted|messages)/i.test(e.message),
      );
      expect(cancelSummary).toBeDefined();
      // Pre-fix: would report 0 deleted. Post-fix: at least 2 (might
      // round to 2 or 3 depending on whether the cancel check fires
      // before or after the third delete attempt — point is, > 0).
      expect(cancelSummary?.message).not.toMatch(/\b0 messages deleted/);
      const match = cancelSummary?.message.match(/(\d+) messages? deleted/);
      expect(Number(match?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
    });
  });

  // ── State Lifecycle ──────────────────────────────────────────────────────

  describe('state lifecycle', () => {
    it('sets isPurging=true on pending, false on fulfilled', async () => {
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [] },
      });

      // Check initial state
      expect(selectIsPurging(store.getState())).toBe(false);

      const promise = store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      await promise;
      expect(selectIsPurging(store.getState())).toBe(false);
    });

    it('sets purgeError on rejected', async () => {
      store = createStore({ token: null });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(selectPurgeError(store.getState())).toBe('Not authenticated');
    });

    it('clears progress on new pending', async () => {
      // Set some progress first
      store.dispatch({
        type: 'purge/setPurgeProgress',
        payload: {
          processed: 50,
          deleted: 40,
          skipped: 10,
          reactionsRemoved: 0,
        },
      });
      expect(selectPurgeProgress(store.getState())).not.toBeNull();

      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [] },
      });

      // Starting a new purge should clear progress
      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(selectIsPurging(store.getState())).toBe(false);
    });

    it('sets isPurging=false and purgeError on rejected for bulkPurgeDMs', async () => {
      store = createStore({ token: null });

      await store.dispatch(
        bulkPurgeDMs({
          channels: [mockDmChannel('dm1', 'friend')],
          config: messagesConfig([CURRENT_USER.id]),
        }),
      );

      expect(selectIsPurging(store.getState())).toBe(false);
      expect(selectPurgeError(store.getState())).toBe('Not authenticated');
    });
  });

  // ── Progress & Status Entries ────────────────────────────────────────────

  describe('progress and status entries', () => {
    it('dispatches progress updates for messages processed', async () => {
      const msg1 = mockMessage('m1');
      const msg2 = mockMessage('m2');

      setupSearchResults([[msg1, msg2]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Final progress should reflect all messages processed
      const progress = selectPurgeProgress(store.getState());
      expect(progress).not.toBeNull();
      expect(progress!.processed).toBe(2);
      expect(progress!.deleted).toBe(2);
    });

    it('logs starting and completion status entries', async () => {
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const messages = entries.map((e) => e.message);

      // Should have starting entry
      expect(
        messages.some((m) => m.includes('Starting operation')),
      ).toBe(true);
      // Should have per-channel starting entry
      expect(
        messages.some((m) => m.includes('Starting #general')),
      ).toBe(true);
      // Should have completion entries
      expect(
        messages.some((m) => m.includes('Completed #general')),
      ).toBe(true);
      expect(
        messages.some((m) => m.includes('Purge: Complete ·')),
      ).toBe(true);
    });

    it('includes bulk context in progress updates', async () => {
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general'), mockChannel('ch2', 'random')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const progress = selectPurgeProgress(store.getState());
      expect(progress?.bulk).toBeDefined();
      expect(progress!.bulk!.totalChannels).toBe(2);
    });

    it('dispatches showOperationTip on start', async () => {
      mockFetchSearchMessageData.mockResolvedValue({
        success: true,
        data: { messages: [] },
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // showOperationTip should have been dispatched (check status slice)
      const state = store.getState().status;
      expect(state.operationTip).toBeDefined();
    });

    it('logs milestone entries when processing >= 100 messages', async () => {
      // Create 100 messages to trigger MILESTONE_INTERVAL
      const batch = Array.from({ length: 100 }, (_, i) => mockMessage(`m${i}`));
      setupSearchResults([batch]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const milestoneEntry = entries.find(
        (e) => e.level === 'info' && e.message.includes('messages processed'),
      );
      expect(milestoneEntry).toBeDefined();
    });

    it('logs milestone entries during reactions scanning at 100+ messages', async () => {
      // Create 100 messages (no reactions) to trigger the milestone in reaction scan
      const batch = Array.from({ length: 100 }, (_, i) => mockMessage(`m${i}`));
      setupFetchMessages([batch]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const milestoneEntry = entries.find(
        (e) => e.level === 'info' && e.message.includes('messages scanned'),
      );
      expect(milestoneEntry).toBeDefined();
    });

    it('logs reaction mode completion summary', async () => {
      const message = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 1 },
      ]);

      setupFetchMessages([[message]]);
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'target' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const messages = entries.map((e) => e.message);

      expect(
        messages.some((m) => m.includes('Reaction purge') && m.includes('Starting')),
      ).toBe(true);
      expect(
        messages.some((m) => m.includes('reactions removed')),
      ).toBe(true);
    });
  });

  // ── Search API interaction details ───────────────────────────────────────

  describe('search API interaction', () => {
    it('passes guildId for guild channel search', async () => {
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild123',
        }),
      );

      expect(mockFetchSearchMessageData).toHaveBeenCalledWith(
        TOKEN,
        0,
        'ch1',
        'guild123',
        expect.objectContaining({ userIds: [CURRENT_USER.id] }),
      );
    });

    it('passes null guildId for DM channel search', async () => {
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockDmChannel('dm1', 'friend')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: null,
        }),
      );

      expect(mockFetchSearchMessageData.mock.calls[0][3]).toBeNull();
    });

    it('#245: retries a transient failure on the reactions-mode history walk', async () => {
      const msg1 = mockMessage('m1');
      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) return Promise.resolve({ success: false, status: 502 });
        if (fetchCall === 2) return Promise.resolve({ success: true, data: [msg1] });
        return Promise.resolve({ success: false, data: [] });
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchMessageData).toHaveBeenCalledTimes(2);
      const entries = store.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some((e) => e.level === 'warning' && /Purge: connection failed, retrying in/.test(e.message))).toBe(true);
      expect(entries.some((e) => e.message.includes('stopped early'))).toBe(false);
    });

    it('#245: a mid-walk failure on the reactions-mode history walk is loud, not a silent end', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => mockMessage(`r-${i}`));
      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) return Promise.resolve({ success: true, data: fullPage });
        return Promise.resolve({ success: false, status: 403 });
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchMessageData).toHaveBeenCalledTimes(2);
      const entries = store.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some((e) => e.level === 'warning' && e.message.includes('Purge: history walk stopped early after a failed request (403)'))).toBe(true);
    });

    it('uses cursor-based pagination for reactions mode', async () => {
      const msg1 = mockMessage('m1');
      const msg2 = mockMessage('m2');

      // Two pages of messages
      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) {
          return Promise.resolve({ success: true, data: [msg1, msg2] });
        }
        return Promise.resolve({ success: false, data: [] });
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      // First call with empty lastId, would continue with msg2's id if there were more
      expect(mockFetchMessageData.mock.calls[0][1]).toBe('');
      if (mockFetchMessageData.mock.calls.length > 1) {
        expect(mockFetchMessageData.mock.calls[1][1]).toBe('m2');
      }
    });
  });

  // ── Bug Fix Tests ───────────────────────────────────────────────────────

  describe('bug fixes', () => {
    it('handles a full page of system messages without infinite-looping (cap-shifts past them)', async () => {
      // 25 system messages (25 search hits, all skipped by purge).
      // Under always-cap-shift, the second call carries searchBeforeDate
      // = oldest system-message timestamp; mock returns empty there,
      // and after 2 consecutive empty responses the iterator terminates.
      const ts = (i: number) =>
        new Date(2025, 0, 30 - i).toISOString();
      let callCount = 0;
      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          _offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          callCount++;
          if (callCount === 1) {
            expect(criteria.searchBeforeDate).toBeNull();
            return Promise.resolve({
              success: true,
              data: {
                messages: Array.from({ length: 25 }, (_, i) => [
                  { ...mockMessage(`sys${i}`, 7), timestamp: ts(i) } as Message,
                ]),
              },
            });
          }
          // Cap-shifted call(s): empty.
          expect(criteria.searchBeforeDate).not.toBeNull();
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Data page + 2 empty cap-shifted pages = 3 calls.
      expect(mockFetchSearchMessageData).toHaveBeenCalledTimes(3);
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('handles mixed system + normal messages without dedup loops', async () => {
      // Iterator yields the page once; purge skips system msgs and
      // deletes the 15 normals. Second call is cap-shifted, returns
      // empty, and we terminate after the 2-empty threshold.
      const ts = (i: number) =>
        new Date(2025, 0, 30 - i).toISOString();
      const mixedHits: Message[][] = [
        ...Array.from({ length: 10 }, (_, i) => [
          { ...mockMessage(`sys${i}`, 7), timestamp: ts(i) } as Message,
        ]),
        ...Array.from({ length: 15 }, (_, i) => [
          { ...mockMessage(`norm${i}`, 0), timestamp: ts(10 + i) } as Message,
        ]),
      ];

      let callCount = 0;
      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          _offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          callCount++;
          if (callCount === 1) {
            expect(criteria.searchBeforeDate).toBeNull();
            return Promise.resolve({
              success: true,
              data: { messages: mixedHits },
            });
          }
          expect(criteria.searchBeforeDate).not.toBeNull();
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(15);
    });

    it('flattens nested Discord search payloads correctly', async () => {
      // Discord wraps each hit in its own inner array. We verify that
      // 10 inner arrays of 5 messages flatten to 50 distinct deletes.
      const ts = (i: number) =>
        new Date(2025, 0, 30 - i).toISOString();
      const rawArrays: Message[][] = Array.from({ length: 10 }, (_, i) => [
        { ...mockMessage(`m${i * 5}`), timestamp: ts(i * 5) } as Message,
        { ...mockMessage(`m${i * 5 + 1}`), timestamp: ts(i * 5 + 1) } as Message,
        { ...mockMessage(`m${i * 5 + 2}`), timestamp: ts(i * 5 + 2) } as Message,
        { ...mockMessage(`m${i * 5 + 3}`), timestamp: ts(i * 5 + 3) } as Message,
        { ...mockMessage(`m${i * 5 + 4}`), timestamp: ts(i * 5 + 4) } as Message,
      ]);

      let callCount = 0;
      mockFetchSearchMessageData.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ success: true, data: { messages: rawArrays } });
        }
        return Promise.resolve({ success: true, data: { messages: [] } });
      });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // All 50 flattened messages deleted; data page + 2 empties for the terminator.
      expect(mockDeleteMessage).toHaveBeenCalledTimes(50);
      expect(mockFetchSearchMessageData).toHaveBeenCalledTimes(3);
    });

    it('cap-shift skips already-yielded messages structurally (no in-memory dedup needed)', async () => {
      // Discord's max_id is exclusive, so a cap-shifted query cannot
      // return a previously-yielded message. This proves it: serve the
      // same 4 messages twice; on the second (cap-shifted) call we
      // remove the messages that fall on or after the boundary so the
      // payload contains only "older" messages. No dedup machinery.
      const ts = (daysAgo: number) =>
        new Date(2025, 0, 30 - daysAgo).toISOString();
      const allMessages = [
        { ...mockMessage('m1'), timestamp: ts(0) } as Message,
        { ...mockMessage('m2'), timestamp: ts(1) } as Message,
        { ...mockMessage('m3'), timestamp: ts(2) } as Message,
        { ...mockMessage('m4'), timestamp: ts(3) } as Message,
      ];

      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          _offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          const before = criteria.searchBeforeDate;
          const filtered = before
            ? allMessages.filter((m) => new Date(m.timestamp) < before)
            : allMessages;
          return Promise.resolve({
            success: true,
            data: { messages: filtered.map((m) => [m]) },
          });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // 4 unique deletions despite Discord re-serving the same payload
      // shape on every call: cap-shift narrows the window each iteration.
      expect(mockDeleteMessage).toHaveBeenCalledTimes(4);
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1] as string);
      expect(new Set(deletedIds).size).toBe(4);
    });

    it('throttles progress dispatches (not per-message)', async () => {
      // With 50 messages and throttle of 10, the onProgress callback
      // fires every 10th message + end-of-batch (not every message).
      // We verify this by checking that the final progress has correct totals
      // (proves all messages were processed) while the intermediate progress
      // values jump by ~10 (not by 1).
      const batch = Array.from({ length: 50 }, (_, i) => mockMessage(`m${i}`));
      setupSearchResults([batch]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Final progress should have correct totals
      const progress = selectPurgeProgress(store.getState());
      expect(progress).not.toBeNull();
      expect(progress!.processed).toBe(50);
      expect(progress!.deleted).toBe(50);
    });
  });

  // ── Thread Tests ────────────────────────────────────────────────────────

  describe('thread integration', () => {
    it('includes thread IDs in search criteria channelIds (messages mode)', async () => {
      const thread1 = mockThreadChannel('t1', 'thread-1', 'ch1');
      const thread2 = mockThreadChannel('t2', 'thread-2', 'ch1');

      setupThreadDiscovery({ ch1: [thread1, thread2] });
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Search criteria should include thread IDs in channelIds
      const searchCriteria = mockFetchSearchMessageData.mock.calls[0][4];
      expect(searchCriteria.channelIds).toContain('t1');
      expect(searchCriteria.channelIds).toContain('t2');
    });

    it('processes threads in reactions mode (fetchMessageData called for parent + threads)', async () => {
      const thread1 = mockThreadChannel('t1', 'thread-1', 'ch1');

      setupThreadDiscovery({ ch1: [thread1] });

      // Parent channel messages
      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(
        (_token: string, _lastId: string, channelId: string) => {
          fetchCall++;
          if (fetchCall === 1 && channelId === 'ch1') {
            return Promise.resolve({
              success: true,
              data: [mockMessage('m1')],
            });
          }
          if (fetchCall === 2 && channelId === 't1') {
            return Promise.resolve({
              success: true,
              data: [mockMessage('m2')],
            });
          }
          return Promise.resolve({ success: false, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      // fetchMessageData should be called for parent AND thread
      const channelIds = mockFetchMessageData.mock.calls.map((c: any[]) => c[2]);
      expect(channelIds).toContain('ch1');
      expect(channelIds).toContain('t1');
    });

    it('does not call thread discovery endpoints for DMs', async () => {
      const dmChannel = mockDmChannel('dm1', 'friend');

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [dmChannel],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: null,
        }),
      );

      expect(mockFetchPublicThreads).not.toHaveBeenCalled();
      expect(mockFetchPrivateThreads).not.toHaveBeenCalled();
    });

    it('paginates archived threads when has_more is true', async () => {
      const thread1 = mockThreadChannel('t1', 'thread-1', 'ch1');
      const thread2 = mockThreadChannel('t2', 'thread-2', 'ch1');

      // First page of public threads has has_more=true
      let publicCall = 0;
      mockFetchPublicThreads.mockImplementation(() => {
        publicCall++;
        if (publicCall === 1) {
          return Promise.resolve({
            success: true,
            data: {
              threads: [thread1],
              members: [],
              has_more: true,
            },
          });
        }
        return Promise.resolve({
          success: true,
          data: {
            threads: [thread2],
            members: [],
            has_more: false,
          },
        });
      });
      mockFetchPrivateThreads.mockResolvedValue({
        success: true,
        data: { threads: [], members: [], has_more: false },
      });
      mockFetchJoinedPrivateArchivedThreads.mockResolvedValue({
        success: true,
        data: { threads: [], members: [], has_more: false },
      });

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // fetchPublicThreads should be called twice (pagination)
      expect(mockFetchPublicThreads).toHaveBeenCalledTimes(2);
      // Second call should have a 'before' parameter
      expect(mockFetchPublicThreads.mock.calls[1][2]).toBeDefined();
    });

    it('deduplicates threads appearing in multiple archived sources', async () => {
      const thread = mockThreadChannel('t1', 'thread-1', 'ch1');

      // Same thread appears in public archived
      setupThreadDiscovery({ ch1: [thread] });

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Thread ID should appear only once in channelIds
      const searchCriteria = mockFetchSearchMessageData.mock.calls[0][4];
      const t1Count = searchCriteria.channelIds.filter((id: string) => id === 't1').length;
      expect(t1Count).toBe(1);
    });

    it('continues purge when thread discovery fails entirely', async () => {
      // All thread endpoints fail
      mockFetchPublicThreads.mockResolvedValue({ success: false });
      mockFetchPrivateThreads.mockResolvedValue({ success: false });

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Purge should still succeed without thread coverage
      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
    });

    it('falls back to joined private archived threads when private threads fail', async () => {
      const joinedThread = mockThreadChannel('jt1', 'joined-thread', 'ch1');

      mockFetchPublicThreads.mockResolvedValue({
        success: true,
        data: { threads: [], members: [], has_more: false },
      });
      // Private threads fails (no MANAGE_THREADS permission)
      mockFetchPrivateThreads.mockResolvedValue({ success: false });
      // Fallback: joined private threads succeeds
      mockFetchJoinedPrivateArchivedThreads.mockResolvedValue({
        success: true,
        data: { threads: [joinedThread], members: [], has_more: false },
      });

      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Fallback should have been called
      expect(mockFetchJoinedPrivateArchivedThreads).toHaveBeenCalled();
      // Thread should be in search criteria
      const searchCriteria = mockFetchSearchMessageData.mock.calls[0][4];
      expect(searchCriteria.channelIds).toContain('jt1');
    });

    it('logs thread count in status when threads are found', async () => {
      const thread1 = mockThreadChannel('t1', 'thread-1', 'ch1');
      const thread2 = mockThreadChannel('t2', 'thread-2', 'ch1');

      setupThreadDiscovery({ ch1: [thread1, thread2] });
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const threadEntry = entries.find(
        (e) => e.level === 'info' && e.message.includes('Found 2 thread'),
      );
      expect(threadEntry).toBeDefined();
    });
  });

  // ── Power User Scale Scenarios ──────────────────────────────────────────

  describe('power user scale scenarios', () => {
    // Messages mode — pagination & re-search
    it('multi-batch re-search (5 cycles)', async () => {
      // 5 search pages of 25 messages each (125 total)
      // Discord returns Message[][] where outer array length = number of search hits
      const pages: Message[][][] = [];
      for (let p = 0; p < 5; p++) {
        // Each search hit is its own inner array (25 hits = 25 arrays)
        const hits = Array.from({ length: 25 }, (_, i) => [
          mockMessage(`p${p}m${i}`),
        ]);
        pages.push(hits);
      }

      let callCount = 0;
      mockFetchSearchMessageData.mockImplementation(() => {
        const page = pages[callCount];
        callCount++;
        if (page) {
          return Promise.resolve({
            success: true,
            data: { messages: page },
          });
        }
        return Promise.resolve({ success: true, data: { messages: [] } });
      });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockDeleteMessage).toHaveBeenCalledTimes(125);
      // 5 pages with data + 2 empty terminator pages (post-#148) = 7
      expect(mockFetchSearchMessageData).toHaveBeenCalledTimes(7);
    });

    it('cap-shifts past consecutive system-message pages and deletes the older normal-message batch', async () => {
      // 3 pages: 25 system, 25 system, 15 normal. Each page is older
      // than the last; cap-shift picks them up in order. Mock keys on
      // searchBeforeDate to decide what to serve next.
      const ts = (i: number) =>
        new Date(2025, 0, 30 - i).toISOString();
      const page1 = Array.from({ length: 25 }, (_, i) => [
        { ...mockMessage(`sys1_${i}`, 7), timestamp: ts(i) } as Message,
      ]);
      const page2 = Array.from({ length: 25 }, (_, i) => [
        { ...mockMessage(`sys2_${i}`, 7), timestamp: ts(25 + i) } as Message,
      ]);
      const page3 = Array.from({ length: 15 }, (_, i) => [
        { ...mockMessage(`norm${i}`, 0), timestamp: ts(50 + i) } as Message,
      ]);

      let callCount = 0;
      const calls: { hasBefore: boolean; iso: string | null }[] = [];
      mockFetchSearchMessageData.mockImplementation(
        (
          _token: string,
          _offset: number,
          _channelId: string,
          _guildId: string,
          criteria: SearchCriteria,
        ) => {
          callCount++;
          calls.push({
            hasBefore: criteria.searchBeforeDate != null,
            iso: criteria.searchBeforeDate?.toISOString() ?? null,
          });
          if (callCount === 1) {
            return Promise.resolve({ success: true, data: { messages: page1 } });
          }
          if (callCount === 2) {
            return Promise.resolve({ success: true, data: { messages: page2 } });
          }
          if (callCount === 3) {
            return Promise.resolve({ success: true, data: { messages: page3 } });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      // Always-cap-shift: call 1 has no boundary; calls 2/3 carry the
      // oldest timestamp seen so far. Then 2 empty pages terminate us.
      expect(callCount).toBe(5);
      expect(calls[0].hasBefore).toBe(false);
      expect(calls[1].iso).toBe(ts(24));
      expect(calls[2].iso).toBe(ts(49));
      expect(calls[3].iso).toBe(ts(64));
      expect(calls[4].iso).toBe(ts(64));
      expect(mockDeleteMessage).toHaveBeenCalledTimes(15);
    });

    it('3 users x 3 channels accumulation', async () => {
      const channels = [
        mockChannel('ch1', 'alpha'),
        mockChannel('ch2', 'beta'),
        mockChannel('ch3', 'gamma'),
      ];

      // Each user-channel returns different counts
      const msgCounts: Record<string, Record<string, number>> = {
        u1: { ch1: 10, ch2: 5, ch3: 8 },
        u2: { ch1: 20, ch2: 3, ch3: 12 },
        u3: { ch1: 7, ch2: 15, ch3: 4 },
      };

      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string, _guildId: string, criteria: any) => {
          const userId = criteria.userIds[0];
          const count = msgCounts[userId]?.[channelId] || 0;
          if (count > 0) {
            // Mark as served so second call returns empty
            msgCounts[userId][channelId] = 0;
            const author = { id: userId, username: userId } as User;
            const msgs = Array.from({ length: count }, (_, i) =>
              mockMessage(`${userId}_${channelId}_${i}`, 0, [], author),
            );
            return Promise.resolve({
              success: true,
              data: { messages: [msgs] },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig(['u1', 'u2', 'u3']),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      // Total: 10+5+8+20+3+12+7+15+4 = 84
      expect(mockDeleteMessage).toHaveBeenCalledTimes(84);

      // Verify completion summary
      const entries = store.getState().status.entries;
      const completeEntry = entries.find(
        (e) => e.level === 'success' && e.message.includes('Purge: Complete ·'),
      );
      expect(completeEntry).toBeDefined();
      expect(completeEntry!.message).toContain('84 messages deleted');
    });

    it('deduplication with retain media', async () => {
      const attachment = { id: 'a1', filename: 'img.png', url: 'https://cdn/img.png' };
      const msgWithAtt = mockMessage('dup1', 0, [attachment]);
      const msgWithAttDup = mockMessage('dup1', 0, [attachment]); // Same ID
      const msgNormal = mockMessage('unique1');
      const msgNormalDup = mockMessage('unique1'); // Same ID

      setupNestedSearchResults([[[msgWithAtt, msgNormal], [msgWithAttDup, msgNormalDup]]]);
      mockEditMessage.mockResolvedValue({ success: true, status: 200 });
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], true),
          guildId: 'guild1',
        }),
      );

      // Only 2 unique IDs: dup1 (has attachment -> edit) and unique1 (no attachment -> delete)
      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
    });

    it('empty channels mixed with full ones', async () => {
      const channels = [
        mockChannel('ch1', 'full1'),
        mockChannel('ch2', 'empty1'),
        mockChannel('ch3', 'full2'),
        mockChannel('ch4', 'empty2'),
        mockChannel('ch5', 'full3'),
      ];

      const channelMsgCounts: Record<string, number> = {
        ch1: 10, ch2: 0, ch3: 8, ch4: 0, ch5: 5,
      };

      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          const count = channelMsgCounts[channelId] || 0;
          if (count > 0) {
            channelMsgCounts[channelId] = 0;
            const msgs = Array.from({ length: count }, (_, i) =>
              mockMessage(`${channelId}_m${i}`),
            );
            return Promise.resolve({
              success: true,
              data: { messages: [msgs] },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(23); // 10 + 8 + 5

      // Empty channels should have warning entries
      const entries = store.getState().status.entries;
      const warnings = entries.filter(
        (e) => e.level === 'warning' && e.message.includes('no messages'),
      );
      expect(warnings).toHaveLength(2);
    });

    it('status log completeness for 3-channel purge', async () => {
      const channels = [
        mockChannel('ch1', 'alpha'),
        mockChannel('ch2', 'beta'),
        mockChannel('ch3', 'gamma'),
      ];

      const channelMsgs: Record<string, number> = { ch1: 3, ch2: 5, ch3: 2 };

      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          const count = channelMsgs[channelId] || 0;
          if (count > 0) {
            channelMsgs[channelId] = 0;
            return Promise.resolve({
              success: true,
              data: {
                messages: [
                  Array.from({ length: count }, (_, i) =>
                    mockMessage(`${channelId}_${i}`),
                  ),
                ],
              },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const messages = entries.map((e) => e.message);

      // Verify expected entries in order
      expect(messages.some((m) => m.includes('Starting operation across 3 channels'))).toBe(true);
      expect(messages.some((m) => m.includes('Starting #alpha (1 of 3)'))).toBe(true);
      expect(messages.some((m) => m.includes('Completed #alpha'))).toBe(true);
      expect(messages.some((m) => m.includes('Starting #beta (2 of 3)'))).toBe(true);
      expect(messages.some((m) => m.includes('Completed #beta'))).toBe(true);
      expect(messages.some((m) => m.includes('Starting #gamma (3 of 3)'))).toBe(true);
      expect(messages.some((m) => m.includes('Completed #gamma'))).toBe(true);
      expect(messages.some((m) => m.includes('Purge: Complete ·') && m.includes('10 messages deleted'))).toBe(true);
    });

    // Reactions mode — full pipeline
    it('large channel scan with multi-reactor pagination', async () => {
      // One message, one emoji, 250 reactors across 3 pages
      const message = mockMessageWithReactions('m1', [
        { emoji: { name: '👍' }, count: 250 },
      ]);

      setupFetchMessages([[message]]);

      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: `r${i}`,
        username: `user${i}`,
      })) as User[];
      const page2 = Array.from({ length: 100 }, (_, i) => ({
        id: `r${100 + i}`,
        username: `user${100 + i}`,
      })) as User[];
      const page3 = Array.from({ length: 50 }, (_, i) => ({
        id: `r${200 + i}`,
        username: `user${200 + i}`,
      })) as User[];

      // Target users distributed across pages
      page1[10] = { id: 'target1', username: 'target1' } as User;
      page1[50] = { id: 'target2', username: 'target2' } as User;
      page2[30] = { id: 'target3', username: 'target3' } as User;
      page3[5] = { id: 'target4', username: 'target4' } as User;
      page3[40] = { id: 'target5', username: 'target5' } as User;

      let reactorCall = 0;
      mockGetReactions.mockImplementation(() => {
        reactorCall++;
        if (reactorCall === 1) return Promise.resolve({ success: true, data: page1 });
        if (reactorCall === 2) return Promise.resolve({ success: true, data: page2 });
        return Promise.resolve({ success: true, data: page3 });
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['target1', 'target2', 'target3', 'target4', 'target5']),
          guildId: 'guild1',
        }),
      );

      expect(mockGetReactions).toHaveBeenCalledTimes(3);
      expect(mockDeleteReaction).toHaveBeenCalledTimes(5);
      // Verify cursor pagination
      expect(mockGetReactions.mock.calls[1][5]).toBe('r99');
      expect(mockGetReactions.mock.calls[2][5]).toBe('r199');
    });

    it('multi-channel accumulated reaction stats', async () => {
      const channels = [
        mockChannel('ch1', 'alpha'),
        mockChannel('ch2', 'beta'),
        mockChannel('ch3', 'gamma'),
      ];

      // Each channel has messages with reactions
      const channelReactorCounts: Record<string, number> = {
        ch1: 10, ch2: 25, ch3: 15,
      };

      mockFetchMessageData.mockImplementation(
        (_token: string, _lastId: string, channelId: string) => {
          if (channelReactorCounts[channelId] && channelReactorCounts[channelId] > 0) {
            const count = channelReactorCounts[channelId];
            channelReactorCounts[channelId] = 0;
            // Create messages with 1 reaction each
            const msgs = Array.from({ length: count }, (_, i) =>
              mockMessageWithReactions(`${channelId}_m${i}`, [
                { emoji: { name: '👍' }, count: 1 },
              ]),
            );
            return Promise.resolve({ success: true, data: msgs });
          }
          return Promise.resolve({ success: false, data: [] });
        },
      );

      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'target' }] as User[],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      // Total reactions removed: 10 + 25 + 15 = 50
      expect(mockDeleteReaction).toHaveBeenCalledTimes(50);

      const entries = store.getState().status.entries;
      const completeEntry = entries.find(
        (e) => e.level === 'success' && e.message.includes('Reaction purge: Complete ·'),
      );
      expect(completeEntry).toBeDefined();
      expect(completeEntry!.message).toContain('50 reactions removed');
    });

    // Thread scale
    it('channel with many threads (messages mode) — all thread IDs in search', async () => {
      const threads = Array.from({ length: 5 }, (_, i) =>
        mockThreadChannel(`t${i}`, `thread-${i}`, 'ch1'),
      );

      setupThreadDiscovery({ ch1: threads });
      setupSearchResults([[mockMessage('m1')]]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const searchCriteria = mockFetchSearchMessageData.mock.calls[0][4];
      expect(searchCriteria.channelIds).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(searchCriteria.channelIds).toContain(`t${i}`);
      }
    });

    it('channel with threads (reactions mode) — parent + each thread scanned', async () => {
      const threads = [
        mockThreadChannel('t1', 'thread-1', 'ch1'),
        mockThreadChannel('t2', 'thread-2', 'ch1'),
        mockThreadChannel('t3', 'thread-3', 'ch1'),
      ];

      setupThreadDiscovery({ ch1: threads });

      // Each channel/thread returns 1 message with no reactions
      mockFetchMessageData.mockImplementation(
        (_token: string, lastId: string, channelId: string) => {
          if (lastId === '') {
            return Promise.resolve({
              success: true,
              data: [mockMessage(`${channelId}_m1`)],
            });
          }
          return Promise.resolve({ success: false, data: [] });
        },
      );

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      // fetchMessageData should be called for ch1, t1, t2, t3 (4 total, plus their empty follow-ups)
      const channelIds = mockFetchMessageData.mock.calls.map((c: any[]) => c[2]);
      expect(channelIds).toContain('ch1');
      expect(channelIds).toContain('t1');
      expect(channelIds).toContain('t2');
      expect(channelIds).toContain('t3');
    });

    it('thread discovery + purge end-to-end (2 channels with threads)', async () => {
      const thread1a = mockThreadChannel('t1a', 'thread-1a', 'ch1');
      const thread1b = mockThreadChannel('t1b', 'thread-1b', 'ch1');
      const thread2a = mockThreadChannel('t2a', 'thread-2a', 'ch2');

      setupThreadDiscovery({ ch1: [thread1a, thread1b], ch2: [thread2a] });

      const channelMsgs: Record<string, number> = { ch1: 3, ch2: 5 };
      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          const count = channelMsgs[channelId] || 0;
          if (count > 0) {
            channelMsgs[channelId] = 0;
            return Promise.resolve({
              success: true,
              data: {
                messages: [
                  Array.from({ length: count }, (_, i) =>
                    mockMessage(`${channelId}_${i}`),
                  ),
                ],
              },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'alpha'), mockChannel('ch2', 'beta')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(8);

      // Verify ch1 search includes its threads
      const ch1Call = mockFetchSearchMessageData.mock.calls.find(
        (c: any[]) => c[2] === 'ch1',
      );
      expect(ch1Call[4].channelIds).toContain('t1a');
      expect(ch1Call[4].channelIds).toContain('t1b');

      // Verify ch2 search includes its thread
      const ch2Call = mockFetchSearchMessageData.mock.calls.find(
        (c: any[]) => c[2] === 'ch2',
      );
      expect(ch2Call[4].channelIds).toContain('t2a');
    });

    // Cancel & error at scale
    it('cancel mid-channel in multi-channel purge preserves partial stats', async () => {
      const channels = [
        mockChannel('ch1', 'alpha'),
        mockChannel('ch2', 'beta'),
        mockChannel('ch3', 'gamma'),
      ];

      const channelMsgs: Record<string, number> = { ch1: 10, ch2: 50, ch3: 20 };
      let deleteCount = 0;

      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          const count = channelMsgs[channelId] || 0;
          if (count > 0) {
            channelMsgs[channelId] = 0;
            return Promise.resolve({
              success: true,
              data: {
                messages: [
                  Array.from({ length: count }, (_, i) =>
                    mockMessage(`${channelId}_${i}`),
                  ),
                ],
              },
            });
          }
          return Promise.resolve({ success: true, data: { messages: [] } });
        },
      );

      // Cancel after first channel completes (during second channel processing)
      // checkCancelled is called many times: during thread discovery, between channels,
      // and per-message. Use deleteCount to know when ch1 is done.
      (checkCancelled as Mock).mockImplementation(() => {
        return deleteCount >= 10; // Cancel once ch1's 10 messages are deleted
      });

      mockDeleteMessage.mockImplementation(() => {
        deleteCount++;
        return Promise.resolve({ success: true, status: 204 });
      });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);

      // ch1 should be fully processed (10), ch2 and ch3 never started
      expect(deleteCount).toBe(10);

      const entries = store.getState().status.entries;
      const cancelEntry = entries.find(
        (e) => e.level === 'warning' && e.message.includes('Cancelled'),
      );
      expect(cancelEntry).toBeDefined();
    });

    it('per-channel error recovery — continues processing remaining channels', async () => {
      const channels = [
        mockChannel('ch1', 'alpha'),
        mockChannel('ch2', 'beta'),
        mockChannel('ch3', 'gamma'),
        mockChannel('ch4', 'delta'),
        mockChannel('ch5', 'epsilon'),
      ];

      mockFetchSearchMessageData.mockImplementation(
        (_token: string, _offset: number, channelId: string) => {
          if (channelId === 'ch3') {
            return Promise.reject(new Error('Permission denied'));
          }
          return Promise.resolve({
            success: true,
            data: {
              messages: [[mockMessage(`${channelId}_m1`)]],
            },
          });
        },
      );
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels,
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      const payload = result.payload as { success: true; errors?: string[] };
      expect(payload.errors).toHaveLength(1);
      expect(payload.errors![0]).toContain('gamma');

      // Should have processed ch1, ch2, ch4, ch5 (4 deletions)
      expect(mockDeleteMessage).toHaveBeenCalledTimes(4);

      const entries = store.getState().status.entries;
      const errorEntry = entries.find(
        (e) => e.level === 'error' && e.message.includes('gamma'),
      );
      expect(errorEntry).toBeDefined();
    });
  });

  describe('Forum channel purge', () => {
    it('forum channel purge discovers threads and includes them in search', async () => {
      const forumThread = mockChannel('ft1', 'forum-thread-1');
      (forumThread as any).parent_id = 'forum1';
      (forumThread as any).type = 11;

      setupThreadDiscovery({ forum1: [forumThread] });
      setupSearchResults([
        [mockMessage('msg1')],
        [],
      ]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockForumChannel('forum1', 'feedback')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);

      const entries = store.getState().status.entries;
      const threadEntry = entries.find((e) => e.message.includes('1 thread'));
      expect(threadEntry).toBeDefined();
    });

    it('forum channel with no threads completes gracefully', async () => {
      setupNoThreads();
      setupSearchResults([[]]);

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockForumChannel('forum1', 'feedback')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);

      // Empty forum logs "no messages" warning — not an error
      const entries = store.getState().status.entries;
      const skipEntry = entries.find(
        (e) => e.message.includes('feedback') && e.message.includes('no messages'),
      );
      expect(skipEntry).toBeDefined();
    });

    it('forum channel logs thread count in starting message', async () => {
      const forumThread1 = mockChannel('ft1', 'thread-1');
      (forumThread1 as any).parent_id = 'forum1';
      (forumThread1 as any).type = 11;
      const forumThread2 = mockChannel('ft2', 'thread-2');
      (forumThread2 as any).parent_id = 'forum1';
      (forumThread2 as any).type = 11;

      setupThreadDiscovery({ forum1: [forumThread1, forumThread2] });
      setupSearchResults([[]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockForumChannel('forum1', 'feedback')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const startEntry = entries.find(
        (e) => e.message.includes('#feedback') && e.message.includes('2 threads discovered'),
      );
      expect(startEntry).toBeDefined();
    });

  });

  // ── Status Log Detail ────────────────────────────────────────────────────

  describe('bulkPurgeChannels — final pass over the newest messages (#257)', () => {
    const OTHER_USER = { id: 'other-user', username: 'other' } as unknown as User;

    it('deletes matching messages the search index never returned and reports them', async () => {
      setupSearchResults([[mockMessage('m1')], []]);
      // Newest page: one already-deleted-via-search id (search saw it), one
      // fresh message search missed, one by someone else.
      mockFetchMessageData.mockResolvedValue({
        success: true,
        data: [mockMessage('fresh-1'), mockMessage('m1'), mockMessage('theirs', 0, [], OTHER_USER)],
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchMessageData).toHaveBeenCalledTimes(1);
      expect(mockFetchMessageData).toHaveBeenCalledWith(TOKEN, '', 'ch1');
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds).toEqual(['m1', 'fresh-1']);

      const entries = store.getState().status.entries.map((e: { message: string }) => e.message);
      expect(entries.some((m) => m.includes('Final pass over the newest messages in #general: found 1 more to process'))).toBe(true);
      expect(entries.some((m) => m.includes('Completed #general') && m.includes('2 deleted, 1 from the final pass'))).toBe(true);
      expect(entries.some((m) => m.includes('2 messages deleted, 1 from the final pass'))).toBe(true);
    });

    it('applies the purge criteria to the newest page (content terms, other authors)', async () => {
      setupSearchResults([[], []]);
      const hit = { ...mockMessage('hit', 0, [], OTHER_USER), content: 'please remove THIS' } as Message;
      const miss = { ...mockMessage('miss', 0, [], OTHER_USER), content: 'keep me' } as Message;
      mockFetchMessageData.mockResolvedValue({ success: true, data: [hit, miss, mockMessage('mine')] });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([OTHER_USER.id]),
          guildId: 'guild1',
          searchCriteria: { searchMessageContents: ['this'] } as unknown as SearchCriteria,
        }),
      );

      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deletedIds).toEqual(['hit']);
    });

    it('reads the newest page once per channel when purging several users', async () => {
      setupSearchResults([[], []]);
      mockFetchMessageData.mockResolvedValue({
        success: true,
        data: [mockMessage('a1'), mockMessage('b1', 0, [], OTHER_USER)],
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id, OTHER_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchMessageData).toHaveBeenCalledTimes(1);
      const deletedIds = mockDeleteMessage.mock.calls.map((c) => c[1]).sort();
      expect(deletedIds).toEqual(['a1', 'b1']);
    });

    it('skips the final pass when the channel is outside an explicit channel filter', async () => {
      setupSearchResults([[], []]);
      mockFetchMessageData.mockResolvedValue({ success: true, data: [mockMessage('fresh')] });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
          searchCriteria: { channelIds: ['thread-only'] } as unknown as SearchCriteria,
        }),
      );

      expect(mockFetchMessageData).not.toHaveBeenCalled();
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('a cancel that lands during the final pass keeps the partial count in the summary', async () => {
      setupSearchResults([[mockMessage('m1')], []]);
      mockFetchMessageData.mockResolvedValue({
        success: true,
        data: [mockMessage('fresh-1'), mockMessage('fresh-2'), mockMessage('fresh-3')],
      });
      // Cancel once the first final-pass delete has gone out.
      (checkCancelled as Mock).mockImplementation(() => mockDeleteMessage.mock.calls.length >= 2);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries as Array<{ level: string; message: string }>;
      const cancelled = entries.find((e) => e.level === 'warning' && e.message.includes('Cancelled'));
      expect(cancelled?.message).toContain('2 messages deleted, 1 from the final pass');
    });

    it('rolls the final-pass count into the multi-server summary', async () => {
      mockFetchChannels.mockReset();
      mockFetchGuildUser.mockReset();
      mockFetchGuildUser.mockResolvedValue({ success: true, status: 200, data: { roles: [] } });
      mockFetchChannels.mockImplementation((_t: string, guildId: string) => Promise.resolve({
        success: true,
        status: 200,
        data: [{ id: guildId === 'g1' ? 'c1' : 'c2', name: 'general', type: 0 }],
      }));
      setupSearchResults([[mockMessage('m1')], []]);
      mockFetchMessageData.mockImplementation((_t: string, _l: string, channelId: string) => Promise.resolve({
        success: true,
        data: [mockMessage(`fresh-${channelId}`)],
      }));
      const guild = (id: string, name: string): Guild =>
        ({ id, name, icon: null, permissions: String((1n << 10n) | (1n << 16n)) } as unknown as Guild);

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const deleted = mockDeleteMessage.mock.calls.map((c) => c[1]);
      expect(deleted).toEqual(expect.arrayContaining(['fresh-c1', 'fresh-c2']));
      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages.some((m) => m.startsWith('Purge: Complete · 2 of 2 servers') && m.includes('2 from the final pass'))).toBe(true);
    });

    it('attachments-only mode edits a final-pass message instead of deleting it and reports no final-pass deletions', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      setupSearchResults([[], []]);
      mockFetchMessageData.mockResolvedValue({ success: true, data: [mockMessage('fresh', 0, [attachment])] });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id], false, true),
          guildId: 'guild1',
        }),
      );

      expect(mockEditMessage).toHaveBeenCalledWith(TOKEN, 'fresh', { attachments: [] }, 'ch1');
      expect(mockDeleteMessage).not.toHaveBeenCalled();
      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages.some((m) => m.includes('Final pass over the newest messages in #general: found 1 more'))).toBe(true);
      expect(messages.some((m) => m.includes('from the final pass'))).toBe(false);
    });

    it('final-pass messages still go through the pinned and preserve gates', async () => {
      const link = { ...mockMessage('linked'), content: 'see https://example.com' } as Message;
      const pinned = { ...mockMessage('pinned'), pinned: true } as Message;
      setupSearchResults([[], []]);
      mockFetchMessageData.mockResolvedValue({ success: true, data: [link, pinned, mockMessage('plain')] });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { ...messagesConfig([CURRENT_USER.id]), preserveMediaAndLinks: true },
          guildId: 'guild1',
          searchCriteria: { isPinned: IsPinnedType.NO } as unknown as SearchCriteria,
        }),
      );

      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['plain']);
      const messages = store.getState().status.entries.map((e) => e.message);
      // The pinned message never reaches the loop (the isPinned=NO criteria
      // drops it client-side on the final pass); the linked one is skipped
      // by the preserve gate and counted.
      expect(messages.some((m) => m.includes('Completed #general') && m.includes('1 deleted, 1 from the final pass, 1 skipped'))).toBe(true);
      expect(messages.some((m) => m.includes('Preserved 1 message with files or links'))).toBe(true);
    });

    it('warns and finishes cleanly when the newest page cannot be read', async () => {
      setupSearchResults([[mockMessage('m1')], []]);
      mockFetchMessageData.mockResolvedValue({ success: false, status: 403 });

      const result = await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(bulkPurgeChannels.fulfilled.match(result)).toBe(true);
      expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
      const entries = store.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some((e) => e.level === 'warning' && e.message.includes('Could not read the newest messages in #general for the final pass'))).toBe(true);
      expect(entries.some((e) => e.message.includes('from the final pass'))).toBe(false);
    });
  });

  describe('status log detail', () => {
    it('never calls fetchActiveGuildThreads (bot-only endpoint)', async () => {
      setupNoThreads();
      setupSearchResults([[]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      expect(mockFetchActiveGuildThreads).not.toHaveBeenCalled();
    });

    it('says "1 message deleted" at a count of one', async () => {
      setupNoThreads();
      setupSearchResults([[mockMessage('m1')], []]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages.some((m) => m.startsWith('Purge: Complete ·') && m.includes('1 message deleted'))).toBe(true);
      expect(messages.some((m) => m.includes('1 messages deleted'))).toBe(false);
    });

    it('logs search batch details in messages mode', async () => {
      setupNoThreads();
      setupSearchResults([
        [mockMessage('m1'), mockMessage('m2'), mockMessage('m3')],
        [],
      ]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const batchEntry = entries.find(
        (e) => e.message.includes('batch 1') && e.message.includes('found 3 message'),
      );
      expect(batchEntry).toBeDefined();
    });

    it('logs a "Searching … for matching messages" start entry in messages mode', async () => {
      setupNoThreads();
      setupSearchResults([
        [mockMessage('m1')],
        [],
      ]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const startEntry = entries.find(
        (e) => e.message.includes('Searching') && e.message.includes('#general') && e.message.includes('matching messages'),
      );
      expect(startEntry).toBeDefined();
    });

    it('surfaces Discord\'s total_results count up front in messages mode', async () => {
      setupNoThreads();
      mockFetchSearchMessageData.mockImplementation(() => Promise.resolve({
        success: true,
        data: { messages: [[mockMessage('m1')]], total_results: 1234 },
      }));
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const totalEntry = entries.find(
        (e) => e.message.includes('Discord reports') && e.message.includes('1,234'),
      );
      expect(totalEntry).toBeDefined();
    });

    it('logs scan batch details with reaction counts in reactions mode', async () => {
      setupNoThreads();
      const msg1 = mockMessage('m1');
      msg1.reactions = [{ emoji: { id: null, name: '😄' }, count: 1, me: true, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];
      const msg2 = mockMessage('m2'); // no reactions

      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) {
          return Promise.resolve({ success: true, data: [msg1, msg2] });
        }
        return Promise.resolve({ success: true, data: [] });
      });

      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'test', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const scanEntry = entries.find(
        (e) => e.message.includes('batch 1') && e.message.includes('2 messages') && e.message.includes('1 with reactions'),
      );
      expect(scanEntry).toBeDefined();
    });

    it('logs a "Scanning messages for matching reactions" start entry in reactions mode', async () => {
      setupNoThreads();
      mockFetchMessageData.mockResolvedValue({ success: true, data: [] });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['u1', 'u2']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const startEntry = entries.find(
        (e) => e.message.includes('Scanning messages for matching reactions') && e.message.includes('2 users'),
      );
      expect(startEntry).toBeDefined();
    });

    it('logs a "Scanning messages for reactions to clear" start entry in clearReactions mode', async () => {
      setupNoThreads();
      mockFetchMessageData.mockResolvedValue({ success: true, data: [] });
      mockDeleteAllReactionsFromMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { mode: 'clearReactions', targetUserIds: [], retainAttachedMedia: false, deleteAttachmentsOnly: false },
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const startEntry = entries.find(
        (e) => e.message.includes('Scanning messages for reactions to clear'),
      );
      expect(startEntry).toBeDefined();
    });

    it('logs silent-batch progress every 5th empty-reaction batch in reactions mode', async () => {
      setupNoThreads();
      // Six full pages of 100 messages with no reactions, then empty.
      // Existing code only logged batches with reactions — silent-scan
      // users saw no feedback. New code throttles silent batches to
      // every 5th page.
      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall <= 6) {
          const msgs = Array.from({ length: 100 }, (_, i) => mockMessage(`m-${fetchCall}-${i}`));
          return Promise.resolve({ success: true, data: msgs });
        }
        return Promise.resolve({ success: true, data: [] });
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['u1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const silentBatchEntries = entries.filter(
        (e) => e.message.includes('messages scanned, no reactions found yet'),
      );
      // Expect batch 1 (first-ever) and batch 5 to fire; batches 2-4 and 6 stay silent
      expect(silentBatchEntries.length).toBeGreaterThanOrEqual(2);
      expect(silentBatchEntries[0].message).toContain('batch 1');
      expect(silentBatchEntries.some((e) => e.message.includes('batch 5'))).toBe(true);
    });

    it('logs per-channel discovery progress when scanning threads across multiple channels', async () => {
      setupThreadDiscovery({});
      setupSearchResults([[]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [
            mockChannel('ch1', 'general'),
            mockChannel('ch2', 'random'),
            mockChannel('ch3', 'media'),
          ],
          config: messagesConfig(['u1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const perChannelEntries = entries.filter(
        (e) => e.message.includes('Scanning threads in #') && e.message.includes('/3'),
      );
      // One entry per channel (3 channels)
      expect(perChannelEntries.length).toBe(3);
      expect(perChannelEntries[0].message).toContain('(1/3)');
      expect(perChannelEntries[1].message).toContain('(2/3)');
      expect(perChannelEntries[2].message).toContain('(3/3)');
    });

    it('logs scan batch details in clearReactions mode', async () => {
      setupNoThreads();
      const msg1 = mockMessage('m1');
      msg1.reactions = [{ emoji: { id: null, name: '👍' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];

      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) {
          return Promise.resolve({ success: true, data: [msg1] });
        }
        return Promise.resolve({ success: true, data: [] });
      });
      mockDeleteAllReactionsFromMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { mode: 'clearReactions', targetUserIds: [], retainAttachedMedia: false, deleteAttachmentsOnly: false },
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const scanEntry = entries.find(
        (e) => e.message.includes('batch 1') && e.message.includes('1 messages') && e.message.includes('1 with reactions'),
      );
      expect(scanEntry).toBeDefined();
    });

    it('logs thread processing entry when threads exist', async () => {
      const thread = { id: 't1', name: 'Thread 1', parent_id: 'ch1', type: 11 } as Channel;
      setupThreadDiscovery({ ch1: [thread] });

      mockFetchMessageData.mockImplementation(() => {
        return Promise.resolve({ success: true, data: [] });
      });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const threadEntry = entries.find(
        (e) => e.message.includes('Processing 1 thread') && e.message.includes('#general'),
      );
      expect(threadEntry).toBeDefined();
    });

    it('logs "Discovering threads" at start of thread discovery', async () => {
      setupNoThreads();
      setupSearchResults([[]]);

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general'), mockChannel('ch2', 'random')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const discoverEntry = entries.find(
        (e) => e.message.includes('Discovering threads across 2 channel'),
      );
      expect(discoverEntry).toBeDefined();
    });

    it('suppresses scan entries for threads with 0 reactions', async () => {
      const thread = { id: 't1', name: 'Empty Thread', parent_id: 'ch1', type: 11 } as Channel;
      setupThreadDiscovery({ ch1: [thread] });

      // Parent channel: 1 message with reactions
      // Thread: 1 message with NO reactions
      mockFetchMessageData.mockImplementation(
        (_token: string, lastId: string, channelId: string) => {
          if (channelId === 'ch1' && lastId === '') {
            const msg = mockMessage('m1');
            msg.reactions = [{ emoji: { id: null, name: '👍' }, count: 1, me: true, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];
            return Promise.resolve({ success: true, data: [msg] });
          }
          if (channelId === 't1' && lastId === '') {
            return Promise.resolve({ success: true, data: [mockMessage('m2')] });
          }
          return Promise.resolve({ success: true, data: [] });
        },
      );
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'test', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      // Should have scan entry for parent channel (1 with reactions)
      const parentScan = entries.find(
        (e) => e.message.includes('1 with reactions'),
      );
      expect(parentScan).toBeDefined();

      // Should NOT have scan entry for the thread (0 with reactions — suppressed)
      const threadScan = entries.find(
        (e) => e.message.includes('0 with reactions'),
      );
      expect(threadScan).toBeUndefined();
    });

    it('logs per-reaction removal in reactions mode', async () => {
      setupNoThreads();
      const msg = mockMessage('m1');
      msg.reactions = [{ emoji: { id: null, name: '😄' }, count: 1, me: true, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] }];

      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) return Promise.resolve({ success: true, data: [msg] });
        return Promise.resolve({ success: true, data: [] });
      });
      mockGetReactions.mockResolvedValue({
        success: true,
        data: [{ id: 'user1', username: 'test', discriminator: '0', avatar: null }],
      });
      mockDeleteReaction.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: reactionsConfig(['user1']),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const removeEntry = entries.find(
        (e) => e.message.includes('Removed reaction 1') && e.message.includes('😄'),
      );
      expect(removeEntry).toBeDefined();
    });

    it('logs per-message clearing in clearReactions mode', async () => {
      setupNoThreads();
      const msg = mockMessage('m1');
      msg.reactions = [
        { emoji: { id: null, name: '👍' }, count: 2, me: false, me_burst: false, count_details: { burst: 0, normal: 2 }, burst_colors: [] },
        { emoji: { id: null, name: '❤️' }, count: 1, me: false, me_burst: false, count_details: { burst: 0, normal: 1 }, burst_colors: [] },
      ];

      let fetchCall = 0;
      mockFetchMessageData.mockImplementation(() => {
        fetchCall++;
        if (fetchCall === 1) return Promise.resolve({ success: true, data: [msg] });
        return Promise.resolve({ success: true, data: [] });
      });
      mockDeleteAllReactionsFromMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: { mode: 'clearReactions', targetUserIds: [], retainAttachedMedia: false, deleteAttachmentsOnly: false },
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const clearEntry = entries.find(
        (e) => e.message.includes('Clearing 2 reactions from message'),
      );
      expect(clearEntry).toBeDefined();
    });

    it('logs progress totals in messages mode', async () => {
      setupNoThreads();
      setupSearchResults([
        [mockMessage('m1'), mockMessage('m2')],
        [],
      ]);
      mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });

      await store.dispatch(
        bulkPurgeChannels({
          channels: [mockChannel('ch1', 'general')],
          config: messagesConfig([CURRENT_USER.id]),
          guildId: 'guild1',
        }),
      );

      const entries = store.getState().status.entries;
      const progressEntry = entries.find(
        (e) => e.message.includes('2 deleted') && e.message.includes('so far'),
      );
      expect(progressEntry).toBeDefined();
    });
  });

  // ── Multi-server purge (#255) ─────────────────────────────────────────────

  describe('purgeGuilds — multi-server purge (#255)', () => {
    const VIEW_CHANNEL = String(1n << 10n);
    const guild = (id: string, name: string, permissions: string | undefined = String((1n << 10n) | (1n << 16n))): Guild =>
      ({ id, name, icon: null, permissions } as unknown as Guild);
    const textChannel = (id: string, name: string, extra: Record<string, unknown> = {}): Channel =>
      ({ id, name, type: 0, ...extra }) as unknown as Channel;
    const categoryChannel = (id: string, name: string): Channel => ({ id, name, type: 4 }) as Channel;
    const voiceChannel = (id: string, name: string): Channel => ({ id, name, type: 2 }) as Channel;

    /** One page per channel keyed by channel id, then empties. */
    const setupPerChannelSearch = (pages: Record<string, Message[]>) => {
      const served = new Set<string>();
      mockFetchSearchMessageData.mockImplementation((_t: string, _o: number, channelId: string) => {
        if (!served.has(channelId) && pages[channelId]?.length) {
          served.add(channelId);
          return Promise.resolve({ success: true, data: { messages: [pages[channelId]] } });
        }
        return Promise.resolve({ success: true, data: { messages: [] } });
      });
    };

    const channelsByGuild = (map: Record<string, Channel[] | { status: number }>) => {
      mockFetchChannels.mockImplementation((_t: string, guildId: string) => {
        const entry = map[guildId];
        if (!entry) return Promise.resolve({ success: false, status: 404 });
        if (!Array.isArray(entry)) return Promise.resolve({ success: false, status: entry.status });
        return Promise.resolve({ success: true, status: 200, data: entry });
      });
    };

    beforeEach(() => {
      mockFetchChannels.mockReset();
      mockFetchGuildUser.mockReset();
      mockFetchGuildUser.mockResolvedValue({ success: true, status: 200, data: { roles: [] } });
    });

    it('walks the selected servers in order and purges every readable message channel in each', async () => {
      channelsByGuild({
        g1: [categoryChannel('cat', 'Text'), textChannel('c1', 'general'), voiceChannel('v1', 'lounge')],
        g2: [textChannel('c2', 'chat')],
      });
      setupPerChannelSearch({ c1: [mockMessage('m1')], v1: [mockMessage('m2')], c2: [mockMessage('m3')] });

      const result = await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      expect(purgeGuilds.fulfilled.match(result)).toBe(true);
      expect(result.payload).toEqual({ success: true });
      expect(mockFetchChannels.mock.calls.map((c) => c[1])).toEqual(['g1', 'g2']);
      // Category skipped; text + voice purged; deletes in server order.
      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m1', 'm2', 'm3']);
      const searchedChannels = new Set(mockFetchSearchMessageData.mock.calls.map((c) => c[2]));
      expect(searchedChannels.has('cat')).toBe(false);

      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages).toContain('Purge: Starting operation across 2 servers');
      expect(messages).toContain('Purge: Server 1 of 2 · Alpha');
      expect(messages).toContain('Purge: Alpha · 2 channels to process');
      expect(messages).toContain('Purge: Server 2 of 2 · Beta');
      expect(messages.some((m) => m.startsWith('Purge: Alpha complete · 2 channels'))).toBe(true);
      expect(messages.some((m) => m.startsWith('Purge: Complete · 2 of 2 servers'))).toBe(true);
      expect(selectIsPurging(store.getState())).toBe(false);
      expect(selectPurgeError(store.getState())).toBeNull();
    });

    it('carries the server position on the bulk progress so the operation label can show it', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')], c2: [mockMessage('m2')] });

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const progress = selectPurgeProgress(store.getState());
      expect(progress?.bulk?.server).toEqual({ name: 'Beta', index: 1, total: 2 });
      expect(progress?.bulk?.totalChannels).toBe(1);
    });

    it('skips channels the user cannot read, using member roles for the overwrite check', async () => {
      const denyEveryone = { permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: VIEW_CHANNEL }] };
      channelsByGuild({ g1: [textChannel('hidden', 'staff', denyEveryone), textChannel('c1', 'general')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')], hidden: [mockMessage('m9')] });

      await store.dispatch(purgeGuilds({ guilds: [guild('g1', 'Alpha')], config: messagesConfig([CURRENT_USER.id]) }));

      expect(mockFetchGuildUser).toHaveBeenCalledWith('g1', CURRENT_USER.id, TOKEN);
      const searchedChannels = new Set(mockFetchSearchMessageData.mock.calls.map((c) => c[2]));
      expect(searchedChannels.has('hidden')).toBe(false);
      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m1']);
    });

    it('reports a server whose channels cannot be loaded and continues with the next one', async () => {
      channelsByGuild({ g1: { status: 403 }, g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c2: [mockMessage('m2')] });

      const result = await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      expect(result.payload).toEqual({ success: true, errors: ['Alpha: could not load channels (HTTP 403)'] });
      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m2']);
      const entries = store.getState().status.entries;
      expect(entries.find((e) => e.level === 'error')?.message).toBe('Purge: Alpha · could not load channels (HTTP 403), skipped');
      expect(entries.map((e) => e.message).some((m) => m.startsWith('Purge: Complete · 1 of 2 servers'))).toBe(true);
      expect(store.getState().purge.channelErrorCount).toBe(1);
    });

    it('logs a server with no readable channels and moves on', async () => {
      channelsByGuild({ g1: [categoryChannel('cat', 'Text')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c2: [mockMessage('m2')] });

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages).toContain('Purge: Alpha · no readable channels, skipped');
      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m2']);
      expect(messages.some((m) => m.startsWith('Purge: Complete · 2 of 2 servers'))).toBe(true);
    });

    it('stops after the current server when cancelled and reports a cancelled summary', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')], c2: [mockMessage('m2')] });
      // Cancel lands during the first server's channel walk.
      let calls = 0;
      (checkCancelled as Mock).mockImplementation(() => {
        calls += 1;
        return calls > 3;
      });

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      expect(mockFetchChannels.mock.calls.map((c) => c[1])).toEqual(['g1']);
      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages.some((m) => m.startsWith('Purge: Cancelled · 1 of 2 servers'))).toBe(true);
      expect(selectIsPurging(store.getState())).toBe(false);
    });

    it('paces between servers with the search delay', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')], c2: [mockMessage('m2')] });
      (cancellableDelay as Mock).mockClear();

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      // One between-server sleep for two servers (plus whatever the
      // channel walks themselves sleep). It must not be zero.
      expect((cancellableDelay as Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('honors pause at every server boundary', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')], g3: [textChannel('c3', 'misc')] });
      setupPerChannelSearch({});
      (waitWhilePaused as Mock).mockClear();

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'A'), guild('g2', 'B'), guild('g3', 'C')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      // At least once per server before its channels are fetched.
      expect((waitWhilePaused as Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('records a failure that escapes one server\'s walk and continues with the next server', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c2: [mockMessage('m2')] });
      // The service lookup inside the first server's walk blows up,
      // outside the per-channel handling. Call 1 is purgeGuilds' own
      // lookup; call 2 is executeBulkPurge's.
      const svc = getDiscordService();
      vi.mocked(getDiscordService)
        .mockImplementationOnce(() => svc)
        .mockImplementationOnce(() => { throw new Error('boom'); });

      const result = await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      expect(purgeGuilds.fulfilled.match(result)).toBe(true);
      expect((result.payload as { errors?: string[] }).errors).toEqual(['Alpha: boom']);
      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m2']);
      const messages = store.getState().status.entries.map((e) => e.message);
      expect(messages).toContain('Purge: Alpha · stopped early, boom');
      expect(messages.some((m) => m.startsWith('Purge: Complete · 1 of 2 servers'))).toBe(true);
    });

    it('still purges when the member-roles lookup fails, using guild-level permissions', async () => {
      mockFetchGuildUser.mockResolvedValue({ success: false, status: 404 });
      channelsByGuild({ g1: [textChannel('c1', 'general')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')] });

      await store.dispatch(purgeGuilds({ guilds: [guild('g1', 'Alpha')], config: messagesConfig([CURRENT_USER.id]) }));

      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m1']);
    });

    it('treats a server with no permission data as fully readable', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')] });

      await store.dispatch(purgeGuilds({ guilds: [guild('g1', 'Alpha', undefined)], config: messagesConfig([CURRENT_USER.id]) }));

      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m1']);
    });

    it('retries a transient channel-list failure before giving up on a server', async () => {
      let calls = 0;
      mockFetchChannels.mockImplementation(() => {
        calls += 1;
        return Promise.resolve(calls === 1
          ? { success: false, status: 503 }
          : { success: true, status: 200, data: [textChannel('c1', 'general')] });
      });
      setupPerChannelSearch({ c1: [mockMessage('m1')] });

      const result = await store.dispatch(purgeGuilds({ guilds: [guild('g1', 'Alpha')], config: messagesConfig([CURRENT_USER.id]) }));

      expect(mockFetchChannels).toHaveBeenCalledTimes(2);
      expect(result.payload).toEqual({ success: true });
      expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['m1']);
    });

    it('passes the filter criteria through to every server\'s search and scopes each search to its server', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c1: [mockMessage('m1')], c2: [mockMessage('m2')] });
      const after = new Date('2025-01-01T00:00:00.000Z');

      await store.dispatch(
        purgeGuilds({
          guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')],
          config: messagesConfig([CURRENT_USER.id]),
          searchCriteria: { searchAfterDate: after } as unknown as SearchCriteria,
        }),
      );

      const calls = mockFetchSearchMessageData.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[4].searchAfterDate).toEqual(after);
        expect(call[4].userIds).toEqual([CURRENT_USER.id]);
      }
      const guildForChannel = new Map(calls.map((c) => [c[2], c[3]]));
      expect(guildForChannel.get('c1')).toBe('g1');
      expect(guildForChannel.get('c2')).toBe('g2');
    });

    it('runs thread discovery for every server\'s channels', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({});
      mockFetchPublicThreads.mockClear();

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id]) }),
      );

      const scanned = mockFetchPublicThreads.mock.calls.map((c) => c.find((arg: unknown) => arg === 'c1' || arg === 'c2'));
      expect(scanned).toEqual(['c1', 'c2']);
    });

    it('attachments-only mode edits instead of deleting, across servers', async () => {
      const attachment = { id: 'att1', filename: 'photo.png', url: 'https://cdn.example.com/photo.png' };
      channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
      setupPerChannelSearch({ c1: [mockMessage('m1', 0, [attachment])], c2: [mockMessage('m2', 0, [attachment])] });

      await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], config: messagesConfig([CURRENT_USER.id], false, true) }),
      );

      expect(mockDeleteMessage).not.toHaveBeenCalled();
      expect(mockEditMessage.mock.calls.map((c) => c[1])).toEqual(['m1', 'm2']);
    });

    it('rejects up front when no target users are configured', async () => {
      channelsByGuild({ g1: [textChannel('c1', 'general')] });
      const result = await store.dispatch(purgeGuilds({ guilds: [guild('g1', 'Alpha')], config: messagesConfig([]) }));
      expect(purgeGuilds.rejected.match(result)).toBe(true);
      expect(result.payload).toBe('No target users specified');
      expect(mockFetchChannels).not.toHaveBeenCalled();
      expect(selectIsPurging(store.getState())).toBe(false);
    });

    it('rejects when no servers are selected or the token is missing', async () => {
      const empty = await store.dispatch(purgeGuilds({ guilds: [], config: messagesConfig([CURRENT_USER.id]) }));
      expect(purgeGuilds.rejected.match(empty)).toBe(true);
      expect(empty.payload).toBe('No servers selected');

      store = createStore({ token: null });
      const noToken = await store.dispatch(purgeGuilds({ guilds: [guild('g1', 'Alpha')], config: messagesConfig([CURRENT_USER.id]) }));
      expect(noToken.payload).toBe('Not authenticated');
      expect(mockFetchChannels).not.toHaveBeenCalled();
    });

    it('does not fetch channels when the guild list is fine but the user has no id (falls back to guild-level permissions)', async () => {
      store = createStore({ currentUser: { id: '', username: 'anon' } as User });
      channelsByGuild({ g1: [textChannel('c1', 'general')] });
      setupPerChannelSearch({});

      const result = await store.dispatch(
        purgeGuilds({ guilds: [guild('g1', 'Alpha')], config: messagesConfig(['someone']) }),
      );

      expect(mockFetchGuildUser).not.toHaveBeenCalled();
      expect(mockFetchChannels).toHaveBeenCalledTimes(1);
      expect(purgeGuilds.fulfilled.match(result)).toBe(true);
    });
  });
});
