import { useLayoutEffect, useRef, useState } from 'react';
import {
  AppBar, Toolbar, Avatar, Typography, IconButton, Box, Tooltip,
  Dialog, DialogContent, Menu, MenuItem, ListItemIcon, ListItemText,
  alpha, useMediaQuery, useTheme, Divider,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import {
  Logout as LogoutIcon,
  Settings as SettingsIcon,
  Minimize as MinimizeIcon,
  Close as CloseIcon,
  Campaign as AnnouncementIcon,
  EmojiObjects as IdeasIcon,
  Reddit as RedditIcon,
  WarningAmber as WarningIcon,
  MoreVert as MoreIcon,
  Menu as MenuIcon,
  Star as StarIcon,
} from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@features/user/userSlice';
import { clearToken, forgetRememberedToken } from '@features/auth/authSlice';
import { clearCurrentUser } from '@features/user/userSlice';
import { clearGuilds, setSelectedGuild } from '@features/guild/guildSlice';
import { clearChannels, setSelectedChannel, selectSelectedChannel } from '@features/channel/channelSlice';
import { clearDMs, setSelectedDm, selectSelectedDm } from '@features/dm/dmSlice';
import { clearMessages } from '@features/message/messageSlice';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectSetting, updateSetting, setMinimized, setKofiOverlayOpen, selectSidebarView,
  setDialogOpen,
} from '@features/app/appSlice';
import TopBarBotSpot from '@components/welcome/TopBarBotSpot';
import { selectIsHeavyOperationRunning, selectOperationSummary } from '@features/app/operationSelectors';
import { reopenAnnouncement, fetchAnnouncementMarkdownThunk } from '@features/announcement/announcementSlice';
import { isOverlayMode, closeOverlay, minimizeOverlay } from '@/extension/messaging';
import {
  selectIsSupporter,
} from '@features/supporter/supporterSlice';
import AppearanceButton from '@components/appearance/AppearanceButton';
import CompatibilityPopover, { CompatibilitySheet } from '@components/compatibility/CompatibilityPopover';
import { InfoOutlined as CompatibilityIcon } from '@mui/icons-material';
import { BleedingStack } from '@components/supporter/BleedingTitle';
import { isBleedingEdgeBuild } from '@services/hostedGate';
import UserProfileModal from '@components/modals/UserProfileModal';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import IdeasContactDialog from '@components/dialogs/IdeasContactDialog';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import { useHotkey } from '@features/hotkeys/HotkeyProvider';
import { selectIsMinimized } from '@features/app/appSlice';
import { useTranslation } from 'react-i18next';

interface TopBarProps {
  /** Opens the navigation drawer; the hamburger only renders below `md`. */
  onMenuClick?: () => void;
}

/** Tight inner gap for a group of icon buttons on the bar. */
const GROUP_SX = { display: 'flex', alignItems: 'center', gap: 0.25 } as const;

/** Thin vertical rule between icon groups. */
const SectionDivider = () => (
  <Divider orientation="vertical" flexItem sx={{ my: 1.25, borderColor: 'divider', opacity: 0.7 }} />
);

/**
 * TopBar component - shows user info and logout button
 */
const TopBar = ({ onMenuClick }: TopBarProps = {}) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const theme = useTheme();
  // `md` and below: hamburger for the sidebar drawer. `sm` and below:
  // compact bar (no username/version text; Settings + Logout live in
  // the More menu) so a 390px phone fits without horizontal scroll.
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  // `md` and up: room for everything, so Supporter Wall, r/discrub and
  // View Announcement sit inline and the More menu (which would be empty)
  // is not rendered at all.
  const isWide = useMediaQuery(theme.breakpoints.up('md'));
  // The bot spotlight needs real acreage. A window media query alone lies
  // here — the donation drawer takes 320px off the bar — so the bar's
  // middle is measured directly and the spotlight renders only when the
  // gap can actually hold it. The `lg` gate spares narrow windows the
  // observer entirely; jsdom (no ResizeObserver) keeps the default true
  // so tests exercise the spotlight under the mocked media query.
  const hasSpotRoom = useMediaQuery(theme.breakpoints.up('lg'));
  const middleRef = useRef<HTMLDivElement>(null);
  const [middleFits, setMiddleFits] = useState(true);
  useLayoutEffect(() => {
    const el = middleRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // ~400px holds the spot with the tagline ellipsizing; below that the
    // card collapses into its buttons and the bar is better off bare.
    const measure = () => setMiddleFits(el.offsetWidth >= 400);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const currentUser = useAppSelector(selectCurrentUser);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedDm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const showKofiFeed = useAppSelector(selectSetting(DiscrubSetting.APP_SHOW_KOFI_FEED));
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const operationSummary = useAppSelector(selectOperationSummary);
  const isSupporter = useAppSelector(selectIsSupporter);
  const [compatOpen, setCompatOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);

  const handleGoHome = () => {
    dispatch(setSelectedGuild(null));
    dispatch(setSelectedChannel(null));
    dispatch(setSelectedDm(null));
  };

  const handleViewAnnouncement = () => {
    dispatch(fetchAnnouncementMarkdownThunk());
    dispatch(reopenAnnouncement());
  };

  const handleToggleKofi = () => {
    if (isMobile) {
      // Phone: open the wall as an overlay; the persisted column setting is untouched.
      dispatch(setKofiOverlayOpen(true));
      return;
    }
    dispatch(
      updateSetting({
        key: DiscrubSetting.APP_SHOW_KOFI_FEED,
        value: showKofiFeed === 'true' ? 'false' : 'true',
      }),
    );
  };

  const handleLogout = () => {
    dispatch(clearToken());
    // #249: a remembered token must not outlive an explicit sign-out.
    dispatch(forgetRememberedToken());
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
      <Toolbar sx={{ gap: { xs: 1, sm: 2 }, minWidth: 0, overflow: 'hidden' }}>
        {isMobile && onMenuClick && (
          <IconButton
            color="inherit"
            edge="start"
            onClick={onMenuClick}
            aria-label={t('topbar.openNavigation')}
            data-testid="sidebar-menu-button"
            sx={{ mr: -0.5 }}
          >
            <MenuIcon />
          </IconButton>
        )}
        {/* Discrub Icon — click to return to WelcomePanel */}
        <Tooltip title={t('topbar.home')} enterDelay={0} arrow>
          <Box
            component="img"
            src="/discrub.png"
            alt={t('topbar.homeAlt')}
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

        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {isBleedingEdgeBuild() ? (
            /* Hosted build (and local dev): the wordmark keeps bleeding after sign-in, scaled to the bar. */
            <BleedingStack size="bar" />
          ) : (
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
          )}
          <Typography
            variant="caption"
            sx={{
              display: isCompact ? 'none' : undefined,
              color: (theme: Theme) => alpha(theme.palette.primary.main, 0.7),
              fontWeight: 500,
              fontSize: '0.7rem',
              letterSpacing: '0.5px',
              ml: 0.5,
              alignSelf: isBleedingEdgeBuild() ? 'flex-end' : undefined,
              mb: isBleedingEdgeBuild() ? '1px' : undefined,
            }}
          >
            v{__APP_VERSION__}
          </Typography>
        </Box>

        {/* The bar's flexible middle. Away from the welcome screen (the
            corkboard's home) it carries the compact bot spotlight; it
            steps aside whenever a heavy operation needs the user's eyes,
            and only bars 1200px and up have the room for it at all. */}
        <Box ref={middleRef} sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, px: 1, overflow: 'hidden' }}>
          {hasSpotRoom &&
            middleFits &&
            currentUser &&
            !isOperationRunning &&
            (Boolean(selectedChannel || selectedDm) || sidebarView === 'package') && <TopBarBotSpot />}
        </Box>

        {currentUser && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1.5 }, flexShrink: 0 }}>
            <Box
              onClick={handleProfileClick}
              data-tour="user-profile"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                padding: { xs: '4px', sm: '4px 12px' },
                borderRadius: '4px',
                transition: 'background-color 200ms ease',
                '&:hover': {
                  backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.1),
                },
              }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <Avatar
                  src={
                    currentUser.avatar
                      ? `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png`
                      : undefined
                  }
                  data-supporter-ring={isSupporter || undefined}
                  sx={{
                    width: 36,
                    height: 36,
                    // Supporter ring: the avatar border tints to the theme's
                    // CTA accent while a valid key is present.
                    border: (theme: Theme) =>
                      `2px solid ${isSupporter ? theme.palette.cta.main : alpha(theme.palette.primary.main, 0.3)}`,
                    transition: 'border-color 200ms ease',
                  }}
                >
                  {currentUser.username?.[0]?.toUpperCase()}
                </Avatar>
                {isSupporter && (
                  <Box
                    data-testid="supporter-avatar-pip"
                    sx={(theme: Theme) => ({
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      bgcolor: 'background.paper',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${alpha(theme.palette.cta.main, 0.5)}`,
                    })}
                  >
                    <StarIcon sx={{ fontSize: 10, color: 'cta.main' }} />
                  </Box>
                )}
              </Box>
              <Typography
                variant="body2"
                noWrap
                sx={{
                  display: isCompact ? 'none' : undefined,
                  transition: 'color 200ms ease',
                }}
              >
                {currentUser.global_name || currentUser.username}
              </Typography>
            </Box>

            {/* Layouts and themes in one menu (2.2.0). Replaces the palette icon; the Themes and Support hub opens from its footer. */}
            <AppearanceButton onOpenSettings={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} />

            {/* App group: Ideas, Compatibility, Settings. Groups are separated
                by thin dividers with a tight gap inside each one. */}
            {!isCompact && <SectionDivider />}
            {!isCompact && (
              <Box data-testid="topbar-group-app" sx={GROUP_SX}>
              <Tooltip title={t('topbar.ideasAndContact')} enterDelay={0} arrow>
                <IconButton
                  color="inherit"
                  onClick={() => setIdeasOpen(true)}
                  aria-label={t('topbar.ideasAndContact')}
                  data-testid="topbar-ideas"
                >
                  <IdeasIcon />
                </IconButton>
              </Tooltip>
              <CompatibilityPopover placement="topbar" />
              <HotkeyTooltip actionId="openSettings" label={t('topbar.settings')} enterDelay={0} arrow>
                <IconButton
                  color="inherit"
                  onClick={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))}
                  aria-label={t('topbar.settings')}
                >
                  <SettingsIcon />
                </IconButton>
              </HotkeyTooltip>
              </Box>
            )}

            {/* Everything below folds into the More menu when the bar gets
                narrow; the wrapper keeps one tour target either way. */}
            <SectionDivider />
            <Box data-tour="topbar-extras" data-testid="topbar-group-community" sx={GROUP_SX}>
              {isWide && (
                <>
                  <Tooltip title={t('topbar.supporterWall')} enterDelay={0} arrow>
                    <IconButton
                      color="inherit"
                      onClick={handleToggleKofi}
                      aria-label={t('topbar.supporterWall')}
                      aria-pressed={showKofiFeed === 'true'}
                      data-testid="topbar-supporter-wall"
                    >
                      <Box
                        component="img"
                        src="/kofi.svg"
                        alt=""
                        sx={{
                          width: 22,
                          height: 22,
                          filter: showKofiFeed === 'true' ? 'none' : 'grayscale(1)',
                          opacity: showKofiFeed === 'true' ? 1 : 0.75,
                        }}
                      />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="r/discrub" enterDelay={0} arrow>
                    <IconButton
                      color="inherit"
                      component="a"
                      href="https://www.reddit.com/r/discrub"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="r/discrub"
                      data-testid="topbar-reddit"
                    >
                      <RedditIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('topbar.viewAnnouncement')} enterDelay={0} arrow>
                    <IconButton
                      color="inherit"
                      onClick={handleViewAnnouncement}
                      aria-label={t('topbar.viewAnnouncement')}
                      data-testid="topbar-announcement"
                    >
                      <AnnouncementIcon />
                    </IconButton>
                  </Tooltip>
                </>
              )}

              {!isWide && (
                <Tooltip title={t('topbar.more')} enterDelay={0} arrow>
                  <IconButton
                    color="inherit"
                    onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
                    aria-label={t('topbar.moreOptions')}
                  >
                    <MoreIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            <Menu
              anchorEl={moreMenuAnchor}
              open={Boolean(moreMenuAnchor)}
              onClose={() => setMoreMenuAnchor(null)}
              PaperProps={{ sx: { bgcolor: 'background.paper', minWidth: 200 } }}
            >
              <MenuItem
                onClick={() => {
                  handleToggleKofi();
                  setMoreMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <Box
                    component="img"
                    src="/kofi.svg"
                    alt="Ko-Fi"
                    sx={{
                      width: 20,
                      height: 20,
                      filter: showKofiFeed === 'true' ? 'none' : 'grayscale(1)',
                    }}
                  />
                </ListItemIcon>
                <ListItemText>{t('topbar.supporterWall')}</ListItemText>
              </MenuItem>
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
              {isCompact && (
                <MenuItem
                  onClick={() => {
                    setIdeasOpen(true);
                    setMoreMenuAnchor(null);
                  }}
                  data-testid="more-menu-ideas"
                >
                  <ListItemIcon>
                    <IdeasIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t('topbar.ideasAndContact')}</ListItemText>
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  handleViewAnnouncement();
                  setMoreMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <AnnouncementIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('topbar.viewAnnouncement')}</ListItemText>
              </MenuItem>
              {isCompact && <Divider />}
              {isCompact && (
                <MenuItem
                  onClick={() => {
                    setMoreMenuAnchor(null);
                    setCompatOpen(true);
                  }}
                  data-testid="more-menu-compatibility"
                >
                  <ListItemIcon>
                    <CompatibilityIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t('topbar.compatibility')}</ListItemText>
                </MenuItem>
              )}
              {isCompact && (
                <MenuItem
                  onClick={() => {
                    dispatch(setDialogOpen({ dialog: 'settings', open: true }));
                    setMoreMenuAnchor(null);
                  }}
                  data-testid="more-menu-settings"
                >
                  <ListItemIcon>
                    <SettingsIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t('topbar.settings')}</ListItemText>
                </MenuItem>
              )}
              {isCompact && (
                <MenuItem
                  onClick={() => {
                    setMoreMenuAnchor(null);
                    handleLogout();
                  }}
                  data-testid="more-menu-logout"
                >
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t('topbar.logout')}</ListItemText>
                </MenuItem>
              )}
            </Menu>

            {!isCompact && <SectionDivider />}
            {!isCompact && (
            <Tooltip title={t('topbar.logout')} enterDelay={0} arrow>
              <IconButton
                color="inherit"
                onClick={handleLogout}
                aria-label={t('topbar.logout')}
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
            )}

            {isOverlayMode() && (
              <HotkeyTooltip actionId="minimize" label={t('topbar.minimizeToDiscord')} enterDelay={0} arrow>
                <IconButton
                  color="inherit"
                  onClick={handleMinimize}
                  aria-label={t('topbar.minimizeDiscrub')}
                >
                  <MinimizeIcon />
                </IconButton>
              </HotkeyTooltip>
            )}

            {isOverlayMode() && (
              <Tooltip title={t('topbar.closeDiscrub')} enterDelay={0} arrow>
                <IconButton
                  color="inherit"
                  onClick={() => isOperationRunning ? setCloseDialogOpen(true) : handleCloseConfirm()}
                  aria-label={t('topbar.closeDiscrub')}
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

      <CompatibilitySheet open={compatOpen} onClose={() => setCompatOpen(false)} />
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
            {t('topbar.operationInProgress')}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {operationSummary.label}
          </Typography>
          <Typography variant="body2" color="warning.main" sx={{ mb: 3 }}>
            {t('topbar.closingCancels')}
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
            <Typography variant="body2">{t('topbar.closeAnyway')}</Typography>
          </Box>
        </DialogContent>
      </Dialog>

      <IdeasContactDialog open={ideasOpen} onClose={() => setIdeasOpen(false)} />
    </AppBar>
  );
};

export default TopBar;
