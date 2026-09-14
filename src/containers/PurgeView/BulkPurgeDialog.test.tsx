import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import BulkPurgeDialog from './BulkPurgeDialog';
import type { Channel, Guild } from 'discrub-core/types/discord-types';
import { ChannelType } from 'discrub-core/discord-enum';
import { createAuthenticatedState } from '@/test/state-factories';
import { bulkPurgeChannels, bulkPurgeDMs, purgeGuilds } from '@features/purge/purgeSlice';

// Permission bits for crafting test guild states
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const MANAGE_MESSAGES = 1n << 13n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const PERMS_WITH_MANAGE = String(VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES | READ_MESSAGE_HISTORY);
const PERMS_NO_MANAGE = String(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY);

vi.mock('@features/purge/purgeSlice', async () => {
  const actual = await vi.importActual('@features/purge/purgeSlice');
  return {
    ...actual,
    bulkPurgeChannels: vi.fn(() => ({ type: 'purge/bulkPurgeChannels/mock' })),
    bulkPurgeDMs: vi.fn(() => ({ type: 'purge/bulkPurgeDMs/mock' })),
    purgeGuilds: vi.fn(() => ({ type: 'purge/purgeGuilds/mock' })),
  };
});

const mockChannels: Channel[] = [
  { id: '1', name: 'general', type: ChannelType.GUILD_TEXT } as Channel,
  { id: '2', name: 'random', type: ChannelType.GUILD_TEXT } as Channel,
  { id: '3', name: 'dev-chat', type: ChannelType.GUILD_TEXT } as Channel,
];

const mockDms: Channel[] = [
  { id: '10', type: 4, recipients: [{ id: '100', username: 'Alice' }] } as unknown as Channel,
  { id: '11', type: 4, recipients: [{ id: '101', username: 'Bob' }] } as unknown as Channel,
];

const baseAuthed = createAuthenticatedState();
const guildWithManage: Guild = {
  ...(baseAuthed.guild.selectedGuild as Guild),
  permissions: PERMS_WITH_MANAGE,
};

const stateWithUser = {
  ...baseAuthed,
  guild: {
    ...baseAuthed.guild,
    guilds: [guildWithManage],
    selectedGuild: guildWithManage,
  },
  user: {
    currentUser: { id: '999', username: 'testuser', discriminator: '0', global_name: 'Test User', avatar: null },
    isLoading: false,
    error: null,
  },
  cache: {
    isLoaded: true,
    userMap: {
      '999': { userName: 'testuser', displayName: 'Test User', avatar: null, guilds: {}, timestamp: 1 },
      '888': { userName: 'otheruser', displayName: 'Other User', avatar: null, guilds: {}, timestamp: 1 },
    },
    failedUserIds: [],
  },
};

// Same shape as stateWithUser, but the selected guild lacks MANAGE_MESSAGES.
// Used by #139 lock-path tests to verify the dialog gates target picking when
// the user can't manage messages in any of the selected channels.
const guildNoManage: Guild = {
  ...(baseAuthed.guild.selectedGuild as Guild),
  permissions: PERMS_NO_MANAGE,
};
const stateWithUserNoManage = {
  ...stateWithUser,
  guild: {
    ...stateWithUser.guild,
    guilds: [guildNoManage],
    selectedGuild: guildNoManage,
  },
};

describe('BulkPurgeDialog', () => {
  describe('Channel mode', () => {
    it('carries the long-run risk note (#124 slot D)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByTestId('long-run-note')).toHaveTextContent('Long runs send many requests from your account.');
    });

    it('says why the confirm button is off until an author is picked, and says nothing once it is on', () => {
      const { unmount } = renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByTestId('purge-disabled-hint')).toHaveTextContent('Open Filters above and pick whose messages to purge.');
      unmount();
      // DM mode targets the signed in user, so the button is on and there is nothing to explain.
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.queryByTestId('purge-disabled-hint')).not.toBeInTheDocument();
    });

    it('renders dialog title with channel count', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('Purge Channels')).toBeInTheDocument();
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('renders compact channel summary with first names + "more" suffix', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      // Summary pill shows count + first few names inline
      expect(screen.getByText('3 channels')).toBeInTheDocument();
      expect(screen.getByText(/# general.*# random.*# dev-chat/)).toBeInTheDocument();
    });

    it('expands channel list when summary is clicked', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Selected channels' }));
      expect(screen.getByText('# general')).toBeInTheDocument();
      expect(screen.getByText('# random')).toBeInTheDocument();
      expect(screen.getByText('# dev-chat')).toBeInTheDocument();
    });

    it('shows +N suffix when there are more than 3 channels', () => {
      const manyChannels = [
        ...mockChannels,
        { id: '4', name: 'support', type: ChannelType.GUILD_TEXT } as Channel,
        { id: '5', name: 'news', type: ChannelType.GUILD_TEXT } as Channel,
      ];
      renderWithProviders(
        <BulkPurgeDialog open channels={manyChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
    });

    it('defaults to Messages mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Attachments Only' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Reactions' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows all 4 mode buttons when canManageMessages is true', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByRole('button', { name: 'Messages' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Attachments Only' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reactions' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear All Reactions' })).toBeInTheDocument();
    });

    it('hides Clear All Reactions without canManageMessages but still shows Attachments Only', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByRole('button', { name: 'Attachments Only' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clear All Reactions' })).not.toBeInTheDocument();
    });

    it('shows Target messages section with Add filters affordance in Messages mode (#112)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('Target messages')).toBeInTheDocument();
      // Guild Messages mode: filter modal replaces the old top-level
      // author picker — the button is the entry point.
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
    });

    it('does not pre-select any user', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      // No user chips should be shown initially
      expect(screen.queryByText('Test User (You)')).not.toBeInTheDocument();
    });

    it('shows filter-modal helper text in Messages mode for server context', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      // The filter modal replaces the old picker and owns the guidance.
      expect(screen.getByText(/Open filters to pick the target author/)).toBeInTheDocument();
    });

    it('shows Retain-media checkbox only in Messages mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByLabelText('Clear text, keep attachments')).toBeInTheDocument();
    });

    it('hides Retain-media checkbox when Attachments Only mode is selected', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));
      expect(screen.queryByLabelText('Clear text, keep attachments')).not.toBeInTheDocument();
    });

    it('does NOT render old "Advanced Options" or "Delete attachments only" UI', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.queryByText('Advanced Options')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Delete attachments only')).not.toBeInTheDocument();
    });

    it('switches to Reactions mode — top-level reactor picker returns, filter modal exits', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      // Reactions keeps its top-level picker (reactor semantic ≠ author).
      // The Add-filters button is now also exposed for optional message-
      // narrowing (orthogonal to the reactor picker) — see issue trailer
      // "Reactions: unchanged — keeps its own picker … Deferred: adding
      //  optional message-narrowing filters to Reactions mode".
      expect(screen.getByText('Remove reactions from')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Clear text, keep attachments')).not.toBeInTheDocument();
    });

    it('hides Target section but still exposes filters in Clear All Reactions mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Clear All Reactions' }));
      expect(screen.queryByText('Target messages')).not.toBeInTheDocument();
      // No reactor picker — but filters stay available for message-narrowing
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
    });

    it('shows irreversible warning', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('This action is irreversible.')).toBeInTheDocument();
    });

    it('shows correct summary text for Messages mode with no users selected', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText(/3 channels will be purged. Messages from 0 users will be permanently deleted/)).toBeInTheDocument();
    });

    it('shows correct summary text for Attachments Only mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));
      expect(screen.getByText(/Attachments will be stripped.*Message text is preserved/)).toBeInTheDocument();
    });

    it('shows correct summary text for Reactions mode without MANAGE (self-locked)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      // Without MANAGE_MESSAGES the target is locked to the current user (1).
      expect(screen.getByText(/Reactions from 1 user will be removed across 3 channels/)).toBeInTheDocument();
    });

    it('confirm button shows channel count', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByRole('button', { name: /Purge 3 Ch\.s/ })).toBeInTheDocument();
    });

    it('confirm button shows "Strip Attachments" label in Attachments Only mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));
      expect(screen.getByRole('button', { name: /Strip Attachments \(3 Ch\.s\)/ })).toBeInTheDocument();
    });

    it('calls onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={onClose} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('disables confirm button when no users are selected in Messages mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByRole('button', { name: /Purge 3 Ch\.s/ })).toBeDisabled();
    });
  });

  describe('DM mode', () => {
    it('renders dialog title for DMs', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('Purge DMs')).toBeInTheDocument();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('shows compact DM summary without # prefix', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('2 conversations')).toBeInTheDocument();
      expect(screen.getByText(/Alice.*Bob/)).toBeInTheDocument();
    });

    it('shows DM restriction info in Messages mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('You can only target your own messages in DMs.')).toBeInTheDocument();
    });

    it('uses "conversation" terminology in summary', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText(/2 conversations will be purged/)).toBeInTheDocument();
    });

    it('confirm button shows DM count', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByRole('button', { name: /Purge 2 DMs/ })).toBeInTheDocument();
    });

    it('locks UserPicker in DM messages mode (no autocomplete input)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      // Disabled UserPicker hides the combobox
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('locks UserPicker to current user in DM reactions mode (no MANAGE_MESSAGES)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      expect(screen.getByText(/only remove your own reactions/)).toBeInTheDocument();
    });
  });

  describe('Single channel', () => {
    it('uses singular terminology for 1 channel', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={[mockChannels[0]]} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText(/1 channel will be purged/)).toBeInTheDocument();
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
  });

  describe('Not rendered when closed', () => {
    it('does not render content when open is false', () => {
      renderWithProviders(
        <BulkPurgeDialog open={false} channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.queryByText('Purge Channels')).not.toBeInTheDocument();
    });
  });

  describe('Dispatch wiring', () => {
    beforeEach(() => {
      vi.mocked(bulkPurgeChannels).mockClear();
      vi.mocked(bulkPurgeDMs).mockClear();
    });

    it('dispatches bulkPurgeChannels with Reactions config when confirmed', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );

      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));

      // Open the autocomplete and select the current user
      const input = screen.getByRole('combobox');
      fireEvent.mouseDown(input);

      const options = screen.getAllByRole('option');
      fireEvent.click(options[0]);

      const confirmButton = screen.getByRole('button', { name: /Remove Reactions/ });
      expect(confirmButton).not.toBeDisabled();
      fireEvent.click(confirmButton);

      expect(bulkPurgeChannels).toHaveBeenCalledTimes(1);
      expect(bulkPurgeChannels).toHaveBeenCalledWith({
        channels: mockChannels,
        config: {
          mode: 'reactions',
          targetUserIds: ['999'],
          retainAttachedMedia: false,
          preserveMediaAndLinks: false,
          deleteAttachmentsOnly: false,
          systemMessageTypesToDelete: [],
          skipArchivedThreads: false,
        },
        guildId: 'g1',
        // Reactions mode doesn't narrow messages via FilterModal (yet).
        searchCriteria: null,
      });
      expect(bulkPurgeDMs).not.toHaveBeenCalled();
    });

    it('dispatches bulkPurgeDMs when confirm is clicked in DM messages mode', () => {
      const onClose = vi.fn();
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={onClose} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      const confirmButton = screen.getByRole('button', { name: /Purge 2 DMs/ });
      expect(confirmButton).not.toBeDisabled();
      fireEvent.click(confirmButton);

      expect(bulkPurgeDMs).toHaveBeenCalledTimes(1);
      expect(bulkPurgeDMs).toHaveBeenCalledWith({
        channels: mockDms,
        config: {
          mode: 'messages',
          targetUserIds: ['999'],
          retainAttachedMedia: false,
          preserveMediaAndLinks: false,
          deleteAttachmentsOnly: false,
          systemMessageTypesToDelete: [],
          skipArchivedThreads: false,
        },
        // DM messages mode exposes the optional filter row but sends null
        // when the user hasn't opened/applied it.
        searchCriteria: null,
      });
      expect(bulkPurgeChannels).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('dispatches Attachments Only mode as {mode: messages, deleteAttachmentsOnly: true}', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));

      const confirmButton = screen.getByRole('button', { name: /Strip Attachments \(2 DMs\)/ });
      expect(confirmButton).not.toBeDisabled();
      fireEvent.click(confirmButton);

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            mode: 'messages',
            retainAttachedMedia: false,
            deleteAttachmentsOnly: true,
          }),
        }),
      );
    });

    it('dispatches Messages mode with retainAttachedMedia when the checkbox is toggled', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      fireEvent.click(screen.getByLabelText('Clear text, keep attachments'));
      const confirmButton = screen.getByRole('button', { name: /Purge 2 DMs/ });
      fireEvent.click(confirmButton);

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            mode: 'messages',
            retainAttachedMedia: true,
            deleteAttachmentsOnly: false,
          }),
        }),
      );
    });

    it('dispatches Clear All Reactions config', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );

      fireEvent.click(screen.getByRole('button', { name: 'Clear All Reactions' }));

      const confirmButton = screen.getByRole('button', { name: /Clear Reactions/ });
      expect(confirmButton).not.toBeDisabled();
      fireEvent.click(confirmButton);

      expect(bulkPurgeChannels).toHaveBeenCalledWith({
        channels: mockChannels,
        config: {
          mode: 'clearReactions',
          targetUserIds: [],
          retainAttachedMedia: false,
          preserveMediaAndLinks: false,
          deleteAttachmentsOnly: false,
          systemMessageTypesToDelete: [],
          skipArchivedThreads: false,
        },
        guildId: 'g1',
        searchCriteria: null,
      });
    });

    it('#239: dispatches preserveMediaAndLinks: true when the keep-files-links checkbox is toggled', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      fireEvent.click(screen.getByLabelText('Keep messages with files or links'));
      fireEvent.click(screen.getByRole('button', { name: /Purge 2 DMs/ }));

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            mode: 'messages',
            preserveMediaAndLinks: true,
          }),
        }),
      );
    });

    it('#239: hides the keep-files-links checkbox outside Messages mode and forces the flag off', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      // Check it in Messages mode, then switch modes — the dispatched
      // config must still carry false (mode gating mirrors retain-media).
      fireEvent.click(screen.getByLabelText('Keep messages with files or links'));
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));

      expect(screen.queryByLabelText('Keep messages with files or links')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Strip Attachments \(2 DMs\)/ }));
      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            deleteAttachmentsOnly: true,
            preserveMediaAndLinks: false,
          }),
        }),
      );
    });

    it('#239: checkbox can be combined with retain-media (both dispatched true)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      fireEvent.click(screen.getByLabelText('Clear text, keep attachments'));
      fireEvent.click(screen.getByLabelText('Keep messages with files or links'));
      fireEvent.click(screen.getByRole('button', { name: /Purge 2 DMs/ }));

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            retainAttachedMedia: true,
            preserveMediaAndLinks: true,
          }),
        }),
      );
    });

    it("#233: dispatches skipArchivedThreads: true when the don't-wake checkbox is toggled (guild mode)", () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );

      // Clear All Reactions needs no targeting, so confirm is always enabled.
      fireEvent.click(screen.getByRole('button', { name: 'Clear All Reactions' }));
      fireEvent.click(screen.getByLabelText("Don't wake archived threads"));
      fireEvent.click(screen.getByRole('button', { name: /Clear Reactions/ }));

      expect(bulkPurgeChannels).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ skipArchivedThreads: true }),
        }),
      );
    });

    it('#233: hides the archived-threads checkbox in DM mode (DMs have no threads)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );

      expect(screen.queryByLabelText("Don't wake archived threads")).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Purge 2 DMs/ }));
      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ skipArchivedThreads: false }),
        }),
      );
    });

    it('does not export PurgeMode from BulkPurgeDialog (only default export)', async () => {
      const bulkPurgeDialogExports = await import('./BulkPurgeDialog');
      const exportKeys = Object.keys(bulkPurgeDialogExports).filter((k) => k !== 'default');
      expect(exportKeys).not.toContain('PurgeMode');
    });

    it('keeps confirm button disabled in guild Messages mode until filters set an author (#112)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      // With no filter applied the target is empty → purge disabled.
      expect(screen.getByRole('button', { name: /Purge 3 Ch\.s/ })).toBeDisabled();
      // Filter modal button is the entry point for setting targets.
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
    });
  });

  describe('Reactions mode permission enforcement', () => {
    it('shows unrestricted UserPicker in Reactions mode with canManageMessages', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      expect(screen.getByText('Remove reactions from')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    it('shows locked UserPicker in Reactions mode without canManageMessages', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      expect(screen.getByText(/only remove your own reactions/)).toBeInTheDocument();
    });

    it('dispatches with current user ID in Reactions mode without canManageMessages', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      const confirmButton = screen.getByRole('button', { name: /Remove Reactions/ });
      fireEvent.click(confirmButton);
      expect(bulkPurgeChannels).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            mode: 'reactions',
            targetUserIds: ['999'],
          }),
        }),
      );
    });
  });

  describe('Clear All Reactions mode (MANAGE_MESSAGES)', () => {
    it('confirm button is enabled without user selection in clearReactions mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Clear All Reactions' }));
      expect(screen.getByRole('button', { name: /Clear Reactions/ })).not.toBeDisabled();
    });

    it('summary text reflects Clear All Reactions mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Clear All Reactions' }));
      expect(screen.getByText(/All reactions will be removed from every message/)).toBeInTheDocument();
    });
  });

  describe('FilterModal hideAuthorFilters wiring (Backlog #137)', () => {
    const openFilters = () => fireEvent.click(screen.getByRole('button', { name: 'Add filters' }));

    it('hides Search From + Author Type when DM mode is in Messages family', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" guildId={null} />,
        { preloadedState: stateWithUser },
      );
      // Default uiMode for DM is "messages" — target is locked to self,
      // so the FilterModal opens with author fields hidden.
      openFilters();
      expect(screen.queryByTestId('filter-modal-search-from')).toBeNull();
      expect(screen.queryByTestId('filter-modal-search-author-type')).toBeNull();
    });

    it('hides Search From + Author Type when DM mode is Attachments Only', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" guildId={null} />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));
      openFilters();
      expect(screen.queryByTestId('filter-modal-search-from')).toBeNull();
      expect(screen.queryByTestId('filter-modal-search-author-type')).toBeNull();
    });

    it('KEEPS Search From + Author Type visible in DM Reactions mode (regression guard)', () => {
      // Critical: in DM Reactions, the reactor is locked but the
      // message-author filter is independent. Hiding From here would
      // silently break the "remove my reactions only from the other
      // person's messages" workflow.
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" guildId={null} />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      openFilters();
      expect(screen.getByTestId('filter-modal-search-from')).toBeInTheDocument();
      expect(screen.getByTestId('filter-modal-search-author-type')).toBeInTheDocument();
    });

    it('keeps Search From + Author Type visible in any guild mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="g1" canManageMessages />,
        { preloadedState: stateWithUser },
      );
      // Guild Messages — author isn't locked.
      openFilters();
      expect(screen.getByTestId('filter-modal-search-from')).toBeInTheDocument();
      expect(screen.getByTestId('filter-modal-search-author-type')).toBeInTheDocument();
    });
  });

  describe('Guild permission gating (Backlog #139)', () => {
    // Channels constructed to deny MANAGE_MESSAGES to @everyone in a subset
    const denyManage = String(MANAGE_MESSAGES);
    const blockedStaff: Channel = {
      id: '101',
      name: 'staff-only',
      type: ChannelType.GUILD_TEXT,
      permission_overwrites: [
        { id: 'guild-123', type: 0, allow: '0', deny: denyManage },
      ],
    } as unknown as Channel;
    const blockedArchived: Channel = {
      id: '102',
      name: 'archived',
      type: ChannelType.GUILD_TEXT,
      permission_overwrites: [
        { id: 'guild-123', type: 0, allow: '0', deny: denyManage },
      ],
    } as unknown as Channel;
    const allowed: Channel = { id: '103', name: 'general', type: ChannelType.GUILD_TEXT } as Channel;

    it('locks target picker when no selected channel has MANAGE_MESSAGES (all-blocked copy)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUserNoManage },
      );
      expect(
        screen.getByText('You can only target your own messages without Manage Messages permission in the selected channels.'),
      ).toBeInTheDocument();
      // Auto-targets self → confirm enabled even with no filters set
      expect(screen.getByRole('button', { name: /Purge 3 Ch\.s/ })).not.toBeDisabled();
    });

    it('locks target picker when MANAGE missing in some selected channels and lists names', () => {
      renderWithProviders(
        <BulkPurgeDialog
          open
          channels={[allowed, blockedStaff, blockedArchived]}
          onClose={vi.fn()}
          mode="channels"
          guildId="guild-123"
        />,
        { preloadedState: stateWithUser },
      );
      expect(
        screen.getByText(/Manage Messages missing in #staff-only, #archived\. Deselect to unlock\./),
      ).toBeInTheDocument();
    });

    it('switches to "N selected channels" wording when more than 2 channels are blocked', () => {
      const extra: Channel = {
        id: '104',
        name: 'private',
        type: ChannelType.GUILD_TEXT,
        permission_overwrites: [
          { id: 'guild-123', type: 0, allow: '0', deny: denyManage },
        ],
      } as unknown as Channel;
      renderWithProviders(
        <BulkPurgeDialog
          open
          channels={[allowed, blockedStaff, blockedArchived, extra]}
          onClose={vi.fn()}
          mode="channels"
          guildId="guild-123"
        />,
        { preloadedState: stateWithUser },
      );
      expect(
        screen.getByText(/Manage Messages missing in 3 of the selected channels\./),
      ).toBeInTheDocument();
    });

    it('does not lock when every selected channel grants MANAGE_MESSAGES', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUser },
      );
      // No lock copy, BulkFilterButton is the target surface
      expect(screen.queryByText(/Manage Messages missing/)).not.toBeInTheDocument();
      expect(screen.queryByText(/without Manage Messages permission/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
    });

    // #205/#217: a channel where the user holds Manage Messages ONLY via a
    // member-specific overwrite (type 1) — e.g. a Ticket Tool channel — must
    // NOT be flagged as blocked. Regression guard for threading currentUserId
    // through guildPermissionAudit (BulkPurgeDialog.tsx:155). The guild here
    // lacks MANAGE, so the member grant is the sole source of the permission:
    // without the currentUserId arg the channel falsely reads as blocked.
    it('does not lock a channel granted MANAGE via a member overwrite (#205/#217)', () => {
      const memberGranted: Channel = {
        id: '105',
        name: 'ticket-1234',
        type: ChannelType.GUILD_TEXT,
        permission_overwrites: [
          { id: 'guild-123', type: 0, allow: '0', deny: denyManage }, // @everyone deny
          { id: '999', type: 1, allow: denyManage, deny: '0' },        // member grant to current user (id 999)
        ],
      } as unknown as Channel;
      renderWithProviders(
        <BulkPurgeDialog open channels={[memberGranted]} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUserNoManage },
      );
      expect(screen.queryByText(/Manage Messages missing/)).not.toBeInTheDocument();
      expect(screen.queryByText(/without Manage Messages permission/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
    });

    it('hides FilterModal author surface when locked by permission', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUserNoManage },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add filters' }));
      expect(screen.queryByTestId('filter-modal-search-from')).toBeNull();
      expect(screen.queryByTestId('filter-modal-search-author-type')).toBeNull();
    });

    it('dispatches with current user as target when locked by permission', () => {
      vi.mocked(bulkPurgeChannels).mockClear();
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUserNoManage },
      );
      fireEvent.click(screen.getByRole('button', { name: /Purge 3 Ch\.s/ }));
      expect(bulkPurgeChannels).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            mode: 'messages',
            targetUserIds: ['999'],
          }),
        }),
      );
    });

    it('does not lock when channels prop is empty (allBlocked is false on empty list)', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={[]} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUserNoManage },
      );
      expect(screen.queryByText(/without Manage Messages permission/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Manage Messages missing/)).not.toBeInTheDocument();
    });

    it('does not surface the new permission lock in Reactions mode (regression guard)', () => {
      // Reactions mode has its own self-lock semantics gated on the
      // canManageMessages prop. The new isMessagesFamily-scoped check
      // must not bleed into reactions copy.
      renderWithProviders(
        <BulkPurgeDialog open channels={mockChannels} onClose={vi.fn()} mode="channels" guildId="guild-123" />,
        { preloadedState: stateWithUserNoManage },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      // The reactions-mode self-lock string is shown, NOT the messages-mode one
      expect(screen.getByText(/only remove your own reactions/)).toBeInTheDocument();
      expect(screen.queryByText(/target your own messages/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Manage Messages missing/)).not.toBeInTheDocument();
    });

    it('recomputes the audit when channels prop changes', () => {
      const { rerender } = renderWithProviders(
        <BulkPurgeDialog
          open
          channels={[allowed]}
          onClose={vi.fn()}
          mode="channels"
          guildId="guild-123"
        />,
        { preloadedState: stateWithUser },
      );
      // Single allowed channel — no lock
      expect(screen.queryByText(/Manage Messages missing/)).not.toBeInTheDocument();

      // Adding a blocked channel should trigger the lock copy
      rerender(
        <BulkPurgeDialog
          open
          channels={[allowed, blockedStaff]}
          onClose={vi.fn()}
          mode="channels"
          guildId="guild-123"
        />,
      );
      expect(
        screen.getByText(/Manage Messages missing in #staff-only\. Deselect to unlock\./),
      ).toBeInTheDocument();
    });
  });

  describe('Delete system messages section (Backlog #196 Phase 2)', () => {
    it('renders the section in Messages mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      expect(screen.getByText('Also delete system messages')).toBeInTheDocument();
    });

    it('spells out in the summary that system messages are an addition, not the only target', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      // With nothing selected the summary stays clean — no system clause.
      expect(screen.queryByText(/will also be deleted/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Also delete system messages'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Pin notifications' }));

      // Once a type is checked the summary reinforces the AND relationship.
      expect(
        screen.getByText(
          /The 1 selected system-message type will also be deleted; all other system notices stay in place/,
        ),
      ).toBeInTheDocument();
    });

    it('hides the section in Attachments Only mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));
      expect(screen.queryByText('Also delete system messages')).not.toBeInTheDocument();
    });

    it('hides the section in Reactions mode', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
      expect(screen.queryByText('Also delete system messages')).not.toBeInTheDocument();
    });

    it('threads a checked group\'s MessageType values into the dispatched config', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByText('Also delete system messages'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Pin notifications' }));

      fireEvent.click(screen.getByRole('button', { name: /Purge 2 DMs/ }));

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            // CHANNEL_PINNED_MESSAGE = "6"
            systemMessageTypesToDelete: ['6'],
          }),
        }),
      );
    });

    it('unions multiple checked groups (in enum-group order) and shows a count chip', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByText('Also delete system messages'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Member joins & leaves' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Pin notifications' }));

      // Chip reflects the number of selected groups, not types.
      expect(screen.getByText('2')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Purge 2 DMs/ }));

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            // Group order (pins → members), not click order:
            // pins ["6"] + members ["1","2","7"].
            systemMessageTypesToDelete: ['6', '1', '2', '7'],
          }),
        }),
      );
    });

    it('toggles every group via the Select all / Clear all button', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByText('Also delete system messages'));

      // Select all → all 7 groups checked, count chip + label flips.
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();

      // Clear all → empty again.
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
      expect(screen.queryByText('7')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
    });

    it('Select all threads every system type into the dispatched config', () => {
      renderWithProviders(
        <BulkPurgeDialog open channels={mockDms} onClose={vi.fn()} mode="dms" />,
        { preloadedState: stateWithUser },
      );
      fireEvent.click(screen.getByText('Also delete system messages'));
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      fireEvent.click(screen.getByRole('button', { name: /Purge 2 DMs/ }));

      expect(bulkPurgeDMs).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            // A representative sample from across the buckets.
            systemMessageTypesToDelete: expect.arrayContaining([
              '6', '1', '2', '7', '8', '24',
            ]),
          }),
        }),
      );
    });
  });

  describe('Servers mode (#255 multi-server purge)', () => {
    const mockGuilds: Guild[] = [
      { id: 'g1', name: 'Alpha Server', icon: null } as Guild,
      { id: 'g2', name: 'Beta Server', icon: null } as Guild,
      { id: 'g3', name: 'Gamma Server', icon: null } as Guild,
    ];
    const renderServers = (guilds = mockGuilds) =>
      renderWithProviders(
        <BulkPurgeDialog open channels={[]} guilds={guilds} onClose={vi.fn()} mode="servers" />,
        { preloadedState: stateWithUser },
      );

    it('titles the dialog for servers and counts servers in the chip and pill', () => {
      renderServers();
      expect(screen.getByText('Purge Servers')).toBeInTheDocument();
      expect(screen.getByText('3 selected')).toBeInTheDocument();
      expect(screen.getByText('3 servers')).toBeInTheDocument();
      expect(screen.getByText(/Alpha Server, Beta Server, Gamma Server/)).toBeInTheDocument();
    });

    it('offers only Messages and Attachments Only', () => {
      renderServers();
      expect(screen.getByRole('button', { name: 'Messages' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Attachments Only' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reactions' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Clear All Reactions' })).toBeNull();
    });

    it('locks the target to the signed-in user and explains the scope', () => {
      renderServers();
      expect(screen.getByText('Server purges target your own messages. Every channel you can read in each selected server is included.')).toBeInTheDocument();
      expect(screen.getByText('Your messages in every channel you can read in 3 servers will be permanently deleted.')).toBeInTheDocument();
      expect(screen.getByText(/A server purge can run for hours/)).toBeInTheDocument();
    });

    it('dispatches purgeGuilds with the selected servers and a self-only target', () => {
      vi.mocked(bulkPurgeChannels).mockClear();
      vi.mocked(bulkPurgeDMs).mockClear();
      vi.mocked(purgeGuilds).mockClear();
      renderServers();
      const confirm = screen.getByRole('button', { name: 'Purge 3 Servers' });
      expect(confirm).not.toBeDisabled();
      fireEvent.click(confirm);

      expect(purgeGuilds).toHaveBeenCalledTimes(1);
      expect(purgeGuilds).toHaveBeenCalledWith({
        guilds: mockGuilds,
        config: {
          mode: 'messages',
          targetUserIds: ['999'],
          retainAttachedMedia: false,
          preserveMediaAndLinks: false,
          deleteAttachmentsOnly: false,
          systemMessageTypesToDelete: [],
          skipArchivedThreads: false,
        },
        searchCriteria: null,
      });
      expect(bulkPurgeChannels).not.toHaveBeenCalled();
      expect(bulkPurgeDMs).not.toHaveBeenCalled();
    });

    it('dispatches the attachments-only variant with its own summary', () => {
      renderServers([mockGuilds[0]]);
      fireEvent.click(screen.getByRole('button', { name: 'Attachments Only' }));
      expect(screen.getByText('Attachments will be stripped from your messages in every channel you can read in 1 server. Message text is preserved.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Strip Attachments (1 Server)' }));
      expect(purgeGuilds).toHaveBeenCalledWith(expect.objectContaining({
        guilds: [mockGuilds[0]],
        config: expect.objectContaining({ deleteAttachmentsOnly: true, targetUserIds: ['999'] }),
      }));
    });

    it('falls back to Messages when the saved purge mode is a reaction mode', () => {
      vi.mocked(purgeGuilds).mockClear();
      const savedReactions = {
        ...stateWithUser,
        app: { ...stateWithUser.app, settings: { ...stateWithUser.app.settings, purgeMode: 'reactions' } as typeof stateWithUser.app.settings },
      };
      renderWithProviders(
        <BulkPurgeDialog open channels={[]} guilds={mockGuilds} onClose={vi.fn()} mode="servers" />,
        { preloadedState: savedReactions },
      );
      expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Purge 3 Servers' }));
      expect(purgeGuilds).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({ mode: 'messages', targetUserIds: ['999'] }),
      }));
    });

    it('disables confirm with no servers selected', () => {
      renderServers([]);
      expect(screen.getByRole('button', { name: 'Purge 0 Servers' })).toBeDisabled();
    });
  });
});
