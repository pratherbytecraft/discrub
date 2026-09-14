import { useState } from 'react';
import { Box, Button, IconButton, Popover, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { LockOutlined as LockIcon, Check as CheckIcon, Settings as SettingsIcon, VisibilityOutlined as PreviewIcon } from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAppLayout, selectSettings, setPreviewLayout, setPreviewTheme, updateSetting } from '@features/app/appSlice';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import { selectHasThemes, selectSupporter, setSupporterDialogOpen } from '@features/supporter/supporterSlice';
import { ThemeGrid } from '@components/settings/tabs/ThemePicker';
import { LAYOUT_META, type LayoutKey } from '@/layouts/types';
import { isLayoutBuilt } from '@/layouts/registry';
import LayoutGlyph from './LayoutGlyph';
import LayoutMockup from './LayoutMockup';

export type AppearanceTab = 'layout' | 'theme';

interface AppearancePopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

/**
 * The Appearance menu (2.2.0): layouts and themes in one popover. Layout cards
 * carry a corner lock and a soft red glow when the key is missing and a check
 * on the current one; hovering shows a larger wireframe of the layout, clicking
 * applies. Themes reuse the theme grid, whose swatches are the preview. There
 * is no live preview of the whole app: one handed out locked layouts and
 * themes for free once the bottom bar was hidden. Footer: the hint, the
 * Themes and Support hub, and Display settings. The header is a segmented
 * control (Layout, Theme) with the current name beside it; plain tabs read as
 * a title bar and were missed (owner, 2026-09-19).
 */
const AppearancePopover = ({ anchorEl, open, onClose, onOpenSettings }: AppearancePopoverProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const [tab, setTab] = useState<AppearanceTab>('layout');
  const settings = useAppSelector(selectSettings);
  const layout = useAppSelector(selectAppLayout);
  const isSupporter = useAppSelector(selectHasThemes);
  const supporterName = useAppSelector(selectSupporter).payload?.name;
  // A preview cannot start mid-run: the store gate would cut the run off (see previewGuardMiddleware).
  const operationRunning = useAppSelector(selectIsOperationRunning);
  const themeSetting = settings?.[DiscrubSetting.APP_THEME_MODE] ?? 'auto';
    // Picking a layout applies it and closes the menu, since the frame that hosts this menu is about to swap.
  const applyLayout = (key: LayoutKey) => {
    dispatch(updateSetting({ key: DiscrubSetting.APP_LAYOUT, value: key }));
    onClose();
  };
  const openHub = () => { onClose(); dispatch(setSupporterDialogOpen(true)); };
  // A live preview swaps the frame, which unmounts the bar hosting this menu, so starting one closes the menu;
  // PreviewBar (mounted by MainLayout) takes over until the preview ends.
  const startLayoutPreview = (key: LayoutKey) => { dispatch(setPreviewLayout(key)); onClose(); };
  const startThemePreview = (id: string) => { dispatch(setPreviewTheme(id)); onClose(); };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { width: 640, maxWidth: 'calc(100vw - 24px)', mt: 1, border: '1px solid', borderColor: 'divider', overflow: 'visible' }, 'data-testid': 'appearance-popover' } as never }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <ToggleButtonGroup exclusive size="small" value={tab} onChange={(_, v: AppearanceTab | null) => { if (v) setTab(v); }} data-testid="appearance-segments" sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, py: 0.5, gap: 0.75 } }}>
          <ToggleButton value="layout" data-testid="appearance-tab-layout"><LayoutGlyph layout={layout} color="currentColor" width={20} height={13} />{t('appearance.layout')}</ToggleButton>
          <ToggleButton value="theme" data-testid="appearance-tab-theme">{t('appearance.theme')}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {tab === 'layout' && (
        <Box sx={{ p: 1.75, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1 }} data-testid="layout-cards">
          {LAYOUT_META.map((m) => {
            const current = m.key === layout;
            const locked = !m.free && !isSupporter;
            const built = isLayoutBuilt(m.key);
            const label = !built ? t('appearance.soonLayout', { name: m.name }) : locked ? t('appearance.lockedLayout', { name: m.name }) : m.name;
            return (
              <Box
                role="button"
                tabIndex={built ? 0 : -1}
                aria-label={label}
                aria-pressed={current}
                aria-disabled={!built || undefined}
                data-testid={`layout-card-${m.key}`}
                onClick={() => { if (!built) return; if (locked) openHub(); else applyLayout(m.key); }}
                onKeyDown={(e) => { if (built && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (locked) openHub(); else applyLayout(m.key); } }}
                sx={{
                  position: 'relative', textAlign: 'left', cursor: built ? 'pointer' : 'default', font: 'inherit', color: 'inherit',
                  p: '10px 10px 8px', borderRadius: 2, border: '1px solid',
                  borderColor: current ? 'primary.main' : 'divider',
                  backgroundColor: current ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                  opacity: built ? 1 : 0.55,
                  boxShadow: locked && built ? `0 0 0 1px ${alpha(theme.palette.error.main, 0.35)}, 0 0 10px ${alpha(theme.palette.error.main, 0.25)}` : 'none',
                  '&:hover': built ? { backgroundColor: current ? alpha(theme.palette.primary.main, 0.14) : alpha(theme.palette.text.primary, 0.05) } : {},
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
                }}
              >
                <Box sx={{ display: 'grid', placeItems: 'center', mb: 1, opacity: locked ? 0.75 : 1 }}>
                  <LayoutMockup layout={m.key} width={156} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.name}{!built && <Box component="span" sx={{ ml: 0.75, fontSize: '0.65rem', color: 'text.secondary', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.5 }}>{t('appearance.soon')}</Box>}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.35, minHeight: 31 }}>{m.blurb}</Typography>
                {locked && built && (
                  <Box data-testid={`layout-locked-${m.key}`} sx={{ position: 'absolute', right: 6, top: 6, width: 18, height: 18, borderRadius: '50%', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', display: 'grid', placeItems: 'center' }}>
                    <LockIcon sx={{ fontSize: 11, color: 'error.main' }} />
                  </Box>
                )}
                {current && !locked && (
                  <Box data-testid="layout-current" sx={{ position: 'absolute', right: 6, top: 6, height: 18, px: 0.75, borderRadius: 9, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    <CheckIcon sx={{ fontSize: 11 }} />{t('appearance.current')}
                  </Box>
                )}
                {built && locked && (
                  <Tooltip title={operationRunning ? t('appearance.previewBusy') : t('appearance.previewThis', { name: m.name })} enterDelay={300} arrow>
                    <IconButton size="small" aria-label={t('appearance.previewThis', { name: m.name })} data-testid={`layout-preview-${m.key}`} disabled={operationRunning} onClick={(e) => { e.stopPropagation(); startLayoutPreview(m.key); }} sx={{ position: 'absolute', right: 4, bottom: 4, p: 0.4, color: 'text.secondary', bgcolor: (th) => alpha(th.palette.background.paper, 0.8), border: '1px solid', borderColor: 'divider' }}>
                      <PreviewIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {tab === 'theme' && (
        <Box sx={{ p: 1.75, maxHeight: 420, overflowY: 'auto' }}>
          <ThemeGrid
            value={themeSetting}
            onChange={(id) => dispatch(updateSetting({ key: DiscrubSetting.APP_THEME_MODE, value: id }))}
            onLockedPick={openHub}
            onPreview={operationRunning ? undefined : startThemePreview}
            isSupporter={isSupporter}
            cardWidth={96}
            data-testid="appearance-theme-grid"
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap data-testid="appearance-hint">
          {t('appearance.hint')}
        </Typography>
        <Button size="small" onClick={openHub} data-testid="appearance-open-hub" sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
          {isSupporter && supporterName ? t('appearance.supporterName', { name: supporterName }) : t('appearance.hub')}
        </Button>
        <Tooltip title={t('appearance.displaySettings')} enterDelay={0} arrow>
          <IconButton size="small" aria-label={t('appearance.displaySettings')} onClick={() => { onClose(); onOpenSettings(); }} data-testid="appearance-open-settings">
            <SettingsIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Popover>
  );
};

export default AppearancePopover;
