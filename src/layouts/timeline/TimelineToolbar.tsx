import { useState } from 'react';
import { Box, Button, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { CloudDownload as LoadAllIcon, FileDownload as ExportIcon, DeleteSweep as PurgeIcon, FilterList as FilterIcon, Forum as ThreadIcon, CalendarViewMonth as MonthsIcon, MoreHoriz as MoreIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ChannelType } from 'discrub-core/discord-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setDialogOpen } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';

type DialogKey = 'loadAll' | 'export' | 'forumExport' | 'purge' | 'filters' | 'threadLoad';

/**
 * Timeline's action row: Load All, Export, Purge, Filters and Load Thread,
 * each opening the store driven dialog every layout uses. Analytics, Focus
 * and Settings live in the top bar. Below the side column's width a Months
 * button opens the month list; on a phone the whole row folds into one menu.
 */
const TimelineToolbar = ({ phone, showMonths, onOpenMonths }: { phone: boolean; showMonths: boolean; onOpenMonths: () => void }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const pagination = useAppSelector(selectActivePagination);
  const running = useAppSelector(selectOperationSummary).tier === 'heavy';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const isPackage = sidebarView === 'package';
  if (isPackage || (!channel && !dm)) return null;
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  const open = (dialog: DialogKey) => { setAnchor(null); dispatch(setDialogOpen({ dialog, open: true })); };
  const items: Array<{ key: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; color?: 'primary' | 'error'; contained?: boolean; tour?: string; note?: string }> = [];
  if (!isForum) items.push({ key: 'load-all', label: t('serverView.loadAll'), icon: <LoadAllIcon fontSize="small" />, onClick: () => open('loadAll'), disabled: running || !pagination.hasMore, color: 'primary', contained: true, note: !pagination.hasMore ? t('timeline.allLoaded') : undefined });
  items.push({ key: 'export', label: t('serverView.export'), icon: <ExportIcon fontSize="small" />, onClick: () => open(isForum ? 'forumExport' : 'export'), disabled: running || (!isForum && messages.length === 0), tour: 'export-button' });
  if (!isForum) items.push({ key: 'purge', label: t('native.purge'), icon: <PurgeIcon fontSize="small" />, onClick: () => open('purge'), disabled: running, color: 'error' });
  if (!isForum) items.push({ key: 'filters', label: t('serverView.filters'), icon: <FilterIcon fontSize="small" />, onClick: () => open('filters'), tour: 'search-filters' });
  if (channel) items.push({ key: 'load-thread', label: t('serverView.loadThread'), icon: <ThreadIcon fontSize="small" />, onClick: () => open('threadLoad'), disabled: running });
  if (showMonths && !isForum) items.push({ key: 'months', label: t('timeline.months'), icon: <MonthsIcon fontSize="small" />, onClick: () => { setAnchor(null); onOpenMonths(); } });

  if (phone) {
    return (
      <Box data-testid="timeline-toolbar" sx={{ display: 'flex', alignItems: 'center', px: 1.25, height: 40, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }} noWrap>{t('timeline.messageCount', { count: messages.length })}</Typography>
        <Button size="small" variant="outlined" color="inherit" startIcon={<MoreIcon />} onClick={(e) => setAnchor(e.currentTarget)} data-testid="timeline-menu" sx={{ textTransform: 'none', borderColor: 'divider' }}>{t('timeline.actions')}</Button>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          {items.map((it) => (
            <MenuItem key={it.key} onClick={it.onClick} disabled={it.disabled} data-testid={`timeline-menu-${it.key}`} sx={it.color === 'error' ? { color: 'error.main' } : undefined}>
              <ListItemIcon sx={{ color: 'inherit' }}>{it.icon}</ListItemIcon>
              <ListItemText primary={it.label} secondary={it.note} />
            </MenuItem>
          ))}
        </Menu>
      </Box>
    );
  }
  return (
    <Box data-testid="timeline-toolbar" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, px: 2.5, height: 44, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, overflowX: 'auto' }}>
      {items.map((it) => (
        <Button key={it.key} size="small" variant={it.contained ? 'contained' : 'outlined'} color={it.color ?? 'inherit'} startIcon={it.icon} onClick={it.onClick} disabled={it.disabled} data-testid={`timeline-${it.key}`} data-tour={it.tour} sx={{ textTransform: 'none', borderColor: it.color ? undefined : 'divider', whiteSpace: 'nowrap', flexShrink: 0 }}>{it.label}</Button>
      ))}
    </Box>
  );
};

export default TimelineToolbar;
