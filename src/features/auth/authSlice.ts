import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import {
  initialAuthState,
  REMEMBERED_TOKEN_STORAGE_KEY,
  REMEMBERED_TOKEN_EXPIRED_MESSAGE,
} from './authTypes';
import { fetchUserData } from '@features/user/userSlice';
import { storage } from '@/extension/storage';
import { isHostedGateEnabled } from '@services/hostedGate';
import { selectHasHosted } from '@features/supporter/supporterSlice';
import type { RootState } from '@/app/store';

/**
 * Auth slice - manages authentication state
 * The token lives in memory. Web builds may opt in to persisting it on
 * the device ("Keep me logged in", #249); it is then
 * stored plaintext under REMEMBERED_TOKEN_STORAGE_KEY in `Discrub-state`
 * and restored on boot by `hydrateRememberedToken`. Logging out forgets it.
 */

/**
 * Async thunk to authenticate user with Discord token
 * Validates token by attempting to fetch user data
 */
export const authenticateWithToken = createAsyncThunk(
  'auth/authenticateWithToken',
  async (token: string, { dispatch, rejectWithValue }) => {
    try {
      // Validate token by fetching user data
      await dispatch(fetchUserData(token)).unwrap();
      return token;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to authenticate'
      );
    }
  }
);

/**
 * Persist the signed-in token on this device (#249). Called after a
 * successful manual sign-in when the opt-in checkbox is ticked.
 */
export const rememberToken = createAsyncThunk(
  'auth/rememberToken',
  async (token: string) => {
    await storage.state.set(REMEMBERED_TOKEN_STORAGE_KEY, token);
  }
);

/** Drop the persisted token (Logout, unticked sign-in, failed restore). */
export const forgetRememberedToken = createAsyncThunk(
  'auth/forgetRememberedToken',
  async () => {
    await storage.state.remove(REMEMBERED_TOKEN_STORAGE_KEY).catch(() => {});
  }
);

/**
 * Boot-time restore of a remembered token (#249). Runs after
 * `initializeSupporter` so a hosted (Bleeding Edge) build still honours
 * the key gate: with the gate up and no live `hosted` feature the stored
 * token is left alone and nothing signs in. A token Discord rejects is
 * removed and the landing page explains why.
 */
export const hydrateRememberedToken = createAsyncThunk<
  { restored: boolean; remembered: boolean },
  void,
  { state: RootState }
>(
  'auth/hydrateRememberedToken',
  async (_, { dispatch, getState }) => {
    const stored = await storage.state.get<string>(REMEMBERED_TOKEN_STORAGE_KEY);
    if (typeof stored !== 'string' || !stored.trim()) {
      return { restored: false, remembered: false };
    }
    if (getState().auth.manuallyLoggedOut || getState().auth.isAuthenticated) {
      return { restored: false, remembered: true };
    }
    if (isHostedGateEnabled() && !selectHasHosted(getState())) {
      return { restored: false, remembered: true };
    }
    dispatch(restoreStarted());
    try {
      await dispatch(authenticateWithToken(stored)).unwrap();
      return { restored: true, remembered: true };
    } catch {
      await dispatch(forgetRememberedToken());
      throw new Error(REMEMBERED_TOKEN_EXPIRED_MESSAGE);
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    setToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload;
      state.isAuthenticated = true;
      state.guestMode = false;
      state.error = null;
    },
    /** #275: open the main layout with only the Package view, no token. */
    enterGuestMode: (state) => {
      state.guestMode = true;
      state.error = null;
    },
    /** #275: back to the landing page from a guest session. */
    leaveGuestMode: (state) => {
      state.guestMode = false;
    },
    clearToken: (state) => {
      state.token = null;
      state.isAuthenticated = false;
      state.error = null;
      state.manuallyLoggedOut = true;
    },
    clearManualLogout: (state) => {
      state.manuallyLoggedOut = false;
    },
    /** A stored token exists and is now being validated (#249). */
    restoreStarted: (state) => {
      state.isRestoring = true;
    },
    setAuthError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.isAuthenticated = false;
      state.token = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(authenticateWithToken.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(authenticateWithToken.fulfilled, (state, action) => {
        state.guestMode = false;
        state.isLoading = false;
        state.token = action.payload;
        state.isAuthenticated = true;
        state.error = null;
        state.manuallyLoggedOut = false;
      })
      .addCase(authenticateWithToken.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.token = null;
        state.isAuthenticated = false;
      })
      .addCase(rememberToken.fulfilled, (state) => {
        state.tokenRemembered = true;
      })
      .addCase(forgetRememberedToken.fulfilled, (state) => {
        state.tokenRemembered = false;
      })
      .addCase(hydrateRememberedToken.fulfilled, (state, action) => {
        state.isRestoring = false;
        state.tokenRemembered = action.payload.remembered;
      })
      .addCase(hydrateRememberedToken.rejected, (state, action) => {
        state.isRestoring = false;
        state.tokenRemembered = false;
        state.error = action.error.message ?? REMEMBERED_TOKEN_EXPIRED_MESSAGE;
      });
  },
});

export const { setToken, clearToken, setAuthError, clearManualLogout, restoreStarted, enterGuestMode, leaveGuestMode } = authSlice.actions;

// Selectors
export const selectAuth = (state: RootState) => state.auth;
export const selectIsAuthenticated = (state: RootState) => state.auth.isAuthenticated;
export const selectAuthToken = (state: RootState) => state.auth.token;
export const selectAuthError = (state: RootState) => state.auth.error;
export const selectAuthLoading = (state: RootState) => state.auth.isLoading;
export const selectManuallyLoggedOut = (state: RootState) => state.auth.manuallyLoggedOut;
export const selectAuthRestoring = (state: RootState) => state.auth.isRestoring;
export const selectTokenRemembered = (state: RootState) => state.auth.tokenRemembered;
export const selectIsGuestMode = (state: RootState) => state.auth.guestMode;

export default authSlice.reducer;
