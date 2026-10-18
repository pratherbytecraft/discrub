/**
 * Mock for @tanstack/react-virtual's useVirtualizer.
 *
 * jsdom has no layout engine, so virtualizers compute 0-height rows and
 * render nothing. This mock returns all items at a fixed row height so
 * MessageTable and other virtualised lists render their rows in tests.
 *
 * Usage in test files:
 *   vi.mock('@tanstack/react-virtual', () => virtualizerMock);
 */

import { vi } from 'vitest';

const ROW = 53;
const itemsFor = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    index: i,
    key: String(i),
    start: i * ROW,
    end: (i + 1) * ROW,
    size: ROW,
    lane: 0,
  }));

/** Tests of the fast scroll layer set this to mount only the first n items while the cache keeps them all. */
export const virtualizerWindow = { size: Infinity };

export const virtualizerMock = {
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => itemsFor(count).slice(0, virtualizerWindow.size),
    getTotalSize: () => count * ROW,
    // The fast scroll skeleton layer (2.2.5) reads positions straight from the cache.
    measurementsCache: itemsFor(count),
    getVirtualItemForOffset: (offset: number) => (count > 0 ? itemsFor(count)[Math.max(0, Math.min(count - 1, Math.floor(offset / ROW)))] : undefined),
    scrollOffset: 0,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
    measureElement: vi.fn(),
  }),
  // The scaled scroll helper reads these; the mock never scrolls.
  observeElementOffset: vi.fn(),
  elementScroll: vi.fn(),
};
