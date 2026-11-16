/**
 * Holds an extension update while a Discrub page is open (2.2.10).
 *
 * Firefox reloads an extension the moment its update arrives unless
 * `runtime.onUpdateAvailable` has a listener. That reload closed the
 * Discrub page in the middle of a Purge or an export and the progress
 * was lost. With the listener the update waits for `runtime.reload()`
 * or the next browser start, so the background applies it only when no
 * Discrub page is open: at once when none is, otherwise when the last
 * one closes. Chrome already waits for open pages on its own; there
 * this only makes the install prompt once they are gone.
 */

/** `chrome.storage.local` key holding the version that is waiting. */
export const UPDATE_PENDING_KEY = 'discrub-update-pending';
/** Asked by the background; any open Discrub page answers `{ open: true }`. */
export const PAGE_OPEN_CHECK = 'pageOpenCheck';
/** Sent by a Discrub page as it goes away. */
export const PAGE_CLOSED = 'pageClosed';
/** Time for the closing page to be gone before the background looks again. */
export const PAGE_CLOSE_SETTLE_MS = 5000;

/**
 * True when some Discrub page answers. No timeout on purpose: a page
 * busy with an export may answer late, and a wrong "no page" would
 * reload it away. The callback fires at once when nothing listens.
 */
export const anyPageOpen = (): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: PAGE_OPEN_CHECK }, (response?: { open?: boolean }) => {
        void chrome.runtime.lastError;
        resolve(response?.open === true);
      });
    } catch {
      resolve(false);
    }
  });

/**
 * Installs the waiting update unless a Discrub page is open. The waiting
 * mark is dropped first, so one mark leads to one reload at most.
 */
export const applyUpdateIfNoPages = async (): Promise<boolean> => {
  if (await anyPageOpen()) return false;
  await chrome.storage?.local?.remove(UPDATE_PENDING_KEY);
  chrome.runtime.reload();
  return true;
};

/** Background side. Call once at the top level so the listeners survive a suspended background. */
export const setupUpdateHold = (): void => {
  chrome.runtime.onUpdateAvailable?.addListener((details) => {
    void (async () => {
      if (await anyPageOpen()) {
        await chrome.storage?.local?.set({ [UPDATE_PENDING_KEY]: details.version });
        return;
      }
      chrome.runtime.reload();
    })();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== PAGE_CLOSED) return false;
    void (async () => {
      const items = await chrome.storage?.local?.get(UPDATE_PENDING_KEY);
      const waiting = items?.[UPDATE_PENDING_KEY];
      if (!waiting) return;
      // Already running that version (installed at a browser start): nothing to do.
      if (waiting === chrome.runtime.getManifest?.().version) {
        await chrome.storage?.local?.remove(UPDATE_PENDING_KEY);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, PAGE_CLOSE_SETTLE_MS));
      await applyUpdateIfNoPages();
    })();
    return false;
  });

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.storage?.local?.remove(UPDATE_PENDING_KEY);
  });
};

/** Page side. Answers the background's check and says when the page goes away. */
export const announcePageOpen = (): void => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.runtime.onMessage) return;
  let closing = false;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== PAGE_OPEN_CHECK || closing) return false;
    sendResponse({ open: true });
    return false;
  });
  window.addEventListener('pageshow', () => {
    closing = false;
  });
  window.addEventListener('pagehide', () => {
    closing = true;
    try {
      void Promise.resolve(chrome.runtime.sendMessage({ action: PAGE_CLOSED })).catch(() => undefined);
    } catch {
      // The extension is already gone.
    }
  });
};
