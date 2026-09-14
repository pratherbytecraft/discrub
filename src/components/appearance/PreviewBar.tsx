import { useEffect } from 'react';
import { Button, ClickAwayListener, Paper, Typography } from '@mui/material';
import { VisibilityOutlined as PreviewIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { endPreview, selectPreview } from '@features/app/appSlice';
import { findThemeDescriptor } from '@/theme/descriptors';
import { LAYOUT_META } from '@/layouts/types';

/**
 * The bar that stands in for the Appearance menu while a live preview is on
 * (2.2.0). Mounted by MainLayout outside the inert shell frame, fixed at
 * the bottom centre. Names the layout or theme and offers End preview.
 * Only locked items can be previewed, so there is nothing to apply.
 * Any click outside it, Esc, or a reload ends the preview too.
 */
const PreviewBar = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectPreview);
  const on = preview.layout != null || preview.theme != null;

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch(endPreview()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, dispatch]);

  if (!on) return null;
  const layoutMeta = preview.layout ? LAYOUT_META.find((m) => m.key === preview.layout) : undefined;
  const themeMeta = preview.theme ? (preview.theme === 'auto' ? { name: 'Auto' } : findThemeDescriptor(preview.theme)) : undefined;
  const name = [layoutMeta?.name, themeMeta?.name].filter(Boolean).join(' · ');
  const stop = () => dispatch(endPreview());

  return (
    <ClickAwayListener onClickAway={stop}>
      <Paper
        data-testid="preview-bar"
        elevation={6}
        sx={{ position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1350, display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, border: '1px solid', borderColor: 'primary.main', maxWidth: 'calc(100vw - 24px)' }}
      >
        <PreviewIcon sx={{ fontSize: 16, color: 'cta.main', flexShrink: 0 }} />
        <Typography variant="body2" noWrap>{t('appearance.previewBar', { name })}</Typography>
        <Button size="small" variant="contained" onClick={stop} data-testid="preview-end" sx={{ whiteSpace: 'nowrap' }}>{t('appearance.endPreview')}</Button>
      </Paper>
    </ClickAwayListener>
  );
};

export default PreviewBar;
