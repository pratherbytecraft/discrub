import type { SearchMessageResult } from 'discrub-core/types/discord-types';
import type { RootState } from '@/app/store';
import type { setOperationHold } from '@features/app/appSlice';
import { cancellableDelay, withTransientRetry } from '@/utils/operationLoopUtils';
import { t } from '@/i18n';

/**
 * Single-page search requests (initial search, thread search) call the
 * search endpoint directly instead of going through the core iterator
 * that Load All uses, so until #262 they had none of its retries: a
 * 202 (Discord still building the index) read as "failed", a 5xx blip
 * was terminal, and the failure message never said what Discord
 * answered. This module gives those callers the same behavior and a
 * failure message that carries the HTTP status.
 */

/** Shape shared by the core search responses; kept structural so tests can build one inline. */
export interface SearchPageResponse {
  success: boolean;
  status?: number;
  data?: SearchMessageResult;
  rateLimited?: boolean;
}

/** How many times a 202 answer is waited out before the search gives up. */
export const INDEXING_WAITS = 5;

/** Wait before the next attempt after a 202: 1s, 2s, 3s, ... capped at 5s. */
export const indexingWaitMs = (attempt: number): number => Math.min(1000 * attempt, 5000);

export interface SearchPageRetryOptions {
  getState: () => RootState;
  signal?: AbortSignal;
  /** Records each retry wait as the operation hold; see withTransientRetry. */
  dispatch?: (action: ReturnType<typeof setOperationHold>) => unknown;
  /** A 202 came back and the search is about to wait `delayMs` before attempt `attempt` of INDEXING_WAITS. */
  onIndexingWait?: (attempt: number, delayMs: number) => void;
  /** A transient failure is being retried (same contract as withTransientRetry's onRetry). */
  onRetry?: (attempt: number, delayMs: number) => void;
  /** Test hook: override the 202 wait schedule. */
  indexingWaitMs?: (attempt: number) => number;
  /** Test hook: base backoff for the transient retry. */
  baseDelayMs?: number;
}

/**
 * Fetch one search page with the retries the core iterator gives Load
 * All: transient failures back off through `withTransientRetry`, and a
 * 202 is waited out up to INDEXING_WAITS times. Returns the final
 * response. A 202 that never clears comes back as
 * `{ success: false, status: 202 }` so the caller reports it as a
 * failure rather than reading an absent body as an empty page. Pause,
 * Cancel and the thunk signal all interrupt the waits; the caller
 * checks for cancellation before reporting a failure.
 */
export const fetchSearchPageWithRetry = async <T extends SearchPageResponse>(
  fetchPage: () => Promise<T>,
  opts: SearchPageRetryOptions,
): Promise<T> => {
  const waitFor = opts.indexingWaitMs ?? indexingWaitMs;
  for (let indexingWaits = 0; ; indexingWaits++) {
    const response = await withTransientRetry(fetchPage, {
      getState: opts.getState,
      signal: opts.signal,
      dispatch: opts.dispatch,
      onRetry: opts.onRetry,
      baseDelayMs: opts.baseDelayMs,
    });
    if (!(response.success && response.status === 202)) return response;
    if (indexingWaits >= INDEXING_WAITS) {
      return { ...response, success: false, data: undefined } as T;
    }
    const delayMs = waitFor(indexingWaits + 1);
    opts.onIndexingWait?.(indexingWaits + 1, delayMs);
    const cancelled = await cancellableDelay(delayMs, opts.getState, opts.signal);
    if (cancelled) return { ...response, success: false, data: undefined } as T;
  }
};

/**
 * The status-log line for a search page that did not succeed. The
 * `scope` picks the thread or channel wording; the status decides the
 * reason: 202 means Discord never finished indexing, a number is the
 * HTTP status Discord answered with, and no status means the request
 * never got an answer (offline, or Discord's edge refused it).
 */
export const describeSearchFailure = (
  response: SearchPageResponse,
  scope: 'channel' | 'thread',
): string => {
  const prefix = scope === 'thread' ? 'searchThreadFailed' : 'searchFailed';
  if (response.status === 202) return t(`status.msg.${prefix}Indexing`);
  if (response.status !== undefined) return t(`status.msg.${prefix}Http`, { status: response.status });
  return t(`status.msg.${prefix}NoResponse`);
};
