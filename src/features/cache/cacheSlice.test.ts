import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';
import cacheReducer, {
  loadCacheFromLocalStorage,
  saveCacheToLocalStorage,
  setCachedUserMap,
  updateCachedUser,
  mergeCachedUserMap,
  clearCachedUserMap,
  setUserMapInMemory,
  addFailedUserId,
  selectCache,
  selectCachedUserMap,
  selectCacheLoaded,
  selectCachedUser,
  selectCachedUserGuildData,
  selectFailedUserIds,
} from './cacheSlice';
import { initialCacheState } from './cacheTypes';
// ExportUserMap type not used directly - mock objects use structural typing

// In-memory mock for the unified storage abstraction so each test gets
// a clean slate without paying for real IndexedDB transactions.
// `vi.hoisted` is required because `vi.mock` factories run before
// module-level statements.
const { cacheStore, migrate } = vi.hoisted(() => {
  function makeAdapter() {
    let store: Record<string, unknown> = {};
    return {
      get: vi.fn(async (key: string) => store[key] ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
      clear: vi.fn(async () => {
        store = {};
      }),
      keys: vi.fn(async () => Object.keys(store)),
      getMany: vi.fn(async (keys: string[]) =>
        keys.map((k) => store[k] ?? null),
      ),
      setMany: vi.fn(async (entries: Array<[string, unknown]>) => {
        for (const [k, v] of entries) store[k] = v;
      }),
      entries: vi.fn(async () => Object.entries(store)),
    };
  }
  return { cacheStore: makeAdapter(), migrate: vi.fn(async () => {}) };
});

vi.mock('@/extension/storage', () => ({
  storage: {
    settings: cacheStore,
    state: cacheStore,
    presets: cacheStore,
    cache: cacheStore,
    history: cacheStore,
    statuslog: cacheStore,
    package: cacheStore,
    media: cacheStore,
  },
  migrateAllStorage: migrate,
}));

// Existing tests reference `storageMock` — alias the cache store so we
// don't need to rename every usage.
const storageMock = cacheStore;

/**
 * Seed cache as it would be after migration: per-user IDB keys
 * (`users:<id>`) instead of a single JSON-blob row.
 */
async function seedUsers(
  userMap: Record<string, unknown>,
): Promise<void> {
  for (const [id, data] of Object.entries(userMap)) {
    await storageMock.set(`users:${id}`, data);
  }
}

async function seedFailedIds(ids: string[]): Promise<void> {
  for (const id of ids) {
    await storageMock.set(`failed:${id}`, { firstSeen: Date.now() });
  }
}

/** Read all per-user keys back into a flat userMap object. */
async function readUserMap(): Promise<Record<string, unknown>> {
  const all = await storageMock.entries();
  const map: Record<string, unknown> = {};
  for (const [key, value] of all) {
    if (typeof key === 'string' && key.startsWith('users:')) {
      map[key.slice('users:'.length)] = value;
    }
  }
  return map;
}

/** Read all per-failed keys back into a flat ID array. */
async function readFailedIds(): Promise<string[]> {
  const all = await storageMock.entries();
  return all
    .filter(([k]) => typeof k === 'string' && k.startsWith('failed:'))
    .map(([k]) => k.slice('failed:'.length));
}

describe('cacheSlice', () => {
  let store: TestStore;

  beforeEach(() => {
    store = createTestStore({ cache: cacheReducer });
    storageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    storageMock.clear();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = store.getState();
      expect(state.cache).toEqual(initialCacheState);
      expect(state.cache.userMap).toEqual({});
      expect(state.cache.isLoaded).toBe(false);
    });
  });

  describe('loadCacheFromLocalStorage', () => {
    it('should load per-user keys into userMap', async () => {
      const mockUserMap = {
        user1: {
          userName: 'User One',
          displayName: 'Display One',
          timestamp: Date.now(),
        },
      };
      await seedUsers(mockUserMap);

      await store.dispatch(loadCacheFromLocalStorage());

      const state = store.getState();
      expect(state.cache.userMap).toEqual(mockUserMap);
      expect(state.cache.isLoaded).toBe(true);
    });

    it('should return empty cache when storage is empty', async () => {
      await store.dispatch(loadCacheFromLocalStorage());

      const state = store.getState();
      expect(state.cache.userMap).toEqual({});
      expect(state.cache.isLoaded).toBe(true);
    });

    it('should partition users:* and failed:* prefixes correctly', async () => {
      await seedUsers({ user1: { userName: 'one', timestamp: 1 } });
      await seedFailedIds(['nope-1', 'nope-2']);

      await store.dispatch(loadCacheFromLocalStorage());

      const state = store.getState();
      expect(state.cache.userMap).toHaveProperty('user1');
      expect([...state.cache.failedUserIds].sort()).toEqual(['nope-1', 'nope-2']);
    });
  });

  describe('saveCacheToLocalStorage', () => {
    it('should write per-user keys + per-failed keys', async () => {
      const mockUserMap = {
        user1: {
          userName: 'User One',
          displayName: 'Display One',
          timestamp: Date.now(),
        },
      };

      store.dispatch(setUserMapInMemory(mockUserMap as any));
      await store.dispatch(saveCacheToLocalStorage());

      const written = await readUserMap();
      expect(written).toEqual(mockUserMap);
    });

    it('should handle storage errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      storageMock.setMany.mockImplementationOnce(async () => {
        throw new Error('Storage quota exceeded');
      });

      const result = await store.dispatch(saveCacheToLocalStorage());

      expect(result.type).toBe('cache/saveToLocalStorage/rejected');
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('setCachedUserMap', () => {
    it('should set entire user map and persist to localStorage', async () => {
      const mockUserMap = {
        'user1': {
          userName: 'User One',
          displayName: 'Display One',
          timestamp: Date.now(),
        },
        'user2': {
          userName: 'User Two',
          displayName: 'Display Two',
          timestamp: Date.now(),
        },
      };

      await store.dispatch(setCachedUserMap(mockUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap).toEqual(mockUserMap);

      const stored = await readUserMap();
      expect(stored).toEqual(mockUserMap);
    });

    it('should replace existing user map', async () => {
      const initialUserMap = {
        'user1': { userName: 'Old User', timestamp: Date.now() },
      };

      const newUserMap = {
        'user2': { userName: 'New User', timestamp: Date.now() },
      };

      await store.dispatch(setCachedUserMap(initialUserMap as any));
      await store.dispatch(setCachedUserMap(newUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap).toEqual(newUserMap);
      expect(state.cache.userMap['user1']).toBeUndefined();
    });
  });

  describe('updateCachedUser', () => {
    it('should update a single user in the cache', async () => {
      const initialUserMap = {
        'user1': { userName: 'User One', timestamp: Date.now() },
        'user2': { userName: 'User Two', timestamp: Date.now() },
      };

      await store.dispatch(setCachedUserMap(initialUserMap as any));

      const updatedUserData = {
        userName: 'User One Updated',
        displayName: 'New Display',
        timestamp: Date.now(),
      };

      await store.dispatch(updateCachedUser({ userId: 'user1', userData: updatedUserData } as any));

      const state = store.getState();
      expect(state.cache.userMap['user1']).toEqual(updatedUserData);
      expect(state.cache.userMap['user2']).toEqual(initialUserMap['user2']);
    });

    it('should add a new user if not exists', async () => {
      const userData = {
        userName: 'New User',
        timestamp: Date.now(),
      };

      await store.dispatch(updateCachedUser({ userId: 'user1', userData } as any));

      const state = store.getState();
      expect(state.cache.userMap['user1']).toEqual(userData);
    });
  });

  describe('mergeCachedUserMap', () => {
    it('should merge new users with existing cache', async () => {
      const existingUserMap = {
        'user1': { userName: 'User One', timestamp: 1000 },
      };

      const newUserMap = {
        'user2': { userName: 'User Two', timestamp: 2000 },
      };

      await store.dispatch(setCachedUserMap(existingUserMap as any));
      await store.dispatch(mergeCachedUserMap(newUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap['user1']).toEqual(existingUserMap['user1']);
      expect(state.cache.userMap['user2']).toEqual(newUserMap['user2']);
    });

    it('should merge guild data for existing users', async () => {
      const existingUserMap = {
        'user1': {
          userName: 'User One',
          timestamp: 1000,
          guilds: {
            'guild1': { serverName: 'Guild One' },
          },
        },
      };

      const newUserMap = {
        'user1': {
          userName: 'User One Updated',
          timestamp: 2000,
          guilds: {
            'guild2': { serverName: 'Guild Two' },
          },
        },
      };

      await store.dispatch(setCachedUserMap(existingUserMap as any));
      await store.dispatch(mergeCachedUserMap(newUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap['user1'].guilds).toEqual({
        'guild1': { serverName: 'Guild One' },
        'guild2': { serverName: 'Guild Two' },
      });
      expect(state.cache.userMap['user1'].timestamp).toBe(2000); // Newer timestamp
    });

    it('should use newer timestamp when merging', async () => {
      const existingUserMap = {
        'user1': { userName: 'User One', timestamp: 2000 },
      };

      const newUserMap = {
        'user1': { userName: 'User One', timestamp: 1000 },
      };

      await store.dispatch(setCachedUserMap(existingUserMap as any));
      await store.dispatch(mergeCachedUserMap(newUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap['user1'].timestamp).toBe(2000); // Kept newer timestamp
    });

    it('keeps the current map by identity and writes nothing when nothing changed (2.2.1 perf)', async () => {
      const existingUserMap = {
        user1: { userName: 'User One', timestamp: 1000, guilds: { g1: { nick: 'one' } } },
      };
      await store.dispatch(setCachedUserMap(existingUserMap as any));
      const before = store.getState().cache.userMap;
      storageMock.setMany.mockClear();
      const setMany = storageMock.setMany;
      await store.dispatch(mergeCachedUserMap({ user1: { userName: 'User One', timestamp: 900, guilds: { g1: { nick: 'one' } } } } as any));
      expect(store.getState().cache.userMap).toBe(before);
      expect(setMany).not.toHaveBeenCalled();
      await store.dispatch(mergeCachedUserMap(before));
      expect(store.getState().cache.userMap).toBe(before);
      expect(setMany).not.toHaveBeenCalled();
    });

    it('writes only the entries that changed', async () => {
      await store.dispatch(setCachedUserMap({
        user1: { userName: 'User One', timestamp: 1000 },
        user2: { userName: 'User Two', timestamp: 1000 },
      } as any));
      const before = store.getState().cache.userMap;
      storageMock.setMany.mockClear();
      const setMany = storageMock.setMany;
      await store.dispatch(mergeCachedUserMap({
        user1: { userName: 'User One', timestamp: 1000 },
        user2: { userName: 'User Two renamed', timestamp: 2000 },
      } as any));
      const after = store.getState().cache.userMap;
      expect(after).not.toBe(before);
      expect(after.user1).toBe(before.user1);
      expect(after.user2.userName).toBe('User Two renamed');
      expect(setMany).toHaveBeenCalledTimes(1);
      expect((setMany.mock.calls[0][0] as Array<[string, unknown]>).map(([k]) => k)).toEqual(['users:user2']);
    });

    it('should handle missing guilds property', async () => {
      const existingUserMap = {
        'user1': { userName: 'User One', timestamp: 1000 },
      };

      const newUserMap = {
        'user1': {
          userName: 'User One',
          timestamp: 2000,
          guilds: {
            'guild1': { serverName: 'Guild One' },
          },
        },
      };

      await store.dispatch(setCachedUserMap(existingUserMap as any));
      await store.dispatch(mergeCachedUserMap(newUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap['user1'].guilds).toEqual({
        'guild1': { serverName: 'Guild One' },
      });
    });
  });

  describe('clearCachedUserMap', () => {
    it('should clear all cached user data', async () => {
      const mockUserMap = {
        'user1': { userName: 'User One', timestamp: Date.now() },
        'user2': { userName: 'User Two', timestamp: Date.now() },
      };

      await store.dispatch(setCachedUserMap(mockUserMap as any));
      expect(Object.keys(store.getState().cache.userMap)).toHaveLength(2);

      await store.dispatch(clearCachedUserMap());

      const state = store.getState();
      expect(state.cache.userMap).toEqual({});

      const stored = await readUserMap();
      expect(stored).toEqual({});
    });
  });

  describe('setUserMapInMemory', () => {
    it('should update user map in memory without persisting', async () => {
      const mockUserMap = {
        'user1': { userName: 'User One', timestamp: Date.now() },
      };

      store.dispatch(setUserMapInMemory(mockUserMap as any));

      const state = store.getState();
      expect(state.cache.userMap).toEqual(mockUserMap);

      // setUserMapInMemory does NOT persist — no users:* keys should exist.
      const stored = await readUserMap();
      expect(stored).toEqual({});
    });
  });

  describe('selectors', () => {
    beforeEach(async () => {
      const mockUserMap = {
        'user1': {
          userName: 'User One',
          displayName: 'Display One',
          timestamp: Date.now(),
          guilds: {
            'guild1': {
              serverName: 'Guild One',
              serverNickname: 'Nickname One',
            },
          },
        },
        'user2': {
          userName: 'User Two',
          timestamp: Date.now(),
        },
      };

      await store.dispatch(setCachedUserMap(mockUserMap as any));
    });

    it('selectCache should return entire cache state', () => {
      const cache = selectCache(store.getState());
      expect(cache).toHaveProperty('userMap');
      expect(cache).toHaveProperty('isLoaded');
    });

    it('selectCachedUserMap should return user map', () => {
      const userMap = selectCachedUserMap(store.getState());
      expect(userMap).toHaveProperty('user1');
      expect(userMap).toHaveProperty('user2');
    });

    it('selectCacheLoaded should return isLoaded status', () => {
      const isLoaded = selectCacheLoaded(store.getState());
      expect(isLoaded).toBe(false); // Not loaded via loadCacheFromLocalStorage
    });

    it('selectCachedUser should return specific user data', () => {
      const user1 = selectCachedUser('user1')(store.getState());
      expect(user1).toHaveProperty('userName', 'User One');
      expect(user1).toHaveProperty('displayName', 'Display One');
    });

    it('selectCachedUser should return undefined for non-existent user', () => {
      const user = selectCachedUser('nonexistent')(store.getState());
      expect(user).toBeUndefined();
    });

    it('selectCachedUserGuildData should return guild-specific data', () => {
      const guildData = selectCachedUserGuildData('user1', 'guild1')(store.getState());
      expect(guildData).toEqual({
        serverName: 'Guild One',
        serverNickname: 'Nickname One',
      });
    });

    it('selectCachedUserGuildData should return undefined for non-existent guild', () => {
      const guildData = selectCachedUserGuildData('user1', 'nonexistent')(store.getState());
      expect(guildData).toBeUndefined();
    });

    it('selectCachedUserGuildData should return undefined for user without guilds', () => {
      const guildData = selectCachedUserGuildData('user2', 'guild1')(store.getState());
      expect(guildData).toBeUndefined();
    });
  });

  describe('failedUserIds', () => {
    it('should start with empty failedUserIds', () => {
      expect(selectFailedUserIds(store.getState())).toEqual([]);
    });

    it('should add a failed user ID', () => {
      store.dispatch(addFailedUserId('404-user'));
      expect(selectFailedUserIds(store.getState())).toEqual(['404-user']);
    });

    it('should not add duplicate failed user IDs', () => {
      store.dispatch(addFailedUserId('404-user'));
      store.dispatch(addFailedUserId('404-user'));
      expect(selectFailedUserIds(store.getState())).toEqual(['404-user']);
    });

    it('should accumulate multiple failed user IDs', () => {
      store.dispatch(addFailedUserId('user-1'));
      store.dispatch(addFailedUserId('user-2'));
      store.dispatch(addFailedUserId('user-3'));
      expect(selectFailedUserIds(store.getState())).toHaveLength(3);
    });

    it('persists failedUserIds via saveCacheToLocalStorage', async () => {
      store.dispatch(addFailedUserId('404-user'));
      await store.dispatch(saveCacheToLocalStorage());

      const stored = await readFailedIds();
      expect(stored).toEqual(['404-user']);
    });

    it('loads failedUserIds from prefixed keys', async () => {
      await seedFailedIds(['saved-404-user']);

      await store.dispatch(loadCacheFromLocalStorage());

      expect(selectFailedUserIds(store.getState())).toEqual(['saved-404-user']);
    });

    it('defaults to empty array when no failed:* keys exist', async () => {
      await seedUsers({ user1: { userName: 'u1', timestamp: 1 } });

      await store.dispatch(loadCacheFromLocalStorage());

      expect(selectFailedUserIds(store.getState())).toEqual([]);
    });

    it('preserves failedUserIds when setCachedUserMap is called', async () => {
      store.dispatch(addFailedUserId('404-user'));
      await store.dispatch(
        setCachedUserMap({
          user1: { userName: 'New', timestamp: Date.now() },
        } as any),
      );
      expect(selectFailedUserIds(store.getState())).toEqual(['404-user']);
    });

    it('preserves failedUserIds when mergeCachedUserMap is called', async () => {
      store.dispatch(addFailedUserId('404-user'));
      await store.dispatch(
        mergeCachedUserMap({
          user2: { userName: 'Merged', timestamp: Date.now() },
        } as any),
      );
      expect(selectFailedUserIds(store.getState())).toEqual(['404-user']);
    });

    it('preserves failedUserIds when updateCachedUser is called', async () => {
      store.dispatch(addFailedUserId('404-user'));
      await store.dispatch(
        updateCachedUser({
          userId: 'user1',
          userData: { userName: 'Updated', timestamp: Date.now() },
        } as any),
      );
      expect(selectFailedUserIds(store.getState())).toEqual(['404-user']);
    });

    it('preserves failedUserIds when clearCachedUserMap is called', async () => {
      store.dispatch(addFailedUserId('404-user'));
      await store.dispatch(clearCachedUserMap());

      expect(selectCachedUserMap(store.getState())).toEqual({});
      expect(selectFailedUserIds(store.getState())).toEqual(['404-user']);
    });
  });

  describe('fetchUserData → cache integration (Backlog #138)', () => {
    // Action creator from userSlice — we don't import the slice's
    // store wiring, just the action shape, so the cache reducer can
    // react to it in isolation.
    const fetchUserDataFulfilled = 'user/fetchUserData/fulfilled';

    it('stamps the authenticated user into cache.userMap on fetchUserData.fulfilled', () => {
      const store = createTestStore({ cache: cacheReducer });
      store.dispatch({
        type: fetchUserDataFulfilled,
        payload: {
          id: '12345',
          username: 'aaron',
          global_name: 'Aaron',
          avatar: 'avatarhash',
          discriminator: '0',
        },
      });

      const cached = selectCachedUser('12345')(store.getState());
      expect(cached).toMatchObject({
        userName: 'aaron',
        displayName: 'Aaron',
        avatar: 'avatarhash',
      });
    });

    it('falls back to username when global_name is null', () => {
      const store = createTestStore({ cache: cacheReducer });
      store.dispatch({
        type: fetchUserDataFulfilled,
        payload: { id: 'u1', username: 'aaron', global_name: null, avatar: null },
      });
      const cached = selectCachedUser('u1')(store.getState());
      expect(cached?.displayName).toBe('aaron');
    });

    it('preserves existing guilds data when the user is re-fetched', () => {
      const existingEntry = {
        userName: 'aaron',
        displayName: 'Aaron',
        avatar: 'oldhash',
        guilds: {
          'guild-1': { roles: ['role-a'], nick: 'AaronNick', joinedAt: '2024-01-01', timestamp: 1000 },
        },
        timestamp: 1000,
      };
      const store = createTestStore(
        { cache: cacheReducer },
        { cache: { ...initialCacheState, userMap: { '12345': existingEntry } } },
      );

      store.dispatch({
        type: fetchUserDataFulfilled,
        payload: {
          id: '12345',
          username: 'aaron-renamed',
          global_name: 'Aaron Renamed',
          avatar: 'newhash',
        },
      });

      const cached = selectCachedUser('12345')(store.getState());
      expect(cached?.userName).toBe('aaron-renamed');
      expect(cached?.displayName).toBe('Aaron Renamed');
      expect(cached?.avatar).toBe('newhash');
      expect(cached?.guilds).toEqual(existingEntry.guilds);
    });

    it('persists the cache entry to storage under the users:<id> key', () => {
      const store = createTestStore({ cache: cacheReducer });
      store.dispatch({
        type: fetchUserDataFulfilled,
        payload: { id: 'u1', username: 'a', global_name: 'A', avatar: null },
      });
      expect(storageMock.set).toHaveBeenCalledWith(
        'users:u1',
        expect.objectContaining({ userName: 'a', displayName: 'A' }),
      );
    });
  });
});
