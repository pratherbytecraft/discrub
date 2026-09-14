import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, screen } from '../../test/test-utils';
import MainLayout from './MainLayout';
import { createBaseState } from '../../test/state-factories';
import { initialAppState } from '@features/app/appTypes';
import { initialExportState } from '@features/export/exportTypes';


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

// Mock the child components to simplify integration test
vi.mock('./TopBar', () => ({
  default: () => <div data-testid="topbar">TopBar</div>,
}));

vi.mock('@components/navigation/Sidebar', () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock('@containers/ServerView/ServerView', () => ({
  default: () => <div data-testid="serverview">ServerView</div>,
}));

vi.mock('@components/donations/DonationDrawer', () => ({
  default: () => <div data-testid="donation-drawer">DonationDrawer</div>,
  DRAWER_WIDTH: 320,
}));

vi.mock('@components/ui/StatusPanel', () => ({
  default: () => <div data-testid="status-panel">StatusPanel</div>,
}));

vi.mock('@/hooks/useBeforeUnloadWarning', () => ({
  useBeforeUnloadWarning: vi.fn(),
}));

describe('MainLayout', () => {
  it('should render TopBar', () => {
    renderWithProviders(<MainLayout />, {
      preloadedState: createBaseState(),
    });
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });

  it('should render Sidebar', () => {
    renderWithProviders(<MainLayout />, {
      preloadedState: createBaseState(),
    });
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('should render ServerView', () => {
    renderWithProviders(<MainLayout />, {
      preloadedState: createBaseState(),
    });
    expect(screen.getByTestId('serverview')).toBeInTheDocument();
  });

  it('should render DonationDrawer', () => {
    renderWithProviders(<MainLayout />, {
      preloadedState: createBaseState(),
    });
    expect(screen.getByTestId('donation-drawer')).toBeInTheDocument();
  });

  it('should render all components together', () => {
    renderWithProviders(<MainLayout />, {
      preloadedState: createBaseState(),
    });
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('serverview')).toBeInTheDocument();
    expect(screen.getByTestId('donation-drawer')).toBeInTheDocument();
  });

  describe('language suggestion toast (#124)', () => {
    it('offers the switch once, in the suggested language, then clears the suggestion', () => {
      const base = createBaseState();
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: { ...base, app: { ...base.app, suggestedLanguage: 'de' } },
      });
      const toast = store.getState().status.toast;
      expect(toast.isVisible).toBe(true);
      expect(toast.level).toBe('info');
      expect(toast.message).toBe('Discrub ist auch auf Deutsch verfügbar.');
      expect(toast.action).toEqual({
        type: 'switchLanguage',
        language: 'de',
        label: 'Auf Deutsch wechseln',
      });
      expect(store.getState().app.suggestedLanguage).toBeNull();
    });

    it('shows nothing when there is no suggestion', () => {
      const { store } = renderWithProviders(<MainLayout />, { preloadedState: createBaseState() });
      expect(store.getState().status.toast.isVisible).toBe(false);
    });
  });

  describe('purge completion toast (#250)', () => {
    // Drive the real reducers: pending puts the run in flight, fulfilled
    // ends it — MainLayout watches the isPurging transition.
    it('warns instead of celebrating when channels errored', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState(),
      });
      act(() => {
        store.dispatch({ type: 'purge/bulkPurgeChannels/pending' });
      });
      act(() => {
        store.dispatch({
          type: 'purge/bulkPurgeChannels/fulfilled',
          payload: { success: true, errors: ['#general: NaN cannot be converted to a BigInt'] },
        });
      });
      const toast = store.getState().status.toast;
      expect(toast.isVisible).toBe(true);
      expect(toast.level).toBe('warning');
      expect(toast.message).toBe('Purge finished, but 1 channel had errors (see the status log)');
    });

    it('keeps the rate-limit stop reason as the final toast when a storm ended the run (#254)', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState(),
      });
      act(() => {
        store.dispatch({ type: 'purge/purgeGuilds/pending' });
      });
      act(() => {
        // What the storm hook does mid-run.
        store.dispatch({ type: 'app/setDiscrubCancelled', payload: true });
        store.dispatch({ type: 'app/setRateLimitStopped', payload: true });
      });
      act(() => {
        store.dispatch({ type: 'purge/purgeGuilds/fulfilled', payload: { success: true, errors: ['Beta › lobby: Search request failed (HTTP 429)'] } });
      });
      const toast = store.getState().status.toast;
      expect(toast.isVisible).toBe(true);
      expect(toast.level).toBe('error');
      expect(toast.message).toBe('Stopped: Discord is rate limiting this account. Wait 10 minutes before trying again.');
      expect(store.getState().app.rateLimitStopped).toBe(false);
      expect(store.getState().app.discrubCancelled).toBe(false);
    });

    it('keeps the refused-requests stop reason as the final toast (GH #14)', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState(),
      });
      act(() => {
        store.dispatch({ type: 'purge/purgeGuilds/pending' });
      });
      act(() => {
        store.dispatch({ type: 'app/setDiscrubCancelled', payload: true });
        store.dispatch({ type: 'app/setRequestsRefusedStopped', payload: true });
      });
      act(() => {
        store.dispatch({ type: 'purge/purgeGuilds/fulfilled', payload: { success: true, errors: [] } });
      });
      const toast = store.getState().status.toast;
      expect(toast.isVisible).toBe(true);
      expect(toast.level).toBe('error');
      expect(toast.message).toBe('Stopped: Discord is refusing requests from this account. Wait an hour before trying again.');
      expect(store.getState().app.requestsRefusedStopped).toBe(false);
      expect(store.getState().app.discrubCancelled).toBe(false);
    });

    it('still celebrates a clean run', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState(),
      });
      act(() => {
        store.dispatch({ type: 'purge/bulkPurgeChannels/pending' });
      });
      act(() => {
        store.dispatch({ type: 'purge/bulkPurgeChannels/fulfilled', payload: { success: true } });
      });
      const toast = store.getState().status.toast;
      expect(toast.isVisible).toBe(true);
      expect(toast.level).toBe('success');
      expect(toast.message).toBe('Purge complete');
    });
  });

  describe('focus mode', () => {
    const focusedState = () =>
      createBaseState({
        app: { ...initialAppState, focusedView: true },
      });

    it('hides TopBar, Sidebar, StatusPanel, and DonationDrawer while keeping ServerView', () => {
      renderWithProviders(<MainLayout />, {
        preloadedState: focusedState(),
      });
      expect(screen.queryByTestId('topbar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('status-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('donation-drawer')).not.toBeInTheDocument();
      expect(screen.getByTestId('serverview')).toBeInTheDocument();
    });

    it('F key toggles focus mode when not in an input', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState(),
      });
      fireEvent.keyDown(document, { key: 'f' });
      expect(store.getState().app.focusedView).toBe(true);
      fireEvent.keyDown(document, { key: 'f' });
      expect(store.getState().app.focusedView).toBe(false);
    });

    it('F key inside an input does not toggle focus mode', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        const { store } = renderWithProviders(<MainLayout />, {
          preloadedState: createBaseState(),
        });
        input.focus();
        fireEvent.keyDown(input, { key: 'f' });
        expect(store.getState().app.focusedView).toBe(false);
      } finally {
        input.remove();
      }
    });

    it('Escape exits focus mode', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: focusedState(),
      });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(store.getState().app.focusedView).toBe(false);
    });

    it('switching to the package sidebar view turns focus mode off', async () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: focusedState(),
      });
      expect(store.getState().app.focusedView).toBe(true);
      store.dispatch({ type: 'app/setSidebarView', payload: 'package' });
      await waitFor(() =>
        expect(store.getState().app.focusedView).toBe(false),
      );
    });
  });

  describe('floating pause control in focused view (#237)', () => {
    const focusedWithHeavyOp = (appOverrides?: Partial<typeof initialAppState>) =>
      createBaseState({
        app: { ...initialAppState, focusedView: true, ...appOverrides },
        export: { ...initialExportState, isExporting: true },
      });

    it('renders the floating pause control when focused and a heavy operation is running', () => {
      renderWithProviders(<MainLayout />, {
        preloadedState: focusedWithHeavyOp(),
      });
      expect(screen.getByTestId('floating-pause-control')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('clicking Pause dispatches pause and swaps the button to Resume', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: focusedWithHeavyOp(),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(store.getState().app.discrubPaused).toBe(true);
      expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    });

    it('shows Resume when paused and clicking it resumes the operation', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: focusedWithHeavyOp({ discrubPaused: true }),
      });
      const resumeButton = screen.getByRole('button', { name: 'Resume' });
      fireEvent.click(resumeButton);
      expect(store.getState().app.discrubPaused).toBe(false);
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });

    it('Space hotkey toggles pause while focused with a heavy operation running', () => {
      const { store } = renderWithProviders(<MainLayout />, {
        preloadedState: focusedWithHeavyOp(),
      });
      fireEvent.keyDown(document, { key: ' ' });
      expect(store.getState().app.discrubPaused).toBe(true);
      fireEvent.keyDown(document, { key: ' ' });
      expect(store.getState().app.discrubPaused).toBe(false);
    });

    it('renders nothing when focused with no heavy operation running', () => {
      renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState({
          app: { ...initialAppState, focusedView: true },
        }),
      });
      expect(screen.queryByTestId('floating-pause-control')).not.toBeInTheDocument();
    });

    it('does not render the floating control in normal view even with a heavy operation running', () => {
      renderWithProviders(<MainLayout />, {
        preloadedState: createBaseState({
          export: { ...initialExportState, isExporting: true },
        }),
      });
      expect(screen.queryByTestId('floating-pause-control')).not.toBeInTheDocument();
      // StatusPanel (mocked) remains the pause/resume mount in normal view.
      expect(screen.getByTestId('status-panel')).toBeInTheDocument();
    });
  });
});
