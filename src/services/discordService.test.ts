import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import type { RateLimitInfo } from 'discrub-core/discord-service';

const constructorSpy = vi.fn();

vi.mock('discrub-core/discord-service', () => ({
  DiscordService: class {
    onRateLimit?: unknown;
    onRateLimitExceeded?: unknown;
    onNetworkFailureStreak?: unknown;
    onDelay?: unknown;
    constructor(...args: unknown[]) {
      constructorSpy(...args);
    }
  },
}));

describe('discordService singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    constructorSpy.mockClear();
  });

  it('constructs the service with autoDelay off — the app owns all pacing (#241)', async () => {
    const { getDiscordService } = await import('./discordService');
    getDiscordService();

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledWith(undefined, { autoDelay: false });
  });

  it('keeps autoDelay off when reinitialized with settings', async () => {
    const { getDiscordService } = await import('./discordService');
    const settings = { searchDelay2: 2 } as unknown as AppSettings;

    getDiscordService();
    getDiscordService(settings);

    expect(constructorSpy).toHaveBeenCalledTimes(2);
    expect(constructorSpy).toHaveBeenLastCalledWith(settings, { autoDelay: false });
  });

  it('reuses the instance when called without settings', async () => {
    const { getDiscordService } = await import('./discordService');

    const first = getDiscordService();
    const second = getDiscordService();

    expect(first).toBe(second);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  describe('network-failure streak hook (GH #14 refused requests)', () => {
    const setOnline = (online: boolean) =>
      Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });

    it('stops the operation when several fetches throw while online: error log, cancel flag, toast', async () => {
      setOnline(true);
      const { getDiscordService, storeReady } = await import('./discordService');
      const { store } = await import('@/app/store');
      const { selectStatusEntries, selectToast } = await import('@features/status/statusSlice');
      const { selectDiscrubCancelled, selectDiscrubPaused, selectRequestsRefusedStopped, setDiscrubPaused } = await import('@features/app/appSlice');
      const service = getDiscordService() as unknown as { onNetworkFailureStreak: (n: number) => void };
      store.dispatch(setDiscrubPaused(true));
      await storeReady();

      service.onNetworkFailureStreak(3);

      const state = store.getState();
      expect(selectDiscrubCancelled(state)).toBe(true);
      expect(selectDiscrubPaused(state)).toBe(false);
      expect(selectRequestsRefusedStopped(state)).toBe(true);
      const last = selectStatusEntries(state).slice(-1)[0];
      expect(last?.level).toBe('error');
      expect(last?.message).toContain('Discord stopped answering requests while your connection was up (3 in a row)');
      expect(selectToast(state).level).toBe('error');
      expect(selectToast(state).message).toBe('Stopped: Discord is refusing requests from this account. Wait an hour before trying again.');

      // Later failures in the same dying run don't stack more entries.
      const before = selectStatusEntries(store.getState()).length;
      service.onNetworkFailureStreak(4);
      expect(selectStatusEntries(store.getState()).length).toBe(before);
    });

    it('does nothing while the browser is offline: the pause-and-Resume path applies', async () => {
      setOnline(false);
      try {
        const { getDiscordService, storeReady } = await import('./discordService');
        const { store } = await import('@/app/store');
        const { selectDiscrubCancelled, selectRequestsRefusedStopped } = await import('@features/app/appSlice');
        const service = getDiscordService() as unknown as { onNetworkFailureStreak: (n: number) => void };
        await storeReady();

        service.onNetworkFailureStreak(3);

        expect(selectDiscrubCancelled(store.getState())).toBe(false);
        expect(selectRequestsRefusedStopped(store.getState())).toBe(false);
      } finally {
        setOnline(true);
      }
    });
  });

  describe('rate-limit hooks (#254)', () => {
    const info = (overrides: Partial<RateLimitInfo> = {}): RateLimitInfo => ({
      retryAfter: 5,
      global: false,
      source: 'json',
      consecutive: 1,
      capped: false,
      ...overrides,
    });

    it('logs each 429 wait, noting global limits and streaks', async () => {
      const { getDiscordService } = await import('./discordService');
      const { store } = await import('@/app/store');
      const { selectStatusEntries } = await import('@features/status/statusSlice');
      const service = getDiscordService() as unknown as {
        onRateLimit: (retryAfter: number, info: RateLimitInfo) => Promise<void>;
      };

      await service.onRateLimit(2.5, info({ global: true, consecutive: 3 }));

      const last = selectStatusEntries(store.getState()).slice(-1)[0];
      expect(last?.level).toBe('warning');
      expect(last?.message).toBe('Rate limited by Discord (global limit), retrying in 2.5s, 3 in a row');
    });

    it('shows a wait of two seconds or more to the layouts and takes it away after (2.2.2)', async () => {
      vi.useFakeTimers();
      try {
        const { showDiscordWait } = await import('./discordService');
        const { store } = await import('@/app/store');
        const { selectOperationHold, setOperationHold } = await import('@features/app/appSlice');
        store.dispatch(setOperationHold(null));

        showDiscordWait(store, 1.5);
        expect(selectOperationHold(store.getState())).toBeNull();

        showDiscordWait(store, 8);
        expect(selectOperationHold(store.getState())).toMatchObject({ kind: 'discordWait' });
        vi.advanceTimersByTime(8000);
        expect(selectOperationHold(store.getState())).toBeNull();

        // A retry hold already showing is left alone, by the wait and by its timer.
        const retry = { kind: 'retryWait' as const, until: 1, attempt: 1, max: 5, answer: 'x' };
        store.dispatch(setOperationHold(retry));
        showDiscordWait(store, 8);
        vi.advanceTimersByTime(8000);
        expect(selectOperationHold(store.getState())).toEqual(retry);
        store.dispatch(setOperationHold(null));
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops the operation when core gives up on a storm: error log, cancel flag, toast', async () => {
      const { getDiscordService, storeReady, RATE_LIMIT_STOP_MESSAGE } = await import('./discordService');
      const { store } = await import('@/app/store');
      const { selectStatusEntries, selectToast } = await import('@features/status/statusSlice');
      const { selectDiscrubCancelled, selectDiscrubPaused, selectRateLimitStopped, setDiscrubPaused } = await import('@features/app/appSlice');
      const service = getDiscordService() as unknown as {
        onRateLimitExceeded: (info: RateLimitInfo) => void;
      };
      store.dispatch(setDiscrubPaused(true));
      await storeReady();

      service.onRateLimitExceeded(info({ retryAfter: 600, consecutive: 1, capped: true }));

      // Synchronous: the cancel flag is set before any await, so a loop
      // that reads it right after the failing request already sees it.
      const state = store.getState();
      expect(selectDiscrubCancelled(state)).toBe(true);
      expect(selectDiscrubPaused(state)).toBe(false);
      expect(selectRateLimitStopped(state)).toBe(true);
      const last = selectStatusEntries(state).slice(-1)[0];
      expect(last?.level).toBe('error');
      expect(last?.message).toContain(RATE_LIMIT_STOP_MESSAGE);
      expect(last?.message).toContain('600s');
      expect(selectToast(state).isVisible).toBe(true);
      expect(selectToast(state).level).toBe('error');
    });
  });
});
