import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent, within } from '@/test/test-utils';
import PackageChannelList from './PackageChannelList';
import { initialPackageState } from '@features/package/packageSlice';
import {
  PACKAGE_CHANNEL_TYPE,
  type PackageChannel,
  type ParsedPackage,
} from '@features/package/packageTypes';

const purgedChannel: PackageChannel = {
  id: '200',
  type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
  name: 'general',
  guildId: 'g1',
  guildName: 'Guild A',
  messageCount: 80000,
  isOrphan: false,
};

const untouchedChannel: PackageChannel = {
  id: '201',
  type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
  name: 'random',
  guildId: 'g1',
  guildName: 'Guild A',
  messageCount: 5,
  isOrphan: false,
};

const parsed: ParsedPackage = {
  user: { id: 'u1', username: 'tester', globalName: 'Tester', avatarHash: null },
  guilds: [{ id: 'g1', name: 'Guild A' }],
  channels: [purgedChannel, untouchedChannel],
  totalMessages: 80005,
  packageSizeBytes: 1,
};

function statePackageLoaded(
  deletedMessageIds: Record<string, string[]> = {},
) {
  return {
    package: {
      ...initialPackageState,
      status: 'ready',
      parsed,
      validation: { ok: true, readOnly: false, warnings: [], errors: [] },
      deletedMessageIds,
    },
  } as never;
}

describe('<PackageChannelList /> — #236 live remaining counts', () => {
  it('renders the archive count untouched when no deletions exist', () => {
    renderWithProviders(<PackageChannelList />, {
      preloadedState: statePackageLoaded(),
    });
    expect(screen.getByText('80,000')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('subtracts deleted-via-Discrub ids from the displayed count', () => {
    renderWithProviders(<PackageChannelList />, {
      preloadedState: statePackageLoaded({ '200': ['1', '2', '3'] }),
    });
    // 80,000 in the archive minus 3 confirmed-gone.
    expect(screen.getByText('79,997')).toBeInTheDocument();
    expect(screen.queryByText('80,000')).not.toBeInTheDocument();
    // Untouched sibling keeps its raw archive count.
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('explains the adjustment in a tooltip on the count caption', async () => {
    renderWithProviders(<PackageChannelList />, {
      preloadedState: statePackageLoaded({ '200': ['1', '2', '3'] }),
    });
    fireEvent.mouseOver(screen.getByText('79,997'));
    expect(
      await screen.findByText('80,000 in package, 3 deleted via Discrub'),
    ).toBeInTheDocument();
  });

  it('does not attach a tooltip when a channel has no deletions', () => {
    renderWithProviders(<PackageChannelList />, {
      preloadedState: statePackageLoaded({ '200': ['1'] }),
    });
    const untouched = screen.getByText('5');
    expect(untouched).not.toHaveAttribute('aria-label');
    fireEvent.mouseOver(untouched);
    expect(
      screen.queryByText(/in package, .* deleted via Discrub/),
    ).not.toBeInTheDocument();
  });
});


describe('<PackageChannelList /> — sections per category (#270)', () => {
  const mixed: ParsedPackage = {
    ...parsed,
    channels: [
      { id: '1', type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT, name: 'text-one', guildId: 'g1', guildName: 'Guild A', messageCount: 3, isOrphan: false },
      { id: '2', type: PACKAGE_CHANNEL_TYPE.GUILD_PRIVATE_THREAD, name: 'thread-two', guildId: 'g1', guildName: 'Guild A', messageCount: 3, isOrphan: false },
      { id: '3', type: PACKAGE_CHANNEL_TYPE.DM, name: 'Direct Message with dm-three#0', messageCount: 3, isOrphan: false },
      { id: '4', type: PACKAGE_CHANNEL_TYPE.GROUP_DM, name: 'group-four', messageCount: 3, isOrphan: false },
      { id: '5', type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT, name: 'orphan-five', messageCount: 3, isOrphan: true },
      { id: '6', type: PACKAGE_CHANNEL_TYPE.UNKNOWN, name: 'mystery-six', messageCount: 3, isOrphan: false },
    ],
    totalMessages: 18,
  };

  it('puts one channel of each type in its own section, unknown under Other', () => {
    const state = statePackageLoaded() as any;
    state.package.parsed = mixed;
    renderWithProviders(<PackageChannelList />, { preloadedState: state });
    expect(screen.getByText('Servers')).toBeInTheDocument();
    // 2.2.9: a thread that names its Server sits under that Server, so no Threads section.
    expect(screen.queryByText('Threads')).not.toBeInTheDocument();
    expect(screen.getByText('Direct Messages')).toBeInTheDocument();
    expect(screen.getByText('Group DMs')).toBeInTheDocument();
    expect(screen.getByText('Left Servers')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('mystery-six')).toBeInTheDocument();
    expect(screen.getByText('thread-two')).toBeInTheDocument();
  });

  // #273: the Left Servers header carries a recheck button when signed in.
  it('shows the Left Servers recheck button only with a token', () => {
    const state = statePackageLoaded() as any;
    state.package.parsed = mixed;
    state.auth = { token: 'tok', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false };
    const { unmount } = renderWithProviders(<PackageChannelList />, { preloadedState: state });
    expect(screen.getByRole('button', { name: 'Recheck left servers' })).toBeInTheDocument();
    unmount();

    const signedOut = statePackageLoaded() as any;
    signedOut.package.parsed = mixed;
    renderWithProviders(<PackageChannelList />, { preloadedState: signedOut });
    expect(screen.queryByRole('button', { name: 'Recheck left servers' })).toBeNull();
  });

  it('leaves the Other section out when nothing is unresolved', () => {
    renderWithProviders(<PackageChannelList />, { preloadedState: statePackageLoaded() });
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });
});

describe('<PackageChannelList /> — Multi-select bulk delete (2.2.8)', () => {
  const signedIn = {
    auth: { token: 'tok', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
  };
  const withLeft: ParsedPackage = {
    ...parsed,
    channels: [purgedChannel, untouchedChannel, { id: '5', type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT, name: 'orphan-five', messageCount: 3, isOrphan: true }],
    totalMessages: 80008,
  };

  function loaded() {
    const state = statePackageLoaded() as any;
    state.package.parsed = withLeft;
    return { ...state, ...signedIn };
  }

  it('shows the toggle only as enabled when signed in and the package is writable', () => {
    const { unmount } = renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    expect(screen.getByTestId('package-multi-select-toggle')).toBeEnabled();
    unmount();

    const signedOut = statePackageLoaded() as any;
    renderWithProviders(<PackageChannelList />, { preloadedState: signedOut });
    expect(screen.getByTestId('package-multi-select-toggle')).toBeDisabled();
  });

  it('ticks rows into the store, leaves Left Servers rows without a checkbox, and Select all picks the rest', () => {
    const { store } = renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    expect(screen.queryAllByTestId('package-bulk-tick')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('package-multi-select-toggle'));
    // Two deletable rows get a checkbox; the Left Servers row (collapsed group) gets none.
    expect(screen.getAllByTestId('package-bulk-tick')).toHaveLength(2);
    expect(screen.getByTestId('multi-select-purge')).toHaveTextContent('Delete');
    expect(screen.getByTestId('multi-select-purge')).toBeDisabled();

    fireEvent.click(screen.getByText('general'));
    expect(store.getState().package.bulkSelectedChannelIds).toEqual(['200']);
    expect(store.getState().package.selectedChannelId).toBeNull();
    expect(screen.getByTestId('multi-select-count')).toHaveTextContent('1 of 2');
    expect(screen.getByTestId('multi-select-purge')).toBeEnabled();

    fireEvent.click(screen.getByTestId('multi-select-toggle-all'));
    expect([...store.getState().package.bulkSelectedChannelIds].sort()).toEqual(['200', '201']);
    fireEvent.click(screen.getByTestId('multi-select-toggle-all'));
    expect(store.getState().package.bulkSelectedChannelIds).toEqual([]);

    // Switching Multi-select off clears the selection.
    fireEvent.click(screen.getByText('general'));
    fireEvent.click(screen.getByTestId('package-multi-select-toggle'));
    expect(store.getState().package.bulkSelectedChannelIds).toEqual([]);
    expect(screen.queryAllByTestId('package-bulk-tick')).toHaveLength(0);
  });

  it('starts with Multi-select on when the store already holds ticks, so a layout switch keeps them visible', () => {
    const state = loaded();
    state.package.bulkSelectedChannelIds = ['200'];
    renderWithProviders(<PackageChannelList />, { preloadedState: state });
    expect(screen.getAllByTestId('package-bulk-tick')).toHaveLength(2);
    expect(screen.getByTestId('multi-select-count')).toHaveTextContent('1 of 2');
  });

  it('opens the confirm dialog from the Delete button', () => {
    renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    fireEvent.click(screen.getByTestId('package-multi-select-toggle'));
    fireEvent.click(screen.getByText('random'));
    fireEvent.click(screen.getByTestId('multi-select-purge'));
    expect(screen.getByTestId('package-bulk-delete-dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete your messages in 1 Channel')).toBeInTheDocument();
  });

  it('shows the running bar with Skip and marks the queue while a run is on', () => {
    const state = loaded();
    state.package.bulkDelete = {
      ...initialPackageState.bulkDelete,
      status: 'running',
      queue: ['200', '201'],
      currentChannelId: '201',
      outcomes: { '200': { channelId: '200', state: 'done' }, '201': { channelId: '201', state: 'running' } },
      progress: { messagesDone: 80000, messagesTotal: 80005 },
    };
    const { store } = renderWithProviders(<PackageChannelList />, { preloadedState: state });
    expect(screen.getByTestId('package-bulk-running')).toHaveTextContent('Deleting Channel 2 of 2 · random');
    expect(screen.getByTestId('package-bulk-running')).toHaveTextContent('80,000 of 80,005 messages');
    expect(screen.queryByTestId('package-multi-select-toggle')).toBeNull();
    expect(screen.getByTestId('package-bulk-mark-done')).toBeInTheDocument();
    expect(screen.getByTestId('package-bulk-mark-running')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('package-bulk-skip'));
    expect(store.getState().package.bulkDelete.skipRequested).toBe(true);
  });

  it('shows the totals after a run and dismisses back to the toggle', () => {
    const state = loaded();
    state.package.bulkDelete = {
      ...initialPackageState.bulkDelete,
      status: 'done',
      queue: ['200'],
      outcomes: { '200': { channelId: '200', state: 'done', result: { deleted: 5, alreadyGone: 2, forbidden: 0, failed: 1, cancelled: false, deletedIds: [], alreadyGoneIds: [] } } },
    };
    const { store } = renderWithProviders(<PackageChannelList />, { preloadedState: state });
    expect(screen.getByTestId('package-bulk-finished')).toHaveTextContent('Done. 5 deleted, 2 already gone, 1 failed.');
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(store.getState().package.bulkDelete.status).toBe('idle');
    expect(screen.getByTestId('package-multi-select-toggle')).toBeInTheDocument();
  });
});

describe('<PackageChannelList /> — one group per Server (2.2.9, GitHub issue 23)', () => {
  const signedIn = {
    auth: { token: 'tok', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
  };
  const ch = (id: string, name: string, guild: 'a' | 'b' | null, messageCount: number, type: PackageChannel['type'] = PACKAGE_CHANNEL_TYPE.GUILD_TEXT): PackageChannel => ({
    id,
    type,
    name,
    ...(guild ? { guildId: guild === 'a' ? 'ga' : 'gb', guildName: guild === 'a' ? 'Alpha Server' : 'Beta Server' } : {}),
    messageCount,
    isOrphan: false,
  });
  const twoServers: ParsedPackage = {
    ...parsed,
    channels: [
      ch('1', 'alpha-small', 'a', 5),
      ch('2', 'alpha-thread', 'a', 90, PACKAGE_CHANNEL_TYPE.GUILD_PUBLIC_THREAD),
      ch('3', 'alpha-big', 'a', 40),
      ch('4', 'beta-one', 'b', 300),
      ch('5', 'beta-thread', 'b', 2, PACKAGE_CHANNEL_TYPE.GUILD_PUBLIC_THREAD),
      ch('6', 'loose-thread', null, 7, PACKAGE_CHANNEL_TYPE.GUILD_PUBLIC_THREAD),
      { id: '7', type: PACKAGE_CHANNEL_TYPE.DM, name: 'Direct Message with pal#0', messageCount: 9, isOrphan: false },
    ],
    totalMessages: 453,
  };

  function loaded() {
    const state = statePackageLoaded() as any;
    state.package.parsed = twoServers;
    return { ...state, ...signedIn };
  }
  const groups = () => screen.getAllByTestId('package-server-group');
  const rowNames = () => screen.getAllByTestId('package-channel-row').map((r) => r.querySelector('.MuiTypography-body2')?.textContent);

  it('lists Servers by message count with their counts, text channels first and threads after', () => {
    renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    expect(groups().map((g) => g.getAttribute('data-server'))).toEqual(['gb', 'ga']);
    expect(groups()[0]).toHaveTextContent('Beta Server');
    expect(groups()[0]).toHaveTextContent('2 channels · 302 messages');
    expect(groups()[1]).toHaveTextContent('3 channels · 135 messages');
    expect(rowNames()).toEqual(['beta-one', 'beta-thread', 'alpha-big', 'alpha-small', 'alpha-thread', 'loose-thread', 'pal']);
    // A thread with no Server on record keeps the Threads section.
    expect(screen.getByText('Threads')).toBeInTheDocument();
  });

  it('counts what is left on the Server header once messages were deleted', () => {
    const state = loaded();
    state.package.deletedMessageIds = { '4': ['m1', 'm2'], '5': ['m3'] };
    renderWithProviders(<PackageChannelList />, { preloadedState: state });
    expect(groups()[0]).toHaveTextContent('2 channels · 299 messages');
  });

  it('drops the Server name line from rows under a Server header', () => {
    renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    expect(screen.getAllByText('Alpha Server')).toHaveLength(1);
    expect(screen.getAllByText('Beta Server')).toHaveLength(1);
  });

  it('folds one Server from its arrow and leaves the others open', () => {
    renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    fireEvent.click(screen.getByLabelText('Show or hide Beta Server'));
    expect(screen.getByLabelText('Show or hide Beta Server')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Show or hide Alpha Server')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('alpha-big')).toBeInTheDocument();
  });

  it('hides a Server when the filter matches none of its channels and keeps one matched by Server name', () => {
    const { unmount } = renderWithProviders(<PackageChannelList filterText="alpha-big" />, { preloadedState: loaded() });
    expect(groups()).toHaveLength(1);
    expect(groups()[0]).toHaveTextContent('1 channel · 40 messages');
    unmount();
    renderWithProviders(<PackageChannelList filterText="beta server" />, { preloadedState: loaded() });
    expect(groups()).toHaveLength(1);
    expect(rowNames()).toEqual(['beta-one', 'beta-thread']);
  });

  it('shows a checkbox on each Server header only in Multi-select, and it ticks and clears the whole Server', () => {
    const { store } = renderWithProviders(<PackageChannelList />, { preloadedState: loaded() });
    expect(screen.queryAllByTestId('package-server-tick')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('package-multi-select-toggle'));
    expect(screen.getAllByTestId('package-server-tick')).toHaveLength(2);

    const alpha = within(groups()[1]).getByRole('checkbox');
    fireEvent.click(alpha);
    expect([...store.getState().package.bulkSelectedChannelIds].sort()).toEqual(['1', '2', '3']);
    expect(alpha).toBeChecked();
    expect(screen.getByTestId('multi-select-count')).toHaveTextContent('3 of 7');

    // One row cleared leaves the header on a dash; the header then ticks the rest back on.
    fireEvent.click(screen.getByText('alpha-small'));
    expect(alpha).not.toBeChecked();
    expect(alpha).toHaveAttribute('data-indeterminate', 'true');
    fireEvent.click(alpha);
    expect([...store.getState().package.bulkSelectedChannelIds].sort()).toEqual(['1', '2', '3']);

    // A tick in another Server survives clearing this one.
    fireEvent.click(screen.getByText('beta-one'));
    fireEvent.click(alpha);
    expect(store.getState().package.bulkSelectedChannelIds).toEqual(['4']);
  });
});
