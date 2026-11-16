import type { Channel, Message } from 'discrub-core/types/discord-types';

/**
 * Types for channel feature
 */

export interface ChannelState {
  channels: Channel[];
  selectedChannel: Channel | null;
  selectedChannels: Channel[];
  isLoading: boolean;
  error: string | null;
  /** Threads/posts for the currently selected forum/media channel */
  forumThreads: Channel[];
  /** First message of each forum thread (preview content) */
  forumFirstMessages: Message[];
  isLoadingForumThreads: boolean;
  hasMoreForumThreads: boolean;
  forumThreadsTotalResults: number;
  forumThreadsNextOffset: number;
  /**
   * In-session cache of discovered threads keyed by parent channel ID
   * (#165). Populated by `fetchChannelThreads.fulfilled`. Held in
   * memory only — a page reload wipes it, which is the desired
   * behavior since the user may have purged or archived threads
   * across sessions. Manual refresh in ThreadLoadModal forces a
   * re-fetch.
   */
  discoveredThreadsByChannel: Record<string, Channel[]>;
  /** Per parent channel: how many threads Discord reports, and where the next page starts. */
  discoveredThreadMeta?: Record<string, { total: number; hasMore: boolean; nextOffset: number }>;
  /** Parent channels with a thread page on its way. */
  loadingMoreThreadsFor?: Record<string, boolean>;
}

export const initialChannelState: ChannelState = {
  channels: [],
  selectedChannel: null,
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
  discoveredThreadMeta: {},
  loadingMoreThreadsFor: {},
};
