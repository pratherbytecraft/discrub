import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { Channel } from 'discrub-core/types/discord-types';
import { ChannelType } from 'discrub-core/discord-enum';
import { initialChannelState } from './channelTypes';
import { getDiscordService } from '@services/discordService';
import type { RootState } from '@/app/store';
import { addStatusEntry } from '@features/status/statusSlice';
import { setSelectedGuild } from '@features/guild/guildSlice';
import { t } from '@/i18n';
import { selectDelayModifier, selectSearchDelay } from '@features/app/appSlice';
import { calculateRandomDelay } from '@/utils/delayUtils';

/**
 * Channel slice - manages channel state
 */

/**
 * Fetch all channels for a guild
 */
export const fetchChannels = createAsyncThunk(
  'channel/fetchChannels',
  async (
    { guildId, token }: { guildId: string; token: string },
    { rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.fetchChannels(token, guildId);

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch channels');
      }

      // Return channels directly (sorting can be added later if needed)
      return response.data as Channel[];
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch channels'
      );
    }
  }
);

/**
 * Fetch a single channel by ID (for thread/forum loading)
 */
export const fetchChannelById = createAsyncThunk(
  'channel/fetchChannelById',
  async (
    { channelId, token }: { channelId: string; token: string },
    { rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.fetchChannel(token, channelId);

      if (!response.success || !response.data) {
        return rejectWithValue('Thread not found');
      }

      return response.data as Channel;
    } catch (error) {
      if (error instanceof Error && error.message.includes('403')) {
        return rejectWithValue('No access to this thread');
      }
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch thread'
      );
    }
  }
);

/**
 * The threads of one text or announcement channel, for the Load Thread
 * dialog and the thread export.
 *
 * Read from `GET /channels/{id}/threads/search` with no `archived`
 * parameter, the call the forum listing uses. For a user account it
 * returns active and archived threads, public and private, 25 a page with
 * a total (checked live 2026-11-16). The calls used before could not see
 * an active thread at all: the guild's active list answers 403 for a
 * user, and the archived lists were read one page only.
 *
 * This reads the first page. `loadMoreChannelThreads` reads the next one.
 * A thread made in the last minute may not be in the search yet; the
 * dialog's refresh reads the list again.
 *
 * Voice and Stage channels have no threads. Forum and media channels have
 * their own listing (`fetchForumThreads`).
 */
export interface ChannelThreadPage {
  threads: Channel[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

const THREAD_PAGE = 25;

/** When the last page of a thread list was asked for, so the next one can keep its distance. */
let lastThreadPageAt = 0;

/**
 * Waits until the Search Delay has passed since the last thread list page.
 * A list scrolled to its end asks for page after page, and without this
 * they went out as fast as Discord answered (2.2.10 VM pass).
 */
const waitForThreadPageTurn = async (state: RootState): Promise<void> => {
  const { delayMs } = calculateRandomDelay(selectSearchDelay(state), selectDelayModifier(state));
  const wait = lastThreadPageAt + delayMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
};

const readThreadPage = async (token: string, channelId: string, offset: number) => {
  lastThreadPageAt = Date.now();
  const response = await getDiscordService().fetchForumThreadSearch(token, channelId, {
    sort_by: 'last_message_time',
    sort_order: 'desc',
    limit: THREAD_PAGE,
    offset,
  });
  if (!response.success || !response.data) {
    throw new Error(`Discord answered ${response.status ?? 'with a network error'}`);
  }
  return response.data;
};

export const fetchChannelThreads = createAsyncThunk(
  'channel/fetchChannelThreads',
  async (
    {
      channel,
      token,
      force = false,
    }: { channel: Channel; guildId: string; token: string; force?: boolean },
    { getState },
  ): Promise<ChannelThreadPage> => {
    if (
      channel.type === ChannelType.GUILD_VOICE ||
      channel.type === ChannelType.GUILD_STAGE_VOICE
    ) {
      return { threads: [], total: 0, hasMore: false, nextOffset: 0 };
    }

    // In-session cache (#165). Opening the dialog passes force=false and
    // makes no call when the list is known; the refresh icon passes true.
    if (!force) {
      const state = (getState() as RootState).channel;
      const cached = state.discoveredThreadsByChannel[channel.id];
      const meta = state.discoveredThreadMeta?.[channel.id];
      if (cached) {
        return {
          threads: cached,
          total: meta?.total ?? cached.length,
          hasMore: meta?.hasMore ?? false,
          nextOffset: meta?.nextOffset ?? cached.length,
        };
      }
    }

    const data = await readThreadPage(token, channel.id, 0);
    const threads = data.threads as Channel[];
    return {
      threads,
      total: Math.max(data.total_results ?? 0, threads.length),
      hasMore: !!data.has_more,
      nextOffset: THREAD_PAGE,
    };
  },
);

/** The next page of a channel's threads, added to the list the dialog shows. */
export const loadMoreChannelThreads = createAsyncThunk(
  'channel/loadMoreChannelThreads',
  async (
    { channel, token }: { channel: Channel; token: string },
    { getState },
  ): Promise<ChannelThreadPage> => {
    const meta = (getState() as RootState).channel.discoveredThreadMeta?.[channel.id];
    const offset = meta?.nextOffset ?? 0;
    await waitForThreadPageTurn(getState() as RootState);
    const data = await readThreadPage(token, channel.id, offset);
    const threads = data.threads as Channel[];
    return {
      threads,
      total: Math.max(data.total_results ?? 0, meta?.total ?? 0),
      // An empty page ends the list whatever Discord says, so a scroll can never loop.
      hasMore: !!data.has_more && threads.length > 0,
      nextOffset: offset + THREAD_PAGE,
    };
  },
  {
    // One page at a time: a second scroll event while a page is on its way does nothing.
    condition: ({ channel }, { getState }) => {
      const state = (getState() as RootState).channel;
      return !state.loadingMoreThreadsFor?.[channel.id] && !!state.discoveredThreadMeta?.[channel.id]?.hasMore;
    },
  },
);

/**
 * Fetch threads/posts for a forum or media channel
 */
/**
 * Fetch threads/posts for a forum or media channel.
 * Uses Discord's threads/search endpoint (same as web client).
 * Single API call returns active + archived threads sorted by recency.
 *
 * NOTE: do NOT pass `archived` here. Discord treats it as a strict
 * filter (`true` → archived only, `false` → active only); omitting it
 * returns the union — which matches the native client's "active +
 * OLDER POSTS" view. (Backlog #151.)
 */
export const fetchForumThreads = createAsyncThunk(
  'channel/fetchForumThreads',
  async (
    { channelId, token }: { channelId: string; token: string },
    { rejectWithValue, dispatch }
  ) => {
    try {
      dispatch(addStatusEntry({ level: 'info', message: t('status.channel.loadingForumPosts') }));
      const discordService = getDiscordService();

      const response = await discordService.fetchForumThreadSearch(token, channelId, {
        sort_by: 'last_message_time',
        sort_order: 'desc',
        limit: 25,
        offset: 0,
      });

      if (!response.success || !response.data) {
        return { threads: [], hasMore: false, totalResults: 0, nextOffset: 0, firstMessages: [] };
      }

      const { threads, has_more, total_results, first_messages } = response.data;

      dispatch(addStatusEntry({
        level: 'success',
        message: t('status.channel.loadedForumPosts', { count: threads.length, total: total_results }),
      }));

      return {
        threads,
        hasMore: has_more,
        totalResults: total_results,
        nextOffset: 25,
        firstMessages: first_messages || [],
      };
    } catch (error) {
      dispatch(addStatusEntry({ level: 'error', message: t('status.channel.forumLoadFailed', { error: error instanceof Error ? error.message : t('status.channel.unknownError') }) }));
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch forum threads'
      );
    }
  }
);

/**
 * Load more forum threads (paginated via offset)
 */
export const loadMoreForumThreads = createAsyncThunk(
  'channel/loadMoreForumThreads',
  async (
    { channelId, token, offset }: { channelId: string; token: string; offset: number },
    { rejectWithValue, dispatch }
  ) => {
    try {
      const discordService = getDiscordService();

      const response = await discordService.fetchForumThreadSearch(token, channelId, {
        sort_by: 'last_message_time',
        sort_order: 'desc',
        limit: 25,
        offset,
        // Omit `archived` — see fetchForumThreads note above (#151).
      });

      if (!response.success || !response.data) {
        return { newThreads: [], hasMore: false, nextOffset: offset, newFirstMessages: [] };
      }

      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.channel.loadedMoreForumPosts', { count: response.data.threads.length }),
      }));

      return {
        newThreads: response.data.threads,
        hasMore: response.data.has_more,
        nextOffset: offset + 25,
        newFirstMessages: response.data.first_messages || [],
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to load more threads'
      );
    }
  }
);

/**
 * Search forum threads by name (server-side, same endpoint Discord uses)
 */
export const searchForumThreads = createAsyncThunk(
  'channel/searchForumThreads',
  async (
    { channelId, token, name }: { channelId: string; token: string; name: string },
    { rejectWithValue, dispatch }
  ) => {
    try {
      const discordService = getDiscordService();

      const response = await discordService.fetchForumThreadSearch(token, channelId, {
        name,
        tag_setting: 'match_some',
      });

      if (!response.success || !response.data) {
        return { threads: [], totalResults: 0, firstMessages: [] };
      }

      dispatch(addStatusEntry({
        level: 'success',
        message: t('status.channel.forumSearchFound', { count: response.data.total_results, name }),
      }));

      return {
        threads: response.data.threads,
        totalResults: response.data.total_results,
        firstMessages: response.data.first_messages || [],
      };
    } catch (error) {
      dispatch(addStatusEntry({ level: 'error', message: t('status.channel.forumSearchFailed', { error: error instanceof Error ? error.message : t('status.channel.unknownError') }) }));
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to search forum threads'
      );
    }
  }
);

const channelSlice = createSlice({
  name: 'channel',
  initialState: initialChannelState,
  reducers: {
    setSelectedChannel: (state, action: PayloadAction<Channel | null>) => {
      state.selectedChannel = action.payload;
    },
    clearChannels: (state) => {
      state.channels = [];
      state.selectedChannel = null;
      state.selectedChannels = [];
    },
    toggleChannelSelection: (state, action: PayloadAction<Channel>) => {
      const index = state.selectedChannels.findIndex(
        (ch: Channel) => ch.id === action.payload.id,
      );
      if (index >= 0) {
        state.selectedChannels.splice(index, 1);
      } else {
        state.selectedChannels.push(action.payload);
      }
    },
    selectAllChannels: (state, action: PayloadAction<Channel[]>) => {
      state.selectedChannels = [...action.payload];
    },
    deselectAllChannels: (state) => {
      state.selectedChannels = [];
    },
    // #218: Shift+Click range select — ADDS the range to the current
    // selection (union, never deselects), matching the familiar
    // file-explorer convention.
    selectChannelsInRange: (state, action: PayloadAction<Channel[]>) => {
      const existing = new Set(state.selectedChannels.map((c: Channel) => c.id));
      for (const channel of action.payload) {
        if (!existing.has(channel.id)) {
          state.selectedChannels.push(channel);
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Multi-select is scoped to the active guild — switching servers
      // must not carry yesterday's destructive-op targets into today.
      .addCase(setSelectedGuild, (state) => {
        state.selectedChannels = [];
      })
      .addCase(fetchChannels.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchChannels.fulfilled, (state, action) => {
        state.isLoading = false;
        state.channels = action.payload;
        state.error = null;
      })
      .addCase(fetchChannels.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // In-session thread-discovery cache (#165). Populates on every
      // fulfilled fetch — including cache hits, where the payload is
      // identical to what's already there (idempotent). The cache is
      // intentionally not cleared on .pending so a stale list keeps
      // rendering while a Refresh re-fetch is in flight.
      .addCase(fetchChannelThreads.fulfilled, (state, action) => {
        const channelId = action.meta.arg.channel.id;
        const { threads, total, hasMore, nextOffset } = action.payload;
        state.discoveredThreadsByChannel[channelId] = threads;
        state.discoveredThreadMeta = { ...state.discoveredThreadMeta, [channelId]: { total, hasMore, nextOffset } };
      })
      .addCase(loadMoreChannelThreads.pending, (state, action) => {
        state.loadingMoreThreadsFor = { ...state.loadingMoreThreadsFor, [action.meta.arg.channel.id]: true };
      })
      .addCase(loadMoreChannelThreads.fulfilled, (state, action) => {
        const channelId = action.meta.arg.channel.id;
        const { threads, total, hasMore, nextOffset } = action.payload;
        const known = state.discoveredThreadsByChannel[channelId] ?? [];
        const ids = new Set(known.map((thread) => thread.id));
        state.discoveredThreadsByChannel[channelId] = [...known, ...threads.filter((thread) => !ids.has(thread.id))];
        state.discoveredThreadMeta = { ...state.discoveredThreadMeta, [channelId]: { total, hasMore, nextOffset } };
        state.loadingMoreThreadsFor = { ...state.loadingMoreThreadsFor, [channelId]: false };
      })
      .addCase(loadMoreChannelThreads.rejected, (state, action) => {
        const channelId = action.meta.arg.channel.id;
        state.loadingMoreThreadsFor = { ...state.loadingMoreThreadsFor, [channelId]: false };
        // A page that failed ends the scroll loading; refresh starts the list again.
        const meta = state.discoveredThreadMeta?.[channelId];
        if (meta) state.discoveredThreadMeta = { ...state.discoveredThreadMeta, [channelId]: { ...meta, hasMore: false } };
      })
      // Forum threads
      .addCase(fetchForumThreads.pending, (state) => {
        state.isLoadingForumThreads = true;
        state.forumThreads = [];
        state.forumFirstMessages = [];
        state.hasMoreForumThreads = false;
        state.forumThreadsTotalResults = 0;
        state.forumThreadsNextOffset = 0;
      })
      .addCase(fetchForumThreads.fulfilled, (state, action) => {
        state.isLoadingForumThreads = false;
        state.forumThreads = action.payload.threads;
        state.forumFirstMessages = action.payload.firstMessages;
        state.hasMoreForumThreads = action.payload.hasMore;
        state.forumThreadsTotalResults = action.payload.totalResults;
        state.forumThreadsNextOffset = action.payload.nextOffset;
      })
      .addCase(fetchForumThreads.rejected, (state) => {
        state.isLoadingForumThreads = false;
        state.forumThreads = [];
        state.forumFirstMessages = [];
      })
      // Load more forum threads
      .addCase(loadMoreForumThreads.pending, (state) => {
        state.isLoadingForumThreads = true;
      })
      .addCase(loadMoreForumThreads.fulfilled, (state, action) => {
        state.isLoadingForumThreads = false;
        state.forumThreads = [...state.forumThreads, ...action.payload.newThreads];
        state.forumFirstMessages = [...state.forumFirstMessages, ...action.payload.newFirstMessages];
        state.hasMoreForumThreads = action.payload.hasMore;
        state.forumThreadsNextOffset = action.payload.nextOffset;
      })
      .addCase(loadMoreForumThreads.rejected, (state) => {
        state.isLoadingForumThreads = false;
      })
      // Search forum threads
      .addCase(searchForumThreads.pending, (state) => {
        state.isLoadingForumThreads = true;
        state.forumThreads = [];
        state.forumFirstMessages = [];
      })
      .addCase(searchForumThreads.fulfilled, (state, action) => {
        state.isLoadingForumThreads = false;
        state.forumThreads = action.payload.threads;
        state.forumFirstMessages = action.payload.firstMessages;
        state.forumThreadsTotalResults = action.payload.totalResults;
        state.hasMoreForumThreads = false; // No scroll-to-load during search
        state.forumThreadsNextOffset = 0;
      })
      .addCase(searchForumThreads.rejected, (state) => {
        state.isLoadingForumThreads = false;
      });
  },
});

export const {
  setSelectedChannel,
  clearChannels,
  toggleChannelSelection,
  selectAllChannels,
  deselectAllChannels,
  selectChannelsInRange,
} = channelSlice.actions;

// Selectors
export const selectChannel = (state: RootState) => state.channel;
export const selectChannels = (state: RootState) => state.channel.channels;
export const selectSelectedChannel = (state: RootState) => state.channel.selectedChannel;
export const selectChannelLoading = (state: RootState) => state.channel.isLoading;
export const selectChannelError = (state: RootState) => state.channel.error;
export const selectSelectedChannels = (state: RootState) => state.channel.selectedChannels;
export const selectForumThreads = (state: RootState) => state.channel.forumThreads ?? [];
/**
 * Per-channel cached discovered threads (#165). Returns undefined for
 * channels that haven't been queried yet — callers distinguish "no
 * cache" (undefined) from "cache says empty list" ([]).
 */
export const selectDiscoveredThreadMeta = (channelId: string | null | undefined) =>
  (state: RootState) =>
    channelId ? state.channel.discoveredThreadMeta?.[channelId] : undefined;
export const selectLoadingMoreThreads = (channelId: string | null | undefined) =>
  (state: RootState) =>
    !!(channelId && state.channel.loadingMoreThreadsFor?.[channelId]);
export const selectDiscoveredThreadsForChannel = (channelId: string | null | undefined) =>
  (state: RootState): Channel[] | undefined =>
    channelId ? state.channel.discoveredThreadsByChannel[channelId] : undefined;
export const selectForumFirstMessages = (state: RootState) => state.channel.forumFirstMessages ?? [];
export const selectIsLoadingForumThreads = (state: RootState) => state.channel.isLoadingForumThreads ?? false;
export const selectHasMoreForumThreads = (state: RootState) => state.channel.hasMoreForumThreads ?? false;
export const selectForumThreadsNextOffset = (state: RootState) => state.channel.forumThreadsNextOffset ?? 0;
export const selectForumThreadsTotalResults = (state: RootState) => state.channel.forumThreadsTotalResults ?? 0;

export default channelSlice.reducer;
