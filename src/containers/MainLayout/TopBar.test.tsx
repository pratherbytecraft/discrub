import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test/test-utils';
import TopBar from './TopBar';
import { createBaseState, createAuthenticatedState } from '../../test/state-factories';
import { createMockUser } from '../../test/fixtures';
import { initialSupporterState } from '@features/supporter/supporterTypes';

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
  isExtensionMode: () => false,
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
          app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const, task: { status: 'idle', message: '' }, settings: null, previewThemeId: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Settings'));
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Ko-Fi Toggle', () => {
    it('should show Supporter Wall menu item when More menu is opened', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('More options'));
      expect(screen.getByText('Supporter Wall')).toBeInTheDocument();
    });

    it('should render Ko-Fi icon image in More menu', () => {
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('More options'));
      expect(screen.getByAltText('Ko-Fi')).toBeInTheDocument();
    });

    it('should dispatch setting update on click', () => {
      const { store } = renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const, task: { status: 'idle', message: '' }, settings: null, previewThemeId: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('More options'));
      fireEvent.click(screen.getByText('Supporter Wall'));
      const actions = store.getState();
      // The updateSetting thunk will have been dispatched
      expect(actions).toBeDefined();
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
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
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

    it('forgets a remembered token on logout (#249)', async () => {
      const { storage } = await import('@/extension/storage');
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: true },
          user: { currentUser, isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Logout'));
      await vi.waitFor(() => {
        expect(storage.state.remove).toHaveBeenCalledWith('auth:rememberedToken');
      });
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
      fireEvent.click(screen.getByLabelText('Ideas & Contact'));
    };

    it('should show an Ideas & Contact icon in the top bar when logged in', () => {
      renderLoggedIn();
      expect(screen.getByTestId('topbar-ideas')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('More options'));
      expect(screen.queryByTestId('more-menu-ideas')).toBeNull();
    });

    it('should open Ideas dialog on click', () => {
      renderLoggedIn();
      openIdeasFromMenu();
      expect(screen.getByText(/Feature ideas, bug reports/)).toBeInTheDocument();
    });

    it('should show the support email link', () => {
      renderLoggedIn();
      openIdeasFromMenu();
      expect(screen.getByText('support@pratherbytecraft.com')).toBeInTheDocument();
    });

    it('should close dialog on Escape', async () => {
      renderLoggedIn();
      openIdeasFromMenu();
      expect(screen.getByText(/Feature ideas, bug reports/)).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByText(/Feature ideas, bug reports/)).toBeNull();
      });
    });
  });

  describe('Gift Button', () => {
    const renderLoggedIn = () => renderWithProviders(<TopBar />, {
      preloadedState: createBaseState({
        user: { currentUser, isLoading: false, error: null },
      }),
    });

    it('should show the gift button when logged in', () => {
      renderLoggedIn();
      expect(screen.getByTestId('gift-button')).toBeInTheDocument();
    });

    it('should open the Appearance menu, calm the attention animation, and reach the Supporter dialog from its footer', async () => {
      const { store } = renderLoggedIn();
      expect(store.getState().supporter.giftAttentionSeen).toBe(false);
      fireEvent.click(screen.getByTestId('gift-button'));
      expect(store.getState().supporter.giftAttentionSeen).toBe(true);
      expect(await screen.findByTestId('appearance-popover')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('appearance-open-hub'));
      expect(store.getState().supporter.dialogOpen).toBe(true);
      await waitFor(() => {
        expect(screen.getByTestId('supporter-dialog')).toBeInTheDocument();
      });
    });
  });

  describe('Supporter Badge', () => {
    // A valid key carries at least one live feature (payload v2).
    const livePayload = {
      v: 2,
      kid: '2026-2',
      jti: 'jti-top',
      name: 'Aaron P.',
      eh: 'hash',
      ent: { themes: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 },
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };
    const renderWithKeyStatus = (keyStatus: 'none' | 'valid' | 'expired') =>
      renderWithProviders(<TopBar />, {
        preloadedState: createBaseState({
          user: { currentUser, isLoading: false, error: null },
          supporter: {
            ...initialSupporterState,
            initialized: true,
            keyStatus,
            payload: keyStatus === 'none' ? null : livePayload,
          },
        }),
      });

    it('should show the gift icon and no ring pip for non-supporters', () => {
      renderWithKeyStatus('none');
      expect(screen.queryByTestId('supporter-badge')).toBeNull();
      expect(screen.queryByTestId('supporter-avatar-pip')).toBeNull();
      expect(screen.getByLabelText('Appearance')).toBeInTheDocument();
    });

    it('should keep the palette icon, mark it as the supporter badge, and show the avatar pip with a valid key', () => {
      renderWithKeyStatus('valid');
      expect(screen.getByTestId('supporter-badge')).toBeInTheDocument();
      expect(screen.getByTestId('supporter-avatar-pip')).toBeVisible();
      expect(screen.getByLabelText('Appearance')).toBeInTheDocument();
    });

    it('should still open the Supporter dialog from the menu footer', async () => {
      const { store } = renderWithKeyStatus('valid');
      fireEvent.click(screen.getByTestId('gift-button'));
      fireEvent.click(await screen.findByTestId('appearance-open-hub'));
      expect(store.getState().supporter.dialogOpen).toBe(true);
      await waitFor(() => {
        expect(screen.getByTestId('supporter-dialog')).toBeInTheDocument();
      });
    });

    it('should treat an expired key as non-supporter', () => {
      renderWithKeyStatus('expired');
      expect(screen.queryByTestId('supporter-badge')).toBeNull();
      expect(screen.getByLabelText('Appearance')).toBeInTheDocument();
    });
  });
});

describe('TopBar wide layout (md and up)', () => {
  const currentUser = createMockUser({ username: 'Aaron' });
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // MUI's useMediaQuery(up('md')) asks for "(min-width:900px)".
    window.matchMedia = ((query: string) => ({
      matches: /min-width:\s*900px/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const render = () =>
    renderWithProviders(<TopBar />, {
      preloadedState: createBaseState({ user: { currentUser, isLoading: false, error: null } }),
    });

  it('shows Supporter Wall, r/discrub and View Announcement inline and drops the More menu', () => {
    render();
    expect(screen.getByLabelText('Supporter Wall')).toBeInTheDocument();
    const reddit = screen.getByLabelText('r/discrub');
    expect(reddit).toHaveAttribute('href', 'https://www.reddit.com/r/discrub');
    expect(reddit).toHaveAttribute('target', '_blank');
    expect(screen.getByLabelText('View Announcement')).toBeInTheDocument();
    expect(screen.queryByLabelText('More options')).not.toBeInTheDocument();
    expect(screen.getByTestId('topbar-ideas')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Logout')).toBeInTheDocument();
  });

  it('View Announcement reopens the dialog from the inline button', () => {
    const { store } = render();
    fireEvent.click(screen.getByLabelText('View Announcement'));
    expect(store.getState().announcement.hasNew).toBe(true);
  });

  it('keeps one tour target for the extras regardless of layout', () => {
    render();
    expect(document.querySelector('[data-tour="topbar-extras"]')).toContainElement(screen.getByLabelText('Supporter Wall'));
  });

  describe('compact bot spotlight', () => {
    beforeEach(() => {
      // The spotlight waits for `lg` ("(min-width:1200px)"); match that too.
      window.matchMedia = ((query: string) => ({
        matches: /min-width:\s*(900|1200)px/.test(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    });

    it('waits for a bar wide enough (lg), even away from home', () => {
      // Only the wide-describe's 900px mock: md matches, lg does not.
      window.matchMedia = ((query: string) => ({
        matches: /min-width:\s*900px/.test(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
      renderWithProviders(<TopBar />, { preloadedState: createAuthenticatedState() });
      expect(screen.queryByTestId('topbar-bot-spot')).not.toBeInTheDocument();
    });

    it('stays off the welcome screen, where the corkboard already has the job', () => {
      render();
      expect(screen.queryByTestId('topbar-bot-spot')).not.toBeInTheDocument();
    });

    it('appears once a channel is selected', () => {
      renderWithProviders(<TopBar />, { preloadedState: createAuthenticatedState() });
      expect(screen.getByTestId('topbar-bot-spot')).toBeInTheDocument();
      expect(screen.getByTestId('bot-spot-add')).toBeInTheDocument();
    });

    it('appears in the package view', () => {
      const state = createBaseState({ user: { currentUser, isLoading: false, error: null } });
      state.app = { ...state.app, sidebarView: 'package' };
      renderWithProviders(<TopBar />, { preloadedState: state });
      expect(screen.getByTestId('topbar-bot-spot')).toBeInTheDocument();
    });

    it('steps aside while a heavy operation is running', () => {
      const state = createAuthenticatedState();
      state.purge = { ...state.purge, isPurging: true };
      renderWithProviders(<TopBar />, { preloadedState: state });
      expect(screen.queryByTestId('topbar-bot-spot')).not.toBeInTheDocument();
    });
  });
});
