import { useEffect, useRef, useState } from 'react';
import { Button, Paper, Typography } from '@mui/material';
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
 * End preview, Esc, or a reload ends it. A click anywhere else does nothing
 * but nudge the bar: ending on any click swapped the frame back under the
 * pointer and felt jumpy (owner, 2026-09-20).
 */
const PreviewBar = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectPreview);
  const on = preview.layout != null || preview.theme != null;
  const barRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch(endPreview()); };
    // The shell is inert, so a press on it lands on the body. Point at the bar instead of failing silently.
    const onDown = (e: PointerEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setNudge((n) => n + 1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [on, dispatch]);

  if (!on) return null;
  const layoutMeta = preview.layout ? LAYOUT_META.find((m) => m.key === preview.layout) : undefined;
  const themeMeta = preview.theme ? (preview.theme === 'auto' ? { name: 'Auto' } : findThemeDescriptor(preview.theme)) : undefined;
  const name = [layoutMeta?.name, themeMeta?.name].filter(Boolean).join(' · ');
  const stop = () => dispatch(endPreview());

  return (
    <Paper
        key={nudge}
        ref={barRef}
        data-testid="preview-bar"
        data-nudges={nudge}
        elevation={6}
        sx={{ position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1350, display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, border: '1px solid', borderColor: 'primary.main', maxWidth: 'calc(100vw - 24px)',
          ...(nudge > 0 && {
            '@keyframes previewNudge': { '0%, 100%': { transform: 'translateX(-50%) scale(1)' }, '40%': { transform: 'translateX(-50%) scale(1.06)' } },
            animation: 'previewNudge 260ms ease-out',
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }) }}
      >
        <PreviewIcon sx={{ fontSize: 16, color: 'cta.main', flexShrink: 0 }} />
        <Typography variant="body2" noWrap>{t('appearance.previewBar', { name })}</Typography>
        <Button size="small" variant="contained" onClick={stop} data-testid="preview-end" sx={{ whiteSpace: 'nowrap' }}>{t('appearance.endPreview')}</Button>
    </Paper>
  );
};

export default PreviewBar;
