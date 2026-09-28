import type { SxProps, Theme } from '@mui/material';

/**
 * OSRS overhead chat, the way every Scrubling speaks: yellow, no box, a black
 * edge on every side so it reads on any theme. Shared by the stage caption
 * and the seasonal notice (2.2.3).
 */
export const OVERHEAD_TEXT_SX: SxProps<Theme> = {
  pointerEvents: 'none', whiteSpace: 'nowrap',
  color: '#ffff00', font: '700 11px/12px ui-monospace, Menlo, monospace', letterSpacing: '0.02em',
  textShadow: '1px 0 #000, -1px 0 #000, 0 1px #000, 0 -1px #000, 1px 1px #000, -1px -1px #000, 1px -1px #000, -1px 1px #000',
};
