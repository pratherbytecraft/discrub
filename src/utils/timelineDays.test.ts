import { describe, it, expect } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import { addDays, buildTimeline, rangeToDates, DAY_BAR_LIMIT, WEEK_BAR_LIMIT } from './timelineDays';

// Built from local date parts so the tests hold in any time zone.
const at = (id: string, y: number, mo: number, d: number, h = 12, mi = 0): Message => ({ id, timestamp: new Date(y, mo - 1, d, h, mi).toISOString() }) as Message;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe('buildTimeline', () => {
  it('returns an empty model for no messages', () => {
    const m = buildTimeline([]);
    expect(m.total).toBe(0);
    expect(m.bars).toEqual([]);
    expect(m.months).toEqual([]);
  });

  it('draws one bar per calendar day, empty days included, oldest first', () => {
    const m = buildTimeline([at('5', 2026, 7, 17, 21), at('4', 2026, 7, 17, 9), at('3', 2026, 7, 15), at('2', 2026, 7, 14), at('1', 2026, 7, 14, 8)]);
    expect(m.unit).toBe('day');
    expect(m.bars.map((b) => [b.from, b.count])).toEqual([['2026-07-14', 2], ['2026-07-15', 1], ['2026-07-16', 0], ['2026-07-17', 2]]);
    expect(m.firstDay).toBe('2026-07-14');
    expect(m.lastDay).toBe('2026-07-17');
  });

  it('makes the bars, the months and the day counts add up to the same total', () => {
    const messages = [at('a', 2026, 4, 30), at('b', 2026, 5, 1), at('c', 2026, 5, 1, 13), at('d', 2026, 6, 20), at('e', 2026, 7, 17), at('f', 2026, 7, 17, 15)];
    const m = buildTimeline(messages);
    expect(m.total).toBe(6);
    expect(sum(m.bars.map((b) => b.count))).toBe(6);
    expect(sum(m.months.map((x) => x.count))).toBe(6);
    expect(sum(Array.from(m.dayCounts.values()))).toBe(6);
    expect(m.months.map((x) => [x.key, x.count])).toEqual([['2026-07', 2], ['2026-06', 1], ['2026-05', 2], ['2026-04', 1]]);
  });

  it('points each bar and month at its newest message, whatever order the list is in', () => {
    const m = buildTimeline([at('old', 2026, 7, 17, 9), at('new', 2026, 7, 17, 21), at('june', 2026, 6, 2)]);
    expect(m.bars[m.bars.length - 1].newestId).toBe('new');
    expect(m.months[0].newestId).toBe('new');
    expect(m.months[1].newestId).toBe('june');
    expect(m.bars.find((b) => b.count === 0)?.newestId).toBeNull();
  });

  it('leaves out messages without a readable timestamp', () => {
    const m = buildTimeline([at('1', 2026, 7, 17), { id: 'x', timestamp: '' } as Message, { id: 'y', timestamp: 'nope' } as Message]);
    expect(m.total).toBe(1);
  });

  it('switches to a bar per week past the day limit and per month past the week limit, keeping the total', () => {
    const weekly = buildTimeline([at('1', 2026, 1, 1), at('2', 2026, 1, 1 + DAY_BAR_LIMIT + 5)]);
    expect(weekly.unit).toBe('week');
    expect(sum(weekly.bars.map((b) => b.count))).toBe(2);
    expect(weekly.bars.every((b, i) => i === 0 || b.from === addDays(weekly.bars[i - 1].to, 1))).toBe(true);
    const monthly = buildTimeline([at('1', 2023, 3, 15), at('2', 2023, 3, 15 + WEEK_BAR_LIMIT + 40), at('3', 2024, 2, 29)]);
    expect(monthly.unit).toBe('month');
    expect(sum(monthly.bars.map((b) => b.count))).toBe(3);
    expect(monthly.bars[0].from).toBe('2023-03-15');
    expect(monthly.bars[0].to).toBe('2023-03-31');
    expect(monthly.bars[1].from).toBe('2023-04-01');
  });
});

describe('addDays and rangeToDates', () => {
  it('steps over month ends and daylight saving changes one calendar day at a time', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('covers the first day from its start to the last day to its end, in either drag direction', () => {
    const a = rangeToDates('2026-07-10', '2026-07-15');
    const b = rangeToDates('2026-07-15', '2026-07-10');
    expect(a.after).toEqual(new Date(2026, 6, 10, 0, 0, 0, 0));
    expect(a.before).toEqual(new Date(2026, 6, 15, 23, 59, 59, 999));
    expect(b).toEqual(a);
  });
});
