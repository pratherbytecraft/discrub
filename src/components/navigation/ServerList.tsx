import { useEffect, useMemo, useState } from 'react';
import {
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Box,
  Typography,
  Tooltip,
  Checkbox,
} from '@mui/material';
import GuildAvatar from '@/components/ui/GuildAvatar';
import {
  Folder as FolderIcon,
  Verified as VerifiedIcon,
  Star as OwnerIcon,
  CheckBox as SelectModeIcon,
  CheckBoxOutlineBlank as SelectModeOffIcon,
} from '@mui/icons-material';
import type { Guild } from 'discrub-core/types/discord-types';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  selectGuilds,
  selectSelectedGuild,
  selectGuildLoading,
  selectSelectedGuilds,
  fetchCurrentMember,
  fetchRoles,
  setSelectedGuild,
  toggleGuildSelection,
  selectAllGuilds,
  deselectAllGuilds,
} from '@features/guild/guildSlice';
import { fetchChannels, setSelectedChannel } from '@features/channel/channelSlice';
import { clearMessages } from '@features/message/messageSlice';
import { addStatusEntry, showToast } from '@features/status/statusSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import ListSkeleton from '@components/ui/ListSkeleton';
import EmptyState from '@components/ui/EmptyState';
import TourButton from '@components/welcome/TourButton';
import MultiSelectControls from './MultiSelectControls';
import { useLoadGuilds } from '@/hooks/useLoadGuilds';
import BulkPurgeDialog from '@containers/PurgeView/BulkPurgeDialog';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 50;

interface ServerListProps {
  filterText?: string;
}

/**
 * ServerList component - displays all guilds/servers
 */
const ServerList = ({ filterText = '' }: ServerListProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const guilds = useAppSelector(selectGuilds);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const selectedGuilds = useAppSelector(selectSelectedGuilds);
  const isLoading = useAppSelector(selectGuildLoading);
  const token = useAppSelector(selectAuthToken);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  // #255 — multi-server purge dialog
  const [serverPurgeOpen, setServerPurgeOpen] = useState(false);

  // Filter guilds by name
  const filteredGuilds = useMemo(() => {
    if (!filterText.trim()) return guilds;

    const searchLower = filterText.toLowerCase().trim();
    return guilds.filter((guild) =>
      guild.name?.toLowerCase().includes(searchLower)
    );
  }, [guilds, filterText]);

  const visible = filteredGuilds.slice(0, visibleCount);

  useLoadGuilds();

  // Reset visible count when filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterText]);

  // Scroll-to-load: listen on nearest scrollable ancestor
  useEffect(() => {
    if (visibleCount >= filteredGuilds.length) return;

    const handleScroll = () => {
      const scrollEl = document.querySelector('[data-server-scroll]');
      if (!scrollEl) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        setVisibleCount((prev) => prev + PAGE_SIZE);
      }
    };

    const scrollEl = document.querySelector('[data-server-scroll]');
    scrollEl?.addEventListener('scroll', handleScroll);
    return () => scrollEl?.removeEventListener('scroll', handleScroll);
  }, [visibleCount, filteredGuilds.length]);

  const handleGuildClick = async (guild: Guild) => {
    if (!token) return;

    if (multiSelectMode) {
      dispatch(toggleGuildSelection(guild));
      return;
    }

    // Clear previous server's state before loading new server
    dispatch(setSelectedChannel(null));
    dispatch(clearMessages());
    dispatch(setSelectedGuild(guild));
    dispatch(addStatusEntry({ level: 'info', message: t('nav.loadingServer', { name: guild.name }) }));
    // Fetch channels, current member roles, and guild roles in parallel
    dispatch(fetchCurrentMember({ guildId: guild.id, token }));
    dispatch(fetchRoles({ guildId: guild.id, token }));
    await dispatch(fetchChannels({ guildId: guild.id, token }));
  };

  const handleCopySelectedNames = () => {
    const names = selectedGuilds
      .map((guild) => guild.name)
      .filter(Boolean)
      .join('\n');
    if (!names) return;
    navigator.clipboard.writeText(names);
    dispatch(showToast({ level: 'success', message: t('nav.copiedToClipboard') }));
  };

  const handleToggleMultiSelect = () => {
    if (multiSelectMode) {
      dispatch(deselectAllGuilds());
    }
    setMultiSelectMode(!multiSelectMode);
  };

  const isGuildSelected = (guild: Guild) =>
    selectedGuilds.some((g) => g.id === guild.id);

  if (isLoading) {
    return <ListSkeleton rows={6} avatar />;
  }

  if (filteredGuilds.length === 0 && filterText.trim()) {
    return <EmptyState message={t('nav.noServersMatching', { filter: filterText })} icon={<FolderIcon />} />;
  }

  if (filteredGuilds.length === 0) {
    return <EmptyState message={t('nav.noServersFound')} icon={<FolderIcon />} />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            color: 'text.secondary',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {t('nav.servers')}
        </Typography>
        <TourButton
          stepKey="multi-select-toggle"
          size="small"
          onClick={handleToggleMultiSelect}
          variant={multiSelectMode ? 'contained' : 'outlined'}
          color={multiSelectMode ? 'primary' : 'inherit'}
          aria-label={t('nav.toggleMultiSelect')}
          data-tour="multi-select-toggle"
          startIcon={multiSelectMode ? <SelectModeIcon fontSize="small" /> : <SelectModeOffIcon fontSize="small" />}
          sx={{ textTransform: 'none', minWidth: 0, px: 1, fontSize: '0.75rem', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <Box component="span" className="multi-select-label">{t('nav.multiSelect')}</Box>
        </TourButton>
      </Box>

      <MultiSelectControls
        active={multiSelectMode}
        selectedCount={selectedGuilds.length}
        totalCount={filteredGuilds.length}
        allSelected={filteredGuilds.length > 0 && selectedGuilds.length === filteredGuilds.length}
        onToggleAll={() =>
          dispatch(
            filteredGuilds.length > 0 && selectedGuilds.length === filteredGuilds.length
              ? deselectAllGuilds()
              : selectAllGuilds(filteredGuilds),
          )
        }
        onPurge={() => setServerPurgeOpen(true)}
        onCopyNames={handleCopySelectedNames}
        noun="servers"
      />

      <BulkPurgeDialog
        open={serverPurgeOpen}
        onClose={() => setServerPurgeOpen(false)}
        channels={[]}
        guilds={selectedGuilds}
        mode="servers"
      />

      <List>
        {visible.map((guild) => (
          <ListItemButton
            key={guild.id}
            selected={multiSelectMode ? isGuildSelected(guild) : selectedGuild?.id === guild.id}
            onClick={() => handleGuildClick(guild)}
            sx={{
              transition: 'opacity 200ms ease',
              ...(!multiSelectMode && selectedGuild && selectedGuild.id !== guild.id && {
                opacity: 0.4,
                '&:hover': {
                  opacity: 0.6,
                },
              }),
            }}
          >
            {multiSelectMode && (
              <Checkbox
                size="small"
                checked={isGuildSelected(guild)}
                tabIndex={-1}
                disableRipple
                sx={{ p: 0, mr: 1 }}
              />
            )}
            <ListItemAvatar>
              <GuildAvatar guild={guild} size={40} />
            </ListItemAvatar>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" noWrap sx={{ fontSize: '0.9rem' }}>
                    {guild.name}
                  </Typography>
                  {guild.owner && (
                    <Tooltip title={t('nav.youOwnThisServer')} enterDelay={0} arrow>
                      <OwnerIcon sx={{ fontSize: 13, color: '#ffd700', flexShrink: 0 }} />
                    </Tooltip>
                  )}
                  {guild.features?.includes('VERIFIED') && (
                    <Tooltip title={t('nav.verifiedServer')} enterDelay={0} arrow>
                      <VerifiedIcon sx={{ fontSize: 13, color: 'primary.main', flexShrink: 0 }} />
                    </Tooltip>
                  )}
                  {guild.features?.includes('PARTNERED') && !guild.features?.includes('VERIFIED') && (
                    <Tooltip title={t('nav.partneredServer')} enterDelay={0} arrow>
                      <VerifiedIcon sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
                    </Tooltip>
                  )}
                </Box>
              }
            />
          </ListItemButton>
        ))}
      </List>

    </Box>
  );
};

export default ServerList;
