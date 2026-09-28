import { keyframes } from '@mui/material';

/**
 * 2.2.2: the wall's glows pulse on a layer of their own. The element keeps
 * its resting shadow and a layer on top carries the peak shadow; only the
 * layer's opacity animates, which the compositor does without repainting.
 * Animating the shadow itself repainted the window on every frame.
 */
export const layerPulse = keyframes`
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
`;

/** Styles for the layer: fills its positioned parent, never takes a click, fades in and out. */
export const glowLayerSx = (duration: string, delay = '0ms') => ({
  position: 'absolute' as const,
  inset: 0,
  borderRadius: 'inherit',
  pointerEvents: 'none' as const,
  opacity: 0,
  willChange: 'opacity',
  animation: `${layerPulse} ${duration} ease-in-out ${delay} infinite`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});
