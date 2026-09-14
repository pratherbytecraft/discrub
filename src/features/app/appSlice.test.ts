import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';
import appReducer, {
  setDialogOpen,
  toggleDialog,
  closeAllDialogs,
  setFeedScrollAnchor,
  selectFeedScrollAnchor,
  setOperationHold,
  selectOperationHold,
  selectAppLayout,
  selectDialogOpen,
  selectDialogs,
  setSuggestedLanguage,
  setRateLimitStopped,
  setRequestsRefusedStopped,
  setRestBreakUntil,
  selectRequestsRefusedStopped,
  selectRestBreakUntil,
  selectRestBreaksEnabled,
  selectRetryWaitSeconds,
  selectRateLimitStopped,
  setDiscrubPaused,
  setDiscrubCancelled,
  setMinimized,
  setFocusedView,
  toggleFocusedView,
  setTask,
  setSettings,
  setPreviewThemeId,
  resetTask,
  loadSettings,
  updateSetting,
  updateAllSettings,
  defaultSettings,
  selectApp,
  selectDiscrubPaused,
  selectDiscrubCancelled,
  selectIsMinimized,
  selectTask,
  selectSettings,
  selectSetting,
  selectSearchDelay,
  selectDeleteDelay,
  selectDelayModifier,
  settingsChangeMiddleware,
} from './appSlice';
import { initialAppState } from './appTypes';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import type { AppSettings } from 'discrub-core/types/discrub-types';

// Mock the unified storage abstraction (IndexedDB-backed in production,
// in-memory here so each test starts with a clean slate without the
// async overhead of fake-indexeddb). `vi.hoisted` is required because
// `vi.mock` factories run before module-level statements.
const { settingsStore, stateStore, migrate } = vi.hoisted(() => {
  function makeAdapter() {
    let store: Record<string, unknown> = {};
    return {
      get: vi.fn(async (key: string) => store[key] ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
      clear: vi.fn(async () => {
        store = {};
      }),
      keys: vi.fn(async () => Object.keys(store)),
      getMany: vi.fn(async (keys: string[]) =>
        keys.map((k) => store[k] ?? null),
      ),
      setMany: vi.fn(async (entries: Array<[string, unknown]>) => {
        for (const [k, v] of entries) store[k] = v;
      }),
      entries: vi.fn(async () => Object.entries(store)),
    };
  }
  return {
    settingsStore: makeAdapter(),
    stateStore: makeAdapter(),
    migrate: vi.fn(async () => {}),
  };
});

vi.mock('@/extension/storage', () => ({
  storage: {
    settings: settingsStore,
    state: stateStore,
    presets: settingsStore,
    cache: settingsStore,
    history: settingsStore,
    statuslog: settingsStore,
    package: settingsStore,
    media: settingsStore,
  },
  migrateAllStorage: migrate,
}));

// Alias retained for tests that historically asserted on localStorageMock —
// they now assert on the same in-memory mock through the new namespaced API.
const localStorageMock = settingsStore;

// Mock discordService
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));

describe('appSlice', () => {
  let store: TestStore;

  beforeEach(() => {
    store = createTestStore({ app: appReducer }, undefined, [settingsChangeMiddleware]);
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = store.getState();
      expect(state.app).toEqual(initialAppState);
      expect(state.app.discrubPaused).toBe(false);
      expect(state.app.discrubCancelled).toBe(false);
      expect(state.app.isMinimized).toBe(false);
      expect(state.app.task.status).toBe('idle');
      expect(state.app.task.message).toBe('');
      expect(state.app.settings).toBeNull();
    });
  });

  describe('feed dialogs', () => {
    it('start closed', () => {
      expect(selectDialogs(store.getState())).toEqual({
        filters: false, export: false, forumExport: false, loadAll: false, threadLoad: false, analytics: false, settings: false, purge: false, bulkExport: false,
      });
    });

    it('setDialogOpen opens and closes one dialog and leaves the rest alone', () => {
      store.dispatch(setDialogOpen({ dialog: 'export', open: true }));
      expect(selectDialogOpen('export')(store.getState())).toBe(true);
      expect(selectDialogOpen('filters')(store.getState())).toBe(false);
      store.dispatch(setDialogOpen({ dialog: 'export', open: false }));
      expect(selectDialogOpen('export')(store.getState())).toBe(false);
    });

    it('toggleDialog flips one dialog', () => {
      store.dispatch(toggleDialog('loadAll'));
      expect(selectDialogOpen('loadAll')(store.getState())).toBe(true);
      store.dispatch(toggleDialog('loadAll'));
      expect(selectDialogOpen('loadAll')(store.getState())).toBe(false);
    });

    it('closeAllDialogs closes every open dialog', () => {
      store.dispatch(setDialogOpen({ dialog: 'analytics', open: true }));
      store.dispatch(setDialogOpen({ dialog: 'threadLoad', open: true }));
      store.dispatch(closeAllDialogs());
      expect(Object.values(selectDialogs(store.getState())).some(Boolean)).toBe(false);
    });

    it('dialog state is not a persisted setting', () => {
      store.dispatch(setDialogOpen({ dialog: 'filters', open: true }));
      expect(store.getState().app.settings).toBeNull();
    });
  });

  describe('feed scroll anchor', () => {
    it('starts empty, holds the last unmount position, and clears', () => {
      expect(selectFeedScrollAnchor(store.getState())).toBeNull();
      store.dispatch(setFeedScrollAnchor({ key: 'ch1:main', messageId: 'm42' }));
      expect(selectFeedScrollAnchor(store.getState())).toEqual({ key: 'ch1:main', messageId: 'm42' });
      store.dispatch(setFeedScrollAnchor(null));
      expect(selectFeedScrollAnchor(store.getState())).toBeNull();
      expect(store.getState().app.settings).toBeNull();
    });
  });

  describe('selectAppLayout', () => {
    it('is Classic before settings load and when the value is unknown', () => {
      expect(selectAppLayout(store.getState())).toBe('classic');
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.APP_LAYOUT]: 'holodeck' }));
      expect(selectAppLayout(store.getState())).toBe('classic');
    });

    it('returns a known layout key', () => {
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.APP_LAYOUT]: 'native' }));
      expect(selectAppLayout(store.getState())).toBe('native');
    });

    // A13: a supporter layout without a live key renders as Native; the saved value is untouched.
    it('falls back to Native for a supporter layout without a key, and keeps the saved value', () => {
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.APP_LAYOUT]: 'workbench' }));
      expect(selectAppLayout(store.getState())).toBe('native');
      expect(store.getState().app.settings?.[DiscrubSetting.APP_LAYOUT]).toBe('workbench');
    });
  });

  describe('operation hold', () => {
    it('starts empty and records a retry wait', () => {
      expect(selectOperationHold(store.getState())).toBeNull();
      store.dispatch(setOperationHold({ kind: 'retryWait', until: 123, attempt: 2, max: 5, answer: 'HTTP 502' }));
      expect(selectOperationHold(store.getState())).toMatchObject({ kind: 'retryWait', attempt: 2 });
      store.dispatch(setOperationHold(null));
      expect(selectOperationHold(store.getState())).toBeNull();
    });

    it('resume clears a paused-after-retries hold but not a retry wait', () => {
      store.dispatch(setDiscrubPaused(true));
      store.dispatch(setOperationHold({ kind: 'retryExhausted', answer: 'HTTP 502', loaded: 1250 }));
      store.dispatch(setDiscrubPaused(false));
      expect(selectOperationHold(store.getState())).toBeNull();
      store.dispatch(setOperationHold({ kind: 'retryWait', until: 1, attempt: 1, max: 5, answer: 'HTTP 502' }));
      store.dispatch(setDiscrubPaused(false));
      expect(selectOperationHold(store.getState())).toMatchObject({ kind: 'retryWait' });
    });

    it('resetTask clears the hold', () => {
      store.dispatch(setOperationHold({ kind: 'retryExhausted', answer: 'HTTP 502', loaded: 10 }));
      store.dispatch(resetTask());
      expect(selectOperationHold(store.getState())).toBeNull();
    });
  });

  describe('reducers', () => {
    describe('setDiscrubPaused', () => {
      it('should set discrubPaused to true', () => {
        store.dispatch(setDiscrubPaused(true));

        const state = store.getState().app;
        expect(state.discrubPaused).toBe(true);
      });

      it('should set discrubPaused to false', () => {
        // First set to true
        store.dispatch(setDiscrubPaused(true));
        expect(store.getState().app.discrubPaused).toBe(true);

        // Then set to false
        store.dispatch(setDiscrubPaused(false));
        expect(store.getState().app.discrubPaused).toBe(false);
      });

      it('should toggle discrubPaused multiple times', () => {
        store.dispatch(setDiscrubPaused(true));
        expect(store.getState().app.discrubPaused).toBe(true);

        store.dispatch(setDiscrubPaused(false));
        expect(store.getState().app.discrubPaused).toBe(false);

        store.dispatch(setDiscrubPaused(true));
        expect(store.getState().app.discrubPaused).toBe(true);
      });
    });

    describe('setDiscrubCancelled', () => {
      it('should set discrubCancelled to true', () => {
        store.dispatch(setDiscrubCancelled(true));

        const state = store.getState().app;
        expect(state.discrubCancelled).toBe(true);
      });

      it('should set discrubCancelled to false', () => {
        store.dispatch(setDiscrubCancelled(true));
        expect(store.getState().app.discrubCancelled).toBe(true);

        store.dispatch(setDiscrubCancelled(false));
        expect(store.getState().app.discrubCancelled).toBe(false);
      });

      it('should not affect discrubPaused', () => {
        store.dispatch(setDiscrubPaused(true));
        store.dispatch(setDiscrubCancelled(true));

        const state = store.getState().app;
        expect(state.discrubPaused).toBe(true);
        expect(state.discrubCancelled).toBe(true);
      });
    });

    describe('setMinimized', () => {
      it('should set isMinimized to true', () => {
        store.dispatch(setMinimized(true));
        expect(store.getState().app.isMinimized).toBe(true);
      });

      it('should set isMinimized to false', () => {
        store.dispatch(setMinimized(true));
        expect(store.getState().app.isMinimized).toBe(true);

        store.dispatch(setMinimized(false));
        expect(store.getState().app.isMinimized).toBe(false);
      });

      it('should not affect other state', () => {
        store.dispatch(setDiscrubPaused(true));
        store.dispatch(setMinimized(true));

        const state = store.getState().app;
        expect(state.isMinimized).toBe(true);
        expect(state.discrubPaused).toBe(true);
      });
    });

    describe('setPreviewThemeId', () => {
      it('defaults to null and never touches settings', () => {
        expect(store.getState().app.previewThemeId).toBeNull();

        store.dispatch(setPreviewThemeId('discord-light'));
        expect(store.getState().app.previewThemeId).toBe('discord-light');
        expect(store.getState().app.settings).toEqual(initialAppState.settings);
      });

      it('clears back to null', () => {
        store.dispatch(setPreviewThemeId('discord-light'));
        store.dispatch(setPreviewThemeId(null));
        expect(store.getState().app.previewThemeId).toBeNull();
      });
    });

    describe('focusedView', () => {
      it('initial state is false', () => {
        expect(store.getState().app.focusedView).toBe(false);
      });

      it('setFocusedView assigns the provided boolean', () => {
        store.dispatch(setFocusedView(true));
        expect(store.getState().app.focusedView).toBe(true);
        store.dispatch(setFocusedView(false));
        expect(store.getState().app.focusedView).toBe(false);
      });

      it('toggleFocusedView flips the current value', () => {
        expect(store.getState().app.focusedView).toBe(false);
        store.dispatch(toggleFocusedView());
        expect(store.getState().app.focusedView).toBe(true);
        store.dispatch(toggleFocusedView());
        expect(store.getState().app.focusedView).toBe(false);
      });

      it('does not affect other app state', () => {
        store.dispatch(setDiscrubPaused(true));
        store.dispatch(toggleFocusedView());
        const state = store.getState().app;
        expect(state.focusedView).toBe(true);
        expect(state.discrubPaused).toBe(true);
      });
    });

    describe('setTask', () => {
      it('should set task with loading status', () => {
        const task = { status: 'loading' as const, message: 'Loading messages...' };
        store.dispatch(setTask(task));

        const state = store.getState().app;
        expect(state.task).toEqual(task);
      });

      it('should set task with succeeded status', () => {
        const task = { status: 'succeeded' as const, message: 'Operation complete' };
        store.dispatch(setTask(task));

        const state = store.getState().app;
        expect(state.task).toEqual(task);
      });

      it('should set task with failed status', () => {
        const task = { status: 'failed' as const, message: 'Operation failed' };
        store.dispatch(setTask(task));

        const state = store.getState().app;
        expect(state.task).toEqual(task);
      });

      it('should update task when called multiple times', () => {
        store.dispatch(setTask({ status: 'loading', message: 'Starting...' }));
        expect(store.getState().app.task.status).toBe('loading');

        store.dispatch(setTask({ status: 'succeeded', message: 'Done!' }));
        expect(store.getState().app.task.status).toBe('succeeded');
      });
    });

    describe('setSettings', () => {
      it('should set settings', () => {
        store.dispatch(setSettings(defaultSettings));

        const state = store.getState().app;
        expect(state.settings).toEqual(defaultSettings);
      });

      it('should update settings when called multiple times', () => {
        const settings1 = { ...defaultSettings, [DiscrubSetting.SEARCH_DELAY]: '2' };
        const settings2 = { ...defaultSettings, [DiscrubSetting.SEARCH_DELAY]: '3' };

        store.dispatch(setSettings(settings1));
        expect(store.getState().app.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('2');

        store.dispatch(setSettings(settings2));
        expect(store.getState().app.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('3');
      });
    });

    describe('resetTask', () => {
      it('should reset task to initial state', () => {
        // Set some task state
        store.dispatch(setTask({ status: 'succeeded', message: 'Done!' }));
        store.dispatch(setDiscrubPaused(true));
        store.dispatch(setDiscrubCancelled(true));

        // Reset
        store.dispatch(resetTask());

        const state = store.getState().app;
        expect(state.task).toEqual(initialAppState.task);
        expect(state.discrubPaused).toBe(false);
        expect(state.discrubCancelled).toBe(false);
      });

      it('should not affect settings', () => {
        store.dispatch(setSettings(defaultSettings));
        store.dispatch(resetTask());

        const state = store.getState().app;
        expect(state.settings).toEqual(defaultSettings);
      });
    });
  });

  describe('loadSettings async thunk', () => {
    it('should load default settings when storage is empty', async () => {
      await store.dispatch(loadSettings());

      const state = store.getState().app;
      // Every default key should be present; the language resolves from
      // the browser on a fresh install (jsdom reports en-US).
      expect(state.settings).toEqual({ ...defaultSettings, [DiscrubSetting.APP_LANGUAGE]: 'en' });
    });

    describe('UI language resolution (#124)', () => {
      const setBrowserLanguages = (languages: string[]) => {
        Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });
        Object.defineProperty(navigator, 'language', { value: languages[0], configurable: true });
      };
      const originalLanguages = navigator.languages;
      const originalLanguage = navigator.language;
      afterEach(() => {
        Object.defineProperty(navigator, 'languages', { value: originalLanguages, configurable: true });
        Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
      });

      it('follows the browser on a fresh install and persists the choice', async () => {
        setBrowserLanguages(['de-DE', 'en-US']);

        await store.dispatch(loadSettings());

        const state = store.getState().app;
        expect(state.settings?.[DiscrubSetting.APP_LANGUAGE]).toBe('de');
        expect(state.suggestedLanguage).toBeNull();
        expect(await localStorageMock.get(DiscrubSetting.APP_LANGUAGE)).toBe('de');
      });

      it('keeps an existing install on English and suggests the browser language once', async () => {
        setBrowserLanguages(['de-DE']);
        await localStorageMock.set(DiscrubSetting.SEARCH_DELAY, '5');

        await store.dispatch(loadSettings());

        const state = store.getState().app;
        expect(state.settings?.[DiscrubSetting.APP_LANGUAGE]).toBe('en');
        expect(state.suggestedLanguage).toBe('de');
        // Pinned, so the next boot resolves nothing and never re-suggests.
        expect(await localStorageMock.get(DiscrubSetting.APP_LANGUAGE)).toBe('en');
      });

      it('does not suggest anything to an existing install whose browser is English', async () => {
        setBrowserLanguages(['en-GB']);
        await localStorageMock.set(DiscrubSetting.SEARCH_DELAY, '5');

        await store.dispatch(loadSettings());

        expect(store.getState().app.settings?.[DiscrubSetting.APP_LANGUAGE]).toBe('en');
        expect(store.getState().app.suggestedLanguage).toBeNull();
      });

      it('respects a saved language regardless of the browser', async () => {
        setBrowserLanguages(['en-US']);
        await localStorageMock.set(DiscrubSetting.APP_LANGUAGE, 'de');

        await store.dispatch(loadSettings());

        expect(store.getState().app.settings?.[DiscrubSetting.APP_LANGUAGE]).toBe('de');
        expect(store.getState().app.suggestedLanguage).toBeNull();
      });

      it('setSuggestedLanguage clears once consumed', () => {
        store.dispatch(setSuggestedLanguage('de'));
        expect(store.getState().app.suggestedLanguage).toBe('de');
        store.dispatch(setSuggestedLanguage(null));
        expect(store.getState().app.suggestedLanguage).toBeNull();
      });
    });

    it('should load a per-key setting from storage', async () => {
      // Seed one setting via the mock; loadSettings merges with defaults.
      await localStorageMock.set(DiscrubSetting.SEARCH_DELAY, '5');

      await store.dispatch(loadSettings());

      const state = store.getState().app;
      expect(state.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('5');
    });

    it('should merge stored settings with defaults (missing keys filled)', async () => {
      await localStorageMock.set(DiscrubSetting.SEARCH_DELAY, '3');

      await store.dispatch(loadSettings());

      const state = store.getState().app;
      expect(state.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('3');
      // Untouched key falls back to default.
      expect(state.settings?.[DiscrubSetting.DELETE_DELAY]).toBe(
        defaultSettings[DiscrubSetting.DELETE_DELAY],
      );
    });

    it('routes state-marker reads to the state store', async () => {
      // Setup: tour flag was previously dismissed (lives in state DB).
      await stateStore.set(DiscrubSetting.APP_TOUR_SHELL_COMPLETED, 'true');

      await store.dispatch(loadSettings());

      const state = store.getState().app;
      expect(
        state.settings?.[DiscrubSetting.APP_TOUR_SHELL_COMPLETED],
      ).toBe('true');
    });

    /**
     * Race-fix carry-over from #110: a user-initiated updateSetting
     * during boot must not be clobbered by the (slower, async) load.
     */
    it('does not overwrite a concurrent updateSetting (race-fix)', async () => {
      const userMutated = {
        ...defaultSettings,
        [DiscrubSetting.APP_THEME_MODE]: 'dark',
      };
      store = createTestStore(
        { app: appReducer },
        { app: { ...initialAppState, settings: userMutated } },
      );

      // Stale stored value the boot would otherwise apply.
      await localStorageMock.set(DiscrubSetting.APP_THEME_MODE, 'auto');

      await store.dispatch(loadSettings());

      expect(
        store.getState().app.settings?.[DiscrubSetting.APP_THEME_MODE],
      ).toBe('dark');
    });
  });

  describe('updateSetting async thunk', () => {
    it('should update a single setting', async () => {
      store = createTestStore(
        { app: appReducer },
        { app: { ...initialAppState, settings: defaultSettings } },
      );

      await store.dispatch(
        updateSetting({ key: DiscrubSetting.SEARCH_DELAY, value: '5' }),
      );

      const state = store.getState().app;
      expect(state.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('5');
      // Persisted via per-key set.
      expect(localStorageMock.set).toHaveBeenCalledWith(
        DiscrubSetting.SEARCH_DELAY,
        '5',
      );
    });

    it('routes state-marker writes to the state store, not settings', async () => {
      store = createTestStore(
        { app: appReducer },
        { app: { ...initialAppState, settings: defaultSettings } },
      );

      await store.dispatch(
        updateSetting({
          key: DiscrubSetting.APP_TOUR_SHELL_COMPLETED,
          value: 'true',
        }),
      );

      // State-marker writes hit stateStore, not settingsStore.
      expect(stateStore.set).toHaveBeenCalledWith(
        DiscrubSetting.APP_TOUR_SHELL_COMPLETED,
        'true',
      );
    });

    it('should preserve other settings when updating one', async () => {
      const customSettings = {
        ...defaultSettings,
        [DiscrubSetting.SEARCH_DELAY]: '5',
      };

      store = createTestStore(
        { app: appReducer },
        { app: { ...initialAppState, settings: customSettings } },
      );

      await store.dispatch(
        updateSetting({ key: DiscrubSetting.DELETE_DELAY, value: '2' }),
      );

      const state = store.getState().app;
      expect(state.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('5');
      expect(state.settings?.[DiscrubSetting.DELETE_DELAY]).toBe('2');
    });

    it('should handle storage error', async () => {
      store = createTestStore(
        { app: appReducer },
        { app: { ...initialAppState, settings: defaultSettings } },
      );

      localStorageMock.set.mockImplementationOnce(async () => {
        throw new Error('Storage full');
      });

      const result = await store.dispatch(
        updateSetting({ key: DiscrubSetting.SEARCH_DELAY, value: '5' }),
      );

      expect(result.type).toBe('app/updateSetting/rejected');
    });
  });

  describe('updateAllSettings async thunk', () => {
    it('should update all settings', async () => {
      const newSettings: AppSettings = {
        ...defaultSettings,
        [DiscrubSetting.SEARCH_DELAY]: '5',
        [DiscrubSetting.DELETE_DELAY]: '3',
      };

      await store.dispatch(updateAllSettings(newSettings));

      const state = store.getState().app;
      expect(state.settings).toEqual(newSettings);
    });

    it('persists every setting via bulk setMany', async () => {
      const newSettings: AppSettings = {
        ...defaultSettings,
        [DiscrubSetting.SEARCH_DELAY]: '0',
      };

      await store.dispatch(updateAllSettings(newSettings));

      // Settings DB receives a setMany call; state DB receives one too
      // (even if the entries array is empty when no state markers
      // changed — the slice always issues both writes for symmetry).
      expect(localStorageMock.setMany).toHaveBeenCalled();
      // The bulk write contains the new search delay value.
      const settingsCall = localStorageMock.setMany.mock.calls.find(
        (call) =>
          Array.isArray(call[0]) &&
          call[0].some(
            ([k, v]) =>
              k === DiscrubSetting.SEARCH_DELAY && v === '0',
          ),
      );
      expect(settingsCall).toBeDefined();
    });

    it('should handle storage error', async () => {
      localStorageMock.setMany.mockImplementationOnce(async () => {
        throw new Error('Storage full');
      });

      const result = await store.dispatch(updateAllSettings(defaultSettings));

      expect(result.type).toBe('app/updateAllSettings/rejected');
    });

    it('should replace settings completely', async () => {
      // Set initial settings
      store = createTestStore({ app: appReducer }, {
        app: {
          ...initialAppState,
          settings: {
            ...defaultSettings,
            [DiscrubSetting.SEARCH_DELAY]: '5',
          },
        },
      });

      const newSettings: AppSettings = {
        ...defaultSettings,
        [DiscrubSetting.DELETE_DELAY]: '1',
      };

      await store.dispatch(updateAllSettings(newSettings));

      const state = store.getState().app;
      expect(state.settings).toEqual(newSettings);
      expect(state.settings?.[DiscrubSetting.SEARCH_DELAY]).toBe(defaultSettings[DiscrubSetting.SEARCH_DELAY]);
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      // Set up known state
      store = createTestStore({ app: appReducer }, {
        app: {
          discrubPaused: true,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          task: { status: 'loading' as const, message: 'Processing...' },
          settings: {
            ...defaultSettings,
            [DiscrubSetting.SEARCH_DELAY]: '5',
            [DiscrubSetting.DELETE_DELAY]: '3',
            [DiscrubSetting.DELAY_MODIFIER]: '0.5',
          },
        },
      });
    });

    it('selectApp should return entire app state', () => {
      const app = selectApp(store.getState());
      expect(app).toHaveProperty('discrubPaused');
      expect(app).toHaveProperty('discrubCancelled');
      expect(app).toHaveProperty('task');
      expect(app).toHaveProperty('settings');
    });

    it('selectDiscrubPaused should return paused status', () => {
      expect(selectDiscrubPaused(store.getState())).toBe(true);
    });

    it('selectDiscrubCancelled should return cancelled status', () => {
      expect(selectDiscrubCancelled(store.getState())).toBe(false);
    });

    it('selectIsMinimized should return minimized status', () => {
      expect(selectIsMinimized(store.getState())).toBe(false);
      store.dispatch(setMinimized(true));
      expect(selectIsMinimized(store.getState())).toBe(true);
    });

    it('selectTask should return task', () => {
      const task = selectTask(store.getState());
      expect(task.status).toBe('loading');
      expect(task.message).toBe('Processing...');
    });

    it('selectSettings should return settings', () => {
      const settings = selectSettings(store.getState());
      expect(settings).not.toBeNull();
      expect(settings?.[DiscrubSetting.SEARCH_DELAY]).toBe('5');
    });

    describe('helper selectors', () => {
      it('selectSetting should return specific setting', () => {
        const searchDelay = selectSetting(DiscrubSetting.SEARCH_DELAY)(store.getState());
        expect(searchDelay).toBe('5');
      });

      it('selectSetting should return default when setting is null', () => {
        store = createTestStore({ app: appReducer }, { app: { ...initialAppState, settings: null } });

        const searchDelay = selectSetting(DiscrubSetting.SEARCH_DELAY)(store.getState());
        expect(searchDelay).toBe(defaultSettings[DiscrubSetting.SEARCH_DELAY]);
      });

      it('selectSearchDelay should return parsed number', () => {
        const delay = selectSearchDelay(store.getState());
        expect(delay).toBe(5);
        expect(typeof delay).toBe('number');
      });

      it('selectDeleteDelay should return parsed number', () => {
        const delay = selectDeleteDelay(store.getState());
        expect(delay).toBe(3);
        expect(typeof delay).toBe('number');
      });

      it('selectDelayModifier should return parsed float', () => {
        const modifier = selectDelayModifier(store.getState());
        // The actual value from the state (DelayModifier enum value gets parsed)
        expect(modifier).toBe(0.5);
        expect(typeof modifier).toBe('number');
      });

      it('selectSearchDelay should return default when settings is null', () => {
        store = createTestStore({ app: appReducer }, { app: { ...initialAppState, settings: null } });

        const delay = selectSearchDelay(store.getState());
        expect(delay).toBe(parseFloat(defaultSettings[DiscrubSetting.SEARCH_DELAY]));
      });

      // 2.1.3 pacing audit: the sliders store one decimal and the loops
      // must sleep exactly that. parseInt used to turn "0.5" into 0 (no
      // delay at all) and "2.9" into 2.
      describe('fractional delays (2.1.3 pacing audit)', () => {
        const withDelays = (search: string, del: string) =>
          createTestStore({ app: appReducer }, {
            app: {
              ...initialAppState,
              settings: {
                ...defaultSettings,
                [DiscrubSetting.SEARCH_DELAY]: search,
                [DiscrubSetting.DELETE_DELAY]: del,
              },
            },
          });

        it.each([
          ['0.5', 0.5],
          ['0.1', 0.1],
          ['1.5', 1.5],
          ['2.9', 2.9],
          ['12.5', 12.5],
          ['30', 30],
        ])('selectSearchDelay keeps %s as %s', (stored, expected) => {
          expect(selectSearchDelay(withDelays(stored, '2').getState())).toBe(expected);
        });

        it.each([
          ['0.5', 0.5],
          ['0.1', 0.1],
          ['2.9', 2.9],
          ['25.5', 25.5],
        ])('selectDeleteDelay keeps %s as %s', (stored, expected) => {
          expect(selectDeleteDelay(withDelays('1', stored).getState())).toBe(expected);
        });

        it('a sub-second search delay still produces a real sleep', async () => {
          const { calculateRandomDelay } = await vi.importActual<typeof import('@/utils/delayUtils')>('@/utils/delayUtils');
          const s = withDelays('0.5', '0.5').getState();
          for (let i = 0; i < 25; i++) {
            const { delayMs } = calculateRandomDelay(selectSearchDelay(s), selectDelayModifier(s));
            expect(delayMs).toBeGreaterThanOrEqual(500);
            expect(delayMs).toBeLessThanOrEqual(1000);
          }
        });

        it('a zero delay is honored as zero', () => {
          const s = withDelays('0', '0').getState();
          expect(selectSearchDelay(s)).toBe(0);
          expect(selectDeleteDelay(s)).toBe(0);
        });
      });
    });
  });

  describe('settingsChangeMiddleware', () => {
    it('should trigger on loadSettings fulfilled', async () => {
      const { getDiscordService } = await import('@services/discordService');

      await store.dispatch(loadSettings());

      // Wait for dynamic import
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(getDiscordService).toHaveBeenCalled();
    });

    it('should trigger on updateSetting fulfilled', async () => {
      const { getDiscordService } = await import('@services/discordService');
      vi.clearAllMocks();

      store = createTestStore({ app: appReducer }, { app: { ...initialAppState, settings: defaultSettings } }, [settingsChangeMiddleware]);

      await store.dispatch(
        updateSetting({
          key: DiscrubSetting.SEARCH_DELAY,
          value: '5',
        })
      );

      // Wait for dynamic import
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(getDiscordService).toHaveBeenCalled();
    });

    it('should trigger on updateAllSettings fulfilled', async () => {
      const { getDiscordService } = await import('@services/discordService');
      vi.clearAllMocks();

      await store.dispatch(updateAllSettings(defaultSettings));

      // Wait for dynamic import
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(getDiscordService).toHaveBeenCalled();
    });

    it('should not trigger on other actions', async () => {
      const { getDiscordService } = await import('@services/discordService');
      vi.clearAllMocks();

      store.dispatch(setDiscrubPaused(true));
      store.dispatch(setTask({ status: 'loading', message: 'Test' }));

      // Wait a bit to ensure no async calls happen
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(getDiscordService).not.toHaveBeenCalled();
    });
  });

  describe('requestsRefusedStopped and restBreakUntil', () => {
    it('sets and clears both, and resetTask clears them too', () => {
      const store = createTestStore({ app: appReducer });
      store.dispatch(setRequestsRefusedStopped(true));
      store.dispatch(setRestBreakUntil(123456));
      expect(selectRequestsRefusedStopped(store.getState())).toBe(true);
      expect(selectRestBreakUntil(store.getState())).toBe(123456);
      store.dispatch(resetTask());
      expect(selectRequestsRefusedStopped(store.getState())).toBe(false);
      expect(selectRestBreakUntil(store.getState())).toBeNull();
    });

    it('rest breaks default on and read the setting', () => {
      const store = createTestStore({ app: appReducer });
      expect(selectRestBreaksEnabled(store.getState())).toBe(true);
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.REST_BREAKS]: 'false' }));
      expect(selectRestBreaksEnabled(store.getState())).toBe(false);
    });
  });

  describe('retry wait (#265)', () => {
    it('defaults to 1 second and reads the setting', () => {
      const store = createTestStore({ app: appReducer });
      expect(selectRetryWaitSeconds(store.getState())).toBe(1);
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.RETRY_WAIT]: '7' }));
      expect(selectRetryWaitSeconds(store.getState())).toBe(7);
    });

    it('clamps out-of-range values and falls back on garbage', () => {
      const store = createTestStore({ app: appReducer });
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.RETRY_WAIT]: '0' }));
      expect(selectRetryWaitSeconds(store.getState())).toBe(1);
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.RETRY_WAIT]: '900' }));
      expect(selectRetryWaitSeconds(store.getState())).toBe(30);
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.RETRY_WAIT]: 'abc' }));
      expect(selectRetryWaitSeconds(store.getState())).toBe(1);
    });
  });

  describe('rateLimitStopped (#254)', () => {
    it('sets and clears the flag, and resetTask clears it too', () => {
      const store = createTestStore({ app: appReducer });
      store.dispatch(setRateLimitStopped(true));
      expect(selectRateLimitStopped(store.getState())).toBe(true);
      store.dispatch(setRateLimitStopped(false));
      expect(selectRateLimitStopped(store.getState())).toBe(false);
      store.dispatch(setRateLimitStopped(true));
      store.dispatch(resetTask());
      expect(selectRateLimitStopped(store.getState())).toBe(false);
    });
  });
});
