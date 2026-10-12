import { describe, it, expect } from 'vitest';
import { BASE_SHELF_BYTES, diskLevel, formatDiskSize, segmentPercents, shelfBytes } from './diskBarScale';

const GB = 1024 ** 3;

describe('disk bar scale (2.2.5 WP5)', () => {
  it('starts at 10 GB, or the quota when that is lower', () => {
    expect(shelfBytes(0, null)).toBe(BASE_SHELF_BYTES);
    expect(shelfBytes(0, 20 * GB)).toBe(BASE_SHELF_BYTES);
    expect(shelfBytes(0, 4 * GB)).toBe(4 * GB);
  });

  it('doubles the shelf each time usage passes it', () => {
    expect(shelfBytes(10 * GB, null)).toBe(10 * GB);
    expect(shelfBytes(10 * GB + 1, null)).toBe(20 * GB);
    expect(shelfBytes(45 * GB, null)).toBe(80 * GB);
  });

  it('turns amber at 80 percent of the allowance and red when full', () => {
    expect(diskLevel(null, null)).toBe('normal');
    expect(diskLevel(7 * GB, 10 * GB)).toBe('normal');
    expect(diskLevel(8 * GB, 10 * GB)).toBe('warning');
    expect(diskLevel(10 * GB, 10 * GB)).toBe('full');
  });

  it('sizes segments from bytes on the shelf', () => {
    expect(segmentPercents([GB, 4 * GB], 10 * GB)).toEqual([10, 40]);
    expect(segmentPercents([GB], 0)).toEqual([0]);
  });

  it('formats sizes the way the browsers do', () => {
    expect(formatDiskSize(0)).toBe('0 MB');
    expect(formatDiskSize(12_400)).toBe('12 KB');
    expect(formatDiskSize(490_000_000)).toBe('490 MB');
    expect(formatDiskSize(1_400_000_000)).toBe('1.4 GB');
  });
});
