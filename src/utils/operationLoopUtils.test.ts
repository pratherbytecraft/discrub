import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  waitWhilePaused,
  checkCancelled,
  cancellableDelay,
  withTransientRetry,
  isTransientApiFailure,
  isBrowserOnline,
  ONLINE_NETWORK_RETRIES, transientRetryDelayMs, describeAnswer, describeFailure } from './operationLoopUtils';
import type { RootState } from '@/app/store';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { initialAppState } from '@features/app/appTypes';

function createMockGetState(overrides: Partial<RootState['app']> = {}): () => RootState {
  const appState = { ...initialAppState, ...overrides };
  return () => ({ app: appState } as RootState);
}

describe('waitWhilePaused', () => {
  it('resolves immediately when not paused', async () => {
    const getState = createMockGetState({ discrubPaused: false });
    await waitWhilePaused(getState);
    // If we reach here, it resolved
    expect(true).toBe(true);
  });

  it('blocks while paused and resumes on unpause', async () => {
    let paused = true;
    const getState = () =>
      ({
        app: { ...initialAppState, discrubPaused: paused, discrubCancelled: false },
      }) as RootState;

    const start = Date.now();
    const promise = waitWhilePaused(getState);

    setTimeout(() => {
      paused = false;
    }, 100);

    await promise;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('resolves when cancelled while paused', async () => {
    let cancelled = false;
    const getState = () =>
      ({
        app: { ...initialAppState, discrubPaused: true, discrubCancelled: cancelled },
      }) as RootState;

    const promise = waitWhilePaused(getState);

    setTimeout(() => {
      cancelled = true;
    }, 100);

    await promise;
    // Should have resolved due to cancellation
    expect(true).toBe(true);
  });
});

describe('cancellableDelay', () => {
  it('completes the full delay and returns false when not cancelled', async () => {
    const getState = createMockGetState({ discrubCancelled: false, discrubPaused: false });
    const start = Date.now();
    const result = await cancellableDelay(400, getState);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(350);
  });

  it('returns true early when cancelled during delay', async () => {
    let cancelled = false;
    const getState = () =>
      ({
        app: { ...initialAppState, discrubPaused: false, discrubCancelled: cancelled },
      }) as RootState;

    const start = Date.now();
    setTimeout(() => { cancelled = true; }, 100);
    const result = await cancellableDelay(2000, getState);
    const elapsed = Date.now() - start;
    expect(result).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('pauses during delay and resumes', async () => {
    let paused = true;
    const getState = () =>
      ({
        app: { ...initialAppState, discrubPaused: paused, discrubCancelled: false },
      }) as RootState;

    const start = Date.now();
    setTimeout(() => { paused = false; }, 300);
    const result = await cancellableDelay(200, getState);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    // Should take at least 300ms (paused) + ~200ms (delay)
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });
});

describe('checkCancelled', () => {
  it('returns false when not cancelled', () => {
    const getState = createMockGetState({ discrubCancelled: false });
    expect(checkCancelled(getState)).toBe(false);
  });

  it('returns true when cancelled', () => {
    const getState = createMockGetState({ discrubCancelled: true });
    expect(checkCancelled(getState)).toBe(true);
  });
});

describe('withTransientRetry', () => {
  it('returns the first success without retrying', async () => {
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: true, status: 200, data: 'ok' });
    const onRetry = vi.fn();

    const result = await withTransientRetry(fn, { getState, onRetry, baseDelayMs: 10 });

    expect(result).toEqual({ success: true, status: 200, data: 'ok' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('records each retry wait as the operation hold and clears it after the wait', async () => {
    const getState = createMockGetState();
    const dispatch = vi.fn();
    const fn = vi.fn()
      .mockResolvedValueOnce({ success: false, status: 502 })
      .mockResolvedValueOnce({ success: true, data: 'ok' });
    const result = await withTransientRetry(fn, { getState, dispatch, baseDelayMs: 5 });
    expect(result.success).toBe(true);
    const payloads = dispatch.mock.calls.map(([a]) => a.payload);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({ kind: 'retryWait', attempt: 1, max: 5, answer: expect.stringContaining('502') });
    expect(payloads[0].until).toBeGreaterThan(Date.now() - 1000);
    expect(payloads[1]).toBeNull();
  });

  it('records nothing without a dispatch', async () => {
    const getState = createMockGetState();
    const fn = vi.fn()
      .mockResolvedValueOnce({ success: false, status: 502 })
      .mockResolvedValueOnce({ success: true, data: 'ok' });
    await expect(withTransientRetry(fn, { getState, baseDelayMs: 5 })).resolves.toMatchObject({ success: true });
  });

  it('retries transient failures then returns success', async () => {
    const getState = createMockGetState();
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ success: false, status: undefined })
      .mockResolvedValueOnce({ success: false, status: 503 })
      .mockResolvedValueOnce({ success: true, status: 200, data: 'recovered' });
    const onRetry = vi.fn();

    const result = await withTransientRetry(fn, {
      getState,
      onRetry,
      baseDelayMs: 10,
      maxDelayMs: 50,
    });

    expect(result).toEqual({ success: true, status: 200, data: 'recovered' });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(onRetry.mock.calls[1][0]).toBe(2);
  });

  it('returns the final failure when retries are exhausted', async () => {
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 503 });
    const onRetry = vi.fn();

    const result = await withTransientRetry(fn, {
      getState,
      onRetry,
      maxRetries: 3,
      baseDelayMs: 5,
    });

    expect(result).toEqual({ success: false, status: 503 });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent 4xx failures', async () => {
    const getState = createMockGetState();
    const cases = [401, 403, 404, 400];
    for (const status of cases) {
      const fn = vi.fn().mockResolvedValue({ success: false, status });
      const onRetry = vi.fn();
      const result = await withTransientRetry(fn, { getState, onRetry, baseDelayMs: 5 });
      expect(result).toEqual({ success: false, status });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    }
  });

  it('honors a custom shouldRetry predicate', async () => {
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 404 });
    const onRetry = vi.fn();

    const result = await withTransientRetry(fn, {
      getState,
      onRetry,
      baseDelayMs: 5,
      maxRetries: 2,
      shouldRetry: (r) => r.status === 404,
    });

    expect(result).toEqual({ success: false, status: 404 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('aborts mid-backoff when cancelled and returns the last failure', async () => {
    let cancelled = false;
    const getState = () =>
      ({
        app: { ...initialAppState, discrubPaused: false, discrubCancelled: cancelled },
      }) as RootState;
    const fn = vi.fn().mockResolvedValue({ success: false, status: 500 });

    setTimeout(() => {
      cancelled = true;
    }, 50);

    const start = Date.now();
    const result = await withTransientRetry(fn, {
      getState,
      baseDelayMs: 5000,
      maxRetries: 3,
    });
    const elapsed = Date.now() - start;

    expect(result).toEqual({ success: false, status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(500);
  });

  it('aborts mid-backoff when signal aborts', async () => {
    const getState = createMockGetState();
    const controller = new AbortController();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 500 });

    setTimeout(() => controller.abort(), 50);

    const start = Date.now();
    const result = await withTransientRetry(fn, {
      getState,
      signal: controller.signal,
      baseDelayMs: 5000,
      maxRetries: 3,
    });
    const elapsed = Date.now() - start;

    expect(result).toEqual({ success: false, status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(500);
  });

  it('caps backoff at maxDelayMs', async () => {
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 500 });
    const onRetry = vi.fn();

    await withTransientRetry(fn, {
      getState,
      onRetry,
      baseDelayMs: 1000,
      maxDelayMs: 50,
      maxRetries: 4,
    });

    expect(onRetry).toHaveBeenCalledTimes(4);
    for (const call of onRetry.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(50);
    }
  });

  it('passes the actual delayMs to onRetry following the exponential schedule', async () => {
    // The schedule is baseDelayMs * 2^attempt, capped at maxDelayMs. With
    // baseDelayMs=10 and maxDelayMs=10000, attempts 0..3 should emit
    // (10, 20, 40, 80) ms. Pinning the actual numbers here means any
    // future change to the backoff formula has to update this test
    // intentionally; right now nothing asserts the schedule itself.
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 500 });
    const onRetry = vi.fn();

    await withTransientRetry(fn, {
      getState,
      onRetry,
      baseDelayMs: 10,
      maxDelayMs: 10000,
      maxRetries: 4,
    });

    const delays = onRetry.mock.calls.map((c) => c[1]);
    expect(delays).toEqual([10, 20, 40, 80]);
    // And the attempt counters track in step (1-indexed by design).
    const attempts = onRetry.mock.calls.map((c) => c[0]);
    expect(attempts).toEqual([1, 2, 3, 4]);
  });
});

describe('describeAnswer / describeFailure (#266)', () => {
  it('names the HTTP status when Discord answered', () => {
    expect(describeAnswer({ status: 503 })).toBe('Discord answered HTTP 503');
    expect(describeFailure({ status: 403 }, 'fetchAllFailed')).toBe('Failed to fetch all messages (HTTP 403)');
    expect(describeFailure({ status: 404 }, 'fetchAllThreadFailed')).toBe('Failed to fetch all thread messages (HTTP 404)');
  });

  it('says Discord did not answer when there is no status', () => {
    expect(describeAnswer({})).toBe('Discord did not answer');
    expect(describeAnswer(undefined)).toBe('Discord did not answer');
    expect(describeFailure({ success: false } as any, 'fetchAllFailed')).toBe(
      'Failed to fetch all messages. Discord did not answer, check your connection and try again.',
    );
  });
});

describe('retry wait setting (#265)', () => {
  it('transientRetryDelayMs doubles from the base and caps at the fifth step', () => {
    expect([0, 1, 2, 3, 4, 5].map((a) => transientRetryDelayMs(a, 1000))).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
    expect([0, 1, 2, 3, 4].map((a) => transientRetryDelayMs(a, 30000))).toEqual([30000, 60000, 120000, 240000, 480000]);
    expect(transientRetryDelayMs(3, 1000, 50)).toBe(50);
  });

  it('withTransientRetry takes its first wait from the Retry wait setting', async () => {
    const getState = createMockGetState({
      settings: { ...initialAppState.settings, [DiscrubSetting.RETRY_WAIT]: '3' } as any,
    });
    const fn = vi.fn().mockResolvedValue({ success: false, status: 500 });
    const onRetry = vi.fn();
    vi.useFakeTimers();
    const run = withTransientRetry(fn, { getState, onRetry, maxRetries: 2 });
    await vi.runAllTimersAsync();
    await run;
    vi.useRealTimers();
    expect(onRetry.mock.calls.map((c) => c[1])).toEqual([3000, 6000]);
  });

  it('withTransientRetry keeps the 1, 2, 4, 8, 16 second curve at the default setting', async () => {
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 500 });
    const onRetry = vi.fn();
    vi.useFakeTimers();
    const run = withTransientRetry(fn, { getState, onRetry });
    await vi.runAllTimersAsync();
    await run;
    vi.useRealTimers();
    expect(onRetry.mock.calls.map((c) => c[1])).toEqual([1000, 2000, 4000, 8000, 16000]);
  });
});

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
};

describe('thrown fetches while online (GH #14 refused requests)', () => {
  afterEach(() => setOnline(true));

  it('reads navigator.onLine, trusting only false', () => {
    setOnline(true);
    expect(isBrowserOnline()).toBe(true);
    setOnline(false);
    expect(isBrowserOnline()).toBe(false);
  });

  it('offline: a status-less failure stays transient at every attempt', () => {
    setOnline(false);
    expect(isTransientApiFailure({ success: false }, 0)).toBe(true);
    expect(isTransientApiFailure({ success: false }, 4)).toBe(true);
    expect(isTransientApiFailure({ success: false })).toBe(true);
  });

  it('online: a status-less failure gets a couple of quick retries, then counts as permanent', () => {
    setOnline(true);
    for (let attempt = 0; attempt < ONLINE_NETWORK_RETRIES; attempt++) {
      expect(isTransientApiFailure({ success: false }, attempt)).toBe(true);
    }
    expect(isTransientApiFailure({ success: false }, ONLINE_NETWORK_RETRIES)).toBe(false);
    // Callers asking after the retry loop (no attempt) get the terminal answer.
    expect(isTransientApiFailure({ success: false })).toBe(false);
  });

  it('online: 5xx is still retried the full schedule', () => {
    setOnline(true);
    expect(isTransientApiFailure({ success: false, status: 502 }, 4)).toBe(true);
    expect(isTransientApiFailure({ success: false, status: 502 })).toBe(true);
  });

  it('withTransientRetry stops after the online retries for a thrown fetch', async () => {
    setOnline(true);
    const fn = vi.fn().mockResolvedValue({ success: false });
    const getState = createMockGetState();
    const onRetry = vi.fn();

    const result = await withTransientRetry(fn, { getState, onRetry, baseDelayMs: 1, maxDelayMs: 2 });

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(ONLINE_NETWORK_RETRIES + 1);
    expect(onRetry).toHaveBeenCalledTimes(ONLINE_NETWORK_RETRIES);
  });

  it('withTransientRetry keeps the full schedule for a thrown fetch while offline', async () => {
    setOnline(false);
    const fn = vi.fn().mockResolvedValue({ success: false });
    const getState = createMockGetState();

    await withTransientRetry(fn, { getState, maxRetries: 5, baseDelayMs: 1, maxDelayMs: 2 });

    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('withTransientRetry does not announce a retry once the failing request cancelled the run', async () => {
    setOnline(false);
    let cancelled = false;
    const getState = () => ({ app: { ...initialAppState, discrubCancelled: cancelled } }) as RootState;
    const fn = vi.fn().mockImplementation(async () => {
      // What the streak hook does from inside the request.
      cancelled = true;
      return { success: false };
    });
    const onRetry = vi.fn();

    await withTransientRetry(fn, { getState, onRetry, baseDelayMs: 1 });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('isTransientApiFailure (#254 rate-limit storms)', () => {
  it('treats network errors (offline) and 5xx as transient', () => {
    setOnline(false);
    expect(isTransientApiFailure({ success: false })).toBe(true);
    setOnline(true);
    expect(isTransientApiFailure({ success: false, status: 503 })).toBe(true);
    expect(isTransientApiFailure({ success: false, status: 408 })).toBe(true);
  });

  it('never treats a 429 as transient, so a storm is not re-hammered', () => {
    expect(isTransientApiFailure({ success: false, status: 429 })).toBe(false);
  });

  it('does not retry a 429 inside withTransientRetry', async () => {
    const getState = createMockGetState();
    const fn = vi.fn().mockResolvedValue({ success: false, status: 429 });
    const onRetry = vi.fn();

    const result = await withTransientRetry(fn, { getState, onRetry, baseDelayMs: 1 });

    expect(result).toEqual({ success: false, status: 429 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
