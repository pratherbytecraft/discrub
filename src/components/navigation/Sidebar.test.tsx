import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import Sidebar from './Sidebar';
import { createBaseState } from '../../test/state-factories';
import { createMockGuild, createMockChannel } from '../../test/fixtures';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchGuilds: vi.fn().mockResolvedValue([]),
    fetchChannels: vi.fn().mockResolvedValue([]),
    fetchDMs: vi.fn().mockResolvedValue([]),
    fetchMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
  })),
}));

vi.mock('@/extension/storage', () => {
  function makeAdapter() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      getMany: vi.fn().mockResolvedValue([]),
      setMany: vi.fn().mockResolvedValue(undefined),
      entries: vi.fn().mockResolvedValue([]),
    };
  }
  return {
    storage: {
      settings: makeAdapter(),
      state: makeAdapter(),
      presets: makeAdapter(),
      cache: makeAdapter(),
      history: makeAdapter(),
      statuslog: makeAdapter(),
      package: makeAdapter(),
      media: makeAdapter(),
    },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

const guild = createMockGuild({ id: 'g1', name: 'Test Guild' });
const guilds = [guild, createMockGuild({ id: 'g2', name: 'Other Guild' })];
const channels = [
  createMockChannel({ id: 'ch-1', name: 'general', type: 0 }),
  createMockChannel({ id: 'ch-2', name: 'random', type: 0 }),
];

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tab Navigation', () => {
    it('should render Servers and DMs tabs', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        }),
      });
      expect(screen.getByRole('tab', { name: 'Servers' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'DMs' })).toBeInTheDocument();
    });

    it('opens on Package when the app is already in Package mode, and keeps that mode', () => {
      const base = createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
      });
      const { store } = renderWithProviders(<Sidebar />, { preloadedState: { ...base, app: { ...base.app, sidebarView: 'package' } } });
      expect(screen.getByRole('tab', { name: 'Package', selected: true })).toBeInTheDocument();
      expect(store.getState().app.sidebarView).toBe('package');
    });

    it('opens on DMs when a DM is already open', () => {
      const base = createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
      });
      const dm = createMockChannel({ id: 'dm-1', type: 1, name: null as never });
      renderWithProviders(<Sidebar />, { preloadedState: { ...base, dm: { ...base.dm, selectedDm: dm } } });
      expect(screen.getByRole('tab', { name: 'DMs', selected: true })).toBeInTheDocument();
    });

    it('should default to Servers tab', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        }),
      });
      expect(screen.getByRole('tab', { name: 'Servers', selected: true })).toBeInTheDocument();
    });

    it('should switch to DMs tab when clicked', async () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        }),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: 'DMs' }));
      });
      expect(screen.getByRole('tab', { name: 'DMs', selected: true })).toBeInTheDocument();
    });
  });

  describe('Search Field', () => {
    it('should render search field', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        }),
      });
      expect(screen.getByPlaceholderText('Search servers...')).toBeInTheDocument();
    });

    it('should change placeholder based on active tab', async () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        }),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: 'DMs' }));
      });
      expect(screen.getByPlaceholderText('Search DMs...')).toBeInTheDocument();
    });

    it('should change placeholder to channels when guild is selected', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels, selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByPlaceholderText('Search channels...')).toBeInTheDocument();
    });
  });

  describe('Server → Channel Drill-down', () => {
    it('should show channel list when guild is selected', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels, selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('general')).toBeInTheDocument();
      expect(screen.getByText('random')).toBeInTheDocument();
    });

    it('should show guild name in channel header', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels, selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getAllByText('Test Guild').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Back Button', () => {
    it('should show back button when guild is selected', () => {
      renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels, selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      // ArrowBackIcon is inside an IconButton
      const backButton = screen.getByTestId('ArrowBackIcon').closest('button');
      expect(backButton).toBeInTheDocument();
    });

    it('should clear guild selection when back button is clicked', () => {
      const { store } = renderWithProviders(<Sidebar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels, selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      const backButton = screen.getByTestId('ArrowBackIcon').closest('button')!;
      fireEvent.click(backButton);
      expect(store.getState().guild.selectedGuild).toBeNull();
    });
  });
});
