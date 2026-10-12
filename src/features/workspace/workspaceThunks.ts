import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Channel } from 'discrub-core/types/discord-types';
import type { RootState } from '@/app/store';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import { setDiscrubCancelled, setDiscrubPaused, setFeedScrollAnchor } from '@features/app/appSlice';
import { setSelectedChannel } from '@features/channel/channelSlice';
import { fetchDmById, setSelectedDm } from '@features/dm/dmSlice';
import { setSelectedGuild } from '@features/guild/guildSlice';
import { clearMessages, openThreadTab, setActiveTab } from '@features/message/messageSlice';
import { openChannel, openDm, openGuild } from '@features/navigation/openConversation';
import { isMessageChannel } from '@utils/channelTypeUtils';
import {
  acquireWorkspaceLock,
  getWorkspace,
  isWorkspaceOpenable,
  releaseWorkspaceLock,
  setLastWorkspace,
  touchWorkspace,
} from '@services/workspaceStore';
import {
  actionsOf,
  scopeRestoreFinished,
  selectCurrentWid,
  workspaceSwitchFailed,
  workspaceSwitchStarted,
  workspaceSwitched,
  type OpenedWorkspace,
} from './workspaceSlice';
import { flushPendingRecords, setSuspendingForSwitch } from './workspacePersistenceMiddleware';

/* ─────────────────── Switch ─────────────────── */

/** Longest a switch waits for a stopped run to let go. A page in flight finishes first. */
const SETTLE_TIMEOUT_MS = 60_000;

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

export type SwitchRefusal = 'same' | 'missing' | 'needsUpdate' | 'heldElsewhere' | 'busy';

/**
 * Opens another workspace (plan section 5.4). A running action is stopped
 * the normal way and keeps its record; the switch waits for the run to let
 * go so no late page is written into the new workspace. Then the old lock
 * is released, the screen is cleared and the new workspace's scope opens
 * through the same steps a click takes (`useWorkspaceScopeRestore`).
 *
 * The confirm when an action is running ("Load All is running") is the
 * caller's job; this thunk assumes the user chose Switch.
 */
export const switchWorkspace = createAsyncThunk<OpenedWorkspace, { wid: string }, { state: RootState; rejectValue: SwitchRefusal }>(
  'workspace/switch',
  async ({ wid }, { dispatch, getState, rejectWithValue }) => {
    const from = getState().workspace?.currentWid ?? null;
    if (from === wid) return rejectWithValue('same');
    if (getState().workspace?.switching) return rejectWithValue('busy');
    const record = await getWorkspace(wid);
    if (!record) return rejectWithValue('missing');
    if (!isWorkspaceOpenable(record)) return rejectWithValue('needsUpdate');
    if (!(await acquireWorkspaceLock(wid))) return rejectWithValue('heldElsewhere');

    dispatch(workspaceSwitchStarted({ wid }));
    try {
      return await finishSwitch(wid, from, record.name, actionsOf(record), dispatch, getState);
    } catch (error) {
      releaseWorkspaceLock(wid);
      dispatch(workspaceSwitchFailed({ wid, reason: error instanceof Error ? error.message : 'switch failed' }));
      throw error;
    }
  },
);

async function finishSwitch(
  wid: string,
  from: string | null,
  name: string,
  actions: OpenedWorkspace['actions'],
  dispatch: (action: unknown) => unknown,
  getState: () => RootState,
): Promise<OpenedWorkspace> {
  try {
    if (selectIsOperationRunning(getState())) {
      setSuspendingForSwitch(true);
      dispatch(setDiscrubPaused(false));
      dispatch(setDiscrubCancelled(true));
      const settled = await waitFor(() => !selectIsOperationRunning(getState()), SETTLE_TIMEOUT_MS);
      // A run that never let go would write its next page into the new
      // workspace, so the switch is refused instead.
      if (!settled) throw new Error('The running action did not stop');
      dispatch(setDiscrubCancelled(false));
    }
    await flushPendingRecords({ dispatch, getState });
  } finally {
    setSuspendingForSwitch(false);
  }

  if (from) releaseWorkspaceLock(from);
  dispatch(clearMessages());
  dispatch(setSelectedChannel(null));
  dispatch(setSelectedDm(null));
  dispatch(setSelectedGuild(null));
  dispatch(setFeedScrollAnchor(null));

  try {
    await touchWorkspace(wid);
    await setLastWorkspace(wid);
  } catch (error) {
    console.error('[workspace] could not mark the workspace as last opened', error);
  }
  const opened: OpenedWorkspace = { wid, name, actions };
  dispatch(workspaceSwitched(opened));
  return opened;
}

/* ─────────────────── Scope ─────────────────── */

/** Longest the restore waits for the server list after boot. */
const GUILDS_TIMEOUT_MS = 15_000;

export type ScopeOutcome = 'restored' | 'empty' | 'skipped' | 'missing';

/**
 * Opens the saved scope of the open workspace (plan sections 5.4 and 5.5):
 * the server and channel, or the DM, then the thread tabs and the active
 * tab, then the scroll anchor. A conversation with rows comes back from
 * disk through the normal open (fetchMessages restores instead of
 * fetching). Nothing happens when the user already picked something, or
 * when the saved server or channel is gone.
 */
export const restoreWorkspaceScope = createAsyncThunk<ScopeOutcome, void, { state: RootState }>(
  'workspace/restoreScope',
  async (_, { dispatch, getState }) => {
    const wid = selectCurrentWid(getState());
    if (!wid) return 'skipped';
    try {
      const outcome = await openScope(wid, dispatch, getState);
      return outcome;
    } finally {
      dispatch(scopeRestoreFinished());
    }
  },
  {
    // Once per workspace; checked synchronously so two renders cannot both start it.
    condition: (_, { getState }) => {
      const ws = getState().workspace;
      return !!ws && ws.ready && ws.scopeRestoredWid !== ws.currentWid;
    },
  },
);

type Dispatch = (action: unknown) => unknown;

const userNavigated = (state: RootState) =>
  !!(state.guild?.selectedGuild || state.channel?.selectedChannel || state.dm?.selectedDm);

async function openScope(wid: string, dispatchAny: Dispatch, getState: () => RootState): Promise<ScopeOutcome> {
  // Thunk dispatches return promises; the loose type keeps this helper simple.
  const dispatch = dispatchAny as (action: unknown) => Promise<unknown> & { unwrap?: () => Promise<unknown> };
  const start = getState();
  const token = start.auth?.token;
  if (!token || start.auth?.guestMode) return 'skipped';
  if (userNavigated(start)) return 'skipped';
  const record = await getWorkspace(wid);
  if (!record) return 'missing';
  const { guildId, channelId, dmId } = record.scope;
  if (!guildId && !dmId) return 'empty';
  const stillHere = () => selectCurrentWid(getState()) === wid;

  let cid: string | null = null;
  if (guildId) {
    await waitFor(() => (getState().guild?.guilds?.length ?? 0) > 0 || !!getState().guild?.error, GUILDS_TIMEOUT_MS);
    if (!stillHere() || userNavigated(getState())) return 'skipped';
    const guild = getState().guild.guilds.find((g) => g.id === guildId);
    if (!guild) return 'missing';
    await dispatch(openGuild({ guild }));
    if (!stillHere() || getState().guild.selectedGuild?.id !== guildId) return 'skipped';
    if (!channelId) return 'restored';
    const channel = getState().channel.channels.find((c) => c.id === channelId);
    if (!channel || !isMessageChannel(channel)) return 'missing';
    await dispatch(openChannel({ channel }));
    cid = channelId;
  } else if (dmId) {
    let dm: Channel | undefined = getState().dm?.dms?.find((d) => d.id === dmId);
    if (!dm) {
      try {
        dm = (await (dispatch(fetchDmById({ channelId: dmId, token })) as unknown as { unwrap: () => Promise<Channel> }).unwrap());
      } catch {
        return 'missing';
      }
    }
    if (!stillHere() || userNavigated(getState())) return 'skipped';
    await dispatch(openDm({ dm }));
    cid = dmId;
  }
  if (!cid || !stillHere()) return 'restored';

  // Thread tabs, in the order they were opened, then the active one.
  const conversation = record.conversations[cid];
  if (conversation) {
    for (const threadId of conversation.threadTabs) {
      if (!stillHere() || selectMainCid(getState()) !== cid) return 'skipped';
      const thread = record.conversations[threadId];
      await dispatch(openThreadTab({ threadId, threadName: thread?.name ?? threadId, token }));
    }
    const tabs = getState().message.threadTabs;
    const activeTab = conversation.activeTab && tabs[conversation.activeTab] ? conversation.activeTab : null;
    dispatch(setActiveTab(activeTab));
    const anchorId = activeTab ? record.conversations[activeTab]?.scrollAnchorId : conversation.scrollAnchorId;
    if (anchorId) dispatch(setFeedScrollAnchor({ key: `${cid}:${activeTab ?? 'main'}`, messageId: anchorId }));
  }
  return 'restored';
}

const selectMainCid = (state: RootState): string | null =>
  state.channel?.selectedChannel?.id ?? state.dm?.selectedDm?.id ?? null;
