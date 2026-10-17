import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import ChannelList from './ChannelList';
import { createBaseState } from '../../test/state-factories';
import { createMockGuild, createMockChannel } from '../../test/fixtures';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
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

// ChannelType enum values: GUILD_TEXT = 0, DM = 1, GUILD_VOICE = 2, GUILD_CATEGORY = 4, GUILD_ANNOUNCEMENT = 5
const textChannel = createMockChannel({ id: 'ch-1', name: 'general', type: 0 });
const announcementChannel = createMockChannel({ id: 'ch-2', name: 'announcements', type: 5 });
const voiceChannel = createMockChannel({ id: 'ch-3', name: 'voice-chat', type: 2 });
const guild = createMockGuild({ id: 'g1', name: 'Test Guild' });

describe('ChannelList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('No Guild Selected', () => {
    it('should show prompt to select a server', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          guild: { guilds: [], selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Select a server to view channels')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner when channels are loading', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [], selectedChannel: null, selectedChannels: [], isLoading: true, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.queryByText('Loading channels...')).not.toBeInTheDocument();
      const skeletons = document.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should show "No channels found" when no channels exist', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('No channels found')).toBeInTheDocument();
    });
  });

  describe('Channel Rendering', () => {
    it('should render only text-based channels', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel, voiceChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('general')).toBeInTheDocument();
      expect(screen.getByText('announcements')).toBeInTheDocument();
      // Voice channels now shown since they contain text chat
      expect(screen.getByText('voice-chat')).toBeInTheDocument();
    });

    it('should show "Channels" section header (not the guild name — that lives in the sidebar crumb)', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('Channels')).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('should filter channels by name', () => {
      renderWithProviders(<ChannelList filterText="general" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('general')).toBeInTheDocument();
      expect(screen.queryByText('announcements')).toBeNull();
    });

    it('should show filter-specific empty state when nothing matches', () => {
      renderWithProviders(<ChannelList filterText="nonexistent" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText(/No channels matching "nonexistent"/)).toBeInTheDocument();
    });

    it('should filter case-insensitively', () => {
      renderWithProviders(<ChannelList filterText="GENERAL" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('general')).toBeInTheDocument();
    });

    // #274: a Channel named in a fancy Unicode font has to match plain typing.
    it('should match fancy font channel names against plain text', () => {
      const fancy = createMockChannel({ id: 'ch-fancy', name: '𝓶𝓮𝓶𝓮𝓼', type: 0 });
      renderWithProviders(<ChannelList filterText="memes" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, fancy], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(screen.getByText('𝓶𝓮𝓶𝓮𝓼')).toBeInTheDocument();
      expect(screen.queryByText('general')).toBeNull();
    });
  });

  describe('Selection', () => {
    it('should dispatch setSelectedChannel when a channel is clicked', () => {
      const { store } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByText('general'));
      const state = store.getState();
      expect(state.channel.selectedChannel?.id).toBe('ch-1');
    });

    it('should clear DM selection on channel click', () => {
      const { store } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          dm: { dms: [], selectedDm: createMockChannel({ id: 'dm-old', type: 1 }), selectedDms: [], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByText('general'));
      expect(store.getState().dm.selectedDm).toBeNull();
    });

    it('should mark selected channel as selected', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: textChannel, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      const generalButton = screen.getByText('general').closest('[role="button"]');
      expect(generalButton).toHaveClass('Mui-selected');
    });
  });

  describe('Shift+Click range select (#218)', () => {
    const rangeChannels = [
      createMockChannel({ id: 'r1', name: 'alpha', type: 0 }),
      createMockChannel({ id: 'r2', name: 'bravo', type: 0 }),
      createMockChannel({ id: 'r3', name: 'charlie', type: 0 }),
      createMockChannel({ id: 'r4', name: 'delta', type: 0 }),
    ];

    const renderInMultiSelect = () => {
      const utils = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: rangeChannels, selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      return utils;
    };

    it('selects the whole range between the anchor and a shift-clicked row', () => {
      const { store } = renderInMultiSelect();
      fireEvent.click(screen.getByText('alpha'));
      fireEvent.click(screen.getByText('delta'), { shiftKey: true });
      const ids = store.getState().channel.selectedChannels.map((c) => c.id).sort();
      expect(ids).toEqual(['r1', 'r2', 'r3', 'r4']);
    });

    it('selects a backwards range (shift-click above the anchor)', () => {
      const { store } = renderInMultiSelect();
      fireEvent.click(screen.getByText('charlie'));
      fireEvent.click(screen.getByText('alpha'), { shiftKey: true });
      const ids = store.getState().channel.selectedChannels.map((c) => c.id).sort();
      expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    it('range-select adds to the existing selection without duplicating', () => {
      const { store } = renderInMultiSelect();
      fireEvent.click(screen.getByText('bravo')); // toggle + anchor
      fireEvent.click(screen.getByText('alpha')); // toggle + re-anchor
      fireEvent.click(screen.getByText('charlie'), { shiftKey: true }); // range a→c
      const ids = store.getState().channel.selectedChannels.map((c) => c.id).sort();
      expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    it('shift-click without an anchor falls back to a plain toggle', () => {
      const { store } = renderInMultiSelect();
      fireEvent.click(screen.getByText('bravo'), { shiftKey: true });
      const ids = store.getState().channel.selectedChannels.map((c) => c.id);
      expect(ids).toEqual(['r2']);
    });
  });

  describe('Copy Names (multi-select toolbar)', () => {
    it('does not render the Copy button when nothing is selected', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      // Multi-select inactive + no selection → MultiSelectControls renders nothing
      expect(screen.queryByTestId('multi-select-copy')).toBeNull();
    });

    it('copies only the selected channel names when Copy is clicked in multi-select mode', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: null, selectedChannels: [textChannel], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      // Enter multi-select mode so the toolbar renders
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-copy'));
      // Only the selected channel ("general") makes it to the clipboard,
      // not "announcements" — proves the new selection-scoped semantics.
      expect(writeText).toHaveBeenCalledWith('general');
    });

    it('dispatches a toast after copying selected channel names', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const { store } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, announcementChannel], selectedChannel: null, selectedChannels: [textChannel], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-copy'));
      expect(store.getState().status.toast.isVisible).toBe(true);
      expect(store.getState().status.toast.message).toBe('Copied to clipboard');
    });
  });

  describe('Channel Permissions', () => {
    const NO_VIEW = '0';

    it('should show lock icon for channels user cannot access', () => {
      const restrictedGuild = createMockGuild({ id: 'g1', name: 'Test Guild', permissions: NO_VIEW });
      const { container } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [restrictedGuild], selectedGuild: restrictedGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(container.querySelector('[data-testid="LockIcon"]')).toBeInTheDocument();
    });

    it('should not show lock icon for accessible channels', () => {
      const { container } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      expect(container.querySelector('[data-testid="LockIcon"]')).not.toBeInTheDocument();
    });

    it('should disable locked channels', () => {
      const restrictedGuild = createMockGuild({ id: 'g1', name: 'Test Guild', permissions: NO_VIEW });
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [restrictedGuild], selectedGuild: restrictedGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      const button = screen.getByText('general').closest('div[role="button"]');
      expect(button).toHaveClass('Mui-disabled');
    });
  });

  /**
   * #135 hard requirement: the Multi-select toggle label stays
   * "Multi-select" in both states. State is conveyed by the button's
   * variant + icon swap, not by switching the text to "Done".
   */
  describe('Multi-select toggle label', () => {
    it('reads "Multi-select" both before and after enabling multi-select mode', () => {
      const guild = createMockGuild({ id: 'g1', name: 'Test Guild' });
      const channel = createMockChannel({ id: 'c1', name: 'general', type: 0 });
      renderWithProviders(<ChannelList filterText="" />, {
        preloadedState: createBaseState({
          auth: { token: 't', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [guild], selectedGuild: guild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [channel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      const button = screen.getByLabelText('Toggle multi-select');
      expect(button).toHaveTextContent('Multi-select');
      fireEvent.click(button);
      expect(button).toHaveTextContent('Multi-select');
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
  });

  // Backlog #160: voice (type 2) and stage (type 13) channels carry
  // persistent text chat under the same channel ID and use the same
  // permission gate as text channels. They must render as clickable,
  // not as the disabled / locked rows we used to ship.
  describe('Voice and Stage channels (Backlog #160)', () => {
    const stageChannel = createMockChannel({ id: 'ch-stage', name: 'live-chat', type: 13 });
    const accessibleGuild = createMockGuild({ id: 'g1', name: 'Test Guild', permissions: '8' });

    it('renders voice channels as enabled rows (not disabled / locked)', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [accessibleGuild], selectedGuild: accessibleGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [voiceChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      const row = screen.getByText('voice-chat').closest('[role="button"]');
      expect(row).not.toHaveClass('Mui-disabled');
    });

    it('renders stage channels as enabled rows (not disabled / locked)', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [accessibleGuild], selectedGuild: accessibleGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [stageChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      const row = screen.getByText('live-chat').closest('[role="button"]');
      expect(row).not.toHaveClass('Mui-disabled');
    });

    it('leaves voice and stage channels out of Select all and its count (pass 3, row 130)', () => {
      const { store } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [accessibleGuild], selectedGuild: accessibleGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, voiceChannel, stageChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      expect(screen.getByTestId('multi-select-count')).toHaveTextContent('0 of 1');
      fireEvent.click(screen.getByTestId('multi-select-toggle-all'));
      const selectedIds = store.getState().channel.selectedChannels.map((c: { id: string }) => c.id);
      expect(selectedIds).toEqual(['ch-1']);
      expect(screen.getByTestId('multi-select-toggle-all')).toHaveTextContent('Deselect all');
    });

    it('counts a voice channel ticked on its own in both numbers (pass 4, row 169)', () => {
      const { store } = renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [accessibleGuild], selectedGuild: accessibleGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, voiceChannel], selectedChannel: null, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-toggle-all'));
      fireEvent.click(screen.getByText('voice-chat').closest('[role="button"]')!);
      const selectedIds = store.getState().channel.selectedChannels.map((c: { id: string }) => c.id);
      expect(selectedIds).toEqual(['ch-1', 'ch-3']);
      expect(screen.getByTestId('multi-select-count')).toHaveTextContent('2 of 2');
    });

    it('counts all text channels as selected when a voice channel is ticked as well', () => {
      renderWithProviders(<ChannelList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
          guild: { guilds: [accessibleGuild], selectedGuild: accessibleGuild, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [textChannel, voiceChannel], selectedChannel: null, selectedChannels: [textChannel, voiceChannel], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      expect(screen.getByTestId('multi-select-toggle-all')).toHaveTextContent('Deselect all');
    });
  });
});
