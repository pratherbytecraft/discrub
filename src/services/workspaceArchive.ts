/**
 * Workspace files (2.2.5 WP6b, plan section 8).
 *
 * A `.discrub-workspace` file is a zip written through the same
 * streaming writer exports use (drip-fs, or OPFS staging on Firefox):
 *
 *   manifest.json                          what the import dialog shows
 *   workspace.json                         the workspace record without authors
 *   authors.json                           the record's author map
 *   conversations/<cid>/<0001>.ndjson.gz   one message per line, 5,000 per part
 *
 * No token and no media. Parts are gzipped on the page (fflate's sync
 * gzip; its async one starts a blob worker the Firefox extension refuses)
 * because the zip writer has no zip64: compressed, a workspace at the
 * 10 GiB storage ceiling stays well under the 4 GiB a zip can hold.
 * Entries are written in that order, so a reader has the record before
 * the first part and the manifest can be read without the rest.
 */

import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { Message } from 'discrub-core/types/discord-types';
import type { WorkspaceAuthor, WorkspaceRecord } from '@features/workspace/workspaceTypes';
import { WORKSPACE_SCHEMA_VERSION } from '@features/workspace/workspaceTypes';
import { StreamingZipService } from './streamingZipService';
import { readPackageEntries, type PackageZipSource } from './packageZipReader';
import { getWorkspace, readWindow, writePage } from './workspaceStore';

export const WORKSPACE_FILE_EXTENSION = 'discrub-workspace';
export const WORKSPACE_FILE_FORMAT = 'discrub-workspace';
/** Messages per conversation part. About 6 MB of JSON before gzip. */
export const PART_SIZE = 5000;

const MANIFEST = 'manifest.json';
const RECORD = 'workspace.json';
const AUTHORS = 'authors.json';
const PART_PATH = /^conversations\/([^/]+)\/(\d+)\.ndjson\.gz$/;

export interface WorkspaceManifest {
  format: typeof WORKSPACE_FILE_FORMAT;
  schema: number;
  appVersion: string;
  wid: string;
  name: string;
  color: string;
  createdAt: number;
  exportedAt: number;
  conversations: number;
  messages: number;
  bytes: number;
}

export class WorkspaceFileError extends Error {
  constructor(public readonly reason: 'notWorkspace' | 'needsUpdate' | 'broken', message: string, public readonly appVersion?: string) {
    super(message);
    this.name = 'WorkspaceFileError';
  }
}

const json = (value: unknown): Blob => new Blob([JSON.stringify(value)], { type: 'application/json' });

/** Characters no file system takes in a name. */
export function workspaceFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'workspace';
}

export function manifestOf(record: WorkspaceRecord, exportedAt = Date.now()): WorkspaceManifest {
  const conversations = Object.values(record.conversations);
  return {
    format: WORKSPACE_FILE_FORMAT,
    schema: record.schema,
    appVersion: record.appVersion,
    wid: record.wid,
    name: record.name,
    color: record.color,
    createdAt: record.createdAt,
    exportedAt,
    conversations: conversations.filter((c) => c.count > 0).length,
    messages: conversations.reduce((sum, c) => sum + c.count, 0),
    bytes: record.bytes,
  };
}

export interface ExportProgress {
  messages: number;
  total: number;
}

/**
 * Writes the workspace to a `.discrub-workspace` download, reading its
 * rows a part at a time so memory holds one part. Resolves with the
 * manifest that was written.
 */
export async function exportWorkspaceFile(
  wid: string,
  options: { onProgress?: (progress: ExportProgress) => void; shouldStop?: () => boolean; partSize?: number } = {},
): Promise<WorkspaceManifest | null> {
  const partSize = options.partSize ?? PART_SIZE;
  const record = await getWorkspace(wid);
  if (!record) throw new Error(`Workspace ${wid} not found`);
  const manifest = manifestOf(record);
  const { authors, ...withoutAuthors } = record;
  const zip = new StreamingZipService(workspaceFileName(record.name), { extension: WORKSPACE_FILE_EXTENSION });
  let written = 0;
  try {
    await zip.addFile(json(manifest), MANIFEST);
    await zip.addFile(json(withoutAuthors), RECORD);
    await zip.addFile(json(authors), AUTHORS);
    for (const conversation of Object.values(record.conversations)) {
      if (conversation.count === 0) continue;
      let afterId: string | undefined;
      for (let part = 1; ; part++) {
        if (options.shouldStop?.()) {
          await zip.cancel();
          return null;
        }
        const messages = await readWindow(wid, conversation.cid, { afterId, limit: partSize, direction: 'asc' });
        if (messages.length === 0) break;
        const ndjson = messages.map((m) => JSON.stringify(m)).join('\n');
        const gz = gzipSync(strToU8(ndjson));
        await zip.addFile(new Blob([gz as BlobPart], { type: 'application/gzip' }), `conversations/${conversation.cid}/${String(part).padStart(4, '0')}.ndjson.gz`);
        written += messages.length;
        options.onProgress?.({ messages: written, total: manifest.messages });
        afterId = messages[messages.length - 1].id;
        if (messages.length < partSize) break;
      }
    }
    await zip.finalize();
  } catch (error) {
    await zip.cancel().catch(() => undefined);
    throw error;
  }
  return manifest;
}

function parseJson<T>(bytes: Uint8Array, path: string): T {
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch {
    throw new WorkspaceFileError('broken', `${path} is not valid JSON`);
  }
}

/** Refuses anything that is not a workspace file, or one this Discrub cannot open. */
export function checkManifest(manifest: Partial<WorkspaceManifest> | null): WorkspaceManifest {
  if (!manifest || manifest.format !== WORKSPACE_FILE_FORMAT || typeof manifest.wid !== 'string') {
    throw new WorkspaceFileError('notWorkspace', 'Not a Discrub workspace file');
  }
  if (manifest.schema !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceFileError('needsUpdate', `Workspace schema ${manifest.schema}`, manifest.appVersion);
  }
  return manifest as WorkspaceManifest;
}

/** Reads only the manifest, the first entry, for the import dialog. */
export async function readWorkspaceManifest(source: PackageZipSource): Promise<WorkspaceManifest> {
  let manifest: Partial<WorkspaceManifest> | null = null;
  try {
    await readPackageEntries(source, {
      want: (path) => path === MANIFEST,
      onEntry: (path, bytes) => {
        manifest = parseJson<Partial<WorkspaceManifest>>(bytes, path);
      },
      shouldStop: () => manifest !== null,
    });
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    if (manifest === null) throw new WorkspaceFileError('notWorkspace', 'Not a Discrub workspace file');
  }
  return checkManifest(manifest);
}

export interface ImportTarget {
  /** The workspace id the rows go under: the file's, a fresh one, or Default. */
  wid: string;
  name: string;
  color: string;
}

export interface ImportProgress {
  messages: number;
  total: number;
}

export interface ImportResult {
  record: WorkspaceRecord;
  messages: number;
}

/**
 * Reads the whole file into `target`. The record is installed when it is
 * read (`install`, which also drops the old rows on a replace), then each
 * part is written as a page. A failed page write rejects; the workspace
 * keeps what was written.
 */
export async function importWorkspaceFile(
  source: PackageZipSource,
  target: ImportTarget,
  install: (record: WorkspaceRecord) => Promise<WorkspaceRecord>,
  options: { onProgress?: (progress: ImportProgress) => void } = {},
): Promise<ImportResult> {
  let manifest: WorkspaceManifest | null = null;
  let record: WorkspaceRecord | null = null;
  let authors: Record<string, WorkspaceAuthor> | null = null;
  // Entries that finish in the same read are handled together, so the
  // first part's install is shared rather than run once per part.
  let installed: Promise<WorkspaceRecord> | null = null;
  let messages = 0;

  const ensureInstalled = (): Promise<WorkspaceRecord> => {
    if (installed) return installed;
    if (!manifest || !record) return Promise.reject(new WorkspaceFileError('broken', 'The workspace record is missing'));
    installed = install({
      ...record,
      authors: authors ?? {},
      wid: target.wid,
      name: target.name,
      color: target.color,
      schema: WORKSPACE_SCHEMA_VERSION,
      appVersion: __APP_VERSION__,
      lastOpened: Date.now(),
    });
    return installed;
  };

  await readPackageEntries(source, {
    want: (path) => path === MANIFEST || path === RECORD || path === AUTHORS || PART_PATH.test(path),
    onEntry: async (path, bytes) => {
      if (path === MANIFEST) {
        manifest = checkManifest(parseJson<Partial<WorkspaceManifest>>(bytes, path));
        return;
      }
      if (path === RECORD) {
        record = parseJson<WorkspaceRecord>(bytes, path);
        return;
      }
      if (path === AUTHORS) {
        authors = parseJson<Record<string, WorkspaceAuthor>>(bytes, path);
        return;
      }
      const match = PART_PATH.exec(path);
      if (!match) return;
      const cid = match[1];
      const workspace = await ensureInstalled();
      if (!workspace.conversations[cid]) return;
      let text: string;
      try {
        text = strFromU8(gunzipSync(bytes));
      } catch {
        throw new WorkspaceFileError('broken', `${path} could not be read`);
      }
      const page = text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Message);
      if (page.length === 0) return;
      await writePage(workspace.wid, cid, page);
      messages += page.length;
      options.onProgress?.({ messages, total: manifest?.messages ?? messages });
    },
  });

  // A workspace with no rows has no parts; install it anyway.
  const done = await ensureInstalled();
  return { record: done, messages };
}
