import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Joyride } from 'react-joyride';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import {
  selectSettings,
  selectSidebarView,
  selectFocusedView,
  setFocusedView,
  toggleFocusedView,
} from '@features/app/appSlice';
import { fetchAnnouncement, dismissAnnouncement, selectHasNewAnnouncement, selectAnnouncementMarkdown, selectIsLoadingMarkdown, selectMarkdownError } from '@features/announcement/announcementSlice';
import { selectIsExporting, selectExportError, resetExport } from '@features/export/exportSlice';
import { selectIsPurging, selectPurgeError } from '@features/purge/purgeSlice';
import { showToast } from '@features/status/statusSlice';
import { setDiscrubCancelled, setDiscrubPaused } from '@features/app/appSlice';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import TopBar from './TopBar';
import Sidebar from '@components/navigation/Sidebar';
import ServerView from '@containers/ServerView/ServerView';
import PackageView from '@components/package/PackageView';
import AnnouncementModal from '@components/modals/AnnouncementModal';
import HotkeysReferenceModal from '@components/modals/HotkeysReferenceModal';
import { useBeforeUnloadWarning } from '@/hooks/useBeforeUnloadWarning';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { useOperationStatusBroadcast } from '@/hooks/useOperationStatusBroadcast';
import { useRestoreListener } from '@/hooks/useRestoreListener';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useTour } from '@/hooks/useTour';
import StatusPanel from '@components/ui/StatusPanel';
import Toast from '@components/ui/Toast';
import TourTooltip from '@components/welcome/TourTooltip';
import { shellTourSteps } from '@components/welcome/tourSteps';
import { HotkeyProvider, useHotkey } from '@features/hotkeys/HotkeyProvider';

/**
 * MainLayout component - main application shell
 * Contains TopBar, Sidebar, and content area.
 */
const MainLayout = () => {
  const dispatch = useAppDispatch();
  const sidebarView = useAppSelector(selectSidebarView);
  const focusedView = useAppSelector(selectFocusedView);
  const hasNewAnnouncement = useAppSelector(selectHasNewAnnouncement);
  const announcementMarkdown = useAppSelector(selectAnnouncementMarkdown);
  const isLoadingMarkdown = useAppSelector(selectIsLoadingMarkdown);
  const markdownError = useAppSelector(selectMarkdownError);
  const isExporting = useAppSelector(selectIsExporting);
  const exportError = useAppSelector(selectExportError);
  const isPurging = useAppSelector(selectIsPurging);
  const purgeError = useAppSelector(selectPurgeError);
  const isOperationRunning = useAppSelector(selectIsOperationRunning);
  const prevIsExporting = useRef(false);
  const prevIsPurging = useRef(false);
  const prevIsOperationRunning = useRef(false);

  // Detect export completion (isExporting transitions from true → false)
  useEffect(() => {
    if (prevIsExporting.current && !isExporting) {
      if (exportError === 'Export cancelled') {
        dispatch(showToast({ level: 'warning', message: 'Export cancelled' }));
      } else if (exportError) {
        dispatch(showToast({ level: 'error', message: `Export failed: ${exportError}` }));
      } else {
        dispatch(showToast({ level: 'success', message: 'Export complete' }));
      }
      dispatch(resetExport());
    }
    prevIsExporting.current = isExporting;
  }, [isExporting, exportError, dispatch]);

  // Detect purge completion (isPurging transitions from true → false)
  useEffect(() => {
    if (prevIsPurging.current && !isPurging) {
      if (purgeError) {
        dispatch(showToast({ level: 'error', message: `Purge failed: ${purgeError}` }));
      } else {
        dispatch(showToast({ level: 'success', message: 'Purge complete' }));
      }
    }
    prevIsPurging.current = isPurging;
  }, [isPurging, purgeError, dispatch]);

  // Reset pause/cancel flags when any operation completes
  useEffect(() => {
    if (prevIsOperationRunning.current && !isOperationRunning) {
      dispatch(setDiscrubCancelled(false));
      dispatch(setDiscrubPaused(false));
    }
    prevIsOperationRunning.current = isOperationRunning;
  }, [isOperationRunning, dispatch]);

  // Shell tour is user-initiated (via WelcomePanel "Take a Tour"),
  // so we DON'T mark it completed on a missing target — let the user
  // retry. All shell tour steps target global chrome (Sidebar/TopBar/
  // StatusPanel) that always renders, so a miss here is exceptional.
  const shellTour = useTour('shell', { steps: shellTourSteps });

  useBeforeUnloadWarning();
  useGlobalErrorHandler();
  useOperationStatusBroadcast();
  useRestoreListener();
  useWakeLock();

  // Wait for settings to load before checking the announcement gist —
  // otherwise the cached-rev comparison races against the IDB-backed
  // settings load and a previously-dismissed announcement can pop up
  // again on cold boot.
  const settings = useAppSelector(selectSettings);
  const announcementFetched = useRef(false);
  useEffect(() => {
    if (announcementFetched.current) return;
    if (!settings) return;
    announcementFetched.current = true;
    dispatch(fetchAnnouncement());
  }, [dispatch, settings]);

  const handleDismissAnnouncement = () => {
    dispatch(dismissAnnouncement());
  };

  // Focus-mode hotkeys go through the shared HotkeyProvider (#144).
  // The provider handles the input/textarea/contenteditable gate and
  // the master toggle; we only supply the per-action availability flag
  // and the callback. Same observable behavior as the previous
  // bespoke listener.
  useHotkey(
    'toggleFocus',
    () => dispatch(toggleFocusedView()),
    sidebarView === 'server',
  );
  useHotkey(
    'closeModalOrExitFocus',
    () => {
      // Defer to MUI Dialog's own Esc-to-close when a dialog is open;
      // we only fire the focus-exit branch when no modal is consuming
      // the keystroke. The DOM query is a v1 pragmatic check; future
      // cleanup could route through a Redux dialog-open registry.
      if (document.querySelector('[role="dialog"]')) return;
      dispatch(setFocusedView(false));
    },
    focusedView,
  );

  // `?` toggles the keyboard-shortcuts reference modal. Pressing
  // `?` again while it's open closes it (matching the F-toggle
  // pattern across the rest of the hotkey set). Esc also closes via
  // MUI Dialog's built-in handler.
  const [hotkeysRefOpen, setHotkeysRefOpen] = useState(false);
  useHotkey('openReference', () => setHotkeysRefOpen((open) => !open), true);

  // Leaving server view (e.g. switching to package view) should not
  // leave focus mode "stuck on" with hidden chrome that can't be
  // exited via the feed toolbar.
  useEffect(() => {
    if (sidebarView !== 'server' && focusedView) {
      dispatch(setFocusedView(false));
    }
  }, [sidebarView, focusedView, dispatch]);

  return (
    <Box sx={{ height: '100%', width: '100%', position: 'relative' }}>
      <Joyride
        steps={shellTourSteps}
        run={shellTour.running}
        stepIndex={shellTour.stepIndex}
        onEvent={shellTour.handleEvent}
        continuous
        scrollToFirstStep
        tooltipComponent={TourTooltip}
        options={{
          // User escape hatch: clicking the overlay closes the tour.
          // Previously `false` (clicks ignored) — if Joyride ever got
          // stuck with an orphan overlay, users had no way out without
          // opening DevTools. Default Joyride behavior is 'close'; we
          // restore that explicitly.
          overlayClickAction: 'close',
          blockTargetInteraction: true,
          overlayColor: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          skipBeacon: true,
        }}
      />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
        }}
      >
        {!focusedView && <TopBar />}

        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          {!focusedView && <Sidebar />}

          <Box
            sx={{
              flexGrow: 1,
              overflow: 'auto',
              backgroundColor: 'background.default',
            }}
          >
            {sidebarView === 'package' ? (
              <PackageView />
            ) : (
              <ServerView onStartShellTour={shellTour.start} />
            )}
          </Box>
        </Box>

        {!focusedView && <StatusPanel />}
      </Box>

      <AnnouncementModal
        open={hasNewAnnouncement}
        onDismiss={handleDismissAnnouncement}
        markdown={announcementMarkdown}
        isLoading={isLoadingMarkdown}
        error={markdownError}
      />

      <HotkeysReferenceModal
        open={hotkeysRefOpen}
        onClose={() => setHotkeysRefOpen(false)}
      />

      <Toast />
    </Box>
  );
};

/**
 * Public export wraps the inner content in `HotkeyProvider` so every
 * descendant can call `useHotkey`. The provider must be inside the
 * Redux <Provider> (mounted by main.tsx), which is why we don't lift
 * it any higher.
 */
const MainLayoutWithHotkeys = () => (
  <HotkeyProvider>
    <MainLayout />
  </HotkeyProvider>
);

export default MainLayoutWithHotkeys;
