import { useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import TopBar from '@containers/MainLayout/TopBar';
import ThemeAccentStrip from '@/theme/ThemeAccentStrip';
import Sidebar from '@components/navigation/Sidebar';
import { SIDEBAR_WIDTH } from '@components/navigation/sidebarConstants';
import ServerView from '@containers/ServerView/ServerView';
import PackageView from '@components/package/PackageView';
import StatusPanel from '@components/ui/StatusPanel';
import FloatingPauseControl from '@components/ui/FloatingPauseControl';
import FocusPill from '@components/ui/FocusPill';
import DonationDrawer, { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import type { ShellProps } from '../types';
import WorkbenchToolbar from './WorkbenchToolbar';
import WorkbenchDock from './WorkbenchDock';
import WorkbenchStatusBar from './WorkbenchStatusBar';

/**
 * Workbench layout (2.2.0, supporter): the Classic top bar and sidebar with a
 * single toolbar row above a dense message table, a dock at the bottom with
 * Progress, Recent runs and Status log tabs, and a one-line status bar. Focus
 * hides the sidebar, the dock and the status bar; the top bar stays. Below md
 * the sidebar rides in its drawer and the dock folds into the status bar.
 */
const WorkbenchShell = ({ focusedView, sidebarOpen, onSidebarOpen, onSidebarClose, drawerOpen, onStartShellTour }: ShellProps) => {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarView = useAppSelector(selectSidebarView);
  const [logOpen, setLogOpen] = useState(false);
  const showDock = !focusedView && !phone;
  return (
    <>
      <Box
        data-testid="workbench-shell"
        sx={{
          display: 'flex', flexDirection: 'column', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' },
          marginRight: drawerOpen ? `${DRAWER_WIDTH}px` : 0, transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        <TopBar onMenuClick={onSidebarOpen} />
        <ThemeAccentStrip />
        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          {!focusedView && <Sidebar open={sidebarOpen} onClose={onSidebarClose} />}
          <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'background.default' }}>
            <WorkbenchToolbar />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1.5, pb: 1 }}>
              {sidebarView === 'package' ? <PackageView /> : <ServerView onStartShellTour={onStartShellTour} variant="workbench" />}
            </Box>
            {showDock && <WorkbenchDock onOpenLog={() => setLogOpen(true)} />}
          </Box>
        </Box>
        {!focusedView && <WorkbenchStatusBar />}
      </Box>
      {!focusedView && <StatusPanel sheetInset={phone ? 0 : SIDEBAR_WIDTH} sheetRightInset={drawerOpen ? DRAWER_WIDTH : 0} open={logOpen} onOpenChange={setLogOpen} hideBar />}
      {!focusedView && <DonationDrawer />}
      {focusedView && <FloatingPauseControl />}
      {focusedView && <FocusPill />}
    </>
  );
};

export default WorkbenchShell;
