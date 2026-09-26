/**
 * 2.2.1 perf. Load All appends each page to one end of the loaded list and
 * keeps every other element (immer keeps element identity), so a pass that
 * walks the whole list on every page can instead handle the new elements
 * only. Returns the index range of the new elements when `next` extends
 * `prev` at its tail or its head, checked by the shared end elements, or
 * null when the lists relate any other way (a delete, a sort, a fresh
 * search) and the caller must start over.
 */
export const extendedRange = <T>(prev: readonly T[] | null | undefined, next: readonly T[]): { from: number; to: number; at: 'tail' | 'head' } | null => {
  if (!prev || prev === next) return null;
  const pl = prev.length;
  if (pl === 0 || next.length <= pl) return null;
  if (next[0] === prev[0] && next[pl - 1] === prev[pl - 1]) return { from: pl, to: next.length, at: 'tail' };
  const shift = next.length - pl;
  if (next[next.length - 1] === prev[pl - 1] && next[shift] === prev[0]) return { from: 0, to: shift, at: 'head' };
  return null;
};

/**
 * The elements of `prev` that are missing from `next`, when `next` is `prev`
 * with some elements taken out and the rest in the same order (a delete
 * flush). Null when the lists relate any other way. One pass of reference
 * compares, bounded by the removed count so a reorder is spotted early.
 */
export const removedFrom = <T>(prev: readonly T[], next: readonly T[], max = 200): T[] | null => {
  if (next.length >= prev.length || prev.length - next.length > max) return null;
  const removed: T[] = [];
  let j = 0;
  for (let i = 0; i < prev.length; i++) {
    if (j < next.length && prev[i] === next[j]) { j++; continue; }
    removed.push(prev[i]);
    if (removed.length > prev.length - next.length) return null;
  }
  return j === next.length ? removed : null;
};
