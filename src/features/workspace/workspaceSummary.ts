import type { ConversationKind, WorkspaceRecord } from './workspaceTypes';
import { isRunCid, isSearchCid, isWorkspaceOpenable, plainCidOf } from '@services/workspaceStore';

/** One conversation as the Workspaces popover lists it. */
export interface ConversationSummary {
  cid: string;
  kind: ConversationKind;
  name: string;
  /** The server's name, from the workspace's map or the signed in server list; null for a DM or when unknown. */
  guildName: string | null;
  /** A thread's parent channel. */
  parentName: string | null;
  count: number;
  bytes: number;
}

/** The unfinished work a row names: "Export 3 of 12", "Load All 48,200", "Purge". */
export interface WorkSummary {
  kind: 'loadAll' | 'export' | 'purge' | 'edit';
  done?: number;
  total?: number;
  /** Messages on disk, for a Load All. */
  count?: number;
}

/** One workspace as the popover, the pill and the disk bar read it (plan section 5). */
export interface WorkspaceSummary {
  wid: string;
  name: string;
  color: string;
  bytes: number;
  /** Messages on disk across every conversation. */
  count: number;
  conversationCount: number;
  lastOpened: number;
  /** False when a newer schema wrote it; the row is greyed with the version it needs. */
  openable: boolean;
  appVersion: string;
  /** Open in another window. */
  heldElsewhere: boolean;
  /** The undeletable Default. */
  isDefault: boolean;
  work: WorkSummary | null;
  /** Conversations with messages on disk, largest first. */
  conversations: ConversationSummary[];
}

function workOf(record: WorkspaceRecord): WorkSummary | null {
  const bulk = record.bulk;
  if (bulk) {
    const kind = bulk.kind === 'bulkExport' ? 'export' : bulk.kind === 'bulkPurge' ? 'purge' : 'edit';
    return { kind, done: bulk.doneCount ?? bulk.done.length, total: bulk.total ?? bulk.queue.length };
  }
  for (const conversation of Object.values(record.conversations)) {
    if (!conversation.action) continue;
    if (conversation.action.kind === 'loadAll') return { kind: 'loadAll', count: conversation.count };
    return { kind: conversation.action.kind };
  }
  return null;
}

export interface SummaryOptions {
  heldElsewhere?: boolean;
  /** Server names from the signed in list, for records without the map. */
  guilds?: Record<string, string>;
  isDefault?: boolean;
}

export function summarizeWorkspace(record: WorkspaceRecord, options: SummaryOptions = {}): WorkspaceSummary {
  const { heldElsewhere = false, guilds: fallbackGuilds = {}, isDefault = false } = options;
  const guildName = (guildId: string | null) =>
    guildId ? record.guilds?.[guildId] ?? fallbackGuilds[guildId] ?? null : null;
  // Run conversations (an export's walk, 2.2.5 WP6c) are not the user's to see or clear.
  // A search set (fix C) is part of its conversation's row: one row per
  // conversation, its plain and search messages together.
  const byCid = new Map<string, ConversationSummary>();
  for (const c of Object.values(record.conversations)) {
    if (c.count === 0 || isRunCid(c.cid)) continue;
    const cid = plainCidOf(c.cid);
    const row = byCid.get(cid);
    if (row) {
      row.count += c.count;
      row.bytes += c.bytes;
      if (!isSearchCid(c.cid)) {
        row.name = c.name;
        row.parentName = c.kind === 'thread' ? c.parentName ?? null : null;
      }
      continue;
    }
    byCid.set(cid, {
      cid,
      kind: c.kind,
      name: c.name,
      guildName: c.kind === 'dm' ? null : guildName(c.guildId),
      parentName: c.kind === 'thread' ? c.parentName ?? null : null,
      count: c.count,
      bytes: c.bytes,
    });
  }
  const conversations = [...byCid.values()].sort((a, b) => b.bytes - a.bytes || b.count - a.count);
  return {
    wid: record.wid,
    name: record.name,
    color: record.color,
    bytes: record.bytes,
    count: conversations.reduce((sum, c) => sum + c.count, 0),
    conversationCount: conversations.length,
    lastOpened: record.lastOpened,
    openable: isWorkspaceOpenable(record),
    appVersion: record.appVersion,
    heldElsewhere,
    isDefault,
    work: workOf(record),
    conversations,
  };
}

/** Colours handed to new workspaces in turn, Default keeps blurple. */
export const WORKSPACE_COLORS = ['#3ba55c', '#faa61a', '#eb459e', '#00b0f4', '#ed4245', '#9b59b6', '#1abc9c', '#e67e22'];

/** The first colour no workspace uses yet, or the next in turn once all are taken. */
export function nextWorkspaceColor(used: string[]): string {
  const free = WORKSPACE_COLORS.find((c) => !used.includes(c));
  return free ?? WORKSPACE_COLORS[used.length % WORKSPACE_COLORS.length];
}

/** "Workspace 2", "Workspace 3", the first number not taken. */
export function nextWorkspaceName(base: string, names: string[]): string {
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!names.includes(candidate)) return candidate;
  }
}

/** "Raid archive copy", then "Raid archive copy 2" and on. */
export function copyName(name: string, suffix: string, names: string[]): string {
  const first = `${name} ${suffix}`;
  if (!names.includes(first)) return first;
  return nextWorkspaceName(first, names);
}
