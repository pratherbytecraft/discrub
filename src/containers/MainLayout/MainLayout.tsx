import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { Joyride } from 'react-joyride';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import {
  selectSetting,
  selectSettings,
  selectFocusedView,
  selectSidebarView,
  setFocusedView,
  toggleFocusedView,
} from '@features/app/appSlice';
import {
  fetchAnnouncement,
  dismissAnnouncement,
  fetchAnnouncementArchiveThunk,
  selectArchiveVersion,
  selectHasNewAnnouncement,
  selectAnnouncementMarkdown,
  selectIsLoadingMarkdown,
  selectMarkdownError,
  selectAnnouncementArchive,
  selectIsLoadingArchive,
  selectArchiveError,
  selectSelectedArchiveVersion,
} from '@features/announcement/announcementSlice';
import { selectIsExporting, selectExportError, resetExport } from '@features/export/exportSlice';
import { selectIsPurging, selectPurgeError, selectPurgeChannelErrorCount } from '@features/purge/purgeSlice';
import { showToast } from '@features/status/statusSlice';
import {
  setDiscrubCancelled,
  setDiscrubPaused,
  setRateLimitStopped,
  selectRateLimitStopped,
  setRequestsRefusedStopped,
  selectRequestsRefusedStopped,
  selectSuggestedLanguage,
  setSuggestedLanguage,
} from '@features/app/appSlice';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import AnnouncementModal from '@components/modals/AnnouncementModal';
import HotkeysReferenceModal from '@components/modals/HotkeysReferenceModal';
import { useBeforeUnloadWarning } from '@/hooks/useBeforeUnloadWarning';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { useOperationStatusBroadcast } from '@/hooks/useOperationStatusBroadcast';
import { useRestoreListener } from '@/hooks/useRestoreListener';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useOperationThrottleOptOut } from '@/hooks/useOperationThrottleOptOut';
import { useRestBreaks } from '@/hooks/useRestBreaks';
import { useTour } from '@/hooks/useTour';
import Toast from '@components/ui/Toast';
import TourTooltip from '@components/welcome/TourTooltip';
import { buildShellTourSteps } from '@components/welcome/tourSteps';
import { HotkeyProvider, useHotkey } from '@features/hotkeys/HotkeyProvider';
import { resolveShell } from '@/layouts/registry';
import { useTranslation } from 'react-i18next';

/**
 * MainLayout component - main application shell
 * Contains TopBar, Sidebar, content area, and DonationDrawer
 */
const MainLayout = () => {
  const dispatch = useAppDispatch();
  const showFeed = useAppSelector(selectSetting(DiscrubSetting.APP_SHOW_KOFI_FEED));
  const sidebarView = useAppSelector(selectSidebarView);
  const focusedView = useAppSelector(selectFocusedView);
  // The layout setting (APP_LAYOUT, core 1.0.13) picks the shell once it lands; Classic until then.
  const Shell = resolveShell('classic');
  const theme = useTheme();
  // Below `md` the Sidebar becomes a temporary drawer opened from the
  // TopBar hamburger, and the Ko-fi feed overlays instead of reserving
  // a 320px column (2.1.0 mobile pass).
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedDm = useAppSelector(selectSelectedDm);
  const selectedChannelId = selectedChannel?.id ?? null;
  const selectedDmId = selectedDm?.id ?? null;
  // Picking a channel or DM is the end of a navigation; on phones the
  // drawer closes so the feed is visible. No-op on desktop (prop ignored).
  useEffect(() => {
    setSidebarOpen(false);
  }, [selectedChannelId, selectedDmId]);
  const drawerOpen = showFeed === 'true' && !focusedView && !isMobile;
  const hasNewAnnouncement = useAppSelector(selectHasNewAnnouncement);
  const announcementMarkdown = useAppSelector(selectAnnouncementMarkdown);
  const isLoadingMarkdown = useAppSelector(selectIsLoadingMarkdown);
  const markdownError = useAppSelector(selectMarkdownError);
  const isExporting = useAppSelector(selectIsExporting);
  const exportError = useAppSelector(selectExportError);
  const isPurging = useAppSelector(selectIsPurging);
  const purgeError = useAppSelector(selectPurgeError);
  const purgeChannelErrorCount = useAppSelector(selectPurgeChannelErrorCount);
  const isOperationRunning = useAppSelector(selectIsOperationRunning);
  const rateLimitStopped = useAppSelector(selectRateLimitStopped);
  const requestsRefusedStopped = useAppSelector(selectRequestsRefusedStopped);
  const suggestedLanguage = useAppSelector(selectSuggestedLanguage);
  const { t } = useTranslation();
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
      } else if (purgeChannelErrorCount > 0) {
        // #250: a run where a channel errored is not a clean success even
        // though the thunk fulfilled; the details are in the status log.
        dispatch(showToast({
          level: 'warning',
          message: `Purge finished, but ${purgeChannelErrorCount} ${purgeChannelErrorCount === 1 ? 'channel' : 'channels'} had errors (see the status log)`,
        }));
      } else {
        dispatch(showToast({ level: 'success', message: 'Purge complete' }));
      }
    }
    prevIsPurging.current = isPurging;
  }, [isPurging, purgeError, purgeChannelErrorCount, dispatch]);

  // Reset pause/cancel flags when any operation completes. Runs after the
  // per-operation completion effects above, so when the run was stopped
  // by a rate-limit storm (#254) this toast is the one the user keeps.
  useEffect(() => {
    if (prevIsOperationRunning.current && !isOperationRunning) {
      dispatch(setDiscrubCancelled(false));
      dispatch(setDiscrubPaused(false));
      if (rateLimitStopped) {
        dispatch(setRateLimitStopped(false));
        dispatch(showToast({ level: 'error', message: t('rateLimit.toast'), duration: 15000 }));
      }
      if (requestsRefusedStopped) {
        dispatch(setRequestsRefusedStopped(false));
        dispatch(showToast({ level: 'error', message: t('requestsRefused.toast'), duration: 15000 }));
      }
    }
    prevIsOperationRunning.current = isOperationRunning;
  }, [isOperationRunning, rateLimitStopped, requestsRefusedStopped, dispatch, t]);

  // #124: existing install whose browser prefers a supported language.
  // One toast, in that language, offering the switch; the setting was
  // already pinned to English so this never repeats.
  useEffect(() => {
    if (!suggestedLanguage) return;
    dispatch(setSuggestedLanguage(null));
    dispatch(
      showToast({
        level: 'info',
        message: t('language.suggestionToast', { lng: suggestedLanguage }),
        duration: 15000,
        action: {
          type: 'switchLanguage',
          language: suggestedLanguage,
          label: t('language.suggestionAction', { lng: suggestedLanguage }),
        },
      }),
    );
  }, [suggestedLanguage, dispatch, t]);

  // Shell tour is user-initiated (via WelcomePanel "Take a Tour"),
  // so we DON'T mark it completed on a missing target — let the user
  // retry. All shell tour steps target global chrome (Sidebar/TopBar/
  // StatusPanel) that always renders, so a miss here is exceptional.
  const shellTourSteps = useMemo(() => buildShellTourSteps(t), [t]);
  const shellTour = useTour('shell', { steps: shellTourSteps });

  useBeforeUnloadWarning();
  useGlobalErrorHandler();
  useOperationStatusBroadcast();
  useRestoreListener();
  useWakeLock();
  useOperationThrottleOptOut();
  useRestBreaks();

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

  const announcementArchive = useAppSelector(selectAnnouncementArchive);
  const isLoadingArchive = useAppSelector(selectIsLoadingArchive);
  const archiveError = useAppSelector(selectArchiveError);
  const selectedArchiveVersion = useAppSelector(selectSelectedArchiveVersion);

  // The dialog's version rail needs the archive whenever it opens (auto-show
  // or View Announcement). Cached in the slice, so this is one request per session.
  useEffect(() => {
    if (hasNewAnnouncement) dispatch(fetchAnnouncementArchiveThunk());
  }, [hasNewAnnouncement, dispatch]);

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
      <Shell
        focusedView={focusedView}
        sidebarOpen={sidebarOpen}
        onSidebarOpen={() => setSidebarOpen(true)}
        onSidebarClose={() => setSidebarOpen(false)}
        drawerOpen={drawerOpen}
        onStartShellTour={shellTour.start}
      />

      <AnnouncementModal
        open={hasNewAnnouncement}
        onDismiss={handleDismissAnnouncement}
        markdown={announcementMarkdown}
        isLoading={isLoadingMarkdown}
        error={markdownError}
        archive={announcementArchive}
        isLoadingArchive={isLoadingArchive}
        archiveError={archiveError}
        selectedVersion={selectedArchiveVersion}
        onSelectVersion={(version) => dispatch(selectArchiveVersion(version))}
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
