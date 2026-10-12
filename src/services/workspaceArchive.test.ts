/**
 * Workspace files (2.2.5 WP6b): the real conflux zip writer with the
 * download sink captured, read back through the real fflate reader into
 * the fake-indexeddb store.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage } from '@/test/fixtures';
import { LEGACY_DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION } from '@features/workspace/workspaceTypes';
import {
  countRows,
  createWorkspace,
  deleteWorkspaceDatabase,
  getWorkspace,
  installImportedWorkspace,
  listWorkspaces,
  readWindow,
  updateWorkspace,
  writePage,
} from './workspaceStore';
import {
  WorkspaceFileError,
  exportWorkspaceFile,
  importWorkspaceFile,
  readWorkspaceManifest,
  workspaceFileName,
} from './workspaceArchive';

vi.mock('drip-fs', () => ({ createStreamingDownload: vi.fn() }));

const seedOf = (name: string) => ({ kind: 'channel' as const, guildId: '42', name });
const msg = (cid: string, id: string): Message => createMockMessage({ id, channel_id: cid, content: `message ${id}` });

let files: Map<string, number[]>;

beforeEach(async () => {
  // The zip writer reads file bodies through Node's Response, which needs Node's Blob.
  vi.stubGlobal('Blob', NodeBlob);
  files = new Map();
  const { createStreamingDownload } = await import('drip-fs');
  vi.mocked(createStreamingDownload).mockImplementation(async (name: string) => {
    const bytes: number[] = [];
    files.set(name, bytes);
    return {
      write: async (chunk: Uint8Array) => {
        for (let i = 0; i < chunk.length; i += 1) bytes.push(chunk[i]);
      },
      close: async () => {},
      abort: async () => {},
      bytesWritten: 0,
    } as never;
  });
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
  vi.unstubAllGlobals();
});

async function seedRaidArchive(): Promise<string> {
  const raid = await createWorkspace({ name: 'Raid: archive', color: '#3ba55d' });
  await writePage(raid.wid, '100', ['1', '2', '3', '4', '5', '6', '7'].map((id) => msg('100', id)), seedOf('general'));
  await writePage(raid.wid, '200', ['8', '9', '10'].map((id) => msg('200', id)), seedOf('raids'));
  await updateWorkspace(raid.wid, (record) => {
    record.authors = { u1: { id: 'u1', username: 'jordan' } as never };
    record.conversations['100'].searchCriteria = { content: 'runite' } as never;
  });
  return raid.wid;
}

const fileBytes = (name: string) => Uint8Array.from(files.get(name)!);
// fflate's zipSync checks leaves with a realm-sensitive instanceof; re-wrap through the global Uint8Array.
const u8 = (text: string): Uint8Array => new Uint8Array(strToU8(text));

describe('workspace files', () => {
  it('writes the manifest, record, authors and gzipped parts of every conversation', async () => {
    const wid = await seedRaidArchive();
    const manifest = await exportWorkspaceFile(wid, { partSize: 3 });
    expect(manifest).toMatchObject({ format: 'discrub-workspace', schema: WORKSPACE_SCHEMA_VERSION, wid, name: 'Raid: archive', conversations: 2, messages: 10 });
    expect([...files.keys()]).toEqual(['Raid_ archive.discrub-workspace']);
    const entries = Object.keys(unzipSync(fileBytes('Raid_ archive.discrub-workspace')));
    expect(entries).toEqual([
      'manifest.json',
      'workspace.json',
      'authors.json',
      'conversations/100/0001.ndjson.gz',
      'conversations/100/0002.ndjson.gz',
      'conversations/100/0003.ndjson.gz',
      'conversations/200/0001.ndjson.gz',
    ]);
  });

  it('reads the manifest alone', async () => {
    const wid = await seedRaidArchive();
    await exportWorkspaceFile(wid);
    const manifest = await readWorkspaceManifest(fileBytes('Raid_ archive.discrub-workspace'));
    expect(manifest).toMatchObject({ wid, name: 'Raid: archive', messages: 10 });
  });

  it('imports into a new workspace with every row, the record and the authors', async () => {
    const wid = await seedRaidArchive();
    await exportWorkspaceFile(wid, { partSize: 4 });
    const bytes = fileBytes('Raid_ archive.discrub-workspace');
    const progress: number[] = [];
    const result = await importWorkspaceFile(
      bytes,
      { wid: 'imported', name: 'Raid: archive (2)', color: '#faa61a' },
      (record) => installImportedWorkspace(record, false),
      { onProgress: (p) => progress.push(p.messages) },
    );
    expect(result.messages).toBe(10);
    expect(progress[progress.length - 1]).toBe(10);
    expect(await countRows('imported', '100')).toBe(7);
    expect(await countRows('imported', '200')).toBe(3);
    expect((await readWindow('imported', '100', { limit: 10 })).map((m) => m.content)).toEqual(
      (await readWindow(wid, '100', { limit: 10 })).map((m) => m.content),
    );
    const record = await getWorkspace('imported');
    const original = await getWorkspace(wid);
    expect(record).toMatchObject({ name: 'Raid: archive (2)', color: '#faa61a', bytes: original!.bytes, authors: original!.authors });
    expect(record!.conversations['100']).toMatchObject({ count: 7, oldestId: '1', newestId: '7', searchCriteria: { content: 'runite' } });
    expect((await listWorkspaces()).map((w) => w.wid)).toEqual([LEGACY_DEFAULT_WORKSPACE_ID, wid, 'imported']);
  });

  it('carries a search set beside its conversation, counted as one conversation (fix C)', async () => {
    const wid = await seedRaidArchive();
    await writePage(wid, 'search:100', ['3', '5'].map((id) => msg('100', id)), seedOf('general'));
    await updateWorkspace(wid, (record) => {
      record.conversations['search:100'].pagination = { ...record.conversations['search:100'].pagination, mode: 'search' };
    });
    const manifest = await exportWorkspaceFile(wid);
    expect(manifest).toMatchObject({ conversations: 2, messages: 12 });
    await importWorkspaceFile(
      fileBytes('Raid_ archive.discrub-workspace'),
      { wid: 'imported', name: 'Raid copy', color: '#faa61a' },
      (record) => installImportedWorkspace(record, false),
    );
    expect(await countRows('imported', '100')).toBe(7);
    expect(await countRows('imported', 'search:100')).toBe(2);
    expect((await getWorkspace('imported'))!.conversations['search:100'].pagination.mode).toBe('search');
  });

  it('replace drops the rows that were there and keeps the place in the order', async () => {
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, '999', [msg('999', '50')], seedOf('old'));
    const wid = await seedRaidArchive();
    await exportWorkspaceFile(wid);
    await importWorkspaceFile(
      fileBytes('Raid_ archive.discrub-workspace'),
      { wid: LEGACY_DEFAULT_WORKSPACE_ID, name: 'Raid: archive', color: '#3ba55d' },
      (record) => installImportedWorkspace(record, true),
    );
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '999')).toBe(0);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, '100')).toBe(7);
    const record = await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID);
    expect(Object.keys(record!.conversations).sort()).toEqual(['100', '200']);
    expect((await listWorkspaces()).map((w) => w.wid)).toEqual([LEGACY_DEFAULT_WORKSPACE_ID, wid]);
  });

  it('never installs over a workspace without replace', async () => {
    const wid = await seedRaidArchive();
    await exportWorkspaceFile(wid);
    await expect(
      importWorkspaceFile(fileBytes('Raid_ archive.discrub-workspace'), { wid, name: 'x', color: '#000' }, (record) => installImportedWorkspace(record, false)),
    ).rejects.toThrow(/already exists/);
    expect(await countRows(wid, '100')).toBe(7);
  });

  it('refuses a newer schema with the version it needs, and a zip that is not a workspace', async () => {
    const newer = zipSync({ 'manifest.json': u8(JSON.stringify({ format: 'discrub-workspace', schema: 99, wid: 'w', appVersion: '3.0.0' })) });
    await expect(readWorkspaceManifest(newer)).rejects.toMatchObject({ reason: 'needsUpdate', appVersion: '3.0.0' });
    const other = zipSync({ 'messages.csv': u8('a,b') });
    await expect(readWorkspaceManifest(other)).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(readWorkspaceManifest(u8('not a zip at all'))).rejects.toMatchObject({ reason: 'notWorkspace' });
  });

  it('cleans names no file system takes', () => {
    expect(workspaceFileName('Raid: archive')).toBe('Raid_ archive');
    expect(workspaceFileName('a/b\\c')).toBe('a_b_c');
    expect(workspaceFileName('  ')).toBe('workspace');
  });
});
