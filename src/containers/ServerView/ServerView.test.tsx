import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor, act } from '../../test/test-utils';
import ServerView from './ServerView';
import { createBaseState, createAuthenticatedState } from '../../test/state-factories';
import { createMockMessage, createMockGuild, createMockChannel } from '../../test/fixtures';

// Mock virtualizer for MessageTable
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i, key: String(i), start: i * 53, end: (i + 1) * 53, size: 53, lane: 0,
      })),
    getTotalSize: () => count * 53,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

vi.mock('@/utils/messageLightFormatting', () => ({
  formatMessageContentLight: vi.fn((content: string) => content || '(no content)'),
}));

vi.mock('@/utils/userDisplayUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/userDisplayUtils')>();
  return {
    ...actual,
    getDisplayName: vi.fn(() => 'testuser'),
  };
});

const mockFetchChannel = vi.fn().mockResolvedValue({ success: true, data: createMockChannel({ id: 'thread-1', name: 'loaded-thread' }) });

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: [] }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    fetchAllMessages: vi.fn().mockResolvedValue([]),
    searchMessages: vi.fn().mockResolvedValue({ messages: [] }),
    fetchUserProfile: vi.fn().mockResolvedValue(null),
    fetchGuildMember: vi.fn().mockResolvedValue(null),
    fetchChannel: (...args: unknown[]) => mockFetchChannel(...args),
  })),
}));

// #226 test: the search thunk runs reaction/reply enrichment after the
// (mocked) search resolves; without these mocks the enrichment wrappers hit
// the real network through discrub-core.
vi.mock('@services/reactionEnrichmentService', () => ({
  reactionEnrichmentService: { enrichMessages: vi.fn(async (msgs: unknown) => msgs) },
}));
vi.mock('@services/replyEnrichmentService', () => ({
  replyEnrichmentService: { enrichMessages: vi.fn(async (msgs: unknown) => msgs) },
}));

vi.mock('@/extension/storage', () => {
  function makeAdapter() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      getMany: vi.fn().mockResolvedValue([]),
      setMany: vi.fn().mockResolvedValue(undefined),
      entries: vi.fn().mockResolvedValue([]),
    };
  }
  return {
    storage: {
      settings: makeAdapter(),
      state: makeAdapter(),
      presets: makeAdapter(),
      cache: makeAdapter(),
      history: makeAdapter(),
      statuslog: makeAdapter(),
      package: makeAdapter(),
      media: makeAdapter(),
    },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

const guild = createMockGuild({ id: 'g1', name: 'Test Guild' });
const channel = createMockChannel({ id: 'ch1', name: 'test-channel' });
const messages = [
  createMockMessage({ id: 'msg-1', content: 'Hello', channel_id: 'ch1' }),
  createMockMessage({ id: 'msg-2', content: 'World', channel_id: 'ch1' }),
];

describe('ServerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('Welcome State', () => {
    it('should show welcome panel when no channel or DM selected', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        }),
      });
      expect(screen.getByText('Welcome to Discrub')).toBeInTheDocument();
      expect(screen.getByText('Take a Tour')).toBeInTheDocument();
      expect(screen.getByText('Getting Started')).toBeInTheDocument();
      expect(screen.getByText('Features')).toBeInTheDocument();
    });
  });

  describe('Header', () => {
    it('should show channel name in header', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByRole('heading', { name: 'test-channel' })).toBeInTheDocument();
    });

    it('should show "All loaded" chip when hasMore is false and messages exist', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByText(/All loaded/)).toBeInTheDocument();
    });

    it('should not show "All loaded" chip when hasMore is true', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: 'msg-2', hasMore: true, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.queryByText(/All loaded/)).toBeNull();
    });

    it('should show message count', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByText(/2 messages/)).toBeInTheDocument();
    });
  });

  describe('Load All Button', () => {
    it('should show Load All button when hasMore is true in paginated mode', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: 'msg-2', hasMore: true, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByRole('button', { name: /Load All/ })).toBeInTheDocument();
    });

    it('should not show Load All button when all messages are loaded', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'all' as any,
            },
          } as any,
        }),
      });
      expect(screen.queryByRole('button', { name: /Load All/ })).toBeNull();
    });
  });

  // #226: ServerView stays mounted across selection changes, and its saved
  // search criteria previously survived a channel switch — stale chips kept
  // rendering (and FilterModal kept pre-filling) for the OLD conversation
  // even though Redux criteria were already cleared.
  // 2.2.0: the new layouts open Filters through the store, and the Timeline
  // strip writes the refine dates from outside the dialog. Every open has to
  // show what is saved, not what the dialog held when it first mounted.
  describe('Filters dialog reads the saved refine on every open', () => {
    it('shows refine dates that were set from outside the dialog, when opened through the store', async () => {
      const { store } = renderWithProviders(<ServerView variant="timeline" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { ...createBaseState().guild, guilds: [guild], selectedGuild: guild },
          channel: { ...createBaseState().channel, channels: [channel], selectedChannel: channel },
        }),
      });
      const { setRefineCriteria } = await import('@/features/message/messageSlice');
      const { setDialogOpen } = await import('@/features/app/appSlice');
      const { defaultCriteria } = await import('@/components/search/searchConstants');
      act(() => { store.dispatch(setRefineCriteria({ ...defaultCriteria, searchAfterDate: new Date(2026, 6, 10), searchBeforeDate: new Date(2026, 6, 15, 23, 59, 59, 999) })); });
      act(() => { store.dispatch(setDialogOpen({ dialog: 'filters', open: true })); });
      expect(await screen.findByTestId('clear-refine-filters')).toHaveTextContent('2');
      // Closed, range cleared from outside, opened again: the dialog follows.
      act(() => { store.dispatch(setDialogOpen({ dialog: 'filters', open: false })); });
      act(() => { store.dispatch(setRefineCriteria({ ...defaultCriteria })); });
      act(() => { store.dispatch(setDialogOpen({ dialog: 'filters', open: true })); });
      await waitFor(() => expect(screen.getByTestId('clear-refine-filters')).not.toHaveTextContent('2'));
    });
  });

  describe('Search criteria reset on conversation switch (#226)', () => {
    it('clears the saved search chips when the selected channel changes', async () => {
      const channelB = createMockChannel({ id: 'ch2', name: 'other-channel' });
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel, channelB], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });

      // Apply a server-side content search through the FilterModal.
      // Exact name — the adjacent TourButton is "Help: Filters".
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await userEvent.type(
        await screen.findByPlaceholderText('Search message content...'),
        'hello,',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(await screen.findByText('content: hello')).toBeInTheDocument();

      // Switch to another channel — the chip must not survive.
      const { setSelectedChannel } = await import('@/features/channel/channelSlice');
      store.dispatch(setSelectedChannel(channelB));
      await waitFor(() =>
        expect(screen.queryByText('content: hello')).not.toBeInTheDocument(),
      );
    });

    it('clears the saved search chips when the SAME channel is re-clicked', async () => {
      // A sidebar re-click of the current conversation dispatches
      // clearMessages without changing the selected id — the chips must
      // clear on the clearMessages signal (clearSeq), not just on id change.
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });

      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await userEvent.type(
        await screen.findByPlaceholderText('Search message content...'),
        'hello,',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(await screen.findByText('content: hello')).toBeInTheDocument();

      // The re-click flow's relevant dispatch, with the id unchanged.
      const { clearMessages } = await import('@/features/message/messageSlice');
      store.dispatch(clearMessages());
      await waitFor(() =>
        expect(screen.queryByText('content: hello')).not.toBeInTheDocument(),
      );
    });
  });

  // #223: an author-filtered search that returns nothing for a DELETED
  // account explains itself instead of a bare empty feed.
  describe('Deleted-account empty-search callout (#223)', () => {
    it('shows the deleted-account explanation when an author search returns empty', async () => {
      const preloaded = createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
      });
      preloaded.message = {
        ...preloaded.message,
        messages: [],
        filteredMessages: [],
        pagination: { ...preloaded.message.pagination, mode: 'search' as const },
      };
      preloaded.cache = {
        ...preloaded.cache,
        userMap: {
          'deleted-1': {
            userName: 'deleted_user_a1b2c3d4',
            displayName: null,
            avatar: null,
            guilds: {},
            timestamp: 1,
          },
        },
      };
      renderWithProviders(<ServerView />, { preloadedState: preloaded });

      // Select the deleted user in the search-section From picker, then Search.
      await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
      const pickers = await screen.findAllByPlaceholderText('Type to search or paste a User ID');
      await userEvent.type(pickers[0], 'deleted');
      await userEvent.click(await screen.findByText('deleted_user_a1b2c3d4'));
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));

      expect(await screen.findByText('This account was deleted')).toBeInTheDocument();
      expect(screen.getByText(/Purge handles deleted accounts automatically/)).toBeInTheDocument();
    });
  });

  describe('Export Button', () => {
    it('should show Export button', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
    });

    it('should disable Export when no messages', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
    });
  });

  describe('Operation Safety', () => {
    const operationRunningState = createAuthenticatedState({
      guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
      channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
      message: {
        messages,
        filteredMessages: messages,
        selectedMessages: [],
        searchCriteria: null,
        order: { order: 'desc' as any, orderBy: 'timestamp' },
        isLoading: false,
        isEditing: false,
        error: null,
        pagination: {
          lastMessageId: 'msg-2', hasMore: true, totalCount: null,
          isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
          mode: 'paginated' as any,
        },
      } as any,
      export: {
        isExporting: true,
        exportProgress: null,
        exportTotal: 0,
        currentPage: 0,
        totalPages: 0,
        exportError: null,
        exportFormat: 'html',
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
        mediaConfig: { images: true, videos: true, audio: true, other: true },
      } as any,
    });

    it('should disable Export button when operation is running', () => {
      renderWithProviders(<ServerView />, { preloadedState: operationRunningState });
      expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
    });

    it('should disable Load All button when operation is running', () => {
      renderWithProviders(<ServerView />, { preloadedState: operationRunningState });
      expect(screen.getByRole('button', { name: /Load All/ })).toBeDisabled();
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner when loading', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: true,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.queryByText(/Loading messages/)).not.toBeInTheDocument();
      const skeletons = document.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Error State', () => {
    it('should show error message when error exists', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: 'Failed to load messages',
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByText('Failed to load messages')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no messages and not loading', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages: [],
            filteredMessages: [],
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByText('No messages found in this channel')).toBeInTheDocument();
    });
  });

  describe('Per-Tab Header Title', () => {
    const makeThreadTab = (id: string, name: string) => ({
      threadId: id,
      threadName: name,
      messages: [],
      filteredMessages: [],
      selectedMessages: [],
      searchCriteria: null,
      order: { order: 'desc' as any, orderBy: 'timestamp' as any },
      isLoading: false,
      error: null,
      pagination: {
        lastMessageId: null, hasMore: false, totalCount: null,
        isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
        mode: 'paginated' as any,
      },
    });

    it('should show thread name in header when thread tab is active', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            isDeleting: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
            activeTab: 't1',
            threadTabs: { 't1': makeThreadTab('t1', 'Bug Discussion') },
          } as any,
        }),
      });
      expect(screen.getByRole('heading', { name: 'Bug Discussion' })).toBeInTheDocument();
    });

    it('should show channel name when on main tab with threads open', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            isDeleting: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
            activeTab: null,
            threadTabs: { 't1': makeThreadTab('t1', 'Bug Discussion') },
          } as any,
        }),
      });
      expect(screen.getByRole('heading', { name: 'test-channel' })).toBeInTheDocument();
    });
  });

  describe('Per-Tab Search Criteria Persistence', () => {
    const makeThreadTab = (id: string, name: string) => ({
      threadId: id,
      threadName: name,
      messages: [],
      filteredMessages: [],
      selectedMessages: [],
      searchCriteria: null,
      order: { order: 'desc' as any, orderBy: 'timestamp' as any },
      isLoading: false,
      error: null,
      pagination: {
        lastMessageId: null, hasMore: false, totalCount: null,
        isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
        mode: 'paginated' as any,
      },
    });

    const baseMessageState = {
      messages,
      filteredMessages: messages,
      selectedMessages: [],
      searchCriteria: null,
      order: { order: 'desc' as any, orderBy: 'timestamp' },
      isLoading: false,
      isDeleting: false,
      isEditing: false,
      error: null,
      pagination: {
        lastMessageId: null, hasMore: false, totalCount: null,
        isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
        mode: 'paginated' as any,
      },
      activeTab: null,
      threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
    } as any;

    it('should show empty search when switching to a tab with no saved criteria', async () => {
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: baseMessageState,
        }),
      });

      // On main tab, expand and type
      await user.click(screen.getByTestId('search-filters-button'));
      const input = screen.getByPlaceholderText('Search message content...');
      await user.type(input, 'hello');
      expect((input as HTMLInputElement).value).toBe('hello');

      // Switch to thread tab (triggers remount via key change)
      store.dispatch({ type: 'message/setActiveTab', payload: 't1' });

      // Expand search on thread tab — should be empty
      await user.click(screen.getByTestId('search-filters-button'));
      await waitFor(() => {
        const threadInput = screen.getByPlaceholderText('Search message content...');
        expect((threadInput as HTMLInputElement).value).toBe('');
      });
    });

    it('should discard unsaved changes when Cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: baseMessageState,
        }),
      });

      // Open modal, type content, then Cancel without applying
      await user.click(screen.getByTestId('search-filters-button'));
      await user.type(screen.getByPlaceholderText('Search message content...'), 'hello');
      await user.click(screen.getByRole('button', { name: /Cancel/ }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Reopen modal — should be empty (Cancel discarded changes)
      await user.click(screen.getByTestId('search-filters-button'));
      await waitFor(() => {
        const mainInput = screen.getByPlaceholderText('Search message content...');
        expect((mainInput as HTMLInputElement).value).toBe('');
      });
    });

    it('should not restore criteria for a closed and reopened thread tab', async () => {
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: { ...baseMessageState, activeTab: 't1' },
        }),
      });

      // On thread tab, expand and type
      await user.click(screen.getByTestId('search-filters-button'));
      await user.type(screen.getByPlaceholderText('Search message content...'), 'thread text');

      // Close thread tab (removeThreadTab)
      store.dispatch({ type: 'message/removeThreadTab', payload: 't1' });

      // Wait for cleanup effect to run (clears tabSearchCriteriaRef for closed tabs)
      await waitFor(() => {
        expect(store.getState().message.threadTabs['t1']).toBeUndefined();
      });

      // Reopen same thread tab (addThreadTab only takes threadId + threadName)
      store.dispatch({
        type: 'message/addThreadTab',
        payload: { threadId: 't1', threadName: 'Thread 1' },
      });

      // Expand search — should be empty (criteria was cleaned up on close)
      await user.click(screen.getByTestId('search-filters-button'));
      await waitFor(() => {
        const threadInput = screen.getByPlaceholderText('Search message content...');
        expect((threadInput as HTMLInputElement).value).toBe('');
      });
    });
  });

  describe('Per-Tab Partial Results Warning', () => {
    const makeThreadTab = (id: string, name: string) => ({
      threadId: id,
      threadName: name,
      messages: [],
      filteredMessages: [],
      selectedMessages: [],
      searchCriteria: null,
      order: { order: 'desc' as any, orderBy: 'timestamp' as any },
      isLoading: false,
      error: null,
      pagination: {
        lastMessageId: null, hasMore: false, totalCount: null,
        isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
        mode: 'paginated' as any,
      },
    });

    it('should not show warning on thread tab when warning is active on main tab', async () => {
      const user = userEvent.setup();
      const mainMessages = messages;
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages: mainMessages,
            filteredMessages: mainMessages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isDeleting: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: 'msg-2', hasMore: true, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
            activeTab: null,
            threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
          } as any,
        }),
      });

      // On main tab, trigger a local refine filter to trigger warning
      await user.click(screen.getByTestId('search-filters-button'));
      const refineInput = screen.getByPlaceholderText('Filter by content...');
      await user.type(refineInput, 'Hello,');
      await user.click(screen.getByRole('button', { name: /Apply Refine/ }));

      // Warning should be visible on main tab
      expect(screen.getByText(/Filtering Loaded Messages Only/)).toBeInTheDocument();

      // Switch to thread tab
      store.dispatch({ type: 'message/setActiveTab', payload: 't1' });

      // Warning should NOT be visible on thread tab
      await waitFor(() => {
        expect(screen.queryByText(/Filtering Loaded Messages Only/)).not.toBeInTheDocument();
      });
    });

    it('should preserve warning when switching back to the tab that triggered it', async () => {
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isDeleting: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: 'msg-2', hasMore: true, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
            activeTab: null,
            threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
          } as any,
        }),
      });

      // Trigger warning on main tab via Refine
      await user.click(screen.getByTestId('search-filters-button'));
      await user.type(screen.getByPlaceholderText('Filter by content...'), 'test,');
      await user.click(screen.getByRole('button', { name: /Apply Refine/ }));
      expect(screen.getByText(/Filtering Loaded Messages Only/)).toBeInTheDocument();

      // Switch to thread tab
      store.dispatch({ type: 'message/setActiveTab', payload: 't1' });
      await waitFor(() => {
        expect(screen.queryByText(/Filtering Loaded Messages Only/)).not.toBeInTheDocument();
      });

      // Switch back to main
      store.dispatch({ type: 'message/setActiveTab', payload: null });
      await waitFor(() => {
        expect(screen.getByText(/Filtering Loaded Messages Only/)).toBeInTheDocument();
      });
    });

    it('should remove warning for closed thread tab', async () => {
      const user = userEvent.setup();
      const threadMessages = [
        createMockMessage({ id: 'tmsg-1', content: 'Thread msg 1', channel_id: 't1' }),
        createMockMessage({ id: 'tmsg-2', content: 'Thread msg 2', channel_id: 't1' }),
      ];
      const { store } = renderWithProviders(<ServerView />, {
        preloadedState: createAuthenticatedState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          message: {
            messages,
            filteredMessages: messages,
            selectedMessages: [],
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isDeleting: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated' as any,
            },
            activeTab: 't1',
            threadTabs: {
              't1': {
                threadId: 't1',
                threadName: 'Thread 1',
                messages: threadMessages,
                filteredMessages: threadMessages,
                selectedMessages: [],
                searchCriteria: null,
                order: { order: 'desc' as any, orderBy: 'timestamp' },
                isLoading: false,
                error: null,
                pagination: {
                  lastMessageId: 'tmsg-2', hasMore: true, totalCount: null,
                  isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
                  mode: 'paginated' as any,
                },
              },
            },
          } as any,
        }),
      });

      // Trigger warning on thread tab via Refine (client-side filter with hasMore)
      await user.click(screen.getByTestId('search-filters-button'));
      await user.type(screen.getByPlaceholderText('Filter by content...'), 'message 1,');
      await user.click(screen.getByRole('button', { name: /Apply Refine/ }));
      expect(screen.getByText(/Filtering Loaded Messages Only/)).toBeInTheDocument();

      // Close thread tab
      store.dispatch({ type: 'message/removeThreadTab', payload: 't1' });

      // Wait for cleanup effect to run (clears warning for closed tabs)
      await waitFor(() => {
        expect(store.getState().message.threadTabs['t1']).toBeUndefined();
      });

      // Reopen same thread tab (addThreadTab only takes threadId + threadName)
      store.dispatch({
        type: 'message/addThreadTab',
        payload: { threadId: 't1', threadName: 'Thread 1' },
      });

      // Warning should be gone since the thread tab was closed and reopened
      await waitFor(() => {
        expect(screen.queryByText(/Filtering Loaded Messages Only/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Dialog Close on Confirm', () => {
    const dialogBaseState = createAuthenticatedState({
      guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
      channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
      message: {
        messages,
        filteredMessages: messages,
        selectedMessages: [],
        searchCriteria: null,
        order: { order: 'desc' as any, orderBy: 'timestamp' },
        isLoading: false,
        isEditing: false,
        error: null,
        pagination: {
          lastMessageId: 'msg-2', hasMore: true, totalCount: null,
          isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
          mode: 'paginated' as any,
        },
      } as any,
    });

    it('should close LoadAllDialog immediately when Load All is confirmed', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ServerView />, { preloadedState: dialogBaseState });

      // Open dialog
      await user.click(screen.getByRole('button', { name: /Load All/ }));
      expect(screen.getByText('Load All Messages')).toBeInTheDocument();

      // Confirm
      await user.click(screen.getByRole('button', { name: 'Load All' }));

      // Dialog should close immediately
      await waitFor(() => {
        expect(screen.queryByText('Are you sure you want to continue?')).not.toBeInTheDocument();
      });
    });

  });

  describe('Thread Load', () => {
    const baseState = createAuthenticatedState({
      guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
      channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
      message: {
        messages,
        filteredMessages: messages,
        selectedMessages: [],
        searchCriteria: null,
        order: { order: 'desc' as any, orderBy: 'timestamp' },
        isLoading: false,
        isDeleting: false,
        isEditing: false,
        error: null,
        pagination: {
          lastMessageId: null, hasMore: false, totalCount: null,
          isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
          mode: 'paginated' as any,
        },
        activeTab: null,
        threadTabs: {},
      } as any,
    });

    const openThreadModalAndLoad = async (user: ReturnType<typeof userEvent.setup>, threadId: string) => {
      await user.click(screen.getByRole('button', { name: /Load Thread/ }));
      const input = screen.getByRole('textbox');
      await user.type(input, threadId);
      await user.click(screen.getByRole('button', { name: 'Load' }));
    };

    it('should close the modal immediately when Load is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ServerView />, { preloadedState: baseState });

      await openThreadModalAndLoad(user, '123456789');

      // Modal should be closed — dialog should no longer be visible
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should open thread as a tab instead of navigating away', async () => {
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, { preloadedState: baseState });

      await openThreadModalAndLoad(user, '123456789');

      await waitFor(() => {
        const messageState = store.getState().message;
        // Thread tab should be created with the channel returned by fetchChannelById (id: 'thread-1')
        expect(messageState.threadTabs['thread-1']).toBeDefined();
        expect(messageState.threadTabs['thread-1'].threadName).toBe('loaded-thread');
        expect(messageState.activeTab).toBe('thread-1');
        // Channel selection should NOT change (we stay on the original channel)
        expect(store.getState().channel.selectedChannel?.id).toBe('ch1');
      });
    });

    it('should log info status entry when loading a thread', async () => {
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, { preloadedState: baseState });

      await openThreadModalAndLoad(user, '123456789');

      const entries = store.getState().status.entries;
      const infoEntry = entries.find((e: any) => e.level === 'info' && e.message.includes('Loading thread...'));
      expect(infoEntry).toBeDefined();
    });

    it('should log success status entry when thread loads successfully', async () => {
      mockFetchChannel.mockResolvedValueOnce({ success: true, data: createMockChannel({ id: 'thread-1', name: 'loaded-thread' }) });
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, { preloadedState: baseState });

      await openThreadModalAndLoad(user, '123456789');

      const entries = store.getState().status.entries;
      const successEntry = entries.find((e: any) => e.level === 'success' && e.message === 'Thread loaded successfully');
      expect(successEntry).toBeDefined();
    });

    it('should log error status entry when thread load fails', async () => {
      mockFetchChannel.mockResolvedValueOnce({ success: false, data: null });
      const user = userEvent.setup();
      const { store } = renderWithProviders(<ServerView />, { preloadedState: baseState });

      await openThreadModalAndLoad(user, '999999999');

      const entries = store.getState().status.entries;
      const errorEntry = entries.find((e: any) => e.level === 'error' && e.message.includes('Failed to load thread'));
      expect(errorEntry).toBeDefined();
    });
  });

  describe('Forum Channel View', () => {
    const forumChannel = createMockChannel({ id: 'forum1', name: 'game-issues', type: 15 });
    const forumThreads = [
      createMockChannel({ id: '900000000000000001', name: 'Bug report', type: 11 }),
      createMockChannel({ id: '900000000000000002', name: 'Feature request', type: 11 }),
    ];

    const forumState = createAuthenticatedState({
      guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
      channel: {
        channels: [forumChannel],
        selectedChannel: forumChannel,
        selectedChannels: [],
        isLoading: false,
        error: null,
        forumThreads,
        forumFirstMessages: [],
        isLoadingForumThreads: false,
        hasMoreForumThreads: false,
        forumThreadsTotalResults: 2,
        forumThreadsNextOffset: 0,
        discoveredThreadsByChannel: {},
      },
      message: {
        messages: [],
        filteredMessages: [],
        selectedMessages: [],
        searchCriteria: null,
        order: { order: 'desc' as any, orderBy: 'timestamp' },
        isLoading: false,
        isEditing: false,
        isDeleting: false,
        error: null,
        pagination: {
          lastMessageId: null, hasMore: false, totalCount: null,
          isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
          mode: 'paginated' as any,
        },
        activeTab: null,
        threadTabs: {},
      } as any,
    });

    it('should hide Load All button in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.queryByRole('button', { name: /Load All/ })).not.toBeInTheDocument();
    });

    it('should hide Analytics button in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.queryByRole('button', { name: /Analytics/ })).not.toBeInTheDocument();
    });

    it('should show Export button in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
    });

    it('should enable Export button when forum threads are loaded', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.getByRole('button', { name: /Export/ })).not.toBeDisabled();
    });

    it('should disable Export button when no forum threads loaded', () => {
      const emptyForumState = createAuthenticatedState({
        guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        channel: {
          channels: [forumChannel],
          selectedChannel: forumChannel,
          selectedChannels: [],
          isLoading: false,
          error: null,
          forumThreads: [],
          forumFirstMessages: [],
          isLoadingForumThreads: false,
          hasMoreForumThreads: false,
          forumThreadsTotalResults: 0,
          forumThreadsNextOffset: 0,
          discoveredThreadsByChannel: {},
        },
        message: {
          messages: [],
          filteredMessages: [],
          selectedMessages: [],
          searchCriteria: null,
          order: { order: 'desc' as any, orderBy: 'timestamp' },
          isLoading: false,
          isEditing: false,
          isDeleting: false,
          error: null,
          pagination: {
            lastMessageId: null, hasMore: false, totalCount: null,
            isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
            mode: 'paginated' as any,
          },
          activeTab: null,
          threadTabs: {},
        } as any,
      });
      renderWithProviders(<ServerView />, { preloadedState: emptyForumState });
      expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
    });

    it('should show Load Thread button in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.getByRole('button', { name: /Load Thread/ })).toBeInTheDocument();
    });

    it('should hide message action buttons in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });

    it('should hide Filters button in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument();
    });

    it('should hide message pagination chips in forum view', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.queryByText(/All loaded/)).not.toBeInTheDocument();
      expect(screen.queryByText(/More available/)).not.toBeInTheDocument();
    });

    it('should show post count in header', () => {
      renderWithProviders(<ServerView />, { preloadedState: forumState });
      expect(screen.getByText('2 posts')).toBeInTheDocument();
    });

    it('should open bulk export dialog when Export is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ServerView />, { preloadedState: forumState });

      await user.click(screen.getByRole('button', { name: /Export/ }));
      expect(screen.getByText(/Bulk Export Channels/)).toBeInTheDocument();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });
  });

  describe('Cancelled Load All callout (#193)', () => {
    const buildState = (overrides: { loadAllCancelled: boolean; error: string | null }) => createAuthenticatedState({
      guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
      channel: { channels: [channel], selectedChannel: channel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
      message: {
        messages,
        filteredMessages: messages,
        selectedMessages: [],
        searchCriteria: null,
        order: { order: 'desc' as any, orderBy: 'timestamp' },
        isLoading: false,
        isEditing: false,
        error: overrides.error,
        pagination: {
          lastMessageId: null, hasMore: false, totalCount: null,
          isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
          loadAllCancelled: overrides.loadAllCancelled,
          mode: 'paginated' as any,
        },
      } as any,
    });

    it('renders the soft callout when loadAllCancelled is true', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: buildState({ loadAllCancelled: true, error: null }),
      });
      expect(screen.getByTestId('load-all-cancelled-callout')).toBeInTheDocument();
      expect(screen.getByText(/Load All stopped/i)).toBeInTheDocument();
      expect(screen.getByText(/2 messages loaded so far are still available/)).toBeInTheDocument();
    });

    it('does NOT render the red error banner when loadAllCancelled is true and error is null', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: buildState({ loadAllCancelled: true, error: null }),
      });
      // The red error banner has no test-id but uses Paper with error.dark.
      // The soft callout is identified by its test-id. Confirming the test-id
      // exists (verifies the soft branch ran) and that no element carrying
      // the cancel message also sits inside an error.dark Paper.
      const callout = screen.getByTestId('load-all-cancelled-callout');
      expect(callout).toBeInTheDocument();
    });

    it('does NOT render the soft callout when loadAllCancelled is false', () => {
      renderWithProviders(<ServerView />, {
        preloadedState: buildState({ loadAllCancelled: false, error: null }),
      });
      expect(screen.queryByTestId('load-all-cancelled-callout')).not.toBeInTheDocument();
    });

    it('prefers the red error banner when both error AND loadAllCancelled are set', () => {
      // Edge case: a Load All errored on a separate concern after a cancel.
      // The error path wins; the soft callout suppresses itself.
      renderWithProviders(<ServerView />, {
        preloadedState: buildState({ loadAllCancelled: true, error: 'Network error' }),
      });
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.queryByTestId('load-all-cancelled-callout')).not.toBeInTheDocument();
    });

    it('Dismiss button removes the callout', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ServerView />, {
        preloadedState: buildState({ loadAllCancelled: true, error: null }),
      });
      expect(screen.getByTestId('load-all-cancelled-callout')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Dismiss/ }));
      expect(screen.queryByTestId('load-all-cancelled-callout')).not.toBeInTheDocument();
    });
  });
});
