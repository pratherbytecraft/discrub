import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { Emoji, Guild, Role } from 'discrub-core/types/discord-types';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { isUserDataStale } from 'discrub-core/discrub-utils';
import { initialGuildState } from './guildTypes';
import { getDiscordService } from '@services/discordService';
import type { RootState } from '@/app/store';

/**
 * Guild slice - manages server/guild state
 */

/**
 * Fetch all guilds for the current user
 */
export const fetchGuilds = createAsyncThunk(
  'guild/fetchGuilds',
  async (token: string, { rejectWithValue }) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.fetchGuilds(token);

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch guilds');
      }

      // Return guilds directly (sorting utility returns partial guilds)
      return response.data as Guild[];
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch guilds'
      );
    }
  }
);

/**
 * Fetch roles for a specific guild
 */
export const fetchRoles = createAsyncThunk(
  'guild/fetchRoles',
  async (
    { guildId, token }: { guildId: string; token: string },
    { rejectWithValue }
  ) => {
    try {
      const discordService = getDiscordService();
      const response = await discordService.fetchRoles(guildId, token);

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch roles');
      }

      return response.data as Role[];
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch roles'
      );
    }
  }
);

/**
 * Fetch current user's guild member data (for role IDs / permission checks).
 * Cached per guild ID — uses APP_USER_DATA_REFRESH_RATE setting for TTL.
 */
export const fetchCurrentMember = createAsyncThunk(
  'guild/fetchCurrentMember',
  async (
    { guildId, token }: { guildId: string; token: string },
    { getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;
      const refreshRate = state.app.settings?.[DiscrubSetting.APP_USER_DATA_REFRESH_RATE] || 'daily';

      // Check cache — reuse isUserDataStale from discrub-core
      const cached = state.guild.memberRolesCache?.[guildId];
      if (cached && !isUserDataStale(cached.fetchedAt, refreshRate)) {
        return { guildId, roles: cached.roles, fromCache: true };
      }

      const userId = state.user?.currentUser?.id;
      if (!userId) return { guildId, roles: [] as string[], fromCache: false };

      const discordService = getDiscordService();
      const response = await discordService.fetchGuildUser(guildId, userId, token);

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch member data');
      }

      return { guildId, roles: response.data.roles, fromCache: false };
    } catch {
      return { guildId, roles: [] as string[], fromCache: false };
    }
  }
);

/**
 * Fetch the custom emoji set for a guild (for the reaction picker's server-emoji grid).
 * The guild-list endpoint omits emojis, so they must be fetched per guild. Cached per
 * guild ID; a fetch failure degrades gracefully (no server emojis) without a global error.
 */
export const fetchGuildEmojis = createAsyncThunk(
  'guild/fetchGuildEmojis',
  async (
    { guildId, token }: { guildId: string; token: string },
    { getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as RootState;
      const cached = state.guild.guildEmojisCache?.[guildId];
      if (cached) {
        return { guildId, emojis: cached, fromCache: true };
      }

      const discordService = getDiscordService();
      const response = await discordService.fetchGuildEmojis(guildId, token);

      if (!response.success || !response.data) {
        return rejectWithValue('Failed to fetch server emojis');
      }

      return { guildId, emojis: response.data as Emoji[], fromCache: false };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch server emojis'
      );
    }
  }
);

const guildSlice = createSlice({
  name: 'guild',
  initialState: initialGuildState,
  reducers: {
    setSelectedGuild: (state, action: PayloadAction<Guild | null>) => {
      state.selectedGuild = action.payload;
      // Reflect any cached emojis for the new guild immediately; clear stale ones
      // from the previous guild. A fresh fetch repopulates the cache.
      state.guildEmojis = action.payload
        ? (state.guildEmojisCache[action.payload.id] ?? [])
        : [];
    },
    clearGuilds: (state) => {
      state.guilds = [];
      state.selectedGuild = null;
      state.selectedGuilds = [];
      state.roles = [];
      state.guildEmojis = [];
      state.guildEmojisCache = {};
      state.currentMemberRoles = [];
    },
    toggleGuildSelection: (state, action: PayloadAction<Guild>) => {
      const index = state.selectedGuilds.findIndex((g) => g.id === action.payload.id);
      if (index >= 0) {
        state.selectedGuilds.splice(index, 1);
      } else {
        state.selectedGuilds.push(action.payload);
      }
    },
    selectAllGuilds: (state, action: PayloadAction<Guild[]>) => {
      state.selectedGuilds = [...action.payload];
    },
    deselectAllGuilds: (state) => {
      state.selectedGuilds = [];
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch guilds
      .addCase(fetchGuilds.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchGuilds.fulfilled, (state, action) => {
        state.isLoading = false;
        state.guilds = action.payload;
        // Refreshing the guild list invalidates any prior multi-select set —
        // entries may no longer exist, and stale picks are surprising.
        state.selectedGuilds = [];
        state.error = null;
      })
      .addCase(fetchGuilds.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // Fetch roles
      .addCase(fetchRoles.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchRoles.fulfilled, (state, action) => {
        state.isLoading = false;
        state.roles = action.payload;
      })
      .addCase(fetchRoles.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // Fetch current member roles (with cache)
      .addCase(fetchCurrentMember.fulfilled, (state, action) => {
        const { guildId, roles, fromCache } = action.payload;
        state.currentMemberRoles = roles;
        if (!fromCache) {
          state.memberRolesCache[guildId] = { roles, fetchedAt: Date.now() };
        }
      })
      .addCase(fetchCurrentMember.rejected, (state) => {
        state.currentMemberRoles = [];
      })
      // Fetch guild emojis (no global loading/error — secondary, degrades gracefully)
      .addCase(fetchGuildEmojis.fulfilled, (state, action) => {
        const { guildId, emojis, fromCache } = action.payload;
        // Guard against a stale resolve after the user switched guilds.
        if (!state.selectedGuild || state.selectedGuild.id === guildId) {
          state.guildEmojis = emojis;
        }
        if (!fromCache) {
          state.guildEmojisCache[guildId] = emojis;
        }
      });
  },
});

export const {
  setSelectedGuild,
  clearGuilds,
  toggleGuildSelection,
  selectAllGuilds,
  deselectAllGuilds,
} = guildSlice.actions;

// Selectors
export const selectGuild = (state: RootState) => state.guild;
export const selectGuilds = (state: RootState) => state.guild.guilds;
export const selectSelectedGuild = (state: RootState) => state.guild.selectedGuild;
/**
 * The Server the open conversation belongs to: none while a DM is open.
 * Opening a DM leaves the Server selected so its channel list stays in the
 * sidebar, and anything that acts on the open conversation with
 * `selectSelectedGuild` then sends the DM to that Server (a DM search went
 * to the Server search and Discord answered 403, found on the VM 2026-11-16).
 */
export const selectConversationGuild = (state: RootState) =>
  state.dm?.selectedDm && !state.channel?.selectedChannel ? null : state.guild.selectedGuild;
export const selectSelectedGuilds = (state: RootState) => state.guild.selectedGuilds ?? [];
export const selectRoles = (state: RootState) => state.guild.roles;
export const selectGuildEmojis = (state: RootState) => state.guild.guildEmojis ?? [];
export const selectGuildLoading = (state: RootState) => state.guild.isLoading;
export const selectGuildError = (state: RootState) => state.guild.error;
export const selectCurrentMemberRoles = (state: RootState) => state.guild.currentMemberRoles ?? [];

export default guildSlice.reducer;
