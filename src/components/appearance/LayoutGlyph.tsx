import { Box } from '@mui/material';
import type { LayoutKey } from '@/layouts/types';

type Rect = [number, number, number, number, number?];
const lines = (l: number, t: number, w: number, n: number, gap = 4, o = 0.35): Rect[] => Array.from({ length: n }, (_, i) => [l, t + i * gap, w, 2, o]);
/** Wireframe of each layout on a 64x40 grid: [left, top, width, height, opacity]. */
const SHAPES: Record<LayoutKey, Rect[]> = {
  classic: [[0, 0, 64, 5], [0, 7, 16, 33, 0.7], ...lines(20, 9, 40, 7)],
  native: [[0, 0, 6, 40, 0.9], [8, 0, 14, 40, 0.6], ...lines(25, 3, 22, 8), [50, 0, 14, 40, 0.45], [52, 3, 10, 6, 1], [52, 11, 10, 6, 0.7]],
  workbench: [[0, 0, 64, 4], [0, 6, 14, 34, 0.6], [17, 6, 47, 3, 0.9], ...lines(17, 11, 47, 6, 3), [17, 32, 47, 8, 0.5]],
  simple: [[0, 0, 64, 4], [12, 7, 40, 6, 0.6], ...lines(12, 16, 40, 6, 4)],
  operator: [[0, 0, 64, 4], [0, 6, 14, 34, 0.6], [17, 6, 30, 16, 0.9], [19, 15, 24, 3, 0.4], ...lines(17, 25, 30, 4, 4), [50, 6, 14, 34, 0.45]],
  timeline: [[0, 0, 64, 4], ...[3, 8, 5, 12, 6, 10, 14, 7, 4, 9, 11, 5].map((v, i): Rect => [2 + i * 5, 18 - v, 4, v, 0.9]), ...lines(4, 22, 56, 5, 4)],
};

/** A small wireframe of a layout, drawn in the given colour. */
const LayoutGlyph = ({ layout, color, width = 64, height = 40 }: { layout: LayoutKey; color: string; width?: number; height?: number }) => (
  <Box component="span" aria-hidden sx={{ position: 'relative', display: 'inline-block', width, height, flexShrink: 0 }}>
    {SHAPES[layout].map(([l, t, w, h, o = 1], i) => (
      <Box key={i} component="i" sx={{ position: 'absolute', left: (l * width) / 64, top: (t * height) / 40, width: (w * width) / 64, height: (h * height) / 40, bgcolor: color, opacity: o, borderRadius: '1px' }} />
    ))}
  </Box>
);

export default LayoutGlyph;
