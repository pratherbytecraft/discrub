import { memo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ChannelType } from 'discrub-core/discord-enum';
import { useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination, selectActiveSelectedMessages } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { perfCount } from '@/utils/perfCounters';

const STATE_HEX: Record<string, string> = { neutral: '#8b949e', success: '#3fb950', warning: '#d29922', info: '#58a6ff', error: '#f85149' };

/** One-line status bar (Workbench): the operation's state and label, or loaded, more available and selected counts. */
const WorkbenchStatusBar = () => {
  perfCount('WorkbenchStatusBar');
  const { t } = useTranslation();
  const summary = useAppSelector(selectOperationSummary);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const selected = useAppSelector(selectActiveSelectedMessages);
  const pagination = useAppSelector(selectActivePagination);
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  // In Package mode the counts belong to the package view, not to the live channel left open behind it
  // (the bar said "0 loaded · more available" there until 2026-09-21).
  const isPackage = useAppSelector(selectSidebarView) === 'package';
  // A forum lists posts, and its own header counts them, so the message counts stay out there too.
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  const hasContext = !isPackage && !isForum && (!!channel || !!dm);
  const running = summary.tier === 'heavy';
  return (
    <Box data-testid="workbench-status-bar" sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 26, borderTop: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', fontSize: '0.72rem', color: 'text.secondary', flexShrink: 0 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATE_HEX[summary.stateColor] }} />
      {running ? (
        <Typography variant="caption" noWrap sx={{ fontSize: 'inherit' }}>{summary.name} · {summary.label}</Typography>
      ) : hasContext ? (
        <Typography variant="caption" noWrap sx={{ fontSize: 'inherit' }}>
          {t('workbench.loaded', { count: messages.length })}
          {' · '}{pagination.hasMore ? t('workbench.moreAvailable') : t('workbench.allLoaded')}
          {selected.length > 0 ? ` · ${t('workbench.selected', { count: selected.length })}` : ''}
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ fontSize: 'inherit' }}>{t('workbench.nothingRunning')}</Typography>
      )}
    </Box>
  );
};

// 2.2.1 perf: rendered again only when its own store reads or props change,
// not whenever the shell above it renders (three times per Load All page).
export default memo(WorkbenchStatusBar);
