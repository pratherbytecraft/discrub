import { useState } from 'react';
import { Box, IconButton, InputAdornment, TextField, Typography, alpha, useTheme } from '@mui/material';
import { Search as SearchIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView } from '@features/app/appSlice';
import { selectSelectedGuild, setSelectedGuild } from '@features/guild/guildSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import ChannelList from '@components/navigation/ChannelList';
import DMList from '@components/navigation/DMList';
import PackageChannelList from '@components/package/PackageChannelList';
import DevToolsFlask from '@components/ui/DevToolsFlask';

export const COLUMN_WIDTH = 248;

/**
 * Channel column (Native): the server's channels when one is picked, the
 * server list otherwise, DMs when the rail's DM entry is active, and the
 * package channels in package view. The signed in user sits at the bottom.
 */
const NativeColumn = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const sidebarView = useAppSelector(selectSidebarView);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const currentUser = useAppSelector(selectCurrentUser);
  const [filterText, setFilterText] = useState('');
  const dmMode = sidebarView === 'server' && !selectedGuild;
  const title = sidebarView === 'package' ? t('sidebar.tabPackage') : selectedGuild ? selectedGuild.name : t('sidebar.tabDms');
  const hint = sidebarView === 'package' ? t('sidebar.searchChannels') : selectedGuild ? t('sidebar.searchChannels') : t('native.searchDms');

  return (
    <Box
      data-testid="native-column"
      sx={{ width: COLUMN_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, height: 48, borderBottom: '1px solid', borderColor: 'divider' }}>
        {selectedGuild && sidebarView === 'server' && (
          <IconButton size="small" aria-label={t('sidebar.backToServers')} onClick={() => dispatch(setSelectedGuild(null))} data-testid="native-column-back"><ArrowBackIcon sx={{ fontSize: 18 }} /></IconButton>
        )}
        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, flex: 1 }} data-testid="native-column-title">{title}</Typography>
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <TextField
          size="small" fullWidth placeholder={hint} value={filterText} onChange={(e) => setFilterText(e.target.value)}
          data-tour="sidebar-search"
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16 }} /></InputAdornment>, sx: { fontSize: '0.85rem', borderRadius: 1.5, backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.25 : 0.04) } }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {sidebarView === 'package' ? <PackageChannelList filterText={filterText} /> : dmMode ? <DMList filterText={filterText} /> : <ChannelList filterText={filterText} />}
      </Box>
      <Box data-tour="user-profile" sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.2 : 0.04) }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{currentUser?.global_name || currentUser?.username || ''}</Typography>
          <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>Discrub {__APP_VERSION__}</Typography>
        </Box>
        <DevToolsFlask />
      </Box>
    </Box>
  );
};

export default NativeColumn;
