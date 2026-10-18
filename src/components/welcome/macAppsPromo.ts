/**
 * Seen and hidden flags for the For Mac section of the Apps menu
 * (mac-apps-promo, 2.2.6). A tiny external store, so the dot on the button
 * and the section in the popover read the same state without a slice.
 *
 * `apps:macSeen` is written the first time the popover opens on a Mac and
 * clears the dot. `apps:macHidden` is written by the Hide link and drops the
 * section and the dot for good. Both live in Discrub-state like the other
 * seen markers.
 */
import { useSyncExternalStore } from 'react';
import { storage } from '@/extension/storage';
import { isMacOS } from '@/utils/platform';

export const MAC_APPS_SEEN_KEY = 'apps:macSeen';
export const MAC_APPS_HIDDEN_KEY = 'apps:macHidden';

export interface MacAppsPromoState {
  /** Flags read from storage. Until then nothing is shown, so a hidden section never flashes. */
  loaded: boolean;
  seen: boolean;
  hidden: boolean;
  mac: boolean;
}

let state: MacAppsPromoState = { loaded: false, seen: false, hidden: false, mac: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<MacAppsPromoState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Read the flags once; later calls answer the same promise. */
export function loadMacAppsPromo(): Promise<void> {
  if (!loading) {
    loading = Promise.all([storage.state.get<boolean>(MAC_APPS_SEEN_KEY), storage.state.get<boolean>(MAC_APPS_HIDDEN_KEY)])
      .then(([seen, hidden]) => set({ loaded: true, seen: Boolean(seen), hidden: Boolean(hidden), mac: isMacOS() }))
      .catch(() => set({ loaded: true, mac: isMacOS() }));
  }
  return loading;
}

export function markMacAppsSeen(): void {
  if (state.seen) return;
  set({ seen: true });
  void storage.state.set(MAC_APPS_SEEN_KEY, true).catch(() => undefined);
}

export function hideMacApps(): void {
  set({ hidden: true, seen: true });
  void storage.state.set(MAC_APPS_HIDDEN_KEY, true).catch(() => undefined);
}

/** Tests only. */
export function resetMacAppsPromo(): void {
  state = { loaded: false, seen: false, hidden: false, mac: false };
  loading = null;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

/** The section shows on a Mac once loaded and not hidden; the dot until it has been seen. */
export function useMacAppsPromo(): { showSection: boolean; showDot: boolean } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!s.loaded) void loadMacAppsPromo();
  const showSection = s.loaded && s.mac && !s.hidden;
  return { showSection, showDot: showSection && !s.seen };
}
