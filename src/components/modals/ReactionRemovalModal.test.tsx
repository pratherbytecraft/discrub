import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReactionRemovalModal, { REACTOR_FETCH_LIMIT } from './ReactionRemovalModal';
import { createMockMessage, createMockReaction } from '../../test/fixtures';
import type { Message, User } from 'discrub-core/types/discord-types';

const messagesWithReactions: Message[] = [
  createMockMessage({
    id: 'msg-1',
    reactions: [
      createMockReaction({ emoji: { id: null, name: '👍' }, count: 3, me: true }),
      createMockReaction({ emoji: { id: null, name: '❤️' }, count: 2, me: true }),
    ],
  }),
  createMockMessage({
    id: 'msg-2',
    reactions: [
      createMockReaction({ emoji: { id: null, name: '👍' }, count: 1, me: true }),
      createMockReaction({ emoji: { id: 'emoji-1', name: 'custom', animated: false }, count: 5 }),
    ],
  }),
  createMockMessage({ id: 'msg-3', reactions: [] }),
];

const mockReactors: User[] = [
  { id: 'user-1', username: 'alice', global_name: 'Alice' } as unknown as User,
  { id: 'user-2', username: 'bob', global_name: 'Bob' } as unknown as User,
];

describe('ReactionRemovalModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    selectedMessages: messagesWithReactions,
    canManageMessages: true,
    currentUserId: 'user-123',
    currentUsername: 'TestUser',
    onConfirm: vi.fn(),
    onFetchReactingUsers: vi.fn().mockResolvedValue(mockReactors),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog title', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    expect(screen.getByText('Remove Reactions')).toBeInTheDocument();
  });

  it('shows emoji select with "All emojis" default', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    expect(screen.getByText('All emojis')).toBeInTheDocument();
  });

  it('shows user select with "All users" pre-selected for admin', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    expect(screen.getByText('All users')).toBeInTheDocument();
  });

  it('shows "You" option for non-admin', () => {
    render(<ReactionRemovalModal {...defaultProps} canManageMessages={false} />);
    expect(screen.getByText('TestUser (you)')).toBeInTheDocument();
  });

  it('does not show "All users" for non-admin', () => {
    render(<ReactionRemovalModal {...defaultProps} canManageMessages={false} />);
    expect(screen.queryByText('All users')).toBeNull();
  });

  it('shows message count summary', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    // 2 of 3 messages have reactions
    expect(screen.getByText('2 messages with reactions will be processed.')).toBeInTheDocument();
  });

  it('shows no reactions message when none selected', () => {
    render(<ReactionRemovalModal {...defaultProps} selectedMessages={[messagesWithReactions[2]]} />);
    expect(screen.getByText('No selected messages have reactions.')).toBeInTheDocument();
  });

  it('calls onConfirm with "all" mode when admin selects all emojis + all users', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Remove'));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: 'msg-1' }),
        expect.objectContaining({ id: 'msg-2' }),
      ]),
      mode: 'all',
    });
  });

  it('calls onConfirm with user mode for non-admin', () => {
    render(<ReactionRemovalModal {...defaultProps} canManageMessages={false} />);
    fireEvent.click(screen.getByText('Remove'));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'user',
        userId: 'user-123',
      }),
    );
  });

  it('calls onClose after confirm', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Remove'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when cancel is clicked', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('auto-fetches reacting users on open', async () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    await waitFor(() => {
      expect(defaultProps.onFetchReactingUsers).toHaveBeenCalled();
    });
  });

  it('shows loading spinner while fetching reactors', async () => {
    const slowFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ReactionRemovalModal {...defaultProps} onFetchReactingUsers={slowFetch} />);
    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  it('excludes messages without reactions from confirm payload', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Remove'));
    const call = defaultProps.onConfirm.mock.calls[0][0];
    expect(call.messages).toHaveLength(2);
    expect(call.messages.every((m: Message) => m.reactions && m.reactions.length > 0)).toBe(true);
  });

  it('disables Remove button when no messages have reactions', () => {
    render(<ReactionRemovalModal {...defaultProps} selectedMessages={[messagesWithReactions[2]]} />);
    expect(screen.getByText('Remove').closest('button')).toBeDisabled();
  });

  it('stops fetching reactors when dialog is closed', async () => {
    const slowFetch = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockReactors), 500))
    );
    const { rerender } = render(
      <ReactionRemovalModal {...defaultProps} onFetchReactingUsers={slowFetch} />
    );

    // Fetch should start
    await waitFor(() => {
      expect(slowFetch).toHaveBeenCalled();
    });

    // Close the dialog
    rerender(
      <ReactionRemovalModal {...defaultProps} open={false} onFetchReactingUsers={slowFetch} />
    );

    // Record call count at close time
    const callsAtClose = slowFetch.mock.calls.length;

    // Wait a bit — no more calls should happen after close
    await new Promise((r) => setTimeout(r, 100));
    expect(slowFetch.mock.calls.length).toBeLessThanOrEqual(callsAtClose + 1);
  });

  it('renders emoji grid with available emojis from selected messages', () => {
    render(<ReactionRemovalModal {...defaultProps} />);
    expect(screen.getByText('All emojis')).toBeInTheDocument();
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
  });

  it('skips reactor fetch when canManageMessages is false', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockReactors);
    render(<ReactionRemovalModal {...defaultProps} canManageMessages={false} onFetchReactingUsers={fetchFn} />);
    // Wait a tick — fetch should NOT be called
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchFn).not.toHaveBeenCalled();
    // Spinner should not show
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('fetches reactors when canManageMessages is true', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockReactors);
    render(<ReactionRemovalModal {...defaultProps} canManageMessages={true} onFetchReactingUsers={fetchFn} fetchDelayMs={0} />);
    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalled();
    });
  });

  it('works without onFetchReactingUsers (no fetch, no crash)', () => {
    render(<ReactionRemovalModal {...defaultProps} onFetchReactingUsers={undefined} />);
    expect(screen.getByText('Remove Reactions')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('handles fetch failure gracefully (continues to next emoji)', async () => {
    let callCount = 0;
    const failingFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('API error'));
      return Promise.resolve(mockReactors);
    });
    render(<ReactionRemovalModal {...defaultProps} onFetchReactingUsers={failingFetch} fetchDelayMs={0} />);
    await waitFor(() => {
      // Should still call for other emojis despite first failure
      expect(failingFetch.mock.calls.length).toBeGreaterThan(1);
    }, { timeout: 3000 });
  });

  // 2.2.5 W4: one call per reaction, so a large selection stops at the cap and says so.
  it('stops reactor lookups at the cap and says so', async () => {
    const many = Array.from({ length: REACTOR_FETCH_LIMIT + 5 }, (_, i) =>
      createMockMessage({ id: `m${i}`, reactions: [createMockReaction({ emoji: { id: null, name: '👍' }, count: 1 })] }),
    );
    const fetch = vi.fn().mockResolvedValue([]);
    render(<ReactionRemovalModal {...defaultProps} selectedMessages={many} fetchDelayMs={0} onFetchReactingUsers={fetch} />);
    expect(await screen.findByTestId('reactors-capped')).toHaveTextContent(`first ${REACTOR_FETCH_LIMIT} reactions`);
    expect(fetch).toHaveBeenCalledTimes(REACTOR_FETCH_LIMIT);
  });
});
