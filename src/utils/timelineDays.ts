import type { Message } from 'discrub-core/types/discord-types';
import { localDayKey } from './messageChunking';

const DAY_MS = 86400000;
/** Up to this many days the strip draws one bar per day, then per week, then per month. */
export const DAY_BAR_LIMIT = 120;
export const WEEK_BAR_LIMIT = 730;

export type BarUnit = 'day' | 'week' | 'month';

export interface TimelineBar {
  /** Local day key (YYYY-MM-DD) of the first day the bar covers. */
  from: string;
  /** Local day key of the last day the bar covers. */
  to: string;
  count: number;
  /** Id of the newest message under the bar, the jump target. Null when the bar is empty. */
  newestId: string | null;
  /** Month label key (YYYY-MM) the bar is filed under. */
  month: string;
}

export interface TimelineMonth { key: string; count: number; newestId: string | null }

export interface TimelineModel {
  unit: BarUnit;
  bars: TimelineBar[];
  /** Newest month first, only months that hold messages. */
  months: TimelineMonth[];
  /** Messages per local day, for the day headings. */
  dayCounts: Map<string, number>;
  total: number;
  firstDay: string;
  lastDay: string;
}

const startOfDay = (key: string): Date => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const keyOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Adds whole calendar days. Works on the date parts so a daylight saving change never skips or repeats a day. */
export const addDays = (key: string, n: number): string => { const d = startOfDay(key); d.setDate(d.getDate() + n); return keyOf(d); };

/**
 * Everything the Timeline layout draws, counted from one message list: the
 * bars, the month list and the per-day counts all add up to `total`.
 * Messages without a readable timestamp are left out of all of them.
 */
export const buildTimeline = (messages: Message[]): TimelineModel => {
  const dayCounts = new Map<string, number>();
  const newestByDay = new Map<string, { id: string; ts: number }>();
  let total = 0; let firstDay = ''; let lastDay = '';
  for (const m of messages) {
    const key = localDayKey(m.timestamp);
    if (!key) continue;
    total += 1;
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    const ts = new Date(m.timestamp).getTime();
    const cur = newestByDay.get(key);
    if (!cur || ts > cur.ts) newestByDay.set(key, { id: m.id, ts });
    if (!firstDay || key < firstDay) firstDay = key;
    if (!lastDay || key > lastDay) lastDay = key;
  }
  if (total === 0) return { unit: 'day', bars: [], months: [], dayCounts, total, firstDay, lastDay };

  const span = Math.round((startOfDay(lastDay).getTime() - startOfDay(firstDay).getTime()) / DAY_MS) + 1;
  const unit: BarUnit = span <= DAY_BAR_LIMIT ? 'day' : span <= WEEK_BAR_LIMIT ? 'week' : 'month';

  const bars: TimelineBar[] = [];
  let cursor = firstDay;
  while (cursor <= lastDay) {
    let to = cursor;
    if (unit === 'week') to = addDays(cursor, 6);
    if (unit === 'month') { const d = startOfDay(cursor); to = keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
    if (to > lastDay) to = lastDay;
    let count = 0; let newest: { id: string; ts: number } | null = null;
    for (let k = cursor; k <= to; k = addDays(k, 1)) {
      count += dayCounts.get(k) ?? 0;
      const n = newestByDay.get(k);
      if (n && (!newest || n.ts > newest.ts)) newest = n;
    }
    bars.push({ from: cursor, to, count, newestId: newest?.id ?? null, month: cursor.slice(0, 7) });
    cursor = addDays(to, 1);
  }

  const monthMap = new Map<string, TimelineMonth & { ts: number }>();
  for (const [key, count] of dayCounts) {
    const mk = key.slice(0, 7);
    const n = newestByDay.get(key)!;
    const cur = monthMap.get(mk);
    if (!cur) monthMap.set(mk, { key: mk, count, newestId: n.id, ts: n.ts });
    else { cur.count += count; if (n.ts > cur.ts) { cur.ts = n.ts; cur.newestId = n.id; } }
  }
  const months = Array.from(monthMap.values()).sort((a, b) => (a.key < b.key ? 1 : -1)).map(({ key, count, newestId }) => ({ key, count, newestId }));
  return { unit, bars, months, dayCounts, total, firstDay, lastDay };
};

/** Start of the first day and end of the last day of a range, as the Date pair the filter criteria hold. */
export const rangeToDates = (from: string, to: string): { after: Date; before: Date } => {
  const a = from <= to ? from : to; const b = from <= to ? to : from;
  const before = startOfDay(b); before.setHours(23, 59, 59, 999);
  return { after: startOfDay(a), before };
};

export const dayKeyToDate = startOfDay;
