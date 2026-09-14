import { useState } from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import PackageView from '@components/package/PackageView';
import ServerView from '@containers/ServerView/ServerView';
import StatusPanel from '@components/ui/StatusPanel';
import FloatingPauseControl from '@components/ui/FloatingPauseControl';
import FocusPill from '@components/ui/FocusPill';
import DonationDrawer, { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import type { ShellProps } from '../types';
import NativeRail, { RAIL_WIDTH } from './NativeRail';
import NativeColumn, { COLUMN_WIDTH } from './NativeColumn';
import NativeHead from './NativeHead';
import NativeInspector, { INSPECTOR_WIDTH } from './NativeInspector';

/**
 * Native layout (2.2.0, the free headline): a Discord-like frame. Server rail
 * on the left, channel column, the feed with a head row that carries the
 * operation strip and the Appearance button, and an inspector on the right
 * with the channel's actions, the run card, filters and a status log peek.
 * Focus hides the rail, the column and the inspector; the head row stays.
 * The status log opens as a sheet over the feed from the inspector.
 */
const NativeShell = ({ focusedView, drawerOpen, sidebarOpen, onSidebarOpen, onSidebarClose, onStartShellTour }: ShellProps) => {
  const theme = useTheme();
  // Three tiers (2.2.0): desktop keeps everything in place; below lg the inspector becomes a slide-over
  // from the head's toggle; below md the rail and column fold into a drawer behind the head's menu button.
  // jsdom reports no match for either query, which counts as desktop.
  const narrow = useMediaQuery(theme.breakpoints.down('lg'));
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarView = useAppSelector(selectSidebarView);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorSheet, setInspectorSheet] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const inspectorInline = !focusedView && inspectorOpen && !narrow;
  const navInline = !focusedView && !phone;
  const navWidth = navInline ? RAIL_WIDTH + COLUMN_WIDTH : 0;
  const toggleInspector = () => (narrow ? setInspectorSheet((o) => !o) : setInspectorOpen((o) => !o));

  return (
    <>
      <Box
        data-testid="native-shell"
        sx={{
          display: 'flex', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' },
          overflow: 'hidden', backgroundColor: 'background.default',
          // The Ko-fi drawer is fixed on the right; keep the inspector clear of it like Classic does.
          marginRight: drawerOpen ? `${DRAWER_WIDTH}px` : 0,
          transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        {navInline && <NativeRail />}
        {navInline && <NativeColumn />}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <NativeHead
            inspectorOpen={narrow ? inspectorSheet : inspectorInline}
            onToggleInspector={toggleInspector}
            canToggleInspector={!focusedView}
            showMenu={phone && !focusedView}
            onMenu={onSidebarOpen}
          />
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
            {sidebarView === 'package' ? <PackageView /> : <ServerView onStartShellTour={onStartShellTour} variant="native" />}
          </Box>
        </Box>
        {inspectorInline && <NativeInspector onOpenLog={() => setLogOpen(true)} />}
      </Box>
      {/* Tablet and phone: the inspector slides over from the right; the rail and column ride in a drawer on phones. */}
      <Drawer anchor="right" open={narrow && !focusedView && inspectorSheet} onClose={() => setInspectorSheet(false)} PaperProps={{ sx: { backgroundColor: 'background.default' } }}>
        <NativeInspector onOpenLog={() => { setInspectorSheet(false); setLogOpen(true); }} />
      </Drawer>
      <Drawer anchor="left" open={phone && !focusedView && sidebarOpen} onClose={onSidebarClose} PaperProps={{ sx: { backgroundColor: 'background.default' } }}>
        <Box sx={{ display: 'flex', height: '100%' }}>
          <NativeRail />
          <NativeColumn />
        </Box>
      </Drawer>
      {!focusedView && (
        <StatusPanel sheetInset={navWidth} sheetRightInset={drawerOpen ? DRAWER_WIDTH : 0} open={logOpen} onOpenChange={setLogOpen} hideBar />
      )}
      {!focusedView && <DonationDrawer />}
      {focusedView && <FloatingPauseControl />}
      {focusedView && <FocusPill />}
    </>
  );
};

export default NativeShell;
export { INSPECTOR_WIDTH };
