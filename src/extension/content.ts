/**
 * Content Script - Runs on discord.com pages
 *
 * Responsibilities:
 * 1. Extract Discord authentication token from localStorage
 * 2. Respond to token requests from the extension app
 * 3. Inject subtle Discrub button into Discord UI
 * 4. Inject and manage launcher splash screen overlay
 * 5. Route between Discrub 2.0, Discrub Classic, and launcher
 * 6. Minimize overlay to floating tab and restore it
 */

/**
 * Overlay state management
 */
const overlayState: {
  isOpen: boolean;
  isMinimized: boolean;
  isAnimating: boolean;
  currentView: 'launcher' | 'web' | 'classic' | null;
  dialogElement: HTMLDialogElement | null;
  iframeElement: HTMLIFrameElement | null;
  floatingTabElement: HTMLDivElement | null;
} = {
  isOpen: false,
  isMinimized: false,
  isAnimating: false,
  currentView: null,
  dialogElement: null,
  iframeElement: null,
  floatingTabElement: null,
};

/**
 * Cached Discord token — extracted once and reused for Classic injection
 */
let cachedToken: string | null = null;

/**
 * Latest Discord token observed by the MAIN-world token bridge (GitHub #9).
 * Discord no longer keeps the token in localStorage for some accounts, so the
 * bridge captures it from Discord's own request headers and relays it here.
 */
let bridgeToken: string | null = null;

/**
 * Battle-test switch: when built with DISCRUB_BRIDGE_ONLY=1, the localStorage
 * token path is disabled so the bridge is exercised on its own. Always false in
 * shipped builds.
 */
const BRIDGE_ONLY =
  (import.meta.env as Record<string, unknown>).DISCRUB_BRIDGE_ONLY === true;

/** Cross-world token relay message types (shared with token-bridge.ts). */
const TOKEN_REQUEST = 'discrub:tokenRequest';
const TOKEN_RESPONSE = 'discrub:tokenResponse';
const TOKEN_CAPTURE = 'discrub:tokenCapture';

/**
 * Receive tokens relayed by the MAIN-world bridge and keep the latest cached so
 * getDiscordToken() can stay synchronous. Runs in addition to the iframe
 * message listener below (that one ignores same-window messages).
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data) return;
  if (data.type === TOKEN_RESPONSE || data.type === TOKEN_CAPTURE) {
    if (typeof data.token === 'string' && data.token.length > 0) {
      bridgeToken = data.token.replace(/^"|"$/g, '');
    }
  }
});

/** Ask the MAIN-world bridge for the current token (primes bridgeToken). */
function requestBridgeToken(): void {
  try {
    window.postMessage({ type: TOKEN_REQUEST }, window.location.origin);
  } catch {
    /* postMessage can throw in exotic contexts — ignore */
  }
}

// Announce ourselves to the bridge on startup so it begins relaying captures.
requestBridgeToken();

/** Extension origin for secure postMessage targeting (prevents broadcast to other iframes) */
function getExtensionOrigin(): string {
  try {
    const url = chrome.runtime.getURL('');
    const origin = new URL(url).origin;
    // chrome-extension:// origins are "null" in non-browser environments (JSDOM)
    return origin && origin !== 'null' ? origin : url;
  } catch {
    return '*';
  }
}

/** Every element this script puts on the Discord page. */
const DISCRUB_ELEMENT_IDS = [
  'discrub-overlay',
  'discrub-floating-tab',
  'discrub-floating-button',
  'discrub-tab-styles',
];

/**
 * True while this script still belongs to a live extension. When the
 * extension updates, reloads or is disabled, Chrome removes every
 * chrome-extension:// iframe from the page but leaves this script running
 * with a dead runtime (`chrome.runtime.id` becomes undefined). That is the
 * open-but-empty overlay from #251: the dialog is still open, its iframe is
 * gone, and every click just re-focuses the empty dialog.
 */
function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Remove anything a previous copy of this script left on the page. Runs at
 * startup so a fresh injection starts clean instead of stacking a second
 * button next to an orphaned one.
 */
function removeLeftoverUi(): void {
  for (const id of DISCRUB_ELEMENT_IDS) {
    document.getElementById(id)?.remove();
  }
}

/**
 * This script has been orphaned by an extension update or reload. Take the
 * dead UI off the page and reset state. Discrub comes back on the next page
 * load; there is no re-injection, since that would need the scripting
 * permission and the page is fine without it.
 */
let orphanedTeardownDone = false;
function teardownOrphanedUi(): void {
  if (orphanedTeardownDone) return;
  orphanedTeardownDone = true;
  console.warn('[Discrub Content] Extension was updated or reloaded; removing the old Discrub UI from this page. Reload Discord to get it back.');
  const dialog = overlayState.dialogElement;
  if (dialog) {
    try {
      if (dialog.open) dialog.close();
    } catch {
      // Detached dialogs can throw on close; removal is what matters.
    }
  }
  removeLeftoverUi();
  overlayState.isOpen = false;
  overlayState.isMinimized = false;
  overlayState.isAnimating = false;
  overlayState.currentView = null;
  overlayState.dialogElement = null;
  overlayState.iframeElement = null;
  overlayState.floatingTabElement = null;
}

/**
 * Hold a port open to the background so an extension update or reload is
 * noticed the moment it happens, not on the next click. A port also drops
 * whenever the MV3 service worker goes idle, so a disconnect only counts as
 * orphaning when the runtime id is gone; otherwise reconnect after a beat.
 */
const RECONNECT_DELAY_MS = 1000;
function watchForExtensionReload(): void {
  // Row 56 (2.2.5 pass): Chrome can drop the port a beat before it clears
  // the runtime id, so the reconnect is where a reload is often first seen.
  // Returning quietly here left the old app frame running and writing.
  if (!isExtensionContextValid()) {
    teardownOrphanedUi();
    return;
  }
  if (typeof chrome.runtime.connect !== 'function') return;
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: 'discrub-content' });
  } catch {
    teardownOrphanedUi();
    return;
  }
  port.onDisconnect.addListener(() => {
    if (!isExtensionContextValid()) {
      teardownOrphanedUi();
      return;
    }
    setTimeout(watchForExtensionReload, RECONNECT_DELAY_MS);
  });
}

/**
 * Check if overlay is currently open
 */
function isOverlayCurrentlyOpen(): boolean {
  return overlayState.isOpen;
}

/**
 * True when state says the overlay is open but the DOM disagrees: the dialog
 * was detached (Discord's SPA re-rendered around it) or lost its iframe. In
 * that state the dialog renders as nothing, and every icon click used to just
 * re-focus the empty dialog ("clicking the icon does nothing", #251).
 */
function isOverlayStale(): boolean {
  if (!overlayState.isOpen) return false;
  const dialog = overlayState.dialogElement;
  if (!dialog || !dialog.isConnected) return true;
  const iframe = dialog.querySelector('#discrub-iframe');
  return !iframe || iframe !== overlayState.iframeElement;
}

/**
 * Drop a stale overlay so the next open takes the healthy path. Cleans up
 * whatever is still attached (dialog, floating tab) and resets the state.
 */
function discardStaleOverlay(): void {
  console.warn('[Discrub Content] Overlay state is stale (dialog or iframe missing); rebuilding');
  removeFloatingTab();
  const dialog = overlayState.dialogElement;
  if (dialog) {
    try {
      if (dialog.open) dialog.close();
    } catch {
      // Detached dialogs can throw on close in some browsers; removal is what matters.
    }
    dialog.remove();
  }
  document.getElementById('discrub-overlay')?.remove();
  const floatingButton = document.getElementById('discrub-floating-button');
  if (floatingButton) floatingButton.style.display = 'flex';
  overlayState.isOpen = false;
  overlayState.isMinimized = false;
  overlayState.isAnimating = false;
  overlayState.currentView = null;
  overlayState.dialogElement = null;
  overlayState.iframeElement = null;
  overlayState.floatingTabElement = null;
}

/**
 * Inject fullscreen overlay with launcher
 */
function injectFullscreenOverlay(): void {
  // Self-heal: a dialog that lost its iframe (or left the DOM) is rebuilt, not focused (#251).
  if (isOverlayStale()) {
    discardStaleOverlay();
  }

  // If open and minimized, restore instead of creating new
  if (overlayState.isOpen && overlayState.isMinimized) {
    restoreFullscreenOverlay();
    return;
  }

  // Prevent duplicate overlays
  if (overlayState.isOpen) {
    console.log('[Discrub Content] Overlay already open, focusing existing overlay');
    overlayState.dialogElement?.focus();
    return;
  }

  console.log('[Discrub Content] Injecting launcher overlay');

  // Create native <dialog> element for proper modal behavior
  const dialog = document.createElement('dialog');
  dialog.id = 'discrub-overlay';

  // Fullscreen dialog styles
  dialog.style.cssText = `
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    overflow: hidden;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 99999;
  `;

  // Create iframe with launcher
  const iframe = document.createElement('iframe');
  iframe.id = 'discrub-iframe';
  iframe.src = chrome.runtime.getURL('launcher.html');

  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  `;

  // Allow iframe to use storage and other features
  iframe.allow = 'storage-access *; clipboard-write *';

  dialog.appendChild(iframe);

  // Handle ESC key to close overlay
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeFullscreenOverlay();
  });

  // Inject into page
  document.body.appendChild(dialog);

  // Show modal (built-in backdrop + ESC handling)
  dialog.showModal();

  // Update state
  overlayState.isOpen = true;
  overlayState.currentView = 'launcher';
  overlayState.dialogElement = dialog;
  overlayState.iframeElement = iframe;

  console.log('[Discrub Content] Launcher overlay injected');
}

/**
 * Switch the overlay iframe to a different view
 */
function switchView(view: 'launcher' | 'web' | 'classic'): void {
  if (!overlayState.iframeElement) return;

  // import.meta.env.BROWSER is replaced at build time by vite.config.extension.ts.
  const isFirefox = (import.meta.env as Record<string, string>).BROWSER === 'firefox';

  // Firefox loads Classic directly (no wrapper) to avoid 3-level iframe nesting
  // that causes blob URL partition key errors. Chrome uses the wrapper.
  const urls: Record<string, string> = {
    launcher: chrome.runtime.getURL('launcher.html'),
    web: chrome.runtime.getURL('index.html'),
    classic: chrome.runtime.getURL(isFirefox ? 'classic/index.html' : 'classic-wrapper.html'),
  };

  console.log(`[Discrub Content] Switching view to: ${view}`);

  // Firefox direct-load: resize the overlay iframe to match classic-wrapper.html
  // dimensions (1250x675 centered) so Classic gets the same viewport as Chrome.
  // Restore fullscreen when switching back to launcher/web.
  if (isFirefox && view === 'classic') {
    overlayState.iframeElement.style.cssText = `
      width: 1250px; height: 675px; border: none; display: block;
      border-radius: 4px;
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
    `;
  } else if (isFirefox) {
    overlayState.iframeElement.style.cssText = `
      width: 100%; height: 100%; border: none; display: block;
    `;
  }

  overlayState.iframeElement.src = urls[view];
  overlayState.currentView = view;

  // After Classic loads (wrapper on Chrome, direct on Firefox), send the token
  if (view === 'classic') {
    overlayState.iframeElement.addEventListener('load', function onLoad() {
      overlayState.iframeElement?.removeEventListener('load', onLoad);
      if (cachedToken) {
        overlayState.iframeElement?.contentWindow?.postMessage(
          { type: 'discrub:token', token: cachedToken },
          getExtensionOrigin(),
        );
      }
    });
  }
}

/**
 * Close and remove fullscreen overlay
 */
function closeFullscreenOverlay(): void {
  if (!overlayState.isOpen) {
    console.log('[Discrub Content] No overlay to close');
    return;
  }

  console.log('[Discrub Content] Closing fullscreen overlay');

  // If minimized, clean up floating tab and restore dialog visibility before closing
  if (overlayState.isMinimized) {
    removeFloatingTab();
    if (overlayState.dialogElement) {
      overlayState.dialogElement.style.display = '';
    }
    overlayState.isMinimized = false;
  }

  // Show floating button again
  const floatingButton = document.getElementById('discrub-floating-button');
  if (floatingButton) {
    floatingButton.style.display = 'flex';
  }

  // Close dialog (removes backdrop)
  overlayState.dialogElement?.close();

  // Remove from DOM
  overlayState.dialogElement?.remove();

  // Reset state
  overlayState.isOpen = false;
  overlayState.isAnimating = false;
  overlayState.currentView = null;
  overlayState.dialogElement = null;
  overlayState.iframeElement = null;

  console.log('[Discrub Content] Fullscreen overlay closed');
}

/**
 * Minimize overlay to floating tab
 */
function minimizeFullscreenOverlay(): void {
  if (!overlayState.isOpen || overlayState.isMinimized || overlayState.isAnimating) {
    return;
  }

  console.log('[Discrub Content] Minimizing overlay');
  overlayState.isAnimating = true;
  ensureAnimationStyles();

  const dialog = overlayState.dialogElement;
  if (dialog) {
    dialog.style.willChange = 'transform, opacity';
    dialog.style.transformOrigin = 'bottom right';
    dialog.style.animation =
      'discrub-shrink-to-tab 250ms cubic-bezier(0.4, 0, 0.2, 1) forwards';

    dialog.addEventListener(
      'animationend',
      function onShrink() {
        dialog.removeEventListener('animationend', onShrink);

        dialog.close();
        dialog.style.display = 'none';
        dialog.style.animation = '';
        dialog.style.transformOrigin = '';
        dialog.style.willChange = '';

        // Hide the floating button
        const floatingButton = document.getElementById(
          'discrub-floating-button',
        );
        if (floatingButton) {
          floatingButton.style.display = 'none';
        }

        // Create and append floating tab (with slide-in animation)
        createFloatingTab();

        overlayState.isMinimized = true;
        overlayState.isAnimating = false;
      },
    );
  }
}

/**
 * Restore overlay from minimized floating tab
 */
function restoreFullscreenOverlay(): void {
  if (!overlayState.isOpen || !overlayState.isMinimized || overlayState.isAnimating) {
    return;
  }

  console.log('[Discrub Content] Restoring overlay');
  overlayState.isAnimating = true;

  const tab = overlayState.floatingTabElement;
  const origin = floatingTabOrigin();
  if (tab) {
    tab.style.willChange = 'transform, opacity';
    tab.style.animation =
      'discrub-tab-slide-out 200ms cubic-bezier(0.4, 0, 0.2, 1) forwards';

    tab.addEventListener(
      'animationend',
      function onSlideOut() {
        tab.removeEventListener('animationend', onSlideOut);

        // Remove tab from DOM
        removeFloatingTab();

        // Restore dialog
        const dialog = overlayState.dialogElement;
        if (dialog) {
          dialog.style.willChange = 'transform, opacity';
          dialog.style.display = '';
          dialog.showModal();
          dialog.style.transformOrigin = origin;
          dialog.style.animation =
            'discrub-expand-from-tab 250ms cubic-bezier(0.4, 0, 0.2, 1) forwards';

          dialog.addEventListener(
            'animationend',
            function onExpand() {
              dialog.removeEventListener('animationend', onExpand);
              dialog.style.animation = '';
              dialog.style.transformOrigin = '';
              dialog.style.willChange = '';

              // Post restored message to iframe
              overlayState.iframeElement?.contentWindow?.postMessage(
                { type: 'discrub:restored' },
                getExtensionOrigin(),
              );

              overlayState.isMinimized = false;
              overlayState.isAnimating = false;
            },
          );
        } else {
          overlayState.isMinimized = false;
          overlayState.isAnimating = false;
        }
      },
    );
  }
}

/**
 * Ensure animation keyframes style tag exists in the document
 */
function ensureAnimationStyles(): void {
  if (document.getElementById('discrub-tab-styles')) return;

  const style = document.createElement('style');
  style.id = 'discrub-tab-styles';
  style.textContent = `
    @keyframes discrub-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes discrub-shrink-to-tab {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(0.3) translateY(20%); }
    }
    @keyframes discrub-expand-from-tab {
      from { opacity: 0; transform: scale(0.3) translateY(20%); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes discrub-tab-slide-in {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }
    @keyframes discrub-tab-slide-out {
      from { transform: translateY(0); opacity: 1; }
      to   { transform: translateY(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}


// ---------------------------------------------------------------------------
// Floating tab position (floating-tab-drag, 2.2.6)
//
// The minimized tab used to sit at the bottom right for good, where it covered
// Discord's own search result page arrows. It can now be dragged anywhere and
// the spot is kept in chrome.storage.local so it comes back next time. A plain
// click (under the drag threshold) still restores the overlay.
// ---------------------------------------------------------------------------

const FLOATING_TAB_POSITION_KEY = 'floatingTabPosition';
const FLOATING_TAB_DRAG_THRESHOLD = 4;
const FLOATING_TAB_MARGIN = 4;

interface FloatingTabPosition {
  left: number;
  top: number;
}

function isTabPosition(value: unknown): value is FloatingTabPosition {
  return (
    typeof value === 'object' && value !== null &&
    Number.isFinite((value as FloatingTabPosition).left) &&
    Number.isFinite((value as FloatingTabPosition).top)
  );
}

/** Keep the whole tab inside the viewport. */
function clampTabPosition(pos: FloatingTabPosition, tab: HTMLElement): FloatingTabPosition {
  const width = tab.offsetWidth || 180;
  const height = tab.offsetHeight || 40;
  const maxLeft = Math.max(FLOATING_TAB_MARGIN, window.innerWidth - width - FLOATING_TAB_MARGIN);
  const maxTop = Math.max(FLOATING_TAB_MARGIN, window.innerHeight - height - FLOATING_TAB_MARGIN);
  return {
    left: Math.min(Math.max(FLOATING_TAB_MARGIN, pos.left), maxLeft),
    top: Math.min(Math.max(FLOATING_TAB_MARGIN, pos.top), maxTop),
  };
}

async function readFloatingTabPosition(): Promise<FloatingTabPosition | null> {
  try {
    const items = await chrome.storage?.local?.get(FLOATING_TAB_POSITION_KEY);
    const value = items?.[FLOATING_TAB_POSITION_KEY];
    return isTabPosition(value) ? value : null;
  } catch {
    return null;
  }
}

function saveFloatingTabPosition(pos: FloatingTabPosition): void {
  try {
    void chrome.storage?.local?.set({ [FLOATING_TAB_POSITION_KEY]: pos });
  } catch {
    // Storage is a convenience; the tab still works where it is.
  }
}

/** Docked (the default bottom right) or free at a saved spot. */
function placeFloatingTab(tab: HTMLElement, pos: FloatingTabPosition | null): void {
  if (!pos) {
    tab.style.left = '';
    tab.style.top = '';
    tab.style.bottom = '0';
    tab.style.right = '24px';
    tab.style.borderRadius = '8px 8px 0 0';
    tab.dataset.docked = 'true';
    return;
  }
  const clamped = clampTabPosition(pos, tab);
  tab.style.bottom = '';
  tab.style.right = '';
  tab.style.left = `${clamped.left}px`;
  tab.style.top = `${clamped.top}px`;
  tab.style.borderRadius = '8px';
  tab.dataset.docked = 'false';
}

/** Where the overlay grows from and shrinks to: the tab's spot. */
function floatingTabOrigin(): string {
  const tab = overlayState.floatingTabElement;
  if (!tab || tab.dataset.docked !== 'false') return 'bottom right';
  const left = parseFloat(tab.style.left) || 0;
  const top = parseFloat(tab.style.top) || 0;
  return `${left + tab.offsetWidth / 2}px ${top + tab.offsetHeight / 2}px`;
}

function makeFloatingTabDraggable(tab: HTMLElement, onClick: () => void): void {
  let start: { x: number; y: number; left: number; top: number } | null = null;
  let dragging = false;

  tab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = tab.getBoundingClientRect();
    start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    dragging = false;
    try { tab.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
  });

  tab.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dx) < FLOATING_TAB_DRAG_THRESHOLD && Math.abs(dy) < FLOATING_TAB_DRAG_THRESHOLD) return;
      dragging = true;
      tab.style.transition = 'none';
      tab.style.transform = '';
      tab.style.cursor = 'grabbing';
    }
    placeFloatingTab(tab, { left: start.left + dx, top: start.top + dy });
  });

  const finish = (event: PointerEvent) => {
    if (!start) return;
    try { tab.releasePointerCapture(event.pointerId); } catch { /* jsdom */ }
    const wasDrag = dragging;
    start = null;
    dragging = false;
    tab.style.transition = 'transform 0.2s ease';
    tab.style.cursor = 'pointer';
    if (wasDrag) {
      tab.dataset.dropped = 'true';
      saveFloatingTabPosition({ left: parseFloat(tab.style.left) || 0, top: parseFloat(tab.style.top) || 0 });
    }
  };
  tab.addEventListener('pointerup', finish);
  tab.addEventListener('pointercancel', finish);

  // The click that follows a drag is the drop, not a restore.
  tab.addEventListener('click', () => {
    if (tab.dataset.dropped === 'true') {
      delete tab.dataset.dropped;
      return;
    }
    onClick();
  });

  window.addEventListener('resize', () => {
    if (tab.isConnected && tab.dataset.docked === 'false') {
      placeFloatingTab(tab, { left: parseFloat(tab.style.left) || 0, top: parseFloat(tab.style.top) || 0 });
    }
  });
}

/**
 * Create the floating tab element
 */
function createFloatingTab(): void {
  ensureAnimationStyles();

  const tab = document.createElement('div');
  tab.id = 'discrub-floating-tab';
  tab.style.cssText = `
    position: fixed;
    min-width: 180px;
    touch-action: none;
    max-width: 280px;
    height: 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px 8px 0 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    cursor: pointer;
    z-index: 99998;
    transition: transform 0.2s ease;
    box-shadow: 0 -2px 12px rgba(102, 126, 234, 0.4);
    user-select: none;
    will-change: transform, opacity;
    animation: discrub-tab-slide-in 250ms cubic-bezier(0.4, 0, 0.2, 1);
  `;

  // Discrub icon
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('discrub.png');
  icon.alt = 'Discrub';
  icon.style.cssText = `
    width: 20px;
    height: 20px;
    border-radius: 50%;
    pointer-events: none;
  `;
  tab.appendChild(icon);

  // Status text
  const statusText = document.createElement('span');
  statusText.id = 'discrub-floating-tab-status';
  statusText.textContent = 'Discrub';
  statusText.style.cssText = `
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  `;
  tab.appendChild(statusText);

  // Activity dot
  const dot = document.createElement('span');
  dot.id = 'discrub-floating-tab-dot';
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #43b581;
    display: none;
    flex-shrink: 0;
    animation: discrub-pulse 1.5s ease-in-out infinite;
    pointer-events: none;
  `;
  tab.appendChild(dot);

  // Click to restore, drag to move (floating-tab-drag)
  makeFloatingTabDraggable(tab, restoreFullscreenOverlay);

  // Hover lift effect
  tab.addEventListener('mouseenter', () => {
    if (tab.style.cursor !== 'grabbing') tab.style.transform = 'translateY(-3px)';
  });
  tab.addEventListener('mouseleave', () => {
    if (tab.style.cursor !== 'grabbing') tab.style.transform = 'translateY(0)';
  });

  placeFloatingTab(tab, null);
  document.body.appendChild(tab);
  overlayState.floatingTabElement = tab;

  // Bring the tab back to where it was last dropped.
  void readFloatingTabPosition().then((pos) => {
    if (pos && overlayState.floatingTabElement === tab && tab.isConnected) {
      placeFloatingTab(tab, pos);
    }
  });
}

/**
 * Remove floating tab from DOM
 */
function removeFloatingTab(): void {
  overlayState.floatingTabElement?.remove();
  overlayState.floatingTabElement = null;
}

/**
 * Update the floating tab status text and activity dot
 */
function updateFloatingTabStatus(payload: { isRunning: boolean; label: string }): void {
  const statusEl = document.getElementById('discrub-floating-tab-status');
  const dotEl = document.getElementById('discrub-floating-tab-dot');

  if (statusEl) {
    statusEl.textContent = payload.isRunning ? payload.label : 'Discrub';
  }
  if (dotEl) {
    dotEl.style.display = payload.isRunning ? 'block' : 'none';
  }
}

/**
 * Listen for postMessage from iframe (launcher, Discrub, classic-wrapper)
 */
window.addEventListener('message', (event) => {
  if (event.source !== overlayState.iframeElement?.contentWindow) return;

  const { type } = event.data || {};

  switch (type) {
    case 'discrub:operationStatus':
      updateFloatingTabStatus(event.data.payload);
      break;

    case 'discrub:checkAuth': {
      // Launcher asks if we have a token
      const token = getDiscordToken();
      cachedToken = token;
      overlayState.iframeElement?.contentWindow?.postMessage(
        { type: 'discrub:authStatus', authenticated: !!token, token },
        getExtensionOrigin(),
      );
      break;
    }

    case 'discrub:launch': {
      // Launcher selected a version
      const version = event.data.version;
      if (version === 'web' || version === 'classic') {
        switchView(version);
      }
      break;
    }

    case 'discrub:requestAuth': {
      // Launcher needs auth — load Discrub with authOnly flag
      if (overlayState.iframeElement) {
        overlayState.iframeElement.src = chrome.runtime.getURL('index.html?authOnly=true');
        overlayState.currentView = 'web';
      }
      break;
    }

    case 'discrub:authenticated': {
      // Auth completed — cache token and return to launcher
      cachedToken = event.data.token;
      switchView('launcher');
      break;
    }

    case 'discrub:switchVersion': {
      // Version switcher pill clicked
      const targetVersion = event.data.version;
      if (targetVersion === 'web' || targetVersion === 'classic') {
        switchView(targetVersion);
      } else {
        switchView('launcher');
      }
      break;
    }
  }
});

/**
 * Resolve the Discord token, preferring the token captured by the MAIN-world
 * bridge (which works even when Discord neuters localStorage — GitHub #9) and
 * falling back to the legacy localStorage read.
 * @returns Discord token without quotes, or null if not found
 */
function getDiscordToken(): string | null {
  // Re-ask the bridge so the cache is fresh for the next call on this tab.
  requestBridgeToken();
  if (bridgeToken) return bridgeToken;
  return getDiscordTokenFromLocalStorage();
}

/**
 * Extract Discord authentication token from localStorage.
 * @returns Discord token without quotes, or null if not found or disabled
 */
function getDiscordTokenFromLocalStorage(): string | null {
  // Battle-test builds disable this path to verify the bridge stands alone.
  if (BRIDGE_ONLY) return null;
  try {
    // Primary location: direct token key
    const token = localStorage.getItem('token');

    if (token) {
      // Remove surrounding quotes if present
      return token.replace(/^"|"$/g, '');
    }

    // Fallback: Check other possible locations
    // (Discord may change storage structure over time)
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (key.includes('token') && !key.includes('push')) {
        const value = localStorage.getItem(key);
        if (value && value.length > 50) {
          console.log(`[Discrub Content] Found token in alternate location: ${key}`);
          return value.replace(/^"|"$/g, '');
        }
      }
    }

    console.warn('[Discrub Content] Discord token not found in localStorage');
    return null;
  } catch (error) {
    console.error('[Discrub Content] Failed to retrieve Discord token:', error);
    return null;
  }
}

/**
 * Inject Discrub button into Discord's toolbar (matching Classic's placement)
 * Falls back to a fixed-position button if toolbar elements aren't found.
 */
function injectFloatingButton(): void {
  // Don't inject if already exists
  if (document.getElementById('discrub-floating-button')) {
    return;
  }

  console.log('[Discrub Content] Injecting Discrub button');

  // Create button
  const button = document.createElement('div');
  button.id = 'discrub-floating-button';
  button.title = 'Open Discrub';

  // Create icon using Discrub logo
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('discrub.png');
  icon.alt = 'Discrub';
  icon.style.cssText = `
    width: 20px;
    height: 20px;
    pointer-events: none;
    border-radius: 50%;
  `;
  button.appendChild(icon);

  // Click handler
  button.addEventListener('click', () => {
    console.log('[Discrub Content] Button clicked');
    if (!isExtensionContextValid()) {
      teardownOrphanedUi();
      return;
    }
    if (isOverlayStale()) {
      discardStaleOverlay();
    }
    if (overlayState.isMinimized) {
      restoreFullscreenOverlay();
    } else if (isOverlayCurrentlyOpen()) {
      overlayState.dialogElement?.focus();
    } else {
      injectFullscreenOverlay();
    }
  });

  // Common button styles
  button.addEventListener('mouseenter', () => { button.style.opacity = '1'; });
  button.addEventListener('mouseleave', () => { button.style.opacity = '0.8'; });

  /**
   * Try to inject into Discord's toolbar (same approach as Classic).
   * Discord's SPA renders asynchronously, so retry if toolbar isn't found yet.
   */
  function tryInjectIntoToolbar(retries: number): void {
    const toolbarParent =
      document.querySelector('[aria-label="Inbox"]')?.parentElement ||
      document.querySelector('[aria-label="Help"]')?.parentElement;

    if (toolbarParent) {
      button.style.cssText = `
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
        transition: opacity 150ms ease;
      `;
      toolbarParent.style.display = 'flex';
      toolbarParent.style.flexDirection = 'row-reverse';
      toolbarParent.style.alignItems = 'center';
      toolbarParent.style.justifyContent = 'center';
      toolbarParent.appendChild(button);
      console.log('[Discrub Content] Button injected into Discord toolbar');
    } else if (retries > 0) {
      // Discord hasn't rendered the toolbar yet — retry
      setTimeout(() => tryInjectIntoToolbar(retries - 1), 500);
    } else {
      // Fallback — fixed position top-right
      button.style.cssText = `
        position: fixed;
        top: 12px;
        right: 60px;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        transition: opacity 150ms ease;
        opacity: 0.8;
      `;
      document.body.appendChild(button);
      console.log('[Discrub Content] Button injected as fixed fallback (toolbar not found)');
    }
  }

  tryInjectIntoToolbar(10); // Retry up to 10 times (5 seconds)
}

/**
 * Initialize content script when DOM is ready
 */
removeLeftoverUi();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingButton);
} else {
  injectFloatingButton();
}
watchForExtensionReload();

/**
 * Listen for messages from extension (background script or app)
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Discrub Content] Received message:', message.action);

  switch (message.action) {
    case 'getToken': {
      const token = getDiscordToken();
      cachedToken = token;
      const success = token !== null;
      console.log(`[Discrub Content] Token retrieval ${success ? 'successful' : 'failed'}`);
      sendResponse({ token, success });
      return true;
    }

    case 'injectOverlay': {
      try {
        injectFullscreenOverlay();
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Discrub Content] Failed to inject overlay:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return true;
    }

    case 'closeOverlay': {
      try {
        closeFullscreenOverlay();
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Discrub Content] Failed to close overlay:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return true;
    }

    case 'minimizeOverlay': {
      try {
        minimizeFullscreenOverlay();
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Discrub Content] Failed to minimize overlay:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return true;
    }

    case 'restoreOverlay': {
      try {
        restoreFullscreenOverlay();
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Discrub Content] Failed to restore overlay:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return true;
    }

    case 'isOverlayOpen': {
      sendResponse({
        isOpen: overlayState.isOpen,
        isMinimized: overlayState.isMinimized,
      });
      return true;
    }

    case 'ping': {
      sendResponse({ pong: true });
      return true;
    }

    default:
      // Handle Discrub Classic messages (format: {message: "..."} instead of {action: "..."})
      if (message.message === 'CLOSE_INJECTED_DIALOG') {
        console.log('[Discrub Content] Classic requested close');
        closeFullscreenOverlay();
        sendResponse({ success: true });
        return true;
      }
      return false;
  }
});

console.log('[Discrub Content] Content script initialized on', window.location.href);

// Module export to allow dynamic import in tests
export {};
