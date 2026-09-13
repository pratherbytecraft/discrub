import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { AppTask, SidebarView, FeedDialog, FeedScrollAnchor, initialAppState, closedFeedDialogs } from './appTypes';
import type { RootState } from '@/app/store';
import { storage, migrateAllStorage } from '@/extension/storage';
import {
  defaultSettings as DEFAULT_SETTINGS,
  isStateSettingKey,
} from './storageKeys';
import { DEFAULT_LANGUAGE, detectBrowserLanguage, isLanguageCode } from '@/i18n/language';

/**
 * App slice — manages global application state including settings,
 * task status, and pause/cancel state.
 *
 * Settings persistence (post-#110-refinement):
 *
 *   • Each setting is its own key in `Discrub-settings` (or
 *     `Discrub-state` for app-internal markers like tour flags). No
 *     more JSON-blob mega-row.
 *   • The `selectSetting` API stays unified — callers don't need to
 *     know which DB a key lives in. Routing happens in
 *     `loadSettings` / `updateSetting`.
 *   • `EXPORT_PRESETS` and `EXPORT_RECENT_HISTORY` no longer live in
 *     settings at all — they have their own slices (presetsSlice,
 *     historySlice). Migration moves any pre-existing data over.
 */

/** Re-export so call sites that imported from here continue to work. */
export const defaultSettings = DEFAULT_SETTINGS;

/** Pulls every known setting key out of its appropriate store. */
async function loadAllSettingsFromStorage(): Promise<{
  settings: AppSettings;
  hasStoredSettings: boolean;
}> {
  const knownKeys = Object.keys(defaultSettings);
  const settingsKeys = knownKeys.filter((k) => !isStateSettingKey(k));
  const stateKeys = knownKeys.filter((k) => isStateSettingKey(k));

  const [settingsValues, stateValues] = await Promise.all([
    storage.settings.getMany<AppSettings[keyof AppSettings]>(settingsKeys),
    storage.state.getMany<AppSettings[keyof AppSettings]>(stateKeys),
  ]);

  const merged: AppSettings = { ...defaultSettings };
  const hasStoredSettings = settingsValues.some((v) => v !== null && v !== undefined);
  settingsKeys.forEach((k, i) => {
    const v = settingsValues[i];
    if (v !== null && v !== undefined) {
      (merged as Record<string, unknown>)[k] = v;
    }
  });
  stateKeys.forEach((k, i) => {
    const v = stateValues[i];
    if (v !== null && v !== undefined) {
      (merged as Record<string, unknown>)[k] = v;
    }
  });
  return { settings: merged, hasStoredSettings };
}

/**
 * Load every setting on app boot. Triggers the unified storage
 * migration first (idempotent — short-circuits after first run).
 */
export const loadSettings = createAsyncThunk(
  'app/loadSettings',
  async (_, { dispatch, rejectWithValue }) => {
    try {
      // Idempotent: legacy JSON-blob and localStorage data → per-key.
      await migrateAllStorage();
      const { settings, hasStoredSettings } = await loadAllSettingsFromStorage();
      // #124: resolve the UI language once. A fresh install follows the
      // browser; an existing install keeps English and, when the browser
      // prefers a supported language, gets a one-time offer to switch.
      if (!isLanguageCode(settings[DiscrubSetting.APP_LANGUAGE])) {
        const detected = detectBrowserLanguage();
        const resolved = hasStoredSettings ? DEFAULT_LANGUAGE : detected;
        settings[DiscrubSetting.APP_LANGUAGE] = resolved;
        if (hasStoredSettings && detected !== DEFAULT_LANGUAGE) {
          dispatch(appSlice.actions.setSuggestedLanguage(detected));
        }
        await storage.settings.set(DiscrubSetting.APP_LANGUAGE, resolved);
      }
      return settings;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return rejectWithValue('Failed to load settings');
    }
  },
);

/**
 * Update a single setting. Routes the write to the correct
 * per-purpose database based on whether the key is meta-state or a
 * user preference.
 */
export const updateSetting = createAsyncThunk(
  'app/updateSetting',
  async (
    { key, value }: { key: DiscrubSetting; value: AppSettings[keyof AppSettings] },
    { getState, rejectWithValue },
  ) => {
    try {
      const state = getState() as RootState;
      const currentSettings = state.app.settings || defaultSettings;
      const target = isStateSettingKey(key) ? storage.state : storage.settings;
      await target.set(key, value);
      return { ...currentSettings, [key]: value };
    } catch (error) {
      console.error('Failed to update setting:', error);
      return rejectWithValue('Failed to update setting');
    }
  },
);

/**
 * Replace every setting at once. Used by SettingsModal's "Save". Each
 * key is routed to its proper store; both writes happen in parallel
 * inside a single bulk transaction per store.
 */
export const updateAllSettings = createAsyncThunk(
  'app/updateAllSettings',
  async (settings: AppSettings, { rejectWithValue }) => {
    try {
      const settingsEntries: Array<[string, unknown]> = [];
      const stateEntries: Array<[string, unknown]> = [];
      for (const [key, value] of Object.entries(settings)) {
        if (isStateSettingKey(key)) stateEntries.push([key, value]);
        else settingsEntries.push([key, value]);
      }
      await Promise.all([
        storage.settings.setMany(settingsEntries),
        storage.state.setMany(stateEntries),
      ]);
      return settings;
    } catch (error) {
      console.error('Failed to update settings:', error);
      return rejectWithValue('Failed to update settings');
    }
  },
);

const appSlice = createSlice({
  name: 'app',
  initialState: initialAppState,
  reducers: {
    setDiscrubPaused: (state, action: PayloadAction<boolean>) => {
      state.discrubPaused = action.payload;
    },
    setRateLimitStopped: (state, action: PayloadAction<boolean>) => {
      state.rateLimitStopped = action.payload;
    },
    setRequestsRefusedStopped: (state, action: PayloadAction<boolean>) => {
      state.requestsRefusedStopped = action.payload;
    },
    setRestBreakUntil: (state, action: PayloadAction<number | null>) => {
      state.restBreakUntil = action.payload;
    },
    setSuggestedLanguage: (state, action: PayloadAction<string | null>) => {
      state.suggestedLanguage = action.payload;
    },
    setDiscrubCancelled: (state, action: PayloadAction<boolean>) => {
      state.discrubCancelled = action.payload;
    },
    setTask: (state, action: PayloadAction<AppTask>) => {
      state.task = action.payload;
    },
    setMinimized: (state, action: PayloadAction<boolean>) => {
      state.isMinimized = action.payload;
    },
    setFocusedView: (state, action: PayloadAction<boolean>) => {
      state.focusedView = action.payload;
    },
    toggleFocusedView: (state) => {
      state.focusedView = !state.focusedView;
    },
    setKofiOverlayOpen: (state, action: PayloadAction<boolean>) => {
      state.kofiOverlayOpen = action.payload;
    },
    setSidebarView: (state, action: PayloadAction<SidebarView>) => {
      state.sidebarView = action.payload;
    },
    setSettings: (state, action: PayloadAction<AppSettings>) => {
      state.settings = action.payload;
    },
    setPreviewThemeId: (state, action: PayloadAction<string | null>) => {
      state.previewThemeId = action.payload;
    },
    setDialogOpen: (state, action: PayloadAction<{ dialog: FeedDialog; open: boolean }>) => {
      state.dialogs = { ...closedFeedDialogs, ...state.dialogs, [action.payload.dialog]: action.payload.open };
    },
    toggleDialog: (state, action: PayloadAction<FeedDialog>) => {
      const open = !(state.dialogs?.[action.payload] ?? false);
      state.dialogs = { ...closedFeedDialogs, ...state.dialogs, [action.payload]: open };
    },
    closeAllDialogs: (state) => {
      state.dialogs = { ...closedFeedDialogs };
    },
    setFeedScrollAnchor: (state, action: PayloadAction<FeedScrollAnchor | null>) => {
      state.feedScrollAnchor = action.payload;
    },
    resetTask: (state) => {
      state.task = initialAppState.task;
      state.discrubPaused = false;
      state.discrubCancelled = false;
      state.rateLimitStopped = false;
      state.requestsRefusedStopped = false;
      state.restBreakUntil = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSettings.fulfilled, (state, action) => {
        // Merge to handle the race between this async load and any
        // updateSetting that lands first. action.payload carries the
        // full defaults+IDB-loaded values; existing state.settings
        // entries (user updates) win on collision. Without the merge,
        // a guard like `if (state.settings === null)` would either
        // clobber user updates (no guard) OR leave state stuck on a
        // partial settings object the caller pre-populated (guard).
        state.settings = {
          ...action.payload,
          ...(state.settings ?? {}),
        } as typeof state.settings;
      })
      // Optimistic update — apply the new value to in-memory state before
      // the IDB write resolves so subsequent renders / rapid sequential
      // dispatches see the latest value. The IDB write is fire-and-look-back
      // in this design; on persistence failure we keep the in-memory value
      // (it'll be re-tried on next save). Without this, two clicks fired
      // synchronously by the user would both read the same stale `themeMode`
      // closure value and produce the wrong end state.
      .addCase(updateSetting.pending, (state, action) => {
        if (state.settings === null) return;
        const { key, value } = action.meta.arg;
        state.settings = { ...state.settings, [key]: value } as typeof state.settings;
      })
      .addCase(updateSetting.fulfilled, (state, action) => {
        state.settings = action.payload;
      })
      .addCase(updateAllSettings.pending, (state, action) => {
        state.settings = action.meta.arg;
      })
      .addCase(updateAllSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
      });
  },
});

export const {
  setDiscrubPaused,
  setDiscrubCancelled,
  setRateLimitStopped,
  setRequestsRefusedStopped,
  setRestBreakUntil,
  setSuggestedLanguage,
  setMinimized,
  setFocusedView,
  toggleFocusedView,
  setKofiOverlayOpen,
  setSidebarView,
  setTask,
  setSettings,
  setPreviewThemeId,
  setDialogOpen,
  toggleDialog,
  closeAllDialogs,
  setFeedScrollAnchor,
  resetTask,
} = appSlice.actions;

// Selectors
export const selectApp = (state: RootState) => state.app;
export const selectDiscrubPaused = (state: RootState) => state.app.discrubPaused;
export const selectDiscrubCancelled = (state: RootState) => state.app.discrubCancelled;
export const selectRateLimitStopped = (state: RootState) => state.app.rateLimitStopped === true;
export const selectRequestsRefusedStopped = (state: RootState) => state.app.requestsRefusedStopped === true;
export const selectRestBreakUntil = (state: RootState) => state.app.restBreakUntil ?? null;
export const selectRestBreaksEnabled = (state: RootState) =>
  (state.app.settings?.[DiscrubSetting.REST_BREAKS] ?? defaultSettings[DiscrubSetting.REST_BREAKS]) !== 'false';
export const selectSuggestedLanguage = (state: RootState) => state.app.suggestedLanguage;
export const selectTask = (state: RootState) => state.app.task;
export const selectSettings = (state: RootState) => state.app.settings;
export const selectPreviewThemeId = (state: RootState) => state.app.previewThemeId;
export const selectIsMinimized = (state: RootState) => state.app.isMinimized;
export const selectFocusedView = (state: RootState) => state.app.focusedView;
export const selectKofiOverlayOpen = (state: RootState) => state.app.kofiOverlayOpen;
export const selectSidebarView = (state: RootState) => state.app.sidebarView;
export const selectFeedScrollAnchor = (state: RootState) => state.app.feedScrollAnchor ?? null;
export const selectDialogs = (state: RootState) => state.app.dialogs ?? closedFeedDialogs;
export const selectDialogOpen = (dialog: FeedDialog) => (state: RootState) => selectDialogs(state)[dialog];

// Settings helper selectors
export const selectSetting = (key: DiscrubSetting) => (state: RootState) =>
  state.app.settings?.[key] ?? defaultSettings[key];

// The delay sliders store one decimal ("0.5", "2.9"). These MUST parse as
// floats: parseInt silently truncated "0.5" to 0 and "2.9" to 2, so every
// operation loop slept less than the Settings tab showed (2.1.3 pacing audit).
export const selectSearchDelay = (state: RootState) =>
  parseFloat(state.app.settings?.[DiscrubSetting.SEARCH_DELAY] ?? defaultSettings[DiscrubSetting.SEARCH_DELAY]);

export const selectDeleteDelay = (state: RootState) =>
  parseFloat(state.app.settings?.[DiscrubSetting.DELETE_DELAY] ?? defaultSettings[DiscrubSetting.DELETE_DELAY]);

/** Retry wait bounds in seconds (#265): the first wait after a failed request. */
export const RETRY_WAIT_MIN_SECONDS = 1;
export const RETRY_WAIT_MAX_SECONDS = 30;

/**
 * #265: seconds to wait before the first retry of a failed request. Each
 * retry doubles it. Out-of-range or unparsable values fall back to the
 * default so a bad stored value cannot make retries instant or endless.
 */
export const selectRetryWaitSeconds = (state: RootState) => {
  const raw = parseFloat(state.app.settings?.[DiscrubSetting.RETRY_WAIT] ?? defaultSettings[DiscrubSetting.RETRY_WAIT]);
  if (!Number.isFinite(raw)) return parseFloat(defaultSettings[DiscrubSetting.RETRY_WAIT]);
  return Math.min(RETRY_WAIT_MAX_SECONDS, Math.max(RETRY_WAIT_MIN_SECONDS, raw));
};

export const selectDelayModifier = (state: RootState) =>
  parseFloat(state.app.settings?.[DiscrubSetting.DELAY_MODIFIER] ?? defaultSettings[DiscrubSetting.DELAY_MODIFIER]);

/**
 * Middleware to reinitialize DiscordService when settings change
 * This ensures the service uses the latest delay settings
 */
export const settingsChangeMiddleware = (storeAPI: any) => (next: any) => (action: any) => {
  const result = next(action);

  // Reinitialize DiscordService when settings are loaded or updated
  if (
    action.type === updateSetting.fulfilled.type ||
    action.type === updateAllSettings.fulfilled.type ||
    action.type === loadSettings.fulfilled.type
  ) {
    const newSettings = storeAPI.getState().app.settings;
    if (newSettings) {
      // Dynamically import to avoid circular dependency
      import('@services/discordService').then(({ getDiscordService }) => {
        getDiscordService(newSettings);
      });
    }
  }

  return result;
};

export default appSlice.reducer;
