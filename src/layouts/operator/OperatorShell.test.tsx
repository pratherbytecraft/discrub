import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockChannel, createMockGuild } from '@/test/fixtures';
import OperatorShell from './OperatorShell';

vi.mock('@containers/ServerView/ServerView', () => ({ default: ({ variant }: { variant?: string }) => <div data-testid="serverview" data-variant={variant} /> }));
vi.mock('@components/package/PackageView', () => ({ default: () => <div data-testid="packageview" /> }));

const props = { sidebarOpen: false, onSidebarOpen: vi.fn(), onSidebarClose: vi.fn(), drawerOpen: false, onStartShellTour: vi.fn() };
const guild = createMockGuild({ id: 'g1', name: 'Cypress Test Server' });
const general = createMockChannel({ id: 'c1', name: 'general' });
const random = createMockChannel({ id: 'c2', name: 'random' });
const withChannel = () => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, guilds: [guild], selectedGuild: guild };
  state.channel = { ...state.channel, channels: [general, random], selectedChannel: general, selectedChannels: [] };
  return state;
};

describe('<OperatorShell />', () => {
  it('renders the top bar crumb, the queue with the segment, the run card, the log, the peek and recent exports', () => {
    renderWithProviders(<OperatorShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('operator-crumb')).toHaveTextContent('Cypress Test Server');
    expect(screen.getByTestId('operator-crumb')).toHaveTextContent('# general');
    expect(screen.getByTestId('operator-version')).not.toHaveTextContent('');
    expect(screen.getByTestId('operator-seg-servers')).toHaveAttribute('data-tour', 'servers-tab');
    expect(screen.getByTestId('operator-run-card')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByTestId('operator-log')).toBeInTheDocument();
    expect(screen.getByTestId('operator-peek')).toBeInTheDocument();
    expect(screen.getByTestId('serverview')).toHaveAttribute('data-variant', 'operator');
    expect(screen.getByTestId('operator-recent')).toBeInTheDocument();
    expect(screen.queryByTestId('focus-pill')).toBeNull();
  });

  it('builds the queue from the ticks and the Export and Purge tiles follow it, Load All stays on the open channel', () => {
    const { store } = renderWithProviders(<OperatorShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('op-export')).toBeDisabled();
    expect(screen.getByTestId('op-purge')).toBeDisabled();
    expect(screen.getByTestId('op-load-all')).toHaveTextContent('in #general');
    const ticks = screen.getAllByTestId('queue-tick');
    fireEvent.click(ticks[0]);
    fireEvent.click(ticks[1]);
    expect(store.getState().channel.selectedChannels).toHaveLength(2);
    expect(screen.getByTestId('operator-queue-count')).toHaveTextContent('2 channels queued');
    expect(screen.getByTestId('op-export')).toBeEnabled();
    expect(screen.getByTestId('op-purge')).toBeEnabled();
    fireEvent.click(screen.getByTestId('op-export'));
    expect(store.getState().app.dialogs?.bulkExport).toBe(true);
    fireEvent.click(screen.getByTestId('op-purge'));
    expect(store.getState().app.dialogs?.purge).toBe(true);
  });

  it('opens Filters, Analytics and Load Thread from the toolbar above the peek', () => {
    const state = withChannel();
    const { store } = renderWithProviders(<OperatorShell {...props} focusedView={false} />, { preloadedState: state });
    fireEvent.click(screen.getByTestId('op-filters'));
    expect(store.getState().app.dialogs?.filters).toBe(true);
    fireEvent.click(screen.getByTestId('op-load-thread'));
    expect(store.getState().app.dialogs?.threadLoad).toBe(true);
  });

  it('Open feed moves the feed to the middle and the run card to the side, Back returns', () => {
    renderWithProviders(<OperatorShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    fireEvent.click(screen.getByTestId('op-open-feed'));
    expect(screen.queryByTestId('operator-peek')).toBeNull();
    expect(screen.getByTestId('operator-main')).toContainElement(screen.getByTestId('serverview'));
    expect(screen.getByTestId('operator-side')).toContainElement(screen.getByTestId('operator-run-card'));
    fireEvent.click(screen.getByTestId('op-open-feed'));
    expect(screen.getByTestId('operator-peek')).toBeInTheDocument();
  });

  it('marks the queue and says how far a bulk export has got', () => {
    const state = withChannel();
    state.channel = { ...state.channel, selectedChannels: [general, random] };
    state.export = { ...state.export, isExporting: true, exportProgress: { ...(state.export.exportProgress ?? {}), bulk: { currentIndex: 1, totalChannels: 2, currentChannelName: 'random' } } as never };
    renderWithProviders(<OperatorShell {...props} focusedView={false} />, { preloadedState: state });
    expect(screen.getByTestId('queue-mark-done')).toBeInTheDocument();
    expect(screen.getByTestId('queue-mark-running')).toBeInTheDocument();
    expect(screen.getByTestId('operator-queue-count')).toHaveTextContent('1 done, 1 running, 0 queued');
    expect(screen.getByTestId('operator-run-card')).not.toHaveAttribute('data-state', 'idle');
  });

  it('shows the package view under the Package segment with no run tiles', () => {
    const state = withChannel();
    state.app = { ...state.app, sidebarView: 'package' };
    renderWithProviders(<OperatorShell {...props} focusedView={false} />, { preloadedState: state });
    expect(screen.getByTestId('packageview')).toBeInTheDocument();
    expect(screen.queryByTestId('op-load-all')).toBeNull();
    expect(screen.getByTestId('operator-crumb')).toHaveTextContent('Package');
  });
});
