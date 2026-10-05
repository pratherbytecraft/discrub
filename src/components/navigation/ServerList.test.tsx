import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test/test-utils';
import ServerList from './ServerList';
import { createBaseState } from '../../test/state-factories';
import { createMockGuild } from '../../test/fixtures';

// Mock discordService so fetchGuilds thunk doesn't hit the network
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchGuilds: vi.fn().mockResolvedValue([]),
    fetchChannels: vi.fn().mockResolvedValue({ success: true, data: [] }),
    fetchRoles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    fetchGuildUser: vi.fn().mockResolvedValue({ success: true, data: { roles: [] } }),
  })),
}));

// Mock storage for settings middleware
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

describe('ServerList', () => {
  const guilds = [
    createMockGuild({ id: 'g1', name: 'Alpha Server', icon: 'abc123' }),
    createMockGuild({ id: 'g2', name: 'Beta Server', icon: null }),
    createMockGuild({ id: 'g3', name: 'Gamma Server', icon: null }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading spinner when guilds are loading', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds: [], selectedGuild: null, selectedGuilds: [], roles: [], isLoading: true, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.queryByText('Loading servers...')).not.toBeInTheDocument();
      const skeletons = document.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should show "No servers found" when no guilds exist and no token', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds: [], selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('No servers found')).toBeInTheDocument();
    });

    it('should show filter-specific empty state when filter matches nothing', () => {
      renderWithProviders(<ServerList filterText="nonexistent" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText(/No servers matching "nonexistent"/)).toBeInTheDocument();
    });
  });

  describe('Guild Rendering', () => {
    it('should render all guilds', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Alpha Server')).toBeInTheDocument();
      expect(screen.getByText('Beta Server')).toBeInTheDocument();
      expect(screen.getByText('Gamma Server')).toBeInTheDocument();
    });

    it('should render "Servers" header', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Servers')).toBeInTheDocument();
    });

    it('should render guild avatar with icon URL when icon exists', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      const avatarImg = screen.getAllByRole('img')[0];
      expect(avatarImg).toHaveAttribute('src', expect.stringContaining('cdn.discordapp.com'));
    });
  });

  describe('Filtering', () => {
    it('should filter guilds by name', () => {
      renderWithProviders(<ServerList filterText="Alpha" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Alpha Server')).toBeInTheDocument();
      expect(screen.queryByText('Beta Server')).toBeNull();
      expect(screen.queryByText('Gamma Server')).toBeNull();
    });

    it('should filter case-insensitively', () => {
      renderWithProviders(<ServerList filterText="beta" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Beta Server')).toBeInTheDocument();
    });

    it('should show all guilds when filter is empty', () => {
      renderWithProviders(<ServerList filterText="" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Alpha Server')).toBeInTheDocument();
      expect(screen.getByText('Beta Server')).toBeInTheDocument();
      expect(screen.getByText('Gamma Server')).toBeInTheDocument();
    });

    it('should show all guilds when filter is whitespace', () => {
      renderWithProviders(<ServerList filterText="   " />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      expect(screen.getByText('Alpha Server')).toBeInTheDocument();
    });
  });

  describe('Multi-select & Copy', () => {
    const baseGuildState = {
      guilds,
      selectedGuild: null,
      selectedGuilds: [],
      roles: [],
      isLoading: false,
      error: null,
      currentMemberRoles: [],
      memberRolesCache: {},
      guildEmojis: [],
      guildEmojisCache: {},
    };

    it('renders the Multi-select toggle in the header', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: baseGuildState,
        }),
      });
      expect(screen.getByLabelText('Toggle multi-select')).toBeInTheDocument();
    });

    it('does not render the legacy header copy IconButton (replaced by multi-select Copy)', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: baseGuildState,
        }),
      });
      expect(screen.queryByLabelText('Copy server names')).toBeNull();
    });

    it('toggles guild selection on row click while multi-select is active (does not switch servers)', () => {
      const { store } = renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: baseGuildState,
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByText('Beta Server'));
      const state = store.getState();
      expect(state.guild.selectedGuilds.map((g) => g.id)).toEqual(['g2']);
      expect(state.guild.selectedGuild).toBeNull();
    });

    it('shows the MultiSelectControls Copy button only after selecting at least one server', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: baseGuildState,
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      expect(screen.queryByTestId('multi-select-copy')).toBeNull();
      fireEvent.click(screen.getByText('Alpha Server'));
      expect(screen.getByTestId('multi-select-copy')).toBeInTheDocument();
    });

    it('renders Purge but not Export in server multi-select (#255)', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { ...baseGuildState, selectedGuilds: [guilds[0]] },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      expect(screen.queryByTestId('multi-select-export')).toBeNull();
      // #255: Purge is available for servers; Export is still single-server.
      expect(screen.getByTestId('multi-select-purge')).toBeInTheDocument();
      expect(screen.getByLabelText('Purge selected servers')).toBeInTheDocument();
    });

    it('opens the server purge dialog from the multi-select Purge button (#255)', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { ...baseGuildState, selectedGuilds: [guilds[0], guilds[2]] },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-purge'));
      expect(screen.getByText('Purge Servers')).toBeInTheDocument();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      expect(screen.getByText(/Alpha Server, Gamma Server/)).toBeInTheDocument();
    });

    it('copies only currently-selected names and dispatches a toast', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const { store } = renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { ...baseGuildState, selectedGuilds: [guilds[0], guilds[2]] },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-copy'));
      expect(writeText).toHaveBeenCalledWith('Alpha Server\nGamma Server');
      expect(store.getState().status.toast.isVisible).toBe(true);
      expect(store.getState().status.toast.message).toBe('Copied to clipboard');
    });

    it('Select all / Deselect all toggle picks up the filtered guild list', () => {
      const { store } = renderWithProviders(<ServerList filterText="Alpha" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: baseGuildState,
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-toggle-all'));
      expect(store.getState().guild.selectedGuilds.map((g) => g.id)).toEqual(['g1']);
    });

    it('clears the selection when multi-select is toggled off', () => {
      const { store } = renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: baseGuildState,
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByText('Alpha Server'));
      expect(store.getState().guild.selectedGuilds).toHaveLength(1);
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      expect(store.getState().guild.selectedGuilds).toEqual([]);
    });
  });

  describe('Selection', () => {
    it('should dispatch setSelectedGuild when a guild is clicked (single-select default mode)', () => {
      const { store } = renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      fireEvent.click(screen.getByText('Beta Server'));
      const state = store.getState();
      expect(state.guild.selectedGuild?.id).toBe('g2');
    });

    it('should mark selected guild item as selected', () => {
      renderWithProviders(<ServerList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          guild: { guilds, selectedGuild: guilds[1], selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      const betaButton = screen.getByText('Beta Server').closest('[role="button"]');
      expect(betaButton).toHaveClass('Mui-selected');
    });
  });

  describe('paging past the first 50 rows', () => {
    const manyGuilds = (count: number) =>
      Array.from({ length: count }, (_, i) => createMockGuild({ id: `g-${i}`, name: `Server ${i}`, icon: null }));

    const stateWithGuilds = (list: ReturnType<typeof manyGuilds>) =>
      createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        guild: { guilds: list, selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
      });

    let observe: ReturnType<typeof vi.fn>;
    let intersect: () => void;

    beforeEach(() => {
      let callback: IntersectionObserverCallback = () => {};
      observe = vi.fn();
      intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      vi.stubGlobal('IntersectionObserver', class {
        constructor(cb: IntersectionObserverCallback) { callback = cb; }
        observe = observe;
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = () => [];
      });
    });

    it('draws more rows each time the sentinel scrolls into view', async () => {
      renderWithProviders(<ServerList />, { preloadedState: stateWithGuilds(manyGuilds(90)) });
      expect(screen.getAllByTestId('server-row')).toHaveLength(50);
      expect(observe).toHaveBeenCalledWith(screen.getByTestId('server-list-sentinel'));

      intersect();
      await waitFor(() => expect(screen.getAllByTestId('server-row')).toHaveLength(90));
      expect(screen.queryByTestId('server-list-sentinel')).not.toBeInTheDocument();
    });

    it('needs no sentinel when the list fits in one page', () => {
      renderWithProviders(<ServerList />, { preloadedState: stateWithGuilds(manyGuilds(12)) });
      expect(screen.getAllByTestId('server-row')).toHaveLength(12);
      expect(screen.queryByTestId('server-list-sentinel')).not.toBeInTheDocument();
    });

    it('finds a server past the first page by name', () => {
      renderWithProviders(<ServerList filterText="Server 77" />, { preloadedState: stateWithGuilds(manyGuilds(90)) });
      expect(screen.getAllByTestId('server-row')).toHaveLength(1);
      expect(screen.getByText('Server 77')).toBeInTheDocument();
    });
  });
});
