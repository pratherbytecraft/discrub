import { Box, Button, IconButton, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { ExpandMore as ChevronIcon, BarChart as AnalyticsIcon, Settings as SettingsIcon, Fullscreen as FocusIcon, FullscreenExit as ExitFocusIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectFocusedView, selectSidebarView, setDialogOpen, toggleFocusedView } from '@features/app/appSlice';
import { selectActiveFilteredMessages } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectIsSupporter } from '@features/supporter/supporterSlice';
import AppearanceButton from '@components/appearance/AppearanceButton';
import ScrublingsStage from '@components/scrublings/ScrublingsStage';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import { getDmName } from '@/utils/dmListUtils';

/**
 * Simple's top bar: the logo with the version, a breadcrumb that is a real
 * picker (opens the navigation drawer), the Appearance button, Analytics,
 * Focus, Settings and the user chip. Stays in Focus. On a phone the wordmark
 * and the chip drop out (the chip lives in the drawer's rail there) so the
 * picker keeps its room.
 */
const SimpleTop = ({ onOpenPicker }: { onOpenPicker: () => void }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const guild = useAppSelector(selectSelectedGuild);
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const focusedView = useAppSelector(selectFocusedView);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const user = useAppSelector(selectCurrentUser);
  const isSupporter = useAppSelector(selectIsSupporter);
  const isPackage = sidebarView === 'package';
  const section = isPackage ? t('sidebar.tabPackage') : guild ? guild.name : t('sidebar.tabDms');
  const leaf = isPackage ? '' : channel ? `# ${channel.name}` : dm ? `@ ${getDmName(dm)}` : '';
  const hasContext = !isPackage && (!!channel || !!dm);
  return (
    <Box data-testid="simple-top" sx={{ display: 'flex', alignItems: 'center', gap: phone ? 0.5 : 1.25, height: 56, px: phone ? 1 : 2.5, backgroundColor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
      {!phone && <Box sx={{ width: 28, height: 28, borderRadius: 2, backgroundColor: 'primary.main', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>D</Box>}
      {!phone && (
        <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }}>Discrub</Typography>
          <Typography variant="caption" data-testid="simple-version" sx={{ color: 'text.secondary', lineHeight: 1.1 }}>{__APP_VERSION__}</Typography>
        </Box>
      )}
      {!phone && <Box sx={{ flex: 1 }} />}
      <Button
        onClick={onOpenPicker}
        data-testid="simple-picker"
        data-tour="servers-tab"
        endIcon={<ChevronIcon />}
        sx={{ textTransform: 'none', color: 'text.primary', borderRadius: 1.5, px: phone ? 1 : 1.75, backgroundColor: alpha(theme.palette.text.primary, 0.05), maxWidth: phone ? 'none' : 520, minWidth: 0, flex: phone ? 1 : 'none', flexShrink: phone ? 1 : 0, justifyContent: phone ? 'flex-start' : 'center', '&:hover': { backgroundColor: alpha(theme.palette.text.primary, 0.1) } }}
      >
        <Typography variant="body2" noWrap sx={{ color: 'text.secondary', minWidth: 0, flexShrink: 1 }}>{section}</Typography>
        {leaf && <Typography variant="body2" noWrap sx={{ mx: 1, color: 'text.secondary', flexShrink: 0 }}>›</Typography>}
        {leaf && <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flexShrink: phone ? 1 : 0 }}>{leaf}</Typography>}
      </Button>
      {!phone && <Box sx={{ flex: 1, alignSelf: 'stretch', position: 'relative', minWidth: 0 }}><ScrublingsStage /></Box>}
      <AppearanceButton onOpenSettings={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} />
      {hasContext && (
        <HotkeyTooltip actionId="openAnalytics" label={t('serverView.analytics')} arrow>
          <IconButton size="small" aria-label={t('serverView.analytics')} disabled={messages.length === 0} onClick={() => dispatch(setDialogOpen({ dialog: 'analytics', open: true }))} data-testid="simple-analytics" data-tour="analytics-button"><AnalyticsIcon /></IconButton>
        </HotkeyTooltip>
      )}
      {hasContext && (
        <HotkeyTooltip actionId="toggleFocus" label={focusedView ? t('serverView.exitFocusMode') : t('serverView.enterFocusMode')} arrow>
          <IconButton size="small" aria-label={focusedView ? t('serverView.exitFocus') : t('serverView.focus')} onClick={() => dispatch(toggleFocusedView())} data-testid="simple-focus" data-tour="focus-button">{focusedView ? <ExitFocusIcon /> : <FocusIcon />}</IconButton>
        </HotkeyTooltip>
      )}
      <Tooltip title={t('topbar.settings')} enterDelay={0} arrow>
        <IconButton size="small" aria-label={t('topbar.settings')} onClick={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} data-testid="simple-settings"><SettingsIcon /></IconButton>
      </Tooltip>
      {!phone && <Box data-tour="user-profile" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, pl: 0.5, pr: 1.25, py: 0.4, borderRadius: 4, backgroundColor: alpha(theme.palette.text.primary, 0.05) }}>
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <Box component="img" alt="" src={user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32` : undefined} sx={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid', borderColor: isSupporter ? 'cta.main' : 'transparent', backgroundColor: 'action.hover' }} />
        </Box>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500, maxWidth: 160 }}>{user?.global_name || user?.username || ''}</Typography>
      </Box>}
    </Box>
  );
};

export default SimpleTop;
