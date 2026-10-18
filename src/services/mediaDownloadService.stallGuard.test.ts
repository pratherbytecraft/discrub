import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streamDownloadWithStallGuard } from './mediaDownloadService';

/**
 * #232 (GitHub #12) — the stall-guard media transport.
 *
 * The old transport raced a buffered fetch against a flat 10s timer, which
 * structurally fails large attachments on slow connections (500MB in 10s
 * needs 400mbps) and never aborted the losing fetch. The stall guard only
 * gives up when NO bytes arrive for the stall window, so slow-but-alive
 * downloads always complete while dead connections still fail fast.
 */

const mockDiscordService = {
  searchDelaySecs: 0,
  deleteDelaySecs: 0,
  delayModifierSecs: 0,
  calculateRandomNumber: vi.fn((max: number, _min: number) => max),
  onRateLimit: vi.fn() as ((retryAfter: number, info?: unknown) => void) | undefined,
  onRateLimitExceeded: vi.fn() as ((info: unknown) => void) | undefined,
  rateLimit: { maxWaitSecs: 60, maxConsecutive: 5, defaultWaitSecs: 5, waitFloorSecs: [1, 2, 4, 8, 16] },
};

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => mockDiscordService),
}));

// ── Streaming Response fake ──────────────────────────────────────
// Chunks arrive after their per-chunk delay; `stall: true` leaves the
// final read pending forever so only the abort signal can settle it.

interface StreamOpts {
  chunkDelaysMs: number[];
  stall?: boolean;
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
}

function makeStreamingResponse(opts: StreamOpts, signal: AbortSignal) {
  const { chunkDelaysMs, stall = false, status = 200, contentType = 'image/png' } = opts;
  let i = 0;
  const reader = {
    read: () =>
      new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        if (i < chunkDelaysMs.length) {
          const delay = chunkDelaysMs[i++];
          setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve({ done: false, value: new Uint8Array([1, 2, 3]) });
          }, delay);
        } else if (!stall) {
          setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve({ done: true });
          }, 0);
        }
        // stall: never resolve — only the abort listener settles this read
      }),
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType, ...(opts.headers ?? {}) }),
    body: { getReader: () => reader },
  } as unknown as Response;
}

function mockFetchStreaming(opts: StreamOpts) {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
    Promise.resolve(makeStreamingResponse(opts, init!.signal as AbortSignal))
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mockDiscordService.searchDelaySecs = 0;
  mockDiscordService.delayModifierSecs = 0;
  mockDiscordService.onRateLimit = vi.fn();
  mockDiscordService.onRateLimitExceeded = vi.fn();
  mockDiscordService.rateLimit = { maxWaitSecs: 60, maxConsecutive: 5, defaultWaitSecs: 5, waitFloorSecs: [1, 2, 4, 8, 16] };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('#232 streamDownloadWithStallGuard', () => {
  it('completes a slow-but-progressing download far beyond the old 10s cap', async () => {
    // 5 chunks, 8s apart = 40s total. The old flat race died at 10s; the
    // stall guard never fires because bytes keep arriving inside the window.
    vi.stubGlobal('fetch', mockFetchStreaming({ chunkDelaysMs: [8000, 8000, 8000, 8000, 8000] }));

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/big-file.png');
    await vi.advanceTimersByTimeAsync(41_000);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data).toBeInstanceOf(Blob);
    expect(result.data!.size).toBe(15); // 5 chunks × 3 bytes
    expect(result.data!.type).toBe('image/png');
  });

  it('aborts when no bytes arrive for the stall window mid-body', async () => {
    // One healthy chunk, then silence — the stall timer must fire and
    // settle the pending read via the abort signal.
    vi.stubGlobal('fetch', mockFetchStreaming({ chunkDelaysMs: [1000], stall: true }));

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/dead-link.png');
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;

    expect(result).toEqual({ success: false, data: null });
  });

  it('aborts when the initial response never arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init!.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
      )
    );

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/black-hole.png');
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await promise;

    expect(result).toEqual({ success: false, data: null });
  });

  it('fails fast on an HTTP error without retrying', async () => {
    const fetchMock = mockFetchStreaming({ chunkDelaysMs: [], status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/gone.png');
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on 429, surfaces it via onRateLimit, and retries', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '3' }),
          body: null,
        } as unknown as Response);
      }
      return Promise.resolve(
        makeStreamingResponse({ chunkDelaysMs: [100] }, init!.signal as AbortSignal)
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/busy.png');
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockDiscordService.onRateLimit).toHaveBeenCalledWith(3, expect.objectContaining({ source: 'header', consecutive: 1 }));
  });

  it('floors a sub second 429 wait at 1 s and the second at 2 s (#279, lib parity)', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      call++;
      if (call <= 2) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ retry_after: 0.2 }),
          body: null,
        } as unknown as Response);
      }
      return Promise.resolve(
        makeStreamingResponse({ chunkDelaysMs: [100] }, init!.signal as AbortSignal)
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/floored.png');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockDiscordService.onRateLimit).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ source: 'json', consecutive: 1, floored: true }));
    expect(mockDiscordService.onRateLimit).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ consecutive: 2, floored: true }));
  });

  it('applies the jittered searchDelay pacing before fetching (lib parity)', async () => {
    mockDiscordService.searchDelaySecs = 2;
    const fetchMock = mockFetchStreaming({ chunkDelaysMs: [10] });
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/paced.png');

    // Pacing window not yet elapsed — no fetch
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('is aborted mid-body by an external signal (F26: Cancel reaches in-flight downloads)', async () => {
    // Trickling forever: a chunk every 20s re-arms the 30s stall clock,
    // so only the external signal can end this download.
    vi.stubGlobal('fetch', mockFetchStreaming({ chunkDelaysMs: Array(1000).fill(20_000) }));

    const external = new AbortController();
    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/trickle.png', external.signal);
    await vi.advanceTimersByTimeAsync(50_000); // a few chunks in, still alive
    external.abort();
    const result = await promise;

    expect(result).toEqual({ success: false, data: null });
  });

  it('returns failure immediately when the external signal is already aborted', async () => {
    const fetchMock = mockFetchStreaming({ chunkDelaysMs: [10] });
    vi.stubGlobal('fetch', fetchMock);

    const external = new AbortController();
    external.abort();
    const result = await streamDownloadWithStallGuard('https://cdn.discordapp.com/late.png', external.signal);

    expect(result).toEqual({ success: false, data: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds a pathological trickle at the absolute per-file ceiling (F26)', async () => {
    // ~66 minutes of chunks arriving inside every stall window — the
    // 30-minute ceiling must end it even with no Cancel.
    vi.stubGlobal('fetch', mockFetchStreaming({ chunkDelaysMs: Array(200).fill(20_000) }));

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/forever.png');
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    const result = await promise;

    expect(result).toEqual({ success: false, data: null });
  });

  it('waits out 429s below the consecutive limit (F25: lib transport parity, #254 bound)', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      call++;
      if (call <= 4) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '1' }),
          body: null,
        } as unknown as Response);
      }
      return Promise.resolve(
        makeStreamingResponse({ chunkDelaysMs: [10] }, init!.signal as AbortSignal)
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/very-busy.png');
    // #279: the floored waits are 1, 2, 4 and 8 s.
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    // The old cap (2 retries) turned the 3rd consecutive 429 into a
    // silently dropped file; four in a row is still under the #254
    // limit of five, so all of them are waited out.
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(mockDiscordService.onRateLimitExceeded).not.toHaveBeenCalled();
  });

  it('gives up with a real 429 after maxConsecutive rate limits (#254)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '1' }),
      body: null,
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/storm.png');
    // #279: the floored waits are 1, 2, 4 and 8 s before the fifth 429.
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).toEqual({ success: false, data: null, status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(mockDiscordService.onRateLimit).toHaveBeenCalledTimes(4);
    expect(mockDiscordService.onRateLimitExceeded).toHaveBeenCalledWith(expect.objectContaining({ consecutive: 5, capped: false }));
  });

  it('gives up immediately when retry_after exceeds maxWaitSecs (#254)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: () => Promise.resolve({ retry_after: 600, global: true }),
      body: null,
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/long-wait.png');
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ success: false, data: null, status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockDiscordService.onRateLimit).not.toHaveBeenCalled();
    expect(mockDiscordService.onRateLimitExceeded).toHaveBeenCalledWith(expect.objectContaining({ capped: true, global: true, retryAfter: 60 }));
  });

  it('prefers the JSON body retry_after over the Retry-After header (F25: lib parity)', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '1' }),
          json: () => Promise.resolve({ retry_after: 4 }),
          body: null,
        } as unknown as Response);
      }
      return Promise.resolve(
        makeStreamingResponse({ chunkDelaysMs: [10] }, init!.signal as AbortSignal)
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/body-wait.png');

    // Header said 1s, body said 4s — the body wins, so no retry yet at 2s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(mockDiscordService.onRateLimit).toHaveBeenCalledWith(4, expect.objectContaining({ source: 'json' }));
  });

  it('does not cap an actively-arriving buffered body at the stall window (F29)', async () => {
    // blob() takes 60s — well past the 30s stall window. The pre-fetch
    // stall timer must be disarmed on the null-body path or it acts as a
    // flat total cap, the exact failure class #232 removed.
    const blob = new Blob(['slow but alive'], { type: 'text/plain' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const signal = init!.signal as AbortSignal;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          body: null,
          blob: () =>
            new Promise((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
              setTimeout(() => resolve(blob), 60_000);
            }),
        } as unknown as Response);
      })
    );

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/slow-buffered.png');
    await vi.advanceTimersByTimeAsync(61_000);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data).toBe(blob);
  });

  it('falls back to a buffered read when the environment has no body stream', async () => {
    const blob = new Blob(['buffered'], { type: 'text/plain' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        blob: () => Promise.resolve(blob),
      } as unknown as Response)
    );

    const promise = streamDownloadWithStallGuard('https://cdn.discordapp.com/no-stream.png');
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data).toBe(blob);
  });
});
