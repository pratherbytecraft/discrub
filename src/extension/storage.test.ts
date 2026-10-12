/**
 * Tests for the namespaced IndexedDB-backed storage layer.
 *
 * Backed by `fake-indexeddb/auto` (registered in src/test/setup.ts).
 * Each top-level `describe` exercises one of the per-purpose stores
 * end-to-end so any regression in the adapter wiring or the
 * underlying object stores is caught.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storage,
  migrateAllStorage,
  resetDiscrubData,
  type StorageAdapter,
  type StoreName,
} from './storage';
import { clear as idbClear, createStore, set as idbSet } from 'idb-keyval';
import { countRows, writePage, WORKSPACE_DB_NAME } from '@/services/workspaceStore';
import { createMockMessage } from '@/test/fixtures';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

const ALL_STORES: StoreName[] = [
  'settings',
  'state',
  'presets',
  'cache',
  'history',
  'statuslog',
  'package',
  'media',
];

async function clearAllStores() {
  await Promise.all(ALL_STORES.map((name) => storage[name].clear()));
}

describe('storage (namespaced IndexedDB adapters)', () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  describe.each(ALL_STORES)('%s store — round-trip', (storeName) => {
    let store: StorageAdapter;
    beforeEach(() => {
      store = storage[storeName];
    });

    it('stores and retrieves a string value', async () => {
      await store.set('greeting', 'hello world');
      expect(await store.get('greeting')).toBe('hello world');
    });

    it('stores and retrieves a structured object (no JSON wrapper needed)', async () => {
      const value = { nested: { items: [1, 2, 3], flag: true }, unicode: '😝🤖' };
      await store.set('object', value);
      const retrieved = await store.get<typeof value>('object');
      expect(retrieved).toEqual(value);
    });

    it('overwrites existing values on re-set', async () => {
      await store.set('counter', 1);
      await store.set('counter', 2);
      expect(await store.get('counter')).toBe(2);
    });

    it('returns null for missing keys', async () => {
      expect(await store.get('does-not-exist')).toBeNull();
    });

    it('returns null after a key is removed', async () => {
      await store.set('temp', 'value');
      await store.remove('temp');
      expect(await store.get('temp')).toBeNull();
    });

    it('remove is silent on already-missing keys', async () => {
      await expect(store.remove('never-set')).resolves.toBeUndefined();
    });

    it('clear empties the store', async () => {
      await store.set('a', '1');
      await store.set('b', '2');
      await store.clear();
      expect(await store.keys()).toEqual([]);
    });

    it('keys reflects current contents', async () => {
      await store.set('alpha', '1');
      await store.set('beta', '2');
      const keys = await store.keys();
      expect(keys.sort()).toEqual(['alpha', 'beta']);
    });

    it('getMany returns values in argument order, null for missing', async () => {
      await store.set('a', 'A');
      await store.set('c', 'C');
      const result = await store.getMany(['a', 'b', 'c']);
      expect(result).toEqual(['A', null, 'C']);
    });

    it('getMany returns [] for empty input without IDB call', async () => {
      expect(await store.getMany([])).toEqual([]);
    });

    it('setMany persists multiple entries in one call', async () => {
      await store.setMany<unknown>([
        ['k1', 'v1'],
        ['k2', { complex: true }],
        ['k3', 42],
      ]);
      expect(await store.get('k1')).toBe('v1');
      expect(await store.get('k2')).toEqual({ complex: true });
      expect(await store.get('k3')).toBe(42);
    });

    it('entries returns every key/value pair', async () => {
      await store.set('foo', 'F');
      await store.set('bar', 'B');
      const result = await store.entries();
      const map = new Map(result);
      expect(map.get('foo')).toBe('F');
      expect(map.get('bar')).toBe('B');
    });

    it('entries returns [] for empty store', async () => {
      expect(await store.entries()).toEqual([]);
    });
  });

  describe('isolation between stores', () => {
    it('writes to one store do not appear in another', async () => {
      await storage.settings.set('shared-key', 'settings value');
      await storage.cache.set('shared-key', 'cache value');

      expect(await storage.settings.get('shared-key')).toBe('settings value');
      expect(await storage.cache.get('shared-key')).toBe('cache value');
      expect(await storage.package.get('shared-key')).toBeNull();
    });

    it('clearing one store leaves the others intact', async () => {
      await storage.settings.set('s', 's-val');
      await storage.cache.set('c', 'c-val');
      await storage.package.set('p', 'p-val');

      await storage.cache.clear();

      expect(await storage.settings.get('s')).toBe('s-val');
      expect(await storage.cache.get('c')).toBeNull();
      expect(await storage.package.get('p')).toBe('p-val');
    });
  });

  describe('error handling (idb-keyval rejects)', () => {
    let mod: typeof import('./storage');
    let stubs: Record<string, any>;

    beforeEach(async () => {
      vi.resetModules();
      stubs = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        clear: vi.fn(),
        keys: vi.fn(),
        getMany: vi.fn(),
        setMany: vi.fn(),
        entries: vi.fn(),
        createStore: vi.fn(() => () => undefined),
      };
      vi.doMock('idb-keyval', () => stubs);
      mod = await import('./storage');
    });

    afterEach(() => {
      vi.doUnmock('idb-keyval');
    });

    it('get returns null when idb-keyval rejects', async () => {
      stubs.get.mockRejectedValueOnce(new Error('IDB unavailable'));
      expect(await mod.storage.settings.get('any')).toBeNull();
    });

    it('set re-throws so callers can catch quota errors', async () => {
      const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
      stubs.set.mockRejectedValueOnce(quota);
      await expect(mod.storage.cache.set('any', 'x')).rejects.toBe(quota);
    });

    it('remove swallows errors silently', async () => {
      stubs.del.mockRejectedValueOnce(new Error('boom'));
      await expect(mod.storage.package.remove('any')).resolves.toBeUndefined();
    });

    it('clear swallows errors silently', async () => {
      stubs.clear.mockRejectedValueOnce(new Error('boom'));
      await expect(mod.storage.settings.clear()).resolves.toBeUndefined();
    });

    it('keys returns an empty array on rejection', async () => {
      stubs.keys.mockRejectedValueOnce(new Error('boom'));
      expect(await mod.storage.cache.keys()).toEqual([]);
    });

    it('keys filters out non-string IDB keys defensively', async () => {
      stubs.keys.mockResolvedValueOnce(['valid', 42, true, null, 'also-valid']);
      const result = await mod.storage.package.keys();
      expect(result).toEqual(['valid', 'also-valid']);
    });

    it('getMany returns null array on rejection', async () => {
      stubs.getMany.mockRejectedValueOnce(new Error('boom'));
      const result = await mod.storage.settings.getMany(['a', 'b']);
      expect(result).toEqual([null, null]);
    });

    it('setMany re-throws', async () => {
      stubs.setMany.mockRejectedValueOnce(new Error('quota'));
      await expect(
        mod.storage.cache.setMany([['k', 'v']]),
      ).rejects.toThrow('quota');
    });

    it('entries returns [] on rejection', async () => {
      stubs.entries.mockRejectedValueOnce(new Error('boom'));
      expect(await mod.storage.history.entries()).toEqual([]);
    });
  });
});

describe('migrateAllStorage', () => {
  beforeEach(async () => {
    await clearAllStores();
    // Wipe any legacy DB residue.
    try {
      await idbClear(createStore('keyval-store', 'keyval'));
    } catch {
      /* may not exist; fine */
    }
  });

  it('records a marker so subsequent boots short-circuit', async () => {
    await migrateAllStorage();
    expect(
      await storage.state.get<boolean>('__migrated_to_per_key_storage__'),
    ).toBe(true);
  });

  it('is idempotent — running twice is harmless', async () => {
    await migrateAllStorage();
    await migrateAllStorage(); // should no-op
    expect(
      await storage.state.get<boolean>('__migrated_to_per_key_storage__'),
    ).toBe(true);
  });

  it('splits a Discrub-settings/main JSON blob into per-key entries', async () => {
    // Seed the legacy single-row settings blob using real enum keys.
    await storage.settings.set(
      'main',
      JSON.stringify({
        [DiscrubSetting.SEARCH_DELAY]: '5',
        [DiscrubSetting.DELETE_DELAY]: '3',
        [DiscrubSetting.APP_SHOW_KOFI_FEED]: 'false',
      }),
    );

    await migrateAllStorage();

    expect(await storage.settings.get(DiscrubSetting.SEARCH_DELAY)).toBe('5');
    expect(await storage.settings.get(DiscrubSetting.DELETE_DELAY)).toBe('3');
    expect(await storage.settings.get(DiscrubSetting.APP_SHOW_KOFI_FEED)).toBe('false');
    // The legacy blob is removed after migration.
    expect(await storage.settings.get('main')).toBeNull();
  });

  it('routes state-marker keys to the state DB instead of settings', async () => {
    await storage.settings.set(
      'main',
      JSON.stringify({
        [DiscrubSetting.SEARCH_DELAY]: '1',
        [DiscrubSetting.APP_TOUR_SHELL_COMPLETED]: 'true',
        [DiscrubSetting.CACHED_ANNOUNCEMENT_REV]: 'rev-42',
      }),
    );

    await migrateAllStorage();

    expect(await storage.settings.get(DiscrubSetting.SEARCH_DELAY)).toBe('1');
    // State markers go to Discrub-state, not Discrub-settings.
    expect(
      await storage.settings.get(DiscrubSetting.APP_TOUR_SHELL_COMPLETED),
    ).toBeNull();
    expect(
      await storage.state.get(DiscrubSetting.APP_TOUR_SHELL_COMPLETED),
    ).toBe('true');
    expect(
      await storage.state.get(DiscrubSetting.CACHED_ANNOUNCEMENT_REV),
    ).toBe('rev-42');
  });

  it('extracts EXPORT_PRESETS into the presets DB', async () => {
    const presets = [
      { id: 'p1', name: 'Archival', isBuiltIn: false, format: 'html' },
      { id: 'p2', name: 'Quick', isBuiltIn: false, format: 'csv' },
    ];
    await storage.settings.set(
      'main',
      JSON.stringify({
        [DiscrubSetting.SEARCH_DELAY]: '1',
        [DiscrubSetting.EXPORT_PRESETS]: presets,
      }),
    );

    await migrateAllStorage();

    const archival = await storage.presets.get('archival');
    expect(archival).toEqual(presets[0]);
    const quick = await storage.presets.get('quick');
    expect(quick).toEqual(presets[1]);
  });

  it('extracts EXPORT_RECENT_HISTORY into the history DB', async () => {
    const records = [
      { id: 'r1', channelName: 'general', timestamp: '2026-01-01' },
      { id: 'r2', channelName: 'random', timestamp: '2026-01-02' },
    ];
    await storage.settings.set(
      'main',
      JSON.stringify({
        [DiscrubSetting.SEARCH_DELAY]: '1',
        [DiscrubSetting.EXPORT_RECENT_HISTORY]: records,
      }),
    );

    await migrateAllStorage();

    const allHistory = await storage.history.entries();
    const sorted = allHistory
      .map(([, v]) => v as typeof records[number])
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted).toEqual(records);
  });

  it('splits a Discrub-cache/userMap JSON blob into users:* + failed:* keys', async () => {
    const cacheBlob = {
      userMap: {
        '253286221395001345': { userName: 'prathercc', timestamp: 1000 },
        '409081361329029120': { userName: 'drewology', timestamp: 2000 },
      },
      failedUserIds: ['111000000000000000', '222000000000000000'],
    };
    await storage.cache.set('userMap', JSON.stringify(cacheBlob));

    await migrateAllStorage();

    expect(await storage.cache.get('users:253286221395001345')).toEqual({
      userName: 'prathercc',
      timestamp: 1000,
    });
    expect(await storage.cache.get('users:409081361329029120')).toEqual({
      userName: 'drewology',
      timestamp: 2000,
    });
    expect(await storage.cache.get('failed:111000000000000000')).toMatchObject({
      firstSeen: expect.any(Number),
    });
    // Old userMap blob removed.
    expect(await storage.cache.get('userMap')).toBeNull();
  });

  it('migrates localStorage status log into the statuslog DB', async () => {
    const entries = [
      { id: '0', timestamp: 1000, level: 'info', message: 'one' },
      { id: '1', timestamp: 2000, level: 'success', message: 'two' },
    ];
    localStorage.setItem('discrub_status_log', JSON.stringify(entries));

    await migrateAllStorage();

    const logged = await storage.statuslog.entries();
    expect(logged).toHaveLength(2);
    expect(logged.map(([_k, v]) => v).sort((a: any, b: any) => a.timestamp - b.timestamp))
      .toEqual(entries);
    // localStorage cleared.
    expect(localStorage.getItem('discrub_status_log')).toBeNull();
  });

  it('migrates the very-legacy keyval-store layout', async () => {
    const legacy = createStore('keyval-store', 'keyval');
    await idbSet(
      'discrub-web-settings',
      JSON.stringify({ [DiscrubSetting.SEARCH_DELAY]: '7' }),
      legacy,
    );
    await idbSet(
      'discrub-cache',
      JSON.stringify({
        userMap: { user1: { userName: 'u1' } },
        failedUserIds: [],
      }),
      legacy,
    );

    await migrateAllStorage();

    expect(await storage.settings.get(DiscrubSetting.SEARCH_DELAY)).toBe('7');
    expect(await storage.cache.get('users:user1')).toEqual({ userName: 'u1' });
  });
});

describe('resetDiscrubData (Backlog #134 escape hatch)', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  let originalChrome: unknown;

  beforeEach(async () => {
    await clearAllStores();
    if (typeof localStorage !== 'undefined') localStorage.clear();

    // Replace window.location so tests don't actually reload the runner.
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    // Capture and clear any chrome global from prior tests.
    originalChrome = (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('clears every Discrub IDB store', async () => {
    await Promise.all(
      ALL_STORES.map((name) => storage[name].set('seed', { v: 1 })),
    );
    for (const name of ALL_STORES) {
      expect(await storage[name].get('seed')).toEqual({ v: 1 });
    }

    await resetDiscrubData();

    for (const name of ALL_STORES) {
      expect(await storage[name].get('seed')).toBeNull();
    }
  });

  it('deletes the workspaces database (2.2.5)', async () => {
    await ensureTestDefaultWorkspace();
    await writePage('default', '1000', [createMockMessage({ id: '1' })], { kind: 'channel', guildId: null, name: 'general' });
    expect(await countRows('default', '1000')).toBe(1);

    await resetDiscrubData();

    const names = await indexedDB.databases();
    expect(names.map((d) => d.name)).not.toContain(WORKSPACE_DB_NAME);
  });

  it('clears localStorage', async () => {
    localStorage.setItem('discrub_status_log', '[{"id":"0"}]');
    localStorage.setItem('something_else', 'value');

    await resetDiscrubData();

    expect(localStorage.getItem('discrub_status_log')).toBeNull();
    expect(localStorage.getItem('something_else')).toBeNull();
  });

  it('triggers a page reload after clearing', async () => {
    await resetDiscrubData();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('continues clearing other stores when one rejects (Promise.allSettled)', async () => {
    await Promise.all(
      ALL_STORES.map((name) => storage[name].set('seed', { v: 1 })),
    );
    const failingClear = vi
      .spyOn(storage.cache, 'clear')
      .mockRejectedValueOnce(new Error('cache store corrupted'));

    await resetDiscrubData();

    expect(failingClear).toHaveBeenCalled();
    // Every OTHER store still cleared despite the rejected cache.clear().
    for (const name of ALL_STORES) {
      if (name === 'cache') continue;
      expect(await storage[name].get('seed')).toBeNull();
    }
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('calls chrome.storage.local.clear() when the API is available', async () => {
    const chromeClear = vi.fn().mockResolvedValue(undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { clear: chromeClear } },
    };

    await resetDiscrubData();

    expect(chromeClear).toHaveBeenCalledTimes(1);
  });

  it('skips chrome.storage entirely when chrome is undefined (web-app mode)', async () => {
    expect((globalThis as { chrome?: unknown }).chrome).toBeUndefined();
    await expect(resetDiscrubData()).resolves.toBeUndefined();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('still reloads when chrome.storage.local.clear() throws', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: { clear: vi.fn().mockRejectedValue(new Error('boom')) },
      },
    };

    await resetDiscrubData();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
