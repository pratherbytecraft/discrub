import { Box, IconButton, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setDialogOpen } from '@features/app/appSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectIsSupporter } from '@features/supporter/supporterSlice';
import AppearanceButton from '@components/appearance/AppearanceButton';
import ScrublingsStage from '@components/scrublings/ScrublingsStage';
import { getDmName } from '@/utils/dmListUtils';

/**
 * Operator's top bar: the logo with the version, a plain breadcrumb
 * (section / name, A12), the Appearance button, Settings and the user chip.
 * No Focus in Operator (A2). On a phone the wordmark and chip drop out.
 */
const OperatorTop = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const guild = useAppSelector(selectSelectedGuild);
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const user = useAppSelector(selectCurrentUser);
  const isSupporter = useAppSelector(selectIsSupporter);
  const isPackage = sidebarView === 'package';
  const section = isPackage ? t('sidebar.tabPackage') : guild ? guild.name : t('sidebar.tabDms');
  const leaf = isPackage ? '' : channel ? `# ${channel.name}` : dm ? getDmName(dm) : '';
  return (
    <Box data-testid="operator-top" sx={{ display: 'flex', alignItems: 'center', gap: phone ? 0.75 : 1.25, height: 56, px: phone ? 1 : 2.5, backgroundColor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
      <Box sx={{ width: 28, height: 28, borderRadius: 2, backgroundColor: 'primary.main', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>D</Box>
      {!phone && (
        <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }}>Discrub</Typography>
          <Typography variant="caption" data-testid="operator-version" sx={{ color: 'text.secondary', lineHeight: 1.1 }}>{__APP_VERSION__}</Typography>
        </Box>
      )}
      <Box data-testid="operator-crumb" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '0 1 auto', ml: phone ? 0 : 2 }}>
        <Typography variant="body2" noWrap sx={{ color: 'text.secondary', flexShrink: 1, minWidth: 0 }}>{section}</Typography>
        {leaf && <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>/</Typography>}
        {leaf && <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{leaf}</Typography>}
      </Box>
      <Box sx={{ flex: '1 1 0', alignSelf: 'stretch', position: 'relative', minWidth: 0 }}><ScrublingsStage /></Box>
      <AppearanceButton onOpenSettings={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} />
      <Tooltip title={t('topbar.settings')} enterDelay={0} arrow>
        <IconButton size="small" aria-label={t('topbar.settings')} onClick={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} data-testid="operator-settings"><SettingsIcon /></IconButton>
      </Tooltip>
      {!phone && <Box data-tour="user-profile" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, pl: 0.5, pr: 1.25, py: 0.4, borderRadius: 4, backgroundColor: alpha(theme.palette.text.primary, 0.05) }}>
        <Box component="img" alt="" src={user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32` : undefined} sx={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid', borderColor: isSupporter ? 'cta.main' : 'transparent', backgroundColor: 'action.hover' }} />
        <Typography variant="body2" noWrap sx={{ fontWeight: 500, maxWidth: 160 }}>{user?.global_name || user?.username || ''}</Typography>
      </Box>}
    </Box>
  );
};

export default OperatorTop;
