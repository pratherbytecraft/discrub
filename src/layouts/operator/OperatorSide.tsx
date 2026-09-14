import { Box, Button, Typography } from '@mui/material';
import { FilterList as FiltersIcon, BarChart as AnalyticsIcon, Forum as ThreadIcon, OpenInFull as OpenIcon, CloseFullscreen as BackIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ChannelType } from 'discrub-core/discord-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setDialogOpen } from '@features/app/appSlice';
import { selectRecentExports } from '@features/history/historySlice';
import { selectActiveFilteredMessages } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { getDmName } from '@/utils/dmListUtils';

/** The row above the peek (Operator): Filters, Analytics and Load Thread, and the Open feed / Back switch. */
export const OperatorFeedToolbar = ({ feedOpen, onToggleFeed }: { feedOpen: boolean; onToggleFeed: () => void }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  const hasContext = !!channel || !!dm;
  const name = channel ? `#${channel.name}` : dm ? getDmName(dm) : '';
  const open = (dialog: 'filters' | 'analytics' | 'threadLoad') => dispatch(setDialogOpen({ dialog, open: true }));
  return (
    <Box data-testid="operator-feed-toolbar" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="overline" noWrap sx={{ lineHeight: 1, color: 'text.secondary', letterSpacing: '0.08em' }}>{hasContext ? t('operator.latestIn', { name }) : t('operator.noConversation')}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
      {hasContext && !isForum && <Button size="small" startIcon={<FiltersIcon />} onClick={() => open('filters')} data-testid="op-filters" sx={{ textTransform: 'none', py: 0 }}>{t('serverView.filters')}</Button>}
      {hasContext && <Button size="small" startIcon={<AnalyticsIcon />} disabled={messages.length === 0} onClick={() => open('analytics')} data-testid="op-analytics" sx={{ textTransform: 'none', py: 0 }}>{t('serverView.analytics')}</Button>}
      {channel && <Button size="small" startIcon={<ThreadIcon />} onClick={() => open('threadLoad')} data-testid="op-load-thread" sx={{ textTransform: 'none', py: 0 }}>{t('serverView.loadThread')}</Button>}
      {hasContext && <Button size="small" variant="outlined" color="inherit" startIcon={feedOpen ? <BackIcon /> : <OpenIcon />} onClick={onToggleFeed} data-testid="op-open-feed" sx={{ textTransform: 'none', py: 0, borderColor: 'divider', ml: 'auto' }}>{feedOpen ? t('operator.backToRun') : t('operator.openFeed')}</Button>}
      </Box>
    </Box>
  );
};

/** Recent exports (Operator): the same history the Workbench dock lists. */
export const OperatorRecent = () => {
  const { t } = useTranslation();
  const runs = useAppSelector(selectRecentExports);
  return (
    <Box data-testid="operator-recent" sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75, flexShrink: 0 }}>
      <Typography variant="overline" sx={{ lineHeight: 1, color: 'text.secondary', letterSpacing: '0.08em' }}>{t('operator.recentExports')}</Typography>
      {runs.length === 0 ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('workbench.noRuns')}</Typography> : runs.slice(0, 5).map((r) => (
        <Box key={r.id} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: '0.8rem' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'success.main', alignSelf: 'center', flexShrink: 0 }} />
          <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: 'inherit' }}>{r.isBulk ? t('workbench.channelCount', { count: r.channelCount ?? 0 }) : r.channelName}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{new Date(r.timestamp).toLocaleDateString()}</Typography>
        </Box>
      ))}
    </Box>
  );
};
