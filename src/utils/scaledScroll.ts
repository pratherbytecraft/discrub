/**
 * Scaled scrolling for the virtualized lists (2.2.5, 1M finding).
 *
 * A browser caps how tall one element can be. Chrome stops at 33,554,428 px,
 * and a feed of one million messages wants about 61M px, so rows past the
 * cap had no scrollable space and the last part of the list was out of
 * reach. Above the cap the list element stays at MAX_LIST_HEIGHT and each
 * scrolled pixel stands for `scrollScale` virtual pixels: the virtualizer
 * reads a scaled offset, writes a divided one, and every row is drawn
 * shifted by the gap between the two. Under the cap the scale is 1 and
 * nothing here changes anything.
 */
import { elementScroll, observeElementOffset, type Virtualizer } from '@tanstack/react-virtual';

/** A little under Chrome's cap so the last row keeps its margin. */
export const MAX_LIST_HEIGHT = 33_000_000;

/** The height the list element gets. */
export const listHeight = (totalSize: number): number => Math.min(totalSize, MAX_LIST_HEIGHT);

/**
 * Virtual pixels per scrolled pixel. 1 under the cap. Above it the capped
 * element's scroll range maps onto the whole list, so the bottom of the
 * element shows the last row.
 */
export const scrollScale = (totalSize: number, viewport: number): number => {
  if (totalSize <= MAX_LIST_HEIGHT) return 1;
  const range = MAX_LIST_HEIGHT - viewport;
  return range > 0 ? (totalSize - viewport) / range : 1;
};

type OffsetCallback = (offset: number, isScrolling: boolean) => void;
// The library's own behavior type has no "instant", unlike the DOM one.
type ScrollToOptions = Parameters<typeof elementScroll>[1];

const scaleOf = <T extends Element>(instance: Virtualizer<T, Element>): number =>
  scrollScale(instance.getTotalSize(), instance.scrollElement?.clientHeight ?? 0);

/** Options for `useVirtualizer` that read and write the scroll position through the scale. */
export const scaledScrollOptions = {
  observeElementOffset: <T extends Element>(instance: Virtualizer<T, Element>, cb: OffsetCallback) =>
    observeElementOffset(instance, (offset, isScrolling) => cb(offset * scaleOf(instance), isScrolling)),
  scrollToFn: <T extends Element>(offset: number, options: ScrollToOptions, instance: Virtualizer<T, Element>) => {
    const scale = scaleOf(instance);
    elementScroll(offset / scale, { ...options, adjustments: (options.adjustments ?? 0) / scale }, instance);
  },
};

/**
 * Added to every row's `start` when placing it: 0 under the cap, otherwise
 * the gap between where the element is scrolled and where the virtualizer
 * thinks it is, so the row the virtualizer puts at the top of the viewport
 * lands there.
 */
export const rowShift = <T extends Element>(instance: Virtualizer<T, Element>): number => {
  if (instance.getTotalSize() <= MAX_LIST_HEIGHT) return 0;
  return (instance.scrollElement?.scrollTop ?? 0) - (instance.scrollOffset ?? 0);
};
