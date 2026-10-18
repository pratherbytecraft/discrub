import type { Message } from 'discrub-core/types/discord-types';
import type { RootState } from '@/app/store';
import { messagesEdited, messagesRemoved, openContainerFor } from '@features/message/messageSlice';
import { editPatch, persistRowDeletes, persistRowPatches } from '@features/message/messagePersistence';

type Dispatch = (action: unknown) => unknown;
type GetState = () => RootState;

/**
 * A purge's deletions applied to the rows the person is looking at and to the
 * workspace (2.2.5). An open conversation drops the rows from Redux, and the
 * persistence listener writes the deletes to disk; a conversation the
 * workspace holds but does not show is written directly. Before this the
 * feed, the saved rows and the next export kept the deleted messages until a
 * Clear in the Workspaces popover.
 */
export function applyPurgeDeletions(getState: GetState, dispatch: Dispatch, cid: string, ids: string[]): void {
  if (ids.length === 0) return;
  const containerId = openContainerFor(getState(), cid);
  if (containerId !== undefined) {
    dispatch(messagesRemoved({ ids, containerId }));
  } else {
    void persistRowDeletes({ dispatch, getState }, cid, ids);
  }
}

/** The same for messages a purge edited (attachments stripped, content cleared). */
export function applyPurgeEdits(getState: GetState, dispatch: Dispatch, cid: string, messages: Message[]): void {
  if (messages.length === 0) return;
  const containerId = openContainerFor(getState(), cid);
  if (containerId !== undefined) {
    dispatch(messagesEdited({ messages, containerId }));
  } else {
    void persistRowPatches({ dispatch, getState }, cid, messages.map(editPatch));
  }
}
