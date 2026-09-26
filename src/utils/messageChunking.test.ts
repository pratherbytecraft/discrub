import { describe, it, expect } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import { chunkMessages, localDayKey, messageDayKey, CHUNK_WINDOW_MS } from './messageChunking';

const msg = (
  id: string,
  authorId: string,
  timestamp: string,
  overrides: Partial<Message> = {},
): Message =>
  ({
    id,
    author: { id: authorId, username: `user-${authorId}` } as Message['author'],
    timestamp,
    type: 0,
    content: `msg ${id}`,
    ...overrides,
  }) as Message;

describe('chunkMessages', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkMessages([])).toEqual([]);
  });

  it('wraps a single message in a single chunk', () => {
    const m = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const chunks = chunkMessages([m]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].key).toBe('1');
    expect(chunks[0].authorId).toBe('alice');
    expect(chunks[0].messages).toEqual([m]);
  });

  it('groups same-author messages within the time window', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const b = msg('2', 'alice', '2026-04-19T15:03:00.000Z');
    const c = msg('3', 'alice', '2026-04-19T15:06:00.000Z');
    const chunks = chunkMessages([a, b, c]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].messages).toEqual([a, b, c]);
  });

  it('splits on author change', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const b = msg('2', 'bob', '2026-04-19T15:01:00.000Z');
    const chunks = chunkMessages([a, b]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].authorId).toBe('alice');
    expect(chunks[1].authorId).toBe('bob');
  });

  it('splits when the time gap equals or exceeds the window', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const b = msg(
      '2',
      'alice',
      new Date(
        new Date('2026-04-19T15:00:00.000Z').getTime() + CHUNK_WINDOW_MS,
      ).toISOString(),
    );
    const chunks = chunkMessages([a, b]);
    expect(chunks).toHaveLength(2);
  });

  it('keeps messages grouped when the gap is just under the window', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const b = msg(
      '2',
      'alice',
      new Date(
        new Date('2026-04-19T15:00:00.000Z').getTime() + CHUNK_WINDOW_MS - 1,
      ).toISOString(),
    );
    const chunks = chunkMessages([a, b]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].messages).toHaveLength(2);
  });

  it('uses absolute time delta so newest-first order still groups', () => {
    const newer = msg('2', 'alice', '2026-04-19T15:03:00.000Z');
    const older = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const chunks = chunkMessages([newer, older]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].messages).toEqual([newer, older]);
  });

  it('breaks the chunk on a reply (type 19) message', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const reply = msg('2', 'alice', '2026-04-19T15:01:00.000Z', { type: 19 });
    const b = msg('3', 'alice', '2026-04-19T15:02:00.000Z');
    const chunks = chunkMessages([a, reply, b]);
    expect(chunks).toHaveLength(3);
    expect(chunks[1].messages[0].type).toBe(19);
  });

  it('breaks the chunk on thread-starter (type 21) and other non-zero types', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const threadStarter = msg('2', 'alice', '2026-04-19T15:01:00.000Z', { type: 21 });
    const chunks = chunkMessages([a, threadStarter]);
    expect(chunks).toHaveLength(2);
  });

  it('handles missing author id by never grouping', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z', { author: undefined } as any);
    const b = msg('2', 'alice', '2026-04-19T15:01:00.000Z', { author: undefined } as any);
    const chunks = chunkMessages([a, b]);
    expect(chunks).toHaveLength(2);
  });

  it('handles missing timestamp by never grouping', () => {
    const a = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const b = msg('2', 'alice', undefined as any);
    const chunks = chunkMessages([a, b]);
    expect(chunks).toHaveLength(2);
  });

  it('resumes grouping after an interrupting author', () => {
    const a1 = msg('1', 'alice', '2026-04-19T15:00:00.000Z');
    const b1 = msg('2', 'bob', '2026-04-19T15:01:00.000Z');
    const a2 = msg('3', 'alice', '2026-04-19T15:02:00.000Z');
    const a3 = msg('4', 'alice', '2026-04-19T15:03:00.000Z');
    const chunks = chunkMessages([a1, b1, a2, a3]);
    expect(chunks.map((c) => c.authorId)).toEqual(['alice', 'bob', 'alice']);
    expect(chunks[2].messages).toHaveLength(2);
  });

  it('derives chunk key from the first message id', () => {
    const a = msg('111', 'alice', '2026-04-19T15:00:00.000Z');
    const b = msg('222', 'alice', '2026-04-19T15:01:00.000Z');
    const chunks = chunkMessages([a, b]);
    expect(chunks[0].key).toBe('111');
  });
});

describe('chunkMessages with splitByDay (Timeline)', () => {
  // Built from local date parts so the test holds in any time zone.
  const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();

  it('ends a chunk at local midnight even inside the grouping window', () => {
    const messages = [msg('2', 'a', local(2026, 7, 18, 0, 1)), msg('1', 'a', local(2026, 7, 17, 23, 58))];
    expect(chunkMessages(messages)).toHaveLength(1);
    const split = chunkMessages(messages, { splitByDay: true });
    expect(split).toHaveLength(2);
    expect(split.map((c) => localDayKey(c.firstTimestamp))).toEqual(['2026-07-18', '2026-07-17']);
  });

  it('still groups a run inside one day', () => {
    const messages = [msg('2', 'a', local(2026, 7, 17, 10, 3)), msg('1', 'a', local(2026, 7, 17, 10, 1))];
    expect(chunkMessages(messages, { splitByDay: true })).toHaveLength(1);
  });

  it('gives an empty key for a missing or unreadable timestamp', () => {
    expect(localDayKey(undefined)).toBe('');
    expect(localDayKey('not a date')).toBe('');
  });
});

describe('chunkMessages reuse (2.2.1 perf)', () => {
  const t = (n: number) => new Date(Date.UTC(2026, 6, 17, 10, n)).toISOString();

  it('returns the same chunk object when its messages did not change', () => {
    const a1 = msg('1', 'a', t(0));
    const a2 = msg('2', 'a', t(1));
    const b1 = msg('3', 'b', t(2));
    const first = chunkMessages([a1, a2, b1]);
    const older = msg('4', 'c', t(5));
    const next = chunkMessages([a1, a2, b1, older], {}, first);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next[2].key).toBe('4');
  });

  it('makes a new chunk when a message inside it was removed', () => {
    const a1 = msg('1', 'a', t(0));
    const a2 = msg('2', 'a', t(1));
    const b1 = msg('3', 'b', t(2));
    const first = chunkMessages([a1, a2, b1]);
    const next = chunkMessages([a1, b1], {}, first);
    expect(next[0]).not.toBe(first[0]);
    expect(next[0].messages).toEqual([a1]);
    expect(next[1]).toBe(first[1]);
  });

  it('makes a new chunk when a message grew into it', () => {
    const a1 = msg('1', 'a', t(0));
    const b1 = msg('3', 'b', t(2));
    const first = chunkMessages([a1, b1]);
    const a2 = msg('2', 'a', t(1));
    const next = chunkMessages([a1, a2, b1], {}, first);
    expect(next[0]).not.toBe(first[0]);
    expect(next[0].messages).toEqual([a1, a2]);
  });

  it('works without a previous result', () => {
    expect(chunkMessages([msg('1', 'a', t(0))], {}, undefined)).toHaveLength(1);
    expect(chunkMessages([msg('1', 'a', t(0))], {}, [])).toHaveLength(1);
  });
});

describe('messageDayKey', () => {
  it('matches localDayKey and remembers the answer per message object', () => {
    const m = msg('1', 'a', new Date(2026, 6, 17, 23, 30).toISOString());
    expect(messageDayKey(m)).toBe(localDayKey(m.timestamp));
    expect(messageDayKey(m)).toBe('2026-07-17');
    const changed = { ...m, timestamp: new Date(2026, 6, 18, 1, 0).toISOString() } as Message;
    expect(messageDayKey(changed)).toBe('2026-07-18');
    expect(messageDayKey(m)).toBe('2026-07-17');
  });

  it('gives an empty key for a missing timestamp', () => {
    expect(messageDayKey({ timestamp: '' } as Message)).toBe('');
  });
});

describe('chunkMessages appended page (2.2.1 perf)', () => {
  const t = (n: number) => new Date(Date.UTC(2026, 6, 17, 10, n)).toISOString();

  it('keeps every earlier chunk and re-chunks only the end when a page is appended at the tail', () => {
    const a1 = msg('1', 'a', t(0)); const a2 = msg('2', 'a', t(1)); const b1 = msg('3', 'b', t(2));
    const first = chunkMessages([a1, a2, b1]);
    const b2 = msg('4', 'b', t(3)); const c1 = msg('5', 'c', t(4));
    const next = chunkMessages([a1, a2, b1, b2, c1], {}, first);
    expect(next.map((c) => c.messages.map((m) => m.id))).toEqual([['1', '2'], ['3', '4'], ['5']]);
    expect(next[0]).toBe(first[0]);
    expect(next).toEqual(chunkMessages([a1, a2, b1, b2, c1]));
  });

  it('keeps every later chunk when a page is added at the head', () => {
    const b1 = msg('3', 'b', t(2)); const c1 = msg('5', 'c', t(4));
    const first = chunkMessages([b1, c1]);
    const a1 = msg('1', 'a', t(0)); const b0 = msg('2', 'b', t(1));
    const next = chunkMessages([a1, b0, b1, c1], {}, first);
    expect(next.map((c) => c.messages.map((m) => m.id))).toEqual([['1'], ['2', '3'], ['5']]);
    expect(next[2]).toBe(first[1]);
    expect(next).toEqual(chunkMessages([a1, b0, b1, c1]));
  });

  it('chains across several appended pages', () => {
    let list = [msg('1', 'a', t(0))];
    let chunks = chunkMessages(list);
    for (let i = 2; i <= 12; i++) {
      list = [...list, msg(String(i), i % 3 === 0 ? 'b' : 'a', t(i * 10))];
      chunks = chunkMessages(list, {}, chunks);
      expect(chunks).toEqual(chunkMessages(list));
    }
  });
});
