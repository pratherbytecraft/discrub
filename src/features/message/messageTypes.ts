import type { Message } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { SortDirection } from 'discrub-core/common-enum';
import type { RefineCriteria } from './messageFiltering';

/**
 * Types for message feature
 */

export interface MessageOrder {
  order: SortDirection;
  orderBy: keyof Message;
}

export interface PaginationState {
  lastMessageId: string | null;
  hasMore: boolean;
  totalCount: number | null;
  isLoadingMore: boolean;
  isLoadingAll: boolean;
  loadAllProgress: {
    current: number;
    total: number;
    message: string;
  } | null;
  /**
   * True when the most recent Load All / Fetch All was cancelled by the
   * user (as opposed to errored or completed). Distinct from the legacy
   * `error` path so the UI can render a soft "stopped at N" callout
   * instead of the red error banner. Set by `cancelLoadAll` and the
   * cancel-payload branch of the loadAll/fetchAll rejected handlers;
   * reset on the next `.pending` (a fresh attempt) or by an explicit
   * `dismissLoadAllCancelled` from the UI. See backlog #193.
   */
  loadAllCancelled: boolean;
  mode: 'paginated' | 'all' | 'search';
  /**
   * Offset-based cursor for the next search page fetch. Only meaningful when
   * mode === 'search'. Discord's search endpoint uses `offset` (not
   * last-message-id) for pagination and caps each query at 5000 matches.
   */
  searchOffset: number;
}

export interface ThreadTabState {
  threadId: string;
  threadName: string;
  messages: Message[];
  filteredMessages: Message[];
  selectedMessages: Message[];
  searchCriteria: SearchCriteria | null;
  /** Client-side refine applied on top of the raw message list. Kept here
   *  (not in a component ref) so data-arrival reducers can re-apply it
   *  automatically when new pages stream in. RefineCriteria extends
   *  SearchCriteria with the client-only system-message filter (#201). */
  refineCriteria: RefineCriteria | null;
  order: MessageOrder;
  isLoading: boolean;
  error: string | null;
  pagination: PaginationState;
}

export interface MessageState {
  messages: Message[];
  filteredMessages: Message[];
  selectedMessages: Message[];
  searchCriteria: SearchCriteria | null;
  /** Client-side refine applied on top of the raw message list. See
   *  ThreadTabState.refineCriteria for rationale. */
  refineCriteria: RefineCriteria | null;
  order: MessageOrder;
  isLoading: boolean;
  isDeleting: boolean;
  isEditing: boolean;
  isEnriching: boolean;
  isRemovingReactions: boolean;
  isAddingReactions: boolean;
  error: string | null;
  pagination: PaginationState;
  activeTab: string | null;
  threadTabs: Record<string, ThreadTabState>;
  /**
   * When a user clicks a reply bar or pinned-message notice, the target
   * message ID is stored here so MessageFeed can scroll it into view and
   * flash-highlight its row. Cleared ~2s after the scroll.
   */
  highlightedMessageId: string | null;
  /**
   * Bumps on every clearMessages. UI that mirrors criteria outside Redux
   * (ServerView's per-tab criteria ref for filter chips) keys its cleanup
   * on this, so a re-click of the SAME conversation — which clears the
   * real criteria without changing the selected id — can't leave stale
   * chips behind (#226).
   */
  clearSeq: number;
  /**
   * 2.2.5: set when the open conversation came back from the workspace
   * store instead of a fetch. The Load All dialog turns this into its
   * Resume and Start over state. Cleared by clearMessages.
   */
  restored: { count: number; oldestTimestamp: string | null } | null;
}

export const initialPaginationState: PaginationState = {
  lastMessageId: null,
  hasMore: true,
  totalCount: null,
  isLoadingMore: false,
  isLoadingAll: false,
  loadAllProgress: null,
  loadAllCancelled: false,
  mode: 'paginated',
  searchOffset: 0,
};

export const initialMessageState: MessageState = {
  messages: [],
  filteredMessages: [],
  selectedMessages: [],
  searchCriteria: null,
  refineCriteria: null,
  order: {
    order: SortDirection.DESCENDING,
    orderBy: 'timestamp',
  },
  isLoading: false,
  isDeleting: false,
  isEditing: false,
  isEnriching: false,
  isRemovingReactions: false,
  isAddingReactions: false,
  error: null,
  pagination: initialPaginationState,
  activeTab: null,
  threadTabs: {},
  highlightedMessageId: null,
  clearSeq: 0,
  restored: null,
};
