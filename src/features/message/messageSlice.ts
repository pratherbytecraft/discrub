import { createAction, createSlice, createAsyncThunk, createSelector, isDraft, original, PayloadAction } from '@reduxjs/toolkit';
import type { Message, Attachment, User, Channel } from 'discrub-core/types/discord-types';
import type { RestoredConversation } from './messagePersistence';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { ReactionType, IsPinnedType } from 'discrub-core/discord-enum';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { MessageOrder, initialMessageState, initialPaginationState, ThreadTabState, type MessageContainer, type MessageState } from './messageTypes';
import {
  appendSortedRows,
  mergeAuthorMap,
  mergeAuthors,
  messageMatchesContentRefine,
  refineNeedsContent,
  removeRowsById,
  rowPredicate,
  rowWithReactions,
  sortRows,
  toMessageRow,
  toMessageRows,
  updateRowsById,
  findRowByTime,
  type MessageRow,
} from './messageRows';
import {
  batchAddition,
  batchRemoval,
  clearReactions,
  removeEmoji,
  removeOneReaction,
  type ReactionUpdate,
} from './reactionUpdates';
import {
  MAIN_CONTAINER,
  cacheMessages,
  cachedMessagesOf,
  dropCachedMessages,
  evictContainer,
  getCachedMessage,
  replaceCachedMessage,
  updateCachedMessage,
  type HydrationSource,
} from './messageCache';
import { countRows, scan, searchCid } from '@services/workspaceStore';
import { selectCurrentWid } from '@features/workspace/workspaceSlice';
import { getDiscordService } from '@services/discordService';
import type { RootState } from '@/app/store';
import { selectSearchDelay, selectDeleteDelay, selectDelayModifier, selectSettings, selectDiscrubPaused, setDiscrubPaused, setOperationHold } from '@features/app/appSlice';
import { calculateRandomDelay } from '@/utils/delayUtils';
import { userEnrichmentService } from '@services/userEnrichmentService';
import { reactionEnrichmentService } from '@services/reactionEnrichmentService';
import { replyEnrichmentService } from '@services/replyEnrichmentService';
import { mergeCachedUserMap, addFailedUserId, saveCacheToLocalStorage } from '@features/cache/cacheSlice';
import { waitWhilePaused, checkCancelled, cancellableDelay, withTransientRetry, isTransientApiFailure, transientRetryDelayMs, retryBaseDelayMs, describeAnswer, describeFailure, isSignInExpired, throwIfSignInExpired, isSignInExpiredError, retryMaxFor } from '@/utils/operationLoopUtils';
import { addStatusEntry, showOperationTip, showToast } from '@features/status/statusSlice';
import { getEmojiKey } from '@/utils/emojiUtils';
import { applyRefineCriteria, criteriaIsActive, type RefineCriteria } from './messageFiltering';
import { applyRefineToRows } from './messageRows';
import { nextMilestone, iterateSearchMessagesRedux } from '@utils/searchPagination';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { countActiveFilters } from 'discrub-core/filtering';
import { t } from '@/i18n';
import { fetchSearchPageWithRetry, describeSearchFailure, INDEXING_WAITS } from './searchPageRetry';
import { notePackageDeletions } from '@features/package/packageDeletedCache';
import {
  clearSavedConversation,
  conversationSeedFromState,
  dropSavedSearch,
  paginationRecord,
  persistConversation,
  persistPage,
  persistThreadTabs,
  restoreConversation,
  restoreConversationOrSearch,
  restoreConversationSettings,
  threadSeedFromState,
} from './messagePersistence';
import type { Conversation } from '@features/workspace/workspaceTypes';

/** The cached objects behind some rows, for a backfill write (2.2.5 WP2b). */
const cachedRowsOf = (container: string, rows: MessageRow[]): Message[] => {
  const out: Message[] = [];
  for (const row of rows) {
    const message = getCachedMessage(container, row.id);
    if (message) out.push(message);
  }
  return out;
};

/**
 * Status-log hooks for a single-page search request (#262): one warning
 * per 202 wait and per transient retry, worded like Load All's.
 */
const searchPageRetryHooks = (
  dispatch: (action: ReturnType<typeof addStatusEntry> | ReturnType<typeof setOperationHold>) => unknown,
  getState: () => RootState,
) => ({
  getState,
  dispatch,
  onIndexingWait: (attempt: number, delayMs: number) => {
    dispatch(addStatusEntry({
      level: 'warning',
      message: t('status.msg.searchIndexingWait', { seconds: Math.round(delayMs / 1000), attempt, max: INDEXING_WAITS }),
    }));
  },
  onRetry: (attempt: number, delayMs: number, max: number) => {
    dispatch(addStatusEntry({
      level: 'warning',
      message: t('status.msg.searchRetry', { seconds: Math.round(delayMs / 1000), attempt, max }),
    }));
  },
});

/**
 * Append the HTTP status discrub-core already returns (`DiscordApiResponse
 * .status`) to a generic write-failure message, so a failed Discord write is
 * self-diagnosing without the user opening devtools — 403 = permission/token,
 * 404 = already gone, 429 = rate-limited. Filed as #212 to unblock the #199
 * DM-self-delete reports, which are stuck on not knowing the failing status.
 */
const withHttpStatus = (message: string, status?: number): string =>
  `${message} (HTTP ${status ?? 'unknown'})`;

/**
 * Emit a status-log entry when a just-loaded page produced zero matches
 * against the currently-active refine. Gives the user an explicit signal
 * that the fetch succeeded — important because otherwise the UI looks
 * frozen (same filtered list, no new rows appeared).
 */
const maybeEmitPhantomLoadStatus = (
  dispatch: (action: unknown) => void,
  refineCriteria: RefineCriteria | null,
  newPage: Message[],
): void => {
  if (!criteriaIsActive(refineCriteria) || newPage.length === 0) return;
  const matched = applyRefineCriteria(newPage, refineCriteria);
  if (matched.length === 0) {
    dispatch(
      addStatusEntry({
        level: 'info',
        message: t('status.msg.loadedMoreNoneMatched', { count: newPage.length }),
      }),
    );
  }
};

/**
 * Message slice - manages message state, filtering, and selection
 */

/**
 * Delete a single message
 */
export const deleteMessage = createAsyncThunk(
  'message/deleteMessage',
  async (
    {
      messageId,
      channelId,
      token,
    }: {
      messageId: string;
      channelId: string;
      token: string;
    },
    { rejectWithValue, getState, dispatch }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.deleteMessage(token, messageId, channelId);

      if (!response.success) {
        return rejectWithValue(withHttpStatus('Failed to delete message', response.status));
      }

      // #271: a loaded package for this channel learns about the deletion.
      await notePackageDeletions(getState as () => RootState, dispatch, channelId, [messageId]);
      return messageId;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete message'
      );
    }
  }
);

/**
 * #183: how many confirmed deletions accumulate before the bulk-delete loop
 * flushes them to state via `messagesRemoved`. Each state write replaces the
 * `messages`/`filteredMessages`/`selectedMessages` array identities, which
 * makes MessageFeed rebuild its chunking memo and re-measure the virtualizer
 * (O(N) work). Per-message writes made a 1000-message delete O(N·D) — the
 * reported "page unresponsive" freeze. A batch keeps the table visibly
 * draining (a flush every second or two at typical delete delays) while
 * cutting the O(N) writes by the batch size.
 */
// 2.2.1 perf: 25 flushes read as one long task each at 30K loaded (about
// 90 ms, a whole screen of chunks redrawn when the deleted rows are the
// visible ones). Ten keeps each flush under the 50 ms long task line and the
// list moves more steadily while a run deletes what the person is looking at.
export const DELETE_BATCH_SIZE = 10;

/**
 * Delete multiple messages
 */
export const deleteMessages = createAsyncThunk(
  'message/deleteMessages',
  async (
    {
      messages,
      channelId,
      token,
    }: {
      /** Only the ids are used (2.2.5 W4). */
      messages: Array<Pick<Message, 'id'>>;
      channelId: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      dispatch(showOperationTip(t('operation.queued.delete')));
      const discordService = getDiscordService();
      const deletedIds: string[] = [];

      // Get delay settings once before loop
      const state = getState() as RootState;
      const deleteDelay = selectDeleteDelay(state);
      const delayModifier = selectDelayModifier(state);

      // F14: capture the target container NOW — the user may switch tabs
      // mid-run (#237 keeps the tab bar interactive), and a flush that
      // resolved the active tab at dispatch time misrouted up to a whole
      // batch of confirmed deletions into the wrong container.
      const startTab = state.message.activeTab;
      const containerId = startTab && state.message.threadTabs[startTab] ? startTab : null;

      // #183: confirmed-deleted ids not yet applied to state. Flushed as one
      // `messagesRemoved` batch every DELETE_BATCH_SIZE deletions, before
      // parking on pause, and (via `finally`) on every loop exit — normal
      // completion, cancel breaks, or an unexpected throw — so no confirmed
      // deletion is ever lost from state.
      let pendingRemovals: string[] = [];
      const flushPendingRemovals = () => {
        if (pendingRemovals.length === 0) return;
        dispatch(messageSlice.actions.messagesRemoved({ ids: pendingRemovals, containerId }));
        pendingRemovals = [];
      };

      try {
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          // Check pause/cancel before each iteration. Flush before parking on
          // pause so the table reflects every confirmed deletion while paused.
          if (selectDiscrubPaused(getState() as RootState)) flushPendingRemovals();
          await waitWhilePaused(getState as () => RootState);
          if (checkCancelled(getState as () => RootState)) break;

          try {
            // #183: call the service directly instead of dispatching the
            // single-message `deleteMessage` thunk — its fulfilled reducer
            // rewrites all three message arrays per message, which is exactly
            // the per-deletion O(N) work this batch path exists to avoid.
            const response = await discordService.deleteMessage(token, message.id, channelId);
            if (!response.success) {
              throw new Error(withHttpStatus('Failed to delete message', response.status));
            }
            deletedIds.push(message.id);
            pendingRemovals.push(message.id);
            if (pendingRemovals.length >= DELETE_BATCH_SIZE) flushPendingRemovals();

            // Apply delay between deletions (skip after the last one)
            if (i < messages.length - 1) {
              const delayCalc = calculateRandomDelay(deleteDelay, delayModifier);

              const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
              if (wasCancelled) break;
            }
          } catch (error) {
            // #212: surface the failure (now carrying the HTTP status) in the
            // status log, not just the console — a status-log entry is what a
            // user can screenshot, which is exactly what #199 has been missing.
            const reason = error instanceof Error ? error.message : String(error);
            console.error(`Failed to delete message ${message.id}:`, error);
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.msg.couldNotDelete', { id: message.id, reason }),
            }));
          }
        }
      } finally {
        flushPendingRemovals();
      }

      // #271: a loaded package for this channel learns about the deletions.
      await notePackageDeletions(getState as () => RootState, dispatch, channelId, deletedIds);

      if (deletedIds.length > 0) {
        dispatch(addStatusEntry({ level: 'success', message: t('status.msg.deleted', { count: deletedIds.length }) }));
      }
      return deletedIds;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete messages'
      );
    }
  }
);

/**
 * Edit a message
 */
export const editMessage = createAsyncThunk(
  'message/editMessage',
  async (
    {
      messageId,
      channelId,
      content,
      token,
    }: {
      messageId: string;
      channelId: string;
      content: string;
      token: string;
    },
    { rejectWithValue, dispatch }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.editMessage(
        token,
        messageId,
        { content },
        channelId
      );

      if (!response.success || !response.data) {
        // Row 166 (pass 3): an edit says so in the log, like deletes and reactions do.
        dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.editFailed', { id: messageId, status: response.status ?? '?' }) }));
        return rejectWithValue(withHttpStatus('Failed to edit message', response.status));
      }

      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.edited', { count: 1 }) }));
      return response.data as Message;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to edit message'
      );
    }
  }
);

/**
 * Edit multiple messages to the same content
 */
export const editMessages = createAsyncThunk(
  'message/editMessages',
  async (
    {
      messages,
      channelId,
      content,
      token,
    }: {
      /** Only the ids are used (2.2.5 W4). */
      messages: Array<Pick<Message, 'id'>>;
      channelId: string;
      content: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      dispatch(showOperationTip(t('operation.queued.edit')));
      const discordService = getDiscordService();
      const editedMessages: Message[] = [];

      const state = getState() as RootState;
      const deleteDelay = selectDeleteDelay(state);
      const delayModifier = selectDelayModifier(state);

      // F14: capture the target container at start — see deleteMessages.
      const startTab = state.message.activeTab;
      const containerId = startTab && state.message.threadTabs[startTab] ? startTab : null;

      // F13: confirmed edits not yet applied to state, flushed as one
      // `messagesEdited` batch — same structure as deleteMessages'
      // pendingRemovals. Pre-fix this loop dispatched the per-message
      // editMessage thunk, whose fulfilled reducer rewrites all three
      // arrays per message: the "page unresponsive" freeze class #183
      // removed for delete, reproduced by a bulk edit of a large table.
      let pendingEdits: Message[] = [];
      const flushPendingEdits = () => {
        if (pendingEdits.length === 0) return;
        dispatch(messageSlice.actions.messagesEdited({ messages: pendingEdits, containerId }));
        pendingEdits = [];
      };

      try {
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          if (selectDiscrubPaused(getState() as RootState)) flushPendingEdits();
          await waitWhilePaused(getState as () => RootState);
          if (checkCancelled(getState as () => RootState)) break;

          try {
            // Call the service directly instead of dispatching editMessage —
            // its fulfilled reducer is the per-message rewrite this batch
            // path exists to avoid (and it flickers isEditing off between
            // messages; the editMessages pending/fulfilled cases now hold
            // it stable for the whole run).
            const response = await discordService.editMessage(
              token,
              message.id,
              { content },
              channelId
            );
            if (!response.success || !response.data) {
              throw new Error(withHttpStatus('Failed to edit message', response.status));
            }
            const edited = response.data as Message;
            editedMessages.push(edited);
            pendingEdits.push(edited);
            if (pendingEdits.length >= DELETE_BATCH_SIZE) flushPendingEdits();

            if (i < messages.length - 1) {
              const delayCalc = calculateRandomDelay(deleteDelay, delayModifier);
              const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
              if (wasCancelled) break;
            }
          } catch (error) {
            console.error(`Failed to edit message ${message.id}:`, error);
          }
        }
      } finally {
        flushPendingEdits();
      }

      if (editedMessages.length > 0) {
        dispatch(addStatusEntry({ level: 'success', message: t('status.msg.edited', { count: editedMessages.length }) }));
      }
      return editedMessages;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to edit messages'
      );
    }
  }
);

/**
 * Backlog #215 — bulk-edit messages across multiple selected channels.
 *
 * The per-channel `editMessages` thunk above operates on an already-loaded
 * message list in the open channel. This thunk extends the same "overwrite
 * content before deleting" workflow to the multi-select channel scaffold:
 * for each selected channel it streams the CURRENT USER's own messages via
 * the shared search iterator (Discord only permits editing your own
 * messages, so scoping the search to the current user is both the correct
 * behavior and a safety gate) and PATCHes each to `content`. Modeled on
 * `bulkPurgeChannels` — outer channel loop, per-channel search, pause/cancel
 * guards, paced delay, per-channel + summary status entries.
 */
/** 2.2.5 WP4b: Bulk Edit has no progress state; this tells the workspace record which channel is in hand. */
export const bulkEditChannelStarted = createAction<{ index: number; total: number }>('message/bulkEditChannelStarted');

export const bulkEditChannels = createAsyncThunk<
  { edited: number; skipped: number; failed: number; signInExpired?: true },
  {
    channels: Channel[];
    content: string;
    guildId?: string | null;
    searchCriteria?: SearchCriteria | null;
  },
  { state: RootState; rejectValue: string }
>(
  'message/bulkEditChannels',
  async (
    { channels, content, guildId, searchCriteria },
    { dispatch, getState, rejectWithValue }
  ) => {
    dispatch(showOperationTip(t('operation.queued.edit')));

    const initialState = getState() as RootState;
    const token = selectAuthToken(initialState);
    if (!token) return rejectWithValue('Not authenticated');

    const currentUser = selectCurrentUser(initialState);
    if (!currentUser?.id) return rejectWithValue('No current user');
    const currentUserId = currentUser.id;

    const deleteDelay = selectDeleteDelay(initialState);
    const delayModifier = selectDelayModifier(initialState);

    const isDm = !guildId;
    const stats = { edited: 0, skipped: 0, failed: 0 };
    // Row 134: the channel the sign in expired on; the run stops there and keeps its record.
    let signInExpiredAt: number | null = null;

    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.msg.bulkEditStart', { count: channels.length, context: isDm ? 'dm' : 'channel' }),
    }));

    try {
      for (let i = 0; i < channels.length; i++) {
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) break;

        const channel = channels[i];
        const channelName = channel.name || channel.id;
        dispatch(bulkEditChannelStarted({ index: i, total: channels.length }));

        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.msg.bulkEditStartChannel', { name: `${isDm ? '' : '#'}${channelName}`, index: i + 1, total: channels.length }),
        }));

        // Only the current user's own messages can be edited (Discord 403s
        // on others'). Force the author filter to the current user; allow an
        // optional date-range/content scope to flow through from the dialog.
        const criteria: SearchCriteria = {
          searchBeforeDate: searchCriteria?.searchBeforeDate ?? null,
          searchAfterDate: searchCriteria?.searchAfterDate ?? null,
          searchMessageContents: searchCriteria?.searchMessageContents ?? [],
          selectedHasTypes: searchCriteria?.selectedHasTypes ?? [],
          userIds: [currentUserId],
          mentionIds: searchCriteria?.mentionIds ?? [],
          channelIds: [],
          isPinned: searchCriteria?.isPinned ?? IsPinnedType.UNSET,
        };

        let channelEdited = 0;
        let cancelled = false;

        try {
          for await (const page of iterateSearchMessagesRedux({
            token,
            channelId: channel.id,
            guildId: guildId ?? null,
            criteria,
            getState: getState as () => RootState,
            dispatch,
          })) {
            await waitWhilePaused(getState as () => RootState);
            if (checkCancelled(getState as () => RootState)) { cancelled = true; break; }

            for (const message of page.messages) {
              await waitWhilePaused(getState as () => RootState);
              if (checkCancelled(getState as () => RootState)) { cancelled = true; break; }

              // Defensive: the search is author-scoped, but never attempt to
              // edit a message that isn't the current user's.
              if (message.author?.id && message.author.id !== currentUserId) {
                stats.skipped++;
                continue;
              }

              try {
                // Call the service directly rather than dispatching the
                // editMessage thunk: that thunk toggles state.isEditing off on
                // every fulfilled, which would flicker the operation indicator
                // and pause/cancel controls off between messages. bulkEdit holds
                // isEditing stable across the whole run via its own reducer cases.
                const response = await getDiscordService().editMessage(
                  token,
                  message.id,
                  { content },
                  message.channel_id ?? channel.id,
                );
                if (response.success) {
                  stats.edited++;
                  channelEdited++;
                } else {
                  throwIfSignInExpired(response);
                  stats.failed++;
                  console.error(`Bulk edit: failed to edit ${message.id} (HTTP ${response.status ?? 'unknown'})`);
                }
              } catch (error) {
                if (isSignInExpiredError(error)) throw error;
                stats.failed++;
                console.error(`Bulk edit: failed to edit ${message.id}:`, error);
              }

              const delayCalc = calculateRandomDelay(deleteDelay, delayModifier);
              const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
              if (wasCancelled) { cancelled = true; break; }
            }

            if (cancelled) break;
          }
        } catch (error) {
          if (isSignInExpiredError(error)) { signInExpiredAt = i; break; }
          dispatch(addStatusEntry({
            level: 'error',
            message: t('status.msg.bulkEditFailedChannel', { name: `${isDm ? '' : '#'}${channelName}`, error: error instanceof Error ? error.message : t('status.msg.failed') }),
          }));
        }

        dispatch(addStatusEntry({
          level: 'success',
          message: t('status.msg.bulkEditCompletedChannel', { name: `${isDm ? '' : '#'}${channelName}`, count: channelEdited }),
        }));

        if (cancelled) break;
      }

      if (signInExpiredAt !== null) {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.msg.bulkEditSignInExpired', { done: signInExpiredAt, total: channels.length }),
        }));
        dispatch(showToast({ level: 'warning', message: t('workspace.signInExpiredToast') }));
        return { ...stats, signInExpired: true };
      }
      dispatch(addStatusEntry({
        level: 'success',
        message: t('status.msg.bulkEditComplete', { edited: stats.edited, skipped: stats.skipped > 0 ? t('status.msg.skippedSuffix', { count: stats.skipped }) : '', failed: stats.failed > 0 ? t('status.msg.failedSuffix', { count: stats.failed }) : '' }),
      }));
      return stats;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Bulk edit failed'
      );
    }
  }
);

/**
 * Fetch users who reacted with a specific emoji on a message
 */
export const fetchReactingUsers = createAsyncThunk(
  'message/fetchReactingUsers',
  async (
    {
      channelId,
      messageId,
      emoji,
      token,
    }: {
      channelId: string;
      messageId: string;
      emoji: string;
      token: string;
    },
    { getState, rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const state = getState() as RootState;
      const searchDelay = selectSearchDelay(state);
      const delayModifier = selectDelayModifier(state);
      const allUsers: User[] = [];
      let lastId: string | null = null;

      // Paginate through all reacting users
      while (true) {
        const response = await discordService.getReactions(
          token,
          channelId,
          messageId,
          emoji,
          ReactionType.NORMAL,
          lastId
        );

        if (!response.success || !response.data) {
          break;
        }

        const users = response.data as User[];
        if (users.length === 0) break;

        allUsers.push(...users);
        lastId = users[users.length - 1].id;

        // Discord returns max 100 per page
        if (users.length < 100) break;

        // Pace between pages — the service no longer self-delays (#241)
        const { delayMs } = calculateRandomDelay(searchDelay, delayModifier);
        await cancellableDelay(delayMs, getState as () => RootState);
      }

      return { messageId, emoji, users: allUsers };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch reacting users'
      );
    }
  }
);

/**
 * Delete a specific reaction from a message
 */
export const deleteReaction = createAsyncThunk(
  'message/deleteReaction',
  async (
    {
      channelId,
      messageId,
      emoji,
      userId,
      token,
    }: {
      channelId: string;
      messageId: string;
      emoji: string;
      userId: string;
      token: string;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.deleteReaction(
        token,
        channelId,
        messageId,
        emoji,
        userId
      );

      if (!response.success) {
        return rejectWithValue(withHttpStatus('Failed to delete reaction', response.status));
      }

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.removedReaction', { emoji, id: messageId }) }));
      return { messageId, emoji, userId };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete reaction'
      );
    }
  }
);

/**
 * Delete all reactions of a specific emoji from a message
 */
export const deleteAllReactions = createAsyncThunk(
  'message/deleteAllReactions',
  async (
    {
      channelId,
      messageId,
      emoji,
      userIds,
      token,
    }: {
      channelId: string;
      messageId: string;
      emoji: string;
      userIds: string[];
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;
      const deleteDelay = selectDeleteDelay(state);
      const delayModifier = selectDelayModifier(state);
      const deletedUserIds: string[] = [];

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.deletingReactions', { count: userIds.length, emoji }) }));

      for (const userId of userIds) {
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) break;

        try {
          await dispatch(deleteReaction({ channelId, messageId, emoji, userId, token })).unwrap();
          deletedUserIds.push(userId);

          if (userIds.indexOf(userId) < userIds.length - 1) {
            const delayCalc = calculateRandomDelay(deleteDelay, delayModifier);
            const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
            if (wasCancelled) break;
          }
        } catch (error) {
          console.error(`Failed to delete reaction ${emoji} by user ${userId}:`, error);
        }
      }

      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.deletedReactions', { deleted: deletedUserIds.length, total: userIds.length, emoji }) }));
      return { messageId, emoji, deletedUserIds };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete reactions'
      );
    }
  }
);

/**
 * Bulk delete all reactions from a message (requires MANAGE_MESSAGES).
 * Uses DELETE /channels/{id}/messages/{id}/reactions — one API call.
 */
export const bulkDeleteAllReactions = createAsyncThunk(
  'message/bulkDeleteAllReactions',
  async (
    {
      channelId,
      messageId,
      token,
    }: {
      channelId: string;
      messageId: string;
      token: string;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.deleteAllReactionsFromMessage(
        token,
        channelId,
        messageId,
      );

      if (!response.success) {
        return rejectWithValue(withHttpStatus('Failed to delete all reactions', response.status));
      }

      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.removedAllReactions') }));
      return { messageId };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete all reactions'
      );
    }
  }
);

/**
 * Bulk delete all reactions for a specific emoji from a message (requires MANAGE_MESSAGES).
 * Uses DELETE /channels/{id}/messages/{id}/reactions/{emoji} — one API call.
 */
export const bulkDeleteReactionsForEmoji = createAsyncThunk(
  'message/bulkDeleteReactionsForEmoji',
  async (
    {
      channelId,
      messageId,
      emoji,
      token,
    }: {
      channelId: string;
      messageId: string;
      emoji: string;
      token: string;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.deleteAllReactionsForEmoji(
        token,
        channelId,
        messageId,
        emoji,
      );

      if (!response.success) {
        return rejectWithValue(withHttpStatus('Failed to delete reactions for emoji', response.status));
      }

      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.removedAllEmojiReactions', { emoji }) }));
      return { messageId, emoji };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete reactions for emoji'
      );
    }
  }
);

/**
 * Batch remove reactions across multiple messages.
 * Modes: 'all' (bulk endpoint per message), 'emoji' (bulk per-emoji endpoint), 'user' (per-user deletion).
 */
export const batchRemoveReactions = createAsyncThunk(
  'message/batchRemoveReactions',
  async (
    {
      channelId,
      messages,
      mode,
      emojis,
      userId,
      token,
    }: {
      channelId: string;
      messages: { id: string; reactions?: { emoji: { id?: string | null; name?: string | null }; count: number; me?: boolean }[] }[];
      mode: 'all' | 'emoji' | 'user';
      emojis?: string[];
      userId?: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;
      const deleteDelay = selectDeleteDelay(state);
      const delayModifier = selectDelayModifier(state);
      const discordService = getDiscordService();
      let processed = 0;
      let removed = 0;

      // Filter to messages that actually have reactions
      const messagesWithReactions = messages.filter((m) => m.reactions && m.reactions.length > 0);
      const total = messagesWithReactions.length;

      if (total === 0) {
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.noReactionsToRemove') }));
        return { processedMessageIds: [], mode, emojis };
      }

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.processingReactions', { count: total }) }));

      for (const msg of messagesWithReactions) {
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) break;

        let didRemove = false;

        if (mode === 'all') {
          try {
            await discordService.deleteAllReactionsFromMessage(token, channelId, msg.id);
            didRemove = true;
          } catch {
            // Continue on failure — partial success is acceptable
          }
        } else if (mode === 'emoji' && emojis) {
          for (const [i, emoji] of emojis.entries()) {
            // One DELETE per emoji: pace between them, the per-message
            // delay below covers the gap after the last (2.1.3 pacing audit).
            if (i > 0) {
              const { delayMs } = calculateRandomDelay(deleteDelay, delayModifier);
              if (await cancellableDelay(delayMs, getState as () => RootState)) break;
            }
            try {
              await discordService.deleteAllReactionsForEmoji(token, channelId, msg.id, emoji);
              didRemove = true;
            } catch {
              // Continue on failure
            }
          }
        } else if (mode === 'user' && userId) {
          // Per-user: only process emojis the user actually reacted to (me flag)
          const targetReactions = (msg.reactions || []).filter((r) => {
            if (r.me === false) return false;
            if (emojis) return emojis.includes(getEmojiKey(r.emoji));
            return true;
          });
          for (const [i, reaction] of targetReactions.entries()) {
            const emojiKey = getEmojiKey(reaction.emoji);
            if (i > 0) {
              const { delayMs } = calculateRandomDelay(deleteDelay, delayModifier);
              if (await cancellableDelay(delayMs, getState as () => RootState)) break;
            }
            try {
              await discordService.deleteReaction(token, channelId, msg.id, emojiKey, userId);
              didRemove = true;
            } catch {
              // User may not have reacted with this emoji — continue
            }
          }
        }

        processed++;
        if (didRemove) removed++;

        if (processed % 10 === 0 || processed === total) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.msg.processedOf', { processed, total }) }));
        }

        if (processed < total) {
          const { delayMs } = calculateRandomDelay(deleteDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayMs, getState as () => RootState);
          if (wasCancelled) break;
        }
      }

      if (removed > 0) {
        dispatch(addStatusEntry({ level: 'success', message: t('status.msg.removedReactionsFrom', { count: removed }) }));
      } else {
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.noMatchingReactions') }));
      }
      // 2.2.5 W1: `processed` counts the messages with reactions, so the ids
      // come from that list (they came from every message before).
      return { processedMessageIds: messagesWithReactions.slice(0, processed).map((m) => m.id), mode, emojis };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to batch remove reactions'
      );
    }
  }
);

type SelectableEmojiInput = {
  id?: string | null;
  name?: string | null;
  animated?: boolean | null;
};

/**
 * Bulk-add one or more reactions to many messages at once (Backlog #202).
 *
 * Additive mirror of batchRemoveReactions: a paced, pausable, cancellable fan-out of
 * PUT /channels/{id}/messages/{id}/reactions/{emoji}/@me over every (message × emoji)
 * pair. addReaction does not throw — it returns { success, status } — so failures are
 * bucketed by HTTP status (403 = no permission / unusable emoji, 400 = emoji rejected
 * by Discord, 404 = message gone, else = failed). 429s are retried inside the lib.
 * Re-adding an existing @me reaction is idempotent (counts as added).
 */
export const batchAddReactions = createAsyncThunk(
  'message/batchAddReactions',
  async (
    {
      channelId,
      messages,
      emojis,
      token,
    }: {
      channelId: string;
      messages: { id: string }[];
      emojis: SelectableEmojiInput[];
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;
      const deleteDelay = selectDeleteDelay(state);
      const delayModifier = selectDelayModifier(state);
      const discordService = getDiscordService();

      const totalMessages = messages.length;
      const emojiCount = emojis.length;

      if (totalMessages === 0 || emojiCount === 0) {
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.noMessagesOrEmojis') }));
        return { successfulAdds: [] as { messageId: string; emojis: SelectableEmojiInput[] }[], added: 0 };
      }

      let added = 0;
      let notAllowed = 0;
      let invalidEmoji = 0;
      let messageGone = 0;
      let failed = 0;
      let processedMessages = 0;
      const successfulAdds: { messageId: string; emojis: SelectableEmojiInput[] }[] = [];

      const totalCalls = totalMessages * emojiCount;
      let callIndex = 0;
      let cancelled = false;

      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.msg.addingReactions', { reactions: t('status.msg.reactions', { count: emojiCount }), messages: t('status.msg.messages', { count: totalMessages }) }),
      }));

      for (const msg of messages) {
        if (cancelled) break;
        const addedForMsg: SelectableEmojiInput[] = [];

        for (const emoji of emojis) {
          await waitWhilePaused(getState as () => RootState);
          if (checkCancelled(getState as () => RootState)) {
            cancelled = true;
            break;
          }

          const emojiKey = getEmojiKey(emoji);
          const response = await discordService.addReaction(token, channelId, msg.id, emojiKey);
          callIndex++;

          if (response.success) {
            added++;
            addedForMsg.push(emoji);
          } else if (response.status === 403) {
            notAllowed++;
          } else if (response.status === 400) {
            invalidEmoji++;
          } else if (response.status === 404) {
            messageGone++;
          } else {
            failed++;
          }

          if (callIndex < totalCalls) {
            const { delayMs } = calculateRandomDelay(deleteDelay, delayModifier);
            const wasCancelled = await cancellableDelay(delayMs, getState as () => RootState);
            if (wasCancelled) {
              cancelled = true;
              break;
            }
          }
        }

        if (addedForMsg.length > 0) {
          successfulAdds.push({ messageId: msg.id, emojis: addedForMsg });
        }
        processedMessages++;

        if (processedMessages % 10 === 0 || processedMessages === totalMessages) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.msg.addedReactionsTo', { processed: processedMessages, total: totalMessages }) }));
        }
      }

      // Plain-language summary — suppress zero buckets (#161 tone).
      const skips: string[] = [];
      if (notAllowed > 0) skips.push(t('status.msg.skippedNoPermission', { count: notAllowed }));
      if (invalidEmoji > 0) skips.push(t('status.msg.skippedInvalidEmoji', { count: invalidEmoji }));
      if (messageGone > 0) skips.push(t('status.msg.skippedMessageGone', { count: messageGone }));
      if (failed > 0) skips.push(t('status.msg.failedCount', { count: failed }));

      if (added > 0) {
        const tail = skips.length ? ` · ${skips.join(', ')}` : '';
        dispatch(addStatusEntry({
          level: skips.length ? 'warning' : 'success',
          message: t('status.msg.addedReactions', { reactions: t('status.msg.reactions', { count: added }), tail }),
        }));
      } else if (skips.length) {
        dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.noReactionsAddedReasons', { reasons: skips.join(', ') }) }));
      } else {
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.noReactionsAdded') }));
      }

      return { successfulAdds, added };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to add reactions'
      );
    }
  }
);

/**
 * Delete a single attachment from a message
 * If message has multiple attachments, edits message to remove the attachment.
 * If it's the last attachment and message has no content, deletes the entire message.
 */
export const deleteAttachment = createAsyncThunk(
  'message/deleteAttachment',
  async (
    {
      message,
      attachment,
      channelId,
      token,
    }: {
      message: Message;
      attachment: Attachment;
      channelId: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      // Read fresh message from Redux state to ensure accurate attachment list
      const state = getState() as RootState;
      const freshMessage = getCachedMessage(activeContainerKey(state.message), message.id) || message;
      const remainingAttachments = (freshMessage.attachments || []).filter(
        (a) => a.id !== attachment.id
      );

      // If no attachments remain and no content, delete the entire message
      if (remainingAttachments.length === 0 && !freshMessage.content?.trim()) {
        const deleteResponse = await discordService.deleteMessage(token, message.id, channelId);
        if (!deleteResponse.success) {
          return rejectWithValue(withHttpStatus('Failed to delete message', deleteResponse.status));
        }
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.deletedLastAttachment', { id: message.id }) }));
        return { messageId: message.id, deleted: true };
      }

      // Otherwise, edit the message to remove the attachment
      const editResponse = await discordService.editMessage(
        token,
        message.id,
        { attachments: remainingAttachments },
        channelId
      );

      if (!editResponse.success || !editResponse.data) {
        return rejectWithValue(withHttpStatus('Failed to remove attachment', editResponse.status));
      }

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.removedAttachment', { name: attachment.filename, id: message.id }) }));
      return { messageId: message.id, deleted: false, updatedMessage: editResponse.data as Message };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete attachment'
      );
    }
  }
);

/**
 * Delete all attachments from a message
 */
export const deleteAllAttachments = createAsyncThunk(
  'message/deleteAllAttachments',
  async (
    {
      message,
      channelId,
      token,
    }: {
      message: Message;
      channelId: string;
      token: string;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();

      // If no content, delete the entire message
      if (!message.content?.trim()) {
        const deleteResponse = await discordService.deleteMessage(token, message.id, channelId);
        if (!deleteResponse.success) {
          return rejectWithValue(withHttpStatus('Failed to delete message', deleteResponse.status));
        }
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.deletedAllAttachments', { id: message.id }) }));
        return { messageId: message.id, deleted: true };
      }

      // Otherwise, edit message to remove all attachments
      const editResponse = await discordService.editMessage(
        token,
        message.id,
        { attachments: [] },
        channelId
      );

      if (!editResponse.success || !editResponse.data) {
        return rejectWithValue(withHttpStatus('Failed to remove attachments', editResponse.status));
      }

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.removedAllAttachments', { id: message.id }) }));
      return { messageId: message.id, deleted: false, updatedMessage: editResponse.data as Message };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to delete attachments'
      );
    }
  }
);

/** What a restore hands the reducers: rows, authors and one window of objects (2.2.5 W1). */
export interface RestoredRows {
  rows: MessageRow[];
  authors: Record<string, User>;
  newest: Message[];
  selectedIds: string[];
}

const restoredRowsOf = (restored: RestoredConversation): RestoredRows => ({
  rows: restored.rows,
  authors: restored.authors,
  newest: restored.newest,
  selectedIds: restored.selectedIds,
});

/** The content refine of a restored conversation, from a scan of its saved messages. */
async function scanRestored(
  dispatch: (action: unknown) => unknown,
  restored: RestoredConversation,
  criteria: RefineCriteria,
): Promise<string[]> {
  if (restored.rows.length >= SCAN_NOTICE_ROWS) {
    dispatch(addStatusEntry({ level: 'info', message: t('status.msg.scanningMessages', { count: restored.rows.length }) }));
  }
  try {
    const result = await scan(restored.wid, restored.cid, (message) => messageMatchesContentRefine(message, criteria));
    return result.ids;
  } catch (error) {
    console.error('[workspace] content scan failed on restore', error);
    return [];
  }
}

/**
 * Fetch messages for a channel (initial load)
 */
export const fetchMessages = createAsyncThunk(
  'message/fetchMessages',
  async (
    {
      channelId,
      token,
    }: {
      guildId?: string;
      channelId: string;
      token: string;
      searchCriteria?: SearchCriteria;
    },
    { rejectWithValue, dispatch, getState }
  ) => {
    try {
      // 2.2.5: a conversation with saved rows in the open workspace comes
      // back from disk instead of a fetch (plan section 5.4). Newer
      // messages arrive through Start over in the Load All dialog.
      const restored = await restoreConversationOrSearch({ dispatch, getState: getState as () => RootState }, channelId);
      if (restored) {
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.restoredFromWorkspace', { count: restored.rows.length }) }));
        const refine = restored.conversation.refineCriteria;
        // 2.2.5 W1: the content part of a saved refine comes from a scan of
        // the store, not from every message held in memory.
        const contentMatchIds = refineNeedsContent(refine)
          ? await scanRestored(dispatch, restored, refine as RefineCriteria)
          : null;
        return {
          messages: [] as Message[],
          restoredRows: restoredRowsOf(restored),
          hasMore: restored.conversation.pagination.hasMore,
          lastMessageId: restored.conversation.pagination.lastMessageId ?? restored.rows[0]?.id ?? null,
          restored: restored.conversation,
          contentMatchIds,
        };
      }

      const discordService = getDiscordService();

      // Fetch first page (most recent 100)
      const response = await discordService.fetchMessageData(
        token,
        '', // Empty lastId for initial load
        channelId
      );

      if (!response.success || !response.data) {
        // Row 97 (pass 3): a channel the account cannot read says so once, in the app language.
        return rejectWithValue(response.status === 403 ? t('status.msg.noAccess') : t('status.msg.fetchFailed'));
      }

      const messages = response.data as Message[];

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loaded', { count: messages.length }) }));
      // Row 159: a record without rows (after Clear) still has its refine and sort.
      const settings = await restoreConversationSettings({ dispatch, getState: getState as () => RootState }, channelId);

      return {
        messages,
        hasMore: messages.length === 100, // If we got 100, there might be more
        lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
        restoredRows: null as RestoredRows | null,
        restored: null as Conversation | null,
        contentMatchIds: null as string[] | null,
        settings,
      };
    } catch (error) {
      console.error('[messages] first page failed', error);
      return rejectWithValue(t('status.msg.fetchFailed'));
    }
  }
);

/**
 * Fetch more messages (infinite scroll)
 */
export const fetchMoreMessages = createAsyncThunk(
  'message/fetchMoreMessages',
  async (
    {
      channelId,
      token,
      lastMessageId,
    }: {
      channelId: string;
      token: string;
      lastMessageId: string;
    },
    { rejectWithValue, dispatch, getState }
  ) => {
    try {
      const discordService = getDiscordService();

      // Fetch next page using lastMessageId as cursor
      const response = await discordService.fetchMessageData(
        token,
        lastMessageId,
        channelId
        // QueryStringParam.BEFORE is the default
      );

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch more messages');
      }

      const messages = response.data as Message[];

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadedMore', { count: messages.length }) }));
      const stateNow = getState() as RootState;
      maybeEmitPhantomLoadStatus(
        dispatch,
        stateNow.message.refineCriteria,
        messages,
      );

      const hasMore = messages.length === 100;
      const nextLastMessageId = messages.length > 0 ? messages[messages.length - 1].id : lastMessageId;
      // 2.2.5: the second page is what makes a conversation worth keeping
      // (plan section 4.2); the first page rides along as the backfill.
      await persistPage({ dispatch, getState: getState as () => RootState }, channelId, messages, {
        seed: conversationSeedFromState(stateNow, channelId),
        backfill: cachedRowsOf(MAIN_CONTAINER, stateNow.message.rows),
        record: { pagination: paginationRecord({ mode: 'paginated', lastMessageId: nextLastMessageId, hasMore }) },
      });

      return {
        messages,
        hasMore,
        lastMessageId: nextLastMessageId,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch more messages'
      );
    }
  }
);

/**
 * Search messages using Discord Search API — fetches page 1 only.
 *
 * Historically this thunk looped until every matching message was returned,
 * which meant huge channels took minutes to surface any results. Now it
 * fetches a single page of 25 matches and sets up pagination state so
 * subsequent pages can be pulled lazily (via `fetchNextSearchPage` on scroll)
 * or all-at-once (via `loadAllSearchResults` when the user clicks Load All).
 *
 * Discord's search endpoint caps each query at 5000 matches. Going past that
 * requires restarting the search with a new `searchAfterDate` boundary —
 * handled in `loadAllSearchResults`, not here.
 */
export const searchMessages = createAsyncThunk(
  'message/searchMessages',
  async (
    {
      channelId,
      guildId,
      token,
      searchCriteria,
    }: {
      channelId?: string;
      guildId?: string;
      token: string;
      searchCriteria: SearchCriteria;
    },
    { rejectWithValue, dispatch, getState }
  ) => {
    try {
      dispatch(showOperationTip(t('operation.queued.search')));
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.searchStarting') }));
      const discordService = getDiscordService();

      // #262: wait out a 202 (Discord still indexing) and retry transient
      // failures, then say what Discord answered when it still fails.
      const response = await fetchSearchPageWithRetry(
        () => discordService.fetchSearchMessageData(
          token,
          0,
          channelId || null,
          guildId || null,
          searchCriteria
        ),
        searchPageRetryHooks(dispatch, getState as () => RootState),
      );

      if (!response.success || !response.data) {
        if (checkCancelled(getState as () => RootState)) {
          return rejectWithValue('Search cancelled');
        }
        return rejectWithValue(describeSearchFailure(response, 'channel'));
      }

      const rawMessages = response.data.messages
        ? response.data.messages.flatMap((group) => group)
        : [];
      const totalResults = response.data.total_results ?? rawMessages.length;

      // #216: an empty result while Discord is still building this
      // conversation's search index does NOT mean "no matches" — say so
      // instead of letting the user conclude their messages are gone.
      if (response.data.doing_deep_historical_index && rawMessages.length === 0) {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.msg.stillIndexing'),
        }));
      }

      // Pass 1 reaction enrichment (#163): Discord's search endpoint omits
      // `reactions`. Without this, reaction badges, the Remove Reactions
      // button, and downstream exports all silently lose reaction data
      // for search-loaded sets.
      const settings = selectSettings(getState() as RootState);
      const reactionEnriched = await reactionEnrichmentService.enrichMessages(
        rawMessages,
        token,
        settings,
        {
          shouldStop: async () => {
            await waitWhilePaused(getState as () => RootState);
            return checkCancelled(getState as () => RootState);
          },
          onWillEnrich: (count) => dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchFetchingReactions', { count }),
          })),
        },
      );
      // Pass 2 reply parent enrichment (#194): Discord's search endpoint
      // omits `referenced_message` on type-19 hits. Without this, every
      // reply in a search result shows "Original message was deleted"
      // even when the parent is alive. Sequenced after reaction
      // enrichment to keep the around-fetch loop deterministic.
      const messages = await replyEnrichmentService.enrichMessages(
        reactionEnriched,
        token,
        settings,
        {
          shouldStop: async () => {
            await waitWhilePaused(getState as () => RootState);
            return checkCancelled(getState as () => RootState);
          },
          onWillEnrich: (count) => dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchResolvingReplies', { count }),
          })),
        },
      );

      dispatch(
        addStatusEntry({
          level: 'success',
          message: t('status.msg.searchFound', { count: messages.length, total: totalResults }),
        })
      );

      // 2.2.5 fix C: a search writes its results to the conversation's
      // search set, beside the plain rows, which it never touches. The search
      // record keeps the criteria and cursor so the next open shows the same
      // results and Load All continues from them.
      if (channelId) {
        const api = { dispatch, getState: getState as () => RootState };
        await dropSavedSearch(api, channelId);
        await persistPage(api, searchCid(channelId), messages, {
          seed: conversationSeedFromState(getState() as RootState, channelId),
          record: {
            searchCriteria,
            pagination: paginationRecord({
              mode: 'search',
              totalCount: totalResults,
              searchOffset: messages.length,
              hasMore: messages.length > 0 && messages.length < totalResults,
            }),
          },
        });
      }

      return {
        messages,
        totalResults,
        // Next page starts after the results we just got. #208: do NOT gate
        // hasMore on the page being exactly full — Discord's /messages/search
        // returns spuriously short pages mid-stream (index lag), and the old
        // `=== SEARCH_PAGE_SIZE` check hid "Load More" with results remaining.
        // A non-empty page with offset still below total means keep going;
        // only a genuinely empty page (or reaching total) ends pagination.
        nextOffset: messages.length,
        hasMore: messages.length > 0 && messages.length < totalResults,
        // Persist the criteria so fetchNextSearchPage / loadAllSearchResults
        // know which search they're paginating without the caller having to
        // dispatch setSearchCriteria separately.
        searchCriteria,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while searching messages'
      );
    }
  }
);

/**
 * Fetch the next page of an already-active search. Reads the current offset
 * and searchCriteria from state; appends results; updates hasMore/offset.
 * A no-op if there's no active search (mode !== 'search') or hasMore is false.
 */
export const fetchNextSearchPage = createAsyncThunk(
  'message/fetchNextSearchPage',
  async (
    {
      channelId,
      guildId,
      token,
    }: { channelId?: string; guildId?: string; token: string },
    { rejectWithValue, getState, dispatch }
  ) => {
    const state = getState() as RootState;
    const { searchCriteria, pagination, refineCriteria } = state.message;

    if (
      pagination.mode !== 'search' ||
      !pagination.hasMore ||
      !searchCriteria
    ) {
      return rejectWithValue('No active search page to fetch');
    }

    try {
      const discordService = getDiscordService();
      // #264: the next page gets the same 202 wait and transient retry as
      // the first one. A filter combination Discord has not indexed yet
      // (a By User filter is the common case) answers 202 on page 2, and
      // without the wait "Load More" gave up at the first 25 results.
      const response = await fetchSearchPageWithRetry(
        () => discordService.fetchSearchMessageData(
          token,
          pagination.searchOffset,
          channelId || null,
          guildId || null,
          searchCriteria
        ),
        searchPageRetryHooks(dispatch, getState as () => RootState),
      );

      if (!response.success || !response.data) {
        if (checkCancelled(getState as () => RootState)) {
          return rejectWithValue('Search cancelled');
        }
        return rejectWithValue(describeSearchFailure(response, 'channel'));
      }

      const rawMessages = response.data.messages
        ? response.data.messages.flatMap((group) => group)
        : [];
      const totalResults = response.data.total_results ?? pagination.totalCount ?? 0;

      // Pass 1 reaction enrichment (#163) — see searchMessages thunk.
      const settings = selectSettings(getState() as RootState);
      const reactionEnriched = await reactionEnrichmentService.enrichMessages(
        rawMessages,
        token,
        settings,
        {
          shouldStop: async () => {
            await waitWhilePaused(getState as () => RootState);
            return checkCancelled(getState as () => RootState);
          },
          onWillEnrich: (count) => dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchFetchingReactions', { count }),
          })),
        },
      );
      // Pass 2 reply parent enrichment (#194) — see searchMessages thunk.
      const messages = await replyEnrichmentService.enrichMessages(
        reactionEnriched,
        token,
        settings,
        {
          shouldStop: async () => {
            await waitWhilePaused(getState as () => RootState);
            return checkCancelled(getState as () => RootState);
          },
          onWillEnrich: (count) => dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchResolvingReplies', { count }),
          })),
        },
      );

      const newOffset = pagination.searchOffset + messages.length;

      maybeEmitPhantomLoadStatus(dispatch, refineCriteria, messages);

      if (channelId) {
        await persistPage({ dispatch, getState: getState as () => RootState }, searchCid(channelId), messages, {
          seed: conversationSeedFromState(getState() as RootState, channelId),
          record: {
            searchCriteria,
            pagination: paginationRecord({
              mode: 'search',
              totalCount: totalResults,
              searchOffset: newOffset,
              hasMore: messages.length > 0 && newOffset < totalResults,
            }),
          },
        });
      }

      return {
        messages,
        totalResults,
        newOffset,
        // #208: a short page mid-stream is not "the end" — keep "Load More"
        // available while the page returned results and offset is below total.
        hasMore: messages.length > 0 && newOffset < totalResults,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while fetching the next search page'
      );
    }
  }
);

/**
 * Explicit Load All for the currently-active search — loops through remaining
 * pages until hasMore goes false, with per-milestone status entries and
 * load-all progress. Preserves the old eager-search behavior but now gated
 * behind a user action.
 *
 * Also handles the >5000-match case by restarting the search with an updated
 * `searchAfterDate` boundary, matching the historical behavior of the
 * auto-looping `searchMessages`.
 */
export const loadAllSearchResults = createAsyncThunk(
  'message/loadAllSearchResults',
  async (
    {
      channelId,
      guildId,
      token,
    }: { channelId?: string; guildId?: string; token: string },
    { rejectWithValue, dispatch, getState, signal }
  ) => {
    const initial = getState() as RootState;
    const initialCriteria = initial.message.searchCriteria;
    if (!initialCriteria || initial.message.pagination.mode !== 'search') {
      return rejectWithValue('No active search to load all for');
    }

    const discordService = getDiscordService();
    const searchDelay = selectSearchDelay(initial);
    const delayModifier = selectDelayModifier(initial);

    const initialRows = initial.message.rows;
    let loaded = initialRows.length;
    const seenIds = new Set(initialRows.map((r) => r.id));
    let milestoneBoundary = nextMilestone(loaded);

    // #221: freeze the grand total used for the "X of Y matches loaded
    // (Z remaining)" header + status-log denominators. The lib iterator
    // cap-shifts max_id every page (#188/#208), so Discord returns
    // total_results for the SHRINKING [min_id, max_id] window — it counts
    // DOWN as we walk newest→oldest. Using each page's total made "loaded"
    // overtake "total" (e.g. "5250 of 188") and "remaining" go negative.
    // Anchor to the initial search's full-window total and never let it drop
    // below what we've actually loaded.
    let grandTotal = initial.message.pagination.totalCount ?? loaded;

    // #208: pagination is delegated to the lib's iterateSearchResults, which
    // walks newest→oldest by tightening searchBeforeDate to the oldest message
    // seen (always-cap-shift, the #188 fix this read path never got). Seed the
    // resume frontier from the oldest message the initial search already
    // loaded so we don't refetch the top — and so a transient-failure restart
    // resumes from progress rather than from scratch.
    let resumeBeforeDate: Date | undefined;
    for (const r of initialRows) {
      if (r.timestamp) {
        const t = new Date(r.timestamp);
        if (!resumeBeforeDate || t < resumeBeforeDate) resumeBeforeDate = t;
      }
    }

    const filterCount = countActiveFilters(initialCriteria);
    const isFiltered = filterCount > 0;

    dispatch(
      addStatusEntry({
        level: 'info',
        message: isFiltered
          ? `Loading all filtered messages (${filterCount} filter${filterCount === 1 ? '' : 's'} active)…`
          : 'Loading all messages…',
      })
    );

    // Reaction enrichment status cadence: emit on first batch, then on
    // nextMilestone boundaries over cumulative enrichment count, then
    // once at the end. Mirrors the search-count ladder (#154) and the
    // reaction-discovery throttle (#170) — avoids the per-batch spam
    // (#178) where a 1010-result load would print ~40 near-identical
    // "fetching reaction data…" entries.
    let reactionTotal = 0;
    let reactionMilestone = nextMilestone(0);
    let reactionAnnounced = false;
    const emitReactionStatus = (count: number) => {
      reactionTotal += count;
      if (!reactionAnnounced) {
        dispatch(
          addStatusEntry({
            level: 'info',
            message: t('status.msg.searchFetchingReactions', { count }),
          })
        );
        reactionAnnounced = true;
        reactionMilestone = nextMilestone(reactionTotal);
        return;
      }
      if (reactionTotal >= reactionMilestone) {
        dispatch(
          addStatusEntry({
            level: 'info',
            message: t('status.msg.searchEnrichedSoFar', { count: reactionTotal }),
          })
        );
        reactionMilestone = nextMilestone(reactionTotal);
      }
    };

    // #194: parallel milestone ladder for reply parent enrichment.
    let replyTotal = 0;
    let replyMilestone = nextMilestone(0);
    let replyAnnounced = false;
    const emitReplyStatus = (count: number) => {
      replyTotal += count;
      if (!replyAnnounced) {
        dispatch(
          addStatusEntry({
            level: 'info',
            message: t('status.msg.searchResolvingReplies', { count }),
          })
        );
        replyAnnounced = true;
        replyMilestone = nextMilestone(replyTotal);
        return;
      }
      if (replyTotal >= replyMilestone) {
        dispatch(
          addStatusEntry({
            level: 'info',
            message: t('status.msg.searchResolvedSoFar', { count: replyTotal }),
          })
        );
        replyMilestone = nextMilestone(replyTotal);
      }
    };

    try {
      let transientRetries = 0;
      let lastAnswer = '';

      // Outer restart loop. The lib iterator handles offset pagination, the
      // 5000-match cap-shift, total_results reshuffles, 202 index-lag retry,
      // and two-empty-page termination — the convergence logic the old
      // hand-rolled short-page break (#208) got wrong. It only retries 202
      // internally and THROWS on a transient network/5xx failure, so we wrap
      // it to preserve #185 Bug A: retry, then pause + Resume from progress.
      // Because it cap-shifts by searchBeforeDate, recreating it from the
      // oldest message loaded resumes exactly where it stopped.
      restart: while (true) {
        if (signal.aborted) {
          return rejectWithValue('Load all cancelled');
        }

        const iterator = discordService.iterateSearchResults({
          token,
          channelId: channelId || null,
          guildId: guildId || null,
          criteria: resumeBeforeDate
            ? { ...initialCriteria, searchBeforeDate: resumeBeforeDate }
            : { ...initialCriteria },
          shouldStop: async () => {
            await waitWhilePaused(getState as () => RootState);
            return checkCancelled(getState as () => RootState);
          },
          onBetweenPages: async () => {
            const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
            // Resolves true on Pause-cancel/cancel mid-wait → stops the
            // iterator; we surface that as a cancel after the loop.
            return await cancellableDelay(
              delayCalc.delayMs,
              getState as () => RootState
            );
          },
        });

        // Drive the iterator by hand so a fetch/transient throw (from
        // .next()) is separable from a body throw (enrichment) — the former
        // retries, the latter is a hard failure routed to the outer catch.
        while (true) {
          let result: Awaited<ReturnType<typeof iterator.next>>;
          try {
            result = await iterator.next();
          } catch (err) {
            const status = (err as { status?: number } | null)?.status;
            if (isTransientApiFailure({ success: false, status })) {
              transientRetries += 1;
              lastAnswer = describeAnswer({ status });
              if (transientRetries <= 5) {
                // #265: same curve as withTransientRetry, from the Retry wait setting.
                const delayMs = transientRetryDelayMs(
                  transientRetries - 1,
                  retryBaseDelayMs(getState as () => RootState),
                );
                dispatch(addStatusEntry({
                  level: 'warning',
                  message: t('status.msg.searchLoadAllRetry', { answer: lastAnswer, seconds: Math.round(delayMs / 1000), attempt: transientRetries, max: retryMaxFor({ status }, 5) }),
                }));
                const cancelled = await cancellableDelay(
                  delayMs,
                  getState as () => RootState,
                  signal
                );
                if (cancelled) return rejectWithValue('Load all cancelled');
                continue restart;
              }
              // Exhausted retries — pause and let the user fix their network,
              // then Resume to continue from progress (#185 Bug A).
              dispatch(setDiscrubPaused(true));
              dispatch(setOperationHold({ kind: 'retryExhausted', answer: lastAnswer, loaded: loaded }));
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.msg.searchLoadAllPaused', { answer: lastAnswer, count: loaded }),
              }));
              await waitWhilePaused(getState as () => RootState);
              if (checkCancelled(getState as () => RootState)) {
                return rejectWithValue('Load all cancelled');
              }
              transientRetries = 0;
              continue restart;
            }
            return rejectWithValue('Failed while loading all search results');
          }

          if (result.done) {
            // Iterator finished (exhausted) or stopped via shouldStop/
            // onBetweenPages. A stop triggered by cancel must reject.
            if (signal.aborted || checkCancelled(getState as () => RootState)) {
              return rejectWithValue('Load all cancelled');
            }
            break restart;
          }

          const pageResult = result.value;
          if (checkCancelled(getState as () => RootState)) {
            return rejectWithValue('Load all cancelled');
          }

          // #169-style honesty: the iterator emits a synthetic final page
          // with incomplete=true when it gives up below total_results
          // (Discord stopped serving matches — search-index churn). Surface
          // the shortfall instead of silently reporting success.
          if (pageResult.incomplete) {
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.msg.searchLoadAllStopped', { count: loaded, total: pageResult.totalResults }),
            }));
            continue;
          }

          // The iterator cap-shifts on an inclusive max_id boundary and does
          // not dedup internally, so the boundary message can reappear; a
          // transient restart also re-walks the frontier. Dedup here and
          // advance the resume frontier to the oldest message seen.
          const fresh = pageResult.messages.filter((m) => !seenIds.has(m.id));
          for (const m of fresh) {
            seenIds.add(m.id);
            if (m.timestamp) {
              const t = new Date(m.timestamp);
              if (!resumeBeforeDate || t < resumeBeforeDate) resumeBeforeDate = t;
            }
          }
          transientRetries = 0; // a page arrived — reset the retry budget
          if (fresh.length === 0) continue;

          // #221: keep the displayed total anchored to the full-window total.
          // pageResult.totalResults only shrinks under cap-shift, so Math.max
          // pins it to the initial total.
          grandTotal = Math.max(grandTotal, pageResult.totalResults);

          // Pass 1 reaction enrichment (#163) — per-page so a mid-load cancel
          // preserves messages enriched before the cancel.
          const settings = selectSettings(getState() as RootState);
          const reactionEnriched = await reactionEnrichmentService.enrichMessages(
            fresh,
            token,
            settings,
            {
              shouldStop: async () => {
                await waitWhilePaused(getState as () => RootState);
                return checkCancelled(getState as () => RootState);
              },
              onWillEnrich: emitReactionStatus,
            },
          );
          // Pass 2 reply parent enrichment (#194) — also per-page.
          const page = await replyEnrichmentService.enrichMessages(
            reactionEnriched,
            token,
            settings,
            {
              shouldStop: async () => {
                await waitWhilePaused(getState as () => RootState);
                return checkCancelled(getState as () => RootState);
              },
              onWillEnrich: emitReplyStatus,
            },
          );

          loaded += page.length;

          // #221: defensive — never show fewer total than we've loaded, even
          // if Discord under-reported total_results for the first window.
          grandTotal = Math.max(grandTotal, loaded);

          // 2.2.5: on disk before it reaches Redux (plan section 7). A full
          // quota pauses the walk here; a cancel while paused ends it.
          if (channelId) {
            const outcome = await persistPage({ dispatch, getState: getState as () => RootState }, searchCid(channelId), page, {
              seed: conversationSeedFromState(getState() as RootState, channelId),
              loaded: loaded,
              record: {
                searchCriteria: initialCriteria,
                pagination: paginationRecord({
                  mode: 'search',
                  totalCount: grandTotal,
                  searchOffset: loaded,
                  searchBeforeDate: resumeBeforeDate ? resumeBeforeDate.toISOString() : null,
                }),
              },
            });
            if (outcome === 'cancelled') return rejectWithValue('Load all cancelled');
          }

          // #181: append live so the table grows as Load All walks pages.
          // The reducer dedupes + re-sorts under the active order.
          dispatch(
            messageSlice.actions.appendLoadAllPage({
              messages: page,
              totalCount: grandTotal,
              searchOffset: loaded,
            })
          );

          dispatch(
            updateLoadAllProgress({
              current: loaded,
              total: grandTotal,
              message: t('status.msg.searchFetched', { count: loaded, total: grandTotal }),
            })
          );

          if (loaded >= milestoneBoundary) {
            dispatch(
              addStatusEntry({
                level: 'info',
                message: t('status.msg.searchFetched', { count: loaded, total: grandTotal }),
              })
            );
            milestoneBoundary = nextMilestone(loaded);
          }
        }
      }

      // 2.2.5 WP4a: a stop ends the iterator quietly; it is not the end of
      // the results, so the record must not be marked complete.
      if (signal.aborted || checkCancelled(getState as () => RootState)) {
        return rejectWithValue('Load all cancelled');
      }

      if (reactionAnnounced) {
        dispatch(
          addStatusEntry({
            level: 'info',
            message: t('status.msg.searchEnrichedTotal', { count: reactionTotal }),
          })
        );
      }

      dispatch(
        addStatusEntry({
          level: 'success',
          message: isFiltered
            ? t('status.msg.loadedFiltered', { count: loaded })
            : t('status.msg.loaded', { count: loaded }),
        })
      );

      if (channelId) {
        await persistConversation({ dispatch, getState: getState as () => RootState }, searchCid(channelId), {
          complete: true,
          pagination: paginationRecord({ mode: 'search', hasMore: false, totalCount: loaded, searchOffset: loaded }),
        });
      }

      return {
        totalResults: loaded,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while loading all search results'
      );
    }
  }
);

/**
 * Fetch all messages from a channel (bulk load)
 */
export const fetchAllMessages = createAsyncThunk(
  'message/fetchAllMessages',
  async (
    {
      channelId,
      token,
    }: {
      channelId: string;
      token: string;
    },
    { rejectWithValue, dispatch, signal, getState }
  ) => {
    try {
      dispatch(showOperationTip(t('operation.queued.loadAll')));
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllStarting') }));
      const discordService = getDiscordService();

      // Get delay settings once at start
      const state = getState() as RootState;
      const searchDelay = selectSearchDelay(state);
      const delayModifier = selectDelayModifier(state);

      // 2.2.5: continue from the pages already loaded on the plain path
      // instead of walking from the top again. The cursor is the oldest
      // loaded id, which a restored conversation carries from its record.
      const existingRows = state.message.rows;
      const existing = cachedRowsOf(MAIN_CONTAINER, existingRows);
      // The pending reducer already set mode 'all', so the plain path is
      // anything that is not a search.
      const continuing = state.message.pagination.mode !== 'search' && existingRows.length > 0 && !!state.message.pagination.lastMessageId;
      const seed = conversationSeedFromState(state, channelId);
      const api = { dispatch, getState: getState as () => RootState };

      // 2.2.5 fix B: pages go to disk and Redux as they arrive, so the walk
      // keeps only a count and the oldest id it fetched. It used to hold
      // every message in an array copied on every page.
      let loadedCount = 0;
      let lastFetchedId: string | null = null;
      let lastMessageId = continuing ? (state.message.pagination.lastMessageId as string) : '';
      let hasMore = continuing ? state.message.pagination.hasMore : true;
      // 500-step cadence (not the shared adaptive helper) — direct-history
      // walks of busy channels can fetch tens of thousands of messages, and
      // a finer cadence would flood the status log.
      let nextLogBoundary = 500;

      // 2.2.5 WP4a: a stop keeps what was loaded and leaves the walk
      // resumable. Before this a stop between pages fell through to the
      // success path and the conversation was recorded as complete.
      const stopped = () => {
        if (lastFetchedId) {
          dispatch(messageSlice.actions.setLoadAllCursor({ lastMessageId: lastFetchedId, hasMore: true }));
        }
        return rejectWithValue('Load cancelled');
      };

      while (hasMore && !signal.aborted) {
        // Check pause/cancel
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) return stopped();

        // Fetch next batch — retry transient failures (#185 Bug A).
        // On exhaustion, pause the operation so the user can fix
        // their network and click Resume; the loop continues with
        // the same lastMessageId on the next iteration.
        const response = await withTransientRetry(
          () => discordService.fetchMessageData(token, lastMessageId, channelId),
          {
            getState: getState as () => RootState,
            dispatch,
            signal,
            onRetry: (attempt, delayMs, last, max) => {
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.msg.loadAllRetry', { answer: describeAnswer(last), seconds: Math.round(delayMs / 1000), attempt, max }),
              }));
            },
          },
        );

        if (!response.success || !response.data) {
          if (isTransientApiFailure(response)) {
            dispatch(setDiscrubPaused(true));
            dispatch(setOperationHold({ kind: 'retryExhausted', answer: describeAnswer(response), loaded: loadedCount }));
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.msg.loadAllPaused', { answer: describeAnswer(response), count: loadedCount }),
            }));
            continue;
          }
          if (isSignInExpired(response)) dispatch(messageSlice.actions.markLoadAllSignInExpired());
          return rejectWithValue(describeFailure(response, 'fetchAllFailed'));
        }

        const messages = response.data as Message[];
        loadedCount += messages.length;
        if (messages.length > 0) lastFetchedId = messages[messages.length - 1].id;
        const pageHasMore = messages.length >= 100;
        const pageCursor = messages.length > 0 ? messages[messages.length - 1].id : lastMessageId;

        // 2.2.5: on disk before it reaches Redux (plan section 7). The
        // first page a user only scrolled rides along as the backfill.
        const outcome = await persistPage(api, channelId, messages, {
          seed,
          backfill: existing,
          loaded: existingRows.length + loadedCount,
          record: { pagination: paginationRecord({ mode: 'all', lastMessageId: pageCursor, hasMore: pageHasMore }) },
        });
        if (outcome === 'cancelled') return stopped();

        // #181: live append so the table grows during the operation.
        dispatch(messageSlice.actions.appendLoadAllPage({ messages }));

        // Update progress
        dispatch(
          updateLoadAllProgress({
            current: loadedCount,
            total: 0, // Unknown until we reach the end
            message: t('status.msg.loadedProgress', { count: loadedCount }),
          })
        );

        if (loadedCount >= nextLogBoundary) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllFetched', { count: loadedCount }) }));
          nextLogBoundary = loadedCount + 500 - (loadedCount % 500);
        }

        // Check if we've reached the end
        if (messages.length < 100) {
          hasMore = false;
        } else {
          lastMessageId = messages[messages.length - 1].id;

          // Calculate random delay between batches
          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);

          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) return stopped();
        }
      }

      // Check if cancelled
      if (signal.aborted) {
        return stopped();
      }

      // Row 165 (pass 3): the closing line counts what is loaded now, not only this run's fetches.
      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.loadAllComplete', { count: (continuing ? existingRows.length : 0) + loadedCount }) }));
      const finalCursor = lastFetchedId ?? (continuing ? lastMessageId : null);
      await persistConversation(api, channelId, {
        complete: true,
        pagination: paginationRecord({ mode: 'all', hasMore: false, lastMessageId: finalCursor }),
      });
      return {
        count: loadedCount,
        hasMore: false,
        lastMessageId: finalCursor,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch all messages'
      );
    }
  }
);

/** Flips the light "Looking up users..." line; only the lookup queue sets it. */
export const setEnriching = createAction<boolean>('message/setEnriching');

/**
 * 2.2.5 fix A: user lookups run one at a time. Before, every Load All page
 * started a new lookup carrying every author so far, each with its own copy
 * of the user map, and they all shared the request pacing with Load All.
 * Now a page only queues the ids it brings that no earlier page asked for
 * (per server and lookup settings), one run works the queue, and a dispatch
 * that arrives while it runs is folded into its next round.
 */
interface LookupJob { guildId: string | null; ids: Set<string> }
const lookupQueue = {
  running: null as Promise<void> | null,
  stopped: false,
  token: '',
  pending: new Map<string, LookupJob>(),
  asked: new Map<string, Set<string>>(),
};

const lookupKey = (guildId: string | null, settings: Record<string, string | undefined>): string =>
  `${guildId ?? 'dm'}|${settings[DiscrubSetting.DISPLAY_NAME_LOOKUP] === 'true'}|${settings[DiscrubSetting.SERVER_NICKNAME_LOOKUP] === 'true'}`;

/** Tests only: forget every queued and asked id. */
export const resetUserLookupQueue = (): void => {
  lookupQueue.running = null;
  lookupQueue.stopped = false;
  lookupQueue.token = '';
  lookupQueue.pending.clear();
  lookupQueue.asked.clear();
};

/**
 * Ends the lookup in flight at its next user and drops what is queued.
 * Resolves when the run has let go. A workspace switch calls it.
 */
export const stopUserLookups = (): Promise<void> => {
  lookupQueue.pending.clear();
  lookupQueue.asked.clear();
  if (!lookupQueue.running) return Promise.resolve();
  lookupQueue.stopped = true;
  return lookupQueue.running;
};

async function runLookupRound(
  job: LookupJob,
  dispatch: (action: unknown) => unknown,
  getState: () => RootState,
): Promise<void> {
  const state = getState();
  const settings = selectSettings(state);
  if (!settings) return;
  const ids = [...job.ids];
  const result = await userEnrichmentService.enrichUserIds(
    ids,
    job.guildId,
    lookupQueue.token,
    settings,
    state.cache.userMap,
    undefined,
    undefined,
    state.cache.failedUserIds,
    async () => lookupQueue.stopped,
  );

  if (result.failedUserIds && result.failedUserIds.length > 0) {
    result.failedUserIds.forEach((id) => dispatch(addFailedUserId(id)));
    await (dispatch(saveCacheToLocalStorage()) as unknown as { unwrap: () => Promise<unknown> }).unwrap();
  }

  // The service hands back the whole map; only the asked ids can have changed.
  const changed: Record<string, (typeof result.userMap)[string]> = {};
  for (const id of ids) {
    const entry = result.userMap[id];
    if (entry) changed[id] = entry;
  }
  if (Object.keys(changed).length > 0) {
    await (dispatch(mergeCachedUserMap(changed)) as unknown as { unwrap: () => Promise<unknown> }).unwrap();
  }
}

async function runLookups(dispatch: (action: unknown) => unknown, getState: () => RootState): Promise<void> {
  dispatch(setEnriching(true));
  try {
    while (!lookupQueue.stopped) {
      const next = lookupQueue.pending.entries().next();
      if (next.done) break;
      const [key, job] = next.value;
      lookupQueue.pending.delete(key);
      try {
        await runLookupRound(job, dispatch, getState);
      } catch (error) {
        // A failed round forgets its ids so a later page can ask again.
        console.error('Failed to enrich user data:', error);
        const asked = lookupQueue.asked.get(key);
        if (asked) for (const id of job.ids) asked.delete(id);
      }
    }
  } finally {
    if (lookupQueue.stopped) lookupQueue.pending.clear();
    lookupQueue.stopped = false;
    lookupQueue.running = null;
    dispatch(setEnriching(false));
  }
}

/**
 * Queues user lookups (display names and server nicknames, per settings)
 * for the given ids. Ids already asked for this server, and ids that came
 * back 404 before, are left out. Returns once the ids are queued; the run
 * itself goes on in the background.
 */
export const enrichMessageUsers = createAsyncThunk(
  'message/enrichMessageUsers',
  async (
    {
      userIds,
      guildId,
      token,
    }: {
      /** Authors and mentioned users of newly loaded rows. */
      userIds: string[];
      guildId: string | null;
      token: string;
    },
    { getState, dispatch }
  ): Promise<{ queued: number }> => {
    const state = getState() as RootState;
    const settings = selectSettings(state);
    if (!settings || lookupQueue.stopped) return { queued: 0 };

    const key = lookupKey(guildId, settings);
    const asked = lookupQueue.asked.get(key) ?? new Set<string>();
    lookupQueue.asked.set(key, asked);
    const failed = new Set(state.cache.failedUserIds);
    const job = lookupQueue.pending.get(key) ?? { guildId, ids: new Set<string>() };
    let queued = 0;
    for (const id of userIds) {
      if (!id || asked.has(id) || failed.has(id)) continue;
      asked.add(id);
      job.ids.add(id);
      queued++;
    }
    if (queued === 0) return { queued };
    lookupQueue.pending.set(key, job);
    lookupQueue.token = token;

    if (!lookupQueue.running) {
      lookupQueue.running = runLookups(dispatch, getState as () => RootState);
    }
    return { queued };
  }
);

/**
 * Open a thread tab — creates tab state and fetches first 100 messages
 */
export const openThreadTab = createAsyncThunk(
  'message/openThreadTab',
  async (
    {
      threadId,
      threadName,
      token,
    }: {
      threadId: string;
      threadName: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;

      // If tab already exists, just switch to it
      if (state.message.threadTabs[threadId]) {
        dispatch(messageSlice.actions.setActiveTab(threadId));
        return { threadId, alreadyOpen: true };
      }

      // Create the tab (sets loading=true, switches activeTab)
      dispatch(messageSlice.actions.addThreadTab({ threadId, threadName }));
      const api = { dispatch, getState: getState as () => RootState };
      const parentCid = state.channel?.selectedChannel?.id ?? state.dm?.selectedDm?.id ?? null;

      // 2.2.5: a thread with saved rows comes back from disk.
      const restored = await restoreConversationOrSearch(api, threadId);
      if (restored) {
        // A plain record's criteria are not a search (fix C); the sort comes
        // back with the record like the main conversation's does (row 11).
        const isSearch = restored.conversation.pagination.mode === 'search';
        dispatch(messageSlice.actions.setThreadSearchCriteria({ threadId, criteria: isSearch ? restored.conversation.searchCriteria : null }));
        dispatch(messageSlice.actions.setThreadOrder({ threadId, order: restored.conversation.order }));
        dispatch(messageSlice.actions.setThreadRestored({ threadId, restored: restoredRowsOf(restored) }));
        await dispatch(setThreadRefineCriteria({ threadId, criteria: restored.conversation.refineCriteria }));
        const p = restored.conversation.pagination;
        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: {
            mode: p.mode,
            hasMore: p.hasMore,
            lastMessageId: p.lastMessageId ?? restored.rows[0]?.id ?? null,
            totalCount: p.totalCount,
            searchOffset: p.searchOffset,
          },
        }));
        dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
        dispatch(addStatusEntry({ level: 'info', message: t('status.msg.restoredFromWorkspace', { count: restored.rows.length }) }));
        if (parentCid) await persistThreadTabs(api, parentCid, getState() as RootState);
        return { threadId, alreadyOpen: false };
      }

      // Fetch first page — threads are channels in Discord's API
      const discordService = getDiscordService();
      const response = await discordService.fetchMessageData(token, '', threadId);

      if (!response.success || !response.data) {
        // Remove the failed tab so user returns to main channel
        dispatch(messageSlice.actions.removeThreadTab(threadId));
        return rejectWithValue('Failed to fetch thread messages');
      }

      const messages = response.data as Message[];
      dispatch(messageSlice.actions.setThreadMessages({ threadId, messages }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          hasMore: messages.length === 100,
          lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
          mode: 'paginated',
        },
      }));
      dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.threadLoaded', { count: messages.length }) }));

      // 2.2.5: opening a thread is a write trigger (plan section 4.2).
      await persistPage(api, threadId, messages, {
        seed: threadSeedFromState(getState() as RootState, threadId),
        record: { pagination: paginationRecord({ mode: 'paginated', hasMore: messages.length === 100, lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : null }) },
      });
      if (parentCid) await persistThreadTabs(api, parentCid, getState() as RootState);

      return { threadId, alreadyOpen: false };
    } catch (error) {
      // Remove the failed tab so user returns to main channel
      dispatch(messageSlice.actions.removeThreadTab(threadId));
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch thread messages'
      );
    }
  }
);

/**
 * Deep-link to a message ID in the currently-visible feed (backlog #123,
 * Phase 1). We check `filteredMessages` — the set actually rendered —
 * rather than the raw `messages[]`, so a refine-hidden message doesn't
 * "succeed" the find only to silently fail at scroll-time. If the
 * target isn't visible we surface a toast (more visible than a
 * status-panel entry). Lazy fetch-around for unloaded targets is Phase
 * 2; cross-channel jumps are Phase 3.
 */
export const navigateToMessage = createAsyncThunk(
  'message/navigateToMessage',
  async (
    { messageId }: { messageId: string },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    const activeTab = state.message.activeTab;
    const pool = activeTab
      ? state.message.threadTabs[activeTab]?.filteredRows ?? []
      : state.message.filteredRows;

    const found = pool.some((r) => r.id === messageId);
    if (!found) {
      dispatch(showToast({
        level: 'info',
        message: t('status.msg.notInView'),
        duration: 4000,
      }));
      return { found: false };
    }

    dispatch(messageSlice.actions.setHighlightedMessageId(messageId));
    return { found: true };
  },
);

/**
 * Apply a single-user filter (#129 inline filter-by-user). Reads the
 * active context (main channel or active thread tab), merges the new
 * userId/mentionId into the existing searchCriteria, and dispatches
 * the appropriate search thunk. Other filter fields (date, content,
 * has-types, pinned, authorType) are preserved — only the userIds
 * (mode='author') or mentionIds (mode='mentions') slot is replaced.
 */
export const applyUserFilter = createAsyncThunk(
  'message/applyUserFilter',
  async (
    {
      userId,
      displayName,
      mode,
    }: { userId: string; displayName: string; mode: 'author' | 'mentions' },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    const token = (state as any).auth?.token as string | undefined;
    if (!token) return { skipped: 'no-token' as const };

    const fallback: SearchCriteria = {
      searchAfterDate: null,
      searchBeforeDate: null,
      searchMessageContents: [],
      selectedHasTypes: [],
      userIds: [],
      mentionIds: [],
      channelIds: [],
      isPinned: IsPinnedType.UNSET,
      authorType: null,
    };

    const activeTab = state.message.activeTab;
    const baseCriteria: SearchCriteria = activeTab
      ? state.message.threadTabs[activeTab]?.searchCriteria ?? fallback
      : state.message.searchCriteria ?? fallback;

    const newCriteria: SearchCriteria = mode === 'author'
      ? { ...baseCriteria, userIds: [userId] }
      : { ...baseCriteria, mentionIds: [userId] };

    if (activeTab) {
      await dispatch(searchThreadMessages({
        threadId: activeTab,
        token,
        searchCriteria: newCriteria,
      }));
    } else {
      const channelId = (state as any).channel?.selectedChannel?.id
        ?? (state as any).dm?.selectedDm?.id;
      const guildId = (state as any).guild?.selectedGuild?.id;
      if (!channelId) return { skipped: 'no-channel' as const };
      await dispatch(searchMessages({
        guildId,
        channelId,
        token,
        searchCriteria: newCriteria,
      }));
    }

    dispatch(showToast({
      level: 'info',
      message: t('status.msg.showingMessages', { name: displayName, context: mode === 'author' ? 'author' : 'mentions' }),
      duration: 3000,
    }));

    return { applied: true as const, mode };
  },
);

/**
 * Fetch more messages for a thread tab (infinite scroll)
 */
export const fetchMoreThreadMessages = createAsyncThunk(
  'message/fetchMoreThreadMessages',
  async (
    {
      threadId,
      token,
      lastMessageId,
    }: {
      threadId: string;
      token: string;
      lastMessageId: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: { isLoadingMore: true },
      }));

      const discordService = getDiscordService();
      const response = await discordService.fetchMessageData(token, lastMessageId, threadId);

      if (!response.success || !response.data) {
        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: { isLoadingMore: false },
        }));
        return rejectWithValue('Failed to fetch more thread messages');
      }

      const newMessages = response.data as Message[];
      const state = getState() as RootState;
      const tab = state.message.threadTabs[threadId];
      if (!tab) return rejectWithValue('Thread tab no longer exists');

      const threadHasMore = newMessages.length === 100;
      const threadCursor = newMessages.length > 0 ? newMessages[newMessages.length - 1].id : lastMessageId;

      await persistPage({ dispatch, getState: getState as () => RootState }, threadId, newMessages, {
        seed: threadSeedFromState(state, threadId),
        backfill: cachedRowsOf(threadId, tab.rows),
        record: { pagination: paginationRecord({ mode: 'paginated', hasMore: threadHasMore, lastMessageId: threadCursor }) },
      });

      // #263: same end-merge as appendLoadAllPage, no full re-sort per page.
      dispatch(messageSlice.actions.appendThreadMessages({ threadId, messages: newMessages }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          isLoadingMore: false,
          hasMore: threadHasMore,
          lastMessageId: threadCursor,
        },
      }));

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadedMore', { count: newMessages.length }) }));

      return { threadId, count: newMessages.length };
    } catch (error) {
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: { isLoadingMore: false },
      }));
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch more thread messages'
      );
    }
  }
);

/**
 * Fetch all messages from a thread (bulk load)
 */
export const fetchAllThreadMessages = createAsyncThunk(
  'message/fetchAllThreadMessages',
  async (
    {
      threadId,
      token,
    }: {
      threadId: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue, signal }
  ) => {
    try {
      dispatch(showOperationTip(t('operation.queued.loadAll')));
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllStarting') }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          isLoadingAll: true,
          mode: 'all',
          loadAllCancelled: false,
          loadAllFailed: null,
          loadAllSignInExpired: false,
          loadAllProgress: { current: 0, total: 0, message: t('status.msg.startingLoadAll') },
        },
      }));

      const discordService = getDiscordService();
      const state = getState() as RootState;
      const searchDelay = selectSearchDelay(state);
      const delayModifier = selectDelayModifier(state);

      // 2.2.5: continue from the thread's loaded pages (see fetchAllMessages).
      const startTab = state.message.threadTabs[threadId];
      const existingRows = startTab?.rows ?? [];
      const existing = cachedRowsOf(threadId, existingRows);
      const continuing = !!startTab && startTab.pagination.mode !== 'search' && existingRows.length > 0 && !!startTab.pagination.lastMessageId;
      const api = { dispatch, getState: getState as () => RootState };
      const seed = threadSeedFromState(state, threadId);

      // 2.2.5 fix B: a count and the oldest fetched id, not every message.
      // Each page goes to the tab as it arrives, like the channel walk, so a
      // long thread no longer holds its pages until the end.
      let loadedCount = 0;
      let lastFetchedId: string | null = null;
      let lastMsgId = continuing ? (startTab.pagination.lastMessageId as string) : '';
      let hasMore = continuing ? startTab.pagination.hasMore : true;
      // 500-step cadence (not the shared adaptive helper) — same rationale
      // as the channel direct-history walk: avoid spamming the status log
      // on multi-thousand-message threads.
      let nextLogBoundary = 500;

      // 2.2.5 WP4a: a stop keeps the pages already fetched (they are on
      // disk) and leaves the walk resumable instead of marking it complete.
      const stopped = () => {
        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: {
            isLoadingAll: false,
            loadAllProgress: null,
            loadAllCancelled: true,
            ...(lastFetchedId ? { lastMessageId: lastFetchedId, hasMore: true } : {}),
          },
        }));
        return rejectWithValue('Load cancelled');
      };

      while (hasMore && !signal.aborted) {
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) return stopped();

        // Retry transient failures (#245, same contract as the channel
        // Load All above). On exhaustion, pause so the user can fix their
        // network and Resume from the same lastMsgId.
        const response = await withTransientRetry(
          () => discordService.fetchMessageData(token, lastMsgId, threadId),
          {
            getState: getState as () => RootState,
            dispatch,
            signal,
            onRetry: (attempt, delayMs, last, max) => {
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.msg.loadAllRetry', { answer: describeAnswer(last), seconds: Math.round(delayMs / 1000), attempt, max }),
              }));
            },
          },
        );

        if (!response.success || !response.data) {
          if (isTransientApiFailure(response) && !signal.aborted && !checkCancelled(getState as () => RootState)) {
            dispatch(setDiscrubPaused(true));
            dispatch(setOperationHold({ kind: 'retryExhausted', answer: describeAnswer(response), loaded: loadedCount }));
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.msg.loadAllPaused', { answer: describeAnswer(response), count: loadedCount }),
            }));
            continue;
          }
          const failure = describeFailure(response, 'fetchAllThreadFailed');
          dispatch(messageSlice.actions.updateThreadPagination({
            threadId,
            pagination: { isLoadingAll: false, loadAllProgress: null, loadAllFailed: failure, loadAllSignInExpired: isSignInExpired(response) },
          }));
          return rejectWithValue(failure);
        }

        const messages = response.data as Message[];
        loadedCount += messages.length;
        if (messages.length > 0) lastFetchedId = messages[messages.length - 1].id;

        const outcome = await persistPage(api, threadId, messages, {
          seed,
          backfill: existing,
          loaded: existingRows.length + loadedCount,
          record: { pagination: paginationRecord({ mode: 'all', hasMore: messages.length >= 100, lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : lastMsgId }) },
        });
        if (outcome === 'cancelled') return stopped();

        // A walk from the top replaces what the tab showed with its first
        // page; every later page, and every page of a continued walk, merges in.
        if (messages.length > 0 && (getState() as RootState).message.threadTabs[threadId]) {
          if (!continuing && loadedCount === messages.length) dispatch(messageSlice.actions.setThreadMessages({ threadId, messages }));
          else dispatch(messageSlice.actions.appendThreadMessages({ threadId, messages }));
        }

        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: {
            loadAllProgress: {
              current: loadedCount,
              total: 0,
              message: t('status.msg.loadedProgress', { count: loadedCount }),
            },
          },
        }));

        if (loadedCount >= nextLogBoundary) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllFetched', { count: loadedCount }) }));
          nextLogBoundary = loadedCount + 500 - (loadedCount % 500);
        }

        if (messages.length < 100) {
          hasMore = false;
        } else {
          lastMsgId = messages[messages.length - 1].id;

          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) return stopped();
        }
      }

      if (signal.aborted) return stopped();

      const tab = (getState() as RootState).message.threadTabs[threadId];
      if (!tab) return rejectWithValue('Thread tab no longer exists');

      // When continuing, the pages already in the tab stay and the new ones
      // merge in behind them.
      const threadFinalCursor = lastFetchedId ?? (continuing ? lastMsgId : null);
      // An empty thread walked from the top ends with an empty tab.
      if (!continuing && loadedCount === 0) dispatch(messageSlice.actions.setThreadMessages({ threadId, messages: [] }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          isLoadingAll: false,
          loadAllProgress: null,
          hasMore: false,
          lastMessageId: threadFinalCursor,
        },
      }));
      // Row 165 (pass 3): the closing line counts what is loaded now, not only this run's fetches.
      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.loadAllComplete', { count: (continuing ? existingRows.length : 0) + loadedCount }) }));
      await persistConversation(api, threadId, {
        complete: true,
        pagination: paginationRecord({ mode: 'all', hasMore: false, lastMessageId: threadFinalCursor }),
      });
      return { threadId, count: loadedCount };
    } catch (error) {
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: { isLoadingAll: false, loadAllProgress: null },
      }));
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch all thread messages'
      );
    }
  }
);

/**
 * Search messages in a thread using Discord Search API
 */
export const searchThreadMessages = createAsyncThunk(
  'message/searchThreadMessages',
  async (
    {
      threadId,
      token,
      searchCriteria,
    }: {
      threadId: string;
      token: string;
      searchCriteria: SearchCriteria;
    },
    { dispatch, getState, rejectWithValue, signal }
  ) => {
    try {
      dispatch(showOperationTip(t('operation.queued.search')));
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.searchStarting') }));
      dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: true }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          mode: 'search',
          loadAllProgress: { current: 0, total: 0, message: t('status.msg.searchingMessages') },
        },
      }));

      const discordService = getDiscordService();
      const state = getState() as RootState;
      const searchDelay = selectSearchDelay(state);
      const delayModifier = selectDelayModifier(state);

      // 2.2.5 fix C: a thread search writes the thread's search set; the
      // thread's plain rows stay.
      const api = { dispatch, getState: getState as () => RootState };
      const threadSeed = threadSeedFromState(state, threadId);
      await dropSavedSearch(api, threadId);

      // 2.2.5 fix B: counts, not arrays; each page goes to the tab as it
      // arrives (the first replaces what the tab showed before the search).
      let totalCount = 0;
      let currentCriteria = { ...searchCriteria };
      let shouldContinue = true;
      let milestoneBoundary = nextMilestone(0);

      // Reaction enrichment status cadence — see loadAllSearchResults (#178).
      let reactionTotal = 0;
      let reactionMilestone = nextMilestone(0);
      let reactionAnnounced = false;
      const emitReactionStatus = (count: number) => {
        reactionTotal += count;
        if (!reactionAnnounced) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchFetchingReactions', { count }),
          }));
          reactionAnnounced = true;
          reactionMilestone = nextMilestone(reactionTotal);
          return;
        }
        if (reactionTotal >= reactionMilestone) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchEnrichedSoFar', { count: reactionTotal }),
          }));
          reactionMilestone = nextMilestone(reactionTotal);
        }
      };

      // #194: parallel milestone ladder for reply parent enrichment.
      let replyTotal = 0;
      let replyMilestone = nextMilestone(0);
      let replyAnnounced = false;
      const emitReplyStatus = (count: number) => {
        replyTotal += count;
        if (!replyAnnounced) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchResolvingReplies', { count }),
          }));
          replyAnnounced = true;
          replyMilestone = nextMilestone(replyTotal);
          return;
        }
        if (replyTotal >= replyMilestone) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.msg.searchResolvedSoFar', { count: replyTotal }),
          }));
          replyMilestone = nextMilestone(replyTotal);
        }
      };

      while (shouldContinue && !signal.aborted) {
        let batchCount = 0;
        let batchLast: Message | null = null;
        let offset = 0;
        const maxPerBatch = 5000;

        while (batchCount < maxPerBatch && !signal.aborted) {
          await waitWhilePaused(getState as () => RootState);
          if (checkCancelled(getState as () => RootState)) {
            shouldContinue = false;
            break;
          }

          // Threads are channels — search by channelId. #262: the same
          // 202 wait + transient retry as the initial channel search, and
          // the failure line carries what Discord answered.
          const response = await fetchSearchPageWithRetry(
            () => discordService.fetchSearchMessageData(
              token,
              offset,
              threadId,
              null,
              currentCriteria
            ),
            { ...searchPageRetryHooks(dispatch, getState as () => RootState), signal },
          );

          if (!response.success || !response.data) {
            dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
            dispatch(messageSlice.actions.updateThreadPagination({
              threadId,
              pagination: { loadAllProgress: null },
            }));
            if (signal.aborted || checkCancelled(getState as () => RootState)) {
              return rejectWithValue('Search cancelled');
            }
            return rejectWithValue(describeSearchFailure(response, 'thread'));
          }

          const searchResult = response.data;
          const rawMessages = searchResult.messages
            ? searchResult.messages.flatMap((group) => group)
            : [];

          // #216 parity with the channel search: an empty first page while
          // Discord is still building the index is not "no matches".
          if (offset === 0 && totalCount === 0
            && searchResult.doing_deep_historical_index && rawMessages.length === 0) {
            dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.stillIndexing') }));
          }

          if (rawMessages.length === 0) {
            shouldContinue = false;
            break;
          }

          // Pass 1 reaction enrichment (#163) — see searchMessages thunk.
          const settings = selectSettings(getState() as RootState);
          const reactionEnriched = await reactionEnrichmentService.enrichMessages(
            rawMessages,
            token,
            settings,
            {
              shouldStop: async () => {
                await waitWhilePaused(getState as () => RootState);
                return checkCancelled(getState as () => RootState);
              },
              onWillEnrich: emitReactionStatus,
            },
          );
          // Pass 2 reply parent enrichment (#194) — see searchMessages thunk.
          const messages = await replyEnrichmentService.enrichMessages(
            reactionEnriched,
            token,
            settings,
            {
              shouldStop: async () => {
                await waitWhilePaused(getState as () => RootState);
                return checkCancelled(getState as () => RootState);
              },
              onWillEnrich: emitReplyStatus,
            },
          );

          if (messages.length > 0 && (getState() as RootState).message.threadTabs[threadId]) {
            if (totalCount + batchCount === 0) dispatch(messageSlice.actions.setThreadMessages({ threadId, messages }));
            else dispatch(messageSlice.actions.appendThreadMessages({ threadId, messages }));
          }
          batchCount += messages.length;
          if (messages.length > 0) batchLast = messages[messages.length - 1];
          const fetched = totalCount + batchCount;
          const total = searchResult.total_results;

          const outcome = await persistPage(api, searchCid(threadId), messages, {
            seed: threadSeed,
            loaded: fetched,
            record: { searchCriteria, pagination: paginationRecord({ mode: 'search', totalCount: total, searchOffset: fetched }) },
          });
          if (outcome === 'cancelled') {
            dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
            dispatch(messageSlice.actions.updateThreadPagination({ threadId, pagination: { loadAllProgress: null } }));
            return rejectWithValue('Search cancelled');
          }

          dispatch(messageSlice.actions.updateThreadPagination({
            threadId,
            pagination: {
              loadAllProgress: {
                current: fetched,
                total,
                message: t('status.msg.searchFetched', { count: fetched, total }),
              },
            },
          }));

          if (fetched >= milestoneBoundary) {
            dispatch(addStatusEntry({ level: 'info', message: t('status.msg.searchFetched', { count: fetched, total }) }));
            milestoneBoundary = nextMilestone(fetched);
          }

          // #264: a short page mid-stream is not the end (#208 parity with
          // the channel path); Discord's search returns spuriously short
          // pages while its index lags. Only an empty page (handled above)
          // or reaching total_results ends the walk, and the offset advances
          // by what actually came back so a short page skips nothing.
          if (batchCount >= searchResult.total_results) {
            break;
          }

          offset += rawMessages.length;

          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) return rejectWithValue('Search cancelled');
        }

        totalCount += batchCount;

        if (batchCount >= maxPerBatch && shouldContinue && batchLast) {
          const lastMessage = batchLast;
          // Tighten searchBeforeDate (max_id) to the oldest seen so the
          // next batch walks further back in time within the user's
          // search window. Matches the lib iterator's cap-shift pattern.
          currentCriteria = {
            ...currentCriteria,
            searchBeforeDate: new Date(lastMessage.timestamp),
          };

          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) return rejectWithValue('Search cancelled');
        } else {
          shouldContinue = false;
        }
      }

      if (signal.aborted) {
        dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: { loadAllProgress: null },
        }));
        return rejectWithValue('Search cancelled');
      }

      const tab = (getState() as RootState).message.threadTabs[threadId];
      if (!tab) return rejectWithValue('Thread tab no longer exists');

      // A search with no matches ends with an empty tab.
      if (totalCount === 0) dispatch(messageSlice.actions.setThreadMessages({ threadId, messages: [] }));
      dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          loadAllProgress: null,
          hasMore: false,
          totalCount: totalCount,
          lastMessageId: null,
        },
      }));

      if (reactionAnnounced) {
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.msg.searchEnrichedTotal', { count: reactionTotal }),
        }));
      }
      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.searchComplete', { count: totalCount }) }));
      // The record write follows the status line so the log never waits on disk.
      await persistConversation(api, searchCid(threadId), {
        complete: true,
        searchCriteria,
        pagination: paginationRecord({ mode: 'search', hasMore: false, totalCount: totalCount, searchOffset: totalCount }),
      });
      return { threadId, count: totalCount };
    } catch (error) {
      dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: { loadAllProgress: null },
      }));
      return rejectWithValue(
        error instanceof Error ? error.message : t('status.msg.searchThreadFailed')
      );
    }
  }
);

/**
 * Start over (2.2.5): drop the rows the workspace keeps for a conversation
 * so the next open and Load All fetch fresh. Redux is cleared by the
 * caller, which then runs the normal open.
 */
export const clearSavedMessages = createAsyncThunk(
  'message/clearSavedMessages',
  async ({ cid }: { cid: string }, { dispatch, getState }) => {
    const outcome = await clearSavedConversation({ dispatch, getState: getState as () => RootState }, cid);
    if (outcome === 'written') {
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.workspaceStartOver') }));
    }
    return { cid, outcome };
  },
);

/**
 * Clearing a search (2.2.5 fix C): the search set and its record go, and
 * the view returns to the conversation's plain rows: restored from disk
 * when the conversation has saved rows, otherwise its first page fresh
 * (plan section 11). Called by the explicit clear controls, never by the
 * per switch criteria reset in ServerView (#226).
 */
export const clearSavedSearch = createAsyncThunk(
  'message/clearSavedSearch',
  async ({ cid }: { cid: string }, { dispatch, getState }) => {
    const api = { dispatch, getState: getState as () => RootState };
    await dropSavedSearch(api, cid);
    const state = getState() as RootState;
    const token = state.auth?.token ?? null;
    if (!token) return { cid };
    if (state.message.threadTabs[cid]) {
      await dispatch(reloadThreadPlain({ threadId: cid, token }));
    } else {
      await dispatch(fetchMessages({ channelId: cid, token }));
    }
    return { cid };
  },
);

/**
 * A thread tab back on its plain rows after a search clear: the saved
 * rows when the thread has them, otherwise its first page.
 */
const reloadThreadPlain = createAsyncThunk(
  'message/reloadThreadPlain',
  async ({ threadId, token }: { threadId: string; token: string }, { dispatch, getState }) => {
    const api = { dispatch, getState: getState as () => RootState };
    dispatch(messageSlice.actions.setThreadSearchCriteria({ threadId, criteria: null }));
    const restored = await restoreConversation(api, threadId);
    if (restored) {
      dispatch(messageSlice.actions.setThreadRestored({ threadId, restored: restoredRowsOf(restored) }));
      // The content part of the tab's refine is a scan of the saved rows.
      const criteria = (getState() as RootState).message.threadTabs[threadId]?.refineCriteria ?? null;
      if (refineNeedsContent(criteria)) await dispatch(setThreadRefineCriteria({ threadId, criteria }));
      const p = restored.conversation.pagination;
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: { mode: p.mode, hasMore: p.hasMore, lastMessageId: p.lastMessageId ?? restored.rows[0]?.id ?? null, totalCount: p.totalCount, searchOffset: p.searchOffset },
      }));
      return;
    }
    const response = await getDiscordService().fetchMessageData(token, '', threadId);
    const messages = response.success && response.data ? (response.data as Message[]) : [];
    dispatch(messageSlice.actions.setThreadMessages({ threadId, messages }));
    dispatch(messageSlice.actions.updateThreadPagination({
      threadId,
      pagination: {
        mode: 'paginated',
        hasMore: messages.length === 100,
        lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
        totalCount: null,
        searchOffset: 0,
      },
    }));
  },
);

/* ─────────────────── Containers (2.2.5 WP2b) ─────────────────── */

type Container = MessageContainer;

/**
 * Helper to get the active message container (thread tab or main state).
 * Returns the draft that holds rows, filteredRows and selectedIds.
 */
const getActiveContainer = (state: MessageState): Container => {
  if (state.activeTab && state.threadTabs[state.activeTab]) {
    return state.threadTabs[state.activeTab];
  }
  return state;
};

/** The message cache key of the active container: 'main' or the thread id. */
export const activeContainerKey = (state: MessageState): string =>
  state.activeTab && state.threadTabs[state.activeTab] ? state.activeTab : MAIN_CONTAINER;

/**
 * #263: the plain (non-draft) array behind a draft field. Iterating an
 * Immer draft array creates a proxy per element touched, so a `filter`,
 * `findIndex`, spread or `map` over a 30K-row draft costs tens of
 * milliseconds before any real work. Reducers below read through this and
 * assign a fresh array instead of mutating the draft in place. Only valid
 * before the field is reassigned in the same reducer (original() is the
 * base value).
 */
const plain = <T,>(arr: T[]): T[] => (isDraft(arr) ? (original(arr) as T[]) : arr);
const plainRecord = <T,>(rec: Record<string, T>): Record<string, T> => (isDraft(rec) ? (original(rec) as Record<string, T>) : rec);

/**
 * 2.2.1 perf: a replaced array handed to immer already frozen. Immer deep
 * freezes every new object a reducer leaves in the draft and skips objects
 * that are frozen already, so freezing the array here saves the walk over
 * 30K elements on every Load All page and every delete flush.
 */
const sealed = <T,>(arr: T[]): T[] => Object.freeze(arr) as T[];

/**
 * F14: resolve the container an operation CAPTURED when it started
 * (null = main, otherwise a thread tab id). The batched reducers take
 * this instead of reading the active tab at flush time, since tab
 * switching is allowed mid-operation (#237). Returns null when the
 * captured thread tab no longer exists.
 */
const resolveCapturedContainer = (state: MessageState, containerId: string | null): Container | null => {
  if (containerId === null) return state;
  return state.threadTabs[containerId] ?? null;
};

const keyOfContainer = (containerId: string | null): string => containerId ?? MAIN_CONTAINER;

const contentSet = (container: Container): ReadonlySet<string> | null =>
  container.contentMatchIds ? new Set(plain(container.contentMatchIds)) : null;

/** Rebuilds `filteredRows` from `rows` under the container's refine. */
const refilter = (container: Container): void => {
  const rows = plain(container.rows);
  const filtered = applyRefineToRows(rows, container.refineCriteria, contentSet(container));
  container.filteredRows = filtered === rows ? rows : sealed(filtered);
};

/**
 * Drops selected ids the refine hides (W4 gate finding). A selection made
 * before a refine otherwise stays whole under it, and Delete would act on
 * messages the user can't see.
 */
const keepSelectionVisible = (container: Container): void => {
  const selected = plain(container.selectedIds);
  if (selected.length === 0 || container.filteredRows === container.rows) return;
  const visible = new Set<string>();
  for (const row of plain(container.filteredRows)) visible.add(row.id);
  const kept = selected.filter((id) => visible.has(id));
  if (kept.length !== selected.length) container.selectedIds = kept;
};

/** The content matches of a page under the container's refine, or null when the refine has no content part. */
const contentMatchesOf = (container: Container, messages: Message[]): string[] | null => {
  const criteria = container.refineCriteria;
  if (!refineNeedsContent(criteria)) return null;
  const out: string[] = [];
  for (const message of messages) if (messageMatchesContentRefine(message, criteria as RefineCriteria)) out.push(message.id);
  return out;
};

const recordAuthors = (state: MessageState, messages: Message[]): void => {
  const held = plainRecord(state.authors);
  const next = mergeAuthors(held, messages);
  if (next !== held) state.authors = next;
};

/* ─────────── User lookups fed per page (2.2.5 W1) ─────────── */

/**
 * The authors and mentioned users of the main conversation's rows since
 * ServerView last asked. Each page adds its own ids here, so the lookup
 * effect no longer walks every row each time the list grows.
 */
const arrivedUserIds = new Set<string>();

const noteArrivedUsers = (key: string, rows: readonly MessageRow[]): void => {
  if (key !== MAIN_CONTAINER) return;
  for (const row of rows) {
    if (row.authorId) arrivedUserIds.add(row.authorId);
    if (row.mentionIds) for (const id of row.mentionIds) arrivedUserIds.add(id);
  }
};

/** The user ids that arrived with main conversation pages since the last call. */
export const takeArrivedUserIds = (): string[] => {
  const ids = [...arrivedUserIds];
  arrivedUserIds.clear();
  return ids;
};

/* ─────────── Rows in and out ─────────── */

/** Ids to their row time, for the row finders. */
const timesOf = (messages: readonly Message[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const m of messages) out.set(m.id, m.timestamp ? new Date(m.timestamp).getTime() : NaN);
  return out;
};

/** Ids to the time of their cached object when there is one. */
const cachedTimesOf = (key: string, ids: Iterable<string>): Map<string, number | undefined> => {
  const out = new Map<string, number | undefined>();
  for (const id of ids) {
    const m = getCachedMessage(key, id);
    out.set(id, m?.timestamp ? new Date(m.timestamp).getTime() : undefined);
  }
  return out;
};

/** `change` applied to some rows of both lists, keeping them one array when no refine is on. */
const changeRows = (
  container: Container,
  changes: ReadonlyMap<string, number | undefined>,
  change: (row: MessageRow) => MessageRow,
): void => {
  const rows = plain(container.rows);
  const filtered = plain(container.filteredRows);
  const nextRows = updateRowsById(rows, changes, change);
  const nextFiltered = filtered === rows ? nextRows : updateRowsById(filtered, changes, change);
  if (nextRows !== rows) container.rows = sealed(nextRows);
  if (nextFiltered !== filtered) container.filteredRows = sealed(nextFiltered);
};

/**
 * A page of messages replaces or joins a container. The objects go to the
 * message cache under the container's key, their authors to the author
 * map, and the rows into `rows` sorted under the container's order.
 *
 * 2.2.5 W1: an appended page costs the page, not the list. Its rows are
 * checked against the list by time (a walk only meets the list at its
 * boundary, and the store's write is the real guard), and only the new
 * rows go through the refine, merged into `filteredRows` at their end.
 */
const ingestPage = (
  state: MessageState,
  container: Container,
  key: string,
  messages: Message[],
  mode: 'replace' | 'append',
): void => {
  cacheMessages(key, messages);
  recordAuthors(state, messages);
  const rows = toMessageRows(messages);
  noteArrivedUsers(key, rows);
  if (mode === 'replace') {
    container.rows = sealed(sortRows(rows, container.order.order));
    container.contentMatchIds = contentMatchesOf(container, messages);
    refilter(container);
    return;
  }
  const existing = plain(container.rows);
  const fresh: MessageRow[] = [];
  const freshIds = new Set<string>();
  for (const row of rows) {
    if (freshIds.has(row.id) || findRowByTime(existing, row.id, row.t) >= 0) continue;
    if (Number.isNaN(row.t) && existing.some((r) => r.id === row.id)) continue;
    freshIds.add(row.id);
    fresh.push(row);
  }
  if (fresh.length === 0) return;
  const order = container.order.order;
  const filtered = plain(container.filteredRows);
  const nextRows = sealed(appendSortedRows(existing, fresh, order));
  container.rows = nextRows;
  const predicate = rowPredicate(container.refineCriteria);
  const pageMatches = contentMatchesOf(container, messages.filter((m) => freshIds.has(m.id)));
  if (!predicate && pageMatches === null) {
    container.filteredRows = nextRows;
    return;
  }
  if (pageMatches !== null) {
    container.contentMatchIds = plain(container.contentMatchIds ?? []).concat(pageMatches);
  }
  if (filtered === existing) {
    // The two lists were one; the refine changed under them. Start over.
    refilter(container);
    return;
  }
  const matched = pageMatches === null ? null : new Set(pageMatches);
  const kept = fresh.filter((r) => (!predicate || predicate(r)) && (!matched || matched.has(r.id)));
  if (kept.length > 0) container.filteredRows = sealed(appendSortedRows(filtered, kept, order));
};

/**
 * A restored conversation replaces a container (2.2.5 W1): rows and
 * authors for every saved message, objects for the newest window only.
 * `contentMatchIds` is the scan's answer when the refine has a content
 * part; a thread tab gets it from its refine thunk right after.
 */
const ingestRestored = (
  state: MessageState,
  container: Container,
  key: string,
  restored: RestoredRows,
  contentMatchIds: string[] | null,
): void => {
  cacheMessages(key, restored.newest);
  const held = plainRecord(state.authors);
  const authors = mergeAuthorMap(held, restored.authors);
  if (authors !== held) state.authors = authors;
  noteArrivedUsers(key, restored.rows);
  container.rows = sealed(sortRows(restored.rows, container.order.order));
  container.contentMatchIds = refineNeedsContent(container.refineCriteria) ? contentMatchIds ?? [] : null;
  refilter(container);
};

const removeRows = (container: Container, key: string, ids: Set<string>): void => {
  const where = cachedTimesOf(key, ids);
  const rows = plain(container.rows);
  const filtered = plain(container.filteredRows);
  const nextRows = removeRowsById(rows, where);
  if (nextRows !== rows) container.rows = sealed(nextRows);
  // With no refine active the two arrays are one, keep it that way.
  const nextFiltered = filtered === rows ? nextRows : removeRowsById(filtered, where);
  if (nextFiltered !== filtered) container.filteredRows = sealed(nextFiltered);
  const selected = plain(container.selectedIds);
  if (selected.length > 0) {
    const kept = selected.filter((id) => !ids.has(id));
    if (kept.length !== selected.length) container.selectedIds = kept;
  }
  if (container.contentMatchIds) container.contentMatchIds = plain(container.contentMatchIds).filter((id) => !ids.has(id));
  dropCachedMessages(key, ids);
};

/** Replaces rows by id (an edit) and the cached objects behind them. */
const replaceRows = (state: MessageState, container: Container, key: string, messages: Message[]): void => {
  if (messages.length === 0) return;
  const byId = new Map(messages.map((m) => [m.id, m]));
  changeRows(container, timesOf(messages), (r) => {
    const m = byId.get(r.id);
    return m ? { ...toMessageRow(m), t: r.t } : r;
  });
  for (const m of messages) replaceCachedMessage(key, m);
  recordAuthors(state, messages);
  // An edit can change what a content refine matches.
  if (refineNeedsContent(container.refineCriteria)) {
    const criteria = container.refineCriteria as RefineCriteria;
    const held = new Set(plain(container.contentMatchIds ?? []));
    for (const m of messages) {
      if (messageMatchesContentRefine(m, criteria)) held.add(m.id); else held.delete(m.id);
    }
    container.contentMatchIds = [...held];
    refilter(container);
  }
};

/**
 * Rewrites the reactions of some messages through `update`, in the cache
 * and on their rows. A message the cache evicted is changed on disk by
 * the persistence middleware, which sends its row back through
 * `reactionRowsSynced`.
 */
const patchReactions = (container: Container, key: string, ids: Iterable<string>, update: ReactionUpdate): void => {
  const changed = new Map<string, Message>();
  for (const id of ids) {
    const next = updateCachedMessage(key, id, update);
    if (next) changed.set(id, next);
  }
  if (changed.size === 0) return;
  changeRows(container, timesOf([...changed.values()]), (r) => {
    const m = changed.get(r.id);
    return m ? rowWithReactions(r, m) : r;
  });
};

/** A selection with one id added or taken out: one copy of the list, no proxy walk. */
const toggledSelection = (base: string[], id: string): string[] => {
  const index = base.indexOf(id);
  const next = base.slice();
  if (index >= 0) next.splice(index, 1);
  else next.push(id);
  return next;
};

/**
 * The ids a reaction action changed and the change itself, or null for any
 * other action (2.2.5 W1). The reducers apply it to the cached objects and
 * the persistence middleware to the stored ones.
 */
export const reactionChangeOf = (action: { type: string; payload?: unknown }): { ids: string[]; update: ReactionUpdate } | null => {
  if (deleteReaction.fulfilled.match(action)) {
    return { ids: [action.payload.messageId], update: removeOneReaction(action.payload.emoji) };
  }
  if (deleteAllReactions.fulfilled.match(action) || bulkDeleteReactionsForEmoji.fulfilled.match(action)) {
    return { ids: [action.payload.messageId], update: removeEmoji(action.payload.emoji) };
  }
  if (bulkDeleteAllReactions.fulfilled.match(action)) {
    return { ids: [action.payload.messageId], update: clearReactions };
  }
  if (batchRemoveReactions.fulfilled.match(action)) {
    const { processedMessageIds, mode, emojis } = action.payload;
    if (processedMessageIds.length === 0) return null;
    return { ids: processedMessageIds, update: batchRemoval(mode, emojis) };
  }
  if (batchAddReactions.fulfilled.match(action)) {
    const { successfulAdds } = action.payload;
    if (!successfulAdds.length) return null;
    const byId = new Map(successfulAdds.map((s) => [s.messageId, s.emojis]));
    return { ids: [...byId.keys()], update: batchAddition(byId) };
  }
  return null;
};

const messageSlice = createSlice({
  name: 'message',
  initialState: initialMessageState,
  reducers: {
    /** Replaces the open conversation with these messages (the first page, a restore, tests). */
    setMessages: (state, action: PayloadAction<Message[]>) => {
      ingestPage(state, state, MAIN_CONTAINER, action.payload, 'replace');
    },
    setSelectedIds: (state, action: PayloadAction<string[]>) => {
      state.selectedIds = action.payload;
    },
    toggleMessageSelection: (state, action: PayloadAction<string>) => {
      // #263: work on the plain array and assign a new one; a splice/push
      // on a 30K draft walks every element through a proxy.
      state.selectedIds = toggledSelection(plain(state.selectedIds), action.payload);
    },
    selectAllMessages: (state) => {
      state.selectedIds = plain(state.filteredRows).map((r) => r.id);
    },
    // #183: batched removal used by the bulk-delete loop. One Set lookup +
    // one filter pass per array for the whole batch. F14: routed by the
    // containerId the operation captured at start, not whichever tab is
    // active when the flush lands.
    messagesRemoved: (state, action: PayloadAction<{ ids: string[]; containerId: string | null }>) => {
      if (action.payload.ids.length === 0) return;
      const container = resolveCapturedContainer(state, action.payload.containerId);
      if (!container) return;
      removeRows(container, keyOfContainer(action.payload.containerId), new Set(action.payload.ids));
    },
    // F13 (#183 follow-up): batched in-place replacement used by the
    // bulk-edit loop, same shape as messagesRemoved.
    messagesEdited: (state, action: PayloadAction<{ messages: Message[]; containerId: string | null }>) => {
      if (action.payload.messages.length === 0) return;
      const container = resolveCapturedContainer(state, action.payload.containerId);
      if (!container) return;
      replaceRows(state, container, keyOfContainer(action.payload.containerId), action.payload.messages);
    },
    deselectAllMessages: (state) => {
      state.selectedIds = [];
    },
    setSearchCriteria: (state, action: PayloadAction<SearchCriteria | null>) => {
      state.searchCriteria = action.payload;
    },
    /**
     * The refine and, when it has a content part, the ids the scan
     * accepted. Dispatched by the `setRefineCriteria` thunk, which runs
     * the scan; a plain row refine can be dispatched here directly.
     */
    refineApplied: (state, action: PayloadAction<{ criteria: RefineCriteria | null; contentMatchIds?: string[] | null }>) => {
      state.refineCriteria = action.payload.criteria;
      state.contentMatchIds = refineNeedsContent(action.payload.criteria) ? action.payload.contentMatchIds ?? [] : null;
      refilter(state);
      keepSelectionVisible(state);
    },
    clearRefineCriteria: (state) => {
      state.refineCriteria = null;
      state.contentMatchIds = null;
      state.filteredRows = state.rows;
    },
    threadRefineApplied: (
      state,
      action: PayloadAction<{ threadId: string; criteria: RefineCriteria | null; contentMatchIds?: string[] | null }>,
    ) => {
      const tab = state.threadTabs?.[action.payload.threadId];
      if (!tab) return;
      tab.refineCriteria = action.payload.criteria;
      tab.contentMatchIds = refineNeedsContent(action.payload.criteria) ? action.payload.contentMatchIds ?? [] : null;
      refilter(tab);
      keepSelectionVisible(tab);
    },
    clearThreadRefineCriteria: (state, action: PayloadAction<string>) => {
      const tab = state.threadTabs?.[action.payload];
      if (!tab) return;
      tab.refineCriteria = null;
      tab.contentMatchIds = null;
      tab.filteredRows = tab.rows;
    },
    setOrder: (state, action: PayloadAction<MessageOrder>) => {
      state.order = action.payload;
      const rows = plain(state.rows);
      const filtered = plain(state.filteredRows);
      if (rows.length > 0) {
        const nextRows = sealed(sortRows(rows, action.payload.order));
        state.rows = nextRows;
        state.filteredRows = filtered === rows ? nextRows : sealed(sortRows(filtered, action.payload.order));
      }
    },
    clearMessages: (state) => {
      state.rows = [];
      state.filteredRows = [];
      state.selectedIds = [];
      state.contentMatchIds = null;
      state.searchCriteria = null;
      // #226: refine must not survive navigation — every data-arrival
      // reducer re-applies state.refineCriteria to incoming pages, so a
      // lingering refine would silently hide messages in the next
      // channel/DM the user opens.
      state.refineCriteria = null;
      // Signal criteria-mirroring UI (ServerView's chip ref) even when the
      // selected conversation id doesn't change (#226 re-click path).
      state.clearSeq += 1;
      // Reset pagination state and cancel any ongoing operations
      state.pagination = initialMessageState.pagination;
      state.isLoading = false;
      state.isDeleting = false;
      state.error = null;
      for (const threadId of Object.keys(state.threadTabs ?? {})) evictContainer(threadId);
      state.activeTab = null;
      state.threadTabs = {};
      state.restored = null;
      state.authors = {};
      arrivedUserIds.clear();
      evictContainer(MAIN_CONTAINER);
    },
    resetPagination: (state) => {
      state.pagination = initialMessageState.pagination;
    },
    updateLoadAllProgress: (
      state,
      action: PayloadAction<{ current: number; total: number; message: string }>
    ) => {
      state.pagination.loadAllProgress = action.payload;
    },
    // #181: per-page live append during Load All. Appends new messages,
    // dedupes against existing, merges under the active order, and
    // refreshes the filtered view. Used by loadAllSearchResults +
    // fetchAllMessages so the table grows while the iterator is still
    // walking pages.
    appendLoadAllPage: (
      state,
      action: PayloadAction<{ messages: Message[]; totalCount?: number; searchOffset?: number }>
    ) => {
      const { messages: pageMessages, totalCount, searchOffset } = action.payload;
      if (pageMessages.length > 0) ingestPage(state, state, MAIN_CONTAINER, pageMessages, 'append');
      if (totalCount !== undefined) state.pagination.totalCount = totalCount;
      if (searchOffset !== undefined) state.pagination.searchOffset = searchOffset;
    },
    /** 2.2.5 WP4a: a stopped Load All leaves the cursor at the last page it kept. */
    setLoadAllCursor: (state, action: PayloadAction<{ lastMessageId: string; hasMore: boolean }>) => {
      state.pagination.lastMessageId = action.payload.lastMessageId;
      state.pagination.hasMore = action.payload.hasMore;
    },
    cancelLoadAll: (state) => {
      state.pagination.isLoadingAll = false;
      state.pagination.loadAllProgress = null;
      // #193: mark the run as user-cancelled so the rejected handler
      // (which fires shortly after when the in-flight thunk detects
      // cancellation) knows to route the resulting payload to the
      // soft-callout state instead of state.error.
      state.pagination.loadAllCancelled = true;
    },
    /** Row 50: the Load All under way is about to fail on a 401; the callout offers Sign in again. */
    markLoadAllSignInExpired: (state) => {
      state.pagination.loadAllSignInExpired = true;
    },
    dismissLoadAllCancelled: (state) => {
      // #193: lets the user close the "stopped at N" soft callout in
      // ServerView without starting a new load. Idempotent. Also closes
      // the failed callout (row 49), on the open thread tab when there is one.
      const tab = state.activeTab ? state.threadTabs[state.activeTab] : undefined;
      const pagination = tab ? tab.pagination : state.pagination;
      pagination.loadAllCancelled = false;
      pagination.loadAllFailed = null;
      pagination.loadAllSignInExpired = false;
    },
    // Thread tab management
    setActiveTab: (state, action: PayloadAction<string | null>) => {
      state.activeTab = action.payload;
    },
    addThreadTab: (
      state,
      action: PayloadAction<{ threadId: string; threadName: string }>
    ) => {
      const { threadId, threadName } = action.payload;
      if (!state.threadTabs) state.threadTabs = {};
      if (!state.threadTabs[threadId]) {
        state.threadTabs[threadId] = {
          threadId,
          threadName,
          rows: [],
          filteredRows: [],
          selectedIds: [],
          contentMatchIds: null,
          searchCriteria: null,
          refineCriteria: null,
          order: { ...state.order },
          isLoading: true,
          error: null,
          pagination: { ...initialPaginationState },
        };
      }
      state.activeTab = threadId;
    },
    removeThreadTab: (state, action: PayloadAction<string>) => {
      const threadId = action.payload;
      if (!state.threadTabs) return;
      delete state.threadTabs[threadId];
      evictContainer(threadId);
      if (state.activeTab === threadId) {
        state.activeTab = null;
      }
    },
    // Thread-tab-aware reducers
    /** Replaces a thread tab's messages (first page, restore, a full search). */
    setThreadMessages: (
      state,
      action: PayloadAction<{ threadId: string; messages: Message[] }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) ingestPage(state, tab, action.payload.threadId, action.payload.messages, 'replace');
    },
    /** Merges a page into a thread tab (#263 end merge, no full re-sort). */
    appendThreadMessages: (
      state,
      action: PayloadAction<{ threadId: string; messages: Message[] }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) ingestPage(state, tab, action.payload.threadId, action.payload.messages, 'append');
    },
    /** A thread tab restored from the workspace store (2.2.5 W1). */
    setThreadRestored: (
      state,
      action: PayloadAction<{ threadId: string; restored: RestoredRows }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) ingestRestored(state, tab, action.payload.threadId, action.payload.restored, null);
    },
    /**
     * 2.2.5 W1: the reaction fields of rows whose messages the middleware
     * changed on disk. Covers the messages the cache had evicted, which
     * the reducer could not change; the rest are already current.
     */
    reactionRowsSynced: (
      state,
      action: PayloadAction<{ containerId: string | null; messages: Message[] }>
    ) => {
      const container = resolveCapturedContainer(state, action.payload.containerId);
      if (!container || action.payload.messages.length === 0) return;
      const byId = new Map(action.payload.messages.map((m) => [m.id, m]));
      changeRows(container, timesOf(action.payload.messages), (r) => {
        const m = byId.get(r.id);
        return m ? rowWithReactions(r, m) : r;
      });
    },
    toggleThreadMessageSelection: (
      state,
      action: PayloadAction<{ threadId: string; messageId: string }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) tab.selectedIds = toggledSelection(plain(tab.selectedIds), action.payload.messageId);
    },
    selectAllThreadMessages: (state, action: PayloadAction<string>) => {
      const tab = state.threadTabs[action.payload];
      if (tab) tab.selectedIds = plain(tab.filteredRows).map((r) => r.id);
    },
    deselectAllThreadMessages: (state, action: PayloadAction<string>) => {
      const tab = state.threadTabs[action.payload];
      if (tab) tab.selectedIds = [];
    },
    // #220: drag-select writes the whole selection per pointer move —
    // thread-tab counterpart of setSelectedIds.
    setThreadSelectedIds: (
      state,
      action: PayloadAction<{ threadId: string; ids: string[] }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) tab.selectedIds = action.payload.ids;
    },
    setThreadOrder: (
      state,
      action: PayloadAction<{ threadId: string; order: MessageOrder }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.order = action.payload.order;
        const rows = plain(tab.rows);
        const filtered = plain(tab.filteredRows);
        if (rows.length > 0) {
          const nextRows = sealed(sortRows(rows, action.payload.order.order));
          tab.rows = nextRows;
          tab.filteredRows = filtered === rows ? nextRows : sealed(sortRows(filtered, action.payload.order.order));
        }
      }
    },
    setThreadSearchCriteria: (
      state,
      action: PayloadAction<{ threadId: string; criteria: SearchCriteria | null }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.searchCriteria = action.payload.criteria;
      }
    },
    setThreadLoading: (
      state,
      action: PayloadAction<{ threadId: string; isLoading: boolean }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.isLoading = action.payload.isLoading;
      }
    },
    setThreadError: (
      state,
      action: PayloadAction<{ threadId: string; error: string | null }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.error = action.payload.error;
      }
    },
    updateThreadPagination: (
      state,
      action: PayloadAction<{
        threadId: string;
        pagination: Partial<ThreadTabState['pagination']>;
      }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        Object.assign(tab.pagination, action.payload.pagination);
      }
    },
    setHighlightedMessageId: (state, action: PayloadAction<string | null>) => {
      state.highlightedMessageId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch messages (initial load)
      .addCase(fetchMessages.pending, (state) => {
        state.isLoading = true;
        state.error = null;
        state.pagination.mode = 'paginated';
      })
      .addCase(fetchMessages.fulfilled, (state, action) => {
        state.isLoading = false;
        state.error = null;
        const restored = action.payload.restored;
        if (restored) {
          // 2.2.5: the conversation came back from the workspace store with
          // its criteria, sort, selection and cursor (plan section 5.4).
          state.order = restored.order;
          // Only a search set's record carries a live search (fix C).
          state.searchCriteria = restored.pagination.mode === 'search' ? restored.searchCriteria : null;
          state.refineCriteria = restored.refineCriteria;
          const restoredRows = action.payload.restoredRows as RestoredRows;
          ingestRestored(state, state, MAIN_CONTAINER, restoredRows, action.payload.contentMatchIds);
          const rows = plain(state.rows);
          // 2.2.5 W1: one Set over the rows, and only when something was selected.
          const saved = restoredRows.selectedIds;
          if (saved.length > 0) {
            const known = new Set(rows.map((r) => r.id));
            state.selectedIds = saved.filter((id) => known.has(id));
          } else {
            state.selectedIds = [];
          }
          state.pagination.mode = restored.pagination.mode;
          state.pagination.lastMessageId = action.payload.lastMessageId;
          state.pagination.hasMore = action.payload.hasMore;
          state.pagination.totalCount = restored.pagination.totalCount;
          state.pagination.searchOffset = restored.pagination.searchOffset;
          state.pagination.isLoadingMore = false;
          // The restore reads oldest first, so the oldest is its first row.
          const oldestTimestamp = restoredRows.rows[0]?.timestamp ?? null;
          state.restored = { count: rows.length, oldestTimestamp };
          return;
        }
        const settings = action.payload.settings;
        if (settings) {
          // Set before the ingest so the first page comes in sorted and refined.
          state.order = settings.order;
          state.refineCriteria = settings.refineCriteria;
        }
        ingestPage(state, state, MAIN_CONTAINER, action.payload.messages, 'replace');
        state.selectedIds = [];
        state.restored = null;

        // Update pagination state
        state.pagination.lastMessageId = action.payload.lastMessageId;
        state.pagination.hasMore = action.payload.hasMore;
        state.pagination.totalCount = null;
        state.pagination.isLoadingMore = false;
      })
      .addCase(fetchMessages.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        // Row 97: nothing loaded, so there is nothing more to load. This
        // hides More available, Load All and Resume for that channel.
        state.pagination.hasMore = false;
      })
      // Fetch more messages (infinite scroll)
      .addCase(fetchMoreMessages.pending, (state) => {
        state.pagination.isLoadingMore = true;
        state.error = null;
      })
      .addCase(fetchMoreMessages.fulfilled, (state, action) => {
        state.pagination.isLoadingMore = false;
        // Append new messages (don't replace); the refine is re-applied so
        // newly-loaded pages stay filtered as the user scrolls.
        ingestPage(state, state, MAIN_CONTAINER, action.payload.messages, 'append');
        state.pagination.lastMessageId = action.payload.lastMessageId;
        state.pagination.hasMore = action.payload.hasMore;
      })
      .addCase(fetchMoreMessages.rejected, (state, action) => {
        state.pagination.isLoadingMore = false;
        state.error = action.payload as string;
      })
      // Delete single message
      .addCase(deleteMessage.fulfilled, (state, action) => {
        removeRows(getActiveContainer(state), activeContainerKey(state), new Set([action.payload]));
      })
      // Delete multiple messages
      .addCase(deleteMessages.pending, (state) => {
        state.isDeleting = true;
      })
      .addCase(deleteMessages.fulfilled, (state) => {
        state.isDeleting = false;
        getActiveContainer(state).selectedIds = [];
      })
      .addCase(deleteMessages.rejected, (state, action) => {
        state.isDeleting = false;
        state.error = action.payload as string;
      })
      // Edit message
      .addCase(editMessage.pending, (state) => {
        state.isEditing = true;
      })
      .addCase(editMessage.fulfilled, (state, action) => {
        state.isEditing = false;
        replaceRows(state, getActiveContainer(state), activeContainerKey(state), [action.payload]);
      })
      .addCase(editMessage.rejected, (state, action) => {
        state.isEditing = false;
        state.error = action.payload as string;
      })
      // Fetch all messages (bulk load)
      .addCase(fetchAllMessages.pending, (state) => {
        state.pagination.isLoadingAll = true;
        state.pagination.loadAllCancelled = false; // #193: clear stale cancel state on a new attempt
        state.pagination.loadAllFailed = null;
        state.pagination.loadAllSignInExpired = false;
        state.pagination.loadAllProgress = {
          current: 0,
          total: 0,
          message: t('status.msg.startingLoadAll'),
        };
        state.pagination.mode = 'all';
        state.error = null;
      })
      .addCase(fetchAllMessages.fulfilled, (state, action) => {
        // Messages were appended live via appendLoadAllPage (#181); just
        // finalize flags. Pages were merged in order, so the rows are sorted.
        state.pagination.isLoadingAll = false;
        state.pagination.loadAllProgress = null;
        state.selectedIds = [];
        state.pagination.lastMessageId = action.payload.lastMessageId;
        state.pagination.hasMore = false;
        state.error = null;
      })
      .addCase(fetchAllMessages.rejected, (state, action) => {
        state.pagination.isLoadingAll = false;
        state.pagination.loadAllProgress = null;
        // #193: the in-flight thunk emits the cancel sentinel via
        // rejectWithValue when the user-driven cancel flag is detected
        // mid-poll. Route that payload to the soft-callout state instead
        // of state.error.
        const payload = action.payload as string | undefined;
        if (payload === 'Load all cancelled' || payload === 'Load cancelled') {
          state.pagination.loadAllCancelled = true;
          return;
        }
        // Row 49: the rows stay; the failure shows in the callout, not in place of the feed.
        state.pagination.loadAllFailed = payload ?? action.error.message ?? null;
      })
      // Bulk edit messages (F13: row updates land via the batched
      // messagesEdited flushes during the run)
      .addCase(editMessages.pending, (state) => {
        state.isEditing = true;
      })
      .addCase(editMessages.fulfilled, (state) => {
        state.isEditing = false;
        getActiveContainer(state).selectedIds = [];
      })
      .addCase(editMessages.rejected, (state, action) => {
        state.isEditing = false;
        state.error = action.payload as string;
      })
      // #215 multi-channel bulk edit — hold isEditing for the whole run.
      .addCase(bulkEditChannels.pending, (state) => {
        state.isEditing = true;
      })
      .addCase(bulkEditChannels.fulfilled, (state) => {
        state.isEditing = false;
      })
      .addCase(bulkEditChannels.rejected, (state, action) => {
        state.isEditing = false;
        state.error = action.payload as string;
      })
      // Search messages (Discord Search API)
      .addCase(searchMessages.pending, (state) => {
        state.isLoading = true;
        state.pagination.mode = 'search';
        state.pagination.loadAllProgress = null;
        state.error = null;
      })
      .addCase(searchMessages.fulfilled, (state, action) => {
        state.isLoading = false;
        state.pagination.loadAllProgress = null;
        ingestPage(state, state, MAIN_CONTAINER, action.payload.messages, 'replace');
        state.selectedIds = [];
        state.pagination.totalCount = action.payload.totalResults;
        state.pagination.hasMore = action.payload.hasMore;
        state.pagination.searchOffset = action.payload.nextOffset;
        state.pagination.lastMessageId = null;
        state.searchCriteria = action.payload.searchCriteria;
        // A fresh search is not the restored conversation (fix C, row 45).
        state.restored = null;
        state.error = null;
      })
      .addCase(searchMessages.rejected, (state, action) => {
        state.isLoading = false;
        state.pagination.loadAllProgress = null;
        state.error = action.payload as string;
      })
      .addCase(fetchNextSearchPage.pending, (state) => {
        state.pagination.isLoadingMore = true;
      })
      .addCase(fetchNextSearchPage.fulfilled, (state, action) => {
        state.pagination.isLoadingMore = false;
        ingestPage(state, state, MAIN_CONTAINER, action.payload.messages, 'append');
        state.pagination.totalCount = action.payload.totalResults;
        state.pagination.hasMore = action.payload.hasMore;
        state.pagination.searchOffset = action.payload.newOffset;
      })
      .addCase(fetchNextSearchPage.rejected, (state) => {
        state.pagination.isLoadingMore = false;
      })
      .addCase(loadAllSearchResults.pending, (state) => {
        state.pagination.isLoadingAll = true;
        state.pagination.loadAllCancelled = false; // #193: clear stale cancel state on a new attempt
        state.pagination.loadAllFailed = null;
        state.pagination.loadAllSignInExpired = false;
        state.pagination.loadAllProgress = {
          current: state.rows.length,
          total: state.pagination.totalCount ?? 0,
          message: t('status.msg.loadingAllSearchResults'),
        };
      })
      .addCase(loadAllSearchResults.fulfilled, (state, action) => {
        // Messages were appended live via appendLoadAllPage (#181); just
        // finalize flags.
        state.pagination.isLoadingAll = false;
        state.pagination.loadAllProgress = null;
        state.pagination.totalCount = action.payload.totalResults;
        state.pagination.hasMore = false;
        state.pagination.searchOffset = state.rows.length;
      })
      .addCase(loadAllSearchResults.rejected, (state, action) => {
        state.pagination.isLoadingAll = false;
        state.pagination.loadAllProgress = null;
        // #193: see fetchAllMessages.rejected comment — symmetric handling.
        const payload = action.payload as string | undefined;
        if (payload === 'Load all cancelled' || payload === 'Load cancelled') {
          state.pagination.loadAllCancelled = true;
          return;
        }
        // Row 49: the rows stay; the failure shows in the callout, not in place of the feed.
        state.pagination.loadAllFailed = payload ?? action.error.message ?? null;
      })
      // Reaction changes (2.2.5 W1: one update per action, shared with the
      // persistence middleware through reactionChangeOf).
      .addCase(deleteReaction.fulfilled, (state, action) => {
        const change = reactionChangeOf(action);
        if (change) patchReactions(getActiveContainer(state), activeContainerKey(state), change.ids, change.update);
      })
      .addCase(deleteAllReactions.fulfilled, (state, action) => {
        const change = reactionChangeOf(action);
        if (change) patchReactions(getActiveContainer(state), activeContainerKey(state), change.ids, change.update);
      })
      // Bulk delete all reactions from a message (MANAGE_MESSAGES)
      .addCase(bulkDeleteAllReactions.fulfilled, (state, action) => {
        const change = reactionChangeOf(action);
        if (change) patchReactions(getActiveContainer(state), activeContainerKey(state), change.ids, change.update);
      })
      // Bulk delete all reactions for a specific emoji (MANAGE_MESSAGES)
      .addCase(bulkDeleteReactionsForEmoji.fulfilled, (state, action) => {
        const change = reactionChangeOf(action);
        if (change) patchReactions(getActiveContainer(state), activeContainerKey(state), change.ids, change.update);
      })
      // Batch remove reactions across multiple messages
      .addCase(batchRemoveReactions.pending, (state) => {
        state.isRemovingReactions = true;
      })
      .addCase(batchRemoveReactions.rejected, (state) => {
        state.isRemovingReactions = false;
      })
      .addCase(batchRemoveReactions.fulfilled, (state, action) => {
        state.isRemovingReactions = false;
        const change = reactionChangeOf(action);
        if (change) patchReactions(getActiveContainer(state), activeContainerKey(state), change.ids, change.update);
      })
      // Batch add reactions across multiple messages (Backlog #202)
      .addCase(batchAddReactions.pending, (state) => {
        state.isAddingReactions = true;
      })
      .addCase(batchAddReactions.rejected, (state) => {
        state.isAddingReactions = false;
      })
      .addCase(batchAddReactions.fulfilled, (state, action) => {
        state.isAddingReactions = false;
        // Optimistically merge the added reactions so the feed reflects them without a refetch.
        const change = reactionChangeOf(action);
        if (change) patchReactions(getActiveContainer(state), activeContainerKey(state), change.ids, change.update);
      })
      // Delete single attachment
      .addCase(deleteAttachment.fulfilled, (state, action) => {
        const { messageId, deleted, updatedMessage } = action.payload;
        const container = getActiveContainer(state);
        const key = activeContainerKey(state);
        if (deleted) removeRows(container, key, new Set([messageId]));
        else if (updatedMessage) replaceRows(state, container, key, [updatedMessage]);
      })
      // Delete all attachments
      .addCase(deleteAllAttachments.fulfilled, (state, action) => {
        const { messageId, deleted, updatedMessage } = action.payload;
        const container = getActiveContainer(state);
        const key = activeContainerKey(state);
        if (deleted) removeRows(container, key, new Set([messageId]));
        else if (updatedMessage) replaceRows(state, container, key, [updatedMessage]);
      })
      // User enrichment (light operation — spinner only)
      .addCase(setEnriching, (state, action) => {
        state.isEnriching = action.payload;
      });
  },
});

export const {
  setMessages,
  setSelectedIds,
  toggleMessageSelection,
  selectAllMessages,
  deselectAllMessages,
  messagesRemoved,
  messagesEdited,
  setSearchCriteria,
  refineApplied,
  clearRefineCriteria,
  threadRefineApplied,
  clearThreadRefineCriteria,
  setOrder,
  clearMessages,
  resetPagination,
  updateLoadAllProgress,
  appendLoadAllPage,
  cancelLoadAll,
  dismissLoadAllCancelled,
  setActiveTab,
  addThreadTab,
  removeThreadTab,
  setThreadMessages,
  appendThreadMessages,
  setThreadRestored,
  reactionRowsSynced,
  toggleThreadMessageSelection,
  selectAllThreadMessages,
  deselectAllThreadMessages,
  setThreadSelectedIds,
  setThreadOrder,
  setThreadSearchCriteria,
  setThreadLoading,
  setThreadError,
  updateThreadPagination,
  setHighlightedMessageId,
} = messageSlice.actions;

/* ─────────────────── Refine (2.2.5 WP2b) ─────────────────── */

/**
 * The ids a content or attachment name refine accepts, from a scan of
 * the conversation's message objects: the workspace store when it holds
 * the conversation, the message cache otherwise (tests, a store failure).
 */
async function scanContentMatches(
  getState: () => RootState,
  dispatch: (action: unknown) => unknown,
  containerKey: string,
  cid: string | null,
  criteria: RefineCriteria,
): Promise<string[]> {
  const state = getState();
  const wid = selectCurrentWid(state);
  const predicate = (message: Message) => messageMatchesContentRefine(message, criteria);
  if (wid && cid) {
    try {
      const total = await countRows(wid, cid);
      if (total > 0) {
        if (total >= SCAN_NOTICE_ROWS) dispatch(addStatusEntry({ level: 'info', message: t('status.msg.scanningMessages', { count: total }) }));
        const result = await scan(wid, cid, predicate);
        return result.ids;
      }
    } catch (error) {
      console.error('[workspace] content scan failed, using the cache', error);
    }
  }
  return cachedMessagesOf(containerKey).filter(predicate).map((m) => m.id);
}

/** Rows a status line is worth above. */
const SCAN_NOTICE_ROWS = 5000;

const mainCidOf = (state: RootState): string | null =>
  state.channel?.selectedChannel?.id ?? state.dm?.selectedDm?.id ?? null;

/**
 * Applies a refine to the open conversation. A refine on row fields is
 * applied at once; one with a content or attachment name part scans the
 * message objects first (plan section 11).
 */
export const setRefineCriteria = createAsyncThunk(
  'message/setRefineCriteria',
  async (criteria: RefineCriteria | null, { dispatch, getState }) => {
    if (!refineNeedsContent(criteria)) {
      dispatch(messageSlice.actions.refineApplied({ criteria }));
      return;
    }
    const contentMatchIds = await scanContentMatches(
      getState as () => RootState, dispatch, MAIN_CONTAINER, containerDiskCid(getState() as RootState, null), criteria as RefineCriteria,
    );
    dispatch(messageSlice.actions.refineApplied({ criteria, contentMatchIds }));
  },
);

export const setThreadRefineCriteria = createAsyncThunk(
  'message/setThreadRefineCriteria',
  async ({ threadId, criteria }: { threadId: string; criteria: RefineCriteria | null }, { dispatch, getState }) => {
    if (!refineNeedsContent(criteria)) {
      dispatch(messageSlice.actions.threadRefineApplied({ threadId, criteria }));
      return;
    }
    const contentMatchIds = await scanContentMatches(getState as () => RootState, dispatch, threadId, containerDiskCid(getState() as RootState, threadId), criteria as RefineCriteria);
    dispatch(messageSlice.actions.threadRefineApplied({ threadId, criteria, contentMatchIds }));
  },
);

/* ─────────────────── Selectors ─────────────────── */

// Base selectors (always return main channel state)
export const selectMessage = (state: RootState) => state.message;
export const selectRows = (state: RootState) => state.message.rows;
export const selectClearSeq = (state: RootState) => state.message.clearSeq;
/** 2.2.5: non-null when the open conversation was restored from the workspace store. */
export const selectRestored = (state: RootState) => state.message.restored ?? null;
export const selectHighlightedMessageId = (state: RootState) =>
  state.message.highlightedMessageId;
export const selectFilteredRows = (state: RootState) => state.message.filteredRows;
export const selectSelectedIds = (state: RootState) => state.message.selectedIds;
/** The authors of every loaded message, keyed by user id (2.2.5 WP2b). */
const NO_AUTHORS: Record<string, User> = Object.freeze({});
export const selectAuthors = (state: RootState) => state.message.authors ?? NO_AUTHORS;
export const selectSearchCriteria = (state: RootState) => state.message.searchCriteria;
export const selectMessageOrder = (state: RootState) => state.message.order;
export const selectMessageLoading = (state: RootState) => state.message.isLoading;
export const selectMessageDeleting = (state: RootState) => state.message.isDeleting;
export const selectMessageEditing = (state: RootState) => state.message.isEditing;
export const selectMessageError = (state: RootState) => state.message.error;
export const selectPagination = (state: RootState) => state.message.pagination;

// Thread tab selectors
export const selectActiveTab = (state: RootState) => state.message.activeTab;
export const selectThreadTabs = (state: RootState) => state.message.threadTabs ?? {};
export const selectThreadTab = (state: RootState, threadId: string) =>
  state.message.threadTabs[threadId] ?? null;

// Active-tab-aware selectors (return data from whichever tab is active)
export const selectActiveRows = (state: RootState) => {
  const { activeTab, threadTabs, rows } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].rows;
  }
  return rows;
};

// #190 Phase 3: a Reselect createSelector so this stays ref-stable on the
// MessageFeed hot path, where a new reference on every dispatch would force
// the whole feed to re-render.
export const selectActiveFilteredRows = createSelector(
  [
    (state: RootState) => state.message.activeTab,
    (state: RootState) => state.message.threadTabs,
    (state: RootState) => state.message.filteredRows,
  ],
  (activeTab, threadTabs, filteredRows) => {
    if (activeTab && threadTabs[activeTab]) {
      return threadTabs[activeTab].filteredRows;
    }
    return filteredRows;
  },
);

export const selectActiveSelectedIds = (state: RootState) => {
  const { activeTab, threadTabs, selectedIds } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].selectedIds;
  }
  return selectedIds;
};

/** The message cache key of the active container: 'main' or the thread id. */
export const selectActiveContainerKey = (state: RootState): string => activeContainerKey(state.message);

/**
 * Where the active container's objects live in the workspace store: the
 * thread id, or the open channel or DM.
 */
export const selectActiveCid = (state: RootState): string | null => {
  const { activeTab, threadTabs } = state.message;
  return containerDiskCid(state, activeTab && threadTabs[activeTab] ? activeTab : null);
};

/**
 * 2.2.5 fix C: the store key a container reads and writes. A container
 * showing a search uses its search set; otherwise the thread id, or the
 * open channel or DM for the main container (null).
 */
export const containerDiskCid = (state: RootState, containerId: string | null): string | null => {
  if (containerId !== null) {
    const tab = state.message.threadTabs[containerId];
    return tab?.pagination.mode === 'search' ? searchCid(containerId) : containerId;
  }
  const main = mainCidOf(state);
  return main && state.message.pagination.mode === 'search' ? searchCid(main) : main;
};

/** What hydration needs: the open workspace and the active conversation id. */
export const selectActiveHydrationSource = createSelector(
  [selectCurrentWid, selectActiveCid],
  (wid, cid): HydrationSource => ({ wid, cid }),
);

export const selectActiveSearchCriteria = (state: RootState) => {
  const { activeTab, threadTabs, searchCriteria } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].searchCriteria;
  }
  return searchCriteria;
};

export const selectActiveOrder = (state: RootState) => {
  const { activeTab, threadTabs, order } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].order;
  }
  return order;
};

export const selectActiveLoading = (state: RootState) => {
  const { activeTab, threadTabs, isLoading } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].isLoading;
  }
  return isLoading;
};

export const selectActiveError = (state: RootState) => {
  const { activeTab, threadTabs, error } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].error;
  }
  return error;
};

export const selectActivePagination = (state: RootState) => {
  const { activeTab, threadTabs, pagination } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].pagination;
  }
  return pagination;
};

// #193: thread-aware accessor for the cancelled-load-all flag. ServerView
// reads this to render the soft callout in the correct container (main
// channel vs active thread tab).
export const selectActiveLoadAllCancelled = (state: RootState): boolean => {
  const { activeTab, threadTabs, pagination } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].pagination.loadAllCancelled;
  }
  return pagination.loadAllCancelled;
};

/** Row 49: why the open container's last Load All failed, or null. */
export const selectActiveLoadAllFailed = (state: RootState): string | null => {
  const { activeTab, threadTabs, pagination } = state.message;
  if (activeTab && threadTabs[activeTab]) return threadTabs[activeTab].pagination.loadAllFailed ?? null;
  return pagination.loadAllFailed ?? null;
};

/** Row 50: the open container's last Load All failed on an expired sign in. */
export const selectActiveLoadAllSignInExpired = (state: RootState): boolean => {
  const { activeTab, threadTabs, pagination } = state.message;
  if (activeTab && threadTabs[activeTab]) return threadTabs[activeTab].pagination.loadAllSignInExpired === true;
  return pagination.loadAllSignInExpired === true;
};

export default messageSlice.reducer;
