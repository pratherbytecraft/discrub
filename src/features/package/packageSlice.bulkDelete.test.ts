import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureStore,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import packageReducer, {
  bulkDeletePackageChannels,
  countBulkDeleteTargets,
  importPackage,
  initialPackageState,
  requestBulkSkip,
  dismissBulkDelete,
  setBulkChannelSelection,
  toggleBulkChannelSelection,
  clearBulkChannelSelection,
  selectChannelDeletedMessageCount,
  selectChannelGoneMessageCount,
  __testHelpers__,
} from './packageSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import { buildFixturePackage } from '@/test/package-fixtures';
import { storage } from '@/extension/storage';
import { checkCancelled } from '@utils/operationLoopUtils';
import { readDeletedCache, readGoneCache } from './packageDeletedCache';
import type { RootState } from '@/app/store';

const mockDeleteMessage = vi.fn();

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    deleteMessage: mockDeleteMessage,
  })),
}));

vi.mock('@utils/operationLoopUtils', () => ({
  withTransientRetry: vi.fn(async (fn: () => Promise<any>) => fn()),
  waitWhilePaused: vi.fn().mockResolvedValue(undefined),
  checkCancelled: vi.fn().mockReturnValue(false),
  // The real helper ends the wait early when `stopWhen` says so; the Skip test relies on that.
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
  };
  if (token) store.dispatch({ type: 'auth/setToken', payload: token });
  store.dispatch({ type: 'user/setCurrentUser', payload: { id: USER_ID, username: 'tester' } });
  return store;
}

/** general (200: ids 1, 2, 3), the DM (300: id 10) and a Left Servers channel (400: id 20). */
async function primedStore(token: string | null = 'tok') {
  const store = makeStore(token);
  const blob = await buildFixturePackage({ includeOrphanChannel: true });
  await store.dispatch(importPackage(blob));
  return store;
}

const statusMessages = (store: ReturnType<typeof makeStore>) =>
  store.getState().status.entries.map((e) => e.message);

describe('packageSlice — bulk selection reducers (2.2.8)', () => {
  it('toggles, replaces and clears the ticked channels', () => {
    const store = makeStore();
    store.dispatch(toggleBulkChannelSelection('200'));
    store.dispatch(toggleBulkChannelSelection('300'));
    expect(store.getState().package.bulkSelectedChannelIds).toEqual(['200', '300']);
    store.dispatch(toggleBulkChannelSelection('200'));
    expect(store.getState().package.bulkSelectedChannelIds).toEqual(['300']);
    store.dispatch(setBulkChannelSelection(['300', '500', '500']));
    expect(store.getState().package.bulkSelectedChannelIds).toEqual(['300', '500']);
    store.dispatch(clearBulkChannelSelection());
    expect(store.getState().package.bulkSelectedChannelIds).toEqual([]);
  });

  it('starts with an idle run and ignores Skip when nothing is running', () => {
    const store = makeStore();
    expect(store.getState().package.bulkDelete).toEqual(initialPackageState.bulkDelete);
    store.dispatch(requestBulkSkip());
    expect(store.getState().package.bulkDelete.skipRequested).toBe(false);
  });
});

describe('packageSlice — countBulkDeleteTargets (2.2.8)', () => {
  beforeEach(async () => {
    mockDeleteMessage.mockReset();
    __testHelpers__.storeSourceFile(null);
    await storage.package.clear();
  });

  it('counts the package rows per channel and zero for a Left Servers channel', async () => {
    const store = await primedStore();
    const action = await store.dispatch(countBulkDeleteTargets({ channelIds: ['200', '300', '400'], criteria: null }));
    expect(action.type).toBe('package/countBulkDeleteTargets/fulfilled');
    expect(store.getState().package.bulkDelete.counts).toEqual({ '200': 3, '300': 1, '400': 0 });
    expect(store.getState().package.bulkDelete.status).toBe('idle');
  });

  it('applies the filter to every channel and leaves out ids already gone', async () => {
    const store = await primedStore();
    store.dispatch({ type: 'package/packageChannelDeletionsApplied', payload: { channelId: '200', deletedIds: ['2'], alreadyGoneIds: [] } });
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200', '300'], criteria: { searchMessageContents: ['hello'] } as any }));
    expect(store.getState().package.bulkDelete.counts).toEqual({ '200': 1, '300': 0 });
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200'], criteria: null }));
    expect(store.getState().package.bulkDelete.counts['200']).toBe(2);
  });
});

describe('packageSlice — bulkDeletePackageChannels (2.2.8)', () => {
  beforeEach(async () => {
    mockDeleteMessage.mockReset();
    vi.mocked(checkCancelled).mockReturnValue(false);
    __testHelpers__.storeSourceFile(null);
    await storage.package.clear();
  });

  it('walks the channels in order, skips a Left Servers channel, and records every id', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();
    store.dispatch(setBulkChannelSelection(['200', '400', '300']));
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200', '400', '300'], criteria: null }));

    const action = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200', '400', '300'], criteria: null }));
    expect(action.type).toBe('package/bulkDelete/fulfilled');
    expect(action.payload).toEqual({ cancelled: false, deleted: 4, alreadyGone: 0, forbidden: 0, failed: 0, channelsDone: 2, channelsSkipped: 1 });

    // general first, then the DM: the Left Servers channel never reached Discord.
    const calls = mockDeleteMessage.mock.calls.map((c) => [c[2], c[1]]);
    expect(calls).toEqual([['200', '1'], ['200', '2'], ['200', '3'], ['300', '10']]);

    const bulk = store.getState().package.bulkDelete;
    expect(bulk.status).toBe('done');
    expect(bulk.cancelled).toBe(false);
    expect(bulk.currentChannelId).toBeNull();
    expect(bulk.queue).toEqual(['200', '400', '300']);
    expect(bulk.outcomes['200'].state).toBe('done');
    expect(bulk.outcomes['400']).toMatchObject({ state: 'skipped', reason: 'orphan' });
    expect(bulk.outcomes['300'].state).toBe('done');
    expect(bulk.progress).toEqual({ messagesDone: 4, messagesTotal: 4 });
    // The run's channels are no longer ticked.
    expect(store.getState().package.bulkSelectedChannelIds).toEqual([]);

    // Deleted ids land in state and in the persisted cache, the same as a single channel delete.
    expect(selectChannelDeletedMessageCount('200')(store.getState())).toBe(3);
    expect(selectChannelDeletedMessageCount('300')(store.getState())).toBe(1);
    expect(await readDeletedCache(USER_ID)).toEqual({ '200': ['1', '2', '3'], '300': ['10'] });

    const messages = statusMessages(store);
    expect(messages).toContain('Deleting 4 messages across 3 Channels.');
    expect(messages).toContain('Unknown channel: skipped, you are no longer in this Server.');
    expect(messages).toContain('Bulk delete finished. 4 deleted, 0 already gone, 0 failed. 2 Channels done, 1 skipped.');
  });

  it('counts a 404 as already gone and a second run has nothing left', async () => {
    mockDeleteMessage.mockImplementation(async (_t: string, id: string) =>
      id === '2' ? { success: false, status: 404 } : { success: true, status: 204 });
    const store = await primedStore();
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200'], criteria: null }));
    const action = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200'], criteria: null }));
    expect(action.payload).toMatchObject({ deleted: 2, alreadyGone: 1, channelsDone: 1 });
    expect(selectChannelGoneMessageCount('200')(store.getState())).toBe(1);
    expect(await readGoneCache(USER_ID)).toEqual({ '200': ['2'] });

    mockDeleteMessage.mockClear();
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200'], criteria: null }));
    expect(store.getState().package.bulkDelete.counts['200']).toBe(0);
    const again = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200'], criteria: null }));
    expect(again.payload).toMatchObject({ deleted: 0, channelsDone: 0, channelsSkipped: 1 });
    expect(mockDeleteMessage).not.toHaveBeenCalled();
    expect(store.getState().package.bulkDelete.outcomes['200']).toMatchObject({ state: 'skipped', reason: 'empty' });
  });

  it('deletes only the rows the filter matches', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();
    const criteria = { searchMessageContents: ['hello'] } as any;
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200', '300'], criteria }));
    const action = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200', '300'], criteria }));
    expect(action.payload).toMatchObject({ deleted: 1, channelsDone: 1, channelsSkipped: 1 });
    expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['1']);
    expect(store.getState().package.bulkDelete.criteria).toEqual(criteria);
  });

  it('Skip ends the current channel after the message in flight and moves on', async () => {
    const store = await primedStore();
    mockDeleteMessage.mockImplementation(async (_t: string, id: string) => {
      // Press Skip while general's first message is being deleted.
      if (id === '1') store.dispatch(requestBulkSkip());
      return { success: true, status: 204 };
    });
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200', '300'], criteria: null }));
    const action = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200', '300'], criteria: null }));
    expect(action.payload).toMatchObject({ cancelled: false, deleted: 2, channelsDone: 1, channelsSkipped: 1 });
    expect(mockDeleteMessage.mock.calls.map((c) => [c[2], c[1]])).toEqual([['200', '1'], ['300', '10']]);
    const bulk = store.getState().package.bulkDelete;
    expect(bulk.outcomes['200']).toMatchObject({ state: 'skipped', reason: 'user' });
    expect(bulk.outcomes['200'].result?.deleted).toBe(1);
    expect(bulk.outcomes['300'].state).toBe('done');
    expect(bulk.skipRequested).toBe(false);
    // What general did get is remembered, so a rerun does not touch id 1 again.
    expect(selectChannelDeletedMessageCount('200')(store.getState())).toBe(1);
  });

  it('Stop ends the run and keeps what was done', async () => {
    const store = await primedStore();
    mockDeleteMessage.mockImplementation(async (_t: string, id: string) => {
      if (id === '2') vi.mocked(checkCancelled).mockReturnValue(true);
      return { success: true, status: 204 };
    });
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200', '300'], criteria: null }));
    const action = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200', '300'], criteria: null }));
    expect(action.payload).toMatchObject({ cancelled: true, deleted: 2, channelsDone: 0 });
    expect(mockDeleteMessage.mock.calls.map((c) => c[1])).toEqual(['1', '2']);
    const bulk = store.getState().package.bulkDelete;
    expect(bulk.status).toBe('done');
    expect(bulk.cancelled).toBe(true);
    expect(bulk.outcomes['300'].state).toBe('pending');
    expect(selectChannelDeletedMessageCount('200')(store.getState())).toBe(2);
    expect(statusMessages(store).some((m) => m.startsWith('Bulk delete stopped.'))).toBe(true);
  });

  it('refuses without a token, in read only mode, and with nothing ticked', async () => {
    const signedOut = await primedStore(null);
    const a = await signedOut.dispatch(bulkDeletePackageChannels({ channelIds: ['200'], criteria: null }));
    expect(a.type).toBe('package/bulkDelete/rejected');
    expect(signedOut.getState().package.bulkDelete.status).toBe('error');

    const store = await primedStore();
    const b = await store.dispatch(bulkDeletePackageChannels({ channelIds: [], criteria: null }));
    expect(b.type).toBe('package/bulkDelete/rejected');
    expect(mockDeleteMessage).not.toHaveBeenCalled();
  });

  it('dismissBulkDelete returns to idle but keeps the counts', async () => {
    mockDeleteMessage.mockResolvedValue({ success: true, status: 204 });
    const store = await primedStore();
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['300'], criteria: null }));
    await store.dispatch(bulkDeletePackageChannels({ channelIds: ['300'], criteria: null }));
    expect(store.getState().package.bulkDelete.status).toBe('done');
    store.dispatch(dismissBulkDelete());
    expect(store.getState().package.bulkDelete.status).toBe('idle');
    expect(store.getState().package.bulkDelete.outcomes).toEqual({});
    expect(store.getState().package.bulkDelete.counts).toEqual({ '300': 1 });
  });
});

describe('packageSlice — bulk delete cache flushes (2.2.8)', () => {
  beforeEach(async () => {
    mockDeleteMessage.mockReset();
    vi.mocked(checkCancelled).mockReturnValue(false);
    __testHelpers__.storeSourceFile(null);
    await storage.package.clear();
  });

  it('writes the deleted ids to state and the cache every 25 results, not only at the end of the channel', async () => {
    const store = await primedStore();
    // Seed general with 60 rows straight into the channel cache, so the run has more than one flush.
    const messages = Array.from({ length: 60 }, (_, i) => ({ id: String(1000 + i), timestamp: '2022-07-28 22:30:52.800000+00:00', content: `row ${i}`, attachments: [] }));
    store.dispatch({ type: 'package/loadChannel/fulfilled', payload: { channelId: '200', messages } });
    const seenAtCall: Record<number, number> = {};
    mockDeleteMessage.mockImplementation(async () => {
      const n = mockDeleteMessage.mock.calls.length;
      if (n === 26 || n === 51) seenAtCall[n] = (store.getState().package.deletedMessageIds['200'] ?? []).length;
      if (n === 55) vi.mocked(checkCancelled).mockReturnValue(true);
      return { success: true, status: 204 };
    });
    await store.dispatch(countBulkDeleteTargets({ channelIds: ['200'], criteria: null }));
    expect(store.getState().package.bulkDelete.counts['200']).toBe(60);
    const action = await store.dispatch(bulkDeletePackageChannels({ channelIds: ['200'], criteria: null }));
    expect(action.payload).toMatchObject({ cancelled: true, deleted: 55 });
    // Mid run the state already held the first and second batches.
    expect(seenAtCall[26]).toBe(25);
    expect(seenAtCall[51]).toBe(50);
    // The final flush covers the rest, in state and on disk.
    expect(selectChannelDeletedMessageCount('200')(store.getState())).toBe(55);
    expect((await readDeletedCache(USER_ID))['200']).toHaveLength(55);
  });
});
