import { useMemo, useState } from 'react';
import { BottomNavigation, BottomNavigationAction, Box, useMediaQuery, useTheme } from '@mui/material';
import { ViewList as QueueIcon, PlayCircle as RunIcon, Forum as FeedIcon, History as RecentIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import { selectExportProgress } from '@features/export/exportSlice';
import { selectPurgeProgress } from '@features/purge/purgeSlice';
import { selectSelectedChannel, selectSelectedChannels } from '@features/channel/channelSlice';
import { selectSelectedDm, selectSelectedDms } from '@features/dm/dmSlice';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import ServerView from '@containers/ServerView/ServerView';
import PackageView from '@components/package/PackageView';
import DonationDrawer, { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import type { QueueMarks } from '@components/navigation/ChannelList';
import type { ShellProps } from '../types';
import OperatorTop from './OperatorTop';
import OperatorQueue, { QUEUE_WIDTH } from './OperatorQueue';
import OperatorRunCard from './OperatorRunCard';
import OperatorLog from './OperatorLog';
import { OperatorFeedToolbar, OperatorRecent } from './OperatorSide';

export const SIDE_WIDTH = 360;
type PhoneTab = 'queue' | 'run' | 'feed' | 'recent';

/**
 * Operator layout (2.2.0, supporter): built around the run. The queue on
 * the left (channel or DM list in queue mode), the run card and the status
 * log in the middle, the feed peek and recent exports on the right. Open
 * feed swaps the feed into the middle and the run card to the side. No
 * Focus (A2). Tablet keeps the peek; a phone shows one panel at a time
 * from a tab bar.
 */
const OperatorShell = ({ drawerOpen, onStartShellTour }: ShellProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const tablet = useMediaQuery(theme.breakpoints.down('lg'));
  const sidebarView = useAppSelector(selectSidebarView);
  const guild = useAppSelector(selectSelectedGuild);
  const selectedChannels = useAppSelector(selectSelectedChannels);
  const selectedDms = useAppSelector(selectSelectedDms);
  const exportProgress = useAppSelector(selectExportProgress);
  const purgeProgress = useAppSelector(selectPurgeProgress);
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const [feedOpenChoice, setFeedOpen] = useState(false);
  const [tab, setTab] = useState<PhoneTab>('queue');
  const isPackage = sidebarView === 'package';
  // With nothing open the feed column holds the welcome panel, which needs the middle; the run card waits on the side.
  const hasContext = !!channel || !!dm;
  const feedOpen = feedOpenChoice || !hasContext;

  // A bulk run walks the queue in order: rows before the current index are done, the current one runs.
  const bulk = exportProgress?.bulk ?? purgeProgress?.bulk ?? null;
  const queue = guild ? selectedChannels : selectedDms;
  const marks = useMemo<QueueMarks>(() => {
    if (!bulk) return {};
    const m: QueueMarks = {};
    queue.forEach((ch, i) => { if (i < bulk.currentIndex) m[ch.id] = 'done'; else if (i === bulk.currentIndex) m[ch.id] = 'running'; });
    return m;
  }, [bulk, queue]);
  const runProgress = bulk ? { done: bulk.currentIndex, total: bulk.totalChannels } : null;

  const feed = <ServerView onStartShellTour={onStartShellTour} variant="operator" />;
  const middle = isPackage ? <PackageView /> : feedOpen ? (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', minHeight: 0 }}>
      {hasContext && <OperatorFeedToolbar feedOpen onToggleFeed={() => setFeedOpen(false)} />}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{feed}</Box>
    </Box>
  ) : (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', minHeight: 0 }}>
      <OperatorRunCard />
      <OperatorLog />
    </Box>
  );
  const side = isPackage ? <OperatorRecent /> : feedOpen ? (
    <>
      <OperatorRunCard />
      <OperatorRecent />
    </>
  ) : (
    <>
      <OperatorFeedToolbar feedOpen={false} onToggleFeed={() => setFeedOpen(true)} />
      <Box data-testid="operator-peek" sx={{ flex: 1, minHeight: 0, overflow: 'auto', borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper' }}>{feed}</Box>
      <OperatorRecent />
    </>
  );

  return (
    <>
      <Box data-testid="operator-shell" sx={{ display: 'flex', flexDirection: 'column', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, backgroundColor: 'background.default', marginRight: drawerOpen ? `${DRAWER_WIDTH}px` : 0, transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)' }}>
        <OperatorTop />
        {phone ? (
          <>
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: tab === 'queue' ? 0 : 1, gap: 1 }}>
              {tab === 'queue' && <OperatorQueue marks={marks} runProgress={runProgress} />}
              {tab === 'run' && (isPackage ? <PackageView /> : <><OperatorRunCard /><OperatorLog /></>)}
              {tab === 'feed' && (isPackage ? <PackageView /> : <><OperatorFeedToolbar feedOpen onToggleFeed={() => setTab('run')} /><Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{feed}</Box></>)}
              {tab === 'recent' && <OperatorRecent />}
            </Box>
            <BottomNavigation showLabels value={tab} onChange={(_, v: PhoneTab) => setTab(v)} data-testid="operator-tabs" sx={{ borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
              <BottomNavigationAction value="queue" label={t('operator.tabQueue')} icon={<QueueIcon />} data-testid="op-tab-queue" />
              <BottomNavigationAction value="run" label={t('operator.tabRun')} icon={<RunIcon />} data-testid="op-tab-run" />
              <BottomNavigationAction value="feed" label={t('operator.tabFeed')} icon={<FeedIcon />} data-testid="op-tab-feed" />
              <BottomNavigationAction value="recent" label={t('operator.tabRecent')} icon={<RecentIcon />} data-testid="op-tab-recent" />
            </BottomNavigation>
          </>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `${tablet ? 232 : QUEUE_WIDTH}px minmax(0, 1fr) ${tablet ? 280 : SIDE_WIDTH}px` }}>
            <OperatorQueue marks={marks} runProgress={runProgress} />
            <Box data-testid="operator-main" sx={{ minHeight: 0, p: 1.5 }}>{middle}</Box>
            <Box data-testid="operator-side" sx={{ minHeight: 0, p: 1.5, pl: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>{side}</Box>
          </Box>
        )}
      </Box>
      <DonationDrawer />
    </>
  );
};

export default OperatorShell;
