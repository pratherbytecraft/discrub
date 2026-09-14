import type { AppSettings } from 'discrub-core/types/discrub-types';

/**
 * Types for app feature
 */

export interface AppTask {
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  message: string;
}

export type SidebarView = 'server' | 'package';

/**
 * The feed dialogs whose open state lives in the store (2.2.0 layouts,
 * foundation). Held here rather than in ServerView useState so a layout
 * swap that remounts the feed keeps an open dialog open.
 */
export type FeedDialog = 'filters' | 'export' | 'forumExport' | 'loadAll' | 'threadLoad' | 'analytics';
export type FeedDialogs = Record<FeedDialog, boolean>;
/**
 * Why a running operation is holding, beyond the user's own pause (2.2.0
 * item 2). Rest breaks keep their end time in `restBreakUntil`; this covers
 * the two retry holds so every layout can name the state, the wait and the
 * attempt. Cleared on resume, on success and on resetTask. Never persisted.
 */
export type OperationHold =
  | { kind: 'retryWait'; until: number; attempt: number; max: number; answer: string }
  | { kind: 'retryExhausted'; answer: string; loaded: number };

export interface FeedScrollAnchor {
  /** `<conversation id>:<thread tab id or main>`. */
  key: string;
  messageId: string;
}
export const closedFeedDialogs: FeedDialogs = {
  filters: false, export: false, forumExport: false, loadAll: false, threadLoad: false, analytics: false,
};

export interface AppState {
  discrubPaused: boolean;
  discrubCancelled: boolean;
  /**
   * #254 — set by the rate-limit storm hook when discrub-core gives up on
   * a request; the current operation was cancelled for that reason.
   * MainLayout turns it into the completion toast and clears it.
   */
  rateLimitStopped?: boolean;
  /**
   * Set by the network-failure streak hook when discrub-core saw several
   * thrown fetches in a row while the browser was online: Discord (or its
   * edge) is refusing this account's requests. The operation was cancelled
   * for that reason; MainLayout turns it into the completion toast.
   */
  requestsRefusedStopped?: boolean;
  /**
   * Wall-clock ms at which the current automatic rest break ends
   * (`useRestBreaks`). Null when the pause, if any, is the user's own.
   */
  restBreakUntil?: number | null;
  isMinimized: boolean;
  focusedView: boolean;
  /** Mobile-only (< md): Ko-fi feed shown as a temporary overlay. Never persisted. */
  kofiOverlayOpen: boolean;
  sidebarView: SidebarView;
  /**
   * Open state of the feed dialogs. Never persisted. Optional like the
   * other transient flags so hand built test states stay valid; the
   * selectors and reducers treat a missing record as all closed.
   */
  dialogs?: FeedDialogs;
  /**
   * First visible message of the feed the last time it unmounted, keyed by
   * conversation and tab, so a layout swap or a Focus toggle that remounts
   * the feed lands back on the same message. Transient, never persisted.
   */
  feedScrollAnchor?: FeedScrollAnchor | null;
  operationHold?: OperationHold | null;
  task: AppTask;
  settings: AppSettings | null;
  /**
   * Transient theme override for the Settings theme picker's live
   * preview. Never persisted — ThemeWrapper renders it over the saved
   * APP_THEME_MODE while set; clearing (null) falls back to the setting.
   */
  previewThemeId: string | null;
  /**
   * #124 — set once by loadSettings when an existing install has no saved
   * language and the browser prefers a supported non-English one. MainLayout
   * turns it into a one-time toast offering the switch, then clears it.
   */
  suggestedLanguage?: string | null;
}

export const initialAppState: AppState = {
  discrubPaused: false,
  discrubCancelled: false,
  rateLimitStopped: false,
  requestsRefusedStopped: false,
  restBreakUntil: null,
  isMinimized: false,
  focusedView: false,
  kofiOverlayOpen: false,
  sidebarView: 'server',
  dialogs: { ...closedFeedDialogs },
  feedScrollAnchor: null,
  operationHold: null,
  task: {
    status: 'idle',
    message: '',
  },
  settings: null,
  previewThemeId: null,
  suggestedLanguage: null,
};
