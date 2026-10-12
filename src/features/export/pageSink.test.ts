/**
 * 2.2.5 WP6c: where an export's walk puts its pages.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockMessages } from '@/test/fixtures';
import { DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';

const quota = vi.hoisted(() => ({ fail: false }));

vi.mock('@services/workspaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/workspaceStore')>();
  return {
    ...actual,
    writePage: vi.fn((...args: Parameters<typeof actual.writePage>) =>
      quota.fail ? Promise.reject(new actual.WorkspaceQuotaError(args[0], args[1])) : actual.writePage(...args)),
  };
});

import { countRows, deleteWorkspaceDatabase, ensureDefaultWorkspace, getConversation } from '@services/workspaceStore';
import { arraySink, storeSink } from './pageSink';

const seed = { kind: 'channel' as const, guildId: 'g', name: 'general' };

async function idsOf(sink: { source(): { windows(d: 'asc'): AsyncIterable<Array<{ id: string }>> } }) {
  const ids: string[] = [];
  for await (const window of sink.source().windows('asc')) ids.push(...window.map((m) => m.id));
  return ids;
}

beforeEach(async () => {
  quota.fail = false;
  await deleteWorkspaceDatabase();
  await ensureDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('arraySink', () => {
  it('keeps the pages in memory', async () => {
    const sink = arraySink();
    await sink.add(createMockMessages(2));
    await sink.add(createMockMessages(3).slice(2));
    expect(sink.count).toBe(3);
    expect(sink.inMemory()).toHaveLength(3);
    expect(await idsOf(sink)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });
});

describe('storeSink', () => {
  it('writes each page to the run conversation and marks it complete', async () => {
    const sink = storeSink({ wid: DEFAULT_WORKSPACE_ID, cid: 'run:c1', seed });
    const messages = createMockMessages(5);
    await sink.add(messages.slice(0, 2));
    await sink.add(messages.slice(2));
    expect(sink.count).toBe(5);
    expect(sink.inMemory()).toBeNull();
    expect(await countRows(DEFAULT_WORKSPACE_ID, 'run:c1')).toBe(5);
    expect(await idsOf(sink)).toEqual(messages.map((m) => m.id));
    expect((await getConversation(DEFAULT_WORKSPACE_ID, 'run:c1'))?.complete).toBe(false);
    await sink.complete();
    expect((await getConversation(DEFAULT_WORKSPACE_ID, 'run:c1'))?.complete).toBe(true);
  });

  it('carries on in memory when the browser storage is full, warning once', async () => {
    const onStorageFull = vi.fn();
    const sink = storeSink({ wid: DEFAULT_WORKSPACE_ID, cid: 'run:c1', seed, onStorageFull });
    const messages = createMockMessages(6);
    await sink.add(messages.slice(0, 2));
    quota.fail = true;
    await sink.add(messages.slice(2, 4));
    await sink.add(messages.slice(4));
    expect(onStorageFull).toHaveBeenCalledTimes(1);
    expect(sink.count).toBe(6);
    expect(sink.inMemory()).toHaveLength(6);
    expect(await idsOf(sink)).toEqual(messages.map((m) => m.id));
    // The half written run conversation is gone, and complete has nothing to mark.
    expect(await getConversation(DEFAULT_WORKSPACE_ID, 'run:c1')).toBeNull();
    await sink.complete();
    expect(await getConversation(DEFAULT_WORKSPACE_ID, 'run:c1')).toBeNull();
  });
});
