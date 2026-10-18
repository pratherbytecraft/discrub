import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureStore,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import packageReducer, {
  movePackageChannelOutOfLeftServers,
  recheckLeftServers,
  selectLeftServersRecheckStatus,
} from './packageSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import guildReducer from '@features/guild/guildSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import type { RootState } from '@/app/store';
import {
  PACKAGE_CHANNEL_TYPE,
  type PackageChannel,
  type ParsedPackage,
} from './packageTypes';

const mockFetchChannel = vi.fn();
const mockFetchGuilds = vi.fn();
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchChannel: mockFetchChannel,
    fetchGuilds: mockFetchGuilds,
  })),
}));

const mockUpdateStoredPackageChannels = vi.fn(async () => undefined);
vi.mock('@/services/packageStreamService', () => ({
  importPackageToStorage: vi.fn(),
  loadChannelMessagesFromStorage: vi.fn(),
  resumePackageFromStorage: vi.fn(),
  clearPackageContents: vi.fn(),
  hasStoredPackage: vi.fn(),
  updateStoredPackageChannels: (...args: unknown[]) => mockUpdateStoredPackageChannels(...(args as [])),
}));

const orphanA: PackageChannel = {
  id: '400',
  type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
  name: 'old-guild-channel',
  messageCount: 3,
  isOrphan: true,
};
const orphanB: PackageChannel = {
  id: '500',
  type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
  name: 'still-gone',
  messageCount: 1,
  isOrphan: true,
};
const home: PackageChannel = {
  id: '200',
  type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
  name: 'general',
  guildId: 'g1',
  guildName: 'Guild A',
  messageCount: 5,
  isOrphan: false,
};

const parsed: ParsedPackage = {
  user: { id: 'u1', username: 'tester', globalName: 'Tester', avatarHash: null },
  guilds: [{ id: 'g1', name: 'Guild A' }],
  channels: [home, orphanA, orphanB],
  totalMessages: 9,
  packageSizeBytes: 1,
};

function makeStore(token: string | null = 'tok', withGuilds = true) {
  const store = configureStore({
    reducer: {
      package: packageReducer,
      auth: authReducer,
      user: userReducer,
      guild: guildReducer,
      app: appReducer,
      status: statusReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  }) as unknown as {
    dispatch: ThunkDispatch<RootState, unknown, UnknownAction>;
    getState: () => RootState;
  };
  if (token) store.dispatch({ type: 'auth/setToken', payload: token });
  store.dispatch({ type: 'user/setCurrentUser', payload: { id: 'u1', username: 'tester' } });
  if (withGuilds) {
    store.dispatch({
      type: 'guild/fetchGuilds/fulfilled',
      payload: [{ id: 'g1', name: 'Guild A' }, { id: 'g2', name: 'Rejoined Guild' }],
    });
  }
  store.dispatch({
    type: 'package/import/fulfilled',
    payload: {
      parsed,
      validation: { ok: true, readOnly: false, warnings: [], errors: [] },
      deletedMessageIds: {},
      goneMessageIds: {},
    },
  });
  return store;
}

const statusMessages = (store: ReturnType<typeof makeStore>) =>
  store.getState().status.entries.map((e) => e.message);

describe('packageSlice — Left Servers recheck (#273)', () => {
  beforeEach(() => {
    mockFetchChannel.mockReset();
    mockFetchGuilds.mockReset();
    mockUpdateStoredPackageChannels.mockClear();
  });

  it('fetches the Server list itself when none is loaded, so the moved channel gets its name', async () => {
    const store = makeStore('tok', false);
    mockFetchGuilds.mockResolvedValue({ success: true, data: [{ id: 'g2', name: 'Rejoined Guild' }] });
    mockFetchChannel.mockImplementation(async (_token: string, id: string) =>
      id === '400'
        ? { success: true, data: { id: '400', type: 0, name: 'old-guild-channel', guild_id: 'g2' } }
        : { success: false, status: 403 },
    );

    await store.dispatch(recheckLeftServers());

    expect(mockFetchGuilds).toHaveBeenCalledWith('tok');
    const moved = store.getState().package.parsed!.channels.find((c) => c.id === '400')!;
    expect(moved.isOrphan).toBe(false);
    expect(moved.guildName).toBe('Rejoined Guild');
    // pkg-notice: the list it fetched reaches the guild slice, so the Left Servers notice compares against it.
    expect(store.getState().guild.guilds.map((g) => g.id)).toEqual(['g2']);
  });

  it('starts idle after an import and only asks Discord about Left Servers channels', async () => {
    const store = makeStore();
    expect(selectLeftServersRecheckStatus(store.getState())).toBe('idle');
    mockFetchChannel.mockResolvedValue({ success: false, status: 404 });

    await store.dispatch(recheckLeftServers());

    expect(mockFetchChannel).toHaveBeenCalledTimes(2);
    expect(mockFetchChannel.mock.calls.map((c) => c[1])).toEqual(['400', '500']);
    expect(selectLeftServersRecheckStatus(store.getState())).toBe('done');
  });

  it('moves a channel Discord now answers with a guild id back under that Server', async () => {
    const store = makeStore();
    mockFetchChannel.mockImplementation(async (_token: string, id: string) =>
      id === '400'
        ? { success: true, data: { id: '400', type: 0, name: 'old-guild-channel', guild_id: 'g2' } }
        : { success: false, status: 403 },
    );

    const action = await store.dispatch(recheckLeftServers());
    expect(action.type).toBe('package/recheckLeftServers/fulfilled');

    const channels = store.getState().package.parsed!.channels;
    const moved = channels.find((c) => c.id === '400')!;
    expect(moved.isOrphan).toBe(false);
    expect(moved.guildId).toBe('g2');
    expect(moved.guildName).toBe('Rejoined Guild');
    expect(channels.find((c) => c.id === '500')!.isOrphan).toBe(true);
    expect(channels.find((c) => c.id === '200')).toEqual(home);
    // The rejoined Server joins the package guild list so the Left Servers
    // notice and the grouping agree.
    expect(store.getState().package.parsed!.guilds).toContainEqual({ id: 'g2', name: 'Rejoined Guild' });
    expect(mockUpdateStoredPackageChannels).toHaveBeenCalledWith('u1', channels);
    expect(statusMessages(store)).toContainEqual('Left Servers: 1 channel moved back under a Server you rejoined');
  });

  it('keeps everything in place and says so when nothing was rejoined', async () => {
    const store = makeStore();
    mockFetchChannel.mockResolvedValue({ success: false, status: 403 });

    await store.dispatch(recheckLeftServers());

    const channels = store.getState().package.parsed!.channels;
    expect(channels.filter((c) => c.isOrphan).map((c) => c.id)).toEqual(['400', '500']);
    expect(mockUpdateStoredPackageChannels).not.toHaveBeenCalled();
    expect(statusMessages(store)).toContainEqual(
      'Left Servers: rechecked 2 channels, none are in a Server you are in now',
    );
  });

  it('rejects without a token and leaves the channels alone', async () => {
    const store = makeStore(null);
    const action = await store.dispatch(recheckLeftServers());
    expect(action.type).toBe('package/recheckLeftServers/rejected');
    expect(mockFetchChannel).not.toHaveBeenCalled();
    expect(store.getState().package.parsed!.channels.filter((c) => c.isOrphan)).toHaveLength(2);
  });

  it('goes back to idle when another package is imported', async () => {
    const store = makeStore();
    mockFetchChannel.mockResolvedValue({ success: false, status: 404 });
    await store.dispatch(recheckLeftServers());
    expect(selectLeftServersRecheckStatus(store.getState())).toBe('done');
    store.dispatch({
      type: 'package/import/fulfilled',
      payload: {
        parsed,
        validation: { ok: true, readOnly: false, warnings: [], errors: [] },
        deletedMessageIds: {},
        goneMessageIds: {},
      },
    });
    expect(selectLeftServersRecheckStatus(store.getState())).toBe('idle');
  });
});

describe('packageSlice — move out of Left Servers by hand (#273)', () => {
  beforeEach(() => {
    mockUpdateStoredPackageChannels.mockClear();
  });

  it('clears the flag on that one channel and persists the list', async () => {
    const store = makeStore();
    const action = await store.dispatch(movePackageChannelOutOfLeftServers({ channelId: '500' }));
    expect(action.type).toBe('package/moveOutOfLeftServers/fulfilled');

    const channels = store.getState().package.parsed!.channels;
    const moved = channels.find((c) => c.id === '500')!;
    expect(moved.isOrphan).toBe(false);
    expect(moved.guildId).toBeUndefined();
    expect(channels.find((c) => c.id === '400')!.isOrphan).toBe(true);
    expect(mockUpdateStoredPackageChannels).toHaveBeenCalledWith('u1', channels);
  });
});
