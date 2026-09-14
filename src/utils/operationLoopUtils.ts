import type { RootState } from '@/app/store';
import { selectDiscrubPaused, selectDiscrubCancelled, selectRetryWaitSeconds, setOperationHold } from '@features/app/appSlice';
import { throttleImmuneSleep } from './workerTimers';
import { t } from '@/i18n';

/**
 * Error thrown when an operation is cancelled by the user.
 *
 * Optionally carries an `partialResult` field — a snapshot of the
 * function's in-flight accumulator at the moment of the cancel
 * throw. The caller's catch block can read it to recover work
 * completed before the cancel signal (#140), e.g. so a "X reactions
 * removed" summary reflects what really happened rather than zero.
 */
export class CancelledError extends Error {
  partialResult?: unknown;
  constructor(partialResult?: unknown) {
    super('Operation cancelled');
    this.name = 'CancelledError';
    this.partialResult = partialResult;
  }
}

/**
 * Waits in a polling loop while the operation is paused.
 * Resolves immediately if not paused or when unpaused.
 * Also resolves if cancelled while paused.
 */
export const waitWhilePaused = async (getState: () => RootState): Promise<void> => {
  while (selectDiscrubPaused(getState())) {
    await throttleImmuneSleep(200);
    if (selectDiscrubCancelled(getState())) return;
  }
};

/**
 * Returns true if the operation has been cancelled.
 */
export const checkCancelled = (getState: () => RootState): boolean => {
  return selectDiscrubCancelled(getState());
};

/**
 * Waits for the specified duration in small increments, checking for
 * cancellation and pause at each step. Returns true if cancelled (by
 * either the Discrub cancel flag or, when provided, an AbortSignal).
 */
export const cancellableDelay = async (
  delayMs: number,
  getState: () => RootState,
  signal?: AbortSignal,
): Promise<boolean> => {
  const interval = 200;
  // Wall-clock accounting (#247): a chunk that oversleeps under browser
  // throttling is credited in full, so the delay never stretches past the
  // real time asked for.
  const start = Date.now();
  while (Date.now() - start < delayMs) {
    if (signal?.aborted || checkCancelled(getState)) return true;
    await waitWhilePaused(getState);
    if (signal?.aborted || checkCancelled(getState)) return true;
    const remaining = delayMs - (Date.now() - start);
    if (remaining <= 0) break;
    await throttleImmuneSleep(Math.min(interval, remaining));
  }
  return signal?.aborted || checkCancelled(getState);
};

/**
 * Creates a shouldContinue callback for use in export/media services.
 * Awaits while paused, throws CancelledError if cancelled.
 */
export const createShouldContinue = (getState: () => RootState) => {
  return async (): Promise<void> => {
    await waitWhilePaused(getState);
    if (checkCancelled(getState)) {
      throw new CancelledError();
    }
  };
};

/**
 * Minimal response shape required by withTransientRetry. Matches
 * discrub-core's APIResponse<T> ({ success, status?, data? }); kept
 * minimal here so any caller that returns the same envelope works.
 */
export interface RetryableResponse {
  success: boolean;
  status?: number;
}

export interface TransientRetryOptions<T extends RetryableResponse> {
  /** Max retries after the initial attempt. Default 5 (so up to 6 total calls). */
  maxRetries?: number;
  /** First backoff delay. Doubles each retry, capped at maxDelayMs. */
  baseDelayMs?: number;
  /** Backoff cap. Default 30000 (30s). */
  maxDelayMs?: number;
  /** Predicate to decide whether a failed response is transient. */
  /** Decide whether to retry; `attempt` is the zero-based retry count so far. */
  shouldRetry?: (response: T, attempt: number) => boolean;
  /** Fires before each backoff sleep with (1-indexed retry number, delayMs, response). */
  onRetry?: (retryNumber: number, delayMs: number, response: T) => void;
  /** State accessor so backoff sleep can honor Pause/Cancel. */
  getState: () => RootState;
  /** Optional thunk signal so backoff sleep can honor abort. */
  signal?: AbortSignal;
  /**
   * When given, every retry wait is recorded as the operation hold
   * (`app.operationHold`, kind retryWait) so the layouts can show the wait
   * and the attempt live; the hold is cleared when the wait ends.
   */
  dispatch?: (action: ReturnType<typeof setOperationHold>) => unknown;
}

/**
 * True for failed responses that withTransientRetry would have
 * retried: network errors (status undefined) and server-side
 * transients (5xx, 408 timeout, 425 too-early). 4xx (auth/perms/
 * not-found/bad-request) is permanent and not retried. 429 is
 * handled inside the lib; when it does bubble here the lib has given
 * up on a rate-limit storm (#254) and the operation is being cancelled.
 *
 * Exported so consumers can distinguish "exhausted retries on a
 * transient" (pause + ask user to fix network) from "hard fail"
 * (reject the thunk) after withTransientRetry returns.
 */
export const isTransientApiFailure = (response: RetryableResponse, attempt = Infinity): boolean => {
  if (response.success) return false;
  // #254: a 429 only reaches here after discrub-core already gave up on
  // it (storm). Retrying would add requests to the pile; the service's
  // onRateLimitExceeded hook has cancelled the operation. Never transient.
  if (response.status === 429) return false;
  // No HTTP status: the fetch threw. Offline, that is the network and the
  // full retry-then-pause path applies. Online, a thrown fetch is Discord
  // or its edge refusing the request (a block page carries no CORS
  // headers, so the browser reports it as a failed fetch). That gets
  // `ONLINE_NETWORK_RETRIES` quick retries for a genuine blip and then
  // counts as permanent, so callers stop instead of pausing and inviting
  // Resume; the service's network-failure streak hook has already
  // cancelled the run by then.
  if (response.status === undefined) return !isBrowserOnline() || attempt < ONLINE_NETWORK_RETRIES;
  if (response.status >= 500) return true;
  if (response.status === 408 || response.status === 425) return true;
  return false;
};

/**
 * Wraps an APIResponse-returning function with bounded transient
 * retry. Up to `maxRetries` retries on transient failure with
 * exponential backoff. Backoff sleep is Pause/Cancel/signal-aware so
 * the user can still cancel mid-wait. Returns the final response —
 * the caller decides what to do with terminal failure (e.g. pause
 * the operation so the user can fix the network).
 */
/** Retries allowed for a thrown fetch while the browser reports itself online. */
export const ONLINE_NETWORK_RETRIES = 2;

/**
 * `navigator.onLine` is only trustworthy when false: true means "not
 * known to be offline". That is enough here, because the question is
 * whether a thrown fetch could be the user's own connection.
 */
export const isBrowserOnline = (): boolean =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * #266: what Discord answered, for a status line. A status is the HTTP
 * code Discord sent back; no status means the request never got an
 * answer (offline, or Discord's edge refused it).
 */
export const describeAnswer = (response: { status?: number } | null | undefined): string =>
  response?.status !== undefined
    ? t('status.msg.answerHttp', { status: response.status })
    : t('status.msg.answerNone');

/**
 * #266: the failure text for a Load All that Discord refused outright
 * (a 4xx the retry helper does not retry, or a refused request while
 * online). `prefix` is the locale key stem, e.g. `fetchAllFailed`.
 */
export const describeFailure = (response: { status?: number } | null | undefined, prefix: string): string =>
  response?.status !== undefined
    ? t(`status.msg.${prefix}Http`, { status: response.status })
    : t(`status.msg.${prefix}NoResponse`);

/** Retries in a transient-retry run (the wait doubles this many times, less one). */
export const TRANSIENT_RETRIES = 5;

/**
 * #265: the wait before retry number `attempt + 1`, in ms. The wait doubles
 * per retry from `baseDelayMs` (the Retry wait setting) and is capped at
 * the last step of a full run, so the default 1 s setting still gives
 * 1, 2, 4, 8, 16 s and a 30 s setting gives 30, 60, 120, 240, 480 s.
 */
export const transientRetryDelayMs = (attempt: number, baseDelayMs: number, maxDelayMs?: number): number => {
  const cap = maxDelayMs ?? baseDelayMs * Math.pow(2, TRANSIENT_RETRIES - 1);
  return Math.min(baseDelayMs * Math.pow(2, attempt), cap);
};

/** The Retry wait setting in ms, read from state. */
export const retryBaseDelayMs = (getState: () => RootState): number =>
  selectRetryWaitSeconds(getState()) * 1000;

export const withTransientRetry = async <T extends RetryableResponse>(
  fn: () => Promise<T>,
  opts: TransientRetryOptions<T>,
): Promise<T> => {
  const maxRetries = opts.maxRetries ?? TRANSIENT_RETRIES;
  // #265: the first wait comes from the Retry wait setting unless the
  // caller pins it; the cap follows the base so the curve keeps its shape.
  const baseDelayMs = opts.baseDelayMs ?? retryBaseDelayMs(opts.getState);
  const maxDelayMs = opts.maxDelayMs;
  const shouldRetry = opts.shouldRetry ?? isTransientApiFailure;

  let lastResponse: T = { success: false } as T;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted || checkCancelled(opts.getState)) return lastResponse;

    lastResponse = await fn();
    if (lastResponse.success || !shouldRetry(lastResponse, attempt)) return lastResponse;
    if (attempt === maxRetries) return lastResponse;
    // The failing request may have stopped the run (streak or storm hook);
    // don't announce a retry that will never happen.
    if (opts.signal?.aborted || checkCancelled(opts.getState)) return lastResponse;

    const delayMs = transientRetryDelayMs(attempt, baseDelayMs, maxDelayMs);
    opts.onRetry?.(attempt + 1, delayMs, lastResponse);
    opts.dispatch?.(setOperationHold({ kind: 'retryWait', until: Date.now() + delayMs, attempt: attempt + 1, max: maxRetries, answer: describeAnswer(lastResponse) }));
    const cancelled = await cancellableDelay(delayMs, opts.getState, opts.signal);
    opts.dispatch?.(setOperationHold(null));
    if (cancelled) return lastResponse;
  }
  return lastResponse;
};
