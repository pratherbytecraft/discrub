import { Box, IconButton, Tooltip } from '@mui/material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectKofiOverlayOpen, selectSetting, setKofiOverlayOpen, updateSetting } from '@features/app/appSlice';
import { useWallOverlay } from './useWallOverlay';

/**
 * Opens and closes the supporter wall (the Ko-fi feed column). The shared
 * top bar has its own copy inside its overflow logic; this one is for the
 * bars that are not the shared top bar (Native, Simple and Timeline,
 * Operator), which had no way to close the column before 2026-09-20. On a
 * phone the wall is an overlay, so the button opens it and leaves the saved
 * column setting alone.
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
  return (
    <Tooltip title={t('topbar.supporterWall')} enterDelay={0} arrow>
      <IconButton size={size} color="inherit" onClick={toggle} aria-label={t('topbar.supporterWall')} aria-pressed={on} data-testid="supporter-wall-toggle">
        <Box component="img" src="/kofi.svg" alt="" sx={{ width: 20, height: 20, filter: on ? 'none' : 'grayscale(1)', opacity: on ? 1 : 0.75 }} />
      </IconButton>
    </Tooltip>
  );
};

export default SupporterWallToggle;
