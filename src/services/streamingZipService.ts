import type { StreamDownloadWriter } from 'drip-fs';
import { createDownloadWriter } from './downloadWriter';
import { Writer } from '@transcend-io/conflux';

/**
 * 32-bit ceiling. @transcend-io/conflux's Writer emits no zip64, so offsets,
 * sizes, and the central directory all use 32-bit fields — a single archive
 * silently corrupts past 4 GiB (and past 65535 entries). The multi-part split
 * below keeps each part safely under these limits. (#207 Arm A)
 */
const HARD_ZIP_LIMIT = 0xffffffff; // 2^32 - 1
const MAX_FILES_PER_PART = 65000; // EOCD entry count is 16-bit (max 65535)

export interface StreamingZipOptions {
  /**
   * Max bytes of file content per part before rolling to a new part file.
   * Falsy / <= 0 means a single archive with no splitting (legacy behavior).
   * Should stay under 4 GiB since conflux has no zip64.
   */
  maxPartBytes?: number | null;
  /** Invoked when a part's download begins. partIndex is 1-based. */
  onPartStart?: (info: { partIndex: number; fileName: string }) => void;
  /** Invoked when a single file exceeds the 32-bit limit (cannot be split, will corrupt). */
  onOversizeFile?: (info: { fileName: string; size: number }) => void;
  /** Invoked when a duplicate path had to be renamed to keep the archive writable (#224). */
  onPathCollision?: (info: { requestedPath: string; finalPath: string }) => void;
  /** File extension without the dot, `zip` when omitted (a workspace file is `discrub-workspace`). */
  extension?: string;
}

/**
 * StreamingZipService - streaming ZIP creation over @transcend-io/conflux Writer,
 * piped to the browser via drip-fs. Optionally splits the output into multiple
 * part files (export.zip, export-part2.zip, …) so no part crosses conflux's
 * 4 GiB / 65535-entry zip64 limits (#207 Arm A). Without maxPartBytes it produces
 * exactly one archive, identical to before.
 */
export class StreamingZipService {
  private writer: WritableStreamDefaultWriter | null = null;
  private readable: ReadableStream | null = null;
  private downloadWriter: StreamDownloadWriter | null = null;
  private pipePromise: Promise<void> | null = null;

  private readonly maxPartBytes: number; // 0 = no limit
  private readonly onPartStart?: StreamingZipOptions['onPartStart'];
  private readonly onOversizeFile?: StreamingZipOptions['onOversizeFile'];
  private readonly onPathCollision?: StreamingZipOptions['onPathCollision'];
  private readonly extension: string;

  /**
   * Every path ever written across ALL parts. Conflux's Writer errors its
   * entire stream on a repeated entry name ("File already exists."), which
   * poisons the part and aborts the download — a duplicate must never reach
   * it. Tracking across parts also prevents silent overwrites when multiple
   * part files are extracted into the same directory. (#224)
   */
  private readonly usedPaths = new Set<string>();

  private partIndex = 0; // 0 until the first part's download opens
  private partBytes = 0;
  private partFiles = 0;

  constructor(private zipName: string, options: StreamingZipOptions = {}) {
    this.maxPartBytes =
      options.maxPartBytes && options.maxPartBytes > 0 ? options.maxPartBytes : 0;
    this.onPartStart = options.onPartStart;
    this.onOversizeFile = options.onOversizeFile;
    this.onPathCollision = options.onPathCollision;
    this.extension = options.extension ?? 'zip';
    this.initWriter();
  }

  /** Create a fresh conflux Writer for the next part (download opens lazily). */
  private initWriter(): void {
    const { readable, writable } = new Writer();
    this.readable = readable;
    this.writer = writable.getWriter();
  }

  private partFileName(index: number): string {
    // First part keeps the plain name so non-split exports look unchanged.
    return index <= 1 ? `${this.zipName}.${this.extension}` : `${this.zipName}-part${index}.${this.extension}`;
  }

  /** Reserve a unique in-archive path, renaming with a `-2`/`-3`… suffix on duplicates. */
  private allocatePath(filePath: string): string {
    if (!this.usedPaths.has(filePath)) {
      this.usedPaths.add(filePath);
      return filePath;
    }
    const slash = filePath.lastIndexOf('/');
    const dot = filePath.lastIndexOf('.');
    const hasExt = dot > slash + 1;
    const stem = hasExt ? filePath.slice(0, dot) : filePath;
    const ext = hasExt ? filePath.slice(dot) : '';
    let candidate: string;
    let n = 2;
    do {
      candidate = `${stem}-${n}${ext}`;
      n += 1;
    } while (this.usedPaths.has(candidate));
    this.usedPaths.add(candidate);
    this.onPathCollision?.({ requestedPath: filePath, finalPath: candidate });
    return candidate;
  }

  /**
   * Add a file to the archive, rolling to a new part first if this file would
   * push the current part past the byte or entry limit. Returns the path the
   * file was actually stored under (renamed if it collided, #224).
   */
  async addFile(blob: Blob, filePath: string, lastModified?: Date): Promise<string> {
    const finalPath = this.allocatePath(filePath);
    const size = blob.size;

    if (this.maxPartBytes && size > HARD_ZIP_LIMIT) {
      // A single file larger than 4 GiB can't be split into parts and will
      // exceed conflux's 32-bit fields — warn rather than silently corrupt.
      this.onOversizeFile?.({ fileName: finalPath, size });
    }

    // Roll to a new part if the current one is non-empty and this file would
    // cross a limit. (Never roll on an empty part — an oversized lone file
    // still has to go somewhere.)
    if (
      this.downloadWriter &&
      this.partFiles > 0 &&
      this.maxPartBytes &&
      (this.partBytes + size > this.maxPartBytes ||
        this.partFiles + 1 > MAX_FILES_PER_PART)
    ) {
      await this.finalizeCurrentPart();
      this.initWriter();
    }

    // Lazily open the download for the current part on its first write.
    if (!this.downloadWriter) {
      this.partIndex += 1;
      this.partBytes = 0;
      this.partFiles = 0;
      const fileName = this.partFileName(this.partIndex);
      this.downloadWriter = await createDownloadWriter(fileName, this.maxPartBytes || undefined);
      this.pipePromise = this.pipeReadableToWriter(this.readable!, this.downloadWriter);
      this.onPartStart?.({ partIndex: this.partIndex, fileName });
    }

    await this.writer!.ready;
    await this.writer!.write({
      name: finalPath,
      lastModified: lastModified || new Date(),
      stream: () => new Response(blob).body,
    });

    this.partBytes += size;
    this.partFiles += 1;
    return finalPath;
  }

  /** Finalize the archive (closing the final part) and complete its download. */
  async finalize(): Promise<void> {
    await this.finalizeCurrentPart();
  }

  /** Close + drain the current part, then clear part state. */
  private async finalizeCurrentPart(): Promise<void> {
    if (this.writer) {
      await this.writer.ready;
      await this.writer.close();
    }
    if (this.pipePromise) {
      await this.pipePromise;
    }
    this.writer = null;
    this.readable = null;
    this.downloadWriter = null;
    this.pipePromise = null;
  }

  /** Cancel ZIP creation and clean up the in-flight part. */
  async cancel(): Promise<void> {
    try {
      if (this.writer) {
        await this.writer.ready;
        await this.writer.close();
      }
    } catch {
      // Already closed or errored
    }

    if (this.downloadWriter) {
      await this.downloadWriter.abort();
    }

    this.writer = null;
    this.readable = null;
    this.downloadWriter = null;
    this.pipePromise = null;
  }

  /** Pipe a ReadableStream to a StreamDownloadWriter chunk by chunk. */
  private async pipeReadableToWriter(
    readable: ReadableStream,
    downloadWriter: StreamDownloadWriter
  ): Promise<void> {
    const reader = readable.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await downloadWriter.write(value);
      }
      await downloadWriter.close();
    } catch (err) {
      await downloadWriter.abort();
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}
