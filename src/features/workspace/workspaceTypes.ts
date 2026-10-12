import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import type { RefineCriteria } from '@features/message/messageFiltering';
import type { MessageOrder } from '@features/message/messageTypes';

/**
 * Records kept in the `Discrub-workspaces` database (2.2.5, backlog #278).
 *
 * A workspace holds any number of conversations, each with its loaded
 * messages (the `rows` store), filters, sort, thread tabs, selection and
 * any unfinished long action. The message objects themselves never enter
 * Redux in full again; see `services/workspaceStore.ts`.
 */

/** Bumped whenever a stored shape changes in a way an older build cannot read. */
export const WORKSPACE_SCHEMA_VERSION = 1;

/**
 * The one workspace every account has. It cannot be deleted, only cleared.
 * Its id is generated like any other and kept in `meta.defaultWid`
 * (ws-default-id, 2026-10-14), so a Default file from another install is
 * a different workspace and not "already here". Builds before that gave
 * every Default the fixed id below; a record under it is adopted at boot.
 */
export const LEGACY_DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_WORKSPACE_NAME = 'Default';
export const DEFAULT_WORKSPACE_COLOR = '#5865f2';

export type ConversationKind = 'channel' | 'dm' | 'thread';

export type ActionKind = 'loadAll' | 'export' | 'purge';

export type BulkKind = 'bulkExport' | 'bulkPurge' | 'bulkEdit';

export type EnrichmentStatus = 'done' | 'running' | 'off';

export interface ConversationPagination {
  mode: 'paginated' | 'all' | 'search';
  lastMessageId: string | null;
  hasMore: boolean;
  totalCount: number | null;
  searchOffset: number;
  /** ISO timestamp of the search cap shift cursor, null on the plain path. */
  searchBeforeDate: string | null;
}

export interface ConversationAction {
  kind: ActionKind;
  /** The dialog's settings as they were when the action started. */
  settings: unknown;
}

export interface ConversationEnrichment {
  reactions: EnrichmentStatus;
  replies: EnrichmentStatus;
  names: EnrichmentStatus;
}

export interface Conversation {
  cid: string;
  kind: ConversationKind;
  guildId: string | null;
  name: string;
  /** A thread's parent channel name, for the "# general › thread" label. */
  parentName?: string | null;
  /** Rows on disk for this conversation. */
  count: number;
  /** Discrub's own byte estimate for the rows on disk (plan section 3.2). */
  bytes: number;
  oldestId: string | null;
  newestId: string | null;
  /** True once a walk reached the end of the conversation. */
  complete: boolean;
  searchCriteria: SearchCriteria | null;
  refineCriteria: RefineCriteria | null;
  order: MessageOrder;
  pagination: ConversationPagination;
  selectedIds: string[];
  scrollAnchorId: string | null;
  threadTabs: string[];
  activeTab: string | null;
  action: ConversationAction | null;
  enrichment: ConversationEnrichment;
}

/** The fields a caller supplies when a conversation record is first written. */
export interface ConversationSeed {
  kind: ConversationKind;
  guildId: string | null;
  name: string;
  /** The server's name as the app saw it, kept in the workspace's `guilds` map. */
  guildName?: string | null;
  parentName?: string | null;
}

/** Current names from a server, channel or DM list, for `refreshConversationNames`. */
export interface NameRefresh {
  guilds?: Record<string, string>;
  channels?: Record<string, string>;
  dms?: Record<string, string>;
}

export interface WorkspaceScope {
  tab: string | null;
  guildId: string | null;
  channelId: string | null;
  dmId: string | null;
}

/** Which list a bulk run was started from: channels of a server, DMs, or whole servers. */
export type BulkMode = 'channels' | 'dms' | 'servers';

export interface WorkspaceBulk {
  kind: BulkKind;
  mode: BulkMode;
  guildId: string | null;
  /** The run's arguments as given (config, criteria, export snapshot); the dialog rebuilds itself from them. */
  settings: unknown;
  /** Channel, DM or server ids in run order. */
  queue: string[];
  done: string[];
  inHand: string | null;
  /** Units the run reports (a forum's posts count one by one in Bulk Export). */
  total: number;
  doneCount: number;
}

export interface WorkspaceAuthor {
  id: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  avatar: string | null;
  bot: boolean;
}

export interface WorkspaceRecord {
  wid: string;
  name: string;
  color: string;
  schema: number;
  appVersion: string;
  createdAt: number;
  lastOpened: number;
  /** Sum of every conversation's byte estimate. */
  bytes: number;
  scope: WorkspaceScope;
  conversations: Record<string, Conversation>;
  bulk: WorkspaceBulk | null;
  authors: Record<string, WorkspaceAuthor>;
  /** Server names by guild id, written with each conversation and refreshed from the server list. */
  guilds: Record<string, string>;
}

export interface WorkspaceMeta {
  lastWid: string | null;
  order: string[];
  /** The undeletable Default. Null only before the first boot. */
  defaultWid: string | null;
}
