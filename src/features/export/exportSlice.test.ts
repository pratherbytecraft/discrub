import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestStore, TestStore } from '@/test/test-utils';

// A status-less failure only counts as "the network" while the browser is
// offline; online it is a refused request and stops instead of pausing.
const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
};

import exportReducer, {
  buildUniqueFolderNames,
  createReactionProgressLogger,
  dmExportName,
  exportMessages,
  setExportFormat,
  setMessagesPerPage,
  setSeparateThreads,
  setIncludeMedia,
  setExportProgress,
  setTotalPages,
  setArtistMode,
  setSortOrder,
  setPreviewMedia,
  setMaxZipPartBytes,
  applyPreset,
  initializeExportFromSettings,
  resetExport,
  setTextOptions,
  setExportCriteria,
  selectExportCriteria,
  selectExport,
  selectIsExporting,
  selectExportProgress,
  selectExportFormat,
  selectExportError,
  selectTextOptions,
} from './exportSlice';
import cacheReducer from '@features/cache/cacheSlice';
import { initialExportState, MediaDownloadProgress, DEFAULT_MAX_ZIP_PART_BYTES } from './exportTypes';
import { createMockMessages } from '@/test/fixtures';
import * as exportService from '@services/exportService';

// Mock the export service
vi.mock('@services/exportService', () => ({
  getExportService: vi.fn(() => ({
    exportToZip: vi.fn(),
    exportMediaOnly: vi.fn(),
    setExportThemeSet: vi.fn(),
    getExportThemeSet: vi.fn(() => ({ defaultId: 'discord-dark', themes: [] })),
  })),
  generateExportReadme: vi.fn(() => 'README'),
}));

vi.mock('@services/reactionEnrichmentService', () => ({
  reactionEnrichmentService: {
    enrichMessages: vi.fn().mockImplementation(async (msgs) => msgs),
  },
}));

// Bulk-export-with-searchCriteria reaches into the search iterator,
// constructs a StreamingZipService, and pulls from discordService.
// These mocks let the bulk thunk run synthetically without touching
// the network or the filesystem; existing tests don't call any of
// these surfaces, so the mocks are harmless to other suites in this
// file.
vi.mock('@/utils/searchPagination', async () => {
  const actual = await vi.importActual<any>('@/utils/searchPagination');
  return {
    ...actual,
    iterateSearchMessagesRedux: vi.fn(),
  };
});

vi.mock('@services/streamingZipService', () => ({
  StreamingZipService: class {
    async addFile() {}
    async finalize() {}
    dispose() {}
  },
}));

vi.mock('@services/exportDiscordShell', () => ({
  generateDiscordShellBulk: vi.fn(() => '<html></html>'),
  generateDiscordShellSingle: vi.fn(() => '<html></html>'),
}));

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchMessageData: vi.fn(),
    fetchSearchMessageData: vi.fn(),
    iterateSearchResults: async function* () {},
  })),
}));

// Skip the real per-page delay (1s default) so unfiltered-branch walk
// tests don't wait seconds per page. Existing tests didn't need this
// because they don't reach the delay path.
vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({ delayMs: 0, delaySec: 0, baseDelay: 0, modifier: 0, randomComponent: 0 })),
}));
vi.mock('@/utils/operationLoopUtils', async () => {
  const actual = await vi.importActual<any>('@/utils/operationLoopUtils');
  return {
    ...actual,
    cancellableDelay: vi.fn().mockResolvedValue(false),
    waitWhilePaused: vi.fn().mockResolvedValue(undefined),
    // Instant fake of withTransientRetry — same retry+predicate contract
    // as the real helper minus the exponential backoff sleep (timing is
    // covered by operationLoopUtils.test.ts).
    withTransientRetry: vi.fn(async (fn: () => Promise<any>, opts: any) => {
      const maxRetries = opts.maxRetries ?? 5;
      const shouldRetry = opts.shouldRetry ?? actual.isTransientApiFailure;
      let lastResponse: any = { success: false };
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (actual.checkCancelled(opts.getState)) return lastResponse;
        lastResponse = await fn();
        if (lastResponse.success || !shouldRetry(lastResponse, attempt)) return lastResponse;
        if (attempt === maxRetries) return lastResponse;
        opts.onRetry?.(attempt + 1, 1000, lastResponse);
      }
      return lastResponse;
    }),
  };
});

describe('exportSlice', () => {
  let store: TestStore;

  beforeEach(() => {
    store = createTestStore({ export: exportReducer, cache: cacheReducer });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = store.getState();
      expect(state.export).toEqual(initialExportState);
      expect(state.export.isExporting).toBe(false);
      expect(state.export.exportFormat).toBe('html');
      expect(state.export.messagesPerPage).toBe(100);
      expect(state.export.separateThreads).toBe(false);
      expect(state.export.includeMedia).toBe(true);
    });
  });

  describe('reducers', () => {
    it('should set export format', () => {
      store.dispatch(setExportFormat('csv'));
      expect(store.getState().export.exportFormat).toBe('csv');

      store.dispatch(setExportFormat('json'));
      expect(store.getState().export.exportFormat).toBe('json');

      store.dispatch(setExportFormat('html'));
      expect(store.getState().export.exportFormat).toBe('html');
    });

    it('should set messages per page', () => {
      store.dispatch(setMessagesPerPage(50));
      expect(store.getState().export.messagesPerPage).toBe(50);

      store.dispatch(setMessagesPerPage(200));
      expect(store.getState().export.messagesPerPage).toBe(200);
    });

    it('should set separate threads flag', () => {
      expect(store.getState().export.separateThreads).toBe(false);

      store.dispatch(setSeparateThreads(true));
      expect(store.getState().export.separateThreads).toBe(true);

      store.dispatch(setSeparateThreads(false));
      expect(store.getState().export.separateThreads).toBe(false);
    });

    it('should set include media flag', () => {
      expect(store.getState().export.includeMedia).toBe(true);

      store.dispatch(setIncludeMedia(false));
      expect(store.getState().export.includeMedia).toBe(false);

      store.dispatch(setIncludeMedia(true));
      expect(store.getState().export.includeMedia).toBe(true);
    });

    it('should set export progress', () => {
      const progress: MediaDownloadProgress = {
        stage: 'avatars',
        current: 5,
        total: 10,
        message: 'Downloading avatars...',
      };

      store.dispatch(setExportProgress(progress));
      expect(store.getState().export.exportProgress).toEqual(progress);
    });

    it('should update export progress stages', () => {
      const stages: MediaDownloadProgress['stage'][] = [
        'avatars',
        'attachments',
        'emojis',
        'roles',
        'html',
        'finalizing',
      ];

      stages.forEach((stage, index) => {
        const progress: MediaDownloadProgress = {
          stage,
          current: index + 1,
          total: stages.length,
        };

        store.dispatch(setExportProgress(progress));
        expect(store.getState().export.exportProgress?.stage).toBe(stage);
      });
    });

    it('should set total pages', () => {
      store.dispatch(setTotalPages(5));
      expect(store.getState().export.totalPages).toBe(5);

      store.dispatch(setTotalPages(10));
      expect(store.getState().export.totalPages).toBe(10);
    });

    it('should reset export state', () => {
      // Set some state first
      store.dispatch(setExportFormat('csv'));
      store.dispatch(setMessagesPerPage(50));
      store.dispatch(setTotalPages(5));
      store.dispatch(setExportProgress({
        stage: 'avatars',
        current: 5,
        total: 10,
      }));

      // Reset should only reset certain fields
      store.dispatch(resetExport());

      const state = store.getState().export;
      expect(state.isExporting).toBe(false);
      expect(state.exportProgress).toBeNull();
      expect(state.exportTotal).toBe(0);
      expect(state.currentPage).toBe(0);
      expect(state.totalPages).toBe(0);
      expect(state.exportError).toBeNull();

      // These should remain unchanged
      expect(state.exportFormat).toBe('csv');
      expect(state.messagesPerPage).toBe(50);
    });
  });

  describe('exportMessages async thunk', () => {
    it('should handle successful export', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      const result = await store.dispatch(exportMessages(params));

      expect(result.type).toBe('export/exportMessages/fulfilled');
      expect(result.payload).toEqual({ success: true });
      expect(mockExportService.exportToZip).toHaveBeenCalledWith(
        messages,
        'test-channel',
        'html',
        100,
        true,
        null,
        {},
        null,
        expect.any(Function),
        undefined,
        undefined,
        expect.any(Function),
        undefined,
        false,
        [],
        undefined,
        [],
        expect.objectContaining({
          attachmentStyle: 'inline',
          reactions: 'include',
          replies: 'quote',
          botIndicator: 'include',
        }),
        expect.objectContaining({ onPartStart: expect.any(Function), onOversizeFile: expect.any(Function) }), // zipOptions (#207 Arm A)
        expect.any(Function), // onRowError (#230)
      );

      const state = store.getState().export;
      expect(state.isExporting).toBe(false);
      expect(state.exportError).toBeNull();
    });

    it('should set isExporting to true when pending', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      store.dispatch(exportMessages(params));

      // Check immediately after dispatch (pending state)
      const state = store.getState().export;
      expect(state.isExporting).toBe(true);
      expect(state.exportError).toBeNull();
      expect(state.exportProgress).toBeNull();
    });

    it('should handle export error', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockRejectedValue(new Error('Export failed')),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      const result = await store.dispatch(exportMessages(params));

      expect(result.type).toBe('export/exportMessages/rejected');
      expect(result.payload).toBe('Export failed');

      const state = store.getState().export;
      expect(state.isExporting).toBe(false);
      expect(state.exportError).toBe('Export failed');
    });

    it('should handle non-Error exceptions', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockRejectedValue('String error'),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      const result = await store.dispatch(exportMessages(params));

      expect(result.type).toBe('export/exportMessages/rejected');
      expect(result.payload).toBe('Failed to export messages');
    });

    it('should dispatch progress updates during export', async () => {
      const capturedProgressUpdates: MediaDownloadProgress[] = [];

      const mockExportService = {
        exportToZip: vi.fn().mockImplementation(async (
          _messages,
          _channelName,
          _format,
          _messagesPerPage,
          _includeMedia,
          _guild,
          _cachedUserMap,
          _guildId,
          progressCallback
        ) => {
          // Simulate progress updates
          const progress1 = { stage: 'avatars' as const, current: 5, total: 10 };
          const progress2 = { stage: 'attachments' as const, current: 10, total: 10 };

          progressCallback(progress1);
          capturedProgressUpdates.push(progress1);

          progressCallback(progress2);
          capturedProgressUpdates.push(progress2);
        }),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      await store.dispatch(exportMessages(params));

      // After export completes, exportProgress is set to null
      // But we can verify the progress callbacks were called
      expect(capturedProgressUpdates).toHaveLength(2);
      expect(capturedProgressUpdates[0]).toEqual({
        stage: 'avatars',
        current: 5,
        total: 10,
      });
      expect(capturedProgressUpdates[1]).toEqual({
        stage: 'attachments',
        current: 10,
        total: 10,
      });

      // exportProgress is null after successful completion
      const state = store.getState().export;
      expect(state.exportProgress).toBeNull();
    });

    it('should not dispatch non-object progress updates', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockImplementation(async (
          _messages,
          _channelName,
          _format,
          _messagesPerPage,
          _includeMedia,
          _guild,
          _cachedUserMap,
          _guildId,
          progressCallback
        ) => {
          // Try to pass a number (should be ignored)
          progressCallback(5);
        }),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      await store.dispatch(exportMessages(params));

      // Progress should still be null since number was ignored
      const state = store.getState().export;
      expect(state.exportProgress).toBeNull();
    });

    it('should use cached user map from state', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      // Set up cached user data
      const mockUserMap = {
        'user1': { userName: 'Test User', timestamp: Date.now() },
      };
      store.dispatch({ type: 'cache/setUserMapInMemory', payload: mockUserMap });

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'html' as const,
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: true,
      };

      await store.dispatch(exportMessages(params));

      // Verify cachedUserMap was passed to exportService
      expect(mockExportService.exportToZip).toHaveBeenCalledWith(
        messages,
        'test-channel',
        'html',
        100,
        true,
        null,
        mockUserMap,
        null,
        expect.any(Function),
        undefined,
        undefined,
        expect.any(Function),
        undefined,
        false,
        [],
        undefined,
        [],
        expect.any(Object), // textOptions (#184)
        expect.objectContaining({ onPartStart: expect.any(Function), onOversizeFile: expect.any(Function) }), // zipOptions (#207 Arm A)
        expect.any(Function), // onRowError (#230)
      );
    });

    it('should pass guildId when provided', async () => {
      const mockExportService = {
        exportToZip: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const messages = createMockMessages(5);
      const params = {
        messages,
        channelName: 'test-channel',
        format: 'csv' as const,
        messagesPerPage: 50,
        separateThreads: true,
        includeMedia: false,
        guildId: 'guild-123',
      };

      await store.dispatch(exportMessages(params));

      expect(mockExportService.exportToZip).toHaveBeenCalledWith(
        messages,
        'test-channel',
        'csv',
        50,
        false,
        null,
        {},
        'guild-123',
        expect.any(Function),
        undefined,
        undefined,
        expect.any(Function),
        undefined,
        true,
        [],
        undefined,
        [],
        expect.any(Object), // textOptions (#184)
        expect.objectContaining({ onPartStart: expect.any(Function), onOversizeFile: expect.any(Function) }), // zipOptions (#207 Arm A)
        expect.any(Function), // onRowError (#230)
      );
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      store.dispatch(setExportFormat('csv'));
      store.dispatch(setMessagesPerPage(50));
      store.dispatch(setExportProgress({
        stage: 'avatars',
        current: 5,
        total: 10,
      }));
    });

    it('selectExport should return entire export state', () => {
      const exportState = selectExport(store.getState());
      expect(exportState).toHaveProperty('isExporting');
      expect(exportState).toHaveProperty('exportFormat');
      expect(exportState).toHaveProperty('exportProgress');
    });

    it('selectIsExporting should return isExporting flag', () => {
      expect(selectIsExporting(store.getState())).toBe(false);
    });

    it('selectExportProgress should return export progress', () => {
      const progress = selectExportProgress(store.getState());
      expect(progress).toEqual({
        stage: 'avatars',
        current: 5,
        total: 10,
      });
    });

    it('selectExportFormat should return export format', () => {
      expect(selectExportFormat(store.getState())).toBe('csv');
    });

    it('selectExportError should return export error', () => {
      expect(selectExportError(store.getState())).toBeNull();

      // Set an error state by simulating a rejected export
      store.dispatch({
        type: 'export/exportMessages/rejected',
        payload: 'Test error',
      });

      expect(selectExportError(store.getState())).toBe('Test error');
    });
  });

  describe('new Phase 1 reducers', () => {
    it('setArtistMode updates state', () => {
      store.dispatch(setArtistMode(true));
      expect(store.getState().export.artistMode).toBe(true);
      store.dispatch(setArtistMode(false));
      expect(store.getState().export.artistMode).toBe(false);
    });

    it('setSortOrder updates state', () => {
      store.dispatch(setSortOrder('ascending'));
      expect(store.getState().export.sortOrder).toBe('ascending');
      store.dispatch(setSortOrder('descending'));
      expect(store.getState().export.sortOrder).toBe('descending');
    });

    it('setPreviewMedia updates state', () => {
      store.dispatch(setPreviewMedia(false));
      expect(store.getState().export.previewMedia).toBe(false);
      store.dispatch(setPreviewMedia(true));
      expect(store.getState().export.previewMedia).toBe(true);
    });

    it('applyPreset sets all export state fields atomically', () => {
      store.dispatch(applyPreset({
        format: 'json',
        messagesPerPage: 500,
        separateThreads: true,
        includeMedia: true,
        mediaConfig: { images: true, videos: false, audio: false, other: false },
        artistMode: true,
        sortOrder: 'ascending',
        previewMedia: false,
      }));

      const state = store.getState().export;
      expect(state.exportFormat).toBe('json');
      expect(state.messagesPerPage).toBe(500);
      expect(state.separateThreads).toBe(true);
      expect(state.includeMedia).toBe(true);
      expect(state.mediaConfig.videos).toBe(false);
      expect(state.artistMode).toBe(true);
      expect(state.sortOrder).toBe('ascending');
      expect(state.previewMedia).toBe(false);
    });

    it('setMaxZipPartBytes sets the value, including null for no limit (#207 Arm A)', () => {
      store.dispatch(setMaxZipPartBytes(1_000_000_000));
      expect(store.getState().export.maxZipPartBytes).toBe(1_000_000_000);
      store.dispatch(setMaxZipPartBytes(null));
      expect(store.getState().export.maxZipPartBytes).toBeNull();
    });

    it('applyPreset resolves an absent maxZipPartBytes to the safe default', () => {
      store.dispatch(setMaxZipPartBytes(null)); // make sure it changes
      store.dispatch(applyPreset({
        format: 'json', messagesPerPage: 500, separateThreads: false, includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false, sortOrder: 'ascending', previewMedia: false,
        // maxZipPartBytes intentionally omitted (preset saved before the field existed)
      }));
      expect(store.getState().export.maxZipPartBytes).toBe(DEFAULT_MAX_ZIP_PART_BYTES);
    });

    it('applyPreset honors an explicit null maxZipPartBytes (single zip)', () => {
      store.dispatch(applyPreset({
        format: 'json', messagesPerPage: 500, separateThreads: false, includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false, sortOrder: 'ascending', previewMedia: false,
        maxZipPartBytes: null,
      }));
      expect(store.getState().export.maxZipPartBytes).toBeNull();
    });

    it('applyPreset with format=media does not auto-enable includeMedia', () => {
      // First set includeMedia to false
      store.dispatch(setIncludeMedia(false));

      // Apply preset with media format but includeMedia explicitly false
      store.dispatch(applyPreset({
        format: 'media',
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: false,
        mediaConfig: { images: true, videos: true, audio: true, other: true },
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: true,
      }));

      // Should respect the preset value, not the setExportFormat side effect
      expect(store.getState().export.includeMedia).toBe(false);
      expect(store.getState().export.exportFormat).toBe('media');
    });

    it('initializeExportFromSettings reads all export settings', () => {
      store.dispatch(initializeExportFromSettings({
        exportFormat: 'csv',
        exportMessagesPerPage: '200',
        exportSeparateThreadAndForumPosts: 'false',
        exportDownloadMedia_2: 'true',
        exportMediaImages: 'true',
        exportMediaVideos: 'false',
        exportMediaAudio: 'true',
        exportMediaOther: 'false',
        exportUseArtistMode: 'true',
        exportMessageSortOrder: 'asc',
        exportPreviewMedia_2: 'false',
      }));

      const state = store.getState().export;
      expect(state.exportFormat).toBe('csv');
      expect(state.messagesPerPage).toBe(200);
      expect(state.separateThreads).toBe(false);
      expect(state.includeMedia).toBe(true);
      expect(state.mediaConfig.images).toBe(true);
      expect(state.mediaConfig.videos).toBe(false);
      expect(state.mediaConfig.audio).toBe(true);
      expect(state.mediaConfig.other).toBe(false);
      expect(state.artistMode).toBe(true);
      expect(state.sortOrder).toBe('ascending');
      expect(state.previewMedia).toBe(false);
    });

    it('initializeExportFromSettings accepts the "text" format (#184)', () => {
      store.dispatch(initializeExportFromSettings({ exportFormat: 'text' }));
      expect(store.getState().export.exportFormat).toBe('text');
    });

    it('initializeExportFromSettings restores export template', () => {
      store.dispatch(initializeExportFromSettings({
        exportTemplate: 'discord',
      }));

      const state = store.getState().export;
      expect(state.exportTemplate).toBe('discord');
    });

    it('initializeExportFromSettings does not auto-apply persisted preset (Option A)', () => {
      // Simulate: user selected "Spreadsheet export" preset (CSV) then changed format to JSON
      store.dispatch(initializeExportFromSettings({
        exportFormat: 'json', // user's manual override
        exportSelectedPreset: 'builtin-spreadsheet', // persisted preset ID
      }));

      const state = store.getState().export;
      // Individual settings should take precedence — preset is cosmetic only
      expect(state.exportFormat).toBe('json');
    });

    it('initializeExportFromSettings with missing settings uses defaults', () => {
      store.dispatch(initializeExportFromSettings({}));

      const state = store.getState().export;
      expect(state.exportFormat).toBe('html');
      expect(state.messagesPerPage).toBe(100);
      expect(state.mediaConfig.images).toBe(true);
      expect(state.previewMedia).toBe(true);
      expect(state.exportTemplate).toBe('discord');
    });

    it('initializeExportFromSettings with null does nothing', () => {
      store.dispatch(setExportFormat('csv'));
      store.dispatch(initializeExportFromSettings(null));
      expect(store.getState().export.exportFormat).toBe('csv');
    });

    // ── #184: plain text format ───────────────────────────────────

    it('setExportFormat("text") records the new format in state', () => {
      store.dispatch(setExportFormat('text'));
      expect(store.getState().export.exportFormat).toBe('text');
      // Picking text must not auto-enable media (only the media format does).
      expect(store.getState().export.includeMedia).toBe(initialExportState.includeMedia);
    });

    it('setTextOptions partial merges into existing textOptions', () => {
      store.dispatch(setTextOptions({ attachmentStyle: 'sidecar' }));
      const after = selectTextOptions(store.getState());
      expect(after.attachmentStyle).toBe('sidecar');
      // Other fields keep their initial defaults
      expect(after.reactions).toBe('include');
      expect(after.replies).toBe('quote');
      expect(after.botIndicator).toBe('include');
    });

    it('setTextOptions supports updating every field', () => {
      store.dispatch(setTextOptions({
        attachmentStyle: 'skip',
        reactions: 'skip',
        replies: 'link',
        botIndicator: 'skip',
      }));
      expect(selectTextOptions(store.getState())).toEqual({
        attachmentStyle: 'skip',
        reactions: 'skip',
        replies: 'link',
        botIndicator: 'skip',
      });
    });

    it('applyPreset with format="text" + textOptions hydrates both', () => {
      store.dispatch(applyPreset({
        format: 'text',
        messagesPerPage: 500,
        separateThreads: false,
        includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: false,
        textOptions: {
          attachmentStyle: 'sidecar',
          reactions: 'skip',
          replies: 'link',
          botIndicator: 'skip',
        },
      }));
      const state = store.getState().export;
      expect(state.exportFormat).toBe('text');
      expect(state.textOptions).toEqual({
        attachmentStyle: 'sidecar',
        reactions: 'skip',
        replies: 'link',
        botIndicator: 'skip',
      });
    });

    it('applyPreset without textOptions does NOT clobber existing textOptions', () => {
      // First customize text options
      store.dispatch(setTextOptions({ attachmentStyle: 'skip' }));
      // Then apply a preset that doesn't carry textOptions
      store.dispatch(applyPreset({
        format: 'csv',
        messagesPerPage: 500,
        separateThreads: false,
        includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false,
        sortOrder: 'ascending',
        previewMedia: false,
      }));
      expect(selectTextOptions(store.getState()).attachmentStyle).toBe('skip');
    });

    it('setExportCriteria stores and clears the export filter window (#207 Arm B)', () => {
      const criteria = {
        searchAfterDate: new Date('2025-01-01T00:00:00.000Z'),
        searchBeforeDate: null,
        searchMessageContents: [],
        selectedHasTypes: [],
        userIds: [],
        mentionIds: [],
        channelIds: [],
        isPinned: 0,
        authorType: null,
      } as any;
      store.dispatch(setExportCriteria(criteria));
      expect(selectExportCriteria(store.getState())?.searchAfterDate).toEqual(
        criteria.searchAfterDate,
      );
      store.dispatch(setExportCriteria(null));
      expect(selectExportCriteria(store.getState())).toBeNull();
    });

    it('applyPreset with a dateRange restores Date bounds onto the export criteria (#207 Arm B)', () => {
      store.dispatch(applyPreset({
        format: 'json',
        messagesPerPage: 500,
        separateThreads: false,
        includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false,
        sortOrder: 'ascending',
        previewMedia: false,
        dateRange: { after: '2025-03-01T00:00:00.000Z', before: '2025-03-31T00:00:00.000Z' },
      }));

      const c = selectExportCriteria(store.getState());
      expect(c?.searchAfterDate).toBeInstanceOf(Date);
      expect((c?.searchAfterDate as Date).toISOString()).toBe('2025-03-01T00:00:00.000Z');
      expect((c?.searchBeforeDate as Date).toISOString()).toBe('2025-03-31T00:00:00.000Z');
    });

    it('applyPreset without a dateRange leaves the current export criteria untouched (#207 Arm B)', () => {
      const existing = {
        searchAfterDate: new Date('2024-12-25T00:00:00.000Z'),
        searchBeforeDate: null,
        searchMessageContents: [],
        selectedHasTypes: [],
        userIds: [],
        mentionIds: [],
        channelIds: [],
        isPinned: 0,
        authorType: null,
      } as any;
      store.dispatch(setExportCriteria(existing));
      store.dispatch(applyPreset({
        format: 'csv',
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false,
        sortOrder: 'ascending',
        previewMedia: false,
      }));
      // Formatting-only preset must not wipe the user's active date window.
      expect(selectExportCriteria(store.getState())?.searchAfterDate).toEqual(
        existing.searchAfterDate,
      );
    });

    it('applyPreset dateRange merges onto existing non-date criteria fields (#207 Arm B)', () => {
      store.dispatch(setExportCriteria({
        searchAfterDate: null,
        searchBeforeDate: null,
        searchMessageContents: ['hello'],
        selectedHasTypes: [],
        userIds: ['user-1'],
        mentionIds: [],
        channelIds: [],
        isPinned: 0,
        authorType: null,
      } as any));
      store.dispatch(applyPreset({
        format: 'json',
        messagesPerPage: 100,
        separateThreads: false,
        includeMedia: false,
        mediaConfig: { images: false, videos: false, audio: false, other: false },
        artistMode: false,
        sortOrder: 'ascending',
        previewMedia: false,
        dateRange: { after: '2025-05-01T00:00:00.000Z', before: null },
      }));
      const c = selectExportCriteria(store.getState());
      expect(c?.searchMessageContents).toEqual(['hello']);
      expect(c?.userIds).toEqual(['user-1']);
      expect((c?.searchAfterDate as Date).toISOString()).toBe('2025-05-01T00:00:00.000Z');
      expect(c?.searchBeforeDate).toBeNull();
    });

    it('resetExport only clears operation state', () => {
      // Set config
      store.dispatch(setExportFormat('csv'));
      store.dispatch(setArtistMode(true));
      store.dispatch(setSortOrder('ascending'));
      store.dispatch(setMessagesPerPage(500));

      // Set operation state
      store.dispatch(setExportProgress({
        stage: 'avatars', current: 5, total: 10,
      }));

      // Reset
      store.dispatch(resetExport());

      const state = store.getState().export;
      // Operation state cleared
      expect(state.isExporting).toBe(false);
      expect(state.exportProgress).toBeNull();
      expect(state.exportError).toBeNull();

      // Config preserved
      expect(state.exportFormat).toBe('csv');
      expect(state.artistMode).toBe(true);
      expect(state.sortOrder).toBe('ascending');
      expect(state.messagesPerPage).toBe(500);
    });
  });

  describe('dmExportName (#227 residue)', () => {
    it('uses the group name when the group is named', () => {
      const dm = {
        id: 'g1',
        name: 'movie night',
        recipients: [{ username: 'alice' }, { username: 'bob' }],
      } as any;
      expect(dmExportName(dm)).toBe('movie night');
    });

    it('falls back to the username join for 1:1 DMs and unnamed groups', () => {
      const dm = {
        id: 'g2',
        name: null,
        recipients: [{ username: 'alice' }, { username: 'bob' }],
      } as any;
      expect(dmExportName(dm)).toBe('alice, bob');
    });

    it('falls back to dm-<id> when there are no recipients left', () => {
      const dm = { id: 'g3', name: null, recipients: [] } as any;
      expect(dmExportName(dm)).toBe('dm-g3');
    });
  });

  describe('buildUniqueFolderNames', () => {
    it('returns sanitized names when no collisions', () => {
      const result = buildUniqueFolderNames([
        { id: '1', name: 'general' },
        { id: '2', name: 'announcements' },
      ]);
      expect(result.get('1')).toBe('general');
      expect(result.get('2')).toBe('announcements');
    });

    it('appends ID suffix when case-insensitive names collide', () => {
      const result = buildUniqueFolderNames([
        { id: '100', name: 'General' },
        { id: '200', name: 'general' },
      ]);
      expect(result.get('100')).toBe('general_100');
      expect(result.get('200')).toBe('general_200');
    });

    it('appends ID suffix when special characters cause collision', () => {
      const result = buildUniqueFolderNames([
        { id: '100', name: 'my-channel' },
        { id: '200', name: 'my_channel' },
      ]);
      expect(result.get('100')).toBe('my_channel_100');
      expect(result.get('200')).toBe('my_channel_200');
    });

    it('handles mixed collisions and unique names', () => {
      const result = buildUniqueFolderNames([
        { id: '1', name: 'unique-channel' },
        { id: '2', name: 'General' },
        { id: '3', name: 'general' },
      ]);
      expect(result.get('1')).toBe('unique_channel');
      expect(result.get('2')).toBe('general_2');
      expect(result.get('3')).toBe('general_3');
    });

    it('collapses multiple underscores from special characters', () => {
      const result = buildUniqueFolderNames([
        { id: '1', name: '💬┆general' },
      ]);
      expect(result.get('1')).toBe('general');
    });

    it('strips leading/trailing underscores', () => {
      const result = buildUniqueFolderNames([
        { id: '1', name: '#channel!' },
      ]);
      expect(result.get('1')).toBe('channel');
    });

    it('handles empty names with fallback', () => {
      const result = buildUniqueFolderNames([
        { id: '1', name: 'channel-1' },
        { id: '2', name: '' },
      ]);
      expect(result.get('2')).toBeDefined();
    });

    it('handles three-way collision', () => {
      const result = buildUniqueFolderNames([
        { id: '1', name: 'Info' },
        { id: '2', name: 'info' },
        { id: '3', name: 'INFO' },
      ]);
      expect(result.get('1')).toBe('info_1');
      expect(result.get('2')).toBe('info_2');
      expect(result.get('3')).toBe('info_3');
    });
  });

  describe('Pass 1 reaction enrichment contract for bulk export with searchCriteria (#163)', () => {
    // Bulk-export-with-searchCriteria flows through fetchAllChannelMessages →
    // iterateSearchMessagesRedux → Discord search endpoint, which omits
    // reactions. Pass 1 must run on the aggregated messages before the
    // export pipeline fans them out to per-channel zips, otherwise both
    // bulkExportChannels and bulkExportDMs silently drop reactions for
    // search-loaded sets — same shape as the live-feed bug at the four
    // search thunks.

    it('runs reactionEnrichmentService.enrichMessages on iterator output when searchCriteria is active', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { reactionEnrichmentService } = await import('@services/reactionEnrichmentService');
      const { iterateSearchMessagesRedux } = await import('@/utils/searchPagination');

      vi.mocked(iterateSearchMessagesRedux).mockImplementation(async function* () {
        yield {
          messages: [
            {
              id: 'sm-1',
              channel_id: 'ch-1',
              timestamp: '2026-01-01T00:00:00.000Z',
              author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
              content: 'hi',
              mentions: [],
              attachments: [],
              embeds: [],
              pinned: false,
              type: 0,
              mention_everyone: false,
              edited_timestamp: null,
              tts: false,
              reactions: undefined,
            } as any,
          ],
          totalResults: 1,
          pageIndex: 0,
          aggregatedCount: 1,
        };
      });

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      vi.mocked(reactionEnrichmentService.enrichMessages).mockClear();

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-1', name: 'general' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          searchCriteria: { searchMessageContents: ['x'] } as any,
        })
      );

      // The exact call count depends on whether the export's per-format
      // pass also enriches; what matters is that AT LEAST ONE call lands
      // with the iterator's messages, proving search-criteria bulk
      // exports flow through Pass 1 enrichment.
      const calls = vi.mocked(reactionEnrichmentService.enrichMessages).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const firstCallMessages = calls[0][0];
      expect(firstCallMessages.length).toBeGreaterThan(0);
      expect(firstCallMessages[0].id).toBe('sm-1');
      expect(firstCallMessages[0].reactions).toBeUndefined();
    });

    it('warns that a still-indexing conversation may export incomplete (#216)', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { iterateSearchMessagesRedux } = await import('@/utils/searchPagination');

      vi.mocked(iterateSearchMessagesRedux).mockImplementation(async function* () {
        yield {
          messages: [],
          totalResults: 0,
          pageIndex: 0,
          aggregatedCount: 0,
          stillIndexing: true,
        } as any;
      });

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-1', name: 'general' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          searchCriteria: { searchMessageContents: ['x'] } as any,
        })
      );

      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      const warning = entries.find((e) => e.message.includes('still indexing'));
      expect(warning).toBeDefined();
      expect(warning?.level).toBe('warning');
      expect(warning?.message).toContain('may be missing messages');
    });
  });

  describe('Bulk export unfiltered branch status log milestones (#167)', () => {
    // The unfiltered branch of fetchAllChannelMessages walks the channel
    // history endpoint with no inherent feedback. #167 adds a "Loading
    // messages from X…" entry on entry, per-500-message milestones during
    // the walk, and a "Loaded N messages from X" success entry on exit.
    // Mirrors the search-criteria branch's pattern.

    it('emits start, milestone, and success entries during an unfiltered bulk-export channel walk', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { getDiscordService } = await import('@services/discordService');

      // Build a fake fetchMessageData that streams ~600 messages across
      // pages of 100, so we cross the first 500-msg milestone before
      // hitting the < 100 short-page terminator.
      let cursor = 0;
      const TOTAL = 600;
      vi.mocked(getDiscordService).mockReturnValue({
        fetchMessageData: vi.fn().mockImplementation(async () => {
          const remaining = TOTAL - cursor;
          if (remaining <= 0) return { success: true, data: [] };
          const pageSize = Math.min(100, remaining);
          const data = Array.from({ length: pageSize }, (_, i) => ({
            id: `${cursor + i + 1}`,
            channel_id: 'ch-unfiltered',
            timestamp: '2026-01-01T00:00:00.000Z',
            author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
            content: 'msg',
            mentions: [],
            attachments: [],
            embeds: [],
            pinned: false,
            type: 0,
            mention_everyone: false,
            edited_timestamp: null,
            tts: false,
            reactions: [],
          }));
          cursor += pageSize;
          return { success: true, data };
        }),
        fetchSearchMessageData: vi.fn(),
        iterateSearchResults: async function* () {},
      } as any);

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-unfiltered', name: 'unfiltered-channel' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          // No searchCriteria → unfiltered branch.
        })
      );

      const entries = testStore.getState().status.entries.map((e: any) => e.message);

      // Start entry referencing the channel label.
      expect(entries.some((m: string) => m.includes('Loading messages from #unfiltered-channel'))).toBe(true);
      // 500-message milestone (boundary crossed at 500 of 600).
      expect(entries.some((m: string) => m.includes('Loaded 500 messages from #unfiltered-channel'))).toBe(true);
      // Final success entry with full count.
      expect(entries.some((m: string) =>
        m.includes('Loaded 600 messages from #unfiltered-channel') &&
        // The success-level entry is the final one; looser match here.
        true
      )).toBe(true);
    });
  });

  describe('Bulk export unfiltered walk transient retry (#245)', () => {
    beforeEach(() => setOnline(false));
    afterEach(() => setOnline(true));

    // One dropped packet mid-export used to throw "Failed to fetch messages
    // for channel" and kill that channel's export. The walk now runs under
    // withTransientRetry and pauses on exhaustion (same contract as Load All).
    const page = (start: number, size: number) => ({
      success: true,
      data: Array.from({ length: size }, (_, i) => ({
        id: `${start + i + 1}`,
        channel_id: 'ch-flaky',
        timestamp: '2026-01-01T00:00:00.000Z',
        author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
        content: 'msg',
        mentions: [], attachments: [], embeds: [], pinned: false, type: 0,
        mention_everyone: false, edited_timestamp: null, tts: false, reactions: [],
      })),
    });

    async function runFlakyExport(fetchMessageData: any) {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { getDiscordService } = await import('@services/discordService');

      vi.mocked(getDiscordService).mockReturnValue({
        fetchMessageData,
        fetchSearchMessageData: vi.fn(),
        iterateSearchResults: async function* () {},
      } as any);

      const testStore = configureStore({
        reducer: {
          export: exportReducer, app: appReducer, auth: authReducer,
          status: statusReducer, history: historyReducer, cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false, discrubCancelled: false, isMinimized: false,
            focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' }, settings: defaultSettings,
          },
        } as any,
      });

      const pending = testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-flaky', name: 'flaky' } as any],
          token: 'token', format: 'html', messagesPerPage: 100,
          separateThreads: false, includeMedia: false, guildId: 'g-1',
        })
      );
      return { testStore, pending };
    }

    it('retries a transient page failure and completes the channel walk', async () => {
      const fetchMessageData = vi.fn()
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValueOnce({ success: false, status: 503 })
        .mockResolvedValueOnce({ success: false, status: undefined })
        .mockResolvedValueOnce(page(100, 10));
      const { testStore, pending } = await runFlakyExport(fetchMessageData);
      const result: any = await pending;

      expect(fetchMessageData).toHaveBeenCalledTimes(4);
      // The retry re-issues the same cursor, so no page is skipped.
      expect(fetchMessageData.mock.calls[1][1]).toBe('100');
      expect(fetchMessageData.mock.calls[3][1]).toBe('100');
      expect(result.payload.errors).toBeUndefined();

      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      const retries = entries.filter((e) => e.level === 'warning' && /Export: connection failed while loading #flaky, retrying in/.test(e.message));
      expect(retries).toHaveLength(2);
      expect(entries.some((e) => e.level === 'success' && e.message.includes('Loaded 110 messages from #flaky'))).toBe(true);
      expect(testStore.getState().app.discrubPaused).toBe(false);
    });

    it('pauses the export after retries are exhausted and keeps the progress made', async () => {
      const { waitWhilePaused } = await import('@/utils/operationLoopUtils');
      // The file-wide stub makes waitWhilePaused a no-op; make it honor
      // the paused flag for this test only so the post-pause loop blocks.
      vi.mocked(waitWhilePaused).mockImplementation(async (getState: any) => {
        while (getState().app.discrubPaused) {
          await new Promise((r) => setTimeout(r, 10));
          if (getState().app.discrubCancelled) return;
        }
      });
      const fetchMessageData = vi.fn()
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValue({ success: false, status: undefined });
      const { testStore, pending } = await runFlakyExport(fetchMessageData);

      for (let i = 0; i < 200 && !testStore.getState().app.discrubPaused; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(testStore.getState().app.discrubPaused).toBe(true);
      // 1 good page + 1 initial attempt + 5 retries.
      expect(fetchMessageData).toHaveBeenCalledTimes(7);

      const { setDiscrubCancelled } = await import('@features/app/appSlice');
      testStore.dispatch(setDiscrubCancelled(true));
      await pending;

      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      const paused = entries.find((e) => e.level === 'warning' && /Export: paused after 5 failed retries loading #flaky/.test(e.message));
      expect(paused?.message).toContain('from 100 loaded');

      vi.mocked(waitWhilePaused).mockResolvedValue(undefined);
    }, 10000);

    it('fails the channel immediately on a permanent 4xx, with the status in the error', async () => {
      const fetchMessageData = vi.fn().mockResolvedValue({ success: false, status: 403 });
      const { testStore, pending } = await runFlakyExport(fetchMessageData);
      const result: any = await pending;

      expect(fetchMessageData).toHaveBeenCalledTimes(1);
      expect(testStore.getState().app.discrubPaused).toBe(false);
      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      expect(entries.some((e) => /retrying in/.test(e.message))).toBe(false);
      expect(JSON.stringify(result.payload ?? '') + entries.map((e) => e.message).join('\n')).toContain('(403)');
    });
  });

  describe('Bulk export search iterator incomplete-flag warning (#169)', () => {
    // The lib iterator can yield a synthetic final page with `incomplete:
    // true` when Discord's search index stops returning new matches before
    // `total_results` is reached (search-index churn / hidden offset cap).
    // Without a consumer-side dispatch, the user only sees a clean
    // "Loaded N matching messages" entry and silently gets a partial
    // export. Confirm the consumer surfaces a warning with explicit
    // numbers when the flag is set.

    it('dispatches a warning entry when the iterator emits a page with incomplete: true', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { iterateSearchMessagesRedux } = await import('@/utils/searchPagination');

      vi.mocked(iterateSearchMessagesRedux).mockImplementation(async function* () {
        // Real page with messages.
        yield {
          messages: [
            {
              id: 'sm-1',
              channel_id: 'ch-incomplete',
              timestamp: '2026-01-01T00:00:00.000Z',
              author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
              content: 'hi',
              mentions: [],
              attachments: [],
              embeds: [],
              pinned: false,
              type: 0,
              mention_everyone: false,
              edited_timestamp: null,
              tts: false,
              reactions: [],
            } as any,
          ],
          totalResults: 2311,
          pageIndex: 0,
          aggregatedCount: 500,
        };
        // Synthetic final page from the lib's safety valve.
        yield {
          messages: [],
          totalResults: 2311,
          pageIndex: 1,
          aggregatedCount: 500,
          incomplete: true,
        };
      });

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-incomplete', name: 'busy-channel' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          searchCriteria: { searchMessageContents: ['x'] } as any,
        })
      );

      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      const warning = entries.find(
        (e) => e.level === 'warning' && e.message.includes('Discord stopped returning results'),
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('500');
      expect(warning!.message).toContain('2,311');
      expect(warning!.message).toContain('1,811');
      expect(warning!.message).toContain('busy-channel');
    });

    it('does NOT dispatch a warning when the iterator finishes cleanly (no incomplete flag)', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { iterateSearchMessagesRedux } = await import('@/utils/searchPagination');

      vi.mocked(iterateSearchMessagesRedux).mockImplementation(async function* () {
        yield {
          messages: [
            {
              id: 'sm-1',
              channel_id: 'ch-clean',
              timestamp: '2026-01-01T00:00:00.000Z',
              author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
              content: 'hi',
              mentions: [],
              attachments: [],
              embeds: [],
              pinned: false,
              type: 0,
              mention_everyone: false,
              edited_timestamp: null,
              tts: false,
              reactions: [],
            } as any,
          ],
          totalResults: 1,
          pageIndex: 0,
          aggregatedCount: 1,
        };
      });

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-clean', name: 'clean-channel' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          searchCriteria: { searchMessageContents: ['x'] } as any,
        })
      );

      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      const warning = entries.find(
        (e) => e.level === 'warning' && e.message.includes('Discord stopped returning results'),
      );
      expect(warning).toBeUndefined();
    });
  });

  describe('Bulk export reaction discovery heartbeat (#170)', () => {
    // Pass 1 reaction enrichment runs an AROUND-window loop in the lib.
    // For large exports, this loop can take minutes with no status feedback
    // between "fetching reaction data for N messages" and "Fetching
    // reaction details" (per-emoji Pass 2). The lib emits onStatus per
    // AROUND-batch (dedup-aware via trackMap), and the consumer counts
    // invocations to surface a milestone on the first call and every 10th
    // call, mirroring the cadence of other long-running phases.

    it('emits milestone "Reaction discovery" entries during Pass 1 enrichment', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { reactionEnrichmentService } = await import('@services/reactionEnrichmentService');
      const { iterateSearchMessagesRedux } = await import('@/utils/searchPagination');

      vi.mocked(iterateSearchMessagesRedux).mockImplementation(async function* () {
        yield {
          messages: [
            {
              id: 'sm-1',
              channel_id: 'ch-heartbeat',
              timestamp: '2026-01-01T00:00:00.000Z',
              author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
              content: 'hi',
              mentions: [],
              attachments: [],
              embeds: [],
              pinned: false,
              type: 0,
              mention_everyone: false,
              edited_timestamp: null,
              tts: false,
              reactions: undefined,
            } as any,
          ],
          totalResults: 1,
          pageIndex: 0,
          aggregatedCount: 1,
        };
      });

      // Override enrichMessages to fire onStatus 25 times before returning.
      // Expected milestones land on the 1st, 10th, and 20th calls.
      vi.mocked(reactionEnrichmentService.enrichMessages).mockImplementationOnce(
        async (msgs: any, _token: any, _settings: any, callbacks: any) => {
          for (let i = 0; i < 25; i++) {
            callbacks?.onStatus?.(`Searching reactions (${i + 1}/${msgs.length})`);
          }
          return msgs;
        },
      );

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-heartbeat', name: 'heartbeat-channel' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          searchCriteria: { searchMessageContents: ['x'] } as any,
        }),
      );

      const entries = testStore.getState().status.entries.map((e: any) => e.message);
      const heartbeats = entries.filter((m: string) => m.startsWith('Reaction discovery:'));

      expect(heartbeats).toHaveLength(3);
      expect(heartbeats[0]).toBe('Reaction discovery: 1 batch scanned in #heartbeat-channel');
      expect(heartbeats[1]).toBe('Reaction discovery: 10 batches scanned in #heartbeat-channel');
      expect(heartbeats[2]).toBe('Reaction discovery: 20 batches scanned in #heartbeat-channel');
    });

    it('does NOT emit any heartbeat entries when the lib makes zero AROUND calls', async () => {
      // If every message already had reactions populated (or REACTIONS_ENABLED
      // is off and the wrapper short-circuits), onStatus never fires and the
      // counter stays at 0. The "Bulk export: fetching reaction data…" entry
      // can still appear via onWillEnrich, but no "Reaction discovery: N
      // batches scanned" lines.
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { reactionEnrichmentService } = await import('@services/reactionEnrichmentService');
      const { iterateSearchMessagesRedux } = await import('@/utils/searchPagination');

      vi.mocked(iterateSearchMessagesRedux).mockImplementation(async function* () {
        yield {
          messages: [
            {
              id: 'sm-1',
              channel_id: 'ch-quiet',
              timestamp: '2026-01-01T00:00:00.000Z',
              author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
              content: 'hi',
              mentions: [],
              attachments: [],
              embeds: [],
              pinned: false,
              type: 0,
              mention_everyone: false,
              edited_timestamp: null,
              tts: false,
              reactions: undefined,
            } as any,
          ],
          totalResults: 1,
          pageIndex: 0,
          aggregatedCount: 1,
        };
      });

      vi.mocked(reactionEnrichmentService.enrichMessages).mockImplementationOnce(
        async (msgs: any) => msgs,
      );

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-quiet', name: 'quiet-channel' } as any],
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          searchCriteria: { searchMessageContents: ['x'] } as any,
        }),
      );

      const entries = testStore.getState().status.entries.map((e: any) => e.message);
      const heartbeats = entries.filter((m: string) => m.startsWith('Reaction discovery:'));
      expect(heartbeats).toHaveLength(0);
    });
  });

  describe('zip path collision warning (#224)', () => {
    // A duplicate in-zip path used to error conflux's whole stream and
    // abort the export ("Unhandled: File already exists."). The rename
    // now happens inside StreamingZipService; buildZipOptions wires its
    // onPathCollision callback to a plain-language warning entry.

    it('passes an onPathCollision handler that logs a warning status entry', async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;

      let capturedZipOptions: any;
      const mockExportService = {
        exportToZip: vi.fn().mockImplementation(async (...args: any[]) => {
          // zipOptions is second-to-last since #230 appended onRowError
          capturedZipOptions = args[args.length - 2];
        }),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
        } as any,
      });

      await testStore.dispatch(
        exportMessages({
          messages: createMockMessages(2),
          channelName: 'test-channel',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
        }) as any,
      );

      expect(capturedZipOptions?.onPathCollision).toBeTypeOf('function');
      capturedZipOptions.onPathCollision({
        requestedPath: 'test-channel/media/attachments/1_2.png',
        finalPath: 'test-channel/media/attachments/1_2-2.png',
      });

      const entries = testStore.getState().status.entries as Array<{ level: string; message: string }>;
      const warning = entries.find((e) => e.message.includes('1_2-2.png'));
      expect(warning).toBeDefined();
      expect(warning?.level).toBe('warning');
      expect(warning?.message).toContain('kept going');
    });
  });

  describe('bulk export shell channel categories', () => {
    // The shell generator has grouped-by-category rendering, but the bulk
    // thunk never populated `category`, so exported shell.html always showed
    // one flat channel list. The thunk now derives categories from the
    // channel slice (type-4 parents), ordering categories by position and
    // channels by position within each, uncategorized first.

    async function dispatchBulkShellExport(channelSliceChannels: any[], exportChannels: any[]) {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const channelReducer = (await import('@features/channel/channelSlice')).default;
      const guildReducer = (await import('@features/guild/guildSlice')).default;
      const { getDiscordService } = await import('@services/discordService');

      // One short page per channel terminates the unfiltered history walk.
      vi.mocked(getDiscordService).mockReturnValue({
        fetchMessageData: vi.fn().mockResolvedValue({
          success: true,
          data: [{
            id: 'm-1',
            channel_id: 'ch',
            timestamp: '2026-01-01T00:00:00.000Z',
            author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
            content: 'hi',
            mentions: [],
            attachments: [],
            embeds: [],
            pinned: false,
            type: 0,
            mention_everyone: false,
            edited_timestamp: null,
            tts: false,
          }],
        }),
      } as any);

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
          channel: channelReducer,
          guild: guildReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
          channel: { channels: channelSliceChannels },
        } as any,
      });

      await testStore.dispatch(
        bulkExportChannels({
          channels: exportChannels,
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          exportConfig: { exportTemplate: 'discord' } as any,
        }) as any,
      );

      const { generateDiscordShellBulk } = await import('@services/exportDiscordShell');
      return vi.mocked(generateDiscordShellBulk).mock.calls;
    }

    it('groups shell sidebar channels under categories in Discord order', async () => {
      const calls = await dispatchBulkShellExport(
        [
          // Positions deliberately invert the alphabetical/dispatch order.
          { id: 'cat-a', name: 'Alpha', type: 4, position: 1 },
          { id: 'cat-b', name: 'Beta', type: 4, position: 0 },
        ],
        [
          { id: 'ch-a1', name: 'alpha-chat', parent_id: 'cat-a', position: 3 } as any,
          { id: 'ch-general', name: 'general' } as any,
          { id: 'ch-b2', name: 'beta-late', parent_id: 'cat-b', position: 9 } as any,
          { id: 'ch-b1', name: 'beta-chat', parent_id: 'cat-b', position: 2 } as any,
        ],
      );

      expect(calls.length).toBe(1);
      const options = calls[0][0];
      // Uncategorized first, then Beta (position 0) with its channels in
      // position order, then Alpha (position 1).
      expect(options.channels.map((c: any) => c.id)).toEqual([
        'ch-general', 'ch-b1', 'ch-b2', 'ch-a1',
      ]);
      expect(options.channels.map((c: any) => c.category)).toEqual([
        undefined, 'Beta', 'Beta', 'Alpha',
      ]);
      // The initially loaded channel matches the top of the sidebar.
      expect(options.activeChannelId).toBe('ch-general');
      expect(options.exportedChannelIds).toEqual(['ch-general', 'ch-b1', 'ch-b2', 'ch-a1']);
    });

    it('falls back to a flat list when the channel slice has no categories', async () => {
      const calls = await dispatchBulkShellExport(
        [],
        [
          { id: 'ch-2', name: 'two', parent_id: 'cat-missing', position: 5 } as any,
          { id: 'ch-1', name: 'one', position: 1 } as any,
        ],
      );

      expect(calls.length).toBe(1);
      const options = calls[0][0];
      // No category data: nothing gains a category label; order follows
      // channel position with no category tiers.
      expect(options.channels.every((c: any) => c.category === undefined)).toBe(true);
      expect(options.channels.map((c: any) => c.id)).toEqual(['ch-1', 'ch-2']);
    });
  });

  describe('bulk export forum expansion (#238)', () => {
    // Multi-selecting a forum (type 15/16) used to export nothing: the
    // parent 400s on the message list endpoint and matches nothing on
    // search, yielding a README-only zip that reported success. The thunk
    // now expands forums into their post threads (offset walk over the
    // same endpoint the single-forum view uses) before the export loop.

    const mockMessage = (channelId: string) => ({
      id: `m-${channelId}`,
      channel_id: channelId,
      timestamp: '2026-01-01T00:00:00.000Z',
      author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
      content: 'hi',
      mentions: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
      mention_everyone: false,
      edited_timestamp: null,
      tts: false,
    });

    async function runBulkForumExport(options: {
      exportChannels: any[];
      forumPages?: Array<{ threads: any[]; has_more: boolean }>;
      // F28: raw response envelopes (success/failure) consumed in order;
      // takes precedence over forumPages when provided.
      forumResponses?: Array<Record<string, unknown>>;
      emptyMessageChannels?: string[];
      sliceChannels?: any[];
    }) {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const channelReducer = (await import('@features/channel/channelSlice')).default;
      const guildReducer = (await import('@features/guild/guildSlice')).default;
      const { getDiscordService } = await import('@services/discordService');

      const pages = options.forumPages ?? [];
      let pageIndex = 0;
      const fetchForumThreadSearch = vi.fn().mockImplementation(async () => {
        if (options.forumResponses) {
          const response = options.forumResponses[Math.min(pageIndex, options.forumResponses.length - 1)];
          pageIndex++;
          return response;
        }
        const page = pages[pageIndex] ?? { threads: [], has_more: false };
        pageIndex++;
        return {
          success: true,
          data: { threads: page.threads, has_more: page.has_more, total_results: 0, first_messages: [], members: [] },
        };
      });

      const fetchMessageData = vi.fn().mockImplementation(async (_token: string, _lastId: string, channelId: string) => ({
        success: true,
        data: options.emptyMessageChannels?.includes(channelId) ? [] : [mockMessage(channelId)],
      }));

      vi.mocked(getDiscordService).mockReturnValue({
        fetchMessageData,
        fetchForumThreadSearch,
      } as any);

      const mockExportService = {
        exportToZip: vi.fn(),
        exportMediaOnly: vi.fn(),
      };
      vi.mocked(exportService.getExportService).mockReturnValue(mockExportService as any);

      const testStore = configureStore({
        reducer: {
          export: exportReducer,
          app: appReducer,
          auth: authReducer,
          status: statusReducer,
          history: historyReducer,
          cache: cacheReducer,
          channel: channelReducer,
          guild: guildReducer,
        } as any,
        preloadedState: {
          app: {
            discrubPaused: false,
            discrubCancelled: false,
            isMinimized: false,
            focusedView: false,
            kofiOverlayOpen: false,
            sidebarView: 'server' as const,
            task: { status: 'idle' as const, message: '' },
            settings: defaultSettings,
          },
          channel: { channels: options.sliceChannels ?? [] },
        } as any,
      });

      const result = await testStore.dispatch(
        bulkExportChannels({
          channels: options.exportChannels,
          token: 'token',
          format: 'html',
          messagesPerPage: 100,
          separateThreads: false,
          includeMedia: false,
          guildId: 'g-1',
          exportConfig: { exportTemplate: 'discord' } as any,
        }) as any,
      );

      const { generateDiscordShellBulk } = await import('@services/exportDiscordShell');
      return {
        result,
        shellCalls: vi.mocked(generateDiscordShellBulk).mock.calls,
        fetchForumThreadSearch,
        exportToZip: mockExportService.exportToZip,
        entries: testStore.getState().status.entries as Array<{ level: string; message: string }>,
      };
    }

    it('records an error instead of silently truncating when a post page fails permanently (F28)', async () => {
      const forumPage = (threads: any[], has_more: boolean) => ({
        success: true,
        data: { threads, has_more, total_results: 0, first_messages: [], members: [] },
      });
      const { result, entries, fetchForumThreadSearch } = await runBulkForumExport({
        exportChannels: [{ id: 'forum-1', name: 'Help Forum', type: 15 }],
        forumResponses: [
          forumPage([{ id: 'post-1', name: 'First Post', type: 11, parent_id: 'forum-1' }], true),
          { success: false, status: 403 },
        ],
      });

      // Pre-fix, the mid-walk failure read as end-of-pagination: 1 of N
      // posts exported, "Expanded forum" info entry, clean summary.
      expect(fetchForumThreadSearch).toHaveBeenCalledTimes(2);
      expect(result.payload.errors).toHaveLength(1);
      expect(result.payload.errors[0]).toContain('Help Forum');
      expect(result.payload.errors[0]).toContain('403');

      const errorEntry = entries.find((e) => e.level === 'error' && e.message.includes('Failed to expand forum Help Forum'));
      expect(errorEntry).toBeDefined();
      expect(entries.find((e) => e.message.includes('Expanded forum'))).toBeUndefined();
    });

    it('retries a transient post-page failure and completes the walk (F28)', async () => {
      const forumPage = (threads: any[], has_more: boolean) => ({
        success: true,
        data: { threads, has_more, total_results: 0, first_messages: [], members: [] },
      });
      const { result, entries, fetchForumThreadSearch, shellCalls } = await runBulkForumExport({
        exportChannels: [{ id: 'forum-1', name: 'Help Forum', type: 15 }],
        forumResponses: [
          forumPage([{ id: 'post-1', name: 'First Post', type: 11, parent_id: 'forum-1' }], true),
          { success: false, status: 500 },
          forumPage([{ id: 'post-2', name: 'Second Post', type: 11, parent_id: 'forum-1' }], false),
        ],
      });

      expect(fetchForumThreadSearch).toHaveBeenCalledTimes(3);
      expect(result.payload.errors).toBeUndefined();
      expect(entries.find((e) => e.level === 'warning' && e.message.includes('retrying'))).toBeDefined();
      expect(entries.find((e) => e.message.includes('Expanded forum Help Forum into 2 posts'))).toBeDefined();

      const shellOptions = shellCalls[0][0];
      expect(shellOptions.channels).toHaveLength(2);
    });

    it('expands a forum into its posts via a multi-page offset walk', async () => {
      const { shellCalls, fetchForumThreadSearch, entries } = await runBulkForumExport({
        exportChannels: [{ id: 'forum-1', name: 'Help Forum', type: 15 }],
        forumPages: [
          {
            threads: [
              { id: 'post-1', name: 'First Post', type: 11, parent_id: 'forum-1' },
              { id: 'post-2', name: 'Second Post', type: 11, parent_id: 'forum-1' },
            ],
            has_more: true,
          },
          {
            threads: [{ id: 'post-3', name: 'Third Post', type: 11, parent_id: 'forum-1' }],
            has_more: false,
          },
        ],
      });

      // Offset walk mirrors loadMoreForumThreads: 25-per-page increments.
      expect(fetchForumThreadSearch).toHaveBeenCalledTimes(2);
      expect(fetchForumThreadSearch.mock.calls[0][2].offset).toBe(0);
      expect(fetchForumThreadSearch.mock.calls[1][2].offset).toBe(25);

      const expansionEntry = entries.find((e) => e.message.includes('Expanded forum Help Forum into 3 posts'));
      expect(expansionEntry?.level).toBe('info');

      // Progress totals reflect the expanded unit count, not the raw selection.
      expect(entries.some((e) => e.message.includes('Starting channel 1/3'))).toBe(true);
      expect(entries.some((e) => e.message.includes('Starting channel 3/3'))).toBe(true);

      // All three posts exported and grouped under the forum's name.
      expect(shellCalls.length).toBe(1);
      const shellOptions: any = shellCalls[0][0];
      expect(shellOptions.channels.map((c: any) => c.id)).toEqual(['post-1', 'post-2', 'post-3']);
      expect(shellOptions.channels.every((c: any) => c.category === 'Help Forum')).toBe(true);
    });

    it('prefixes post folder names with the parent forum name', async () => {
      const { exportToZip } = await runBulkForumExport({
        exportChannels: [{ id: 'forum-1', name: 'Help Forum', type: 15 }],
        forumPages: [
          { threads: [{ id: 'post-1', name: 'First Post', type: 11, parent_id: 'forum-1' }], has_more: false },
        ],
      });

      expect(exportToZip).toHaveBeenCalledTimes(1);
      // Second positional arg is the channel folder name.
      expect(exportToZip.mock.calls[0][1]).toBe('help_forum_first_post');
    });

    it('logs a skip warning for a forum with zero posts and warns that nothing exported', async () => {
      const { shellCalls, entries } = await runBulkForumExport({
        exportChannels: [{ id: 'forum-1', name: 'Ghost Forum', type: 15 }],
        forumPages: [{ threads: [], has_more: false }],
      });

      const skipEntry = entries.find((e) => e.message.includes('No posts in Ghost Forum, skipping'));
      expect(skipEntry?.level).toBe('warning');

      // Nothing exported: no shell, and the summary WARN fires so the run
      // doesn't read as a clean success.
      expect(shellCalls.length).toBe(0);
      const summaryEntry = entries.find((e) => e.message.includes('0 channels exported'));
      expect(summaryEntry?.level).toBe('warning');
    });

    it('exports a mixed selection of text channels and forums', async () => {
      const { shellCalls, exportToZip, entries } = await runBulkForumExport({
        exportChannels: [
          { id: 'ch-1', name: 'general', type: 0 },
          { id: 'forum-1', name: 'Help Forum', type: 15 },
        ],
        forumPages: [
          { threads: [{ id: 'post-1', name: 'First Post', type: 11, parent_id: 'forum-1' }], has_more: false },
        ],
      });

      expect(exportToZip).toHaveBeenCalledTimes(2);
      expect(entries.some((e) => e.message.includes('Expanded forum Help Forum into 1 post'))).toBe(true);

      const shellOptions: any = shellCalls[0][0];
      expect(shellOptions.channels.map((c: any) => c.id)).toEqual(['ch-1', 'post-1']);
      expect(shellOptions.channels.map((c: any) => c.category)).toEqual([undefined, 'Help Forum']);
      // The plain channel keeps its unprefixed folder name.
      expect(exportToZip.mock.calls[0][1]).toBe('general');
      expect(exportToZip.mock.calls[1][1]).toBe('help_forum_first_post');
    });

    it('groups single-forum-path posts under the forum from the channel slice', async () => {
      // ServerView's forum export passes the already-expanded post threads
      // directly; the forum itself lives only in the channel slice. The
      // shell grouping must resolve parent_id against it.
      const { shellCalls } = await runBulkForumExport({
        exportChannels: [
          { id: 'post-1', name: 'First Post', type: 11, parent_id: 'forum-1' },
          { id: 'post-2', name: 'Second Post', type: 11, parent_id: 'forum-1' },
        ],
        sliceChannels: [{ id: 'forum-1', name: 'Help Forum', type: 15, position: 2 }],
      });

      const shellOptions: any = shellCalls[0][0];
      expect(shellOptions.channels.map((c: any) => c.category)).toEqual(['Help Forum', 'Help Forum']);
    });

    it('warns when every channel produced nothing', async () => {
      const { result, entries, shellCalls } = await runBulkForumExport({
        exportChannels: [{ id: 'ch-1', name: 'general', type: 0 }],
        emptyMessageChannels: ['ch-1'],
      });

      // Per-channel isolation intact: the thunk still resolves.
      expect(result.type).toBe('export/bulkExportChannels/fulfilled');
      expect(shellCalls.length).toBe(0);
      const summaryEntry = entries.find((e) => e.message.includes('0 channels exported'));
      expect(summaryEntry?.level).toBe('warning');
      expect(summaryEntry?.message).toContain('README');
    });
  });

  describe('createReactionProgressLogger (#243)', () => {
    const loggedMessages = (dispatch: ReturnType<typeof vi.fn>) =>
      dispatch.mock.calls.map(([action]) => action.payload.message);

    it('logs each milestone exactly once even when onProgress repeats per reaction', () => {
      const dispatch = vi.fn();
      const onProgress = createReactionProgressLogger(dispatch as any);

      // The service reports per REACTION: message 1 has 3 reactions, then
      // messages 2-9 advance normally, message 10 has 5 reactions, and the
      // final message reports twice.
      [1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 10, 11, 12, 12].forEach(
        (current) => onProgress({ current, total: 12 }),
      );

      expect(loggedMessages(dispatch)).toEqual([
        'Reactions: 1/12 messages processed',
        'Reactions: 10/12 messages processed',
        'Reactions: 12/12 messages processed',
      ]);
    });

    it('keeps the milestone cadence (first, every 10th, last)', () => {
      const dispatch = vi.fn();
      const onProgress = createReactionProgressLogger(dispatch as any);

      for (let current = 1; current <= 25; current++) {
        onProgress({ current, total: 25 });
      }

      expect(loggedMessages(dispatch)).toEqual([
        'Reactions: 1/25 messages processed',
        'Reactions: 10/25 messages processed',
        'Reactions: 20/25 messages processed',
        'Reactions: 25/25 messages processed',
      ]);
    });
  });

  describe('thread walk pacing (2.1.3 pacing audit)', () => {
    afterEach(async () => {
      const { cancellableDelay } = await import('@/utils/operationLoopUtils');
      vi.mocked(cancellableDelay).mockReset().mockResolvedValue(false);
    });
    type Ev = string;
    const msg = (id: string, channelId: string, thread?: { id: string; name: string }) => ({
      id, channel_id: channelId, timestamp: '2026-01-01T00:00:00.000Z',
      author: { id: 'u', username: 'u', discriminator: '0', global_name: null, avatar: null },
      content: 'msg', mentions: [], attachments: [], embeds: [], pinned: false, type: 0,
      mention_everyone: false, edited_timestamp: null, tts: false, reactions: [],
      ...(thread ? { thread: { id: thread.id, name: thread.name, type: 11 } } : {}),
    });

    const deps = async () => {
      const { configureStore } = await import('@reduxjs/toolkit');
      const { default: exportReducer, bulkExportChannels } = await import('./exportSlice');
      const appReducer = (await import('@features/app/appSlice')).default;
      const { defaultSettings } = await import('@features/app/appSlice');
      const authReducer = (await import('@features/auth/authSlice')).default;
      const statusReducer = (await import('@features/status/statusSlice')).default;
      const historyReducer = (await import('@features/history/historySlice')).default;
      const { getDiscordService } = await import('@services/discordService');
      const buildStore = () => configureStore({
      reducer: {
        export: exportReducer, app: appReducer, auth: authReducer,
        status: statusReducer, history: historyReducer, cache: cacheReducer,
      } as any,
      preloadedState: {
        app: {
          discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false,
          kofiOverlayOpen: false, sidebarView: 'server' as const,
          task: { status: 'idle' as const, message: '' }, settings: defaultSettings,
        },
      } as any,
    });
      return { buildStore, bulkExportChannels, getDiscordService };
    };

    const runWithThreads = async (threadCount: number, pagesPerThread = 1) => {
      const { buildStore, bulkExportChannels, getDiscordService } = await deps();
      const events: Ev[] = [];
      const threads = Array.from({ length: threadCount }, (_, i) => ({ id: `t${i + 1}`, name: `thread-${i + 1}` }));
      const parentPage = threads.map((t, i) => msg(`p${i + 1}`, 'ch-1', t));
      const served: Record<string, number> = {};
      vi.mocked(getDiscordService).mockReturnValue({
        fetchMessageData: vi.fn().mockImplementation(async (_t: string, _last: string | null, channelId: string) => {
          events.push(`fetch:${channelId}`);
          if (channelId === 'ch-1') return { success: true, data: parentPage };
          served[channelId] = (served[channelId] ?? 0) + 1;
          const full = served[channelId] < pagesPerThread;
          return { success: true, data: full
            ? Array.from({ length: 100 }, (_, i) => msg(`${channelId}-${served[channelId]}-${i}`, channelId))
            : [msg(`${channelId}-last`, channelId)] };
        }),
        fetchSearchMessageData: vi.fn(),
        iterateSearchResults: async function* () {},
      } as any);
      const { cancellableDelay } = await import('@/utils/operationLoopUtils');
      vi.mocked(cancellableDelay).mockImplementation(async () => { events.push('delay'); return false; });
      const { calculateRandomDelay } = await import('@/utils/delayUtils');
      vi.mocked(calculateRandomDelay).mockClear();

      await buildStore().dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-1', name: 'parent' } as any],
          token: 'token', format: 'json', messagesPerPage: 100,
          separateThreads: true, includeMedia: false, guildId: 'g-1',
        })
      );
      return { events, bases: vi.mocked(calculateRandomDelay).mock.calls.map((c) => c[0]) };
    };

    const threadFetches = (events: Ev[]) => events.filter((e) => e.startsWith('fetch:t'));
    const backToBackThreadFetches = (events: Ev[]) =>
      events.some((e, i) => e.startsWith('fetch:t') && (events[i + 1] ?? '').startsWith('fetch:t')
        && events[i + 1] !== e);

    it('sleeps between consecutive thread walks', async () => {
      const { events, bases } = await runWithThreads(3);
      expect(threadFetches(events)).toEqual(['fetch:t1', 'fetch:t2', 'fetch:t3']);
      expect(backToBackThreadFetches(events)).toBe(false);
      // Exactly one sleep per thread boundary: between t1→t2 and t2→t3.
      const first = events.indexOf('fetch:t1');
      expect(events.slice(first).filter((e) => e === 'delay')).toHaveLength(2);
      expect(bases.slice(-2)).toEqual([1, 1]); // search delay (default 1s)
    });

    it('does not sleep before the first thread or after the last', async () => {
      const { events } = await runWithThreads(1);
      const first = events.indexOf('fetch:t1');
      expect(events.slice(first)).toEqual(['fetch:t1']);
    });

    it('keeps pacing when a thread has several pages', async () => {
      const { events } = await runWithThreads(2, 2);
      const first = events.indexOf('fetch:t1');
      // t1 page 1, page delay, t1 page 2, boundary delay, t2 page 1, page delay, t2 page 2
      expect(events.slice(first)).toEqual([
        'fetch:t1', 'delay', 'fetch:t1', 'delay', 'fetch:t2', 'delay', 'fetch:t2',
      ]);
    });

    it('a cancel during the thread boundary sleep stops the walk', async () => {
      const { buildStore, bulkExportChannels, getDiscordService } = await deps();
      const events: Ev[] = [];
      const threads = [{ id: 't1', name: 'a' }, { id: 't2', name: 'b' }];
      vi.mocked(getDiscordService).mockReturnValue({
        fetchMessageData: vi.fn().mockImplementation(async (_t: string, _l: string | null, channelId: string) => {
          events.push(`fetch:${channelId}`);
          if (channelId === 'ch-1') return { success: true, data: threads.map((t, i) => msg(`p${i}`, 'ch-1', t)) };
          return { success: true, data: [msg(`${channelId}-x`, channelId)] };
        }),
        fetchSearchMessageData: vi.fn(),
        iterateSearchResults: async function* () {},
      } as any);
      const { cancellableDelay } = await import('@/utils/operationLoopUtils');
      vi.mocked(cancellableDelay).mockImplementation(async () => { events.push('delay'); return true; });

      await buildStore().dispatch(
        bulkExportChannels({
          channels: [{ id: 'ch-1', name: 'parent' } as any],
          token: 'token', format: 'json', messagesPerPage: 100,
          separateThreads: true, includeMedia: false, guildId: 'g-1',
        })
      );
      expect(threadFetches(events)).toEqual(['fetch:t1']);
    });
  });
});
