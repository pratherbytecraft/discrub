import { useState } from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import ServerView from '@containers/ServerView/ServerView';
import PackageView from '@components/package/PackageView';
import StatusPanel from '@components/ui/StatusPanel';
import FloatingPauseControl from '@components/ui/FloatingPauseControl';
import FocusPill from '@components/ui/FocusPill';
import DonationDrawer, { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import NativeRail from '../native/NativeRail';
import NativeColumn from '../native/NativeColumn';
import type { ShellProps } from '../types';
import SimpleTop from './SimpleTop';
import SimpleSearchCard from './SimpleSearchCard';
import SimpleBanner from './SimpleBanner';
import SimpleHintBar from './SimpleHintBar';

export const SIMPLE_COLUMN = 1120;

/**
 * Simple layout (2.2.0, supporter): one calm column. A top bar with a picker
 * for servers, conversations and the package, a search card that carries the
 * conversation's actions, a banner while an operation runs, the feed, a
 * hotkey hint bar and the collapsed status log bar. Focus keeps the top bar
 * and the feed and hides the rest.
 */
const SimpleShell = ({ focusedView, sidebarOpen, onSidebarOpen, onSidebarClose, drawerOpen, onStartShellTour }: ShellProps) => {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarView = useAppSelector(selectSidebarView);
  const [logOpen, setLogOpen] = useState(false);
  return (
    <>
      <Box
        data-testid="simple-shell"
        sx={{
          display: 'flex', flexDirection: 'column', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' },
          backgroundColor: 'background.default', marginRight: drawerOpen ? `${DRAWER_WIDTH}px` : 0, transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        <SimpleTop onOpenPicker={onSidebarOpen} />
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', px: phone ? 1 : 2.5, pt: focusedView ? 1 : 2 }}>
          <Box sx={{ width: '100%', maxWidth: SIMPLE_COLUMN, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {!focusedView && sidebarView !== 'package' && <SimpleSearchCard />}
            <SimpleBanner />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {sidebarView === 'package' ? <PackageView /> : <ServerView onStartShellTour={onStartShellTour} variant="simple" />}
            </Box>
          </Box>
        </Box>
        {!focusedView && !phone && <SimpleHintBar />}
        {!focusedView && <StatusPanel sheetInset={0} sheetRightInset={drawerOpen ? DRAWER_WIDTH : 0} open={logOpen} onOpenChange={setLogOpen} />}
      </Box>
      {/* keepMounted: the channel and DM lists own the bulk Purge dialog, so they must exist while the drawer is shut. */}
      <Drawer anchor="left" open={!focusedView && sidebarOpen} onClose={onSidebarClose} ModalProps={{ keepMounted: true }} PaperProps={{ sx: { backgroundColor: 'background.default' } }}>
        <Box sx={{ display: 'flex', height: '100%' }} onClick={(e) => { if ((e.target as HTMLElement).closest('li, a, [role="button"], [data-testid="rail-package"]')) setTimeout(onSidebarClose, 150); }}>
          <NativeRail />
          <NativeColumn />
        </Box>
      </Drawer>
      {!focusedView && <DonationDrawer />}
      {focusedView && <FloatingPauseControl />}
      {focusedView && <FocusPill />}
    </>
  );
};

export default SimpleShell;
