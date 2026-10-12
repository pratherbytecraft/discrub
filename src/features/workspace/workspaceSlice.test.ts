import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStore } from '@/test/test-utils';
import workspaceReducer, { initializeWorkspaces, selectCurrentWid,
  selectDefaultWid, selectWorkspaceReady, setCurrentWorkspace, waitForWorkspaces } from './workspaceSlice';
import { LEGACY_DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION } from './workspaceTypes';
import {
  createWorkspace,
  deleteWorkspaceDatabase,
  getMeta,
  getWorkspace,
  releaseWorkspaceLock,
  setLastWorkspace,
  updateWorkspace,
  listWorkspaces,
} from '@services/workspaceStore';

const makeStore = () => createTestStore({ workspace: workspaceReducer });

beforeEach(async () => {
  await deleteWorkspaceDatabase();
});

afterEach(async () => {
  releaseWorkspaceLock(LEGACY_DEFAULT_WORKSPACE_ID);
  await deleteWorkspaceDatabase();
});

describe('workspaceSlice', () => {
  it('is not ready until boot ran, so writes are skipped', () => {
    const store = makeStore();
    expect(selectWorkspaceReady(store.getState())).toBe(false);
    expect(selectCurrentWid(store.getState())).toBeNull();
  });

  it('boot creates Default on a fresh install and opens it', async () => {
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    const wid = selectDefaultWid(store.getState());
    expect(wid).not.toBeNull();
    expect(wid).not.toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect(selectCurrentWid(store.getState())).toBe(wid);
    expect(selectWorkspaceReady(store.getState())).toBe(true);
    const record = await getWorkspace(wid!);
    expect(record?.name).toBe('Default');
    expect(await getMeta()).toMatchObject({ lastWid: wid, defaultWid: wid });
    releaseWorkspaceLock(wid!);
  });

  it('boot adopts a Default written under the fixed id of older builds (ws-default-id)', async () => {
    await createWorkspace({ wid: LEGACY_DEFAULT_WORKSPACE_ID, name: 'Default' });
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    expect(selectDefaultWid(store.getState())).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect(selectCurrentWid(store.getState())).toBe(LEGACY_DEFAULT_WORKSPACE_ID);
    expect((await listWorkspaces()).length).toBe(1);
  });

  it('boot opens the workspace that was open last', async () => {
    const other = await createWorkspace({ name: 'Raid archive' });
    await setLastWorkspace(other.wid);
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    expect(selectCurrentWid(store.getState())).toBe(other.wid);
    expect((await getWorkspace(other.wid))?.lastOpened).toBeGreaterThan(0);
    releaseWorkspaceLock(other.wid);
  });

  it('boot falls back to Default when the last workspace is gone or needs a newer Discrub', async () => {
    const other = await createWorkspace({ name: 'Newer' });
    await updateWorkspace(other.wid, (w) => {
      w.schema = WORKSPACE_SCHEMA_VERSION + 1;
    });
    await setLastWorkspace(other.wid);
    const store = makeStore();
    await store.dispatch(initializeWorkspaces());
    const wid = selectDefaultWid(store.getState());
    expect(selectCurrentWid(store.getState())).toBe(wid);
    expect((await getMeta()).lastWid).toBe(wid);

    await setLastWorkspace('missing');
    const again = makeStore();
    await again.dispatch(initializeWorkspaces());
    expect(selectCurrentWid(again.getState())).toBe(wid);
    releaseWorkspaceLock(wid!);
  });

  it('waitForWorkspaces waits only while boot is in flight', async () => {
    const store = makeStore();
    const boot = store.dispatch(initializeWorkspaces());
    expect(store.getState().workspace.booting).toBe(true);
    await waitForWorkspaces(store.getState);
    expect(selectWorkspaceReady(store.getState())).toBe(true);
    await boot;

    await waitForWorkspaces(() => ({}) as never);

    // A store that never booted (component tests) does not wait.
    const idle = makeStore();
    const started = Date.now();
    await waitForWorkspaces(idle.getState, 500);
    expect(Date.now() - started).toBeLessThan(100);

    // A boot that never settles is bounded by the timeout.
    const stuck = makeStore();
    stuck.dispatch({ type: initializeWorkspaces.pending.type, meta: { requestId: 'r', arg: undefined, requestStatus: 'pending' } });
    const began = Date.now();
    await waitForWorkspaces(stuck.getState, 60);
    expect(Date.now() - began).toBeGreaterThanOrEqual(50);
  });

  it('setCurrentWorkspace marks the slice ready for tests and switching', () => {
    const store = makeStore();
    store.dispatch(setCurrentWorkspace('w1'));
    expect(selectCurrentWid(store.getState())).toBe('w1');
    store.dispatch(setCurrentWorkspace(null));
    expect(selectCurrentWid(store.getState())).toBeNull();
  });
});
