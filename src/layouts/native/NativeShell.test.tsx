import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockChannel, createMockGuild } from '@/test/fixtures';
import NativeShell from './NativeShell';

vi.mock('@containers/ServerView/ServerView', () => ({ default: ({ variant }: { variant?: string }) => <div data-testid="serverview" data-variant={variant} /> }));
vi.mock('@components/package/PackageView', () => ({ default: () => <div data-testid="packageview" /> }));

const props = { sidebarOpen: false, onSidebarOpen: vi.fn(), onSidebarClose: vi.fn(), drawerOpen: false, onStartShellTour: vi.fn() };
const guild = createMockGuild({ id: 'g1', name: 'Cypress Test Server' });
const channel = createMockChannel({ id: 'c1', name: 'general' });
const withChannel = () => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, guilds: [guild], selectedGuild: guild };
  state.channel = { ...state.channel, channels: [channel], selectedChannel: channel };
  return state;
};

describe('<NativeShell />', () => {
  it('renders the rail, the column, the head and the inspector around the feed', () => {
    renderWithProviders(<NativeShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('native-rail')).toBeInTheDocument();
    expect(screen.getByTestId('rail-guild-g1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('native-column-title')).toHaveTextContent('Cypress Test Server');
    expect(screen.getByTestId('native-head-title')).toHaveTextContent('general');
    expect(screen.getByTestId('serverview')).toHaveAttribute('data-variant', 'native');
    expect(screen.getByTestId('inspector-actions')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-log')).toBeInTheDocument();
  });

  it('opens the shared dialogs from the inspector through the store', () => {
    const { store } = renderWithProviders(<NativeShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    fireEvent.click(screen.getByTestId('inspector-export'));
    expect(store.getState().app.dialogs?.export).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-filters-edit'));
    expect(store.getState().app.dialogs?.filters).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-purge'));
    expect(store.getState().app.dialogs?.purge).toBe(true);
    fireEvent.click(screen.getByTestId('native-filters'));
    expect(store.getState().app.dialogs?.filters).toBe(true);
  });

  // 2.2.0 (A2): Focus hides the rail, the column and the inspector; the head row stays.
  it('in Focus keeps the head row and shows the pill', () => {
    const state = withChannel();
    state.app = { ...state.app, focusedView: true };
    renderWithProviders(<NativeShell {...props} focusedView />, { preloadedState: state });
    expect(screen.queryByTestId('native-rail')).toBeNull();
    expect(screen.queryByTestId('native-column')).toBeNull();
    expect(screen.queryByTestId('native-inspector')).toBeNull();
    expect(screen.getByTestId('native-head')).toBeInTheDocument();
    expect(screen.getByTestId('focus-pill')).toBeInTheDocument();
  });

  it('shows the package view with its own inspector card in package view', () => {
    const state = withChannel();
    state.app = { ...state.app, sidebarView: 'package' };
    renderWithProviders(<NativeShell {...props} focusedView={false} />, { preloadedState: state });
    expect(screen.getByTestId('packageview')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-package')).toBeInTheDocument();
    expect(screen.getByTestId('rail-package')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the status log as a sheet from the inspector peek', () => {
    renderWithProviders(<NativeShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(document.querySelector('[data-tour="status-panel"]')).toBeNull();
    fireEvent.click(screen.getByTestId('inspector-log-open'));
    const panel = document.querySelector('[data-tour="status-panel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('data-sheet')).toBe('true');
  });
});
