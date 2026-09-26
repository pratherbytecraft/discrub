import { memo } from 'react';
import { Box } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import TopBar from '@containers/MainLayout/TopBar';
import ThemeAccentStrip from '@/theme/ThemeAccentStrip';
import Sidebar from '@components/navigation/Sidebar';
import { SIDEBAR_WIDTH } from '@components/navigation/sidebarConstants';
import ServerView from '@containers/ServerView/ServerView';
import PackageView from '@components/package/PackageView';
import DonationDrawer, { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import StatusPanel from '@components/ui/StatusPanel';
import FloatingPauseControl from '@components/ui/FloatingPauseControl';
import FocusPill from '@components/ui/FocusPill';
import { useMediaQuery, useTheme } from '@mui/material';
import type { ShellProps } from '../types';
import { perfCount } from '@/utils/perfCounters';
import { PerfProfiler } from '@/utils/PerfProfiler';

/**
 * Classic layout: the 2.1 frame as is. Top bar, accent strip, sidebar,
 * ServerView or PackageView, status panel at the bottom, donation drawer
 * on the right. Focus hides everything but the content and floats the
 * pause control over it.
 *
 * MainLayout owns the app-wide hooks, the tour, the modals and the toast;
 * a shell owns only the frame. Every layout added in 2.2.0 implements the
 * same ShellProps.
 */
const ClassicShell = ({ focusedView, sidebarOpen, onSidebarOpen, onSidebarClose, drawerOpen, onStartShellTour }: ShellProps) => {
  perfCount('ClassicShell');
  const sidebarView = useAppSelector(selectSidebarView);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          // dvh tracks the visible viewport on phones (iOS URL bar), so the
          // StatusPanel stays pinned to the bottom edge instead of below the fold.
          height: '100vh',
          '@supports (height: 100dvh)': { height: '100dvh' },
          marginRight: drawerOpen ? `${DRAWER_WIDTH}px` : 0,
          transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        {/* Focus hides navigation, side panels and the dock; the top bar stays so Appearance and the user chip never vanish (2.2.0, A2). */}
        <PerfProfiler id="TopBar"><TopBar onMenuClick={onSidebarOpen} /></PerfProfiler>
        <PerfProfiler id="ThemeAccentStrip"><ThemeAccentStrip /></PerfProfiler>

        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          {!focusedView && <PerfProfiler id="Sidebar"><Sidebar open={sidebarOpen} onClose={onSidebarClose} /></PerfProfiler>}

          {/* The status log lives in the content column, so the closed bar and the open sheet span the same width and the sidebar runs to the bottom edge. */}
          <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
            <Box
              sx={{
                flexGrow: 1,
                overflow: 'auto',
                backgroundColor: 'background.default',
              }}
            >
              {sidebarView === 'package' ? (
                <PerfProfiler id="PackageView"><PackageView /></PerfProfiler>
              ) : (
                <PerfProfiler id="ServerView"><ServerView onStartShellTour={onStartShellTour} /></PerfProfiler>
              )}
            </Box>
            {/* The open sheet is fixed to the window, so it takes the wall's width as its right inset while the wall is open (2.2.1). */}
            {!focusedView && <PerfProfiler id="StatusPanel"><StatusPanel sheetInset={isMobile ? 0 : SIDEBAR_WIDTH} sheetRightInset={drawerOpen ? DRAWER_WIDTH : 0} /></PerfProfiler>}
          </Box>
        </Box>
      </Box>

      {!focusedView && <PerfProfiler id="DonationDrawer"><DonationDrawer /></PerfProfiler>}

      {/* Focused view hides the StatusPanel (the only other
          PauseResumeControls mount), so float a compact pill above the
          feed to keep pause/resume/cancel — and the Space/mod+.
          hotkeys registered inside it — reachable during heavy
          operations (#237). Mutually exclusive with the StatusPanel
          mount above; the component self-nulls when no heavy op is
          running. */}
      {focusedView && <FloatingPauseControl />}
      {focusedView && <FocusPill />}
    </>
  );
};

// 2.2.1 perf: rendered again only when its own store reads or props change,
// not whenever the shell above it renders (three times per Load All page).
export default memo(ClassicShell);
