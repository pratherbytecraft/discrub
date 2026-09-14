import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockChannel, createMockGuild } from '@/test/fixtures';
import WorkbenchShell from './WorkbenchShell';

vi.mock('@containers/ServerView/ServerView', () => ({ default: ({ variant }: { variant?: string }) => <div data-testid="serverview" data-variant={variant} /> }));
vi.mock('@components/package/PackageView', () => ({ default: () => <div data-testid="packageview" /> }));
vi.mock('@components/navigation/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock('@containers/MainLayout/TopBar', () => ({ default: () => <div data-testid="topbar" /> }));

const props = { sidebarOpen: false, onSidebarOpen: vi.fn(), onSidebarClose: vi.fn(), drawerOpen: false, onStartShellTour: vi.fn() };
const guild = createMockGuild({ id: 'g1', name: 'Cypress Test Server' });
const channel = createMockChannel({ id: 'c1', name: 'general' });
const withChannel = () => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, guilds: [guild], selectedGuild: guild };
  state.channel = { ...state.channel, channels: [channel], selectedChannel: channel };
  return state;
};

describe('<WorkbenchShell />', () => {
  it('renders the top bar, sidebar, toolbar, table variant, dock and status bar', () => {
    renderWithProviders(<WorkbenchShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('serverview')).toHaveAttribute('data-variant', 'workbench');
    expect(screen.getByTestId('workbench-dock')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-status-bar')).toHaveTextContent('loaded');
  });

  it('opens the shared dialogs from the toolbar through the store', () => {
    const { store } = renderWithProviders(<WorkbenchShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    fireEvent.click(screen.getByTestId('wb-filters'));
    expect(store.getState().app.dialogs?.filters).toBe(true);
    fireEvent.click(screen.getByTestId('wb-purge'));
    expect(store.getState().app.dialogs?.purge).toBe(true);
    fireEvent.click(screen.getByTestId('wb-load-thread'));
    expect(store.getState().app.dialogs?.threadLoad).toBe(true);
  });

  it('opens the status log as a sheet from the dock tab', () => {
    renderWithProviders(<WorkbenchShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(document.querySelector('[data-tour="status-panel"]')).toBeNull();
    fireEvent.click(screen.getByTestId('dock-tab-log'));
    expect((document.querySelector('[data-tour="status-panel"]') as HTMLElement).getAttribute('data-sheet')).toBe('true');
  });

  it('in Focus keeps the top bar and the toolbar, hides the sidebar, dock and status bar, shows the pill', () => {
    const state = withChannel();
    state.app = { ...state.app, focusedView: true };
    renderWithProviders(<WorkbenchShell {...props} focusedView />, { preloadedState: state });
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.queryByTestId('workbench-dock')).toBeNull();
    expect(screen.queryByTestId('workbench-status-bar')).toBeNull();
    expect(screen.getByTestId('focus-pill')).toBeInTheDocument();
  });
});
