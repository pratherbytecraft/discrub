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
  bulkEditChannels,
  bulkEditChannelStarted,
  selectActiveCid,
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
  containerDiskCid,
  reactionChangeOf,
  reactionRowsSynced,
} from '@features/message/messageSlice';
import {
  conversationSeedFromState,
  forgetConversation,
  persistConversation,
  persistRowDeletes,
  persistRowPatches,
  persistRowUpdates,
  persistSelection,
  persistThreadTabs,
  threadSeedFromState,
  type PersistApi,
} from '@features/message/messagePersistence';
import { BULK_RUN_PREFIX, deleteConversationsWithPrefix, refreshConversationNames, searchCid, updateWorkspace, type RowPatch } from '@services/workspaceStore';
import { fetchGuilds, setSelectedGuild } from '@features/guild/guildSlice';
import { fetchChannels, setSelectedChannel } from '@features/channel/channelSlice';
import { fetchDMs, setSelectedDm } from '@features/dm/dmSlice';
import { getDmName } from '@utils/dmListUtils';
import type { ActionKind, BulkKind, BulkMode, ConversationSeed, NameRefresh, WorkspaceBulk, WorkspaceScope } from './workspaceTypes';
import { actionRecorded, bulkOf, bulkRecorded, feedAnchorMoved, initializeWorkspaces, scopeRestoreFinished, selectCurrentWid, workspaceSwitched } from './workspaceSlice';
import { buildConfigSnapshot, bulkExportChannels, bulkExportDMs, bulkUnitFinished, exportMessages, setExportProgress } from '@features/export/exportSlice';
import { bulkPurgeChannels, purgeGuilds, setPurgeProgress } from '@features/purge/purgeSlice';

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

/** The store key of a container: its search set while it shows a search (fix C). */
const cidFor = (state: RootState, containerId: string | null): string | null =>
  containerDiskCid(state, containerId);

/** The fields an edit can change. Reactions and reply parents stay as enriched. */
const EDIT_FIELDS: Array<keyof Message> = ['content', 'edited_timestamp', 'attachments', 'embeds', 'mentions', 'flags', 'components', 'pinned'];

export function editPatch(message: Message): RowPatch {
  const patch: Partial<Message> = {};
  for (const field of EDIT_FIELDS) {
    if (message[field] !== undefined) (patch as Record<string, unknown>)[field] = message[field];
  }
  return { id: message.id, patch };
}

/* ─────────────────── Debounced record rewrites ─────────────────── */

type RecordJob = { timer: ReturnType<typeof setTimeout>; containerId: string | null };
const pending = new Map<string, RecordJob>();
/** 2.2.5 W1: selection writes, apart from the record, keyed by store cid. */
const pendingSelections = new Map<string, RecordJob>();

function recordFromState(state: RootState, containerId: string | null): Partial<Conversation> | null {
  const container = containerFor(state, containerId);
  if (!container) return null;
  return {
    searchCriteria: container.searchCriteria,
    refineCriteria: container.refineCriteria,
    order: container.order,
  };
}

function schedule(jobs: Map<string, RecordJob>, api: PersistApi, containerId: string | null, flush: (cid: string, containerId: string | null) => Promise<unknown>): void {
  const cid = cidFor(api.getState(), containerId);
  if (!cid) return;
  const existing = jobs.get(cid);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    jobs.delete(cid);
    void flush(cid, containerId);
  }, RECORD_DEBOUNCE_MS);
  jobs.set(cid, { timer, containerId });
}

function scheduleRecord(api: PersistApi, containerId: string | null): void {
  schedule(pending, api, containerId, (cid, id) => flushRecord(api, cid, id));
}

function scheduleSelection(api: PersistApi, containerId: string | null): void {
  schedule(pendingSelections, api, containerId, (cid, id) => flushSelection(api, cid, id));
}

async function flushRecord(api: PersistApi, cid: string, containerId: string | null): Promise<void> {
  const state = api.getState();
  const record = recordFromState(state, containerId);
  if (!record) return;
  // A filter, refine or sort writes the record (plan section 4.2).
  const seed = containerId === null ? conversationSeedFromState(state, cid) : threadSeedFromState(state, cid);
  await persistConversation(api, cid, record, seed);
}

/** A selection only lands for a conversation that is already saved. */
async function flushSelection(api: PersistApi, cid: string, containerId: string | null): Promise<void> {
  const container = containerFor(api.getState(), containerId);
  if (!container) return;
  await persistSelection(api, cid, container.selectedIds);
}

/** Tests, a switch and unload: write every pending record now. */
export async function flushPendingRecords(api: PersistApi): Promise<void> {
  const jobs = [...pending.entries()];
  pending.clear();
  for (const [cid, job] of jobs) {
    clearTimeout(job.timer);
    await flushRecord(api, cid, job.containerId);
  }
  const selections = [...pendingSelections.entries()];
  pendingSelections.clear();
  for (const [cid, job] of selections) {
    clearTimeout(job.timer);
    await flushSelection(api, cid, job.containerId);
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

/**
 * Row 49: a Load All that failed (not one the user stopped) keeps its
 * record, so the button reads Resume and continues from the cursor.
 */
function loadAllFailed(action: { type: string; payload?: unknown }): boolean {
  if (!action.type.endsWith('/rejected')) return false;
  return action.payload !== 'Load all cancelled' && action.payload !== 'Load cancelled';
}

/** The action's end: finished or stopped clears the record, a switch keeps it. */
function actionEnded(api: PersistApi, cid: string | null): void {
  if (!cid || isSuspendingForSwitch()) return;
  recordActionEnd(api, cid);
}

/* ─────────────────── Scope (2.2.5 WP4a) ─────────────────── */

/** Where the user is, as the workspace row keeps it. */
export function scopeFromState(state: RootState): WorkspaceScope {
  const channelId = state.channel?.selectedChannel?.id ?? null;
  const dmId = channelId ? null : state.dm?.selectedDm?.id ?? null;
  // Row 12: an open DM leaves the last server selected; the scope is the DM alone.
  return {
    tab: null,
    guildId: dmId ? null : state.guild?.selectedGuild?.id ?? null,
    channelId,
    dmId,
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

/**
 * 2.2.5 W1: a reaction change is applied to the stored messages with the
 * same update the reducer ran on the cached ones, so a message the cache
 * evicted is changed on disk too, and its row comes back current.
 */
listen({
  matcher: isAnyOf(
    deleteReaction.fulfilled,
    deleteAllReactions.fulfilled,
    bulkDeleteAllReactions.fulfilled,
    bulkDeleteReactionsForEmoji.fulfilled,
    batchRemoveReactions.fulfilled,
    batchAddReactions.fulfilled,
  ),
  effect: async (action, listenerApi) => {
    const change = reactionChangeOf(action);
    if (!change) return;
    const state = listenerApi.getState();
    const containerId = activeContainerId(state);
    const cid = cidFor(state, containerId);
    if (!cid) return;
    const changed = await persistRowUpdates(api(listenerApi), cid, change.ids, change.update);
    if (changed.length > 0) listenerApi.dispatch(reactionRowsSynced({ containerId, messages: changed }));
  },
});

listen({
  matcher: isAnyOf(refineApplied, clearRefineCriteria, setOrder, setSearchCriteria),
  effect: (action, listenerApi) => {
    // 2.2.5 fix C: clearing criteria writes nothing. A search clear drops the
    // search set; the per switch reset (#226) fired before the next
    // conversation's restore and wrote the default sort over its record
    // (row 11).
    if (setSearchCriteria.match(action) && action.payload === null) return;
    scheduleRecord(api(listenerApi), null);
  },
});

listen({
  matcher: isAnyOf(threadRefineApplied, clearThreadRefineCriteria, setThreadOrder, setThreadSearchCriteria),
  effect: (action, listenerApi) => {
    if (setThreadSearchCriteria.match(action) && action.payload.criteria === null) return;
    const payload = action.payload as string | { threadId: string };
    const threadId = typeof payload === 'string' ? payload : payload.threadId;
    scheduleRecord(api(listenerApi), threadId);
  },
});

listen({
  matcher: isAnyOf(toggleMessageSelection, selectAllMessages, deselectAllMessages, setSelectedIds),
  effect: (_action, listenerApi) => {
    scheduleSelection(api(listenerApi), null);
  },
});

listen({
  matcher: isAnyOf(toggleThreadMessageSelection, selectAllThreadMessages, deselectAllThreadMessages, setThreadSelectedIds),
  effect: (action, listenerApi) => {
    const payload = action.payload as string | { threadId: string };
    const threadId = typeof payload === 'string' ? payload : payload.threadId;
    scheduleSelection(api(listenerApi), threadId);
  },
});

listen({
  actionCreator: removeThreadTab,
  effect: async (action, listenerApi) => {
    const threadId = action.payload;
    for (const jobs of [pending, pendingSelections]) {
      const job = jobs.get(threadId);
      if (job) {
        clearTimeout(job.timer);
        jobs.delete(threadId);
      }
    }
    const state = listenerApi.getState();
    const parent = mainCid(state);
    await forgetConversation(api(listenerApi), threadId);
    if (parent) await persistThreadTabs(api(listenerApi), parent, state);
  },
});

/* ─────────────────── Name refresh (2.2.5 ws-conv-names) ─────────────────── */

/**
 * A server, channel or DM list the app just fetched carries the current
 * names, so the open workspace's records follow it. Nothing is written
 * while a switch is going, since the list may belong to the old scope.
 */
function refreshNames(listenerApi: { getState: () => RootState }, names: NameRefresh): void {
  const state = listenerApi.getState();
  const wid = state.workspace?.currentWid;
  if (!wid || state.workspace?.switching) return;
  void chained(async () => {
    try {
      await refreshConversationNames(wid, names);
    } catch (error) {
      console.warn('[workspace] name refresh failed', error);
    }
  });
}

const namesOf = <T extends { id: string; name?: string | null }>(items: T[], nameOf: (item: T) => string = (item) => item.name ?? item.id) =>
  Object.fromEntries(items.map((item) => [item.id, nameOf(item)]));

listen({
  actionCreator: fetchGuilds.fulfilled,
  effect: (action, listenerApi) => {
    refreshNames(listenerApi, { guilds: namesOf(action.payload) });
  },
});

listen({
  actionCreator: fetchChannels.fulfilled,
  effect: (action, listenerApi) => {
    refreshNames(listenerApi, { channels: namesOf(action.payload) });
  },
});

listen({
  actionCreator: fetchDMs.fulfilled,
  effect: (action, listenerApi) => {
    refreshNames(listenerApi, { dms: namesOf(action.payload, getDmName) });
  },
});

// Row 15: a list that arrived while the workspace was still opening was
// dropped above; once it is open, the lists already loaded rename it.
// Names are keyed by id, so a list from the previous scope is still right.
listen({
  matcher: isAnyOf(initializeWorkspaces.fulfilled, workspaceSwitched),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState();
    const names: NameRefresh = {};
    if (state.guild?.guilds?.length) names.guilds = namesOf(state.guild.guilds);
    if (state.channel?.channels?.length) names.channels = namesOf(state.channel.channels);
    if (state.dm?.dms?.length) names.dms = namesOf(state.dm.dms, getDmName);
    if (Object.keys(names).length > 0) refreshNames(listenerApi, names);
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
    // A search's Load All belongs to the search set (fix C).
    recordActionStart(api(listenerApi), searchCid(cid), 'loadAll', conversationSeedFromState(state, cid), { mode: 'search' });
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
    if (loadAllFailed(action)) return;
    actionEnded(api(listenerApi), argOf<{ channelId: string }>(action).channelId);
  },
});

listen({
  matcher: isAnyOf(loadAllSearchResults.fulfilled, loadAllSearchResults.rejected),
  effect: (action, listenerApi) => {
    if (loadAllFailed(action)) return;
    const arg = argOf<{ channelId?: string }>(action);
    const cid = arg.channelId ?? mainCid(listenerApi.getState());
    if (cid) actionEnded(api(listenerApi), searchCid(cid));
  },
});

listen({
  matcher: isAnyOf(fetchAllThreadMessages.fulfilled, fetchAllThreadMessages.rejected),
  effect: (action, listenerApi) => {
    if (loadAllFailed(action)) return;
    actionEnded(api(listenerApi), argOf<{ threadId: string }>(action).threadId);
  },
});

/* ─────────────────── WP4b: Export and bulk records ─────────────────── */

/** The conversation each running export started in, by request id, so its end clears the right record. */
const exportCids = new Map<string, string>();

listen({
  actionCreator: exportMessages.pending,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState();
    const cid = selectActiveCid(state);
    if (!cid) return;
    exportCids.set(action.meta.requestId, cid);
    const thread = state.message.activeTab && state.message.threadTabs?.[state.message.activeTab] ? cid : null;
    const seed = thread ? threadSeedFromState(state, cid) : conversationSeedFromState(state, cid);
    recordActionStart(api(listenerApi), cid, 'export', seed, { snapshot: buildConfigSnapshot(state) });
  },
});

listen({
  matcher: isAnyOf(exportMessages.fulfilled, exportMessages.rejected),
  effect: (action, listenerApi) => {
    const requestId = (action as unknown as { meta: { requestId: string } }).meta.requestId;
    const cid = exportCids.get(requestId) ?? null;
    exportCids.delete(requestId);
    actionEnded(api(listenerApi), cid);
  },
});

interface BulkStart {
  kind: BulkKind;
  mode: BulkMode;
  guildId: string | null;
  settings: unknown;
  queue: string[];
  /** A resumed Bulk Export keeps the units that finished (2.2.5 WP6c). */
  keepDone?: boolean;
}

/** The last progress index written, so a progress action per message writes nothing new. */
let bulkWrittenIndex = -1;

function recordBulkStart(persistApi: PersistApi, start: BulkStart): void {
  const wid = selectCurrentWid(persistApi.getState());
  if (!wid) return;
  bulkWrittenIndex = -1;
  const { keepDone, ...fields } = start;
  const bulk: WorkspaceBulk = {
    ...fields,
    done: [],
    inHand: start.queue[0] ?? null,
    total: start.queue.length,
    doneCount: 0,
  };
  persistApi.dispatch(bulkRecorded(bulkOf({ bulk } as never)));
  void chained(async () => {
    try {
      const record = await updateWorkspace(wid, (workspace) => {
        const done = keepDone && workspace.bulk?.kind === bulk.kind ? workspace.bulk.done : [];
        workspace.bulk = { ...bulk, done };
      });
      if (keepDone && selectCurrentWid(persistApi.getState()) === wid) persistApi.dispatch(bulkRecorded(bulkOf(record)));
    } catch (error) {
      console.error('[workspace] could not record the bulk run', error);
    }
  });
}

/** A Bulk Export unit rendered into the zip; a resumed run skips it (2.2.5 WP6c). */
function recordBulkUnitDone(persistApi: PersistApi, id: string): void {
  const wid = selectCurrentWid(persistApi.getState());
  if (!wid || persistApi.getState().workspace?.bulk?.kind !== 'bulkExport') return;
  void chained(async () => {
    try {
      const record = await updateWorkspace(wid, (workspace) => {
        const bulk = workspace.bulk;
        if (!bulk || bulk.kind !== 'bulkExport' || bulk.done.includes(id)) return;
        bulk.done.push(id);
      });
      if (selectCurrentWid(persistApi.getState()) === wid && persistApi.getState().workspace?.bulk) {
        persistApi.dispatch(bulkRecorded(bulkOf(record)));
      }
    } catch (error) {
      console.error('[workspace] could not record the finished unit', error);
    }
  });
}

/** The rows a Bulk Export walked into the workspace go when the run is over or forgotten. */
export function dropBulkRunConversations(wid: string): Promise<unknown> {
  return chained(async () => {
    try {
      await deleteConversationsWithPrefix(wid, BULK_RUN_PREFIX);
    } catch (error) {
      console.error('[workspace] could not drop the run conversations', error);
    }
  });
}

/** Moves the record to the unit at `index` (everything before it is done). */
function recordBulkAt(persistApi: PersistApi, index: number, total: number | null): void {
  const wid = selectCurrentWid(persistApi.getState());
  if (!wid || !persistApi.getState().workspace?.bulk || index === bulkWrittenIndex) return;
  bulkWrittenIndex = index;
  void chained(async () => {
    try {
      const record = await updateWorkspace(wid, (workspace) => {
        const bulk = workspace.bulk;
        if (!bulk) return;
        bulk.doneCount = index;
        if (total !== null) bulk.total = total;
        // Bulk Export counts a forum's posts one by one, so its index does
        // not map onto the queue; the other runs walk the queue itself.
        if (bulk.kind !== 'bulkExport') {
          bulk.done = bulk.queue.slice(0, index);
          bulk.inHand = bulk.queue[index] ?? null;
        }
      });
      if (selectCurrentWid(persistApi.getState()) === wid && persistApi.getState().workspace?.bulk) {
        persistApi.dispatch(bulkRecorded(bulkOf(record)));
      }
    } catch (error) {
      console.error('[workspace] could not update the bulk run', error);
    }
  });
}

function recordBulkEnd(persistApi: PersistApi): void {
  const wid = selectCurrentWid(persistApi.getState());
  if (!wid || isSuspendingForSwitch()) return;
  const wasExport = persistApi.getState().workspace?.bulk?.kind === 'bulkExport';
  bulkWrittenIndex = -1;
  persistApi.dispatch(bulkRecorded(null));
  void chained(async () => {
    try {
      await updateWorkspace(wid, (workspace) => {
        workspace.bulk = null;
      });
    } catch (error) {
      console.error('[workspace] could not clear the bulk run', error);
    }
  });
  if (wasExport) void dropBulkRunConversations(wid);
}

const idsOf = (items: Array<{ id: string }>): string[] => items.map((item) => item.id);

listen({
  matcher: isAnyOf(bulkExportChannels.pending, bulkExportDMs.pending),
  effect: (action, listenerApi) => {
    const arg = argOf<{ channels: Array<{ id: string }>; guildId?: string | null; searchCriteria?: unknown; resume?: boolean }>(action);
    const dms = bulkExportDMs.pending.match(action);
    recordBulkStart(api(listenerApi), {
      kind: 'bulkExport',
      mode: dms ? 'dms' : 'channels',
      guildId: dms ? null : arg.guildId ?? null,
      settings: { snapshot: buildConfigSnapshot(listenerApi.getState()), searchCriteria: arg.searchCriteria ?? null },
      queue: idsOf(arg.channels),
      keepDone: arg.resume === true,
    });
  },
});

listen({
  actionCreator: bulkUnitFinished,
  effect: (action, listenerApi) => {
    recordBulkUnitDone(api(listenerApi), action.payload.id);
  },
});

listen({
  actionCreator: setExportProgress,
  effect: (action, listenerApi) => {
    const bulk = action.payload.bulk;
    if (!bulk || listenerApi.getState().workspace?.bulk?.kind !== 'bulkExport') return;
    recordBulkAt(api(listenerApi), bulk.currentIndex, bulk.totalChannels);
  },
});

listen({
  matcher: isAnyOf(bulkExportChannels.fulfilled, bulkExportChannels.rejected, bulkExportDMs.fulfilled, bulkExportDMs.rejected),
  effect: (_action, listenerApi) => {
    recordBulkEnd(api(listenerApi));
  },
});

listen({
  actionCreator: bulkPurgeChannels.pending,
  effect: (action, listenerApi) => {
    const arg = action.meta.arg;
    recordBulkStart(api(listenerApi), {
      kind: 'bulkPurge',
      mode: arg.guildId ? 'channels' : 'dms',
      guildId: arg.guildId ?? null,
      settings: { config: arg.config, searchCriteria: arg.searchCriteria ?? null },
      queue: idsOf(arg.channels),
    });
  },
});

listen({
  actionCreator: purgeGuilds.pending,
  effect: (action, listenerApi) => {
    const arg = action.meta.arg;
    recordBulkStart(api(listenerApi), {
      kind: 'bulkPurge',
      mode: 'servers',
      guildId: null,
      settings: { config: arg.config, searchCriteria: arg.searchCriteria ?? null },
      queue: idsOf(arg.guilds),
    });
  },
});

listen({
  actionCreator: setPurgeProgress,
  effect: (action, listenerApi) => {
    const bulk = action.payload.bulk;
    const record = listenerApi.getState().workspace?.bulk;
    if (!bulk || record?.kind !== 'bulkPurge') return;
    const index = record.mode === 'servers' ? bulk.server?.index ?? 0 : bulk.currentIndex;
    recordBulkAt(api(listenerApi), index, null);
  },
});

listen({
  matcher: isAnyOf(bulkPurgeChannels.fulfilled, bulkPurgeChannels.rejected, purgeGuilds.fulfilled, purgeGuilds.rejected),
  effect: (action, listenerApi) => {
    // A server run purges each server's channels inside one purgeGuilds; only its own end counts.
    if (bulkPurgeChannels.fulfilled.match(action) || bulkPurgeChannels.rejected.match(action)) {
      if (listenerApi.getState().workspace?.bulk?.mode === 'servers') return;
    }
    recordBulkEnd(api(listenerApi));
  },
});

listen({
  actionCreator: bulkEditChannels.pending,
  effect: (action, listenerApi) => {
    const arg = action.meta.arg;
    recordBulkStart(api(listenerApi), {
      kind: 'bulkEdit',
      mode: arg.guildId ? 'channels' : 'dms',
      guildId: arg.guildId ?? null,
      settings: { content: arg.content, searchCriteria: arg.searchCriteria ?? null },
      queue: idsOf(arg.channels),
    });
  },
});

listen({
  actionCreator: bulkEditChannelStarted,
  effect: (action, listenerApi) => {
    if (listenerApi.getState().workspace?.bulk?.kind !== 'bulkEdit') return;
    recordBulkAt(api(listenerApi), action.payload.index, null);
  },
});

listen({
  matcher: isAnyOf(bulkEditChannels.fulfilled, bulkEditChannels.rejected),
  effect: (_action, listenerApi) => {
    recordBulkEnd(api(listenerApi));
  },
});
