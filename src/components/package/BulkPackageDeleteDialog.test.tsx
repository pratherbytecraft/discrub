import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import BulkPackageDeleteDialog from './BulkPackageDeleteDialog';
import { initialPackageState } from '@features/package/packageSlice';
import {
  PACKAGE_CHANNEL_TYPE,
  type PackageChannel,
  type PackageMessage,
  type ParsedPackage,
} from '@features/package/packageTypes';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({ deleteMessage: vi.fn().mockResolvedValue({ success: true, status: 204 }) })),
}));

const general: PackageChannel = { id: '200', type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT, name: 'general', guildId: 'g1', guildName: 'Guild A', messageCount: 3, isOrphan: false };
const dm: PackageChannel = { id: '300', type: PACKAGE_CHANNEL_TYPE.DM, name: 'Direct Message with friend#0', messageCount: 1, isOrphan: false };
const left: PackageChannel = { id: '400', type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT, name: 'old-channel', messageCount: 9, isOrphan: true };

const parsed: ParsedPackage = {
  user: { id: 'u1', username: 'tester', globalName: 'Tester', avatarHash: null },
  guilds: [{ id: 'g1', name: 'Guild A' }],
  channels: [general, dm, left],
  totalMessages: 13,
  packageSizeBytes: 1,
};

const msg = (id: string, content: string, timestamp = '2023-01-01T00:00:00.000Z'): PackageMessage => ({ id, timestamp, content, attachments: [] });

// Messages preloaded in the cache, so counting never touches IndexedDB.
const loadedChannels = {
  '200': [msg('1', 'hello there'), msg('2', 'second'), msg('3', 'hello again')],
  '300': [msg('10', 'yo')],
  '400': [msg('20', 'orphan')],
};

function stateLoaded(extra: Partial<typeof initialPackageState> = {}) {
  return {
    auth: { token: 'tok', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
    package: {
      ...initialPackageState,
      status: 'ready',
      parsed,
      validation: { ok: true, readOnly: false, warnings: [], errors: [] },
      loadedChannels,
      loadedOrder: ['200', '300', '400'],
      ...extra,
    },
  } as never;
}

describe('<BulkPackageDeleteDialog /> (2.2.8)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists every ticked channel with its count, marks the Left Servers one, and totals the rest', async () => {
    renderWithProviders(
      <BulkPackageDeleteDialog open onClose={() => {}} channelIds={['200', '300', '400']} />,
      { preloadedState: stateLoaded() },
    );
    expect(screen.getByText('Delete your messages in 3 Channels')).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('friend')).toBeInTheDocument();
    expect(screen.getByText('Left Server, skipped')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('4'));
    expect(screen.getByTestId('package-bulk-delete-row-200')).toHaveTextContent('3');
    expect(screen.getByTestId('package-bulk-delete-row-300')).toHaveTextContent('1');
    expect(screen.getByTestId('package-bulk-delete-confirm')).toHaveTextContent('Delete 4 messages');
    expect(screen.getByTestId('package-bulk-delete-confirm')).toBeEnabled();
    expect(screen.getByText(/no second confirmation/)).toBeInTheDocument();
  });

  it('starts the run with the ticked channels and closes', async () => {
    const onClose = vi.fn();
    const { store } = renderWithProviders(
      <BulkPackageDeleteDialog open onClose={onClose} channelIds={['200', '300']} />,
      { preloadedState: stateLoaded() },
    );
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-confirm')).toBeEnabled());
    fireEvent.click(screen.getByTestId('package-bulk-delete-confirm'));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(store.getState().package.bulkDelete.queue).toEqual(['200', '300']));
  });

  it('says so and disables the button when nothing is left to delete', async () => {
    renderWithProviders(
      <BulkPackageDeleteDialog open onClose={() => {}} channelIds={['200', '400']} />,
      { preloadedState: stateLoaded({ deletedMessageIds: { '200': ['1', '2', '3'] } }) },
    );
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-nothing')).toBeInTheDocument());
    expect(screen.getByTestId('package-bulk-delete-confirm')).toBeDisabled();
    expect(screen.getByTestId('package-bulk-delete-confirm')).toHaveTextContent('Delete 0 messages');
  });

  it('drops a filter from an earlier open so the next run starts from everything', async () => {
    const { rerender } = renderWithProviders(
      <BulkPackageDeleteDialog open onClose={() => {}} channelIds={['200', '300']} />,
      { preloadedState: stateLoaded() },
    );
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('4'));
    fireEvent.click(screen.getByTestId('package-bulk-delete-filters'));
    fireEvent.change(await screen.findByPlaceholderText(/Search message content/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply filters/i }));
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('2'));

    rerender(<BulkPackageDeleteDialog open={false} onClose={() => {}} channelIds={['200', '300']} />);
    rerender(<BulkPackageDeleteDialog open onClose={() => {}} channelIds={['200', '300']} />);
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('4'));
    expect(screen.getByTestId('package-bulk-delete-filters')).toHaveTextContent('Add filters');
  });

  it('opens the package filter and recounts with it', async () => {
    renderWithProviders(
      <BulkPackageDeleteDialog open onClose={() => {}} channelIds={['200', '300']} />,
      { preloadedState: stateLoaded() },
    );
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('4'));
    fireEvent.click(screen.getByTestId('package-bulk-delete-filters'));
    const input = await screen.findByPlaceholderText(/Search message content/i);
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply filters/i }));
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('2'));
    expect(screen.getByTestId('package-bulk-delete-filters')).toHaveTextContent('Edit filters (1)');
    expect(screen.getByText('Filters apply to every Channel in this run.')).toBeInTheDocument();
  });

  // 2.2.9 (GitHub issue 23)
  it('recounts without the messages on a loaded skip list and offers the last run\'s failed list', async () => {
    const big = { '200': [msg('10001', 'a'), msg('10002', 'b'), msg('10003', 'c')], '300': [msg('10010', 'yo')], '400': [] };
    renderWithProviders(
      <BulkPackageDeleteDialog open onClose={() => {}} channelIds={['200', '300']} />,
      {
        preloadedState: {
          ...(stateLoaded({ loadedChannels: big }) as object),
          failures: { purge: [], package: [{ messageId: '10001', channelId: '200', guildId: 'g1', channelName: 'general', status: 403, kind: 'permanent', at: '2026-11-08T10:00:00.000Z' }], loadedFor: null },
        } as never,
      },
    );
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('4'));
    expect(screen.getByTestId('last-run-failures')).toHaveTextContent("The last run couldn't delete 1 message.");

    const text = JSON.stringify({ failures: [{ messageId: '10001', kind: 'permanent' }, { messageId: '10010', kind: 'retryable' }] });
    const file = new File([text], 'discrub-failed-2026-11-08.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
    fireEvent.change(screen.getByTestId('skip-list-input'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('3'));
    expect(screen.getByTestId('package-bulk-delete-row-200')).toHaveTextContent('2');
    expect(screen.getByTestId('package-bulk-delete-row-300')).toHaveTextContent('1');
    expect(screen.getByTestId('package-bulk-delete-confirm')).toHaveTextContent('Delete 3 messages');

    fireEvent.click(screen.getByTestId('skip-list-clear'));
    await waitFor(() => expect(screen.getByTestId('package-bulk-delete-total')).toHaveTextContent('4'));
  });
});
