/**
 * Message rows (2.2.5 WP2b, plan section 4.4).
 *
 * Redux no longer holds the Discord message objects of an open
 * conversation. It holds one small row per message with the fields the
 * feed, the table, the Timeline, selection and every refine except
 * content and attachment name need. The objects live in the workspace
 * store on disk and in the message cache (`messageCache.ts`); the rows
 * on screen are hydrated from there.
 *
 * `timestamp` keeps the message field name so the day key helpers and
 * the Timeline fold take a row or a message alike.
 */

import type { Message, User } from 'discrub-core/types/discord-types';
import { AuthorType, HasType, IsPinnedType } from 'discrub-core/discord-enum';
import { SortDirection } from 'discrub-core/common-enum';
import { messageMatchesAttachmentCriteria } from 'discrub-core/filtering';
import { groupsToTypes } from '@/utils/systemMessageGroups';
import { messageHasType, type RefineCriteria } from './messageFiltering';
import { sameAuthorFields } from '@/utils/messageAuthorOverlay';

export interface MessageRow {
  id: string;
  /** ISO timestamp as Discord sent it. */
  timestamp: string;
  /** `timestamp` in epoch milliseconds, parsed once, for sorting and the Timeline. */
  t: number;
  authorId: string;
  type: number;
  /** A bitmask of `RowFlag`, computed when the row is built. */
  flags: number;
  /** Ids of the users the message mentions, left out when there are none. */
  mentionIds?: string[];
  hasReactions: boolean;
}

export const RowFlag = {
  EMBED: 1 << 0,
  IMAGE: 1 << 1,
  VIDEO: 1 << 2,
  SOUND: 1 << 3,
  FILE: 1 << 4,
  LINK: 1 << 5,
  STICKER: 1 << 6,
  POLL: 1 << 7,
  FORWARD: 1 << 8,
  PINNED: 1 << 9,
  BOT: 1 << 10,
  WEBHOOK: 1 << 11,
  REPLY: 1 << 12,
  /** The signed in user reacted to the message. */
  MY_REACTION: 1 << 13,
} as const;

const HAS_TYPE_FLAG: Record<string, number> = {
  [HasType.EMBED]: RowFlag.EMBED,
  [HasType.IMAGE]: RowFlag.IMAGE,
  [HasType.VIDEO]: RowFlag.VIDEO,
  [HasType.SOUND]: RowFlag.SOUND,
  [HasType.FILE]: RowFlag.FILE,
  [HasType.LINK]: RowFlag.LINK,
  [HasType.STICKER]: RowFlag.STICKER,
  [HasType.POLL]: RowFlag.POLL,
  [HasType.FORWARD]: RowFlag.FORWARD,
};

const REPLY_MESSAGE_TYPE = 19;

export const messageFlags = (message: Message): number => {
  let flags = 0;
  for (const type of Object.keys(HAS_TYPE_FLAG) as HasType[]) {
    if (messageHasType(message, type)) flags |= HAS_TYPE_FLAG[type];
  }
  if (message.pinned === true) flags |= RowFlag.PINNED;
  if (message.author?.bot === true) flags |= RowFlag.BOT;
  if (message.webhook_id) flags |= RowFlag.WEBHOOK;
  if (message.type === REPLY_MESSAGE_TYPE) flags |= RowFlag.REPLY;
  if (message.reactions?.some((r) => r.me)) flags |= RowFlag.MY_REACTION;
  return flags;
};

const parseTime = (timestamp: string | undefined): number => {
  if (!timestamp) return NaN;
  return new Date(timestamp).getTime();
};

export const toMessageRow = (message: Message): MessageRow => {
  const row: MessageRow = {
    id: message.id,
    timestamp: message.timestamp,
    t: parseTime(message.timestamp),
    authorId: message.author?.id ?? '',
    type: message.type,
    flags: messageFlags(message),
    hasReactions: !!message.reactions && message.reactions.length > 0,
  };
  if (message.mentions && message.mentions.length > 0) row.mentionIds = message.mentions.map((u: User) => u.id);
  return row;
};

export const toMessageRows = (messages: Message[]): MessageRow[] => messages.map(toMessageRow);

/** A row with its reaction fields read again from the message, same object when nothing changed. */
export const rowWithReactions = (row: MessageRow, message: Message): MessageRow => {
  const hasReactions = !!message.reactions && message.reactions.length > 0;
  const mine = message.reactions?.some((r) => r.me) ?? false;
  const flags = mine ? row.flags | RowFlag.MY_REACTION : row.flags & ~RowFlag.MY_REACTION;
  if (hasReactions === row.hasReactions && flags === row.flags) return row;
  return { ...row, hasReactions, flags };
};

/* ─────────────────── Authors ─────────────────── */

/**
 * Merges the authors of `messages` into `authors`. A user already held
 * keeps its object unless a name or avatar changed, so the map keeps its
 * identity across pages (the feed's user map memo depends on that).
 * Returns the same object when nothing changed.
 */
export const mergeAuthors = (authors: Record<string, User>, messages: Message[]): Record<string, User> => {
  let next: Record<string, User> | null = null;
  for (const message of messages) {
    const author = message.author;
    if (!author) continue;
    const held = (next ?? authors)[author.id];
    if (held && sameAuthorFields(held, author)) continue;
    if (!next) next = { ...authors };
    next[author.id] = author;
  }
  return next ?? authors;
};

/* ─────────────────── Sorting ─────────────────── */

export const sortRows = (rows: MessageRow[], order: SortDirection): MessageRow[] => {
  const sorted = rows.slice();
  if (order === SortDirection.ASCENDING) sorted.sort((a, b) => a.t - b.t);
  else sorted.sort((a, b) => b.t - a.t);
  return sorted;
};

/**
 * Merges a fresh page into an already sorted list without re-sorting the
 * whole list (#263). Pages normally belong at one end; anything else
 * falls back to the full sort.
 */
export const appendSortedRows = (existing: MessageRow[], fresh: MessageRow[], order: SortDirection): MessageRow[] => {
  if (fresh.length === 0) return existing;
  const page = sortRows(fresh, order);
  if (existing.length === 0) return page;
  const first = existing[0].t;
  const last = existing[existing.length - 1].t;
  const pageFirst = page[0].t;
  const pageLast = page[page.length - 1].t;
  const desc = order === SortDirection.DESCENDING;
  if (desc ? pageFirst <= last : pageFirst >= last) return existing.concat(page);
  if (desc ? pageLast >= first : pageLast <= first) return page.concat(existing);
  return sortRows(existing.concat(page), order);
};

/* ─────────────────── Refine ─────────────────── */

/** True when the refine needs the message objects: content terms or attachment name rules. */
export const refineNeedsContent = (criteria: RefineCriteria | null | undefined): boolean => {
  if (!criteria) return false;
  if (criteria.searchMessageContents && criteria.searchMessageContents.length > 0) return true;
  if (criteria.attachmentExtensions && criteria.attachmentExtensions.length > 0) return true;
  if (criteria.attachmentFilename) return true;
  return false;
};

/** The content and attachment name part of a refine, run on a message object. */
export const messageMatchesContentRefine = (message: Message, criteria: RefineCriteria): boolean => {
  if (criteria.searchMessageContents && criteria.searchMessageContents.length > 0) {
    const content = message.content?.toLowerCase() || '';
    if (!criteria.searchMessageContents.some((term) => content.includes(term.toLowerCase()))) return false;
  }
  if (!messageMatchesAttachmentCriteria(message.attachments, criteria.attachmentExtensions, criteria.attachmentFilename)) return false;
  return true;
};

const rowCriteriaIsActive = (c: RefineCriteria): boolean =>
  !!(c.searchAfterDate || c.searchBeforeDate)
  || (!!c.selectedHasTypes && c.selectedHasTypes.length > 0)
  || (!!c.userIds && c.userIds.length > 0)
  || (!!c.mentionIds && c.mentionIds.length > 0)
  || (c.isPinned !== undefined && c.isPinned !== IsPinnedType.UNSET)
  || !!c.authorType
  || (!!c.systemMessageGroups && c.systemMessageGroups.length > 0);

/**
 * A predicate over rows for every refine field the row carries. Null when
 * none of them is set. The content part is `contentIds`, the ids a scan
 * of the message objects accepted (see `messageMatchesContentRefine`).
 */
export const rowPredicate = (criteria: RefineCriteria | null | undefined): ((row: MessageRow) => boolean) | null => {
  if (!criteria || !rowCriteriaIsActive(criteria)) return null;
  const c = criteria;
  const after = c.searchAfterDate ? new Date(c.searchAfterDate).getTime() : null;
  const before = c.searchBeforeDate ? new Date(c.searchBeforeDate).getTime() : null;
  const typeMask = c.selectedHasTypes && c.selectedHasTypes.length > 0
    ? c.selectedHasTypes.reduce((mask, type) => mask | (HAS_TYPE_FLAG[type] ?? 0), 0)
    : 0;
  const users = c.userIds && c.userIds.length > 0 ? new Set(c.userIds) : null;
  const mentions = c.mentionIds && c.mentionIds.length > 0 ? new Set(c.mentionIds) : null;
  const pinned = c.isPinned !== undefined && c.isPinned !== IsPinnedType.UNSET ? c.isPinned : null;
  const systemTypes = c.systemMessageGroups && c.systemMessageGroups.length > 0
    ? new Set(groupsToTypes(c.systemMessageGroups).map(Number))
    : null;
  const systemMode = c.systemMessageMode ?? 'only';

  return (row) => {
    if (after !== null || before !== null) {
      if (Number.isNaN(row.t)) return false;
      if (after !== null && row.t < after) return false;
      if (before !== null && row.t > before) return false;
    }
    if (typeMask !== 0 && (row.flags & typeMask) === 0) return false;
    if (users && !users.has(row.authorId)) return false;
    if (pinned !== null) {
      const isPinned = (row.flags & RowFlag.PINNED) !== 0;
      if (pinned === IsPinnedType.YES && !isPinned) return false;
      if (pinned === IsPinnedType.NO && isPinned) return false;
    }
    if (c.authorType) {
      const isBot = (row.flags & RowFlag.BOT) !== 0;
      const isWebhook = (row.flags & RowFlag.WEBHOOK) !== 0;
      if (c.authorType === AuthorType.USER && (isBot || isWebhook)) return false;
      if (c.authorType === AuthorType.BOT && !isBot) return false;
      if (c.authorType === AuthorType.WEBHOOK && !isWebhook) return false;
    }
    if (mentions) {
      if (!row.mentionIds || !row.mentionIds.some((id) => mentions.has(id))) return false;
    }
    if (systemTypes) {
      const selected = systemTypes.has(row.type);
      if (systemMode === 'only' && !selected) return false;
      if (systemMode === 'hide' && selected) return false;
    }
    return true;
  };
};

/**
 * The rows a refine keeps. `contentIds` is the result of the content scan
 * when the refine needs one; null means no content part. Returns `rows`
 * itself when nothing filters.
 */
export const applyRefineToRows = (
  rows: MessageRow[],
  criteria: RefineCriteria | null | undefined,
  contentIds: ReadonlySet<string> | null,
): MessageRow[] => {
  const predicate = rowPredicate(criteria);
  const needsContent = refineNeedsContent(criteria);
  if (!predicate && !needsContent) return rows;
  const ids = needsContent ? contentIds ?? new Set<string>() : null;
  return rows.filter((row) => (!predicate || predicate(row)) && (!ids || ids.has(row.id)));
};
