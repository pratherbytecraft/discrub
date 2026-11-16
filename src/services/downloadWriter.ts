import { createStreamingDownload } from 'drip-fs';
import type { StreamDownloadWriter } from 'drip-fs';
import { isExtensionMode } from '@/extension/messaging';

/**
 * iOS Safari (iPhone, iPad, and iPadOS reporting as "MacIntel" with touch)
 * cannot take the drip-fs service-worker stream: it navigates the tab to
 * the hidden-iframe download URL, which unloads the app and, with a
 * memory-only token, lands on the sign-in screen. Those browsers get a
 * buffered Blob + `<a download>` instead (share sheet, page stays put).
 */
export const isIOSSafari = (nav: Navigator = navigator): boolean => {
  const ua = nav.userAgent || '';
  const applePhone = /iP(hone|ad|od)/.test(ua);
  const iPadOSDesktopUA = nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
  return applePhone || iPadOSDesktopUA;
};

/**
 * drip-fs puts the file name into the download URL as is. Chrome encodes
 * a space, a # or a non ASCII letter there, the URL no longer matches,
 * and no file is saved while the export still finishes (2.2.5 row 30).
 * Anything but letters, digits, dot, dash and underscore becomes one
 * underscore.
 */
export const urlSafeFileName = (filename: string): string =>
  filename.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '');

/** Buffered writer with the drip-fs `StreamDownloadWriter` shape. */
export const createBlobDownloadWriter = (
  filename: string,
  onProgress?: (bytes: number) => void,
): StreamDownloadWriter => {
  const chunks: Uint8Array[] = [];
  let bytesWritten = 0;
  let closed = false;
  return {
    async write(chunk: Uint8Array) {
      if (closed) throw new Error('Cannot write to closed stream');
      chunks.push(chunk);
      bytesWritten += chunk.byteLength;
      onProgress?.(bytesWritten);
    },
    async close() {
      if (closed) return;
      closed = true;
      const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
      chunks.length = 0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
    },
    async abort() {
      closed = true;
      chunks.length = 0;
    },
    get bytesWritten() {
      return bytesWritten;
    },
  } as StreamDownloadWriter;
};

/** drip-fs's staging folder, so its startup sweep also clears parts this writer left behind. */
const STAGING_DIR = 'drip-fs-staging';
/** Staged parts already handed to the browser, oldest first. */
const finishedStaged: { name: string; savedAt: number }[] = [];
/** A saved part is never removed sooner than this after its save began. */
export const MIN_STAGED_AGE_MS = 30_000;
/**
 * How long a saved part stays staged when nothing removes it sooner: a
 * minute, or longer for a big part so a slow disk has time to copy it.
 * Firefox 159 needs the file for about 20 ms after the click (measured
 * 2026-11-15); this is there so the last parts of an export do not sit in
 * storage until the page closes.
 */
export const stagedLifetimeMs = (bytes: number): number => Math.max(60_000, Math.ceil(bytes / 10_000));

const formatBytes = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(n / 1024 ** 2)} MB`;

/**
 * The Firefox extension page has no service worker for drip-fs to stream
 * through, and its content security policy refuses the blob worker
 * drip-fs's own OPFS mode starts. Firefox does allow a writable stream on
 * an OPFS file from the page itself, so there the zip part is written to
 * the origin private file system and saved when it closes (2.2.5 WP6a).
 * Memory stays flat however big the part.
 */
export const stagesThroughOpfs = (nav: Navigator = navigator, extension: boolean = isExtensionMode()): boolean =>
  extension &&
  /\bFirefox\//.test(nav.userAgent || '') &&
  typeof nav.storage?.getDirectory === 'function' &&
  typeof FileSystemFileHandle !== 'undefined' &&
  'createWritable' in FileSystemFileHandle.prototype;

/** Saves a finished file through a hidden `<a download>`. */
const saveFile = (file: Blob, filename: string): void => {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
};

/**
 * A writer with the drip-fs shape that stages the part in OPFS through
 * `createWritable` on the page.
 *
 * Firefox opens the staged file some time after the save link is
 * clicked. A file removed before then gives a "File not found" tab and
 * the part is never saved, while the export carries on (2.2.10). So the
 * part saved last stays staged when the next one opens, and only the
 * parts before it are removed. A saved part that nothing removed is
 * removed on a timer (`stagedLifetimeMs`), which clears the last parts
 * of an export.
 */
export const createOpfsDownloadWriter = async (filename: string, size?: number): Promise<StreamDownloadWriter> => {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(STAGING_DIR, { create: true });
  while (finishedStaged.length > 1) {
    const old = finishedStaged.shift()!;
    await dir.removeEntry(old.name).catch(() => undefined);
  }
  if (size && size > 0) {
    const hasRoom = async (): Promise<boolean> => {
      const estimate = await navigator.storage.estimate?.().catch(() => undefined);
      return !(estimate?.quota != null && estimate.usage != null && estimate.quota - estimate.usage < size);
    };
    if (!(await hasRoom())) {
      // The kept part is the only thing left to free. Give its save time to start first.
      const kept = finishedStaged.shift();
      if (kept) {
        const wait = MIN_STAGED_AGE_MS - (Date.now() - kept.savedAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        await dir.removeEntry(kept.name).catch(() => undefined);
      }
      if (!kept || !(await hasRoom())) {
        throw new Error(`Not enough free storage to stage a ${formatBytes(size)} download part.`);
      }
    }
  }
  const stagedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const handle = await dir.getFileHandle(stagedName, { create: true });
  const stream = await handle.createWritable();
  let bytesWritten = 0;
  let closed = false;
  return {
    async write(chunk: Uint8Array) {
      if (closed) throw new Error('Cannot write to closed stream');
      await stream.write(chunk as FileSystemWriteChunkType);
      bytesWritten += chunk.byteLength;
    },
    async close() {
      if (closed) return;
      closed = true;
      await stream.close();
      saveFile(await handle.getFile(), filename);
      const saved = { name: stagedName, savedAt: Date.now() };
      finishedStaged.push(saved);
      setTimeout(() => {
        const at = finishedStaged.indexOf(saved);
        if (at === -1) return;
        finishedStaged.splice(at, 1);
        void dir.removeEntry(stagedName).catch(() => undefined);
      }, stagedLifetimeMs(bytesWritten));
    },
    async abort() {
      if (closed) return;
      closed = true;
      await stream.abort().catch(() => undefined);
      await dir.removeEntry(stagedName).catch(() => undefined);
    },
    get bytesWritten() {
      return bytesWritten;
    },
  } as StreamDownloadWriter;
};

/**
 * drip-fs 1.1 picks the path itself (service-worker stream, or an
 * OPFS-staged file on iOS WebKit where iframe downloads are forbidden).
 * The Firefox extension stages through OPFS with the writer above. The
 * in-memory Blob writer stays as the last resort for iOS devices and
 * Firefox when the staged file cannot be opened (old WebKit without OPFS
 * sync access handles, or a storage-quota refusal).
 */
export const createDownloadWriter = async (
  filename: string,
  /** Max bytes this part may reach; lets the OPFS path check free storage up front. */
  size?: number,
): Promise<StreamDownloadWriter> => {
  const opfs = stagesThroughOpfs();
  try {
    if (opfs) return await createOpfsDownloadWriter(filename, size);
    const streamed = urlSafeFileName(filename) || 'download';
    return size && size > 0
      ? await createStreamingDownload(streamed, { size })
      : await createStreamingDownload(streamed);
  } catch (err) {
    if (!opfs && !isIOSSafari()) throw err;
    console.warn('Could not stage the download on this device; buffering in memory instead.', err);
    return createBlobDownloadWriter(filename);
  }
};
