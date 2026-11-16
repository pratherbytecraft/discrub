/**
 * Store only zip writer with zip64, for the single zip export choice.
 *
 * Same shape as conflux's Writer: `const { readable, writable } = new Zip64Writer()`,
 * then write entries `{ name, lastModified, stream }`. Parted exports and workspace
 * files stay on conflux; this writer is only picked when an export asks for one
 * archive with no size limit.
 *
 * Each entry is read twice. The first read gets its CRC and size, so the local
 * header is complete and no data descriptor follows the data. That is the layout
 * every tool tried reads past 4 GiB (unzip, bsdtar, 7-Zip, Python zipfile, macOS
 * ditto and Archive Utility). `stream` must therefore return the same bytes on
 * both calls, which a Blob does.
 *
 * An entry of 4 GiB or more gets a zip64 extra field in its local header. The
 * central directory carries a zip64 extra field only for the values that do not
 * fit in 32 bits, and the zip64 end record and locator are written only when the
 * archive needs them (4 GiB, 65,535 entries, or any zip64 entry).
 */

export interface Zip64Entry {
  name: string;
  lastModified?: Date | number;
  /** Called twice. Must give the same bytes both times. */
  stream?: () => ReadableStream<Uint8Array> | null;
  directory?: boolean;
}

export interface Zip64WriterOptions {
  /**
   * Tests only. Counts this many bytes as already written, so offsets past
   * 4 GiB can be checked without writing them.
   */
  baseOffset?: bigint;
}

interface EntryRecord {
  nameBuf: Uint8Array;
  zip64: boolean;
  time: number;
  date: number;
  crc: number;
  size: bigint;
  offset: bigint;
  directory: boolean;
}

const encoder = new TextEncoder();
const U32 = 0xffffffff;
const U32N = 0xffffffffn;
const U16 = 0xffff;
/** Bit 11: the name is UTF-8. Bit 3 (data descriptor) is never set. */
const FLAGS = 0x0800;
const DIRECTORY_BATCH_BYTES = 1 << 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let t = i;
    for (let b = 0; b < 8; b++) t = t & 1 ? (t >>> 1) ^ 0xedb88320 : t >>> 1;
    table[i] = t >>> 0;
  }
  return table;
})();

const crc32 = (crc: number, data: Uint8Array): number => {
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  return crc;
};

const clamp32 = (value: bigint): number => (value >= U32N ? U32 : Number(value));

const dosTimeDate = (date: Date): [number, number] => [
  (((date.getHours() << 6) | date.getMinutes()) << 5) | (date.getSeconds() >> 1),
  ((((Math.max(1980, date.getFullYear()) - 1980) << 4) | (date.getMonth() + 1)) << 5) | date.getDate(),
];

class Zip64Transformer implements Transformer<Zip64Entry, Uint8Array> {
  private entries: EntryRecord[] = [];
  private offset: bigint;

  constructor(options: Zip64WriterOptions = {}) {
    this.offset = options.baseOffset ?? 0n;
  }

  async transform(entry: Zip64Entry, ctrl: TransformStreamDefaultController<Uint8Array>): Promise<void> {
    const trimmed = entry.name.trim();
    const name = entry.directory && !trimmed.endsWith('/') ? `${trimmed}/` : trimmed;
    const nameBuf = encoder.encode(name);
    if (nameBuf.length > U16) throw new Error('File name is too long.');
    const open = entry.directory ? undefined : entry.stream;

    // First read: CRC and size, nothing written.
    let crc = -1;
    let size = 0n;
    const first = open?.();
    if (first) {
      const reader = first.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        crc = crc32(crc, value);
        size += BigInt(value.length);
      }
    }
    const knownCrc = (crc ^ -1) >>> 0;
    const zip64 = size >= U32N;
    const [time, date] = dosTimeDate(new Date(entry.lastModified ?? Date.now()));
    const record: EntryRecord = {
      nameBuf, zip64, time, date, crc: knownCrc, size, offset: this.offset, directory: !!entry.directory,
    };
    this.entries.push(record);

    const local = new Uint8Array(30 + nameBuf.length + (zip64 ? 20 : 0));
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, zip64 ? 45 : 20, true);
    dv.setUint16(6, FLAGS, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, knownCrc, true);
    dv.setUint32(18, clamp32(size), true);
    dv.setUint32(22, clamp32(size), true);
    dv.setUint16(26, nameBuf.length, true);
    local.set(nameBuf, 30);
    if (zip64) {
      dv.setUint16(28, 20, true);
      const at = 30 + nameBuf.length;
      dv.setUint16(at, 0x0001, true);
      dv.setUint16(at + 2, 16, true);
      dv.setBigUint64(at + 4, size, true);
      dv.setBigUint64(at + 12, size, true);
    }
    ctrl.enqueue(local);

    // Second read: the bytes themselves, checked against the first read.
    let writtenCrc = -1;
    let written = 0n;
    const second = open?.();
    if (second) {
      const reader = second.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writtenCrc = crc32(writtenCrc, value);
        written += BigInt(value.length);
        if (written > size) break;
        ctrl.enqueue(value);
      }
    }
    if (written !== size || ((writtenCrc ^ -1) >>> 0) !== knownCrc) {
      throw new Error(`${name} changed between the two reads.`);
    }
    this.offset += BigInt(local.length) + size;
  }

  flush(ctrl: TransformStreamDefaultController<Uint8Array>): void {
    const directoryOffset = this.offset;
    let directorySize = 0n;
    let anyZip64 = false;
    // Batched, so a directory of 100,000 entries is never one huge buffer.
    let batch: Uint8Array[] = [];
    let batchBytes = 0;
    const flushBatch = () => {
      if (!batchBytes) return;
      const out = new Uint8Array(batchBytes);
      let at = 0;
      for (const bytes of batch) {
        out.set(bytes, at);
        at += bytes.length;
      }
      ctrl.enqueue(out);
      batch = [];
      batchBytes = 0;
    };

    for (const e of this.entries) {
      const big: bigint[] = [];
      if (e.size >= U32N) big.push(e.size, e.size); // uncompressed, compressed
      if (e.offset >= U32N) big.push(e.offset);
      const extraLength = big.length ? 4 + big.length * 8 : 0;
      const needs45 = e.zip64 || big.length > 0;
      anyZip64 ||= needs45;
      const rec = new Uint8Array(46 + e.nameBuf.length + extraLength);
      const dv = new DataView(rec.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, needs45 ? 45 : 20, true); // made by
      dv.setUint16(6, needs45 ? 45 : 20, true); // needed
      dv.setUint16(8, FLAGS, true);
      dv.setUint16(12, e.time, true);
      dv.setUint16(14, e.date, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, clamp32(e.size), true);
      dv.setUint32(24, clamp32(e.size), true);
      dv.setUint16(28, e.nameBuf.length, true);
      dv.setUint16(30, extraLength, true);
      dv.setUint32(38, e.directory ? 16 : 0, true);
      dv.setUint32(42, clamp32(e.offset), true);
      rec.set(e.nameBuf, 46);
      if (extraLength) {
        let at = 46 + e.nameBuf.length;
        dv.setUint16(at, 0x0001, true);
        dv.setUint16(at + 2, big.length * 8, true);
        at += 4;
        for (const value of big) {
          dv.setBigUint64(at, value, true);
          at += 8;
        }
      }
      batch.push(rec);
      batchBytes += rec.length;
      directorySize += BigInt(rec.length);
      if (batchBytes >= DIRECTORY_BATCH_BYTES) flushBatch();
    }
    flushBatch();

    const count = this.entries.length;
    const zip64End = anyZip64 || count >= U16 || directorySize >= U32N || directoryOffset >= U32N;
    const end = new Uint8Array((zip64End ? 76 : 0) + 22);
    const dv = new DataView(end.buffer);
    let at = 0;
    if (zip64End) {
      dv.setUint32(0, 0x06064b50, true); // zip64 end of central directory record
      dv.setBigUint64(4, 44n, true);
      dv.setUint16(12, 45, true);
      dv.setUint16(14, 45, true);
      dv.setBigUint64(24, BigInt(count), true);
      dv.setBigUint64(32, BigInt(count), true);
      dv.setBigUint64(40, directorySize, true);
      dv.setBigUint64(48, directoryOffset, true);
      dv.setUint32(56, 0x07064b50, true); // locator
      dv.setBigUint64(64, directoryOffset + directorySize, true);
      dv.setUint32(72, 1, true);
      at = 76;
    }
    dv.setUint32(at, 0x06054b50, true);
    dv.setUint16(at + 8, Math.min(count, U16), true);
    dv.setUint16(at + 10, Math.min(count, U16), true);
    dv.setUint32(at + 12, clamp32(directorySize), true);
    dv.setUint32(at + 16, clamp32(directoryOffset), true);
    ctrl.enqueue(end);
    this.entries = [];
  }
}

export class Zip64Writer extends TransformStream<Zip64Entry, Uint8Array> {
  constructor(options?: Zip64WriterOptions) {
    super(new Zip64Transformer(options));
  }
}
