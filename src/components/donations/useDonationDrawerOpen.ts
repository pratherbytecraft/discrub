import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useAppSelector } from '@/app/hooks';
import { selectSetting, selectKofiOverlayOpen } from '@features/app/appSlice';
import { useWallOverlay } from './useWallOverlay';

/**
 * True while the supporter wall is open. Desktop follows the persisted
 * setting (a remembered column); below the inline width it follows the
 * transient overlay flag so the wall never covers the app on load. The
 * drawer and anything that has to make room for it (the toast) share this
 * so they always agree.
 */
export const useDonationDrawerOpen = (): { open: boolean; inline: boolean } => {
  const isMobile = useWallOverlay();
  const showFeed = useAppSelector(selectSetting(DiscrubSetting.APP_SHOW_KOFI_FEED));
  const overlayOpen = useAppSelector(selectKofiOverlayOpen);
  const open = isMobile ? overlayOpen : showFeed === 'true';
  return { open, inline: open && !isMobile };
};
