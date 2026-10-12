import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import type { Message } from 'discrub-core/types/discord-types';
import type { RootState } from '@/app/store';
import type { Conversation } from './workspaceTypes';
import {
  batchAddReactions,
  batchRemoveReactions,
  bulkDeleteAllReactions,
  bulkDeleteReactionsForEmoji,
  clearRefineCriteria,
  clearThreadRefineCriteria,
  deleteAllAttachments,
  deleteAllReactions,
  deleteAttachment,
  deleteMessage,
  deleteReaction,
  deselectAllMessages,
  deselectAllThreadMessages,
  editMessage,
  messagesEdited,
  messagesRemoved,
  removeThreadTab,
  selectAllMessages,
  selectAllThreadMessages,
  setOrder,
  setRefineCriteria,
  setSearchCriteria,
  setSelectedMessages,
  setThreadOrder,
  setThreadRefineCriteria,
  setThreadSearchCriteria,
  setThreadSelectedMessages,
  toggleMessageSelection,
  toggleThreadMessageSelection,
} from '@features/message/messageSlice';
import {
  conversationSeedFromState,
  forgetConversation,
  persistConversation,
  persistRowDeletes,
  persistRowPatches,
  persistThreadTabs,
  threadSeedFromState,
  type PersistApi,
} from '@features/message/messagePersistence';
import type { RowPatch } from '@services/workspaceStore';

/**
 * Keeps the workspace store in step with what the reducers did to the
 * arrays (2.2.5 WP2a, plan section 7). Page writes stay in the thunks,
 * because a page must be on disk before it reaches Redux and a quota
 * failure pauses the walk there. Everything after the fact, deletes,
 * edits, reaction changes, criteria, sort and selection, is mirrored
 * here from the state the reducer just produced, so no reducer has to
 * know about the store.
 */
export const workspacePersistenceMiddleware = createListenerMiddleware();

const listen = workspacePersistenceMiddleware.startListening.withTypes<RootState>();

/** Debounce for record rewrites, the plan's 500 ms. */
export const RECORD_DEBOUNCE_MS = 500;

const mainCid = (state: RootState): string | null =>
  state.channel?.selectedChannel?.id ?? state.dm?.selectedDm?.id ?? null;

const containerFor = (state: RootState, containerId: string | null) =>
  containerId === null ? state.message : state.message.threadTabs?.[containerId] ?? null;

const activeContainerId = (state: RootState): string | null => {
  const { activeTab, threadTabs } = state.message;
  return activeTab && threadTabs?.[activeTab] ? activeTab : null;
};

const cidFor = (state: RootState, containerId: string | null): string | null =>
  containerId === null ? mainCid(state) : containerId;

/** The fields an edit can change. Reactions and reply parents stay as enriched. */
const EDIT_FIELDS: Array<keyof Message> = ['content', 'edited_timestamp', 'attachments', 'embeds', 'mentions', 'flags', 'components', 'pinned'];

export function editPatch(message: Message): RowPatch {
  const patch: Partial<Message> = {};
  for (const field of EDIT_FIELDS) {
    if (message[field] !== undefined) (patch as Record<string, unknown>)[field] = message[field];
  }
  return { id: message.id, patch };
}

const reactionPatches = (state: RootState, containerId: string | null, ids: Iterable<string>): RowPatch[] => {
  const container = containerFor(state, containerId);
  if (!container) return [];
  const wanted = new Set(ids);
  const patches: RowPatch[] = [];
  for (const message of container.messages) {
    if (!wanted.has(message.id)) continue;
    patches.push({ id: message.id, patch: { reactions: message.reactions ?? [] } });
    if (patches.length === wanted.size) break;
  }
  return patches;
};

/* ─────────────────── Debounced record rewrites ─────────────────── */

type RecordJob = { timer: ReturnType<typeof setTimeout>; fields: Set<'criteria' | 'selection'>; containerId: string | null };
const pending = new Map<string, RecordJob>();

function recordFromState(state: RootState, containerId: string | null, fields: Set<'criteria' | 'selection'>): Partial<Conversation> | null {
  const container = containerFor(state, containerId);
  if (!container) return null;
  const record: Partial<Conversation> = {};
  if (fields.has('criteria')) {
    record.searchCriteria = container.searchCriteria;
    record.refineCriteria = container.refineCriteria;
    record.order = container.order;
  }
  if (fields.has('selection')) {
    record.selectedIds = container.selectedMessages.map((m) => m.id);
  }
  return record;
}

function scheduleRecord(api: PersistApi, containerId: string | null, field: 'criteria' | 'selection'): void {
  const state = api.getState();
  const cid = cidFor(state, containerId);
  if (!cid) return;
  const existing = pending.get(cid);
  if (existing) {
    existing.fields.add(field);
    clearTimeout(existing.timer);
  }
  const fields = existing?.fields ?? new Set<'criteria' | 'selection'>([field]);
  const timer = setTimeout(() => {
    pending.delete(cid);
    void flushRecord(api, cid, containerId, fields);
  }, RECORD_DEBOUNCE_MS);
  pending.set(cid, { timer, fields, containerId });
}

async function flushRecord(api: PersistApi, cid: string, containerId: string | null, fields: Set<'criteria' | 'selection'>): Promise<void> {
  const state = api.getState();
  const record = recordFromState(state, containerId, fields);
  if (!record) return;
  // A filter, refine or sort writes the record (plan section 4.2); a
  // selection alone only updates a record that already exists.
  const seed = fields.has('criteria')
    ? containerId === null ? conversationSeedFromState(state, cid) : threadSeedFromState(state, cid)
    : null;
  await persistConversation(api, cid, record, seed);
}

/** Tests and unload: write every pending record now. */
export async function flushPendingRecords(api: PersistApi): Promise<void> {
  const jobs = [...pending.entries()];
  pending.clear();
  for (const [cid, job] of jobs) {
    clearTimeout(job.timer);
    await flushRecord(api, cid, job.containerId, job.fields);
  }
}

/* ─────────────────── Listeners ─────────────────── */

const api = (listenerApi: { dispatch: (a: unknown) => unknown; getState: () => RootState }): PersistApi => ({
  dispatch: listenerApi.dispatch,
  getState: listenerApi.getState,
});

listen({
  actionCreator: messagesRemoved,
  effect: async (action, listenerApi) => {
    const cid = cidFor(listenerApi.getState(), action.payload.containerId);
    if (cid) await persistRowDeletes(api(listenerApi), cid, action.payload.ids);
  },
});

listen({
  actionCreator: deleteMessage.fulfilled,
  effect: async (action, listenerApi) => {
    await persistRowDeletes(api(listenerApi), action.meta.arg.channelId, [action.payload]);
  },
});

type AttachmentOutcome = { messageId: string; deleted: boolean; updatedMessage?: Message | null };
const attachmentEffect = async (
  action: { payload: AttachmentOutcome; meta: { arg: { channelId: string } } },
  listenerApi: { dispatch: (a: unknown) => unknown; getState: () => RootState },
) => {
  const { messageId, deleted, updatedMessage } = action.payload;
  const cid = action.meta.arg.channelId;
  if (deleted) await persistRowDeletes(api(listenerApi), cid, [messageId]);
  else if (updatedMessage) await persistRowPatches(api(listenerApi), cid, [editPatch(updatedMessage)]);
};
listen({ actionCreator: deleteAttachment.fulfilled, effect: attachmentEffect });
listen({ actionCreator: deleteAllAttachments.fulfilled, effect: attachmentEffect });

listen({
  actionCreator: editMessage.fulfilled,
  effect: async (action, listenerApi) => {
    await persistRowPatches(api(listenerApi), action.meta.arg.channelId, [editPatch(action.payload)]);
  },
});

listen({
  actionCreator: messagesEdited,
  effect: async (action, listenerApi) => {
    const cid = cidFor(listenerApi.getState(), action.payload.containerId);
    if (cid) await persistRowPatches(api(listenerApi), cid, action.payload.messages.map(editPatch));
  },
});

listen({
  matcher: isAnyOf(
    deleteReaction.fulfilled,
    deleteAllReactions.fulfilled,
    bulkDeleteAllReactions.fulfilled,
    bulkDeleteReactionsForEmoji.fulfilled,
  ),
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState();
    const containerId = activeContainerId(state);
    const cid = cidFor(state, containerId);
    const { messageId } = action.payload as { messageId: string };
    if (cid) await persistRowPatches(api(listenerApi), cid, reactionPatches(state, containerId, [messageId]));
  },
});

listen({
  actionCreator: batchRemoveReactions.fulfilled,
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState();
    const containerId = activeContainerId(state);
    const cid = cidFor(state, containerId);
    if (cid) await persistRowPatches(api(listenerApi), cid, reactionPatches(state, containerId, action.payload.processedMessageIds));
  },
});

listen({
  actionCreator: batchAddReactions.fulfilled,
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState();
    const containerId = activeContainerId(state);
    const cid = cidFor(state, containerId);
    const ids = action.payload.successfulAdds.map((s) => s.messageId);
    if (cid) await persistRowPatches(api(listenerApi), cid, reactionPatches(state, containerId, ids));
  },
});

listen({
  matcher: isAnyOf(setRefineCriteria, clearRefineCriteria, setOrder, setSearchCriteria),
  effect: (_action, listenerApi) => {
    scheduleRecord(api(listenerApi), null, 'criteria');
  },
});

listen({
  matcher: isAnyOf(setThreadRefineCriteria, clearThreadRefineCriteria, setThreadOrder, setThreadSearchCriteria),
  effect: (action, listenerApi) => {
    const payload = action.payload as string | { threadId: string };
    const threadId = typeof payload === 'string' ? payload : payload.threadId;
    scheduleRecord(api(listenerApi), threadId, 'criteria');
  },
});

listen({
  matcher: isAnyOf(toggleMessageSelection, selectAllMessages, deselectAllMessages, setSelectedMessages),
  effect: (_action, listenerApi) => {
    scheduleRecord(api(listenerApi), null, 'selection');
  },
});

listen({
  matcher: isAnyOf(toggleThreadMessageSelection, selectAllThreadMessages, deselectAllThreadMessages, setThreadSelectedMessages),
  effect: (action, listenerApi) => {
    const payload = action.payload as string | { threadId: string };
    const threadId = typeof payload === 'string' ? payload : payload.threadId;
    scheduleRecord(api(listenerApi), threadId, 'selection');
  },
});

listen({
  actionCreator: removeThreadTab,
  effect: async (action, listenerApi) => {
    const threadId = action.payload;
    const job = pending.get(threadId);
    if (job) {
      clearTimeout(job.timer);
      pending.delete(threadId);
    }
    const state = listenerApi.getState();
    const parent = mainCid(state);
    await forgetConversation(api(listenerApi), threadId);
    if (parent) await persistThreadTabs(api(listenerApi), parent, state);
  },
});
