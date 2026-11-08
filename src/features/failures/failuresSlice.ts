import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { storage } from '@/extension/storage';
import { downloadFailures, type DeleteFailure, type DeleteFailureSource } from './deleteFailures';

/**
 * 2.2.9 (GitHub issue 23): the messages the last Purge and the last package
 * delete could not delete. One list per kind of run, replaced when the next
 * run of that kind starts, kept in Discrub-state per user so Save failed list
 * still works after a reload.
 */
export interface FailuresState {
  purge: DeleteFailure[];
  package: DeleteFailure[];
  /** The user id the lists were read from storage for; null until read. */
  loadedFor: string | null;
}

export const initialFailuresState: FailuresState = { purge: [], package: [], loadedFor: null };

const storageKey = (userId: string) => `deleteFailures:${userId}`;

type StoredFailures = { purge?: DeleteFailure[]; package?: DeleteFailure[] };

/** Read the saved lists for the signed in user, once per user. A run already under way keeps its own list. */
export const loadFailures = createAsyncThunk<
  { userId: string; stored: StoredFailures } | null,
  void,
  { state: RootState }
>('failures/load', async (_, { getState }) => {
  const userId = getState().user.currentUser?.id;
  if (!userId || getState().failures?.loadedFor === userId) return null;
  try {
    return { userId, stored: (await storage.state.get<StoredFailures>(storageKey(userId))) ?? {} };
  } catch {
    return { userId, stored: {} };
  }
});

/**
 * Called when a run ends, however it ended. Writes both lists for the user.
 * The Purge completion toast (MainLayout) and the package finished note read
 * the list from the store and offer Save failed list.
 */
export const finishFailureRun = createAsyncThunk<void, DeleteFailureSource, { state: RootState }>(
  'failures/finishRun',
  async (_source, { getState }) => {
    const state = getState();
    const userId = state.user.currentUser?.id;
    // A store built without this slice (some tests) has nothing to keep.
    if (!state.failures) return;
    const { purge, package: pkg } = state.failures;
    if (userId) {
      try {
        await storage.state.set<StoredFailures>(storageKey(userId), { purge, package: pkg });
      } catch {
        // The list stays in memory for this session.
      }
    }
  },
);

/** Save one run's list as a file: CSV when that is the export format, JSON otherwise. */
export const saveFailedList = createAsyncThunk<void, DeleteFailureSource, { state: RootState }>(
  'failures/save',
  async (source, { getState }) => {
    const state = getState();
    const failures = state.failures?.[source] ?? [];
    if (failures.length === 0) return;
    downloadFailures(failures, state.export.exportFormat === 'csv' ? 'csv' : 'json', __APP_VERSION__);
  },
);

const failuresSlice = createSlice({
  name: 'failures',
  initialState: initialFailuresState,
  reducers: {
    /** A new run starts with an empty list of its kind. */
    failureRunStarted: (state, action: PayloadAction<DeleteFailureSource>) => {
      state[action.payload] = [];
    },
    failureNoted: (state, action: PayloadAction<{ source: DeleteFailureSource; failure: DeleteFailure }>) => {
      state[action.payload.source].push(action.payload.failure);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadFailures.fulfilled, (state, action) => {
      if (!action.payload) return;
      const { userId, stored } = action.payload;
      if (state.purge.length === 0 && Array.isArray(stored.purge)) state.purge = stored.purge;
      if (state.package.length === 0 && Array.isArray(stored.package)) state.package = stored.package;
      state.loadedFor = userId;
    });
  },
});

export const { failureRunStarted, failureNoted } = failuresSlice.actions;

const NONE: DeleteFailure[] = [];
export const selectFailures = (source: DeleteFailureSource) => (state: RootState): DeleteFailure[] => state.failures?.[source] ?? NONE;
export const selectFailureCount = (source: DeleteFailureSource) => (state: RootState): number => state.failures?.[source]?.length ?? 0;

export default failuresSlice.reducer;
