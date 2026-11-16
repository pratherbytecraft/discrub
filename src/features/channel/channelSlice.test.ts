import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';
import channelReducer, {
  setSelectedChannel,
  clearChannels,
  toggleChannelSelection,
  selectAllChannels,
  deselectAllChannels,
  fetchChannels,
  fetchChannelById,
  fetchChannelThreads,
  loadMoreChannelThreads,
  fetchForumThreads,
  loadMoreForumThreads,
  searchForumThreads,
  selectChannel,
  selectChannels,
  selectSelectedChannel,
  selectChannelLoading,
  selectChannelError,
  selectSelectedChannels,
} from './channelSlice';
import statusReducer from '@features/status/statusSlice';
import appReducer from '@features/app/appSlice';
import { initialAppState } from '@features/app/appTypes';
import { initialChannelState } from './channelTypes';
import * as discordService from '@services/discordService';
import type { Channel } from 'discrub-core/types/discord-types';

// Mock the Discord service
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));

describe('channelSlice', () => {
  let store: TestStore;

  const mockChannels: Channel[] = [
    {
      id: 'channel-1',
      name: 'general',
      type: 0,
      position: 0,
    } as Channel,
    {
      id: 'channel-2',
      name: 'announcements',
      type: 0,
      position: 1,
    } as Channel,
    {
      id: 'channel-3',
      name: 'voice-channel',
      type: 2,
      position: 2,
    } as Channel,
  ];

  beforeEach(() => {
    store = createTestStore({ channel: channelReducer });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = store.getState();
      expect(state.channel).toEqual(initialChannelState);
      expect(state.channel.channels).toEqual([]);
      expect(state.channel.selectedChannel).toBeNull();
      expect(state.channel.isLoading).toBe(false);
      expect(state.channel.error).toBeNull();
    });
  });

  describe('reducers', () => {
    describe('setSelectedChannel', () => {
      it('should set selected channel', () => {
        store.dispatch(setSelectedChannel(mockChannels[0]));

        const state = store.getState().channel;
        expect(state.selectedChannel).toEqual(mockChannels[0]);
      });

      it('should update selected channel when called multiple times', () => {
        store.dispatch(setSelectedChannel(mockChannels[0]));
        expect(store.getState().channel.selectedChannel?.id).toBe('channel-1');

        store.dispatch(setSelectedChannel(mockChannels[1]));
        expect(store.getState().channel.selectedChannel?.id).toBe('channel-2');
      });

      it('should handle null channel', () => {
        // First set a channel
        store.dispatch(setSelectedChannel(mockChannels[0]));
        expect(store.getState().channel.selectedChannel).toEqual(mockChannels[0]);

        // Then set to null
        store.dispatch(setSelectedChannel(null));
        expect(store.getState().channel.selectedChannel).toBeNull();
      });

      it('should not affect channels array', () => {
        // Set up initial state with channels
        store = createTestStore({ channel: channelReducer }, { channel: {
              ...initialChannelState,
              channels: mockChannels,
            } });

        store.dispatch(setSelectedChannel(mockChannels[0]));

        const state = store.getState().channel;
        expect(state.channels).toEqual(mockChannels);
      });

      it('should handle different channel types', () => {
        // Text channel
        store.dispatch(setSelectedChannel(mockChannels[0]));
        expect(store.getState().channel.selectedChannel?.type).toBe(0);

        // Voice channel
        store.dispatch(setSelectedChannel(mockChannels[2]));
        expect(store.getState().channel.selectedChannel?.type).toBe(2);
      });
    });

    describe('clearChannels', () => {
      it('should clear channels and selected channel', () => {
        // Set up initial state
        store = createTestStore({ channel: channelReducer }, { channel: {
              ...initialChannelState,
              channels: mockChannels,
              selectedChannel: mockChannels[0],
            } });

        store.dispatch(clearChannels());

        const state = store.getState().channel;
        expect(state.channels).toEqual([]);
        expect(state.selectedChannel).toBeNull();
      });

      it('should not affect loading or error state', () => {
        // Set up initial state with error
        store = createTestStore({ channel: channelReducer }, { channel: {
              ...initialChannelState,
              channels: mockChannels,
              error: 'Some error',
              isLoading: true,
            } });

        store.dispatch(clearChannels());

        const state = store.getState().channel;
        expect(state.error).toBe('Some error');
        expect(state.isLoading).toBe(true);
      });

      it('should be idempotent', () => {
        store.dispatch(clearChannels());
        const state1 = store.getState().channel;

        store.dispatch(clearChannels());
        const state2 = store.getState().channel;

        expect(state1.channels).toEqual(state2.channels);
        expect(state1.selectedChannel).toEqual(state2.selectedChannel);
      });
    });
  });

  describe('fetchChannels async thunk', () => {
    it('should set loading state when pending', () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'test-token' }));

      const state = store.getState().channel;
      expect(state.isLoading).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should handle successful fetch', async () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: true,
          data: mockChannels,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const params = { guildId: 'guild-1', token: 'valid-token' };
      await store.dispatch(fetchChannels(params));

      const state = store.getState().channel;
      expect(state.isLoading).toBe(false);
      expect(state.channels).toEqual(mockChannels);
      expect(state.error).toBeNull();

      expect(mockDiscordService.fetchChannels).toHaveBeenCalledWith(
        params.token,
        params.guildId
      );
    });

    it('should handle fetch failure with unsuccessful response', async () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: false,
          data: null,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'invalid-token' }));

      const state = store.getState().channel;
      expect(state.isLoading).toBe(false);
      expect(state.channels).toEqual([]);
      expect(state.error).toBe('Failed to fetch channels');
    });

    it('should handle fetch failure with null data', async () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: true,
          data: null,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'test-token' }));

      const state = store.getState().channel;
      expect(state.error).toBe('Failed to fetch channels');
    });

    it('should handle fetch failure with Error', async () => {
      const errorMessage = 'Network error';
      const mockDiscordService = {
        fetchChannels: vi.fn().mockRejectedValue(new Error(errorMessage)),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'test-token' }));

      const state = store.getState().channel;
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(errorMessage);
    });

    it('should handle fetch failure with non-Error', async () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockRejectedValue('String error'),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'test-token' }));

      const state = store.getState().channel;
      expect(state.error).toBe('Failed to fetch channels');
    });

    it('should clear previous error on successful fetch', async () => {
      // Set initial error
      store = createTestStore({ channel: channelReducer }, { channel: {
            ...initialChannelState,
            error: 'Previous error',
          } });

      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: true,
          data: mockChannels,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'valid-token' }));

      const state = store.getState().channel;
      expect(state.error).toBeNull();
      expect(state.channels).toEqual(mockChannels);
    });

    it('should replace previous channels on new fetch', async () => {
      // Set initial channels
      store = createTestStore({ channel: channelReducer }, { channel: {
            ...initialChannelState,
            channels: [mockChannels[0]],
          } });

      const newChannels = [mockChannels[1], mockChannels[2]];
      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: true,
          data: newChannels,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'token' }));

      const state = store.getState().channel;
      expect(state.channels).toEqual(newChannels);
      expect(state.channels).not.toContain(mockChannels[0]);
    });

    it('should fetch channels for specific guild', async () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: true,
          data: mockChannels,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-123', token: 'token' }));

      expect(mockDiscordService.fetchChannels).toHaveBeenCalledWith('token', 'guild-123');
    });

    it('should handle empty channels array', async () => {
      const mockDiscordService = {
        fetchChannels: vi.fn().mockResolvedValue({
          success: true,
          data: [],
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'token' }));

      const state = store.getState().channel;
      expect(state.channels).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      // Set up a known state
      store = createTestStore({ channel: channelReducer }, { channel: {
            channels: mockChannels,
            selectedChannel: mockChannels[0],
            selectedChannels: [],
            isLoading: false,
            error: 'Test error',
          } });
    });

    it('selectChannel should return entire channel state', () => {
      const channel = selectChannel(store.getState());
      expect(channel).toHaveProperty('channels');
      expect(channel).toHaveProperty('selectedChannel');
      expect(channel).toHaveProperty('isLoading');
      expect(channel).toHaveProperty('error');
    });

    it('selectChannels should return channels array', () => {
      const channels = selectChannels(store.getState());
      expect(channels).toEqual(mockChannels);
    });

    it('selectSelectedChannel should return selected channel', () => {
      const selectedChannel = selectSelectedChannel(store.getState());
      expect(selectedChannel).toEqual(mockChannels[0]);

      store.dispatch(setSelectedChannel(null));
      expect(selectSelectedChannel(store.getState())).toBeNull();
    });

    it('selectChannelLoading should return loading status', () => {
      expect(selectChannelLoading(store.getState())).toBe(false);

      // Trigger loading state
      const mockDiscordService = {
        fetchChannels: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(fetchChannels({ guildId: 'guild-1', token: 'test' }));
      expect(selectChannelLoading(store.getState())).toBe(true);
    });

    it('selectChannelError should return error', () => {
      const error = selectChannelError(store.getState());
      expect(error).toBe('Test error');

      store.dispatch(clearChannels());
      // Error is preserved after clearChannels
      expect(selectChannelError(store.getState())).toBe('Test error');
    });

    it('selectSelectedChannels should return selected channels array', () => {
      expect(selectSelectedChannels(store.getState())).toEqual([]);
    });
  });

  describe('multi-select reducers', () => {
    beforeEach(() => {
      store = createTestStore({ channel: channelReducer }, {
        channel: {
          ...initialChannelState,
          channels: mockChannels,
        },
      });
    });

    describe('toggleChannelSelection', () => {
      it('should add channel to selection', () => {
        store.dispatch(toggleChannelSelection(mockChannels[0]));
        expect(selectSelectedChannels(store.getState())).toEqual([mockChannels[0]]);
      });

      it('should remove channel from selection on second toggle', () => {
        store.dispatch(toggleChannelSelection(mockChannels[0]));
        store.dispatch(toggleChannelSelection(mockChannels[0]));
        expect(selectSelectedChannels(store.getState())).toEqual([]);
      });

      it('should support selecting multiple channels', () => {
        store.dispatch(toggleChannelSelection(mockChannels[0]));
        store.dispatch(toggleChannelSelection(mockChannels[1]));
        expect(selectSelectedChannels(store.getState())).toHaveLength(2);
      });
    });

    describe('selectAllChannels', () => {
      it('should select all channels', () => {
        store.dispatch(selectAllChannels(mockChannels));
        expect(selectSelectedChannels(store.getState())).toEqual(mockChannels);
      });
    });

    describe('deselectAllChannels', () => {
      it('should deselect all channels', () => {
        store.dispatch(selectAllChannels(mockChannels));
        store.dispatch(deselectAllChannels());
        expect(selectSelectedChannels(store.getState())).toEqual([]);
      });
    });

    it('clearChannels should also clear selectedChannels', () => {
      store.dispatch(toggleChannelSelection(mockChannels[0]));
      store.dispatch(clearChannels());
      expect(selectSelectedChannels(store.getState())).toEqual([]);
    });
  });

  describe('cross-server selection persistence (#125)', () => {
    it('clears selectedChannels when the selected guild changes', async () => {
      const { setSelectedGuild } = await import('@features/guild/guildSlice');
      const guildReducer = (await import('@features/guild/guildSlice')).default;

      store = createTestStore(
        { channel: channelReducer, guild: guildReducer },
        {
          channel: {
            ...initialChannelState,
            channels: mockChannels,
            selectedChannels: [mockChannels[0], mockChannels[1]],
          },
        },
      );

      // Sanity: selections start populated (as if the user had entered
      // multi-select mode and picked channels in the previous server)
      expect(selectSelectedChannels(store.getState())).toHaveLength(2);

      // Switching servers must wipe prior multi-select state — otherwise
      // the user's old targets ride into destructive bulk ops on the new
      // server.
      store.dispatch(setSelectedGuild({ id: 'guild-2', name: 'Other Server' } as any));
      expect(selectSelectedChannels(store.getState())).toEqual([]);
    });

    it('clears selection even when guild is set to null (e.g., back-to-server-list)', async () => {
      const { setSelectedGuild } = await import('@features/guild/guildSlice');
      const guildReducer = (await import('@features/guild/guildSlice')).default;

      store = createTestStore(
        { channel: channelReducer, guild: guildReducer },
        {
          channel: {
            ...initialChannelState,
            selectedChannels: [mockChannels[0]],
          },
        },
      );

      store.dispatch(setSelectedGuild(null));
      expect(selectSelectedChannels(store.getState())).toEqual([]);
    });
  });

  describe('fetchChannelById async thunk', () => {
    it('should fetch channel by ID successfully', async () => {
      const threadChannel: Channel = {
        id: 'thread-1',
        name: 'my-thread',
        type: 11,
      } as Channel;

      const mockDiscordService = {
        fetchChannel: vi.fn().mockResolvedValue({
          success: true,
          data: threadChannel,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(fetchChannelById({ channelId: 'thread-1', token: 'test-token' }));

      expect(result.type).toBe('channel/fetchChannelById/fulfilled');
      expect(result.payload).toEqual(threadChannel);
      expect(mockDiscordService.fetchChannel).toHaveBeenCalledWith('test-token', 'thread-1');
    });

    it('should reject when thread not found (unsuccessful response)', async () => {
      const mockDiscordService = {
        fetchChannel: vi.fn().mockResolvedValue({
          success: false,
          data: null,
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(fetchChannelById({ channelId: 'nonexistent', token: 'test-token' }));

      expect(result.type).toBe('channel/fetchChannelById/rejected');
      expect(result.payload).toBe('Thread not found');
    });

    it('should reject with access error when 403 forbidden', async () => {
      const mockDiscordService = {
        fetchChannel: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(fetchChannelById({ channelId: 'private-thread', token: 'test-token' }));

      expect(result.type).toBe('channel/fetchChannelById/rejected');
      expect(result.payload).toBe('No access to this thread');
    });

    it('should handle generic errors', async () => {
      const mockDiscordService = {
        fetchChannel: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(fetchChannelById({ channelId: 'thread-1', token: 'test-token' }));

      expect(result.type).toBe('channel/fetchChannelById/rejected');
      expect(result.payload).toBe('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      const mockDiscordService = {
        fetchChannel: vi.fn().mockRejectedValue('Unknown failure'),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const result = await store.dispatch(fetchChannelById({ channelId: 'thread-1', token: 'test-token' }));

      expect(result.type).toBe('channel/fetchChannelById/rejected');
      expect(result.payload).toBe('Failed to fetch thread');
    });
  });

  // Backlog #150: discover all threads (active + archived public + archived
  // private/joined) for a channel so users can find threads whose type-21
  // starter has been deleted (otherwise invisible in the message feed).
  // GitHub 24: the list is read from Discord's thread search, the one call
  // that shows a user account active and archived threads alike.
  describe('fetchChannelThreads', () => {
    const textChannel = { id: 'parent', name: 'general', type: 0 } as Channel;
    const voiceChannel = { id: 'voice', name: 'voice-chat', type: 2 } as Channel;
    const stageChannel = { id: 'stage', name: 'live', type: 13 } as Channel;
    const thread = (id: string, archived = false): Channel =>
      ({ id, name: `t-${id}`, type: 11, parent_id: 'parent', thread_metadata: { archived } } as unknown as Channel);
    const page = (threads: Channel[], total: number, has_more: boolean) => ({ success: true, data: { threads, total_results: total, has_more } });
    const useSearch = (...pages: unknown[]) => {
      const fetchForumThreadSearch = vi.fn();
      pages.forEach((p) => fetchForumThreadSearch.mockResolvedValueOnce(p));
      vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);
      return fetchForumThreadSearch;
    };
    const get = () => store.dispatch(fetchChannelThreads({ channel: textChannel, guildId: 'g1', token: 't' }));

    it('makes one thread search call with no archived filter, and keeps active and archived threads', async () => {
      const search = useSearch(page([thread('100'), thread('300', true)], 2, false));
      const result = await get();
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('t', 'parent', { sort_by: 'last_message_time', sort_order: 'desc', limit: 25, offset: 0 });
      expect(search.mock.calls[0][2]).not.toHaveProperty('archived');
      expect(result.payload).toEqual({ threads: [thread('100'), thread('300', true)], total: 2, hasMore: false, nextOffset: 25 });
      expect(store.getState().channel.discoveredThreadsByChannel.parent.map((c) => c.id)).toEqual(['100', '300']);
      expect(store.getState().channel.discoveredThreadMeta?.parent).toEqual({ total: 2, hasMore: false, nextOffset: 25 });
    });

    it('never calls the bot only active list or the archived lists', async () => {
      const others = { fetchActiveGuildThreads: vi.fn(), fetchPublicThreads: vi.fn(), fetchPrivateThreads: vi.fn(), fetchJoinedPrivateArchivedThreads: vi.fn() };
      vi.mocked(discordService.getDiscordService).mockReturnValue({
        ...others,
        fetchForumThreadSearch: vi.fn().mockResolvedValue(page([thread('1')], 1, false)),
      } as any);
      await get();
      Object.values(others).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it('keeps the total Discord reports when only the first page is read', async () => {
      useSearch(page([thread('1'), thread('2')], 140, true));
      await get();
      expect(store.getState().channel.discoveredThreadMeta?.parent).toEqual({ total: 140, hasMore: true, nextOffset: 25 });
    });

    it('returns nothing and makes no call for voice and stage channels', async () => {
      const search = useSearch();
      const voice = await store.dispatch(fetchChannelThreads({ channel: voiceChannel, guildId: 'g1', token: 't' }));
      const stage = await store.dispatch(fetchChannelThreads({ channel: stageChannel, guildId: 'g1', token: 't' }));
      expect((voice.payload as { threads: Channel[] }).threads).toEqual([]);
      expect((stage.payload as { threads: Channel[] }).threads).toEqual([]);
      expect(search).not.toHaveBeenCalled();
    });

    it('rejects when Discord refuses the listing, and leaves an earlier list alone', async () => {
      useSearch(page([thread('1')], 1, false), { success: false, status: 403 });
      await get();
      const result = await store.dispatch(fetchChannelThreads({ channel: textChannel, guildId: 'g1', token: 't', force: true }));
      expect(result.type).toBe('channel/fetchChannelThreads/rejected');
      expect((result as { error: { message: string } }).error.message).toContain('403');
      expect(store.getState().channel.discoveredThreadsByChannel.parent.map((c) => c.id)).toEqual(['1']);
    });

    describe('in-session cache (Backlog #165)', () => {
      it('opening again makes no call, and gives back the list with its total', async () => {
        const search = useSearch(page([thread('100')], 60, true));
        await get();
        const again = await get();
        expect(search).toHaveBeenCalledOnce();
        expect(again.payload).toEqual({ threads: [thread('100')], total: 60, hasMore: true, nextOffset: 25 });
      });

      it('force reads the list again from the first page', async () => {
        const search = useSearch(page([thread('100')], 1, false), page([thread('100'), thread('200')], 2, false));
        await get();
        await store.dispatch(fetchChannelThreads({ channel: textChannel, guildId: 'g1', token: 't', force: true }));
        expect(search).toHaveBeenCalledTimes(2);
        expect(search.mock.calls[1][2]).toMatchObject({ offset: 0 });
        expect(store.getState().channel.discoveredThreadsByChannel.parent.map((c) => c.id)).toEqual(['100', '200']);
      });

      it('is kept per channel', async () => {
        const search = useSearch(page([thread('100')], 1, false), page([], 0, false));
        await get();
        await store.dispatch(fetchChannelThreads({ channel: { id: 'other', name: 'random', type: 0 } as Channel, guildId: 'g1', token: 't' }));
        expect(search).toHaveBeenCalledTimes(2);
      });
    });

    describe('loadMoreChannelThreads', () => {
      const more = () => store.dispatch(loadMoreChannelThreads({ channel: textChannel, token: 't' }));
      const storeWithDelay = (searchDelay: string) => createTestStore(
        { channel: channelReducer, app: appReducer },
        { app: { ...initialAppState, settings: { searchDelay2: searchDelay, delayModifier2: '0' } } } as any,
      );

      beforeEach(() => {
        store = storeWithDelay('0');
      });

      it('waits out the Search Delay since the last page before it asks for the next', async () => {
        vi.useFakeTimers();
        try {
          store = storeWithDelay('2');
          const search = useSearch(page([thread('1')], 60, true), page([thread('2')], 60, true), page([thread('3')], 60, true));
          await get();
          const next = more();
          await vi.advanceTimersByTimeAsync(1900);
          expect(search).toHaveBeenCalledOnce();
          await vi.advanceTimersByTimeAsync(200);
          await next;
          expect(search).toHaveBeenCalledTimes(2);
          // The page after that waits again.
          const third = more();
          await vi.advanceTimersByTimeAsync(1500);
          expect(search).toHaveBeenCalledTimes(2);
          await vi.advanceTimersByTimeAsync(600);
          await third;
          expect(search).toHaveBeenCalledTimes(3);
        } finally {
          vi.useRealTimers();
        }
      });

      it('reads the next page from where the list ends and adds it', async () => {
        const search = useSearch(page([thread('1')], 51, true), page([thread('2')], 51, true), page([thread('3')], 51, false));
        await get();
        await more();
        expect(search.mock.calls[1][2]).toMatchObject({ limit: 25, offset: 25 });
        await more();
        expect(search.mock.calls[2][2]).toMatchObject({ offset: 50 });
        expect(store.getState().channel.discoveredThreadsByChannel.parent.map((c) => c.id)).toEqual(['1', '2', '3']);
        expect(store.getState().channel.discoveredThreadMeta?.parent).toEqual({ total: 51, hasMore: false, nextOffset: 75 });
      });

      it('makes no call when the list has ended', async () => {
        const search = useSearch(page([thread('1')], 1, false));
        await get();
        await more();
        expect(search).toHaveBeenCalledOnce();
      });

      it('lets one page through at a time', async () => {
        let release: (value: unknown) => void = () => undefined;
        const fetchForumThreadSearch = vi.fn()
          .mockResolvedValueOnce(page([thread('1')], 60, true))
          .mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);
        await get();
        const first = more();
        const second = more();
        release(page([thread('2')], 60, true));
        await Promise.all([first, second]);
        expect(fetchForumThreadSearch).toHaveBeenCalledTimes(2);
      });

      it('does not add a thread the list already has', async () => {
        useSearch(page([thread('1'), thread('2')], 3, true), page([thread('2'), thread('3')], 3, false));
        await get();
        await more();
        expect(store.getState().channel.discoveredThreadsByChannel.parent.map((c) => c.id)).toEqual(['1', '2', '3']);
      });

      it('an empty page ends the list even when Discord says there is more', async () => {
        useSearch(page([thread('1')], 60, true), page([], 60, true));
        await get();
        await more();
        expect(store.getState().channel.discoveredThreadMeta?.parent.hasMore).toBe(false);
      });

      it('a page that fails ends the scroll loading and keeps the list', async () => {
        const search = useSearch(page([thread('1')], 60, true), { success: false, status: 500 });
        await get();
        await more();
        await more();
        expect(search).toHaveBeenCalledTimes(2);
        expect(store.getState().channel.discoveredThreadsByChannel.parent.map((c) => c.id)).toEqual(['1']);
        expect(store.getState().channel.loadingMoreThreadsFor?.parent).toBe(false);
      });
    });
  });

  describe('forum thread thunks (Backlog #151)', () => {
    let forumStore: TestStore;

    const activeThread = { id: 'thread-active-1', name: 'Test post', thread_metadata: { archived: false } } as any;
    const archivedThread = { id: 'thread-archived-1', name: 'OLDER POST', thread_metadata: { archived: true } } as any;
    const firstMsgs = [{ id: 'm1', channel_id: 'thread-active-1' }, { id: 'm2', channel_id: 'thread-archived-1' }] as any;

    beforeEach(() => {
      forumStore = createTestStore({ channel: channelReducer, status: statusReducer });
    });

    describe('fetchForumThreads', () => {
      it('does NOT pass `archived` to Discord (#151 regression guard)', async () => {
        const fetchForumThreadSearch = vi.fn().mockResolvedValue({
          success: true,
          data: { threads: [activeThread, archivedThread], has_more: false, total_results: 2, first_messages: firstMsgs },
        });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        await forumStore.dispatch(fetchForumThreads({ channelId: 'forum-1', token: 'tok' }));

        const opts = fetchForumThreadSearch.mock.calls[0][2];
        expect(opts).not.toHaveProperty('archived');
        expect(opts).toMatchObject({ sort_by: 'last_message_time', sort_order: 'desc', limit: 25, offset: 0 });
      });

      it('stores both active and archived threads from the union response', async () => {
        const fetchForumThreadSearch = vi.fn().mockResolvedValue({
          success: true,
          data: { threads: [activeThread, archivedThread], has_more: true, total_results: 6, first_messages: firstMsgs },
        });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        await forumStore.dispatch(fetchForumThreads({ channelId: 'forum-1', token: 'tok' }));

        const state = forumStore.getState().channel;
        expect(state.forumThreads.map((t: any) => t.id)).toEqual(['thread-active-1', 'thread-archived-1']);
        expect(state.forumThreadsTotalResults).toBe(6);
        expect(state.hasMoreForumThreads).toBe(true);
        expect(state.forumThreadsNextOffset).toBe(25);
        expect(state.forumFirstMessages).toEqual(firstMsgs);
      });

      it('falls through to empty arrays when the response is unsuccessful', async () => {
        const fetchForumThreadSearch = vi.fn().mockResolvedValue({ success: false, data: null });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        await forumStore.dispatch(fetchForumThreads({ channelId: 'forum-1', token: 'tok' }));

        const state = forumStore.getState().channel;
        expect(state.forumThreads).toEqual([]);
        expect(state.forumThreadsTotalResults).toBe(0);
      });

      it('rejects on a thrown error', async () => {
        const fetchForumThreadSearch = vi.fn().mockRejectedValue(new Error('boom'));
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        const result = await forumStore.dispatch(fetchForumThreads({ channelId: 'forum-1', token: 'tok' }));
        expect(result.type).toBe('channel/fetchForumThreads/rejected');
        expect(result.payload).toBe('boom');
      });
    });

    describe('loadMoreForumThreads', () => {
      it('does NOT pass `archived` to Discord (#151 regression guard)', async () => {
        const fetchForumThreadSearch = vi.fn().mockResolvedValue({
          success: true,
          data: { threads: [archivedThread], has_more: false, total_results: 6, first_messages: [firstMsgs[1]] },
        });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        await forumStore.dispatch(loadMoreForumThreads({ channelId: 'forum-1', token: 'tok', offset: 25 }));

        const opts = fetchForumThreadSearch.mock.calls[0][2];
        expect(opts).not.toHaveProperty('archived');
        expect(opts).toMatchObject({ offset: 25, limit: 25 });
      });

      it('appends new threads + first messages and advances offset', async () => {
        // Seed page 1 already in state.
        forumStore = createTestStore(
          { channel: channelReducer, status: statusReducer },
          { channel: { ...initialChannelState, forumThreads: [activeThread], forumFirstMessages: [firstMsgs[0]], forumThreadsNextOffset: 25 } },
        );
        const fetchForumThreadSearch = vi.fn().mockResolvedValue({
          success: true,
          data: { threads: [archivedThread], has_more: false, total_results: 2, first_messages: [firstMsgs[1]] },
        });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        await forumStore.dispatch(loadMoreForumThreads({ channelId: 'forum-1', token: 'tok', offset: 25 }));

        const state = forumStore.getState().channel;
        expect(state.forumThreads.map((t: any) => t.id)).toEqual(['thread-active-1', 'thread-archived-1']);
        expect(state.forumFirstMessages).toEqual(firstMsgs);
        expect(state.forumThreadsNextOffset).toBe(50);
      });
    });

    describe('searchForumThreads', () => {
      it('does NOT pass `archived` so search hits both buckets', async () => {
        const fetchForumThreadSearch = vi.fn().mockResolvedValue({
          success: true,
          data: { threads: [activeThread, archivedThread], total_results: 2, first_messages: firstMsgs },
        });
        vi.mocked(discordService.getDiscordService).mockReturnValue({ fetchForumThreadSearch } as any);

        await forumStore.dispatch(searchForumThreads({ channelId: 'forum-1', token: 'tok', name: 'test' }));

        const opts = fetchForumThreadSearch.mock.calls[0][2];
        expect(opts).not.toHaveProperty('archived');
        expect(opts).toMatchObject({ name: 'test' });
      });
    });
  });
});
