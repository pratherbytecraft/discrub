import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureStore,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import packageReducer, {
  deletePackageMessages,
  importPackage,
  initialPackageState,
  loadPackageChannelMessages,
  resumeStoredPackage,
  selectAllChannelMessages,
  selectChannelDeletedMessageCount,
  selectPackageDeletedMessageCount,
  selectChannelGoneMessageCount,
  selectPackageGoneMessageCount,
  ALREADY_GONE_DELAY_MS,
  clearChannelMessageSelection,
  toggleMessageSelection,
  __testHelpers__,
} from './packageSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import { buildFixturePackage } from '@/test/package-fixtures';
import { storage } from '@/extension/storage';
import { calculateRandomDelay } from '@utils/delayUtils';
import { cancellableDelay } from '@utils/operationLoopUtils';
import { externalDeletionsRecorded } from './packageDeletedCache';
import type { RootState } from '@/app/store';

const mockDeleteMessage = vi.fn();

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    deleteMessage: mockDeleteMessage,
  })),
}));

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
  checkCancelled: vi.fn().mockReturnValue(false),
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

function makeStore(currentUserId = '253286221395001345', token: string | null = 'tok') {
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
  };
  if (token) {
    store.dispatch({ type: 'auth/setToken', payload: token });
  }
  if (currentUserId) {
    store.dispatch({
      type: 'user/setCurrentUser',
      payload: { id: currentUserId, username: 'tester' },
    });
  }
  return store;
}

describe('packageSlice — selection reducers', () => {
  it('toggleMessageSelection adds and removes message IDs', () => {
    const store = makeStore();
    store.dispatch(toggleMessageSelection({ channelId: 'c1', messageId: 'm1' }));
    store.dispatch(toggleMessageSelection({ channelId: 'c1', messageId: 'm2' }));
    expect(store.getState().package.selectedMessageIds.c1).toEqual(['m1', 'm2']);

    store.dispatch(toggleMessageSelection({ channelId: 'c1', messageId: 'm1' }));
    expect(store.getState().package.selectedMessageIds.c1).toEqual(['m2']);
  });

  it('selectAllChannelMessages replaces the selection atomically', () => {
    const store = makeStore();
    store.dispatch(toggleMessageSelection({ channelId: 'c1', messageId: 'm1' }));
    store.dispatch(selectAllChannelMessages({ channelId: 'c1', messageIds: ['a', 'b', 'c'] }));
    expect(store.getState().package.selectedMessageIds.c1).toEqual(['a', 'b', 'c']);
  });

  it('clearChannelMessageSelection removes the channel entry entirely', () => {
    const store = makeStore();
    store.dispatch(selectAllChannelMessages({ channelId: 'c1', messageIds: ['a'] }));
    store.dispatch(clearChannelMessageSelection('c1'));
    expect(store.getState().package.selectedMessageIds.c1).toBeUndefined();
  });

  it('last toggle that empties a channel removes it from state', () => {
    const store = makeStore();
    store.dispatch(toggleMessageSelection({ channelId: 'c1', messageId: 'm1' }));
    store.dispatch(toggleMessageSelection({ channelId: 'c1', messageId: 'm1' }));
    expect(store.getState().package.selectedMessageIds.c1).toBeUndefined();
  });
});

describe('packageSlice — deletePackageMessages', () => {
  beforeEach(async () => {
    mockDeleteMessage.mockReset();
    __testHelpers__.storeSourceFile(null);
    // `importPackage` re-hydrates the persisted deleted-message cache
    // via IDB. Without clearing here, state from a prior test leaks
    // in and the new pre-filter (gone messages can't be re-deleted)
    // rejects the run.
    await storage.package.clear();
  });

  async function primedStore() {
    const store = makeStore();
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));
    await store.dispatch(loadPackageChannelMessages('200'));
    store.dispatch(
      selectAllChannelMessages({
        channelId: '200',
        messageIds: ['1', '2', '3'],
      }),
    );
    return store;
  }

  // discrub-core's `deleteMessage` does not throw on HTTP errors; its
  // `withRetry` wrapper catches and returns `{ success, status }`. The
  // tests below stub that contract directly. Pre-#161 stubs threw on
  // 404/403 (and the slice categorized via a catch block), but that
  // never reflected production — every error fell through to the
  // try-block's `result.deleted += 1` and the polished banner exposed
  // the false positive. The slice and these stubs now match reality.
  it('counts successful deletes', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();

    const action = await store.dispatch(deletePackageMessages({ channelId: '200' }));
    expect(action.type).toBe('package/deleteMessages/fulfilled');

    const state = store.getState().package;
    expect(state.deleteStatus).toBe('ready');
    expect(state.deleteResult?.deleted).toBe(3);
    expect(state.deleteResult?.failed).toBe(0);
    expect(state.selectedMessageIds['200']).toBeUndefined();
  });

  it('tolerates 404 as alreadyGone', async () => {
    mockDeleteMessage.mockImplementation(async (_t, id) => {
      if (id === '2') return { success: false, status: 404 };
      return { success: true, status: 204 };
    });
    const store = await primedStore();

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const result = store.getState().package.deleteResult;
    expect(result?.deleted).toBe(2);
    expect(result?.alreadyGone).toBe(1);
    expect(result?.failed).toBe(0);

    // #271: the union keeps every gone id, the subset only the 404.
    const pkg = store.getState().package;
    expect(pkg.deletedMessageIds['200']).toEqual(['1', '3', '2']);
    expect(pkg.goneMessageIds['200']).toEqual(['2']);
    expect(await storage.package.get(`deleted:${FIXTURE_USER_ID}`)).toEqual({ '200': ['1', '3', '2'] });
    expect(await storage.package.get(`gone:${FIXTURE_USER_ID}`)).toEqual({ '200': ['2'] });
  });

  it('keeps real deletions out of the gone subset and its persisted key (#271)', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();
    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    expect(store.getState().package.goneMessageIds['200']).toBeUndefined();
    expect(await storage.package.get(`deleted:${FIXTURE_USER_ID}`)).toEqual({ '200': ['1', '2', '3'] });
    expect(await storage.package.get(`gone:${FIXTURE_USER_ID}`)).toBeFalsy();
  });

  it('a run where everything was already gone warns and says nothing was deleted (#271)', async () => {
    mockDeleteMessage.mockResolvedValue({ success: false, status: 404 });
    const store = await primedStore();
    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const entries = store.getState().status.entries;
    const summary = entries.find((e) => e.message.startsWith('Nothing to delete.'));
    expect(summary?.level).toBe('warning');
    expect(summary?.message).toBe('Nothing to delete. All 3 messages were already gone on Discord.');
    // More than half were gone, so the rehydrate hint follows.
    expect(entries.some((e) => e.level === 'warning' && e.message.includes('Rehydrate this channel first'))).toBe(true);
  });

  it('a mixed run keeps the success level and the existing sentence (#271)', async () => {
    mockDeleteMessage.mockImplementation(async (_t, id) => {
      if (id === '2') return { success: false, status: 404 };
      return { success: true, status: 204 };
    });
    const store = await primedStore();
    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const entries = store.getState().status.entries;
    const summary = entries.find((e) => e.message.startsWith('Deleted 2 messages.'));
    expect(summary?.level).toBe('success');
    expect(summary?.message).toBe('Deleted 2 messages. 1 message was already gone on Discord.');
    expect(entries.some((e) => e.message.includes('Rehydrate this channel first'))).toBe(false);
  });

  it('waits only a short floor after a 404 instead of the full Delete Delay (#271)', async () => {
    vi.mocked(calculateRandomDelay).mockReturnValue({ delayMs: 2000, delaySec: 2 } as never);
    mockDeleteMessage.mockImplementation(async (_t, id) => {
      if (id === '1') return { success: false, status: 404 };
      return { success: true, status: 204 };
    });
    const store = await primedStore();
    vi.mocked(cancellableDelay).mockClear();
    await store.dispatch(deletePackageMessages({ channelId: '200' }));
    vi.mocked(calculateRandomDelay).mockReturnValue({ delayMs: 0, delaySec: 0 } as never);

    // Three messages, two waits: after the 404 (short) and after the
    // real delete (full). No wait after the last one.
    const waits = vi.mocked(cancellableDelay).mock.calls.map((c) => c[0]);
    expect(waits).toEqual([ALREADY_GONE_DELAY_MS, 2000]);
  });

  it('logs a progress line every 50 already-gone answers (#271)', async () => {
    mockDeleteMessage.mockResolvedValue({ success: false, status: 404 });
    const store = makeStore();
    await store.dispatch(importPackage(await buildFixturePackage()));
    await store.dispatch(loadPackageChannelMessages('200'));
    const ids = Array.from({ length: 120 }, (_, i) => `stale-${i}`);
    store.dispatch(selectAllChannelMessages({ channelId: '200', messageIds: ids }));

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const lines = store.getState().status.entries.filter((e) => e.message.includes('were already gone on Discord.') && e.level === 'info');
    expect(lines.map((l) => l.message)).toEqual([
      '50 of the 50 messages tried so far were already gone on Discord.',
      '100 of the 100 messages tried so far were already gone on Discord.',
    ]);
    expect(store.getState().package.goneMessageIds['200']).toHaveLength(120);
  });

  it('skips ids the live purge already reported as gone (#271)', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();
    store.dispatch(externalDeletionsRecorded({ channelId: '200', ids: ['2'] }));

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
    expect(mockDeleteMessage).not.toHaveBeenCalledWith('tok', '2', '200');
  });

  it('categorizes 403 as forbidden', async () => {
    mockDeleteMessage.mockResolvedValue({ success: false, status: 403 });
    const store = await primedStore();

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const result = store.getState().package.deleteResult;
    expect(result?.forbidden).toBe(3);
    expect(result?.deleted).toBe(0);
  });

  it('falls through to "failed" for unexpected HTTP statuses (e.g. 500)', async () => {
    mockDeleteMessage.mockResolvedValue({ success: false, status: 500 });
    const store = await primedStore();

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const result = store.getState().package.deleteResult;
    expect(result?.failed).toBe(3);
    expect(result?.deleted).toBe(0);
  });

  it('still routes a thrown exception through the catch fallback', async () => {
    // Defensive: if the lib's contract ever changes back to throwing,
    // we still categorize correctly rather than miscount as deleted.
    mockDeleteMessage.mockImplementation(async () => {
      throw { status: 404, message: 'Not Found' };
    });
    const store = await primedStore();

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    const result = store.getState().package.deleteResult;
    expect(result?.alreadyGone).toBe(3);
    expect(result?.deleted).toBe(0);
  });

  it('rejects when package is read-only', async () => {
    const store = makeStore('different-user');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));
    await store.dispatch(loadPackageChannelMessages('200'));
    store.dispatch(selectAllChannelMessages({ channelId: '200', messageIds: ['1'] }));

    const action = await store.dispatch(deletePackageMessages({ channelId: '200' }));
    expect(action.type).toBe('package/deleteMessages/rejected');
    expect(mockDeleteMessage).not.toHaveBeenCalled();
  });

  it('rejects when channel is orphan', async () => {
    const store = makeStore();
    const blob = await buildFixturePackage({ includeOrphanChannel: true });
    await store.dispatch(importPackage(blob));
    store.dispatch(selectAllChannelMessages({ channelId: '400', messageIds: ['20'] }));

    const action = await store.dispatch(deletePackageMessages({ channelId: '400' }));
    expect(action.type).toBe('package/deleteMessages/rejected');
    expect(mockDeleteMessage).not.toHaveBeenCalled();
  });

  it('rejects when no auth token', async () => {
    const store = makeStore('253286221395001345', null);
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));
    store.dispatch(selectAllChannelMessages({ channelId: '200', messageIds: ['1'] }));

    const action = await store.dispatch(deletePackageMessages({ channelId: '200' }));
    expect(action.type).toBe('package/deleteMessages/rejected');
  });

  it('skips messages already in the deleted-message cache', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const { hydratePackageDeletedCache } = await import('./packageSlice');
    const store = await primedStore();
    store.dispatch({
      type: hydratePackageDeletedCache.fulfilled.type,
      payload: { deleted: { '200': ['2'] }, gone: {} },
      meta: { requestStatus: 'fulfilled' },
    });

    const action = await store.dispatch(deletePackageMessages({ channelId: '200' }));
    expect(action.type).toBe('package/deleteMessages/fulfilled');
    expect(mockDeleteMessage).toHaveBeenCalledTimes(2);
    const calledIds = mockDeleteMessage.mock.calls.map((c) => c[1]);
    expect(calledIds).toEqual(['1', '3']);
  });

  it('rejects when every selected message is already gone', async () => {
    const { hydratePackageDeletedCache } = await import('./packageSlice');
    const store = await primedStore();
    store.dispatch({
      type: hydratePackageDeletedCache.fulfilled.type,
      payload: { '200': ['1', '2', '3'] },
      meta: { requestStatus: 'fulfilled' },
    });

    const action = await store.dispatch(deletePackageMessages({ channelId: '200' }));
    expect(action.type).toBe('package/deleteMessages/rejected');
    expect(mockDeleteMessage).not.toHaveBeenCalled();
  });

  it('keeps confirmed-gone messages visible in loadedChannels after delete', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();

    const before = store.getState().package.loadedChannels['200'];
    expect(before?.length).toBe(3);

    await store.dispatch(deletePackageMessages({ channelId: '200' }));

    // Previously these rows were stripped from loadedChannels to hide
    // them; now they remain so the table can render them with the
    // "gone" visual treatment.
    const after = store.getState().package.loadedChannels['200'];
    expect(after?.length).toBe(3);
    expect(store.getState().package.deletedMessageIds['200']).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});

/* ────────── #236: live remaining counts + hydrate ordering ────────── */

const FIXTURE_USER_ID = '253286221395001345';

function stateWith(overrides: Partial<typeof initialPackageState>): RootState {
  return {
    package: { ...initialPackageState, ...overrides },
  } as unknown as RootState;
}

const minimalParsed = {
  user: {
    id: FIXTURE_USER_ID,
    username: 'tester',
    globalName: null,
    avatarHash: null,
  },
  guilds: [],
  channels: [
    {
      id: '200',
      type: 0,
      name: 'general',
      guildId: 'g1',
      guildName: 'Guild A',
      messageCount: 3,
      isOrphan: false,
    },
  ],
  totalMessages: 3,
  packageSizeBytes: 1,
} as never;

describe('packageSlice — #236 deleted-count selectors', () => {
  it('selectChannelDeletedMessageCount returns per-channel counts (0 when absent)', () => {
    const state = stateWith({ deletedMessageIds: { '200': ['1', '2'] } });
    expect(selectChannelDeletedMessageCount('200')(state)).toBe(2);
    expect(selectChannelDeletedMessageCount('999')(state)).toBe(0);
  });

  it('selectPackageDeletedMessageCount only counts ids for channels in the parsed package', () => {
    // 'stale-channel' simulates a leftover cache entry from an older
    // export of the same account — it must not skew this package's total.
    const state = stateWith({
      parsed: minimalParsed,
      deletedMessageIds: {
        '200': ['1', '2'],
        'stale-channel': ['9', '10', '11'],
      },
    });
    expect(selectPackageDeletedMessageCount(state)).toBe(2);
  });

  it('selectPackageDeletedMessageCount is 0 without a parsed package', () => {
    const state = stateWith({
      parsed: null,
      deletedMessageIds: { '200': ['1'] },
    });
    expect(selectPackageDeletedMessageCount(state)).toBe(0);
  });
});

describe('packageSlice — #236 deleted-cache hydrate ordering', () => {
  beforeEach(async () => {
    __testHelpers__.storeSourceFile(null);
    await storage.package.clear();
  });

  it('importPackage applies the persisted deleted cache atomically with the parsed payload', async () => {
    await storage.package.set(`deleted:${FIXTURE_USER_ID}`, {
      '200': ['1', '2'],
    });
    const store = makeStore();
    await store.dispatch(importPackage(await buildFixturePackage()));

    // Asserted immediately after the thunk settles — no extra microtask
    // flush. Pre-#236 a fire-and-forget hydrate raced the fulfilled
    // reducer's `deletedMessageIds = {}` reset and only won by accident
    // of IDB latency.
    expect(store.getState().package.deletedMessageIds['200']).toEqual([
      '1',
      '2',
    ]);
  });

  it('F19: import prunes cached ids the fresh archive no longer contains', async () => {
    // A package requested AFTER a purge already excludes those messages
    // from its archive and counts — carrying their ids forward would
    // subtract them a second time (small channels read "empty").
    await storage.package.set(`deleted:${FIXTURE_USER_ID}`, {
      '200': ['1', 'purged-before-this-archive'],
      'channel-not-in-archive': ['x1', 'x2'],
    });
    const store = makeStore();
    await store.dispatch(importPackage(await buildFixturePackage()));

    const map = store.getState().package.deletedMessageIds;
    // '1' still exists in the archive (purge happened after this package
    // was generated) — it remains a valid subtraction.
    expect(map['200']).toEqual(['1']);
    expect(map['channel-not-in-archive']).toBeUndefined();

    // The pruned map is persisted so later resumes stay consistent.
    const persisted = await storage.package.get(`deleted:${FIXTURE_USER_ID}`);
    expect(persisted).toEqual({ '200': ['1'] });
  });

  it('deleted ids survive resumeStoredPackage without a separate hydrate dispatch', async () => {
    // Stream a package into IDB, then simulate a purge having persisted
    // deleted ids before the next session resumes.
    const seedStore = makeStore();
    await seedStore.dispatch(importPackage(await buildFixturePackage()));
    await storage.package.set(`deleted:${FIXTURE_USER_ID}`, { '200': ['1'] });

    const store = makeStore();
    await store.dispatch(resumeStoredPackage());

    expect(store.getState().package.parsed).not.toBeNull();
    expect(store.getState().package.deletedMessageIds['200']).toEqual(['1']);
  });
});


describe('packageSlice — #271 external deletions and gone provenance', () => {
  beforeEach(async () => {
    __testHelpers__.storeSourceFile(null);
    await storage.package.clear();
  });

  it('externalDeletionsRecorded adds to the union and drops the ids from the selection', async () => {
    const store = makeStore();
    await store.dispatch(importPackage(await buildFixturePackage()));
    store.dispatch(selectAllChannelMessages({ channelId: '200', messageIds: ['1', '2', '3'] }));

    store.dispatch(externalDeletionsRecorded({ channelId: '200', ids: ['2'] }));

    const pkg = store.getState().package;
    expect(pkg.deletedMessageIds['200']).toEqual(['2']);
    expect(pkg.goneMessageIds['200']).toBeUndefined();
    expect(pkg.selectedMessageIds['200']).toEqual(['1', '3']);
  });

  it('externalDeletionsRecorded ignores channels outside the loaded package', async () => {
    const store = makeStore();
    await store.dispatch(importPackage(await buildFixturePackage()));
    store.dispatch(externalDeletionsRecorded({ channelId: 'not-here', ids: ['2'] }));
    expect(store.getState().package.deletedMessageIds['not-here']).toBeUndefined();
  });

  it('gone selectors count only the already-gone subset, scoped to the package', () => {
    const state = stateWith({
      parsed: minimalParsed,
      deletedMessageIds: { '200': ['1', '2', '3'], stale: ['9'] },
      goneMessageIds: { '200': ['2', '3'], stale: ['9'] },
    });
    expect(selectChannelGoneMessageCount('200')(state)).toBe(2);
    expect(selectChannelGoneMessageCount('999')(state)).toBe(0);
    expect(selectPackageGoneMessageCount(state)).toBe(2);
    expect(selectPackageDeletedMessageCount(state)).toBe(3);
  });

  it('import hydrates the gone subset and prunes it against the archive', async () => {
    await storage.package.set(`deleted:${FIXTURE_USER_ID}`, { '200': ['1', '2', 'purged-earlier'] });
    await storage.package.set(`gone:${FIXTURE_USER_ID}`, { '200': ['2', 'purged-earlier'], 'other': ['x'] });
    const store = makeStore();
    await store.dispatch(importPackage(await buildFixturePackage()));

    const pkg = store.getState().package;
    expect(pkg.deletedMessageIds['200']).toEqual(['1', '2']);
    expect(pkg.goneMessageIds['200']).toEqual(['2']);
    expect(pkg.goneMessageIds['other']).toBeUndefined();
    expect(await storage.package.get(`gone:${FIXTURE_USER_ID}`)).toEqual({ '200': ['2'] });
  });

  it('resume carries the gone subset', async () => {
    const seed = makeStore();
    await seed.dispatch(importPackage(await buildFixturePackage()));
    await storage.package.set(`deleted:${FIXTURE_USER_ID}`, { '200': ['1', '2'] });
    await storage.package.set(`gone:${FIXTURE_USER_ID}`, { '200': ['2'] });

    const store = makeStore();
    await store.dispatch(resumeStoredPackage());
    expect(store.getState().package.goneMessageIds['200']).toEqual(['2']);
  });
});
