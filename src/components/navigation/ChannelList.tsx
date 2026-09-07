import { useMemo, useRef, useState } from 'react';
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  Divider,
  Checkbox,
} from '@mui/material';
import {
  Tag as TextChannelIcon,
  VolumeUp as VoiceChannelIcon,
  Forum as ForumIcon,
  Folder as CategoryIcon,
  CheckBox as SelectModeIcon,
  CheckBoxOutlineBlank as SelectModeOffIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as CollapseIcon,
  Lock as LockIcon,
  FolderOpenOutlined,
} from '@mui/icons-material';
import MultiSelectControls from './MultiSelectControls';
import type { Channel } from 'discrub-core/types/discord-types';
import { ChannelType } from 'discrub-core/discord-enum';
import { isMessageChannel } from '@utils/channelTypeUtils';
import TourButton from '@components/welcome/TourButton';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  selectChannels,
  selectSelectedChannel,
  selectChannelLoading,
  selectSelectedChannels,
  setSelectedChannel,
  toggleChannelSelection,
  selectAllChannels,
  deselectAllChannels,
  selectChannelsInRange,
  fetchForumThreads,
} from '@features/channel/channelSlice';
import { selectSelectedGuild, selectCurrentMemberRoles } from '@features/guild/guildSlice';
import { canAccessChannel, canManageMessages } from '@/utils/permissionUtils';
import { selectAuthToken } from '@features/auth/authSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import { fetchMessages, clearMessages } from '@features/message/messageSlice';
import { addStatusEntry, showToast } from '@features/status/statusSlice';
import { setSelectedDm } from '@features/dm/dmSlice';
import ListSkeleton from '@components/ui/ListSkeleton';
import EmptyState from '@components/ui/EmptyState';
import BulkExportDialog from '@containers/ExportView/BulkExportDialog';
import BulkPurgeDialog from '@containers/PurgeView/BulkPurgeDialog';
import BulkEditDialog from '@containers/PurgeView/BulkEditDialog';
import { useTranslation } from 'react-i18next';

interface ChannelListProps {
  filterText?: string;
}

/**
 * ChannelList component - displays channels for selected guild
 */
const ChannelList = ({ filterText = '' }: ChannelListProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const channels = useAppSelector(selectChannels);
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedChannels = useAppSelector(selectSelectedChannels);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const memberRoles = useAppSelector(selectCurrentMemberRoles);
  const currentUserId = useAppSelector(selectCurrentUser)?.id;
  const isLoading = useAppSelector(selectChannelLoading);
  const token = useAppSelector(selectAuthToken);
  const guildPermissions = selectedGuild?.permissions;

  // Guild-level MANAGE_MESSAGES check (ignoring per-channel overwrites — conservative for multi-channel ops)
  const hasManageMessages = useMemo(() => {
    if (!selectedGuild?.id || !guildPermissions) return false;
    const dummyChannel = { id: '', type: 0 } as import('discrub-core/types/discord-types').Channel;
    return canManageMessages(guildPermissions, memberRoles, dummyChannel, selectedGuild.id);
  }, [guildPermissions, memberRoles, selectedGuild?.id]);

  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [bulkExportOpen, setBulkExportOpen] = useState(false);
  const [bulkPurgeOpen, setBulkPurgeOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // #218: Shift+Click range anchor — id of the last plainly-clicked row in
  // multi-select mode. Stored by id (not index) so filtering/collapsing
  // between clicks can't shift the anchor onto a different channel.
  const rangeAnchorIdRef = useRef<string | null>(null);

  const handleChannelClick = async (channel: Channel, event?: React.MouseEvent) => {
    if (!token || !selectedGuild) return;

    // Only allow channels that contain fetchable messages (see
    // MESSAGE_CHANNEL_TYPES in channelTypeUtils, backlog #160).
    if (!isMessageChannel(channel)) {
      return;
    }

    if (multiSelectMode) {
      // #218: Shift+Click selects the whole visible range between the last
      // plainly-clicked row (anchor) and this one. Plain click toggles and
      // re-anchors, like a file explorer.
      if (event?.shiftKey && rangeAnchorIdRef.current) {
        const anchorIdx = visibleOrderedChannels.findIndex(
          (c) => c.id === rangeAnchorIdRef.current,
        );
        const clickIdx = visibleOrderedChannels.findIndex((c) => c.id === channel.id);
        if (anchorIdx !== -1 && clickIdx !== -1) {
          const [from, to] =
            anchorIdx <= clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
          dispatch(selectChannelsInRange(visibleOrderedChannels.slice(from, to + 1)));
          return;
        }
      }
      dispatch(toggleChannelSelection(channel));
      rangeAnchorIdRef.current = channel.id;
      return;
    }

    // Normal single-select navigation
    dispatch(setSelectedDm(null));
    dispatch(clearMessages());
    dispatch(setSelectedChannel(channel));
    const isForumType = channel.type === ChannelType.GUILD_FORUM || channel.type === ChannelType.GUILD_MEDIA;
    dispatch(addStatusEntry({ level: 'info', message: isForumType ? t('nav.loadingForumPostsFor', { name: channel.name }) : t('nav.loadingMessagesFor', { name: channel.name }) }));

    // Forum/media channels: fetch threads instead of messages
    if (isForumType) {
      await dispatch(
        fetchForumThreads({
          channelId: channel.id,
          token,
        })
      );
    } else {
      await dispatch(
        fetchMessages({
          guildId: selectedGuild.id,
          channelId: channel.id,
          token,
        })
      );
    }
  };

  const handleCopySelectedNames = () => {
    const names = selectedChannels
      .map((ch) => ch.name)
      .filter(Boolean)
      .join('\n');
    if (!names) return;
    navigator.clipboard.writeText(names);
    dispatch(showToast({ level: 'success', message: t('nav.copiedToClipboard') }));
  };

  const handleToggleMultiSelect = () => {
    if (multiSelectMode) {
      dispatch(deselectAllChannels());
    }
    rangeAnchorIdRef.current = null;
    setMultiSelectMode(!multiSelectMode);
  };

  const getChannelIcon = (type: ChannelType) => {
    switch (type) {
      case ChannelType.GUILD_TEXT:
      case ChannelType.GUILD_ANNOUNCEMENT:
        return <TextChannelIcon fontSize="small" />;
      case ChannelType.GUILD_VOICE:
      case ChannelType.GUILD_STAGE_VOICE:
        return <VoiceChannelIcon fontSize="small" />;
      case ChannelType.GUILD_FORUM:
      case ChannelType.GUILD_MEDIA:
        return <ForumIcon fontSize="small" />;
      case ChannelType.GUILD_CATEGORY:
        return <CategoryIcon fontSize="small" />;
      default:
        return <TextChannelIcon fontSize="small" />;
    }
  };

  // Channel types that support fetching messages — see #160 note above
  // on `handleChannelClick` for why voice + stage are included.
  const messageChannelTypes = [
    ChannelType.GUILD_TEXT,
    ChannelType.GUILD_ANNOUNCEMENT,
    ChannelType.GUILD_FORUM,
    ChannelType.GUILD_MEDIA,
    ChannelType.GUILD_VOICE,
    ChannelType.GUILD_STAGE_VOICE,
  ];
  const textChannels = channels.filter((ch) => messageChannelTypes.includes(ch.type));

  const filteredChannels = useMemo(() => {
    if (!filterText.trim()) return textChannels;

    const searchLower = filterText.toLowerCase().trim();
    return textChannels.filter((channel) =>
      channel.name?.toLowerCase().includes(searchLower)
    );
  }, [textChannels, filterText]);

  // Channels eligible for "Select all" in multi-select mode: anything
  // the user has VIEW_CHANNEL + READ_MESSAGE_HISTORY for. Voice/stage
  // are now included since their embedded text chat uses the same
  // permission gate as text channels (#160).
  const accessibleChannels = useMemo(() => {
    return filteredChannels.filter((ch) =>
      canAccessChannel(guildPermissions, memberRoles, ch, selectedGuild?.id || '', currentUserId),
    );
  }, [filteredChannels, guildPermissions, memberRoles, selectedGuild?.id, currentUserId]);

  // Build category map from all channels (including type 4 categories)
  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    channels.forEach((ch) => {
      if (ch.type === ChannelType.GUILD_CATEGORY) {
        map[ch.id] = ch.name || t('nav.unknownCategory');
      }
    });
    return map;
  }, [channels, t]);

  // Group filtered channels by category
  const groupedChannels = useMemo(() => {
    const groups: { categoryId: string | null; categoryName: string; channels: Channel[] }[] = [];
    const byCategory: Record<string, Channel[]> = {};
    const uncategorized: Channel[] = [];

    filteredChannels.forEach((ch) => {
      const parentId = (ch as any).parent_id;
      if (parentId && categoryMap[parentId]) {
        if (!byCategory[parentId]) byCategory[parentId] = [];
        byCategory[parentId].push(ch);
      } else {
        uncategorized.push(ch);
      }
    });

    // Add uncategorized channels first
    if (uncategorized.length > 0) {
      groups.push({ categoryId: null, categoryName: '', channels: uncategorized });
    }

    // Add categorized groups sorted by category position
    const categoryOrder = channels
      .filter((ch) => ch.type === ChannelType.GUILD_CATEGORY)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    categoryOrder.forEach((cat) => {
      if (byCategory[cat.id] && byCategory[cat.id].length > 0) {
        groups.push({
          categoryId: cat.id,
          categoryName: categoryMap[cat.id],
          channels: byCategory[cat.id].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        });
      }
    });

    return groups;
  }, [filteredChannels, categoryMap, channels]);

  // #218: the flattened row order the user actually sees — grouped by
  // category, collapsed categories excluded, inaccessible channels excluded.
  // Shift+Click ranges are computed over this list so "from here to there"
  // means exactly the rows between the two clicks.
  const visibleOrderedChannels = useMemo(() => {
    const list: Channel[] = [];
    groupedChannels.forEach((group) => {
      if (group.categoryId && collapsedCategories.has(group.categoryId)) return;
      group.channels.forEach((ch) => {
        if (
          canAccessChannel(
            guildPermissions,
            memberRoles,
            ch,
            selectedGuild?.id || '',
            currentUserId,
          )
        ) {
          list.push(ch);
        }
      });
    });
    return list;
  }, [groupedChannels, collapsedCategories, guildPermissions, memberRoles, selectedGuild?.id, currentUserId]);

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  if (!selectedGuild) {
    return <EmptyState message={t('nav.selectServerForChannels')} icon={<FolderOpenOutlined fontSize="inherit" />} />;
  }

  if (isLoading) {
    return <ListSkeleton rows={8} icon />;
  }

  if (channels.length === 0) {
    return <EmptyState message={t('nav.noChannelsFound')} icon={<TextChannelIcon />} />;
  }

  if (filteredChannels.length === 0 && filterText.trim()) {
    return (
      <Box>
        <Typography
          variant="caption"
          sx={{
            px: 2,
            py: 1,
            display: 'block',
            color: 'text.secondary',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {t('nav.channels')}
        </Typography>
        <Divider />
        <EmptyState
          message={t('nav.noChannelsMatching', { filter: filterText })}
          icon={<TextChannelIcon />}
        />
      </Box>
    );
  }

  const isChannelSelected = (channel: Channel) =>
    selectedChannels.some((c) => c.id === channel.id);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1 }}>
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            color: 'text.secondary',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {t('nav.channels')}
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
          sx={{ textTransform: 'none', minWidth: 0, px: 1, fontSize: '0.75rem' }}
        >
          {t('nav.multiSelect')}
        </TourButton>
      </Box>

      <MultiSelectControls
        active={multiSelectMode}
        selectedCount={selectedChannels.length}
        totalCount={accessibleChannels.length}
        allSelected={accessibleChannels.length > 0 && selectedChannels.length === accessibleChannels.length}
        onToggleAll={() =>
          dispatch(
            accessibleChannels.length > 0 && selectedChannels.length === accessibleChannels.length
              ? deselectAllChannels()
              : selectAllChannels(accessibleChannels),
          )
        }
        onExport={() => setBulkExportOpen(true)}
        onPurge={() => setBulkPurgeOpen(true)}
        onEdit={() => setBulkEditOpen(true)}
        onCopyNames={handleCopySelectedNames}
        noun="channels"
      />

      <Divider />
      <List dense>
        {groupedChannels.map((group) => (
          <Box key={group.categoryId || '__uncategorized__'}>
            {group.categoryId && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  px: 1,
                  pt: 1.5,
                  pb: 0.25,
                  cursor: 'pointer',
                  '&:hover': { color: 'text.primary' },
                  color: 'text.secondary',
                }}
                onClick={() => toggleCategory(group.categoryId!)}
              >
                {collapsedCategories.has(group.categoryId) ? (
                  <CollapseIcon sx={{ fontSize: 14, mr: 0.25 }} />
                ) : (
                  <ExpandMoreIcon sx={{ fontSize: 14, mr: 0.25 }} />
                )}
                <Typography
                  variant="caption"
                  sx={{
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    letterSpacing: '0.02em',
                  }}
                >
                  {group.categoryName}
                </Typography>
              </Box>
            )}
            {(!group.categoryId || !collapsedCategories.has(group.categoryId)) &&
              group.channels.map((channel) => {
                const hasAccess = canAccessChannel(
                  guildPermissions,
                  memberRoles,
                  channel,
                  selectedGuild?.id || '',
                  currentUserId,
                );

                return (
                <ListItemButton
                  key={channel.id}
                  selected={multiSelectMode ? isChannelSelected(channel) : selectedChannel?.id === channel.id}
                  onClick={(e) => hasAccess && handleChannelClick(channel, e)}
                  // Shift+Click must not smear a text selection across rows.
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                  disabled={!hasAccess}
                  sx={{
                    ...(!hasAccess && {
                      opacity: 0.4,
                      cursor: 'default',
                    }),
                  }}
                >
                  {multiSelectMode && hasAccess && (
                    <Checkbox
                      size="small"
                      checked={isChannelSelected(channel)}
                      tabIndex={-1}
                      disableRipple
                      sx={{ p: 0, mr: 1 }}
                    />
                  )}
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    {hasAccess ? getChannelIcon(channel.type) : <LockIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
                  </ListItemIcon>
                  <ListItemText
                    primary={channel.name}
                    primaryTypographyProps={{
                      noWrap: true,
                      fontSize: '0.875rem',
                    }}
                  />
                </ListItemButton>
                );
              })}
          </Box>
        ))}
      </List>

      <BulkExportDialog
        open={bulkExportOpen}
        onClose={() => setBulkExportOpen(false)}
        channels={selectedChannels}
        mode="channels"
        guildId={selectedGuild.id}
      />

      <BulkPurgeDialog
        open={bulkPurgeOpen}
        onClose={() => setBulkPurgeOpen(false)}
        channels={selectedChannels}
        mode="channels"
        guildId={selectedGuild.id}
        canManageMessages={hasManageMessages}
      />

      <BulkEditDialog
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        channels={selectedChannels}
        mode="channels"
        guildId={selectedGuild.id}
      />

    </Box>
  );
};

export default ChannelList;
