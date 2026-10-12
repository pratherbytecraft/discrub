import { describe, it, expect, beforeEach, vi } from 'vitest';
import statusReducer, {
  addStatusEntry,
  clearStatusLog,
  loadStatusLog,
  showOperationTip,
  hideOperationTip,
  selectStatusEntries,
  selectStatusCount,
  selectOperationTip,
  _setCurrentSessionIdForTesting,
  _flushPersistBufferForTesting,
  _getPersistBufferSizeForTesting,
  installUnloadFlushListener,
} from './statusSlice';
import { createTestStore } from '@/test/test-utils';
import { initialStatusState } from './statusTypes';
import { storage } from '@/extension/storage';

function createStore(preloadedState?: Record<string, unknown>) {
  return createTestStore(
    { status: statusReducer },
    preloadedState,
  );
}

// Persistence is fire-and-forget; flush microtasks so the write completes
// before assertions read it back.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('statusSlice', () => {
  beforeEach(async () => {
    // Drain any buffered writes from a previous test so storage starts clean.
    _flushPersistBufferForTesting();
    await storage.statuslog.clear();
  });

  describe('addStatusEntry', () => {
    it('adds an entry to the log', () => {
      const store = createStore();
      store.dispatch(addStatusEntry({ level: 'info', message: 'Test message' }));
      const entries = selectStatusEntries(store.getState());
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('info');
      expect(entries[0].message).toBe('Test message');
      expect(entries[0].id).toBeDefined();
      expect(entries[0].timestamp).toBeGreaterThan(0);
    });

    it('adds multiple entries', () => {
      const store = createStore();
      store.dispatch(addStatusEntry({ level: 'info', message: 'First' }));
      store.dispatch(addStatusEntry({ level: 'warning', message: 'Second' }));
      store.dispatch(addStatusEntry({ level: 'error', message: 'Third' }));
      const entries = selectStatusEntries(store.getState());
      expect(entries).toHaveLength(3);
      expect(entries[0].message).toBe('First');
      expect(entries[1].message).toBe('Second');
      expect(entries[2].message).toBe('Third');
    });

    it('caps entries at maxEntries', () => {
      const store = createStore({
        status: { ...initialStatusState, maxEntries: 3 },
      });
      for (let i = 0; i < 5; i++) {
        store.dispatch(addStatusEntry({ level: 'info', message: `Entry ${i}` }));
      }
      const entries = selectStatusEntries(store.getState());
      expect(entries).toHaveLength(3);
      // Should keep the last 3
      expect(entries[0].message).toBe('Entry 2');
      expect(entries[1].message).toBe('Entry 3');
      expect(entries[2].message).toBe('Entry 4');
    });

    it('persists entries to IndexedDB statuslog store', async () => {
      const store = createStore();
      store.dispatch(addStatusEntry({ level: 'info', message: 'Persisted' }));
      // #183: writes are now batched; force a flush before assertion.
      _flushPersistBufferForTesting();
      await flush();
      const stored = (await storage.statuslog.entries()).map(([, v]) => v) as Array<{ message: string }>;
      expect(stored).toHaveLength(1);
      expect(stored[0].message).toBe('Persisted');
    });

    // ── #183: batched IDB persistence ─────────────────────────────

    it('buffers writes until the flush threshold is hit (default 50)', async () => {
      const store = createStore();
      // 30 writes — under threshold and within the 250ms timer window.
      for (let i = 0; i < 30; i++) {
        store.dispatch(addStatusEntry({ level: 'info', message: `Burst ${i}` }));
      }
      // Without forcing a flush, IDB should still be empty (buffered).
      expect(_getPersistBufferSizeForTesting()).toBe(30);
      expect((await storage.statuslog.entries()).length).toBe(0);
    });

    it('auto-flushes when the threshold is exceeded', async () => {
      const store = createStore();
      for (let i = 0; i < 60; i++) {
        store.dispatch(addStatusEntry({ level: 'info', message: `Burst ${i}` }));
      }
      await flush();
      // After 60 writes the threshold (50) has fired at least once.
      // Buffer holds the remaining 10; IDB holds the first 50.
      expect(_getPersistBufferSizeForTesting()).toBe(10);
      expect((await storage.statuslog.entries()).length).toBe(50);
    });

    // Storage full on Firefox (2.2.5 recheck): a refused save surfaced as an
    // unhandled rejection, which the global handler logged as a new entry,
    // whose save was refused again, four lines a second.
    it('keeps a refused save from becoming an unhandled rejection', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      const quota = new Error('The current transaction exceeded its quota limitations.');
      const setMany = vi.spyOn(storage.statuslog, 'setMany').mockRejectedValueOnce(quota);
      const remove = vi.spyOn(storage.statuslog, 'remove').mockRejectedValueOnce(quota);
      try {
        const store = createStore();
        store.dispatch(addStatusEntry({ level: 'warning', message: 'Browser storage is full' }));
        _flushPersistBufferForTesting();
        store.dispatch(clearStatusLog());
        await flush();
        await flush();
        expect(setMany).toHaveBeenCalled();
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        setMany.mockRestore();
        remove.mockRestore();
      }
    });

    it('explicit flush drains the buffer', async () => {
      const store = createStore();
      for (let i = 0; i < 5; i++) {
        store.dispatch(addStatusEntry({ level: 'info', message: `b${i}` }));
      }
      expect(_getPersistBufferSizeForTesting()).toBe(5);
      _flushPersistBufferForTesting();
      await flush();
      expect(_getPersistBufferSizeForTesting()).toBe(0);
      expect((await storage.statuslog.entries()).length).toBe(5);
    });

    it('cap-trim of buffered-but-not-yet-persisted entries drops them in place (no write+delete churn)', async () => {
      const store = createStore({
        status: { ...initialStatusState, maxEntries: 3 },
      });
      // Push 5 entries — first 2 should be trimmed AND dropped from the
      // buffer before they ever hit IDB.
      for (let i = 0; i < 5; i++) {
        store.dispatch(addStatusEntry({ level: 'info', message: `Trim ${i}` }));
      }
      // Buffer holds only the surviving 3 (the trimmed-from-front ones
      // were excised before flush).
      expect(_getPersistBufferSizeForTesting()).toBe(3);
      _flushPersistBufferForTesting();
      await flush();
      const stored = (await storage.statuslog.entries()).map(([, v]) => v) as Array<{ message: string }>;
      expect(stored.map((s) => s.message).sort()).toEqual(['Trim 2', 'Trim 3', 'Trim 4']);
    });
  });

  describe('maxEntries', () => {
    it('supports up to 2000 entries', () => {
      expect(initialStatusState.maxEntries).toBe(2000);
    });
  });

  describe('clearStatusLog', () => {
    it('clears all entries', () => {
      const store = createStore();
      store.dispatch(addStatusEntry({ level: 'info', message: 'Test' }));
      store.dispatch(addStatusEntry({ level: 'error', message: 'Error' }));
      expect(selectStatusEntries(store.getState())).toHaveLength(2);

      store.dispatch(clearStatusLog());
      expect(selectStatusEntries(store.getState())).toHaveLength(0);
    });

    it('clears IndexedDB statuslog store on clear', async () => {
      const store = createStore();
      store.dispatch(addStatusEntry({ level: 'info', message: 'Test' }));
      _flushPersistBufferForTesting();
      await flush();
      expect(await storage.statuslog.entries()).toHaveLength(1);

      store.dispatch(clearStatusLog());
      await flush();
      expect(await storage.statuslog.entries()).toHaveLength(0);
    });
  });

  describe('showOperationTip', () => {
    it('sets isVisible and message', () => {
      const store = createStore();
      store.dispatch(showOperationTip('Deleting messages'));
      const tip = selectOperationTip(store.getState());
      expect(tip.isVisible).toBe(true);
      expect(tip.message).toBe('Deleting messages');
    });

    it('overwrites previous tip message', () => {
      const store = createStore();
      store.dispatch(showOperationTip('First'));
      store.dispatch(showOperationTip('Second'));
      const tip = selectOperationTip(store.getState());
      expect(tip.isVisible).toBe(true);
      expect(tip.message).toBe('Second');
    });
  });

  describe('hideOperationTip', () => {
    it('sets isVisible to false', () => {
      const store = createStore();
      store.dispatch(showOperationTip('Test'));
      store.dispatch(hideOperationTip());
      const tip = selectOperationTip(store.getState());
      expect(tip.isVisible).toBe(false);
    });
  });

  describe('selectors', () => {
    it('selectStatusCount returns entry count', () => {
      const store = createStore();
      expect(selectStatusCount(store.getState())).toBe(0);
      store.dispatch(addStatusEntry({ level: 'info', message: 'Test' }));
      expect(selectStatusCount(store.getState())).toBe(1);
    });
  });

  describe('sessionId stamping (Backlog #126)', () => {
    it('stamps every new entry with the current session id', () => {
      _setCurrentSessionIdForTesting('test-session-A');
      const store = createStore();
      store.dispatch(addStatusEntry({ level: 'info', message: 'first' }));
      store.dispatch(addStatusEntry({ level: 'info', message: 'second' }));
      const entries = selectStatusEntries(store.getState());
      expect(entries.every((e) => e.sessionId === 'test-session-A')).toBe(true);
    });

    it('uses different session ids for entries dispatched in different sessions', () => {
      const store = createStore();
      _setCurrentSessionIdForTesting('session-1');
      store.dispatch(addStatusEntry({ level: 'info', message: 'session 1 entry' }));
      _setCurrentSessionIdForTesting('session-2');
      store.dispatch(addStatusEntry({ level: 'info', message: 'session 2 entry' }));
      const entries = selectStatusEntries(store.getState());
      expect(entries.find((e) => e.message === 'session 1 entry')?.sessionId).toBe('session-1');
      expect(entries.find((e) => e.message === 'session 2 entry')?.sessionId).toBe('session-2');
      // Reset so other tests don't see the stale id.
      _setCurrentSessionIdForTesting(null);
    });
  });

  describe('loadStatusLog (Backlog #126 boot-race fix)', () => {
    it('seeds an empty state from IDB', async () => {
      await storage.statuslog.setMany([
        ['1000-0', { id: '0', timestamp: 1000, level: 'info', message: 'persisted A' }],
        ['2000-1', { id: '1', timestamp: 2000, level: 'info', message: 'persisted B' }],
      ]);
      const store = createStore();
      await store.dispatch(loadStatusLog());
      const entries = selectStatusEntries(store.getState());
      expect(entries.map((e) => e.message)).toEqual(['persisted A', 'persisted B']);
    });

    it('merges persisted history with entries dispatched during boot (race fix)', async () => {
      // Pre-populate IDB with a prior session's entries.
      await storage.statuslog.setMany([
        ['1000-0', { id: '0', timestamp: 1000, level: 'info', message: 'prior session 1' }],
        ['2000-1', { id: '1', timestamp: 2000, level: 'info', message: 'prior session 2' }],
      ]);
      const store = createStore();

      // Simulate boot: dispatch synchronously BEFORE the load thunk resolves.
      store.dispatch(addStatusEntry({ level: 'session', message: 'New session established' }));
      store.dispatch(addStatusEntry({ level: 'info', message: 'Loading servers...' }));

      // Now resolve the load.
      await store.dispatch(loadStatusLog());

      const messages = selectStatusEntries(store.getState()).map((e) => e.message);
      expect(messages).toContain('prior session 1');
      expect(messages).toContain('prior session 2');
      expect(messages).toContain('New session established');
      expect(messages).toContain('Loading servers...');
      // Chronological order: prior entries (older timestamps) first.
      expect(messages.indexOf('prior session 1')).toBeLessThan(messages.indexOf('New session established'));
    });

    it('dedupes entries already in memory by timestamp+id key', async () => {
      const dup = { id: '0', timestamp: 1000, level: 'info' as const, message: 'dup' };
      await storage.statuslog.set('1000-0', dup);
      const store = createStore({ status: { ...initialStatusState, entries: [dup] } });

      await store.dispatch(loadStatusLog());

      const entries = selectStatusEntries(store.getState());
      expect(entries.filter((e) => e.message === 'dup')).toHaveLength(1);
    });

    it('respects maxEntries when merge would overflow', async () => {
      // 3 persisted + 2 in memory = 5 candidates, cap at 3 → keep latest 3.
      await storage.statuslog.setMany([
        ['1000-0', { id: '0', timestamp: 1000, level: 'info', message: 'old A' }],
        ['2000-1', { id: '1', timestamp: 2000, level: 'info', message: 'old B' }],
        ['3000-2', { id: '2', timestamp: 3000, level: 'info', message: 'old C' }],
      ]);
      const store = createStore({ status: { ...initialStatusState, maxEntries: 3 } });
      store.dispatch(addStatusEntry({ level: 'info', message: 'fresh A' }));
      store.dispatch(addStatusEntry({ level: 'info', message: 'fresh B' }));

      await store.dispatch(loadStatusLog());

      const messages = selectStatusEntries(store.getState()).map((e) => e.message);
      expect(messages).toHaveLength(3);
      // Two freshest in-memory entries (timestamp = Date.now()) win.
      expect(messages).toContain('fresh A');
      expect(messages).toContain('fresh B');
      expect(messages).toContain('old C');
      expect(messages).not.toContain('old A');
      expect(messages).not.toContain('old B');
    });
  });

  describe('installUnloadFlushListener (#183 — flush on tab close / hide)', () => {
    it('flushes the pending persist buffer when pagehide fires', async () => {
      const store = createStore();
      const uninstall = installUnloadFlushListener();
      try {
        // Push one entry; it should sit in the 250ms coalescing buffer.
        store.dispatch(addStatusEntry({ level: 'info', message: 'about to close tab' }));
        expect(_getPersistBufferSizeForTesting()).toBe(1);

        window.dispatchEvent(new Event('pagehide'));

        // Listener calls flushPersistBuffer synchronously — buffer is empty.
        expect(_getPersistBufferSizeForTesting()).toBe(0);

        await flush();
        const keys = await storage.statuslog.keys();
        expect(keys.length).toBe(1);
      } finally {
        uninstall();
      }
    });

    it('flushes when visibilitychange fires with document.hidden = true', async () => {
      const store = createStore();
      const uninstall = installUnloadFlushListener();
      try {
        store.dispatch(addStatusEntry({ level: 'info', message: 'tab going hidden' }));
        expect(_getPersistBufferSizeForTesting()).toBe(1);

        // jsdom: redefine document.hidden to simulate the visible→hidden transition.
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(_getPersistBufferSizeForTesting()).toBe(0);
        await flush();
        const keys = await storage.statuslog.keys();
        expect(keys.length).toBe(1);
      } finally {
        uninstall();
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      }
    });

    it('does NOT flush on visibilitychange when document.hidden is false', () => {
      const store = createStore();
      const uninstall = installUnloadFlushListener();
      try {
        store.dispatch(addStatusEntry({ level: 'info', message: 'tab becoming visible' }));
        expect(_getPersistBufferSizeForTesting()).toBe(1);

        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));

        // Buffer untouched — flushing on visible would needlessly write
        // mid-session every time the user tabs back.
        expect(_getPersistBufferSizeForTesting()).toBe(1);
      } finally {
        uninstall();
      }
    });

    it('uninstall stops further flushes from firing', () => {
      const store = createStore();
      const uninstall = installUnloadFlushListener();
      uninstall();

      store.dispatch(addStatusEntry({ level: 'info', message: 'after uninstall' }));
      expect(_getPersistBufferSizeForTesting()).toBe(1);

      window.dispatchEvent(new Event('pagehide'));

      // Listener is gone — buffer stays unflushed (the 250ms timer would
      // eventually drain it, but the unload event didn't trigger early flush).
      expect(_getPersistBufferSizeForTesting()).toBe(1);
    });

    it('is idempotent — calling install twice still installs only one effective listener pair', () => {
      const store = createStore();
      const uninstall1 = installUnloadFlushListener();
      const uninstall2 = installUnloadFlushListener();
      try {
        store.dispatch(addStatusEntry({ level: 'info', message: 'double install' }));
        expect(_getPersistBufferSizeForTesting()).toBe(1);

        window.dispatchEvent(new Event('pagehide'));
        // Doesn't matter that two listeners ran; the second flush is a no-op.
        expect(_getPersistBufferSizeForTesting()).toBe(0);
      } finally {
        uninstall1();
        uninstall2();
      }
    });
  });
});
