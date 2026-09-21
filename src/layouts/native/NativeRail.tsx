import { Box, Tooltip, alpha, useTheme } from '@mui/material';
import { AlternateEmail as DmIcon, Inventory2Outlined as PackageIcon, Settings as SettingsIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setDialogOpen, setSidebarView } from '@features/app/appSlice';
import { selectGuilds, selectSelectedGuild, setSelectedGuild, fetchRoles, fetchCurrentMember } from '@features/guild/guildSlice';
import { fetchChannels, setSelectedChannel } from '@features/channel/channelSlice';
import { clearMessages } from '@features/message/messageSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import GuildAvatar from '@components/ui/GuildAvatar';
import { useLoadGuilds } from '@/hooks/useLoadGuilds';
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
          position: 'relative', width: 48, height: 48, flexShrink: 0, borderRadius: active ? 4 : '50%', border: 0, p: 0, cursor: 'pointer',
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

/** Server rail (Native): DMs and the data package, then every server, and Settings at the bottom. */
const NativeRail = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const guilds = useAppSelector(selectGuilds);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const sidebarView = useAppSelector(selectSidebarView);
  const token = useAppSelector(selectAuthToken);
  const [view, setView] = [sidebarView, (v: 'server' | 'package') => dispatch(setSidebarView(v))];

  useLoadGuilds();

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
      sx={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 1.5, overflow: 'hidden', backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.25 : 0.06) }}
    >
      {/* DMs and the package sit above the servers and Settings below, all pinned. Only the servers scroll, so a long list never squeezes or hides the fixed buttons. */}
      <RailButton label={t('sidebar.tabDms')} active={view === 'server' && !selectedGuild} onClick={() => { setView('server'); dispatch(setSelectedGuild(null)); }} testId="rail-dms" tour="dms-tab">
        <DmIcon />
      </RailButton>
      <RailButton label={t('sidebar.tabPackage')} active={view === 'package'} onClick={() => setView('package')} testId="rail-package" tour="package-tab">
        <PackageIcon />
      </RailButton>
      <Box sx={{ width: 32, height: 2, borderRadius: 1, backgroundColor: 'divider', flexShrink: 0 }} />
      <Box
        data-tour="servers-tab"
        data-testid="rail-servers"
        sx={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 0.25, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
      >
        {guilds.map((g) => (
          <RailButton key={g.id} label={g.name} active={view === 'server' && selectedGuild?.id === g.id} onClick={() => void pickGuild(g)} testId={`rail-guild-${g.id}`}>
            <GuildAvatar guild={g} size={48} />
          </RailButton>
        ))}
      </Box>
      <Box sx={{ width: 32, height: 2, borderRadius: 1, backgroundColor: 'divider', flexShrink: 0 }} />
      <RailButton label={t('settings.title')} onClick={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} testId="rail-settings">
        <SettingsIcon />
      </RailButton>
    </Box>
  );
};

export default NativeRail;
