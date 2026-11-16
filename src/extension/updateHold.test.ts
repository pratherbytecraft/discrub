import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  announcePageOpen,
  PAGE_CLOSED,
  PAGE_CLOSE_SETTLE_MS,
  PAGE_OPEN_CHECK,
  setupUpdateHold,
  UPDATE_PENDING_KEY,
} from './updateHold';

type Listener = (...args: any[]) => unknown;

/** A small stand-in for the parts of `chrome` the update hold touches. */
const fakeChrome = () => {
  const stored = new Map<string, unknown>();
  const listeners = { update: [] as Listener[], message: [] as Listener[], installed: [] as Listener[] };
  /** What an open page would answer, or undefined when no page is open. */
  let pageAnswer: { open: boolean } | undefined;
  const chromeMock = {
    runtime: {
      id: 'test',
      lastError: undefined as { message: string } | undefined,
      reload: vi.fn(),
      getManifest: () => ({ version: '2.2.10' }),
      sendMessage: vi.fn((_message: unknown, callback?: (response?: unknown) => void) => {
        callback?.(pageAnswer);
        return Promise.resolve(pageAnswer);
      }),
      onUpdateAvailable: { addListener: (l: Listener) => listeners.update.push(l) },
      onMessage: { addListener: (l: Listener) => listeners.message.push(l) },
      onInstalled: { addListener: (l: Listener) => listeners.installed.push(l) },
    },
    storage: {
      local: {
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.entries(items).forEach(([k, v]) => stored.set(k, v));
        }),
        get: vi.fn(async (key: string) => (stored.has(key) ? { [key]: stored.get(key) } : {})),
        remove: vi.fn(async (key: string) => {
          stored.delete(key);
        }),
      },
    },
  };
  return {
    chromeMock,
    stored,
    listeners,
    setPageOpen: (open: boolean) => {
      pageAnswer = open ? { open: true } : undefined;
    },
  };
};

describe('update hold, background side', () => {
  let env: ReturnType<typeof fakeChrome>;

  beforeEach(() => {
    vi.useFakeTimers();
    env = fakeChrome();
    vi.stubGlobal('chrome', env.chromeMock);
    setupUpdateHold();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('listens for an update so the browser does not reload the extension by itself', () => {
    expect(env.listeners.update).toHaveLength(1);
  });

  it('installs the update at once when no Discrub page is open', async () => {
    env.setPageOpen(false);
    env.listeners.update[0]({ version: '2.2.11' });
    await vi.runAllTimersAsync();
    expect(env.chromeMock.runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('holds the update while a Discrub page is open and remembers the version', async () => {
    env.setPageOpen(true);
    env.listeners.update[0]({ version: '2.2.11' });
    await vi.runAllTimersAsync();
    expect(env.chromeMock.runtime.reload).not.toHaveBeenCalled();
    expect(env.stored.get(UPDATE_PENDING_KEY)).toBe('2.2.11');
  });

  it('installs a held update once the last page has closed', async () => {
    env.setPageOpen(true);
    env.listeners.update[0]({ version: '2.2.11' });
    await vi.runAllTimersAsync();
    env.setPageOpen(false);
    env.listeners.message.forEach((l) => l({ action: PAGE_CLOSED }, {}, vi.fn()));
    await vi.advanceTimersByTimeAsync(PAGE_CLOSE_SETTLE_MS - 1);
    expect(env.chromeMock.runtime.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(env.chromeMock.runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps holding when one page closes and another is still open', async () => {
    env.setPageOpen(true);
    env.listeners.update[0]({ version: '2.2.11' });
    env.listeners.message.forEach((l) => l({ action: PAGE_CLOSED }, {}, vi.fn()));
    await vi.runAllTimersAsync();
    expect(env.chromeMock.runtime.reload).not.toHaveBeenCalled();
  });

  it('does not reload on a page close when no update is waiting', async () => {
    env.setPageOpen(false);
    env.listeners.message.forEach((l) => l({ action: PAGE_CLOSED }, {}, vi.fn()));
    await vi.runAllTimersAsync();
    expect(env.chromeMock.runtime.reload).not.toHaveBeenCalled();
  });

  it('drops the mark before it reloads, so one mark gives one reload', async () => {
    env.setPageOpen(true);
    env.listeners.update[0]({ version: '2.2.11' });
    await vi.runAllTimersAsync();
    env.setPageOpen(false);
    env.listeners.message.forEach((l) => l({ action: PAGE_CLOSED }, {}, vi.fn()));
    await vi.runAllTimersAsync();
    expect(env.stored.has(UPDATE_PENDING_KEY)).toBe(false);
    env.listeners.message.forEach((l) => l({ action: PAGE_CLOSED }, {}, vi.fn()));
    await vi.runAllTimersAsync();
    expect(env.chromeMock.runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for a version that is already running', async () => {
    env.stored.set(UPDATE_PENDING_KEY, '2.2.10');
    env.setPageOpen(false);
    env.listeners.message.forEach((l) => l({ action: PAGE_CLOSED }, {}, vi.fn()));
    await vi.runAllTimersAsync();
    expect(env.chromeMock.runtime.reload).not.toHaveBeenCalled();
    expect(env.stored.has(UPDATE_PENDING_KEY)).toBe(false);
  });

  it('leaves no mark when the update installs at once', async () => {
    env.setPageOpen(false);
    env.listeners.update[0]({ version: '2.2.11' });
    await vi.runAllTimersAsync();
    expect(env.stored.has(UPDATE_PENDING_KEY)).toBe(false);
  });

  it('forgets the waiting version once an install or update has happened', async () => {
    env.stored.set(UPDATE_PENDING_KEY, '2.2.11');
    env.listeners.installed[0]({ reason: 'update' });
    await vi.runAllTimersAsync();
    expect(env.stored.has(UPDATE_PENDING_KEY)).toBe(false);
  });
});

describe('update hold, page side', () => {
  let env: ReturnType<typeof fakeChrome>;

  beforeEach(() => {
    env = fakeChrome();
    vi.stubGlobal('chrome', env.chromeMock);
    announcePageOpen();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers the background check while open and ignores other messages', () => {
    const respond = vi.fn();
    env.listeners.message[0]({ action: PAGE_OPEN_CHECK }, {}, respond);
    expect(respond).toHaveBeenCalledWith({ open: true });
    const other = vi.fn();
    env.listeners.message[0]({ action: 'requestToken' }, {}, other);
    expect(other).not.toHaveBeenCalled();
  });

  it('says it closed on pagehide and stops answering the check', () => {
    window.dispatchEvent(new Event('pagehide'));
    expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ action: PAGE_CLOSED });
    const respond = vi.fn();
    env.listeners.message[0]({ action: PAGE_OPEN_CHECK }, {}, respond);
    expect(respond).not.toHaveBeenCalled();
  });
});
