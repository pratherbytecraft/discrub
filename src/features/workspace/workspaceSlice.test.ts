import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStore } from '@/test/test-utils';
import workspaceReducer, { initializeWorkspaces, selectCurrentWid, selectWorkspaceReady, setCurrentWorkspace, waitForWorkspaces } from './workspaceSlice';
import { DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION } from './workspaceTypes';
import {
  createWorkspace,
  deleteWorkspaceDatabase,
  getMeta,
  getWorkspace,
  releaseWorkspaceLock,
  setLastWorkspace,
  updateWorkspace,
} from '@services/workspaceStore';

const makeStore = () => createTestStore({ workspace: workspaceReducer });

beforeEach(async () => {
  await deleteWorkspaceDatabase();
});

afterEach(async () => {
  releaseWorkspaceLock(DEFAULT_WORKSPACE_ID);
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
    expect(selectCurrentWid(store.getState())).toBe(DEFAULT_WORKSPACE_ID);
    expect(selectWorkspaceReady(store.getState())).toBe(true);
    const record = await getWorkspace(DEFAULT_WORKSPACE_ID);
    expect(record?.name).toBe('Default');
    expect((await getMeta()).lastWid).toBe(DEFAULT_WORKSPACE_ID);
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
    expect(selectCurrentWid(store.getState())).toBe(DEFAULT_WORKSPACE_ID);
    expect((await getMeta()).lastWid).toBe(DEFAULT_WORKSPACE_ID);

    await setLastWorkspace('missing');
    const again = makeStore();
    await again.dispatch(initializeWorkspaces());
    expect(selectCurrentWid(again.getState())).toBe(DEFAULT_WORKSPACE_ID);
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
