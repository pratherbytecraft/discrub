/**
 * Ask the browser to mark this origin's storage as persistent, which
 * exempts the Discrub-* IndexedDB databases (settings, cache, the
 * supporter key, everything) from best-effort eviction under disk
 * pressure. Chromium grants extensions silently; a denial or a browser
 * without the API just leaves storage best-effort, exactly as today —
 * this can only upgrade, never break.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storageManager = navigator.storage;
    if (!storageManager?.persist) return false;
    if (await storageManager.persisted()) return true;
    return await storageManager.persist();
  } catch {
    return false;
  }
}

/**
 * The request made when Discrub opens (2.2.10). Firefox answers a
 * request with a permission popup, and one shown before the user has
 * done anything reads as Discrub asking for more access, so Firefox is
 * not asked here. It is still asked once a data package has been loaded
 * (`packageStreamService`). Chromium grants without a prompt.
 */
export async function requestPersistentStorageAtLaunch(): Promise<boolean> {
  try {
    if (/\bFirefox\//.test(navigator.userAgent || '')) return false;
  } catch {
    return false;
  }
  return requestPersistentStorage();
}
