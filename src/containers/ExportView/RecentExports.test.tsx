import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import RecentExports from './RecentExports';
import { createBaseState } from '@/test/state-factories';
import { defaultSettings } from '@features/app/appSlice';
import type { RecentExport } from '@features/export/exportTypes';

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

function createRecentEntry(overrides: Partial<RecentExport> = {}): RecentExport {
  return {
    id: 'recent-1',
    channelName: 'test-channel',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    isBulk: false,
    config: {
      format: 'html',
      messagesPerPage: 100,
      separateThreads: false,
      includeMedia: true,
      mediaConfig: { images: true, videos: true, audio: true, other: true },
      artistMode: false,
      sortOrder: 'descending',
      previewMedia: true,
    },
    ...overrides,
  };
}

describe('RecentExports', () => {
  function renderRecent(history: RecentExport[] = []) {
    return renderWithProviders(<RecentExports />, {
      preloadedState: createBaseState({
        app: {
          discrubPaused: false,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          task: { status: 'idle', message: '' },
          settings: { ...defaultSettings },
        },
        history: { exports: history, isLoaded: true },
      } as any),
    });
  }

  it('renders nothing for empty history', () => {
    const { container } = renderRecent([]);
    expect(container.firstChild).toBeNull();
  });

  it('shows toggle with count', () => {
    renderRecent([createRecentEntry(), createRecentEntry({ id: 'r2', channelName: 'ch2' }), createRecentEntry({ id: 'r3', channelName: 'ch3' })]);
    expect(screen.getByText('Recent exports (3)')).toBeInTheDocument();
  });

  it('shows channel name on expand', () => {
    renderRecent([createRecentEntry({ channelName: 'my-channel' })]);
    fireEvent.click(screen.getByText('Recent exports (1)'));
    expect(screen.getByText('my-channel')).toBeInTheDocument();
  });

  it('shows format chip', () => {
    renderRecent([createRecentEntry()]);
    fireEvent.click(screen.getByText('Recent exports (1)'));
    expect(screen.getByText('HTML')).toBeInTheDocument();
  });

  it('shows relative timestamp', () => {
    renderRecent([createRecentEntry()]);
    fireEvent.click(screen.getByText('Recent exports (1)'));
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
  });

  it('bulk entries show channel count', () => {
    renderRecent([createRecentEntry({ isBulk: true, channelCount: 3 })]);
    fireEvent.click(screen.getByText('Recent exports (1)'));
    expect(screen.getByText('(3 channels)')).toBeInTheDocument();
  });

  it('a thread, post or DM run names what it counted', () => {
    renderRecent([
      createRecentEntry({ id: 'a', isBulk: true, channelCount: 100, unit: 'thread' }),
      createRecentEntry({ id: 'b', isBulk: true, channelCount: 30, unit: 'post' }),
      createRecentEntry({ id: 'c', isBulk: true, channelCount: 4, unit: 'dm' }),
    ]);
    fireEvent.click(screen.getByText('Recent exports (3)'));
    expect(screen.getByText('(100 threads)')).toBeInTheDocument();
    expect(screen.getByText('(30 posts)')).toBeInTheDocument();
    expect(screen.getByText('(4 DMs)')).toBeInTheDocument();
  });

  it('limits to 5 entries', () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      createRecentEntry({ id: `r-${i}`, channelName: `channel-${i}` })
    );
    renderRecent(entries);
    fireEvent.click(screen.getByText('Recent exports (5)'));
    // Only first 5 should be rendered
    expect(screen.getByText('channel-0')).toBeInTheDocument();
    expect(screen.getByText('channel-4')).toBeInTheDocument();
    expect(screen.queryByText('channel-5')).toBeNull();
  });

  it('clear all button empties history', async () => {
    const { store } = renderRecent([createRecentEntry()]);
    fireEvent.click(screen.getByText('Recent exports (1)'));
    fireEvent.click(screen.getByText('Clear all'));
    // After clearing, the clearRecentExports thunk should empty the slice.
    await vi.waitFor(() => {
      expect(store.getState().history.exports).toEqual([]);
    });
  });
});
