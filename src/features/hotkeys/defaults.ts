import type { HotkeyActionId, HotkeyBinding, HotkeyMeta } from './types';

/**
 * The full registry of hotkey-able actions, grouped by scope so the
 * Settings tab and `?` reference modal can render section headers
 * without re-deriving order.
 *
 * Order within a group matters — the Settings tab and reference modal
 * both render rows in this order. Group order here mirrors the
 * priority workflows from the #144 design doc:
 *   1. Operation control (highest per-press value when running)
 *   2. In-channel actions (most frequent click savings)
 *   3. App-wide affordances (settings, reference, minimize, esc)
 */
export const HOTKEY_ACTIONS: HotkeyMeta[] = [
  // ─── Operation control ────────────────────────────────────────────
  {
    id: 'pauseResume',
    label: 'Pause / Resume',
    description: 'Pause or resume an in-flight purge or export.',
    scope: 'operationRunning',
    defaultKey: 'Space',
  },
  {
    id: 'cancelOp',
    label: 'Cancel operation',
    description: 'Cancel an in-flight purge or export.',
    scope: 'operationRunning',
    defaultKey: 'mod+.',
  },

  // ─── In a channel ─────────────────────────────────────────────────
  {
    id: 'openFilters',
    label: 'Open Filters',
    description: 'Search and refine messages in the current channel.',
    scope: 'serverViewWithChannel',
    defaultKey: '/',
  },
  {
    id: 'openExport',
    label: 'Open Export',
    description: 'Open the export dialog for the current channel.',
    scope: 'serverViewWithChannel',
    defaultKey: 'E',
  },
  {
    id: 'openAnalytics',
    label: 'Open Analytics',
    description: 'View analytics for the current channel.',
    scope: 'serverViewWithChannel',
    defaultKey: 'A',
  },
  {
    id: 'loadAll',
    label: 'Load All messages',
    description: 'Load every remaining message in the current channel.',
    scope: 'serverViewWithChannel',
    defaultKey: 'L',
  },
  {
    id: 'loadThread',
    label: 'Load Thread',
    description: 'Open the thread loader for the current channel.',
    scope: 'serverViewWithChannel',
    defaultKey: 'T',
  },
  {
    id: 'toggleFocus',
    label: 'Toggle focus mode',
    description: 'Hide the top bar and sidebar to maximize the message feed.',
    scope: 'serverView',
    defaultKey: 'F',
  },

  // ─── App-wide ─────────────────────────────────────────────────────
  {
    id: 'openSettings',
    label: 'Open Settings',
    description: "Open Discrub's settings.",
    scope: 'app',
    defaultKey: 'mod+,',
  },
  {
    id: 'openAppearance',
    label: 'Open Appearance',
    description: 'Open the layout and theme menu.',
    scope: 'app',
    defaultKey: 'mod+shift+L',
  },
  {
    id: 'openReference',
    label: 'Show keyboard shortcuts',
    description: 'Open the reference modal listing every shortcut.',
    scope: 'app',
    defaultKey: '?',
  },
  {
    id: 'minimize',
    label: 'Minimize to Discord',
    description: 'Collapse Discrub back to the floating tab (extension only).',
    scope: 'app',
    defaultKey: 'M',
  },
  {
    id: 'closeModalOrExitFocus',
    label: 'Close / exit',
    description: 'Close the active modal, or exit focus mode if no modal is open.',
    scope: 'app',
    defaultKey: 'Escape',
  },
];

/**
 * Quick lookup of action metadata by ID. Built once at module load;
 * downstream code uses `getHotkeyMeta(id)` rather than walking the
 * array.
 */
const META_BY_ID: Record<HotkeyActionId, HotkeyMeta> = Object.fromEntries(
  HOTKEY_ACTIONS.map((a) => [a.id, a]),
) as Record<HotkeyActionId, HotkeyMeta>;

export function getHotkeyMeta(id: HotkeyActionId): HotkeyMeta {
  return META_BY_ID[id];
}

/**
 * Default binding map. Exported separately from `HOTKEY_ACTIONS` so
 * "reset all to defaults" is a single object spread rather than an
 * array walk.
 */
export const DEFAULT_HOTKEYS: Record<HotkeyActionId, HotkeyBinding> = Object.fromEntries(
  HOTKEY_ACTIONS.map((a) => [a.id, a.defaultKey]),
) as Record<HotkeyActionId, HotkeyBinding>;

/** All known action IDs, in declaration order. */
export const ALL_HOTKEY_ACTION_IDS: HotkeyActionId[] = HOTKEY_ACTIONS.map((a) => a.id);
