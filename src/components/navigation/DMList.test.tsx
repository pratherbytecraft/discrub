import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test/test-utils';
import DMList from './DMList';
import { createBaseState } from '../../test/state-factories';
import { createMockUser, createMockChannel } from '../../test/fixtures';
import { DiscrubSetting, DmSortOrder } from 'discrub-core/discrub-enum';
import { getDiscordService } from '@services/discordService';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchDMs: vi.fn().mockResolvedValue([]),
    fetchMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
  })),
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

const dmWithRecipient = {
  id: 'dm-1',
  type: 1,
  last_message_id: 'msg-100',
  recipients: [createMockUser({ id: 'u1', username: 'Alice', avatar: 'avt1' })],
} as any;

const dmWithMultiRecipients = {
  id: 'dm-2',
  type: 1,
  last_message_id: 'msg-200',
  recipients: [
    createMockUser({ id: 'u2', username: 'Bob', avatar: null }),
    createMockUser({ id: 'u3', username: 'Charlie', avatar: null }),
  ],
} as any;

const dmWithNoRecipients = {
  id: 'dm-3',
  type: 1,
  last_message_id: null,
  recipients: [],
} as any;

describe('DMList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading spinner when DMs are loading', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [], selectedDm: null, selectedDms: [], isLoading: true, error: null },
        }),
      });
      expect(screen.queryByText('Loading DMs...')).not.toBeInTheDocument();
      const skeletons = document.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should show "No direct messages found" when no DMs exist and no token', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('No direct messages found')).toBeInTheDocument();
    });

    it('should show filter empty state when filter matches nothing', () => {
      renderWithProviders(<DMList filterText="nobody" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText(/No DMs matching "nobody"/)).toBeInTheDocument();
    });
  });

  describe('DM Rendering', () => {
    it('should render DM recipient usernames', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob, Charlie')).toBeInTheDocument();
    });

    it('should show "Direct Message" for DMs with no recipients', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithNoRecipients], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('Direct Message')).toBeInTheDocument();
    });

    it('should render "Direct Messages" header', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('Direct Messages')).toBeInTheDocument();
    });

    it('should render avatar with CDN URL when recipient has avatar', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', expect.stringContaining('cdn.discordapp.com'));
    });
  });

  describe('Filtering', () => {
    it('should filter DMs by recipient name', () => {
      renderWithProviders(<DMList filterText="Alice" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob, Charlie')).toBeNull();
    });

    it('should filter case-insensitively', () => {
      renderWithProviders(<DMList filterText="alice" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  describe('Selection', () => {
    it('should dispatch setSelectedDm when a DM is clicked', () => {
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByText('Alice'));
      expect(store.getState().dm.selectedDm?.id).toBe('dm-1');
    });

    it('should clear channel selection on DM click', () => {
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          channel: { channels: [], selectedChannel: createMockChannel(), selectedChannels: [], isLoading: false, error: null, forumThreads: [], forumFirstMessages: [], isLoadingForumThreads: false, hasMoreForumThreads: false, forumThreadsTotalResults: 0, forumThreadsNextOffset: 0, discoveredThreadsByChannel: {} },
          dm: { dms: [dmWithRecipient], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByText('Alice'));
      expect(store.getState().channel.selectedChannel).toBeNull();
    });

    it('should mark selected DM as selected', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: dmWithRecipient, selectedDms: [], isLoading: false, error: null },
        }),
      });
      const aliceButton = screen.getByText('Alice').closest('[role="button"]');
      expect(aliceButton).toHaveClass('Mui-selected');
    });
  });

  describe('Group DM distinction (#227)', () => {
    const groupDm = (over: Record<string, unknown>) =>
      ({
        id: 'g1',
        type: 3,
        name: null,
        last_message_id: null,
        recipients: [createMockUser({ id: 'u9', username: 'granddemon', global_name: 'GrandDemon', avatar: null })],
        ...over,
      }) as any;

    const renderWithDms = (dms: any[]) =>
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms, selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });

    it('marks a one-remaining-recipient group as a group, not a 1:1 DM', () => {
      renderWithDms([groupDm({})]);
      expect(screen.getByTestId('group-dm-indicator')).toHaveTextContent('Group · 2 members');
      // Groups never borrow the recipient's display name as the row title.
      expect(screen.queryByText('GrandDemon')).not.toBeInTheDocument();
      expect(screen.getByText('granddemon')).toBeInTheDocument();
    });

    it('shows the custom group name as the primary label when set', () => {
      renderWithDms([groupDm({ name: 'the lads' })]);
      expect(screen.getByText('the lads')).toBeInTheDocument();
    });

    it('labels an emptied group as "Group DM" with a member count of 1', () => {
      renderWithDms([groupDm({ recipients: [] })]);
      expect(screen.getByText('Group DM')).toBeInTheDocument();
      expect(screen.getByTestId('group-dm-indicator')).toHaveTextContent('Group · 1 member');
    });

    it('does not mark a 1:1 DM as a group', () => {
      renderWithDms([dmWithRecipient]);
      expect(screen.queryByTestId('group-dm-indicator')).not.toBeInTheDocument();
    });

    it('shows the members of a NAMED group as a secondary caption', () => {
      // The custom name is the primary label; without this caption the
      // member names would appear nowhere on the row.
      renderWithDms([groupDm({ name: 'the lads' })]);
      expect(screen.getByText('the lads')).toBeInTheDocument();
      expect(screen.getByText('granddemon')).toBeInTheDocument();
    });

    it('finds a NAMED group when filtering by a member name', () => {
      renderWithProviders(<DMList filterText="granddemon" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [groupDm({ name: 'the lads' })], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('the lads')).toBeInTheDocument();
    });

    it('finds a NAMED group when filtering by a member display name', () => {
      renderWithProviders(<DMList filterText="GrandDemon" />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [groupDm({ name: 'the lads' })], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('the lads')).toBeInTheDocument();
    });
  });

  describe('Shift+Click range select (#218)', () => {
    const mkDm = (id: string, name: string) =>
      ({
        id,
        type: 1,
        last_message_id: null,
        recipients: [createMockUser({ id: `u-${id}`, username: name, avatar: null })],
      }) as any;
    const dms = [mkDm('d1', 'alice'), mkDm('d2', 'bella'), mkDm('d3', 'carol'), mkDm('d4', 'dana')];

    const renderInMultiSelect = () => {
      const utils = renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms, selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      return utils;
    };

    it('selects the whole range between the anchor and a shift-clicked row', () => {
      const { store } = renderInMultiSelect();
      fireEvent.click(screen.getByText('alice'));
      fireEvent.click(screen.getByText('dana'), { shiftKey: true });
      const ids = store.getState().dm.selectedDms.map((d: any) => d.id).sort();
      expect(ids).toEqual(['d1', 'd2', 'd3', 'd4']);
    });

    it('selects a backwards range and unions with the existing selection', () => {
      const { store } = renderInMultiSelect();
      fireEvent.click(screen.getByText('dana'));   // toggle + anchor
      fireEvent.click(screen.getByText('bella'), { shiftKey: true }); // range b→d
      const ids = store.getState().dm.selectedDms.map((d: any) => d.id).sort();
      expect(ids).toEqual(['d2', 'd3', 'd4']);
    });
  });

  describe('Copy Names (multi-select toolbar)', () => {
    it('does not render the Copy button when nothing is selected', () => {
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.queryByTestId('multi-select-copy')).toBeNull();
    });

    it('copies only the selected DM recipient names when Copy is clicked in multi-select mode', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: null, selectedDms: [dmWithRecipient], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-copy'));
      // Only the selected DM ("Alice") makes it to the clipboard, not "Bob, Charlie"
      expect(writeText).toHaveBeenCalledWith('Alice');
    });

    it('dispatches a toast after copying selected DM names', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const { store } = renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dmWithRecipient, dmWithMultiRecipients], selectedDm: null, selectedDms: [dmWithRecipient], isLoading: false, error: null },
        }),
      });
      fireEvent.click(screen.getByLabelText('Toggle multi-select'));
      fireEvent.click(screen.getByTestId('multi-select-copy'));
      expect(store.getState().status.toast.isVisible).toBe(true);
      expect(store.getState().status.toast.message).toBe('Copied to clipboard');
    });
  });

  /**
   * Bug fix: the contextual tour's step 1 targets
   * `[data-tour="multi-select-toggle"]`. When the user lands in DM view
   * directly on cold boot, the ChannelList (which had the attribute) is
   * NOT rendered — without the same attribute on DMList's toggle, the
   * tour would fire with a missing target and leave an orphaned gray
   * overlay blocking all clicks.
   */
  describe('Tour target attribute', () => {
    it('multi-select toggle carries the data-tour attribute for Joyride', () => {
      const dm = createMockChannel({ id: 'dm-1', name: null, type: 1 });
      renderWithProviders(<DMList filterText="" />, {
        preloadedState: createBaseState({
          auth: { token: 't', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dm], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      const button = screen.getByLabelText('Toggle multi-select');
      expect(button.getAttribute('data-tour')).toBe('multi-select-toggle');
    });
  });

  /**
   * #135 hard requirement: the Multi-select toggle label stays
   * "Multi-select" in both states. State is conveyed by the button's
   * variant + icon swap, not by switching the text to "Done".
   */
  describe('Multi-select toggle label', () => {
    it('reads "Multi-select" both before and after enabling multi-select mode', () => {
      const dm = createMockChannel({ id: 'dm-1', name: null, type: 1 });
      renderWithProviders(<DMList filterText="" />, {
        preloadedState: createBaseState({
          auth: { token: 't', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [dm], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      const button = screen.getByLabelText('Toggle multi-select');
      expect(button).toHaveTextContent('Multi-select');
      fireEvent.click(button);
      expect(button).toHaveTextContent('Multi-select');
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
  });

  /**
   * #240: closed DM conversations (e.g. with a deleted account) are omitted
   * from GET /users/@me/channels, so the list can never show them. The
   * "Open DM by ID" affordance fetches such a channel directly by snowflake
   * (raw ID or pasted discord.com/channels/@me link), upserts it into the
   * session's DM list, and selects it.
   */
  describe('Open DM by ID (#240)', () => {
    // A closed 1:1 DM whose counterpart account was deleted: recipients
    // empty. The row must still render safely ("Direct Message" label,
    // '#' placeholder avatar).
    const closedDm = {
      id: '1029384756102938475',
      type: 1,
      last_message_id: null,
      recipients: [],
    } as any;

    const authedState = (dms: any[]) =>
      createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        dm: { dms, selectedDm: null, selectedDms: [], isLoading: false, error: null },
      });

    const mockService = (
      fetchChannel: ReturnType<typeof vi.fn>,
      createDm: ReturnType<typeof vi.fn> = vi.fn(),
    ) => {
      vi.mocked(getDiscordService).mockReturnValue({
        fetchChannel,
        createDm,
        fetchDirectMessages: vi.fn().mockResolvedValue({ success: true, data: [] }),
        fetchMessageData: vi.fn().mockResolvedValue({ success: true, data: [] }),
      } as any);
      return { fetchChannel, createDm };
    };

    it('renders the Open DM by ID button in the header', () => {
      renderWithProviders(<DMList />, { preloadedState: authedState([dmWithRecipient]) });
      expect(screen.getByTestId('open-dm-by-id-button')).toBeInTheDocument();
      expect(screen.getByLabelText('Open DM by ID')).toBeInTheDocument();
    });

    it('keeps the affordance reachable when the DM list is empty', () => {
      // The exact target user: every DM closed, list empty. token: null so
      // the mount-time fetchDMs does not flip the list into its skeleton.
      renderWithProviders(<DMList />, {
        preloadedState: createBaseState({
          auth: { token: null, isAuthenticated: false, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
          dm: { dms: [], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        }),
      });
      expect(screen.getByText('No direct messages found')).toBeInTheDocument();
      expect(screen.getByTestId('open-dm-by-id-button')).toBeInTheDocument();
    });

    it('opens a closed DM from a pasted URL, selects it, and lists it for the session', async () => {
      const { fetchChannel } = mockService(
        vi.fn().mockResolvedValue({ success: true, data: closedDm })
      );
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: 'https://discord.com/channels/@me/1029384756102938475' },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));

      await waitFor(() => {
        expect(store.getState().dm.selectedDm?.id).toBe('1029384756102938475');
      });
      expect(fetchChannel).toHaveBeenCalledWith('test-token', '1029384756102938475');

      // Upserted into the session's list and rendered safely despite the
      // empty recipients array (deleted account).
      expect(store.getState().dm.dms.some((d: any) => d.id === closedDm.id)).toBe(true);
      expect(screen.getByText('Direct Message')).toBeInTheDocument();

      // Status log INFO entry.
      expect(
        store.getState().status.entries.some(
          (e: any) => e.message === 'Opened DM channel 1029384756102938475 by ID'
        )
      ).toBe(true);

      // Dialog closes on success.
      await waitFor(() => {
        expect(screen.queryByTestId('open-dm-by-id-input')).not.toBeInTheDocument();
      });
    });

    it('accepts a raw snowflake as input', async () => {
      const { fetchChannel } = mockService(
        vi.fn().mockResolvedValue({ success: true, data: closedDm })
      );
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: '1029384756102938475' },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));

      await waitFor(() => {
        expect(store.getState().dm.selectedDm?.id).toBe('1029384756102938475');
      });
      expect(fetchChannel).toHaveBeenCalledWith('test-token', '1029384756102938475');
    });

    it('shows an inline error and stays open when the channel cannot be fetched', async () => {
      mockService(vi.fn().mockRejectedValue(new Error('Request failed: 404 Not Found')));
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: '1029384756102938475' },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));

      expect(
        await screen.findByText(/Couldn't open that channel/)
      ).toBeInTheDocument();
      // Dialog stays open, nothing selected, list untouched.
      expect(screen.getByTestId('open-dm-by-id-input')).toBeInTheDocument();
      expect(store.getState().dm.selectedDm).toBeNull();
      expect(store.getState().dm.dms).toHaveLength(1);
    });

    // #242: the thunk's distinguishable rejection payloads must reach the
    // dialog as distinct guidance, not the one generic line.
    const submitId = (id: string) => {
      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: id },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));
    };

    it('shows the missing-access message on a 403', async () => {
      mockService(vi.fn().mockResolvedValue({ success: false, status: 403 }));
      renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      submitId('1029384756102938475');
      expect(
        await screen.findByText(/Discord refused access to that channel/)
      ).toBeInTheDocument();
      expect(screen.getByTestId('open-dm-by-id-input')).toBeInTheDocument();
    });

    it('shows the no-such-channel message on a 404', async () => {
      mockService(vi.fn().mockResolvedValue({ success: false, status: 404 }));
      renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      submitId('1029384756102938475');
      expect(
        await screen.findByText(/Discord has no channel with that ID/)
      ).toBeInTheDocument();
      expect(screen.getByTestId('open-dm-by-id-input')).toBeInTheDocument();
    });

    it('shows the not-a-DM message for a guild channel ID', async () => {
      mockService(
        vi.fn().mockResolvedValue({
          success: true,
          data: { id: '1029384756102938475', type: 0, name: 'general' },
        })
      );
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      submitId('1029384756102938475');
      expect(
        await screen.findByText(/belongs to a server channel, not a DM/)
      ).toBeInTheDocument();
      // The guild channel must not sneak into the DM list either.
      expect(store.getState().dm.dms).toHaveLength(1);
    });

    // #223 Facet B: user-id mode resolves the person's DM channel through
    // createDm and rides the identical select-and-load path.
    const submitUserId = (id: string) => {
      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.click(screen.getByTestId('open-dm-by-id-mode-user'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: id },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));
    };

    it('opens a DM by user ID in user mode, selecting the resolved channel', async () => {
      const { createDm } = mockService(
        vi.fn(),
        vi.fn().mockResolvedValue({ success: true, data: closedDm })
      );
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      submitUserId('999888777666555444');
      await waitFor(() => {
        expect(store.getState().dm.selectedDm?.id).toBe(closedDm.id);
      });
      expect(createDm).toHaveBeenCalledWith('test-token', '999888777666555444');
    });

    it('shows the cannot-open guidance when Discord rejects the recipient', async () => {
      mockService(vi.fn(), vi.fn().mockResolvedValue({ success: false, status: 400 }));
      renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      submitUserId('999888777666555444');
      expect(
        await screen.findByText(/deleted accounts can't be messaged/)
      ).toBeInTheDocument();
      expect(screen.getByTestId('open-dm-by-id-input')).toBeInTheDocument();
    });

    it('rejects unparseable input locally in user mode with the user-flavored message', () => {
      const { createDm } = mockService(vi.fn(), vi.fn());
      renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      submitUserId('not-a-user-id');
      expect(
        screen.getByText('Enter a 17-20 digit user ID or a discord.com/users link.')
      ).toBeInTheDocument();
      expect(createDm).not.toHaveBeenCalled();
    });

    it('resets to channel mode when the dialog is cancelled', () => {
      mockService(vi.fn(), vi.fn());
      renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      // Switch to user mode, cancel, reopen — the toggle must be back on
      // channel mode (aria-pressed reflects MUI ToggleButton selection).
      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.click(screen.getByTestId('open-dm-by-id-mode-user'));
      expect(screen.getByTestId('open-dm-by-id-mode-user')).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByText('Cancel'));

      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      expect(screen.getByTestId('open-dm-by-id-mode-channel')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('open-dm-by-id-mode-user')).toHaveAttribute('aria-pressed', 'false');
    });

    it('auto-switches to user mode when a discord.com/users link is pasted', async () => {
      const { createDm } = mockService(
        vi.fn(),
        vi.fn().mockResolvedValue({ success: true, data: closedDm })
      );
      const { store } = renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      // No toggle click — the pasted profile URL should flip the mode.
      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: 'https://discord.com/users/999888777666555444' },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));

      await waitFor(() => {
        expect(store.getState().dm.selectedDm?.id).toBe(closedDm.id);
      });
      expect(createDm).toHaveBeenCalledWith('test-token', '999888777666555444');
    });

    it('rejects unparseable input client-side without calling the API', async () => {
      const { fetchChannel } = mockService(vi.fn());
      renderWithProviders(<DMList />, {
        preloadedState: authedState([dmWithRecipient]),
      });

      fireEvent.click(screen.getByTestId('open-dm-by-id-button'));
      fireEvent.change(screen.getByTestId('open-dm-by-id-input'), {
        target: { value: 'not-a-channel-id' },
      });
      fireEvent.click(screen.getByTestId('open-dm-by-id-confirm'));

      expect(
        await screen.findByText(/Enter a 17-20 digit channel ID/)
      ).toBeInTheDocument();
      expect(fetchChannel).not.toHaveBeenCalled();
    });
  });

  describe('DM sort order (#248)', () => {
    // Snowflake for a given ms timestamp: (ms - epoch) << 22.
    const snowflakeAt = (ms: number) =>
      ((BigInt(ms) - 1420070400000n) << 22n).toString();

    const oldDm = {
      id: 'dm-old',
      type: 1,
      last_message_id: snowflakeAt(Date.UTC(2023, 0, 1)),
      recipients: [createMockUser({ id: 'u-z', username: 'Zoe' })],
    } as any;
    const newDm = {
      id: 'dm-new',
      type: 1,
      last_message_id: snowflakeAt(Date.UTC(2025, 0, 1)),
      recipients: [createMockUser({ id: 'u-m', username: 'Mia' })],
    } as any;
    const silentDm = {
      id: 'dm-silent',
      type: 1,
      last_message_id: null,
      recipients: [createMockUser({ id: 'u-a', username: 'Ann' })],
    } as any;

    const stateWithOrder = (order?: DmSortOrder) =>
      createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        dm: { dms: [silentDm, oldDm, newDm], selectedDm: null, selectedDms: [], isLoading: false, error: null },
        ...(order
          ? {
              app: {
                ...createBaseState().app,
                settings: {
                  ...createBaseState().app.settings!,
                  [DiscrubSetting.APP_DM_SORT_ORDER]: order,
                },
              },
            }
          : {}),
      });

    const renderedNames = () =>
      Array.from(document.querySelectorAll('.MuiListItemText-primary')).map(
        (el) => el.textContent,
      );

    it('defaults to recent activity: newest first, silent DMs last', () => {
      renderWithProviders(<DMList />, { preloadedState: stateWithOrder() });
      expect(renderedNames()).toEqual(['Mia', 'Zoe', 'Ann']);
    });

    it('sorts alphabetically when set to name', () => {
      renderWithProviders(<DMList />, {
        preloadedState: stateWithOrder(DmSortOrder.NAME),
      });
      expect(renderedNames()).toEqual(['Ann', 'Mia', 'Zoe']);
    });

    it("keeps the API's order when set to discord", () => {
      renderWithProviders(<DMList />, {
        preloadedState: stateWithOrder(DmSortOrder.DISCORD),
      });
      expect(renderedNames()).toEqual(['Ann', 'Zoe', 'Mia']);
    });

    it('keeps the chosen order while filtering', () => {
      renderWithProviders(<DMList filterText="o" />, {
        preloadedState: stateWithOrder(DmSortOrder.NAME),
      });
      // "o" matches Zoe only.
      expect(renderedNames()).toEqual(['Zoe']);
    });
  });

  describe('paging past the first 50 rows', () => {
    const manyDms = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `dm-${i}`,
        type: 1,
        last_message_id: null,
        recipients: [createMockUser({ id: `u-${i}`, username: `person${i}`, avatar: null })],
      })) as any[];

    const stateWithDms = (dms: any[]) =>
      createBaseState({
        auth: { token: 'test-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
        dm: { dms, selectedDm: null, selectedDms: [], isLoading: false, error: null },
      });

    let observe: ReturnType<typeof vi.fn>;
    let intersect: () => void;

    beforeEach(() => {
      let callback: IntersectionObserverCallback = () => {};
      observe = vi.fn();
      intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      vi.stubGlobal('IntersectionObserver', class {
        constructor(cb: IntersectionObserverCallback) { callback = cb; }
        observe = observe;
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = () => [];
      });
    });

    it('draws more rows each time the sentinel scrolls into view', async () => {
      renderWithProviders(<DMList />, { preloadedState: stateWithDms(manyDms(120)) });
      expect(screen.getAllByTestId('dm-row')).toHaveLength(50);
      expect(observe).toHaveBeenCalledWith(screen.getByTestId('dm-list-sentinel'));

      intersect();
      await waitFor(() => expect(screen.getAllByTestId('dm-row')).toHaveLength(100));

      intersect();
      await waitFor(() => expect(screen.getAllByTestId('dm-row')).toHaveLength(120));
      expect(screen.queryByTestId('dm-list-sentinel')).not.toBeInTheDocument();
    });

    it('needs no sentinel when the list fits in one page', () => {
      renderWithProviders(<DMList />, { preloadedState: stateWithDms(manyDms(12)) });
      expect(screen.getAllByTestId('dm-row')).toHaveLength(12);
      expect(screen.queryByTestId('dm-list-sentinel')).not.toBeInTheDocument();
    });
  });
});
