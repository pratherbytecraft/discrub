import { useRef, useState } from 'react';
import { Box, ButtonBase, Tooltip, Typography, alpha, useMediaQuery, useTheme, type Theme } from '@mui/material';
import { ArrowDropDown as ChevronIcon } from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAppLayout, selectPreviewLayout, selectSettings } from '@features/app/appSlice';
import { markGiftAttentionSeen, selectGiftAttentionSeen, selectIsSupporter } from '@features/supporter/supporterSlice';
import { useHotkey } from '@features/hotkeys/HotkeyProvider';
import { findThemeDescriptor } from '@/theme/descriptors';
import { resolveThemeIdFromSetting } from '@/theme/theme';
import { LAYOUT_NAMES } from '@/layouts/types';
import AppearancePopover from './AppearancePopover';

/**
 * Top bar entry for layouts and themes (2.2.0). Replaces the palette icon:
 * names the current layout and theme, collapses to its dot below the sm
 * breakpoint, opens the Appearance popover on click or Ctrl Shift L. Keeps
 * the attention glow non-supporters saw on the palette icon and the
 * supporter badge once a key is in.
 */
const AppearanceButton = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const settings = useAppSelector(selectSettings);
  const layout = useAppSelector(selectAppLayout);
  const previewLayout = useAppSelector(selectPreviewLayout);
  const isSupporter = useAppSelector(selectIsSupporter);
  const giftAttentionSeen = useAppSelector(selectGiftAttentionSeen);
  const themeName = findThemeDescriptor(resolveThemeIdFromSetting(settings?.[DiscrubSetting.APP_THEME_MODE] ?? 'auto'))?.name ?? '';
  const previewing = previewLayout != null && previewLayout !== layout;

  const toggle = () => {
    if (!giftAttentionSeen) dispatch(markGiftAttentionSeen());
    setOpen((o) => !o);
  };
  useHotkey('openAppearance', toggle, true);

  const dot = (
    <Box
      data-testid={isSupporter ? 'supporter-badge' : undefined}
      sx={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, border: '1px solid', borderColor: 'divider', background: `conic-gradient(${theme.palette.primary.main} 0 50%, ${theme.palette.background.paper} 50% 100%)` }}
    />
  );

  return (
    <>
      <Tooltip title={t('appearance.button')} enterDelay={0} arrow>
        <ButtonBase
          ref={ref}
          onClick={toggle}
          aria-label={t('appearance.button')}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="gift-button"
          sx={(th: Theme) => ({
            display: 'inline-flex', alignItems: 'center', gap: 1, height: 30, px: compact ? 0.75 : 1.25, borderRadius: 1.5,
            border: '1px solid', borderColor: previewing ? 'primary.main' : 'divider',
            backgroundColor: previewing ? alpha(th.palette.primary.main, 0.14) : alpha(th.palette.text.primary, 0.04),
            color: 'text.primary', whiteSpace: 'nowrap', transition: 'box-shadow 200ms ease, background-color 200ms ease',
            '&:hover': { backgroundColor: alpha(th.palette.text.primary, 0.08) },
            // Non-supporters keep the soft halo the palette icon had; it calms once the menu has been opened this session.
            ...(!isSupporter && {
              boxShadow: `0 0 8px 1px ${alpha(th.palette.cta.main, 0.25)}`,
              ...(giftAttentionSeen ? {} : {
                '@keyframes giftGlow': {
                  '0%, 100%': { boxShadow: `0 0 8px 1px ${alpha(th.palette.cta.main, 0.25)}` },
                  '50%': { boxShadow: `0 0 14px 3px ${alpha(th.palette.cta.main, 0.45)}` },
                },
                '@keyframes giftWiggle': {
                  '0%, 92%, 100%': { transform: 'rotate(0deg)' },
                  '94%': { transform: 'rotate(-8deg)' },
                  '96%': { transform: 'rotate(8deg)' },
                  '98%': { transform: 'rotate(-4deg)' },
                },
                animation: 'giftGlow 3s ease-in-out infinite, giftWiggle 7s ease-in-out infinite',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }),
            }),
          })}
        >
          {dot}
          {!compact && (
            <>
              <Typography variant="overline" sx={{ lineHeight: 1, color: 'text.secondary', fontSize: '0.65rem' }}>{t('appearance.button')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="appearance-current-layout">{LAYOUT_NAMES[layout]}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>·</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="appearance-current-theme">{themeName}</Typography>
              <ChevronIcon sx={{ fontSize: 18, color: 'text.secondary', ml: -0.5 }} />
            </>
          )}
        </ButtonBase>
      </Tooltip>
      <AppearancePopover anchorEl={ref.current} open={open} onClose={() => setOpen(false)} onOpenSettings={onOpenSettings} />
    </>
  );
};

export default AppearanceButton;
