import { useState, memo, useCallback } from 'react';
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
import { perfCount } from '@/utils/perfCounters';
import { PerfProfiler } from '@/utils/PerfProfiler';

/**
 * Workbench layout (2.2.0, supporter): the Classic top bar and sidebar with a
 * single toolbar row above a dense message table, a dock at the bottom with
 * Progress, Recent runs and Status log tabs, and a one-line status bar. Focus
 * hides the sidebar, the dock and the status bar; the top bar stays. Below md
 * the sidebar rides in its drawer and the dock folds into the status bar.
 */
const WorkbenchShell = ({ focusedView, sidebarOpen, onSidebarOpen, onSidebarClose, drawerOpen, onStartShellTour }: ShellProps) => {
  perfCount('WorkbenchShell');
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarView = useAppSelector(selectSidebarView);
  const [logOpen, setLogOpen] = useState(false);
  const openLog = useCallback(() => setLogOpen(true), []);
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
        <PerfProfiler id="TopBar"><TopBar onMenuClick={onSidebarOpen} /></PerfProfiler>
        <PerfProfiler id="ThemeAccentStrip"><ThemeAccentStrip /></PerfProfiler>
        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          {!focusedView && <PerfProfiler id="Sidebar"><Sidebar open={sidebarOpen} onClose={onSidebarClose} /></PerfProfiler>}
          <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'background.default' }}>
            <PerfProfiler id="WorkbenchToolbar"><WorkbenchToolbar /></PerfProfiler>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1.5, pb: 1 }}>
              {sidebarView === 'package' ? <PerfProfiler id="PackageView"><PackageView /></PerfProfiler> : <PerfProfiler id="ServerView"><ServerView onStartShellTour={onStartShellTour} variant="workbench" /></PerfProfiler>}
            </Box>
            {showDock && <WorkbenchDock onOpenLog={openLog} />}
          </Box>
        </Box>
        {!focusedView && <PerfProfiler id="WorkbenchStatusBar"><WorkbenchStatusBar /></PerfProfiler>}
      </Box>
      {!focusedView && <PerfProfiler id="StatusPanel"><StatusPanel sheetInset={phone ? 0 : SIDEBAR_WIDTH} sheetRightInset={drawerOpen ? DRAWER_WIDTH : 0} open={logOpen} onOpenChange={setLogOpen} hideBar /></PerfProfiler>}
      {!focusedView && <PerfProfiler id="DonationDrawer"><DonationDrawer /></PerfProfiler>}
      {focusedView && <FloatingPauseControl />}
      {focusedView && <FocusPill />}
    </>
  );
};

// 2.2.1 perf: rendered again only when its own store reads or props change,
// not whenever the shell above it renders (three times per Load All page).
export default memo(WorkbenchShell);
