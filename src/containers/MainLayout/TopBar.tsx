import { useState } from 'react';
import {
  AppBar, Toolbar, Avatar, Typography, IconButton, Box, Tooltip,
  Dialog, DialogContent, Menu, MenuItem, ListItemIcon, ListItemText,
} from '@mui/material';
import {
  Logout as LogoutIcon,
  Settings as SettingsIcon,
  Minimize as MinimizeIcon,
  Close as CloseIcon,
  Campaign as AnnouncementIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  BrightnessAuto as AutoModeIcon,
  EmojiObjects as IdeasIcon,
  Reddit as RedditIcon,
  Email as EmailIcon,
  WarningAmber as WarningIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@features/user/userSlice';
import { clearToken } from '@features/auth/authSlice';
import { clearCurrentUser } from '@features/user/userSlice';
import { clearGuilds, setSelectedGuild } from '@features/guild/guildSlice';
import { clearChannels, setSelectedChannel } from '@features/channel/channelSlice';
import { clearDMs, setSelectedDm } from '@features/dm/dmSlice';
import { clearMessages } from '@features/message/messageSlice';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectSetting, updateSetting, setMinimized } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning, selectOperationSummary } from '@features/app/operationSelectors';
import { reopenAnnouncement, fetchAnnouncementMarkdownThunk } from '@features/announcement/announcementSlice';
import { isOverlayMode, closeOverlay, minimizeOverlay } from '@/extension/messaging';
import SettingsModal from '@components/settings/SettingsModal';
import UserProfileModal from '@components/modals/UserProfileModal';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import { useHotkey } from '@features/hotkeys/HotkeyProvider';
import { selectIsMinimized } from '@features/app/appSlice';

/**
 * TopBar component - shows user info and logout button
 */
const TopBar = () => {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(selectCurrentUser);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const themeMode = useAppSelector(selectSetting(DiscrubSetting.APP_THEME_MODE)) || 'auto';
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const operationSummary = useAppSelector(selectOperationSummary);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);

  const handleGoHome = () => {
    dispatch(setSelectedGuild(null));
    dispatch(setSelectedChannel(null));
    dispatch(setSelectedDm(null));
  };

  const handleCycleTheme = () => {
    // Cycle: auto → dark → light → auto
    const next = themeMode === 'auto' ? 'dark' : themeMode === 'dark' ? 'light' : 'auto';
    dispatch(updateSetting({ key: DiscrubSetting.APP_THEME_MODE, value: next }));
  };

  const themeIcon = themeMode === 'light' ? <LightModeIcon /> : themeMode === 'dark' ? <DarkModeIcon /> : <AutoModeIcon />;
  const themeLabel = themeMode === 'light' ? 'Light mode' : themeMode === 'dark' ? 'Dark mode' : 'Auto (system)';

  const handleLogout = () => {
    dispatch(clearToken());
    dispatch(clearCurrentUser());
    dispatch(clearGuilds());
    dispatch(clearChannels());
    dispatch(clearDMs());
    dispatch(clearMessages());
  };

  const handleProfileClick = () => {
    setProfileModalOpen(true);
  };

  const handleMinimize = async () => {
    dispatch(setMinimized(true));
    try {
      await minimizeOverlay();
    } catch {
      dispatch(setMinimized(false));
    }
  };

  // Wire #144 hotkeys for the topbar. Settings toggles open/close —
  // pressing mod+, again while Settings is open closes the dialog,
  // matching how F toggles focus mode. Minimize is one-shot (no
  // restore-from-minimized hotkey in v1, see backlog).
  const isMinimized = useAppSelector(selectIsMinimized);
  useHotkey('openSettings', () => setSettingsOpen((open) => !open), true);
  useHotkey('minimize', handleMinimize, isOverlayMode() && !isMinimized);

  const handleCloseConfirm = async () => {
    setCloseDialogOpen(false);
    try {
      await closeOverlay();
    } catch {
      // closeOverlay already logs errors internally
    }
  };

  return (
    <AppBar
      position="static"
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderBottom: 1,
        borderColor: 'divider',
        boxShadow: (theme) => theme.customShadows?.elevation1 || '0 2px 8px rgba(0, 0, 0, 0.2)',
      }}
    >
      <Toolbar sx={{ gap: 2 }}>
        {/* Discrub Icon — click to return to WelcomePanel */}
        <Tooltip title="Home" enterDelay={0} arrow>
          <Box
            component="img"
            src="/discrub.png"
            alt="Discrub Home"
            onClick={handleGoHome}
            sx={{
              height: 36,
              width: 36,
              mr: 1,
              transition: 'transform 200ms ease',
              cursor: 'pointer',
              '&:hover': {
                transform: 'scale(1.05)',
              },
            }}
          />
        </Tooltip>

        <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
          <Typography
            variant="h6"
            component="div"
            sx={{
              fontWeight: 700,
              background: (theme) => `linear-gradient(135deg, ${theme.palette.text.primary}, ${theme.palette.primary.main})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Discrub
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: 'rgba(114, 137, 218, 0.7)',
              fontWeight: 500,
              fontSize: '0.7rem',
              letterSpacing: '0.5px',
              ml: 0.5,
            }}
          >
            v{__APP_VERSION__}
          </Typography>
        </Box>

        {currentUser && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              onClick={handleProfileClick}
              data-tour="user-profile"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                padding: '4px 12px',
                borderRadius: '4px',
                transition: 'background-color 200ms ease',
                '&:hover': {
                  backgroundColor: 'rgba(114, 137, 218, 0.1)',
                },
              }}
            >
              <Avatar
                src={
                  currentUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png`
                    : undefined
                }
                sx={{
                  width: 36,
                  height: 36,
                  border: '2px solid rgba(114, 137, 218, 0.3)',
                  transition: 'border-color 200ms ease',
                }}
              >
                {currentUser.username?.[0]?.toUpperCase()}
              </Avatar>
              <Typography
                variant="body2"
                sx={{
                  transition: 'color 200ms ease',
                }}
              >
                {currentUser.global_name || currentUser.username}
              </Typography>
            </Box>

            <HotkeyTooltip actionId="openSettings" label="Settings" enterDelay={0} arrow>
              <IconButton
                color="inherit"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
              >
                <SettingsIcon />
              </IconButton>
            </HotkeyTooltip>

            <Tooltip title={themeLabel} enterDelay={0} arrow>
              <IconButton
                color="inherit"
                onClick={handleCycleTheme}
                aria-label="Toggle theme"
              >
                {themeIcon}
              </IconButton>
            </Tooltip>

            <Tooltip title="More" enterDelay={0} arrow>
              <IconButton
                color="inherit"
                onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
                aria-label="More options"
              >
                <MoreIcon />
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={moreMenuAnchor}
              open={Boolean(moreMenuAnchor)}
              onClose={() => setMoreMenuAnchor(null)}
              PaperProps={{ sx: { bgcolor: 'background.paper', minWidth: 200 } }}
            >
              <MenuItem
                component="a"
                href="https://www.reddit.com/r/discrub"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMoreMenuAnchor(null)}
              >
                <ListItemIcon>
                  <RedditIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>r/discrub</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setIdeasOpen(true);
                  setMoreMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <IdeasIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Ideas & Contact</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  dispatch(fetchAnnouncementMarkdownThunk());
                  dispatch(reopenAnnouncement());
                  setMoreMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <AnnouncementIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>View Announcement</ListItemText>
              </MenuItem>
            </Menu>

            <Tooltip title="Logout" enterDelay={0} arrow>
              <IconButton
                color="inherit"
                onClick={handleLogout}
                aria-label="Logout"
                sx={{
                  transition: 'background-color 200ms ease',
                  '&:hover': {
                    backgroundColor: 'rgba(240, 71, 71, 0.15)',
                  },
                }}
              >
                <LogoutIcon />
              </IconButton>
            </Tooltip>

            {isOverlayMode() && (
              <HotkeyTooltip actionId="minimize" label="Minimize to Discord" enterDelay={0} arrow>
                <IconButton
                  color="inherit"
                  onClick={handleMinimize}
                  aria-label="Minimize Discrub"
                >
                  <MinimizeIcon />
                </IconButton>
              </HotkeyTooltip>
            )}

            {isOverlayMode() && (
              <Tooltip title="Close Discrub" enterDelay={0} arrow>
                <IconButton
                  color="inherit"
                  onClick={() => isOperationRunning ? setCloseDialogOpen(true) : handleCloseConfirm()}
                  aria-label="Close Discrub"
                  sx={{
                    transition: 'background-color 200ms ease',
                    '&:hover': {
                      backgroundColor: 'rgba(240, 71, 71, 0.15)',
                    },
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Toolbar>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <UserProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        user={currentUser}
        cachedUserMap={cachedUserMap}
        guildId={null}
      />

      <Dialog
        open={closeDialogOpen}
        onClose={() => setCloseDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper' } }}
      >
        <DialogContent sx={{ textAlign: 'center', py: 4, px: 3, position: 'relative' }}>
          <DialogCloseIcon onClose={() => setCloseDialogOpen(false)} />

          <WarningIcon sx={{ fontSize: 40, color: 'warning.main', mb: 1 }} />

          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            Operation in Progress
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {operationSummary.label}
          </Typography>
          <Typography variant="body2" color="warning.main" sx={{ mb: 3 }}>
            Closing will cancel this operation. Progress may be lost.
          </Typography>

          <Box
            component="button"
            onClick={handleCloseConfirm}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5,
              px: 2, py: 1.25, borderRadius: 1, border: 'none', cursor: 'pointer',
              bgcolor: 'action.hover', color: 'text.secondary', width: '100%',
              transition: 'background-color 150ms ease',
              '&:hover': { bgcolor: 'rgba(240, 71, 71, 0.15)', color: 'error.main' },
            }}
          >
            <CloseIcon sx={{ fontSize: 18, color: 'error.main' }} />
            <Typography variant="body2">Close Anyway</Typography>
          </Box>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ideasOpen}
        onClose={() => setIdeasOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper' } }}
      >
        <DialogContent sx={{ textAlign: 'center', py: 4, px: 3, position: 'relative' }}>
          <DialogCloseIcon onClose={() => setIdeasOpen(false)} label="Close Ideas" />
          <IdeasIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            Ideas & Contact
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Have an idea for a feature, found a bug, or want something similar built?
            I'd love to hear from you!
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box
              component="a"
              href="mailto:prathercc@gmail.com"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.25,
                borderRadius: 1,
                bgcolor: 'action.hover',
                color: 'text.secondary',
                textDecoration: 'none',
                transition: 'background-color 150ms ease',
                '&:hover': { bgcolor: 'action.selected', color: 'text.primary' },
              }}
            >
              <EmailIcon sx={{ fontSize: 18, color: 'primary.main' }} />
              <Typography variant="body2">prathercc@gmail.com</Typography>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </AppBar>
  );
};

export default TopBar;
