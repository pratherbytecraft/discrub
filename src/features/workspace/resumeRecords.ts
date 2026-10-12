import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { getConversation, getWorkspace, updateConversation, updateWorkspace } from '@services/workspaceStore';
import type { ConversationAction, WorkspaceBulk } from './workspaceTypes';
import { actionRecorded, bulkRecorded, selectCurrentWid } from './workspaceSlice';

/**
 * Reading and dropping unfinished run records for the dialogs that resume
 * them (2.2.5 WP4b). Kept apart from workspaceThunks.ts so a dialog does
 * not load the persistence middleware.
 */

/** The open workspace's full bulk record, settings included, or null. */
export async function readBulkRecord(state: RootState): Promise<WorkspaceBulk | null> {
  const wid = selectCurrentWid(state);
  if (!wid) return null;
  try {
    return (await getWorkspace(wid))?.bulk ?? null;
  } catch {
    return null;
  }
}

/** A conversation's unfinished action with its settings, or null. */
export async function readConversationAction(state: RootState, cid: string): Promise<ConversationAction | null> {
  const wid = selectCurrentWid(state);
  if (!wid) return null;
  try {
    return (await getConversation(wid, cid))?.action ?? null;
  } catch {
    return null;
  }
}

/** Start over in a bulk dialog: the run is forgotten, nothing else changes. */
export const discardBulkRecord = createAsyncThunk<void, void, { state: RootState }>(
  'workspace/discardBulk',
  async (_, { dispatch, getState }) => {
    const wid = selectCurrentWid(getState());
    dispatch(bulkRecorded(null));
    if (!wid) return;
    try {
      await updateWorkspace(wid, (workspace) => {
        workspace.bulk = null;
      });
    } catch (error) {
      console.error('[workspace] could not drop the bulk run', error);
    }
  },
);

/** Start over in the Export dialog: the conversation's export record is forgotten. */
export const discardConversationAction = createAsyncThunk<void, { cid: string }, { state: RootState }>(
  'workspace/discardAction',
  async ({ cid }, { dispatch, getState }) => {
    const wid = selectCurrentWid(getState());
    dispatch(actionRecorded({ cid, action: null }));
    if (!wid) return;
    try {
      await updateConversation(wid, cid, (conversation) => {
        conversation.action = null;
      });
    } catch (error) {
      console.error('[workspace] could not drop the action', error);
    }
  },
);

/**
 * The channels, DMs or servers a resumed run works on, found by id in what
 * is loaded (channels, forum posts, DMs, servers). Ids that are gone (a
 * left server, a deleted channel) are skipped.
 */
export function resolveQueue<T extends { id: string }>(ids: string[], pools: Array<ReadonlyArray<T> | undefined>): T[] {
  const byId = new Map<string, T>();
  for (const pool of pools) for (const item of pool ?? []) byId.set(item.id, item);
  return ids.map((id) => byId.get(id)).filter((item): item is T => !!item);
}
