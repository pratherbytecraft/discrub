/**
 * 2.2.5 WP4b: unfinished Export and bulk run records (plan section 6). The
 * runs themselves are covered elsewhere; these tests dispatch their
 * lifecycle actions and check what the workspace keeps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { AppDispatch } from '@/app/store';
import type { Channel, Guild } from 'discrub-core/types/discord-types';
import { createMockChannel, createMockGuild } from '@/test/fixtures';
import messageReducer, { bulkEditChannels, bulkEditChannelStarted } from '@features/message/messageSlice';
import workspaceReducer, { selectHasUnfinishedWork, selectUnfinishedBulk, setCurrentWorkspace, initializeWorkspaces } from './workspaceSlice';
import { workspacePersistenceMiddleware, flushPendingRecords, setSuspendingForSwitch } from './workspacePersistenceMiddleware';
import channelReducer, { setSelectedChannel } from '@features/channel/channelSlice';
import dmReducer from '@features/dm/dmSlice';
import guildReducer from '@features/guild/guildSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import exportReducer, { bulkExportChannels, bulkUnitFinished, exportMessages, setExportProgress } from '@features/export/exportSlice';
import purgeReducer, { bulkPurgeChannels, purgeGuilds, setPurgeProgress } from '@features/purge/purgeSlice';
import type { PurgeConfig } from '@features/purge/purgeTypes';
import { DEFAULT_WORKSPACE_ID } from './workspaceTypes';
import { discardBulkRecord, discardConversationAction, readBulkRecord, readConversationAction, resolveQueue } from './resumeRecords';
import {
  acquireWorkspaceLock,
  deleteWorkspaceDatabase,
  ensureDefaultWorkspace,
  getConversation,
  getWorkspace,
  releaseWorkspaceLock,
  writePage,
} from '@services/workspaceStore';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn() }));

const chan = (id: string, name = id): Channel => createMockChannel({ id, name, guild_id: '42' });
const CHANNELS = [chan('c1', 'one'), chan('c2', 'two'), chan('c3', 'three')];
const CONFIG: PurgeConfig = {
  mode: 'messages',
  targetUserIds: ['me'],
  retainAttachedMedia: true,
  deleteAttachmentsOnly: false,
  systemMessageTypesToDelete: [],
};

function makeStore() {
  return configureStore({
    reducer: {
      message: messageReducer,
      workspace: workspaceReducer,
      channel: channelReducer,
      dm: dmReducer,
      guild: guildReducer,
      app: appReducer,
      status: statusReducer,
      export: exportReducer,
      purge: purgeReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(workspacePersistenceMiddleware.middleware),
  });
}
type Store = ReturnType<typeof makeStore>;

const flush = (store: Store) => flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
const purgeArg = (channels = CHANNELS) => ({ channels, config: CONFIG, guildId: '42', searchCriteria: null });
const bulk = (index: number, total: number, server?: { name: string; index: number; total: number }) => ({
  currentIndex: index,
  totalChannels: total,
  currentChannelName: 'x',
  completedStats: { deleted: 0, skipped: 0, reactionsRemoved: 0 },
  ...(server ? { server } : {}),
});

async function openDefault() {
  const store = makeStore();
  await ensureDefaultWorkspace();
  await acquireWorkspaceLock(DEFAULT_WORKSPACE_ID);
  store.dispatch(setCurrentWorkspace(DEFAULT_WORKSPACE_ID));
  return store;
}

beforeEach(async () => {
  await deleteWorkspaceDatabase();
});

afterEach(async () => {
  setSuspendingForSwitch(false);
  releaseWorkspaceLock(DEFAULT_WORKSPACE_ID);
  await deleteWorkspaceDatabase();
});

describe('single Export record', () => {
  it('keeps the export settings on the open conversation while it runs and clears them at the end', async () => {
    const store = await openDefault();
    store.dispatch(setSelectedChannel(chan('801', 'general')));
    const arg = { messages: [], channelName: 'general', format: 'html' as const, messagesPerPage: 1000, separateThreads: false, includeMedia: false };
    store.dispatch(exportMessages.pending('r1', arg));
    expect(store.getState().workspace.actions['801']?.kind).toBe('export');
    await flush(store);
    const action = await readConversationAction(store.getState() as never, '801');
    expect(action?.kind).toBe('export');
    expect((action?.settings as { snapshot: { format: string } }).snapshot.format).toBe(store.getState().export.exportFormat);

    store.dispatch(exportMessages.fulfilled({} as never, 'r1', arg));
    await flush(store);
    expect(store.getState().workspace.actions['801']).toBeUndefined();
    expect((await getConversation(DEFAULT_WORKSPACE_ID, '801'))?.action).toBeNull();
  });

  it('Start over drops the record', async () => {
    const store = await openDefault();
    store.dispatch(setSelectedChannel(chan('801', 'general')));
    store.dispatch(exportMessages.pending('r1', { messages: [], channelName: 'general', format: 'html', messagesPerPage: 1000, separateThreads: false, includeMedia: false }));
    await flush(store);
    await (store.dispatch as unknown as AppDispatch)(discardConversationAction({ cid: '801' }));
    expect(store.getState().workspace.actions['801']).toBeUndefined();
    expect((await getConversation(DEFAULT_WORKSPACE_ID, '801'))?.action).toBeNull();
  });
});

describe('Bulk Purge record', () => {
  it('records the queue and settings, follows the channel in hand, and clears when the run ends', async () => {
    const store = await openDefault();
    store.dispatch(bulkPurgeChannels.pending('p1', purgeArg()));
    expect(selectUnfinishedBulk(store.getState() as never)).toMatchObject({ kind: 'bulkPurge', mode: 'channels', guildId: '42', remaining: 3 });
    expect(selectHasUnfinishedWork(store.getState() as never)).toBe(true);

    store.dispatch(setPurgeProgress({ processed: 0, deleted: 0, skipped: 0, reactionsRemoved: 0, bulk: bulk(1, 3) }));
    // A progress action per message writes nothing new.
    store.dispatch(setPurgeProgress({ processed: 5, deleted: 5, skipped: 0, reactionsRemoved: 0, bulk: bulk(1, 3) }));
    await flush(store);
    const record = await readBulkRecord(store.getState() as never);
    expect(record).toMatchObject({ queue: ['c1', 'c2', 'c3'], done: ['c1'], inHand: 'c2', doneCount: 1 });
    expect((record?.settings as { config: PurgeConfig }).config).toEqual(CONFIG);
    expect(selectUnfinishedBulk(store.getState() as never)?.remaining).toBe(2);

    store.dispatch(bulkPurgeChannels.fulfilled({} as never, 'p1', purgeArg()));
    await flush(store);
    expect(selectUnfinishedBulk(store.getState() as never)).toBeNull();
    expect((await getWorkspace(DEFAULT_WORKSPACE_ID))?.bulk).toBeNull();
  });

  it('keeps the record when a workspace switch stopped the run', async () => {
    const store = await openDefault();
    store.dispatch(bulkPurgeChannels.pending('p1', purgeArg()));
    setSuspendingForSwitch(true);
    store.dispatch(bulkPurgeChannels.fulfilled({} as never, 'p1', purgeArg()));
    setSuspendingForSwitch(false);
    await flush(store);
    expect((await getWorkspace(DEFAULT_WORKSPACE_ID))?.bulk?.kind).toBe('bulkPurge');
  });

  it('a DM run records the dms list', async () => {
    const store = await openDefault();
    store.dispatch(bulkPurgeChannels.pending('p1', { ...purgeArg(), guildId: null }));
    expect(selectUnfinishedBulk(store.getState() as never)).toMatchObject({ mode: 'dms', guildId: null });
  });

  it('a server run follows the server index and ignores the end of each server\'s channel pass', async () => {
    const store = await openDefault();
    const guilds: Guild[] = [createMockGuild({ id: 'g1' }), createMockGuild({ id: 'g2' })];
    const arg = { guilds, config: CONFIG, searchCriteria: null };
    store.dispatch(purgeGuilds.pending('s1', arg));
    store.dispatch(setPurgeProgress({ processed: 0, deleted: 0, skipped: 0, reactionsRemoved: 0, bulk: bulk(3, 9, { name: 'two', index: 1, total: 2 }) }));
    store.dispatch(bulkPurgeChannels.fulfilled({} as never, 'inner', purgeArg()));
    await flush(store);
    const record = await readBulkRecord(store.getState() as never);
    expect(record).toMatchObject({ mode: 'servers', queue: ['g1', 'g2'], done: ['g1'], inHand: 'g2' });
    store.dispatch(purgeGuilds.fulfilled({} as never, 's1', arg));
    await flush(store);
    expect(await readBulkRecord(store.getState() as never)).toBeNull();
  });

  it('Start over drops the record', async () => {
    const store = await openDefault();
    store.dispatch(bulkPurgeChannels.pending('p1', purgeArg()));
    await flush(store);
    await (store.dispatch as unknown as AppDispatch)(discardBulkRecord());
    expect(selectUnfinishedBulk(store.getState() as never)).toBeNull();
    expect((await getWorkspace(DEFAULT_WORKSPACE_ID))?.bulk).toBeNull();
  });
});

describe('Bulk Export and Bulk Edit records', () => {
  it('Bulk Export counts finished units from its progress (a forum counts its posts)', async () => {
    const store = await openDefault();
    const arg = { channels: CHANNELS, token: 't', format: 'html' as const, messagesPerPage: 1000, separateThreads: false, includeMedia: false, guildId: '42', searchCriteria: null };
    store.dispatch(bulkExportChannels.pending('e1', arg));
    store.dispatch(setExportProgress({ stage: 'messages', current: 0, total: 0, bulk: { currentIndex: 4, totalChannels: 7, currentChannelName: 'x' } } as never));
    await flush(store);
    expect(await readBulkRecord(store.getState() as never)).toMatchObject({ kind: 'bulkExport', doneCount: 4, total: 7, done: [] });
    expect(selectUnfinishedBulk(store.getState() as never)).toMatchObject({ doneCount: 4, total: 7 });
    store.dispatch(bulkExportChannels.rejected(null, 'e1', arg));
    await flush(store);
    expect(await readBulkRecord(store.getState() as never)).toBeNull();
  });

  it('Bulk Edit follows the channel it is on and keeps the text', async () => {
    const store = await openDefault();
    const arg = { channels: CHANNELS, content: 'redacted', guildId: '42', searchCriteria: null };
    store.dispatch(bulkEditChannels.pending('b1', arg));
    store.dispatch(bulkEditChannelStarted({ index: 2, total: 3 }));
    await flush(store);
    const record = await readBulkRecord(store.getState() as never);
    expect(record).toMatchObject({ kind: 'bulkEdit', done: ['c1', 'c2'], inHand: 'c3' });
    expect((record?.settings as { content: string }).content).toBe('redacted');
  });
});

describe('boot and lookup', () => {
  it('boot loads an unfinished bulk run into the slice', async () => {
    const first = await openDefault();
    first.dispatch(bulkPurgeChannels.pending('p1', purgeArg()));
    await flush(first);
    releaseWorkspaceLock(DEFAULT_WORKSPACE_ID);
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    expect(selectUnfinishedBulk(store.getState() as never)).toMatchObject({ kind: 'bulkPurge', remaining: 3 });
  });

  it('resolveQueue keeps run order and skips what is gone', () => {
    expect(resolveQueue(['c3', 'gone', 'c1'], [CHANNELS]).map((c) => c.id)).toEqual(['c3', 'c1']);
  });
});

describe('Bulk Export run conversations (2.2.5 WP6c)', () => {
  const arg = (resume?: boolean) => ({ channels: CHANNELS, token: 't', format: 'json' as const, messagesPerPage: 100, separateThreads: false, includeMedia: false, guildId: '42', resume });

  it('a finished unit joins the done list, a resumed run keeps it and a fresh run drops it', async () => {
    const store = await openDefault();
    store.dispatch(bulkExportChannels.pending('e1', arg()));
    store.dispatch(bulkUnitFinished({ id: 'c1' }));
    store.dispatch(bulkUnitFinished({ id: 'c1' }));
    await flush(store);
    expect((await readBulkRecord(store.getState() as never))?.done).toEqual(['c1']);
    expect(selectUnfinishedBulk(store.getState() as never)?.remaining).toBe(2);

    store.dispatch(bulkExportChannels.pending('e2', arg(true)));
    await flush(store);
    expect((await readBulkRecord(store.getState() as never))?.done).toEqual(['c1']);

    store.dispatch(bulkExportChannels.pending('e3', arg()));
    await flush(store);
    expect((await readBulkRecord(store.getState() as never))?.done).toEqual([]);
  });

  it('the run conversations go when the run ends and on Start over, other conversations stay', async () => {
    const store = await openDefault();
    const seed = { kind: 'channel' as const, guildId: '42', name: 'one' };
    await writePage(DEFAULT_WORKSPACE_ID, 'run:c1', [{ id: '1', timestamp: '2026-01-01T00:00:00.000Z' } as never], seed);
    await writePage(DEFAULT_WORKSPACE_ID, 'c1', [{ id: '2', timestamp: '2026-01-01T00:00:00.000Z' } as never], seed);
    store.dispatch(bulkExportChannels.pending('e1', arg()));
    store.dispatch(bulkExportChannels.fulfilled({ success: true }, 'e1', arg()));
    await flush(store);
    expect(Object.keys((await getWorkspace(DEFAULT_WORKSPACE_ID))?.conversations ?? {})).toEqual(['c1']);

    await writePage(DEFAULT_WORKSPACE_ID, 'run:c2', [{ id: '3', timestamp: '2026-01-01T00:00:00.000Z' } as never], seed);
    store.dispatch(bulkExportChannels.pending('e2', arg()));
    await flush(store);
    await (store.dispatch as unknown as AppDispatch)(discardBulkRecord());
    expect(Object.keys((await getWorkspace(DEFAULT_WORKSPACE_ID))?.conversations ?? {})).toEqual(['c1']);
  });

  it('a switch keeps the run conversations with the record', async () => {
    const store = await openDefault();
    await writePage(DEFAULT_WORKSPACE_ID, 'run:c1', [{ id: '1', timestamp: '2026-01-01T00:00:00.000Z' } as never], { kind: 'channel', guildId: '42', name: 'one' });
    store.dispatch(bulkExportChannels.pending('e1', arg()));
    setSuspendingForSwitch(true);
    store.dispatch(bulkExportChannels.rejected(null, 'e1', arg()));
    await flush(store);
    const workspace = await getWorkspace(DEFAULT_WORKSPACE_ID);
    expect(workspace?.bulk?.kind).toBe('bulkExport');
    expect(Object.keys(workspace?.conversations ?? {})).toEqual(['run:c1']);
  });
});
