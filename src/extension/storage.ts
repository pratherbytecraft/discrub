/**
 * Storage Abstraction Layer
 *
 * Per-purpose IndexedDB databases under a shared `Discrub-` prefix.
 * Every kind of persistent data Discrub tracks lives in its own
 * database so DevTools is genuinely browsable: one database per
 * concern, one row per logical record (no JSON-serialized blobs).
 *
 * ───────────────────────────────────────────────────────────────────────
 * Database layout
 *
 *   Discrub-settings    user preferences (per-key: searchDelay, apiTheme, …)
 *   Discrub-state       app meta-state markers (tour:*, announcement:*, selectedPreset, migration markers)
 *   Discrub-presets     user-created export presets (one row per preset)
 *   Discrub-cache       user resolution + 404s (users:*, failed:*, meta:*)
 *   Discrub-history     recent exports (timestamp-keyed)
 *   Discrub-statuslog   status log entries (timestamp-keyed)
 *   Discrub-package     imported package + rehydration cache
 *   Discrub-media       (reserved) avatar/emoji binary blobs
 *   Discrub-workspaces  workspaces and their message rows (2.2.5). Not
 *                       idb-keyval: it needs a compound key and an index,
 *                       so it is opened raw in services/workspaceStore.ts
 *                       and is cleared here only by resetDiscrubData.
 *
 * Each database holds ONE object store (`keyval`) because idb-keyval
 * manages a single store per database. Per-purpose split (vs one DB
 * with multiple stores) sidesteps `onupgradeneeded` complexity for
 * adding new stores in the future.
 *
 * ───────────────────────────────────────────────────────────────────────
 * Storage values
 *
 * Stored natively via IDB's structured-clone — strings, numbers,
 * booleans, plain objects, arrays, Blobs, Maps, Sets, Date all work.
 * NO `JSON.stringify` round-trips. DevTools renders objects as
 * expandable trees.
 *
 * ───────────────────────────────────────────────────────────────────────
 * CROSS-TAB CONSISTENCY (regression vs the localStorage backend)
 *
 * `localStorage` fires the `storage` event in *other* tabs of the same
 * origin when one tab writes — Discrub never relied on this, but the
 * mechanism existed. IndexedDB has no equivalent built-in event. If a
 * user opens Discrub in two tabs and changes a setting in one, the
 * other tab will not see the change until it is reloaded. If we ever
 * need cross-tab reactivity, wrap writes here with a
 * `BroadcastChannel('discrub-storage').postMessage({ store, key })`
 * and have consumers listen for it.
 *
 * ───────────────────────────────────────────────────────────────────────
 * EXTENSION MANIFEST: keep the `"storage"` permission
 *
 * Modern discrub-web no longer touches `chrome.storage`, so the
 * manifest permission seems redundant — but **Discrub Classic**
 * (bundled inside our extension as `public/classic-{chrome,firefox}/`)
 * actively reads/writes 22 settings via `chrome.storage.local`.
 * Removing the permission would break Classic. Verified Apr 2026.
 * Re-evaluate if/when Classic is sunset.
 */

import {
  clear as idbClear,
  createStore,
  del as idbDel,
  entries as idbEntries,
  get as idbGet,
  getMany as idbGetMany,
  keys as idbKeys,
  set as idbSet,
  setMany as idbSetMany,
  type UseStore,
} from 'idb-keyval';
import { deleteWorkspaceDatabase } from '@/services/workspaceStore';

const DB_PREFIX = 'Discrub-';

/** Object store identifiers — one per logical concern. */
export type StoreName =
  | 'settings'
  | 'state'
  | 'presets'
  | 'cache'
  | 'history'
  | 'statuslog'
  | 'package'
  | 'media';

const ALL_STORE_NAMES: readonly StoreName[] = [
  'settings',
  'state',
  'presets',
  'cache',
  'history',
  'statuslog',
  'package',
  'media',
] as const;

/** Maps a logical store name to its per-purpose IndexedDB database name. */
function dbNameFor(store: StoreName): string {
  return `${DB_PREFIX}${store}`;
}

/** Logger that respects test environment (silent during tests). */
function logError(message: string, error?: unknown): void {
  if (process.env.NODE_ENV === 'test' || import.meta.env?.MODE === 'test') {
    return;
  }
  console.error(message, error);
}

function logInfo(message: string): void {
  if (process.env.NODE_ENV === 'test' || import.meta.env?.MODE === 'test') {
    return;
  }
  console.log(message);
}

/**
 * Per-database adapter. Generic over value type — pass `<T>` if you
 * want a typed return; defaults to `unknown` so unknown-shape lookups
 * are explicit at call sites.
 *
 * Rejections in read methods are swallowed (return null/[]) — storage
 * shouldn't be the reason a feature breaks. Rejections in write methods
 * are re-thrown so callers can catch quota errors.
 */
export interface StorageAdapter {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  /** Bulk read in one IDB transaction. Returns null for any missing key. */
  getMany<T = unknown>(keys: string[]): Promise<Array<T | null>>;
  /** Bulk write in one IDB transaction. */
  setMany<T = unknown>(entries: Array<[string, T]>): Promise<void>;
  /** Every key/value pair in this store, useful for prefix-filter loads. */
  entries<T = unknown>(): Promise<Array<[string, T]>>;
}

function makeAdapter(storeName: StoreName, store: UseStore): StorageAdapter {
  const tag = `[storage.${storeName}]`;

  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const value = await idbGet<T>(key, store);
        return value ?? null;
      } catch (error) {
        logError(`${tag} get(${key}) failed`, error);
        return null;
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      try {
        await idbSet(key, value, store);
      } catch (error) {
        logError(`${tag} set(${key}) failed`, error);
        throw error; // preserve quota-error visibility
      }
    },

    async remove(key: string): Promise<void> {
      try {
        await idbDel(key, store);
      } catch (error) {
        logError(`${tag} remove(${key}) failed`, error);
      }
    },

    async clear(): Promise<void> {
      try {
        await idbClear(store);
      } catch (error) {
        logError(`${tag} clear() failed`, error);
      }
    },

    async keys(): Promise<string[]> {
      try {
        const all = await idbKeys(store);
        return all.filter((k): k is string => typeof k === 'string');
      } catch (error) {
        logError(`${tag} keys() failed`, error);
        return [];
      }
    },

    async getMany<T>(keys: string[]): Promise<Array<T | null>> {
      if (keys.length === 0) return [];
      try {
        const values = await idbGetMany<T>(keys, store);
        return values.map((v) => v ?? null);
      } catch (error) {
        logError(`${tag} getMany() failed`, error);
        return keys.map(() => null);
      }
    },

    async setMany<T>(entries: Array<[string, T]>): Promise<void> {
      if (entries.length === 0) return;
      try {
        await idbSetMany(entries, store);
      } catch (error) {
        logError(`${tag} setMany() failed`, error);
        throw error;
      }
    },

    async entries<T>(): Promise<Array<[string, T]>> {
      try {
        const all = await idbEntries<string, T>(store);
        return all.filter(
          ([k]) => typeof k === 'string',
        ) as Array<[string, T]>;
      } catch (error) {
        logError(`${tag} entries() failed`, error);
        return [];
      }
    },
  };
}

/**
 * idb-keyval's `createStore` calls `indexedDB.open` lazily; methods on
 * the returned `UseStore` are what actually open the DB. We pre-create
 * handles for every store at module-eval time so every database is
 * present in DevTools as soon as anything writes to it.
 */
const stores: Record<StoreName, UseStore> = ALL_STORE_NAMES.reduce(
  (acc, name) => {
    acc[name] = createStore(dbNameFor(name), 'keyval');
    return acc;
  },
  {} as Record<StoreName, UseStore>,
);

/**
 * Namespaced storage instances — one adapter per object store. Use the
 * one whose name describes the data you're persisting:
 *
 *   await storage.settings.set('searchDelay', '2');
 *   const cached = await storage.cache.get<UserData>('users:123');
 *   const all = await storage.presets.entries<ExportPreset>();
 *
 * Adding a new store is one entry in `ALL_STORE_NAMES`.
 */
export const storage: Record<StoreName, StorageAdapter> = ALL_STORE_NAMES.reduce(
  (acc, name) => {
    acc[name] = makeAdapter(name, stores[name]);
    return acc;
  },
  {} as Record<StoreName, StorageAdapter>,
);

logInfo(`[storage] Using IndexedDB databases "${DB_PREFIX}*" (${ALL_STORE_NAMES.length} stores)`);

/* ─────────────────── Migration ─────────────────── */

import {
  defaultSettings,
  isStateSettingKey,
  EXPORT_PRESETS_KEY,
  EXPORT_RECENT_HISTORY_KEY,
} from '@features/app/storageKeys';

/**
 * One-time migration from the various legacy storage shapes Discrub
 * has used over its lifetime. Idempotent: a marker key in
 * `Discrub-state` short-circuits subsequent runs. Best-effort: any
 * failure is logged and swallowed so a corrupted legacy record can't
 * block app boot.
 *
 * Sources collapsed:
 *
 *   • `keyval-store/keyval` (very legacy)        ─┐
 *   • `Discrub-settings/main` JSON blob          ─┤
 *   • `Discrub-cache/userMap` JSON blob          ─┤── all into the
 *   • EXPORT_PRESETS array inside settings       ─┤   per-purpose DBs
 *   • EXPORT_RECENT_HISTORY array inside settings─┤
 *   • localStorage `discrub_status_log` JSON     ─┘
 */
const MIGRATION_MARKER_KEY = '__migrated_to_per_key_storage__';

export async function migrateAllStorage(): Promise<void> {
  if (await storage.state.get<boolean>(MIGRATION_MARKER_KEY)) return;

  let totalMigrated = 0;

  totalMigrated += await migrateLegacyKeyvalStore();
  totalMigrated += await migrateSettingsBlob();
  totalMigrated += await migrateCacheBlob();
  totalMigrated += await migrateStatusLogLocalStorage();

  await storage.state.set(MIGRATION_MARKER_KEY, true);

  if (totalMigrated > 0) {
    logInfo(`[storage] Migrated ${totalMigrated} record(s) into per-key storage.`);
  }
}

/** Pre-rename `keyval-store/keyval` (very legacy) → settings/cache. */
async function migrateLegacyKeyvalStore(): Promise<number> {
  try {
    const legacy = createStore('keyval-store', 'keyval');
    const settingsBlob = await idbGet<string>('discrub-web-settings', legacy);
    const cacheBlob = await idbGet<string>('discrub-cache', legacy);
    let count = 0;
    if (typeof settingsBlob === 'string') {
      await splitSettingsBlob(settingsBlob);
      count++;
    }
    if (typeof cacheBlob === 'string') {
      await splitCacheBlob(cacheBlob);
      count++;
    }
    if (count > 0) await idbClear(legacy);
    return count;
  } catch (error) {
    logError('[storage] keyval-store migration failed', error);
    return 0;
  }
}

/**
 * `Discrub-settings/main` JSON blob (the previous step) → per-key
 * settings + state, plus extracted presets + history.
 */
async function migrateSettingsBlob(): Promise<number> {
  try {
    const blob = await storage.settings.get<string>('main');
    if (typeof blob !== 'string') return 0;
    await splitSettingsBlob(blob);
    await storage.settings.remove('main');
    return 1;
  } catch (error) {
    logError('[storage] settings-blob migration failed', error);
    return 0;
  }
}

async function splitSettingsBlob(jsonBlob: string): Promise<void> {
  const parsed = JSON.parse(jsonBlob) as Record<string, unknown>;
  const settingsEntries: Array<[string, unknown]> = [];
  const stateEntries: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (key === EXPORT_PRESETS_KEY) {
      // Pull presets out into their own DB.
      const presets = parseJsonArray(value);
      const presetEntries: Array<[string, unknown]> = presets.map((preset) => {
        const id = typeof (preset as { name?: string }).name === 'string'
          ? slugifyPresetName((preset as { name: string }).name)
          : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return [id, preset];
      });
      if (presetEntries.length > 0) await storage.presets.setMany(presetEntries);
      continue;
    }
    if (key === EXPORT_RECENT_HISTORY_KEY) {
      const history = parseJsonArray(value);
      const historyEntries: Array<[string, unknown]> = history.map((rec, i) => {
        const ts =
          typeof (rec as { timestamp?: number }).timestamp === 'number'
            ? String((rec as { timestamp: number }).timestamp)
            : String(Date.now() - (history.length - i)); // best-effort ordering
        return [ts, rec];
      });
      if (historyEntries.length > 0) await storage.history.setMany(historyEntries);
      continue;
    }
    if (isStateSettingKey(key)) {
      stateEntries.push([key, value]);
    } else if (key in defaultSettings) {
      settingsEntries.push([key, value]);
    }
    // Unknown keys silently dropped (defaults will fill on next load).
  }

  await Promise.all([
    storage.settings.setMany(settingsEntries),
    storage.state.setMany(stateEntries),
  ]);
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function slugifyPresetName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `preset-${Date.now()}`
  );
}

/** `Discrub-cache/userMap` JSON blob → per-user / per-failed keys. */
async function migrateCacheBlob(): Promise<number> {
  try {
    const blob = await storage.cache.get<string>('userMap');
    if (typeof blob !== 'string') return 0;
    await splitCacheBlob(blob);
    await storage.cache.remove('userMap');
    return 1;
  } catch (error) {
    logError('[storage] cache-blob migration failed', error);
    return 0;
  }
}

async function splitCacheBlob(jsonBlob: string): Promise<void> {
  const parsed = JSON.parse(jsonBlob) as {
    userMap?: Record<string, unknown>;
    failedUserIds?: string[];
  };
  const userEntries: Array<[string, unknown]> = Object.entries(
    parsed.userMap ?? {},
  ).map(([id, data]) => [`users:${id}`, data]);
  const failedEntries: Array<[string, unknown]> = (parsed.failedUserIds ?? [])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => [`failed:${id}`, { firstSeen: Date.now() }]);
  await storage.cache.setMany([...userEntries, ...failedEntries]);
}

/** localStorage `discrub_status_log` JSON array → per-entry IDB rows. */
async function migrateStatusLogLocalStorage(): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem('discrub_status_log');
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;

    const entries: Array<[string, unknown]> = parsed.map((entry, i) => {
      const ts =
        typeof (entry as { timestamp?: number }).timestamp === 'number'
          ? String((entry as { timestamp: number }).timestamp)
          : String(Date.now() - (parsed.length - i));
      return [ts, entry];
    });

    if (entries.length > 0) await storage.statuslog.setMany(entries);
    localStorage.removeItem('discrub_status_log');
    return entries.length;
  } catch (error) {
    logError('[storage] status-log migration failed', error);
    return 0;
  }
}

/* ─────────────────── Reset escape hatch ─────────────────── */

/**
 * Wipe every byte of Discrub data on this device + reload.
 *
 * Single source of truth for "what counts as Discrub data" — keep this
 * in sync with any new IDB store added to `ALL_STORE_NAMES`, plus the raw
 * `Discrub-workspaces` database (2.2.5). Used by the
 * Reset button on LandingPage and Settings (#134) to recover from any
 * stale-state issue without DevTools.
 *
 * Uses `Promise.allSettled` deliberately: if one store is corrupted and
 * its `.clear()` rejects, the others must still run. Aborting on first
 * failure would defeat the whole point of the escape hatch.
 */
export async function resetDiscrubData(): Promise<void> {
  await Promise.allSettled([
    ...ALL_STORE_NAMES.map((name) => storage[name].clear()),
    deleteWorkspaceDatabase(),
  ]);

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.clear();
    } catch (error) {
      logError('[storage] chrome.storage.local clear failed', error);
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.clear();
    } catch (error) {
      logError('[storage] localStorage clear failed', error);
    }
  }

  window.location.reload();
}
