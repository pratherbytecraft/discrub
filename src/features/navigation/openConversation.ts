import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Channel, Guild } from 'discrub-core/types/discord-types';
import { ChannelType } from 'discrub-core/discord-enum';
import type { RootState } from '@/app/store';
import { fetchChannels, fetchForumThreads, setSelectedChannel } from '@features/channel/channelSlice';
import { fetchCurrentMember, fetchRoles, setSelectedGuild } from '@features/guild/guildSlice';
import { setSelectedDm } from '@features/dm/dmSlice';
import { clearMessages, fetchMessages } from '@features/message/messageSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { getDmName } from '@/utils/dmListUtils';
import { t } from '@/i18n';

/**
 * Opening a server, a channel or a DM (2.2.5 WP4a). The sidebar lists and
 * the workspace scope restore go through the same three steps, so a
 * restored scope lands exactly where a click would.
 */

export const openGuild = createAsyncThunk<void, { guild: Guild }, { state: RootState }>(
  'navigation/openGuild',
  async ({ guild }, { dispatch, getState }) => {
    const token = getState().auth.token;
    if (!token) return;
    // Clear the previous server's state before loading the new one. An open
    // DM goes too (row 129): its header and Load All stayed on screen otherwise.
    dispatch(setSelectedChannel(null));
    dispatch(setSelectedDm(null));
    dispatch(clearMessages());
    dispatch(setSelectedGuild(guild));
    dispatch(addStatusEntry({ level: 'info', message: t('nav.loadingServer', { name: guild.name }) }));
    // Channels, current member roles and guild roles in parallel.
    dispatch(fetchCurrentMember({ guildId: guild.id, token }));
    dispatch(fetchRoles({ guildId: guild.id, token }));
    await dispatch(fetchChannels({ guildId: guild.id, token }));
  },
);

export const openChannel = createAsyncThunk<void, { channel: Channel }, { state: RootState }>(
  'navigation/openChannel',
  async ({ channel }, { dispatch, getState }) => {
    const state = getState();
    const token = state.auth.token;
    if (!token) return;
    dispatch(setSelectedDm(null));
    dispatch(clearMessages());
    dispatch(setSelectedChannel(channel));
    const isForumType = channel.type === ChannelType.GUILD_FORUM || channel.type === ChannelType.GUILD_MEDIA;
    dispatch(addStatusEntry({
      level: 'info',
      message: isForumType ? t('nav.loadingForumPostsFor', { name: channel.name }) : t('nav.loadingMessagesFor', { name: channel.name }),
    }));
    // Forum and media channels list their posts instead of messages.
    if (isForumType) {
      await dispatch(fetchForumThreads({ channelId: channel.id, token }));
    } else {
      await dispatch(fetchMessages({ guildId: state.guild.selectedGuild?.id, channelId: channel.id, token }));
    }
  },
);

export const openDm = createAsyncThunk<void, { dm: Channel }, { state: RootState }>(
  'navigation/openDm',
  async ({ dm }, { dispatch, getState }) => {
    const token = getState().auth.token;
    if (!token) return;
    dispatch(setSelectedChannel(null));
    dispatch(clearMessages());
    dispatch(setSelectedDm(dm));
    dispatch(addStatusEntry({ level: 'info', message: t('dm.loadingConversationWith', { name: getDmName(dm) }) }));
    await dispatch(fetchMessages({ channelId: dm.id, token }));
  },
);
