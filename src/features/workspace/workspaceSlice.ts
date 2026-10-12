import { createAction, createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { addStatusEntry, showToast } from '@features/status/statusSlice';
import { t } from '@/i18n';
import {
  acquireWorkspaceLock,
  ensureDefaultWorkspace,
  getMeta,
  getWorkspace,
  isWorkspaceOpenable,
  setLastWorkspace,
  touchWorkspace,
} from '@services/workspaceStore';
import { DEFAULT_WORKSPACE_ID, type ActionKind, type WorkspaceRecord } from './workspaceTypes';

/** An unfinished long action recorded in a conversation of the open workspace (plan section 6). */
export interface UnfinishedAction {
  cid: string;
  name: string;
  kind: ActionKind;
}

/**
 * Which workspace is open (2.2.5 WP2a, grown in WP4a with switching, the
 * lock refused state, scope restore and the unfinished work records).
 * The thunks that touch other slices live in workspaceThunks.ts so this
 * module stays free of import cycles.
 */
export interface WorkspaceState {
  /** The open workspace, null until boot finished. */
  currentWid: string | null;
  currentName: string | null;
  /** True once Default exists and the last workspace is open. Writes wait for it. */
  ready: boolean;
  /** True while boot is in flight; only then does a fetch wait for the open. */
  booting: boolean;
  error: string | null;
  /** The workspace boot wanted but another window holds. Nothing is written while set. */
  heldElsewhere: string | null;
  /** True while a switch runs; scope writes stay off so the old workspace keeps its scope. */
  switching: boolean;
  /** The workspace whose saved scope was restored (or is being restored). */
  scopeRestoredWid: string | null;
  /** True while the saved scope is being opened; navigation is not written meanwhile. */
  restoringScope: boolean;
  /** Unfinished actions in the open workspace, by conversation id. */
  actions: Record<string, UnfinishedAction>;
}

export const initialWorkspaceState: WorkspaceState = {
  currentWid: null,
  currentName: null,
  ready: false,
  booting: false,
  error: null,
  heldElsewhere: null,
  switching: false,
  scopeRestoredWid: null,
  restoringScope: false,
  actions: {},
};

/** The unfinished actions a workspace record carries. */
export function actionsOf(record: WorkspaceRecord | null | undefined): Record<string, UnfinishedAction> {
  const actions: Record<string, UnfinishedAction> = {};
  if (!record) return actions;
  for (const conversation of Object.values(record.conversations)) {
    if (conversation.action) {
      actions[conversation.cid] = { cid: conversation.cid, name: conversation.name, kind: conversation.action.kind };
    }
  }
  return actions;
}

export interface OpenedWorkspace {
  wid: string;
  name: string;
  actions: Record<string, UnfinishedAction>;
}

export interface BootResult {
  opened: OpenedWorkspace | null;
  /** Set when the last workspace is open in another window. */
  heldElsewhere: string | null;
}

/**
 * Boot: make sure Default exists, open the workspace that was open last
 * (Default when that one is gone or written by a newer schema), take its
 * lock and remember it as last. When another window holds the lock this
 * window opens nothing and writes nothing; the Workspaces popover (WP5)
 * shows that row dimmed. A toast names the workspace unless it is
 * Default, which every account opens on every launch.
 */
export const initializeWorkspaces = createAsyncThunk<BootResult, void, { rejectValue: string }>(
  'workspace/initialize',
  async (_, { dispatch, rejectWithValue }) => {
    try {
      await ensureDefaultWorkspace();
      const meta = await getMeta();
      let wid = meta.lastWid ?? DEFAULT_WORKSPACE_ID;
      let record = await getWorkspace(wid);
      if (!record || !isWorkspaceOpenable(record)) {
        wid = DEFAULT_WORKSPACE_ID;
        record = await getWorkspace(wid);
      }
      if (!(await acquireWorkspaceLock(wid))) {
        dispatch(addStatusEntry({ level: 'warning', message: t('workspace.heldElsewhere') }));
        return { opened: null, heldElsewhere: wid };
      }
      await touchWorkspace(wid);
      if (meta.lastWid !== wid) await setLastWorkspace(wid);
      const name = record?.name ?? wid;
      if (wid !== DEFAULT_WORKSPACE_ID) {
        dispatch(showToast({ level: 'info', message: t('workspace.openedToast', { name }) }));
      }
      return { opened: { wid, name, actions: actionsOf(record) }, heldElsewhere: null };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Could not open workspaces');
    }
  },
);

/* Switch lifecycle, dispatched by `switchWorkspace` in workspaceThunks.ts. */
export const workspaceSwitchStarted = createAction<{ wid: string }>('workspace/switchStarted');
export const workspaceSwitched = createAction<OpenedWorkspace>('workspace/switched');
export const workspaceSwitchFailed = createAction<{ wid: string; reason: string }>('workspace/switchFailed');

/** The type of restoreWorkspaceScope's pending action. */
export const RESTORE_SCOPE_PENDING = 'workspace/restoreScope/pending';

/** The feed's first visible message settled; the record takes it after 2 s. */
export const feedAnchorMoved = createAction<{ containerId: string | null; messageId: string }>('workspace/feedAnchorMoved');

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState: initialWorkspaceState,
  reducers: {
    /** Tests set the open workspace directly. */
    setCurrentWorkspace: (state, action: PayloadAction<string | null>) => {
      state.currentWid = action.payload;
      state.ready = action.payload !== null;
      state.booting = false;
    },
    scopeRestoreFinished: (state) => {
      state.restoringScope = false;
    },
    /** Mirrors a conversation's action record; null clears it. */
    actionRecorded: (state, action: PayloadAction<{ cid: string; action: UnfinishedAction | null }>) => {
      if (action.payload.action) state.actions[action.payload.cid] = action.payload.action;
      else delete state.actions[action.payload.cid];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeWorkspaces.pending, (state) => {
        state.booting = true;
      })
      .addCase(initializeWorkspaces.fulfilled, (state, action) => {
        const { opened, heldElsewhere } = action.payload;
        state.booting = false;
        state.error = null;
        state.heldElsewhere = heldElsewhere;
        state.currentWid = opened?.wid ?? null;
        state.currentName = opened?.name ?? null;
        state.ready = opened !== null;
        state.actions = opened?.actions ?? {};
      })
      .addCase(initializeWorkspaces.rejected, (state, action) => {
        state.currentWid = null;
        state.ready = false;
        state.booting = false;
        state.error = action.payload ?? 'Could not open workspaces';
      })
      .addCase(workspaceSwitchStarted, (state) => {
        state.switching = true;
      })
      .addCase(workspaceSwitched, (state, action) => {
        state.switching = false;
        state.currentWid = action.payload.wid;
        state.currentName = action.payload.name;
        state.ready = true;
        state.heldElsewhere = null;
        state.actions = action.payload.actions;
        state.scopeRestoredWid = null;
        state.restoringScope = false;
      })
      .addCase(workspaceSwitchFailed, (state) => {
        state.switching = false;
      })
      // restoreWorkspaceScope lives in workspaceThunks.ts (it reaches into
      // other slices); its pending marks the restore in the same tick, so
      // a second render cannot start it again.
      .addMatcher(
        (action): action is { type: string } => action.type === RESTORE_SCOPE_PENDING,
        (state) => {
          state.scopeRestoredWid = state.currentWid;
          state.restoringScope = true;
        },
      );
  },
});

export const { setCurrentWorkspace, scopeRestoreFinished, actionRecorded } = workspaceSlice.actions;

/** The open workspace id, or null while workspaces are not ready (writes are skipped). */
export const selectCurrentWid = (state: RootState): string | null => {
  const ws = state.workspace;
  return ws && ws.ready ? ws.currentWid : null;
};
export const selectWorkspaceReady = (state: RootState): boolean => state.workspace?.ready ?? false;
export const selectWorkspaceError = (state: RootState): string | null => state.workspace?.error ?? null;
export const selectCurrentWorkspaceName = (state: RootState): string | null => state.workspace?.currentName ?? null;
export const selectWorkspaceHeldElsewhere = (state: RootState): string | null => state.workspace?.heldElsewhere ?? null;
export const selectWorkspaceSwitching = (state: RootState): boolean => state.workspace?.switching ?? false;
export const selectScopeRestoredWid = (state: RootState): string | null => state.workspace?.scopeRestoredWid ?? null;
const noActions: Record<string, UnfinishedAction> = {};
export const selectUnfinishedActions = (state: RootState): Record<string, UnfinishedAction> => state.workspace?.actions ?? noActions;
/** The pill's dot: true when the open workspace has unfinished work. */
export const selectHasUnfinishedWork = (state: RootState): boolean => Object.keys(selectUnfinishedActions(state)).length > 0;
/** The unfinished action recorded for a conversation, if any. */
export const selectConversationAction = (cid: string | null | undefined) => (state: RootState): UnfinishedAction | null =>
  cid ? selectUnfinishedActions(state)[cid] ?? null : null;

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
