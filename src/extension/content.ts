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

import { getDiscordToken } from './tokenExtraction';

/**
 * Overlay state management
 */
let overlayState: {
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

/**
 * Check if overlay is currently open
 */
function isOverlayCurrentlyOpen(): boolean {
  return overlayState.isOpen;
}

/**
 * Inject fullscreen overlay with launcher
 */
function injectFullscreenOverlay(): void {
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
          dialog.style.transformOrigin = 'bottom right';
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

/**
 * Create the floating tab element
 */
function createFloatingTab(): void {
  ensureAnimationStyles();

  const tab = document.createElement('div');
  tab.id = 'discrub-floating-tab';
  tab.style.cssText = `
    position: fixed;
    bottom: 0;
    right: 24px;
    min-width: 180px;
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

  // Click to restore
  tab.addEventListener('click', () => {
    restoreFullscreenOverlay();
  });

  // Hover lift effect
  tab.addEventListener('mouseenter', () => {
    tab.style.transform = 'translateY(-3px)';
  });
  tab.addEventListener('mouseleave', () => {
    tab.style.transform = 'translateY(0)';
  });

  document.body.appendChild(tab);
  overlayState.floatingTabElement = tab;
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingButton);
} else {
  injectFloatingButton();
}

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
