import { Box, Tooltip, alpha, useTheme } from '@mui/material';
import { AlternateEmail as DmIcon, Inventory2Outlined as PackageIcon, Settings as SettingsIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setSidebarView } from '@features/app/appSlice';
import { selectGuilds, selectSelectedGuild, setSelectedGuild, fetchRoles, fetchCurrentMember } from '@features/guild/guildSlice';
import { fetchChannels, setSelectedChannel } from '@features/channel/channelSlice';
import { clearMessages } from '@features/message/messageSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { setSupporterDialogOpen } from '@features/supporter/supporterSlice';
import GuildAvatar from '@components/ui/GuildAvatar';
import type { Guild } from 'discrub-core/types/discord-types';

export const RAIL_WIDTH = 72;

const RailButton = ({ label, active, onClick, children, testId, tour }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; testId?: string; tour?: string }) => {
  const theme = useTheme();
  return (
    <Tooltip title={label} placement="right" enterDelay={300} arrow>
      <Box
        component="button"
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-testid={testId}
        data-tour={tour}
        onClick={onClick}
        sx={{
          position: 'relative', width: 48, height: 48, borderRadius: active ? 4 : '50%', border: 0, p: 0, cursor: 'pointer',
          display: 'grid', placeItems: 'center', overflow: 'hidden', font: 'inherit', color: 'text.primary',
          backgroundColor: active ? 'primary.main' : alpha(theme.palette.text.primary, 0.08),
          transition: 'border-radius 150ms ease, background-color 150ms ease',
          '&:hover': { borderRadius: 4, backgroundColor: active ? 'primary.main' : alpha(theme.palette.primary.main, 0.35) },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
};

/** Server rail (Native): every server, then DMs, the data package, and Settings at the bottom. */
const NativeRail = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const guilds = useAppSelector(selectGuilds);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const sidebarView = useAppSelector(selectSidebarView);
  const token = useAppSelector(selectAuthToken);
  const [view, setView] = [sidebarView, (v: 'server' | 'package') => dispatch(setSidebarView(v))];

  // Same sequence ServerList runs on a click, so the rail behaves like the list.
  const pickGuild = async (guild: Guild) => {
    if (!token) return;
    if (view !== 'server') setView('server');
    dispatch(setSelectedChannel(null));
    dispatch(clearMessages());
    dispatch(setSelectedGuild(guild));
    dispatch(addStatusEntry({ level: 'info', message: t('nav.loadingServer', { name: guild.name }) }));
    dispatch(fetchCurrentMember({ guildId: guild.id, token }));
    dispatch(fetchRoles({ guildId: guild.id, token }));
    await dispatch(fetchChannels({ guildId: guild.id, token }));
  };

  return (
    <Box
      data-testid="native-rail"
      sx={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 1.5, overflowY: 'auto', overflowX: 'hidden', backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.25 : 0.06) }}
    >
      <Box data-tour="servers-tab" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        {guilds.map((g) => (
          <RailButton key={g.id} label={g.name} active={view === 'server' && selectedGuild?.id === g.id} onClick={() => void pickGuild(g)} testId={`rail-guild-${g.id}`}>
            <GuildAvatar guild={g} size={48} />
          </RailButton>
        ))}
      </Box>
      <Box sx={{ width: 32, height: 2, borderRadius: 1, backgroundColor: 'divider', my: 0.5 }} />
      <RailButton label={t('sidebar.tabDms')} active={view === 'server' && !selectedGuild} onClick={() => { setView('server'); dispatch(setSelectedGuild(null)); }} testId="rail-dms" tour="dms-tab">
        <DmIcon />
      </RailButton>
      <RailButton label={t('sidebar.tabPackage')} active={view === 'package'} onClick={() => setView('package')} testId="rail-package" tour="package-tab">
        <PackageIcon />
      </RailButton>
      <Box sx={{ flex: 1 }} />
      <RailButton label={t('topbar.themesAndSupport')} onClick={() => dispatch(setSupporterDialogOpen(true))} testId="rail-support">
        <SettingsIcon />
      </RailButton>
    </Box>
  );
};

export default NativeRail;
