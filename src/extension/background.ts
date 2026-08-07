/**
 * Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * 1. Handle messages from content script and extension app
 * 2. Inject overlay on Discord tabs
 * 3. Forward token requests between content script and app
 * 4. Handle streaming downloads via setupStreamingDownloads()
 *
 * The background acts as the service worker controller for all extension pages,
 * enabling streaming downloads for both Discrub 2.0 and Discrub Classic.
 */

import { setupStreamingDownloads } from 'drip-fs/background';

setupStreamingDownloads();

console.log('[Discrub Background] Background script initialized');

type ContentMessage = { action: string } | { message: string };
type TokenResponse = { success?: boolean; token?: string | null; error?: string };

const DISCORD_TAB_URLS = ['*://discord.com/*', '*://*.discord.com/*'];
const DISCORD_API_URLS = [
  '*://discord.com/api/*',
  '*://*.discord.com/api/*',
  '*://discordapp.com/api/*',
  '*://*.discordapp.com/api/*',
];
const CACHED_TOKEN_STORAGE_KEY = 'discrubDiscordToken';

let cachedDiscordToken: string | null = null;

function isLikelyUserToken(value: string | undefined): value is string {
  if (!value) return false;
  const token = value.trim();
  return token.length > 20 && !token.toLowerCase().startsWith('bot ');
}

function cacheAuthorizationHeader(headers?: chrome.webRequest.HttpHeader[]): void {
  const header = headers?.find((item) => item.name.toLowerCase() === 'authorization');
  const value = typeof header?.value === 'string' ? header.value.trim() : undefined;

  if (isLikelyUserToken(value)) {
    cachedDiscordToken = value;
    chrome.storage?.session?.set?.({ [CACHED_TOKEN_STORAGE_KEY]: value });
    console.log('[Discrub Background] Cached Discord auth header from API request');
  }
}

function setupDiscordAuthHeaderCache(): void {
  if (!chrome.webRequest?.onBeforeSendHeaders) {
    console.warn('[Discrub Background] webRequest API is unavailable; auth header cache disabled');
    return;
  }

  const listener = (details: chrome.webRequest.WebRequestHeadersDetails): void => {
    cacheAuthorizationHeader(details.requestHeaders);
  };

  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      listener,
      { urls: DISCORD_API_URLS },
      ['requestHeaders', 'extraHeaders'],
    );
  } catch (error) {
    console.warn('[Discrub Background] extraHeaders unavailable, using requestHeaders only:', error);
    chrome.webRequest.onBeforeSendHeaders.addListener(
      listener,
      { urls: DISCORD_API_URLS },
      ['requestHeaders'],
    );
  }
}

function chooseDiscordTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab {
  return [...tabs].sort((first, second) => getDiscordTabPriority(first) - getDiscordTabPriority(second))[0];
}

function getDiscordTabPriority(tab: chrome.tabs.Tab): number {
  const url = tab.url ?? '';
  if (tab.active && url.includes('/channels/')) return 0;
  if (url.includes('/channels/')) return 1;
  if (tab.active) return 2;
  return 3;
}

function getCachedDiscordToken(callback: (token: string | null) => void): void {
  if (cachedDiscordToken) {
    callback(cachedDiscordToken);
    return;
  }

  if (!chrome.storage?.session?.get) {
    callback(null);
    return;
  }

  chrome.storage.session.get(CACHED_TOKEN_STORAGE_KEY, (items) => {
    const token = items[CACHED_TOKEN_STORAGE_KEY];
    if (typeof token === 'string' && isLikelyUserToken(token)) {
      cachedDiscordToken = token;
      callback(token);
    } else {
      callback(null);
    }
  });
}

function sendCachedTokenResponse(
  sendResponse: (response?: unknown) => void,
  fallback: () => void,
): void {
  getCachedDiscordToken((token) => {
    if (!token) {
      fallback();
      return;
    }

    sendResponse({
      success: true,
      token,
      source: 'webRequest',
    });
  });
}

setupDiscordAuthHeaderCache();

function injectContentScript(tabId: number, callback: (error?: string) => void): void {
  if (!chrome.scripting?.executeScript) {
    callback('Scripting API is unavailable.');
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId },
      files: ['content.js'],
    },
    () => {
      callback(chrome.runtime.lastError?.message);
    },
  );
}

function sendContentMessage(
  tab: chrome.tabs.Tab,
  message: ContentMessage,
  callback: (response?: unknown, error?: string) => void,
  retryWithInjection = false,
): void {
  if (!tab.id) {
    callback(undefined, 'Discord tab has no id.');
    return;
  }

  chrome.tabs.sendMessage(tab.id, message, (response) => {
    const sendError = chrome.runtime.lastError?.message;
    if (!sendError) {
      callback(response);
      return;
    }

    if (!retryWithInjection) {
      callback(undefined, sendError);
      return;
    }

    console.warn('[Discrub Background] Content script not responding, injecting fallback:', sendError);
    injectContentScript(tab.id!, (injectError) => {
      if (injectError) {
        callback(undefined, injectError);
        return;
      }

      chrome.tabs.sendMessage(tab.id!, message, (retryResponse) => {
        callback(retryResponse, chrome.runtime.lastError?.message);
      });
    });
  });
}

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Discrub Background] Received message:', message.action);

  // Extension app → request token from content script
  if (message.action === 'requestToken') {
    // Find discord.com tab
    chrome.tabs.query(
      { url: DISCORD_TAB_URLS },
      (tabs) => {
        if (tabs.length === 0) {
          console.warn('[Discrub Background] No Discord tabs found');
          sendResponse({
            success: false,
            error: 'No Discord tabs open. Please open discord.com first.'
          });
          return;
        }

        // Send message to content script on discord.com
        const discordTab = chooseDiscordTab(tabs);
        sendContentMessage(discordTab, { action: 'getToken' }, (response, error) => {
          if (error) {
            console.error('[Discrub Background] Content script not responding:', error);
            sendCachedTokenResponse(sendResponse, () => {
              sendResponse({
                success: false,
                error: 'Failed to communicate with Discord tab. Try refreshing discord.com.'
              });
            });
          } else {
            const tokenResponse = response as TokenResponse | undefined;
            console.log('[Discrub Background] Token response:', tokenResponse?.success ? 'Success' : 'Failed');
            if (tokenResponse?.success && tokenResponse.token) {
              sendResponse(response);
            } else {
              sendCachedTokenResponse(sendResponse, () => {
                sendResponse({
                  success: false,
                  token: null,
                  error: tokenResponse?.error || 'Could not retrieve token from Discord. Refresh discord.com and try again.',
                });
              });
            }
          }
        }, true);
      }
    );

    return true; // Keep channel open for async response
  }

  // Extension app → inject overlay on Discord
  if (message.action === 'injectOverlay') {
    console.log('[Discrub Background] Injecting overlay on Discord tab');

    // Find active Discord tab first, fall back to any Discord tab
    chrome.tabs.query(
      { url: ['*://discord.com/*', '*://*.discord.com/*'], active: true, currentWindow: true },
      (activeTabs) => {
        if (activeTabs.length > 0) {
          // Use active tab
          sendInjectMessage(activeTabs[0]);
        } else {
          // Fall back to any Discord tab
          chrome.tabs.query(
            { url: DISCORD_TAB_URLS },
            (allTabs) => {
              if (allTabs.length === 0) {
                console.warn('[Discrub Background] No Discord tabs found');
                sendResponse({
                  success: false,
                  error: 'No Discord tabs open. Please open discord.com first.'
                });
                return;
              }
              sendInjectMessage(allTabs[0]);
            }
          );
        }
      }
    );

    function sendInjectMessage(tab: chrome.tabs.Tab) {
      sendContentMessage(tab, { action: 'injectOverlay' }, (response, error) => {
        if (error) {
          console.error('[Discrub Background] Content script not responding:', error);
          sendResponse({
            success: false,
            error: 'Failed to communicate with Discord tab. Try refreshing discord.com.'
          });
        } else {
          const injectResponse = response as { success?: boolean } | undefined;
          console.log('[Discrub Background] Overlay injection:', injectResponse?.success ? 'Success' : 'Failed');
          sendResponse(response);
        }
      }, true);
    }

    return true; // Keep channel open for async response
  }

  // Extension app → close overlay on Discord
  if (message.action === 'closeOverlay') {
    console.log('[Discrub Background] Closing overlay on Discord tab');

    chrome.tabs.query(
      { url: ['*://discord.com/*', '*://*.discord.com/*'] },
      (tabs) => {
        if (tabs.length === 0) {
          console.warn('[Discrub Background] No Discord tabs found');
          sendResponse({
            success: false,
            error: 'No Discord tabs open.'
          });
          return;
        }

        // Send close message to content script
        const discordTab = tabs[0];
        chrome.tabs.sendMessage(
          discordTab.id!,
          { action: 'closeOverlay' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Discrub Background] Content script not responding:', chrome.runtime.lastError);
              sendResponse({
                success: false,
                error: 'Failed to communicate with Discord tab.'
              });
            } else {
              console.log('[Discrub Background] Overlay closed');
              sendResponse(response);
            }
          }
        );
      }
    );

    return true; // Keep channel open for async response
  }

  // Extension app → minimize overlay on Discord
  if (message.action === 'minimizeOverlay') {
    console.log('[Discrub Background] Minimizing overlay on Discord tab');

    chrome.tabs.query(
      { url: ['*://discord.com/*', '*://*.discord.com/*'] },
      (tabs) => {
        if (tabs.length === 0) {
          sendResponse({ success: false, error: 'No Discord tabs open.' });
          return;
        }

        const discordTab = tabs[0];
        chrome.tabs.sendMessage(
          discordTab.id!,
          { action: 'minimizeOverlay' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Discrub Background] Content script not responding:', chrome.runtime.lastError);
              sendResponse({ success: false, error: 'Failed to communicate with Discord tab.' });
            } else {
              sendResponse(response);
            }
          }
        );
      }
    );

    return true; // Keep channel open for async response
  }

  // Extension app → restore overlay on Discord
  if (message.action === 'restoreOverlay') {
    console.log('[Discrub Background] Restoring overlay on Discord tab');

    chrome.tabs.query(
      { url: ['*://discord.com/*', '*://*.discord.com/*'] },
      (tabs) => {
        if (tabs.length === 0) {
          sendResponse({ success: false, error: 'No Discord tabs open.' });
          return;
        }

        const discordTab = tabs[0];
        chrome.tabs.sendMessage(
          discordTab.id!,
          { action: 'restoreOverlay' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Discrub Background] Content script not responding:', chrome.runtime.lastError);
              sendResponse({ success: false, error: 'Failed to communicate with Discord tab.' });
            } else {
              sendResponse(response);
            }
          }
        );
      }
    );

    return true; // Keep channel open for async response
  }

  // Handle Discrub Classic messages (different format: {message: "..."} instead of {action: "..."})
  if (message.message === 'CLOSE_INJECTED_DIALOG') {
    console.log('[Discrub Background] Classic requested close');

    chrome.tabs.query(
      { url: ['*://discord.com/*', '*://*.discord.com/*'] },
      (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(
            tabs[0].id!,
            { action: 'closeOverlay' },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('[Discrub Background] Failed to close overlay:', chrome.runtime.lastError);
              }
              sendResponse(response || { success: true });
            }
          );
        }
      }
    );

    return true;
  }

  return false;
});

/**
 * Extension icon click handler - inject overlay on active Discord tab
 */
const openExtensionOverlay = () => {
  console.log('[Discrub Background] Extension icon clicked');

  // Try to inject overlay on active Discord tab
  chrome.tabs.query(
    { url: ['*://discord.com/*', '*://*.discord.com/*'], active: true, currentWindow: true },
    (activeTabs) => {
      if (activeTabs.length > 0) {
        // Active Discord tab found - inject overlay
        sendContentMessage(activeTabs[0], { action: 'injectOverlay' }, (_response, error) => {
          if (error) {
            console.warn('[Discrub Background] Could not inject overlay:', error);
          }
        }, true);
      } else {
        // No active Discord tab - check for any Discord tab
        chrome.tabs.query(
          { url: DISCORD_TAB_URLS },
          (allTabs) => {
            if (allTabs.length > 0) {
              // Discord tab exists but not active - switch to it and inject
              chrome.tabs.update(allTabs[0].id!, { active: true }, () => {
                sendContentMessage(allTabs[0], { action: 'injectOverlay' }, (_response, error) => {
                  if (error) {
                    console.warn('[Discrub Background] Could not inject overlay:', error);
                  }
                }, true);
              });
            } else {
              console.warn('[Discrub Background] No Discord tabs found. Please open discord.com first.');
            }
          }
        );
      }
    }
  );
};

chrome.action.onClicked.addListener(openExtensionOverlay);

/**
 * Extension lifecycle events
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Discrub Background] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[Discrub Background] Extension updated to version', chrome.runtime.getManifest().version);
  }
});

// Module export to allow dynamic import in tests
export {};
