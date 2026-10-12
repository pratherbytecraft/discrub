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
  refineApplied,
  threadRefineApplied,
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
  fetchAllMessages,
  fetchAllThreadMessages,
  loadAllSearchResults,
  setActiveTab,
  selectAllMessages,
  selectAllThreadMessages,
  setOrder,
  setSearchCriteria,
  setSelectedIds,
  setThreadOrder,
  setThreadSearchCriteria,
  setThreadSelectedIds,
  toggleMessageSelection,
  toggleThreadMessageSelection,
} from '@features/message/messageSlice';
import { MAIN_CONTAINER, getCachedMessage } from '@features/message/messageCache';
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
import { updateWorkspace, type RowPatch } from '@services/workspaceStore';
import { setSelectedGuild } from '@features/guild/guildSlice';
import { setSelectedChannel } from '@features/channel/channelSlice';
import { setSelectedDm } from '@features/dm/dmSlice';
import type { ActionKind, ConversationSeed, WorkspaceScope } from './workspaceTypes';
import { actionRecorded, feedAnchorMoved, scopeRestoreFinished, selectCurrentWid } from './workspaceSlice';

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

/**
 * The reactions the reducer just wrote, read from the message cache
 * (2.2.5 WP2b: Redux holds rows). A message the cache evicted is skipped;
 * the one a user just acted on is always there.
 */
const reactionPatches = (containerId: string | null, ids: Iterable<string>): RowPatch[] => {
  const key = containerId ?? MAIN_CONTAINER;
  const patches: RowPatch[] = [];
  for (const id of ids) {
    const message = getCachedMessage(key, id);
    if (message) patches.push({ id, patch: { reactions: message.reactions ?? [] } });
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
    record.selectedIds = container.selectedIds;
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

/** Tests, a switch and unload: write every pending record now. */
export async function flushPendingRecords(api: PersistApi): Promise<void> {
  const jobs = [...pending.entries()];
  pending.clear();
  for (const [cid, job] of jobs) {
    clearTimeout(job.timer);
    await flushRecord(api, cid, job.containerId, job.fields);
  }
  await recordChain;
}

/* ─────────────────── Switch flag (2.2.5 WP4a) ─────────────────── */

/**
 * True while a workspace switch is stopping the running action. A run
 * stopped by a switch keeps its action record, so its button reads Resume
 * when the user comes back (plan section 5.4).
 */
let suspendingForSwitch = false;
export const isSuspendingForSwitch = (): boolean => suspendingForSwitch;
export const setSuspendingForSwitch = (value: boolean): void => {
  suspendingForSwitch = value;
};

/* ─────────────────── Action records (2.2.5 WP4a) ─────────────────── */

/**
 * Record writes run one after another, so a run that ends quickly cannot
 * have its clear land before its start.
 */
let recordChain: Promise<unknown> = Promise.resolve();
const chained = (job: () => Promise<unknown>): Promise<unknown> => {
  recordChain = recordChain.then(job, job);
  return recordChain;
};

function recordActionStart(api: PersistApi, cid: string, kind: ActionKind, seed: ConversationSeed | null, settings: unknown): void {
  if (!selectCurrentWid(api.getState())) return;
  const name = seed?.name ?? api.getState().workspace?.actions?.[cid]?.name ?? cid;
  api.dispatch(actionRecorded({ cid, action: { cid, name, kind } }));
  void chained(() => persistConversation(api, cid, { action: { kind, settings } }, seed));
}

function recordActionEnd(api: PersistApi, cid: string): void {
  if (!selectCurrentWid(api.getState())) return;
  api.dispatch(actionRecorded({ cid, action: null }));
  void chained(() => persistConversation(api, cid, { action: null }, null));
}

/** The action's end: finished or stopped clears the record, a switch keeps it. */
function actionEnded(api: PersistApi, cid: string | null): void {
  if (!cid || isSuspendingForSwitch()) return;
  recordActionEnd(api, cid);
}

/* ─────────────────── Scope (2.2.5 WP4a) ─────────────────── */

/** Where the user is, as the workspace row keeps it. */
export function scopeFromState(state: RootState): WorkspaceScope {
  return {
    tab: null,
    guildId: state.guild?.selectedGuild?.id ?? null,
    channelId: state.channel?.selectedChannel?.id ?? null,
    dmId: state.dm?.selectedDm?.id ?? null,
  };
}

function writeScope(api: PersistApi): void {
  const state = api.getState();
  const wid = selectCurrentWid(state);
  const ws = state.workspace;
  if (!wid || !ws || ws.switching || ws.restoringScope) return;
  const scope = scopeFromState(state);
  void chained(async () => {
    try {
      await updateWorkspace(wid, (workspace) => {
        workspace.scope = scope;
      });
    } catch (error) {
      console.error('[workspace] could not write the scope', error);
    }
  });
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
    if (cid) await persistRowPatches(api(listenerApi), cid, reactionPatches(containerId, [messageId]));
  },
});

listen({
  actionCreator: batchRemoveReactions.fulfilled,
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState();
    const containerId = activeContainerId(state);
    const cid = cidFor(state, containerId);
    if (cid) await persistRowPatches(api(listenerApi), cid, reactionPatches(containerId, action.payload.processedMessageIds));
  },
});

listen({
  actionCreator: batchAddReactions.fulfilled,
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState();
    const containerId = activeContainerId(state);
    const cid = cidFor(state, containerId);
    const ids = action.payload.successfulAdds.map((s) => s.messageId);
    if (cid) await persistRowPatches(api(listenerApi), cid, reactionPatches(containerId, ids));
  },
});

listen({
  matcher: isAnyOf(refineApplied, clearRefineCriteria, setOrder, setSearchCriteria),
  effect: (_action, listenerApi) => {
    scheduleRecord(api(listenerApi), null, 'criteria');
  },
});

listen({
  matcher: isAnyOf(threadRefineApplied, clearThreadRefineCriteria, setThreadOrder, setThreadSearchCriteria),
  effect: (action, listenerApi) => {
    const payload = action.payload as string | { threadId: string };
    const threadId = typeof payload === 'string' ? payload : payload.threadId;
    scheduleRecord(api(listenerApi), threadId, 'criteria');
  },
});

listen({
  matcher: isAnyOf(toggleMessageSelection, selectAllMessages, deselectAllMessages, setSelectedIds),
  effect: (_action, listenerApi) => {
    scheduleRecord(api(listenerApi), null, 'selection');
  },
});

listen({
  matcher: isAnyOf(toggleThreadMessageSelection, selectAllThreadMessages, deselectAllThreadMessages, setThreadSelectedIds),
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

/* ─────────────────── WP4a listeners ─────────────────── */

const argOf = <T,>(action: unknown): T => (action as { meta: { arg: T } }).meta.arg;

listen({
  matcher: isAnyOf(setSelectedGuild, setSelectedChannel, setSelectedDm, scopeRestoreFinished),
  effect: (_action, listenerApi) => {
    writeScope(api(listenerApi));
  },
});

listen({
  actionCreator: setActiveTab,
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState();
    if (state.workspace?.restoringScope) return;
    const parent = mainCid(state);
    const persistApi = api(listenerApi);
    if (parent) await chained(() => persistThreadTabs(persistApi, parent, persistApi.getState()));
  },
});

listen({
  actionCreator: feedAnchorMoved,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState();
    if (state.workspace?.restoringScope) return;
    const cid = cidFor(state, action.payload.containerId);
    if (!cid) return;
    // The feed already waited for scrolling to rest (2 s). Only an existing
    // record takes the anchor; opening and scrolling one page writes nothing.
    const persistApi = api(listenerApi);
    void chained(() => persistConversation(persistApi, cid, { scrollAnchorId: action.payload.messageId }, null));
  },
});

listen({
  actionCreator: fetchAllMessages.pending,
  effect: (action, listenerApi) => {
    const cid = action.meta.arg.channelId;
    const state = listenerApi.getState();
    recordActionStart(api(listenerApi), cid, 'loadAll', conversationSeedFromState(state, cid), { mode: 'plain' });
  },
});

listen({
  actionCreator: loadAllSearchResults.pending,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState();
    const cid = action.meta.arg.channelId ?? mainCid(state);
    if (!cid) return;
    recordActionStart(api(listenerApi), cid, 'loadAll', conversationSeedFromState(state, cid), { mode: 'search' });
  },
});

listen({
  actionCreator: fetchAllThreadMessages.pending,
  effect: (action, listenerApi) => {
    const cid = action.meta.arg.threadId;
    const state = listenerApi.getState();
    recordActionStart(api(listenerApi), cid, 'loadAll', threadSeedFromState(state, cid), { mode: 'thread' });
  },
});

listen({
  matcher: isAnyOf(fetchAllMessages.fulfilled, fetchAllMessages.rejected),
  effect: (action, listenerApi) => {
    actionEnded(api(listenerApi), argOf<{ channelId: string }>(action).channelId);
  },
});

listen({
  matcher: isAnyOf(loadAllSearchResults.fulfilled, loadAllSearchResults.rejected),
  effect: (action, listenerApi) => {
    const arg = argOf<{ channelId?: string }>(action);
    actionEnded(api(listenerApi), arg.channelId ?? mainCid(listenerApi.getState()));
  },
});

listen({
  matcher: isAnyOf(fetchAllThreadMessages.fulfilled, fetchAllThreadMessages.rejected),
  effect: (action, listenerApi) => {
    actionEnded(api(listenerApi), argOf<{ threadId: string }>(action).threadId);
  },
});
