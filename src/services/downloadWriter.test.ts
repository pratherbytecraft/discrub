import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('drip-fs', () => ({ createStreamingDownload: vi.fn(async () => ({ tag: 'drip' })) }));
vi.mock('@/extension/messaging', () => ({ isExtensionMode: vi.fn(() => false) }));

import { createStreamingDownload } from 'drip-fs';
import { isExtensionMode } from '@/extension/messaging';
import { createBlobDownloadWriter, createDownloadWriter, isIOSSafari, stagesThroughOpfs } from './downloadWriter';

const nav = (overrides: Partial<Navigator>): Navigator =>
  ({ userAgent: '', platform: '', maxTouchPoints: 0, ...overrides }) as Navigator;

describe('isIOSSafari', () => {
  it('detects iPhone and iPad user agents', () => {
    expect(isIOSSafari(nav({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }))).toBe(true);
    expect(isIOSSafari(nav({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }))).toBe(true);
  });

  it('detects iPadOS that reports a desktop Mac UA via touch points', () => {
    expect(isIOSSafari(nav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true);
  });

  it('is false for desktop Chrome and macOS Safari', () => {
    expect(isIOSSafari(nav({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126', platform: 'Win32' }))).toBe(false);
    expect(isIOSSafari(nav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
  });
});

describe('createDownloadWriter', () => {
  const originalUA = navigator.userAgent;
  beforeEach(() => {
    vi.mocked(createStreamingDownload).mockReset();
    vi.mocked(createStreamingDownload).mockResolvedValue({ tag: 'drip' } as never);
  });
  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
    vi.restoreAllMocks();
  });

  it('delegates to drip-fs everywhere (desktop), passing the part cap as size when known', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux) Chrome/126', configurable: true });
    const w = await createDownloadWriter('x.zip');
    expect(createStreamingDownload).toHaveBeenCalledWith('x.zip');
    await createDownloadWriter('y.zip', 4 * 1024 ** 3);
    expect(createStreamingDownload).toHaveBeenLastCalledWith('y.zip', { size: 4 * 1024 ** 3 });
    expect((w as unknown as { tag: string }).tag).toBe('drip');
  });

  it('hands drip-fs a name the download URL keeps as is', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux) Chrome/126', configurable: true });
    await createDownloadWriter('Raid archive #2.discrub-workspace');
    expect(createStreamingDownload).toHaveBeenCalledWith('Raid_archive_2.discrub-workspace');
    await createDownloadWriter('my-export-2026-02-25.zip');
    expect(createStreamingDownload).toHaveBeenLastCalledWith('my-export-2026-02-25.zip');
  });

  it('delegates to drip-fs on iOS too (1.1 stages through OPFS itself)', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/126', configurable: true });
    const w = await createDownloadWriter('x.zip');
    expect(createStreamingDownload).toHaveBeenCalledWith('x.zip');
    expect((w as unknown as { tag: string }).tag).toBe('drip');
  });

  it('falls back to the Blob writer only on iOS when drip-fs throws', async () => {
    vi.mocked(createStreamingDownload).mockRejectedValue(new Error('no OPFS'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
    const w = await createDownloadWriter('x.zip');
    expect(w.bytesWritten).toBe(0);
    expect(console.warn).toHaveBeenCalled();

    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux) Chrome/126', configurable: true });
    await expect(createDownloadWriter('x.zip')).rejects.toThrow('no OPFS');
  });
});

describe('createBlobDownloadWriter', () => {
  it('buffers chunks, reports progress, and saves via a download anchor on close', async () => {
    const progress: number[] = [];
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();

    const w = createBlobDownloadWriter('export.zip', (b) => progress.push(b));
    await w.write(new Uint8Array([1, 2, 3]));
    await w.write(new Uint8Array([4]));
    expect(progress).toEqual([3, 4]);
    expect(w.bytesWritten).toBe(4);

    await w.close();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const anchor = document.querySelector('a[download="export.zip"]') as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    expect(anchor.href).toContain('blob:x');
    expect(click).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(document.querySelector('a[download="export.zip"]')).toBeNull();

    await expect(w.write(new Uint8Array([5]))).rejects.toThrow(/closed/);
    vi.useRealTimers();
    click.mockRestore();
  });
});

describe('Firefox extension zips (WP6a)', () => {
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
  class FakeHandle {
    createWritable() { return Promise.resolve(undefined); }
  }
  const originalUA = navigator.userAgent;
  const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
  let written: number[];
  let removed: string[];
  let created: string[];
  let saved: string[];

  const fakeOpfs = (quota = 10e9, usage = 0) => {
    written = [];
    removed = [];
    created = [];
    saved = [];
    const dir = {
      getFileHandle: vi.fn(async (name: string) => {
        created.push(name);
        return {
          createWritable: async () => ({
            write: async (chunk: Uint8Array) => { written.push(chunk.byteLength); },
            close: async () => undefined,
            abort: async () => undefined,
          }),
          getFile: async () => new Blob([new Uint8Array(written.reduce((a, b) => a + b, 0))]),
        };
      }),
      removeEntry: vi.fn(async (name: string) => { removed.push(name); }),
    };
    Object.defineProperty(navigator, 'storage', {
      value: {
        getDirectory: async () => ({ getDirectoryHandle: async () => dir }),
        estimate: async () => ({ quota, usage }),
      },
      configurable: true,
    });
  };

  beforeEach(() => {
    vi.mocked(createStreamingDownload).mockReset();
    vi.mocked(createStreamingDownload).mockResolvedValue({ tag: 'drip' } as never);
    vi.mocked(isExtensionMode).mockReturnValue(true);
    vi.stubGlobal('FileSystemFileHandle', FakeHandle);
    Object.defineProperty(navigator, 'userAgent', { value: FIREFOX, configurable: true });
    fakeOpfs();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
  });
  afterEach(() => {
    vi.mocked(isExtensionMode).mockReturnValue(false);
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
    else delete (navigator as unknown as { storage?: unknown }).storage;
    vi.restoreAllMocks();
  });

  it('stages through OPFS only in the Firefox extension with writable OPFS files', () => {
    const withOpfs = (userAgent: string) => ({ userAgent, storage: { getDirectory: () => Promise.resolve() } }) as unknown as Navigator;
    expect(stagesThroughOpfs(withOpfs(FIREFOX), true)).toBe(true);
    expect(stagesThroughOpfs(withOpfs(FIREFOX), false)).toBe(false);
    expect(stagesThroughOpfs(withOpfs('Mozilla/5.0 (X11; Linux) Chrome/126'), true)).toBe(false);
    expect(stagesThroughOpfs({ userAgent: FIREFOX } as Navigator, true)).toBe(false);
    vi.stubGlobal('FileSystemFileHandle', class {});
    expect(stagesThroughOpfs(withOpfs(FIREFOX), true)).toBe(false);
  });

  it('writes the part to an OPFS file, saves it on close, and removes it when the next part opens', async () => {
    const first = await createDownloadWriter('export.zip', 500_000_000);
    expect(createStreamingDownload).not.toHaveBeenCalled();
    await first.write(new Uint8Array(10));
    await first.write(new Uint8Array(5));
    expect(first.bytesWritten).toBe(15);
    await first.close();
    expect(saved).toEqual(['export.zip']);
    const second = await createDownloadWriter('export_part2.zip');
    expect(removed).toEqual([created[0]]);
    await second.abort();
    expect(removed).toEqual([created[0], created[1]]);
  });

  it('buffers in memory when there is no room to stage the part', async () => {
    fakeOpfs(1_000_000, 900_000);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await createDownloadWriter('x.zip', 500_000_000);
    expect(created).toEqual([]);
    expect(w.bytesWritten).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
