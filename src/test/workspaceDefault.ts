import { createWorkspace, ensureDefaultWorkspace, getWorkspace } from '@services/workspaceStore';
import { DEFAULT_WORKSPACE_NAME, LEGACY_DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';

/**
 * Default for tests, under the fixed id older builds used, so a spec can
 * name it. `ensureDefaultWorkspace` adopts the record the way boot does
 * for an install from before ws-default-id.
 */
export async function ensureTestDefaultWorkspace() {
  if (!(await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))) {
    await createWorkspace({ wid: LEGACY_DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME });
  }
  return ensureDefaultWorkspace();
}
