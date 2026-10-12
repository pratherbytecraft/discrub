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

import type { Message } from 'discrub-core/types/discord-types';
import type { RootState } from '@/app/store';
import type { Conversation, ConversationPagination, ConversationSeed } from '@features/workspace/workspaceTypes';
import { selectCurrentWid, waitForWorkspaces } from '@features/workspace/workspaceSlice';
import { setDiscrubPaused, setOperationHold } from '@features/app/appSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { waitWhilePaused, checkCancelled } from '@/utils/operationLoopUtils';
import { getDmName } from '@/utils/dmListUtils';
import { t } from '@/i18n';
import {
  WorkspaceQuotaError,
  clearConversation,
  deleteConversation,
  deleteRows,
  getConversation,
  patchRows,
  readWindow,
  updateConversation,
  writePage,
  type RowPatch,
} from '@services/workspaceStore';

type Dispatch = (action: unknown) => unknown;
type GetState = () => RootState;

export interface PersistApi {
  dispatch: Dispatch;
  getState: GetState;
}

/** Rows read back per transaction when a conversation is restored. */
const RESTORE_WINDOW = 2000;

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
export function conversationSeedFromState(state: RootState, cid: string): ConversationSeed | null {
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
export function threadSeedFromState(state: RootState, threadId: string): ConversationSeed | null {
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
    // nobody wrote yet (plan section 4.2); only log real failures.
    if (!(error instanceof Error && /not found/.test(error.message))) logWriteFailure(api, error);
    return 'failed';
  }
}

export async function persistRowPatches(api: PersistApi, cid: string, patches: RowPatch[]): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid || patches.length === 0) return 'skipped';
  try {
    await patchRows(wid, cid, patches);
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
    await deleteRows(wid, cid, ids);
    return 'written';
  } catch (error) {
    logWriteFailure(api, error);
    return 'failed';
  }
}

/** Drops a thread's rows and record when its tab closes. */
export async function forgetConversation(api: PersistApi, cid: string): Promise<PersistOutcome> {
  const wid = selectCurrentWid(api.getState());
  if (!wid) return 'skipped';
  try {
    await deleteConversation(wid, cid);
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

/* ─────────────────── Restore ─────────────────── */

export interface RestoredConversation {
  conversation: Conversation;
  /** Every saved message, oldest first. The reducer sorts under the record's order. */
  messages: Message[];
}

/**
 * The saved rows and record for a conversation in the open workspace, or
 * null when there are none. Reads in windows so a large conversation does
 * not hold one transaction open for seconds.
 */
export async function restoreConversation(api: PersistApi, cid: string): Promise<RestoredConversation | null> {
  // A channel clicked right after boot must not race the workspace open.
  await waitForWorkspaces(api.getState);
  const wid = selectCurrentWid(api.getState());
  if (!wid) return null;
  try {
    const conversation = await getConversation(wid, cid);
    if (!conversation || conversation.count === 0) return null;
    const messages: Message[] = [];
    let afterId: string | undefined;
    while (true) {
      const window = await readWindow(wid, cid, { afterId, limit: RESTORE_WINDOW });
      messages.push(...window);
      if (window.length < RESTORE_WINDOW) break;
      afterId = window[window.length - 1].id;
    }
    if (messages.length === 0) return null;
    return { conversation, messages };
  } catch (error) {
    console.error('[workspace] restore failed, fetching instead', error);
    return null;
  }
}

/** Mirrors the open thread tabs into the parent conversation's record when it exists. */
export async function persistThreadTabs(api: PersistApi, parentCid: string, state: RootState): Promise<PersistOutcome> {
  const threadTabs = Object.keys(state.message.threadTabs ?? {});
  return persistConversation(api, parentCid, { threadTabs, activeTab: state.message.activeTab }, null);
}
