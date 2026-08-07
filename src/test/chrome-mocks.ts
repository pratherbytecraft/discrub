/**
 * Chrome Extension API Mocks for Testing
 *
 * Provides mock implementations of chrome.* APIs used by the extension.
 * Install with installChromeMocks() in test setup.
 */

import { vi } from 'vitest';

/**
 * Mock message listeners
 */
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

/**
 * Mock tab click listeners
 */
type TabClickListener = (tab: chrome.tabs.Tab) => void;

/**
 * Default mock tab properties
 */
const defaultTabProps: chrome.tabs.Tab = {
  id: 1,
  index: 0,
  pinned: false,
  highlighted: false,
  windowId: 1,
  active: true,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  frozen: false,
};

/**
 * Mock Chrome runtime API
 */
export function createRuntimeMock() {
  const listeners: MessageListener[] = [];

  return {
    id: 'test-extension-id',
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    sendMessage: vi.fn((_message: unknown, callback?: (response: unknown) => void) => {
      // Simulate async response
      if (callback) {
        setTimeout(() => callback({ success: true }), 0);
      }
      return Promise.resolve({ success: true });
    }),
    onMessage: {
      addListener: vi.fn((listener: MessageListener) => {
        listeners.push(listener);
      }),
      removeListener: vi.fn((listener: MessageListener) => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }),
      hasListener: vi.fn((listener: MessageListener) => listeners.includes(listener)),
      // Helper for tests to trigger messages
      _triggerMessage: (message: unknown, sender = {}, sendResponse = vi.fn()) => {
        listeners.forEach((listener) => listener(message, sender as chrome.runtime.MessageSender, sendResponse));
      },
    },
    onInstalled: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
    lastError: undefined as chrome.runtime.LastError | undefined,
    getManifest: vi.fn(() => ({
      version: __APP_VERSION__,
      name: 'Test Extension',
      manifest_version: 3,
    })),
  };
}

/**
 * Mock Chrome tabs API
 */
export function createTabsMock() {
  return {
    create: vi.fn(
      (
        createProperties: chrome.tabs.CreateProperties,
        callback?: (tab: chrome.tabs.Tab) => void
      ) => {
        const tab: chrome.tabs.Tab = {
          ...defaultTabProps,
          url: createProperties.url,
        };
        if (callback) {
          setTimeout(() => callback(tab), 0);
        }
        return Promise.resolve(tab);
      }
    ),
    query: vi.fn(
      (
        _queryInfo: chrome.tabs.QueryInfo,
        callback?: (tabs: chrome.tabs.Tab[]) => void
      ) => {
        // Default: return empty array (no Discord tabs)
        const tabs: chrome.tabs.Tab[] = [];
        if (callback) {
          setTimeout(() => callback(tabs), 0);
        }
        return Promise.resolve(tabs);
      }
    ),
    sendMessage: vi.fn(
      (
        _tabId: number,
        _message: unknown,
        callback?: (response: unknown) => void
      ) => {
        if (callback) {
          setTimeout(() => callback({ success: true }), 0);
        }
        return Promise.resolve({ success: true });
      }
    ),
    update: vi.fn(
      (
        tabId: number,
        _updateProperties: chrome.tabs.UpdateProperties,
        callback?: (tab?: chrome.tabs.Tab) => void
      ) => {
        const tab: chrome.tabs.Tab = {
          ...defaultTabProps,
          id: tabId,
        };
        if (callback) {
          setTimeout(() => callback(tab), 0);
        }
        return Promise.resolve(tab);
      }
    ),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
  };
}

/**
 * Mock Chrome storage API
 */
export function createStorageMock() {
  const storage = new Map<string, unknown>();

  return {
    local: {
      get: vi.fn((keys: string | string[] | null, callback?: (items: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        if (keys === null) {
          storage.forEach((value, key) => {
            result[key] = value;
          });
        } else if (typeof keys === 'string') {
          const value = storage.get(keys);
          if (value !== undefined) {
            result[keys] = value;
          }
        } else {
          keys.forEach((key) => {
            const value = storage.get(key);
            if (value !== undefined) {
              result[key] = value;
            }
          });
        }
        if (callback) {
          setTimeout(() => callback(result), 0);
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
        Object.entries(items).forEach(([key, value]) => {
          storage.set(key, value);
        });
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[], callback?: () => void) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys;
        keysArray.forEach((key) => storage.delete(key));
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return Promise.resolve();
      }),
      clear: vi.fn((callback?: () => void) => {
        storage.clear();
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return Promise.resolve();
      }),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
  };
}

/**
 * Mock Chrome action API (MV3)
 */
export function createActionMock() {
  const listeners: TabClickListener[] = [];

  return {
    onClicked: {
      addListener: vi.fn((listener: TabClickListener) => {
        listeners.push(listener);
      }),
      removeListener: vi.fn((listener: TabClickListener) => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }),
      hasListener: vi.fn((listener: TabClickListener) => listeners.includes(listener)),
    },
    setIcon: vi.fn(),
    setTitle: vi.fn(),
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  };
}

/**
 * Mock Chrome scripting API (MV3)
 */
export function createScriptingMock() {
  return {
    executeScript: vi.fn(
      (
        _injection: chrome.scripting.ScriptInjection<[], unknown>,
        callback?: (results?: chrome.scripting.InjectionResult<unknown>[]) => void
      ) => {
        if (callback) {
          callback([]);
        }
        return Promise.resolve([]);
      }
    ),
  };
}

/**
 * Mock Chrome webRequest API
 */
export function createWebRequestMock() {
  return {
    onBeforeSendHeaders: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
  };
}

/**
 * Create full Chrome API mock
 */
export function createChromeMocks() {
  return {
    runtime: createRuntimeMock(),
    tabs: createTabsMock(),
    storage: createStorageMock(),
    action: createActionMock(),
    scripting: createScriptingMock(),
    webRequest: createWebRequestMock(),
  };
}

/**
 * Install Chrome mocks globally
 */
export function installChromeMocks() {
  const mocks = createChromeMocks();
  (globalThis as unknown as { chrome: typeof mocks }).chrome = mocks;
  return mocks;
}

/**
 * Cleanup Chrome mocks
 */
export function cleanupChromeMocks() {
  delete (globalThis as { chrome?: unknown }).chrome;
}

/**
 * Get current Chrome mocks (throws if not installed)
 */
export function getChromeMocks() {
  const chrome = (globalThis as unknown as { chrome?: ReturnType<typeof createChromeMocks> }).chrome;
  if (!chrome) {
    throw new Error('Chrome mocks not installed. Call installChromeMocks() first.');
  }
  return chrome;
}
