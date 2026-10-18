import { describe, it, expect } from 'vitest';
import {
  resolveExportThemeSet,
  defaultExportThemeSet,
  buildContentThemeCSS,
  buildShellThemeCSS,
  buildThemeOptionsJson,
  buildThemeSelectHtml,
  type ExportTheme,
} from './exportThemes';
import { THEME_DESCRIPTORS, DISCORD_DARK_ID, DISCORD_LIGHT_ID } from '@/theme/theme';

const FREE_COUNT = THEME_DESCRIPTORS.filter((d) => d.tier === 'free').length;
const TOTAL_COUNT = THEME_DESCRIPTORS.length;
// Outside every holiday season, so the free count is the plain tier split.
const OFF_SEASON = new Date(2026, 5, 15);
// Inside Halloween '26 (October 1 to November 2).
const HALLOWEEN = new Date(2026, 9, 19);

const CONTENT_VAR_NAMES = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover',
  '--text-primary', '--text-secondary', '--text-muted', '--text-link',
  '--border-color', '--accent', '--card-bg', '--card-border',
  '--code-bg', '--input-bg',
];

const SHELL_VAR_NAMES = [
  '--shell-bg', '--server-bg', '--channel-bg', '--channel-header-bg',
  '--topbar-bg', '--main-bg', '--channel-active', '--channel-hover',
  '--text-primary', '--text-secondary', '--text-muted', '--text-channels',
  '--separator', '--scrollbar-thumb', '--scrollbar-track',
];

// WCAG relative-luminance helpers (mirrors theme.test.ts).
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return (
    0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(full.slice(4, 6), 16))
  );
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const supporterSet = () =>
  resolveExportThemeSet({ themeSetting: DISCORD_DARK_ID, isSupporter: true });

const themeById = (themes: ExportTheme[], id: string) =>
  themes.find((t) => t.id === id)!;

describe('exportThemes', () => {
  describe('legacy Discord palettes are pinned verbatim', () => {
    // These are the hand-tuned export palettes that shipped before
    // slot E. Existing exports must not shift by a pixel.
    it('Dark Original content vars', () => {
      const t = themeById(supporterSet().themes, DISCORD_DARK_ID);
      expect(t.contentVars['--bg-primary']).toBe('#1e2124');
      expect(t.contentVars['--text-primary']).toBe('#dcddde');
      expect(t.contentVars['--text-link']).toBe('#00b0f4');
      expect(t.contentVars['--accent']).toBe('#5865f2');
      expect(t.contentVars['--input-bg']).toBe('#1e1f22');
      expect(t.contentVars['--card-bg']).toBe('rgba(47, 49, 54, 0.6)');
    });

    it('Light Original content vars', () => {
      const t = themeById(supporterSet().themes, DISCORD_LIGHT_ID);
      expect(t.contentVars['--bg-primary']).toBe('#ffffff');
      expect(t.contentVars['--text-primary']).toBe('#2e3338');
      expect(t.contentVars['--text-link']).toBe('#0067e0');
      expect(t.contentVars['--code-bg']).toBe('#f2f3f5');
    });

    it('Discord shell vars', () => {
      const dark = themeById(supporterSet().themes, DISCORD_DARK_ID);
      const light = themeById(supporterSet().themes, DISCORD_LIGHT_ID);
      expect(dark.shellVars['--shell-bg']).toBe('#202225');
      expect(dark.shellVars['--topbar-bg']).toBe('#36393f');
      expect(dark.shellVars['--channel-active']).toBe('rgba(79, 84, 92, 0.6)');
      expect(light.shellVars['--shell-bg']).toBe('#e3e5e8');
      expect(light.shellVars['--scrollbar-thumb']).toBe('#c4c9ce');
    });
  });

  describe('resolveExportThemeSet', () => {
    it('embeds only free themes for non-supporters', () => {
      const set = resolveExportThemeSet({ themeSetting: DISCORD_DARK_ID, isSupporter: false, now: OFF_SEASON });
      expect(set.themes).toHaveLength(FREE_COUNT);
      expect(set.themes.map((t) => t.id)).not.toContain('synthwave');
      expect(set.themes.map((t) => t.id)).not.toContain('halloween-26');
    });

    it('embeds a holiday theme for everyone inside its season and bakes it as the default', () => {
      const set = resolveExportThemeSet({ themeSetting: 'halloween-26', isSupporter: false, now: HALLOWEEN });
      expect(set.themes).toHaveLength(FREE_COUNT + 1);
      expect(set.themes.map((t) => t.id)).toContain('halloween-26');
      expect(set.defaultId).toBe('halloween-26');
    });

    it('a holiday theme after its season falls back like any supporter theme', () => {
      const set = resolveExportThemeSet({ themeSetting: 'halloween-26', isSupporter: false, now: OFF_SEASON });
      expect(set.themes.map((t) => t.id)).not.toContain('halloween-26');
      expect(set.defaultId).toBe(DISCORD_DARK_ID);
    });

    it('embeds the full roster for supporters', () => {
      const set = supporterSet();
      expect(set.themes).toHaveLength(TOTAL_COUNT);
      expect(set.themes.map((t) => t.id)).toContain('synthwave');
    });

    it('bakes the active theme as default', () => {
      const set = resolveExportThemeSet({ themeSetting: 'terminal', isSupporter: false });
      expect(set.defaultId).toBe('terminal');
    });

    it('resolves legacy aliases and auto', () => {
      expect(resolveExportThemeSet({ themeSetting: 'dark', isSupporter: false }).defaultId).toBe(DISCORD_DARK_ID);
      // jsdom has no matchMedia match for light → auto resolves dark.
      expect(resolveExportThemeSet({ themeSetting: 'auto', isSupporter: false }).defaultId).toBe(DISCORD_DARK_ID);
    });

    it('supporter default embeds for a supporter', () => {
      const set = resolveExportThemeSet({ themeSetting: 'synthwave', isSupporter: true });
      expect(set.defaultId).toBe('synthwave');
    });

    it('a supporter theme without a valid key falls back by base', () => {
      const darkFallback = resolveExportThemeSet({ themeSetting: 'synthwave', isSupporter: false, now: OFF_SEASON });
      expect(darkFallback.defaultId).toBe(DISCORD_DARK_ID);
      const lightFallback = resolveExportThemeSet({ themeSetting: 'nekonoir', isSupporter: false, now: OFF_SEASON });
      expect(lightFallback.defaultId).toBe(DISCORD_LIGHT_ID);
    });

    it('defaultExportThemeSet matches pre-theming behavior', () => {
      const set = defaultExportThemeSet();
      expect(set.defaultId).toBe(DISCORD_DARK_ID);
      expect(set.themes).toHaveLength(FREE_COUNT);
    });
  });

  describe('derived themes', () => {
    const themes = supporterSet().themes;

    it('every theme carries the full content and shell var sets', () => {
      for (const t of themes) {
        for (const name of CONTENT_VAR_NAMES) {
          expect(t.contentVars[name], `${t.id} ${name}`).toBeTruthy();
        }
        for (const name of SHELL_VAR_NAMES) {
          expect(t.shellVars[name], `${t.id} ${name}`).toBeTruthy();
        }
      }
    });

    it('body text stays WCAG AA readable on every export background', () => {
      for (const t of themes) {
        const text = t.contentVars['--text-primary'];
        for (const bgVar of ['--bg-primary', '--bg-secondary', '--bg-tertiary']) {
          const bg = t.contentVars[bgVar];
          if (!text.startsWith('#') || !bg.startsWith('#')) continue;
          expect(
            contrast(text, bg),
            `${t.id}: --text-primary on ${bgVar}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it('shell text stays readable on shell surfaces', () => {
      for (const t of themes) {
        const text = t.shellVars['--text-primary'];
        for (const bgVar of ['--shell-bg', '--channel-bg', '--topbar-bg']) {
          const bg = t.shellVars[bgVar];
          if (!text.startsWith('#') || !bg.startsWith('#')) continue;
          expect(
            contrast(text, bg),
            `${t.id}: shell --text-primary on ${bgVar}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });

  describe('CSS and HTML builders', () => {
    it('content CSS puts the default on :root and a class per theme', () => {
      const set = resolveExportThemeSet({ themeSetting: 'terminal', isSupporter: false });
      const css = buildContentThemeCSS(set);
      expect(css).toMatch(/:root \{[^}]*--bg-primary: #0a0f0a/);
      for (const t of set.themes) {
        expect(css).toContain(`.export-theme-${t.id} {`);
      }
      // Theme classes must come after :root so equal specificity resolves
      // in the class's favor.
      expect(css.indexOf(':root')).toBeLessThan(css.indexOf('.export-theme-'));
    });

    it('shell CSS mirrors the same structure', () => {
      const set = defaultExportThemeSet();
      const css = buildShellThemeCSS(set);
      expect(css).toMatch(/:root \{[^}]*--shell-bg: #202225/);
      for (const t of set.themes) {
        expect(css).toContain(`.shell-theme-${t.id} {`);
      }
    });

    it('options JSON carries id, name, and base only', () => {
      const parsed = JSON.parse(buildThemeOptionsJson(defaultExportThemeSet()));
      expect(parsed[0]).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        base: expect.stringMatching(/^(dark|light)$/),
      });
    });

    it('select HTML marks the default selected and escapes names', () => {
      const set = resolveExportThemeSet({ themeSetting: DISCORD_LIGHT_ID, isSupporter: false });
      const html = buildThemeSelectHtml(set, 'theme-select', 'theme-select');
      expect(html).toContain('<option value="discord-light" selected>');
      expect(html).toContain('id="theme-select"');
      expect(html).not.toContain('<option value="discord-dark" selected>');
    });
  });
});
