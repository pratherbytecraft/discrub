import type { Theme } from '@mui/material/styles';
import { createAppTheme } from './createAppTheme';
import {
  THEME_DESCRIPTORS,
  DEFAULT_THEME_ID,
  DISCORD_DARK_ID,
  DISCORD_LIGHT_ID,
  findThemeDescriptor,
} from './descriptors';
import type { ThemeAccent, ThemeEffectsId } from './descriptors';

declare module '@mui/material/styles' {
  interface Theme {
    /** Supporter themes' animated accent strip; absent on free themes. */
    themeAccent?: ThemeAccent;
    /** Whole-app visual effects some themes carry; see ThemeEffects. */
    themeEffects?: ThemeEffectsId;
    customShadows: {
      elevation1: string;
      elevation2: string;
      elevation3: string;
      elevation4: string;
      glow: string;
      glowHover: string;
    };
    customTransitions: {
      duration: {
        instant: number;
        fast: number;
        normal: number;
        slow: number;
        slowest: number;
      };
      easing: {
        spring: string;
        smooth: string;
        accelerate: string;
        decelerate: string;
      };
    };
  }
  interface ThemeOptions {
    themeAccent?: ThemeAccent;
    themeEffects?: ThemeEffectsId;
    customShadows?: {
      elevation1?: string;
      elevation2?: string;
      elevation3?: string;
      elevation4?: string;
      glow?: string;
      glowHover?: string;
    };
    customTransitions?: {
      duration?: {
        instant?: number;
        fast?: number;
        normal?: number;
        slow?: number;
        slowest?: number;
      };
      easing?: {
        spring?: string;
        smooth?: string;
        accelerate?: string;
        decelerate?: string;
      };
    };
  }
  interface Palette {
    primaryGradient: string;
    primaryGradientSubtle: string;
    backgroundElevated: string;
    backgroundGlass: string;
    backgroundGlassStrong: string;
    backgroundGlassSubtle: string;
    backgroundGradientOverlay: string;
    backgroundDialog: string;
    backgroundTooltip: string;
    link: string;
    linkHover: string;
    cta: { main: string; hover: string; active: string };
    ctaDanger: { main: string; hover: string; active: string };
  }
  interface PaletteOptions {
    primaryGradient?: string;
    primaryGradientSubtle?: string;
    backgroundElevated?: string;
    backgroundGlass?: string;
    backgroundGlassStrong?: string;
    backgroundGlassSubtle?: string;
    backgroundGradientOverlay?: string;
    backgroundDialog?: string;
    backgroundTooltip?: string;
    link?: string;
    linkHover?: string;
    cta?: { main: string; hover: string; active: string };
    ctaDanger?: { main: string; hover: string; active: string };
  }
  interface Shape {
    borderRadiusLarge: number;
    borderRadiusMedium: number;
    borderRadiusSmall: number;
  }
  interface ShapeOptions {
    borderRadiusLarge?: number;
    borderRadiusMedium?: number;
    borderRadiusSmall?: number;
  }
}

// Themes are built lazily and cached — createTheme() is not free, and
// most sessions only ever touch one or two themes.
const themeCache = new Map<string, Theme>();

/**
 * Get the built MUI theme for a theme id. Accepts legacy 'dark'/'light'
 * aliases; unknown or missing ids fall back to the default theme, so a
 * stored id whose theme no longer exists (or was never valid) still
 * renders the app.
 */
export function getThemeById(id: string | undefined): Theme {
  const descriptor = findThemeDescriptor(id) ?? findThemeDescriptor(DEFAULT_THEME_ID)!;
  let theme = themeCache.get(descriptor.id);
  if (!theme) {
    theme = createAppTheme(descriptor);
    themeCache.set(descriptor.id, theme);
  }
  return theme;
}

export { THEME_DESCRIPTORS, findThemeDescriptor, DEFAULT_THEME_ID, DISCORD_DARK_ID, DISCORD_LIGHT_ID };
export type { ThemeDescriptor, ThemeAccent } from './descriptors';

/**
 * Resolve the effective theme id from an APP_THEME_MODE setting value.
 * Explicit ids (including legacy 'dark'/'light' aliases) resolve
 * through the registry; 'auto' — and any unknown id — detects from
 * Discord's page class (extension) or the system preference (web app)
 * and picks the matching Discord theme. Shared by ThemeWrapper and the
 * export pipeline so both always agree on what "the active theme" is.
 */
export function resolveThemeIdFromSetting(settingValue: string | undefined): string {
  if (settingValue && settingValue !== 'auto') {
    const descriptor = findThemeDescriptor(settingValue);
    if (descriptor) return descriptor.id;
  }

  // Auto-detect: Discord's own theme class when running inside Discord.
  try {
    if (document.documentElement.classList.contains('theme-light')) return DISCORD_LIGHT_ID;
  } catch {
    // Fall through to system preference
  }

  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return DISCORD_LIGHT_ID;
  }

  return DISCORD_DARK_ID;
}

/** Compat exports — Storybook's preview and older call sites use these. */
export const darkTheme = getThemeById(DISCORD_DARK_ID);
export const lightTheme = getThemeById(DISCORD_LIGHT_ID);

/**
 * Get theme by mode string.
 * @deprecated Use getThemeById — kept for callers predating the registry.
 */
export function getThemeByMode(mode: string): Theme {
  return getThemeById(mode);
}

// Default export for backward compatibility
export default darkTheme;
