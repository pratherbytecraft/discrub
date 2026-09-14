import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import { selectHotkeyBindings, selectHotkeysEnabled } from './hotkeysSlice';
import { selectIsPreviewing } from '@features/app/appSlice';
import { eventToBinding } from './keyMatcher';
import type { HotkeyActionId, HotkeyBinding } from './types';

/**
 * Hotkey-system context (#144 phase 2).
 *
 * The provider maintains a single document-level keydown listener and
 * a registry of action-ID → callback. Components opt in via the
 * `useHotkey` hook; the provider invokes the matching callback when
 * the user presses the bound key, gated on:
 *
 *   1. Master toggle (`hotkeys.enabled`)
 *   2. Focus is not on an input / textarea / contenteditable
 *   3. The hotkey binding maps to a registered action
 *   4. The component-supplied `enabled` flag is true
 *
 * Components own the per-action availability check via the `enabled`
 * flag — same condition that drives the corresponding button.disabled.
 * Single source of truth, no duplication of "is this action available
 * right now?" logic between the button and the hotkey.
 */

type HotkeyHandler = () => void;

interface HotkeyRegistration {
  callback: HotkeyHandler;
  enabled: boolean;
}

interface HotkeyContextValue {
  /**
   * Register a hotkey handler. Returns an unsubscribe function.
   * Used internally by `useHotkey`; not part of the public surface.
   */
  register: (
    actionId: HotkeyActionId,
    callback: HotkeyHandler,
    enabled: boolean,
  ) => () => void;
}

const noop = () => {};
const HotkeyContext = createContext<HotkeyContextValue>({
  register: () => noop,
});

interface HotkeyProviderProps {
  children: React.ReactNode;
}

export const HotkeyProvider = ({ children }: HotkeyProviderProps) => {
  // Hotkeys are off during a live preview (2.2.0): the shell is inert, and a key must not reach past it.
  const previewing = useAppSelector(selectIsPreviewing);
  const enabled = useAppSelector(selectHotkeysEnabled) && !previewing;
  const bindings = useAppSelector(selectHotkeyBindings);

  // Mutable map keeps registrations stable across renders; replacing
  // the whole map on every register would re-run the listener effect
  // unnecessarily and could drop in-flight registrations.
  const registrationsRef = useRef(new Map<HotkeyActionId, HotkeyRegistration>());

  const register = useCallback<HotkeyContextValue['register']>(
    (actionId, callback, enabledFlag) => {
      registrationsRef.current.set(actionId, { callback, enabled: enabledFlag });
      // Return an unsubscribe scoped to *this* registration so a
      // re-registration of the same actionId (different callback or
      // different enabled flag) doesn't have its later state torn
      // down when the earlier effect cleans up.
      const ourCallback = callback;
      return () => {
        const current = registrationsRef.current.get(actionId);
        if (current && current.callback === ourCallback) {
          registrationsRef.current.delete(actionId);
        }
      };
    },
    [],
  );

  // Reverse-index from binding string → actionId. Recomputed when
  // bindings change (settings tab rebind, reset-all, etc.).
  const bindingToAction = useMemo(() => {
    const map = new Map<HotkeyBinding, HotkeyActionId>();
    for (const [id, key] of Object.entries(bindings) as [HotkeyActionId, HotkeyBinding][]) {
      if (key) map.set(key, id);
    }
    return map;
  }, [bindings]);

  useEffect(() => {
    if (!enabled) return undefined;

    const listener = (e: KeyboardEvent) => {
      // Don't intercept keys typed into form fields. Mirrors the
      // existing focus-mode handler's gate — pasting / typing should
      // never accidentally trigger a hotkey. We check both the
      // standard `isContentEditable` property AND the attribute,
      // because jsdom (and older Safari) don't always reflect the
      // attribute through to the property — using only the property
      // would let "f" inside a Trix-style contenteditable trip the
      // focus toggle.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const ceAttr = target?.getAttribute?.('contenteditable');
      const isCE =
        target?.isContentEditable ||
        ceAttr === '' ||
        ceAttr === 'true' ||
        ceAttr === 'plaintext-only';
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        isCE
      ) {
        return;
      }

      // Respect any handler that already consumed the event (e.g. a
      // MUI Dialog's Esc-to-close). Without this, our smart-stack Esc
      // would fire on top of MUI's, double-handling.
      if (e.defaultPrevented) return;

      const binding = eventToBinding(e);
      if (!binding) return;

      const actionId = bindingToAction.get(binding);
      if (!actionId) return;

      const reg = registrationsRef.current.get(actionId);
      if (!reg || !reg.enabled) return;

      e.preventDefault();
      reg.callback();
    };

    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [enabled, bindingToAction]);

  const value = useMemo(() => ({ register }), [register]);
  return <HotkeyContext.Provider value={value}>{children}</HotkeyContext.Provider>;
};

/**
 * Register a hotkey handler scoped to the calling component's lifetime.
 *
 * `enabled` is the per-action availability gate — typically the same
 * boolean expression that drives the corresponding button.disabled.
 * When false, the hotkey is a no-op and the keystroke falls through
 * to the browser (so `/` in a non-bound state still types `/`).
 *
 * Multiple components can register the same actionId, but only the
 * most-recent registration wins. This matters when components mount
 * conditionally (a modal registers its own Esc handler while open;
 * unmounting restores the underlying registration).
 */
export function useHotkey(
  actionId: HotkeyActionId,
  callback: HotkeyHandler,
  enabled = true,
): void {
  const { register } = useContext(HotkeyContext);
  // Capture latest callback in a ref so the registration doesn't
  // churn every render — the unsubscribe/resubscribe cycle could
  // race with rapid state updates.
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return register(actionId, () => callbackRef.current(), enabled);
  }, [actionId, register, enabled]);
}
