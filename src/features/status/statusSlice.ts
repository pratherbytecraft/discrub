import { previewSafe } from '@/middleware/previewGuardMiddleware';
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { storage } from '@/extension/storage';
import type { StatusLogEntry, ToastAction } from './statusTypes';
import { StatusLevel, initialStatusState } from './statusTypes';

/**
 * Status log slice.
 *
 * Storage layout (Discrub-statuslog database):
 *
 *   <timestampMs> → StatusLogEntry  (one row per entry, browseable in DevTools)
 *
 * Hydration is async (`loadStatusLog` thunk) — boot dispatches it and
 * the panel briefly shows empty until the read resolves. Trade-off
 * accepted as part of moving every persistent store to IndexedDB.
 */

let nextId = 0;

/**
 * One id per page-load. Stamped on every `addStatusEntry` so the panel
 * can group entries by session (#126). Tests can override via
 * `_setCurrentSessionIdForTesting`.
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let currentSessionId = generateSessionId();

/** Test-only escape hatch — control session id for grouping tests. */
export function _setCurrentSessionIdForTesting(id: string | null): void {
  currentSessionId = id ?? generateSessionId();
}

/** Read the current page-load session id (used by StatusPanel grouping). */
export function getCurrentSessionId(): string {
  return currentSessionId;
}

/**
 * Load every persisted status entry on app boot. One IDB transaction.
 * Sorted ascending by timestamp so the panel renders in chronological
 * order without per-render sorting.
 */
export const loadStatusLog = previewSafe(createAsyncThunk(
  'status/loadStatusLog',
  async (_, { rejectWithValue }) => {
    try {
      const all = await storage.statuslog.entries<StatusLogEntry>();
      const sorted = all
        .map(([_key, entry]) => entry)
        .sort((a, b) => a.timestamp - b.timestamp);
      // Seed nextId so newly-added entries don't collide with persisted ones.
      nextId = sorted.length > 0
        ? Math.max(...sorted.map((e) => Number(e.id) || 0)) + 1
        : 0;
      return sorted;
    } catch (error) {
      console.error('Failed to load status log:', error);
      return rejectWithValue('Failed to load status log');
    }
  },
));

/**
 * Best-effort persistence helpers — fire-and-forget, never block the
 * Redux dispatch they originate from. Failures are logged via the
 * adapter; we can't surface storage errors to the UI from a reducer.
 *
 * #183: a 5k+ purge that hits errors per-message used to issue one IDB
 * write per entry. Even though `void storage.set(...)` is async, the
 * 5000 individual transactions serialize through IDB's request queue
 * and add measurable main-thread pressure (each call also allocates +
 * structurally clones the entry). The batch buffer below coalesces
 * pending writes into a single `setMany` flushed every 250ms or every
 * 50 entries, whichever comes first.
 */
const PERSIST_FLUSH_INTERVAL_MS = 250;
const PERSIST_FLUSH_THRESHOLD = 50;
let pendingPersistBuffer: Array<[string, StatusLogEntry]> = [];
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPersistBuffer(): void {
  if (pendingPersistBuffer.length === 0) return;
  const batch = pendingPersistBuffer;
  pendingPersistBuffer = [];
  if (pendingFlushTimer !== null) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  void storage.statuslog.setMany(batch);
}

function persistEntry(entry: StatusLogEntry): void {
  pendingPersistBuffer.push([
    String(entry.timestamp) + '-' + entry.id,
    entry,
  ]);
  if (pendingPersistBuffer.length >= PERSIST_FLUSH_THRESHOLD) {
    flushPersistBuffer();
    return;
  }
  if (pendingFlushTimer === null) {
    pendingFlushTimer = setTimeout(flushPersistBuffer, PERSIST_FLUSH_INTERVAL_MS);
  }
}

function persistTrim(removedKeys: string[]): void {
  // If the trimmed entries are still in the pending-write buffer, drop
  // them in place rather than write-then-delete. Reduces churn during
  // cap-trim cascades on long-running operations.
  if (pendingPersistBuffer.length > 0 && removedKeys.length > 0) {
    const removedSet = new Set(removedKeys);
    pendingPersistBuffer = pendingPersistBuffer.filter(
      ([key]) => !removedSet.has(key),
    );
  }
  removedKeys.forEach((k) => void storage.statuslog.remove(k));
}

function persistClear(): void {
  pendingPersistBuffer = [];
  if (pendingFlushTimer !== null) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  void storage.statuslog.clear();
}

/**
 * Test-only escape hatch: synchronously flush the persist buffer and
 * reset bookkeeping. Lets unit tests assert on the post-flush IDB state
 * without waiting on the 250ms timer.
 */
export function _flushPersistBufferForTesting(): void {
  flushPersistBuffer();
}

/** Test-only escape hatch: inspect the pending buffer size. */
export function _getPersistBufferSizeForTesting(): number {
  return pendingPersistBuffer.length;
}

/**
 * #183 unload-flush arm: registers handlers that drain the 250ms-coalesced
 * persist buffer when the tab is about to die or go background. Without
 * this, the in-memory buffer's tail (up to 50 entries / 250ms worth) is
 * lost if the user closes the tab, reloads the extension, or the browser
 * crashes mid-coalesce. Confirmed by a Cypress regression where the
 * session-marker test had to wait past the flush window before reloading.
 *
 * Uses `pagehide` (modern unload signal, fires reliably for tab close)
 * and `visibilitychange` to `hidden` (catches user backgrounding the tab).
 * `beforeunload` is intentionally skipped — modern browsers throttle it
 * heavily on mobile and may skip it entirely for tab close.
 *
 * Returns an uninstaller function; safe to call multiple times (each
 * install registers its own listeners; each uninstall removes the
 * exact pair it added).
 */
export function installUnloadFlushListener(): () => void {
  const onPageHide = () => {
    flushPersistBuffer();
  };
  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      flushPersistBuffer();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

const statusSlice = createSlice({
  name: 'status',
  initialState: initialStatusState,
  reducers: {
    addStatusEntry: (
      state,
      action: PayloadAction<{ level: StatusLevel; message: string }>,
    ) => {
      const entry: StatusLogEntry = {
        id: String(nextId++),
        timestamp: Date.now(),
        level: action.payload.level,
        message: action.payload.message,
        sessionId: currentSessionId,
      };
      state.entries.push(entry);
      persistEntry(entry);

      // #183: when already at the cap, every push triggers an overflow
      // trim. The previous `slice(overflow)` allocated a brand new
      // array of `maxEntries` length per push — O(N) work per addition
      // during a high-volume operation. `splice` operates on the Immer
      // draft in place: O(overflow) which is 1 in the steady state.
      if (state.entries.length > state.maxEntries) {
        const overflow = state.entries.length - state.maxEntries;
        const removed = state.entries.splice(0, overflow);
        persistTrim(removed.map((e) => String(e.timestamp) + '-' + e.id));
      }
    },
    clearStatusLog: (state) => {
      state.entries = [];
      persistClear();
    },
    showOperationTip: (state, action: PayloadAction<string>) => {
      state.operationTip.isVisible = true;
      state.operationTip.message = action.payload;
    },
    hideOperationTip: (state) => {
      state.operationTip.isVisible = false;
    },
    showToast: (
      state,
      action: PayloadAction<{
        level: StatusLevel;
        message: string;
        duration?: number;
        action?: ToastAction;
      }>,
    ) => {
      state.toast.isVisible = true;
      state.toast.level = action.payload.level;
      state.toast.message = action.payload.message;
      state.toast.duration = action.payload.duration ?? 3000;
      state.toast.action = action.payload.action;
    },
    hideToast: (state) => {
      state.toast.isVisible = false;
      state.toast.action = undefined;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadStatusLog.fulfilled, (state, action) => {
      // Merge persisted history with anything synchronously dispatched
      // during boot (e.g. the "New session established" marker fired
      // from main.tsx before the IDB read resolves). Dedupe by the same
      // composite key the storage layer uses so a re-load doesn't
      // double-count rows that are already in memory.
      const keyOf = (e: StatusLogEntry) => `${e.timestamp}-${e.id}`;
      const existingKeys = new Set(state.entries.map(keyOf));
      const merged: StatusLogEntry[] = [
        ...action.payload.filter((e) => !existingKeys.has(keyOf(e))),
        ...state.entries,
      ].sort((a, b) => a.timestamp - b.timestamp);
      state.entries = merged.slice(-state.maxEntries);
    });
  },
});

export const {
  addStatusEntry,
  clearStatusLog,
  showOperationTip,
  hideOperationTip,
  showToast,
  hideToast,
} = statusSlice.actions;

// Selectors
export const selectStatusEntries = (state: RootState) => state.status.entries;
export const selectStatusCount = (state: RootState) => state.status.entries.length;
export const selectOperationTip = (state: RootState) => state.status.operationTip;
export const selectToast = (state: RootState) => state.status.toast;

export default statusSlice.reducer;
