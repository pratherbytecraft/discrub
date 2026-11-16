/**
 * The single zip writer (2.2.10): two reads per entry, no data descriptors,
 * zip64 records only where a value does not fit.
 */
import { describe, it, expect } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { unzipSync } from 'fflate';
import { Zip64Writer, type Zip64Entry, type Zip64WriterOptions } from './zip64Writer';
import { readZipDirectory, readZipEntries } from './zipDirectoryReader';

const streamOf = (bytes: Uint8Array) => () =>
  new ReadableStream<Uint8Array>({
    start(ctrl) {
      // Two chunks, so a CRC kept across chunks is checked too.
      const half = bytes.length >> 1;
      if (half) ctrl.enqueue(bytes.subarray(0, half));
      if (bytes.length - half) ctrl.enqueue(bytes.subarray(half));
      ctrl.close();
    },
  });

async function writeZip(entries: Zip64Entry[], options?: Zip64WriterOptions): Promise<Uint8Array> {
  const { readable, writable } = new Zip64Writer(options);
  const chunks: Uint8Array[] = [];
  const reading = (async () => {
    const reader = readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  // A failed entry errors both sides; the write is the one the caller sees.
  reading.catch(() => undefined);
  const writer = writable.getWriter();
  for (const entry of entries) await writer.write(entry);
  await writer.close();
  await reading;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const blobOf = (bytes: Uint8Array): Blob => new NodeBlob([bytes as Uint8Array<ArrayBuffer>]) as unknown as Blob;
const text = (s: string) => new TextEncoder().encode(s);
const find = (bytes: Uint8Array, sig: number): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 4; i >= 0; i--) if (view.getUint32(i, true) === sig) return i;
  return -1;
};

describe('Zip64Writer', () => {
  it('writes a small archive other readers open, with sizes in the local header and no descriptor', async () => {
    const a = text('hello world');
    const b = new Uint8Array(5000).map((_, i) => i % 251);
    const zip = await writeZip([
      { name: 'a.txt', stream: streamOf(a), lastModified: new Date(2026, 10, 15, 12, 30, 10) },
      { name: 'media/b.bin', stream: streamOf(b) },
      { name: 'empty.txt', stream: streamOf(new Uint8Array(0)) },
    ]);

    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['a.txt', 'media/b.bin', 'empty.txt']);
    expect(Array.from(files['a.txt'])).toEqual(Array.from(a));
    expect(Array.from(files['media/b.bin'])).toEqual(Array.from(b));
    expect(files['empty.txt'].length).toBe(0);

    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(4, true)).toBe(20);
    expect(view.getUint16(6, true)).toBe(0x0800); // UTF-8 name, no data descriptor
    expect(view.getUint32(18, true)).toBe(a.length);
    expect(view.getUint32(22, true)).toBe(a.length);
    // The second local header starts right after the first entry's bytes.
    expect(view.getUint32(30 + 5 + a.length, true)).toBe(0x04034b50);
    // Small archive: no zip64 end record.
    expect(find(zip, 0x06064b50)).toBe(-1);
  });

  it('keeps names that are not ASCII, read back by the app\'s own reader', async () => {
    const names = ['频道/消息.html', 'Gespräch/Übersicht.json', 'plain.txt'];
    const zip = await writeZip(names.map((name, i) => ({ name, stream: streamOf(text(`body ${i}`)) })));

    const directory = await readZipDirectory(blobOf(zip));
    expect(directory.map((e) => e.path)).toEqual(names);
    expect(directory.every((e) => e.method === 0)).toBe(true);

    const read: Record<string, string> = {};
    await readZipEntries(blobOf(zip), {
      want: () => true,
      onEntry: (path, bytes) => {
        read[path] = new TextDecoder().decode(bytes);
      },
    });
    expect(read).toEqual({ [names[0]]: 'body 0', [names[1]]: 'body 1', [names[2]]: 'body 2' });
    expect(Object.keys(unzipSync(zip))).toEqual(names);
  });

  it('writes a zip64 end record past 65,535 entries, and the reader finds every entry', async () => {
    const count = 66_000;
    const body = text('x');
    const entries: Zip64Entry[] = [];
    for (let i = 0; i < count; i++) entries.push({ name: `f/${i}.txt`, stream: streamOf(body) });
    const zip = await writeZip(entries);

    const end64 = find(zip, 0x06064b50);
    expect(end64).toBeGreaterThan(0);
    const view = new DataView(zip.buffer);
    expect(Number(view.getBigUint64(end64 + 32, true))).toBe(count);
    const end = find(zip, 0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(0xffff);

    const directory = await readZipDirectory(blobOf(zip));
    expect(directory).toHaveLength(count);
    expect(directory[count - 1].path).toBe(`f/${count - 1}.txt`);
    let last = '';
    await readZipEntries(blobOf(zip), {
      want: (path) => path === `f/${count - 1}.txt`,
      onEntry: (_path, bytes) => {
        last = new TextDecoder().decode(bytes);
      },
    });
    expect(last).toBe('x');
  }, 60_000);

  it('records an offset past 4 GiB in a zip64 extra field and the zip64 end record', async () => {
    const base = 0x1_2000_0000n; // 4.5 GiB counted as already written
    const zip = await writeZip(
      [{ name: 'a.txt', stream: streamOf(text('abc')) }, { name: 'b.txt', stream: streamOf(text('defg')) }],
      { baseOffset: base },
    );
    const view = new DataView(zip.buffer);
    const firstLocal = 30 + 5 + 3;
    const secondLocal = 30 + 5 + 4;
    const directoryAt = firstLocal + secondLocal;

    // First directory record: 32-bit offset saturated, the real one in the extra field.
    expect(view.getUint32(directoryAt, true)).toBe(0x02014b50);
    expect(view.getUint16(directoryAt + 6, true)).toBe(45);
    expect(view.getUint32(directoryAt + 20, true)).toBe(3); // size still fits
    expect(view.getUint32(directoryAt + 42, true)).toBe(0xffffffff);
    expect(view.getUint16(directoryAt + 30, true)).toBe(12);
    const extra = directoryAt + 46 + 5;
    expect(view.getUint16(extra, true)).toBe(0x0001);
    expect(view.getUint16(extra + 2, true)).toBe(8);
    expect(view.getBigUint64(extra + 4, true)).toBe(base);
    const second = extra + 12;
    expect(view.getBigUint64(second + 46 + 5 + 4, true)).toBe(base + BigInt(firstLocal));

    const end64 = find(zip, 0x06064b50);
    expect(view.getBigUint64(end64 + 24, true)).toBe(2n);
    expect(view.getBigUint64(end64 + 48, true)).toBe(base + BigInt(directoryAt));
    // Locator points at the zip64 end record.
    expect(view.getUint32(end64 + 56, true)).toBe(0x07064b50);
    expect(view.getBigUint64(end64 + 64, true)).toBe(base + BigInt(end64));
    const end = find(zip, 0x06054b50);
    expect(view.getUint32(end + 16, true)).toBe(0xffffffff);
  });

  it('writes a folder entry with a trailing slash and no data', async () => {
    const zip = await writeZip([{ name: 'media', directory: true }, { name: 'media/a.txt', stream: streamOf(text('a')) }]);
    const directory = await readZipDirectory(blobOf(zip));
    expect(directory.map((e) => e.path)).toEqual(['media/', 'media/a.txt']);
    expect(directory[0].uncompressedSize).toBe(0);
  });

  it('fails the archive when an entry gives different bytes on the second read', async () => {
    let calls = 0;
    const changing = () => streamOf(text(calls++ === 0 ? 'first' : 'other'))();
    await expect(writeZip([{ name: 'a.txt', stream: changing }])).rejects.toThrow('changed between the two reads');
  });
});
