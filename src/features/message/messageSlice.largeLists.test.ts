/**
 * 2.2.5 W1: the reducers' per page and per change work on large lists.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { Message } from 'discrub-core/types/discord-types';
import { SortDirection } from 'discrub-core/common-enum';
import { IsPinnedType } from 'discrub-core/discord-enum';
import { createMockMessage, createMockUser } from '@/test/fixtures';
import messageReducer, {
  appendLoadAllPage,
  clearMessages,
  deleteAllReactions,
  messagesRemoved,
  reactionRowsSynced,
  refineApplied,
  setMessages,
  setOrder,
  takeArrivedUserIds,
  toggleMessageSelection,
} from './messageSlice';
import { MAIN_CONTAINER, clearMessageCache, dropCachedMessages, getCachedMessage } from './messageCache';
import { RowFlag, applyRefineToRows } from './messageRows';

const BASE = 1_700_000_000_000;
/** Real snowflakes, so the id and the timestamp agree as Discord's do. */
const snowflake = (ms: number, n = 0): string => String((BigInt(ms - 1420070400000) << 22n) + BigInt(n));
const msg = (i: number, extra: Partial<Message> = {}): Message => {
  const ms = BASE + i * 1000;
  return createMockMessage({ id: snowflake(ms), timestamp: new Date(ms).toISOString(), content: `m${i}`, ...extra }) as Message;
};
/** Newest first, the way Discord pages arrive. */
const pageOf = (from: number, count: number, extra: (i: number) => Partial<Message> = () => ({})): Message[] =>
  Array.from({ length: count }, (_, k) => msg(from - k, extra(from - k)));

const makeStore = () => configureStore({
  reducer: { message: messageReducer },
  middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
});

beforeEach(() => {
  clearMessageCache();
  takeArrivedUserIds();
});

describe('appendLoadAllPage (2.2.5 W1)', () => {
  it('keeps every row once when a page overlaps the boundary', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(1000, 100)));
    // The next page starts two messages back inside the first.
    store.dispatch(appendLoadAllPage({ messages: pageOf(902, 100) }));
    const ids = store.getState().message.rows.map((r) => r.id);
    expect(ids).toHaveLength(198);
    expect(new Set(ids).size).toBe(198);
    expect(store.getState().message.rows[197].id).toBe(msg(803).id);
  });

  it('a page already loaded changes nothing', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(1000, 100)));
    const before = store.getState().message.rows;
    store.dispatch(appendLoadAllPage({ messages: pageOf(950, 20) }));
    expect(store.getState().message.rows).toBe(before);
  });

  it('merges a page under oldest first order at the right end', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(1000, 50)));
    store.dispatch(setOrder({ order: SortDirection.ASCENDING, orderBy: 'timestamp' }));
    store.dispatch(appendLoadAllPage({ messages: pageOf(950, 50) }));
    const rows = store.getState().message.rows;
    expect(rows).toHaveLength(100);
    expect(rows[0].id).toBe(msg(901).id);
    expect(rows[99].id).toBe(msg(1000).id);
  });

  it('runs only the new rows through a row refine, matching a full refilter', () => {
    const store = makeStore();
    const pinnedEvery3 = (i: number) => ({ pinned: i % 3 === 0 });
    store.dispatch(setMessages(pageOf(1000, 100, pinnedEvery3)));
    store.dispatch(refineApplied({ criteria: { isPinned: IsPinnedType.YES } as never }));
    for (let from = 900; from > 400; from -= 100) store.dispatch(appendLoadAllPage({ messages: pageOf(from, 100, pinnedEvery3) }));
    const state = store.getState().message;
    expect(state.rows).toHaveLength(600);
    expect(state.filteredRows).not.toBe(state.rows);
    expect(state.filteredRows.map((r) => r.id)).toEqual(applyRefineToRows(state.rows, state.refineCriteria, null).map((r) => r.id));
    expect(state.filteredRows).toHaveLength(200);
  });

  it('adds the content matches of new rows only', () => {
    const store = makeStore();
    const needle = (i: number) => ({ content: i % 4 === 0 ? 'needle' : 'hay' });
    store.dispatch(setMessages(pageOf(1000, 100, needle)));
    store.dispatch(refineApplied({ criteria: { searchMessageContents: ['needle'] } as never, contentMatchIds: pageOf(1000, 100, needle).filter((m) => m.content === 'needle').map((m) => m.id) }));
    store.dispatch(appendLoadAllPage({ messages: pageOf(901, 100, needle) }));
    const state = store.getState().message;
    expect(state.rows).toHaveLength(199);
    expect(state.contentMatchIds).toHaveLength(50);
    expect(state.filteredRows).toHaveLength(50);
  });

  it('with no refine the two lists stay one array', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(1000, 100)));
    store.dispatch(appendLoadAllPage({ messages: pageOf(900, 100) }));
    const state = store.getState().message;
    expect(state.filteredRows).toBe(state.rows);
  });
});

describe('row changes by id (2.2.5 W1)', () => {
  it('removes a few rows from both lists and the selection', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(1000, 300, (i) => ({ pinned: i % 2 === 0 }))));
    store.dispatch(refineApplied({ criteria: { isPinned: IsPinnedType.YES } as never }));
    const gone = [msg(1000).id, msg(998).id, msg(999).id];
    store.dispatch(toggleMessageSelection(gone[0]));
    store.dispatch(toggleMessageSelection(msg(990).id));
    store.dispatch(messagesRemoved({ ids: gone, containerId: null }));
    const state = store.getState().message;
    expect(state.rows).toHaveLength(297);
    expect(state.rows.some((r) => gone.includes(r.id))).toBe(false);
    expect(state.filteredRows).toHaveLength(148);
    expect(state.selectedIds).toEqual([msg(990).id]);
  });

  it('removes many rows in one walk', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(1000, 300)));
    const gone = pageOf(1000, 300).filter((_, k) => k % 3 === 0).map((m) => m.id);
    store.dispatch(messagesRemoved({ ids: gone, containerId: null }));
    expect(store.getState().message.rows).toHaveLength(200);
    expect(store.getState().message.filteredRows).toBe(store.getState().message.rows);
  });

  it('a reaction change on a cached message updates its row in place', () => {
    const store = makeStore();
    const reacted = msg(500, { reactions: [{ count: 1, me: true, emoji: { name: 'x' } }] as never });
    store.dispatch(setMessages([...pageOf(1000, 400), reacted]));
    const before = store.getState().message.rows;
    store.dispatch(deleteAllReactions.fulfilled({ messageId: reacted.id, emoji: 'x' } as never, 'r', {} as never));
    const after = store.getState().message.rows;
    expect(after).not.toBe(before);
    const row = after.find((r) => r.id === reacted.id);
    expect(row?.hasReactions).toBe(false);
    expect(after.filter((r, i) => r !== before[i])).toHaveLength(1);
  });

  it('reactionRowsSynced brings an evicted message row up to date and leaves current rows alone', () => {
    const store = makeStore();
    const reacted = msg(500, { reactions: [{ count: 1, me: true, emoji: { name: 'x' } }] as never });
    store.dispatch(setMessages([...pageOf(1000, 10), reacted]));
    dropCachedMessages(MAIN_CONTAINER, [reacted.id]);
    store.dispatch(reactionRowsSynced({ containerId: null, messages: [{ ...reacted, reactions: [] }] }));
    const row = store.getState().message.rows.find((r) => r.id === reacted.id);
    expect(row?.hasReactions).toBe(false);
    expect((row?.flags ?? 0) & RowFlag.MY_REACTION).toBe(0);
    expect(getCachedMessage(MAIN_CONTAINER, reacted.id)).toBeUndefined();
    const before = store.getState().message.rows;
    store.dispatch(reactionRowsSynced({ containerId: null, messages: [{ ...reacted, reactions: [] }] }));
    expect(store.getState().message.rows).toBe(before);
  });
});

describe('selection toggles (2.2.5 W1)', () => {
  it('adds and takes out one id', () => {
    const store = makeStore();
    store.dispatch(setMessages(pageOf(10, 5)));
    store.dispatch(toggleMessageSelection('a'));
    store.dispatch(toggleMessageSelection('b'));
    store.dispatch(toggleMessageSelection('a'));
    expect(store.getState().message.selectedIds).toEqual(['b']);
  });
});

describe('user ids per page (2.2.5 W1)', () => {
  it('hands over the authors and mentions of each main page once', () => {
    const store = makeStore();
    const by = (i: number) => ({ author: createMockUser({ id: `u${i % 3}` }), mentions: i === 10 ? [createMockUser({ id: 'm1' })] : [] });
    store.dispatch(setMessages(pageOf(10, 5, by)));
    expect(takeArrivedUserIds().sort()).toEqual(['m1', 'u0', 'u1', 'u2']);
    expect(takeArrivedUserIds()).toEqual([]);
    store.dispatch(appendLoadAllPage({ messages: pageOf(5, 2, () => ({ author: createMockUser({ id: 'u9' }) })) }));
    expect(takeArrivedUserIds()).toEqual(['u9']);
    store.dispatch(setMessages(pageOf(3, 1)));
    store.dispatch(clearMessages());
    expect(takeArrivedUserIds()).toEqual([]);
  });
});

