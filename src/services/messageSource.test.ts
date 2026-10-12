/**
 * 2.2.5 WP6c: the message sources an export reads a window at a time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockMessages } from '@/test/fixtures';
import { deleteWorkspaceDatabase, ensureDefaultWorkspace, writePage } from './workspaceStore';
import { DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import {
  arraySource,
  collectMessages,
  concatSources,
  forEachMessage,
  isMessageSource,
  pageCount,
  pagesOf,
  storeSource,
  storeSourceOf,
  toSource,
  WINDOW_SIZE,
} from './messageSource';

const seed = { kind: 'channel' as const, guildId: 'g', name: 'general' };

async function drain(source: { windows: (d: 'asc' | 'desc') => AsyncIterable<Array<{ id: string }>> }, direction: 'asc' | 'desc') {
  const ids: string[] = [];
  const sizes: number[] = [];
  for await (const window of source.windows(direction)) {
    sizes.push(window.length);
    ids.push(...window.map((m) => m.id));
  }
  return { ids, sizes };
}

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('arraySource', () => {
  it('sorts by time either way and keeps the count', async () => {
    const messages = createMockMessages(3).reverse();
    const source = arraySource(messages);
    expect(source.count).toBe(3);
    expect((await drain(source, 'asc')).ids).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect((await drain(source, 'desc')).ids).toEqual(['msg-3', 'msg-2', 'msg-1']);
    expect(messages.map((m) => m.id)).toEqual(['msg-3', 'msg-2', 'msg-1']);
  });

  it('splits long lists into windows', async () => {
    const source = arraySource(createMockMessages(WINDOW_SIZE + 3));
    expect((await drain(source, 'asc')).sizes).toEqual([WINDOW_SIZE, 3]);
  });
});

describe('storeSource', () => {
  it('reads the conversation in id order in both directions', async () => {
    const messages = createMockMessages(7);
    await writePage(DEFAULT_WORKSPACE_ID, 'c1', messages, seed);
    const source = await storeSourceOf(DEFAULT_WORKSPACE_ID, 'c1');
    expect(source.count).toBe(7);
    expect((await drain(source, 'asc')).ids).toEqual(messages.map((m) => m.id));
    expect((await drain(source, 'desc')).ids).toEqual(messages.map((m) => m.id).reverse());
  });

  it('keeps only the ids a refine accepted', async () => {
    await writePage(DEFAULT_WORKSPACE_ID, 'c1', createMockMessages(6), seed);
    const source = await storeSourceOf(DEFAULT_WORKSPACE_ID, 'c1', new Set(['msg-2', 'msg-5']));
    expect(source.count).toBe(2);
    expect((await drain(source, 'desc')).ids).toEqual(['msg-5', 'msg-2']);
  });

  it('walks past the window size', async () => {
    const messages = createMockMessages(WINDOW_SIZE + 2);
    await writePage(DEFAULT_WORKSPACE_ID, 'c1', messages, seed);
    const { ids, sizes } = await drain(storeSource(DEFAULT_WORKSPACE_ID, 'c1', messages.length), 'asc');
    expect(sizes).toEqual([WINDOW_SIZE, 2]);
    expect(ids).toHaveLength(messages.length);
    expect(new Set(ids).size).toBe(messages.length);
  });

  it('is empty for a conversation that is not there', async () => {
    const source = await storeSourceOf(DEFAULT_WORKSPACE_ID, 'nope');
    expect(source.count).toBe(0);
    expect((await drain(source, 'asc')).ids).toEqual([]);
  });
});

describe('helpers', () => {
  it('tells a source from an array', () => {
    expect(isMessageSource(arraySource([]))).toBe(true);
    expect(isMessageSource([])).toBe(false);
    expect(toSource([]).count).toBe(0);
  });

  it('concatenates sources and walks them with a running index', async () => {
    const a = arraySource(createMockMessages(2));
    const b = arraySource([{ ...createMockMessages(1)[0], id: 'other', timestamp: '2027-01-01T00:00:00.000Z' }] as never);
    const both = concatSources([a, b]);
    expect(both.count).toBe(3);
    const seen: Array<[string, number]> = [];
    await forEachMessage(both, (m, index) => seen.push([m.id, index]));
    expect(seen).toEqual([['msg-1', 0], ['msg-2', 1], ['other', 2]]);
    expect((await collectMessages(both, (m) => m.id === 'other')).map((m) => m.id)).toEqual(['other']);
  });

  it('pages a source in the export order', async () => {
    const source = arraySource(createMockMessages(5));
    const pages: Array<[number, string[]]> = [];
    for await (const page of pagesOf(source, 2, 'desc')) pages.push([page.pageNumber, page.messages.map((m) => m.id)]);
    expect(pages).toEqual([[1, ['msg-5', 'msg-4']], [2, ['msg-3', 'msg-2']], [3, ['msg-1']]]);
    expect(pageCount(5, 2)).toBe(3);
    expect(pageCount(0, 2)).toBe(0);
    expect(pageCount(2, 2)).toBe(1);
  });
});
