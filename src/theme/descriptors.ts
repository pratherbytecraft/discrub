/**
 * Theme descriptors — the palette-level source of truth the theme
 * factory (`createAppTheme.ts`) builds full MUI themes from.
 *
 * A descriptor is intentionally small: only the colors that genuinely
 * differ between themes live here. Everything else (typography, shape,
 * transitions, component overrides, glass/glow derivations) is shared
 * and derived by the factory, so adding a theme means adding ONE
 * descriptor entry — never another hand-built `createTheme` call.
 *
 * v2.1.0 roster: the free and supporter palettes land in a later slot;
 * this file starts with the two existing Discord themes migrated
 * verbatim (every hex below matches the pre-factory `theme.ts`).
 */

export type ThemeBase = 'dark' | 'light';
export type ThemeTier = 'free' | 'supporter';

export interface ThemeDescriptorPalette {
  primary: { main: string; light: string; dark: string; contrastText: string };
  secondary: { main: string; light: string; dark: string };
  background: { default: string; paper: string; elevated: string };
  text: { primary: string; secondary: string };
  error: string;
  warning: string;
  success: string;
  divider: string;
  /** Solid base color the translucent glass surfaces are mixed from. */
  glassBase: string;
  /** Dialog paper backdrop (translucent values allowed). */
  dialog: string;
  /** Tooltip/arrow backdrop (translucent values allowed). */
  tooltip: string;
  link: { main: string; hover: string };
  /** Contained-button (call-to-action) color ramp. */
  cta: { main: string; hover: string; active: string };
  /** Destructive contained-button color ramp. */
  ctaDanger: { main: string; hover: string; active: string };
  gradient: { primary: string; primarySubtle: string; overlay: string };
}

/**
 * A supporter theme's single subtle animated accent, rendered as a thin
 * gradient strip under the top bar. CSS-only: 'flow' drifts the gradient
 * horizontally (background-position over a 200%-wide gradient whose ends
 * match, so the loop is seamless); 'pulse' breathes its opacity. Gated by
 * APP_THEME_ANIMATIONS, paused while an operation runs, and neutralized
 * by the global prefers-reduced-motion rule. Free themes have none.
 */
export interface ThemeAccent {
  /** CSS background for the strip (a linear-gradient). */
  background: string;
  motion: 'flow' | 'pulse';
  /** Animation loop duration in seconds. */
  durationS: number;
}

export type ThemeEffectsId = 'abstract';

export interface ThemeDescriptor {
  /** Stable id persisted in APP_THEME_MODE. Never 'auto'. */
  id: string;
  /** Display name for pickers and tooltips. */
  name: string;
  /** MUI palette mode the theme renders in. */
  base: ThemeBase;
  tier: ThemeTier;
  palette: ThemeDescriptorPalette;
  accent?: ThemeAccent;
  /** A named set of whole-app visual effects, drawn by `ThemeEffects`. Only Abstract has one. */
  effects?: ThemeEffectsId;
}

export const DISCORD_DARK_ID = 'discord-dark';
export const DISCORD_LIGHT_ID = 'discord-light';

const discordDark: ThemeDescriptor = {
  id: DISCORD_DARK_ID,
  name: 'Dark Original',
  base: 'dark',
  tier: 'free',
  palette: {
    primary: { main: '#7289da', light: '#99aab5', dark: '#5865f2', contrastText: '#fff' },
    secondary: { main: '#d2d5f7', light: '#ffffff', dark: '#99aab5' },
    background: { default: '#1e2124', paper: '#282b30', elevated: '#2e3338' },
    text: { primary: '#ffffff', secondary: '#d2d5f7' },
    error: '#f04747',
    warning: '#faa61a',
    success: '#43b581',
    divider: 'rgba(255, 255, 255, 0.12)',
    glassBase: '#282b30',
    dialog: 'rgba(54, 57, 63, 0.95)',
    tooltip: 'rgba(40, 43, 48, 0.98)',
    link: { main: '#00b0f4', hover: '#00d4ff' },
    cta: { main: '#5865f2', hover: '#4752c4', active: '#3c45a5' },
    ctaDanger: { main: '#ed4245', hover: '#d83c3e', active: '#c43538' },
    gradient: {
      primary: 'linear-gradient(135deg, #7289da 0%, #5865f2 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(114, 137, 218, 0.1) 0%, rgba(88, 101, 242, 0.15) 100%)',
      overlay: 'linear-gradient(180deg, rgba(114, 137, 218, 0.05) 0%, transparent 100%)',
    },
  },
};

const discordLight: ThemeDescriptor = {
  id: DISCORD_LIGHT_ID,
  name: 'Light Original',
  base: 'light',
  tier: 'free',
  palette: {
    primary: { main: '#5865f2', light: '#7289da', dark: '#4752c4', contrastText: '#fff' },
    secondary: { main: '#4f5660', light: '#747f8d', dark: '#2e3338' },
    background: { default: '#ffffff', paper: '#f2f3f5', elevated: '#e3e5e8' },
    text: { primary: '#2e3338', secondary: '#4f5660' },
    error: '#d83c3e',
    warning: '#e67e22',
    success: '#2d8b5e',
    divider: 'rgba(0, 0, 0, 0.08)',
    glassBase: '#ffffff',
    dialog: 'rgba(255, 255, 255, 0.98)',
    tooltip: 'rgba(255, 255, 255, 0.98)',
    link: { main: '#0067e0', hover: '#004db3' },
    cta: { main: '#5865f2', hover: '#4752c4', active: '#3c45a5' },
    ctaDanger: { main: '#d83c3e', hover: '#c43538', active: '#b02e31' },
    gradient: {
      primary: 'linear-gradient(135deg, #5865f2 0%, #7289da 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(88, 101, 242, 0.06) 0%, rgba(114, 137, 218, 0.1) 100%)',
      overlay: 'linear-gradient(180deg, rgba(88, 101, 242, 0.03) 0%, transparent 100%)',
    },
  },
};

// ── Free roster (v2.1.0) ────────────────────────────────────────────

const terminal: ThemeDescriptor = {
  id: 'terminal',
  name: 'Terminal',
  base: 'dark',
  tier: 'free',
  palette: {
    primary: { main: '#2ee66b', light: '#66ff99', dark: '#1fb350', contrastText: '#05130a' },
    secondary: { main: '#9fdf9f', light: '#ccffcc', dark: '#6fae6f' },
    background: { default: '#0a0f0a', paper: '#101710', elevated: '#162016' },
    text: { primary: '#c8f5c8', secondary: '#84c98d' },
    error: '#ff5544',
    warning: '#ffbb33',
    success: '#2ee66b',
    divider: 'rgba(46, 230, 107, 0.15)',
    glassBase: '#101710',
    dialog: 'rgba(16, 26, 16, 0.95)',
    tooltip: 'rgba(12, 19, 12, 0.98)',
    link: { main: '#ffc266', hover: '#ffd699' },
    cta: { main: '#1fb350', hover: '#178f40', active: '#117233' },
    ctaDanger: { main: '#cc4436', hover: '#a83a2e', active: '#8f2f24' },
    gradient: {
      primary: 'linear-gradient(135deg, #2ee66b 0%, #1fb350 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(46, 230, 107, 0.08) 0%, rgba(31, 179, 80, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(46, 230, 107, 0.04) 0%, transparent 100%)',
    },
  },
};

const highContrast: ThemeDescriptor = {
  id: 'high-contrast',
  name: 'High Contrast',
  base: 'dark',
  tier: 'free',
  palette: {
    primary: { main: '#ffd500', light: '#ffe561', dark: '#c7a600', contrastText: '#000000' },
    secondary: { main: '#66d9ff', light: '#a3ecff', dark: '#2eb8e6' },
    background: { default: '#000000', paper: '#0d0d0d', elevated: '#1a1a1a' },
    text: { primary: '#ffffff', secondary: '#e6e6e6' },
    error: '#ff6161',
    warning: '#ffb84d',
    success: '#4dff88',
    divider: 'rgba(255, 255, 255, 0.35)',
    glassBase: '#000000',
    dialog: 'rgba(0, 0, 0, 0.98)',
    tooltip: 'rgba(13, 13, 13, 0.98)',
    link: { main: '#66d9ff', hover: '#a3ecff' },
    cta: { main: '#ffd500', hover: '#e6bf00', active: '#c7a600' },
    ctaDanger: { main: '#d90000', hover: '#b30000', active: '#8f0000' },
    gradient: {
      primary: 'linear-gradient(135deg, #ffd500 0%, #c7a600 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(255, 213, 0, 0.1) 0%, rgba(199, 166, 0, 0.14) 100%)',
      overlay: 'linear-gradient(180deg, rgba(255, 213, 0, 0.05) 0%, transparent 100%)',
    },
  },
};

const overcast: ThemeDescriptor = {
  id: 'overcast',
  name: 'Overcast',
  base: 'light',
  tier: 'free',
  palette: {
    primary: { main: '#5b7c99', light: '#82a0ba', dark: '#446079', contrastText: '#fff' },
    secondary: { main: '#6d7a86', light: '#93a0ac', dark: '#4c5762' },
    background: { default: '#f4f6f8', paper: '#e9edf1', elevated: '#dde3e9' },
    text: { primary: '#2c3540', secondary: '#4f5d6b' },
    error: '#bf3f3f',
    warning: '#a3691f',
    success: '#337453',
    divider: 'rgba(44, 53, 64, 0.12)',
    glassBase: '#f7f9fa',
    dialog: 'rgba(249, 250, 251, 0.98)',
    tooltip: 'rgba(255, 255, 255, 0.98)',
    link: { main: '#3a6ea5', hover: '#2a5479' },
    cta: { main: '#4a6a86', hover: '#3e5a73', active: '#334c61' },
    ctaDanger: { main: '#bf3f3f', hover: '#a83636', active: '#8f2c2c' },
    gradient: {
      primary: 'linear-gradient(135deg, #5b7c99 0%, #446079 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(91, 124, 153, 0.07) 0%, rgba(68, 96, 121, 0.1) 100%)',
      overlay: 'linear-gradient(180deg, rgba(91, 124, 153, 0.04) 0%, transparent 100%)',
    },
  },
};

// Homage to discrub-ext 1.x: Discord-era grays with the steel-blue
// #266798 accent the classic extension used. Our own colors.
const classic: ThemeDescriptor = {
  id: 'classic',
  name: 'Classic',
  base: 'dark',
  tier: 'free',
  palette: {
    primary: { main: '#3f8ec6', light: '#6faed6', dark: '#266798', contrastText: '#fff' },
    secondary: { main: '#b5bac1', light: '#dcdee1', dark: '#82878f' },
    background: { default: '#202225', paper: '#2b2d31', elevated: '#36393f' },
    text: { primary: '#f2f3f5', secondary: '#b5bac1' },
    error: '#f04747',
    warning: '#faa61a',
    success: '#43b581',
    divider: 'rgba(255, 255, 255, 0.1)',
    glassBase: '#2b2d31',
    dialog: 'rgba(43, 45, 49, 0.95)',
    tooltip: 'rgba(32, 34, 37, 0.98)',
    link: { main: '#35a6e0', hover: '#5cc0f2' },
    cta: { main: '#266798', hover: '#1f557d', active: '#194564' },
    ctaDanger: { main: '#d83c3e', hover: '#c43538', active: '#b02e31' },
    gradient: {
      primary: 'linear-gradient(135deg, #3f8ec6 0%, #266798 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(63, 142, 198, 0.08) 0%, rgba(38, 103, 152, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(63, 142, 198, 0.05) 0%, transparent 100%)',
    },
  },
};

// ── Supporter roster (v2.1.0) ───────────────────────────────────────

const amoledVoid: ThemeDescriptor = {
  id: 'amoled-void',
  name: 'AMOLED Void',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#8a7bff', light: '#b3a8ff', dark: '#6553e0', contrastText: '#0e0b26' },
    secondary: { main: '#a8a4bf', light: '#cfcce0', dark: '#7c7896' },
    background: { default: '#000000', paper: '#0a0a0f', elevated: '#131318' },
    text: { primary: '#e8e6f0', secondary: '#a8a4bf' },
    error: '#ff5c5c',
    warning: '#ffb454',
    success: '#4ade80',
    divider: 'rgba(255, 255, 255, 0.09)',
    glassBase: '#0a0a0f',
    dialog: 'rgba(13, 13, 20, 0.95)',
    tooltip: 'rgba(10, 10, 15, 0.98)',
    link: { main: '#9d8fff', hover: '#c0b6ff' },
    cta: { main: '#8a7bff', hover: '#7463f2', active: '#5f4ed8' },
    ctaDanger: { main: '#e0484b', hover: '#c93d40', active: '#b03436' },
    gradient: {
      primary: 'linear-gradient(135deg, #8a7bff 0%, #6553e0 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(138, 123, 255, 0.08) 0%, rgba(101, 83, 224, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(138, 123, 255, 0.04) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, transparent 0%, rgba(138, 123, 255, 0.8) 50%, transparent 100%)',
    motion: 'pulse',
    durationS: 6,
  },
};

const synthwave: ThemeDescriptor = {
  id: 'synthwave',
  name: 'Synthwave',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#ff4fd8', light: '#ff85e6', dark: '#d426ae', contrastText: '#2b0a24' },
    secondary: { main: '#35e0e0', light: '#7df0f0', dark: '#1fb0b0' },
    background: { default: '#16102b', paper: '#1f1738', elevated: '#2a1f4a' },
    text: { primary: '#f5eaff', secondary: '#c3aee6' },
    error: '#ff5470',
    warning: '#ffc247',
    success: '#3ddc97',
    divider: 'rgba(255, 79, 216, 0.18)',
    glassBase: '#1f1738',
    dialog: 'rgba(31, 23, 56, 0.95)',
    tooltip: 'rgba(22, 16, 43, 0.98)',
    link: { main: '#4fd8ff', hover: '#8ae8ff' },
    cta: { main: '#d426ae', hover: '#b31f93', active: '#93187a' },
    ctaDanger: { main: '#e04565', hover: '#c43a57', active: '#a83049' },
    gradient: {
      primary: 'linear-gradient(135deg, #ff4fd8 0%, #35e0e0 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(255, 79, 216, 0.09) 0%, rgba(53, 224, 224, 0.09) 100%)',
      overlay: 'linear-gradient(180deg, rgba(255, 79, 216, 0.05) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, #ff4fd8 0%, #35e0e0 50%, #ff4fd8 100%)',
    motion: 'flow',
    durationS: 8,
  },
};

const bytecraft: ThemeDescriptor = {
  id: 'bytecraft',
  name: 'Bytecraft',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#a06bff', light: '#bf94ff', dark: '#7c46d8', contrastText: '#fff' },
    secondary: { main: '#e6b84d', light: '#f2d084', dark: '#c2933a' },
    background: { default: '#17111f', paper: '#201829', elevated: '#2a2136' },
    text: { primary: '#f3edfa', secondary: '#c9b8dd' },
    error: '#f25555',
    warning: '#f0a33c',
    success: '#4ec98a',
    divider: 'rgba(160, 107, 255, 0.16)',
    glassBase: '#201829',
    dialog: 'rgba(32, 24, 41, 0.95)',
    tooltip: 'rgba(23, 17, 31, 0.98)',
    link: { main: '#e6b84d', hover: '#f2d084' },
    cta: { main: '#7c46d8', hover: '#6938bd', active: '#572e9e' },
    ctaDanger: { main: '#d84a4a', hover: '#bd3f3f', active: '#a13434' },
    gradient: {
      primary: 'linear-gradient(135deg, #a06bff 0%, #e6b84d 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(160, 107, 255, 0.08) 0%, rgba(230, 184, 77, 0.08) 100%)',
      overlay: 'linear-gradient(180deg, rgba(160, 107, 255, 0.05) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, transparent 0%, transparent 30%, rgba(230, 184, 77, 0.9) 50%, transparent 70%, transparent 100%)',
    motion: 'flow',
    durationS: 7,
  },
};

const ember: ThemeDescriptor = {
  id: 'ember',
  name: 'Ember',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#e2662a', light: '#f28b52', dark: '#b84c15', contrastText: '#fff' },
    secondary: { main: '#d9a583', light: '#efc7a9', dark: '#b57f5c' },
    background: { default: '#191210', paper: '#221a16', elevated: '#2d221c' },
    text: { primary: '#faf1ea', secondary: '#d9bfae' },
    error: '#f0483f',
    warning: '#f0a33c',
    success: '#58c27d',
    divider: 'rgba(226, 102, 42, 0.16)',
    glassBase: '#221a16',
    dialog: 'rgba(34, 26, 22, 0.95)',
    tooltip: 'rgba(25, 18, 16, 0.98)',
    link: { main: '#f5a05f', hover: '#ffc08a' },
    cta: { main: '#b84c15', hover: '#9c3f10', active: '#82340c' },
    ctaDanger: { main: '#cf4040', hover: '#b43737', active: '#992e2e' },
    gradient: {
      primary: 'linear-gradient(135deg, #e2662a 0%, #b84c15 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(226, 102, 42, 0.08) 0%, rgba(184, 76, 21, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(226, 102, 42, 0.05) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, transparent 0%, rgba(226, 102, 42, 0.85) 50%, transparent 100%)',
    motion: 'pulse',
    durationS: 5,
  },
};

const nekonoir: ThemeDescriptor = {
  id: 'nekonoir',
  name: 'Nekonoir',
  base: 'light',
  tier: 'supporter',
  palette: {
    primary: { main: '#d4739f', light: '#e69dbd', dark: '#b25580', contrastText: '#fff' },
    secondary: { main: '#9c8ac9', light: '#bcaede', dark: '#7d6bab' },
    background: { default: '#fdf6f0', paper: '#f7ebe3', elevated: '#f0e0d5' },
    text: { primary: '#4a3b45', secondary: '#6f5a66' },
    error: '#c4504e',
    warning: '#a06a24',
    success: '#3f7d56',
    divider: 'rgba(74, 59, 69, 0.12)',
    glassBase: '#fdf6f0',
    dialog: 'rgba(253, 248, 244, 0.98)',
    tooltip: 'rgba(255, 252, 249, 0.98)',
    link: { main: '#6f54a8', hover: '#59418c' },
    cta: { main: '#b25580', hover: '#9a476d', active: '#823a5b' },
    ctaDanger: { main: '#c4504e', hover: '#ab4341', active: '#903836' },
    gradient: {
      primary: 'linear-gradient(135deg, #d4739f 0%, #9c8ac9 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(212, 115, 159, 0.08) 0%, rgba(156, 138, 201, 0.1) 100%)',
      overlay: 'linear-gradient(180deg, rgba(212, 115, 159, 0.05) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, #d4739f 0%, #9c8ac9 50%, #d4739f 100%)',
    motion: 'flow',
    durationS: 10,
  },
};

const circuit: ThemeDescriptor = {
  id: 'circuit',
  name: 'Circuit',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#d8973f', light: '#ecb56b', dark: '#b57827', contrastText: '#0e1626' },
    secondary: { main: '#56d364', light: '#84e08e', dark: '#3aa94a' },
    background: { default: '#0b1220', paper: '#111a2c', elevated: '#182338' },
    text: { primary: '#e8eef7', secondary: '#a9b8cf' },
    error: '#f25f5c',
    warning: '#e0a63c',
    success: '#56d364',
    divider: 'rgba(216, 151, 63, 0.18)',
    glassBase: '#111a2c',
    dialog: 'rgba(17, 26, 44, 0.95)',
    tooltip: 'rgba(11, 18, 32, 0.98)',
    link: { main: '#56d364', hover: '#84e08e' },
    cta: { main: '#d8973f', hover: '#c08430', active: '#a87226' },
    ctaDanger: { main: '#cf4747', hover: '#b53c3c', active: '#9a3232' },
    gradient: {
      primary: 'linear-gradient(135deg, #d8973f 0%, #b57827 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(216, 151, 63, 0.08) 0%, rgba(181, 120, 39, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(216, 151, 63, 0.04) 0%, transparent 100%)',
    },
  },
  accent: {
    // Copper "trace" dashes with a phosphor-green node, drifting like
    // current on a PCB. Multi-stop gradient so 'flow' loops seamlessly.
    background: 'linear-gradient(90deg, transparent 0%, rgba(216, 151, 63, 0.9) 8%, transparent 16%, transparent 24%, rgba(216, 151, 63, 0.9) 32%, transparent 40%, rgba(86, 211, 100, 0.9) 48%, transparent 56%, transparent 64%, rgba(216, 151, 63, 0.9) 72%, transparent 80%, rgba(216, 151, 63, 0.9) 92%, transparent 100%)',
    motion: 'flow',
    durationS: 6,
  },
};

const noir: ThemeDescriptor = {
  id: 'noir',
  name: 'Noir',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#c22e35', light: '#d95a60', dark: '#9c2329', contrastText: '#fff' },
    secondary: { main: '#8f8f96', light: '#bdbdc4', dark: '#6b6b72' },
    background: { default: '#101012', paper: '#17171a', elevated: '#202024' },
    text: { primary: '#f5f5f5', secondary: '#b3b3b8' },
    error: '#e04545',
    warning: '#d1953c',
    success: '#57a869',
    divider: 'rgba(255, 255, 255, 0.14)',
    glassBase: '#17171a',
    dialog: 'rgba(23, 23, 26, 0.95)',
    tooltip: 'rgba(16, 16, 18, 0.98)',
    link: { main: '#d0d0d6', hover: '#ffffff' },
    cta: { main: '#c22e35', hover: '#a52830', active: '#8a2128' },
    ctaDanger: { main: '#802025', hover: '#6b1a1f', active: '#57151a' },
    gradient: {
      primary: 'linear-gradient(135deg, #c22e35 0%, #7a1e24 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(194, 46, 53, 0.08) 0%, rgba(122, 30, 36, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(194, 46, 53, 0.04) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, transparent 0%, transparent 35%, rgba(245, 245, 245, 0.5) 50%, transparent 65%, transparent 100%)',
    motion: 'flow',
    durationS: 12,
  },
};

const abyss: ThemeDescriptor = {
  id: 'abyss',
  name: 'Abyss',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#2adfd4', light: '#6ceee6', dark: '#16aba3', contrastText: '#04252b' },
    secondary: { main: '#5a9ddb', light: '#8cc0ea', dark: '#3d7db3' },
    background: { default: '#04121b', paper: '#082031', elevated: '#0d2a3f' },
    text: { primary: '#dff3f7', secondary: '#93bcc9' },
    error: '#f0605a',
    warning: '#e8b04a',
    success: '#45cf7f',
    divider: 'rgba(42, 223, 212, 0.15)',
    glassBase: '#082031',
    dialog: 'rgba(8, 32, 49, 0.95)',
    tooltip: 'rgba(4, 18, 27, 0.98)',
    link: { main: '#63e0ff', hover: '#9deeff' },
    cta: { main: '#16aba3', hover: '#128f89', active: '#0e746f' },
    ctaDanger: { main: '#d34a48', hover: '#b83f3e', active: '#9c3534' },
    gradient: {
      primary: 'linear-gradient(135deg, #2adfd4 0%, #0d5c8c 100%)',
      primarySubtle: 'linear-gradient(135deg, rgba(42, 223, 212, 0.07) 0%, rgba(13, 92, 140, 0.12) 100%)',
      overlay: 'linear-gradient(180deg, rgba(42, 223, 212, 0.04) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, transparent 0%, rgba(42, 223, 212, 0.65) 35%, rgba(90, 157, 219, 0.5) 65%, transparent 100%)',
    motion: 'flow',
    durationS: 14,
  },
};

/**
 * Abstract (2.2.0, owner 2026-09-21): a trippy theme. Misprint colours on
 * near-black violet, kept dark on the owner's ask. The palette is ordinary;
 * the warped headings, twisting buttons and drifting colour live in
 * `ThemeEffects` behind `effects: 'abstract'`.
 */
const abstract: ThemeDescriptor = {
  id: 'abstract',
  name: 'Abstract',
  base: 'dark',
  tier: 'supporter',
  palette: {
    primary: { main: '#d63bbd', light: '#f06ad9', dark: '#a02a8d', contrastText: '#12040f' },
    secondary: { main: '#22c8d6', light: '#6fe3ec', dark: '#16939e' },
    background: { default: '#08040e', paper: '#0f0819', elevated: '#180d27' },
    text: { primary: '#ece4f7', secondary: '#a08fbd' },
    error: '#ff5470',
    warning: '#e6dc3a',
    success: '#3ddc97',
    divider: 'rgba(143, 91, 255, 0.2)',
    glassBase: '#0f0819',
    dialog: 'rgba(15, 8, 25, 0.96)',
    tooltip: 'rgba(8, 4, 14, 0.98)',
    link: { main: '#3fd4e0', hover: '#86e9f0' },
    cta: { main: '#a02a8d', hover: '#872377', active: '#6e1c61' },
    ctaDanger: { main: '#d23f5e', hover: '#b83652', active: '#9c2d45' },
    gradient: {
      primary: 'linear-gradient(100deg, #d63bbd 0%, #7a4be0 55%, #22c8d6 100%)',
      primarySubtle: 'linear-gradient(100deg, rgba(214, 59, 189, 0.08) 0%, rgba(34, 200, 214, 0.08) 100%)',
      overlay: 'linear-gradient(180deg, rgba(122, 75, 224, 0.05) 0%, transparent 100%)',
    },
  },
  accent: {
    background: 'linear-gradient(90deg, #d63bbd 0%, #e6dc3a 33%, #22c8d6 66%, #d63bbd 100%)',
    motion: 'flow',
    durationS: 11,
  },
  effects: 'abstract',
};


/** Registry, in display order. The first entry is the app default. */
export const THEME_DESCRIPTORS: ThemeDescriptor[] = [
  discordDark,
  discordLight,
  terminal,
  highContrast,
  overcast,
  classic,
  amoledVoid,
  synthwave,
  bytecraft,
  ember,
  nekonoir,
  circuit,
  noir,
  abyss,
  abstract,
];

export const DEFAULT_THEME_ID = DISCORD_DARK_ID;
export const DEFAULT_LIGHT_THEME_ID = DISCORD_LIGHT_ID;

/**
 * Pre-registry APP_THEME_MODE values ('dark' / 'light') map onto the
 * Discord themes. Accepted forever — stored settings are never migrated.
 */
const LEGACY_THEME_ALIASES: Record<string, string> = {
  dark: DISCORD_DARK_ID,
  light: DISCORD_LIGHT_ID,
};

/**
 * Look up a descriptor by id, accepting legacy aliases. Returns
 * undefined for 'auto', unknown ids, or missing values — callers
 * decide the fallback (ThemeWrapper auto-detects, getThemeById
 * falls back to the default theme).
 */
export function findThemeDescriptor(id: string | undefined): ThemeDescriptor | undefined {
  if (!id) return undefined;
  const canonical = LEGACY_THEME_ALIASES[id] ?? id;
  return THEME_DESCRIPTORS.find((d) => d.id === canonical);
}
