/**
 * Types for status log feature
 */

export type StatusLevel = 'info' | 'warning' | 'error' | 'success' | 'session';

export interface StatusLogEntry {
  id: string;
  timestamp: number;
  level: StatusLevel;
  message: string;
  /**
   * Per-page-load identifier. Stamped at dispatch time so the panel can
   * group entries by session. Optional because entries persisted before
   * the field existed (#126) won't have it; treat as a "legacy" group.
   */
  sessionId?: string;
}

export interface OperationTip {
  isVisible: boolean;
  message: string;
}

/** #124 one-time offer to switch the UI language. */
export type ToastAction = { type: 'switchLanguage'; language: string; label: string };

export interface ToastNotification {
  isVisible: boolean;
  level: StatusLevel;
  message: string;
  duration: number;
  action?: ToastAction;
}

export interface StatusState {
  entries: StatusLogEntry[];
  maxEntries: number;
  operationTip: OperationTip;
  toast: ToastNotification;
}

export const initialStatusState: StatusState = {
  entries: [],
  maxEntries: 2000,
  operationTip: {
    isVisible: false,
    message: '',
  },
  toast: {
    isVisible: false,
    level: 'info',
    message: '',
    duration: 3000,
  },
};
