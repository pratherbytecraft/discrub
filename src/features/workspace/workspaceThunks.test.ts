/**
 * 2.2.5 WP4a: switching workspaces, the Load All action record, scope
 * writes and scope restore (plan sections 5.4, 5.5, 6 and 7).
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { AppDispatch } from '@/app/store';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockChannel, createMockDmChannel, createMockGuild, createMockMessage } from '@/test/fixtures';
import * as discordService from '@services/discordService';
import messageReducer, { fetchAllMessages, fetchMessages, setActiveTab } from '@features/message/messageSlice';
import workspaceReducer, {
  feedAnchorMoved,
  initializeWorkspaces,
  selectConversationAction,
  selectHasUnfinishedWork,
  setCurrentWorkspace,
} from './workspaceSlice';
import { restoreWorkspaceScope, switchWorkspace } from './workspaceThunks';
import { workspacePersistenceMiddleware, flushPendingRecords } from './workspacePersistenceMiddleware';
import channelReducer, { setSelectedChannel } from '@features/channel/channelSlice';
import dmReducer, { setSelectedDm } from '@features/dm/dmSlice';
import guildReducer, { fetchGuilds, setSelectedGuild } from '@features/guild/guildSlice';
import appReducer, { setDiscrubCancelled, selectFeedScrollAnchor } from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import cacheReducer from '@features/cache/cacheSlice';
import exportReducer from '@features/export/exportSlice';
import purgeReducer from '@features/purge/purgeSlice';
import authReducer, { setToken } from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import packageReducer from '@features/package/packageSlice';
import devReducer from '@features/dev/devSlice';
import { LEGACY_DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION } from './workspaceTypes';
import {
  acquireWorkspaceLock,
  countRows,
  createWorkspace,
  deleteWorkspaceDatabase,
  getConversation,
  getMeta,
  getWorkspace,
  holdsWorkspaceLock,
  releaseWorkspaceLock,
  setLastWorkspace,
  updateConversation,
  updateWorkspace,
  writePage,
} from '@services/workspaceStore';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn() }));
vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({ delayMs: 0, delaySec: 0, baseDelay: 0, modifier: 0, randomComponent: 0 })),
}));
vi.mock('@services/reactionEnrichmentService', () => ({
  reactionEnrichmentService: { enrichMessages: vi.fn(async (messages: Message[]) => messages) },
}));
vi.mock('@services/replyEnrichmentService', () => ({
  replyEnrichmentService: { enrichMessages: vi.fn(async (messages: Message[]) => messages) },
}));

const CID = '801';
const GUILD = createMockGuild({ id: '42', name: 'Raid' });
const CHANNEL = createMockChannel({ id: CID, name: 'general', guild_id: '42' });
const seed = { kind: 'channel' as const, guildId: '42', name: 'general' };

const page = (from: number, count: number): Message[] =>
  Array.from({ length: count }, (_, i) => createMockMessage({
    id: String(from - i),
    channel_id: CID,
    content: `m${from - i}`,
    timestamp: new Date(1_700_000_000_000 + (from - i) * 1000).toISOString(),
  }));

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
      cache: cacheReducer,
      export: exportReducer,
      purge: purgeReducer,
      auth: authReducer,
      user: userReducer,
      package: packageReducer,
      dev: devReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(workspacePersistenceMiddleware.middleware),
  });
}

type Store = ReturnType<typeof makeStore>;
/** The test store carries fewer slices than RootState; the thunks only read the ones it has. */
const thunk = (store: Store) => store.dispatch as unknown as AppDispatch;

function service(overrides: Record<string, unknown> = {}) {
  vi.mocked(discordService.getDiscordService).mockReturnValue({
    fetchGuilds: vi.fn().mockResolvedValue({ success: true, data: [GUILD] }),
    fetchChannels: vi.fn().mockResolvedValue({ success: true, data: [CHANNEL] }),
    fetchRoles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    fetchGuildUser: vi.fn().mockResolvedValue({ success: false }),
    fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: page(1000, 100) }),
    ...overrides,
  } as never);
}

async function openDefault(store: Store) {
  await ensureTestDefaultWorkspace();
  await acquireWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID);
  store.dispatch(setCurrentWorkspace(LEGACY_DEFAULT_WORKSPACE_ID));
  store.dispatch(setToken('token'));
}

const until = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

let others: string[] = [];

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  others = [];
  service();
});

afterEach(async () => {
  releaseWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID);
  for (const wid of others) releaseWorkspaceLock(wid);
  await deleteWorkspaceDatabase();
});

describe('boot', () => {
  it('names a workspace other than Default in a toast and loads its unfinished actions', async () => {
    const other = await createWorkspace({ name: 'Raid archive' });
    others.push(other.wid);
    await updateConversation(other.wid, CID, (c) => {
      c.action = { kind: 'loadAll', settings: { mode: 'plain' } };
    }, seed);
    await setLastWorkspace(other.wid);
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    expect(store.getState().workspace.currentName).toBe('Raid archive');
    expect(store.getState().status.toast?.message).toBe('Opened workspace Raid archive');
    expect(selectConversationAction(CID)(store.getState() as never)?.kind).toBe('loadAll');
    expect(selectHasUnfinishedWork(store.getState() as never)).toBe(true);
  });

  it('shows no toast for Default', async () => {
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    expect(store.getState().workspace.currentWid).toBe(store.getState().workspace.defaultWid);
    expect(store.getState().status.toast.isVisible).toBe(false);
  });
});

describe('switchWorkspace', () => {
  it('opens the other workspace, clears the screen and moves the lock', async () => {
    const store = makeStore();
    await openDefault(store);
    const other = await createWorkspace({ name: 'Raid archive' });
    others.push(other.wid);
    store.dispatch(setSelectedGuild(GUILD));
    store.dispatch(setSelectedChannel(CHANNEL));
    await store.dispatch(fetchMessages({ channelId: CID, token: 'token' }));
    expect(store.getState().message.rows).toHaveLength(100);

    const result = await thunk(store)(switchWorkspace({ wid: other.wid }));
    expect(result.type, JSON.stringify((result as { error?: unknown }).error)).toBe('workspace/switch/fulfilled');
    const state = store.getState();
    expect(state.workspace.currentWid).toBe(other.wid);
    expect(state.workspace.currentName).toBe('Raid archive');
    expect(state.workspace.switching).toBe(false);
    expect(state.workspace.scopeRestoredWid).toBeNull();
    expect(state.message.rows).toHaveLength(0);
    expect(state.channel.selectedChannel).toBeNull();
    expect(state.guild.selectedGuild).toBeNull();
    expect(holdsWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID)).toBe(false);
    expect(holdsWorkspaceLock(other.wid)).toBe(true);
    expect((await getMeta()).lastWid).toBe(other.wid);
    // The switch's own clearing does not overwrite Default's scope.
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect((await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))?.scope).toMatchObject({ guildId: '42', channelId: CID });
  });

  it('refuses the open workspace, a missing one and one written by a newer schema', async () => {
    const store = makeStore();
    await openDefault(store);
    const newer = await createWorkspace({ name: 'Newer' });
    others.push(newer.wid);
    await updateWorkspace(newer.wid, (w) => {
      w.schema = WORKSPACE_SCHEMA_VERSION + 1;
    });
    expect((await thunk(store)(switchWorkspace({ wid: LEGACY_DEFAULT_WORKSPACE_ID }))).payload).toBe('same');
    expect((await thunk(store)(switchWorkspace({ wid: 'gone' }))).payload).toBe('missing');
    expect((await thunk(store)(switchWorkspace({ wid: newer.wid }))).payload).toBe('needsUpdate');
    expect(store.getState().workspace.currentWid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
  });

  it('pauses a running Load All, keeps its record for Resume and writes nothing into the new workspace', async () => {
    let releaseSecond: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const fetchMessageData = vi.fn()
      .mockResolvedValueOnce({ success: true, data: page(1000, 100) })
      .mockImplementationOnce(async () => {
        await second;
        return { success: true, data: page(900, 100) };
      })
      .mockResolvedValue({ success: true, data: page(800, 100) });
    service({ fetchMessageData });
    const store = makeStore();
    await openDefault(store);
    const other = await createWorkspace({ name: 'Raid archive' });
    others.push(other.wid);
    store.dispatch(setSelectedGuild(GUILD));
    store.dispatch(setSelectedChannel(CHANNEL));

    const run = store.dispatch(fetchAllMessages({ channelId: CID, token: 'token' }));
    await until(() => fetchMessageData.mock.calls.length >= 2);
    expect(selectConversationAction(CID)(store.getState() as never)?.kind).toBe('loadAll');

    const switching = thunk(store)(switchWorkspace({ wid: other.wid }));
    await until(() => store.getState().app.discrubCancelled);
    releaseSecond();
    const ended = await run;
    expect(ended.payload).toBe('Load cancelled');
    expect((await switching).type).toBe('workspace/switch/fulfilled');

    const saved = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(saved?.action?.kind).toBe('loadAll');
    expect(saved?.complete).toBe(false);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(200);
    expect(await countRows(other.wid, CID)).toBe(0);
    expect(store.getState().workspace.currentWid).toBe(other.wid);
    expect(store.getState().app.discrubCancelled).toBe(false);
    // The open workspace's actions are the new workspace's (none).
    expect(selectHasUnfinishedWork(store.getState() as never)).toBe(false);
  });
});

describe('Load All action record', () => {
  it('is written when Load All starts and cleared when it finishes', async () => {
    const fetchMessageData = vi.fn()
      .mockResolvedValueOnce({ success: true, data: page(1000, 100) })
      .mockResolvedValueOnce({ success: true, data: page(900, 40) });
    service({ fetchMessageData });
    const store = makeStore();
    await openDefault(store);
    store.dispatch(setSelectedChannel(CHANNEL));
    const run = store.dispatch(fetchAllMessages({ channelId: CID, token: 'token' }));
    expect(selectConversationAction(CID)(store.getState() as never)).toMatchObject({ kind: 'loadAll', name: 'general' });
    await run;
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect(selectConversationAction(CID)(store.getState() as never)).toBeNull();
    const saved = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(saved?.action).toBeNull();
    expect(saved?.complete).toBe(true);
  });

  it('is cleared when the user stops the run, which stays resumable', async () => {
    const fetchMessageData = vi.fn().mockImplementation(async () => {
      if (fetchMessageData.mock.calls.length === 2) store.dispatch(setDiscrubCancelled(true));
      return { success: true, data: page(1000 - (fetchMessageData.mock.calls.length - 1) * 100, 100) };
    });
    service({ fetchMessageData });
    const store = makeStore();
    await openDefault(store);
    store.dispatch(setSelectedChannel(CHANNEL));
    const ended = await store.dispatch(fetchAllMessages({ channelId: CID, token: 'token' }));
    expect(ended.payload).toBe('Load cancelled');
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    const saved = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(saved?.action).toBeNull();
    expect(saved?.complete).toBe(false);
    expect(saved?.pagination.hasMore).toBe(true);
    expect(saved?.pagination.lastMessageId).toBe('801');
    expect(store.getState().message.pagination.lastMessageId).toBe('801');
    expect(store.getState().message.pagination.hasMore).toBe(true);
  });
});

describe('scope and anchor writes', () => {
  it('writes the scope on navigation but not while the saved scope is being restored', async () => {
    const store = makeStore();
    await openDefault(store);
    store.dispatch(setSelectedGuild(GUILD));
    store.dispatch(setSelectedChannel(CHANNEL));
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect((await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))?.scope).toEqual({ tab: null, guildId: '42', channelId: CID, dmId: null });

    store.dispatch(setSelectedChannel(null));
    store.dispatch(setSelectedGuild(null));
    const dm = createMockDmChannel({ id: '555' });
    store.dispatch(setSelectedDm(dm));
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect((await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))?.scope).toEqual({ tab: null, guildId: null, channelId: null, dmId: '555' });
  });

  it('writes the scroll anchor only into a conversation that has a record', async () => {
    const store = makeStore();
    await openDefault(store);
    store.dispatch(setSelectedChannel(CHANNEL));
    store.dispatch(feedAnchorMoved({ containerId: null, messageId: '950' }));
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();

    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(1000, 100), seed);
    store.dispatch(feedAnchorMoved({ containerId: null, messageId: '950' }));
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.scrollAnchorId).toBe('950');
  });
});

describe('restoreWorkspaceScope', () => {
  it('opens the saved server and channel from disk, with the scroll anchor', async () => {
    const store = makeStore();
    await openDefault(store);
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(1000, 100), seed);
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => {
      c.scrollAnchorId = '950';
    });
    await updateWorkspace(LEGACY_DEFAULT_WORKSPACE_ID, (w) => {
      w.scope = { tab: null, guildId: '42', channelId: CID, dmId: null };
    });
    await store.dispatch(fetchGuilds('token'));
    const fetchMessageData = vi.fn();
    service({ fetchMessageData });

    const outcome = await thunk(store)(restoreWorkspaceScope());
    expect(outcome.payload).toBe('restored');
    const state = store.getState();
    expect(state.guild.selectedGuild?.id).toBe('42');
    expect(state.channel.selectedChannel?.id).toBe(CID);
    expect(state.message.rows).toHaveLength(100);
    expect(fetchMessageData).not.toHaveBeenCalled();
    expect(selectFeedScrollAnchor(state as never)).toEqual({ key: `${CID}:main`, messageId: '950' });
    expect(state.workspace.restoringScope).toBe(false);
    expect(state.workspace.scopeRestoredWid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    // Once per workspace.
    expect(((await thunk(store)(restoreWorkspaceScope())).meta as { condition?: boolean }).condition).toBe(true);
  });

  it('leaves the screen alone when the user already picked something', async () => {
    const store = makeStore();
    await openDefault(store);
    await updateWorkspace(LEGACY_DEFAULT_WORKSPACE_ID, (w) => {
      w.scope = { tab: null, guildId: '42', channelId: CID, dmId: null };
    });
    const dm = createMockDmChannel({ id: '555' });
    store.dispatch(setSelectedDm(dm));
    expect((await thunk(store)(restoreWorkspaceScope())).payload).toBe('skipped');
    expect(store.getState().dm.selectedDm?.id).toBe('555');
    expect(store.getState().guild.selectedGuild).toBeNull();
  });

  it('stops when the user leaves the server view before the saved scope opened', async () => {
    const store = makeStore();
    await openDefault(store);
    await updateWorkspace(LEGACY_DEFAULT_WORKSPACE_ID, (w) => {
      w.scope = { tab: null, guildId: '42', channelId: CID, dmId: null };
    });
    // The servers are not loaded yet, so the restore waits for them.
    const restoring = thunk(store)(restoreWorkspaceScope());
    store.dispatch(setSelectedGuild(null));
    await store.dispatch(fetchGuilds('token'));
    expect((await restoring).payload).toBe('skipped');
    expect(store.getState().guild.selectedGuild).toBeNull();
  });

  it('answers missing when the saved channel is gone', async () => {
    service({ fetchChannels: vi.fn().mockResolvedValue({ success: true, data: [] }) });
    const store = makeStore();
    await openDefault(store);
    await updateWorkspace(LEGACY_DEFAULT_WORKSPACE_ID, (w) => {
      w.scope = { tab: null, guildId: '42', channelId: CID, dmId: null };
    });
    await store.dispatch(fetchGuilds('token'));
    expect((await thunk(store)(restoreWorkspaceScope())).payload).toBe('missing');
    expect(store.getState().guild.selectedGuild?.id).toBe('42');
  });

  it('reopens the thread tabs and the active tab', async () => {
    const store = makeStore();
    await openDefault(store);
    const threadSeed = { kind: 'thread' as const, guildId: '42', name: 'Bug talk' };
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, page(1000, 100), seed);
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, '77', page(500, 10).map((m) => ({ ...m, channel_id: '77' })), threadSeed);
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => {
      c.threadTabs = ['77'];
      c.activeTab = '77';
    });
    await updateWorkspace(LEGACY_DEFAULT_WORKSPACE_ID, (w) => {
      w.scope = { tab: null, guildId: '42', channelId: CID, dmId: null };
    });
    await store.dispatch(fetchGuilds('token'));
    await thunk(store)(restoreWorkspaceScope());
    const message = store.getState().message;
    expect(Object.keys(message.threadTabs)).toEqual(['77']);
    expect(message.threadTabs['77'].threadName).toBe('Bug talk');
    expect(message.threadTabs['77'].rows).toHaveLength(10);
    expect(message.activeTab).toBe('77');
    // The restore does not write its partial steps back.
    store.dispatch(setActiveTab(null));
    await flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.activeTab).toBeNull();
  });
});
