import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import LandingPage from './LandingPage';
import { createBaseState } from '../../test/state-factories';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import type { SupporterKeyPayload } from '@services/supporterKeyService';

// Mock extension messaging
vi.mock('@/extension/messaging', () => ({
  isExtensionMode: vi.fn(() => false),
  requestDiscordToken: vi.fn().mockResolvedValue({ success: false, error: 'No token' }),
}));

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    validateToken: vi.fn().mockResolvedValue({ id: 'user-1', username: 'testuser' }),
    fetchCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', username: 'testuser' }),
    fetchUserData: vi.fn().mockResolvedValue({ success: true, data: { id: 'user-1', username: 'testuser' } }),
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

describe('LandingPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset import.meta.env mock
    vi.stubEnv('VITE_DISCORD_TOKEN', '');
    vi.stubEnv('VITE_HOSTED_GATE', '');
    // Reset isExtensionMode to false (may have been changed by Extension Mode tests)
    const { isExtensionMode } = await import('@/extension/messaging');
    vi.mocked(isExtensionMode).mockReturnValue(false);
  });

  describe('Rendering', () => {
    it('should render the welcome title', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText(/Welcome to Discrub/)).toBeInTheDocument();
    });

    it('should render the token input field', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByLabelText(/Discord Token/)).toBeInTheDocument();
    });

    it('should render the Sign In button', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    });

    it('should render help link', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText('How to find my Discord token?')).toBeInTheDocument();
    });

    it('should render disclaimer text', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText(/Discrub is an unofficial tool/)).toBeInTheDocument();
    });
  });

  describe('Token Input', () => {
    it('should allow entering a token', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      const input = screen.getByLabelText(/Discord Token/);
      fireEvent.change(input, { target: { value: 'my-test-token' } });
      expect((input as HTMLInputElement).value).toBe('my-test-token');
    });

    it('should disable Sign In when token is empty', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled();
    });

    it('should enable Sign In when token is entered', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });
      const input = screen.getByLabelText(/Discord Token/);
      fireEvent.change(input, { target: { value: 'my-token' } });
      expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeDisabled();
    });
  });

  describe('Error Display', () => {
    it('should show auth error when present', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: 'Invalid token', manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
        }),
      });
      expect(screen.getByText('Invalid token')).toBeInTheDocument();
    });

    it('should show helper text about invalid token on error', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: 'Bad token', manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
        }),
      });
      expect(screen.getByText(/Invalid token. Check it and try again/)).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should disable token input while loading', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: true, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
        }),
      });
      expect(screen.getByLabelText(/Discord Token/)).toBeDisabled();
    });

    it('should show spinner instead of Sign In text while loading', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: true, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
        }),
      });
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Extension Mode', () => {
    it('should show authenticating screen during auto-auth in extension mode', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);

      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });

      // In extension mode with auto-auth loading, the authenticating screen appears
      expect(screen.getByText(/Authenticating with Discord/)).toBeInTheDocument();
    });
  });

  describe('Sign In', () => {
    it('should dispatch authenticateWithToken when form is submitted', async () => {
      const { store } = renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState(),
      });

      const input = screen.getByLabelText(/Discord Token/);
      fireEvent.change(input, { target: { value: 'test-token' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      // Auth state should be loading after dispatch
      await vi.waitFor(() => {
        const state = store.getState();
        expect(state.auth.isLoading).toBe(true);
      });
    });
  });

  describe('Keep me logged in (#249)', () => {
    it('offers the unticked "Keep me logged in" opt-in on web builds', () => {
      renderWithProviders(<LandingPage />, { preloadedState: createBaseState() });
      const box = screen.getByTestId('landing-remember-token') as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(screen.getByText('Keep me logged in')).toBeInTheDocument();
      expect(screen.getByText('Only do this on a device you trust')).toBeInTheDocument();
      expect(screen.getByText('Your token is only kept until you close this tab')).toBeInTheDocument();
    });

    it('hides the checkbox in extension mode (the token bridge handles auth there)', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);
      renderWithProviders(<LandingPage />, { preloadedState: createBaseState() });
      await vi.waitFor(() => {
        expect(screen.getByText('Try Auto-Authentication Again')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('landing-remember-token')).toBeNull();
    });

    it('ticking the box swaps the helper text to the saved-on-device wording', () => {
      renderWithProviders(<LandingPage />, { preloadedState: createBaseState() });
      fireEvent.click(screen.getByTestId('landing-remember-token'));
      expect((screen.getByTestId('landing-remember-token') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText('Your token will be saved on this device until you log out')).toBeInTheDocument();
    });

    it('persists the token after a successful sign-in when ticked', async () => {
      const { storage } = await import('@/extension/storage');
      renderWithProviders(<LandingPage />, { preloadedState: createBaseState() });
      fireEvent.click(screen.getByTestId('landing-remember-token'));
      fireEvent.change(screen.getByLabelText(/Discord Token/), { target: { value: 'keep-me' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
      await vi.waitFor(() => {
        expect(storage.state.set).toHaveBeenCalledWith('auth:rememberedToken', 'keep-me');
      });
    });

    it('does not persist the token when left unticked, and drops a previously remembered one', async () => {
      const { storage } = await import('@/extension/storage');
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: true, guestMode: false },
        }),
      });
      fireEvent.change(screen.getByLabelText(/Discord Token/), { target: { value: 'once' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
      await vi.waitFor(() => {
        expect(storage.state.remove).toHaveBeenCalledWith('auth:rememberedToken');
      });
      expect(storage.state.set).not.toHaveBeenCalledWith('auth:rememberedToken', expect.anything());
    });

    it('shows "Forget saved token" on the gate when a token is stored but not restored', async () => {
      const { storage } = await import('@/extension/storage');
      const { store } = renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: true, guestMode: false },
        }),
      });
      expect(screen.getByTestId('landing-token-remembered')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('landing-forget-token'));
      await vi.waitFor(() => {
        expect(storage.state.remove).toHaveBeenCalledWith('auth:rememberedToken');
      });
      await vi.waitFor(() => {
        expect(store.getState().auth.tokenRemembered).toBe(false);
      });
      expect(screen.queryByTestId('landing-token-remembered')).toBeNull();
    });

    it('shows the restoring panel while a remembered token is being validated', () => {
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: true, error: null, manuallyLoggedOut: false, isRestoring: true, tokenRemembered: true, guestMode: false },
        }),
      });
      expect(screen.getByTestId('landing-restoring')).toBeInTheDocument();
      expect(screen.getByText('Signing in with the token saved on this device')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Discord Token/)).toBeNull();
    });
  });

  describe('Hosted gate (VITE_HOSTED_GATE=true)', () => {
    const DAY_S = 24 * 60 * 60;
    const nowS = Math.floor(Date.now() / 1000);
    const hostedPayload: SupporterKeyPayload = {
      v: 2,
      kid: '2026-2',
      jti: 'jti-h',
      name: 'Aaron P.',
      eh: 'hash',
      ent: { themes: nowS + 30 * DAY_S, hosted: nowS + 30 * DAY_S },
      iat: nowS,
      exp: nowS + 30 * DAY_S,
    };
    const themesOnlyPayload: SupporterKeyPayload = {
      ...hostedPayload,
      jti: 'jti-t',
      ent: { themes: nowS + 30 * DAY_S },
    };

    const renderGate = (supporter: Partial<typeof initialSupporterState>) =>
      renderWithProviders(<LandingPage />, {
        preloadedState: createBaseState({
          supporter: { ...initialSupporterState, initialized: true, ...supporter },
        }) as never,
      });

    beforeEach(() => {
      vi.stubEnv('VITE_HOSTED_GATE', 'true');
    });

    it('is absent from the ordinary build', () => {
      vi.stubEnv('VITE_HOSTED_GATE', '');
      renderGate({});
      expect(screen.queryByTestId('hosted-gate')).toBeNull();
    });

    it('asks for a supporter key (masked) and keeps Sign In disabled without one', () => {
      renderGate({});
      expect(screen.getByTestId('bleeding-prefix')).toHaveTextContent('Discrub');
      expect(screen.getByTestId('bleeding-title')).toHaveTextContent('Bleeding Edge');
      const keyField = screen.getByTestId('hosted-gate-key');
      expect(keyField).toHaveAttribute('type', 'password');
      expect(screen.getByLabelText(/Discord Token/)).toHaveAttribute('type', 'password');
      fireEvent.change(screen.getByLabelText(/Discord Token/), { target: { value: 'tok' } });
      expect(screen.getByTestId('landing-sign-in')).toBeDisabled();
      expect(screen.getByTestId('hosted-gate-help')).toHaveTextContent(/Paste the key from your Ko-fi email/);
      expect(screen.getByTestId('hosted-gate-kofi-monthly')).toHaveAttribute(
        'href',
        'https://ko-fi.com/prathercc/tiers',
      );
      expect(screen.getByTestId('hosted-gate-kofi-yearly')).toHaveAttribute(
        'href',
        'https://ko-fi.com/s/3b0ad65948',
      );
      expect(screen.getByTestId('bleeding-prefix')).toHaveTextContent('Discrub');
      expect(screen.getByTestId('bleeding-title')).toHaveTextContent('Bleeding Edge');
      expect(screen.getByTestId('bleeding-caption')).toHaveTextContent(/Early access build v\d+\.\d+\.\d+/);
      expect(screen.getAllByTestId('bleeding-drip')).toHaveLength(1);
      expect(screen.queryByText('Welcome to Discrub')).toBeNull();
    });

    it('lets a hosted-entitled key through and shows it as remembered', () => {
      renderGate({ keyStatus: 'valid', payload: hostedPayload });
      expect(screen.getByTestId('hosted-gate-key-status')).toHaveTextContent(
        /Supporter key validated\./,
      );
      expect(screen.queryByTestId('hosted-gate-key')).toBeNull();
      fireEvent.change(screen.getByLabelText(/Discord Token/), { target: { value: 'tok' } });
      expect(screen.getByTestId('landing-sign-in')).not.toBeDisabled();
    });

    it('tells a themes-only key holder that Bleeding Edge is a separate tier', () => {
      renderGate({ keyStatus: 'valid', payload: themesOnlyPayload });
      expect(screen.getByTestId('hosted-gate-key-status')).toHaveTextContent(
        /doesn't include Bleeding Edge/,
      );
      fireEvent.change(screen.getByLabelText(/Discord Token/), { target: { value: 'tok' } });
      expect(screen.getByTestId('landing-sign-in')).toBeDisabled();
    });

    it('"Forget my key" removes the key and brings the field back', async () => {
      const { store } = renderGate({ keyStatus: 'valid', payload: hostedPayload });
      fireEvent.click(screen.getByTestId('hosted-gate-forget-key'));
      await vi.waitFor(() => {
        expect(store.getState().supporter.keyStatus).toBe('none');
      });
      expect(screen.getByTestId('hosted-gate-key')).toBeInTheDocument();
    });
  });
});

// #275: the landing page offers a way into the Package view without a token.
describe('LandingPage browse a data package (#275)', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_DISCORD_TOKEN', '');
    vi.stubEnv('VITE_HOSTED_GATE', '');
    const { isExtensionMode } = await import('@/extension/messaging');
    vi.mocked(isExtensionMode).mockReturnValue(false);
  });

  it('starts a guest session on the Package view', () => {
    const { store } = renderWithProviders(<LandingPage />, { preloadedState: createBaseState() });
    fireEvent.click(screen.getByTestId('landing-browse-package'));
    expect(store.getState().auth.guestMode).toBe(true);
    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(store.getState().app.sidebarView).toBe('package');
  });
});
