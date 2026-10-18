/**
 * The message thunks' door to the workspace store (2.2.5 WP2a, plan
 * sections 7 and 10).
 *
 * Every page a walk fetches is written here before the append reaches
 * Redux, so a crash loses at most one page. The conversation record
 * carries the cursor, criteria, order and selection so the next open can
 * restore the conversation and a later Load All continues from where it
 * stopped. Redux still keeps the full message arrays in this package;
 * WP2b replaces them with rows.
 *
 * Nothing here throws at a caller. Writes are skipped while workspaces
 * are not ready (the slice tests build stores without the workspace
 * reducer), a quota failure pauses the run with the storageFull hold,
 * and any other storage failure is logged once and the run carries on
 * in memory, since storage must never be the reason a feature breaks.
 */

import type { Message, User } from 'discrub-core/types/discord-types';
import type { RootState } from '@/app/store';
import type { Conversation, ConversationPagination, ConversationSeed } from '@features/workspace/workspaceTypes';
import { selectCurrentWid, waitForWorkspaces } from '@features/workspace/workspaceSlice';
import { setDiscrubPaused, setOperationHold } from '@features/app/appSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { waitWhilePaused, checkCancelled } from '@/utils/operationLoopUtils';
import { getDmName } from '@/utils/dmListUtils';
import { t } from '@/i18n';
import type { MessageRow } from './messageRows';
import {
  WorkspaceQuotaError,
  clearConversation,
  deleteConversation,
  deleteRows,
  getConversation,
  getSelection,
  patchRows,
  plainCidOf,
  readAuthors,
  readRows,
  readWindow,
  searchCid,
  setSelection,
  updateConversation,
  updateRows,
  writePage,
  type RowPatch,
} from '@services/workspaceStore';

type Dispatch = (action: unknown) => unknown;
type GetState = () => RootState;

export interface PersistApi {
  dispatch: Dispatch;
  getState: GetState;
}

/** Full messages read for the first screen when a conversation is restored. */
const RESTORE_WINDOW = 2000;
/** Slim rows read per transaction when a conversation is restored (2.2.5 W2). */
const RESTORE_ROW_WINDOW = 10_000;

let writeFailureLogged = false;
let notSavedLogged = false;

/** Tests reset the once per session warnings. */
export function resetPersistenceWarnings(): void {
  writeFailureLogged = false;
  notSavedLogged = false;
}

function logWriteFailure(api: PersistApi, error: unknown): void {
  if (writeFailureLogged) return;
  writeFailureLogged = true;
  api.dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.workspaceWriteFailed') }));
  console.error('[workspace] write failed, continuing in memory', error);
}

/* ─────────────────── Seeds ─────────────────── */

/**
 * The conversation record fields for the open channel or DM. Null when
 * nothing is selected or the selection does not match `cid`, so a page
 * for a conversation the user already left is still written under the
 * right record only when one exists.
 */
export function conversationSeedFromState(state: RootState, key: string): ConversationSeed | null {
  // A search set takes its conversation's seed (fix C).
  const cid = plainCidOf(key);
  const channel = state.channel?.selectedChannel;
  if (channel && channel.id === cid) {
    const guild = state.guild?.selectedGuild;
    return {
      kind: 'channel',
      guildId: guild?.id ?? channel.guild_id ?? null,
      name: channel.name ?? cid,
      guildName: guild && guild.id === (channel.guild_id ?? guild.id) ? guild.name ?? null : null,
    };
  }
  const dm = state.dm?.selectedDm;
  if (dm && dm.id === cid) {
    return { kind: 'dm', guildId: null, name: getDmName(dm) };
  }
  return null;
}

/** The record fields for an open thread tab. */
export function threadSeedFromState(state: RootState, key: string): ConversationSeed | null {
  const threadId = plainCidOf(key);
  const tab = state.message?.threadTabs?.[threadId];
  if (!tab) return null;
  const guild = state.guild?.selectedGuild;
  return {
    kind: 'thread',
    guildId: guild?.id ?? null,
    name: tab.threadName || threadId,
    guildName: guild?.name ?? null,
    parentName: state.channel?.selectedChannel?.name ?? null,
  };
}

/* ─────────────────── Pages ─────────────────── */

export type PersistOutcome = 'written' | 'skipped' | 'failed' | 'cancelled';

/**
 * Writes one page, then merges `record` into the conversation record in a
 * second transaction (cursor, criteria, order). On a quota failure a Load
 * All walk is paused with the storageFull hold; once the user resumes, the write is
 * tried again, and a cancel while paused answers `cancelled` so the thunk
 * can end the run. Other failures answer `failed` after one warning.
 */
export async function persistPage(
  api: PersistApi,
  cid: string,
  messages: Message[],
  options: {
    seed?: ConversationSeed | null;
    record?: Partial<Conversation>;
    /**
     * Rows loaded so far, for the hold's "paused at" figure. Only the
     * Load All walks pass it, and only they pause on a full quota: their
     * loops end on `cancelled` and the run shows Resume on the status
     * row. A single page (a scroll, a search, a thread opened) carries on
     * in memory with one warning instead of waiting where nothing can
     * resume it.
     */
    loaded?: number;
    /**
     * Messages already in Redux that were never written because the
     * conversation had only been opened (plan section 4.2). Written first
     * when the record does not exist yet, so the second page brings the
     * first with it.
     */
    backfill?: Message[];
  } = {},
): Promise<PersistOutcome> {
  await waitForWorkspaces(api.getState);
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  const seed = options.seed ?? undefined;
  while (true) {
    try {
      if (options.backfill && options.backfill.length > 0) {
        // A record Start over emptied counts as unwritten too.
        const existing = await getConversation(wid, cid);
        if (!existing || existing.count === 0) await writePage(wid, cid, options.backfill, seed);
      }
      if (messages.length > 0) {
        await writePage(wid, cid, messages, seed);
      } else if (seed) {
        await updateConversation(wid, cid, () => undefined, seed);
      }
      if (options.record) {
        const record = options.record;
        await updateConversation(wid, cid, (conversation) => Object.assign(conversation, record), seed);
      }
      return 'written';
    } catch (error) {
      if (!(error instanceof WorkspaceQuotaError)) {
        logWriteFailure(api, error);
        return 'failed';
      }
      if (options.loaded === undefined) {
        if (!notSavedLogged) {
          notSavedLogged = true;
          api.dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.storageFullNotSaved') }));
        }
        return 'failed';
      }
      // The walk counts the page in hand; the hold names what is saved.
      const loaded = Math.max(0, options.loaded - messages.length);
      api.dispatch(setDiscrubPaused(true));
      api.dispatch(setOperationHold({ kind: 'storageFull', loaded }));
      api.dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.storageFull', { count: loaded }) }));
      await waitWhilePaused(api.getState);
      if (checkCancelled(api.getState)) return 'cancelled';
    }
  }
}

/** A full pagination record from the few fields a thunk knows. */
export function paginationRecord(fields: Partial<ConversationPagination> & { mode: ConversationPagination['mode'] }): ConversationPagination {
  return {
    lastMessageId: null,
    hasMore: true,
    totalCount: null,
    searchOffset: 0,
    searchBeforeDate: null,
    ...fields,
  };
}

/** Merges fields into the conversation record. Never throws. */
export async function persistConversation(
  api: PersistApi,
  cid: string,
  record: Partial<Conversation>,
  seed?: ConversationSeed | null,
): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  try {
    await updateConversation(wid, cid, (conversation) => Object.assign(conversation, record), seed ?? undefined);
    return 'written';
  } catch (error) {
    // A missing record with no seed is the normal case for a conversation
    // nobody wrote yet (plan section 4.2): nothing to write, not a failure.
    if (error instanceof Error && /not found/.test(error.message)) return 'skipped';
    logWriteFailure(api, error);
    return 'failed';
  }
}

/**
 * 2.2.5 fix C: a message can sit in a conversation's plain rows and in its
 * search set at once, so an edit or a delete reaches both. A key that is
 * not saved is a no op in the store.
 */
const bothSets = (cid: string): string[] => [plainCidOf(cid), searchCid(plainCidOf(cid))];

/** The fields an edit can change. Reactions and reply parents stay as enriched. */
const EDIT_FIELDS: Array<keyof Message> = ['content', 'edited_timestamp', 'attachments', 'embeds', 'mentions', 'flags', 'components', 'pinned'];

/** The row patch for an edited message, for the stored rows of its conversation. */
export function editPatch(message: Message): RowPatch {
  const patch: Partial<Message> = {};
  for (const field of EDIT_FIELDS) {
    if (message[field] !== undefined) (patch as Record<string, unknown>)[field] = message[field];
  }
  return { id: message.id, patch };
}

export async function persistRowPatches(api: PersistApi, cid: string, patches: RowPatch[]): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid || patches.length === 0) return 'skipped';
  try {
    for (const key of bothSets(cid)) await patchRows(wid, key, patches);
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

export async function persistRowDeletes(api: PersistApi, cid: string, ids: string[]): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid || ids.length === 0) return 'skipped';
  try {
    for (const key of bothSets(cid)) await deleteRows(wid, key, ids);
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

/** Drops a thread's rows and record, and its search set, when its tab closes. */
export async function forgetConversation(api: PersistApi, cid: string): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  try {
    for (const key of bothSets(cid)) await deleteConversation(wid, key);
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

/** Start over: drops the saved rows, keeps the record's filters. */
export async function clearSavedConversation(api: PersistApi, cid: string): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  try {
    await clearConversation(wid, cid);
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

/**
 * 2.2.5 W1: a reaction change applied to the stored messages of both of a
 * conversation's sets, so a message the cache evicted changes on disk too.
 * Answers the messages that changed in `cid`'s own set, for the rows.
 */
export async function persistRowUpdates(
  api: PersistApi,
  cid: string,
  ids: string[],
  update: (message: Message) => Message,
): Promise<Message[]> {
  const wid = selectCurrentWid(api.getState());
  if (!wid || ids.length === 0) return [];
  let own: Message[] = [];
  try {
    for (const key of bothSets(cid)) {
      const changed = await updateRows(wid, key, ids, update);
      if (key === cid) own = changed;
    }
  } catch (error) {
    logWriteFailure(api, error);
  }
  return own;
}

/* ─────────────────── Selection (2.2.5 W1) ─────────────────── */

/** Saves a conversation's selection under its own key. Never throws. */
export async function persistSelection(api: PersistApi, cid: string, ids: readonly string[]): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  try {
    // Only a conversation that is saved keeps a selection (plan section 4.2).
    const conversation = await getConversation(wid, cid);
    if (!conversation) return 'skipped';
    await setSelection(wid, cid, ids);
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

/* ─────────────────── Restore ─────────────────── */

export interface RestoredConversation {
  conversation: Conversation;
  /** The store key the rows came from: the conversation or its search set. */
  cid: string;
  wid: string;
  /** One row per saved message, oldest first. The reducer sorts under the record's order. */
  rows: MessageRow[];
  /** The authors saved in the workspace, keyed by user id (a superset of this conversation's). */
  authors: Record<string, User>;
  /**
   * The newest saved messages, oldest first, at most one restore window.
   * Only these go to the message cache, for the first screen; the rest
   * are read when they scroll into view.
   */
  newest: Message[];
  /** The saved selection. */
  selectedIds: string[];
}

/**
 * The saved rows and record for a conversation in the open workspace, or
 * null when there are none.
 *
 * 2.2.5 W2: the rows come from the slim store and the authors from the
 * authors store, so an open reads no full message except the newest
 * window for the first screen (about a second at 250K). Before W1 every
 * message was held in one array (about 1 GB at 250K).
 */
export async function restoreConversation(api: PersistApi, cid: string): Promise<RestoredConversation | null> {
  // A channel clicked right after boot must not race the workspace open.
  await waitForWorkspaces(api.getState);
  const wid = selectCurrentWid(api.getState());
  if (!wid) return null;
  try {
    const conversation = await getConversation(wid, cid);
    if (!conversation || conversation.count === 0) return null;
    const rows: MessageRow[] = [];
    let afterId: string | undefined;
    while (true) {
      const window = await readRows(wid, cid, { afterId, limit: RESTORE_ROW_WINDOW });
      for (const row of window) rows.push(row);
      if (window.length < RESTORE_ROW_WINDOW) break;
      afterId = window[window.length - 1].id;
    }
    if (rows.length === 0) return null;
    const newest = (await readWindow(wid, cid, { limit: RESTORE_WINDOW, direction: 'desc' })).reverse();
    const authors = await readAuthors(wid);
    const selectedIds = await restoreSelection(api, wid, cid, conversation);
    return { conversation, cid, wid, rows, authors, newest, selectedIds };
  } catch (error) {
    console.error('[workspace] restore failed, fetching instead', error);
    return null;
  }
}

/** What a conversation record keeps once its rows are gone. */
export interface SavedConversationSettings {
  refineCriteria: Conversation['refineCriteria'];
  order: Conversation['order'];
}

/**
 * Row 159 (pass 3): the refine and sort of a record that has no rows, eg.
 * right after Clear, which keeps the record. The open fetches a fresh first
 * page and puts these back; without them the next write saved the empty
 * screen over the record and they were gone for good.
 * Null when there is no record or it still has rows (the restore covers it).
 */
export async function restoreConversationSettings(api: PersistApi, cid: string): Promise<SavedConversationSettings | null> {
  await waitForWorkspaces(api.getState);
  const wid = selectCurrentWid(api.getState());
  if (!wid) return null;
  try {
    const conversation = await getConversation(wid, cid);
    if (!conversation || conversation.count > 0) return null;
    return {
      refineCriteria: conversation.refineCriteria,
      order: conversation.order,
    };
  } catch (error) {
    console.error('[workspace] settings restore failed', error);
    return null;
  }
}

/**
 * The saved selection. A record written before W1 carries it inline; it
 * moves to its own key and the field is dropped from the record.
 */
async function restoreSelection(api: PersistApi, wid: string, cid: string, conversation: Conversation): Promise<string[]> {
  const saved = await getSelection(wid, cid);
  const legacy = conversation.selectedIds;
  if (legacy === undefined) return saved ?? [];
  const ids = saved ?? legacy;
  try {
    if (!saved && legacy.length > 0) await setSelection(wid, cid, legacy);
    await updateConversation(wid, cid, (record) => {
      delete record.selectedIds;
    });
  } catch (error) {
    logWriteFailure(api, error);
  }
  return ids;
}

/**
 * 2.2.5 fix C: what an open shows. A saved search comes back first (leaving
 * a conversation with a search on keeps it, owner 2026-10-14), then the
 * plain rows. A plain record left in search mode by a 2.2.5 build before
 * the search sets holds search results under the plain key; it is dropped
 * so the open fetches the plain first page.
 */
export async function restoreConversationOrSearch(api: PersistApi, cid: string): Promise<RestoredConversation | null> {
  const search = await restoreConversation(api, searchCid(cid));
  if (search) return search;
  const plainSet = await restoreConversation(api, cid);
  if (plainSet && plainSet.conversation.pagination.mode === 'search') {
    await clearSavedConversation(api, cid);
    return null;
  }
  return plainSet;
}

/** Drops a conversation's search set and its record; the plain rows stay. */
export async function dropSavedSearch(api: PersistApi, cid: string): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  try {
    await deleteConversation(wid, searchCid(cid));
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

/** Mirrors the open thread tabs into the parent conversation's record when it exists. */
export async function persistThreadTabs(api: PersistApi, parentCid: string, state: RootState): Promise<PersistOutcome> {
  const threadTabs = Object.keys(state.message.threadTabs ?? {});
  // Row 127 (pass 2): a parent with only its first page has no record yet, so the seed writes one; without it the tabs were lost on reload.
  return persistConversation(api, parentCid, { threadTabs, activeTab: state.message.activeTab }, conversationSeedFromState(state, parentCid));
}
