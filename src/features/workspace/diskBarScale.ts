/** The bar's first shelf, and the most the browsers give an extension without a new permission (plan 3.1). */
export const BASE_SHELF_BYTES = 10 * 1024 ** 3;

/** Amber from this share of the browser's allowance. */
export const WARN_SHARE = 0.8;

/**
 * The bar is scaled to a shelf, not the raw quota (plan 5.3): 10 GB, or the
 * browser's quota when that is lower, doubling each time usage passes it.
 */
export function shelfBytes(used: number, quota: number | null | undefined): number {
  let shelf = quota && quota > 0 ? Math.min(BASE_SHELF_BYTES, quota) : BASE_SHELF_BYTES;
  while (used > shelf) shelf *= 2;
  return shelf;
}

export type DiskLevel = 'normal' | 'warning' | 'full';

/** Amber from 80 percent of the allowance, red when nothing remains. */
export function diskLevel(usage: number | null | undefined, quota: number | null | undefined): DiskLevel {
  if (!usage || !quota || quota <= 0) return 'normal';
  if (usage >= quota) return 'full';
  if (usage >= quota * WARN_SHARE) return 'warning';
  return 'normal';
}

/** Each segment's share of the bar in percent, from Discrub's own byte estimate. */
export function segmentPercents(bytes: number[], shelf: number): number[] {
  if (shelf <= 0) return bytes.map(() => 0);
  return bytes.map((b) => Math.max(0, (b / shelf) * 100));
}

/** "1.4 GB", "490 MB", "12 KB", decimal like the browsers' storage pages. */
export function formatDiskSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return bytes > 0 ? '1 KB' : '0 MB';
}
