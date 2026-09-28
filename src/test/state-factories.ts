import type { RootState } from '@/app/store';
import { initialAuthState } from '@features/auth/authTypes';
import { initialUserState } from '@features/user/userTypes';
import { initialAppState } from '@features/app/appTypes';
import { initialGuildState } from '@features/guild/guildTypes';
import { initialChannelState } from '@features/channel/channelTypes';
import { initialDmState } from '@features/dm/dmTypes';
import { initialMessageState } from '@features/message/messageTypes';
import { initialExportState } from '@features/export/exportTypes';
import { initialCacheState } from '@features/cache/cacheTypes';
import { initialStatusState } from '@features/status/statusTypes';
import { initialPurgeState } from '@features/purge/purgeTypes';
import { initialAnnouncementState } from '@features/announcement/announcementTypes';
import { defaultSettings } from '@features/app/appSlice';
import { initialPackageState } from '@features/package/packageSlice';
import { DEFAULT_HOTKEYS } from '@features/hotkeys/defaults';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import { createMockUser, createMockGuild, createMockChannel, createMockMessages } from './fixtures';

const initialPresetsState = { presets: {}, isLoaded: false };
const initialHistoryState = { exports: [], isLoaded: false };
const initialHotkeysState = { enabled: true, bindings: { ...DEFAULT_HOTKEYS } };
const initialDevState = { isSeeding: false, seedProgress: null, seedError: null };

/**
 * Create a base RootState with all slices at their initial values.
 * Pass overrides for any slice you need to customize.
 */
export function createBaseState(overrides?: Partial<RootState>): RootState {
  return {
    auth: { ...initialAuthState },
    user: { ...initialUserState },
    app: { ...initialAppState },
    guild: { ...initialGuildState },
    channel: { ...initialChannelState },
    dm: { ...initialDmState },
    message: { ...initialMessageState },
    export: { ...initialExportState },
    cache: { ...initialCacheState },
    status: { ...initialStatusState },
    purge: { ...initialPurgeState },
    announcement: { ...initialAnnouncementState },
    presets: { ...initialPresetsState },
    history: { ...initialHistoryState },
    package: { ...initialPackageState },
    hotkeys: { ...initialHotkeysState },
    dev: { ...initialDevState },
    supporter: { ...initialSupporterState },
    notice: { loaded: true, seenId: null },
    ...overrides,
  } as RootState;
}

/**
 * Create an authenticated state with a user, guild, channel selected,
 * and messages loaded. Useful for testing components that assume the
 * user is logged in and viewing messages.
 */
export function createAuthenticatedState(overrides?: Partial<RootState>): RootState {
  const user = createMockUser();
  const guild = createMockGuild();
  const channel = createMockChannel();
  const messages = createMockMessages(5);

  return createBaseState({
    auth: {
      ...initialAuthState,
      token: 'test-token',
      isAuthenticated: true,
    },
    user: {
      ...initialUserState,
      currentUser: user,
    },
    app: {
      ...initialAppState,
      settings: defaultSettings as RootState['app']['settings'],
    },
    guild: {
      ...initialGuildState,
      guilds: [guild],
      selectedGuild: guild,
    },
    channel: {
      ...initialChannelState,
      channels: [channel],
      selectedChannel: channel,
    },
    message: {
      ...initialMessageState,
      messages,
      filteredMessages: messages,
    },
    ...overrides,
  });
}
