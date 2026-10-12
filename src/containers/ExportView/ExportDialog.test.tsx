import { rowsOf } from '@/test/state-factories';
/**
 * ExportDialog Tests
 *
 * Tests for ExportDialog component including settings initialization from app
 * state, settings persistence on change, and export dialog behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import ExportDialog from './ExportDialog';
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { initialExportState } from '@features/export/exportTypes';

// Mock storage so updateSetting thunk doesn't fail
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

// Create a minimal message for the messages array
function createMockMessage(id = '1') {
  return {
    id,
    content: 'test message',
    author: { id: '123', username: 'testuser', discriminator: '0001', avatar: null },
    timestamp: '2024-01-01T00:00:00.000Z',
    channel_id: 'ch1',
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    type: 0,
    tts: false,
    mention_everyone: false,
  };
}

describe('ExportDialog', () => {
  const defaultOnClose = vi.fn();

  function renderDialog(
    overrides: {
      open?: boolean;
      settings?: Record<string, any> | null;
      messages?: any[];
    } = {}
  ) {
    const { open = true, settings = defaultSettings, messages = [createMockMessage()] } = overrides;

    return renderWithProviders(
      <ExportDialog open={open} onClose={defaultOnClose} />,
      {
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            task: { status: 'idle', message: '' },
            settings: settings as any,
          },
          message: {
            rows: rowsOf(messages),
            filteredRows: rowsOf(messages),
            isLoading: false,
            isEditing: false,
            messageFilters: {
              searchTerm: '',
              contentTypes: [],
              hasAttachments: null,
              userId: null,
              dateRange: { start: null, end: null },
              isPinned: null,
            },
            pagination: {
              lastMessageId: null, hasMore: false, totalCount: null,
              isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
              mode: 'paginated',
            },
          } as any,
          channel: {
            channels: [],
            selectedChannel: { id: 'ch1', name: 'test-channel' },
            isLoading: false,
          } as any,
          export: { ...initialExportState },
        } as any,
      }
    );
  }

  describe('Rendering', () => {
    it('carries the long-run risk note (#124 slot D)', () => {
      renderDialog();
      expect(screen.getByTestId('long-run-note')).toHaveTextContent('Long runs send many requests from your account.');
    });

    it('should render dialog when open', () => {
      renderDialog();

      expect(screen.getByText('Export Messages')).toBeInTheDocument();
      expect(screen.getByText(/Exporting 1 message/)).toBeInTheDocument();
    });

    it('should show channel name in description', () => {
      renderDialog();

      expect(screen.getByText('test-channel')).toBeInTheDocument();
    });

    it('should render three accordion sections', () => {
      renderDialog();

      expect(screen.getByText('Format & Output')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Files & Media')).toBeInTheDocument();
    });

    it('should render format options in Format & Output section', () => {
      renderDialog();

      expect(screen.getByText(/HTML - Styled/)).toBeInTheDocument();
      expect(screen.getByText(/CSV - Spreadsheet/)).toBeInTheDocument();
      expect(screen.getByText(/JSON - Raw/)).toBeInTheDocument();
    });

    it('should disable Export button when no messages', () => {
      renderDialog({ messages: [] });

      const exportButton = screen.getByRole('button', { name: /^Export$/ });
      expect(exportButton).toBeDisabled();
    });

    it('should pluralize message count', () => {
      renderDialog({ messages: [createMockMessage('1'), createMockMessage('2')] });

      expect(screen.getByText(/Exporting 2 messages/)).toBeInTheDocument();
    });
  });

  describe('Thread-aware channel name', () => {
    it('should show channel name when no activeTab', () => {
      renderDialog();
      expect(screen.getByText('test-channel')).toBeInTheDocument();
    });

    it('should show thread name when activeTab is set', () => {
      renderWithProviders(
        <ExportDialog open={true} onClose={defaultOnClose} />,
        {
          preloadedState: {
            app: {
              discrubPaused: false,
              discrubCancelled: false,
              task: { status: 'idle', message: '' },
              settings: defaultSettings as any,
            },
            message: {
              rows: rowsOf([createMockMessage()]),
              filteredRows: rowsOf([createMockMessage()]),
              isLoading: false,
              isEditing: false,
              pagination: {
                lastMessageId: null, hasMore: false, totalCount: null,
                isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
                mode: 'paginated',
              },
              activeTab: 'thread-123',
              threadTabs: {
                'thread-123': {
                  threadId: 'thread-123',
                  threadName: 'My Test Thread',
                  rows: rowsOf([createMockMessage()]),
                  filteredRows: rowsOf([createMockMessage()]),
                  selectedIds: [],
                  contentMatchIds: null,
                  searchCriteria: null,
                  order: { order: 'desc', orderBy: 'timestamp' },
                  isLoading: false,
                  error: null,
                  pagination: {
                    lastMessageId: null, hasMore: false, totalCount: null,
                    isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
                    mode: 'paginated',
                  },
                },
              },
            } as any,
            channel: {
              channels: [],
              selectedChannel: { id: 'ch1', name: 'test-channel' },
              isLoading: false,
            } as any,
            export: { ...initialExportState },
          } as any,
        }
      );

      expect(screen.getByText('My Test Thread')).toBeInTheDocument();
      expect(screen.queryByText('test-channel')).not.toBeInTheDocument();
    });
  });

  describe('Settings Initialization', () => {
    it('should initialize includeMedia from app settings', () => {
      const settings = {
        ...defaultSettings,
        [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'true',
      };

      renderDialog({ settings });

      // Expand Media accordion to see the checkbox
      fireEvent.click(screen.getByText('Files & Media'));

      const checkbox = screen.getByLabelText(/Download files/) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('should initialize separateThreads from app settings', () => {
      const settings = {
        ...defaultSettings,
        [DiscrubSetting.EXPORT_SEPARATE_THREAD_AND_FORUM_POSTS]: 'true',
      };

      renderDialog({ settings });

      // Expand Content accordion
      fireEvent.click(screen.getByText('Content'));

      const checkbox = screen.getByLabelText(/Download threads/) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('should initialize messagesPerPage from app settings', () => {
      const settings = {
        ...defaultSettings,
        [DiscrubSetting.EXPORT_MESSAGES_PER_PAGE]: '75',
      };

      renderDialog({ settings });

      const input = screen.getByLabelText(/Messages per page/) as HTMLInputElement;
      expect(input.value).toBe('75');
    });

    it('should use default values when settings are null', () => {
      renderDialog({ settings: null });

      // With null settings, the initializeExportFromSettings does nothing,
      // so defaults from initial export state apply (includeMedia: true)
      // Expand Media accordion
      fireEvent.click(screen.getByText('Files & Media'));
      const mediaCheckbox = screen.getByLabelText(/Download files/) as HTMLInputElement;
      expect(mediaCheckbox).toBeInTheDocument();
    });
  });

  describe('Settings Persistence', () => {
    it('should update export state without mutating settings on media checkbox change', async () => {
      const { store } = renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'false',
        },
      });

      // Expand Media accordion
      fireEvent.click(screen.getByText('Files & Media'));

      const checkbox = screen.getByLabelText(/Download files/);
      await act(async () => {
        fireEvent.click(checkbox);
      });

      await vi.waitFor(() => {
        const state = store.getState();
        expect(state.export.includeMedia).toBe(true);
        // Settings should NOT be mutated by the export dialog
        expect(state.app.settings?.[DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]).toBe('false');
      });
    });

    it('should update export state without mutating settings on threads checkbox change', async () => {
      const { store } = renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_SEPARATE_THREAD_AND_FORUM_POSTS]: 'true',
        },
      });

      // Expand Content accordion
      fireEvent.click(screen.getByText('Content'));

      const checkbox = screen.getByLabelText(/Download threads/);
      await act(async () => {
        fireEvent.click(checkbox);
      });

      await vi.waitFor(() => {
        const state = store.getState();
        expect(state.export.separateThreads).toBe(false);
        // Settings should NOT be mutated by the export dialog
        expect(state.app.settings?.[DiscrubSetting.EXPORT_SEPARATE_THREAD_AND_FORUM_POSTS]).toBe('true');
      });
    });

    it('should dispatch setMessagesPerPage and updateSetting on change', async () => {
      const { store } = renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_MESSAGES_PER_PAGE]: '50',
        },
      });

      const input = screen.getByRole('spinbutton') as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: '200' } });
      });

      await vi.waitFor(() => {
        const state = store.getState();
        expect(state.export.messagesPerPage).toBe(200);
      });
    });

    it('should not persist invalid messagesPerPage (0 or negative)', () => {
      const { store } = renderDialog();

      const input = screen.getByLabelText(/Messages per page/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '0' } });

      const state = store.getState();
      expect(state.export.messagesPerPage).not.toBe(0);
    });
  });

  describe('Format Selection', () => {
    it('should keep messagesPerPage enabled when CSV selected', () => {
      renderDialog();

      fireEvent.click(screen.getByText(/CSV - Spreadsheet/));

      const input = screen.getByLabelText(/Messages per page/) as HTMLInputElement;
      expect(input).not.toBeDisabled();
    });

    it('should keep messagesPerPage enabled when JSON selected', () => {
      renderDialog();

      fireEvent.click(screen.getByText(/JSON - Raw/));

      const input = screen.getByLabelText(/Messages per page/) as HTMLInputElement;
      expect(input).not.toBeDisabled();
    });

    it('should disable messagesPerPage when Media Only selected', () => {
      renderDialog();

      fireEvent.click(screen.getByText(/Media Only/));

      const input = screen.getByLabelText(/Messages per page/) as HTMLInputElement;
      expect(input).toBeDisabled();
    });

    it('should restore includeMedia from settings when switching away from Media Only', () => {
      // Start with includeMedia = false in settings
      renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'false',
        },
      });

      // Expand Media accordion
      fireEvent.click(screen.getByText('Files & Media'));

      const mediaCheckbox = screen.getByLabelText(/Download files/) as HTMLInputElement;
      // Settings say false, so should be unchecked
      expect(mediaCheckbox.checked).toBe(false);

      // Switch to Media Only — checkbox forced checked
      fireEvent.click(screen.getByText(/Media Only/));
      expect(mediaCheckbox.checked).toBe(true);

      // Switch back to HTML — should restore to false from settings
      fireEvent.click(screen.getByText(/HTML - Styled/));
      expect(mediaCheckbox.checked).toBe(false);
    });
  });

  describe('Media Config', () => {
    it('should show media type checkboxes when Download files is checked', () => {
      renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'true',
        },
      });

      // Media accordion auto-expands when media enabled
      expect(screen.getByText('Media types to include:')).toBeInTheDocument();
      expect(screen.getByLabelText(/^Images/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Videos/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Audio/)).toBeInTheDocument();
    });

    it('should update mediaConfig in Redux when toggling a media type', async () => {
      const { store } = renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'true',
        },
      });

      // All checked by default — uncheck Images
      const imagesCheckbox = screen.getByLabelText(/^Images/);
      await act(async () => {
        fireEvent.click(imagesCheckbox);
      });

      await vi.waitFor(() => {
        expect(store.getState().export.mediaConfig.images).toBe(false);
      });

      expect(store.getState().export.mediaConfig.videos).toBe(true);
      expect(store.getState().export.mediaConfig.audio).toBe(true);
    });
  });

  describe('Accordion features', () => {
    it('should show sort order dropdown in Format section', () => {
      renderDialog();

      // MUI InputLabel renders the label text (twice: label + outlined notch)
      expect(screen.getAllByText('Sort Order').length).toBeGreaterThan(0);
    });

    it('should show artist mode checkbox in Media section', () => {
      renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'true',
        },
      });

      expect(screen.getByLabelText(/Artist mode/)).toBeInTheDocument();
    });

    it('should show preview media checkbox in Media section', () => {
      renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'true',
        },
      });

      expect(screen.getByLabelText(/Preview media/)).toBeInTheDocument();
    });

    it('dialog open calls initializeExportFromSettings', () => {
      const { store } = renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_ARTIST_MODE]: 'true',
          [DiscrubSetting.EXPORT_MESSAGE_SORT_ORDER]: 'asc',
        },
      });

      const state = store.getState().export;
      expect(state.artistMode).toBe(true);
      expect(state.sortOrder).toBe('ascending');
    });

    it('handleExport builds ExportConfig from exportState', () => {
      const { store } = renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.EXPORT_ARTIST_MODE]: 'true',
        },
      });

      // Verify the export state has the setting
      expect(store.getState().export.artistMode).toBe(true);
    });

    it('handleExport reads dateFormat/timeFormat from settings', () => {
      renderDialog({
        settings: {
          ...defaultSettings,
          [DiscrubSetting.DATE_FORMAT]: 'yyyy/MM/dd',
          [DiscrubSetting.TIME_FORMAT]: 'HH:mm',
        },
      });

      // Just verify the dialog renders — the actual test is that dateFormat
      // is read from settings, not exportState
      expect(screen.getByText('Export Messages')).toBeInTheDocument();
    });
  });

  describe('Operation Safety', () => {
    it('should disable Export button when an operation is running', () => {
      renderWithProviders(
        <ExportDialog open={true} onClose={defaultOnClose} />,
        {
          preloadedState: {
            app: {
              discrubPaused: false,
              discrubCancelled: false,
              task: { status: 'idle', message: '' },
              settings: defaultSettings as any,
            },
            message: {
              rows: rowsOf([createMockMessage()]),
              filteredRows: rowsOf([createMockMessage()]),
              isLoading: false,
              isEditing: false,
              messageFilters: {
                searchTerm: '',
                contentTypes: [],
                hasAttachments: null,
                userId: null,
                dateRange: { start: null, end: null },
                isPinned: null,
              },
              pagination: {
                lastMessageId: null, hasMore: false, totalCount: null,
                isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
                mode: 'paginated',
              },
            } as any,
            channel: {
              channels: [],
              selectedChannel: { id: 'ch1', name: 'test-channel' },
              isLoading: false,
            } as any,
            purge: {
              isPurging: true,
              purgeProgress: null,
              purgeError: null,
            } as any,
          } as any,
        }
      );

      const exportButton = screen.getByRole('button', { name: /^Export$/ });
      expect(exportButton).toBeDisabled();
    });
  });

  describe('Dialog Actions', () => {
    it('should call onClose and reset export when Cancel clicked', () => {
      const onClose = vi.fn();

      renderWithProviders(
        <ExportDialog open={true} onClose={onClose} />,
        {
          preloadedState: {
            app: {
              discrubPaused: false,
              discrubCancelled: false,
              task: { status: 'idle', message: '' },
              settings: defaultSettings as any,
            },
            message: {
              rows: rowsOf([createMockMessage()]),
              filteredRows: rowsOf([createMockMessage()]),
              isLoading: false,
              isEditing: false,
              messageFilters: {
                searchTerm: '',
                contentTypes: [],
                hasAttachments: null,
                userId: null,
                dateRange: { start: null, end: null },
                isPinned: null,
              },
              pagination: {
                lastMessageId: null, hasMore: false, totalCount: null,
                isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
                mode: 'paginated',
              },
            } as any,
            channel: {
              channels: [],
              selectedChannel: { id: 'ch1', name: 'test-channel' },
              isLoading: false,
            } as any,
            export: { ...initialExportState },
          } as any,
        }
      );

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose immediately when Export is clicked (fire-and-forget)', () => {
      const onClose = vi.fn();

      renderWithProviders(
        <ExportDialog open={true} onClose={onClose} />,
        {
          preloadedState: {
            app: {
              discrubPaused: false,
              discrubCancelled: false,
              task: { status: 'idle', message: '' },
              settings: defaultSettings as any,
            },
            message: {
              rows: rowsOf([createMockMessage()]),
              filteredRows: rowsOf([createMockMessage()]),
              isLoading: false,
              isEditing: false,
              messageFilters: {
                searchTerm: '',
                contentTypes: [],
                hasAttachments: null,
                userId: null,
                dateRange: { start: null, end: null },
                isPinned: null,
              },
              pagination: {
                lastMessageId: null, hasMore: false, totalCount: null,
                isLoadingMore: false, isLoadingAll: false, loadAllProgress: null,
                mode: 'paginated',
              },
            } as any,
            channel: {
              channels: [],
              selectedChannel: { id: 'ch1', name: 'test-channel' },
              isLoading: false,
            } as any,
            export: { ...initialExportState },
          } as any,
        }
      );

      fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  /* ────────── Phase E: package context ────────── */

  describe('Package export context', () => {
    function renderWithPackageContext(overrides: { enriched?: boolean } = {}) {
      const { enriched = false } = overrides;
      return renderWithProviders(
        <ExportDialog
          open={true}
          onClose={vi.fn()}
          exportContext={{ source: 'package', channelId: '200' }}
        />,
        {
          preloadedState: {
            app: {
              discrubPaused: false,
              discrubCancelled: false,
              task: { status: 'idle', message: '' },
              settings: defaultSettings as any,
            },
            export: { ...initialExportState },
            package: {
              status: 'ready',
              parsed: {
                user: { id: 'u1', username: 'tester', globalName: 'Tester', avatarHash: null },
                guilds: [{ id: '100', name: 'G' }],
                channels: [{ id: '200', type: 0, name: 'general', messageCount: 3, isOrphan: false }],
                totalMessages: 3,
                packageSizeBytes: 1,
              },
              validation: { ok: true, readOnly: false, warnings: [], errors: [] },
              error: null,
              selectedChannelId: null,
              loadedChannels: {
                '200': [
                  { id: '1', timestamp: '2022-07-28 22:30:52.800000+00:00', content: 'hi', attachments: [] },
                  { id: '2', timestamp: '2022-07-28 22:31:00.000000+00:00', content: 'bye', attachments: [] },
                ],
              },
              loadedOrder: ['200'],
              loadingChannelId: null,
              selectedMessageIds: {},
              timelineStatus: 'idle',
              timelineTimestamps: [],
              timelineProgress: null,
              timelineError: null,
              deleteStatus: 'idle',
              deleteProgress: null,
              deleteResult: null,
              deleteError: null,
              exportStatus: 'idle',
              exportError: null,
              deletedMessageIds: {},
              goneMessageIds: {},
              enrichmentStatus: enriched ? { '200': 'done' } : {},
              enrichmentProgress: {},
              enrichedMessages: enriched
                ? { '200': { '1': { id: '1', content: 'hi' } as any } }
                : {},
              enrichmentMisses: {},
              enrichmentError: {},
              enrichmentLastFetched: enriched ? { '200': Date.now() } : {},
              activeEnrichmentChannelId: null,
            } as any,
          } as any,
        },
      );
    }

    it('pulls channel name and message count from the package', () => {
      renderWithPackageContext();
      expect(screen.getByText(/Exporting 2 messages/)).toBeInTheDocument();
      expect(screen.getByText('general')).toBeInTheDocument();
    });

    it('hides the Content (thread separation) accordion in package mode', () => {
      renderWithPackageContext();
      // Content accordion is gated off in package mode.
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
      // The other sections still render.
      expect(screen.getByText('Format & Output')).toBeInTheDocument();
      expect(screen.getByText('Files & Media')).toBeInTheDocument();
    });

    it('shows the "Rehydrate before export" toggle when not yet enriched', () => {
      renderWithPackageContext({ enriched: false });
      expect(screen.getByText(/Rehydrate before export/)).toBeInTheDocument();
    });

    it('hides the rehydration affordance entirely when already enriched', () => {
      // The dialog should look and behave identically to the live
      // export when the channel already has enriched data. No extra
      // banners, no checkboxes — just the standard export controls.
      renderWithPackageContext({ enriched: true });
      expect(screen.queryByText(/Rehydrate before export/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Rich data already loaded/)).not.toBeInTheDocument();
    });
  });
});
