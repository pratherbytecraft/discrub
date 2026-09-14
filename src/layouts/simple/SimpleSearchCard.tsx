import { Box, Button, Chip, Typography, alpha, useTheme } from '@mui/material';
import { Search as SearchIcon, CloudDownload as LoadAllIcon, FileDownload as ExportIcon, DeleteSweep as PurgeIcon, Forum as ThreadIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ChannelType } from 'discrub-core/discord-enum';
import { countActiveFilters } from 'discrub-core/filtering';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setDialogOpen } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination, selectActiveSearchCriteria } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { getDmName } from '@/utils/dmListUtils';

/**
 * The search card (Simple, 2.2.0): a big Filters entry, a line that says what
 * is loaded, and the conversation's actions. Every action opens the store
 * driven dialog the other layouts use. Hidden while nothing is open and in
 * Focus.
 */
const SimpleSearchCard = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const pagination = useAppSelector(selectActivePagination);
  const criteria = useAppSelector(selectActiveSearchCriteria);
  const summary = useAppSelector(selectOperationSummary);
  const running = summary.tier === 'heavy';
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  if (!channel && !dm) {
    return (
      <Box data-testid="simple-welcome-card" sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('simple.pickHint')}</Typography>
      </Box>
    );
  }
  const name = channel ? `#${channel.name}` : dm ? getDmName(dm) : '';
  const filters = criteria ? countActiveFilters(criteria) : 0;
  const open = (dialog: 'filters' | 'loadAll' | 'export' | 'forumExport' | 'purge' | 'threadLoad') => dispatch(setDialogOpen({ dialog, open: true }));
  return (
    <Box data-testid="simple-search-card" sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {!isForum && (
        <Box component="button" type="button" onClick={() => open('filters')} data-testid="simple-filters" data-tour="search-filters" sx={{ height: 44, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.25 : 0.04), display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, font: 'inherit', color: 'text.secondary', cursor: 'pointer', textAlign: 'left', '&:hover': { borderColor: 'primary.main' } }}>
          <SearchIcon sx={{ fontSize: 20 }} />
          <Typography variant="body1" noWrap sx={{ flex: 1 }}>{t('simple.searchIn', { name })}</Typography>
          {filters > 0 && <Chip size="small" color="primary" label={t('native.filtersActive', { count: filters })} data-testid="simple-filter-count" />}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {/* Forums count posts in the feed itself, so the loaded line is for channels and DMs only. */}
        {isForum ? <Box sx={{ flex: 1 }} /> : (
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
            <Box component="b" sx={{ fontWeight: 600 }}>{messages.length.toLocaleString()}</Box> {t('simple.messagesLoaded')}{pagination.hasMore && !running ? ` · ${t('workbench.moreAvailable')}` : !pagination.hasMore && messages.length > 0 ? ` · ${t('workbench.allLoaded')}` : ''}
          </Typography>
        )}
        {!isForum && !running && <Button size="small" variant="contained" startIcon={<LoadAllIcon />} disabled={!pagination.hasMore} onClick={() => open('loadAll')} data-testid="simple-load-all" sx={{ textTransform: 'none' }}>{t('serverView.loadAll')}</Button>}
        <Button size="small" variant="outlined" color="inherit" startIcon={<ExportIcon />} disabled={running || (!isForum && messages.length === 0)} onClick={() => open(isForum ? 'forumExport' : 'export')} data-testid="simple-export" data-tour="export-button" sx={{ textTransform: 'none', borderColor: 'divider' }}>{t('serverView.export')}</Button>
        {!isForum && <Button size="small" variant="outlined" color="error" startIcon={<PurgeIcon />} disabled={running} onClick={() => open('purge')} data-testid="simple-purge" sx={{ textTransform: 'none' }}>{t('native.purge')}</Button>}
        {channel && <Button size="small" variant="outlined" color="inherit" startIcon={<ThreadIcon />} disabled={running} onClick={() => open('threadLoad')} data-testid="simple-load-thread" sx={{ textTransform: 'none', borderColor: 'divider' }}>{t('serverView.loadThread')}</Button>}
      </Box>
    </Box>
  );
};

export default SimpleSearchCard;
