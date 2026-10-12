import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import {
  acquireWorkspaceLock,
  ensureDefaultWorkspace,
  getMeta,
  getWorkspace,
  isWorkspaceOpenable,
  setLastWorkspace,
  touchWorkspace,
} from '@services/workspaceStore';
import { DEFAULT_WORKSPACE_ID } from './workspaceTypes';

/**
 * Which workspace is open (2.2.5 WP2a). This is the smallest slice that
 * lets the message thunks write pages to the store: WP4 grows it with
 * switching, scope restore and the unfinished work records.
 */
export interface WorkspaceState {
  /** The open workspace, null until boot finished. */
  currentWid: string | null;
  /** True once Default exists and the last workspace is open. Writes wait for it. */
  ready: boolean;
  /** True while boot is in flight; only then does a fetch wait for the open. */
  booting: boolean;
  error: string | null;
}

export const initialWorkspaceState: WorkspaceState = {
  currentWid: null,
  ready: false,
  booting: false,
  error: null,
};

/**
 * Boot: make sure Default exists, open the workspace that was open last
 * (Default when that one is gone or written by a newer schema), take its
 * lock and remember it as last. A second window holding the lock does not
 * block this release; WP4 dims the row instead.
 */
export const initializeWorkspaces = createAsyncThunk<string, void, { rejectValue: string }>(
  'workspace/initialize',
  async (_, { rejectWithValue }) => {
    try {
      await ensureDefaultWorkspace();
      const meta = await getMeta();
      let wid = meta.lastWid ?? DEFAULT_WORKSPACE_ID;
      if (wid !== DEFAULT_WORKSPACE_ID) {
        const record = await getWorkspace(wid);
        if (!record || !isWorkspaceOpenable(record)) wid = DEFAULT_WORKSPACE_ID;
      }
      await acquireWorkspaceLock(wid);
      await touchWorkspace(wid);
      if (meta.lastWid !== wid) await setLastWorkspace(wid);
      return wid;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Could not open workspaces');
    }
  },
);

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState: initialWorkspaceState,
  reducers: {
    /** Tests and WP4 switching set the open workspace directly. */
    setCurrentWorkspace: (state, action: PayloadAction<string | null>) => {
      state.currentWid = action.payload;
      state.ready = action.payload !== null;
      state.booting = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeWorkspaces.pending, (state) => {
        state.booting = true;
      })
      .addCase(initializeWorkspaces.fulfilled, (state, action) => {
        state.currentWid = action.payload;
        state.ready = true;
        state.booting = false;
        state.error = null;
      })
      .addCase(initializeWorkspaces.rejected, (state, action) => {
        state.currentWid = null;
        state.ready = false;
        state.booting = false;
        state.error = action.payload ?? 'Could not open workspaces';
      });
  },
});

export const { setCurrentWorkspace } = workspaceSlice.actions;

/** The open workspace id, or null while workspaces are not ready (writes are skipped). */
export const selectCurrentWid = (state: RootState): string | null => {
  const ws = state.workspace;
  return ws && ws.ready ? ws.currentWid : null;
};
export const selectWorkspaceReady = (state: RootState): boolean => state.workspace?.ready ?? false;
export const selectWorkspaceError = (state: RootState): string | null => state.workspace?.error ?? null;

/**
 * Resolves once boot has opened a workspace, or straight away when the
 * slice is absent, boot never started (component tests), already ready,
 * or failed. Bounded, so a boot that never finishes cannot hang a fetch.
 */
export async function waitForWorkspaces(getState: () => RootState, timeoutMs = 3000): Promise<void> {
  const settled = () => {
    const ws = getState().workspace;
    return !ws || !ws.booting;
  };
  if (settled()) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (settled()) return;
  }
}

export default workspaceSlice.reducer;
