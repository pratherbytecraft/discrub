import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test/test-utils';
import TopBar from './TopBar';
import { createBaseState } from '../../test/state-factories';
import { createMockUser } from '../../test/fixtures';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({})),
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

const mockIsOverlayMode = vi.fn(() => false);
const mockCloseOverlay = vi.fn().mockResolvedValue(undefined);
const mockMinimizeOverlay = vi.fn().mockResolvedValue(undefined);

vi.mock('@/extension/messaging', () => ({
  isOverlayMode: () => mockIsOverlayMode(),
  closeOverlay: () => mockCloseOverlay(),
  minimizeOverlay: () => mockMinimizeOverlay(),
}));

const currentUser = createMockUser({ id: 'u1', username: 'TestUser', avatar: 'abc' });

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOverlayMode.mockReturnValue(false);
  });

  describe('Rendering', () => {
    it('should render the Discrub title', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText('Discrub')).toBeInTheDocument();
    });

    it('should render the Discrub logo', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByAltText('Discrub Home')).toBeInTheDocument();
    });
  });

  describe('Home Navigation', () => {
    it('should navigate home when logo is clicked', () => {
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          guild: { guilds: [], selectedGuild: { id: 'g1', name: 'Test Server' } as any, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
          channel: { channels: [], selectedChannel: { id: 'c1', name: 'general' } as any, selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
        }),
      });
      fireEvent.click(screen.getByAltText('Discrub Home'));
      expect(store.getState().guild.selectedGuild).toBeNull();
      expect(store.getState().channel.selectedChannel).toBeNull();
      expect(store.getState().dm.selectedDm).toBeNull();
    });

    it('should navigate home from DM context', () => {
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          dm: { dms: [], selectedDm: { id: 'd1' } as any, selectedDms: [], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByAltText('Discrub Home'));
      expect(store.getState().dm.selectedDm).toBeNull();
      expect(store.getState().channel.selectedChannel).toBeNull();
    });

    it('should be a no-op when already on home screen', () => {
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByAltText('Discrub Home'));
      expect(store.getState().guild.selectedGuild).toBeNull();
      expect(store.getState().channel.selectedChannel).toBeNull();
      expect(store.getState().dm.selectedDm).toBeNull();
    });
  });

  describe('User Info', () => {
    it('should display username when user is logged in', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    it('should display avatar with CDN URL', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      const avatar = screen.getAllByRole('img').find(
        (img) => img.getAttribute('src')?.includes('cdn.discordapp.com')
      );
      expect(avatar).toBeDefined();
    });

    it('should not show user info when no user', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser: null, isLoading: false, error: null },
        }),
      });
      expect(screen.queryByText('TestUser')).toBeNull();
    });
  });

  describe('Settings Button', () => {
    it('should show settings button when user is logged in', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.getByLabelText('Settings')).toBeInTheDocument();
    });

    it('should open settings modal when settings button is clicked', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, sidebarView: 'server' as const, task: { status: 'idle', message: '' }, settings: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Settings'));
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Logout', () => {
    it('should show logout button when user is logged in', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.getByLabelText('Logout')).toBeInTheDocument();
    });

    it('should clear all state on logout', () => {
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false },
          user: { currentUser, isLoading: false, error: null },
          guild: { guilds: [], selectedGuild: null, selectedGuilds: [], roles: [], isLoading: false, error: null, currentMemberRoles: [], memberRolesCache: {}, guildEmojis: [], guildEmojisCache: {} },
        }),
      });
      fireEvent.click(screen.getByLabelText('Logout'));
      const state = store.getState();
      expect(state.auth.token).toBeNull();
      expect(state.auth.isAuthenticated).toBe(false);
      expect(state.user.currentUser).toBeNull();
    });
  });

  describe('Minimize Button', () => {
    it('should not show minimize button when not in overlay mode', () => {
      mockIsOverlayMode.mockReturnValue(false);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.queryByLabelText('Minimize Discrub')).toBeNull();
    });

    it('should show minimize button in overlay mode', () => {
      mockIsOverlayMode.mockReturnValue(true);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.getByLabelText('Minimize Discrub')).toBeInTheDocument();
    });

    it('should call minimizeOverlay and dispatch setMinimized on click', async () => {
      mockIsOverlayMode.mockReturnValue(true);
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Minimize Discrub'));
      expect(mockMinimizeOverlay).toHaveBeenCalled();
      await waitFor(() => {
        expect(store.getState().app.isMinimized).toBe(true);
      });
    });

    it('should revert isMinimized on failure', async () => {
      mockIsOverlayMode.mockReturnValue(true);
      mockMinimizeOverlay.mockRejectedValueOnce(new Error('fail'));
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Minimize Discrub'));
      await waitFor(() => {
        expect(store.getState().app.isMinimized).toBe(false);
      });
    });
  });

  describe('Close Button', () => {
    it('should not show close button when not in overlay mode', () => {
      mockIsOverlayMode.mockReturnValue(false);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.queryByLabelText('Close Discrub')).toBeNull();
    });

    it('should show close button in overlay mode', () => {
      mockIsOverlayMode.mockReturnValue(true);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      expect(screen.getByLabelText('Close Discrub')).toBeInTheDocument();
    });

    it('should close immediately when no operation is running', () => {
      mockIsOverlayMode.mockReturnValue(true);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Close Discrub'));
      expect(mockCloseOverlay).toHaveBeenCalled();
      expect(screen.queryByText('Operation in Progress')).toBeNull();
    });

    it('should show warning dialog when operation is running', () => {
      mockIsOverlayMode.mockReturnValue(true);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          export: {
            isExporting: true,
            exportCriteria: null,
            maxZipPartBytes: null,
            exportProgress: null,
            exportTotal: 0,
            currentPage: 0,
            totalPages: 0,
            exportError: null,
            exportFormat: 'html' as const,
            messagesPerPage: 100,
            separateThreads: false,
            includeMedia: true,
            mediaConfig: { images: true, videos: true, audio: true, other: true },
            artistMode: false,
            sortOrder: 'descending' as const,
            previewMedia: true,
            exportTemplate: 'discord',
            textOptions: { attachmentStyle: 'inline', reactions: 'include', replies: 'quote', botIndicator: 'include' },
          },
        }),
      });
      fireEvent.click(screen.getByLabelText('Close Discrub'));
      expect(screen.getByText('Operation in Progress')).toBeInTheDocument();
      expect(screen.getByText('Close Anyway')).toBeInTheDocument();
      expect(screen.getByText('Closing will cancel this operation. Progress may be lost.')).toBeInTheDocument();
    });

    it('should call closeOverlay when clicking Close Anyway', () => {
      mockIsOverlayMode.mockReturnValue(true);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          export: {
            isExporting: true,
            exportCriteria: null,
            maxZipPartBytes: null,
            exportProgress: null,
            exportTotal: 0,
            currentPage: 0,
            totalPages: 0,
            exportError: null,
            exportFormat: 'html' as const,
            messagesPerPage: 100,
            separateThreads: false,
            includeMedia: true,
            mediaConfig: { images: true, videos: true, audio: true, other: true },
            artistMode: false,
            sortOrder: 'descending' as const,
            previewMedia: true,
            exportTemplate: 'discord',
            textOptions: { attachmentStyle: 'inline', reactions: 'include', replies: 'quote', botIndicator: 'include' },
          },
        }),
      });
      fireEvent.click(screen.getByLabelText('Close Discrub'));
      fireEvent.click(screen.getByText('Close Anyway'));
      expect(mockCloseOverlay).toHaveBeenCalled();
    });

    it('should dismiss warning dialog on X button', async () => {
      mockIsOverlayMode.mockReturnValue(true);
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          export: {
            isExporting: true,
            exportCriteria: null,
            maxZipPartBytes: null,
            exportProgress: null,
            exportTotal: 0,
            currentPage: 0,
            totalPages: 0,
            exportError: null,
            exportFormat: 'html' as const,
            messagesPerPage: 100,
            separateThreads: false,
            includeMedia: true,
            mediaConfig: { images: true, videos: true, audio: true, other: true },
            artistMode: false,
            sortOrder: 'descending' as const,
            previewMedia: true,
            exportTemplate: 'discord',
            textOptions: { attachmentStyle: 'inline', reactions: 'include', replies: 'quote', botIndicator: 'include' },
          },
        }),
      });
      fireEvent.click(screen.getByLabelText('Close Discrub'));
      expect(screen.getByText('Operation in Progress')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Close'));
      await waitFor(() => {
        expect(screen.queryByText('Operation in Progress')).toBeNull();
      });
    });
  });

  describe('Ideas & Contact', () => {
    const renderLoggedIn = () => renderWithProviders(<TopBar />, {
      preloadedState: createBaseState({
        user: { currentUser, isLoading: false, error: null },
      }),
    });

    const openIdeasFromMenu = () => {
      fireEvent.click(screen.getByLabelText('More options'));
      fireEvent.click(screen.getByText('Ideas & Contact'));
    };

    it('should show Ideas menu item in More menu when logged in', () => {
      renderLoggedIn();
      fireEvent.click(screen.getByLabelText('More options'));
      expect(screen.getByText('Ideas & Contact')).toBeInTheDocument();
    });

    it('should open Ideas dialog on click', () => {
      renderLoggedIn();
      openIdeasFromMenu();
      expect(screen.getByText(/Have an idea for a feature/)).toBeInTheDocument();
    });

    it('should show email link', () => {
      renderLoggedIn();
      openIdeasFromMenu();
      expect(screen.getByText('prathercc@gmail.com')).toBeInTheDocument();
    });

    it('should close dialog on Escape', async () => {
      renderLoggedIn();
      openIdeasFromMenu();
      expect(screen.getByText(/Have an idea for a feature/)).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByText(/Have an idea for a feature/)).toBeNull();
      });
    });
  });
});
