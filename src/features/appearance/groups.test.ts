import { describe, expect, it } from 'vitest';
import { groupItems, groupOrder, halloween, inSeason, isUnlocked } from './groups';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);

describe('holiday seasons (2.2.3)', () => {
  it('Halloween runs October 1 to November 2 of its own year only', () => {
    const s = halloween(2026);
    expect(inSeason(s, d(2026, 9, 30))).toBe(false);
    expect(inSeason(s, d(2026, 10, 1))).toBe(true);
    expect(inSeason(s, d(2026, 10, 31))).toBe(true);
    expect(inSeason(s, d(2026, 11, 2))).toBe(true);
    expect(inSeason(s, d(2026, 11, 3))).toBe(false);
    expect(inSeason(s, d(2027, 10, 15))).toBe(false);
    expect(inSeason(undefined, d(2026, 10, 15))).toBe(false);
  });

  it('unlocks free items always, supporter items with a key, holiday items in season too', () => {
    const free = { tier: 'free' as const };
    const paid = { tier: 'supporter' as const };
    const holiday = { tier: 'supporter' as const, season: halloween(2026) };
    expect(isUnlocked(free, false, d(2026, 9, 1))).toBe(true);
    expect(isUnlocked(paid, false, d(2026, 9, 1))).toBe(false);
    expect(isUnlocked(paid, true, d(2026, 9, 1))).toBe(true);
    expect(isUnlocked(holiday, false, d(2026, 9, 1))).toBe(false);
    expect(isUnlocked(holiday, false, d(2026, 10, 20))).toBe(true);
    expect(isUnlocked(holiday, false, d(2026, 11, 3))).toBe(false);
    expect(isUnlocked(holiday, true, d(2026, 11, 3))).toBe(true);
  });

  it('lists Commissioned first, then Holiday ahead of Standard in season and after it otherwise', () => {
    const items = [{ id: 'a' }, { id: 'h', group: 'holiday' as const, season: halloween(2026) }];
    expect(groupOrder(items, d(2026, 10, 5))).toEqual(['commissioned', 'holiday', 'standard']);
    expect(groupOrder(items, d(2026, 12, 5))).toEqual(['commissioned', 'standard', 'holiday']);
    expect(groupItems(items, d(2026, 12, 5)).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['commissioned', []],
      ['standard', ['a']],
      ['holiday', ['h']],
    ]);
  });
});
