/**
 * Groups and seasons for themes and Scrublings (2.2.3).
 *
 * The Appearance menu lists both in groups: Standard, Holiday and
 * Commissioned. A holiday item carries a season; inside it the item is
 * free for everyone, outside it the item locks like any supporter item
 * (owner, 2026-09-29). Only the current year's holiday item is free, so
 * each year's item has its own season with its own year. The clock is the
 * device's own and works offline.
 *
 * In season the Holiday group sorts first, otherwise it sits below Standard.
 * Commissioned is always last and shows a short line when it is empty.
 */
export type ItemGroup = 'standard' | 'holiday' | 'commissioned';
export type ItemTier = 'free' | 'supporter';

/** Month and day, inclusive at both ends, plus the one year the window is open. */
export interface Season {
  year: number;
  from: [number, number];
  until: [number, number];
}

export const GROUPS: ItemGroup[] = ['commissioned', 'standard', 'holiday'];

/** Halloween runs October 1 to November 2 (owner, 2026-09-29). */
export const halloween = (year: number): Season => ({ year, from: [10, 1], until: [11, 2] });

const dayNumber = (month: number, day: number) => month * 100 + day;

export const inSeason = (season: Season | undefined, now: Date = new Date()): boolean => {
  if (!season) return false;
  if (now.getFullYear() !== season.year) return false;
  const today = dayNumber(now.getMonth() + 1, now.getDate());
  return today >= dayNumber(...season.from) && today <= dayNumber(...season.until);
};

/** Free items always, supporter items with a key, holiday items also inside their season. */
export const isUnlocked = (item: { tier: ItemTier; season?: Season }, hasKey: boolean, now: Date = new Date()): boolean =>
  item.tier === 'free' || hasKey || inSeason(item.season, now);

/** A group's slot in the menu: Commissioned leads (owner, 2026-10-04), then Holiday jumps ahead of Standard while any of its items is in season. */
export const groupOrder = (items: { group?: ItemGroup; season?: Season }[], now: Date = new Date()): ItemGroup[] => {
  const holidayOn = items.some((i) => (i.group ?? 'standard') === 'holiday' && inSeason(i.season, now));
  return holidayOn ? ['commissioned', 'holiday', 'standard'] : ['commissioned', 'standard', 'holiday'];
};

/** The items of each group in their registry order, every group present even when empty. */
export const groupItems = <T extends { group?: ItemGroup; season?: Season }>(items: T[], now: Date = new Date()): { group: ItemGroup; items: T[] }[] =>
  groupOrder(items, now).map((group) => ({ group, items: items.filter((i) => (i.group ?? 'standard') === group) }));

/**
 * A day key for memoized selectors: a selector that takes this as an input
 * recomputes once a day, which is as often as a season can change.
 */
export const selectDayKey = (): string => new Date().toDateString();
