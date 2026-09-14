import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, within, act } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockChannel, createMockGuild, createMockMessage } from '@/test/fixtures';
import MessageDayHeading from '@components/message/MessageDayHeading';
import TimelineShell from './TimelineShell';

vi.mock('@containers/ServerView/ServerView', () => ({ default: ({ variant }: { variant?: string }) => <div data-testid="serverview" data-variant={variant} /> }));
vi.mock('@components/package/PackageView', () => ({ default: () => <div data-testid="packageview" /> }));

const props = { sidebarOpen: false, onSidebarOpen: vi.fn(), onSidebarClose: vi.fn(), drawerOpen: false, onStartShellTour: vi.fn() };
const guild = createMockGuild({ id: 'g1', name: 'Cypress Test Server' });
const channel = createMockChannel({ id: 'c1', name: 'general' });
// Local date parts keep the day keys the same in any time zone.
const at = (id: string, mo: number, d: number, h = 12) => createMockMessage({ id, timestamp: new Date(2026, mo - 1, d, h).toISOString() });
const MESSAGES = [at('m6', 7, 17, 21), at('m5', 7, 17, 9), at('m4', 7, 15), at('m3', 7, 14), at('m2', 6, 30), at('m1', 6, 30, 8)];

const withChannel = (hasMore = false) => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, guilds: [guild], selectedGuild: guild };
  state.channel = { ...state.channel, channels: [channel], selectedChannel: channel };
  state.message = { ...state.message, messages: MESSAGES, filteredMessages: MESSAGES, pagination: { ...state.message.pagination, hasMore } };
  return state;
};
const withNothingOpen = () => {
  const state = createAuthenticatedState();
  state.guild = { ...state.guild, selectedGuild: null };
  state.channel = { ...state.channel, selectedChannel: null };
  state.dm = { ...state.dm, selectedDm: null };
  return state;
};

describe('<TimelineShell />', () => {
  it('renders the top bar, the strip, the action row, the month list and the feed grouped by day', () => {
    renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('simple-picker')).toHaveTextContent('# general');
    expect(screen.getByTestId('timeline-strip')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-side')).toBeInTheDocument();
    expect(screen.getByTestId('serverview')).toHaveAttribute('data-variant', 'timeline');
  });

  it('draws a bar for every day from the oldest to the newest message, and the counts agree everywhere', () => {
    renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    const bars = screen.getAllByTestId('timeline-bar');
    expect(bars).toHaveLength(18); // Jun 30 to Jul 17
    expect(bars[0]).toHaveAttribute('data-from', '2026-06-30');
    expect(bars[bars.length - 1]).toHaveAttribute('data-from', '2026-07-17');
    const barTotal = bars.reduce((a, b) => a + Number(b.getAttribute('data-count')), 0);
    expect(barTotal).toBe(6);
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('6');
    expect(screen.getByTestId('timeline-summary')).toHaveTextContent('6 messages, All loaded');
    const months = screen.getAllByTestId('timeline-month');
    expect(months.map((m) => m.textContent)).toEqual(['Jul 20264', 'Jun 20262']);
  });

  it('says older days need Load All while more is available, and enables Load All', () => {
    renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withChannel(true) });
    expect(screen.getByTestId('timeline-summary')).toHaveTextContent('older days need Load All');
    expect(screen.getByTestId('timeline-summary')).not.toHaveTextContent('All loaded');
    expect(screen.getByTestId('timeline-load-all')).toBeEnabled();
  });

  it('disables Load All once everything is loaded and opens the shared dialogs from the action row', () => {
    const { store } = renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    expect(screen.getByTestId('timeline-load-all')).toBeDisabled();
    fireEvent.click(screen.getByTestId('timeline-filters'));
    expect(store.getState().app.dialogs?.filters).toBe(true);
    fireEvent.click(screen.getByTestId('timeline-purge'));
    expect(store.getState().app.dialogs?.purge).toBe(true);
  });

  it('sets the refine date range from a drag across bars, keeps the strip whole, and clears it', () => {
    const { store } = renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    const bars = screen.getAllByTestId('timeline-bar');
    const from = bars.find((b) => b.getAttribute('data-from') === '2026-07-14')!;
    const to = bars.find((b) => b.getAttribute('data-from') === '2026-07-15')!;
    fireEvent.pointerDown(from, { pointerType: 'mouse', button: 0 });
    fireEvent.pointerOver(to);
    fireEvent.pointerUp(window);
    const refine = store.getState().message.refineCriteria!;
    expect(refine.searchAfterDate).toEqual(new Date(2026, 6, 14, 0, 0, 0, 0));
    expect(refine.searchBeforeDate).toEqual(new Date(2026, 6, 15, 23, 59, 59, 999));
    expect(store.getState().message.filteredMessages.map((m) => m.id)).toEqual(['m4', 'm3']);
    expect(screen.getByTestId('timeline-range')).toHaveTextContent('2 of 6 messages shown. Select all and Export use this range.');
    expect(screen.getAllByTestId('timeline-bar')).toHaveLength(18);
    expect(screen.getAllByTestId('timeline-bar').filter((b) => b.getAttribute('data-in-range') === 'true')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('timeline-range-clear'));
    expect(store.getState().message.filteredMessages).toHaveLength(6);
    expect(screen.queryByTestId('timeline-range')).not.toBeInTheDocument();
  });

  it('jumps to the newest message of a day on a plain click, without setting a range', () => {
    const { store } = renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withChannel() });
    const bar = screen.getAllByTestId('timeline-bar').find((b) => b.getAttribute('data-from') === '2026-07-17')!;
    fireEvent.pointerDown(bar, { pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(window);
    expect(store.getState().message.highlightedMessageId).toBe('m6');
    expect(store.getState().message.refineCriteria).toBeNull();
  });

  it('shows one hint and no action row before a conversation is open', () => {
    renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withNothingOpen() });
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-bar')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('timeline-side')).getByText('Get started')).toBeInTheDocument();
  });

  it('survives a channel opening after the shell has rendered with nothing open', () => {
    const { store } = renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: withNothingOpen() });
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
    act(() => {
      store.dispatch({ type: 'channel/setSelectedChannel', payload: channel });
      store.dispatch({ type: 'message/setMessages', payload: MESSAGES });
    });
    expect(store.getState().channel.selectedChannel?.id).toBe('c1');
    expect(screen.getByTestId('timeline-shell')).toBeInTheDocument();
  });

  it('keeps the top bar and the feed in Focus and hides the strip, the action row and the month list', () => {
    renderWithProviders(<TimelineShell {...props} focusedView />, { preloadedState: withChannel() });
    expect(screen.getByTestId('simple-top')).toBeInTheDocument();
    expect(screen.getByTestId('serverview')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-side')).not.toBeInTheDocument();
  });

  it('leaves the strip and the month list out for a forum, which lists posts', () => {
    const state = withChannel();
    const forum = createMockChannel({ id: 'f1', name: 'buyer-feedback', type: 15 });
    state.channel = { ...state.channel, channels: [forum], selectedChannel: forum };
    renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: state });
    expect(screen.queryByTestId('timeline-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-side')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-export')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-purge')).not.toBeInTheDocument();
  });

  it('shows the package view with no strip and no action row in package mode', () => {
    const state = withChannel();
    state.app = { ...state.app, sidebarView: 'package' };
    renderWithProviders(<TimelineShell {...props} focusedView={false} />, { preloadedState: state });
    expect(screen.getByTestId('packageview')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-toolbar')).not.toBeInTheDocument();
  });
});

describe('<MessageDayHeading />', () => {
  it('names the day, counts it and toggles Select day', () => {
    const onToggleDay = vi.fn();
    const { rerender } = renderWithProviders(<MessageDayHeading dayKey="2026-07-17" count={6} selectedCount={0} onToggleDay={onToggleDay} />);
    expect(screen.getByTestId('day-heading')).toHaveTextContent('Friday, July 17th, 2026');
    expect(screen.getByTestId('day-count')).toHaveTextContent('6 messages');
    fireEvent.click(screen.getByTestId('select-day'));
    expect(onToggleDay).toHaveBeenCalledWith('2026-07-17');
    rerender(<MessageDayHeading dayKey="2026-07-17" count={1} selectedCount={1} onToggleDay={onToggleDay} />);
    expect(screen.getByTestId('select-day')).toHaveTextContent('Clear day');
    expect(screen.getByTestId('day-count')).toHaveTextContent('1 message');
  });
});
