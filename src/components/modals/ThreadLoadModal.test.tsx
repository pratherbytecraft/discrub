import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import ThreadLoadModal, { describeThread, sortThreadsForList } from './ThreadLoadModal';
import { initialAppState } from '@features/app/appTypes';

// Modal now uses Redux for the discovered-threads thunk (#150). All
// non-discovery tests below should still work with a default store and
// the existing prop shape (no channel / guildId → discovery list hidden).
const render = (ui: React.ReactElement) =>
  renderWithProviders(ui, {
    preloadedState: {
      auth: { token: 'tok', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
      // No wait between thread list pages, so a scroll test does not sit out the Search Delay.
      app: { ...initialAppState, settings: { searchDelay2: '0', delayModifier2: '0' } },
    } as any,
  });

const mockSearch = vi.fn();

vi.mock('@services/discordService', () => ({
  getDiscordService: () => ({
    fetchForumThreadSearch: mockSearch,
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
    mockSearch.mockResolvedValue({ success: true, data: { threads: [], has_more: false, total_results: 0 } });
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
      mockSearch.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '111', name: 'orphan-thread', type: 11, parent_id: 'parent' }] },
      });

      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('orphan-thread')).toBeInTheDocument();
    });

    it('clicking a discovered thread row calls onLoad with that thread id', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '222', name: 'pickme', type: 11, parent_id: 'parent' }] },
      });

      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      const row = await screen.findByTestId('discovered-thread-222');
      fireEvent.click(row);
      expect(mockOnLoad).toHaveBeenCalledWith('222');
    });

    it('renders an "Archived" chip for archived threads', async () => {
      mockSearch.mockResolvedValue({
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
      mockSearch.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '444', name: 'busy', type: 11, parent_id: 'parent', total_message_sent: 1234, member_count: 1 }] },
      });
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('1,234 messages · 1 member')).toBeInTheDocument();
    });

    it('marks private threads with a Private chip', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        data: { threads: [{ id: '555', name: 'secret', type: 12, parent_id: 'parent' }] },
      });
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      expect(await screen.findByText('secret')).toBeInTheDocument();
      expect(screen.getByText('Private')).toBeInTheDocument();
    });

    it('lists active threads before archived ones', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        data: { threads: [
          { id: '1', name: 'old', type: 11, parent_id: 'parent', thread_metadata: { archived: true } },
          { id: '2', name: 'fresh', type: 11, parent_id: 'parent' },
        ] },
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

  // GitHub 24: the list comes from Discord's thread search, a box per row
  // picks threads, and the button exports the picked ones or all of them.
  describe('thread export (GitHub 24)', () => {
    const textChannel = { id: 'parent', name: 'general', type: 0 } as any;
    const thread = (id: string, name = `t${id}`) => ({ id, name, type: 11, parent_id: 'parent' });
    const page = (threads: unknown[], total: number, has_more: boolean) => ({ success: true, data: { threads, total_results: total, has_more } });
    const onExport = vi.fn();
    const open = (extra: Record<string, unknown> = {}) =>
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" onExport={onExport} {...extra} />);

    beforeEach(() => onExport.mockClear());

    it('reads the list with one thread search call, first page, no archived filter', async () => {
      mockSearch.mockResolvedValue(page([thread('1')], 1, false));
      open();
      await screen.findByText('t1');
      expect(mockSearch).toHaveBeenCalledTimes(1);
      expect(mockSearch).toHaveBeenCalledWith('tok', 'parent', { sort_by: 'last_message_time', sort_order: 'desc', limit: 25, offset: 0 });
    });

    it('shows how many threads Discord reports, not how many are loaded', async () => {
      mockSearch.mockResolvedValue(page([thread('1'), thread('2')], 140, true));
      open();
      await screen.findByText('t1');
      expect(screen.getByTestId('thread-total')).toHaveTextContent('140 found');
      expect(screen.getByTestId('export-threads')).toHaveTextContent('Export all threads (140)');
      expect(screen.getByTestId('threads-loading-more')).toBeInTheDocument();
    });

    it('with nothing ticked and the whole list loaded, the button hands over every thread so nothing is listed again', async () => {
      mockSearch.mockResolvedValue(page([thread('1'), thread('2')], 2, false));
      open();
      await screen.findByText('t1');
      fireEvent.click(screen.getByTestId('export-threads'));
      expect(onExport).toHaveBeenCalledWith({ all: false, threads: [thread('1'), thread('2')], total: 2 });
    });

    it('with pages left to load, the button asks for every thread of the channel', async () => {
      mockSearch.mockResolvedValue(page([thread('1'), thread('2')], 60, true));
      open();
      await screen.findByText('t1');
      fireEvent.click(screen.getByTestId('export-threads'));
      expect(onExport).toHaveBeenCalledWith({ all: true, threads: [thread('1'), thread('2')], total: 60 });
    });

    it('ticking rows exports only those, and the button says how many', async () => {
      mockSearch.mockResolvedValue(page([thread('1'), thread('2'), thread('3')], 3, false));
      open();
      await screen.findByText('t1');
      fireEvent.click(screen.getByTestId('thread-tick-2').querySelector('input')!);
      expect(screen.getByTestId('export-threads')).toHaveTextContent('Export 1 thread');
      fireEvent.click(screen.getByTestId('thread-tick-3').querySelector('input')!);
      expect(screen.getByTestId('export-threads')).toHaveTextContent('Export 2 threads');
      fireEvent.click(screen.getByTestId('export-threads'));
      expect(onExport).toHaveBeenCalledWith({ all: false, threads: [thread('2'), thread('3')], total: 2 });
      expect(mockOnLoad).not.toHaveBeenCalled();
    });

    it('the heading box means every thread, loaded or not', async () => {
      mockSearch.mockResolvedValue(page([thread('1'), thread('2')], 60, true));
      open();
      await screen.findByText('t1');
      fireEvent.click(screen.getByTestId('thread-select-all').querySelector('input')!);
      expect((screen.getByTestId('thread-tick-1').querySelector('input') as HTMLInputElement).checked).toBe(true);
      fireEvent.click(screen.getByTestId('export-threads'));
      expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ all: true, total: 60 }));
    });

    it('unticking one row after the heading box keeps the loaded rows minus that one', async () => {
      mockSearch.mockResolvedValue(page([thread('1'), thread('2'), thread('3')], 3, false));
      open();
      await screen.findByText('t1');
      fireEvent.click(screen.getByTestId('thread-select-all').querySelector('input')!);
      fireEvent.click(screen.getByTestId('thread-tick-2').querySelector('input')!);
      expect(screen.getByTestId('export-threads')).toHaveTextContent('Export 2 threads');
      fireEvent.click(screen.getByTestId('export-threads'));
      expect(onExport).toHaveBeenCalledWith({ all: false, threads: [thread('1'), thread('3')], total: 2 });
    });

    it('scrolling to the end of the list loads the next page once', async () => {
      mockSearch.mockResolvedValueOnce(page([thread('1')], 30, true));
      mockSearch.mockResolvedValueOnce(page([thread('2')], 30, false));
      open();
      await screen.findByText('t1');
      const list = screen.getByTestId('discovered-threads');
      fireEvent.scroll(list);
      fireEvent.scroll(list);
      expect(await screen.findByText('t2')).toBeInTheDocument();
      expect(mockSearch).toHaveBeenCalledTimes(2);
      expect(mockSearch).toHaveBeenLastCalledWith('tok', 'parent', expect.objectContaining({ offset: 25 }));
      expect(screen.queryByTestId('threads-loading-more')).toBeNull();
    });

    it('the button is off with no threads and while another job runs', async () => {
      open();
      await screen.findByText(/No threads found/i);
      expect(screen.getByTestId('export-threads')).toBeDisabled();
    });

    it('is off while another long job runs', async () => {
      mockSearch.mockResolvedValue(page([thread('1')], 1, false));
      open({ exportDisabled: true });
      await screen.findByText('t1');
      expect(screen.getByTestId('export-threads')).toBeDisabled();
    });

    it('a failed listing says so', async () => {
      mockSearch.mockResolvedValue({ success: false, status: 403 });
      open();
      expect(await screen.findByText(/Couldn't load threads/)).toBeInTheDocument();
    });

    it('without onExport there are no boxes and no button', async () => {
      mockSearch.mockResolvedValue(page([thread('1')], 1, false));
      render(<ThreadLoadModal {...defaultProps} channel={textChannel} guildId="g1" />);
      await screen.findByText('t1');
      expect(screen.queryByTestId('export-threads')).toBeNull();
      expect(screen.queryByTestId('thread-tick-1')).toBeNull();
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
