/**
 * 2.2.5 WP6c: with a workspace open the Export dialog hands the thunk the
 * conversation in the store instead of hydrating every message.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import { rowsOf } from '@/test/state-factories';
import ExportDialog from './ExportDialog';
import { defaultSettings } from '@features/app/appSlice';
import { initialExportState } from '@features/export/exportTypes';
import { initialWorkspaceState } from '@features/workspace/workspaceSlice';
import { createMockMessages } from '@/test/fixtures';
import { exportMessages } from '@features/export/exportSlice';

vi.mock('@features/export/exportSlice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/export/exportSlice')>();
  return { ...actual, exportMessages: vi.fn((arg: unknown) => ({ type: 'test/exportMessages', payload: arg })) };
});

vi.mock('@/extension/storage', () => {
  const adapter = () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    getMany: vi.fn().mockResolvedValue([]),
    setMany: vi.fn().mockResolvedValue(undefined),
    entries: vi.fn().mockResolvedValue([]),
  });
  return {
    storage: { settings: adapter(), state: adapter(), presets: adapter(), cache: adapter(), history: adapter(), statuslog: adapter(), package: adapter(), media: adapter() },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

describe('ExportDialog with a workspace open', () => {
  it('dispatches the store reference and the ids on screen, not the messages', () => {
    const messages = createMockMessages(2);
    renderWithProviders(<ExportDialog open onClose={vi.fn()} />, {
      preloadedState: {
        app: { discrubPaused: false, discrubCancelled: false, task: { status: 'idle', message: '' }, settings: defaultSettings },
        message: { rows: rowsOf(messages), filteredRows: rowsOf(messages), threadTabs: {}, activeTab: null, pagination: { mode: 'paginated', lastMessageId: null, hasMore: false, totalCount: null } },
        channel: { channels: [], selectedChannel: { id: 'ch1', name: 'general' }, isLoading: false },
        workspace: { ...initialWorkspaceState, ready: true, currentWid: 'default', currentName: 'Default' },
        export: { ...initialExportState },
      } as never,
    });
    expect(screen.getByText(/Exporting 2 messages/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('export-confirm'));
    expect(exportMessages).toHaveBeenCalledWith(expect.objectContaining({
      store: { wid: 'default', cid: 'ch1', container: 'main', ids: ['msg-1', 'msg-2'] },
      channelName: 'general',
    }));
    expect((vi.mocked(exportMessages).mock.calls[0][0] as { messages?: unknown }).messages).toBeUndefined();
  });
});
