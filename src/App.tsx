import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useAppSelector, useAppDispatch } from './app/hooks';
import { selectIsAuthenticated, selectAuthToken, hydrateRememberedToken } from '@features/auth/authSlice';
import { loadSettings } from '@features/app/appSlice';
import { loadCacheFromLocalStorage } from '@features/cache/cacheSlice';
import { loadPresets } from '@features/presets/presetsSlice';
import { loadRecentExports } from '@features/history/historySlice';
import { loadStatusLog } from '@features/status/statusSlice';
import { loadHotkeys } from '@features/hotkeys/hotkeysSlice';
import { initializeSupporter } from '@features/supporter/supporterSlice';
import { loadSeasonalNotice } from '@features/appearance/noticeSlice';
import { requestPersistentStorage } from '@/utils/persistentStorage';
import { sweepStagedDownloads } from 'drip-fs';
import { isOverlayMode } from '@/extension/messaging';
import { useLanguageSync } from '@/i18n/useLanguageSync';
import LandingPage from '@containers/LandingPage/LandingPage';
import MainLayout from '@containers/MainLayout/MainLayout';

/** Check if this is an auth-only flow (launcher requested auth before version selection) */
const isAuthOnly = new URLSearchParams(window.location.search).get('authOnly') === 'true';

/**
 * Root application component
 * Routes between landing page (authentication) and main layout based on auth state
 */
function App() {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const token = useAppSelector(selectAuthToken);
  useLanguageSync();

  // Load every persisted slice on app startup. loadSettings runs the
  // unified storage migration first; the other thunks are idempotent
  // and read from per-purpose IDB databases that the migration may
  // have just populated. Ref prevents strict-mode double-fire.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // Fire-and-forget: upgrade the origin to persistent storage so the
    // per-purpose IDB databases can't be evicted under disk pressure.
    void requestPersistentStorage();
    // Staged download parts left by an earlier session (iOS OPFS path); no-op elsewhere.
    void sweepStagedDownloads();
    dispatch(loadSettings()).then(() => {
      dispatch(loadCacheFromLocalStorage());
      dispatch(loadPresets());
      dispatch(loadRecentExports());
      dispatch(loadStatusLog());
      dispatch(loadHotkeys());
      dispatch(loadSeasonalNotice());
      // Verifies any stored supporter key locally and, for monthly
      // keys near expiry with a stored email, silently refreshes it
      // (at most one attempt per app-open).
      // #249: restore an opt-in remembered token once the supporter key
      // is known, so the hosted gate still applies to the restore.
      dispatch(initializeSupporter()).then(() => {
        dispatch(hydrateRememberedToken());
      });
    });
  }, [dispatch]);

  // Auth-only flow: after auth, send token back to launcher via parent and stop
  const authOnlySent = useRef(false);
  useEffect(() => {
    if (isAuthOnly && isAuthenticated && token && !authOnlySent.current && isOverlayMode()) {
      authOnlySent.current = true;
      window.parent.postMessage({ type: 'discrub:authenticated', token }, '*');
    }
  }, [isAuthenticated, token]);

  // In auth-only mode, show landing page until auth completes, then show a brief "redirecting" state
  if (isAuthOnly) {
    return (
      <Box sx={{ height: '100%', width: '100%' }}>
        {!isAuthenticated ? <LandingPage /> : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
            Redirecting to launcher...
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', width: '100%' }}>
      {!isAuthenticated ? <LandingPage /> : <MainLayout />}
    </Box>
  );
}

export default App;
