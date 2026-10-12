import { messageStateWith, rowsOf } from '@/test/state-factories';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '../../test/test-utils';
import MessageActions from './MessageActions';
import { initialMessageState, initialPaginationState } from '@features/message/messageTypes';
import { createMockMessage, createMockEmbed } from '../../test/fixtures';

// Stub the add-reactions modal so this gating test doesn't load the emoji dataset.
vi.mock('@components/modals/AddReactionsModal', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-reactions-modal" /> : null,
}));

describe('MessageActions', () => {
  const defaultProps = {
    selectedMessages: [] as any[],
    onDelete: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(undefined),
    formattingContext: { userMap: {}, channelMap: {}, guildRoles: [] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // #263: the toolbar reads the selection from the store when the prop is
  // omitted, so ServerView no longer re-renders on every selection change.
  describe('Store-backed selection', () => {
    it('reads the selection from the store when no prop is given', () => {
      const { selectedMessages: _omit, ...rest } = defaultProps;
      render(<MessageActions {...rest} />, {
        preloadedState: {
          message: {
            ...initialMessageState,
            ...messageStateWith(initialMessageState, [createMockMessage({ id: 'a' }), createMockMessage({ id: 'b' })]),
            selectedIds: ['a', 'b'],
          },
        } as any,
      });
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    // 2.2.5 W1: the buttons used to wait for every selected object, and past
    // the cache size the read never settled, so they stayed disabled.
    it('enables the buttons for a 25,000 message selection from the rows alone', () => {
      const { selectedMessages: _omit, ...rest } = defaultProps;
      const messages = Array.from({ length: 25_000 }, (_, i) => createMockMessage({
        id: String(i + 1),
        author: { id: 'me', username: 'me' } as any,
        reactions: i === 7 ? [{ count: 1, me: true, emoji: { name: 'x' } }] as any : [],
      }));
      const state = messageStateWith(initialMessageState, messages);
      render(<MessageActions {...rest} currentUserId="me" onBatchRemoveReactions={vi.fn()} onBatchAddReactions={vi.fn()} />, {
        preloadedState: { message: { ...initialMessageState, ...state, selectedIds: messages.map((m) => m.id) } } as any,
      });
      expect(screen.getByText('25,000 selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Add Reactions' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Remove Reactions' })).toBeEnabled();
    });

    it('gates delete and reaction removal on the selected rows', () => {
      const { selectedMessages: _omit, ...rest } = defaultProps;
      const messages = [
        createMockMessage({ id: 'a', author: { id: 'other', username: 'o' } as any, reactions: [{ count: 2, me: false, emoji: { name: 'x' } }] as any }),
        createMockMessage({ id: 'b', author: { id: 'me', username: 'me' } as any }),
      ];
      render(<MessageActions {...rest} currentUserId="me" canManageMessages={false} onBatchRemoveReactions={vi.fn()} />, {
        preloadedState: { message: { ...initialMessageState, ...messageStateWith(initialMessageState, messages), selectedIds: ['a', 'b'] } } as any,
      });
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remove Reactions' })).toBeDisabled();
    });

    // 2.2.5 W4: bulk actions take ids; only Remove Reactions reads messages.
    describe('bulk actions on the stored selection', () => {
      const { selectedMessages: _omit, ...rest } = defaultProps;
      const me = { id: 'me', username: 'me' } as any;
      const messages = [
        createMockMessage({ id: 'a', author: me, content: 'one', reactions: [{ count: 1, me: true, emoji: { name: 'x' } }] as any }),
        createMockMessage({ id: 'b', author: me, content: 'two', attachments: [{ id: 'f', filename: 'f.png' }] as any }),
      ];
      const stored = () => ({ preloadedState: { message: { ...initialMessageState, ...messageStateWith(initialMessageState, messages), selectedIds: ['a', 'b'] } } as any });

      it('Delete passes the ids', async () => {
        const onDelete = vi.fn().mockResolvedValue(undefined);
        render(<MessageActions {...rest} onDelete={onDelete} currentUserId="me" />, stored());
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await act(async () => {
          const buttons = screen.getAllByRole('button', { name: 'Delete' });
          fireEvent.click(buttons[buttons.length - 1]);
        });
        expect(onDelete).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]);
      });

      it('bulk Edit passes the ids and warns about a bare message from the rows', async () => {
        const onBulkEdit = vi.fn().mockResolvedValue(undefined);
        render(<MessageActions {...rest} onBulkEdit={onBulkEdit} currentUserId="me" />, stored());
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(await screen.findByText(/Some selected messages have no attachments or embeds/)).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'gone' } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        });
        expect(onBulkEdit).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }], 'gone');
      });

      it('Remove Reactions reads only the reacted messages, ids and reactions', async () => {
        const onBatchRemoveReactions = vi.fn();
        render(<MessageActions {...rest} currentUserId="me" onBatchRemoveReactions={onBatchRemoveReactions} />, stored());
        fireEvent.click(screen.getByRole('button', { name: 'Remove Reactions' }));
        expect(await screen.findByText('1 message with reactions will be processed.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(onBatchRemoveReactions.mock.calls[0][0].messages).toEqual([{ id: 'a', reactions: messages[0].reactions }]);
      });
    });

    it('reads the active thread tab selection when a thread tab is open', () => {
      const { selectedMessages: _omit, ...rest } = defaultProps;
      render(<MessageActions {...rest} />, {
        preloadedState: {
          message: {
            ...initialMessageState,
            ...messageStateWith(initialMessageState, [createMockMessage({ id: 'main-1' })]),
            selectedIds: ['main-1'],
            activeTab: 'thread-1',
            threadTabs: {
              'thread-1': {
                threadId: 'thread-1',
                threadName: 'Thread 1',
                rows: rowsOf([createMockMessage({ id: 't-1' }), createMockMessage({ id: 't-2' }), createMockMessage({ id: 't-3' })], 'thread-1'),
                filteredRows: rowsOf([createMockMessage({ id: 't-1' }), createMockMessage({ id: 't-2' }), createMockMessage({ id: 't-3' })], 'thread-1'),
                selectedIds: ['t-1', 't-2', 't-3'],
                contentMatchIds: null,
                searchCriteria: null,
                refineCriteria: null,
                order: initialMessageState.order,
                isLoading: false,
                error: null,
                pagination: initialPaginationState,
              },
            },
          },
        } as any,
      });
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });
  });

  describe('Selection Count', () => {
    it('should show "0 selected" when no messages selected', () => {
      render(<MessageActions {...defaultProps} />);
      expect(screen.getByText('0 selected')).toBeInTheDocument();
    });

    it('should show correct selection count', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage({ id: 'a' }), createMockMessage({ id: 'b' })]} />);
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });
  });

  describe('Button States', () => {
    it('should disable Delete when no messages selected', () => {
      render(<MessageActions {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
    });

    it('should enable Delete when messages are selected', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage()]} />);
      expect(screen.getByRole('button', { name: /Delete/ })).not.toBeDisabled();
    });

    it('should disable Edit when no messages selected', () => {
      render(<MessageActions {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
    });

    it('should enable Edit when multiple messages selected', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage({ id: 'a' }), createMockMessage({ id: 'b' })]} />);
      expect(screen.getByRole('button', { name: /Edit/ })).not.toBeDisabled();
    });

    it('should enable Edit when exactly one message selected', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage()]} />);
      expect(screen.getByRole('button', { name: /Edit/ })).not.toBeDisabled();
    });

  });

  describe('Embed Button', () => {
    it('should show Embeds button when message has embeds', () => {
      const msg = createMockMessage({ embeds: [createMockEmbed()] });
      render(<MessageActions {...defaultProps} selectedMessages={[msg]} />);
      expect(screen.getByRole('button', { name: /Embeds \(1\)/ })).toBeInTheDocument();
    });
  });

  describe('Operation Safety', () => {
    it('should disable Delete when isOperationRunning is true', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage()]} isOperationRunning={true} />);
      expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
    });

    it('should disable Edit when multiple selected and isOperationRunning is true', () => {
      const msgs = [createMockMessage({ id: 'a' }), createMockMessage({ id: 'b' })];
      render(<MessageActions {...defaultProps} selectedMessages={msgs} onBulkEdit={vi.fn()} isOperationRunning={true} />);
      expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
    });

    it('should not disable Edit when isOperationRunning is true (single-message op)', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage()]} isOperationRunning={true} />);
      expect(screen.getByRole('button', { name: /Edit/ })).not.toBeDisabled();
    });
  });

  describe('Modal Opening', () => {
    it('should open delete modal when Delete is clicked', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage()]} />);
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
      expect(screen.getByText('Delete Messages')).toBeInTheDocument();
    });

    it('should open edit modal when Edit is clicked', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage({ content: 'edit me' })]} />);
      fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
      expect(screen.getByText('Edit Message')).toBeInTheDocument();
    });

  });

  describe('Delete Callback', () => {
    it('should call onDelete with selected messages when confirmed', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      const messages = [createMockMessage({ id: 'del-1' })];
      render(<MessageActions {...defaultProps} onDelete={onDelete} selectedMessages={messages} />);
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
      // Click the confirm button in the DeleteConfirmModal
      const confirmBtn = screen.getByRole('button', { name: 'Delete' });
      await act(async () => {
        fireEvent.click(confirmBtn);
      });
      expect(onDelete).toHaveBeenCalledWith(messages);
    });

    it('should close the delete modal immediately when confirmed', async () => {
      let resolveDelete: () => void;
      const onDelete = vi.fn().mockImplementation(() => new Promise<void>((r) => { resolveDelete = r; }));
      const messages = [createMockMessage({ id: 'del-1' })];
      render(<MessageActions {...defaultProps} onDelete={onDelete} selectedMessages={messages} />);
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
      expect(screen.getByText('Delete Messages')).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      });
      // Modal should close immediately, before onDelete resolves
      await waitFor(() => {
        expect(screen.queryByText('Delete Messages')).toBeNull();
      });
      // Clean up the pending promise
      await act(async () => { resolveDelete!(); });
    });
  });

  describe('Permission gating (Backlog #139)', () => {
    const selfId = 'user-123';
    const otherId = 'user-456';
    const selfMsg = createMockMessage({ id: 'm-self', author: { id: selfId, username: 'me' } as any });
    const otherMsg = createMockMessage({ id: 'm-other', author: { id: otherId, username: 'them' } as any });

    it('disables Delete when selection includes non-self messages and no MANAGE', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[selfMsg, otherMsg]}
          currentUserId={selfId}
          canManageMessages={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
    });

    it('enables Delete when selection includes non-self messages and user has MANAGE', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[selfMsg, otherMsg]}
          currentUserId={selfId}
          canManageMessages={true}
        />,
      );
      expect(screen.getByRole('button', { name: /Delete/ })).not.toBeDisabled();
    });

    it('enables Delete for self-only selection without MANAGE', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[selfMsg]}
          currentUserId={selfId}
          canManageMessages={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Delete/ })).not.toBeDisabled();
    });

    it('shows lock reason tooltip on disabled Delete button', async () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[otherMsg]}
          currentUserId={selfId}
          canManageMessages={false}
        />,
      );
      // Tooltip lives on the wrapping span — hover the wrapper to surface it
      const button = screen.getByRole('button', { name: /Delete/ });
      const wrapper = button.parentElement!;
      fireEvent.mouseOver(wrapper);
      await waitFor(() => {
        expect(
          screen.getByText('You can only delete your own messages without Manage Messages permission in this channel.'),
        ).toBeInTheDocument();
      });
    });

    it('shows DM-aware lock reason tooltip when isDm is true', async () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[otherMsg]}
          currentUserId={selfId}
          canManageMessages={false}
          isDm={true}
        />,
      );
      const button = screen.getByRole('button', { name: /Delete/ });
      const wrapper = button.parentElement!;
      fireEvent.mouseOver(wrapper);
      await waitFor(() => {
        expect(
          screen.getByText('You can only delete your own messages in DMs.'),
        ).toBeInTheDocument();
      });
    });

    it('disables Edit when selection includes non-self messages even with MANAGE', () => {
      // Discord PATCH is author-only regardless of permission
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[otherMsg]}
          currentUserId={selfId}
          canManageMessages={true}
        />,
      );
      expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
    });

    it('enables Edit when selection is self-only', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[selfMsg]}
          currentUserId={selfId}
          canManageMessages={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Edit/ })).not.toBeDisabled();
    });

    it('disables Edit when mixed-author selection includes any non-self message', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[selfMsg, otherMsg]}
          currentUserId={selfId}
          canManageMessages={true}
        />,
      );
      expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
    });

    it('shows lock reason tooltip on disabled Edit button', async () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[otherMsg]}
          currentUserId={selfId}
          canManageMessages={true}
        />,
      );
      const button = screen.getByRole('button', { name: /Edit/ });
      const wrapper = button.parentElement!;
      fireEvent.mouseOver(wrapper);
      await waitFor(() => {
        expect(
          screen.getByText("You can only edit your own messages. Discord blocks editing other users' messages."),
        ).toBeInTheDocument();
      });
    });
  });

  describe('System message edit gating (#196 Phase 3)', () => {
    it('disables Edit when the selection includes a system message', () => {
      const normal = createMockMessage({ id: 'n1', type: 0 });
      const pinNotice = createMockMessage({ id: 's1', type: 6 });
      render(<MessageActions {...defaultProps} selectedMessages={[normal, pinNotice]} />);
      expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
    });

    it('keeps Delete enabled for a system-message selection (deletion is the point of #196)', () => {
      const pinNotice = createMockMessage({ id: 's1', type: 6 });
      render(<MessageActions {...defaultProps} selectedMessages={[pinNotice]} />);
      expect(screen.getByRole('button', { name: /Delete/ })).not.toBeDisabled();
    });

    it('shows the system-message lock reason on the disabled Edit button', async () => {
      const pinNotice = createMockMessage({ id: 's1', type: 6 });
      render(<MessageActions {...defaultProps} selectedMessages={[pinNotice]} />);
      const button = screen.getByRole('button', { name: /Edit/ });
      fireEvent.mouseOver(button.parentElement!);
      await waitFor(() => {
        expect(
          screen.getByText("System messages (pins, joins, boosts, etc.) can't be edited."),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Edit Callback', () => {
    it('should call onEdit with message and new content when saved', async () => {
      const onEdit = vi.fn().mockResolvedValue(undefined);
      const msg = createMockMessage({ content: 'original' });
      render(<MessageActions {...defaultProps} onEdit={onEdit} selectedMessages={[msg]} />);
      fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
      const textarea = screen.getByLabelText('Message Content');
      fireEvent.change(textarea, { target: { value: 'updated' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      expect(onEdit).toHaveBeenCalledWith(msg, 'updated');
    });

    it('should close the edit modal immediately when saved', async () => {
      let resolveEdit: () => void;
      const onEdit = vi.fn().mockImplementation(() => new Promise<void>((r) => { resolveEdit = r; }));
      const msg = createMockMessage({ content: 'original' });
      render(<MessageActions {...defaultProps} onEdit={onEdit} selectedMessages={[msg]} />);
      fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
      expect(screen.getByText('Edit Message')).toBeInTheDocument();
      const textarea = screen.getByLabelText('Message Content');
      fireEvent.change(textarea, { target: { value: 'updated' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      // Modal should close immediately, before onEdit resolves
      await waitFor(() => {
        expect(screen.queryByText('Edit Message')).toBeNull();
      });
      // Clean up the pending promise
      await act(async () => { resolveEdit!(); });
    });
  });

  describe('Add Reactions button (Backlog #202)', () => {
    it('is not rendered without an onBatchAddReactions handler', () => {
      render(<MessageActions {...defaultProps} selectedMessages={[createMockMessage()]} />);
      expect(screen.queryByRole('button', { name: 'Add Reactions' })).toBeNull();
    });

    it('is disabled with no selection and enabled with a selection', () => {
      const onBatchAddReactions = vi.fn();
      const { rerender } = render(
        <MessageActions {...defaultProps} onBatchAddReactions={onBatchAddReactions} />
      );
      expect(screen.getByRole('button', { name: 'Add Reactions' })).toBeDisabled();

      rerender(
        <MessageActions
          {...defaultProps}
          selectedMessages={[createMockMessage()]}
          onBatchAddReactions={onBatchAddReactions}
        />
      );
      expect(screen.getByRole('button', { name: 'Add Reactions' })).toBeEnabled();
    });

    it('is disabled while another operation is running', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[createMockMessage()]}
          onBatchAddReactions={vi.fn()}
          isOperationRunning
        />
      );
      expect(screen.getByRole('button', { name: 'Add Reactions' })).toBeDisabled();
    });

    it('opens the add-reactions modal on click (no manage-messages gate)', () => {
      render(
        <MessageActions
          {...defaultProps}
          selectedMessages={[createMockMessage()]}
          onBatchAddReactions={vi.fn()}
          canManageMessages={false}
        />
      );
      expect(screen.queryByTestId('add-reactions-modal')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add Reactions' }));
      expect(screen.getByTestId('add-reactions-modal')).toBeInTheDocument();
    });
  });
});
