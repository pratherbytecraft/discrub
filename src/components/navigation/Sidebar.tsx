import { useState, useEffect } from 'react';

import { SIDEBAR_WIDTH } from './sidebarConstants';
import { Box, Tabs, Tab, Drawer, useMediaQuery, useTheme, TextField, InputAdornment, IconButton, Typography, alpha } from '@mui/material';
import { Search as SearchIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useStore } from 'react-redux';
import type { RootState } from '@/app/store';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedGuild, setSelectedGuild } from '@features/guild/guildSlice';
import { selectSidebarView, setSidebarView } from '@features/app/appSlice';
import ServerList from './ServerList';
import DMList from './DMList';
import ChannelList from './ChannelList';
import PackageChannelList from '@/components/package/PackageChannelList';
import DevToolsFlask from '@/components/ui/DevToolsFlask';
import GuildAvatar from '@/components/ui/GuildAvatar';
import SeedMessagesDialog from '@/components/modals/SeedMessagesDialog';
import { useDevToolsEnabled } from '@/utils/useDevToolsEnabled';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import ScienceIcon from '@mui/icons-material/Science';
import Chip from '@mui/material/Chip';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

/**
 * Sidebar component - contains navigation for servers, DMs, and channels
 */
const Sidebar = ({ open = false, onClose }: SidebarProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // The sidebar mounts fresh on every switch into Classic or Workbench, so it opens on the tab that matches
  // what is already on screen. Until 2026-09-21 it always opened on Servers: coming from Native in Package
  // mode threw the package view away, and an open DM sat beside the server list.
  const store = useStore<RootState>();
  const [tab, setTab] = useState(() => {
    const state = store.getState();
    if (selectSidebarView(state) === 'package') return 2;
    return selectSelectedDm(state) && !selectSelectedChannel(state) ? 1 : 0;
  });
  const [filterText, setFilterText] = useState('');
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const sidebarView = useAppSelector(selectSidebarView);
  // Dev-tools gate (#153). Pill button below the channel header
  // appears only when devTools is on, the user owns the guild, and
  // no heavy operation is already running (would conflict with the
  // shared pause/cancel infra).
  const devToolsEnabled = useDevToolsEnabled();
  const currentUser = useAppSelector(selectCurrentUser);
  const isHeavyRunning = useAppSelector(selectIsHeavyOperationRunning);
  // Discord's /users/@me/guilds endpoint returns `owner: boolean` for
  // each guild (true iff the current user owns it) but NOT `owner_id`
  // — that field only comes from /guilds/{id}, which Discrub doesn't
  // fetch for the sidebar list. The boolean is the right check; the
  // owner_id fallback handles the rare case where a fuller guild
  // object got cached (e.g., via a member-role lookup).
  const isOwner =
    !!devToolsEnabled &&
    !!selectedGuild &&
    (selectedGuild.owner === true ||
      (!!selectedGuild.owner_id &&
        !!currentUser?.id &&
        selectedGuild.owner_id === currentUser.id));
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);

  useEffect(() => {
    // Clear search text when navigating between server and channel views
    setFilterText('');
  }, [selectedGuild, tab]);

  useEffect(() => {
    // Keep Redux sidebarView in sync when user switches to/from Package tab.
    const desired = tab === 2 ? 'package' : 'server';
    if (desired !== sidebarView) dispatch(setSidebarView(desired));
  }, [tab, sidebarView, dispatch]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  const handleBackToServers = () => {
    dispatch(setSelectedGuild(null));
  };

  const renderChannelHeader = () => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        px: 1,
        py: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'action.hover',
      }}
    >
      <IconButton
        onClick={handleBackToServers}
        size="small"
        sx={{
          mr: 1,
          color: 'text.secondary',
          transition: 'all 200ms ease',
          '&:hover': {
            color: 'primary.main',
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            transform: 'scale(1.05)',
          },
        }}
      >
        <ArrowBackIcon fontSize="small" />
      </IconButton>
      {/*
        Server icon follows the user into the channel-list view (#166).
        Anchored next to the back arrow so the visual context the user
        clicked moments ago stays visible while they navigate channels.
      */}
      <GuildAvatar guild={selectedGuild} size={24} sx={{ mr: 1 }} />
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 600,
          fontSize: '0.95rem',
          color: 'text.primary',
          flexGrow: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {selectedGuild?.name}
      </Typography>
      {isOwner && (
        <Chip
          icon={<ScienceIcon sx={{ fontSize: 14 }} />}
          label={t('sidebar.seed')}
          size="small"
          variant="outlined"
          color="primary"
          onClick={() => setSeedDialogOpen(true)}
          disabled={isHeavyRunning}
          data-testid="seed-pill"
          sx={{ ml: 1, height: 24, fontSize: '0.7rem' }}
        />
      )}
    </Box>
  );

  const sidebarContent = (
    <Box
      sx={{
        width: isMobile ? 'min(300px, 85vw)' : SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
      }}
    >
      <Tabs
        value={tab}
        onChange={handleTabChange}
        variant="fullWidth"
        sx={{
          borderBottom: '2px solid transparent',
          borderImage: (theme) => `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark}) 1`,
          '& .MuiTab-root': {
            fontWeight: 600,
            textTransform: 'none',
            fontSize: '1rem',
            transition: 'background-color 200ms ease',
            '&:hover': {
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
            },
            '&.Mui-selected': {
              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${alpha(theme.palette.primary.dark, 0.1)} 100%)`,
            },
          },
          '& .MuiTabs-indicator': {
            height: 3,
            background: (theme) => `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            borderRadius: '3px 3px 0 0',
          },
        }}
      >
        <Tab label={t('sidebar.tabServers')} data-tour="servers-tab" />
        <Tab label={t('sidebar.tabDms')} data-tour="dms-tab" />
        <Tab label={t('sidebar.tabPackage')} data-tour="package-tab" />
      </Tabs>

      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <TextField
          fullWidth
          size="small"
          data-tour="sidebar-search"
          placeholder={
            tab === 0
              ? (selectedGuild ? t('sidebar.searchChannels') : t('sidebar.searchServers'))
              : tab === 1
                ? t('sidebar.searchDms')
                : t('sidebar.searchPackage')
          }
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              backgroundColor: 'action.hover',
              transition: 'all 200ms ease',
              outline: 'none !important',
              boxShadow: 'none !important',
              '& fieldset': {
                borderColor: 'divider',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderWidth: '1px',
              },
              '&:hover': {
                backgroundColor: 'action.selected',
                '& fieldset': {
                  borderColor: alpha(theme.palette.primary.main, 0.5),
                },
              },
              '&.Mui-focused': {
                backgroundColor: alpha(theme.palette.primary.main, 0.05),
                boxShadow: 'none !important',
                outline: 'none !important',
                '& fieldset': {
                  borderColor: alpha(theme.palette.primary.main, 0.8),
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderWidth: '1px',
                },
              },
            },
            '& input': {
              outline: 'none !important',
              boxShadow: 'none !important',
            },
          }}
        />
      </Box>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {tab === 0 && (
          selectedGuild ? (
            <>
              {renderChannelHeader()}
              <ChannelList filterText={filterText} />
            </>
          ) : (
            <ServerList filterText={filterText} />
          )
        )}
        {tab === 1 && <DMList filterText={filterText} />}
        {tab === 2 && <PackageChannelList filterText={filterText} />}
      </Box>

      {/*
        Easter-egg dev-tools toggle (#153). Looks like a UI accent at
        low opacity; double-click flips the localStorage flag that
        gates the seed-messages affordance. Single click does
        nothing — keeps the gesture intentional.
      */}
      <Box
        sx={{
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <DevToolsFlask />
      </Box>

      <SeedMessagesDialog
        open={seedDialogOpen}
        onClose={() => setSeedDialogOpen(false)}
      />
    </Box>
  );

  // Mobile: Use drawer, Desktop: Static sidebar
  if (isMobile) {
    return (
      <Drawer
        anchor="left"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ 'data-testid': 'sidebar-drawer' } as object}
      >
        {sidebarContent}
      </Drawer>
    );
  }

  return sidebarContent;
};

export default Sidebar;
