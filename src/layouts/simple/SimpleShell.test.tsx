import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockChannel, createMockGuild } from '@/test/fixtures';
import SimpleShell from './SimpleShell';

vi.mock('@containers/ServerView/ServerView', () => ({ default: ({ variant }: { variant?: string }) => <div data-testid="serverview" data-variant={variant} /> }));
vi.mock('@components/package/PackageView', () => ({ default: () => <div data-testid="packageview" /> }));

const props = { sidebarOpen: false, onSidebarOpen: vi.fn(), onSidebarClose: vi.fn(), drawerOpen: false, onStartShellTour: vi.fn() };
const guild = createMockGuild({ id: 'g1', name: 'Cypress Test Server' });
const channel = createMockChannel({ id: 'c1', name: 'general' });
const withNothingOpen = () => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, selectedGuild: null };
  state.channel = { ...state.channel, selectedChannel: null };
  state.dm = { ...state.dm, selectedDm: null };
  return state;
};
const withChannel = () => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, guilds: [guild], selectedGuild: guild };
  state.channel = { ...state.channel, channels: [channel], selectedChannel: channel };
  return state;
};

describe('<SimpleShell />', () => {
  it('renders the top bar with the picker breadcrumb and the version, the search card, the hint bar and the feed', () => {
    renderWithProviders(<SimpleShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('simple-top')).toBeInTheDocument();
    expect(screen.getByTestId('simple-picker')).toHaveTextContent('Cypress Test Server');
    expect(screen.getByTestId('simple-picker')).toHaveTextContent('# general');
    expect(screen.getByTestId('simple-version')).not.toHaveTextContent('');
    expect(screen.getByTestId('simple-search-card')).toBeInTheDocument();
    expect(screen.getByTestId('simple-hint-bar')).toBeInTheDocument();
    expect(screen.getByTestId('serverview')).toHaveAttribute('data-variant', 'simple');
  });

  it('shows the pick hint card and no Analytics or Focus before a conversation is open', () => {
    renderWithProviders(<SimpleShell {...props} focusedView={false} />, { preloadedState: withNothingOpen() });
    expect(screen.getByTestId('simple-welcome-card')).toBeInTheDocument();
    expect(screen.queryByTestId('simple-search-card')).toBeNull();
    expect(screen.queryByTestId('simple-analytics')).toBeNull();
    expect(screen.queryByTestId('simple-focus')).toBeNull();
  });

  it('opens the navigation drawer from the picker', () => {
    const onSidebarOpen = vi.fn();
    renderWithProviders(<SimpleShell {...props} onSidebarOpen={onSidebarOpen} focusedView={false} />, { preloadedState: withChannel() });
    fireEvent.click(screen.getByTestId('simple-picker'));
    expect(onSidebarOpen).toHaveBeenCalled();
  });

  it('shows the rail and the column inside the drawer when it is open', () => {
    renderWithProviders(<SimpleShell {...props} sidebarOpen focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('native-rail')).toBeInTheDocument();
    expect(screen.getByTestId('native-column-title')).toHaveTextContent('Cypress Test Server');
  });

  it('opens the shared dialogs from the search card and the top bar through the store', () => {
    const { store } = renderWithProviders(<SimpleShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    fireEvent.click(screen.getByTestId('simple-filters'));
    expect(store.getState().app.dialogs?.filters).toBe(true);
    fireEvent.click(screen.getByTestId('simple-purge'));
    expect(store.getState().app.dialogs?.purge).toBe(true);
    fireEvent.click(screen.getByTestId('simple-load-thread'));
    expect(store.getState().app.dialogs?.threadLoad).toBe(true);
    fireEvent.click(screen.getByTestId('simple-settings'));
    expect(store.getState().app.dialogs?.settings).toBe(true);
    fireEvent.click(screen.getByTestId('simple-focus'));
    expect(store.getState().app.focusedView).toBe(true);
  });

  it('opens the status log as a sheet from the bottom bar', () => {
    renderWithProviders(<SimpleShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    const panel = document.querySelector('[data-tour="status-panel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('data-sheet')).not.toBe('true');
    fireEvent.click(screen.getByLabelText('Expand log'));
    expect((document.querySelector('[data-tour="status-panel"]') as HTMLElement).getAttribute('data-sheet')).toBe('true');
  });

  // 2.2.0 (A2): Focus keeps the top bar and the feed, hides the search card, hint bar and log.
  it('in Focus keeps the top bar and shows the pill', () => {
    const state = withChannel();
    state.app = { ...state.app, focusedView: true };
    renderWithProviders(<SimpleShell {...props} focusedView />, { preloadedState: state });
    expect(screen.getByTestId('simple-top')).toBeInTheDocument();
    expect(screen.queryByTestId('simple-search-card')).toBeNull();
    expect(screen.queryByTestId('simple-hint-bar')).toBeNull();
    expect(document.querySelector('[data-tour="status-panel"]')).toBeNull();
    expect(screen.getByTestId('focus-pill')).toBeInTheDocument();
  });

  it('shows the package view with the Package breadcrumb and no search card in package view', () => {
    const state = withChannel();
    state.app = { ...state.app, sidebarView: 'package' };
    renderWithProviders(<SimpleShell {...props} focusedView={false} />, { preloadedState: state });
    expect(screen.getByTestId('packageview')).toBeInTheDocument();
    expect(screen.queryByTestId('simple-search-card')).toBeNull();
    expect(screen.getByTestId('simple-picker')).toHaveTextContent('Package');
  });
});
