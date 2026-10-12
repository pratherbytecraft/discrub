/**
 * Types for authentication feature
 */

export interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  manuallyLoggedOut: boolean;
  /** True while a remembered token (#249) is being restored on boot. */
  isRestoring: boolean;
  /** Whether a token is currently persisted on this device (#249). */
  tokenRemembered: boolean;
  /**
   * #275: browsing a data package without signing in. The main layout
   * shows with only the Package view; signing in turns it off.
   */
  guestMode: boolean;
}

export const initialAuthState: AuthState = {
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  manuallyLoggedOut: false,
  isRestoring: false,
  tokenRemembered: false,
  guestMode: false,
};

/**
 * `Discrub-state` key holding the opt-in remembered Discord token (#249).
 * Plaintext at rest by design: obfuscation adds nothing against anyone
 * who can read the origin's IndexedDB, and the UI says so honestly.
 */
export const REMEMBERED_TOKEN_STORAGE_KEY = 'auth:rememberedToken';

/** Shown when a remembered token no longer authenticates and gets dropped. */
export const REMEMBERED_TOKEN_EXPIRED_MESSAGE =
  'Your saved token no longer works and has been removed. Log in again.';
