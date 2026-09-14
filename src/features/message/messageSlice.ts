import { createSlice, createAsyncThunk, createSelector, isDraft, original, PayloadAction } from '@reduxjs/toolkit';
import type { Message, Attachment, User, Channel } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { getSortedMessages } from 'discrub-core/discrub-utils';
import { appendSortedPage } from './messageOrdering';
import { ReactionType, IsPinnedType } from 'discrub-core/discord-enum';
import { MessageOrder, initialMessageState, initialPaginationState, ThreadTabState } from './messageTypes';
import { getDiscordService } from '@services/discordService';
import type { RootState } from '@/app/store';
import { selectSearchDelay, selectDeleteDelay, selectDelayModifier, selectSettings, selectDiscrubPaused, setDiscrubPaused, setOperationHold } from '@features/app/appSlice';
import { calculateRandomDelay } from '@/utils/delayUtils';
import { userEnrichmentService } from '@services/userEnrichmentService';
import { reactionEnrichmentService } from '@services/reactionEnrichmentService';
import { replyEnrichmentService } from '@services/replyEnrichmentService';
import { mergeCachedUserMap, addFailedUserId, saveCacheToLocalStorage } from '@features/cache/cacheSlice';
import { waitWhilePaused, checkCancelled, cancellableDelay, withTransientRetry, isTransientApiFailure, transientRetryDelayMs, retryBaseDelayMs, describeAnswer, describeFailure } from '@/utils/operationLoopUtils';
import { addStatusEntry, showOperationTip, showToast } from '@features/status/statusSlice';
import { getEmojiKey } from '@/utils/emojiUtils';
import { applyRefineCriteria, criteriaIsActive, type RefineCriteria } from './messageFiltering';
import { nextMilestone, iterateSearchMessagesRedux } from '@utils/searchPagination';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { countActiveFilters } from 'discrub-core/filtering';
import { t } from '@/i18n';
import { fetchSearchPageWithRetry, describeSearchFailure } from './searchPageRetry';
import { notePackageDeletions } from '@features/package/packageDeletedCache';

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
      message: t('status.msg.searchIndexingWait', { seconds: Math.round(delayMs / 1000), attempt }),
    }));
  },
  onRetry: (attempt: number, delayMs: number) => {
    dispatch(addStatusEntry({
      level: 'warning',
      message: t('status.msg.searchRetry', { seconds: Math.round(delayMs / 1000), attempt }),
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
 * reported "page unresponsive" freeze. 25 keeps the table visibly draining
 * (a flush every few seconds at typical delete delays) while cutting the
 * O(N) re-renders by 25x.
 */
export const DELETE_BATCH_SIZE = 25;

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
      messages: Message[];
      channelId: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      dispatch(showOperationTip('Delete Operation Queued'));
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
    { rejectWithValue }
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
        return rejectWithValue(withHttpStatus('Failed to edit message', response.status));
      }

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
      messages: Message[];
      channelId: string;
      content: string;
      token: string;
    },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      dispatch(showOperationTip('Edit Operation Queued'));
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
export const bulkEditChannels = createAsyncThunk<
  { edited: number; skipped: number; failed: number },
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
    dispatch(showOperationTip('Edit Operation Queued'));

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
                  stats.failed++;
                  console.error(`Bulk edit: failed to edit ${message.id} (HTTP ${response.status ?? 'unknown'})`);
                }
              } catch (error) {
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
      return { processedMessageIds: messages.slice(0, processed).map((m) => m.id), mode, emojis };
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
      const freshMessage = state.message.messages.find((m) => m.id === message.id) || message;
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
    { rejectWithValue, dispatch }
  ) => {
    try {
      const discordService = getDiscordService();

      // Fetch first page (most recent 100)
      const response = await discordService.fetchMessageData(
        token,
        '', // Empty lastId for initial load
        channelId
      );

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch messages');
      }

      const messages = response.data as Message[];

      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loaded', { count: messages.length }) }));

      return {
        messages,
        hasMore: messages.length === 100, // If we got 100, there might be more
        lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch messages'
      );
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
      maybeEmitPhantomLoadStatus(
        dispatch,
        (getState() as RootState).message.refineCriteria,
        messages,
      );

      return {
        messages,
        hasMore: messages.length === 100,
        lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : lastMessageId,
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
      dispatch(showOperationTip('Search Operation Queued'));
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

    const aggregated: Message[] = [...initial.message.messages];
    const seenIds = new Set(aggregated.map((m) => m.id));
    let milestoneBoundary = nextMilestone(aggregated.length);

    // #221: freeze the grand total used for the "X of Y matches loaded
    // (Z remaining)" header + status-log denominators. The lib iterator
    // cap-shifts max_id every page (#188/#208), so Discord returns
    // total_results for the SHRINKING [min_id, max_id] window — it counts
    // DOWN as we walk newest→oldest. Using each page's total made "loaded"
    // overtake "total" (e.g. "5250 of 188") and "remaining" go negative.
    // Anchor to the initial search's full-window total and never let it drop
    // below what we've actually loaded.
    let grandTotal = initial.message.pagination.totalCount ?? aggregated.length;

    // #208: pagination is delegated to the lib's iterateSearchResults, which
    // walks newest→oldest by tightening searchBeforeDate to the oldest message
    // seen (always-cap-shift, the #188 fix this read path never got). Seed the
    // resume frontier from the oldest message the initial search already
    // loaded so we don't refetch the top — and so a transient-failure restart
    // resumes from progress rather than from scratch.
    let resumeBeforeDate: Date | undefined;
    for (const m of aggregated) {
      if (m.timestamp) {
        const t = new Date(m.timestamp);
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
                  message: t('status.msg.searchLoadAllRetry', { answer: lastAnswer, seconds: Math.round(delayMs / 1000), attempt: transientRetries }),
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
              dispatch(setOperationHold({ kind: 'retryExhausted', answer: lastAnswer, loaded: aggregated.length }));
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.msg.searchLoadAllPaused', { answer: lastAnswer, count: aggregated.length }),
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
              message: t('status.msg.searchLoadAllStopped', { count: aggregated.length, total: pageResult.totalResults }),
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

          aggregated.push(...page);

          // #221: defensive — never show fewer total than we've loaded, even
          // if Discord under-reported total_results for the first window.
          grandTotal = Math.max(grandTotal, aggregated.length);

          // #181: append live so the table grows as Load All walks pages.
          // The reducer dedupes + re-sorts under the active order.
          dispatch(
            messageSlice.actions.appendLoadAllPage({
              messages: page,
              totalCount: grandTotal,
              searchOffset: aggregated.length,
            })
          );

          dispatch(
            updateLoadAllProgress({
              current: aggregated.length,
              total: grandTotal,
              message: t('status.msg.searchFetched', { count: aggregated.length, total: grandTotal }),
            })
          );

          if (aggregated.length >= milestoneBoundary) {
            dispatch(
              addStatusEntry({
                level: 'info',
                message: t('status.msg.searchFetched', { count: aggregated.length, total: grandTotal }),
              })
            );
            milestoneBoundary = nextMilestone(aggregated.length);
          }
        }
      }

      if (signal.aborted) {
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
            ? `Loaded ${aggregated.length} filtered message${aggregated.length === 1 ? '' : 's'}`
            : `Loaded ${aggregated.length} message${aggregated.length === 1 ? '' : 's'}`,
        })
      );

      return {
        messages: aggregated,
        totalResults: aggregated.length,
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
      dispatch(showOperationTip('Load All Operation Queued'));
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllStarting') }));
      const discordService = getDiscordService();

      // Get delay settings once at start
      const state = getState() as RootState;
      const searchDelay = selectSearchDelay(state);
      const delayModifier = selectDelayModifier(state);

      let allMessages: Message[] = [];
      let lastMessageId = '';
      let hasMore = true;
      // 500-step cadence (not the shared adaptive helper) — direct-history
      // walks of busy channels can fetch tens of thousands of messages, and
      // a finer cadence would flood the status log.
      let nextLogBoundary = 500;

      while (hasMore && !signal.aborted) {
        // Check pause/cancel
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) break;

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
            onRetry: (attempt, delayMs, last) => {
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.msg.loadAllRetry', { answer: describeAnswer(last), seconds: Math.round(delayMs / 1000), attempt }),
              }));
            },
          },
        );

        if (!response.success || !response.data) {
          if (isTransientApiFailure(response)) {
            dispatch(setDiscrubPaused(true));
            dispatch(setOperationHold({ kind: 'retryExhausted', answer: describeAnswer(response), loaded: allMessages.length }));
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.msg.loadAllPaused', { answer: describeAnswer(response), count: allMessages.length }),
            }));
            continue;
          }
          return rejectWithValue(describeFailure(response, 'fetchAllFailed'));
        }

        const messages = response.data as Message[];
        allMessages = [...allMessages, ...messages];

        // #181: live append so the table grows during the operation.
        dispatch(messageSlice.actions.appendLoadAllPage({ messages }));

        // Update progress
        dispatch(
          updateLoadAllProgress({
            current: allMessages.length,
            total: 0, // Unknown until we reach the end
            message: t('status.msg.loadedProgress', { count: allMessages.length }),
          })
        );

        if (allMessages.length >= nextLogBoundary) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllFetched', { count: allMessages.length }) }));
          nextLogBoundary = allMessages.length + 500 - (allMessages.length % 500);
        }

        // Check if we've reached the end
        if (messages.length < 100) {
          hasMore = false;
        } else {
          lastMessageId = messages[messages.length - 1].id;

          // Calculate random delay between batches
          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);

          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) return rejectWithValue('Load cancelled');
        }
      }

      // Check if cancelled
      if (signal.aborted) {
        return rejectWithValue('Load cancelled');
      }

      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.loadAllComplete', { count: allMessages.length }) }));
      return {
        messages: allMessages,
        hasMore: false,
        lastMessageId: allMessages.length > 0 ? allMessages[allMessages.length - 1].id : null,
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch all messages'
      );
    }
  }
);

/**
 * Enrich user data for messages
 * Fetches display names and server nicknames based on settings
 */
export const enrichMessageUsers = createAsyncThunk(
  'message/enrichMessageUsers',
  async (
    {
      messages,
      guildId,
      token,
    }: {
      messages: Message[];
      guildId: string | null;
      token: string;
    },
    { getState, dispatch, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;
      const settings = selectSettings(state);
      const existingUserMap = state.cache.userMap;
      const failedUserIds = state.cache.failedUserIds;

      if (!settings) {
        return rejectWithValue('Settings not available');
      }

      // Enrich user data (skip users that previously returned 404)
      const result = await userEnrichmentService.enrichMessages(
        messages,
        guildId,
        token,
        settings,
        existingUserMap,
        undefined,
        undefined,
        failedUserIds
      );

      // Cache newly failed user IDs (404 only) so they're skipped in future runs
      if (result.failedUserIds && result.failedUserIds.length > 0) {
        result.failedUserIds.forEach((id) => dispatch(addFailedUserId(id)));
        // Persist to storage so failed IDs survive page refreshes
        await dispatch(saveCacheToLocalStorage()).unwrap();
      }

      // Merge enriched data into cache
      const enrichedUserMap = result.userMap;
      await dispatch(mergeCachedUserMap(enrichedUserMap)).unwrap();

      return enrichedUserMap;
    } catch (error) {
      console.error('Failed to enrich user data:', error);
      // Don't reject - enrichment failures shouldn't block message display
      return {};
    }
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

      // Fetch first page — threads are channels in Discord's API
      const discordService = getDiscordService();
      const response = await discordService.fetchMessageData(token, '', threadId);

      if (!response.success || !response.data) {
        // Remove the failed tab so user returns to main channel
        dispatch(messageSlice.actions.removeThreadTab(threadId));
        return rejectWithValue('Failed to fetch thread messages');
      }

      const messages = response.data as Message[];
      const sorted = getSortedMessages(
        messages,
        (getState() as RootState).message.threadTabs[threadId]?.order.order ?? 'desc'
      );

      dispatch(messageSlice.actions.setThreadMessages({ threadId, messages: sorted }));
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
      ? state.message.threadTabs[activeTab]?.filteredMessages ?? []
      : state.message.filteredMessages;

    const found = pool.some((m) => m.id === messageId);
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

      // #263: same end-merge as appendLoadAllPage, no full re-sort per page.
      const sorted = appendSortedPage(tab.messages, newMessages, tab.order.order);

      dispatch(messageSlice.actions.setThreadMessages({ threadId, messages: sorted }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          isLoadingMore: false,
          hasMore: newMessages.length === 100,
          lastMessageId: newMessages.length > 0 ? newMessages[newMessages.length - 1].id : lastMessageId,
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
      dispatch(showOperationTip('Load All Operation Queued'));
      dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllStarting') }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          isLoadingAll: true,
          mode: 'all',
          loadAllProgress: { current: 0, total: 0, message: t('status.msg.startingLoadAll') },
        },
      }));

      const discordService = getDiscordService();
      const state = getState() as RootState;
      const searchDelay = selectSearchDelay(state);
      const delayModifier = selectDelayModifier(state);

      let allMessages: Message[] = [];
      let lastMsgId = '';
      let hasMore = true;
      // 500-step cadence (not the shared adaptive helper) — same rationale
      // as the channel direct-history walk: avoid spamming the status log
      // on multi-thousand-message threads.
      let nextLogBoundary = 500;

      while (hasMore && !signal.aborted) {
        await waitWhilePaused(getState as () => RootState);
        if (checkCancelled(getState as () => RootState)) break;

        // Retry transient failures (#245, same contract as the channel
        // Load All above). On exhaustion, pause so the user can fix their
        // network and Resume from the same lastMsgId.
        const response = await withTransientRetry(
          () => discordService.fetchMessageData(token, lastMsgId, threadId),
          {
            getState: getState as () => RootState,
            dispatch,
            signal,
            onRetry: (attempt, delayMs, last) => {
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.msg.loadAllRetry', { answer: describeAnswer(last), seconds: Math.round(delayMs / 1000), attempt }),
              }));
            },
          },
        );

        if (!response.success || !response.data) {
          if (isTransientApiFailure(response) && !signal.aborted && !checkCancelled(getState as () => RootState)) {
            dispatch(setDiscrubPaused(true));
            dispatch(setOperationHold({ kind: 'retryExhausted', answer: describeAnswer(response), loaded: allMessages.length }));
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.msg.loadAllPaused', { answer: describeAnswer(response), count: allMessages.length }),
            }));
            continue;
          }
          dispatch(messageSlice.actions.updateThreadPagination({
            threadId,
            pagination: { isLoadingAll: false, loadAllProgress: null },
          }));
          return rejectWithValue(describeFailure(response, 'fetchAllThreadFailed'));
        }

        const messages = response.data as Message[];
        allMessages = [...allMessages, ...messages];

        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: {
            loadAllProgress: {
              current: allMessages.length,
              total: 0,
              message: t('status.msg.loadedProgress', { count: allMessages.length }),
            },
          },
        }));

        if (allMessages.length >= nextLogBoundary) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.msg.loadAllFetched', { count: allMessages.length }) }));
          nextLogBoundary = allMessages.length + 500 - (allMessages.length % 500);
        }

        if (messages.length < 100) {
          hasMore = false;
        } else {
          lastMsgId = messages[messages.length - 1].id;

          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) break;
        }
      }

      if (signal.aborted) {
        dispatch(messageSlice.actions.updateThreadPagination({
          threadId,
          pagination: { isLoadingAll: false, loadAllProgress: null },
        }));
        return rejectWithValue('Load cancelled');
      }

      const tab = (getState() as RootState).message.threadTabs[threadId];
      if (!tab) return rejectWithValue('Thread tab no longer exists');

      const sorted = getSortedMessages(allMessages, tab.order.order);
      dispatch(messageSlice.actions.setThreadMessages({ threadId, messages: sorted }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          isLoadingAll: false,
          loadAllProgress: null,
          hasMore: false,
          lastMessageId: allMessages.length > 0 ? allMessages[allMessages.length - 1].id : null,
        },
      }));

      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.loadAllComplete', { count: allMessages.length }) }));
      return { threadId, count: allMessages.length };
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
      dispatch(showOperationTip('Search Operation Queued'));
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

      let allMessages: Message[] = [];
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
        let batchMessages: Message[] = [];
        let offset = 0;
        const maxPerBatch = 5000;

        while (batchMessages.length < maxPerBatch && !signal.aborted) {
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
          if (offset === 0 && allMessages.length === 0
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

          batchMessages = [...batchMessages, ...messages];
          const fetched = allMessages.length + batchMessages.length;
          const total = searchResult.total_results;

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
          if (batchMessages.length >= searchResult.total_results) {
            break;
          }

          offset += rawMessages.length;

          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState as () => RootState);
          if (wasCancelled) return rejectWithValue('Search cancelled');
        }

        allMessages = [...allMessages, ...batchMessages];

        if (batchMessages.length >= maxPerBatch && shouldContinue) {
          const lastMessage = batchMessages[batchMessages.length - 1];
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

      const sorted = getSortedMessages(allMessages, tab.order.order);
      dispatch(messageSlice.actions.setThreadMessages({ threadId, messages: sorted }));
      dispatch(messageSlice.actions.setThreadLoading({ threadId, isLoading: false }));
      dispatch(messageSlice.actions.updateThreadPagination({
        threadId,
        pagination: {
          loadAllProgress: null,
          hasMore: false,
          totalCount: allMessages.length,
          lastMessageId: null,
        },
      }));

      if (reactionAnnounced) {
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.msg.searchEnrichedTotal', { count: reactionTotal }),
        }));
      }
      dispatch(addStatusEntry({ level: 'success', message: t('status.msg.searchComplete', { count: allMessages.length }) }));
      return { threadId, count: allMessages.length };
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
 * Helper to get the active message container (thread tab or main state).
 * Returns an object with messages, filteredMessages, and selectedMessages
 * that can be mutated in place (Immer draft).
 */
const getActiveContainer = (state: import('./messageTypes').MessageState) => {
  if (state.activeTab && state.threadTabs[state.activeTab]) {
    return state.threadTabs[state.activeTab];
  }
  return state;
};

/**
 * F14: resolve the container an operation CAPTURED when it started
 * (null = main arrays, otherwise a thread tab id). The batched
 * reducers take this instead of reading the active tab at flush time —
 * tab switching is deliberately allowed mid-operation (#237 keeps the
 * tab bar interactive), and an active-tab lookup at flush time silently
 * routed a whole batch of confirmed deletions into the wrong
 * container's arrays. Returns null when the captured thread tab no
 * longer exists (nothing left to update).
 */
/**
 * #263: the plain (non-draft) array behind a draft field. Iterating an
 * Immer draft array creates a proxy per element touched, so a `filter`,
 * `findIndex`, spread or `map` over a 30K-message draft costs tens of
 * milliseconds before any real work. Reducers below read through this and
 * assign a fresh array instead of mutating the draft in place. Only valid
 * before the field is reassigned in the same reducer (original() is the
 * base value).
 */
const plain = <T,>(arr: T[]): T[] => (isDraft(arr) ? (original(arr) as T[]) : arr);

const resolveCapturedContainer = (
  state: import('./messageTypes').MessageState,
  containerId: string | null,
) => {
  if (containerId === null) return state;
  return state.threadTabs[containerId] ?? null;
};

const messageSlice = createSlice({
  name: 'message',
  initialState: initialMessageState,
  reducers: {
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.messages = action.payload;
      state.filteredMessages = action.payload;
    },
    setFilteredMessages: (state, action: PayloadAction<Message[]>) => {
      state.filteredMessages = action.payload;
    },
    setSelectedMessages: (state, action: PayloadAction<Message[]>) => {
      state.selectedMessages = action.payload;
    },
    toggleMessageSelection: (state, action: PayloadAction<Message>) => {
      // #263: work on the plain array and assign a new one; a splice/push
      // on a 30K draft walks every element through a proxy.
      const base = plain(state.selectedMessages);
      const index = base.findIndex((msg: Message) => msg.id === action.payload.id);
      state.selectedMessages = index >= 0
        ? base.filter((_, i) => i !== index)
        : [...base, action.payload];
    },
    selectAllMessages: (state) => {
      state.selectedMessages = plain(state.filteredMessages).slice();
    },
    // #183: batched removal used by the bulk-delete loop. One Set lookup +
    // one filter pass per array for the whole batch, instead of a full
    // three-array rewrite per deleted message (the per-message
    // `deleteMessage.fulfilled` path). Final state is identical to applying
    // the same ids one at a time — removal by id is order-independent.
    // F14: routed by the containerId the operation captured at start, not
    // whichever tab is active when the flush lands.
    messagesRemoved: (state, action: PayloadAction<{ ids: string[]; containerId: string | null }>) => {
      if (action.payload.ids.length === 0) return;
      const container = resolveCapturedContainer(state, action.payload.containerId);
      if (!container) return;
      const ids = new Set(action.payload.ids);
      container.messages = plain(container.messages).filter((m) => !ids.has(m.id));
      container.filteredMessages = plain(container.filteredMessages).filter((m) => !ids.has(m.id));
      container.selectedMessages = plain(container.selectedMessages).filter((m) => !ids.has(m.id));
    },
    // F13 (#183 follow-up): batched in-place replacement used by the
    // bulk-edit loop — same shape as messagesRemoved. Pre-fix, bulk edit
    // dispatched the per-message editMessage thunk whose fulfilled
    // reducer rewrote all three arrays per message: the exact freeze
    // class #183 removed for delete, still live for edit.
    messagesEdited: (state, action: PayloadAction<{ messages: Message[]; containerId: string | null }>) => {
      if (action.payload.messages.length === 0) return;
      const container = resolveCapturedContainer(state, action.payload.containerId);
      if (!container) return;
      const byId = new Map(action.payload.messages.map((m) => [m.id, m]));
      const replaceInArray = (arr: Message[]) => plain(arr).map((m) => byId.get(m.id) ?? m);
      container.messages = replaceInArray(container.messages);
      container.filteredMessages = replaceInArray(container.filteredMessages);
      container.selectedMessages = replaceInArray(container.selectedMessages);
    },
    deselectAllMessages: (state) => {
      state.selectedMessages = [];
    },
    setSearchCriteria: (state, action: PayloadAction<SearchCriteria | null>) => {
      state.searchCriteria = action.payload;
    },
    setRefineCriteria: (state, action: PayloadAction<RefineCriteria | null>) => {
      state.refineCriteria = action.payload;
      // Re-derive filteredMessages now so the UI snaps to the new refine
      // without the caller needing a second dispatch.
      state.filteredMessages = applyRefineCriteria(plain(state.messages), action.payload);
    },
    clearRefineCriteria: (state) => {
      state.refineCriteria = null;
      state.filteredMessages = state.messages;
    },
    setThreadRefineCriteria: (
      state,
      action: PayloadAction<{ threadId: string; criteria: RefineCriteria | null }>,
    ) => {
      const tab = state.threadTabs?.[action.payload.threadId];
      if (!tab) return;
      tab.refineCriteria = action.payload.criteria;
      tab.filteredMessages = applyRefineCriteria(plain(tab.messages), action.payload.criteria);
    },
    clearThreadRefineCriteria: (state, action: PayloadAction<string>) => {
      const tab = state.threadTabs?.[action.payload];
      if (!tab) return;
      tab.refineCriteria = null;
      tab.filteredMessages = tab.messages;
    },
    setOrder: (state, action: PayloadAction<MessageOrder>) => {
      state.order = action.payload;
      // Re-sort messages when order changes
      if (state.filteredMessages.length > 0) {
        state.filteredMessages = getSortedMessages(
          state.filteredMessages,
          action.payload.order
        );
      }
    },
    clearMessages: (state) => {
      state.messages = [];
      state.filteredMessages = [];
      state.selectedMessages = [];
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
      state.activeTab = null;
      state.threadTabs = {};
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
    // dedupes against existing, re-sorts under the active order, and
    // refreshes the filtered view. Used by loadAllSearchResults +
    // fetchAllMessages so the table grows while the iterator is still
    // walking pages. The fulfilled reducer re-applies the same sort over
    // the final aggregated set — these appends are not a separate "preview
    // slice"; they are the same source of truth, just written incrementally.
    appendLoadAllPage: (
      state,
      action: PayloadAction<{ messages: Message[]; totalCount?: number; searchOffset?: number }>
    ) => {
      const { messages: pageMessages, totalCount, searchOffset } = action.payload;
      if (pageMessages.length === 0) return;
      const existing = plain(state.messages);
      const existingIds = new Set(existing.map((m) => m.id));
      const fresh = pageMessages.filter((m) => !existingIds.has(m.id));
      if (fresh.length === 0) return;
      // #263: merge the page at the right end instead of re-sorting the
      // whole list every page (quadratic at 30K). When no refine is active
      // filteredMessages is the same array, not a copy.
      const sorted = appendSortedPage(existing, fresh, state.order.order);
      state.messages = sorted;
      state.filteredMessages = applyRefineCriteria(sorted, state.refineCriteria);
      if (totalCount !== undefined) state.pagination.totalCount = totalCount;
      if (searchOffset !== undefined) state.pagination.searchOffset = searchOffset;
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
    dismissLoadAllCancelled: (state) => {
      // #193: lets the user close the "stopped at N" soft callout in
      // ServerView without starting a new load. Idempotent.
      state.pagination.loadAllCancelled = false;
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
          messages: [],
          filteredMessages: [],
          selectedMessages: [],
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
      if (state.activeTab === threadId) {
        state.activeTab = null;
      }
    },
    // Thread-tab-aware reducers
    setThreadMessages: (
      state,
      action: PayloadAction<{ threadId: string; messages: Message[] }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.messages = action.payload.messages;
        tab.filteredMessages = applyRefineCriteria(
          action.payload.messages,
          tab.refineCriteria,
        );
      }
    },
    setThreadFilteredMessages: (
      state,
      action: PayloadAction<{ threadId: string; messages: Message[] }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.filteredMessages = action.payload.messages;
      }
    },
    toggleThreadMessageSelection: (
      state,
      action: PayloadAction<{ threadId: string; message: Message }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        const base = plain(tab.selectedMessages);
        const index = base.findIndex((msg: Message) => msg.id === action.payload.message.id);
        tab.selectedMessages = index >= 0
          ? base.filter((_, i) => i !== index)
          : [...base, action.payload.message];
      }
    },
    selectAllThreadMessages: (state, action: PayloadAction<string>) => {
      const tab = state.threadTabs[action.payload];
      if (tab) {
        tab.selectedMessages = [...tab.filteredMessages];
      }
    },
    deselectAllThreadMessages: (state, action: PayloadAction<string>) => {
      const tab = state.threadTabs[action.payload];
      if (tab) {
        tab.selectedMessages = [];
      }
    },
    // #220: drag-select writes the whole selection per pointer move —
    // thread-tab counterpart of setSelectedMessages.
    setThreadSelectedMessages: (
      state,
      action: PayloadAction<{ threadId: string; messages: Message[] }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.selectedMessages = action.payload.messages;
      }
    },
    setThreadOrder: (
      state,
      action: PayloadAction<{ threadId: string; order: MessageOrder }>
    ) => {
      const tab = state.threadTabs[action.payload.threadId];
      if (tab) {
        tab.order = action.payload.order;
        if (tab.filteredMessages.length > 0) {
          tab.filteredMessages = getSortedMessages(
            tab.filteredMessages,
            action.payload.order.order
          );
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
        // Sort messages by order
        const sorted = getSortedMessages(action.payload.messages, state.order.order);
        state.messages = sorted;
        state.filteredMessages = sorted;
        state.selectedMessages = [];
        state.error = null;

        // Update pagination state
        state.pagination.lastMessageId = action.payload.lastMessageId;
        state.pagination.hasMore = action.payload.hasMore;
        state.pagination.totalCount = null;
        state.pagination.isLoadingMore = false;
      })
      .addCase(fetchMessages.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // Fetch more messages (infinite scroll)
      .addCase(fetchMoreMessages.pending, (state) => {
        state.pagination.isLoadingMore = true;
        state.error = null;
      })
      .addCase(fetchMoreMessages.fulfilled, (state, action) => {
        state.pagination.isLoadingMore = false;

        // Append new messages (don't replace). Then re-apply any active
        // refine so newly-loaded pages stay filtered as the user scrolls.
        const newMessages = [...state.messages, ...action.payload.messages];
        const sorted = getSortedMessages(newMessages, state.order.order);
        state.messages = sorted;
        state.filteredMessages = applyRefineCriteria(sorted, state.refineCriteria);

        // Update pagination state
        state.pagination.lastMessageId = action.payload.lastMessageId;
        state.pagination.hasMore = action.payload.hasMore;
      })
      .addCase(fetchMoreMessages.rejected, (state, action) => {
        state.pagination.isLoadingMore = false;
        state.error = action.payload as string;
      })
      // Delete single message
      .addCase(deleteMessage.fulfilled, (state, action) => {
        const messageId = action.payload;
        const container = getActiveContainer(state);
        container.messages = plain(container.messages).filter((m) => m.id !== messageId);
        container.filteredMessages = plain(container.filteredMessages).filter((m) => m.id !== messageId);
        container.selectedMessages = plain(container.selectedMessages).filter((m) => m.id !== messageId);
      })
      // Delete multiple messages
      .addCase(deleteMessages.pending, (state) => {
        state.isDeleting = true;
      })
      .addCase(deleteMessages.fulfilled, (state) => {
        state.isDeleting = false;
        const container = getActiveContainer(state);
        container.selectedMessages = [];
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
        const updatedMessage = action.payload;
        const container = getActiveContainer(state);
        const updateInArray = (arr: Message[]) =>
          arr.map((m) => (m.id === updatedMessage.id ? updatedMessage : m));
        container.messages = updateInArray(container.messages);
        container.filteredMessages = updateInArray(container.filteredMessages);
        container.selectedMessages = updateInArray(container.selectedMessages);
      })
      .addCase(editMessage.rejected, (state, action) => {
        state.isEditing = false;
        state.error = action.payload as string;
      })
      // Fetch all messages (bulk load)
      .addCase(fetchAllMessages.pending, (state) => {
        state.pagination.isLoadingAll = true;
        state.pagination.loadAllCancelled = false; // #193: clear stale cancel state on a new attempt
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
        // finalize flags + run a defensive canonical sort over what's
        // already in state.
        state.pagination.isLoadingAll = false;
        state.pagination.loadAllProgress = null;

        // #263: pages were merged in order, so this is only a defensive
        // pass, done on the plain array rather than the draft.
        const finalSorted = getSortedMessages(plain(state.messages), state.order.order);
        state.messages = finalSorted;
        state.filteredMessages = applyRefineCriteria(finalSorted, state.refineCriteria);
        state.selectedMessages = [];

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
        // of state.error — partial results below remain rendered, and
        // ServerView shows a dismissable "Load All stopped" callout
        // instead of the red error banner.
        const payload = action.payload as string | undefined;
        if (payload === 'Load all cancelled' || payload === 'Load cancelled') {
          state.pagination.loadAllCancelled = true;
          return;
        }
        state.error = payload ?? null;
      })
      // Bulk edit messages (F13: array updates land via the batched
      // messagesEdited flushes during the run — the fulfilled case only
      // finalizes flags + selection, mirroring deleteMessages.fulfilled)
      .addCase(editMessages.pending, (state) => {
        state.isEditing = true;
      })
      .addCase(editMessages.fulfilled, (state) => {
        state.isEditing = false;
        const container = getActiveContainer(state);
        container.selectedMessages = [];
      })
      .addCase(editMessages.rejected, (state, action) => {
        state.isEditing = false;
        state.error = action.payload as string;
      })
      // #215 multi-channel bulk edit — hold isEditing for the whole run so the
      // "Editing messages..." indicator + pause/cancel controls stay surfaced
      // (the per-message service calls don't touch isEditing).
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

        const sorted = getSortedMessages(action.payload.messages, state.order.order);
        state.messages = sorted;
        state.filteredMessages = applyRefineCriteria(sorted, state.refineCriteria);
        state.selectedMessages = [];

        state.pagination.totalCount = action.payload.totalResults;
        state.pagination.hasMore = action.payload.hasMore;
        state.pagination.searchOffset = action.payload.nextOffset;
        state.pagination.lastMessageId = null;
        state.searchCriteria = action.payload.searchCriteria;
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

        const existing = plain(state.messages);
        const existingIds = new Set(existing.map((m) => m.id));
        const newMessages = action.payload.messages.filter(
          (m) => !existingIds.has(m.id)
        );
        const sorted = appendSortedPage(existing, newMessages, state.order.order);
        state.messages = sorted;
        state.filteredMessages = applyRefineCriteria(sorted, state.refineCriteria);

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
        state.pagination.loadAllProgress = {
          current: state.messages.length,
          total: state.pagination.totalCount ?? 0,
          message: t('status.msg.loadingAllSearchResults'),
        };
      })
      .addCase(loadAllSearchResults.fulfilled, (state, action) => {
        // Messages were appended live via appendLoadAllPage (#181); just
        // finalize flags + run a defensive canonical sort over what's
        // already in state. The aggregated payload may contain duplicates
        // (the thunk doesn't dedup the local accumulator) — using
        // state.messages here preserves the deduped/sorted version.
        state.pagination.isLoadingAll = false;
        state.pagination.loadAllProgress = null;

        // #263: pages were merged in order, so this is only a defensive
        // pass, done on the plain array rather than the draft.
        const finalSorted = getSortedMessages(plain(state.messages), state.order.order);
        state.messages = finalSorted;
        state.filteredMessages = applyRefineCriteria(finalSorted, state.refineCriteria);

        state.pagination.totalCount = action.payload.totalResults;
        state.pagination.hasMore = false;
        state.pagination.searchOffset = state.messages.length;
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
        state.error = payload ?? null;
      })
      // Delete single reaction
      .addCase(deleteReaction.fulfilled, (state, action) => {
        const { messageId, emoji } = action.payload;
        const container = getActiveContainer(state);
        const updateReactions = (arr: Message[]) =>
          arr.map((m) => {
            if (m.id !== messageId || !m.reactions) return m;
            const updatedReactions = m.reactions
              .map((r) => {
                const emojiKey = r.emoji.id || r.emoji.name;
                if (emojiKey === emoji || `${r.emoji.name}:${r.emoji.id}` === emoji) {
                  return { ...r, count: (r.count || 1) - 1 };
                }
                return r;
              })
              .filter((r) => (r.count || 0) > 0);
            return { ...m, reactions: updatedReactions };
          });
        container.messages = updateReactions(container.messages);
        container.filteredMessages = updateReactions(container.filteredMessages);
        container.selectedMessages = updateReactions(container.selectedMessages);
      })
      // Delete all reactions of an emoji
      .addCase(deleteAllReactions.fulfilled, (state, action) => {
        const { messageId, emoji } = action.payload;
        const container = getActiveContainer(state);
        const removeEmoji = (arr: Message[]) =>
          arr.map((m) => {
            if (m.id !== messageId || !m.reactions) return m;
            const updatedReactions = m.reactions.filter((r) => {
              const emojiKey = r.emoji.id || r.emoji.name;
              return emojiKey !== emoji && `${r.emoji.name}:${r.emoji.id}` !== emoji;
            });
            return { ...m, reactions: updatedReactions };
          });
        container.messages = removeEmoji(container.messages);
        container.filteredMessages = removeEmoji(container.filteredMessages);
        container.selectedMessages = removeEmoji(container.selectedMessages);
      })
      // Bulk delete all reactions from a message (MANAGE_MESSAGES)
      .addCase(bulkDeleteAllReactions.fulfilled, (state, action) => {
        const { messageId } = action.payload;
        const container = getActiveContainer(state);
        const clearReactions = (arr: Message[]) =>
          arr.map((m) => m.id === messageId ? { ...m, reactions: [] } : m);
        container.messages = clearReactions(container.messages);
        container.filteredMessages = clearReactions(container.filteredMessages);
        container.selectedMessages = clearReactions(container.selectedMessages);
      })
      // Bulk delete all reactions for a specific emoji (MANAGE_MESSAGES)
      .addCase(bulkDeleteReactionsForEmoji.fulfilled, (state, action) => {
        const { messageId, emoji } = action.payload;
        const container = getActiveContainer(state);
        const removeEmoji = (arr: Message[]) =>
          arr.map((m) => {
            if (m.id !== messageId || !m.reactions) return m;
            const updatedReactions = m.reactions.filter((r) => {
              const emojiKey = r.emoji.id || r.emoji.name;
              return emojiKey !== emoji && `${r.emoji.name}:${r.emoji.id}` !== emoji;
            });
            return { ...m, reactions: updatedReactions };
          });
        container.messages = removeEmoji(container.messages);
        container.filteredMessages = removeEmoji(container.filteredMessages);
        container.selectedMessages = removeEmoji(container.selectedMessages);
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
        const { processedMessageIds, mode, emojis } = action.payload;
        const idSet = new Set(processedMessageIds);
        const emojiSet = emojis ? new Set(emojis) : null;
        const container = getActiveContainer(state);
        const update = (arr: Message[]) =>
          arr.map((m) => {
            if (!idSet.has(m.id) || !m.reactions) return m;
            if (mode === 'all') return { ...m, reactions: [] };
            if (mode === 'emoji' && emojiSet) {
              return {
                ...m,
                reactions: m.reactions.filter((r) => !emojiSet.has(getEmojiKey(r.emoji))),
              };
            }
            return {
              ...m,
              reactions: m.reactions
                .map((r) => {
                  if (emojiSet && !emojiSet.has(getEmojiKey(r.emoji))) return r;
                  return { ...r, count: Math.max(0, (r.count || 1) - 1), me: false };
                })
                .filter((r) => r.count > 0),
            };
          });
        container.messages = update(container.messages);
        container.filteredMessages = update(container.filteredMessages);
        container.selectedMessages = update(container.selectedMessages);
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
        const { successfulAdds } = action.payload;
        if (!successfulAdds.length) return;
        const byId = new Map(successfulAdds.map((s) => [s.messageId, s.emojis]));
        const container = getActiveContainer(state);
        // Optimistically merge the added reactions so the feed reflects them without a refetch.
        const mergeReactions = (m: Message): Message => {
          const toAdd = byId.get(m.id);
          if (!toAdd) return m;
          let reactions = [...(m.reactions || [])];
          for (const emoji of toAdd) {
            const key = getEmojiKey(emoji);
            const idx = reactions.findIndex((r) => getEmojiKey(r.emoji) === key);
            if (idx >= 0) {
              const r = reactions[idx];
              // Idempotent: only bump count if this @me reaction wasn't already present.
              if (!r.me) {
                reactions = reactions.map((rx, i) =>
                  i === idx ? { ...rx, count: (rx.count || 0) + 1, me: true } : rx
                );
              }
            } else {
              reactions = [
                ...reactions,
                {
                  count: 1,
                  count_details: { burst: 0, normal: 1 },
                  me: true,
                  me_burst: false,
                  emoji: {
                    id: emoji.id ?? undefined,
                    name: emoji.name ?? undefined,
                    animated: emoji.animated ?? undefined,
                  },
                  burst_colors: [],
                },
              ];
            }
          }
          return { ...m, reactions };
        };
        const update = (arr: Message[]) => arr.map(mergeReactions);
        container.messages = update(container.messages);
        container.filteredMessages = update(container.filteredMessages);
        container.selectedMessages = update(container.selectedMessages);
      })
      // Delete single attachment
      .addCase(deleteAttachment.fulfilled, (state, action) => {
        const { messageId, deleted, updatedMessage } = action.payload;
        const container = getActiveContainer(state);
        if (deleted) {
          container.messages = plain(container.messages).filter((m) => m.id !== messageId);
          container.filteredMessages = plain(container.filteredMessages).filter((m) => m.id !== messageId);
          container.selectedMessages = plain(container.selectedMessages).filter((m) => m.id !== messageId);
        } else if (updatedMessage) {
          const updateInArray = (arr: Message[]) =>
            arr.map((m) => (m.id === messageId ? updatedMessage : m));
          container.messages = updateInArray(container.messages);
          container.filteredMessages = updateInArray(container.filteredMessages);
          container.selectedMessages = updateInArray(container.selectedMessages);
        }
      })
      // Delete all attachments
      .addCase(deleteAllAttachments.fulfilled, (state, action) => {
        const { messageId, deleted, updatedMessage } = action.payload;
        const container = getActiveContainer(state);
        if (deleted) {
          container.messages = plain(container.messages).filter((m) => m.id !== messageId);
          container.filteredMessages = plain(container.filteredMessages).filter((m) => m.id !== messageId);
          container.selectedMessages = plain(container.selectedMessages).filter((m) => m.id !== messageId);
        } else if (updatedMessage) {
          const updateInArray = (arr: Message[]) =>
            arr.map((m) => (m.id === messageId ? updatedMessage : m));
          container.messages = updateInArray(container.messages);
          container.filteredMessages = updateInArray(container.filteredMessages);
          container.selectedMessages = updateInArray(container.selectedMessages);
        }
      })
      // User enrichment (light operation — spinner only)
      .addCase(enrichMessageUsers.pending, (state) => {
        state.isEnriching = true;
      })
      .addCase(enrichMessageUsers.fulfilled, (state) => {
        state.isEnriching = false;
      })
      .addCase(enrichMessageUsers.rejected, (state) => {
        state.isEnriching = false;
      });
  },
});

export const {
  setMessages,
  setFilteredMessages,
  setSelectedMessages,
  toggleMessageSelection,
  selectAllMessages,
  deselectAllMessages,
  messagesRemoved,
  messagesEdited,
  setSearchCriteria,
  setRefineCriteria,
  clearRefineCriteria,
  setThreadRefineCriteria,
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
  setThreadFilteredMessages,
  toggleThreadMessageSelection,
  selectAllThreadMessages,
  deselectAllThreadMessages,
  setThreadSelectedMessages,
  setThreadOrder,
  setThreadSearchCriteria,
  setThreadLoading,
  setThreadError,
  updateThreadPagination,
  setHighlightedMessageId,
} = messageSlice.actions;

// Base selectors (always return main channel state)
export const selectMessage = (state: RootState) => state.message;
export const selectMessages = (state: RootState) => state.message.messages;
export const selectClearSeq = (state: RootState) => state.message.clearSeq;
export const selectHighlightedMessageId = (state: RootState) =>
  state.message.highlightedMessageId;
export const selectFilteredMessages = (state: RootState) => state.message.filteredMessages;
export const selectSelectedMessages = (state: RootState) => state.message.selectedMessages;
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
export const selectActiveMessages = (state: RootState) => {
  const { activeTab, threadTabs, messages } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].messages;
  }
  return messages;
};

// #190 Phase 3: converted to a Reselect createSelector. The previous
// raw-property selector was already referentially stable (it returns one
// of two stored arrays without deriving), so the direct perf win is
// marginal — what this conversion buys is INTENT DOCUMENTATION (this
// selector is on the MessageFeed hot path and must stay ref-stable) and
// FUTURE-PROOFING against a refactor that adds derived work (a .map,
// a filter, a spread) — Reselect would still cache the output, where a
// raw selector would emit a new reference on every dispatch and force
// the whole feed to re-render. Backed by 4 regression-guard tests in
// the Active-tab-aware selectors describe block.
export const selectActiveFilteredMessages = createSelector(
  [
    (state: RootState) => state.message.activeTab,
    (state: RootState) => state.message.threadTabs,
    (state: RootState) => state.message.filteredMessages,
  ],
  (activeTab, threadTabs, filteredMessages) => {
    if (activeTab && threadTabs[activeTab]) {
      return threadTabs[activeTab].filteredMessages;
    }
    return filteredMessages;
  },
);

export const selectActiveSelectedMessages = (state: RootState) => {
  const { activeTab, threadTabs, selectedMessages } = state.message;
  if (activeTab && threadTabs[activeTab]) {
    return threadTabs[activeTab].selectedMessages;
  }
  return selectedMessages;
};

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

export default messageSlice.reducer;
