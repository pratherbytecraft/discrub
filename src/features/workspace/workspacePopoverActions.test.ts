/**
 * 2.2.5 WP5: the list the popover reads and the actions behind its rows
 * (plan sections 5.2 and 8).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { AppDispatch } from '@/app/store';
import { createMockMessage } from '@/test/fixtures';
import messageReducer from '@features/message/messageSlice';
import channelReducer from '@features/channel/channelSlice';
import dmReducer from '@features/dm/dmSlice';
import guildReducer from '@features/guild/guildSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import exportReducer from '@features/export/exportSlice';
import purgeReducer from '@features/purge/purgeSlice';
import authReducer from '@features/auth/authSlice';
import cacheReducer from '@features/cache/cacheSlice';
import userReducer from '@features/user/userSlice';
import packageReducer from '@features/package/packageSlice';
import devReducer from '@features/dev/devSlice';
import workspaceReducer, {
  actionRecorded,
  refreshWorkspaces,
  selectAnyUnfinishedWork,
  selectCurrentWorkspaceName,
  selectWorkspaceList,
  setCurrentWorkspace,
} from './workspaceSlice';
import {
  clearAllWorkspaces,
  clearConversationThunk,
  clearWorkspaceThunk,
  createNewWorkspace,
  deleteWorkspaceThunk,
  duplicateWorkspaceThunk,
  renameWorkspaceThunk,
} from './workspaceThunks';
import { DEFAULT_WORKSPACE_ID } from './workspaceTypes';
import {
  acquireWorkspaceLock,
  countRows,
  createWorkspace,
  deleteWorkspaceDatabase,
  ensureDefaultWorkspace,
  getConversation,
  getWorkspace,
  listWorkspaces,
  releaseWorkspaceLock,
  updateConversation,
  writePage,
} from '@services/workspaceStore';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn(() => ({})) }));

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
      auth: authReducer,
      cache: cacheReducer,
      user: userReducer,
      package: packageReducer,
      dev: devReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
}
type Store = ReturnType<typeof makeStore>;
const thunk = (store: Store) => store.dispatch as unknown as AppDispatch;
const state = (store: Store) => store.getState() as never;

const seed = { kind: 'channel' as const, guildId: 'g', name: 'general' };
const messages = (n: number) => Array.from({ length: n }, (_, i) => createMockMessage({ id: String(1000 - i), channel_id: '801' }));

async function openDefault(store: Store) {
  await ensureDefaultWorkspace();
  await acquireWorkspaceLock(DEFAULT_WORKSPACE_ID);
  store.dispatch(setCurrentWorkspace(DEFAULT_WORKSPACE_ID));
}

beforeEach(async () => {
  await deleteWorkspaceDatabase();
});
afterEach(async () => {
  releaseWorkspaceLock(DEFAULT_WORKSPACE_ID);
  await deleteWorkspaceDatabase();
});

describe('workspace list and popover actions', () => {
  it('refresh lists every workspace with its figures', async () => {
    const store = makeStore();
    await openDefault(store);
    await writePage(DEFAULT_WORKSPACE_ID, '801', messages(3), seed);
    await createWorkspace({ wid: 'w2', name: 'Raid archive' });
    await thunk(store)(refreshWorkspaces());
    const list = selectWorkspaceList(state(store));
    expect(list.map((w) => w.name)).toEqual(['Default', 'Raid archive']);
    expect(list[0].count).toBe(3);
    expect(list[0].bytes).toBeGreaterThan(0);
    expect(list[1].count).toBe(0);
  });

  it('the pill dot covers unfinished work in any workspace', async () => {
    const store = makeStore();
    await openDefault(store);
    await createWorkspace({ wid: 'w2', name: 'Raid archive' });
    await writePage('w2', '801', messages(2), seed);
    await thunk(store)(refreshWorkspaces());
    expect(selectAnyUnfinishedWork(state(store))).toBe(false);
    await updateConversation('w2', '801', (c) => {
      c.action = { kind: 'loadAll', settings: null };
    });
    await thunk(store)(refreshWorkspaces());
    expect(selectAnyUnfinishedWork(state(store))).toBe(true);
  });

  it('New makes Workspace 2 in its own colour without opening it', async () => {
    const store = makeStore();
    await openDefault(store);
    await thunk(store)(refreshWorkspaces());
    const wid = await thunk(store)(createNewWorkspace()).unwrap();
    const created = await getWorkspace(wid);
    expect(created?.name).toBe('Workspace 2');
    expect(created?.color).not.toBe('#5865f2');
    expect(store.getState().workspace.currentWid).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('rename of the open workspace updates the pill name', async () => {
    const store = makeStore();
    await openDefault(store);
    await thunk(store)(renameWorkspaceThunk({ wid: DEFAULT_WORKSPACE_ID, name: '  Main  ' }));
    expect(selectCurrentWorkspaceName(state(store))).toBe('Main');
    expect((await getWorkspace(DEFAULT_WORKSPACE_ID))?.name).toBe('Main');
  });

  it('duplicate copies the rows under a new name and colour', async () => {
    const store = makeStore();
    await openDefault(store);
    await writePage(DEFAULT_WORKSPACE_ID, '801', messages(4), seed);
    await thunk(store)(refreshWorkspaces());
    const wid = await thunk(store)(duplicateWorkspaceThunk({ wid: DEFAULT_WORKSPACE_ID })).unwrap();
    const copy = await getWorkspace(wid);
    expect(copy?.name).toBe('Default copy');
    expect(copy?.color).not.toBe('#5865f2');
    expect(await countRows(wid, '801')).toBe(4);
  });

  it('clearing a conversation drops its rows, cursor and unfinished action, keeps its filters', async () => {
    const store = makeStore();
    await openDefault(store);
    await writePage(DEFAULT_WORKSPACE_ID, '801', messages(5), seed);
    await updateConversation(DEFAULT_WORKSPACE_ID, '801', (c) => {
      c.refineCriteria = { pinned: true } as never;
      c.pagination.lastMessageId = '996';
      c.action = { kind: 'loadAll', settings: null };
    });
    store.dispatch(actionRecorded({ cid: '801', action: { cid: '801', name: 'general', kind: 'loadAll' } }));
    await thunk(store)(clearConversationThunk({ wid: DEFAULT_WORKSPACE_ID, cid: '801' }));
    const c = await getConversation(DEFAULT_WORKSPACE_ID, '801');
    expect(c?.count).toBe(0);
    expect(c?.pagination.lastMessageId).toBeNull();
    expect(c?.action).toBeNull();
    expect(c?.refineCriteria).toEqual({ pinned: true });
    expect(store.getState().workspace.actions['801']).toBeUndefined();
    expect(await countRows(DEFAULT_WORKSPACE_ID, '801')).toBe(0);
  });

  it('clearing a workspace keeps the workspace', async () => {
    const store = makeStore();
    await openDefault(store);
    await writePage(DEFAULT_WORKSPACE_ID, '801', messages(5), seed);
    await thunk(store)(clearWorkspaceThunk({ wid: DEFAULT_WORKSPACE_ID }));
    expect((await getWorkspace(DEFAULT_WORKSPACE_ID))?.bytes).toBe(0);
    expect(selectWorkspaceList(state(store))[0].count).toBe(0);
  });

  it('deleting the open workspace switches to Default first; Default is never deleted', async () => {
    const store = makeStore();
    await ensureDefaultWorkspace();
    await createWorkspace({ wid: 'w2', name: 'Raid archive' });
    await acquireWorkspaceLock('w2');
    store.dispatch(setCurrentWorkspace('w2'));
    await thunk(store)(deleteWorkspaceThunk({ wid: 'w2' })).unwrap();
    expect(store.getState().workspace.currentWid).toBe(DEFAULT_WORKSPACE_ID);
    expect(await getWorkspace('w2')).toBeNull();
    await thunk(store)(deleteWorkspaceThunk({ wid: DEFAULT_WORKSPACE_ID }));
    expect(await getWorkspace(DEFAULT_WORKSPACE_ID)).not.toBeNull();
  });

  it('sign out removes every workspace and opens an empty Default', async () => {
    const store = makeStore();
    await openDefault(store);
    await writePage(DEFAULT_WORKSPACE_ID, '801', messages(5), seed);
    await createWorkspace({ wid: 'w2', name: 'Raid archive' });
    await thunk(store)(clearAllWorkspaces());
    const all = await listWorkspaces();
    expect(all.map((w) => w.wid)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(await countRows(DEFAULT_WORKSPACE_ID, '801')).toBe(0);
    expect(store.getState().workspace.currentWid).toBe(DEFAULT_WORKSPACE_ID);
  });
});
