import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, act } from '../../test/test-utils';
import Toast from './Toast';
import { createBaseState } from '../../test/state-factories';
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { DRAWER_WIDTH } from '@components/donations/DonationDrawer';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const renderToast = (toastState = {}) =>
    renderWithProviders(<Toast />, {
      preloadedState: createBaseState({
        status: {
          entries: [],
          maxEntries: 2000,
          operationTip: { isVisible: false, message: '' },
          toast: {
            isVisible: true,
            level: 'success',
            message: 'Operation complete',
            duration: 3000,
            ...toastState,
          },
        },
      }),
    });

  it('should render when toast is visible', () => {
    renderToast();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Operation complete')).toBeInTheDocument();
  });

  it('sits left of the supporter wall while the wall is open as a column (row 109)', () => {
    const base = createBaseState();
    const render = (showFeed: 'true' | 'false') =>
      renderWithProviders(<Toast />, {
        preloadedState: {
          ...base,
          app: { ...base.app, settings: { ...defaultSettings, [DiscrubSetting.APP_SHOW_KOFI_FEED]: showFeed } },
          status: { ...base.status, toast: { isVisible: true, level: 'info', message: 'Hi', duration: 3000 } },
        } as never,
      });
    const { unmount } = render('true');
    expect(screen.getByRole('alert')).toHaveStyle({ right: `${24 + DRAWER_WIDTH}px` });
    unmount();
    render('false');
    expect(screen.getByRole('alert')).toHaveStyle({ right: '24px' });
  });

  it('should not render when toast is not visible', () => {
    renderToast({ isVisible: false });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should show success icon for success level', () => {
    renderToast({ level: 'success' });
    expect(screen.getByTestId('CheckCircleIcon')).toBeInTheDocument();
  });

  it('should show error icon for error level', () => {
    renderToast({ level: 'error', message: 'Something failed' });
    expect(screen.getByTestId('ErrorIcon')).toBeInTheDocument();
  });

  it('should show warning icon for warning level', () => {
    renderToast({ level: 'warning', message: 'Be careful' });
    expect(screen.getByTestId('WarningIcon')).toBeInTheDocument();
  });

  it('should show info icon for info level', () => {
    renderToast({ level: 'info', message: 'FYI' });
    expect(screen.getByTestId('InfoIcon')).toBeInTheDocument();
  });

  it('should auto-dismiss after duration', () => {
    const { store } = renderToast({ duration: 3000 });
    expect(store.getState().status.toast.isVisible).toBe(true);

    act(() => { vi.advanceTimersByTime(3000); });

    expect(store.getState().status.toast.isVisible).toBe(false);
  });

  it('should dismiss on close button click', () => {
    const { store } = renderToast();
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(store.getState().status.toast.isVisible).toBe(false);
  });

  it('should display the toast message', () => {
    renderToast({ message: 'Copied to clipboard' });
    expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
  });

  describe('Action button', () => {
    it('switchLanguage action saves the language and hides the toast (#124)', async () => {
      const base = createBaseState();
      const { store } = renderWithProviders(<Toast />, {
        preloadedState: {
          ...base,
          app: { ...base.app, settings: defaultSettings },
          status: {
            ...base.status,
            toast: {
              isVisible: true,
              level: 'info',
              message: 'Discrub ist auch auf Deutsch verfügbar.',
              duration: 3000,
              action: { type: 'switchLanguage', language: 'de', label: 'Auf Deutsch wechseln' },
            },
          },
        },
      });
      fireEvent.click(screen.getByText('Auf Deutsch wechseln'));
      // updateSetting.pending applies optimistically.
      expect(store.getState().app.settings?.appLanguage).toBe('de');
      expect(store.getState().status.toast.isVisible).toBe(false);
    });

    it('renders no action button when no action is present', () => {
      renderToast();
      expect(screen.queryByRole('button', { name: /reload/i })).toBeNull();
    });

    it('renders an action button when action is present', () => {
      renderToast({
        action: { type: 'reloadChannel', channelId: '999', label: 'Reload feed' },
      });
      expect(screen.getByRole('button', { name: 'Reload feed' })).toBeInTheDocument();
    });

    it('clicking the action button hides the toast and clears the action', () => {
      const { store } = renderToast({
        action: { type: 'reloadChannel', channelId: '999', label: 'Reload feed' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reload feed' }));
      expect(store.getState().status.toast.isVisible).toBe(false);
      expect(store.getState().status.toast.action).toBeUndefined();
    });
  });
});
