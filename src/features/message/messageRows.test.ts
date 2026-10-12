import { describe, it, expect } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import { AuthorType, HasType, IsPinnedType } from 'discrub-core/discord-enum';
import { SortDirection } from 'discrub-core/common-enum';
import { createMockMessage, createMockUser } from '@/test/fixtures';
import type { RefineCriteria } from './messageFiltering';
import {
  RowFlag,
  appendSortedRows,
  applyRefineToRows,
  mergeAuthors,
  messageMatchesContentRefine,
  refineNeedsContent,
  rowPredicate,
  rowWithReactions,
  sortRows,
  toMessageRow,
  toMessageRows,
} from './messageRows';

const at = (id: string, iso: string, extra: Partial<Message> = {}): Message =>
  createMockMessage({ id, timestamp: iso, ...extra }) as Message;

describe('toMessageRow', () => {
  it('keeps the fields the screen and the refines need', () => {
    const author = createMockUser({ id: 'u1', bot: true });
    const row = toMessageRow(at('1', '2026-05-01T10:00:00.000Z', {
      author,
      type: 19,
      pinned: true,
      mentions: [createMockUser({ id: 'u2' })],
      reactions: [{ emoji: { name: 'x' }, count: 2, me: true }] as never,
      attachments: [{ id: 'a', filename: 'clip.mp4', content_type: 'video/mp4' }] as never,
      content: 'see https://example.com',
      embeds: [{ title: 't' }] as never,
      webhook_id: 'w',
    }));
    expect(row.id).toBe('1');
    expect(row.timestamp).toBe('2026-05-01T10:00:00.000Z');
    expect(row.t).toBe(Date.parse('2026-05-01T10:00:00.000Z'));
    expect(row.authorId).toBe('u1');
    expect(row.type).toBe(19);
    expect(row.mentionIds).toEqual(['u2']);
    expect(row.hasReactions).toBe(true);
    for (const flag of [RowFlag.EMBED, RowFlag.VIDEO, RowFlag.FILE, RowFlag.LINK, RowFlag.PINNED, RowFlag.BOT, RowFlag.WEBHOOK, RowFlag.REPLY, RowFlag.MY_REACTION]) {
      expect(row.flags & flag).toBe(flag);
    }
    expect(row.flags & RowFlag.IMAGE).toBe(0);
    expect(row.flags & RowFlag.STICKER).toBe(0);
  });

  it('leaves mentionIds out when there are none', () => {
    const row = toMessageRow(at('1', '2026-05-01T10:00:00.000Z', { mentions: [] }));
    expect('mentionIds' in row).toBe(false);
    expect(row.hasReactions).toBe(false);
    expect(row.flags & RowFlag.MY_REACTION).toBe(0);
  });
});

describe('rowWithReactions', () => {
  it('returns the same row when nothing about the reactions changed', () => {
    const message = at('1', '2026-05-01T10:00:00.000Z', { reactions: [{ emoji: { name: 'x' }, count: 1, me: false }] as never });
    const row = toMessageRow(message);
    expect(rowWithReactions(row, message)).toBe(row);
  });

  it('updates hasReactions and the my reaction flag', () => {
    const row = toMessageRow(at('1', '2026-05-01T10:00:00.000Z'));
    const next = rowWithReactions(row, at('1', '2026-05-01T10:00:00.000Z', { reactions: [{ emoji: { name: 'x' }, count: 1, me: true }] as never }));
    expect(next.hasReactions).toBe(true);
    expect(next.flags & RowFlag.MY_REACTION).toBe(RowFlag.MY_REACTION);
    const cleared = rowWithReactions(next, at('1', '2026-05-01T10:00:00.000Z', { reactions: [] }));
    expect(cleared.hasReactions).toBe(false);
    expect(cleared.flags & RowFlag.MY_REACTION).toBe(0);
  });
});

describe('mergeAuthors', () => {
  it('keeps the map and its objects when the authors are already known', () => {
    const alice = createMockUser({ id: 'a', username: 'alice' });
    const first = mergeAuthors({}, [at('1', '2026-05-01T10:00:00.000Z', { author: alice })]);
    expect(Object.keys(first)).toEqual(['a']);
    const copy = { ...alice };
    const second = mergeAuthors(first, [at('2', '2026-05-01T10:01:00.000Z', { author: copy })]);
    expect(second).toBe(first);
    expect(second.a).toBe(alice);
  });

  it('replaces an author whose name changed and adds new ones', () => {
    const alice = createMockUser({ id: 'a', username: 'alice' });
    const first = mergeAuthors({}, [at('1', '2026-05-01T10:00:00.000Z', { author: alice })]);
    const renamed = createMockUser({ id: 'a', username: 'alicia' });
    const bob = createMockUser({ id: 'b', username: 'bob' });
    const second = mergeAuthors(first, [at('2', '2026-05-01T10:01:00.000Z', { author: renamed }), at('3', '2026-05-01T10:02:00.000Z', { author: bob })]);
    expect(second).not.toBe(first);
    expect(second.a).toBe(renamed);
    expect(second.b).toBe(bob);
    expect(first.a).toBe(alice);
  });
});

describe('sortRows and appendSortedRows', () => {
  const rows = toMessageRows([
    at('2', '2026-05-01T10:02:00.000Z'),
    at('1', '2026-05-01T10:01:00.000Z'),
    at('3', '2026-05-01T10:03:00.000Z'),
  ]);

  it('sorts newest first or oldest first', () => {
    expect(sortRows(rows, SortDirection.DESCENDING).map((r) => r.id)).toEqual(['3', '2', '1']);
    expect(sortRows(rows, SortDirection.ASCENDING).map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('appends a page at the tail or the head without a full sort', () => {
    const existing = sortRows(rows, SortDirection.DESCENDING);
    const older = toMessageRows([at('0', '2026-05-01T09:00:00.000Z')]);
    expect(appendSortedRows(existing, older, SortDirection.DESCENDING).map((r) => r.id)).toEqual(['3', '2', '1', '0']);
    const newer = toMessageRows([at('9', '2026-05-01T11:00:00.000Z')]);
    expect(appendSortedRows(existing, newer, SortDirection.DESCENDING).map((r) => r.id)).toEqual(['9', '3', '2', '1']);
    const middle = toMessageRows([at('2b', '2026-05-01T10:02:30.000Z')]);
    expect(appendSortedRows(existing, middle, SortDirection.DESCENDING).map((r) => r.id)).toEqual(['3', '2b', '2', '1']);
    expect(appendSortedRows(existing, [], SortDirection.DESCENDING)).toBe(existing);
  });
});

describe('refine on rows', () => {
  const base: RefineCriteria = {
    searchAfterDate: null,
    searchBeforeDate: null,
    searchMessageContents: [],
    selectedHasTypes: [],
    userIds: [],
    mentionIds: [],
    channelIds: [],
    isPinned: IsPinnedType.UNSET,
    authorType: null,
  };
  const messages = [
    at('1', '2026-05-01T10:00:00.000Z', { author: createMockUser({ id: 'u1' }), content: 'hello there', attachments: [{ id: 'a', filename: 'pic.png', content_type: 'image/png' }] as never }),
    at('2', '2026-05-02T10:00:00.000Z', { author: createMockUser({ id: 'u2', bot: true }), content: 'bot says', pinned: true }),
    at('3', '2026-05-03T10:00:00.000Z', { author: createMockUser({ id: 'u1' }), content: 'later', mentions: [createMockUser({ id: 'u9' })], type: 7 }),
  ];
  const rows = toMessageRows(messages);

  it('says which refines need the message objects', () => {
    expect(refineNeedsContent(null)).toBe(false);
    expect(refineNeedsContent(base)).toBe(false);
    expect(refineNeedsContent({ ...base, searchMessageContents: ['x'] })).toBe(true);
    expect(refineNeedsContent({ ...base, attachmentExtensions: ['png'] })).toBe(true);
    expect(refineNeedsContent({ ...base, attachmentFilename: 'pic' })).toBe(true);
  });

  it('has no predicate for an empty refine', () => {
    expect(rowPredicate(null)).toBeNull();
    expect(rowPredicate(base)).toBeNull();
    expect(applyRefineToRows(rows, base, null)).toBe(rows);
  });

  it('filters by date, author, has type, pinned, author type, mentions and system type', () => {
    const ids = (c: Partial<RefineCriteria>) => applyRefineToRows(rows, { ...base, ...c }, null).map((r) => r.id);
    expect(ids({ searchAfterDate: new Date('2026-05-01T12:00:00.000Z') })).toEqual(['2', '3']);
    expect(ids({ searchBeforeDate: new Date('2026-05-02T12:00:00.000Z') })).toEqual(['1', '2']);
    expect(ids({ userIds: ['u2'] })).toEqual(['2']);
    expect(ids({ selectedHasTypes: [HasType.IMAGE] })).toEqual(['1']);
    expect(ids({ selectedHasTypes: [HasType.FILE, HasType.LINK] })).toEqual(['1']);
    expect(ids({ isPinned: IsPinnedType.YES })).toEqual(['2']);
    expect(ids({ isPinned: IsPinnedType.NO })).toEqual(['1', '3']);
    expect(ids({ authorType: AuthorType.BOT })).toEqual(['2']);
    expect(ids({ authorType: AuthorType.USER })).toEqual(['1', '3']);
    expect(ids({ mentionIds: ['u9'] })).toEqual(['3']);
    expect(ids({ systemMessageGroups: ['pins'], systemMessageMode: 'hide' } as Partial<RefineCriteria>)).not.toContain('nothing');
  });

  it('runs the content part on the objects and the rest on the rows', () => {
    const criteria = { ...base, searchMessageContents: ['HELLO', 'later'] };
    const matched = messages.filter((m) => messageMatchesContentRefine(m, criteria)).map((m) => m.id);
    expect(matched).toEqual(['1', '3']);
    expect(applyRefineToRows(rows, criteria, new Set(matched)).map((r) => r.id)).toEqual(['1', '3']);
    expect(applyRefineToRows(rows, { ...criteria, userIds: ['u1'] }, new Set(['1'])).map((r) => r.id)).toEqual(['1']);
    // A content refine with no scan result yet shows nothing rather than everything.
    expect(applyRefineToRows(rows, criteria, null)).toEqual([]);
  });

  it('matches attachment names on the objects', () => {
    const criteria = { ...base, attachmentExtensions: ['png'] };
    expect(messageMatchesContentRefine(messages[0], criteria)).toBe(true);
    expect(messageMatchesContentRefine(messages[1], criteria)).toBe(false);
  });
});
