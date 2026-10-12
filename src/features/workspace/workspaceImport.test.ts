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
import workspaceReducer, { initializeWorkspaces, refreshWorkspaces, setCurrentWorkspace } from './workspaceSlice';
import { importName, importWorkspaceThunk } from './workspaceThunks';
import { LEGACY_DEFAULT_WORKSPACE_ID } from './workspaceTypes';
import type { WorkspaceManifest } from '@services/workspaceArchive';
import {
  acquireWorkspaceLock,
  countRows,
  deleteWorkspaceDatabase,
  getMeta,
  getWorkspace,
  installStagedWorkspace,
  listWorkspaces,
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

  it('replaces Default, keeps the name Default (row 10), and opens it again with the file\'s unfinished work', async () => {
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
      // Row 117: the import goes into a staged record beside the old one, which is still whole.
      expect(target.wid).not.toBe(LEGACY_DEFAULT_WORKSPACE_ID);
      expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '999')).toBe(1);
      await writePage(target.wid, '801', [createMockMessage({ id: '1', channel_id: '801' }), createMockMessage({ id: '2', channel_id: '801' })], { kind: 'channel', guildId: '42', name: 'general' });
      await updateConversation(target.wid, '801', (c) => {
        c.action = { kind: 'loadAll', settings: null } as never;
      });
      return { record: installed, messages: 2 };
    });
    const outcome = await thunk(store)(importWorkspaceThunk({ file: new Blob(), manifest, mode: 'replace', targetWid: LEGACY_DEFAULT_WORKSPACE_ID })).unwrap();
    expect(outcome).toBe('imported');
    const workspace = store.getState().workspace;
    const wid = workspace.currentWid!;
    expect(wid).not.toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect(await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID)).toBeNull();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '999')).toBe(0);
    expect(await countRows(wid, '801')).toBe(2);
    expect(await getMeta()).toMatchObject({ defaultWid: wid, lastWid: wid });
    expect((await listWorkspaces()).map((w) => w.wid)).toEqual([wid]);
    expect(workspace.currentName).toBe('Default');
    expect(workspace.switching).toBe(false);
    expect(workspace.scopeRestoredWid).toBeNull();
    expect(Object.keys(workspace.actions)).toEqual(['801']);
    expect(store.getState().status.toast.message).toBe('Imported Default with 2 messages');
    expect(store.getState().workspace.importing).toBeNull();
    expect(workspace.list.map((w) => w.wid)).toEqual([wid]);
    releaseWorkspaceLock(wid);
  });

  it('a file that cannot be read leaves the replaced workspace as it was (row 117)', async () => {
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, '999', [createMockMessage({ id: '50', channel_id: '999' })], { kind: 'channel', guildId: '1', name: 'old' });
    const store = makeStore();
    store.dispatch(setCurrentWorkspace(LEGACY_DEFAULT_WORKSPACE_ID));
    await thunk(store)(refreshWorkspaces());
    vi.spyOn(archive, 'importWorkspaceFile').mockImplementation(async (_source, target, install) => {
      const record = await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID);
      await install({ ...record!, conversations: {}, wid: target.wid, name: target.name });
      await writePage(target.wid, '801', [createMockMessage({ id: '1', channel_id: '801' })], { kind: 'channel', guildId: '42', name: 'general' });
      throw new archive.WorkspaceFileError('broken', 'conversations/801/0002.ndjson.gz could not be read');
    });
    const outcome = await thunk(store)(importWorkspaceThunk({ file: new Blob(), manifest, mode: 'replace', targetWid: LEGACY_DEFAULT_WORKSPACE_ID })).unwrap();
    expect(outcome).toBe('failed');
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '999')).toBe(1);
    expect((await listWorkspaces()).map((w) => w.wid)).toEqual([LEGACY_DEFAULT_WORKSPACE_ID]);
    const staged = vi.mocked(archive.importWorkspaceFile).mock.calls[0][1].wid;
    expect(await getWorkspace(staged)).toBeNull();
    expect(await countRows(staged, '801')).toBe(0);
    const workspace = store.getState().workspace;
    expect(workspace.currentWid).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect(workspace.switching).toBe(false);
    expect(store.getState().status.toast.message).toBe('Could not read this workspace file');
  });

  it('boot drops an import that never finished (row 120)', async () => {
    const record = (await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))!;
    await installStagedWorkspace({ ...record, wid: 'staged', name: 'Half read' });
    await writePage('staged', '801', [createMockMessage({ id: '1', channel_id: '801' })], { kind: 'channel', guildId: '42', name: 'general' });
    releaseWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID);
    const store = makeStore();
    await thunk(store)(initializeWorkspaces());
    expect(await getWorkspace('staged')).toBeNull();
    expect(await countRows('staged', '801')).toBe(0);
    expect((await listWorkspaces()).map((w) => w.wid)).toEqual([LEGACY_DEFAULT_WORKSPACE_ID]);
    expect(store.getState().status.entries.map((e) => e.message)).toContain('An import that did not finish was removed.');
  });
});
