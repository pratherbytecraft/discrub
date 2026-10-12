import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureStore,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import packageReducer, {
  enrichPackageChannel,
  hydrateCachedEnrichment,
  importPackage,
  loadPackageChannelMessages,
  __testHelpers__,
} from './packageSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import { buildFixturePackage } from '@/test/package-fixtures';
import { enrichmentCache } from './enrichmentCache';
import { storage } from '@/extension/storage';
import type { RootState } from '@/app/store';

const mockFetchMessageData = vi.fn();
const mockFetchSearchMessageData = vi.fn();

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchMessageData: mockFetchMessageData,
    fetchSearchMessageData: mockFetchSearchMessageData,
  })),
}));

const mockCheckCancelled = vi.fn().mockReturnValue(false);
vi.mock('@utils/operationLoopUtils', () => ({
  // Instant fake of withTransientRetry (#245) — same retry+predicate
  // contract as the real helper minus the backoff sleep.
  withTransientRetry: vi.fn(async (fn: () => Promise<any>, opts: any) => {
    const maxRetries = opts.maxRetries ?? 5;
    const isTransient = (r: any) =>
      !r.success && (r.status === undefined || r.status >= 500 || r.status === 408 || r.status === 425);
    const shouldRetry = opts.shouldRetry ?? isTransient;
    let lastResponse: any = { success: false };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastResponse = await fn();
      if (lastResponse.success || !shouldRetry(lastResponse, attempt)) return lastResponse;
      if (attempt === maxRetries) return lastResponse;
      opts.onRetry?.(attempt + 1, 1000, lastResponse, lastResponse.status === undefined ? Math.min(maxRetries, 2) : maxRetries);
    }
    return lastResponse;
  }),
  waitWhilePaused: vi.fn().mockResolvedValue(undefined),
  checkCancelled: (...args: unknown[]) => mockCheckCancelled(...args),
  cancellableDelay: vi.fn().mockResolvedValue(false),
  CancelledError: class CancelledError extends Error {
    constructor() {
      super('Cancelled');
      this.name = 'CancelledError';
    }
  },
}));

vi.mock('@utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn().mockReturnValue({ delayMs: 0, delaySec: 0 }),
}));

const USER_ID = '253286221395001345';

function makeStore(token: string | null = 'tok') {
  const store = configureStore({
    reducer: {
      package: packageReducer,
      auth: authReducer,
      user: userReducer,
      app: appReducer,
      status: statusReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  }) as unknown as {
    dispatch: ThunkDispatch<RootState, unknown, UnknownAction>;
    getState: () => RootState;
    subscribe: (listener: () => void) => () => void;
  };
  if (token) {
    store.dispatch({ type: 'auth/setToken', payload: token });
  }
  store.dispatch({
    type: 'user/setCurrentUser',
    payload: { id: USER_ID, username: 'tester' },
  });
  return store;
}

async function primedStore() {
  const store = makeStore();
  const blob = await buildFixturePackage();
  await store.dispatch(importPackage(blob));
  await store.dispatch(loadPackageChannelMessages('200'));
  return store;
}

function liveMessage(id: string) {
  return {
    id,
    content: `live ${id}`,
    author: { id: 'author', username: 'author' },
    reactions: [{ emoji: { name: '👍' }, count: 1 }],
  };
}

describe('packageSlice — enrichPackageChannel', () => {
  beforeEach(async () => {
    mockFetchMessageData.mockReset();
    // Default: preflight returns 403 (no search permission) so the
    // main AROUND loop runs identically to its pre-preflight behavior.
    // Tests that exercise the preflight success path override this.
    mockFetchSearchMessageData.mockReset().mockResolvedValue({
      success: false,
      status: 403,
    });
    mockCheckCancelled.mockReset().mockReturnValue(false);
    __testHelpers__.storeSourceFile(null);
    await storage.package.clear();
  });

  it('rejects when not authenticated', async () => {
    const store = makeStore(null);
    const action = await store.dispatch(
      enrichPackageChannel({ channelId: '200' }),
    );
    expect(action.type).toBe('package/enrichChannel/rejected');
    expect(mockFetchMessageData).not.toHaveBeenCalled();
  });

  it('rejects when channel is not in the package', async () => {
    const store = await primedStore();
    const action = await store.dispatch(
      enrichPackageChannel({ channelId: 'does-not-exist' }),
    );
    expect(action.type).toBe('package/enrichChannel/rejected');
  });

  it('is skipped via condition when another channel is actively enriching', async () => {
    const store = await primedStore();
    // Simulate an in-flight run by firing a real pending action for a
    // different channel. RTK's `condition` check runs synchronously on
    // dispatch — so our new enrichPackageChannel call should be aborted
    // before ever running its payload creator.
    store.dispatch({
      type: enrichPackageChannel.pending.type,
      meta: {
        arg: { channelId: '999' },
        requestId: 'fake-id',
        requestStatus: 'pending' as const,
      },
    });
    expect(store.getState().package.activeEnrichmentChannelId).toBe('999');

    const action = await store.dispatch(
      enrichPackageChannel({ channelId: '200' }),
    );
    // RTK reports a condition-aborted thunk as rejected with
    // meta.condition === true and no reducer side effects.
    expect(action.type).toBe('package/enrichChannel/rejected');
    expect(
      enrichPackageChannel.rejected.match(action) && action.meta.condition,
    ).toBe(true);
    expect(mockFetchMessageData).not.toHaveBeenCalled();
    // activeEnrichmentChannelId should still point at the simulated
    // in-flight channel, untouched by the aborted dispatch.
    expect(store.getState().package.activeEnrichmentChannelId).toBe('999');
  });

  it('enriches every message on the happy path', async () => {
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) =>
        Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        }),
    );
    const store = await primedStore();

    const action = await store.dispatch(
      enrichPackageChannel({ channelId: '200' }),
    );
    expect(action.type).toBe('package/enrichChannel/fulfilled');

    const state = store.getState().package;
    expect(state.enrichmentStatus['200']).toBe('done');
    expect(state.enrichedMessages['200']).toBeDefined();
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
    expect(state.enrichmentMisses['200']).toEqual({ deleted: [], forbidden: [] });
    expect(state.activeEnrichmentChannelId).toBeNull();

    // Persisted to IDB.
    const cached = await enrichmentCache.get(USER_ID, '200');
    expect(cached).not.toBeNull();
    expect(Object.keys(cached?.messages ?? {})).toEqual(['1', '2', '3']);
  });

  it('#245: retries a transient AROUND failure instead of dropping the message', async () => {
    let flaky = 0;
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) => {
        if (targetId === '2' && flaky++ < 2) {
          return Promise.resolve({ success: false, status: flaky === 1 ? 503 : undefined });
        }
        return Promise.resolve({ success: true, status: 200, data: [liveMessage(targetId)] });
      },
    );
    const store = await primedStore();

    const action = await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    expect(action.type).toBe('package/enrichChannel/fulfilled');

    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
    expect(state.enrichmentMisses['200']).toEqual({ deleted: [], forbidden: [] });
    // 3 targets + 2 retries on target '2'.
    expect(mockFetchMessageData).toHaveBeenCalledTimes(5);
  });

  it('treats HTTP 404 as a deleted miss, continues the loop', async () => {
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) => {
        if (targetId === '2') {
          return Promise.resolve({ success: false, status: 404 });
        }
        return Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        });
      },
    );
    const store = await primedStore();
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '3']);
    expect(state.enrichmentMisses['200'].deleted).toEqual(['2']);
    expect(state.enrichmentMisses['200'].forbidden).toEqual([]);
  });

  it('treats HTTP 403 as a forbidden miss, continues the loop', async () => {
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) => {
        if (targetId === '2') {
          return Promise.resolve({ success: false, status: 403 });
        }
        return Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        });
      },
    );
    const store = await primedStore();
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '3']);
    expect(state.enrichmentMisses['200'].forbidden).toEqual(['2']);
  });

  it('treats target missing from response data as deleted', async () => {
    mockFetchMessageData.mockImplementation(() =>
      // Neighbor-only response — target id was not returned.
      Promise.resolve({
        success: true,
        status: 200,
        data: [liveMessage('neighbor')],
      }),
    );
    const store = await primedStore();
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'] ?? {})).toEqual([]);
    expect(state.enrichmentMisses['200'].deleted).toEqual(['1', '2', '3']);
  });

  it('short-circuits to the cached result when present', async () => {
    // Pre-seed the IDB cache.
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 42,
      messages: { '1': liveMessage('1') as never, '2': liveMessage('2') as never },
      misses: { deleted: ['3'], forbidden: [] },
    });
    const store = await primedStore();

    const action = await store.dispatch(
      enrichPackageChannel({ channelId: '200' }),
    );
    expect(action.type).toBe('package/enrichChannel/fulfilled');
    expect(mockFetchMessageData).not.toHaveBeenCalled();

    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2']);
    expect(state.enrichmentMisses['200'].deleted).toEqual(['3']);
    expect(state.enrichmentStatus['200']).toBe('done');
    expect(state.enrichmentLastFetched['200']).toBe(42);
  });

  it('bypasses the cache when refresh=true', async () => {
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 42,
      messages: { '1': liveMessage('1') as never },
      misses: { deleted: [], forbidden: [] },
    });
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) =>
        Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        }),
    );
    const store = await primedStore();

    await store.dispatch(
      enrichPackageChannel({ channelId: '200', refresh: true }),
    );
    // API was called for each of the 3 messages.
    expect(mockFetchMessageData).toHaveBeenCalledTimes(3);
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('saves partial results and flips status to cancelled on cancel', async () => {
    // Cancel after the first message returns.
    let callCount = 0;
    mockCheckCancelled.mockImplementation(() => {
      callCount++;
      // Let the first iteration run, cancel before the second.
      // The preflight loop calls checkCancelled once before any main
      // loop iteration — bumped from `> 1` so "cancel after 1st msg"
      // semantics hold: preflight check (1) + first main iter (2) →
      // cancel fires on the second main iter (3).
      return callCount > 2;
    });
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) =>
        Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        }),
    );
    const store = await primedStore();

    const action = await store.dispatch(
      enrichPackageChannel({ channelId: '200' }),
    );
    expect(action.type).toBe('package/enrichChannel/fulfilled');

    const state = store.getState().package;
    expect(state.enrichmentStatus['200']).toBe('cancelled');
    // Only message 1 was enriched before the cancel check fired.
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1']);
    expect(state.activeEnrichmentChannelId).toBeNull();
    // Partial results are persisted to IDB for next session.
    const cached = await enrichmentCache.get(USER_ID, '200');
    expect(Object.keys(cached?.messages ?? {})).toEqual(['1']);
  });

  it('keeps old enriched state visible during refresh, overwrites on completion', async () => {
    // Pre-populate state via the hydrate reducer path (cache hit).
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 1,
      messages: { stale: liveMessage('stale') as never },
      misses: { deleted: [], forbidden: [] },
    });
    const store = await primedStore();
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    expect(Object.keys(store.getState().package.enrichedMessages['200']))
      .toEqual(['stale']);

    // Start a refresh. Fix F (no-flicker): the pending reducer must
    // NOT wipe the stale entries — rows should keep showing enriched
    // content throughout the refresh run so users don't see every row
    // flash back to the source chip.
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) =>
        Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        }),
    );
    const p = store.dispatch(
      enrichPackageChannel({ channelId: '200', refresh: true }),
    );
    // Right after kicking off: stale data is still present.
    expect(store.getState().package.enrichedMessages['200']).toBeDefined();
    expect(Object.keys(store.getState().package.enrichedMessages['200']))
      .toContain('stale');
    await p;
    // On successful completion the stale entry is replaced by fresh IDs.
    expect(Object.keys(store.getState().package.enrichedMessages['200']))
      .toEqual(['1', '2', '3']);
  });

  it('rejects when the channel has no messages', async () => {
    // Skip primedStore's loadPackageChannelMessages so the channel's
    // loadedChannels entry stays undefined. Then directly set it to [].
    const store = makeStore();
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));
    store.dispatch(loadPackageChannelMessages.fulfilled(
      { channelId: '200', messages: [] },
      'req-id',
      '200',
    ));

    const action = await store.dispatch(
      enrichPackageChannel({ channelId: '200' }),
    );
    expect(action.type).toBe('package/enrichChannel/rejected');
    expect(mockFetchMessageData).not.toHaveBeenCalled();
  });

  it('Fix C: cancel during refresh preserves the previous full cache', async () => {
    // Pre-populate IDB with a full enrichment of 3 messages.
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 42,
      messages: {
        '1': liveMessage('1') as never,
        '2': liveMessage('2') as never,
        '3': liveMessage('3') as never,
      },
      misses: { deleted: [], forbidden: [] },
    });
    const store = await primedStore();
    // Load the cache into state (cache-hit path).
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    expect(Object.keys(store.getState().package.enrichedMessages['200']))
      .toHaveLength(3);

    // Cancel after the very first fetch during refresh.
    let callCount = 0;
    mockCheckCancelled.mockImplementation(() => {
      callCount++;
      // The preflight loop calls checkCancelled once before any main
      // loop iteration — bumped from `> 1` so "cancel after 1st msg"
      // semantics hold: preflight check (1) + first main iter (2) →
      // cancel fires on the second main iter (3).
      return callCount > 2;
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );

    await store.dispatch(
      enrichPackageChannel({ channelId: '200', refresh: true }),
    );

    // Cache in IDB should still be the original 3-message one.
    const cached = await enrichmentCache.get(USER_ID, '200');
    expect(Object.keys(cached?.messages ?? {})).toEqual(['1', '2', '3']);
    // Redux state likewise holds the previous 3 enriched messages.
    expect(Object.keys(store.getState().package.enrichedMessages['200']))
      .toHaveLength(3);
    expect(store.getState().package.enrichmentStatus['200']).toBe('cancelled');
  });

  it('Fix C: cancel during a fresh run (no previous cache) saves the partial result', async () => {
    // No previous cache. Cancel after the first fetch.
    let callCount = 0;
    mockCheckCancelled.mockImplementation(() => {
      callCount++;
      // The preflight loop calls checkCancelled once before any main
      // loop iteration — bumped from `> 1` so "cancel after 1st msg"
      // semantics hold: preflight check (1) + first main iter (2) →
      // cancel fires on the second main iter (3).
      return callCount > 2;
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const cached = await enrichmentCache.get(USER_ID, '200');
    // Partial: only the first message made it.
    expect(Object.keys(cached?.messages ?? {})).toEqual(['1']);
  });

  it('Fix E: cancel does NOT falsely set progress to 100%', async () => {
    let callCount = 0;
    mockCheckCancelled.mockImplementation(() => {
      callCount++;
      // The preflight loop calls checkCancelled once before any main
      // loop iteration — bumped from `> 1` so "cancel after 1st msg"
      // semantics hold: preflight check (1) + first main iter (2) →
      // cancel fires on the second main iter (3).
      return callCount > 2;
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const progress = store.getState().package.enrichmentProgress['200'];
    // Progress should NOT jump to full (3/3) — only the per-iteration
    // throttled updates fired, and they cap at "1" before cancel.
    expect(progress?.current).not.toBe(3);
  });

  it('Fix H: enrichedMessages is bounded by an LRU limit', async () => {
    const store = await primedStore();
    // Hydrate 6 channels directly into state — more than the 5-channel limit.
    for (let i = 1; i <= 6; i++) {
      store.dispatch({
        type: 'package/hydrateEnrichmentFromCache',
        payload: {
          channelId: `channel-${i}`,
          cache: {
            lastFetched: i,
            messages: { [String(i)]: liveMessage(String(i)) as never },
            misses: { deleted: [], forbidden: [] },
          },
        },
      });
    }
    const state = store.getState().package;
    // Oldest (channel-1) evicted, newest 5 retained.
    expect(state.enrichedMessages['channel-1']).toBeUndefined();
    expect(state.enrichedMessages['channel-2']).toBeDefined();
    expect(state.enrichedMessages['channel-6']).toBeDefined();
    expect(state.enrichedOrder).toEqual([
      'channel-2', 'channel-3', 'channel-4', 'channel-5', 'channel-6',
    ]);
  });

  it('Fix H: accessing an older channel moves it to the tail (LRU bump)', async () => {
    const store = await primedStore();
    for (let i = 1; i <= 3; i++) {
      store.dispatch({
        type: 'package/hydrateEnrichmentFromCache',
        payload: {
          channelId: `c${i}`,
          cache: {
            lastFetched: i,
            messages: {},
            misses: { deleted: [], forbidden: [] },
          },
        },
      });
    }
    // Re-hydrate c1 — should move to the tail.
    store.dispatch({
      type: 'package/hydrateEnrichmentFromCache',
      payload: {
        channelId: 'c1',
        cache: {
          lastFetched: 99,
          messages: {},
          misses: { deleted: [], forbidden: [] },
        },
      },
    });
    expect(store.getState().package.enrichedOrder).toEqual(['c2', 'c3', 'c1']);
  });

  it('paints chips live via mergeEnrichmentDelta during the run', async () => {
    // Force the throttle to flush by returning a promise that resolves
    // on the macrotask queue — that gives enough elapsed time for the
    // 500ms timer gate to cross on at least one iteration after the
    // test advances time manually via a large message set.
    // Simpler approach: dispatch the reducer directly and verify merge.
    const { default: reducer } = await import('./packageSlice');
    const { mergeEnrichmentDelta } = await import('./packageSlice');

    const state1 = reducer(
      undefined,
      mergeEnrichmentDelta({
        channelId: 'c1',
        enriched: { '1': liveMessage('1') as never },
        deleted: ['9'],
        forbidden: [],
      }),
    );
    expect(state1.enrichedMessages.c1).toEqual({ '1': liveMessage('1') });
    expect(state1.enrichmentMisses.c1.deleted).toEqual(['9']);

    // A second delta merges without clobbering prior entries.
    const state2 = reducer(
      state1,
      mergeEnrichmentDelta({
        channelId: 'c1',
        enriched: { '2': liveMessage('2') as never },
        deleted: ['9', '8'], // 9 already there — dedup expected
        forbidden: ['7'],
      }),
    );
    expect(Object.keys(state2.enrichedMessages.c1)).toEqual(['1', '2']);
    expect([...state2.enrichmentMisses.c1.deleted].sort()).toEqual(['8', '9']);
    expect(state2.enrichmentMisses.c1.forbidden).toEqual(['7']);
  });

  it('uses the AROUND window cache to avoid redundant API calls', async () => {
    // One API call returns all three messages as the neighbor window —
    // subsequent targets should be served from the cache.
    mockFetchMessageData.mockImplementation(() =>
      Promise.resolve({
        success: true,
        status: 200,
        data: [liveMessage('1'), liveMessage('2'), liveMessage('3')],
      }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // Only one API call even though we enriched three messages — the
    // window cache served the other two for free.
    expect(mockFetchMessageData).toHaveBeenCalledTimes(1);
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('skips messages already known-deleted (from prior user delete)', async () => {
    // Seed the deleted-message cache via hydrate — simulates the user
    // having previously deleted message '2' in a prior session.
    await storage.package.set(`deleted:${USER_ID}`, { '200': ['2'] });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // '2' should not have been fetched — it's already known gone.
    const calledIds = mockFetchMessageData.mock.calls.map((c) => c[1]);
    expect(calledIds).not.toContain('2');
    expect(calledIds).toContain('1');
    expect(calledIds).toContain('3');

    // '2' still lands in misses.deleted so the UI paints it as gone.
    const state = store.getState().package;
    expect(state.enrichmentMisses['200'].deleted).toContain('2');
  });

  it('skips messages already known-deleted (from prior enrichment 404)', async () => {
    // Seed a previous cache where message '2' is already marked gone.
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 1,
      messages: {},
      misses: { deleted: ['2'], forbidden: [] },
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();
    // Use refresh=true so we bypass the cache short-circuit but still
    // honor the knownDeleted set read from that same cache.
    await store.dispatch(enrichPackageChannel({ channelId: '200', refresh: true }));

    const calledIds = mockFetchMessageData.mock.calls.map((c) => c[1]);
    expect(calledIds).not.toContain('2');
    // '2' preserved as deleted in the new misses map.
    const state = store.getState().package;
    expect(state.enrichmentMisses['200'].deleted).toContain('2');
  });

  it('preflight: search hit short-circuits per-message AROUND calls', async () => {
    // Preflight returns all 3 package messages in one search page.
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [liveMessage('1'), liveMessage('2'), liveMessage('3')],
        threads: [],
        total_results: 3,
      },
    });
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // Main loop never called fetchMessageData — all served by preflight.
    expect(mockFetchMessageData).not.toHaveBeenCalled();
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  // #264: a short search page mid-stream is index lag, not the end. The
  // preflight used to stop on any page under 25, missing the hits on the
  // pages after it.
  it('preflight: keeps paging after a short page while total_results says there is more', async () => {
    mockFetchSearchMessageData
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { messages: [liveMessage('1')], threads: [], total_results: 3 },
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { messages: [liveMessage('2'), liveMessage('3')], threads: [], total_results: 3 },
      });
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    expect(mockFetchSearchMessageData).toHaveBeenCalledTimes(2);
    // Page 2 starts after the one result page 1 returned.
    expect(mockFetchSearchMessageData.mock.calls[1][1]).toBe(1);
    expect(mockFetchMessageData).not.toHaveBeenCalled();
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('preflight: gaps in search results fall through to AROUND loop', async () => {
    // Preflight finds '1' and '3' but not '2' (deleted or indexing lag).
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [liveMessage('1'), liveMessage('3')],
        threads: [],
        total_results: 2,
      },
    });
    // AROUND loop handles the uncovered '2'.
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // Only '2' triggers an AROUND call; '1' and '3' are from preflight.
    expect(mockFetchMessageData).toHaveBeenCalledTimes(1);
    expect(mockFetchMessageData.mock.calls[0][1]).toBe('2');
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200']).sort())
      .toEqual(['1', '2', '3']);
  });

  it('preflight: type-19 reply without referenced_message falls through to AROUND', async () => {
    // Discord's /messages/search returns reply messages with the reply
    // preview in an adjacent context slot, not on referenced_message.
    // If we cached such replies, the package view would render the
    // "Original message was deleted" chip even when the parent is
    // alive on Discord. Force them through AROUND, where the bulk
    // channel-messages endpoint reliably populates referenced_message.
    const replyHit = {
      ...liveMessage('1'),
      type: 19,
      message_reference: {
        type: 0,
        channel_id: '200',
        message_id: 'parent-id',
        guild_id: 'guild-x',
      },
      // referenced_message intentionally absent (search response shape)
    };
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [replyHit, liveMessage('2'), liveMessage('3')],
        threads: [],
        total_results: 3,
      },
    });
    // AROUND will get called for '1' and must return a copy WITH
    // referenced_message populated (matching real Discord bulk-endpoint
    // behavior).
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) => {
        if (id === '1') {
          return Promise.resolve({
            success: true,
            status: 200,
            data: [
              {
                ...replyHit,
                referenced_message: { id: 'parent-id', content: 'parent' },
              },
            ],
          });
        }
        return Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] });
      },
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // '1' must have triggered an AROUND call despite being in the
    // preflight result set. '2' and '3' (no message_reference) are
    // served by the preflight cache.
    const calledIds = mockFetchMessageData.mock.calls.map((c) => c[1]);
    expect(calledIds).toEqual(['1']);
    const enriched = store.getState().package.enrichedMessages['200'];
    expect(
      (enriched['1'] as { referenced_message?: unknown }).referenced_message,
    ).toEqual({ id: 'parent-id', content: 'parent' });
  });

  it('preflight: type-19 reply WITH referenced_message stays cached', async () => {
    // The opposite of the above: when search returns a reply already
    // populated (rare but allowed by the API contract), we trust it
    // and short-circuit the AROUND call.
    const replyHit = {
      ...liveMessage('1'),
      type: 19,
      message_reference: {
        type: 0,
        channel_id: '200',
        message_id: 'parent-id',
        guild_id: 'guild-x',
      },
      referenced_message: { id: 'parent-id', content: 'parent' },
    };
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [replyHit, liveMessage('2'), liveMessage('3')],
        threads: [],
        total_results: 3,
      },
    });
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    expect(mockFetchMessageData).not.toHaveBeenCalled();
    const enriched = store.getState().package.enrichedMessages['200'];
    expect(
      (enriched['1'] as { referenced_message?: unknown }).referenced_message,
    ).toEqual({ id: 'parent-id', content: 'parent' });
  });

  it('preflight: 403 falls back cleanly to per-message AROUND loop', async () => {
    // Default beforeEach mock returns { success: false, status: 403 } —
    // relying on that here. AROUND loop should handle all 3 messages.
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    expect(mockFetchMessageData).toHaveBeenCalledTimes(3);
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('preflight: Message[][] (array-of-arrays) response is flattened', async () => {
    // Discord sometimes returns messages as Message[][] with context.
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [
          [liveMessage('1'), liveMessage('neighbor-a')],
          [liveMessage('2'), liveMessage('neighbor-b')],
          [liveMessage('3'), liveMessage('neighbor-c')],
        ] as never,
        threads: [],
        total_results: 3,
      },
    });
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    expect(mockFetchMessageData).not.toHaveBeenCalled();
    const state = store.getState().package;
    // All three package messages enriched; neighbor IDs ignored since
    // they aren't in the package.
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('preflight: paginates until a short page, then stops', async () => {
    // First page returns a full 25 results (still package-relevant),
    // second page returns a short page signaling end of results.
    const firstPageMessages = Array.from({ length: 25 }, (_, i) =>
      liveMessage(`extra-${i}`),
    );
    mockFetchSearchMessageData
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: {
          messages: firstPageMessages,
          threads: [],
          total_results: 27,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: {
          messages: [liveMessage('1'), liveMessage('2'), liveMessage('3')],
          threads: [],
          total_results: 27,
        },
      });
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    expect(mockFetchSearchMessageData).toHaveBeenCalledTimes(2);
    expect(mockFetchMessageData).not.toHaveBeenCalled();
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('preflight: cap-exceeded falls back to AROUND for uncovered ids', async () => {
    // Return 25 messages repeatedly so the loop advances offset and
    // eventually crosses the 5000-offset cap. None of the returned IDs
    // match the package — forcing the AROUND fallback for all 3.
    let searchCalls = 0;
    mockFetchSearchMessageData.mockImplementation(() => {
      searchCalls++;
      return Promise.resolve({
        success: true,
        status: 200,
        data: {
          messages: Array.from({ length: 25 }, (_, i) =>
            liveMessage(`extra-${searchCalls}-${i}`),
          ),
          threads: [],
          total_results: 999_999,
        },
      });
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // Preflight hit the cap (5000 / 25 = 200 pages). AROUND loop ran
    // for all 3 package messages since none matched search results.
    expect(searchCalls).toBeGreaterThanOrEqual(200);
    expect(mockFetchMessageData).toHaveBeenCalledTimes(3);
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200']).sort())
      .toEqual(['1', '2', '3']);
    // User-facing warning in status log. Phrase stays stable across
    // copy polish (#161): the warning explains that Discord caps a
    // single search at 5,000 results, so we anchor on the number.
    const hasCapWarning = (store.getState() as any).status?.entries
      ?.some((e: { message: string }) => e.message.includes('5,000 messages'));
    expect(hasCapWarning).toBe(true);
  });

  it('preflight: progress bar advances as pages come in (not stuck at 0/0)', async () => {
    // Two pages of search results — both return package-matching IDs.
    // Between pages we should see progress climb past 0.
    const progressSnapshots: Array<{ current: number; total: number } | null> = [];
    mockFetchSearchMessageData
      .mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          status: 200,
          data: {
            messages: Array.from({ length: 25 }, (_, i) =>
              liveMessage(`page1-${i}`),
            ),
            threads: [],
            total_results: 50,
          },
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          status: 200,
          data: {
            messages: [liveMessage('1'), liveMessage('2'), liveMessage('3')],
            threads: [],
            total_results: 50,
          },
        }),
      );
    const store = await primedStore();
    // Record progress after each reducer pass.
    const unsubscribe = store.subscribe(() => {
      const p = store.getState().package.enrichmentProgress['200'];
      if (p) progressSnapshots.push({ ...p });
    });
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    unsubscribe();

    // Total was set to messages.length (3) at thunk start — not 0.
    expect(progressSnapshots.some((p) => p && p.total === 3)).toBe(true);
    // At some point during the run, current advanced past 0 — confirming
    // the preflight's onPageComplete dispatched live progress.
    const anyNonZero = progressSnapshots.some(
      (p) => p && p.current > 0 && p.current <= p.total,
    );
    expect(anyNonZero).toBe(true);
  });

  it('preflight progress reflects package-overlap, not total search results', async () => {
    // Reproduces the "stuck at 58/60" bug: search returns far more
    // user messages in the date range than there are in the package.
    // Bar must track the *package* matches (≤ messages.length), not
    // the raw search-result count, otherwise it pegs at messages.length
    // before the AROUND loop has had a chance to walk through.
    //
    // Package has 3 messages ('1','2','3'). Preflight returns one
    // package match ('1') alongside many non-package user messages.
    // The progress bar must NOT jump past 1 during preflight.
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [
          liveMessage('1'),
          ...Array.from({ length: 22 }, (_, i) =>
            liveMessage(`other-channel-${i}`),
          ),
        ],
        threads: [],
        total_results: 23,
      },
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );

    const progressSnapshots: Array<{ current: number; total: number }> = [];
    const store = await primedStore();
    const unsubscribe = store.subscribe(() => {
      const p = store.getState().package.enrichmentProgress['200'];
      if (p) progressSnapshots.push({ ...p });
    });
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    unsubscribe();

    // Every recorded snapshot must satisfy current <= total. Pre-fix,
    // the bar climbed to min(23, 3) = 3 instantly during preflight.
    // Post-fix, it advances at most 1 step per package-matching hit.
    for (const snap of progressSnapshots) {
      expect(snap.current).toBeLessThanOrEqual(snap.total);
    }
    // The first non-zero progress snapshot (from preflight) must be 1,
    // not 3 — proving we used packageHitsSoFar, not foundById.size.
    const firstNonZero = progressSnapshots.find((p) => p.current > 0);
    expect(firstNonZero).toBeDefined();
    expect(firstNonZero!.current).toBe(1);
    // Final progress lands at total once AROUND fills the gaps.
    expect(progressSnapshots[progressSnapshots.length - 1]).toEqual({
      current: 3,
      total: 3,
    });
  });

  it('preflight status log reports package-overlap count, not raw search hits', async () => {
    // "Channel scan matched X of N package messages" — X is the
    // number of *package* IDs returned by search, not the total
    // number of user messages in the date range.
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [
          liveMessage('1'),
          liveMessage('2'),
          ...Array.from({ length: 10 }, (_, i) =>
            liveMessage(`other-channel-${i}`),
          ),
        ],
        threads: [],
        total_results: 12,
      },
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const entries: Array<{ message: string }> =
      (store.getState() as any).status?.entries ?? [];
    const scanLog = entries.find((e) =>
      e.message.startsWith('Channel scan matched '),
    );
    expect(scanLog).toBeDefined();
    // 2 package messages ('1','2') matched out of 3 total in the package.
    expect(scanLog!.message).toContain('matched 2 of 3 package messages');
  });

  it('preflight: chips paint live during preflight via delta dispatches', async () => {
    // First page has 25 results with one package match ('1'), forcing
    // pagination. Second page (partial) has the remaining two.
    const page1Messages = [
      liveMessage('1'),
      ...Array.from({ length: 24 }, (_, i) => liveMessage(`extra-${i}`)),
    ];
    mockFetchSearchMessageData
      .mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          status: 200,
          data: {
            messages: page1Messages,
            threads: [],
            total_results: 27,
          },
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          status: 200,
          data: {
            messages: [liveMessage('2'), liveMessage('3')],
            threads: [],
            total_results: 27,
          },
        }),
      );
    const store = await primedStore();
    // Watch for a mid-preflight partial enrichment state.
    let sawMidRunPartialEnrichment = false;
    const unsubscribe = store.subscribe(() => {
      const enriched = store.getState().package.enrichedMessages['200'];
      if (
        enriched &&
        Object.keys(enriched).length > 0 &&
        Object.keys(enriched).length < 3
      ) {
        sawMidRunPartialEnrichment = true;
      }
    });
    await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    unsubscribe();

    expect(sawMidRunPartialEnrichment).toBe(true);
    const final = store.getState().package.enrichedMessages['200'];
    expect(Object.keys(final).sort()).toEqual(['1', '2', '3']);
  });

  it('preflight: 404 aborts the run without per-message AROUND calls', async () => {
    // Guild search 404 = user no longer has access to the guild.
    // The AROUND loop would produce N more 404s and poison the
    // deleted-cache with false positives, so we abort instead.
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: false,
      status: 404,
    });
    const store = await primedStore();

    const action = await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    expect(action.type).toBe('package/enrichChannel/fulfilled');

    // No AROUND calls should have fired — the loop was skipped.
    expect(mockFetchMessageData).not.toHaveBeenCalled();

    const payload = action.payload as {
      channelInaccessible?: boolean;
      inaccessibleStatus?: number;
    };
    expect(payload.channelInaccessible).toBe(true);
    expect(payload.inaccessibleStatus).toBe(404);

    const state = store.getState().package;
    expect(state.enrichmentStatus['200']).toBe('failed');
    expect(state.enrichmentError['200']).toContain('404');
    // No false-positive "deleted" entries pollute the cache.
    expect(state.enrichmentMisses['200']?.deleted ?? []).toEqual([]);
    // Prominent error message in the status log. Anchor on the
    // user-facing phrase from #161; "inaccessible" used to appear
    // verbatim but was rephrased to "no longer accessible".
    const hasAbortMessage = (store.getState() as any).status?.entries
      ?.some((e: { message: string }) => e.message.includes('no longer accessible'));
    expect(hasAbortMessage).toBe(true);
  });

  it('preflight: 404 with previous cache preserves the cached data', async () => {
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 42,
      messages: { '1': liveMessage('1') as never, '2': liveMessage('2') as never },
      misses: { deleted: [], forbidden: [] },
    });
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: false,
      status: 404,
    });
    const store = await primedStore();
    // Force the refresh=true path so we bypass the cache short-circuit
    // and actually run preflight.
    await store.dispatch(enrichPackageChannel({ channelId: '200', refresh: true }));

    // The old cache on disk is untouched.
    const cached = await enrichmentCache.get(USER_ID, '200');
    expect(Object.keys(cached?.messages ?? {}).sort()).toEqual(['1', '2']);
    // Redux state likewise shows the preserved data (not an empty
    // state from the aborted run).
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200']).sort()).toEqual(['1', '2']);
  });

  it('preflight: non-403 error (e.g. 500) falls back cleanly', async () => {
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: false,
      status: 500,
    });
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    // Only one preflight attempt, then AROUND took over for all 3.
    expect(mockFetchSearchMessageData).toHaveBeenCalledTimes(1);
    expect(mockFetchMessageData).toHaveBeenCalledTimes(3);
    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1', '2', '3']);
  });

  it('preflight: thrown exception is caught, main loop still runs', async () => {
    mockFetchSearchMessageData.mockRejectedValueOnce(
      new TypeError('network blip'),
    );
    mockFetchMessageData.mockImplementation(
      (_t: string, id: string) =>
        Promise.resolve({ success: true, status: 200, data: [liveMessage(id)] }),
    );
    const store = await primedStore();

    const action = await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    expect(action.type).toBe('package/enrichChannel/fulfilled');
    expect(mockFetchMessageData).toHaveBeenCalledTimes(3);
  });

  it('preflight: cancellation mid-preflight sets cancelled and preserves no partial cache', async () => {
    // Cancel on the very first checkCancelled call (inside preflight).
    mockCheckCancelled.mockReset().mockReturnValue(true);
    // If search ever runs, return something — but cancel should fire first.
    mockFetchSearchMessageData.mockResolvedValue({
      success: true,
      status: 200,
      data: {
        messages: [liveMessage('1'), liveMessage('2'), liveMessage('3')],
        threads: [],
        total_results: 3,
      },
    });
    const store = await primedStore();

    const action = await store.dispatch(enrichPackageChannel({ channelId: '200' }));
    // Thunk still fulfills (cancellation is a normal exit, not an error).
    expect(action.type).toBe('package/enrichChannel/fulfilled');
    const state = store.getState().package;
    expect(state.enrichmentStatus['200']).toBe('cancelled');
    // No search calls completed, so no messages got enriched.
    expect(state.enrichedMessages['200'] ?? {}).toEqual({});
    // Partial empty cache is persisted (no previous cache existed).
    const cached = await enrichmentCache.get(USER_ID, '200');
    expect(Object.keys(cached?.messages ?? {})).toEqual([]);
  });

  it('preflight does not override knownDeleted: stale search hits stay marked deleted', async () => {
    // User previously deleted message '2'.
    await storage.package.set(`deleted:${USER_ID}`, { '200': ['2'] });
    // Preflight search is stale and still returns '2' alongside others.
    mockFetchSearchMessageData.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: {
        messages: [liveMessage('1'), liveMessage('2'), liveMessage('3')],
        threads: [],
        total_results: 3,
      },
    });
    const store = await primedStore();

    await store.dispatch(enrichPackageChannel({ channelId: '200' }));

    const state = store.getState().package;
    // '2' is NOT in enriched — knownDeleted wins over windowCache hit.
    expect(Object.keys(state.enrichedMessages['200']).sort())
      .toEqual(['1', '3']);
    expect(state.enrichmentMisses['200'].deleted).toContain('2');
    // '2' was never fetched via AROUND either.
    expect(mockFetchMessageData).not.toHaveBeenCalled();
  });

  it('hydrateCachedEnrichment: loads IDB cache into state when present', async () => {
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 999,
      messages: { '1': liveMessage('1') as never },
      misses: { deleted: ['2'], forbidden: [] },
    });
    const store = await primedStore();

    const action = await store.dispatch(hydrateCachedEnrichment({ channelId: '200' }));
    expect(action.type).toBe('package/hydrateCachedEnrichment/fulfilled');
    expect((action.payload as { hydrated: boolean }).hydrated).toBe(true);

    const state = store.getState().package;
    expect(Object.keys(state.enrichedMessages['200'])).toEqual(['1']);
    expect(state.enrichmentMisses['200'].deleted).toEqual(['2']);
    // No API calls — pure IDB read.
    expect(mockFetchMessageData).not.toHaveBeenCalled();
    expect(mockFetchSearchMessageData).not.toHaveBeenCalled();
  });

  it('hydrateCachedEnrichment: no-op when no cache present', async () => {
    const store = await primedStore();
    const action = await store.dispatch(hydrateCachedEnrichment({ channelId: '200' }));
    expect((action.payload as { hydrated: boolean }).hydrated).toBe(false);
    expect(store.getState().package.enrichedMessages['200']).toBeUndefined();
  });

  it('hydrateCachedEnrichment: no-op when enrichment already running', async () => {
    await enrichmentCache.put(USER_ID, '200', {
      lastFetched: 1,
      messages: { '1': liveMessage('1') as never },
      misses: { deleted: [], forbidden: [] },
    });
    const store = await primedStore();
    // Simulate in-flight enrichment.
    store.dispatch({
      type: enrichPackageChannel.pending.type,
      meta: { arg: { channelId: '200' }, requestId: 'x', requestStatus: 'pending' as const },
    });

    const action = await store.dispatch(hydrateCachedEnrichment({ channelId: '200' }));
    expect((action.payload as { hydrated: boolean }).hydrated).toBe(false);
  });

  it('records the active channel while running and clears it when done', async () => {
    mockFetchMessageData.mockImplementation(
      (_token: string, targetId: string) =>
        Promise.resolve({
          success: true,
          status: 200,
          data: [liveMessage(targetId)],
        }),
    );
    const store = await primedStore();

    const p = store.dispatch(enrichPackageChannel({ channelId: '200' }));
    // `pending` fires synchronously on dispatch — active channel is set
    // before the async payload creator returns.
    expect(store.getState().package.activeEnrichmentChannelId).toBe('200');
    expect(store.getState().package.enrichmentStatus['200']).toBe('running');

    await p;

    expect(store.getState().package.activeEnrichmentChannelId).toBeNull();
    expect(store.getState().package.enrichmentStatus['200']).toBe('done');
  });
});
