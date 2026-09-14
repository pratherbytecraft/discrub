import { useState } from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { ChannelType } from 'discrub-core/discord-enum';
import { selectSidebarView } from '@features/app/appSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import ServerView from '@containers/ServerView/ServerView';
import PackageView from '@components/package/PackageView';
import StatusPanel from '@components/ui/StatusPanel';
import FloatingPauseControl from '@components/ui/FloatingPauseControl';
import FocusPill from '@components/ui/FocusPill';
import DonationDrawer, { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import NativeRail from '../native/NativeRail';
import NativeColumn from '../native/NativeColumn';
import SimpleTop from '../simple/SimpleTop';
import SimpleBanner from '../simple/SimpleBanner';
import type { ShellProps } from '../types';
import TimelineStrip from './TimelineStrip';
import TimelineToolbar from './TimelineToolbar';
import TimelineSide from './TimelineSide';

export const TIMELINE_SIDE = 300;

/**
 * Timeline layout (2.2.0, supporter): the conversation by day. The top bar
 * and its picker are Simple's. Under it a strip of bars covers every loaded
 * day, then the action row, then the feed with a heading per day beside a
 * month list. Below the lg width the month list opens from the action row.
 * Focus keeps the top bar and the feed and hides the rest.
 */
const TimelineShell = ({ focusedView, sidebarOpen, onSidebarOpen, onSidebarClose, drawerOpen, onStartShellTour }: ShellProps) => {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const narrow = useMediaQuery(theme.breakpoints.down('lg'));
  const sidebarView = useAppSelector(selectSidebarView);
  const [logOpen, setLogOpen] = useState(false);
  const [monthsOpen, setMonthsOpen] = useState(false);
  const channel = useAppSelector(selectSelectedChannel);
  const isPackage = sidebarView === 'package';
  // A forum lists posts, not messages, so there are no days to draw: the strip and the month list stay out.
  const isForum = !isPackage && (channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA);
  const daysShown = !focusedView && !isPackage && !isForum;
  return (
    <>
      <Box
        data-testid="timeline-shell"
        sx={{
          display: 'flex', flexDirection: 'column', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' },
          backgroundColor: 'background.default', marginRight: drawerOpen ? `${DRAWER_WIDTH}px` : 0, transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        <SimpleTop onOpenPicker={onSidebarOpen} />
        {daysShown && <TimelineStrip />}
        {!focusedView && <TimelineToolbar phone={phone} showMonths={narrow && daysShown} onOpenMonths={() => setMonthsOpen(true)} />}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1, px: phone ? 1 : 2.5, pt: 1 }}>
            <SimpleBanner />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {isPackage ? <PackageView /> : <ServerView onStartShellTour={onStartShellTour} variant="timeline" />}
            </Box>
          </Box>
          {daysShown && !narrow && (
            <Box sx={{ width: TIMELINE_SIDE, flexShrink: 0, borderLeft: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <TimelineSide />
            </Box>
          )}
        </Box>
        {!focusedView && <StatusPanel sheetInset={0} sheetRightInset={drawerOpen ? DRAWER_WIDTH : 0} open={logOpen} onOpenChange={setLogOpen} />}
      </Box>
      {/* keepMounted: the channel and DM lists own the bulk Purge dialog, so they must exist while the drawer is shut. */}
      <Drawer anchor="left" open={!focusedView && sidebarOpen} onClose={onSidebarClose} ModalProps={{ keepMounted: true }} PaperProps={{ sx: { backgroundColor: 'background.default' } }}>
        <Box sx={{ display: 'flex', height: '100%' }} onClick={(e) => { if ((e.target as HTMLElement).closest('li, a, [role="button"], [data-testid="rail-package"]')) setTimeout(onSidebarClose, 150); }}>
          <NativeRail />
          <NativeColumn />
        </Box>
      </Drawer>
      <Drawer anchor="right" open={narrow && monthsOpen && !focusedView} onClose={() => setMonthsOpen(false)} PaperProps={{ sx: { width: Math.min(TIMELINE_SIDE, 320), maxWidth: '86vw', backgroundColor: 'background.paper' } }}>
        <TimelineSide onPicked={() => setMonthsOpen(false)} />
      </Drawer>
      {!focusedView && <DonationDrawer />}
      {focusedView && <FloatingPauseControl />}
      {focusedView && <FocusPill />}
    </>
  );
};

export default TimelineShell;
