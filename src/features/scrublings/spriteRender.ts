import type { SpriteSheet } from './spriteTypes';
import { SPRITE_H, SPRITE_W } from './spriteTypes';

const cache = new Map<string, string>();

/**
 * One frame as an SVG data URI. Horizontal runs of one color collapse into a
 * single rect, so a frame is a few dozen rects rather than a few hundred.
 * Memoized per sheet and frame; the sheets never change at runtime.
 */
export const frameDataUri = (sheet: SpriteSheet, frame: string): string => {
  const key = `${sheet.id}/${frame}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grid = sheet.frames[frame] ?? [];
  let rects = '';
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const color = sheet.palette[ch];
      if (!color) { x += 1; continue; }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end += 1;
      rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`;
      x = end;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPRITE_W} ${SPRITE_H}" shape-rendering="crispEdges">${rects}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg).replace(/%20/g, ' ').replace(/%22/g, "'")}`;
  cache.set(key, uri);
  return uri;
};

/** The frames an activity cycles through; an unknown activity falls back to its name as a single frame, then to idle. */
export const activityFrames = (sheet: SpriteSheet, activity: string): string[] => {
  const frames = sheet.activities[activity];
  if (frames && frames.length > 0) return frames;
  if (sheet.frames[activity]) return [activity];
  return sheet.activities.idle ?? Object.keys(sheet.frames).slice(0, 1);
};
