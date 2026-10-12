import { createAction, createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { addStatusEntry, showToast } from '@features/status/statusSlice';
import { takeSkipScopeRestore } from './scopeRestoreFlag';
import { t } from '@/i18n';
import {
  acquireWorkspaceLock,
  dropStagedWorkspaces,
  ensureDefaultWorkspace,
  getMeta,
  getWorkspace,
  isWorkspaceHeldElsewhere,
  isWorkspaceOpenable,
  listWorkspaces,
  readStorageEstimate,
  setLastWorkspace,
  touchWorkspace,
  type StorageFigures,
} from '@services/workspaceStore';
import { summarizeWorkspace, type WorkspaceSummary } from './workspaceSummary';
import { type ActionKind, type BulkKind, type BulkMode, type WorkspaceRecord } from './workspaceTypes';

/** An unfinished long action recorded in a conversation of the open workspace (plan section 6). */
export interface UnfinishedAction {
  cid: string;
  name: string;
  kind: ActionKind;
}

/** The workspace's unfinished bulk run, without its settings (those stay on disk). */
export interface UnfinishedBulk {
  kind: BulkKind;
  mode: BulkMode;
  guildId: string | null;
  total: number;
  doneCount: number;
  remaining: number;
  /** Row 134: the run stopped on a 401; the dialog offers Sign in again beside Resume. */
  signInExpired?: boolean;
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
  /** The undeletable Default's id, known once boot ran. */
  defaultWid: string | null;
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
  /** The user left the server view (the DMs tab) before the saved scope opened; the restore stops. */
  scopeInterrupted: boolean;
  /** Unfinished actions in the open workspace, by conversation id. */
  actions: Record<string, UnfinishedAction>;
  /** The open workspace's unfinished bulk run (WP4b). */
  bulk: UnfinishedBulk | null;
  /** Every workspace with its figures, for the popover, the pill and the disk bar (WP5). */
  list: WorkspaceSummary[];
  /** The browser's own usage and quota, null where `estimate()` is missing. */
  storage: StorageFigures | null;
  /** The Workspaces popover over the disk bar, opened from anywhere (the storage full hold, WP6a). */
  popoverOpen: boolean;
  /** Row 9: the import under way, for the popover's progress line; null when none runs. */
  importing: WorkspaceImportProgress | null;
}

export interface WorkspaceImportProgress {
  name: string;
  messages: number;
  total: number;
}

export const initialWorkspaceState: WorkspaceState = {
  currentWid: null,
  defaultWid: null,
  currentName: null,
  ready: false,
  booting: false,
  error: null,
  heldElsewhere: null,
  switching: false,
  scopeRestoredWid: null,
  restoringScope: false,
  scopeInterrupted: false,
  actions: {},
  bulk: null,
  list: [],
  storage: null,
  popoverOpen: false,
  importing: null,
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

/** The light view of a record's bulk run. */
export function bulkOf(record: WorkspaceRecord | null | undefined): UnfinishedBulk | null {
  const bulk = record?.bulk;
  if (!bulk) return null;
  return {
    kind: bulk.kind,
    mode: bulk.mode ?? 'channels',
    guildId: bulk.guildId,
    total: bulk.total ?? bulk.queue.length,
    doneCount: bulk.doneCount ?? bulk.done.length,
    signInExpired: bulk.signInExpired === true,
    remaining: bulk.queue.filter((id) => !bulk.done.includes(id)).length,
  };
}

export interface OpenedWorkspace {
  wid: string;
  name: string;
  actions: Record<string, UnfinishedAction>;
  bulk?: UnfinishedBulk | null;
}

export interface BootResult {
  opened: OpenedWorkspace | null;
  defaultWid: string;
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
      const defaultRecord = await ensureDefaultWorkspace();
      const defaultWid = defaultRecord.wid;
      // Row 120: an import cut by a closed tab left a staged record; it goes with its rows.
      if (await dropStagedWorkspaces()) dispatch(addStatusEntry({ level: 'info', message: t('workspace.importDropped') }));
      const skipScope = await takeSkipScopeRestore();
      if (skipScope) dispatch(addStatusEntry({ level: 'info', message: t('workspace.scopeSkipped') }));
      const meta = await getMeta();
      let wid = meta.lastWid ?? defaultWid;
      let record = await getWorkspace(wid);
      if (!record || !isWorkspaceOpenable(record)) {
        wid = defaultWid;
        record = defaultRecord;
      }
      if (!(await acquireWorkspaceLock(wid))) {
        dispatch(addStatusEntry({ level: 'warning', message: t('workspace.heldElsewhere') }));
        return { opened: null, defaultWid, heldElsewhere: wid };
      }
      await touchWorkspace(wid);
      if (meta.lastWid !== wid) await setLastWorkspace(wid);
      const name = record?.name ?? wid;
      if (wid !== defaultWid) {
        dispatch(showToast({ level: 'info', message: t('workspace.openedToast', { name }) }));
      }
      return { opened: { wid, name, actions: actionsOf(record), bulk: bulkOf(record) }, defaultWid, heldElsewhere: null };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Could not open workspaces');
    }
  },
);

export interface WorkspaceListResult {
  list: WorkspaceSummary[];
  storage: StorageFigures | null;
}

/**
 * Reads every workspace record and the browser's estimate (WP5). Rows held
 * by another window are asked about one by one through the Web Lock.
 */
export const refreshWorkspaces = createAsyncThunk<WorkspaceListResult, void, { state: RootState }>(
  'workspace/refresh',
  async (_, { getState }) => {
    const [records, storage, meta] = await Promise.all([listWorkspaces(), readStorageEstimate(), getMeta()]);
    const current = getState().workspace?.currentWid ?? null;
    const held = await Promise.all(records.map((r) => (r.wid === current ? Promise.resolve(false) : isWorkspaceHeldElsewhere(r.wid))));
    const guilds = Object.fromEntries((getState().guild?.guilds ?? []).map((g) => [g.id, g.name]));
    return { list: records.map((r, i) => summarizeWorkspace(r, { heldElsewhere: held[i], guilds, isDefault: r.wid === meta.defaultWid })), storage };
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
    /** Mirrors the workspace's bulk record; null clears it. */
    bulkRecorded: (state, action: PayloadAction<UnfinishedBulk | null>) => {
      state.bulk = action.payload;
    },
    /** The open workspace was renamed from the popover. */
    currentWorkspaceRenamed: (state, action: PayloadAction<string>) => {
      state.currentName = action.payload;
    },
    /** Opens or closes the Workspaces popover the disk bar hosts. */
    workspacesPopoverToggled: (state, action: PayloadAction<boolean>) => {
      state.popoverOpen = action.payload;
    },
    importProgressed: (state, action: PayloadAction<WorkspaceImportProgress | null>) => {
      state.importing = action.payload;
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
        const { opened, defaultWid, heldElsewhere } = action.payload;
        state.booting = false;
        state.error = null;
        state.defaultWid = defaultWid;
        state.heldElsewhere = heldElsewhere;
        state.currentWid = opened?.wid ?? null;
        state.currentName = opened?.name ?? null;
        state.ready = opened !== null;
        state.actions = opened?.actions ?? {};
        state.bulk = opened?.bulk ?? null;
      })
      .addCase(initializeWorkspaces.rejected, (state, action) => {
        state.currentWid = null;
        state.ready = false;
        state.booting = false;
        state.error = action.payload ?? 'Could not open workspaces';
      })
      .addCase(refreshWorkspaces.fulfilled, (state, action) => {
        state.list = action.payload.list;
        state.storage = action.payload.storage;
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
        state.bulk = action.payload.bulk ?? null;
        state.scopeRestoredWid = null;
        state.restoringScope = false;
        state.scopeInterrupted = false;
      })
      .addCase(workspaceSwitchFailed, (state) => {
        state.switching = false;
      })
      // restoreWorkspaceScope lives in workspaceThunks.ts (it reaches into
      // other slices); its pending marks the restore in the same tick, so
      // a second render cannot start it again.
      // Clearing the server is always the user (the DMs tab, a back arrow);
      // the restore's own steps never do it. Before the saved scope has
      // opened, that means the user went elsewhere and the restore stops.
      .addMatcher(
        (action): action is { type: string; payload: unknown } => action.type === 'guild/setSelectedGuild' && (action as { payload?: unknown }).payload === null,
        (state) => {
          if (state.restoringScope || (state.currentWid !== null && state.scopeRestoredWid !== state.currentWid)) state.scopeInterrupted = true;
        },
      )
      .addMatcher(
        (action): action is { type: string } => action.type === RESTORE_SCOPE_PENDING,
        (state) => {
          state.scopeRestoredWid = state.currentWid;
          state.restoringScope = true;
        },
      );
  },
});

export const { setCurrentWorkspace, scopeRestoreFinished, actionRecorded, bulkRecorded, currentWorkspaceRenamed, workspacesPopoverToggled, importProgressed } = workspaceSlice.actions;
/** Row 9: the import under way, or null. */
export const selectWorkspaceImporting = (state: RootState): WorkspaceImportProgress | null => state.workspace?.importing ?? null;

/** The open workspace id, or null while workspaces are not ready (writes are skipped). */
export const selectDefaultWid = (state: RootState): string | null => state.workspace?.defaultWid ?? null;
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
export const selectUnfinishedBulk = (state: RootState): UnfinishedBulk | null => state.workspace?.bulk ?? null;
/** True when the open workspace has unfinished work. */
export const selectHasUnfinishedWork = (state: RootState): boolean =>
  Object.keys(selectUnfinishedActions(state)).length > 0 || selectUnfinishedBulk(state) !== null;
const noList: WorkspaceSummary[] = [];
export const selectWorkspaceList = (state: RootState): WorkspaceSummary[] => state.workspace?.list ?? noList;
export const selectWorkspacesPopoverOpen = (state: RootState): boolean => state.workspace?.popoverOpen ?? false;
export const selectStorageFigures = (state: RootState): StorageFigures | null => state.workspace?.storage ?? null;
/** The pill's dot: true when any workspace has unfinished work (plan 5.1). */
export const selectAnyUnfinishedWork = (state: RootState): boolean =>
  selectHasUnfinishedWork(state) || selectWorkspaceList(state).some((w) => w.work !== null);
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
