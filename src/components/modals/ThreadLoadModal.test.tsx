import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import ThreadLoadModal, { describeThread, sortThreadsForList } from './ThreadLoadModal';

// Modal now uses Redux for the discovered-threads thunk (#150). All
// non-discovery tests below should still work with a default store and
// the existing prop shape (no channel / guildId → discovery list hidden).
const render = (ui: React.ReactElement) =>
  renderWithProviders(ui, {
    preloadedState: {
      auth: { token: 'tok', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
    } as any,
  });

const mockFetchActiveGuildThreads = vi.fn();
const mockFetchPublicThreads = vi.fn();
const mockFetchPrivateThreads = vi.fn();
const mockFetchJoinedPrivateArchivedThreads = vi.fn();

vi.mock('@services/discordService', () => ({
  getDiscordService: () => ({
    fetchActiveGuildThreads: mockFetchActiveGuildThreads,
    fetchPublicThreads: mockFetchPublicThreads,
    fetchPrivateThreads: mockFetchPrivateThreads,
    fetchJoinedPrivateArchivedThreads: mockFetchJoinedPrivateArchivedThreads,
  }),
}));

describe('ThreadLoadModal', () => {
  const mockOnClose = vi.fn();
  const mockOnLoad = vi.fn();

  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    onLoad: mockOnLoad,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: every endpoint returns empty so non-discovery tests
    // (which don't pass channel/guildId) don't trigger any thunk calls
    // anyway, and discovery tests can override per-test.
    mockFetchActiveGuildThreads.mockResolvedValue({ success: true, data: { threads: [] } });
    mockFetchPublicThreads.mockResolvedValue({ success: true, data: { threads: [] } });
    mockFetchPrivateThreads.mockResolvedValue({ success: true, data: { threads: [] } });
    mockFetchJoinedPrivateArchivedThreads.mockResolvedValue({ success: true, data: { threads: [] } });
  });

  it('should render dialog with title', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    expect(screen.getByText('Load Thread')).toBeInTheDocument();
  });

  it('should render text field for thread ID', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    expect(screen.getByLabelText('Thread / Forum Post ID')).toBeInTheDocument();
  });

  it('should render description text', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    expect(screen.getByText(/Enter a thread or forum post ID/)).toBeInTheDocument();
  });

  it('should disable Load button when input is empty', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    expect(screen.getByText('Load')).toBeDisabled();
  });

  it('should enable Load button when input has value', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Thread / Forum Post ID'), {
      target: { value: '1234567890' },
    });
    expect(screen.getByText('Load')).not.toBeDisabled();
  });

  it('should call onLoad with thread ID on click', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Thread / Forum Post ID'), {
      target: { value: '1234567890' },
    });
    fireEvent.click(screen.getByText('Load'));
    expect(mockOnLoad).toHaveBeenCalledWith('1234567890');
  });

  it('should call onLoad on Enter key press', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    const input = screen.getByLabelText('Thread / Forum Post ID');
    fireEvent.change(input, { target: { value: '1234567890' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnLoad).toHaveBeenCalledWith('1234567890');
  });

  it('should strip non-numeric characters from input', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Thread / Forum Post ID'), {
      target: { value: 'abc123def456' },
    });
    expect(screen.getByLabelText('Thread / Forum Post ID')).toHaveValue('123456');
  });

  it('should call onClose when Cancel is clicked', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should not render when open is false', () => {
    render(<ThreadLoadModal {...defaultProps} open={false} />);
    expect(screen.queryByText('Load Thread')).toBeNull();
  });

  it('should clear input after successful load', () => {
    render(<ThreadLoadModal {...defaultProps} />);
    const input = screen.getByLabelText('Thread / Forum Post ID') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1234567890' } });
    expect(input.value).toBe('1234567890');
    fireEvent.click(screen.getByText('Load'));
    expect(mockOnLoad).toHaveBeenCalledWith('1234567890');
    expect(input.value).toBe('');
  });

  // Backlog #150: when channel + guildId are passed, the modal auto-
  // discovers threads in that channel and renders a clickable list so
  // users don't need to know the thread ID by hand. Threads with deleted
  // type-21 starter messages were otherwise invisible in the feed.
  describe('discovered threads list (Backlog #150)', () => {
    const textChannel = { id: 'parent', name: 'general', type: 0 } as any;

    it('does not render the discovery section when channel/guildId are missing', () => {
      render(<ThreadLoadModal {...defaultProps} />);
      expect(screen.queryByText('Threads in this channel')).toBeNull();
      expect(screen.queryByTestId('discovered-threads')).toBeNull();
    });

    it('renders discovered threads when channel + guildId are passed', async () => {
      mockFetchActiveGuildThreads.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '111', name: 'orphan-thread', type: 11, parent_id: 'parent' }] },
      });

      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('orphan-thread')).toBeInTheDocument();
    });

    it('clicking a discovered thread row calls onLoad with that thread id', async () => {
      mockFetchActiveGuildThreads.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '222', name: 'pickme', type: 11, parent_id: 'parent' }] },
      });

      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      const row = await screen.findByTestId('discovered-thread-222');
      fireEvent.click(row);
      expect(mockOnLoad).toHaveBeenCalledWith('222');
    });

    it('renders an "Archived" chip for archived threads', async () => {
      mockFetchPublicThreads.mockResolvedValue({
        success: true,
        data: {
          threads: [{
            id: '333',
            name: 'old-thread',
            type: 11,
            parent_id: 'parent',
            thread_metadata: { archived: true, archive_timestamp: '2026-01-01T00:00:00Z' },
          }],
        },
      });

      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('old-thread')).toBeInTheDocument();
      expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
    });

    // Backlog #252: rows carry an icon, a bold name, a facts line
    // (messages · members · archived when), and a Private chip for
    // private threads. Active threads list before archived ones.
    it('renders message and member counts under the thread name', async () => {
      mockFetchActiveGuildThreads.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '444', name: 'busy', type: 11, parent_id: 'parent', total_message_sent: 1234, member_count: 1 }] },
      });
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('1,234 messages · 1 member')).toBeInTheDocument();
    });

    it('marks private threads with a Private chip', async () => {
      mockFetchActiveGuildThreads.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '555', name: 'secret', type: 12, parent_id: 'parent' }] },
      });
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('secret')).toBeInTheDocument();
      expect(screen.getByText('Private')).toBeInTheDocument();
    });

    it('lists active threads before archived ones', async () => {
      mockFetchPublicThreads.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '1', name: 'old', type: 11, parent_id: 'parent', thread_metadata: { archived: true } }] },
      });
      mockFetchActiveGuildThreads.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '2', name: 'fresh', type: 11, parent_id: 'parent' }] },
      });
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      await screen.findByText('old');
      const list = screen.getByTestId('discovered-threads');
      const names = Array.from(list.querySelectorAll('[data-testid^="discovered-thread-"]')).map((el) => el.getAttribute('data-testid'));
      expect(names).toEqual(['discovered-thread-2', 'discovered-thread-1']);
    });

    it('shows "No threads found" empty state when discovery returns nothing', async () => {
      // beforeEach defaults all endpoints to empty.
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText(/No threads found/i)).toBeInTheDocument();
    });
  });

  describe('row helpers (#252)', () => {
    it('describeThread joins the facts it has and skips the ones it lacks', () => {
      expect(describeThread({ id: '1', type: 11, message_count: 1, member_count: 3 } as any)).toBe('1 message · 3 members');
      expect(describeThread({ id: '1', type: 11, total_message_sent: 50, message_count: 40 } as any)).toBe('50 messages');
      expect(describeThread({ id: '9', type: 11 } as any)).toBe('ID 9');
    });

    it('describeThread adds when an archived thread was archived', () => {
      const text = describeThread({ id: '1', type: 11, member_count: 2, thread_metadata: { archived: true, archive_timestamp: new Date(Date.now() - 3 * 86_400_000).toISOString() } } as any);
      expect(text).toBe('2 members · archived 3 days ago');
      expect(describeThread({ id: '1', type: 11, thread_metadata: { archived: true } } as any)).toBe('archived');
    });

    it('sortThreadsForList keeps server order within the active and archived groups', () => {
      const t = (id: string, archived: boolean) => ({ id, type: 11, thread_metadata: { archived } }) as any;
      expect(sortThreadsForList([t('a', true), t('b', false), t('c', true), t('d', false)]).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
    });
  });
});
