import { memo } from 'react';
import { DonationDrawer as Drawer } from '@pratherbytecraft/supporter';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { setKofiOverlayOpen } from '@features/app/appSlice';
import { useWallOverlay } from './useWallOverlay';
import { useDonationDrawerOpen } from './useDonationDrawerOpen';

export { DRAWER_WIDTH } from '@pratherbytecraft/supporter';

/**
 * The supporter wall. The drawer lives in the supporter package; this reads
 * Discrub's settings and operation state (see useDonationDrawerOpen).
 */
const DonationDrawer = () => {
  const dispatch = useAppDispatch();
  const isMobile = useWallOverlay();
  const { open } = useDonationDrawerOpen();
  const running = useAppSelector(selectIsHeavyOperationRunning);
  return <Drawer open={open} isMobile={isMobile} onClose={() => dispatch(setKofiOverlayOpen(false))} animationsPaused={running} />;
};

// Rendered again only when its own store reads change, not whenever the shell above it renders.
export default memo(DonationDrawer);
