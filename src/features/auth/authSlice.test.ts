import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';
import authReducer, {
  setToken,
  clearToken,
  setAuthError,
  authenticateWithToken,
  selectAuth,
  selectIsAuthenticated,
  selectAuthToken,
  selectAuthError,
  selectAuthLoading,
  rememberToken,
  forgetRememberedToken,
  hydrateRememberedToken,
  selectAuthRestoring,
  selectTokenRemembered, enterGuestMode, leaveGuestMode, signInAgain } from './authSlice';
import { requestDiscordToken } from '@/extension/messaging';
import {
  initialAuthState,
  REMEMBERED_TOKEN_STORAGE_KEY,
  REMEMBERED_TOKEN_EXPIRED_MESSAGE,
} from './authTypes';
import userReducer from '@features/user/userSlice';
import * as discordService from '@services/discordService';

vi.mock('@/extension/messaging', async (importOriginal) => ({ ...(await importOriginal<object>()), requestDiscordToken: vi.fn() }));

// Mock the Discord service
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));

// In-memory `Discrub-state` for the remembered-token thunks (#249)
const { stateData, stateStore } = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  return {
    stateData: data,
    stateStore: {
      get: vi.fn(async (key: string) => data[key] ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        data[key] = value;
      }),
      remove: vi.fn(async (key: string) => {
        delete data[key];
      }),
    },
  };
});
vi.mock('@/extension/storage', () => ({
  storage: { state: stateStore },
}));

const { mockHostedGate, mockHasHosted } = vi.hoisted(() => ({
  mockHostedGate: vi.fn(() => false),
  mockHasHosted: vi.fn(() => false),
}));
vi.mock('@services/hostedGate', () => ({
  isHostedGateEnabled: mockHostedGate,
  isBleedingEdgeBuild: vi.fn(() => false),
}));
vi.mock('@features/supporter/supporterSlice', () => ({
  selectHasHosted: mockHasHosted,
}));

describe('authSlice', () => {
  let store: TestStore;

  beforeEach(() => {
    store = createTestStore({ auth: authReducer, user: userReducer });
    vi.clearAllMocks();
    for (const key of Object.keys(stateData)) delete stateData[key];
    mockHostedGate.mockReturnValue(false);
    mockHasHosted.mockReturnValue(false);
  });

  const mockValidUser = () => {
    const svc = {
      fetchUserData: vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'user-123', username: 'testuser' },
      }),
    };
    vi.mocked(discordService.getDiscordService).mockReturnValue(svc as any);
    return svc;
  };
  const mockInvalidUser = () => {
    const svc = {
      fetchUserData: vi.fn().mockResolvedValue({ success: false, error: 'Unauthorized' }),
    };
    vi.mocked(discordService.getDiscordService).mockReturnValue(svc as any);
    return svc;
  };

  describe('signInAgain (2.2.5 row 50)', () => {
    const signedInAs = async (id: string, token: string) => {
      vi.mocked(discordService.getDiscordService).mockReturnValue({
        fetchUserData: vi.fn().mockResolvedValue({ success: true, data: { id, username: 'u' } }),
      } as any);
      await store.dispatch(authenticateWithToken(token));
    };

    it('swaps in the fresh token from the Discord tab for the same account', async () => {
      await signedInAs('user-123', 'old');
      vi.mocked(requestDiscordToken).mockResolvedValue({ success: true, token: 'new' });
      expect(await store.dispatch(signInAgain()).unwrap()).toBe('signedIn');
      expect(store.getState().auth.token).toBe('new');
      expect(store.getState().auth.isAuthenticated).toBe(true);
    });

    it('leaves everything as it is when the tab still has the expired token, another account or nothing', async () => {
      await signedInAs('user-123', 'old');
      vi.mocked(requestDiscordToken).mockResolvedValue({ success: true, token: 'old' });
      expect(await store.dispatch(signInAgain()).unwrap()).toBe('unchanged');

      vi.mocked(discordService.getDiscordService).mockReturnValue({
        fetchUserData: vi.fn().mockResolvedValue({ success: true, data: { id: 'someone-else' } }),
      } as any);
      vi.mocked(requestDiscordToken).mockResolvedValue({ success: true, token: 'other' });
      expect(await store.dispatch(signInAgain()).unwrap()).toBe('otherAccount');

      mockInvalidUser();
      expect(await store.dispatch(signInAgain()).unwrap()).toBe('failed');

      vi.mocked(requestDiscordToken).mockResolvedValue({ success: false, token: null });
      expect(await store.dispatch(signInAgain()).unwrap()).toBe('failed');

      expect(store.getState().auth.token).toBe('old');
      expect(store.getState().auth.isAuthenticated).toBe(true);
    });
  });

  describe('remembered token (#249)', () => {
    it('rememberToken persists the token under the auth:rememberedToken key', async () => {
      await store.dispatch(rememberToken('tok-1'));
      expect(stateStore.set).toHaveBeenCalledWith(REMEMBERED_TOKEN_STORAGE_KEY, 'tok-1');
      expect(selectTokenRemembered(store.getState() as never)).toBe(true);
    });

    it('forgetRememberedToken removes the stored token and clears the flag', async () => {
      await store.dispatch(rememberToken('tok-1'));
      await store.dispatch(forgetRememberedToken());
      expect(stateData[REMEMBERED_TOKEN_STORAGE_KEY]).toBeUndefined();
      expect(selectTokenRemembered(store.getState() as never)).toBe(false);
    });

    it('hydrate with nothing stored leaves auth untouched', async () => {
      const svc = mockValidUser();
      const p = store.dispatch(hydrateRememberedToken());
      // Nothing stored: the restoring flag must never flip (no panel flash)
      expect(selectAuthRestoring(store.getState() as never)).toBe(false);
      await p;
      const auth = store.getState().auth;
      expect(auth.isAuthenticated).toBe(false);
      expect(auth.tokenRemembered).toBe(false);
      expect(auth.isRestoring).toBe(false);
      expect(svc.fetchUserData).not.toHaveBeenCalled();
    });

    it('hydrate signs in with a stored token that Discord accepts', async () => {
      stateData[REMEMBERED_TOKEN_STORAGE_KEY] = 'saved-token';
      let release!: (v: unknown) => void;
      const svc = {
        fetchUserData: vi.fn(() => new Promise((resolve) => { release = resolve; })),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(svc as any);
      const p = store.dispatch(hydrateRememberedToken());
      await vi.waitFor(() => {
        expect(selectAuthRestoring(store.getState() as never)).toBe(true);
      });
      release({ success: true, data: { id: 'user-123', username: 'testuser' } });
      await p;
      const auth = store.getState().auth;
      expect(svc.fetchUserData).toHaveBeenCalledWith('saved-token');
      expect(auth.isAuthenticated).toBe(true);
      expect(auth.token).toBe('saved-token');
      expect(auth.tokenRemembered).toBe(true);
      expect(auth.isRestoring).toBe(false);
      expect(auth.error).toBeNull();
    });

    it('hydrate drops a stored token Discord rejects and explains why', async () => {
      stateData[REMEMBERED_TOKEN_STORAGE_KEY] = 'stale-token';
      mockInvalidUser();
      await store.dispatch(hydrateRememberedToken());
      const auth = store.getState().auth;
      expect(auth.isAuthenticated).toBe(false);
      expect(auth.tokenRemembered).toBe(false);
      expect(auth.error).toBe(REMEMBERED_TOKEN_EXPIRED_MESSAGE);
      expect(stateData[REMEMBERED_TOKEN_STORAGE_KEY]).toBeUndefined();
    });

    it('hydrate does not sign in after a manual logout (token kept until Logout forgets it)', async () => {
      stateData[REMEMBERED_TOKEN_STORAGE_KEY] = 'saved-token';
      const svc = mockValidUser();
      store.dispatch(clearToken());
      await store.dispatch(hydrateRememberedToken());
      expect(svc.fetchUserData).not.toHaveBeenCalled();
      expect(store.getState().auth.isAuthenticated).toBe(false);
      expect(stateData[REMEMBERED_TOKEN_STORAGE_KEY]).toBe('saved-token');
    });

    it('hydrate honours the hosted gate: no live hosted feature means no restore', async () => {
      stateData[REMEMBERED_TOKEN_STORAGE_KEY] = 'saved-token';
      mockHostedGate.mockReturnValue(true);
      mockHasHosted.mockReturnValue(false);
      const svc = mockValidUser();
      await store.dispatch(hydrateRememberedToken());
      expect(svc.fetchUserData).not.toHaveBeenCalled();
      expect(store.getState().auth.tokenRemembered).toBe(true);
    });

    it('hydrate restores through the hosted gate when the key carries hosted', async () => {
      stateData[REMEMBERED_TOKEN_STORAGE_KEY] = 'saved-token';
      mockHostedGate.mockReturnValue(true);
      mockHasHosted.mockReturnValue(true);
      mockValidUser();
      await store.dispatch(hydrateRememberedToken());
      expect(store.getState().auth.isAuthenticated).toBe(true);
    });
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = store.getState();
      expect(state.auth).toEqual(initialAuthState);
      expect(state.auth.token).toBeNull();
      expect(state.auth.isAuthenticated).toBe(false);
      expect(state.auth.isLoading).toBe(false);
      expect(state.auth.error).toBeNull();
    });
  });

  describe('reducers', () => {
    describe('setToken', () => {
      it('should set token and mark as authenticated', () => {
        const token = 'test-token-123';
        store.dispatch(setToken(token));

        const state = store.getState().auth;
        expect(state.token).toBe(token);
        expect(state.isAuthenticated).toBe(true);
        expect(state.error).toBeNull();
      });

      it('should clear error when setting token', () => {
        // First set an error
        store.dispatch(setAuthError('Previous error'));
        expect(store.getState().auth.error).toBe('Previous error');

        // Then set token
        store.dispatch(setToken('new-token'));

        const state = store.getState().auth;
        expect(state.error).toBeNull();
        expect(state.isAuthenticated).toBe(true);
      });

      it('should handle empty string token', () => {
        store.dispatch(setToken(''));

        const state = store.getState().auth;
        expect(state.token).toBe('');
        expect(state.isAuthenticated).toBe(true);
      });

      it('should update token when called multiple times', () => {
        store.dispatch(setToken('token-1'));
        expect(store.getState().auth.token).toBe('token-1');

        store.dispatch(setToken('token-2'));
        expect(store.getState().auth.token).toBe('token-2');
      });
    });

    describe('clearToken', () => {
      it('should clear token and reset authentication state', () => {
        // First set a token
        store.dispatch(setToken('test-token'));
        expect(store.getState().auth.isAuthenticated).toBe(true);

        // Then clear it
        store.dispatch(clearToken());

        const state = store.getState().auth;
        expect(state.token).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(state.error).toBeNull();
      });

      it('should clear error when clearing token', () => {
        // Set token and error
        store.dispatch(setToken('test-token'));
        store.dispatch(setAuthError('Some error'));

        // Clear token
        store.dispatch(clearToken());

        const state = store.getState().auth;
        expect(state.error).toBeNull();
      });

      it('should be idempotent', () => {
        // Clear when already cleared
        store.dispatch(clearToken());
        const state1 = store.getState().auth;

        store.dispatch(clearToken());
        const state2 = store.getState().auth;

        expect(state1).toEqual(state2);
        expect(state2).toEqual({ ...initialAuthState, manuallyLoggedOut: true, isRestoring: false, tokenRemembered: false, guestMode: false });
      });
    });

    describe('setAuthError', () => {
      it('should set error and clear authentication', () => {
        const errorMessage = 'Authentication failed';
        store.dispatch(setAuthError(errorMessage));

        const state = store.getState().auth;
        expect(state.error).toBe(errorMessage);
        expect(state.isAuthenticated).toBe(false);
        expect(state.token).toBeNull();
      });

      it('should clear token when setting error', () => {
        // First set a token
        store.dispatch(setToken('test-token'));
        expect(store.getState().auth.token).toBe('test-token');

        // Then set error
        store.dispatch(setAuthError('Token invalid'));

        const state = store.getState().auth;
        expect(state.token).toBeNull();
        expect(state.isAuthenticated).toBe(false);
      });

      it('should handle empty error message', () => {
        store.dispatch(setAuthError(''));

        const state = store.getState().auth;
        expect(state.error).toBe('');
        expect(state.isAuthenticated).toBe(false);
      });

      it('should update error when called multiple times', () => {
        store.dispatch(setAuthError('Error 1'));
        expect(store.getState().auth.error).toBe('Error 1');

        store.dispatch(setAuthError('Error 2'));
        expect(store.getState().auth.error).toBe('Error 2');
      });
    });
  });

  describe('authenticateWithToken async thunk', () => {
    it('should set loading state when pending', () => {
      const mockDiscordService = {
        fetchUserData: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(authenticateWithToken('test-token'));

      const state = store.getState().auth;
      expect(state.isLoading).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should handle successful authentication', async () => {
      const mockDiscordService = {
        fetchUserData: vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'user-123', username: 'testuser' },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      const token = 'valid-token-123';
      await store.dispatch(authenticateWithToken(token));

      const state = store.getState().auth;
      expect(state.isLoading).toBe(false);
      expect(state.token).toBe(token);
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBeNull();

      expect(mockDiscordService.fetchUserData).toHaveBeenCalledWith(token);
    });

    it('should handle authentication failure with API error', async () => {
      const mockDiscordService = {
        fetchUserData: vi.fn().mockRejectedValue(new Error('Invalid token')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(authenticateWithToken('invalid-token'));

      const state = store.getState().auth;
      expect(state.isLoading).toBe(false);
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      // userSlice converts Error to string via rejectWithValue('Invalid token')
      // Then unwrap() throws that string, authSlice catches it, sees it's not an Error
      // and uses the fallback message 'Failed to authenticate'
      expect(state.error).toBe('Failed to authenticate');
    });

    it('should handle authentication failure with non-Error', async () => {
      const mockDiscordService = {
        fetchUserData: vi.fn().mockRejectedValue('String error'),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(authenticateWithToken('invalid-token'));

      const state = store.getState().auth;
      expect(state.error).toBe('Failed to authenticate');
    });

    it('should clear previous error on successful authentication', async () => {
      // Set initial error
      store.dispatch(setAuthError('Previous error'));
      expect(store.getState().auth.error).toBe('Previous error');

      // Successful authentication
      const mockDiscordService = {
        fetchUserData: vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'user-123' },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      await store.dispatch(authenticateWithToken('valid-token'));

      const state = store.getState().auth;
      expect(state.error).toBeNull();
      expect(state.isAuthenticated).toBe(true);
    });

    it('should handle authentication attempt after previous failure', async () => {
      // First attempt fails
      const mockDiscordServiceFail = {
        fetchUserData: vi.fn().mockRejectedValue(new Error('First error')),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordServiceFail as any);

      await store.dispatch(authenticateWithToken('bad-token'));
      expect(store.getState().auth.error).toBe('Failed to authenticate');

      // Second attempt succeeds
      const mockDiscordServiceSuccess = {
        fetchUserData: vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'user-123' },
        }),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordServiceSuccess as any);

      await store.dispatch(authenticateWithToken('good-token'));

      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBeNull();
      expect(state.token).toBe('good-token');
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      // Set up a known state
      store.dispatch(setToken('test-token'));
      store.dispatch(setAuthError('Test error'));
    });

    it('selectAuth should return entire auth state', () => {
      const auth = selectAuth(store.getState());
      expect(auth).toHaveProperty('token');
      expect(auth).toHaveProperty('isAuthenticated');
      expect(auth).toHaveProperty('isLoading');
      expect(auth).toHaveProperty('error');
    });

    it('selectIsAuthenticated should return authentication status', () => {
      expect(selectIsAuthenticated(store.getState())).toBe(false); // Error was set, which clears auth

      store.dispatch(setToken('valid-token'));
      expect(selectIsAuthenticated(store.getState())).toBe(true);
    });

    it('selectAuthToken should return token', () => {
      const state = store.getState();
      const token = selectAuthToken(state);
      expect(token).toBeNull(); // Error was set, which clears token

      store.dispatch(setToken('my-token'));
      expect(selectAuthToken(store.getState())).toBe('my-token');
    });

    it('selectAuthError should return error', () => {
      const error = selectAuthError(store.getState());
      expect(error).toBe('Test error');

      store.dispatch(clearToken());
      expect(selectAuthError(store.getState())).toBeNull();
    });

    it('selectAuthLoading should return loading status', () => {
      expect(selectAuthLoading(store.getState())).toBe(false);

      // Trigger loading state
      const mockDiscordService = {
        fetchUserData: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);

      store.dispatch(authenticateWithToken('test'));
      expect(selectAuthLoading(store.getState())).toBe(true);
    });
  });
});

// #275: browsing a data package without signing in.
describe('authSlice guest mode (#275)', () => {
  it('enterGuestMode and leaveGuestMode flip the flag without touching the token', () => {
    const store = createTestStore({ auth: authReducer, user: userReducer });
    expect(store.getState().auth.guestMode).toBe(false);
    store.dispatch(enterGuestMode());
    expect(store.getState().auth.guestMode).toBe(true);
    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(store.getState().auth.token).toBeNull();
    store.dispatch(leaveGuestMode());
    expect(store.getState().auth.guestMode).toBe(false);
  });

  it('signing in ends the guest session', () => {
    const store = createTestStore({ auth: authReducer, user: userReducer });
    store.dispatch(enterGuestMode());
    store.dispatch(setToken('tok'));
    expect(store.getState().auth.guestMode).toBe(false);
    expect(store.getState().auth.isAuthenticated).toBe(true);
  });
});
