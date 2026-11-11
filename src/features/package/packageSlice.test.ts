import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore, type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import packageReducer, {
  applyLocalMessageEdits,
  importPackage,
  initialPackageState,
  loadPackageChannelMessages,
  loadAllPackageTimestamps,
  selectPackageChannel,
  clearPackage,
  __testHelpers__,
} from './packageSlice';
import userReducer from '@features/user/userSlice';
import { buildFixturePackage } from '@/test/package-fixtures';

function makeStore(currentUserId: string | null = null) {
  const store = configureStore({
    reducer: {
      package: packageReducer,
      user: userReducer,
    },
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: false,
      }),
  }) as unknown as {
    dispatch: ThunkDispatch<RootState, unknown, UnknownAction>;
    getState: () => RootState;
  };
  if (currentUserId) {
    store.dispatch({
      type: 'user/setCurrentUser',
      payload: { id: currentUserId, username: 'tester' },
    });
  }
  return store;
}

describe('packageSlice — importPackage', () => {
  beforeEach(() => {
    __testHelpers__.storeSourceFile(null);
  });

  it('parses and stores a valid package', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    const action = await store.dispatch(importPackage(blob));

    expect(action.type).toBe('package/import/fulfilled');
    const state = store.getState().package;
    expect(state.status).toBe('ready');
    expect(state.parsed?.user.id).toBe('253286221395001345');
    expect(state.validation?.readOnly).toBe(false);
  });

  it('returns read-only validation when user IDs mismatch', async () => {
    const store = makeStore('different-user');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    const state = store.getState().package;
    expect(state.status).toBe('ready');
    expect(state.validation?.readOnly).toBe(true);
    expect(state.validation?.warnings[0]).toMatch(/different user/i);
  });

  it('returns read-only with warning when no auth', async () => {
    const store = makeStore(null);
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    const state = store.getState().package;
    expect(state.validation?.readOnly).toBe(true);
  });

  it('rejects when user.json is missing', async () => {
    const store = makeStore('abc');
    const blob = await buildFixturePackage({ omitUserJson: true });
    await store.dispatch(importPackage(blob));

    const state = store.getState().package;
    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
  });
});

describe('packageSlice — loadPackageChannelMessages (LRU)', () => {
  beforeEach(() => {
    __testHelpers__.storeSourceFile(null);
  });

  it('loads messages lazily and caches them', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    await store.dispatch(loadPackageChannelMessages('200'));

    const state = store.getState().package;
    expect(state.loadedChannels['200']).toHaveLength(3);
    expect(state.loadedOrder).toEqual(['200']);
  });

  it('returns cached messages without re-reading', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    await store.dispatch(loadPackageChannelMessages('200'));
    __testHelpers__.storeSourceFile(null); // Simulate losing source
    const second = await store.dispatch(loadPackageChannelMessages('200'));

    expect(second.type).toBe('package/loadChannel/fulfilled');
  });

  it('rejects when source file is unavailable for uncached channel', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    __testHelpers__.storeSourceFile(null);
    const result = await store.dispatch(loadPackageChannelMessages('999'));
    expect(result.type).toBe('package/loadChannel/rejected');
  });
});

describe('packageSlice — loadAllPackageTimestamps', () => {
  beforeEach(() => {
    __testHelpers__.storeSourceFile(null);
  });

  it('collects timestamps from all channels', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage({ includeOrphanChannel: true });
    await store.dispatch(importPackage(blob));

    const result = await store.dispatch(loadAllPackageTimestamps());
    expect(result.type).toBe('package/loadAllTimestamps/fulfilled');

    const state = store.getState().package;
    expect(state.timelineStatus).toBe('ready');
    // 3 in channel 200 + 1 in channel 300 + 1 in orphan 400 = 5
    expect(state.timelineTimestamps).toHaveLength(5);
    expect(state.timelineProgress).toBeNull();
  });

  it('rejects when no package is loaded', async () => {
    const store = makeStore('abc');
    const result = await store.dispatch(loadAllPackageTimestamps());
    expect(result.type).toBe('package/loadAllTimestamps/rejected');
  });

  it('tolerates missing per-channel data by emptying timestamps (catch-and-continue)', async () => {
    // Pre-#162: a missing File handle rejected the whole thunk.
    // Post-#162: per-channel reads come from IDB and a cache miss on a
    // single channel is logged-and-skipped, not fatal. Clear every
    // `pkg:msgs:*` key for the user; the loader still fulfills with an
    // empty timestamp list rather than rejecting.
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    const { storage } = await import('@/extension/storage');
    const allKeys = await storage.package.keys();
    const msgsKeys = allKeys.filter((k) => k.startsWith('pkg:msgs:253286221395001345:'));
    await Promise.all(msgsKeys.map((k) => storage.package.remove(k)));

    const result = await store.dispatch(loadAllPackageTimestamps());
    expect(result.type).toBe('package/loadAllTimestamps/fulfilled');
    expect(store.getState().package.timelineTimestamps).toEqual([]);
  });
});

describe('packageSlice — reducers', () => {
  it('selectPackageChannel sets the selected channel ID', async () => {
    const store = makeStore('253286221395001345');
    store.dispatch(selectPackageChannel('200'));
    expect(store.getState().package.selectedChannelId).toBe('200');
  });

  it('clearPackage resets state', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    store.dispatch(clearPackage());
    const state = store.getState().package;
    expect(state.parsed).toBeNull();
    expect(state.status).toBe('idle');
  });

  it('Fix I: resetPackage purges the IDB enrichment cache for the user', async () => {
    const { resetPackage } = await import('./packageSlice');
    const { enrichmentCache } = await import('./enrichmentCache');
    const { storage } = await import('@/extension/storage');
    await storage.package.clear();

    const USER = '253286221395001345';
    const store = makeStore(USER);
    const blob = await buildFixturePackage();
    await store.dispatch(importPackage(blob));

    // Seed two channels' worth of enrichment for this user.
    await enrichmentCache.put(USER, '200', {
      lastFetched: 1,
      messages: {},
      misses: { deleted: [], forbidden: [] },
    });
    await enrichmentCache.put(USER, '300', {
      lastFetched: 2,
      messages: {},
      misses: { deleted: [], forbidden: [] },
    });
    expect(await enrichmentCache.get(USER, '200')).not.toBeNull();

    await store.dispatch(resetPackage());

    // In-memory state reset as usual.
    expect(store.getState().package.parsed).toBeNull();
    // AND the persisted cache was cleared.
    expect(await enrichmentCache.get(USER, '200')).toBeNull();
    expect(await enrichmentCache.get(USER, '300')).toBeNull();
  });

  it('applyLocalMessageEdits stores per-message content instead of one sample', () => {
    const store = configureStore({
      reducer: { package: packageReducer },
      preloadedState: {
        package: {
          ...initialPackageState,
          loadedChannels: {
            '200': [
              { id: '1', timestamp: 't1', content: 'original one', attachments: [] },
              { id: '2', timestamp: 't2', content: 'original two', attachments: [] },
              { id: '3', timestamp: 't3', content: 'untouched', attachments: [] },
            ],
          },
          loadedOrder: ['200'],
        },
      },
    });

    store.dispatch(
      applyLocalMessageEdits({
        channelId: '200',
        updates: [
          { id: '1', content: 'generated one' },
          { id: '2', content: 'generated two' },
        ],
      }),
    );

    expect(
      store.getState().package.loadedChannels['200'].map((m) => m.content),
    ).toEqual(['generated one', 'generated two', 'untouched']);
  });

  it('applyLocalMessageEdits ignores channels that are not cached', () => {
    const store = configureStore({
      reducer: { package: packageReducer },
      preloadedState: {
        package: { ...initialPackageState, loadedChannels: {}, loadedOrder: [] },
      },
    });

    expect(() =>
      store.dispatch(
        applyLocalMessageEdits({
          channelId: '999',
          updates: [{ id: '1', content: 'x' }],
        }),
      ),
    ).not.toThrow();
    expect(store.getState().package.loadedChannels).toEqual({});
  });
});


describe('packageSlice — import progress and diagnostics (#269)', () => {
  it('tracks bytes read while importing and clears them when done', async () => {
    const store = makeStore('253286221395001345');
    const blob = await buildFixturePackage();
    const seen: Array<{ read: number; total: number } | null> = [];
    const unsubscribe = (store as unknown as { subscribe: (l: () => void) => () => void }).subscribe(() => {
      seen.push(store.getState().package.importProgress);
    });
    await store.dispatch(importPackage(blob));
    unsubscribe();

    const ticks = seen.filter((p): p is { read: number; total: number } => p !== null);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[ticks.length - 1].read).toBe(blob.size);
    expect(ticks[ticks.length - 1].total).toBe(blob.size);
    expect(store.getState().package.importProgress).toBeNull();
  });

  it('clears the progress on a failed import and on clearPackage', async () => {
    const store = makeStore('253286221395001345');
    await store.dispatch(importPackage(await buildFixturePackage({ omitUserJson: true })));
    expect(store.getState().package.status).toBe('error');
    expect(store.getState().package.importProgress).toBeNull();

    store.dispatch({ type: 'package/setImportProgress', payload: { read: 1, total: 2 } });
    store.dispatch(clearPackage());
    expect(store.getState().package.importProgress).toBeNull();
  });

  it('writes one status line about what was read, on import but not on resume', async () => {
    const { resumeStoredPackage } = await import('./packageSlice');
    const statusReducer = (await import('@features/status/statusSlice')).default;
    const store = configureStore({
      reducer: { package: packageReducer, user: userReducer, status: statusReducer },
    }) as unknown as { dispatch: ThunkDispatch<RootState, unknown, UnknownAction>; getState: () => RootState };
    store.dispatch({ type: 'user/setCurrentUser', payload: { id: '253286221395001345', username: 'tester' } });

    await store.dispatch(importPackage(await buildFixturePackage()));
    const afterImport = store.getState().status.entries.filter((e) => e.message.startsWith('Package read:'));
    expect(afterImport).toHaveLength(1);
    expect(afterImport[0].level).toBe('info');
    expect(afterImport[0].message).toBe('Package read: 2 channels, 4 messages.');

    await store.dispatch(resumeStoredPackage());
    const afterResume = store.getState().status.entries.filter((e) => e.message.startsWith('Package read:'));
    expect(afterResume).toHaveLength(1);
  });

  it('warns when folders were skipped or a channel stored no rows', async () => {
    const statusReducer = (await import('@features/status/statusSlice')).default;
    const store = configureStore({
      reducer: { package: packageReducer, user: userReducer, status: statusReducer },
    }) as unknown as { dispatch: ThunkDispatch<RootState, unknown, UnknownAction>; getState: () => RootState };
    store.dispatch({ type: 'user/setCurrentUser', payload: { id: '253286221395001345', username: 'tester' } });

    await store.dispatch(importPackage(await buildFixturePackage({
      renamedMessageKeys: true,
      includeOrphanChannel: true,
      brokenFolders: [{ id: '400', drop: 'messages' }],
    })));
    const line = store.getState().status.entries.find((e) => e.message.startsWith('Package read:'));
    expect(line?.level).toBe('warning');
    expect(line?.message).toBe(
      'Package read: 2 channels, 4 messages. 1 channel folder was skipped (1 without a messages file). 1 channel listed messages Discrub could not read (fields seen: id, timestamp, contents, attachments).',
    );
  });
});
