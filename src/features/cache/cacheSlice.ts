import { previewSafe } from '@/middleware/previewGuardMiddleware';
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import { initialCacheState } from './cacheTypes';
import type { RootState } from '@/app/store';
import { storage, migrateAllStorage } from '@/extension/storage';
import { fetchUserData } from '@features/user/userSlice';

/**
 * Cache slice — persistent caching for user resolution + 404 misses.
 *
 * Storage layout (Discrub-cache database):
 *
 *   users:<userId>      → ExportUserMap[userId]   (one row per user)
 *   failed:<userId>     → { firstSeen: number }    (one row per 404)
 *
 * Per-user keys mean a single user update is one IDB write, not a
 * full-blob rewrite. The legacy single-row layout has been migrated
 * away from in `extension/storage.ts::migrateAllStorage`.
 */

const USER_KEY_PREFIX = 'users:';
const FAILED_KEY_PREFIX = 'failed:';

type FailedRecord = { firstSeen: number };

function userKey(userId: string): string {
  return `${USER_KEY_PREFIX}${userId}`;
}

function failedKey(userId: string): string {
  return `${FAILED_KEY_PREFIX}${userId}`;
}

/**
 * Load every cached user + failed-id from storage. One IDB transaction
 * per prefix via `entries()`, partitioned by key.
 */
export const loadCacheFromLocalStorage = createAsyncThunk(
  'cache/loadFromLocalStorage',
  async (_, { rejectWithValue }) => {
    try {
      // Idempotent — only does work the first time after the rename.
      await migrateAllStorage();

      const allEntries = await storage.cache.entries<unknown>();

      const userMap: ExportUserMap = {};
      const failedUserIds: string[] = [];

      for (const [key, value] of allEntries) {
        if (key.startsWith(USER_KEY_PREFIX)) {
          const userId = key.slice(USER_KEY_PREFIX.length);
          userMap[userId] = value as ExportUserMap[string];
        } else if (key.startsWith(FAILED_KEY_PREFIX)) {
          const userId = key.slice(FAILED_KEY_PREFIX.length);
          failedUserIds.push(userId);
        }
      }

      return { userMap, failedUserIds };
    } catch (error) {
      console.error('Failed to load cache from storage:', error);
      return rejectWithValue('Failed to load cache');
    }
  },
);

/**
 * Bulk-write the entire current cache state to storage. Useful after
 * batch operations; for individual writes prefer `setCachedUserMap` /
 * `updateCachedUser` which write only the affected rows.
 */
export const saveCacheToLocalStorage = previewSafe(createAsyncThunk(
  'cache/saveToLocalStorage',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const userEntries: Array<[string, unknown]> = Object.entries(
        state.cache.userMap,
      ).map(([id, data]) => [userKey(id), data]);
      const failedEntries: Array<[string, unknown]> = state.cache.failedUserIds.map(
        (id) => [failedKey(id), { firstSeen: Date.now() } satisfies FailedRecord],
      );
      await storage.cache.setMany([...userEntries, ...failedEntries]);
      return {
        userMap: state.cache.userMap,
        failedUserIds: state.cache.failedUserIds,
      };
    } catch (error) {
      console.error('Failed to save cache to storage:', error);
      return rejectWithValue('Failed to save cache');
    }
  },
));

/**
 * Replace the entire user map (rare — most callers use updateCachedUser
 * or mergeCachedUserMap). Removes any user keys not in the new map.
 */
export const setCachedUserMap = createAsyncThunk(
  'cache/setCachedUserMap',
  async (userMap: ExportUserMap, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      // Drop existing user rows that aren't in the new map.
      const currentIds = new Set(Object.keys(state.cache.userMap));
      const newIds = new Set(Object.keys(userMap));
      const toRemove = [...currentIds].filter((id) => !newIds.has(id));
      await Promise.all([
        ...toRemove.map((id) => storage.cache.remove(userKey(id))),
        storage.cache.setMany(
          Object.entries(userMap).map(([id, data]) => [userKey(id), data]),
        ),
      ]);
      return userMap;
    } catch (error) {
      console.error('Failed to update user map cache:', error);
      return rejectWithValue('Failed to update cache');
    }
  },
);

/**
 * Update one user — single-row write. Cheap regardless of cache size.
 */
export const updateCachedUser = createAsyncThunk(
  'cache/updateCachedUser',
  async (
    { userId, userData }: { userId: string; userData: ExportUserMap[string] },
    { getState, rejectWithValue },
  ) => {
    try {
      const state = getState() as RootState;
      const updatedUserMap = {
        ...state.cache.userMap,
        [userId]: userData,
      };
      await storage.cache.set(userKey(userId), userData);
      return updatedUserMap;
    } catch (error) {
      console.error('Failed to update user in cache:', error);
      return rejectWithValue('Failed to update user cache');
    }
  },
);

/**
 * Merge user data into the existing cache. Preserves per-guild data on
 * collision. Writes only the changed users (not the whole map).
 */
export const mergeCachedUserMap = createAsyncThunk(
  'cache/mergeCachedUserMap',
  async (newUserMap: ExportUserMap, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const currentUserMap = state.cache.userMap;
      const mergedUserMap: ExportUserMap = { ...currentUserMap };
      const writeBatch: Array<[string, ExportUserMap[string]]> = [];

      Object.entries(newUserMap).forEach(([userId, userData]) => {
        const existing = mergedUserMap[userId];
        if (existing) {
          mergedUserMap[userId] = {
            ...userData,
            guilds: {
              ...(existing.guilds || {}),
              ...(userData.guilds || {}),
            },
            timestamp: Math.max(existing.timestamp || 0, userData.timestamp || 0),
          };
        } else {
          mergedUserMap[userId] = userData;
        }
        writeBatch.push([userKey(userId), mergedUserMap[userId]]);
      });

      if (writeBatch.length > 0) await storage.cache.setMany(writeBatch);
      return mergedUserMap;
    } catch (error) {
      console.error('Failed to merge user map cache:', error);
      return rejectWithValue('Failed to merge cache');
    }
  },
);

/**
 * Wipe every cached user (preserves the failed-IDs list). One bulk
 * operation: clear the cache DB then re-stamp the failed entries.
 */
export const clearCachedUserMap = createAsyncThunk(
  'cache/clearCachedUserMap',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      // Remove only user rows; preserve failed:* entries.
      const userIds = Object.keys(state.cache.userMap);
      await Promise.all(userIds.map((id) => storage.cache.remove(userKey(id))));
      return {};
    } catch (error) {
      console.error('Failed to clear user map cache:', error);
      return rejectWithValue('Failed to clear cache');
    }
  },
);

const cacheSlice = createSlice({
  name: 'cache',
  initialState: initialCacheState,
  reducers: {
    /** Synchronous in-memory update without persistence. */
    setUserMapInMemory: (state, action: PayloadAction<ExportUserMap>) => {
      state.userMap = action.payload;
    },
    addFailedUserId: (state, action: PayloadAction<string>) => {
      const userId = action.payload;
      if (state.failedUserIds.includes(userId)) return;
      state.failedUserIds.push(userId);
      // Cap at 1000 entries to prevent unbounded growth — evict oldest
      if (state.failedUserIds.length > 1000) {
        state.failedUserIds = state.failedUserIds.slice(-1000);
      }
      // Best-effort persist of the new failed entry — fire-and-forget;
      // bulk save will catch up the rest.
      void storage.cache.set(failedKey(userId), {
        firstSeen: Date.now(),
      } satisfies FailedRecord);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCacheFromLocalStorage.fulfilled, (state, action) => {
        state.userMap = action.payload.userMap;
        state.failedUserIds = action.payload.failedUserIds;
        state.isLoaded = true;
      })
      .addCase(loadCacheFromLocalStorage.rejected, (state) => {
        state.isLoaded = true;
      })
      .addCase(saveCacheToLocalStorage.fulfilled, (state, action) => {
        state.userMap = action.payload.userMap;
        state.failedUserIds = action.payload.failedUserIds;
      })
      .addCase(setCachedUserMap.fulfilled, (state, action) => {
        state.userMap = action.payload;
      })
      .addCase(updateCachedUser.fulfilled, (state, action) => {
        state.userMap = action.payload;
      })
      .addCase(mergeCachedUserMap.fulfilled, (state, action) => {
        state.userMap = action.payload;
      })
      .addCase(clearCachedUserMap.fulfilled, (state, action) => {
        state.userMap = action.payload;
      })
      // Stamp the freshly-authenticated user into the user map so any
      // surface that looks up display info by ID (UserPicker, bulk
      // purge/export dialogs, etc.) can render "Name (You)" immediately
      // on sign-in instead of falling back to the raw user ID until
      // some other enrichment populates it. (#138)
      .addCase(fetchUserData.fulfilled, (state, action) => {
        const user = action.payload;
        const existing = state.userMap[user.id];
        const entry: ExportUserMap[string] = {
          userName: user.username,
          displayName: user.global_name ?? user.username,
          avatar: user.avatar,
          // Preserve any guild-membership data already cached by prior
          // enrichment — fetchUserData only knows about the user, not
          // their per-guild nick/roles/joinedAt.
          guilds: existing?.guilds ?? {},
          timestamp: Date.now(),
        };
        state.userMap[user.id] = entry;
        // Best-effort persist — same fire-and-forget pattern as
        // `addFailedUserId`. Failures don't block sign-in.
        void storage.cache.set(userKey(user.id), entry);
      });
  },
});

export const { setUserMapInMemory, addFailedUserId } = cacheSlice.actions;

export const selectCache = (state: RootState) => state.cache;
export const selectCachedUserMap = (state: RootState) => state.cache.userMap;
export const selectCacheLoaded = (state: RootState) => state.cache.isLoaded;
export const selectFailedUserIds = (state: RootState) => state.cache.failedUserIds;

export const selectCachedUser = (userId: string) => (state: RootState) =>
  state.cache.userMap[userId];

export const selectCachedUserGuildData =
  (userId: string, guildId: string) => (state: RootState) => {
    const user = state.cache.userMap[userId];
    return user?.guilds?.[guildId];
  };

export default cacheSlice.reducer;
