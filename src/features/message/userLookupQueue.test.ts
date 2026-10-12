import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestStore, type TestStore } from '@/test/test-utils';
import messageReducer, { enrichMessageUsers, resetUserLookupQueue, stopUserLookups } from './messageSlice';
import appReducer from '@features/app/appSlice';
import cacheReducer from '@features/cache/cacheSlice';
import { userEnrichmentService } from '@services/userEnrichmentService';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';

// 2.2.5 fix A: user lookups run one at a time, ask only for new ids, and
// stop when asked.

vi.mock('@services/userEnrichmentService', () => ({
  userEnrichmentService: { enrichUserIds: vi.fn() },
}));

const enrich = vi.mocked(userEnrichmentService.enrichUserIds);

const entry = (name: string) => ({ userName: name, displayName: name, avatar: null, guilds: {}, timestamp: 1 });
const mapFor = (ids: string[]): ExportUserMap =>
  Object.fromEntries(ids.map((id) => [id, entry(`name-${id}`)])) as unknown as ExportUserMap;

interface Deferred { resolve: () => void; promise: Promise<void> }
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { resolve, promise };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('user lookup queue (2.2.5 fix A)', () => {
  let store: TestStore;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUserLookupQueue();
    const app = appReducer(undefined, { type: 'init' });
    store = createTestStore(
      { message: messageReducer, app: appReducer, cache: cacheReducer },
      {
        app: {
          ...app,
          settings: {
            ...app.settings,
            [DiscrubSetting.DISPLAY_NAME_LOOKUP]: 'true',
            [DiscrubSetting.SERVER_NICKNAME_LOOKUP]: 'false',
          },
        },
      },
    );
  });

  const lookup = (userIds: string[], guildId: string | null = 'g1') =>
    store.dispatch(enrichMessageUsers({ userIds, guildId, token: 't' }) as never);

  it('runs one lookup and folds ids that arrive while it runs into one more round', async () => {
    const gates: Deferred[] = [];
    enrich.mockImplementation(async (ids) => {
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return { userMap: mapFor(ids) };
    });

    await lookup(['a', 'b']);
    expect(store.getState().message.isEnriching).toBe(true);
    await lookup(['b', 'c']);
    await lookup(['d']);
    await flush();
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][0]).toEqual(['a', 'b']);

    gates[0].resolve();
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(2));
    expect(enrich.mock.calls[1][0]).toEqual(['c', 'd']);

    gates[1].resolve();
    await vi.waitFor(() => expect(store.getState().message.isEnriching).toBe(false));
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(Object.keys(store.getState().cache.userMap).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('skips ids already asked for and ids that came back 404', async () => {
    enrich.mockImplementation(async (ids) => ({ userMap: mapFor(ids), failedUserIds: ids.includes('gone') ? ['gone'] : undefined }));

    await lookup(['a', 'gone']);
    await vi.waitFor(() => expect(store.getState().message.isEnriching).toBe(false));
    await vi.waitFor(() => expect(store.getState().cache.failedUserIds).toContain('gone'));

    resetUserLookupQueue();
    const result = await lookup(['gone']);
    expect((result as { payload: { queued: number } }).payload.queued).toBe(0);

    await lookup(['a', 'b']);
    await vi.waitFor(() => expect(store.getState().message.isEnriching).toBe(false));
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(enrich.mock.calls[1][0]).toEqual(['a', 'b']);
  });

  it('does not ask again for an id this server already asked', async () => {
    enrich.mockImplementation(async (ids) => ({ userMap: mapFor(ids) }));
    await lookup(['a', 'b']);
    await vi.waitFor(() => expect(store.getState().message.isEnriching).toBe(false));
    await lookup(['a', 'b']);
    await flush();
    expect(enrich).toHaveBeenCalledTimes(1);

    // Another server asks again, since nicknames are per server.
    await lookup(['a'], 'g2');
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(2));
  });

  it('merges only the asked ids, not the whole map the service returns', async () => {
    enrich.mockImplementation(async (ids) => ({ userMap: { ...mapFor(['unrelated']), ...mapFor(ids) } }));
    await lookup(['a']);
    await vi.waitFor(() => expect(store.getState().message.isEnriching).toBe(false));
    expect(Object.keys(store.getState().cache.userMap)).toEqual(['a']);
  });

  it('passes a stop check that a switch turns on, and drops what is queued', async () => {
    let stopCheck: (() => Promise<boolean>) | undefined;
    const gate = deferred();
    enrich.mockImplementation(async (ids, _g, _t, _s, _m, _p, _st, _f, shouldStop) => {
      stopCheck = shouldStop;
      await gate.promise;
      return { userMap: mapFor(ids) };
    });

    await lookup(['a']);
    await lookup(['b']);
    expect(await stopCheck!()).toBe(false);

    const stopped = stopUserLookups();
    expect(await stopCheck!()).toBe(true);
    // Ids that arrive while it stops are not queued.
    const late = await lookup(['c']);
    expect((late as { payload: { queued: number } }).payload.queued).toBe(0);

    gate.resolve();
    await stopped;
    expect(store.getState().message.isEnriching).toBe(false);
    expect(enrich).toHaveBeenCalledTimes(1);

    // After the stop the queue takes work again, including ids it had asked.
    enrich.mockImplementation(async (ids) => ({ userMap: mapFor(ids) }));
    await lookup(['a', 'b']);
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(2));
    expect(enrich.mock.calls[1][0]).toEqual(['a', 'b']);
  });

  it('a failed round forgets its ids so a later page can ask again', async () => {
    enrich.mockRejectedValueOnce(new Error('boom'));
    await lookup(['a']);
    await vi.waitFor(() => expect(store.getState().message.isEnriching).toBe(false));
    enrich.mockImplementation(async (ids) => ({ userMap: mapFor(ids) }));
    await lookup(['a']);
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(2));
  });
});
