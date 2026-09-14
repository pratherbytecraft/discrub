import { describe, it, expect } from 'vitest';
import { createBaseState } from '@/test/state-factories';
import { selectOperationSummary, selectIsOperationRunning, selectIsHeavyOperationRunning } from './operationSelectors';
import type { ExportProgress, MediaDownloadProgress } from '@features/export/exportTypes';
import type { PurgeProgress } from '@features/purge/purgeTypes';

describe('operationSelectors', () => {
  describe('selectOperationSummary', () => {
    it('should return idle when no operations are running', () => {
      const state = createBaseState();
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: false, isPaused: false, label: 'Idle', tier: 'idle' });
    });

    it('should return exporting without progress when isExporting but no progress', () => {
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
          exportProgress: null,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Exporting...', tier: 'heavy' });
    });

    it('should return exporting with stage and percentage when progress exists', () => {
      const progress: MediaDownloadProgress = {
        stage: 'attachments',
        current: 45,
        total: 100,
      };
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
          exportProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({
        isRunning: true,
        isPaused: false,
        label: 'Exporting (attachments)... 45%',
        progress: 45,
        tier: 'heavy',
      });
    });

    it('should handle zero total in progress gracefully', () => {
      const progress: MediaDownloadProgress = {
        stage: 'avatars',
        current: 0,
        total: 0,
      };
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
          exportProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.progress).toBe(0);
      expect(summary.label).toContain('0%');
    });

    it('should return bulk export label when progress has bulk context', () => {
      const progress: ExportProgress = {
        stage: 'attachments',
        current: 30,
        total: 100,
        bulk: {
          currentIndex: 1,
          totalChannels: 5,
          currentChannelName: 'general',
        },
      };
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
          exportProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({
        isRunning: true,
        isPaused: false,
        label: 'Channel 2/5: general (attachments)... 30%',
        progress: 30,
        tier: 'heavy',
      });
    });

    it('should return bulk export label without percentage when total is zero', () => {
      const progress: ExportProgress = {
        stage: 'avatars',
        current: 0,
        total: 0,
        bulk: {
          currentIndex: 0,
          totalChannels: 3,
          currentChannelName: 'dev-chat',
        },
      };
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
          exportProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({
        isRunning: true,
        isPaused: false,
        label: 'Channel 1/3: dev-chat',
        tier: 'heavy',
      });
    });

    it('should return paused bulk export label when paused', () => {
      const progress: ExportProgress = {
        stage: 'html',
        current: 50,
        total: 100,
        bulk: {
          currentIndex: 2,
          totalChannels: 4,
          currentChannelName: 'random',
        },
      };
      const state = createBaseState({
        app: {
          ...createBaseState().app,
          discrubPaused: true,
        },
        export: {
          ...createBaseState().export,
          isExporting: true,
          exportProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isPaused).toBe(true);
      expect(summary.label).toBe('Paused · Channel 3/4: random');
    });

    it('should return loading all messages when isLoadingAll', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          pagination: {
            ...createBaseState().message.pagination,
            isLoadingAll: true,
          },
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Loading all messages...', tier: 'heavy' });
    });

    it('should return loading messages when isLoading', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isLoading: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Loading messages...', tier: 'light' });
    });

    it('should return light tier for user enrichment', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isEnriching: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Looking up users...', tier: 'light' });
    });

    it('should prioritize exporting over loadingAll', () => {
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
        },
        message: {
          ...createBaseState().message,
          pagination: {
            ...createBaseState().message.pagination,
            isLoadingAll: true,
          },
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toBe('Exporting...');
    });

    it('should prioritize loadingAll over isLoading', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isLoading: true,
          pagination: {
            ...createBaseState().message.pagination,
            isLoadingAll: true,
          },
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toBe('Loading all messages...');
    });

    it('should return deleting messages when isDeleting', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isDeleting: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Deleting messages...', tier: 'heavy' });
    });

    it('should return paused deleting label when paused and isDeleting', () => {
      const state = createBaseState({
        app: {
          ...createBaseState().app,
          discrubPaused: true,
        },
        message: {
          ...createBaseState().message,
          isDeleting: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: true, label: 'Paused · Deleting messages', tier: 'heavy' });
    });

    it('should prioritize isDeleting over isLoading', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isLoading: true,
          isDeleting: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toBe('Deleting messages...');
    });

    it('should return removing reactions when isRemovingReactions', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isRemovingReactions: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Removing reactions...', tier: 'heavy' });
    });

    it('should return paused label when paused and isRemovingReactions', () => {
      const state = createBaseState({
        app: {
          ...createBaseState().app,
          discrubPaused: true,
        },
        message: {
          ...createBaseState().message,
          isRemovingReactions: true,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: true, label: 'Paused · Removing reactions', tier: 'heavy' });
    });
  });

  describe('Package export tier (#162)', () => {
    // Package thunks set `state.package.exportStatus = 'running'` rather
    // than `state.export.isExporting`, so the operation selector needs
    // its own branch — without it, package exports never qualify as a
    // heavy operation and the Pause/Cancel controls in StatusPanel
    // never render. Live export progress data is still propagated via
    // `setExportProgress`, so the label can reuse it.

    it('flags a running package export as heavy (no progress yet)', () => {
      const state = createBaseState({
        package: {
          ...createBaseState().package,
          exportStatus: 'running',
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
      expect(summary.tier).toBe('heavy');
      expect(summary.label).toBe('Package export...');
    });

    it('renders stage + percentage when exportProgress is populated', () => {
      const progress: MediaDownloadProgress = {
        stage: 'attachments',
        current: 50,
        total: 200,
      };
      const state = createBaseState({
        package: {
          ...createBaseState().package,
          exportStatus: 'running',
        },
        export: {
          ...createBaseState().export,
          exportProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.tier).toBe('heavy');
      expect(summary.label).toBe('Package export (attachments)... 25%');
      expect(summary.progress).toBe(25);
    });

    it('shows the paused label when discrubPaused is set', () => {
      const state = createBaseState({
        app: { ...createBaseState().app, discrubPaused: true },
        package: {
          ...createBaseState().package,
          exportStatus: 'running',
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isPaused).toBe(true);
      expect(summary.label).toBe('Paused · Package export');
    });

    it('selectIsHeavyOperationRunning is true while a package export runs', () => {
      const state = createBaseState({
        package: {
          ...createBaseState().package,
          exportStatus: 'running',
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(true);
    });
  });

  describe('Thread tab operation detection', () => {
    const createThreadTab = (overrides: Record<string, unknown> = {}) => ({
      threadId: 'thread-100',
      threadName: 'Test Thread',
      messages: [],
      filteredMessages: [],
      selectedMessages: [],
      searchCriteria: null,
      order: { order: 'desc', orderBy: 'timestamp' },
      isLoading: false,
      error: null,
      pagination: {
        lastMessageId: null,
        hasMore: true,
        totalCount: null,
        isLoadingMore: false,
        isLoadingAll: false,
        loadAllProgress: null,
        mode: 'paginated',
      },
      ...overrides,
    });

    it('should detect thread isLoadingAll as running with "Loading all" label', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': createThreadTab({
              pagination: {
                ...createThreadTab().pagination,
                isLoadingAll: true,
              },
            }),
          } as any,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
      expect(summary.label).toContain('Loading all');
    });

    it('should detect thread isLoading as running with "Loading" label', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': createThreadTab({ isLoading: true }),
          } as any,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
      expect(summary.label).toContain('Loading messages');
    });

    it('should return idle when main and all threads are idle', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': createThreadTab(),
          } as any,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(false);
      expect(summary.label).toBe('Idle');
    });

    it('should detect loading when one of multiple threads is loading', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': createThreadTab(),
            'thread-200': createThreadTab({ threadId: 'thread-200', isLoading: true }),
          } as any,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
    });

    it('should not pause when thread is loading (light operation) and app is paused', () => {
      const state = createBaseState({
        app: {
          ...createBaseState().app,
          discrubPaused: true,
        },
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': createThreadTab({ isLoading: true }),
          } as any,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
      expect(summary.isPaused).toBe(false);
      expect(summary.tier).toBe('light');
      expect(summary.label).toBe('Loading messages...');
    });

    it('should prioritize export over thread isLoadingAll', () => {
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
        },
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': createThreadTab({
              pagination: {
                ...createThreadTab().pagination,
                isLoadingAll: true,
              },
            }),
          } as any,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toBe('Exporting...');
    });
  });

  describe('Purge operation detection', () => {
    it('should return Purging with no progress details when isPurging with no progress', () => {
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: null,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({ isRunning: true, isPaused: false, label: 'Purging...', tier: 'heavy' });
    });

    it('should return legacy purge label with processed and deleted counts', () => {
      const progress: PurgeProgress = {
        processed: 50,
        deleted: 30,
        skipped: 20,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
      };
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({
        isRunning: true,
        isPaused: false,
        label: 'Purging... 50 processed (30 deleted)',
        tier: 'heavy',
      });
    });

    it('should return bulk purge messages label with channel info and counts', () => {
      const progress: PurgeProgress = {
        processed: 25,
        deleted: 10,
        skipped: 15,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
        bulk: {
          currentIndex: 1,
          totalChannels: 3,
          currentChannelName: 'general',
          completedStats: { deleted: 40, skipped: 20, editedAttachmentsOnly: 0, reactionsRemoved: 0 },
        },
      };
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({
        isRunning: true,
        isPaused: false,
        label: 'Purging... Channel 2/3: general · 25 processed (50 deleted)',
        progress: 33,
        tier: 'heavy',
      });
    });

    it('prefixes the server position and spreads progress across servers for a multi-server purge (#255)', () => {
      const progress: PurgeProgress = {
        processed: 25,
        deleted: 10,
        skipped: 15,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
        bulk: {
          currentIndex: 1,
          totalChannels: 4,
          currentChannelName: 'general',
          completedStats: { deleted: 40, skipped: 20, editedAttachmentsOnly: 0, reactionsRemoved: 0 },
          server: { name: 'Beta', index: 2, total: 5 },
        },
      };
      const state = createBaseState({
        purge: { ...createBaseState().purge, isPurging: true, purgeProgress: progress },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toBe('Purging... Server 3/5 Beta · Channel 2/4: general · 25 processed (50 deleted)');
      // (2 servers done + 1/4 of the third) / 5 = 45%
      expect(summary.progress).toBe(45);
    });

    it('should return bulk purge reactions label with scanned and removed counts', () => {
      const progress: PurgeProgress = {
        processed: 100,
        deleted: 0,
        skipped: 0,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 15,
        bulk: {
          currentIndex: 0,
          totalChannels: 2,
          currentChannelName: 'memes',
          completedStats: { deleted: 0, skipped: 0, editedAttachmentsOnly: 0, reactionsRemoved: 5 },
        },
      };
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary).toMatchObject({
        isRunning: true,
        isPaused: false,
        label: 'Removing reactions... Channel 1/2: memes · 100 scanned (20 removed)',
        progress: 0,
        tier: 'heavy',
      });
    });

    it('should return paused bulk purge label', () => {
      const progress: PurgeProgress = {
        processed: 10,
        deleted: 5,
        skipped: 5,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
        bulk: {
          currentIndex: 2,
          totalChannels: 4,
          currentChannelName: 'dev-chat',
          completedStats: { deleted: 30, skipped: 10, editedAttachmentsOnly: 0, reactionsRemoved: 0 },
        },
      };
      const state = createBaseState({
        app: {
          ...createBaseState().app,
          discrubPaused: true,
        },
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.isPaused).toBe(true);
      expect(summary.label).toBe('Paused · Channel 3/4: dev-chat');
    });

    it('should calculate correct progress percentage for bulk purge', () => {
      const progress: PurgeProgress = {
        processed: 10,
        deleted: 5,
        skipped: 5,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
        bulk: {
          currentIndex: 2,
          totalChannels: 4,
          currentChannelName: 'random',
          completedStats: { deleted: 0, skipped: 0, editedAttachmentsOnly: 0, reactionsRemoved: 0 },
        },
      };
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.progress).toBe(50);
    });

    it('should accumulate completedStats with current progress for totalDeleted', () => {
      const progress: PurgeProgress = {
        processed: 20,
        deleted: 8,
        skipped: 12,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
        bulk: {
          currentIndex: 3,
          totalChannels: 5,
          currentChannelName: 'announcements',
          completedStats: { deleted: 100, skipped: 50, editedAttachmentsOnly: 0, reactionsRemoved: 0 },
        },
      };
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      // totalDeleted = completedStats.deleted (100) + progress.deleted (8) = 108
      expect(summary.label).toContain('108 deleted');
    });

    it('should prioritize purge over export when both are active', () => {
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
        },
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: null,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toBe('Purging...');
    });

    it('should detect reactions mode from completedStats alone', () => {
      const progress: PurgeProgress = {
        processed: 5,
        deleted: 0,
        skipped: 0,
        editedAttachmentsOnly: 0,
        reactionsRemoved: 0,
        bulk: {
          currentIndex: 1,
          totalChannels: 3,
          currentChannelName: 'off-topic',
          completedStats: { deleted: 0, skipped: 0, editedAttachmentsOnly: 0, reactionsRemoved: 10 },
        },
      };
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
          purgeProgress: progress,
        },
      });
      const summary = selectOperationSummary(state);
      expect(summary.label).toContain('Removing reactions');
      expect(summary.label).toContain('10 removed');
    });
  });

  describe('selectIsHeavyOperationRunning', () => {
    it('should return false when idle', () => {
      const state = createBaseState();
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });

    it('should return true when exporting', () => {
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(true);
    });

    it('should return true when purging', () => {
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(true);
    });

    it('should return true when deleting messages', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isDeleting: true,
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(true);
    });

    it('should return true when loading all messages', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          pagination: {
            ...createBaseState().message.pagination,
            isLoadingAll: true,
          },
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(true);
    });

    it('should return false when only loading messages (not load-all)', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isLoading: true,
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });

    it('should return false when only loading forum threads', () => {
      const state = createBaseState({
        channel: {
          ...createBaseState().channel,
          isLoadingForumThreads: true,
        },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });

    it('should return false for guild loading (light tier)', () => {
      const state = createBaseState({
        guild: { ...createBaseState().guild, isLoading: true },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });

    it('should return false for channel loading (light tier)', () => {
      const state = createBaseState({
        channel: { ...createBaseState().channel, isLoading: true },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });

    it('should return false for DM loading (light tier)', () => {
      const state = createBaseState({
        dm: { ...createBaseState().dm, isLoading: true },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });

    it('should return false for user enrichment (light tier)', () => {
      const state = createBaseState({
        message: { ...createBaseState().message, isEnriching: true },
      });
      expect(selectIsHeavyOperationRunning(state)).toBe(false);
    });
  });

  describe('selectIsOperationRunning', () => {
    it('should return false when idle', () => {
      const state = createBaseState();
      expect(selectIsOperationRunning(state)).toBe(false);
    });

    it('should return true when exporting', () => {
      const state = createBaseState({
        export: {
          ...createBaseState().export,
          isExporting: true,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when loading messages', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          isLoading: true,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when purging', () => {
      const state = createBaseState({
        purge: {
          ...createBaseState().purge,
          isPurging: true,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when loading more messages (pagination)', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          pagination: {
            ...createBaseState().message.pagination,
            isLoadingMore: true,
          },
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when guilds are loading', () => {
      const state = createBaseState({
        guild: {
          ...createBaseState().guild,
          isLoading: true,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when channels are loading', () => {
      const state = createBaseState({
        channel: {
          ...createBaseState().channel,
          isLoading: true,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when DMs are loading', () => {
      const state = createBaseState({
        dm: {
          ...createBaseState().dm,
          isLoading: true,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when enriching users', () => {
      const state = createBaseState({
        message: { ...createBaseState().message, isEnriching: true },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    it('should return true when a thread tab is loading', () => {
      const state = createBaseState({
        message: {
          ...createBaseState().message,
          threadTabs: {
            'thread-100': {
              threadId: 'thread-100',
              threadName: 'Test Thread',
              messages: [],
              filteredMessages: [],
              selectedMessages: [],
              searchCriteria: null,
              order: { order: 'desc', orderBy: 'timestamp' },
              isLoading: true,
              error: null,
              pagination: {
                lastMessageId: null,
                hasMore: true,
                totalCount: null,
                isLoadingMore: false,
                isLoadingAll: false,
                loadAllProgress: null,
                mode: 'paginated',
              },
            },
          } as any,
        },
      });
      expect(selectIsOperationRunning(state)).toBe(true);
    });

    /* ────────── Fix A (#109 followup): package rehydration ────────── */

    it('reports package rehydration as a heavy operation with progress', () => {
      const state = createBaseState({
        package: {
          ...createBaseState().package,
          activeEnrichmentChannelId: '200',
          enrichmentProgress: { '200': { current: 45, total: 100 } },
        } as any,
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
      expect(summary.tier).toBe('heavy');
      expect(summary.label).toContain('Rehydrating');
      expect(summary.label).toContain('45/100');
      expect(summary.progress).toBe(45);
    });

    it('reports package rehydration running without progress', () => {
      const state = createBaseState({
        package: {
          ...createBaseState().package,
          activeEnrichmentChannelId: '200',
          enrichmentProgress: {},
        } as any,
      });
      const summary = selectOperationSummary(state);
      expect(summary.isRunning).toBe(true);
      expect(summary.tier).toBe('heavy');
      expect(summary.label).toBe('Rehydrating...');
    });

    it('reports paused rehydration correctly', () => {
      const state = createBaseState({
        app: { ...createBaseState().app, discrubPaused: true },
        package: {
          ...createBaseState().package,
          activeEnrichmentChannelId: '200',
          enrichmentProgress: { '200': { current: 10, total: 50 } },
        } as any,
      });
      const summary = selectOperationSummary(state);
      expect(summary.isPaused).toBe(true);
      expect(summary.label).toMatch(/Paused/);
    });
  });


  describe('purge label parts (#272)', () => {
    const bulkProgress = (overrides: Partial<PurgeProgress>, completed: Partial<NonNullable<PurgeProgress['bulk']>['completedStats']> = {}): PurgeProgress => ({
      processed: 25,
      deleted: 10,
      skipped: 15,
      reactionsRemoved: 0,
      ...overrides,
      bulk: {
        currentIndex: 0,
        totalChannels: 1,
        currentChannelName: 'general',
        completedStats: { deleted: 0, skipped: 0, reactionsRemoved: 0, ...completed },
      },
    });
    const withProgress = (progress: PurgeProgress) =>
      createBaseState({ purge: { ...createBaseState().purge, isPurging: true, purgeProgress: progress } });

    it('shows deleted plus stripped when attachments were stripped', () => {
      const summary = selectOperationSummary(withProgress(bulkProgress({ editedAttachmentsOnly: 4 })));
      expect(summary.label).toBe('Purging... Channel 1/1: general · 25 processed (10 deleted, 4 stripped)');
    });

    it('shows all three parts when something also failed', () => {
      const summary = selectOperationSummary(withProgress(bulkProgress({ editedAttachmentsOnly: 4, failed: 2 })));
      expect(summary.label).toBe('Purging... Channel 1/1: general · 25 processed (10 deleted, 4 stripped, 2 failed)');
    });

    it('shows failed without stripped on a plain delete run that hit an error', () => {
      const summary = selectOperationSummary(withProgress(bulkProgress({ failed: 1 })));
      expect(summary.label).toBe('Purging... Channel 1/1: general · 25 processed (10 deleted, 1 failed)');
    });

    it('adds the counts from channels already completed', () => {
      const summary = selectOperationSummary(withProgress(bulkProgress({ editedAttachmentsOnly: 1, failed: 1 }, { deleted: 5, editedAttachmentsOnly: 9, failed: 3 })));
      expect(summary.label).toBe('Purging... Channel 1/1: general · 25 processed (15 deleted, 10 stripped, 4 failed)');
    });

    it('treats missing counters as zero and keeps the plain label', () => {
      const summary = selectOperationSummary(withProgress(bulkProgress({ editedAttachmentsOnly: undefined, failed: undefined })));
      expect(summary.label).toBe('Purging... Channel 1/1: general · 25 processed (10 deleted)');
    });

    it('still prefers the reactions label when reactions were removed', () => {
      const summary = selectOperationSummary(withProgress(bulkProgress({ reactionsRemoved: 3, editedAttachmentsOnly: 4, failed: 2 })));
      expect(summary.label).toBe('Removing reactions... Channel 1/1: general · 25 scanned (3 removed)');
    });

    it('renders the parts on the non-bulk label too', () => {
      const progress: PurgeProgress = { processed: 7, deleted: 2, skipped: 1, reactionsRemoved: 0, editedAttachmentsOnly: 3, failed: 1 };
      const summary = selectOperationSummary(withProgress(progress));
      expect(summary.label).toBe('Purging... 7 processed (2 deleted, 3 stripped, 1 failed)');
    });

    it('uses the translated paused label on the non-bulk branch', () => {
      const progress: PurgeProgress = { processed: 7, deleted: 2, skipped: 1, reactionsRemoved: 0 };
      const state = createBaseState({
        purge: { ...createBaseState().purge, isPurging: true, purgeProgress: progress },
        app: { ...createBaseState().app, discrubPaused: true },
      });
      expect(selectOperationSummary(state).label).toBe('Paused · Purging');
    });
  });
  // 2.2.0 item 2 (A4): the state overlay every layout reads.
  describe('operation state overlay', () => {
    const exporting = () => createBaseState({ export: { ...createBaseState().export, isExporting: true } });

    it('is idle when nothing runs and running for a heavy operation', () => {
      expect(selectOperationSummary(createBaseState())).toMatchObject({ state: 'idle', stateColor: 'neutral' });
      expect(selectOperationSummary(exporting())).toMatchObject({ state: 'running', stateColor: 'success', name: 'Export' });
    });

    it('reports a rest break with its end time and sentence', () => {
      const state = exporting();
      state.app = { ...state.app, discrubPaused: true, restBreakUntil: 123456 };
      const s = selectOperationSummary(state);
      expect(s).toMatchObject({ state: 'restBreak', stateColor: 'warning', hold: { until: 123456 } });
      expect(s.sentence).toBe('Paused for 10 minutes after 45 minutes of activity. Resume skips the break.');
    });

    it('reports a retry wait with the attempt and the answer', () => {
      const state = exporting();
      state.app = { ...state.app, operationHold: { kind: 'retryWait', until: 99, attempt: 3, max: 5, answer: 'Discord answered HTTP 502' } };
      const s = selectOperationSummary(state);
      expect(s).toMatchObject({ state: 'retrying', stateColor: 'info', hold: { until: 99, attempt: 3, max: 5 } });
      expect(s.sentence).toBe('Discord answered HTTP 502. Each retry waits twice as long, then Export pauses for you.');
    });

    it('reports a pause after retries with the resume point, and a plain pause otherwise', () => {
      const state = exporting();
      state.app = { ...state.app, discrubPaused: true, operationHold: { kind: 'retryExhausted', answer: 'Discord answered HTTP 502', loaded: 1250 } };
      const s = selectOperationSummary(state);
      expect(s).toMatchObject({ state: 'retryPaused', stateColor: 'error', hold: { max: 5, loaded: 1250 } });
      expect(s.sentence).toBe('Discord answered HTTP 502. Wait a bit, then Resume to continue from 1,250 loaded.');
      const plain = exporting();
      plain.app = { ...plain.app, discrubPaused: true };
      expect(selectOperationSummary(plain)).toMatchObject({ state: 'paused', stateColor: 'warning' });
    });

    it('never marks a light operation as holding', () => {
      const state = createBaseState({ message: { ...createBaseState().message, isLoading: true } });
      state.app = { ...state.app, operationHold: { kind: 'retryWait', until: 1, attempt: 1, max: 5, answer: 'x' } };
      expect(selectOperationSummary(state)).toMatchObject({ state: 'running', tier: 'light' });
    });
  });
});
