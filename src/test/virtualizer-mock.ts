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

export const virtualizerMock = {
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: String(i),
        start: i * 53,
        end: (i + 1) * 53,
        size: 53,
        lane: 0,
      })),
    getTotalSize: () => count * 53,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
    measureElement: vi.fn(),
  }),
  // The scaled scroll helper reads these; the mock never scrolls.
  observeElementOffset: vi.fn(),
  elementScroll: vi.fn(),
};
