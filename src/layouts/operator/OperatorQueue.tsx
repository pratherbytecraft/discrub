import { useEffect, useState } from 'react';
import { Box, InputAdornment, MenuItem, Select, TextField, ToggleButton, ToggleButtonGroup, Typography, alpha, useTheme } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Guild } from 'discrub-core/types/discord-types';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setSidebarView } from '@features/app/appSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { fetchChannels, selectSelectedChannels, setSelectedChannel, deselectAllChannels } from '@features/channel/channelSlice';
import { selectSelectedDms, deselectAllDms } from '@features/dm/dmSlice';
import { fetchCurrentMember, fetchRoles, selectGuilds, selectSelectedGuild, setSelectedGuild } from '@features/guild/guildSlice';
import { clearMessages } from '@features/message/messageSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import ChannelList, { type QueueMarks } from '@components/navigation/ChannelList';
import DMList from '@components/navigation/DMList';
import PackageChannelList from '@components/package/PackageChannelList';
import GuildAvatar from '@components/ui/GuildAvatar';

export const QUEUE_WIDTH = 280;

/**
 * The queue column (Operator, 2.2.0): a Servers / DMs / Package segment (the
 * tour's servers target), a server picker, a search box, and the channel or
 * DM list in queue mode. The count line under the list says what the queue
 * holds, and during a bulk run how far it has got (A5, option 2: the queue
 * drives Export and Purge; Load All stays on the open channel).
 */
const OperatorQueue = ({ marks, runProgress }: { marks: QueueMarks; runProgress?: { done: number; total: number } | null }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const token = useAppSelector(selectAuthToken);
  const guilds = useAppSelector(selectGuilds);
  const guild = useAppSelector(selectSelectedGuild);
  const sidebarView = useAppSelector(selectSidebarView);
  const selectedChannels = useAppSelector(selectSelectedChannels);
  const selectedDms = useAppSelector(selectSelectedDms);
  const [filterText, setFilterText] = useState('');
  type Segment = 'servers' | 'dms' | 'package';
  // The segment is the column's own choice: Servers with nothing picked shows the picker, not the DM list.
  const [segment, setSegmentState] = useState<Segment>(sidebarView === 'package' ? 'package' : guild ? 'servers' : 'dms');
  useEffect(() => { if (sidebarView === 'package') setSegmentState('package'); else if (guild) setSegmentState('servers'); }, [sidebarView, guild]);
  const queued = segment === 'dms' ? selectedDms.length : segment === 'servers' ? selectedChannels.length : 0;

  const pickGuild = async (g: Guild) => {
    if (!token) return;
    dispatch(deselectAllChannels());
    dispatch(setSelectedChannel(null));
    dispatch(clearMessages());
    dispatch(setSelectedGuild(g));
    dispatch(addStatusEntry({ level: 'info', message: t('nav.loadingServer', { name: g.name }) }));
    dispatch(fetchCurrentMember({ guildId: g.id, token }));
    dispatch(fetchRoles({ guildId: g.id, token }));
    await dispatch(fetchChannels({ guildId: g.id, token }));
  };
  const setSegment = (next: Segment | null) => {
    if (!next || next === segment) return;
    setSegmentState(next);
    if (next === 'package') { dispatch(setSidebarView('package')); return; }
    dispatch(setSidebarView('server'));
    if (next === 'dms') { dispatch(deselectAllChannels()); dispatch(setSelectedChannel(null)); dispatch(clearMessages()); dispatch(setSelectedGuild(null)); }
    else dispatch(deselectAllDms());
  };
  const countLine = runProgress
    ? t('operator.queueRun', { done: runProgress.done, left: Math.max(0, runProgress.total - runProgress.done - 1) })
    : queued > 0 ? t('operator.queued', { count: queued }) : t('operator.queueEmpty');

  return (
    <Box data-testid="operator-queue" sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <ToggleButtonGroup exclusive fullWidth size="small" value={segment} onChange={(_, v) => setSegment(v)} data-testid="operator-segment">
          <ToggleButton value="servers" data-tour="servers-tab" data-testid="operator-seg-servers" sx={{ textTransform: 'none', py: 0.4 }}>{t('sidebar.tabServers')}</ToggleButton>
          <ToggleButton value="dms" data-tour="dms-tab" data-testid="operator-seg-dms" sx={{ textTransform: 'none', py: 0.4 }}>{t('sidebar.tabDms')}</ToggleButton>
          <ToggleButton value="package" data-tour="package-tab" data-testid="operator-seg-package" sx={{ textTransform: 'none', py: 0.4 }}>{t('sidebar.tabPackage')}</ToggleButton>
        </ToggleButtonGroup>
        {segment === 'servers' && (
          <Select size="small" value={guild?.id ?? ''} displayEmpty onChange={(e) => { const g = guilds.find((x) => x.id === e.target.value); if (g) void pickGuild(g); }} data-testid="operator-guild" renderValue={(v) => { const g = guilds.find((x) => x.id === v); return g ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><GuildAvatar guild={g} size={22} /><Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{g.name}</Typography></Box> : <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('operator.pickServer')}</Typography>; }} sx={{ fontSize: '0.875rem' }}>
            {guilds.map((g) => <MenuItem key={g.id} value={g.id} data-testid={`operator-guild-${g.id}`}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><GuildAvatar guild={g} size={22} />{g.name}</Box></MenuItem>)}
          </Select>
        )}
        <TextField size="small" fullWidth placeholder={segment === 'dms' ? t('native.searchDms') : t('sidebar.searchChannels')} value={filterText} onChange={(e) => setFilterText(e.target.value)} data-tour="sidebar-search"
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16 }} /></InputAdornment>, sx: { fontSize: '0.85rem', borderRadius: 1.5, backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.25 : 0.04) } }} />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {segment === 'package' ? <PackageChannelList filterText={filterText} /> : segment === 'dms' ? <DMList filterText={filterText} queue={{ marks }} /> : guild ? <ChannelList filterText={filterText} queue={{ marks }} /> : (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>{t('operator.pickServerHint')}</Typography>
        )}
      </Box>
      {segment !== 'package' && (
        <Typography variant="caption" data-testid="operator-queue-count" sx={{ color: 'text.secondary', px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>{countLine}</Typography>
      )}
    </Box>
  );
};

export default OperatorQueue;
