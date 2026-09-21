import { useMediaQuery } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectEffectiveLayout } from '@features/app/appSlice';

/** Below this window width the wall is an overlay. Native and Operator carry a third column, so they need more. */
export const WALL_INLINE_MIN = { default: 1200, native: 1440, operator: 1440 } as const;

/**
 * True when the supporter wall opens as an overlay instead of a fixed column.
 * The column is 320 px wide, and until 2026-09-20 it stayed fixed down to
 * 900 px, which left a 900 to 1199 px window with a feed a few words wide and
 * the wall covering part of the top bar. It is an overlay below 1200 px now,
 * opened from the Ko-fi button. Native adds a rail, a channel column and an
 * inspector, and the inspector holds Load All, Export and Purge, so there the
 * wall gives way first, below 1440 px. Operator has a queue, a run column and
 * a side column, and at 1280 px the wall left the middle one 300 px wide, so it
 * follows the same rule. One hook so the drawer, the frame's
 * margin and both toggle buttons always agree.
 */
export const useWallOverlay = (): boolean => {
  const layout = useAppSelector(selectEffectiveLayout);
  const min = layout === 'native' || layout === 'operator' ? WALL_INLINE_MIN[layout] : WALL_INLINE_MIN.default;
  return useMediaQuery(`(max-width:${min - 0.05}px)`);
};
