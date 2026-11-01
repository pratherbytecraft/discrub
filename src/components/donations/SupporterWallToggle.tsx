import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { SupporterWallToggle as Toggle } from '@pratherbytecraft/supporter';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectKofiOverlayOpen, selectSetting, setKofiOverlayOpen, updateSetting } from '@features/app/appSlice';
import { useWallOverlay } from './useWallOverlay';

/**
 * Opens and closes the supporter wall. On a desktop it flips the remembered
 * column setting, on a phone it opens the overlay and leaves the setting alone.
 */
const SupporterWallToggle = ({ size = 'small' }: { size?: 'small' | 'medium' }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isMobile = useWallOverlay();
  const saved = useAppSelector(selectSetting(DiscrubSetting.APP_SHOW_KOFI_FEED)) === 'true';
  const overlayOpen = useAppSelector(selectKofiOverlayOpen);
  const on = isMobile ? overlayOpen : saved;
  const toggle = () => {
    if (isMobile) { dispatch(setKofiOverlayOpen(true)); return; }
    dispatch(updateSetting({ key: DiscrubSetting.APP_SHOW_KOFI_FEED, value: saved ? 'false' : 'true' }));
  };
  return <Toggle on={on} onToggle={toggle} label={t('topbar.supporterWall')} size={size} />;
};

export default SupporterWallToggle;
