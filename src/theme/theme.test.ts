import { describe, it, expect } from 'vitest';
import {
  darkTheme,
  lightTheme,
  getThemeById,
  getThemeByMode,
  findThemeDescriptor,
  THEME_DESCRIPTORS,
  DISCORD_DARK_ID,
  DISCORD_LIGHT_ID,
} from './theme';
import { createAppTheme } from './createAppTheme';
import type { ThemeDescriptor } from './descriptors';

describe('theme registry', () => {
  it('resolves canonical ids', () => {
    expect(getThemeById(DISCORD_DARK_ID)).toBe(darkTheme);
    expect(getThemeById(DISCORD_LIGHT_ID)).toBe(lightTheme);
  });

  it('accepts legacy dark/light aliases forever', () => {
    expect(getThemeById('dark')).toBe(darkTheme);
    expect(getThemeById('light')).toBe(lightTheme);
    expect(findThemeDescriptor('dark')?.id).toBe(DISCORD_DARK_ID);
    expect(findThemeDescriptor('light')?.id).toBe(DISCORD_LIGHT_ID);
  });

  it('falls back to the default theme for unknown or missing ids', () => {
    expect(getThemeById(undefined)).toBe(darkTheme);
    expect(getThemeById('')).toBe(darkTheme);
    expect(getThemeById('synthwave-not-yet-shipped')).toBe(darkTheme);
  });

  it('getThemeByMode keeps its pre-registry contract', () => {
    expect(getThemeByMode('light')).toBe(lightTheme);
    expect(getThemeByMode('dark')).toBe(darkTheme);
    expect(getThemeByMode('anything-else')).toBe(darkTheme);
  });

  it('caches built themes per id', () => {
    expect(getThemeById(DISCORD_DARK_ID)).toBe(getThemeById(DISCORD_DARK_ID));
  });

  it('every descriptor has a unique id and never uses the reserved "auto"', () => {
    const ids = THEME_DESCRIPTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('auto');
  });
});

describe('v2.1.0 roster', () => {
  it('ships 6 free and 9 supporter themes in ratified display order', () => {
    expect(THEME_DESCRIPTORS.map((d) => d.name)).toEqual([
      'Dark Original',
      'Light Original',
      'Terminal',
      'High Contrast',
      'Overcast',
      'Classic',
      'AMOLED Void',
      'Synthwave',
      'Bytecraft',
      'Ember',
      'Nekonoir',
      'Circuit',
      'Noir',
      'Abyss',
      'Abstract',
    ]);
    expect(THEME_DESCRIPTORS.filter((d) => d.tier === 'free')).toHaveLength(6);
    expect(THEME_DESCRIPTORS.filter((d) => d.tier === 'supporter')).toHaveLength(9);
  });

  it('the default theme stays Dark Original', () => {
    expect(THEME_DESCRIPTORS[0].id).toBe(DISCORD_DARK_ID);
  });

  it('every supporter theme has exactly one accent; free themes have none', () => {
    for (const d of THEME_DESCRIPTORS) {
      if (d.tier === 'supporter') {
        expect(d.accent, `${d.id} should have an accent`).toBeDefined();
        expect(['flow', 'pulse']).toContain(d.accent!.motion);
        expect(d.accent!.durationS).toBeGreaterThan(0);
      } else {
        expect(d.accent, `${d.id} should not have an accent`).toBeUndefined();
      }
    }
  });

  it('built themes carry the accent through to theme.themeAccent', () => {
    expect(getThemeById('synthwave').themeAccent?.motion).toBe('flow');
    expect(getThemeById('amoled-void').themeAccent?.motion).toBe('pulse');
    expect(getThemeById('terminal').themeAccent).toBeUndefined();
    expect(darkTheme.themeAccent).toBeUndefined();
  });

  it("'flow' accents loop seamlessly (gradient starts and ends on the same stop)", () => {
    for (const d of THEME_DESCRIPTORS) {
      if (d.accent?.motion !== 'flow') continue;
      const stops = d.accent.background
        .replace(/^linear-gradient\(\s*90deg\s*,/, '')
        .replace(/\)\s*$/, '')
        .split(/,(?![^(]*\))/)
        .map((s) => s.trim().replace(/\s+[\d.]+%$/, ''));
      expect(stops[0], `${d.id} accent should wrap seamlessly`).toBe(stops[stops.length - 1]);
    }
  });
});

// ── WCAG contrast enforcement ───────────────────────────────────────
// The sweep's guardrail: every palette must be genuinely readable, and
// High Contrast must earn its name (AAA for body text).

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('palette contrast (WCAG)', () => {
  for (const d of THEME_DESCRIPTORS) {
    const p = d.palette;
    const isHC = d.id === 'high-contrast';
    const bodyMin = isHC ? 7 : 4.5;

    it(`${d.id}: primary text is readable on all backgrounds (>= ${bodyMin}:1)`, () => {
      for (const bg of [p.background.default, p.background.paper, p.background.elevated]) {
        expect(
          contrast(p.text.primary, bg),
          `${d.id} text.primary on ${bg}`,
        ).toBeGreaterThanOrEqual(bodyMin);
      }
    });

    it(`${d.id}: secondary text is readable on default/paper (>= 4.5:1)`, () => {
      for (const bg of [p.background.default, p.background.paper]) {
        expect(
          contrast(p.text.secondary, bg),
          `${d.id} text.secondary on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${d.id}: button text is legible on its fills (>= 3:1, UI component threshold)`, () => {
      const ctaText = p.primary.contrastText === '#fff' ? '#ffffff' : p.primary.contrastText;
      expect(contrast(ctaText, p.cta.main), `${d.id} contained button`).toBeGreaterThanOrEqual(3);
      expect(contrast('#ffffff', p.ctaDanger.main), `${d.id} danger button`).toBeGreaterThanOrEqual(3);
      expect(
        contrast(ctaText, p.primary.main),
        `${d.id} toggle/selection fill`,
      ).toBeGreaterThanOrEqual(3);
    });

    it(`${d.id}: links are readable on default background (>= 4.5:1)`, () => {
      expect(contrast(p.link.main, p.background.default), `${d.id} link`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('migrated Discord themes stay pixel-identical', () => {
  it('dark theme keeps its pre-factory palette', () => {
    expect(darkTheme.palette.mode).toBe('dark');
    expect(darkTheme.palette.primary.main).toBe('#7289da');
    expect(darkTheme.palette.primary.dark).toBe('#5865f2');
    expect(darkTheme.palette.background.default).toBe('#1e2124');
    expect(darkTheme.palette.background.paper).toBe('#282b30');
    expect(darkTheme.palette.backgroundElevated).toBe('#2e3338');
    expect(darkTheme.palette.backgroundGlass).toBe('rgba(40, 43, 48, 0.7)');
    expect(darkTheme.palette.backgroundGlassStrong).toBe('rgba(40, 43, 48, 0.85)');
    expect(darkTheme.palette.backgroundGlassSubtle).toBe('rgba(40, 43, 48, 0.5)');
    expect(darkTheme.palette.backgroundDialog).toBe('rgba(54, 57, 63, 0.95)');
    expect(darkTheme.palette.backgroundTooltip).toBe('rgba(40, 43, 48, 0.98)');
    expect(darkTheme.palette.cta).toEqual({ main: '#5865f2', hover: '#4752c4', active: '#3c45a5' });
    expect(darkTheme.customShadows.glow).toBe(
      '0 0 20px rgba(114, 137, 218, 0.3), 0 0 40px rgba(114, 137, 218, 0.15)',
    );
  });

  it('light theme keeps its pre-factory palette', () => {
    expect(lightTheme.palette.mode).toBe('light');
    expect(lightTheme.palette.primary.main).toBe('#5865f2');
    expect(lightTheme.palette.background.default).toBe('#ffffff');
    expect(lightTheme.palette.background.paper).toBe('#f2f3f5');
    expect(lightTheme.palette.backgroundGlass).toBe('rgba(255, 255, 255, 0.7)');
    expect(lightTheme.palette.backgroundGlassStrong).toBe('rgba(255, 255, 255, 0.9)');
    expect(lightTheme.palette.ctaDanger).toEqual({ main: '#d83c3e', hover: '#c43538', active: '#b02e31' });
    expect(lightTheme.customShadows.glow).toBe(
      '0 0 20px rgba(88, 101, 242, 0.15), 0 0 40px rgba(88, 101, 242, 0.08)',
    );
  });

  it('contained buttons keep the exact pre-factory action colors', () => {
    const styles = darkTheme.components?.MuiButton?.styleOverrides as any;
    expect(styles.contained.backgroundColor).toBe('#5865f2');
    expect(styles.contained['&:hover'].backgroundColor).toBe('#4752c4');
    expect(styles.containedError.backgroundColor).toBe('#ed4245');
    expect(styles.outlined.backgroundColor).toBe('rgba(114, 137, 218, 0.12)');
    expect(styles.outlined.color).toBe('#7289da');
  });
});

// A deliberately non-blurple descriptor: if any blurple survives in the
// built theme, a component override is still hardcoded instead of derived.
const emberLike: ThemeDescriptor = {
  id: 'test-ember',
  name: 'Test Ember',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#e25822', light: '#f07f4f', dark: '#b23e12', contrastText: '#fff' },
    secondary: { main: '#f2c9b0', light: '#ffffff', dark: '#c99b7d', },
    background: { default: '#16100c', paper: '#211913', elevated: '#2a2119' },
    text: { primary: '#fff4ec', secondary: '#e8cdbb' },
    error: '#f04747',
    warning: '#faa61a',
    success: '#43b581',
    divider: 'rgba(255, 255, 255, 0.12)',
    glassBase: '#211913',
    dialog: 'rgba(42, 33, 25, 0.95)',
    tooltip: 'rgba(33, 25, 19, 0.98)',
    link: { main: '#ffab70', hover: '#ffc599' },
    cta: { main: '#e25822', hover: '#c44b1c', active: '#a63e16' },
    ctaDanger: { main: '#ed4245', hover: '#d83c3e', active: '#c43538' },
    gradient: {
      primary: 'linear-gradient(135deg, #e25822 0%, #b23e12 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(226, 88, 34, 0.1) 0%, rgba(178, 62, 18, 0.15) 100%)',
      overlay: 'linear-gradient(180deg, rgba(226, 88, 34, 0.05) 0%, transparent 100%)',
    },
  },
};

describe('createAppTheme derives everything from the descriptor', () => {
  const theme = createAppTheme(emberLike);

  it('accent colors track the descriptor primary, not blurple', () => {
    expect(theme.palette.primary.main).toBe('#e25822');
    expect(theme.customShadows.glow).toBe(
      '0 0 20px rgba(226, 88, 34, 0.3), 0 0 40px rgba(226, 88, 34, 0.15)',
    );
    const styles = theme.components?.MuiButton?.styleOverrides as any;
    expect(styles.contained.backgroundColor).toBe('#e25822');
    expect(styles.outlined.backgroundColor).toBe('rgba(226, 88, 34, 0.12)');
    expect(styles.root['&.Mui-focusVisible'].outline).toBe('2px solid #e25822');
  });

  it('glass surfaces derive from the descriptor glassBase', () => {
    expect(theme.palette.backgroundGlass).toBe('rgba(33, 25, 19, 0.7)');
    expect(theme.palette.backgroundGlassStrong).toBe('rgba(33, 25, 19, 0.85)');
    expect(theme.palette.backgroundGlassSubtle).toBe('rgba(33, 25, 19, 0.5)');
  });

  it('no blurple leaks into the built theme', () => {
    const serialized = JSON.stringify({
      palette: theme.palette,
      customShadows: theme.customShadows,
      components: theme.components?.MuiButton,
    }).toLowerCase();
    expect(serialized).not.toContain('7289da');
    expect(serialized).not.toContain('5865f2');
    expect(serialized).not.toContain('114, 137, 218');
    expect(serialized).not.toContain('88, 101, 242');
  });
});
