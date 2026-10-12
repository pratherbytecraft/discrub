/**
 * 2.2.5 WP6b: importing a workspace file over the open workspace, and
 * the names an import takes beside a match.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
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
import packageReducer from '@features/package/packageSlice';
import devReducer from '@features/dev/devSlice';
import cacheReducer from '@features/cache/cacheSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import workspaceReducer, { refreshWorkspaces, setCurrentWorkspace } from './workspaceSlice';
import { importName, importWorkspaceThunk } from './workspaceThunks';
import { LEGACY_DEFAULT_WORKSPACE_ID } from './workspaceTypes';
import type { WorkspaceManifest } from '@services/workspaceArchive';
import {
  acquireWorkspaceLock,
  countRows,
  deleteWorkspaceDatabase,
  getWorkspace,
  releaseWorkspaceLock,
  updateConversation,
  writePage,
} from '@services/workspaceStore';
import * as archive from '@services/workspaceArchive';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn() }));

const reducer = combineReducers({
  message: messageReducer, workspace: workspaceReducer, channel: channelReducer, dm: dmReducer, guild: guildReducer,
  app: appReducer, status: statusReducer, export: exportReducer, purge: purgeReducer, package: packageReducer,
  dev: devReducer, cache: cacheReducer, auth: authReducer, user: userReducer,
});

function makeStore(purging = false) {
  const purge = { ...purgeReducer(undefined, { type: 'init' }), isPurging: purging };
  return configureStore({
    reducer,
    preloadedState: { purge } as Partial<ReturnType<typeof reducer>>,
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
}
const thunk = (store: ReturnType<typeof makeStore>) => store.dispatch as unknown as AppDispatch;

const manifest: WorkspaceManifest = {
  format: 'discrub-workspace', schema: 1, appVersion: '2.2.5', wid: 'elsewhere', name: 'Old raids', color: '#3ba55c',
  createdAt: 1, exportedAt: 2, conversations: 1, messages: 2, bytes: 1,
};

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
  await acquireWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID);
});

afterEach(async () => {
  releaseWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID);
  vi.restoreAllMocks();
  await deleteWorkspaceDatabase();
});

describe('importName', () => {
  it('numbers a name already taken', () => {
    expect(importName('Raid archive', ['Default'])).toBe('Raid archive');
    expect(importName('Raid archive', ['Raid archive'])).toBe('Raid archive (2)');
    expect(importName('Raid archive', ['Raid archive', 'Raid archive (2)'])).toBe('Raid archive (3)');
  });
});

describe('importWorkspaceThunk over the open workspace', () => {
  it('is refused while a run is going', async () => {
    const store = makeStore(true);
    store.dispatch(setCurrentWorkspace(LEGACY_DEFAULT_WORKSPACE_ID));
    const spy = vi.spyOn(archive, 'importWorkspaceFile');
    const outcome = await thunk(store)(importWorkspaceThunk({ file: new Blob(), manifest, mode: 'replace', targetWid: LEGACY_DEFAULT_WORKSPACE_ID })).unwrap();
    expect(outcome).toBe('busy');
    expect(spy).not.toHaveBeenCalled();
    expect(store.getState().status.toast.message).toBe('Wait for the running action to finish or stop it first.');
  });

  it('replaces Default and opens it again with the file\'s unfinished work', async () => {
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, '999', [createMockMessage({ id: '50', channel_id: '999' })], { kind: 'channel', guildId: '1', name: 'old' });
    const store = makeStore();
    store.dispatch(setCurrentWorkspace(LEGACY_DEFAULT_WORKSPACE_ID));
    await thunk(store)(refreshWorkspaces());
    vi.spyOn(archive, 'importWorkspaceFile').mockImplementation(async (_source, target, install) => {
      const record = await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID);
      const installed = await install({
        ...record!,
        conversations: {},
        wid: target.wid,
        name: target.name,
      });
      await writePage(target.wid, '801', [createMockMessage({ id: '1', channel_id: '801' }), createMockMessage({ id: '2', channel_id: '801' })], { kind: 'channel', guildId: '42', name: 'general' });
      await updateConversation(target.wid, '801', (c) => {
        c.action = { kind: 'loadAll', settings: null } as never;
      });
      return { record: installed, messages: 2 };
    });
    const outcome = await thunk(store)(importWorkspaceThunk({ file: new Blob(), manifest, mode: 'replace', targetWid: LEGACY_DEFAULT_WORKSPACE_ID })).unwrap();
    expect(outcome).toBe('imported');
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '999')).toBe(0);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '801')).toBe(2);
    const workspace = store.getState().workspace;
    expect(workspace.currentWid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect(workspace.currentName).toBe('Old raids');
    expect(workspace.switching).toBe(false);
    expect(workspace.scopeRestoredWid).toBeNull();
    expect(Object.keys(workspace.actions)).toEqual(['801']);
    expect(store.getState().status.toast.message).toBe('Imported Old raids with 2 messages');
  });
});
