import { describe, it, expect, vi } from 'vitest';
import type { Virtualizer } from '@tanstack/react-virtual';

vi.mock('@tanstack/react-virtual', () => ({
  // Reports the element's scrollTop once, the way the real observer does on attach.
  observeElementOffset: (instance: { scrollElement: { scrollTop: number } }, cb: (offset: number, isScrolling: boolean) => void) => {
    cb(instance.scrollElement.scrollTop, false);
    return () => undefined;
  },
  elementScroll: (offset: number, options: { adjustments?: number }, instance: { scrollElement: { scrollTo: (o: { top: number }) => void } }) => {
    instance.scrollElement.scrollTo({ top: offset + (options.adjustments ?? 0) });
  },
}));

import { MAX_LIST_HEIGHT, listHeight, rowShift, scaledScrollOptions, scrollScale } from './scaledScroll';

const fakeVirtualizer = (totalSize: number, scrollTop: number, scrollOffset: number | null, clientHeight = 800) => {
  const scrollTo = vi.fn();
  const instance = {
    getTotalSize: () => totalSize,
    scrollOffset,
    scrollElement: { scrollTop, clientHeight, scrollTo },
  } as unknown as Virtualizer<Element, Element>;
  return { instance, scrollTo };
};

describe('scaledScroll', () => {
  it('leaves a list under the cap alone', () => {
    expect(listHeight(1_000_000)).toBe(1_000_000);
    expect(scrollScale(1_000_000, 800)).toBe(1);
    const { instance } = fakeVirtualizer(1_000_000, 500, 400);
    expect(rowShift(instance)).toBe(0);
  });

  it('caps the element height and maps its scroll range onto the whole list', () => {
    const total = 60_980_600;
    const viewport = 800;
    expect(listHeight(total)).toBe(MAX_LIST_HEIGHT);
    const scale = scrollScale(total, viewport);
    expect(scale).toBeGreaterThan(1.8);
    // The bottom of the element shows the last row.
    expect((MAX_LIST_HEIGHT - viewport) * scale).toBeCloseTo(total - viewport, 3);
  });

  it('reports a scaled offset to the virtualizer', () => {
    const total = 60_980_600;
    const { instance } = fakeVirtualizer(total, 10_000, null);
    const cb = vi.fn();
    scaledScrollOptions.observeElementOffset(instance, cb);
    expect(cb).toHaveBeenCalledWith(10_000 * scrollScale(total, 800), false);
  });

  it('divides a scroll request and its adjustment by the scale', () => {
    const total = 60_980_600;
    const scale = scrollScale(total, 800);
    const { instance, scrollTo } = fakeVirtualizer(total, 0, 0);
    scaledScrollOptions.scrollToFn(total - 800, { adjustments: scale * 10 }, instance);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0].top).toBeCloseTo((total - 800) / scale + 10, 3);
  });

  it('passes a scroll request through unchanged under the cap', () => {
    const { instance, scrollTo } = fakeVirtualizer(5_000, 0, 0);
    scaledScrollOptions.scrollToFn(1_234, { adjustments: 6 }, instance);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_240 });
  });

  it('shifts rows by the gap between the element and the virtual offset above the cap', () => {
    const total = 60_980_600;
    const scrollTop = 10_000;
    const scrollOffset = scrollTop * scrollScale(total, 800);
    const { instance } = fakeVirtualizer(total, scrollTop, scrollOffset);
    // A row the virtualizer starts at scrollOffset draws at the element's scrollTop.
    expect(scrollOffset + rowShift(instance)).toBeCloseTo(scrollTop, 6);
  });
});
