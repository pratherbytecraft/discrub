import { Box, Checkbox, FormControlLabel, IconButton, Link, Popover, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { LockOutlined as LockIcon, Check as CheckIcon, Settings as SettingsIcon, VisibilityOutlined as PreviewIcon } from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { Trans, useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAppLayout, selectSettings, setPreviewLayout, setPreviewTheme, updateSetting } from '@features/app/appSlice';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import { selectHasThemes } from '@features/supporter/supporterSlice';
import SupporterPanel from '@components/supporter/SupporterPanel';
import { KOFI_COMMISSIONS_URL } from '@services/kofiLinks';
import { ThemeGrid } from '@components/settings/tabs/ThemePicker';
import { LAYOUT_META, type LayoutKey } from '@/layouts/types';
import { isLayoutBuilt } from '@/layouts/registry';
import LayoutMockup from './LayoutMockup';
import ScrublingsTab from './ScrublingsTab';

/** Every segment's body scrolls inside this, so the menu never runs off a short window. */
const BODY_MAX_H = 'min(520px, calc(100vh - 170px))';

export type AppearanceTab = 'layout' | 'theme' | 'scrublings' | 'supporter';

interface AppearancePopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  tab: AppearanceTab;
  onTabChange: (tab: AppearanceTab) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

/**
 * The Appearance menu (2.2.0): layouts, themes, Scrublings and supporter
 * access in one popover. The header is a segmented control with four text
 * segments and no icons (owner, 2026-09-20). Layout cards carry a corner lock
 * and a soft red glow when the key is missing and a check on the current one;
 * clicking applies, the eye starts a look-only preview of a locked one. The
 * Theme segment holds the theme grid, the animations toggle and the
 * commission link. The Supporter segment is what the Themes and Support
 * dialog used to be: plans, the key box, the access card and the export
 * footer controls. A locked pick anywhere switches to it. The tab is owned by
 * AppearanceButton so other parts of the app can open the menu on Supporter.
 * No hint lines anywhere: the cards explain themselves (owner, 2026-09-20).
 * The gear beside the segments opens Display settings.
 */
const AppearancePopover = ({ anchorEl, open, tab, onTabChange, onClose, onOpenSettings }: AppearancePopoverProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const setTab = onTabChange;
  const settings = useAppSelector(selectSettings);
  const layout = useAppSelector(selectAppLayout);
  const isSupporter = useAppSelector(selectHasThemes);
  // A preview cannot start mid-run: the store gate would cut the run off (see previewGuardMiddleware).
  const operationRunning = useAppSelector(selectIsOperationRunning);
  const themeSetting = settings?.[DiscrubSetting.APP_THEME_MODE] ?? 'auto';
    // Picking a layout applies it and closes the menu, since the frame that hosts this menu is about to swap.
  const applyLayout = (key: LayoutKey) => {
    dispatch(updateSetting({ key: DiscrubSetting.APP_LAYOUT, value: key }));
    onClose();
  };
  const animationsSetting = settings?.[DiscrubSetting.APP_THEME_ANIMATIONS] ?? 'true';
  // A locked pick lands on the Supporter segment, where the plans and the key box are.
  const openHub = () => setTab('supporter');
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
          <ToggleButton value="layout" data-testid="appearance-tab-layout">{t('appearance.layout')}</ToggleButton>
          <ToggleButton value="theme" data-testid="appearance-tab-theme">{t('appearance.theme')}</ToggleButton>
          <ToggleButton value="scrublings" data-testid="appearance-tab-scrublings">{t('appearance.scrublings')}</ToggleButton>
          <ToggleButton value="supporter" data-testid="appearance-tab-supporter">{t('appearance.supporter')}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('appearance.displaySettings')} enterDelay={0} arrow>
          <IconButton size="small" aria-label={t('appearance.displaySettings')} onClick={() => { onClose(); onOpenSettings(); }} data-testid="appearance-open-settings">
            <SettingsIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
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
        <Box sx={{ p: 1.75, maxHeight: BODY_MAX_H, overflowY: 'auto' }} data-testid="supporter-theme-showcase">
          <ThemeGrid
            value={themeSetting}
            onChange={(id) => dispatch(updateSetting({ key: DiscrubSetting.APP_THEME_MODE, value: id }))}
            onLockedPick={openHub}
            onPreview={operationRunning ? undefined : startThemePreview}
            isSupporter={isSupporter}
            cardWidth={96}
            data-testid="appearance-theme-grid"
          />
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', textAlign: 'center', mt: 1.5 }} data-testid="supporter-commission-note">
            <Trans i18nKey="supporter.wantTheme" components={{ kofi: <Link href={KOFI_COMMISSIONS_URL} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 600 }} /> }} />
          </Typography>
          <FormControlLabel
            sx={{ mt: 1, alignItems: 'flex-start' }}
            control={<Checkbox size="small" sx={{ mt: -0.5 }} checked={animationsSetting === 'true'} onChange={(e) => dispatch(updateSetting({ key: DiscrubSetting.APP_THEME_ANIMATIONS, value: e.target.checked ? 'true' : 'false' }))} inputProps={{ 'data-testid': 'theme-animations-toggle' } as object} />}
            label={<Box><Typography variant="body2">{t('supporter.themeAnimations')}</Typography><Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('supporter.themeAnimationsHelp')}</Typography></Box>}
          />
        </Box>
      )}

      {tab === 'scrublings' && <ScrublingsTab onLockedPick={openHub} />}

      {tab === 'supporter' && <Box sx={{ maxHeight: BODY_MAX_H, overflowY: 'auto' }}><SupporterPanel /></Box>}

    </Popover>
  );
};

export default AppearancePopover;
