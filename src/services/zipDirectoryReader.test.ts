/**
 * Row 117: entries are read by the central directory, so the bytes
 * inside an entry cannot end it early.
 */
import { describe, it, expect } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { strToU8, zipSync } from 'fflate';
import { readZipDirectory, readZipEntries, ZipDirectoryError } from './zipDirectoryReader';

const u8 = (text: string): Uint8Array => new Uint8Array(strToU8(text));
const blobOf = (bytes: Uint8Array): Blob => new NodeBlob([bytes as Uint8Array<ArrayBuffer>]) as unknown as Blob;

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * A zip the way conflux writes one: every entry stored, bit 3 set, no
 * sizes in the local header and a `PK 07 08` footer after the data.
 */
function storedWithDescriptors(entries: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of entries) {
    const name = u8(path);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0808, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const footer = new Uint8Array(16);
    const fv = new DataView(footer.buffer);
    fv.setUint32(0, 0x08074b50, true);
    fv.setUint32(4, crc32(data), true);
    fv.setUint32(8, data.length, true);
    fv.setUint32(12, data.length, true);
    const record = new Uint8Array(46 + name.length);
    const rv = new DataView(record.buffer);
    rv.setUint32(0, 0x02014b50, true);
    rv.setUint16(4, 20, true);
    rv.setUint16(6, 20, true);
    rv.setUint16(8, 0x0808, true);
    rv.setUint32(16, crc32(data), true);
    rv.setUint32(20, data.length, true);
    rv.setUint32(24, data.length, true);
    rv.setUint16(28, name.length, true);
    rv.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);
    parts.push(local, data, footer);
    offset += local.length + data.length + footer.length;
  }
  const directorySize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function readAll(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  await readZipEntries(blobOf(bytes), { want: () => true, onEntry: (path, data) => { out[path] = data; } });
  return out;
}

describe('zipDirectoryReader', () => {
  it('reads a stored entry whole when its bytes hold the data descriptor marker', async () => {
    const marker = new Uint8Array([0x50, 0x4b, 0x07, 0x08]);
    const data = new Uint8Array(300);
    data.fill(7);
    data.set(marker, 123);
    const zip = storedWithDescriptors([['manifest.json', u8('{"a":1}')], ['conversations/1/0001.ndjson.gz', data], ['authors.json', u8('{}')]]);
    const entries = await readAll(zip);
    expect(Object.keys(entries)).toEqual(['manifest.json', 'conversations/1/0001.ndjson.gz', 'authors.json']);
    expect(entries['conversations/1/0001.ndjson.gz']).toEqual(data);
  });

  it('reads deflated entries and skips directories, junk and unwanted paths', async () => {
    const zip = zipSync({ 'a.txt': u8('alpha'), 'dir/': new Uint8Array(0), '__MACOSX/._a.txt': u8('x'), 'b.txt': u8('beta') });
    const seen: string[] = [];
    await readZipEntries(zip, { want: (path) => path !== 'b.txt', onEntry: (path, data) => { seen.push(`${path}=${new TextDecoder().decode(data)}`); } });
    expect(seen).toEqual(['a.txt=alpha']);
  });

  it('stops between entries when asked', async () => {
    const zip = zipSync({ 'a.txt': u8('alpha'), 'b.txt': u8('beta') });
    const seen: string[] = [];
    await readZipEntries(zip, { want: () => true, onEntry: (path) => { seen.push(path); }, shouldStop: () => seen.length > 0 });
    expect(seen).toEqual(['a.txt']);
  });

  it('refuses a file with no end record or one cut short', async () => {
    await expect(readZipDirectory(blobOf(u8('not a zip at all, long enough to look')))).rejects.toBeInstanceOf(ZipDirectoryError);
    const zip = zipSync({ 'a.txt': u8('alpha') });
    await expect(readZipDirectory(blobOf(zip.subarray(0, zip.length - 10)))).rejects.toThrow(/cut short/);
  });
});
