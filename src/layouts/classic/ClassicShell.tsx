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
        <TopBar onMenuClick={onSidebarOpen} />
        <ThemeAccentStrip />

        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          {!focusedView && <Sidebar open={sidebarOpen} onClose={onSidebarClose} />}

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
              <ServerView onStartShellTour={onStartShellTour} />
            )}
          </Box>
        </Box>

        {!focusedView && <StatusPanel sheetInset={isMobile ? 0 : SIDEBAR_WIDTH} />}
      </Box>

      {!focusedView && <DonationDrawer />}

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

export default ClassicShell;
