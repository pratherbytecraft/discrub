import type { Middleware } from '@reduxjs/toolkit';

/**
 * The live preview gate (2.2.0). While the Appearance menu is previewing a
 * locked layout or theme, the shell is inert and hotkeys are off, but both
 * of those live in the DOM and a determined person can strip them in dev
 * tools. This middleware is the part they cannot strip: every thunk
 * dispatched while `app.preview` is set is dropped before it runs, except
 * the few background ones marked with `previewSafe`. Nothing that fetches,
 * exports, purges, edits or imports can start during a preview, so a
 * preview of a locked layout or theme is worth nothing beyond the look.
 *
 * A preview cannot start while an operation is running (the menu checks
 * `selectIsOperationRunning`), so a running purge or export is never cut
 * off mid-flight by this gate.
 */
const PREVIEW_SAFE = Symbol.for('discrub.previewSafe');

interface PreviewState { app?: { preview?: { layout?: unknown; theme?: unknown } | null } }

export const isPreviewingState = (state: unknown): boolean => {
  const p = (state as PreviewState)?.app?.preview;
  return !!p && (p.layout != null || p.theme != null);
};

/** The value dispatch returns for a dropped thunk: awaitable, and unwrap rejects. */
export const blockedThunkResult = () => {
  const error = new Error('Blocked while previewing a layout or theme');
  error.name = 'PreviewBlocked';
  return Object.assign(Promise.resolve({ type: 'app/previewBlocked' }), {
    unwrap: () => Promise.reject(error),
    abort: () => undefined,
    requestId: '',
    arg: undefined,
  });
};

export const previewGuardMiddleware: Middleware = (storeAPI) => (next) => (action) => {
  if (typeof action === 'function' && !(action as unknown as Record<symbol, boolean>)[PREVIEW_SAFE] && isPreviewingState(storeAPI.getState())) {
    return blockedThunkResult();
  }
  return next(action);
};

/**
 * Marks a thunk action creator as allowed during a preview. Only for
 * background work that does no Discord I/O the user could benefit from:
 * settings writes, cache saves, key refresh, status log loads.
 */
export const previewSafe = <C extends (...args: never[]) => unknown>(creator: C): C => {
  const wrapped = ((...args: Parameters<C>) => {
    const thunk = creator(...args);
    if (typeof thunk === 'function') (thunk as unknown as Record<symbol, boolean>)[PREVIEW_SAFE] = true;
    return thunk;
  }) as unknown as C;
  return Object.assign(wrapped, creator);
};
