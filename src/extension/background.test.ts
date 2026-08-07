/**
 * Background Script Tests
 *
 * Tests that actually import and execute background.ts, verifying
 * message routing, tab management, icon click handling, and lifecycle events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeMocks, cleanupChromeMocks } from '../test/chrome-mocks';

// Helper to create a mock tab
function createMockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    url: 'https://discord.com/channels/@me',
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
    ...overrides,
  };
}

describe('Background Script', () => {
  let mockChrome: ReturnType<typeof installChromeMocks>;
  let messageListener: (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => boolean | void;
  let onInstalledListener: (details: chrome.runtime.InstalledDetails) => void;

  beforeEach(async () => {
    vi.resetModules();
    mockChrome = installChromeMocks();

    // Capture the listeners registered by background.ts
    mockChrome.runtime.onMessage.addListener = vi.fn((listener) => {
      messageListener = listener;
    });
    mockChrome.runtime.onInstalled.addListener = vi.fn((listener) => {
      onInstalledListener = listener as any;
    });

    // Make tabs.query use callback pattern (background.ts uses callbacks, not promises)
    mockChrome.tabs.query = vi.fn() as any;
    mockChrome.tabs.sendMessage = vi.fn() as any;
    mockChrome.tabs.update = vi.fn() as any;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Import the module — this registers all listeners
    await import('./background');
  });

  afterEach(() => {
    cleanupChromeMocks();
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should register message listener', () => {
      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledWith(
        expect.any(Function)
      );
      expect(messageListener).toBeDefined();
    });

    it('should register onInstalled listener', () => {
      expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('should register action.onClicked listener', () => {
      expect(mockChrome.action.onClicked.addListener).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('should register Discord API auth header listener', () => {
      expect(mockChrome.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        {
          urls: [
            '*://discord.com/api/*',
            '*://*.discord.com/api/*',
            '*://discordapp.com/api/*',
            '*://*.discordapp.com/api/*',
          ],
        },
        ['requestHeaders', 'extraHeaders'],
      );
    });
  });

  describe('requestToken message', () => {
    it('should query for Discord tabs and forward getToken', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      // Make tabs.query call the callback with a tab
      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      // Make tabs.sendMessage call the callback with success
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) =>
          cb({ success: true, token: 'abc123' })
      );

      const result = messageListener(
        { action: 'requestToken' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(result).toBe(true); // async response
      expect(mockChrome.tabs.query).toHaveBeenCalledWith(
        { url: ['*://discord.com/*', '*://*.discord.com/*'] },
        expect.any(Function)
      );
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        tab.id,
        { action: 'getToken' },
        expect.any(Function)
      );
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        token: 'abc123',
      });
    });

    it('should prefer a channels tab over a stale Discord login tab', () => {
      const sendResponse = vi.fn();
      const loginTab = createMockTab({
        id: 1,
        active: true,
        url: 'https://discord.com/login',
      });
      const channelsTab = createMockTab({
        id: 2,
        active: false,
        url: 'https://discord.com/channels/@me',
      });

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([loginTab, channelsTab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) =>
          cb({ success: true, token: 'abc123' })
      );

      messageListener(
        { action: 'requestToken' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        2,
        { action: 'getToken' },
        expect.any(Function)
      );
    });

    it('should return cached Authorization header token when content extraction fails', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();
      const headerListener = (mockChrome.webRequest.onBeforeSendHeaders.addListener as any)
        .mock.calls[0][0];

      headerListener({
        requestHeaders: [
          { name: 'Authorization', value: 'a'.repeat(70) },
        ],
      });

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) =>
          cb({ success: false, token: null })
      );

      messageListener(
        { action: 'requestToken' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        token: 'a'.repeat(70),
        source: 'webRequest',
      });
    });

    it('should return error when no Discord tabs found', () => {
      const sendResponse = vi.fn();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([])
      );

      messageListener(
        { action: 'requestToken' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No Discord tabs open. Please open discord.com first.',
      });
    });

    it('should handle content script communication failure', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => {
          mockChrome.runtime.lastError = {
            message: 'Could not establish connection',
          };
          cb(undefined);
          mockChrome.runtime.lastError = undefined;
        }
      );

      messageListener(
        { action: 'requestToken' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error:
          'Failed to communicate with Discord tab. Try refreshing discord.com.',
      });
    });
  });

  describe('injectOverlay message', () => {
    it('should prefer active Discord tab', () => {
      const sendResponse = vi.fn();
      const activeTab = createMockTab({ id: 5 });

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([activeTab]);
          else cb([]);
        }
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      messageListener(
        { action: 'injectOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        5,
        { action: 'injectOverlay' },
        expect.any(Function)
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should fall back to any Discord tab when no active tab', () => {
      const sendResponse = vi.fn();
      const inactiveTab = createMockTab({ id: 7, active: false });

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([]);
          else cb([inactiveTab]);
        }
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      messageListener(
        { action: 'injectOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        7,
        { action: 'injectOverlay' },
        expect.any(Function)
      );
    });

    it('should return error when no Discord tabs found', () => {
      const sendResponse = vi.fn();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([])
      );

      messageListener(
        { action: 'injectOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No Discord tabs open. Please open discord.com first.',
      });
    });

    it('should handle content script communication failure on inject', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([tab]);
          else cb([]);
        }
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => {
          mockChrome.runtime.lastError = {
            message: 'Could not establish connection',
          };
          cb(undefined);
          mockChrome.runtime.lastError = undefined;
        }
      );

      messageListener(
        { action: 'injectOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error:
          'Failed to communicate with Discord tab. Try refreshing discord.com.',
      });
    });
  });

  describe('closeOverlay message', () => {
    it('should send closeOverlay to Discord tab', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      messageListener(
        { action: 'closeOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { action: 'closeOverlay' },
        expect.any(Function)
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should return error when no Discord tabs found', () => {
      const sendResponse = vi.fn();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([])
      );

      messageListener(
        { action: 'closeOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No Discord tabs open.',
      });
    });

    it('should handle content script communication failure on close', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => {
          mockChrome.runtime.lastError = {
            message: 'Could not establish connection',
          };
          cb(undefined);
          mockChrome.runtime.lastError = undefined;
        }
      );

      messageListener(
        { action: 'closeOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to communicate with Discord tab.',
      });
    });
  });

  describe('minimizeOverlay message', () => {
    it('should send minimizeOverlay to Discord tab', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      const result = messageListener(
        { action: 'minimizeOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(result).toBe(true);
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { action: 'minimizeOverlay' },
        expect.any(Function)
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should return error when no Discord tabs found for minimize', () => {
      const sendResponse = vi.fn();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([])
      );

      messageListener(
        { action: 'minimizeOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No Discord tabs open.',
      });
    });
  });

  describe('restoreOverlay message', () => {
    it('should send restoreOverlay to Discord tab', () => {
      const sendResponse = vi.fn();
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([tab])
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      const result = messageListener(
        { action: 'restoreOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(result).toBe(true);
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { action: 'restoreOverlay' },
        expect.any(Function)
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should return error when no Discord tabs found for restore', () => {
      const sendResponse = vi.fn();

      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([])
      );

      messageListener(
        { action: 'restoreOverlay' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No Discord tabs open.',
      });
    });
  });

  describe('Unknown messages', () => {
    it('should return false for unknown message actions', () => {
      const sendResponse = vi.fn();

      const result = messageListener(
        { action: 'unknownAction' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe('Extension icon click', () => {
    let iconClickListener: (tab: chrome.tabs.Tab) => void;

    beforeEach(() => {
      iconClickListener = (mockChrome.action.onClicked.addListener as any)
        .mock.calls[0][0];
    });

    it('should inject overlay on active Discord tab', () => {
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([tab]);
          else cb([]);
        }
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      iconClickListener(tab);

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { action: 'injectOverlay' },
        expect.any(Function)
      );
    });

    it('should switch to inactive Discord tab and inject', () => {
      const inactiveTab = createMockTab({ id: 3, active: false });

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([]);
          else cb([inactiveTab]);
        }
      );
      (mockChrome.tabs.update as any).mockImplementation(
        (_id: number, _props: any, cb: Function) => cb()
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => cb({ success: true })
      );

      iconClickListener(createMockTab());

      expect(mockChrome.tabs.update).toHaveBeenCalledWith(
        3,
        { active: true },
        expect.any(Function)
      );
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        3,
        { action: 'injectOverlay' },
        expect.any(Function)
      );
    });

    it('should warn when no Discord tabs found', () => {
      (mockChrome.tabs.query as any).mockImplementation(
        (_q: any, cb: Function) => cb([])
      );

      iconClickListener(createMockTab());

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Discord tabs found')
      );
    });

    it('should handle runtime error when injecting from icon click (active tab)', () => {
      const tab = createMockTab();

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([tab]);
          else cb([]);
        }
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => {
          mockChrome.runtime.lastError = {
            message: 'Could not establish connection',
          };
          cb(undefined);
          mockChrome.runtime.lastError = undefined;
        }
      );

      iconClickListener(tab);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not inject overlay'),
        expect.any(String)
      );
    });

    it('should handle runtime error when injecting from icon click (inactive tab)', () => {
      const inactiveTab = createMockTab({ id: 3, active: false });

      (mockChrome.tabs.query as any).mockImplementation(
        (q: any, cb: Function) => {
          if (q.active) cb([]);
          else cb([inactiveTab]);
        }
      );
      (mockChrome.tabs.update as any).mockImplementation(
        (_id: number, _props: any, cb: Function) => cb()
      );
      (mockChrome.tabs.sendMessage as any).mockImplementation(
        (_id: number, _msg: any, cb: Function) => {
          mockChrome.runtime.lastError = {
            message: 'Could not establish connection',
          };
          cb(undefined);
          mockChrome.runtime.lastError = undefined;
        }
      );

      iconClickListener(createMockTab());

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not inject overlay'),
        expect.any(String)
      );
    });
  });

  describe('onInstalled event', () => {
    it('should log on install', () => {
      onInstalledListener({
        reason: 'install' as chrome.runtime.OnInstalledReason,
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Extension installed')
      );
    });

    it('should log on update with version', () => {
      onInstalledListener({
        reason: 'update' as chrome.runtime.OnInstalledReason,
        previousVersion: '0.9.0',
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Extension updated'),
        __APP_VERSION__
      );
    });
  });
});
