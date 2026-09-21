import { createTheme, alpha, type Theme } from '@mui/material/styles';
import { componentOverrides } from './overrides';
import type { ThemeDescriptor } from './descriptors';

// Shared options across all themes
const sharedTypography = {
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
  ].join(','),
  h5: {
    fontWeight: 700,
    lineHeight: 1.3,
  },
  h6: {
    fontWeight: 700,
    lineHeight: 1.3,
  },
  button: {
    textTransform: 'none' as const,
  },
};

const sharedTransitions = {
  duration: {
    instant: 100,
    fast: 200,
    normal: 300,
    slow: 400,
    slowest: 600,
  },
  easing: {
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  },
};

// Neutral drop shadows only vary by base mode, not per theme.
const darkElevations = {
  elevation1: '0 2px 8px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.4)',
  elevation2: '0 4px 16px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.45)',
  elevation3: '0 8px 24px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.5)',
  elevation4: '0 16px 40px rgba(0, 0, 0, 0.45), 0 8px 20px rgba(0, 0, 0, 0.55)',
};

const lightElevations = {
  elevation1: '0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.1)',
  elevation2: '0 4px 16px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.12)',
  elevation3: '0 8px 24px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.15)',
  elevation4: '0 16px 40px rgba(0, 0, 0, 0.15), 0 8px 20px rgba(0, 0, 0, 0.18)',
};

function applyShapeExtensions(theme: Theme): void {
  (theme.shape as any).borderRadiusLarge = 16;
  (theme.shape as any).borderRadiusMedium = 12;
  (theme.shape as any).borderRadiusSmall = 6;
}

/**
 * Build a full MUI theme from a palette descriptor. Every color the app
 * renders derives from the descriptor (directly or via `alpha()`), so a
 * new theme is complete the moment its descriptor is registered.
 */
export function createAppTheme(descriptor: ThemeDescriptor): Theme {
  const p = descriptor.palette;
  const isDark = descriptor.base === 'dark';

  const theme = createTheme({
    palette: {
      mode: descriptor.base,
      primary: { ...p.primary },
      secondary: { ...p.secondary },
      background: {
        default: p.background.default,
        paper: p.background.paper,
      },
      text: { ...p.text },
      error: { main: p.error },
      warning: { main: p.warning },
      success: { main: p.success },
      divider: p.divider,
      primaryGradient: p.gradient.primary,
      primaryGradientSubtle: p.gradient.primarySubtle,
      backgroundElevated: p.background.elevated,
      backgroundGlass: alpha(p.glassBase, 0.7),
      backgroundGlassStrong: alpha(p.glassBase, isDark ? 0.85 : 0.9),
      backgroundGlassSubtle: alpha(p.glassBase, isDark ? 0.5 : 0.6),
      backgroundGradientOverlay: p.gradient.overlay,
      backgroundDialog: p.dialog,
      backgroundTooltip: p.tooltip,
      link: p.link.main,
      linkHover: p.link.hover,
      cta: { ...p.cta },
      ctaDanger: { ...p.ctaDanger },
    },
    typography: sharedTypography,
    shape: { borderRadius: 8 } as any,
    customShadows: {
      ...(isDark ? darkElevations : lightElevations),
      glow: isDark
        ? `0 0 20px ${alpha(p.primary.main, 0.3)}, 0 0 40px ${alpha(p.primary.main, 0.15)}`
        : `0 0 20px ${alpha(p.primary.main, 0.15)}, 0 0 40px ${alpha(p.primary.main, 0.08)}`,
      glowHover: isDark
        ? `0 0 30px ${alpha(p.primary.main, 0.4)}, 0 0 60px ${alpha(p.primary.main, 0.2)}`
        : `0 0 30px ${alpha(p.primary.main, 0.2)}, 0 0 60px ${alpha(p.primary.main, 0.1)}`,
    },
    customTransitions: sharedTransitions,
    components: {
      ...componentOverrides,
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            fontWeight: 600,
            textTransform: 'none',
            padding: '6px 16px',
            fontSize: '0.8125rem',
            transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
            '&.Mui-focusVisible': {
              outline: `2px solid ${p.primary.main}`,
              outlineOffset: '2px',
            },
            '&.Mui-disabled': {
              opacity: 0.5,
            },
          },
          sizeSmall: {
            padding: '4px 12px',
            fontSize: '0.75rem',
          },
          contained: {
            backgroundColor: p.cta.main,
            color: p.primary.contrastText,
            boxShadow: 'none',
            '&:hover': {
              backgroundColor: p.cta.hover,
              boxShadow: 'none',
            },
            '&:active': {
              backgroundColor: p.cta.active,
            },
          },
          containedError: {
            backgroundColor: p.ctaDanger.main,
            color: '#fff',
            '&:hover': {
              backgroundColor: p.ctaDanger.hover,
            },
            '&:active': {
              backgroundColor: p.ctaDanger.active,
            },
          },
          outlined: {
            borderColor: 'transparent',
            backgroundColor: alpha(p.primary.main, isDark ? 0.12 : 0.08),
            color: p.primary.main,
            '&:hover': {
              borderColor: 'transparent',
              backgroundColor: alpha(p.primary.main, isDark ? 0.2 : 0.14),
            },
            '&:active': {
              backgroundColor: alpha(p.primary.main, isDark ? 0.25 : 0.2),
            },
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      // MuiTooltip styling lives in `componentOverrides` (overrides.ts).
      // An inline override here would clobber the polished glass/blur
      // style by virtue of object-key precedence after the spread.
    },
    themeAccent: descriptor.accent,
    themeEffects: descriptor.effects,
  });
  applyShapeExtensions(theme);
  return theme;
}
