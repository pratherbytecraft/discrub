import type { RootState } from '@/app/store';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import type { SearchIterationPage } from 'discrub-core/types/discrub-types';
import { getDiscordService } from '@/services/discordService';
import { selectSearchDelay, selectDelayModifier, setOperationHold } from '@features/app/appSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { t } from '@/i18n';
import { calculateRandomDelay } from './delayUtils';
import {
  cancellableDelay,
  checkCancelled,
  describeAnswer,
  isTransientApiFailure,
  retryBaseDelayMs,
  TRANSIENT_RETRIES,
  transientRetryDelayMs,
  waitWhilePaused,
} from './operationLoopUtils';

export type ReduxSearchIteratorOptions = {
  token: string;
  channelId: string | null;
  guildId: string | null;
  criteria: SearchCriteria;
  getState: () => RootState;
  /**
   * When given, a search page that fails on a network error or a 5xx is
   * retried instead of ending the walk: each wait is logged as a status
   * line and shown as the operation hold, the same as a delete retry.
   * Without it a failed page still ends the walk with a throw, as the
   * core iterator does.
   */
  dispatch?: (action: ReturnType<typeof addStatusEntry> | ReturnType<typeof setOperationHold>) => unknown;
  /** Thunk signal so a retry wait ends when the thunk is aborted. */
  signal?: AbortSignal;
};

/**
 * Redux-aware wrapper around `DiscordService.iterateSearchResults`.
 *
 * Supplies pause/cancel/delay from the store so bulk callers (export,
 * purge, thread search, etc.) can share a single pagination policy
 * without re-implementing the loop. Yields pages one at a time; callers
 * log progress, dispatch updates, and perform per-page work (e.g. delete
 * messages) in between.
 *
 * The core iterator retries a 202 (index still building) on its own but
 * throws on any other failed page, including a fetch that never got an
 * answer. Deletes retry through `withTransientRetry`; until 2.2.1 the
 * search stream did not, so one dropped request ended an overnight
 * purge with "Search request failed (HTTP ?)". A thrown page is now
 * retried on the same budget and curve as `withTransientRetry` when the
 * caller passes `dispatch`. The core iterator cannot be resumed once it
 * has thrown, so the retry recreates it with `searchBeforeDate` set to
 * the oldest message yielded so far, which is exactly where the
 * always-cap-shift walk would have continued (the pattern Load All
 * uses). Discord's `max_id` boundary can hand the frontier message back
 * once, so messages at the frontier timestamp are deduplicated across
 * a restart. Page indexes and aggregated counts stay continuous across
 * restarts so progress lines do not jump back.
 */
export async function* iterateSearchMessagesRedux(
  options: ReduxSearchIteratorOptions,
): AsyncGenerator<SearchIterationPage, void, void> {
  const { token, channelId, guildId, criteria, getState, dispatch, signal } = options;
  const service = getDiscordService();

  // Resume frontier for a restart, and the ids sitting exactly on it.
  let resumeBeforeDate: Date | null = null;
  let frontierIds = new Set<string>();
  let pageIndex = 0;
  let aggregatedCount = 0;
  let transientRetries = 0;

  const makeInner = () => service.iterateSearchResults({
    token,
    channelId,
    guildId,
    criteria: resumeBeforeDate ? { ...criteria, searchBeforeDate: resumeBeforeDate } : criteria,
    shouldStop: () => checkCancelled(getState),
    onBetweenPages: async () => {
      await waitWhilePaused(getState);
      if (checkCancelled(getState)) return true;
      const searchDelay = selectSearchDelay(getState());
      const delayModifier = selectDelayModifier(getState());
      const delayCalc = calculateRandomDelay(searchDelay, delayModifier);
      const wasCancelled = await cancellableDelay(delayCalc.delayMs, getState);
      return wasCancelled === true;
    },
  });

  restart: while (true) {
    const inner = makeInner();
    while (true) {
      let result: IteratorResult<SearchIterationPage, void>;
      try {
        result = await inner.next();
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        const stopped = signal?.aborted === true || checkCancelled(getState);
        if (
          !dispatch ||
          stopped ||
          transientRetries >= TRANSIENT_RETRIES ||
          !isTransientApiFailure({ success: false, status }, transientRetries)
        ) {
          throw err;
        }
        const delayMs = transientRetryDelayMs(transientRetries, retryBaseDelayMs(getState));
        transientRetries += 1;
        const answer = describeAnswer({ status });
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.msg.searchPageRetry', { answer, seconds: Math.round(delayMs / 1000), attempt: transientRetries }),
        }));
        dispatch(setOperationHold({ kind: 'retryWait', until: Date.now() + delayMs, attempt: transientRetries, max: TRANSIENT_RETRIES, answer }));
        // Retry now clears the hold from the UI, which ends this wait early.
        const cancelled = await cancellableDelay(delayMs, getState, signal, () => getState().app.operationHold == null);
        dispatch(setOperationHold(null));
        if (cancelled) return;
        continue restart;
      }
      if (result.done) return;

      await waitWhilePaused(getState);
      if (checkCancelled(getState)) return;

      const page = result.value;
      const fresh = frontierIds.size === 0
        ? page.messages
        : page.messages.filter((m) => !frontierIds.has(m.id));
      for (const m of fresh) {
        if (!m.timestamp) continue;
        const ts = new Date(m.timestamp);
        if (!resumeBeforeDate || ts < resumeBeforeDate) {
          resumeBeforeDate = ts;
          frontierIds = new Set([m.id]);
        } else if (ts.getTime() === resumeBeforeDate.getTime()) {
          frontierIds.add(m.id);
        }
      }
      // A page arrived, so the retry budget starts over.
      transientRetries = 0;
      aggregatedCount += fresh.length;
      yield { ...page, messages: fresh, pageIndex, aggregatedCount };
      pageIndex++;
    }
  }
}

/**
 * Milestone helper — returns the next boundary above `current` for
 * progress-log emission. Step size scales with `current` so small
 * operations get periodic feedback (otherwise a 25-message purge
 * would never log between "Searching..." and "Completed") while
 * large operations keep the original 100-step cadence to avoid
 * log spam.
 *
 * Step ladder: <25 → 5, <100 → 25, otherwise → 100.
 */
export const nextMilestone = (current: number): number => {
  const step = current < 25 ? 5 : current < 100 ? 25 : 100;
  return current === 0 ? step : current + step - (current % step);
};
