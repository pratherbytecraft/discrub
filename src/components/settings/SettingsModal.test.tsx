import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test/test-utils';
import SettingsModal from './SettingsModal';
import { createBaseState } from '../../test/state-factories';
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

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

describe('SettingsModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderSettings(settings: any = defaultSettings) {
    return renderWithProviders(<SettingsModal {...defaultProps} />, {
      preloadedState: createBaseState({
        app: {
          discrubPaused: false,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings,
          previewThemeId: null,
        },
      }),
    });
  }

  describe('Rendering', () => {
    it('should render dialog title', () => {
      renderSettings();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      renderWithProviders(<SettingsModal open={false} onClose={vi.fn()} />, {
        preloadedState: createBaseState(),
      });
      expect(screen.queryByText('Settings')).toBeNull();
    });
  });

  describe('Tabs', () => {
    it('should render all tab labels', () => {
      renderSettings();
      expect(screen.getByRole('tab', { name: 'Operation Delays' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Export Preferences' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'User Data' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Display' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Purge Behavior' })).toBeInTheDocument();
    });

    it('should default to first tab', () => {
      renderSettings();
      expect(screen.getByRole('tab', { name: 'Operation Delays', selected: true })).toBeInTheDocument();
    });

    it('should switch tabs on click', () => {
      renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Export Preferences' }));
      expect(screen.getByRole('tab', { name: 'Export Preferences', selected: true })).toBeInTheDocument();
    });

    it('should show tab content for Export Preferences', () => {
      renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Export Preferences' }));
      // ExportPreferencesTab should render its content
      expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    });

    it('should show tab content for Display', () => {
      renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
      expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('should render Save, Cancel, and Reset to defaults buttons', () => {
      renderSettings();
      expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    });

    it('Reset to defaults preserves the theme choices (they live in the hub now)', async () => {
      const { store } = renderSettings({
        ...defaultSettings,
        [DiscrubSetting.APP_THEME_MODE]: 'synthwave',
        [DiscrubSetting.APP_THEME_ANIMATIONS]: 'false',
        [DiscrubSetting.DATE_FORMAT]: 'DD/MM/YYYY',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

      await waitFor(() => {
        const settings = store.getState().app.settings;
        // Non-theme settings reset...
        expect(settings?.[DiscrubSetting.DATE_FORMAT]).toBe(
          defaultSettings[DiscrubSetting.DATE_FORMAT],
        );
        // ...but the hub-owned theme keys must not be clobbered.
        expect(settings?.[DiscrubSetting.APP_THEME_MODE]).toBe('synthwave');
        expect(settings?.[DiscrubSetting.APP_THEME_ANIMATIONS]).toBe('false');
      });
    });

    it('should call onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(<SettingsModal open={true} onClose={onClose} />, {
        preloadedState: createBaseState({
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle', message: '' },
            settings: defaultSettings as any,
            previewThemeId: null,
          },
        }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Save keeps the dialog open (#260)', () => {
    it('stays open after Save, shows the confirmation, and Cancel then closes without a prompt', async () => {
      const onClose = vi.fn();
      const { store } = renderWithProviders(<SettingsModal open onClose={onClose} />, {
        preloadedState: createBaseState({
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle', message: '' },
            settings: defaultSettings as any,
            previewThemeId: null,
          },
        }),
      });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Rest breaks' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

      await waitFor(() => {
        expect(store.getState().app.settings?.[DiscrubSetting.REST_BREAKS]).toBe('false');
        expect(screen.getByRole('status')).toHaveTextContent('Settings saved');
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });

    it('clears the confirmation on the next edit', async () => {
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Settings saved'));

      fireEvent.click(screen.getByRole('checkbox', { name: 'Rest breaks' }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('a saved hotkeys edit closes without the discard prompt too', async () => {
      const onClose = vi.fn();
      renderWithProviders(<SettingsModal open onClose={onClose} />, {
        preloadedState: createBaseState({
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle', message: '' },
            settings: defaultSettings as any,
            previewThemeId: null,
          },
        }),
      });
      fireEvent.click(screen.getByRole('tab', { name: 'Hotkeys' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Enable hotkeys' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Settings saved'));

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('After a save (#260 edges)', () => {
    const render = (onClose = vi.fn()) => renderWithProviders(<SettingsModal open onClose={onClose} />, {
      preloadedState: createBaseState({
        app: {
          discrubPaused: false,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings: defaultSettings as any,
          previewThemeId: null,
        },
      }),
    });
    const editAndSave = async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Rest breaks' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Settings saved'));
    };

    it('Esc closes without the discard prompt once the edit is saved', async () => {
      const onClose = vi.fn();
      render(onClose);
      await editAndSave();

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });

    it('Reset to defaults after a save clears the confirmation and makes the form dirty again', async () => {
      const onClose = vi.fn();
      render(onClose);
      await editAndSave();

      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('a background settings write after a save reseeds the untouched form', async () => {
      const { store } = render();
      await editAndSave();
      expect(screen.getByRole('checkbox', { name: 'Rest breaks' })).not.toBeChecked();

      const { setSettings } = await import('@features/app/appSlice');
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.REST_BREAKS]: 'true' }));

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: 'Rest breaks' })).toBeChecked();
      });
    });

    it('a failed save keeps the dialog open with the error and no confirmation', async () => {
      const onClose = vi.fn();
      const { store } = render(onClose);
      const storage = (await import('@/extension/storage')).storage as any;
      storage.settings.setMany.mockRejectedValueOnce(new Error('disk full'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Rest breaks' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Save Settings' })).toBeEnabled();
      void store;
    });
  });

  describe('Background settings writes while open (#256)', () => {
    it('keeps an in-progress edit when an unrelated setting changes underneath the form', async () => {
      const { store } = renderSettings();
      const toggle = screen.getByRole('checkbox', { name: 'Rest breaks' });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();

      // What the announcement fetch does right after login.
      const { setSettings } = await import('@features/app/appSlice');
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.CACHED_ANNOUNCEMENT_REV]: '99' }));

      expect(screen.getByRole('checkbox', { name: 'Rest breaks' })).not.toBeChecked();
    });

    it('still follows a settings change while the form is untouched', async () => {
      const { store } = renderSettings();
      expect(screen.getByRole('checkbox', { name: 'Rest breaks' })).toBeChecked();

      const { setSettings } = await import('@features/app/appSlice');
      store.dispatch(setSettings({ ...defaultSettings, [DiscrubSetting.REST_BREAKS]: 'false' }));

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: 'Rest breaks' })).not.toBeChecked();
      });
    });
  });

  describe('Settings Initialization', () => {
    it('should use defaultSettings when settings are null', () => {
      renderSettings(null);
      // Modal renders with default settings — no errors
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Saved token (#249)', () => {
    it('shows "Forget saved token" on the Reset tab only while a token is remembered', async () => {
      const { storage } = await import('@/extension/storage');
      const { store } = renderWithProviders(<SettingsModal open onClose={vi.fn()} />, {
        preloadedState: createBaseState({
          auth: { token: 't', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: true },
        }),
      });
      fireEvent.click(screen.getByRole('tab', { name: 'Reset Discrub' }));
      expect(screen.getByTestId('settings-saved-token')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('settings-forget-token'));
      await vi.waitFor(() => {
        expect(storage.state.remove).toHaveBeenCalledWith('auth:rememberedToken');
      });
      await vi.waitFor(() => {
        expect(store.getState().auth.tokenRemembered).toBe(false);
      });
      // Session stays signed in; the section disappears.
      expect(store.getState().auth.isAuthenticated).toBe(true);
      expect(screen.queryByTestId('settings-saved-token')).toBeNull();
    });

    it('hides the Saved token section when nothing is remembered', () => {
      renderWithProviders(<SettingsModal open onClose={vi.fn()} />, {
        preloadedState: createBaseState(),
      });
      fireEvent.click(screen.getByRole('tab', { name: 'Reset Discrub' }));
      expect(screen.queryByTestId('settings-saved-token')).toBeNull();
    });
  });
});
