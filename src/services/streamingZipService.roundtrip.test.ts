import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { unzipSync } from 'fflate';
import { StreamingZipService } from './streamingZipService';

// NOTE on the Blob source: the service feeds file content through
// `new Response(blob).body`. The global Response here is Node's (undici), which
// reads a NATIVE Blob but coerces a jsdom Blob to the string "[object Blob]",
// poisoning byte fidelity. We build fixtures with node:buffer's Blob so the
// round-trip carries real bytes, while staying in the jsdom env the shared
// test setup requires.

// Round-trip validation for the multi-part split (#207 Arm A).
//
// Unlike streamingZipService.test.ts — which mocks @transcend-io/conflux to
// assert orchestration (part names, callbacks) — this file uses the REAL
// conflux Writer and only stubs drip-fs's download sink to CAPTURE the emitted
// bytes. That lets us actually unzip each produced part and prove:
//   (a) the expected number of parts,
//   (b) each part is a structurally valid zip,
//   (c) the union of entries across parts equals the input, byte-for-byte.
// This is the automated stand-in for the manual "open each part, confirm it
// isn't corrupt" check.
vi.mock('drip-fs', () => ({ createStreamingDownload: vi.fn() }));

describe('streamingZipService round-trip (#207 Arm A)', () => {
  let parts: Map<string, number[]>; // fileName -> captured bytes, in write order

  beforeEach(async () => {
    vi.clearAllMocks();
    parts = new Map();
    const { createStreamingDownload } = await import('drip-fs');
    vi.mocked(createStreamingDownload).mockImplementation(async (name: string) => {
      const bytes: number[] = [];
      parts.set(name, bytes);
      return {
        write: async (chunk: Uint8Array) => {
          for (let i = 0; i < chunk.length; i += 1) bytes.push(chunk[i]);
        },
        close: async () => {},
        abort: async () => {},
        bytesWritten: 0,
      } as any;
    });
  });

  const unzipPart = (name: string) => unzipSync(Uint8Array.from(parts.get(name)!));
  const blobOf = (size: number, fill: number) =>
    new NodeBlob([new Uint8Array(size).fill(fill)]) as unknown as Blob;

  it('produces a single valid, fully-unzippable archive when under the threshold', async () => {
    const svc = new StreamingZipService('export', { maxPartBytes: 100_000 });
    await svc.addFile(blobOf(50, 1), 'a.bin');
    await svc.addFile(blobOf(50, 2), 'b.bin');
    await svc.finalize();

    expect([...parts.keys()]).toEqual(['export.zip']);
    const files = unzipPart('export.zip');
    expect(Object.keys(files).sort()).toEqual(['a.bin', 'b.bin']);
    expect(files['a.bin'].length).toBe(50);
    expect(files['b.bin'].length).toBe(50);
    expect(files['a.bin'].every((b) => b === 1)).toBe(true);
  });

  it('splits across parts that each unzip cleanly, with the entry union preserved', async () => {
    const svc = new StreamingZipService('export', { maxPartBytes: 1000 });
    await svc.addFile(blobOf(600, 1), 'a.bin'); // part 1
    await svc.addFile(blobOf(600, 2), 'b.bin'); // 600+600 > 1000 → rolls to part 2
    await svc.addFile(blobOf(100, 3), 'c.bin'); // part 2
    await svc.finalize();

    expect([...parts.keys()]).toEqual(['export.zip', 'export-part2.zip']);

    // Each part is independently a valid zip with exactly its expected members.
    const p1 = unzipPart('export.zip');
    const p2 = unzipPart('export-part2.zip');
    expect(Object.keys(p1)).toEqual(['a.bin']);
    expect(Object.keys(p2).sort()).toEqual(['b.bin', 'c.bin']);

    // Union across parts equals every input, byte lengths intact (no truncation
    // or corruption at the part boundary).
    const all = { ...p1, ...p2 };
    expect(Object.keys(all).sort()).toEqual(['a.bin', 'b.bin', 'c.bin']);
    expect(all['a.bin'].length).toBe(600);
    expect(all['b.bin'].length).toBe(600);
    expect(all['c.bin'].length).toBe(100);
    expect(all['b.bin'].every((b) => b === 2)).toBe(true);
  });

  it('writes one archive whatever the size when a single zip is asked for (2.2.10)', async () => {
    const onPartStart = vi.fn();
    // maxPartBytes is ignored once singleZip is set.
    const svc = new StreamingZipService('export', { singleZip: true, maxPartBytes: 1000, onPartStart });
    await svc.addFile(blobOf(600, 1), 'a.bin');
    await svc.addFile(blobOf(600, 2), 'b.bin');
    await svc.addFile(blobOf(100, 3), 'c.bin');
    await svc.finalize();

    expect([...parts.keys()]).toEqual(['export.zip']);
    expect(onPartStart).toHaveBeenCalledTimes(1);
    const bytes = Uint8Array.from(parts.get('export.zip')!);
    // Zip64Writer's layout: no data descriptor flag on the first local header.
    expect(new DataView(bytes.buffer).getUint16(6, true)).toBe(0x0800);
    const files = unzipPart('export.zip');
    expect(Object.keys(files)).toEqual(['a.bin', 'b.bin', 'c.bin']);
    expect(files['b.bin'].length).toBe(600);
    expect(files['b.bin'].every((b) => b === 2)).toBe(true);
    expect(files['c.bin'].every((b) => b === 3)).toBe(true);
  });

  it('stays on the conflux layout when no single zip is asked for, limit or not', async () => {
    for (const options of [{ maxPartBytes: 100_000 }, {}]) {
      parts.clear();
      const svc = new StreamingZipService('export', options);
      await svc.addFile(blobOf(50, 1), 'a.bin');
      await svc.finalize();
      const bytes = Uint8Array.from(parts.get('export.zip')!);
      // conflux sets bit 3 (data descriptor) on every entry.
      expect(new DataView(bytes.buffer).getUint16(6, true) & 0x0008).toBe(0x0008);
    }
  });
});
