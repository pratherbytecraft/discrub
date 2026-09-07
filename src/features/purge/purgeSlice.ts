import { createSlice, createAsyncThunk, PayloadAction, type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit';
import type { Message, Channel, Emoji, Guild } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { ChannelType, IsPinnedType, ReactionType, QueryStringParam } from 'discrub-core/discord-enum';
import { initialPurgeState } from './purgeTypes';
import type { PurgeProgress, PurgeConfig, PurgeMode, BulkPurgeContext, ServerPurgeContext } from './purgeTypes';
import type { RootState } from '@/app/store';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { selectSearchDelay, selectDeleteDelay, selectDelayModifier } from '@features/app/appSlice';
import { getDiscordService } from '@services/discordService';
import { addStatusEntry, showOperationTip, showToast } from '@features/status/statusSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import {
  waitWhilePaused,
  checkCancelled,
  cancellableDelay,
  CancelledError,
  withTransientRetry,
} from '@utils/operationLoopUtils';
import { calculateRandomDelay } from '@utils/delayUtils';
import { iterateSearchMessagesRedux } from '@utils/searchPagination';
import { applyRefineCriteria, criteriaIsActive, messageHasFileOrLink } from '@features/message/messageFiltering';
import { nextMilestone } from '@utils/searchPagination';
import { isDeletedUserEntry } from '@utils/userDisplayUtils';
import { dropInvalidDate } from '@utils/dateValidation';
import { isMessageChannel } from '@utils/channelTypeUtils';
import { canAccessChannel } from '@/utils/permissionUtils';
import { t } from '@/i18n';

/** Progress throttle — dispatch progress every N messages in messages mode */
const PROGRESS_THROTTLE_MESSAGES = 10;

/** Progress throttle — dispatch progress every N messages in reactions scan mode */
const PROGRESS_THROTTLE_REACTIONS = 25;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encode an Emoji for use in Discord API URL paths.
 * Custom emojis → "name:id", Unicode emojis → URL-encoded character.
 */
const formatEmojiForApi = (emoji: Emoji): string => {
  if (emoji.id) {
    return `${emoji.name}:${emoji.id}`;
  }
  return encodeURIComponent(emoji.name || '');
};

/**
 * Get a display name for a channel (handles DMs vs server channels).
 * Group DMs (#227) prefer their custom name and carry a "(group)" marker so
 * purge status entries can't be mistaken for a 1:1 conversation.
 */
const getChannelDisplayName = (channel: Channel, isDm: boolean): string => {
  if (isDm) {
    if (channel.type === ChannelType.GROUP_DM) {
      const base =
        channel.name ||
        channel.recipients?.map((r) => r.username).join(', ') ||
        'Group DM';
      return `${base} (group)`;
    }
    return channel.recipients?.map((r) => r.username).join(', ') || 'DM';
  }
  return channel.name || `channel-${channel.id}`;
};

/**
 * Build an empty SearchCriteria with only userIds populated.
 */
// Build the trailing "N [messages] deleted, N stripped, N skipped,
// N failed" fragment for status-log entries. Zero-valued chunks
// disappear so the default purge flow (everything deleted) still
// reads as a single "N deleted" instead of a noisy line of zeros.
// `noun` is prefixed on the "deleted" chunk only — used in final
// summaries ("84 messages deleted") but omitted on per-batch progress
// lines where the run-on gets noisy.
const formatPurgeDetail = (
  deleted: number,
  skipped: number,
  editedAttachmentsOnly: number,
  failed: number,
  noun?: string,
  // #257: how many of `deleted` the final pass over the newest messages
  // caught after search ran dry. Shown only when non-zero.
  finalPass = 0,
): string => {
  const parts: string[] = [];
  parts.push(noun ? t('status.purge.detailDeletedNoun', { count: deleted, noun: t('status.purge.nounMessages', { count: deleted }) }) : t('status.purge.detailDeleted', { count: deleted }));
  if (finalPass > 0) {
    parts.push(t('status.purge.detailFinalPass', { count: finalPass }));
  }
  if (editedAttachmentsOnly > 0) {
    parts.push(t('status.purge.detailStripped', { count: editedAttachmentsOnly }));
  }
  if (skipped > 0) {
    parts.push(t('status.purge.detailSkipped', { count: skipped }));
  }
  if (failed > 0) {
    parts.push(t('status.purge.detailFailed', { count: failed }));
  }
  return parts.join(', ');
};

/**
 * Build a Discord-search SearchCriteria for the purge loop.
 *
 * `userIds` is always required — each bulk-purge run iterates once per
 * target author. The optional `overrides` parameter merges in additional
 * filter criteria from the user (content, date range, has-types, mentions)
 * set via the FilterModal. The caller supplies the author list (per-loop)
 * and can layer additional narrowing on top — the merged criteria still
 * pin `userIds` to the current loop iteration so multi-author runs
 * don't cross-pollinate search results.
 */
const buildSearchCriteria = (
  userIds: string[],
  overrides?: SearchCriteria | null,
): SearchCriteria => ({
  // #250 belt-and-braces: an Invalid Date is truthy, survives `??`, and
  // NaN-poisons the date-to-snowflake conversion, so the scan would match
  // nothing while the run still reports success. The FilterModal refuses
  // to apply one; drop it here too in case criteria arrive another way.
  searchBeforeDate: dropInvalidDate(overrides?.searchBeforeDate),
  searchAfterDate: dropInvalidDate(overrides?.searchAfterDate),
  searchMessageContents: overrides?.searchMessageContents ?? [],
  selectedHasTypes: overrides?.selectedHasTypes ?? [],
  userIds,
  mentionIds: overrides?.mentionIds ?? [],
  channelIds: overrides?.channelIds ?? [],
  isPinned: overrides?.isPinned ?? IsPinnedType.UNSET,
  attachmentExtensions: overrides?.attachmentExtensions ?? [],
  attachmentFilename: overrides?.attachmentFilename ?? null,
});

/**
 * Returns true if any non-default filter is set. Used by the reaction-
 * purge paths to decide between list-endpoint pagination (fetches every
 * message) and search-endpoint pagination (only messages matching the
 * filter). Mirrors the helper in exportSlice.ts.
 */
const hasAnyFilter = (c: SearchCriteria | null | undefined): boolean => {
  if (!c) return false;
  return (
    (c.userIds?.length ?? 0) > 0 ||
    (c.mentionIds?.length ?? 0) > 0 ||
    (c.selectedHasTypes?.length ?? 0) > 0 ||
    (c.attachmentExtensions?.length ?? 0) > 0 ||
    !!c.attachmentFilename ||
    (c.searchMessageContents?.length ?? 0) > 0 ||
    !!c.searchAfterDate ||
    !!c.searchBeforeDate ||
    (c.isPinned !== undefined && c.isPinned !== IsPinnedType.UNSET)
  );
};

/**
 * One batch yielded by `iterateReactionPurgeMessages`. `scanned` is the
 * raw page size (pre-filter), `filtered` is the subset the caller should
 * actually process. When no filter is active, `filtered === scanned size`.
 */
type ReactionPurgeBatch = {
  scanned: number;
  filtered: Message[];
};

/**
 * Yield pages of messages from a channel for reaction-purge processing.
 *
 * Two paths:
 * - **No filter**: list endpoint (`/channels/{id}/messages`, 100 msgs/page,
 *   newest-first). Reactions present on every message.
 * - **Filter active**: stream search hits via `iterateSearchMessagesRedux`,
 *   then for each unseen hit fetch the surrounding ±25-message window via
 *   `fetchMessageData(..., AROUND)`. The around-response contains the hit
 *   WITH its reactions (search alone strips them — verified in a
 *   2026-04-23 HAR where filtered reaction purges removed zero reactions).
 *   Context overlap means clustered hits resolve to a single around-call,
 *   amortizing the cost. Each around-batch is re-filtered via
 *   `applyRefineCriteria` so only real matches (not incidental context)
 *   get processed.
 *
 * Network-call tradeoff: filtered reaction purge is strictly more
 * expensive than unfiltered (adds around-calls on top of search pages).
 * That's inherent to Discord's API — the search endpoint is
 * reaction-stripped, so the full message has to be re-fetched. Users
 * accept this tradeoff when they enable filters.
 */
async function* iterateReactionPurgeMessages(
  channelId: string,
  guildId: string | null,
  token: string,
  getState: () => RootState,
  dispatch: (action: any) => void,
  filterOverrides: SearchCriteria | null | undefined,
  searchDelay: number,
  delayModifier: number,
  // Caller-supplied dedup set, shared across parent-channel + per-thread
  // purge calls for the same channel. Without this, a thread-hosted hit
  // surfaced via the parent's guild-search would trigger one around-fetch
  // in the parent pass AND a second duplicate around-fetch in the thread
  // pass — ~15% wasted calls in a 2026-04-23 dogfood. When caller omits
  // the set, iterator scopes dedup to its own call (prior behavior).
  sharedSeenIds?: Set<string>,
): AsyncGenerator<ReactionPurgeBatch> {
  const discordService = getDiscordService();
  const active = criteriaIsActive(filterOverrides);

  if (active) {
    const criteria = buildSearchCriteria(filterOverrides?.userIds ?? [], filterOverrides);
    // Dedup across around-calls — the target message + ±25 context often
    // overlap neighbouring hits, so we skip re-fetching messages already
    // seen and only process each message once.
    const seenIds = sharedSeenIds ?? new Set<string>();
    // Per-channel-miss log throttle so a run that keeps hitting the same
    // cross-channel edge case doesn't spam the status log.
    const aroundFailuresReported = new Set<string>();

    for await (const page of iterateSearchMessagesRedux({
      token, channelId, guildId, criteria, getState,
    })) {
      for (const hit of page.messages) {
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) return;
        if (seenIds.has(hit.id)) continue; // covered as context of a prior around-call

        // Use the hit's own channel_id when present — Discord's guild-level
        // search can return thread-hosted messages under the parent channel
        // query, and calling `around=id` against the parent 404s (and fails
        // preflight CORS — seen in a 2026-04-23 HAR). Falling back to the
        // caller-provided channelId matches pre-refactor behavior when the
        // hit omits channel_id.
        const aroundChannelId = hit.channel_id || channelId;

        // Around-fetch: 50 messages centered on the hit, each including
        // the full reaction payload that search stripped.
        let aroundResp;
        try {
          aroundResp = await withTransientRetry(
            () => discordService.fetchMessageData(
              token, hit.id, aroundChannelId, QueryStringParam.AROUND,
            ),
            { getState },
          );
        } catch (err) {
          // Network / CORS / preflight failure — surface once per channel
          // so users aren't left wondering why some hits didn't process.
          if (!aroundFailuresReported.has(aroundChannelId)) {
            aroundFailuresReported.add(aroundChannelId);
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.purge.contextFailed', { reason: err instanceof Error ? err.message : t('status.purge.networkError') }),
            }));
          }
          continue;
        }
        if (!aroundResp.success || !aroundResp.data) {
          // HTTP error (404, 403, etc.) — log once and move on. Often caused
          // by search results that reference messages the user can no longer
          // read (moved threads, revoked access, etc.).
          if (!aroundFailuresReported.has(aroundChannelId)) {
            aroundFailuresReported.add(aroundChannelId);
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.purge.contextFailed', { reason: t('status.purge.httpStatus', { status: aroundResp?.status ?? '?' }) }),
            }));
          }
          continue;
        }

        const batch = aroundResp.data;
        for (const m of batch) seenIds.add(m.id);

        // Only yield messages that actually match the user's criteria.
        // Context messages fetched as part of the around-window may not
        // satisfy the filter (e.g. a "content: hello" hit's neighbours
        // probably don't contain "hello") — skip those.
        const matched = applyRefineCriteria(batch, filterOverrides!);
        if (matched.length > 0) {
          yield { scanned: batch.length, filtered: matched };
        }

        const { delayMs } = calculateRandomDelay(searchDelay, delayModifier);
        const wasCancelled = await cancellableDelay(delayMs, getState);
        if (wasCancelled) return;
      }
    }
    return;
  }

  // Unfiltered path — standard list-endpoint pagination.
  let lastId: string | null = null;
  let hasMore = true;
  while (hasMore) {
    await waitWhilePaused(getState);
    if (checkCancelled(getState)) return;

    // Retry transient failures (#245). Exhaustion is loud: a silent
    // return here would let the purge end as if the walk completed.
    const response = await withTransientRetry(
      () => discordService.fetchMessageData(token, lastId ?? '', channelId),
      {
        getState,
        onRetry: (attempt, delayMs) => {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.retry', { seconds: Math.round(delayMs / 1000), attempt }),
          }));
        },
      },
    );
    if (!response.success || !response.data) {
      if (!checkCancelled(getState) && lastId !== null) {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.purge.historyStopped', { reason: response.status ?? t('status.purge.networkError') }),
        }));
      }
      return;
    }

    const messages = response.data;
    hasMore = messages.length >= 100;
    if (messages.length === 0) return;
    lastId = messages[messages.length - 1].id;

    yield { scanned: messages.length, filtered: messages };

    if (hasMore) {
      const { delayMs } = calculateRandomDelay(searchDelay, delayModifier);
      const wasCancelled = await cancellableDelay(delayMs, getState);
      if (wasCancelled) return;
    }
  }
}

// ─── Deleted-account scan fallback (#223) ────────────────────────────────────

/** Oldest snowflake whose creation time is >= the given date. */
const snowflakeFromDate = (date: Date): string =>
  ((BigInt(date.getTime() - 1420070400000) << 22n)).toString();

/**
 * Yield pages of a channel's history filtered client-side to one author,
 * shaped like `SearchIterationPage` so `purgeChannelMessages` can consume
 * either source with the same processing loop.
 *
 * Exists because Discord's `author_id` search returns NOTHING for DELETED
 * accounts (owner-reproduced 2026-07-08) while the messages remain in the
 * channel and remain deletable. The plain list endpoint has no author
 * filter at all, so this walks every message (parent channel + each
 * thread) and filters on `author.id` via `applyRefineCriteria` — the same
 * merged criteria a search run would have used, so content/date/has-type
 * narrowing still applies.
 *
 * Cost is O(channel history), not O(target's messages) — inherent, and why
 * this path only runs for detected-deleted targets. A `searchBeforeDate`
 * seeds the cursor and a `searchAfterDate` stops the walk, so date-windowed
 * purges skip the history outside the window.
 */
async function* iterateDeletedUserScan(
  channelId: string,
  threadIds: string[] | undefined,
  userId: string,
  filterOverrides: SearchCriteria | null | undefined,
  token: string,
  getState: () => RootState,
  dispatch: (action: any) => void,
  searchDelay: number,
  delayModifier: number,
  channelLabel: string,
): AsyncGenerator<{ messages: Message[]; totalResults: number; pageIndex: number; aggregatedCount: number }> {
  const discordService = getDiscordService();
  const matchCriteria = buildSearchCriteria([userId], filterOverrides);
  const afterDate = filterOverrides?.searchAfterDate ?? null;
  const beforeDate = filterOverrides?.searchBeforeDate ?? null;

  let pageIndex = 0;
  let aggregatedCount = 0;
  let scannedTotal = 0;
  let nextScanMilestone = 500;

  const channelsToScan = [channelId, ...(threadIds ?? [])];
  let scanIncomplete = false;
  for (const scanChannelId of channelsToScan) {
    // Seed the before-cursor inside the date window when one is set —
    // the list endpoint walks newest→oldest from this point.
    let lastId: string = beforeDate ? snowflakeFromDate(beforeDate) : '';
    let hasMore = true;
    let scannedThisChannel = 0;

    while (hasMore) {
      await waitWhilePaused(getState);
      if (checkCancelled(getState)) return;

      // Retry transient failures (#245) before treating the page as failed.
      const response = await withTransientRetry(
        () => discordService.fetchMessageData(token, lastId, scanChannelId),
        {
          getState,
          onRetry: (attempt, delayMs) => {
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.purge.scanRetry', { label: channelLabel, seconds: Math.round(delayMs / 1000), attempt }),
            }));
          },
        },
      );
      if (!response.success || !response.data) {
        // A FIRST-page failure is the expected shape for unwalkable
        // channels (forum parents 400 on the list endpoint, unreadable
        // private threads) — skip quietly. A MID-walk failure means part
        // of the history went unscanned and must not pass as a clean scan.
        if (scannedThisChannel > 0) {
          scanIncomplete = true;
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.scanStopped', { label: channelLabel, count: scannedThisChannel.toLocaleString() }),
          }));
        }
        break;
      }

      let messages = response.data;
      hasMore = messages.length >= 100;
      if (messages.length === 0) break;
      lastId = messages[messages.length - 1].id;
      scannedTotal += messages.length;
      scannedThisChannel += messages.length;

      // Early exit: once the page reaches past the window's start, drop
      // the out-of-window tail and stop walking this channel.
      if (afterDate) {
        const oldest = messages[messages.length - 1];
        const inWindow = messages.filter(
          (m) => !m.timestamp || new Date(m.timestamp) >= afterDate,
        );
        if (inWindow.length < messages.length ||
            (oldest.timestamp && new Date(oldest.timestamp) < afterDate)) {
          hasMore = false;
        }
        messages = inWindow;
      }

      const matched = applyRefineCriteria(messages, matchCriteria);
      if (matched.length > 0) {
        aggregatedCount += matched.length;
        yield { messages: matched, totalResults: 0, pageIndex: pageIndex++, aggregatedCount };
      }

      if (scannedTotal >= nextScanMilestone) {
        nextScanMilestone += 500;
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.scanned', { scanned: scannedTotal.toLocaleString(), label: channelLabel, matched: aggregatedCount.toLocaleString() }),
        }));
      }

      if (hasMore) {
        const { delayMs } = calculateRandomDelay(searchDelay, delayModifier);
        const wasCancelled = await cancellableDelay(delayMs, getState);
        if (wasCancelled) return;
      }
    }
  }

  dispatch(addStatusEntry({
    level: scanIncomplete ? 'warning' : 'info',
    message: scanIncomplete
      ? `Scan of ${channelLabel} stopped early: ${scannedTotal.toLocaleString()} messages checked, ${aggregatedCount.toLocaleString()} from this user; results may be incomplete`
      : `Scan of ${channelLabel} complete: ${scannedTotal.toLocaleString()} messages checked, ${aggregatedCount.toLocaleString()} from this user`,
  }));
}

// ─── Thread Discovery ─────────────────────────────────────────────────────────

/**
 * Discover all threads (active + archived) for the given channels in a guild.
 * Returns a Map from parent channel ID to an array of thread Channels.
 * Entirely non-fatal: if all discovery fails, returns an empty map.
 */
async function discoverThreadsForChannels(
  channels: Channel[],
  _guildId: string,
  token: string,
  getState: () => RootState,
  dispatch: (action: any) => void,
  searchDelay: number,
  delayModifier: number,
): Promise<Map<string, Channel[]>> {
  const discordService = getDiscordService();
  dispatch(addStatusEntry({ level: 'info', message: t('status.purge.discoveringThreads', { count: channels.length }) }));
  const channelIds = new Set(channels.map((c) => c.id));
  const threadMap = new Map<string, Channel[]>();
  const seenThreadIds = new Set<string>();

  const addThread = (thread: Channel) => {
    if (seenThreadIds.has(thread.id)) return;
    seenThreadIds.add(thread.id);
    const parentId = thread.parent_id;
    if (!parentId || !channelIds.has(parentId)) return;
    const existing = threadMap.get(parentId) || [];
    existing.push(thread);
    threadMap.set(parentId, existing);
  };

  // Per channel: fetch archived threads (public + private)
  for (let ci = 0; ci < channels.length; ci++) {
    const channel = channels[ci];

    // Voice + Stage channels carry text chat but DO NOT support threads
    // (Discord blocks thread creation on type 2 / 13). Hitting the thread
    // endpoints on a voice channel ID 400s and just wastes API calls +
    // emits "Could not fetch archived threads" warnings. Skip cleanly.
    // See backlog #160.
    if (
      channel.type === ChannelType.GUILD_VOICE ||
      channel.type === ChannelType.GUILD_STAGE_VOICE
    ) {
      continue;
    }

    // Per-channel progress so bulk purges across many channels don't
    // look stuck during the multi-minute discovery phase when searchDelay
    // is high. Firing once per channel (not per page) keeps the log tidy.
    if (channels.length > 1) {
      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.purge.scanningThreads', { name: channel.name || channel.id, index: ci + 1, total: channels.length }),
      }));
    }

    // Public archived threads (paginated)
    try {
      let hasMore = true;
      let before: string | undefined;

      while (hasMore) {
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) return threadMap;

        const publicResponse = await discordService.fetchPublicThreads(token, channel.id, before);
        if (!publicResponse.success || !publicResponse.data) break;

        for (const thread of publicResponse.data.threads) {
          addThread(thread);
        }

        hasMore = publicResponse.data.has_more;
        if (hasMore && publicResponse.data.threads.length > 0) {
          const lastThread = publicResponse.data.threads[publicResponse.data.threads.length - 1];
          before = lastThread.thread_metadata?.archive_timestamp;
        }

        const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
        const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
        if (wasCancelled) return threadMap;
      }
    } catch {
      dispatch(addStatusEntry({ level: 'warning', message: t('status.purge.archivedThreadsFailed', { name: channel.name || channel.id }) }));
    }

    // Private archived threads: try MANAGE_THREADS endpoint first, fall back to joined-only
    try {
      await waitWhilePaused(getState);
      if (checkCancelled(getState)) return threadMap;

      const privateResponse = await discordService.fetchPrivateThreads(token, channel.id);
      if (privateResponse.success && privateResponse.data) {
        for (const thread of privateResponse.data.threads) {
          addThread(thread);
        }
      } else {
        // Fallback: fetch only threads the current user joined
        const joinedResponse = await discordService.fetchJoinedPrivateArchivedThreads(
          token,
          channel.id,
        );
        if (joinedResponse.success && joinedResponse.data) {
          for (const thread of joinedResponse.data.threads) {
            addThread(thread);
          }
        }
      }

      const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
      const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
      if (wasCancelled) return threadMap;
    } catch {
      dispatch(addStatusEntry({ level: 'warning', message: t('status.purge.privateThreadsFailed', { name: channel.name || channel.id }) }));
    }
  }

  if (seenThreadIds.size > 0) {
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.foundThreads', { count: seenThreadIds.size }),
    }));
  }

  return threadMap;
}

// ─── Messages Mode: single-channel purge ────────────────────────────────────

interface ChannelPurgeResult {
  deleted: number;
  skipped: number;
  editedAttachmentsOnly: number;
  failed: number;
  // #257: deletions the final pass over the newest messages caught.
  finalPass: number;
}

/**
 * Purge messages from a single channel using the Search API.
 * Tracks searchOffset to avoid infinite loops on system-message-only batches.
 * Deduplicates flattened results and throttles progress dispatches.
 */
async function purgeChannelMessages(
  channelId: string,
  guildId: string | null,
  targetUserIds: string[],
  retainAttachedMedia: boolean,
  deleteAttachmentsOnly: boolean,
  // Current user's ID — needed because Discord only lets the message
  // author edit their own messages. For PATCH-based modes (attachments
  // only, retain-media) we pre-check authorship and skip cleanly rather
  // than burning an API call on a guaranteed-403.
  currentUserId: string | undefined,
  // Optional narrowing filters set via the FilterModal (#112): content,
  // date range, has-types, mentions. Merged into each per-user search
  // criteria so bulk purge can target a subset rather than all the
  // user's messages in the channel.
  filterOverrides: SearchCriteria | null | undefined,
  token: string,
  getState: () => RootState,
  dispatch: (action: any) => void,
  deleteDelay: number,
  // Per-page search delay is now sourced from Redux inside the shared
  // `iterateSearchMessagesRedux` iterator. Retained in the signature for
  // caller-side positional stability.
  _searchDelay: number,
  delayModifier: number,
  onProgress: (
    processed: number,
    deleted: number,
    skipped: number,
    editedAttachmentsOnly: number,
    failed: number,
  ) => void,
  threadIds?: string[],
  // Threads whose `thread_metadata.archived === true`. Any message whose
  // `channel_id` lands in this set can't be PATCH'd or DELETE'd without
  // first un-archiving the thread (Discord error 50083). We skip those
  // messages with a clear log entry rather than burning retries.
  archivedThreadIds?: Set<string>,
  // Human-readable channel label for status-log entries (e.g. `#general`
  // or the DM recipient list). Falls back to `#${channelId}`.
  channelLabel?: string,
  // Backlog #196 Phase 2 — MessageType enum string values (e.g. "6") the
  // user opted to delete despite being system messages. Converted to a
  // numeric Set below and consulted by the system-message skip gate.
  systemMessageTypesToDelete?: string[],
  // #233 — leave archived threads untouched: skip their messages (counted,
  // summarized) instead of un-archiving, so the thread never resurfaces
  // for other members.
  skipArchivedThreads?: boolean,
  // #239 — "Keep messages with files or links": messages carrying an
  // attachment or an http(s) link are skipped entirely (counted,
  // summarized) — no delete, no content-clear. Wins over
  // retainAttachedMedia.
  preserveMediaAndLinks?: boolean,
): Promise<ChannelPurgeResult> {
  const discordService = getDiscordService();
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalEditedAttachmentsOnly = 0;
  let totalFailed = 0;
  let totalSkippedNotAuthor = 0;
  let totalSkippedUnexpectedAuthor = 0;
  let totalSkippedArchivedOptOut = 0;
  let totalSkippedPinned = 0;
  let totalSkippedPreserved = 0;
  let totalProcessed = 0;
  let lastProgressDispatch = 0;
  let searchPageCount = 0;
  // #257: Discord's search index lags on the freshest message or two, so
  // a search-driven purge can end with matching messages still sitting
  // at the top of the channel (seen on every live purge test; reported
  // on r/discrub 2026-09-07). After search runs dry, read the newest page
  // straight from the list endpoint, apply the same criteria client-side
  // and push the leftovers through the normal processing loop. The page
  // is fetched once per channel and shared across target users.
  const seenIds = new Set<string>();
  const finalPassIds = new Set<string>();
  let totalFinalPass = 0;
  let newestPage: Message[] | null | undefined;

  // Snapshot the in-flight accumulator at any cancel-throw site so the
  // caller's catch can recover work-already-done (#140) instead of
  // dropping it on the floor when control jumps to the catch.
  const partialMessages = (): ChannelPurgeResult => ({
    deleted: totalDeleted,
    skipped: totalSkipped,
    editedAttachmentsOnly: totalEditedAttachmentsOnly,
    failed: totalFailed,
    finalPass: totalFinalPass,
  });

  // Threads we un-archived during this run. The finally block re-archives
  // them so we never leave the user's thread state unintentionally changed.
  const unarchivedThisRun = new Set<string>();
  // Per-thread cache: true = we successfully un-archived and can process
  // messages, false = we lack permission (403) and must skip this thread's
  // messages for the rest of the run. Avoids retrying the PATCH per message.
  const threadUnarchiveAllowed = new Map<string, boolean>();
  // #233 — threads we've already announced skipping under the opt-out,
  // so a busy thread logs once instead of once per message.
  const optOutLoggedThreads = new Set<string>();
  // #233/F18 — archived threads the deleted-account scan excluded from
  // its walk under the opt-out. The scan never sees their messages (the
  // filter exists to protect the scan's budget), so the option's
  // "skipped (and counted)" contract is honored at thread granularity:
  // logged when excluded, summarized at the end. Without this, a
  // deleted-account purge reported a clean complete while messages
  // persisted in archived threads with no signal at all.
  const scanExcludedArchivedThreads = new Set<string>();

  try {

  const label = channelLabel ?? `#${channelId}`;

  // Backlog #196 Phase 2 — system message types the user explicitly
  // opted to delete. `message.type` is numeric on the wire; the config
  // carries MessageType enum string values, so normalize to numbers once.
  const includedSystemTypes = new Set(
    (systemMessageTypesToDelete ?? []).map(Number),
  );

  // #257: the final pass only makes sense where search was the page
  // source (the deleted-account scan already reads the list endpoint) and
  // where the parent channel is inside any explicit channel narrowing.
  const explicitChannelIds = filterOverrides?.channelIds ?? [];
  const finalPassApplies =
    explicitChannelIds.length === 0 || explicitChannelIds.includes(channelId);

  const fetchNewestPage = async (): Promise<Message[]> => {
    if (newestPage !== undefined) return newestPage ?? [];
    const response = await withTransientRetry(
      async () => (await discordService.fetchMessageData(token, '', channelId)) ?? { success: false },
      {
        getState,
        onRetry: (attempt, delayMs) => {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.finalPassRetry', { label, seconds: Math.round(delayMs / 1000), attempt }),
          }));
        },
      },
    );
    if (response.success && Array.isArray(response.data)) {
      newestPage = response.data;
    } else {
      newestPage = null;
      if (!checkCancelled(getState)) {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.purge.finalPassFailed', { label }),
        }));
      }
    }
    return newestPage ?? [];
  };

  // Wrap a search page source so that, once it runs dry, one more page is
  // yielded: the newest messages that match this user's criteria and were
  // never seen during the search walk.
  async function* withFinalPass(
    source: AsyncGenerator<{ messages: Message[]; totalResults: number; pageIndex: number; aggregatedCount: number }>,
    matchCriteria: SearchCriteria,
  ): AsyncGenerator<{ messages: Message[]; totalResults: number; pageIndex: number; aggregatedCount: number; finalPass?: boolean }> {
    yield* source;
    if (checkCancelled(getState)) return;
    const newest = await fetchNewestPage();
    if (newest.length === 0) return;
    const leftovers = applyRefineCriteria(newest, matchCriteria).filter((m) => !seenIds.has(m.id));
    if (leftovers.length === 0) return;
    yield { messages: leftovers, totalResults: 0, pageIndex: 0, aggregatedCount: 0, finalPass: true };
  }

  for (const userId of targetUserIds) {
    const searchCriteria = buildSearchCriteria([userId], filterOverrides);

    // Include thread IDs in search criteria so search covers parent + threads.
    // Merge with any explicit channelIds the caller passed via filterOverrides.
    if (threadIds && threadIds.length > 0) {
      const existing = searchCriteria.channelIds ?? [];
      searchCriteria.channelIds = existing.length > 0
        ? Array.from(new Set([...existing, ...threadIds]))
        : threadIds;
    }

    // #223: Discord's author_id search returns nothing for DELETED accounts
    // even though their messages remain (and remain deletable). When the
    // target's cached user object is a deleted-account placeholder, swap the
    // search iterator for a full history scan filtered client-side. Slow but
    // works beats fast but returns nothing; current members keep the fast
    // search path untouched.
    const targetIsDeleted = isDeletedUserEntry(getState().cache?.userMap?.[userId]);

    if (targetIsDeleted) {
      dispatch(addStatusEntry({
        level: 'warning',
        message: t('status.purge.deletedAccountScan', { label }),
      }));
    } else {
      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.purge.searching', { label }),
      }));
    }

    let totalForThisUser = 0;
    let announcedTotal = false;

    // #233: opted-out archived threads are excluded from the walk
    // entirely — scanning them only to skip every hit wastes the
    // scan's (already slow) budget. F18: count and announce what got
    // excluded (see scanExcludedArchivedThreads).
    let scanThreadIds = threadIds;
    if (targetIsDeleted && skipArchivedThreads && threadIds) {
      scanThreadIds = threadIds.filter((id) => !archivedThreadIds?.has(id));
      const newlyExcluded = threadIds.filter(
        (id) => archivedThreadIds?.has(id) && !scanExcludedArchivedThreads.has(id),
      );
      newlyExcluded.forEach((id) => scanExcludedArchivedThreads.add(id));
      if (newlyExcluded.length > 0) {
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.leavingArchivedUnscanned', { count: newlyExcluded.length, label }),
        }));
      }
    }

    const pageSource = targetIsDeleted
      ? iterateDeletedUserScan(
          channelId,
          scanThreadIds,
          userId,
          filterOverrides,
          token,
          getState,
          dispatch,
          selectSearchDelay(getState()),
          delayModifier,
          label,
        )
      : iterateSearchMessagesRedux({
          token,
          channelId,
          guildId,
          criteria: searchCriteria,
          getState,
        });
    const pagesWithFinalPass = targetIsDeleted || !finalPassApplies
      ? pageSource
      : withFinalPass(pageSource, buildSearchCriteria([userId], filterOverrides));

    for await (const page of pagesWithFinalPass) {
      await waitWhilePaused(getState);
      if (checkCancelled(getState)) throw new CancelledError(partialMessages());

      if (!announcedTotal) {
        announcedTotal = true;
        totalForThisUser = page.totalResults;
        if (totalForThisUser > 0) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.purge.discordReports', { count: totalForThisUser, label }),
          }));
          if ((page as { stillIndexing?: boolean }).stillIndexing) {
            // #216: a non-zero total while indexing is in progress can
            // still be an UNDERCOUNT — deleting only what search returns
            // and reporting success would silently miss the rest.
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.purge.indexingCount', { label }),
            }));
          }
        } else if ((page as { stillIndexing?: boolean }).stillIndexing) {
          // #216: "0 matches" while Discord is still building this
          // conversation's search index is not a real zero — the likely
          // cause of "purge found nothing in my group DM" reports.
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.indexingNothing', { label }),
          }));
        }
      }

      const messages = page.messages;
      if (messages.length === 0) continue;
      messages.forEach((m) => seenIds.add(m.id));

      if ((page as { finalPass?: boolean }).finalPass) {
        messages.forEach((m) => finalPassIds.add(m.id));
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.finalPass', { label, count: messages.length }),
        }));
      } else {
        searchPageCount++;
        // Use the original totalResults (announced once at the top of the
        // search) as the denominator. After deletions Discord's totalResults
        // shrinks every page, which made the live denominator nonsensical
        // ("75 of 64 matches fetched") as aggregatedCount kept growing past
        // the now-shrunken total. The stable original keeps the progress
        // signal honest: how much of the originally-reported set we've
        // touched, not a live ratio against a moving target.
        const batchDenom = totalForThisUser > 0
          ? t('status.purge.batchDenom', { fetched: page.aggregatedCount.toLocaleString(), total: totalForThisUser.toLocaleString() })
          : '';
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.searchBatch', { batch: searchPageCount, count: messages.length, denom: batchDenom }),
        }));
      }

      // Process each message in the batch
      for (let mi = 0; mi < messages.length; mi++) {
        const message = messages[mi];
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) throw new CancelledError(partialMessages());

        // Skip system messages (type > 0 that aren't DEFAULT or REPLY),
        // unless the user opted to delete this specific type via the
        // BulkPurgeDialog system-message section (#196 Phase 2).
        if (
          message.type !== 0 &&
          message.type !== 19 &&
          !includedSystemTypes.has(message.type)
        ) {
          totalSkipped++;
          totalProcessed++;
          // Throttled progress dispatch
          if (totalProcessed - lastProgressDispatch >= PROGRESS_THROTTLE_MESSAGES || mi === messages.length - 1) {
            lastProgressDispatch = totalProcessed;
            onProgress(totalProcessed, totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed);
          }
          continue;
        }

        const hasAttachments =
          !!message.attachments && message.attachments.length > 0;
        const hasContent = (message.content ?? '').trim().length > 0;

        // Backlog #156: when the user opted out of touching pinned
        // messages (`isPinned: NO` in the FilterModal), enforce that
        // client-side. Discord's search endpoint silently *ignores*
        // `pinned=false` and returns pinned messages anyway — this was
        // documented in discrub-ext's changelog and re-confirmed via
        // research in 2026-05. Without this gate, the user's explicit
        // "exclude pinned" choice has no effect on what actually gets
        // deleted / edited. `message.pinned` is a required boolean on
        // every message object (discord-api-types), so the check is
        // safe to make unconditional.
        if (
          filterOverrides?.isPinned === IsPinnedType.NO &&
          message.pinned === true
        ) {
          totalSkipped++;
          totalSkippedPinned++;
          totalProcessed++;
          if (totalProcessed - lastProgressDispatch >= PROGRESS_THROTTLE_MESSAGES || mi === messages.length - 1) {
            lastProgressDispatch = totalProcessed;
            onProgress(totalProcessed, totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed);
          }
          continue;
        }

        // #239 — "Keep messages with files or links": a message carrying
        // an attachment or an http(s) link is preserved entirely — no
        // API call, no delete, no content-clear. Checked BEFORE the
        // archived-thread handling so a preserved message never triggers
        // an un-archive PATCH on its behalf, and before the
        // retainAttachedMedia / delete branches so preserve wins over
        // retain (the message keeps its text instead of having it
        // cleared). Applies identically to the search path and the
        // deleted-account history-scan path — both feed this loop.
        if (preserveMediaAndLinks && messageHasFileOrLink(message)) {
          totalSkipped++;
          totalSkippedPreserved++;
          totalProcessed++;
          if (totalProcessed - lastProgressDispatch >= PROGRESS_THROTTLE_MESSAGES || mi === messages.length - 1) {
            lastProgressDispatch = totalProcessed;
            onProgress(totalProcessed, totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed);
          }
          continue;
        }

        // Route delete/edit at the message's own channel, not the outer
        // channel we're iterating — a search with thread IDs returns
        // messages whose home is the thread, and Discord's DELETE/PATCH
        // endpoints 404 if the {channel_id} in the URL isn't the exact
        // home. This affects forum posts and any channel with threads.
        const targetChannelId = message.channel_id || channelId;

        // Archived threads reject PATCH/DELETE on their messages with
        // error 50083 "Thread is archived". Try to un-archive once per
        // thread (cached) so we can process the messages inside, then
        // re-archive in the finally block. Without MANAGE_THREADS or
        // thread ownership the un-archive PATCH returns 403 — skip
        // messages in that thread with a single info log and move on.
        const isArchivedThread =
          !!message.channel_id && !!archivedThreadIds?.has(message.channel_id);

        if (isArchivedThread && message.channel_id) {
          const threadId = message.channel_id;

          // #233: the user opted out of waking archived threads. Skip the
          // message without attempting the un-archive PATCH — the whole
          // point of the option is that the thread must never resurface
          // for other members.
          if (skipArchivedThreads) {
            if (!optOutLoggedThreads.has(threadId)) {
              optOutLoggedThreads.add(threadId);
              dispatch(addStatusEntry({
                level: 'info',
                message: t('status.purge.leavingArchivedThread', { id: threadId }),
              }));
            }
            totalSkipped++;
            totalSkippedArchivedOptOut++;
            totalProcessed++;
            if (totalProcessed - lastProgressDispatch >= PROGRESS_THROTTLE_MESSAGES || mi === messages.length - 1) {
              lastProgressDispatch = totalProcessed;
              onProgress(totalProcessed, totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed);
            }
            continue;
          }

          // First message we've seen in this archived thread this run?
          // Attempt the un-archive and cache the outcome.
          if (!threadUnarchiveAllowed.has(threadId)) {
            const unarchiveResp = await discordService.editChannel(
              token,
              threadId,
              { archived: false },
            );
            if (unarchiveResp.success) {
              threadUnarchiveAllowed.set(threadId, true);
              unarchivedThisRun.add(threadId);
              dispatch(addStatusEntry({
                level: 'info',
                message: t('status.purge.unarchivedMessages', { id: threadId }),
              }));
            } else {
              threadUnarchiveAllowed.set(threadId, false);
              const status = unarchiveResp.status;
              dispatch(addStatusEntry({
                level: 'warning',
                message: status === 403
                  ? `Missing permission to un-archive thread ${threadId}; its messages will be skipped`
                  : `Failed to un-archive thread ${threadId} (HTTP ${status ?? '?'}); its messages will be skipped`,
              }));
            }
          }

          // Cached "not allowed" → aggregate skip, move on.
          if (threadUnarchiveAllowed.get(threadId) === false) {
            totalSkipped++;
            totalProcessed++;
            if (totalProcessed - lastProgressDispatch >= PROGRESS_THROTTLE_MESSAGES || mi === messages.length - 1) {
              lastProgressDispatch = totalProcessed;
              onProgress(totalProcessed, totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed);
            }
            continue;
          }
          // Otherwise the thread is now un-archived; fall through to the
          // normal per-message branches.
        }

        if (deleteAttachmentsOnly) {
          if (!hasAttachments) {
            // "Attachments only" is opt-in destructive *of attachments*,
            // not of whole messages. A plain-text message is a no-op,
            // not a delete-fallback. Previous versions fell through to
            // deleteMessage here, which destroyed text-only messages
            // silently.
            totalSkipped++;
          } else if (currentUserId && message.author?.id !== currentUserId) {
            // Discord's PATCH (edit) endpoint only accepts edits from the
            // message author, even for accounts with MANAGE_MESSAGES.
            // Pre-skip to avoid a guaranteed-403 per message.
            totalSkipped++;
            totalSkippedNotAuthor++;
          } else if (!hasContent) {
            // Attachment-only messages (and voice messages — code 50162
            // — which are attachment-only by nature): PATCH would leave
            // the message with nothing → Discord 400 code 50006 "Cannot
            // send an empty message". The attachment IS the message, so
            // "strip attachments" here effectively means delete.
            const response = await discordService.deleteMessage(token, message.id, targetChannelId);
            if (response.success) {
              totalDeleted++;
            } else {
              totalFailed++;
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.purge.deleteAttachmentOnlyFailed', { reason: t('status.purge.httpStatus', { status: response.status ?? '?' }), id: message.id }),
              }));
            }
          } else {
            const response = await discordService.editMessage(
              token, message.id,
              { attachments: [] },
              targetChannelId,
            );
            if (response.success) {
              totalEditedAttachmentsOnly++;
            } else {
              // Don't count as "stripped". Log once per miss so the user
              // can audit; keep Discord's status for diagnostics.
              totalFailed++;
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.purge.stripFailed', { reason: t('status.purge.httpStatus', { status: response.status ?? '?' }), id: message.id }),
              }));
            }
          }
        } else if (retainAttachedMedia && hasAttachments) {
          if (currentUserId && message.author?.id !== currentUserId) {
            // PATCH is author-only — pre-skip to avoid 403s. See note above.
            totalSkipped++;
            totalSkippedNotAuthor++;
          } else {
            // Edit message to clear content but preserve attachments
            const response = await discordService.editMessage(
              token, message.id,
              { content: '', attachments: message.attachments },
              targetChannelId,
            );
            if (response.success) {
              totalSkipped++;
            } else {
              totalFailed++;
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.purge.clearTextFailed', { reason: t('status.purge.httpStatus', { status: response.status ?? '?' }), id: message.id }),
              }));
            }
          }
        } else if (message.author?.id !== userId) {
          // Defensive: search asked Discord for messages by `userId`, so
          // every result should have author.id === userId. Discord's docs
          // confirm search currently returns hits-only (no surrounding
          // context), so this branch is a no-op today. If that ever
          // regresses to include context messages, we never want to
          // delete a neighbor whose author wasn't targeted — even with
          // MANAGE_MESSAGES, deleting non-matching authors would betray
          // the user's targeting intent.
          totalSkipped++;
          totalSkippedUnexpectedAuthor++;
        } else {
          const response = await discordService.deleteMessage(token, message.id, targetChannelId);
          if (response.success) {
            totalDeleted++;
            if (finalPassIds.has(message.id)) totalFinalPass++;
          } else {
            totalFailed++;
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.purge.deleteFailed', { reason: t('status.purge.httpStatus', { status: response.status ?? '?' }), id: message.id }),
            }));
          }
        }

        totalProcessed++;
        // Throttled progress dispatch
        if (totalProcessed - lastProgressDispatch >= PROGRESS_THROTTLE_MESSAGES || mi === messages.length - 1) {
          lastProgressDispatch = totalProcessed;
          onProgress(totalProcessed, totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed);
        }

        // Delay between operations
        const delayCalc = calculateRandomDelay(deleteDelay, delayModifier);
        const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
        if (wasCancelled) throw new CancelledError(partialMessages());
      }

      // Log batch completion with running totals
      if (totalDeleted > 0 || totalSkipped > 0 || totalEditedAttachmentsOnly > 0 || totalFailed > 0) {
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.progress', { detail: formatPurgeDetail(totalDeleted, totalSkipped, totalEditedAttachmentsOnly, totalFailed, undefined, totalFinalPass) }),
        }));
      }

      // `totalForThisUser` is surfaced via the one-shot "Discord reports N
      // matching messages" entry above; the caller's `onProgress` +
      // `formatPurgeDetail` drive per-milestone "N deleted, N skipped"
      // entries every 100 messages, so we don't add a duplicate milestone
      // here. The `void` silences the unused-variable warning when no
      // matches came back (totalForThisUser stays 0).
      void totalForThisUser;

      // The lib iterator (#188) cap-shifts `searchBeforeDate` to the
      // oldest yielded timestamp on every iteration, so post-deletion
      // re-fetches transparently advance past everything we've already
      // seen. No caller-side restart plumbing needed.
    }
  }

  // Surface a single info-level summary when we silently skipped messages
  // that weren't authored by the current user (PATCH-only modes). Avoids
  // a warning-per-message explosion in the status log while still telling
  // the user why their target count doesn't match the outcome.
  if (totalSkippedNotAuthor > 0) {
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.skippedOtherAuthors', { count: totalSkippedNotAuthor }),
    }));
  }

  // Defensive-skip summary: search returned messages whose author didn't
  // match the targeted user. Should never fire under current Discord
  // behavior (search returns hits-only); if it does, it likely indicates
  // an API regression and is worth investigating.
  if (totalSkippedUnexpectedAuthor > 0) {
    dispatch(addStatusEntry({
      level: 'warning',
      message: t('status.purge.skippedUnexpectedAuthor', { count: totalSkippedUnexpectedAuthor }),
    }));
  }

  // Single info summary when the user opted to exclude pinned messages
  // and we caught some that Discord's broken `pinned=false` filter let
  // through (#156). Counts how many actually-pinned messages we
  // protected from deletion.
  if (totalSkippedPinned > 0) {
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.preservedPinned', { count: totalSkippedPinned }),
    }));
  }

  // #239: single summary for messages preserved because they carry an
  // attachment or a link and the user opted to keep those.
  if (totalSkippedPreserved > 0) {
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.preservedFiles', { count: totalSkippedPreserved }),
    }));
  }

  // #233: single summary for messages left untouched inside archived
  // threads because the user opted out of waking them.
  if (totalSkippedArchivedOptOut > 0) {
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.leftArchivedMessages', { count: totalSkippedArchivedOptOut }),
    }));
  }

  // #233/F18: the deleted-account scan excludes opted-out archived
  // threads wholesale, so their skips are reported per thread rather
  // than per message.
  if (scanExcludedArchivedThreads.size > 0) {
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.leftArchivedUnscanned', { count: scanExcludedArchivedThreads.size }),
    }));
  }

  return {
    deleted: totalDeleted,
    skipped: totalSkipped,
    editedAttachmentsOnly: totalEditedAttachmentsOnly,
    failed: totalFailed,
    finalPass: totalFinalPass,
  };

  } finally {
    // Re-archive any threads we un-archived during this run — restore
    // the user's original thread state. Runs on success, cancellation,
    // and errors. Best-effort: if the re-archive itself fails we log a
    // warning but don't throw (we'd rather not convert a completed purge
    // into a "failed" one over cleanup).
    for (const threadId of unarchivedThisRun) {
      try {
        const resp = await discordService.editChannel(token, threadId, { archived: true });
        if (resp.success) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.purge.rearchived', { id: threadId }),
          }));
        } else {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.rearchiveFailedHttp', { id: threadId, reason: t('status.purge.httpStatus', { status: resp.status ?? '?' }) }),
          }));
        }
      } catch {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.purge.rearchiveFailedHttp', { id: threadId, reason: t('status.purge.networkError') }),
        }));
      }
    }
  }
}

// ─── Reactions Mode: single-channel purge ───────────────────────────────────

interface ReactionPurgeResult {
  scanned: number;
  reactionsRemoved: number;
  /**
   * Number of reaction DELETE calls that hit a Discord error (403, 429
   * post-retry, 50083, etc). Surfaces in the completion log so the user
   * doesn't see "3 reactions removed" when 2 of them silently failed.
   */
  failed: number;
}

type ThreadMutationGuard = {
  /**
   * Lazily un-archive the thread the first time it's called. Caches the
   * outcome — subsequent calls are O(1) and don't hit the network.
   * Returns `true` when the caller is free to mutate (either the thread
   * wasn't archived, or it's been successfully un-archived). Returns
   * `false` when the thread IS archived but un-archive was denied — the
   * caller should skip the mutation and treat it as a failure.
   */
  ensureUnarchived: () => Promise<boolean>;
  /** Re-archive the thread if (and only if) we un-archived it. Safe to
   *  call even when we didn't — it's a no-op in that case. Always
   *  invoke in a `finally` block. */
  cleanup: () => Promise<void>;
};

/**
 * Build a lazy un-archive / re-archive guard for an archived thread.
 *
 * Archived threads accept READ operations (fetchMessageData returns
 * messages + reactions) but reject PATCH/DELETE with code 50083
 * "Thread is archived". Rather than un-archive every flagged thread
 * up-front — wasting two PATCHes per thread that turns out to have no
 * matching work — we defer the un-archive until the caller is about to
 * actually mutate, and we cache the outcome so subsequent checks are
 * free.
 *
 * When `isArchivedThread` is false this is an entirely no-op pair —
 * callers can safely wrap every channel, not just archived threads.
 */
function createThreadMutationGuard(
  channelId: string,
  isArchivedThread: boolean,
  token: string,
  dispatch: (action: any) => void,
  // #233 — user opted out of waking archived threads: deny mutation
  // without ever PATCHing, announced calmly (a choice, not an error).
  skipWaking = false,
): ThreadMutationGuard {
  if (!isArchivedThread) {
    return { ensureUnarchived: async () => true, cleanup: async () => {} };
  }

  if (skipWaking) {
    let logged = false;
    return {
      ensureUnarchived: async () => {
        if (!logged) {
          logged = true;
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.purge.leavingArchivedReactions', { id: channelId }),
          }));
        }
        return false;
      },
      cleanup: async () => {},
    };
  }

  // Three-state cache — pending = not attempted yet, unarchived = success,
  // denied = attempted and blocked. Captured in closure.
  type GuardState = 'pending' | 'unarchived' | 'denied';
  let state: GuardState = 'pending';

  return {
    ensureUnarchived: async () => {
      if (state === 'unarchived') return true;
      if (state === 'denied') return false;

      const discordService = getDiscordService();
      const resp = await discordService.editChannel(token, channelId, { archived: false });
      if (resp.success) {
        state = 'unarchived';
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.unarchivedReactions', { id: channelId }),
        }));
        return true;
      }
      state = 'denied';
      dispatch(addStatusEntry({
        level: 'warning',
        message: resp.status === 403
          ? `Missing permission to un-archive thread ${channelId}; its reactions will be skipped`
          : `Failed to un-archive thread ${channelId} (HTTP ${resp.status ?? '?'}); its reactions will be skipped`,
      }));
      return false;
    },

    cleanup: async () => {
      if (state !== 'unarchived') return;
      const discordService = getDiscordService();
      try {
        const reResp = await discordService.editChannel(token, channelId, { archived: true });
        if (reResp.success) {
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.purge.rearchived', { id: channelId }),
          }));
        } else {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.rearchiveFailedHttp', { id: channelId, reason: t('status.purge.httpStatus', { status: reResp.status ?? '?' }) }),
          }));
        }
      } catch {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.purge.rearchiveFailedHttp', { id: channelId, reason: t('status.purge.networkError') }),
        }));
      }
    },
  };
}

/**
 * A per-run registry that hands out thread-mutation guards on demand,
 * one per target channel. Solves the cross-channel archived-thread
 * problem: parent-channel search can surface hits in archived *sibling*
 * threads via `message.channel_id`, but a guard bound only to the
 * outer `channelId` can't un-archive those. The registry lazily builds
 * (and caches) a guard for every channel the caller touches, and
 * `cleanupAll()` re-archives every thread we un-archived in one
 * sweep at the end of the run.
 *
 * `archivedChannelIds` lists channel IDs the caller knows up-front
 * are archived threads (computed from the discovered `threadMap`).
 * Guards for channels outside that set are instantiated as no-ops.
 */
export type ThreadMutationGuardRegistry = {
  getGuard: (channelId: string) => ThreadMutationGuard;
  cleanupAll: () => Promise<void>;
};

function createThreadMutationGuardRegistry(
  token: string,
  dispatch: (action: any) => void,
  archivedChannelIds: Set<string>,
  skipWaking = false,
): ThreadMutationGuardRegistry {
  const guards = new Map<string, ThreadMutationGuard>();
  return {
    getGuard: (channelId: string) => {
      const existing = guards.get(channelId);
      if (existing) return existing;
      const fresh = createThreadMutationGuard(
        channelId, archivedChannelIds.has(channelId), token, dispatch, skipWaking,
      );
      guards.set(channelId, fresh);
      return fresh;
    },
    cleanupAll: async () => {
      for (const guard of guards.values()) {
        await guard.cleanup();
      }
    },
  };
}

/**
 * Clear all reactions from a single channel using bulk endpoints (requires MANAGE_MESSAGES).
 * Uses DELETE /channels/{id}/messages/{id}/reactions (one call per message).
 */
async function purgeChannelClearAllReactions(
  channelId: string,
  token: string,
  getState: () => RootState,
  dispatch: (action: any) => void,
  deleteDelay: number,
  searchDelay: number,
  delayModifier: number,
  onProgress: (scanned: number, reactionsCleared: number) => void,
  // Archived threads reject DELETE /reactions with 400 code 50083. Caller
  // sets this when `channelId` points to an archived thread so we un-archive
  // up-front and re-archive on exit.
  isArchivedThread: boolean = false,
  // Guild context — required by the search-endpoint when narrowing via
  // FilterModal. DM callers pass null and land in the list-endpoint path.
  guildId: string | null = null,
  // Optional FilterModal-sourced narrowing. When set, scans only messages
  // matching the filter (via search endpoint) rather than every message
  // in the channel.
  filterOverrides: SearchCriteria | null | undefined = null,
  // Optional shared dedup set across parent-channel + per-thread calls.
  // See `iterateReactionPurgeMessages` for rationale.
  sharedSeenIds?: Set<string>,
  // Optional shared thread-mutation guard registry. When provided, the
  // function routes un-archive/re-archive through the registry keyed by
  // each message's own channel_id — so cross-channel hits landing in
  // archived sibling threads get un-archived correctly (rather than
  // only the outer function-scope `channelId`).
  guardRegistry?: ThreadMutationGuardRegistry,
): Promise<ReactionPurgeResult> {
  const discordService = getDiscordService();
  let totalScanned = 0;
  let totalCleared = 0;
  let totalFailed = 0;
  let lastProgressDispatch = 0;
  let fetchPageCount = 0;

  const guard = await createThreadMutationGuard(
    channelId, isArchivedThread, token, dispatch,
  );

  try {
    dispatch(addStatusEntry({
      level: 'info',
      message: hasAnyFilter(filterOverrides)
        ? `Scanning filtered messages for reactions to clear…`
        : `Scanning messages for reactions to clear…`,
    }));

    for await (const { scanned, filtered } of iterateReactionPurgeMessages(
      channelId, guildId, token, getState, dispatch, filterOverrides, searchDelay, delayModifier, sharedSeenIds,
    )) {
      fetchPageCount++;
      const withReactions = filtered.filter((m) => m.reactions && m.reactions.length > 0).length;
      const filterSuffix = hasAnyFilter(filterOverrides)
        ? t('status.purge.filterSuffix', { count: filtered.length })
        : '';
      if (withReactions > 0) {
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.scanBatch', { batch: fetchPageCount, scanned, withReactions, suffix: filterSuffix }),
        }));
      } else if (fetchPageCount === 1 || fetchPageCount % 5 === 0) {
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.scanBatchNone', { batch: fetchPageCount, scanned: totalScanned + scanned, suffix: filterSuffix }),
        }));
      }

      for (const msg of filtered) {
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) break;

        totalScanned++;

        if (msg.reactions && msg.reactions.length > 0) {
          // Cross-channel routing: around-fetch can yield messages from
          // threads within the parent channel (Discord search behavior).
          // Use the message's own channel_id so the DELETE hits the
          // correct endpoint and not the function-scope parent.
          const targetChannelId = msg.channel_id || channelId;

          // Lazy un-archive — only pay the un-archive PATCH when we've
          // actually found a message that needs clearing. Threads that
          // scan clean stay archived (saves 2 API calls per thread).
          // When a registry is supplied, look up the per-channel guard
          // so cross-channel hits landing in archived sibling threads
          // get un-archived (otherwise the outer `guard` bound to
          // `channelId` can't help).
          const effectiveGuard = guardRegistry
            ? guardRegistry.getGuard(targetChannelId)
            : guard;
          const canMutate = await effectiveGuard.ensureUnarchived();
          if (!canMutate) {
            totalFailed++;
            continue;
          }

          const emojiCount = msg.reactions.length;
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.purge.clearingReactions', { count: emojiCount }),
          }));
          const delResp = await discordService.deleteAllReactionsFromMessage(token, targetChannelId, msg.id);
          if (delResp.success) {
            totalCleared++;
          } else {
            totalFailed++;
            dispatch(addStatusEntry({
              level: 'warning',
              message: t('status.purge.clearFailed', { reason: t('status.purge.httpStatus', { status: delResp.status ?? '?' }), id: msg.id }),
            }));
          }

          const { delayMs } = calculateRandomDelay(deleteDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayMs, getState);
          if (wasCancelled) break;
        }

        if (totalScanned - lastProgressDispatch >= PROGRESS_THROTTLE_REACTIONS) {
          lastProgressDispatch = totalScanned;
          onProgress(totalScanned, totalCleared);
        }
      }
    }

    onProgress(totalScanned, totalCleared);
    return { scanned: totalScanned, reactionsRemoved: totalCleared, failed: totalFailed };
  } finally {
    await guard.cleanup();
  }
}

/**
 * Remove reactions from a single channel using cursor-based pagination.
 */
async function purgeChannelReactions(
  channelId: string,
  targetUserIds: string[],
  currentUserId: string | undefined,
  token: string,
  getState: () => RootState,
  dispatch: (action: any) => void,
  deleteDelay: number,
  searchDelay: number,
  delayModifier: number,
  onProgress: (scanned: number, reactionsRemoved: number) => void,
  // Archived threads reject DELETE /reactions with 400 code 50083. Caller
  // sets this when `channelId` points to an archived thread so we un-archive
  // up-front and re-archive on exit.
  isArchivedThread: boolean = false,
  // Guild context — required by the search-endpoint when narrowing via
  // FilterModal. DM callers pass null and land in the list-endpoint path.
  guildId: string | null = null,
  // Optional FilterModal-sourced narrowing. When set, only messages
  // matching the filter are scanned — useful for targeting reactions on
  // messages by specific authors, within date ranges, etc. The existing
  // `targetUserIds` (reactor picker) is independent of this filter and
  // still selects whose reactions to remove from each matching message.
  filterOverrides: SearchCriteria | null | undefined = null,
  // Optional shared dedup set across parent-channel + per-thread calls.
  // See `iterateReactionPurgeMessages` for rationale.
  sharedSeenIds?: Set<string>,
  // Optional shared thread-mutation guard registry — routes un-archive
  // through the message's own channel_id so cross-channel hits landing
  // in archived sibling threads get un-archived correctly.
  guardRegistry?: ThreadMutationGuardRegistry,
): Promise<ReactionPurgeResult> {
  const discordService = getDiscordService();
  const targetSet = new Set(targetUserIds);
  // When only targeting the current user, use the `me` flag to skip reactions
  // the user hasn't reacted to — avoids fetching the full reactor list
  const canUseMe = targetUserIds.length === 1 && targetUserIds[0] === currentUserId;
  let totalScanned = 0;
  let totalReactionsRemoved = 0;
  let totalFailed = 0;
  let lastProgressDispatch = 0;
  let fetchPageCount = 0;

  // Snapshot the in-flight accumulator at any cancel-throw site so the
  // caller's catch can recover work-already-done (#140) instead of
  // dropping it on the floor when control jumps to the catch.
  const partialReactions = (): ReactionPurgeResult => ({
    scanned: totalScanned,
    reactionsRemoved: totalReactionsRemoved,
    failed: totalFailed,
  });

  const guard = await createThreadMutationGuard(
    channelId, isArchivedThread, token, dispatch,
  );

  try {
  const filtered = hasAnyFilter(filterOverrides);
  dispatch(addStatusEntry({
    level: 'info',
    message: filtered
      ? `Scanning filtered messages for matching reactions from ${targetUserIds.length} user${targetUserIds.length === 1 ? '' : 's'}…`
      : `Scanning messages for matching reactions from ${targetUserIds.length} user${targetUserIds.length === 1 ? '' : 's'}…`,
  }));

  for await (const { scanned, filtered } of iterateReactionPurgeMessages(
    channelId, guildId, token, getState, dispatch, filterOverrides, searchDelay, delayModifier, sharedSeenIds,
  )) {
    if (checkCancelled(getState)) throw new CancelledError(partialReactions());

    fetchPageCount++;
    const withReactions = filtered.filter((m) => m.reactions && m.reactions.length > 0).length;
    const filterSuffix = hasAnyFilter(filterOverrides)
      ? t('status.purge.filterSuffix', { count: filtered.length })
      : '';
    if (withReactions > 0) {
      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.purge.scanBatch', { batch: fetchPageCount, scanned, withReactions, suffix: filterSuffix }),
      }));
    } else if (fetchPageCount === 1 || fetchPageCount % 5 === 0) {
      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.purge.scanBatchNone', { batch: fetchPageCount, scanned: totalScanned + scanned, suffix: filterSuffix }),
      }));
    }

    // Every GET /reactions must be preceded by a delay. Set after each
    // lookup, cleared by any delay that ran since (delete delay, page
    // delay), so emojis and messages with no matching reactors no longer
    // fire back to back (2.1.3 pacing audit).
    let reactorLookupPending = false;

    for (const message of filtered) {
      await waitWhilePaused(getState);
      if (checkCancelled(getState)) throw new CancelledError(partialReactions());

      totalScanned++;

      // Cross-channel routing — around-fetch may return messages that
      // actually live in a thread of this channel (Discord's guild-level
      // search returns thread-hosted hits). Using the function's
      // `channelId` for the reactor + delete calls 404s in that case
      // (every GET /channels/{parentId}/messages/{threadMsgId}/reactions
      // fails). Route through the message's own channel_id to hit the
      // right endpoint — matches `targetChannelId` in messages-mode purge.
      const targetChannelId = message.channel_id || channelId;

      if (message.reactions && message.reactions.length > 0) {
        for (const reaction of message.reactions) {
          // Skip emojis the current user hasn't reacted to (when only targeting self)
          if (canUseMe && reaction.me === false) continue;

          const emojiStr = formatEmojiForApi(reaction.emoji);

          // Paginate through all reactors for this emoji
          let reactorLastId: string | null = null;
          let hasMoreReactors = true;

          while (hasMoreReactors) {
            if (reactorLookupPending) {
              const lookupDelay = calculateRandomDelay(searchDelay, delayModifier);
              const wasCancelled = await cancellableDelay(lookupDelay.delayMs, getState);
              if (wasCancelled) throw new CancelledError(partialReactions());
            }
            const reactorsResponse = await discordService.getReactions(
              token,
              targetChannelId,
              message.id,
              emojiStr,
              ReactionType.NORMAL,
              reactorLastId,
            );
            reactorLookupPending = true;

            if (!reactorsResponse.success || !reactorsResponse.data || reactorsResponse.data.length === 0) {
              hasMoreReactors = false;
              break;
            }

            const reactors = reactorsResponse.data;

            for (const reactor of reactors) {
              if (targetSet.has(reactor.id)) {
                await waitWhilePaused(getState);
                if (checkCancelled(getState)) throw new CancelledError(partialReactions());

                // Lazy un-archive — only pay the PATCH when we've
                // actually found a matching reactor. Threads with
                // reactions but no matching reactors stay archived.
                // When a registry is supplied, look up the per-channel
                // guard so cross-channel hits landing in archived
                // sibling threads get un-archived too.
                const effectiveGuard = guardRegistry
                  ? guardRegistry.getGuard(targetChannelId)
                  : guard;
                const canMutate = await effectiveGuard.ensureUnarchived();
                if (!canMutate) {
                  totalFailed++;
                  continue;
                }

                const delResp = await discordService.deleteReaction(token, targetChannelId, message.id, emojiStr, reactor.id);
                if (delResp.success) {
                  totalReactionsRemoved++;
                  dispatch(addStatusEntry({
                    level: 'info',
                    message: t('status.purge.removedReaction', { count: totalReactionsRemoved, emoji: reaction.emoji.name || '?' }),
                  }));
                } else {
                  // Real regression guard: previous versions incremented
                  // the counter and logged "Removed" even on 400/403.
                  // Surface actual failures so the completion total
                  // matches what the user sees happen on Discord.
                  totalFailed++;
                  dispatch(addStatusEntry({
                    level: 'warning',
                    message: t('status.purge.removeReactionFailed', { emoji: reaction.emoji.name || '?', reason: t('status.purge.httpStatus', { status: delResp.status ?? '?' }), id: message.id }),
                  }));
                }

                const delayCalc = calculateRandomDelay(deleteDelay, delayModifier);
                const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
                if (wasCancelled) throw new CancelledError(partialReactions());
                reactorLookupPending = false;
              }
            }

            if (reactors.length < 100) {
              hasMoreReactors = false;
            } else {
              reactorLastId = reactors[reactors.length - 1].id;
              // The next page is paced by the pending-lookup delay at
              // the top of this loop.
            }
          }
        }
      }

      // Throttled milestone progress
      if (totalScanned - lastProgressDispatch >= PROGRESS_THROTTLE_REACTIONS) {
        lastProgressDispatch = totalScanned;
        onProgress(totalScanned, totalReactionsRemoved);
      }
    }
  }

  // Final progress dispatch to ensure UI reflects the last batch
  onProgress(totalScanned, totalReactionsRemoved);

  return { scanned: totalScanned, reactionsRemoved: totalReactionsRemoved, failed: totalFailed };
  } finally {
    await guard.cleanup();
  }
}

// ─── Bulk Purge Thunks ─────────────────────────────────────────────────────

interface BulkPurgeParams {
  channels: Channel[];
  config: PurgeConfig;
  guildId?: string | null;
  // Optional FilterModal-sourced narrowing for the search API
  // (content, date range, has-types, mentions). #112 — applies to
  // Messages / Attachments Only / Reactions (as message-side narrowing)
  // / Clear All Reactions (same).
  searchCriteria?: SearchCriteria | null;
}

interface BulkPurgeApi {
  dispatch: ThunkDispatch<RootState, unknown, UnknownAction>;
  getState: () => RootState;
}

interface BulkPurgeRunResult {
  errors: string[];
  cancelled: boolean;
  completedStats: {
    deleted: number;
    skipped: number;
    editedAttachmentsOnly: number;
    failed: number;
    finalPass: number;
    reactionsRemoved: number;
  };
}

const purgeModeLabel = (mode: PurgeMode) =>
  mode === 'clearReactions' ? t('status.purge.mode.clearReactions') : mode === 'reactions' ? t('status.purge.mode.reactions') : t('status.purge.mode.purge');

/**
 * The channel walk shared by `bulkPurgeChannels`, `bulkPurgeDMs` and the
 * multi-server `purgeGuilds` (#255). Runs every channel sequentially with
 * pause/cancel support and returns the aggregate; the thunks own the
 * lifecycle (pending/fulfilled/rejected) so one operation stays one
 * operation however many servers it spans. Throws before any request when
 * the run cannot start (no token, no target users); the thunks turn that
 * into a rejection.
 */
const executeBulkPurge = async (
  params: BulkPurgeParams,
  { dispatch, getState }: BulkPurgeApi,
  serverContext?: ServerPurgeContext,
): Promise<BulkPurgeRunResult> => {
    const { channels, config, guildId, searchCriteria: filterCriteria } = params;
    const { mode, targetUserIds, retainAttachedMedia, deleteAttachmentsOnly, systemMessageTypesToDelete, skipArchivedThreads, preserveMediaAndLinks } = config;
    const errors: string[] = [];
    const isDm = !guildId;
    const isReactionsMode = mode === 'reactions';
    const isClearReactionsMode = mode === 'clearReactions';
    const modeLabel = purgeModeLabel(mode);

    if (!serverContext) {
      dispatch(showOperationTip('Purge Operation Queued'));
    }

    // Snapshot delay settings at start
    const initialState = getState();
    const token = selectAuthToken(initialState);
    if (!token) throw new Error('Not authenticated');

    const searchDelay = selectSearchDelay(initialState);
    const deleteDelay = selectDeleteDelay(initialState);
    const delayModifier = selectDelayModifier(initialState);

    // In DM messages mode, only current user's messages can be deleted
    const currentUser = selectCurrentUser(initialState);
    const effectiveUserIds = isDm && !isReactionsMode && !isClearReactionsMode
      ? (currentUser?.id ? [currentUser.id] : [])
      : targetUserIds;

    if (effectiveUserIds.length === 0 && !isClearReactionsMode) {
      throw new Error('No target users specified');
    }

    // Accumulated stats across all channels
    const completedStats = {
      deleted: 0,
      skipped: 0,
      editedAttachmentsOnly: 0,
      failed: 0,
      finalPass: 0,
      reactionsRemoved: 0,
    };

    dispatch(addStatusEntry({
      level: 'info',
      message: serverContext
        ? `${modeLabel}: ${serverContext.name} · ${channels.length} channel${channels.length !== 1 ? 's' : ''} to process`
        : `${modeLabel}: Starting operation across ${channels.length} ${isDm ? 'conversation' : 'channel'}${channels.length !== 1 ? 's' : ''}`,
    }));

    try {
      // Thread discovery for guild channels only
      let threadMap: Map<string, Channel[]> | undefined;
      if (guildId) {
        threadMap = await discoverThreadsForChannels(
          channels,
          guildId,
          token,
          getState,
          dispatch,
          searchDelay,
          delayModifier,
        );
      }

      for (let i = 0; i < channels.length; i++) {
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) break;

        const channel = channels[i];
        const channelName = getChannelDisplayName(channel, isDm);

        const bulkContext: BulkPurgeContext = {
          currentIndex: i,
          totalChannels: channels.length,
          currentChannelName: channelName,
          completedStats: { ...completedStats },
          ...(serverContext ? { server: serverContext } : {}),
        };

        const channelThreads = threadMap?.get(channel.id);
        const threadInfo = channelThreads?.length ? t('status.purge.threadsDiscovered', { count: channelThreads.length }) : '';
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.startingChannel', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, index: i + 1, total: channels.length, threads: threadInfo }),
        }));

        // Initialize progress for this channel
        dispatch(setPurgeProgress({
          processed: 0,
          deleted: 0,
          skipped: 0,
          editedAttachmentsOnly: 0,
          reactionsRemoved: 0,
          bulk: bulkContext,
        }));

        // Shared dedup across parent + its threads. Parent search can
        // surface thread-hosted hits whose around-fetch populates this
        // set; the subsequent per-thread pass then skips those already
        // seen IDs instead of duplicating the around-call. Rebuilt per
        // channel so unrelated channels don't cross-pollute.
        const sharedSeenIds = new Set<string>();

        // Shared thread-mutation guard registry spanning parent + its
        // threads. Handles the cross-channel archived-thread case:
        // parent search surfaces a hit in an archived sibling thread,
        // around-fetch routes to that thread's channel_id, and the
        // registry un-archives + re-archives it correctly. Without
        // this, DELETE would fail with 400 code 50083 and the
        // reaction would be lost.
        // Declared outside the try so the finally clause can cleanup.
        const allChannelThreads = threadMap?.get(channel.id) ?? [];
        const archivedChannelIds = new Set(
          allChannelThreads
            .filter((t) => t.thread_metadata?.archived === true)
            .map((t) => t.id),
        );
        // #233 (reactions family only): with the opt-out on, archived
        // threads are dropped from the per-thread pass up-front (scanning
        // them only to skip is wasted API budget). Messages mode instead
        // keeps them in the search so every skipped message is counted.
        // The registry keeps the FULL archived set so cross-channel hits
        // landing in archived siblings are skipped quietly via skipWaking
        // instead of un-archived.
        const dropArchivedThreads =
          !!skipArchivedThreads && (isReactionsMode || isClearReactionsMode);
        const threads = dropArchivedThreads
          ? allChannelThreads.filter((t) => t.thread_metadata?.archived !== true)
          : allChannelThreads;
        if (dropArchivedThreads && threads.length < allChannelThreads.length) {
          const skippedCount = allChannelThreads.length - threads.length;
          dispatch(addStatusEntry({
            level: 'info',
            message: t('status.purge.leavingArchivedInChannel', { count: skippedCount, name: `${isDm ? '' : '#'}${channelName}` }),
          }));
        }
        const guardRegistry = createThreadMutationGuardRegistry(
          token, dispatch, archivedChannelIds, skipArchivedThreads,
        );

        try {
          if (isClearReactionsMode) {
            let milestoneBoundary = nextMilestone(0);

            const result = await purgeChannelClearAllReactions(
              channel.id,
              token,
              getState,
              dispatch,
              deleteDelay,
              searchDelay,
              delayModifier,
              (scanned, reactionsCleared) => {
                dispatch(setPurgeProgress({
                  processed: scanned,
                  deleted: 0,
                  skipped: 0,
                  editedAttachmentsOnly: 0,
                  reactionsRemoved: reactionsCleared,
                  bulk: bulkContext,
                }));
                if (scanned >= milestoneBoundary) {
                  milestoneBoundary = nextMilestone(scanned);
                  dispatch(addStatusEntry({
                    level: 'info',
                    message: t('status.purge.channelClearedProgress', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, scanned, cleared: reactionsCleared }),
                  }));
                }
              },
              false, // top-level channel, not an archived thread
              guildId || null,
              filterCriteria,
              sharedSeenIds,
              guardRegistry,
            );

            // Process threads
            let threadReactionsCleared = 0;
            if (threads.length > 0) {
              dispatch(addStatusEntry({
                level: 'info',
                message: t('status.purge.processingThreads', { count: threads.length, name: `${isDm ? '' : '#'}${channelName}` }),
              }));
            }
            let threadFailedClears = 0;
            for (const thread of threads) {
              const threadResult = await purgeChannelClearAllReactions(
                thread.id,
                token,
                getState,
                dispatch,
                deleteDelay,
                searchDelay,
                delayModifier,
                (scanned, reactionsCleared) => {
                  dispatch(setPurgeProgress({
                    processed: result.scanned + scanned,
                    deleted: 0,
                    skipped: 0,
                    editedAttachmentsOnly: 0,
                    reactionsRemoved: result.reactionsRemoved + reactionsCleared,
                    bulk: bulkContext,
                  }));
                },
                thread.thread_metadata?.archived === true,
                guildId || null,
                filterCriteria,
                sharedSeenIds,
                guardRegistry,
              );
              threadReactionsCleared += threadResult.reactionsRemoved;
              threadFailedClears += threadResult.failed;
            }

            const totalCleared = result.reactionsRemoved + threadReactionsCleared;
            const totalFailedClears = result.failed + threadFailedClears;
            completedStats.reactionsRemoved += totalCleared;

            const failedSuffix = totalFailedClears > 0
              ? t('status.purge.failedSuffix', { count: totalFailedClears })
              : '';
            dispatch(addStatusEntry({
              level: totalFailedClears > 0 ? 'warning' : 'success',
              message: t('status.purge.completedCleared', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, count: totalCleared, failed: failedSuffix }),
            }));
          } else if (isReactionsMode) {
            let milestoneBoundary = nextMilestone(0);

            const result = await purgeChannelReactions(
              channel.id,
              effectiveUserIds,
              currentUser?.id,
              token,
              getState,
              dispatch,
              deleteDelay,
              searchDelay,
              delayModifier,
              (scanned, reactionsRemoved) => {
                dispatch(setPurgeProgress({
                  processed: scanned,
                  deleted: 0,
                  skipped: 0,
                  editedAttachmentsOnly: 0,
                  reactionsRemoved,
                  bulk: bulkContext,
                }));
                // Log milestones
                if (scanned >= milestoneBoundary) {
                  milestoneBoundary = nextMilestone(scanned);
                  dispatch(addStatusEntry({
                    level: 'info',
                    message: t('status.purge.channelReactionsProgress', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, scanned, removed: reactionsRemoved }),
                  }));
                }
              },
              false, // top-level channel, not an archived thread
              guildId || null,
              filterCriteria,
              sharedSeenIds,
              guardRegistry,
            );

            // Process threads in reactions mode
            let threadReactionsRemoved = 0;
            if (threads.length > 0) {
              dispatch(addStatusEntry({
                level: 'info',
                message: t('status.purge.processingThreads', { count: threads.length, name: `${isDm ? '' : '#'}${channelName}` }),
              }));
            }
            let threadFailedRemoves = 0;
            for (const thread of threads) {
              const threadResult = await purgeChannelReactions(
                thread.id,
                effectiveUserIds,
                currentUser?.id,
                token,
                getState,
                dispatch,
                deleteDelay,
                searchDelay,
                delayModifier,
                (scanned, reactionsRemoved) => {
                  dispatch(setPurgeProgress({
                    processed: result.scanned + scanned,
                    deleted: 0,
                    skipped: 0,
                    editedAttachmentsOnly: 0,
                    reactionsRemoved: result.reactionsRemoved + reactionsRemoved,
                    bulk: bulkContext,
                  }));
                },
                thread.thread_metadata?.archived === true,
                guildId || null,
                filterCriteria,
                sharedSeenIds,
                guardRegistry,
              );
              threadReactionsRemoved += threadResult.reactionsRemoved;
              threadFailedRemoves += threadResult.failed;
            }

            const totalChannelReactions = result.reactionsRemoved + threadReactionsRemoved;
            const totalFailedRemoves = result.failed + threadFailedRemoves;
            completedStats.reactionsRemoved += totalChannelReactions;

            const removeFailedSuffix = totalFailedRemoves > 0
              ? t('status.purge.failedSuffix', { count: totalFailedRemoves })
              : '';
            dispatch(addStatusEntry({
              level: totalFailedRemoves > 0 ? 'warning' : 'success',
              message: t('status.purge.completedReactions', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, count: totalChannelReactions, failed: removeFailedSuffix }),
            }));
          } else {
            let milestoneBoundary = nextMilestone(0);

            // Get thread IDs for this channel (messages mode — included in search criteria)
            const channelThreads = threadMap?.get(channel.id) ?? [];
            const channelThreadIds = channelThreads.map((t) => t.id);
            // Set of thread IDs whose metadata says archived. PATCH/DELETE
            // against archived threads always 400s (code 50083), so we
            // skip pre-emptively rather than burning per-message retries.
            const archivedThreadIds = new Set(
              channelThreads
                .filter((t) => t.thread_metadata?.archived === true)
                .map((t) => t.id),
            );

            const result = await purgeChannelMessages(
              channel.id,
              guildId || null,
              effectiveUserIds,
              retainAttachedMedia,
              deleteAttachmentsOnly,
              currentUser?.id,
              filterCriteria,
              token,
              getState,
              dispatch,
              deleteDelay,
              searchDelay,
              delayModifier,
              (processed, deleted, skipped, editedAttachmentsOnly, failed) => {
                dispatch(setPurgeProgress({
                  processed,
                  deleted,
                  skipped,
                  editedAttachmentsOnly,
                  failed,
                  reactionsRemoved: 0,
                  bulk: bulkContext,
                }));
                // Log milestones
                if (processed >= milestoneBoundary) {
                  milestoneBoundary = nextMilestone(processed);
                  const detail = formatPurgeDetail(
                    deleted,
                    skipped,
                    editedAttachmentsOnly,
                    failed,
                  );
                  dispatch(addStatusEntry({
                    level: 'info',
                    message: t('status.purge.channelProcessed', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, processed, detail }),
                  }));
                }
              },
              channelThreadIds,
              archivedThreadIds,
              `${isDm ? '' : '#'}${channelName}`,
              systemMessageTypesToDelete,
              skipArchivedThreads,
              preserveMediaAndLinks,
            );

            if (
              result.deleted === 0 &&
              result.skipped === 0 &&
              result.editedAttachmentsOnly === 0 &&
              result.failed === 0
            ) {
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.purge.noTargetMessages', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}` }),
              }));
            } else {
              completedStats.deleted += result.deleted;
              completedStats.skipped += result.skipped;
              completedStats.editedAttachmentsOnly += result.editedAttachmentsOnly;
              completedStats.failed += result.failed;
              completedStats.finalPass += result.finalPass;

              const detail = formatPurgeDetail(
                result.deleted,
                result.skipped,
                result.editedAttachmentsOnly,
                result.failed,
                undefined,
                result.finalPass,
              );
              dispatch(addStatusEntry({
                level: result.failed > 0 ? 'warning' : 'success',
                message: t('status.purge.completedDetail', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, detail }),
              }));
            }
          }
        } catch (error) {
          if (error instanceof CancelledError) {
            // Recover the in-flight accumulator from the cancelled call
            // (#140) so the final summary reflects work that actually
            // happened before the cancel signal — without this, a
            // mid-channel cancel reports zero even when N reactions /
            // messages were really removed.
            const partial = error.partialResult as
              | (Partial<ChannelPurgeResult> & Partial<ReactionPurgeResult>)
              | undefined;
            if (partial) {
              if (typeof partial.deleted === 'number') {
                completedStats.deleted += partial.deleted;
              }
              if (typeof partial.skipped === 'number') {
                completedStats.skipped += partial.skipped;
              }
              if (typeof partial.editedAttachmentsOnly === 'number') {
                completedStats.editedAttachmentsOnly += partial.editedAttachmentsOnly;
              }
              if (typeof partial.failed === 'number') {
                completedStats.failed += partial.failed;
              }
              if (typeof partial.finalPass === 'number') {
                completedStats.finalPass += partial.finalPass;
              }
              if (typeof partial.reactionsRemoved === 'number') {
                completedStats.reactionsRemoved += partial.reactionsRemoved;
              }
            }
            break;
          }
          const errorMsg = error instanceof Error ? error.message : t('status.purge.unknownError');
          errors.push(`${channelName}: ${errorMsg}`);
          dispatch(addStatusEntry({
            level: 'error',
            message: t('status.purge.errorProcessing', { mode: modeLabel, name: `${isDm ? '' : '#'}${channelName}`, error: errorMsg }),
          }));
        } finally {
          // Re-archive every thread the registry un-archived — runs on
          // success, error, and cancellation paths so we never leave
          // a channel's thread state unintentionally changed. Safe to
          // call even when only messages-mode ran (registry stays empty
          // so cleanup is a no-op).
          await guardRegistry.cleanupAll();
        }

        // Delay between channels
        if (i < channels.length - 1) {
          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
          if (wasCancelled) break;
        }
      }

      // Final summary
      const wasCancelled = checkCancelled(getState);
      const totalDetail = formatPurgeDetail(
        completedStats.deleted,
        completedStats.skipped,
        completedStats.editedAttachmentsOnly,
        completedStats.failed,
        'messages',
        completedStats.finalPass,
      );
      if (wasCancelled) {
        if (isReactionsMode) {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.cancelledReactions', { mode: modeLabel, count: completedStats.reactionsRemoved }),
          }));
        } else {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.cancelledDetail', { mode: modeLabel, detail: totalDetail }),
          }));
        }
      } else {
        // Normalize grammar to match kickoff + per-channel entries:
        //   "Reaction purge: Starting operation across 8 channels"   (start)
        //   "Reaction purge: Completed #general — 3 reactions removed" (per-ch)
        //   "Reaction purge: Complete — 8 channels, 7 reactions removed" (final)
        const completeLabel = serverContext ? t('status.purge.serverComplete', { name: serverContext.name }) : t('status.purge.complete');
        if (isReactionsMode) {
          dispatch(addStatusEntry({
            level: 'success',
            message: t('status.purge.completeReactions', { mode: modeLabel, label: completeLabel, scope: t('status.purge.scope', { count: channels.length, context: isDm ? 'dm' : 'channel' }), count: completedStats.reactionsRemoved }),
          }));
        } else {
          dispatch(addStatusEntry({
            level: 'success',
            message: t('status.purge.completeDetail', { mode: modeLabel, label: completeLabel, scope: t('status.purge.scope', { count: channels.length, context: isDm ? 'dm' : 'channel' }), detail: totalDetail }),
          }));
        }

        // If the user is still looking at a channel that was part of the
        // target set, the loaded feed is now a stale snapshot. Surface a
        // toast with a one-click "Reload feed" action. Checking at
        // completion time means a user who navigated away during the
        // purge correctly gets no toast.
        const selectedChannel = selectSelectedChannel(getState());
        if (selectedChannel && channels.some((c) => c.id === selectedChannel.id)) {
          dispatch(showToast({
            level: 'success',
            message: t('status.purge.completeToast', { mode: modeLabel }),
            duration: 10000,
            action: { type: 'reloadChannel', channelId: selectedChannel.id, label: 'Reload feed' },
          }));
        }
      }

      return { errors, cancelled: wasCancelled, completedStats };
    } catch (error) {
      dispatch(addStatusEntry({
        level: 'error',
        message: t('status.purge.failedToast', { mode: modeLabel, error: error instanceof Error ? error.message : t('status.purge.unknownError') }),
      }));
      throw error;
    }
};

/**
 * Bulk purge channels (server context).
 * Processes channels sequentially with pause/cancel support.
 */
export const bulkPurgeChannels = createAsyncThunk<
  { success: true; errors?: string[] },
  BulkPurgeParams,
  { state: RootState; rejectValue: string }
>(
  'purge/bulkPurgeChannels',
  async (params, { rejectWithValue, dispatch, getState }) => {
    try {
      const { errors } = await executeBulkPurge(params, { dispatch, getState });
      return errors.length > 0 ? { success: true, errors } : { success: true };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to bulk purge',
      );
    }
  },
);

export interface PurgeGuildsParams {
  guilds: Guild[];
  config: PurgeConfig;
  searchCriteria?: SearchCriteria | null;
}

/**
 * Multi-server purge (#255). For each selected server, in order: load its
 * channel list, keep the message-bearing channels the user can read, then
 * run the same per-channel walk single-server purges use. One operation
 * (one pending/fulfilled), one pause/cancel, the same pacing per request.
 * A server whose channels cannot be loaded is reported and skipped; the
 * run continues with the next one. Cancel finishes the current channel
 * and stops.
 */
export const purgeGuilds = createAsyncThunk<
  { success: true; errors?: string[] },
  PurgeGuildsParams,
  { state: RootState; rejectValue: string }
>(
  'purge/purgeGuilds',
  async ({ guilds, config, searchCriteria }, { rejectWithValue, dispatch, getState, signal }) => {
    const modeLabel = purgeModeLabel(config.mode);
    const initialState = getState();
    const token = selectAuthToken(initialState);
    if (!token) return rejectWithValue('Not authenticated');
    const currentUserId = selectCurrentUser(initialState)?.id;
    if (guilds.length === 0) return rejectWithValue('No servers selected');
    if (config.targetUserIds.length === 0 && config.mode !== 'clearReactions') {
      return rejectWithValue('No target users specified');
    }

    dispatch(showOperationTip('Purge Operation Queued'));
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.purge.startingServers', { mode: modeLabel, count: guilds.length }),
    }));

    const searchDelay = selectSearchDelay(initialState);
    const delayModifier = selectDelayModifier(initialState);
    const discordService = getDiscordService();
    const errors: string[] = [];
    const totals = { deleted: 0, skipped: 0, editedAttachmentsOnly: 0, failed: 0, finalPass: 0, reactionsRemoved: 0 };
    let serversProcessed = 0;
    let cancelled = false;

    try {
      for (let i = 0; i < guilds.length; i++) {
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) { cancelled = true; break; }

        const guild = guilds[i];
        const serverContext: ServerPurgeContext = { name: guild.name, index: i, total: guilds.length };
        dispatch(addStatusEntry({
          level: 'info',
          message: t('status.purge.serverHeader', { mode: modeLabel, index: i + 1, total: guilds.length, name: guild.name }),
        }));

        // Channel discovery. Transient failures retry with backoff; a hard
        // failure (403 on a server the token cannot see any more, etc.)
        // is recorded and the run moves on.
        const channelsResponse = await withTransientRetry(
          () => discordService.fetchChannels(token, guild.id),
          {
            getState,
            signal,
            onRetry: (attempt, delayMs) => {
              dispatch(addStatusEntry({
                level: 'warning',
                message: t('status.purge.channelsRetry', { mode: modeLabel, name: guild.name, seconds: Math.round(delayMs / 1000), attempt }),
              }));
            },
          },
        );
        if (!channelsResponse.success || !channelsResponse.data) {
          const detail = t('status.purge.couldNotLoadChannels', { status: channelsResponse.status ?? 'unknown' });
          errors.push(`${guild.name}: ${detail}`);
          dispatch(addStatusEntry({ level: 'error', message: t('status.purge.serverSkipped', { mode: modeLabel, name: guild.name, detail }) }));
          continue;
        }

        // Member roles feed the per-channel permission check (overwrites).
        // A miss is not fatal: canAccessChannel falls back to the guild
        // level permissions the guild list already carries.
        let memberRoles: string[] = [];
        if (currentUserId) {
          const memberResponse = await withTransientRetry(
            () => discordService.fetchGuildUser(guild.id, currentUserId, token),
            { getState, signal, maxRetries: 2 },
          );
          if (memberResponse.success && memberResponse.data) {
            memberRoles = memberResponse.data.roles ?? [];
          }
        }

        const channels = (channelsResponse.data as Channel[]).filter(
          (channel) =>
            isMessageChannel(channel)
            && canAccessChannel(guild.permissions, memberRoles, channel, guild.id, currentUserId),
        );
        if (channels.length === 0) {
          dispatch(addStatusEntry({ level: 'info', message: t('status.purge.noReadableChannels', { mode: modeLabel, name: guild.name }) }));
          serversProcessed += 1;
          continue;
        }

        // A failure that escapes the channel walk (its own per-channel
        // handling covers the usual cases) must not end the whole run:
        // record it against the server and continue with the next one.
        let result: BulkPurgeRunResult;
        try {
          result = await executeBulkPurge(
            { channels, config, guildId: guild.id, searchCriteria },
            { dispatch, getState },
            serverContext,
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : t('status.purge.unknownError');
          errors.push(`${guild.name}: ${detail}`);
          dispatch(addStatusEntry({ level: 'error', message: t('status.purge.serverStoppedEarly', { mode: modeLabel, name: guild.name, detail }) }));
          continue;
        }
        serversProcessed += 1;
        errors.push(...result.errors.map((e) => `${guild.name} › ${e}`));
        totals.deleted += result.completedStats.deleted;
        totals.skipped += result.completedStats.skipped;
        totals.editedAttachmentsOnly += result.completedStats.editedAttachmentsOnly;
        totals.failed += result.completedStats.failed;
        totals.finalPass += result.completedStats.finalPass;
        totals.reactionsRemoved += result.completedStats.reactionsRemoved;
        if (result.cancelled) { cancelled = true; break; }

        // Delay between servers — same cadence as between channels.
        if (i < guilds.length - 1) {
          const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
          if (wasCancelled) { cancelled = true; break; }
        }
      }

      const detail = config.mode === 'messages'
        ? formatPurgeDetail(totals.deleted, totals.skipped, totals.editedAttachmentsOnly, totals.failed, 'messages', totals.finalPass)
        : t('status.purge.reactionsRemovedDetail', { count: totals.reactionsRemoved });
      const serverCount = t('status.purge.serverCount', { processed: serversProcessed, count: guilds.length });
      if (cancelled || checkCancelled(getState)) {
        dispatch(addStatusEntry({ level: 'warning', message: t('status.purge.serversCancelled', { mode: modeLabel, servers: serverCount, detail }) }));
      } else {
        dispatch(addStatusEntry({ level: 'success', message: t('status.purge.serversComplete', { mode: modeLabel, servers: serverCount, detail }) }));
      }
      return errors.length > 0 ? { success: true, errors } : { success: true };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to purge servers',
      );
    }
  },
);

/**
 * Bulk purge DM channels.
 * Delegates to the same logic as bulkPurgeChannels with guildId=null.
 */
export const bulkPurgeDMs = createAsyncThunk<
  { success: true; errors?: string[] },
  Omit<BulkPurgeParams, 'guildId'>,
  { state: RootState; rejectValue: string }
>(
  'purge/bulkPurgeDMs',
  async (params, thunkApi) => {
    // Delegate to bulkPurgeChannels with no guildId
    const result = await thunkApi.dispatch(
      bulkPurgeChannels({ ...params, guildId: null }),
    );
    if (bulkPurgeChannels.rejected.match(result)) {
      return thunkApi.rejectWithValue(result.payload as string);
    }
    return result.payload as { success: true; errors?: string[] };
  },
);

// ─── Slice ──────────────────────────────────────────────────────────────────

const purgeSlice = createSlice({
  name: 'purge',
  initialState: initialPurgeState,
  reducers: {
    setPurgeProgress: (state, action: PayloadAction<PurgeProgress>) => {
      state.purgeProgress = action.payload;
    },
    resetPurge: (state) => {
      state.isPurging = false;
      state.purgeProgress = null;
      state.purgeError = null;
      state.channelErrorCount = 0;
    },
  },
  extraReducers: (builder) => {
    builder
      // Bulk purge channels
      .addCase(bulkPurgeChannels.pending, (state) => {
        state.isPurging = true;
        state.purgeError = null;
        state.purgeProgress = null;
        state.channelErrorCount = 0;
      })
      .addCase(bulkPurgeChannels.fulfilled, (state, action) => {
        state.isPurging = false;
        state.channelErrorCount = action.payload.errors?.length ?? 0;
      })
      .addCase(bulkPurgeChannels.rejected, (state, action) => {
        state.isPurging = false;
        state.purgeError = action.payload as string;
      })
      // Bulk purge DMs (delegates to bulkPurgeChannels, but has its own lifecycle)
      .addCase(bulkPurgeDMs.pending, (state) => {
        state.isPurging = true;
        state.purgeError = null;
        state.purgeProgress = null;
        state.channelErrorCount = 0;
      })
      .addCase(bulkPurgeDMs.fulfilled, (state, action) => {
        state.isPurging = false;
        state.channelErrorCount = action.payload.errors?.length ?? 0;
      })
      .addCase(bulkPurgeDMs.rejected, (state, action) => {
        state.isPurging = false;
        state.purgeError = action.payload as string;
      })
      // Multi-server purge (#255) — one lifecycle for the whole run
      .addCase(purgeGuilds.pending, (state) => {
        state.isPurging = true;
        state.purgeError = null;
        state.purgeProgress = null;
        state.channelErrorCount = 0;
      })
      .addCase(purgeGuilds.fulfilled, (state, action) => {
        state.isPurging = false;
        state.channelErrorCount = action.payload.errors?.length ?? 0;
      })
      .addCase(purgeGuilds.rejected, (state, action) => {
        state.isPurging = false;
        state.purgeError = action.payload as string;
      });
  },
});

export const { setPurgeProgress, resetPurge } = purgeSlice.actions;

export const selectPurge = (state: RootState) => state.purge;
export const selectIsPurging = (state: RootState) => state.purge.isPurging;
export const selectPurgeProgress = (state: RootState) => state.purge.purgeProgress;
export const selectPurgeError = (state: RootState) => state.purge.purgeError;
export const selectPurgeChannelErrorCount = (state: RootState) => state.purge.channelErrorCount;

export default purgeSlice.reducer;
