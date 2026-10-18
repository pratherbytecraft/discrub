import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import LoadAllDialog from './LoadAllDialog';
import { createBaseState, messageStateWith, rowsOf } from '../../test/state-factories';
import { createMockChannel, createMockMessage } from '../../test/fixtures';
import { initialWorkspaceState } from '@features/workspace/workspaceSlice';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({})),
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

describe('LoadAllDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    contextLabel: 'channel',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 2.2.5: a conversation restored from the workspace continues from its cursor.
  describe('Restored conversation (2.2.5)', () => {
    const restoredState = () => {
      const base = createBaseState();
      return createBaseState({
        message: {
          ...base.message,
          ...messageStateWith(base.message, [createMockMessage({ id: '1', timestamp: '2026-03-03T12:00:00.000Z' })]),
          restored: { count: 12480, oldestTimestamp: '2026-03-03T12:00:00.000Z' },
        },
      });
    };

    // A Load All that was cut is recorded on the conversation (row 35, fix C).
    const cutState = () => {
      const base = restoredState();
      return createBaseState({
        ...base,
        channel: { ...base.channel, selectedChannel: createMockChannel({ id: 'cut-1', name: 'general' }) },
        workspace: { ...initialWorkspaceState, actions: { 'cut-1': { kind: 'loadAll', settings: { mode: 'plain' } } } } as never,
      });
    };

    it('shows the saved count line, Resume and Start over after a cut Load All', () => {
      const onStartOver = vi.fn();
      renderWithProviders(<LoadAllDialog {...defaultProps} onStartOver={onStartOver} />, { preloadedState: cutState() });
      expect(screen.getByTestId('load-all-restored-line')).toHaveTextContent(/12,480 loaded so far in this workspace\. Resume continues from Mar 3, 2026\./);
      expect(screen.getByTestId('load-all-confirm')).toHaveTextContent('Resume');
      fireEvent.click(screen.getByTestId('load-all-start-over'));
      expect(onStartOver).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('load-all-confirm'));
      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
    });

    it('a restored conversation with no cut Load All reads its count, Load All and Start over (row 35)', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} onStartOver={vi.fn()} />, { preloadedState: restoredState() });
      expect(screen.getByTestId('load-all-restored-line')).toHaveTextContent('12,480 loaded so far in this workspace.');
      expect(screen.getByTestId('load-all-restored-line')).not.toHaveTextContent('Resume continues');
      expect(screen.getByTestId('load-all-confirm')).toHaveTextContent('Load All');
      expect(screen.getByTestId('load-all-start-over')).toBeInTheDocument();
    });

    it('shows no plain figures while a search is showing (row 45)', () => {
      const base = restoredState();
      renderWithProviders(<LoadAllDialog {...defaultProps} onStartOver={vi.fn()} />, {
        preloadedState: createBaseState({ message: { ...base.message, pagination: { ...base.message.pagination, mode: 'search' } } }),
      });
      expect(screen.queryByTestId('load-all-restored-line')).not.toBeInTheDocument();
      expect(screen.queryByTestId('load-all-start-over')).not.toBeInTheDocument();
    });

    it('offers only Start over when the saved walk is complete', () => {
      const onStartOver = vi.fn();
      const base = restoredState();
      renderWithProviders(<LoadAllDialog {...defaultProps} onStartOver={onStartOver} />, {
        preloadedState: createBaseState({ message: { ...base.message, pagination: { ...base.message.pagination, hasMore: false } } }),
      });
      expect(screen.getByTestId('load-all-restored-line')).toHaveTextContent('All 12,480 messages in this channel are saved in this workspace. Start over fetches the channel again and picks up anything posted since.');
      expect(screen.queryByTestId('load-all-confirm')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('load-all-start-over'));
      expect(onStartOver).toHaveBeenCalledTimes(1);
    });

    // 2.2.5 B: a Load All that finished this session left nothing restored, but the
    // conversation is on disk, so the dialog still offers Start over for what was posted since.
    it('offers Start over for a conversation the open workspace holds even when nothing was restored', () => {
      const onStartOver = vi.fn();
      const base = createBaseState();
      const channel = createMockChannel({ id: 'saved-1', name: 'general' });
      renderWithProviders(<LoadAllDialog {...defaultProps} contextLabel="conversation" onStartOver={onStartOver} />, {
        preloadedState: createBaseState({
          message: {
            ...base.message,
            ...messageStateWith(base.message, [createMockMessage({ id: '1' })]),
            restored: null,
            pagination: { ...base.message.pagination, hasMore: false },
          },
          channel: { ...base.channel, selectedChannel: channel },
          workspace: {
            ...initialWorkspaceState,
            ready: true,
            currentWid: 'w1',
            list: [{ wid: 'w1', name: 'Default', color: '', bytes: 10, count: 200, conversationCount: 1, lastOpened: 0, openable: true, appVersion: '2.2.5', heldElsewhere: false, isDefault: true, work: null, conversations: [{ cid: 'saved-1', kind: 'channel', name: 'general', guildName: null, parentName: null, count: 200, bytes: 10 }] }],
          } as never,
        }),
      });
      expect(screen.getByTestId('load-all-restored-line')).toHaveTextContent('All 200 messages in this conversation are saved in this workspace.');
      expect(screen.queryByTestId('load-all-confirm')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('load-all-start-over'));
      expect(onStartOver).toHaveBeenCalledTimes(1);
    });

    it('keeps the plain dialog without a Start over handler, on a thread tab, or when nothing was restored', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, { preloadedState: restoredState() });
      expect(screen.queryByTestId('load-all-start-over')).not.toBeInTheDocument();
      expect(screen.getByTestId('load-all-confirm')).toHaveTextContent('Load All');

      const base = createBaseState();
      renderWithProviders(<LoadAllDialog {...defaultProps} onStartOver={vi.fn()} />, {
        preloadedState: createBaseState({ message: { ...base.message, restored: null } }),
      });
      expect(screen.queryByTestId('load-all-restored-line')).not.toBeInTheDocument();
    });
  });

  // 2.2.5 WP4a: an unfinished Load All recorded in the workspace reads Resume.
  it('reads Resume when the open conversation has an unfinished Load All', () => {
    const base = createBaseState();
    renderWithProviders(<LoadAllDialog {...defaultProps} />, {
      preloadedState: createBaseState({
        channel: { ...base.channel, selectedChannel: createMockChannel({ id: 'c1', name: 'general' }) },
        workspace: { ...initialWorkspaceState, actions: { c1: { cid: 'c1', name: 'general', kind: 'loadAll' } } },
      }),
    });
    expect(screen.getByTestId('load-all-confirm')).toHaveTextContent('Resume');
  });

  describe('Confirmation State', () => {
    it('should render dialog title', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText('Load All Messages')).toBeInTheDocument();
    });

    it('should show warning alert', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText(/load all messages from this channel/)).toBeInTheDocument();
    });

    it('should show currently loaded message count', () => {
      const messages = [createMockMessage({ id: 'm1' }), createMockMessage({ id: 'm2' })];
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState({
          message: {
            rows: rowsOf(messages),
            filteredRows: rowsOf(messages),
            selectedIds: [],
            contentMatchIds: null,
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null,
              hasMore: false,
              totalCount: null,
              isLoadingMore: false,
              isLoadingAll: false,
              loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('should show confirmation question', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText('Are you sure you want to continue?')).toBeInTheDocument();
    });

    it('should render Cancel and Load All buttons', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Load All' })).toBeInTheDocument();
    });

    it('should call onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(<LoadAllDialog {...defaultProps} onClose={onClose} />, {
        preloadedState: createBaseState(),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('should call onConfirm when Load All is clicked', () => {
      const onConfirm = vi.fn();
      renderWithProviders(<LoadAllDialog {...defaultProps} onConfirm={onConfirm} />, {
        preloadedState: createBaseState(),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Load All' }));
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  describe('Context-aware text', () => {
    it('should show "channel" when contextLabel is channel', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText(/this channel/)).toBeInTheDocument();
    });

    it('should show "conversation" when contextLabel is conversation', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} contextLabel="conversation" />, {
        preloadedState: createBaseState(),
      });
      expect(screen.getByText(/this conversation/)).toBeInTheDocument();
      expect(screen.getByText(/for conversations with thousands/)).toBeInTheDocument();
    });

    it('should show "thread" when activeTab is set', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState({
          message: {
            rows: rowsOf([]),
            filteredRows: rowsOf([]),
            selectedIds: [],
            contentMatchIds: null,
            searchCriteria: null,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null,
              hasMore: false,
              totalCount: null,
              isLoadingMore: false,
              isLoadingAll: false,
              loadAllProgress: null,
              mode: 'paginated' as any,
            },
            activeTab: 'thread-123',
            threadTabs: {
              'thread-123': {
                threadId: 'thread-123',
                threadName: 'Test Thread',
                rows: rowsOf([]),
                filteredRows: rowsOf([]),
                selectedIds: [],
                contentMatchIds: null,
                searchCriteria: null,
                order: { order: 'desc' as any, orderBy: 'timestamp' },
                isLoading: false,
                error: null,
                pagination: {
                  lastMessageId: null,
                  hasMore: false,
                  totalCount: null,
                  isLoadingMore: false,
                  isLoadingAll: false,
                  loadAllProgress: null,
                  mode: 'paginated' as any,
                },
              },
            },
          } as any,
        }),
      });
      expect(screen.getByText(/this thread/)).toBeInTheDocument();
      expect(screen.getByText(/for threads with thousands/)).toBeInTheDocument();
    });
  });

  describe('Filter-aware copy (#178)', () => {
    const buildFilteredState = (criteria: Record<string, unknown>) =>
      createBaseState({
        message: {
          rows: rowsOf([]),
          filteredRows: rowsOf([]),
          selectedIds: [],
          contentMatchIds: null,
          searchCriteria: criteria as any,
          order: { order: 'desc' as any, orderBy: 'timestamp' },
          isLoading: false,
          isEditing: false,
          error: null,
          pagination: {
            lastMessageId: null,
            hasMore: true,
            totalCount: 1010,
            isLoadingMore: false,
            isLoadingAll: false,
            loadAllProgress: null,
            mode: 'search' as any,
            searchOffset: 0,
          },
        } as any,
      });

    it('uses the filtered title when a search filter is active', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: buildFilteredState({ searchMessageContents: ['hello'] }),
      });
      expect(screen.getByText('Load All Filtered Messages')).toBeInTheDocument();
      expect(screen.queryByText('Load All Messages')).not.toBeInTheDocument();
    });

    it('reports the active filter count in the alert copy', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: buildFilteredState({
          searchMessageContents: ['hello'],
          userIds: ['u1', 'u2'],
        }),
      });
      expect(screen.getByText(/3 active/)).toBeInTheDocument();
      expect(screen.getByText(/matches your active filters/)).toBeInTheDocument();
    });

    it('uses singular wording when exactly one filter is active', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: buildFilteredState({ searchMessageContents: ['hello'] }),
      });
      expect(screen.getByText(/your active filter \(1 active\)/)).toBeInTheDocument();
    });

    it('keeps the default copy when search mode is active but no filters are set', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: buildFilteredState({}),
      });
      expect(screen.getByText('Load All Messages')).toBeInTheDocument();
      expect(screen.getByText(/load all messages from this channel/)).toBeInTheDocument();
    });

    it('keeps the default copy when filters are present but mode is not search', () => {
      renderWithProviders(<LoadAllDialog {...defaultProps} />, {
        preloadedState: createBaseState({
          message: {
            rows: rowsOf([]),
            filteredRows: rowsOf([]),
            selectedIds: [],
            contentMatchIds: null,
            searchCriteria: { searchMessageContents: ['hello'] } as any,
            order: { order: 'desc' as any, orderBy: 'timestamp' },
            isLoading: false,
            isEditing: false,
            error: null,
            pagination: {
              lastMessageId: null,
              hasMore: false,
              totalCount: null,
              isLoadingMore: false,
              isLoadingAll: false,
              loadAllProgress: null,
              mode: 'paginated' as any,
            },
          } as any,
        }),
      });
      expect(screen.getByText('Load All Messages')).toBeInTheDocument();
    });
  });
});
