import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import ThreadTabBar from './ThreadTabBar';
import { createBaseState } from '../../test/state-factories';
import { initialMessageState, initialPaginationState } from '@features/message/messageTypes';

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

function renderTabBar(
  messageOverrides: Partial<typeof initialMessageState> = {},
  channelName = 'general'
) {
  return renderWithProviders(
    <ThreadTabBar channelName={channelName} />,
    {
      preloadedState: createBaseState({
        message: { ...initialMessageState, ...messageOverrides },
      }),
    }
  );
}

const makeThreadTab = (id: string, name: string) => ({
  threadId: id,
  threadName: name,
  rows: [],
  filteredRows: [],
  selectedIds: [],
  contentMatchIds: null,
  searchCriteria: null, refineCriteria: null,
  order: initialMessageState.order,
  isLoading: false,
  error: null,
  pagination: { ...initialPaginationState },
});

describe('ThreadTabBar', () => {
  it('should render tab bar container even with no thread tabs', () => {
    renderTabBar({});
    expect(screen.getByTestId('thread-tab-bar')).toBeInTheDocument();
    // Only the main tab should exist
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
  });

  it('should show all tabs when multiple threads are open', () => {
    renderTabBar({
      threadTabs: {
        't1': makeThreadTab('t1', 'Thread A'),
        't2': makeThreadTab('t2', 'Thread B'),
        't3': makeThreadTab('t3', 'Thread C'),
      },
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4); // main + 3 threads
  });

  it('should render main tab with channel name', () => {
    renderTabBar({}, 'general');
    expect(screen.getByText('general')).toBeInTheDocument();
  });

  it('should render thread tabs', () => {
    renderTabBar({
      threadTabs: {
        't1': makeThreadTab('t1', 'Bug Discussion'),
        't2': makeThreadTab('t2', 'Feature Request'),
      },
    });
    expect(screen.getByText('Bug Discussion')).toBeInTheDocument();
    expect(screen.getByText('Feature Request')).toBeInTheDocument();
  });

  it('should highlight main tab when activeTab is null', () => {
    renderTabBar({
      activeTab: null,
      threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
    });
    const mainTab = screen.getByRole('tab', { name: 'general' });
    expect(mainTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should highlight thread tab when activeTab matches', () => {
    renderTabBar({
      activeTab: 't1',
      threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
    });
    // The thread tab label includes both the text and the close button
    const threadTab = screen.getByRole('tab', { name: /Thread 1/ });
    expect(threadTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should switch to main tab on click', () => {
    const { store } = renderTabBar({
      activeTab: 't1',
      threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'general' }));
    expect(store.getState().message.activeTab).toBeNull();
  });

  it('should switch to thread tab on click', () => {
    const { store } = renderTabBar({
      activeTab: null,
      threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
    });

    fireEvent.click(screen.getByRole('tab', { name: /Thread 1/ }));
    expect(store.getState().message.activeTab).toBe('t1');
  });

  it('should remove thread tab when close button clicked', () => {
    const { store } = renderTabBar({
      activeTab: 't1',
      threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
    });

    const closeButton = screen.getByRole('button', { name: '' });
    fireEvent.click(closeButton);
    expect(store.getState().message.threadTabs['t1']).toBeUndefined();
    expect(store.getState().message.activeTab).toBeNull();
  });

  it('should not remove thread tab when operation is running', () => {
    const { store } = renderWithProviders(
      <ThreadTabBar channelName="general" />,
      {
        preloadedState: createBaseState({
          message: {
            ...initialMessageState,
            activeTab: 't1',
            threadTabs: { 't1': makeThreadTab('t1', 'Thread 1') },
          },
          export: {
            ...createBaseState().export,
            isExporting: true,
          } as any,
        }),
      }
    );

    const closeButton = screen.getByRole('button', { name: '' });
    fireEvent.click(closeButton);
    // Tab should still exist
    expect(store.getState().message.threadTabs['t1']).toBeDefined();
  });
});
