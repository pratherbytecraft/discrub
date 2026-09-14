import { Box, Button, Typography } from '@mui/material';
import { VisibilityOutlined as PreviewIcon } from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAppLayout, selectPreviewLayout, setPreviewLayout, updateSetting } from '@features/app/appSlice';
import { selectHasThemes } from '@features/supporter/supporterSlice';
import { LAYOUT_META } from '@/layouts/types';

/**
 * Bottom-centre bar while a layout preview is on (2.2.0). Copies the theme
 * preview bar: names the layout, says Locked without a key, offers Apply when
 * it can be kept and Stop always. Mounted by MainLayout so it survives the swap.
 */
const LayoutPreviewBar = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const layout = useAppSelector(selectAppLayout);
  const preview = useAppSelector(selectPreviewLayout);
  const isSupporter = useAppSelector(selectHasThemes);
  if (!preview || preview === layout) return null;
  const meta = LAYOUT_META.find((m) => m.key === preview);
  if (!meta) return null;
  const locked = !meta.free && !isSupporter;
  const stop = () => dispatch(setPreviewLayout(null));
  const apply = () => { dispatch(updateSetting({ key: DiscrubSetting.APP_LAYOUT, value: preview })); dispatch(setPreviewLayout(null)); };
  return (
    <Box
      data-testid="layout-preview-bar"
      sx={(theme) => ({
        position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1350,
        display: 'inline-flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, borderRadius: 2,
        border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', boxShadow: 3,
        color: theme.palette.text.primary,
      })}
    >
      <PreviewIcon sx={{ fontSize: 16, color: 'cta.main' }} />
      <Typography variant="body2" noWrap>
        {t('appearance.previewBar', { name: meta.name })}
        {locked && ` · ${t('appearance.locked')}`}
      </Typography>
      {!locked && <Button size="small" variant="contained" onClick={apply} data-testid="layout-preview-apply">{t('appearance.apply')}</Button>}
      <Button size="small" color="inherit" onClick={stop} data-testid="layout-preview-stop">{t('appearance.stop')}</Button>
    </Box>
  );
};

export default LayoutPreviewBar;
