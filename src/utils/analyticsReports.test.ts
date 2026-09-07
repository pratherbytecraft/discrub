import { describe, it, expect } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import {
  ANALYTICS_REPORTS,
  REPORT_IDS,
  REPORT_LIST,
  BESTOF_MIN_REACTIONS,
  domainOf,
  emojiLabel,
  exportReportCSV,
  formatHour,
  parseTerms,
} from './analyticsReports';

type Partial<T> = { [K in keyof T]?: T[K] };

const user = (id: string, username: string, extra: Partial<Message['author']> = {}) =>
  ({ id, username, discriminator: '0', global_name: null, avatar: null, ...extra }) as Message['author'];

const alice = user('1', 'alice', { global_name: 'Alice' });
const bob = user('2', 'bob');
const bot = user('9', 'statsbot', { bot: true });

let nextId = 100;
const msg = (overrides: Partial<Message> = {}): Message =>
  ({
    id: String(nextId++),
    channel_id: 'chan',
    author: alice,
    content: '',
    timestamp: '2026-08-10T15:00:00.000Z',
    type: 0,
    attachments: [],
    embeds: [],
    mentions: [],
    ...overrides,
  }) as Message;

const reaction = (name: string, count: number, id?: string) => ({ count, emoji: { id: id ?? null, name } }) as Message['reactions'] extends (infer R)[] | undefined ? R : never;

const userMap = { '1': { userName: 'alice', displayName: 'Alice', nick: 'Ali' }, '2': { userName: 'bob' } };
const ctx = { userMap };

describe('analyticsReports registry', () => {
  it('lists every report once, in tab order', () => {
    expect(REPORT_LIST.map((r) => r.id)).toEqual(REPORT_IDS);
    expect(new Set(REPORT_IDS).size).toBe(REPORT_IDS.length);
    REPORT_LIST.forEach((r) => {
      expect(r.label).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.description).toBeTruthy();
    });
  });

  it('every report returns an empty state on no messages', () => {
    REPORT_LIST.forEach((r) => {
      const result = r.compute([], ctx);
      expect(result.rows).toEqual([]);
      expect(result.empty).toBeTruthy();
    });
  });
});

describe('mentions', () => {
  it('counts @mentions and resolves names from the user map', () => {
    const rows = ANALYTICS_REPORTS.mentions.compute([msg({ content: '<@1> and <@2>' }), msg({ content: '<@1>' })], ctx).rows;
    expect(rows).toEqual([
      { key: '1', label: 'Ali', count: 2 },
      { key: '2', label: 'bob', count: 1 },
    ]);
  });
});

describe('members', () => {
  it('counts messages per person, prefers nick, skips bots and system messages', () => {
    const rows = ANALYTICS_REPORTS.members.compute(
      [msg(), msg(), msg({ author: bob }), msg({ author: bot }), msg({ author: bob, type: 7 }), msg({ author: bob, type: 19 })],
      ctx,
    ).rows;
    expect(rows).toEqual([
      { key: '1', label: 'Ali', count: 2 },
      { key: '2', label: 'bob', count: 2 },
    ]);
  });

  it('skips webhook posts', () => {
    const rows = ANALYTICS_REPORTS.members.compute([msg({ webhook_id: 'w' })], ctx).rows;
    expect(rows).toEqual([]);
  });
});

describe('reactions', () => {
  it('sums reactions received per author and ignores zero-count reactions', () => {
    const result = ANALYTICS_REPORTS.reactions.compute(
      [msg({ reactions: [reaction('👍', 3), reaction('x', 0)] }), msg({ author: bob, reactions: [reaction('❤️', 1)] }), msg({ author: bob })],
      ctx,
    );
    expect(result.rows).toEqual([
      { key: '1', label: 'Ali', count: 3 },
      { key: '2', label: 'bob', count: 1 },
    ]);
    expect(result.summary).toBe("4 reactions on 2 people's messages");
  });
});

describe('bestof', () => {
  it('lists messages with 2+ reactions, breakdown per emoji, custom emoji as :name:', () => {
    const hot = msg({ id: '500', content: 'a very good post', reactions: [reaction('🔥', 5), reaction('pepe', 2, '123')] });
    const meh = msg({ id: '501', content: 'meh', reactions: [reaction('👍', 1)] });
    const ok = msg({ id: '502', author: bob, content: 'ok', reactions: [reaction('👍', 2)] });
    const result = ANALYTICS_REPORTS.bestof.compute([meh, ok, hot], ctx);
    expect(BESTOF_MIN_REACTIONS).toBe(2);
    expect(result.rows.map((r) => r.key)).toEqual(['500', '502']);
    expect(result.rows[0]).toMatchObject({ label: 'Ali', count: 7, detail: '🔥 5 · :pepe: 2', excerpt: 'a very good post', channelId: 'chan' });
    expect(result.summary).toBe('🔥 5 · 👍 3 · :pepe: 2');
    expect(result.mode).toBe('2+ reactions only');
  });

  it('breaks ties by newest message first and describes text-less messages', () => {
    const older = msg({ id: '600', content: '', attachments: [{ filename: 'cat.png' }] as Message['attachments'], reactions: [reaction('👍', 2)] });
    const newer = msg({ id: '601', content: 'x'.repeat(100), reactions: [reaction('👍', 2)] });
    const rows = ANALYTICS_REPORTS.bestof.compute([older, newer], ctx).rows;
    expect(rows.map((r) => r.key)).toEqual(['601', '600']);
    expect(rows[0].excerpt).toHaveLength(80);
    expect(rows[0].excerpt?.endsWith('…')).toBe(true);
    expect(rows[1].excerpt).toBe('Attachment: cat.png');
  });
});

describe('threads', () => {
  it('counts messages outside the container channel, named from threadNames, with people', () => {
    const result = ANALYTICS_REPORTS.threads.compute(
      [msg(), msg({ channel_id: 't1' }), msg({ channel_id: 't1', author: bob }), msg({ channel_id: 't2' }), msg({ channel_id: 't1', author: bot })],
      { userMap, containerId: 'chan', threadNames: { t1: 'Help thread' } },
    );
    expect(result.rows).toEqual([
      { key: 't1', label: 'Help thread', count: 2, detail: '2 people', channelId: 't1' },
      { key: 't2', label: 'Thread t2', count: 1, detail: '1 person', channelId: 't2' },
    ]);
  });

  it('treats every message as a thread message when no container is known', () => {
    const rows = ANALYTICS_REPORTS.threads.compute([msg()], { userMap }).rows;
    expect(rows).toHaveLength(1);
  });
});

describe('keywords', () => {
  it('asks for terms when none are given', () => {
    const result = ANALYTICS_REPORTS.keywords.compute([msg({ content: 'crash' })], { userMap, terms: [] });
    expect(result.rows).toEqual([]);
    expect(result.empty).toMatch(/terms/i);
  });

  it('counts messages per term, case-insensitive, any-of summary, bots excluded', () => {
    const result = ANALYTICS_REPORTS.keywords.compute(
      [msg({ content: 'The app CRASHED on login' }), msg({ content: 'login works' }), msg({ content: 'crash', author: bot }), msg({ content: 'nothing' })],
      { userMap, terms: ['crash', 'login'] },
    );
    expect(result.rows).toEqual([
      { key: 'login', label: 'login', count: 2 },
      { key: 'crash', label: 'crash', count: 1 },
    ]);
    expect(result.summary).toBe('2 messages mention at least one term');
  });

  it('parseTerms trims, dedupes case-insensitively and caps at 10', () => {
    expect(parseTerms(' crash, Crash ,login,, ')).toEqual(['crash', 'login']);
    expect(parseTerms(Array.from({ length: 12 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
    expect(parseTerms('')).toEqual([]);
  });
});

describe('links', () => {
  it('counts one per message per domain from text and embeds, strips www', () => {
    const result = ANALYTICS_REPORTS.links.compute(
      [
        msg({ content: 'see https://www.youtube.com/watch?v=1 and https://youtube.com/2' }),
        msg({ content: 'nothing', embeds: [{ url: 'https://github.com/x' }] as Message['embeds'] }),
        msg({ content: 'https://github.com/y', author: bot }),
      ],
      ctx,
    );
    expect(result.rows).toEqual([
      { key: 'github.com', label: 'github.com', count: 1 },
      { key: 'youtube.com', label: 'youtube.com', count: 1 },
    ]);
    expect(result.summary).toBe('2 messages with links · 2 domains');
    expect(domainOf('not a url')).toBeUndefined();
  });
});

describe('media', () => {
  it('counts attachments per person with an image/video/other breakdown', () => {
    const result = ANALYTICS_REPORTS.media.compute(
      [
        msg({ attachments: [{ filename: 'a.png', content_type: 'image/png' }, { filename: 'clip.MOV' }] as Message['attachments'] }),
        msg({ author: bob, attachments: [{ filename: 'doc.pdf' }] as Message['attachments'] }),
        msg({ author: bot, attachments: [{ filename: 'chart.png' }] as Message['attachments'] }),
      ],
      ctx,
    );
    expect(result.rows).toEqual([
      { key: '1', label: 'Ali', count: 2 },
      { key: '2', label: 'bob', count: 1 },
    ]);
    expect(result.summary).toBe('3 total: 1 image, 1 video, 1 other');
  });
});

describe('overview', () => {
  it('computes the headline numbers in the given zone', () => {
    const result = ANALYTICS_REPORTS.overview.compute(
      [
        msg({ id: '700', timestamp: '2026-08-10T15:00:00.000Z', reactions: [reaction('🔥', 4)], content: 'best one' }),
        msg({ id: '701', timestamp: '2026-08-10T15:30:00.000Z', author: bob, type: 19, attachments: [{ filename: 'a.png' }] as Message['attachments'] }),
        msg({ id: '702', timestamp: '2026-08-11T03:00:00.000Z', channel_id: 't1', reactions: [reaction('👍', 1)] }),
        msg({ id: '703', timestamp: '2026-08-11T03:10:00.000Z', author: bot, attachments: [{ filename: 'b.png' }] as Message['attachments'] }),
      ],
      { userMap, containerId: 'chan', timeZone: 'UTC' },
    );
    expect(result.stats).toMatchObject({
      messages: 4,
      people: 2,
      reactions: 5,
      attachments: 1,
      replies: 1,
      threads: 1,
      busiestDay: { label: 'Mon, Aug 10, 2026', count: 2 },
      peakHour: { hour: 3, count: 2 },
      topEmoji: [
        { label: '🔥', count: 4 },
        { label: '👍', count: 1 },
      ],
      best: { messageId: '700', author: 'Ali', total: 4, excerpt: 'best one' },
    });
    expect(result.rows).toEqual([
      { key: '1', label: 'Ali', count: 2 },
      { key: '2', label: 'bob', count: 1 },
    ]);
  });

  it('formats the peak hour', () => {
    expect(formatHour(15)).toMatch(/3\s?PM|15/);
  });
});

describe('exportReportCSV', () => {
  it('writes subject, id and count, adding detail/message columns only when rows carry them', () => {
    const plain = exportReportCSV(ANALYTICS_REPORTS.members, [{ key: '1', label: 'Ali, "the" one', count: 2 }]);
    expect(plain).toBe('Member,ID,Messages\n"Ali, ""the"" one",1,2');
    const rich = exportReportCSV(ANALYTICS_REPORTS.bestof, [{ key: '5', label: 'Ali', count: 3, detail: '🔥 3', excerpt: 'hi' }]);
    expect(rich).toBe('Message,ID,Reactions,Detail,Message\nAli,5,3,🔥 3,hi');
  });

  it('emojiLabel renders unicode as-is and custom emoji as :name:', () => {
    expect(emojiLabel({ id: null, name: '👍' })).toBe('👍');
    expect(emojiLabel({ id: '1', name: 'pepe', animated: true })).toBe(':pepe:');
  });
});
