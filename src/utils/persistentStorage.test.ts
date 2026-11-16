import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestPersistentStorage, requestPersistentStorageAtLaunch } from './persistentStorage';

const stubStorageManager = (manager: unknown) => {
  vi.stubGlobal('navigator', { storage: manager });
};

describe('requestPersistentStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests persistence when not yet granted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorageManager({ persisted: vi.fn().mockResolvedValue(false), persist });

    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('short-circuits when the origin is already persistent', async () => {
    const persist = vi.fn();
    stubStorageManager({ persisted: vi.fn().mockResolvedValue(true), persist });

    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('returns false on denial', async () => {
    stubStorageManager({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    });

    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns false without the API (never throws)', async () => {
    stubStorageManager(undefined);
    expect(await requestPersistentStorage()).toBe(false);

    stubStorageManager({});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('swallows a rejected persist call', async () => {
    stubStorageManager({
      persisted: vi.fn().mockRejectedValue(new Error('nope')),
      persist: vi.fn(),
    });

    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('requestPersistentStorageAtLaunch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not ask on Firefox, where the request is a popup', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0',
      storage: { persisted, persist },
    });

    expect(await requestPersistentStorageAtLaunch()).toBe(false);
    expect(persisted).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks on Chrome', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
      storage: { persisted: vi.fn().mockResolvedValue(false), persist },
    });

    expect(await requestPersistentStorageAtLaunch()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
