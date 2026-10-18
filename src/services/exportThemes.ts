/**
 * Export theme sets (v2.1.0 slot E).
 *
 * Exported HTML is styled by CSS custom properties in two places: the
 * Discord shell (--shell-bg and friends) and the content pages
 * (--bg-primary and friends). This module maps the app's theme
 * descriptors onto those two var sets so exports can embed the full
 * roster: the free six always, the supporter eight only when a valid
 * key is present at export time.
 *
 * The two Discord themes keep their long-standing hand-tuned export
 * palettes VERBATIM (pinned by tests) so existing exports don't shift
 * by a pixel; every other theme derives its vars from its descriptor
 * palette. Exports stay static — accent animations never embed.
 */

import {
  THEME_DESCRIPTORS,
  findThemeDescriptor,
  resolveThemeIdFromSetting,
  DISCORD_DARK_ID,
  DISCORD_LIGHT_ID,
  type ThemeDescriptor,
} from '@/theme/theme';
import { isUnlocked } from '@features/appearance/groups';

export interface ExportTheme {
  id: string;
  name: string;
  base: 'dark' | 'light';
  /** Values for the content pages' --bg-primary var family. */
  contentVars: Record<string, string>;
  /** Values for the shell's --shell-bg var family. */
  shellVars: Record<string, string>;
}

export interface ExportThemeSet {
  /** Baked default — the app's effective theme at export time. */
  defaultId: string;
  themes: ExportTheme[];
}

// ── Color helpers ────────────────────────────────────────────────
// Descriptor palettes use hex for every field we derive from; divider
// values may already be rgba() strings and pass through untouched.

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  let h = match[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// ── Legacy Discord export palettes (verbatim — do not derive) ────

const LEGACY_CONTENT_DARK: Record<string, string> = {
  '--bg-primary': '#1e2124',
  '--bg-secondary': '#282b30',
  '--bg-tertiary': '#2f3136',
  '--bg-hover': 'rgba(114, 137, 218, 0.08)',
  '--text-primary': '#dcddde',
  '--text-secondary': '#b9bbbe',
  '--text-muted': '#72767d',
  '--text-link': '#00b0f4',
  '--border-color': '#40444b',
  '--accent': '#5865f2',
  '--card-bg': 'rgba(47, 49, 54, 0.6)',
  '--card-border': 'rgba(114, 137, 218, 0.2)',
  '--code-bg': '#2f3136',
  '--input-bg': '#1e1f22',
};

const LEGACY_CONTENT_LIGHT: Record<string, string> = {
  '--bg-primary': '#ffffff',
  '--bg-secondary': '#f2f3f5',
  '--bg-tertiary': '#e3e5e8',
  '--bg-hover': 'rgba(116, 127, 141, 0.08)',
  '--text-primary': '#2e3338',
  '--text-secondary': '#4f5660',
  '--text-muted': '#747f8d',
  '--text-link': '#0067e0',
  '--border-color': '#e3e5e8',
  '--accent': '#5865f2',
  '--card-bg': 'rgba(0, 0, 0, 0.04)',
  '--card-border': 'rgba(0, 0, 0, 0.08)',
  '--code-bg': '#f2f3f5',
  '--input-bg': '#e3e5e8',
};

const LEGACY_SHELL_DARK: Record<string, string> = {
  '--shell-bg': '#202225',
  '--server-bg': '#202225',
  '--channel-bg': '#2f3136',
  '--channel-header-bg': '#2f3136',
  '--topbar-bg': '#36393f',
  '--main-bg': '#36393f',
  '--channel-active': 'rgba(79, 84, 92, 0.6)',
  '--channel-hover': 'rgba(79, 84, 92, 0.3)',
  '--text-primary': '#fff',
  '--text-secondary': '#b9bbbe',
  '--text-muted': '#72767d',
  '--text-channels': '#8e9297',
  '--separator': 'rgba(255, 255, 255, 0.06)',
  '--scrollbar-thumb': '#202225',
  '--scrollbar-track': '#2f3136',
};

const LEGACY_SHELL_LIGHT: Record<string, string> = {
  '--shell-bg': '#e3e5e8',
  '--server-bg': '#e3e5e8',
  '--channel-bg': '#f2f3f5',
  '--channel-header-bg': '#f2f3f5',
  '--topbar-bg': '#ffffff',
  '--main-bg': '#ffffff',
  '--channel-active': 'rgba(0, 0, 0, 0.06)',
  '--channel-hover': 'rgba(0, 0, 0, 0.03)',
  '--text-primary': '#060607',
  '--text-secondary': '#4f5660',
  '--text-muted': '#5c6470',
  '--text-channels': '#5c6470',
  '--separator': 'rgba(0, 0, 0, 0.06)',
  '--scrollbar-thumb': '#c4c9ce',
  '--scrollbar-track': '#e3e5e8',
};

// ── Derivation for non-Discord themes ────────────────────────────

function deriveContentVars(d: ThemeDescriptor): Record<string, string> {
  const p = d.palette;
  const isLight = d.base === 'light';
  return {
    '--bg-primary': p.background.default,
    '--bg-secondary': p.background.paper,
    '--bg-tertiary': p.background.elevated,
    '--bg-hover': rgba(p.primary.main, 0.08),
    '--text-primary': p.text.primary,
    '--text-secondary': p.text.secondary,
    '--text-muted': rgba(p.text.secondary, 0.75),
    '--text-link': p.link.main,
    '--border-color': p.divider,
    '--accent': p.cta.main,
    '--card-bg': isLight ? 'rgba(0, 0, 0, 0.04)' : rgba(p.background.paper, 0.6),
    '--card-border': isLight ? 'rgba(0, 0, 0, 0.08)' : rgba(p.primary.main, 0.2),
    '--code-bg': isLight ? p.background.paper : p.background.elevated,
    '--input-bg': isLight ? p.background.elevated : p.background.default,
  };
}

function deriveShellVars(d: ThemeDescriptor): Record<string, string> {
  const p = d.palette;
  return {
    '--shell-bg': p.background.default,
    '--server-bg': p.background.default,
    '--channel-bg': p.background.paper,
    '--channel-header-bg': p.background.paper,
    '--topbar-bg': p.background.elevated,
    '--main-bg': p.background.elevated,
    '--channel-active': rgba(p.text.primary, 0.12),
    '--channel-hover': rgba(p.text.primary, 0.06),
    '--text-primary': p.text.primary,
    '--text-secondary': p.text.secondary,
    '--text-muted': rgba(p.text.secondary, 0.75),
    '--text-channels': rgba(p.text.secondary, 0.9),
    '--separator': p.divider,
    '--scrollbar-thumb': rgba(p.text.primary, 0.2),
    '--scrollbar-track': p.background.paper,
  };
}

function toExportTheme(d: ThemeDescriptor): ExportTheme {
  if (d.id === DISCORD_DARK_ID) {
    return { id: d.id, name: d.name, base: d.base, contentVars: LEGACY_CONTENT_DARK, shellVars: LEGACY_SHELL_DARK };
  }
  if (d.id === DISCORD_LIGHT_ID) {
    return { id: d.id, name: d.name, base: d.base, contentVars: LEGACY_CONTENT_LIGHT, shellVars: LEGACY_SHELL_LIGHT };
  }
  return { id: d.id, name: d.name, base: d.base, contentVars: deriveContentVars(d), shellVars: deriveShellVars(d) };
}

// ── Set resolution ───────────────────────────────────────────────

/**
 * Build the theme set an export should embed: every theme the app
 * itself would let this user pick right now (`isUnlocked`), so the
 * free themes always, the supporter themes with a key, and a holiday
 * theme inside its season for everyone. The baked default is the
 * app's effective theme (same resolution as ThemeWrapper, including
 * the locked-supporter-theme fallback), so an export always opens
 * looking like the app that produced it.
 */
export function resolveExportThemeSet(options: {
  /** Raw APP_THEME_MODE setting value ('auto', id, or legacy alias). */
  themeSetting: string | undefined;
  isSupporter: boolean;
  /** The export's clock, for the holiday season check. Defaults to now. */
  now?: Date;
}): ExportThemeSet {
  const { themeSetting, isSupporter, now = new Date() } = options;
  const descriptors = THEME_DESCRIPTORS.filter((d) => isUnlocked(d, isSupporter, now));

  let defaultId = resolveThemeIdFromSetting(themeSetting);
  if (!descriptors.some((d) => d.id === defaultId)) {
    // A supporter theme without a valid key at export time — mirror
    // the app's own fallback.
    defaultId = findThemeDescriptor(defaultId)?.base === 'light' ? DISCORD_LIGHT_ID : DISCORD_DARK_ID;
  }

  return { defaultId, themes: descriptors.map(toExportTheme) };
}

/** The pre-slot-E behavior: free themes only (no season check), Discord Dark default. */
export function defaultExportThemeSet(): ExportThemeSet {
  return {
    defaultId: DISCORD_DARK_ID,
    themes: THEME_DESCRIPTORS.filter((d) => d.tier === 'free').map(toExportTheme),
  };
}

// ── CSS / JS emission helpers ────────────────────────────────────

function varsBlock(vars: Record<string, string>, indent: string): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n');
}

function themeById(set: ExportThemeSet, id: string): ExportTheme {
  return set.themes.find((t) => t.id === id) ?? set.themes[0];
}

/**
 * Content-page theme CSS: `:root` carries the baked default, one
 * `.export-theme-<id>` class per embedded theme overrides it. The
 * `.light-theme` class survives with broadened semantics — "the active
 * theme has a light base" — because ~90 structural selectors (shadows,
 * light-mode hardcoded colors) key on it; the runtime JS toggles it
 * alongside the per-theme class.
 */
export function buildContentThemeCSS(set: ExportThemeSet): string {
  const parts = [`    :root {\n${varsBlock(themeById(set, set.defaultId).contentVars, '      ')}\n    }`];
  for (const t of set.themes) {
    parts.push(`    .export-theme-${t.id} {\n${varsBlock(t.contentVars, '      ')}\n    }`);
  }
  return parts.join('\n\n');
}

/** Shell theme CSS: same shape with `.shell-theme-<id>` classes. */
export function buildShellThemeCSS(set: ExportThemeSet): string {
  const parts = [`    :root {\n${varsBlock(themeById(set, set.defaultId).shellVars, '      ')}\n    }`];
  for (const t of set.themes) {
    parts.push(`    .shell-theme-${t.id} {\n${varsBlock(t.shellVars, '      ')}\n    }`);
  }
  return parts.join('\n\n');
}

/** Dropdown data embedded into the export's inline JS. */
export function buildThemeOptionsJson(set: ExportThemeSet): string {
  return JSON.stringify(
    set.themes.map((t) => ({ id: t.id, name: t.name, base: t.base })),
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The theme `<select>` shared by the shell topbar and content pages. */
export function buildThemeSelectHtml(
  set: ExportThemeSet,
  domId: string,
  className: string,
): string {
  const options = set.themes
    .map(
      (t) =>
        `<option value="${t.id}"${t.id === set.defaultId ? ' selected' : ''}>${escapeHtml(t.name)}</option>`,
    )
    .join('');
  return `<select id="${domId}" class="${className}" title="Theme" aria-label="Theme">${options}</select>`;
}
