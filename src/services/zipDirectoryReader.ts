/**
 * ZIP reader driven by the central directory (2.2.5 pass 2, row 117).
 *
 * Workspace files are written by conflux, which stores every part with a
 * bit 3 data descriptor: the local header carries no sizes and a
 * `PK 07 08` footer follows the data. fflate's streaming `Unzip` finds
 * the end of such an entry by scanning its bytes for that marker, so a
 * gzipped part that happens to contain the four bytes is cut short and
 * the import fails on a file that is fine. The central directory at the
 * end of the archive records every entry's compressed size and offset,
 * so this reader goes by that instead: find the end record, read the
 * directory, then slice each wanted entry out of the Blob by its exact
 * size. Nothing inside an entry's bytes can end it early.
 *
 * Plain and zip64 end records are both read, so an archive past 4 GiB
 * or 65,535 entries works the same way.
 */

import { inflateSync } from 'fflate';
import { readBlobAsArrayBuffer } from './packageZipReader';

export interface ZipDirectoryEntry {
  path: string;
  /** 0 stored, 8 deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's local header from the start of the archive. */
  offset: number;
}

export class ZipDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipDirectoryError';
  }
}

export interface ReadZipEntriesHandlers {
  /** Decided from the path, before any bytes of the entry are read. */
  want: (path: string) => boolean;
  /** Called with the full bytes of every wanted entry, in directory order. */
  onEntry: (path: string, bytes: Uint8Array) => Promise<void> | void;
  /** Checked before each entry; true stops reading and resolves normally. */
  shouldStop?: () => boolean;
}

const SIG_END = 0x06054b50;
const SIG_END64_LOCATOR = 0x07064b50;
const SIG_END64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EXTRA_ZIP64 = 0x0001;
/** The end record is 22 bytes plus a comment of up to 65,535 bytes. */
const END_SEARCH = 22 + 0xffff;

const u32 = (view: DataView, at: number): number => view.getUint32(at, true);
const u16 = (view: DataView, at: number): number => view.getUint16(at, true);
const u64 = (view: DataView, at: number): number => {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipDirectoryError('An entry is too large to read');
  return Number(value);
};

async function bytesOf(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await readBlobAsArrayBuffer(blob.slice(start, end)));
}

const decoder = new TextDecoder();

/** Reads every entry's path, method, sizes and offset from the central directory. */
export async function readZipDirectory(blob: Blob): Promise<ZipDirectoryEntry[]> {
  const size = blob.size;
  if (size < 22) throw new ZipDirectoryError('Not a ZIP file');
  const tailStart = Math.max(0, size - END_SEARCH);
  const tail = await bytesOf(blob, tailStart, size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let endAt = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tailView, i) === SIG_END) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new ZipDirectoryError('The end of the archive is missing, the file may be cut short');

  let count = u16(tailView, endAt + 10);
  let directorySize = u32(tailView, endAt + 12);
  let directoryOffset = u32(tailView, endAt + 16);

  // zip64: the plain record saturates and a locator 20 bytes before it points at the real one.
  if ((count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) && endAt >= 20 && u32(tailView, endAt - 20) === SIG_END64_LOCATOR) {
    const end64Offset = u64(tailView, endAt - 20 + 8);
    const end64 = await bytesOf(blob, end64Offset, Math.min(size, end64Offset + 56));
    const view64 = new DataView(end64.buffer, end64.byteOffset, end64.byteLength);
    if (end64.length < 56 || u32(view64, 0) !== SIG_END64) throw new ZipDirectoryError('The zip64 end record is missing');
    count = u64(view64, 32);
    directorySize = u64(view64, 40);
    directoryOffset = u64(view64, 48);
  }
  if (directoryOffset + directorySize > size) throw new ZipDirectoryError('The central directory is outside the file');

  const directory = await bytesOf(blob, directoryOffset, directoryOffset + directorySize);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: ZipDirectoryEntry[] = [];
  let at = 0;
  for (let n = 0; n < count && at + 46 <= directory.length; n++) {
    if (u32(view, at) !== SIG_CENTRAL) throw new ZipDirectoryError('The central directory is damaged');
    const method = u16(view, at + 10);
    let compressedSize = u32(view, at + 20);
    let uncompressedSize = u32(view, at + 24);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    let offset = u32(view, at + 42);
    const path = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));
    // Saturated fields are spelled out in the zip64 extra field, in this order, only for the ones that saturated.
    let extraAt = at + 46 + nameLength;
    const extraEnd = extraAt + extraLength;
    while (extraAt + 4 <= extraEnd) {
      const id = u16(view, extraAt);
      const length = u16(view, extraAt + 2);
      if (id === EXTRA_ZIP64) {
        let field = extraAt + 4;
        if (uncompressedSize === 0xffffffff) { uncompressedSize = u64(view, field); field += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(view, field); field += 8; }
        if (offset === 0xffffffff) { offset = u64(view, field); field += 8; }
        break;
      }
      extraAt += 4 + length;
    }
    entries.push({ path, method, compressedSize, uncompressedSize, offset });
    at = extraEnd + commentLength;
  }
  if (entries.length !== count) throw new ZipDirectoryError('The central directory is cut short');
  return entries;
}

/** The entry's bytes, inflated when it was deflated. */
export async function readZipEntryBytes(blob: Blob, entry: ZipDirectoryEntry): Promise<Uint8Array> {
  const header = await bytesOf(blob, entry.offset, entry.offset + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length < 30 || u32(view, 0) !== SIG_LOCAL) throw new ZipDirectoryError(`${entry.path}: the entry header is missing`);
  const dataAt = entry.offset + 30 + u16(view, 26) + u16(view, 28);
  if (dataAt + entry.compressedSize > blob.size) throw new ZipDirectoryError(`${entry.path}: the entry runs past the end of the file`);
  const data = await bytesOf(blob, dataAt, dataAt + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    try {
      return inflateSync(data);
    } catch {
      throw new ZipDirectoryError(`${entry.path}: the entry could not be inflated`);
    }
  }
  throw new ZipDirectoryError(`${entry.path}: unknown compression type ${entry.method}`);
}

const asBlob = (source: Blob | ArrayBuffer | Uint8Array): Blob => {
  if (source instanceof ArrayBuffer) return new Blob([source]);
  if (source instanceof Uint8Array) return new Blob([source as BlobPart]);
  return source;
};

/**
 * Reads every entry `want()` accepts, by the central directory, and hands
 * each one's bytes to `onEntry` in directory order. Directories and
 * macOS junk are never offered.
 */
export async function readZipEntries(source: Blob | ArrayBuffer | Uint8Array, handlers: ReadZipEntriesHandlers): Promise<void> {
  const blob = asBlob(source);
  const entries = await readZipDirectory(blob);
  for (const entry of entries) {
    if (handlers.shouldStop?.()) return;
    if (entry.path.endsWith('/') || entry.path.startsWith('__MACOSX/') || !handlers.want(entry.path)) continue;
    const bytes = await readZipEntryBytes(blob, entry);
    await handlers.onEntry(entry.path, bytes);
  }
}
