import { storage } from '@/extension/storage';

/**
 * Row 124 (pass 2): "Open without restoring" on the error page. The flag
 * is read and cleared by the next boot, which then skips the saved scope
 * once, so a conversation that crashes the feed does not come back on
 * every reload.
 */
const SKIP_SCOPE_RESTORE_KEY = 'scope:skipRestoreOnce';

export async function markSkipScopeRestore(): Promise<void> {
  await storage.state.set(SKIP_SCOPE_RESTORE_KEY, true);
}

/** True once when the flag was set; the flag is cleared on the way out. */
export async function takeSkipScopeRestore(): Promise<boolean> {
  try {
    const set = await storage.state.get<boolean>(SKIP_SCOPE_RESTORE_KEY);
    if (!set) return false;
    await storage.state.remove(SKIP_SCOPE_RESTORE_KEY);
    return true;
  } catch {
    return false;
  }
}
