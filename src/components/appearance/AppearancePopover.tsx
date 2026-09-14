import { useState } from 'react';
import { Box, Button, IconButton, Popover, Tab, Tabs, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { LockOutlined as LockIcon, Check as CheckIcon, Settings as SettingsIcon } from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAppLayout, selectPreviewLayout, selectSettings, setPreviewLayout, updateSetting } from '@features/app/appSlice';
import { selectHasThemes, selectSupporter, setSupporterDialogOpen } from '@features/supporter/supporterSlice';
import { ThemeGrid } from '@components/settings/tabs/ThemePicker';
import { findThemeDescriptor } from '@/theme/descriptors';
import { resolveThemeIdFromSetting } from '@/theme/theme';
import { LAYOUT_META, type LayoutKey } from '@/layouts/types';
import { isLayoutBuilt } from '@/layouts/registry';
import LayoutGlyph from './LayoutGlyph';

export type AppearanceTab = 'layout' | 'theme';

interface AppearancePopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

/**
 * The Appearance menu (2.2.0): layouts and themes in one popover. Layout cards
 * carry a corner lock and a soft red glow when the key is missing, a check on
 * the current one, and preview on hover; clicking applies. Themes reuse the
 * theme grid with its own preview bar. Footer: the hint, the Themes and
 * Support hub, and Display settings.
 */
const AppearancePopover = ({ anchorEl, open, onClose, onOpenSettings }: AppearancePopoverProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const [tab, setTab] = useState<AppearanceTab>('layout');
  const settings = useAppSelector(selectSettings);
  const layout = useAppSelector(selectAppLayout);
  const previewLayout = useAppSelector(selectPreviewLayout);
  const isSupporter = useAppSelector(selectHasThemes);
  const supporterName = useAppSelector(selectSupporter).payload?.name;
  const themeSetting = settings?.[DiscrubSetting.APP_THEME_MODE] ?? 'auto';
  const themeName = findThemeDescriptor(resolveThemeIdFromSetting(themeSetting))?.name ?? '';

  const preview = (key: LayoutKey | null) => dispatch(setPreviewLayout(key));
  // Picking a layout applies it and closes the menu, so no hover preview lingers over the new frame.
  const applyLayout = (key: LayoutKey) => {
    dispatch(updateSetting({ key: DiscrubSetting.APP_LAYOUT, value: key }));
    dispatch(setPreviewLayout(null));
    onClose();
  };
  const openHub = () => { onClose(); dispatch(setSupporterDialogOpen(true)); };
  const hovered = previewLayout && previewLayout !== layout ? LAYOUT_META.find((m) => m.key === previewLayout) : undefined;

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={() => { preview(null); onClose(); }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { width: 640, maxWidth: 'calc(100vw - 24px)', mt: 1, border: '1px solid', borderColor: 'divider', overflow: 'visible' }, 'data-testid': 'appearance-popover' } as never }}
    >
      <Tabs value={tab} onChange={(_, v: AppearanceTab) => setTab(v)} sx={{ borderBottom: '1px solid', borderColor: 'divider', minHeight: 40, px: 1 }}>
        <Tab value="layout" data-testid="appearance-tab-layout" sx={{ minHeight: 40, textTransform: 'none', gap: 1 }} label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><LayoutGlyph layout={layout} color={theme.palette.primary.main} width={20} height={13} /><Typography variant="overline" sx={{ lineHeight: 1 }}>{t('appearance.layout')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{LAYOUT_META.find((m) => m.key === layout)?.name}</Typography></Box>} />
        <Tab value="theme" data-testid="appearance-tab-theme" sx={{ minHeight: 40, textTransform: 'none' }} label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Typography variant="overline" sx={{ lineHeight: 1 }}>{t('appearance.theme')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{themeName}</Typography></Box>} />
      </Tabs>

      {tab === 'layout' && (
        <Box sx={{ p: 1.75, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1 }} data-testid="layout-cards" onMouseLeave={() => preview(null)}>
          {LAYOUT_META.map((m) => {
            const current = m.key === layout;
            const locked = !m.free && !isSupporter;
            const built = isLayoutBuilt(m.key);
            const label = !built ? t('appearance.soonLayout', { name: m.name }) : locked ? t('appearance.lockedLayout', { name: m.name }) : m.name;
            return (
              <Box
                key={m.key}
                component="button"
                type="button"
                aria-label={label}
                aria-pressed={current}
                data-testid={`layout-card-${m.key}`}
                disabled={!built}
                onMouseEnter={() => built && preview(m.key)}
                onFocus={() => built && preview(m.key)}
                onClick={() => { if (!built) return; if (locked) openHub(); else applyLayout(m.key); }}
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
                <Box sx={{ display: 'grid', placeItems: 'center', height: 48, mb: 1, opacity: locked ? 0.7 : 1 }}>
                  <LayoutGlyph layout={m.key} color={current ? theme.palette.primary.main : theme.palette.text.primary} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.name}{!built && <Box component="span" sx={{ ml: 0.75, fontSize: '0.65rem', color: 'text.secondary', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.5 }}>{t('appearance.soon')}</Box>}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.35, minHeight: 31 }}>{m.blurb}</Typography>
                {locked && built && (
                  <Box data-testid={`layout-locked-${m.key}`} sx={{ position: 'absolute', right: 6, top: 6, width: 18, height: 18, borderRadius: '50%', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', display: 'grid', placeItems: 'center' }}>
                    <LockIcon sx={{ fontSize: 11, color: 'error.main' }} />
                  </Box>
                )}
                {current && !locked && (
                  <Box sx={{ position: 'absolute', right: 6, top: 6, width: 18, height: 18, borderRadius: '50%', bgcolor: 'primary.main', display: 'grid', placeItems: 'center' }}>
                    <CheckIcon sx={{ fontSize: 12, color: '#fff' }} />
                  </Box>
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
            isSupporter={isSupporter}
            cardWidth={96}
            data-testid="appearance-theme-grid"
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap data-testid="appearance-hint">
          {hovered ? t('appearance.previewing', { name: hovered.name }) : t('appearance.hint')}
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
