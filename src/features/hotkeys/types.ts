/**
 * Hotkey system type definitions (#144).
 *
 * Bindings are stored as flat strings ("F", "Space", "/", "mod+,") so
 * persistence and migration stay simple. The literal "mod" segment
 * resolves to Cmd on Mac and Ctrl on every other platform at runtime;
 * the display layer translates it back to the right symbol per OS.
 *
 * Scope and predicate gates live separately from the binding string —
 * the binding is what the user customizes, the scope/predicate are
 * compile-time facts about each action that the user can't change.
 */

/** Compile-time list of areas an action can apply to. */
export type HotkeyScope =
  | 'app'
  | 'serverView'
  | 'serverViewWithChannel'
  | 'packageView'
  | 'operationRunning'
  | 'anyModalOpen';

/**
 * Stable IDs for every hotkey-able action. Used as the key in the
 * persisted bindings map, in tooltip lookups, and as the ID surfaced
 * in the Settings tab and reference modal.
 */
export type HotkeyActionId =
  | 'toggleFocus'
  | 'closeModalOrExitFocus'
  | 'openFilters'
  | 'openReference'
  | 'openExport'
  | 'openAnalytics'
  | 'loadAll'
  | 'loadThread'
  | 'pauseResume'
  | 'cancelOp'
  | 'openSettings'
  | 'openAppearance'
  | 'minimize';

/**
 * The literal binding string. Examples: "F", "Space", "/", "mod+,",
 * "mod+.", "Escape". The "mod" prefix means Cmd on Mac / Ctrl elsewhere.
 */
export type HotkeyBinding = string;

/**
 * Per-action metadata that doesn't change across user sessions. Lives
 * in `defaults.ts`; the user customizes only the binding key, not the
 * label / description / scope.
 */
export interface HotkeyMeta {
  id: HotkeyActionId;
  /** User-facing label, matches the corresponding button copy. */
  label: string;
  /** One-line "what does this do?" shown in tooltips and Settings rows. */
  description: string;
  /** Compile-time scope; both this and the predicate must pass at fire time. */
  scope: HotkeyScope;
  /** Default binding string; what `Reset` reverts to. */
  defaultKey: HotkeyBinding;
}

/**
 * Slice state. `enabled` is the master toggle; when false the provider
 * short-circuits and no registered hotkey fires (system Esc / Tab still
 * work because we never registered them). `bindings` is the live map of
 * action ID to binding string.
 */
export interface HotkeysState {
  enabled: boolean;
  bindings: Record<HotkeyActionId, HotkeyBinding>;
}
