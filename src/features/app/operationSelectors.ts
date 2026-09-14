import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { t } from '@/i18n';
import { TRANSIENT_RETRIES } from '@/utils/operationLoopUtils';
import { REST_BREAK_AFTER_MINUTES, REST_BREAK_LENGTH_MINUTES } from '@/hooks/restBreakConstants';

export type OperationTier = 'heavy' | 'light' | 'idle';
/**
 * Why the operation is where it is (2.2.0 item 2, decision A4). One state,
 * one colour and one sentence that every layout renders in its own spot.
 * restBreak, retrying and retryPaused only apply to heavy operations; a
 * light operation is running and nothing is idle.
 */
export type OperationState = 'idle' | 'running' | 'paused' | 'restBreak' | 'retrying' | 'retryPaused';
export type OperationStateColor = 'neutral' | 'success' | 'warning' | 'info' | 'error';
export interface OperationHoldView {
  /** Wall-clock ms the hold ends (rest break, retry wait). */
  until?: number;
  attempt?: number;
  max?: number;
  answer?: string;
  loaded?: number;
}

export interface OperationSummary {
  isRunning: boolean;
  isPaused: boolean;
  label: string;
  progress?: number;
  /** heavy = pause/cancel/disables actions, light = spinner + status only */
  tier: OperationTier;
  state: OperationState;
  stateColor: OperationStateColor;
  /** The operation's short name for the state sentences ("Load All", "Export", "Purge"). */
  name: string;
  hold?: OperationHoldView;
  /** The line under the headline. The headline carries a live countdown, so components build it from state and hold. */
  sentence?: string;
}
type BaseSummary = Omit<OperationSummary, 'state' | 'stateColor' | 'name' | 'hold' | 'sentence'>;

const selectExportState = (state: RootState) => state.export;
const selectMessageState = (state: RootState) => state.message;
const selectAppState = (state: RootState) => state.app;
const selectPurgeState = (state: RootState) => state.purge;
const selectChannelState = (state: RootState) => state.channel;
const selectGuildState = (state: RootState) => state.guild;
const selectDmState = (state: RootState) => state.dm;
const selectPackageState = (state: RootState) => state.package;
const selectDevState = (state: RootState) => state.dev;

/**
 * The parenthetical on the running purge label. "deleted" is always
 * shown; "stripped" and "failed" appear only when they are over zero, so
 * a plain delete run renders exactly the label it always has, while an
 * attachments-only run (#272) shows what it is actually doing.
 */
const purgeDetailParts = (deleted: number, stripped: number, failed: number): string => {
  const parts = [t('operation.partDeleted', { count: deleted })];
  if (stripped > 0) parts.push(t('operation.partStripped', { count: stripped }));
  if (failed > 0) parts.push(t('operation.partFailed', { count: failed }));
  return parts.join(', ');
};

const selectBaseSummary = createSelector(
  [selectExportState, selectMessageState, selectAppState, selectPurgeState, selectChannelState, selectGuildState, selectDmState, selectPackageState, selectDevState],
  (exportState, messageState, appState, purgeState, channelState, guildState, dmState, packageState, devState): BaseSummary => {
    const isPaused = appState.discrubPaused;

    // ── HEAVY OPERATIONS (pause/cancel/disable) ──────────────────

    // Purge
    if (purgeState.isPurging) {
      const progress = purgeState.purgeProgress;

      if (progress?.bulk) {
        const { currentIndex, totalChannels, currentChannelName, completedStats, server } = progress.bulk;
        // #255: a multi-server run prefixes the server position and
        // spreads the percentage across servers, so the bar does not
        // jump back to 0 at every server boundary.
        const channelLabel = server
          ? t('operation.serverChannelLabel', {
              serverIndex: server.index + 1,
              serverTotal: server.total,
              serverName: server.name,
              channelIndex: currentIndex + 1,
              channelTotal: totalChannels,
              channelName: currentChannelName,
            })
          : t('operation.channelLabel', {
              channelIndex: currentIndex + 1,
              channelTotal: totalChannels,
              channelName: currentChannelName,
            });
        const isReactionsMode = progress.reactionsRemoved > 0 || completedStats.reactionsRemoved > 0;

        const channelFraction = totalChannels > 0 ? (currentIndex) / totalChannels : 0;
        const overallFraction = server && server.total > 0
          ? (server.index + channelFraction) / server.total
          : channelFraction;
        const pct = Math.round(overallFraction * 100);

        if (isReactionsMode) {
          const totalRemoved = completedStats.reactionsRemoved + progress.reactionsRemoved;
          return {
            isRunning: true, isPaused, tier: 'heavy',
            label: isPaused
              ? t('operation.paused', { label: channelLabel })
              : t('operation.removingReactionsBulk', { label: channelLabel, processed: progress.processed, removed: totalRemoved }),
            progress: pct,
          };
        }

        const detail = purgeDetailParts(
          completedStats.deleted + progress.deleted,
          (completedStats.editedAttachmentsOnly ?? 0) + (progress.editedAttachmentsOnly ?? 0),
          (completedStats.failed ?? 0) + (progress.failed ?? 0),
        );
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused
            ? t('operation.paused', { label: channelLabel })
            : t('operation.purgingBulk', { label: channelLabel, processed: progress.processed, detail }),
          progress: pct,
        };
      }

      if (progress) {
        const detail = purgeDetailParts(progress.deleted, progress.editedAttachmentsOnly ?? 0, progress.failed ?? 0);
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused
            ? t('operation.pausedPurging')
            : t('operation.purgingProgress', { processed: progress.processed, detail }),
        };
      }
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedPurging') : t('operation.purging') };
    }

    // Export
    if (exportState.isExporting) {
      const progress = exportState.exportProgress;
      if (progress?.bulk) {
        const { currentIndex, totalChannels, currentChannelName } = progress.bulk;
        const channelLabel = `Channel ${currentIndex + 1}/${totalChannels}: ${currentChannelName}`;
        if (progress.total > 0) {
          const pct = Math.round((progress.current / progress.total) * 100);
          return {
            isRunning: true, isPaused, tier: 'heavy',
            label: isPaused ? `Paused · ${channelLabel}` : `${channelLabel} (${progress.stage})... ${pct}%`,
            progress: pct,
          };
        }
        return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? `Paused · ${channelLabel}` : channelLabel };
      }
      if (progress) {
        const pct = progress.total > 0
          ? Math.round((progress.current / progress.total) * 100)
          : 0;
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused ? t('operation.pausedExporting') : t('operation.exportingStage', { stage: progress.stage, pct }),
          progress: pct,
        };
      }
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedExporting') : t('operation.exporting') };
    }

    // Deleting messages (heavy — destructive)
    if (messageState.isDeleting) {
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedDeletingMessages') : t('operation.deletingMessages') };
    }

    // Editing messages (heavy — modifying)
    if (messageState.isEditing) {
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedEditingMessages') : t('operation.editingMessages') };
    }

    // Removing reactions (heavy — destructive, supports pause/cancel)
    if (messageState.isRemovingReactions) {
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedRemovingReactions') : t('operation.removingReactions') };
    }

    // Adding reactions (heavy — bulk PUT fan-out, supports pause/cancel; Backlog #202)
    if (messageState.isAddingReactions) {
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedAddingReactions') : t('operation.addingReactions') };
    }

    // Loading all messages (heavy — long-running, many API calls)
    const threadTabValues = Object.values(messageState.threadTabs ?? {});
    const threadLoadingAll = threadTabValues.some((tab) => tab.pagination.isLoadingAll);

    if (messageState.pagination.isLoadingAll || threadLoadingAll) {
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? t('operation.pausedLoadingAllMessages') : t('operation.loadingAllMessages') };
    }

    // Package export (heavy — bulk media download + zip build, can
    // take minutes on attachment-heavy channels, supports pause/cancel
    // via the same shouldContinue plumbing the live export uses).
    // Package thunks set `state.package.exportStatus` rather than
    // `state.export.isExporting`, so we branch on the package flag and
    // read the export-progress data the package thunk's onProgress
    // routes through `setExportProgress`.
    if (packageState.exportStatus === 'running') {
      const progress = exportState.exportProgress;
      if (progress && progress.total > 0) {
        const pct = Math.round((progress.current / progress.total) * 100);
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused
            ? t('operation.pausedPackageExportStage', { stage: progress.stage })
            : t('operation.packageExportStagePct', { stage: progress.stage, pct }),
          progress: pct,
        };
      }
      if (progress) {
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused
            ? t('operation.pausedPackageExportStage', { stage: progress.stage })
            : t('operation.packageExportStage', { stage: progress.stage }),
        };
      }
      return {
        isRunning: true, isPaused, tier: 'heavy',
        label: isPaused ? t('operation.pausedPackageExport') : t('operation.packageExport'),
      };
    }

    // Package rehydration (heavy — per-message Discord API loop, can
    // take several minutes on large channels, supports pause/cancel)
    const activeEnrichId = packageState.activeEnrichmentChannelId;
    if (activeEnrichId) {
      const progress = packageState.enrichmentProgress[activeEnrichId];
      if (progress && progress.total > 0) {
        const pct = Math.round((progress.current / progress.total) * 100);
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused
            ? `Paused · Rehydrating (${progress.current}/${progress.total})`
            : `Rehydrating... ${progress.current}/${progress.total} (${pct}%)`,
          progress: pct,
        };
      }
      return {
        isRunning: true, isPaused, tier: 'heavy',
        label: isPaused ? 'Paused · Rehydrating' : 'Rehydrating...',
      };
    }

    // Seeding (heavy — bulk POSTs across multiple channels, dev tool, #153)
    if (devState.isSeeding) {
      const progress = devState.seedProgress;
      if (progress) {
        const { channelIndex, totalChannels, currentChannelName, current, total } = progress;
        const channelLabel = totalChannels > 1
          ? `Channel ${channelIndex + 1}/${totalChannels}: #${currentChannelName}`
          : `#${currentChannelName}`;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        return {
          isRunning: true, isPaused, tier: 'heavy',
          label: isPaused
            ? `Paused · Seeding ${channelLabel}`
            : `Seeding ${channelLabel} · ${current}/${total}`,
          progress: pct,
        };
      }
      return { isRunning: true, isPaused, tier: 'heavy', label: isPaused ? 'Paused · Seeding' : 'Seeding...' };
    }

    // ── LIGHT OPERATIONS (spinner + status log only) ─────────────

    // Message loading (initial fetch or load-more pagination)
    const threadLoading = threadTabValues.some((tab) => tab.isLoading);
    const threadLoadingMore = threadTabValues.some((tab) => tab.pagination?.isLoadingMore);
    if (messageState.isLoading || threadLoading || messageState.pagination?.isLoadingMore || threadLoadingMore) {
      return { isRunning: true, isPaused: false, tier: 'light', label: t('operation.loadingMessages') };
    }

    // Forum thread loading
    if (channelState.isLoadingForumThreads) {
      return { isRunning: true, isPaused: false, tier: 'light', label: t('operation.loadingForumPosts') };
    }

    // Guild loading
    if (guildState?.isLoading) {
      return { isRunning: true, isPaused: false, tier: 'light', label: t('operation.loadingServers') };
    }

    // Channel loading
    if (channelState?.isLoading) {
      return { isRunning: true, isPaused: false, tier: 'light', label: t('operation.loadingChannels') };
    }

    // DM loading
    if (dmState?.isLoading) {
      return { isRunning: true, isPaused: false, tier: 'light', label: t('operation.loadingDms') };
    }

    // User enrichment (display name / nickname lookups)
    if (messageState.isEnriching) {
      return { isRunning: true, isPaused: false, tier: 'light', label: t('operation.lookingUpUsers') };
    }

    // ── IDLE ─────────────────────────────────────────────────────

    return { isRunning: false, isPaused: false, tier: 'idle', label: t('operation.idle') };
  },
);

const STATE_COLORS: Record<OperationState, OperationStateColor> = {
  idle: 'neutral', running: 'success', paused: 'warning', restBreak: 'warning', retrying: 'info', retryPaused: 'error',
};

const operationName = (exportState: RootState['export'], purgeState: RootState['purge'], packageState: RootState['package'], messageState: RootState['message']): string => {
  if (purgeState.isPurging) return t('operation.names.purge');
  if (exportState.isExporting) return t('operation.names.export');
  if (packageState?.exportStatus === 'running' || packageState?.activeEnrichmentChannelId) return t('operation.names.package');
  if (messageState.pagination?.isLoadingAll || Object.values(messageState.threadTabs ?? {}).some((tab) => tab.pagination?.isLoadingAll)) return t('operation.names.loadAll');
  return t('operation.names.operation');
};

/**
 * The base summary plus the state overlay: which hold, if any, the operation
 * is in, its colour, and the sentence every layout prints under the headline.
 */
export const selectOperationSummary = createSelector(
  [selectBaseSummary, selectAppState, selectExportState, selectPurgeState, selectPackageState, selectMessageState],
  (base, appState, exportState, purgeState, packageState, messageState): OperationSummary => {
    const name = base.tier === 'heavy' ? operationName(exportState, purgeState, packageState, messageState) : t('operation.names.operation');
    if (base.tier !== 'heavy') return { ...base, name, state: base.isRunning ? 'running' : 'idle', stateColor: base.isRunning ? 'success' : 'neutral' };
    const hold = appState.operationHold ?? null;
    const restBreakUntil = appState.restBreakUntil ?? null;
    if (base.isPaused && restBreakUntil != null) {
      return {
        ...base, name, state: 'restBreak', stateColor: STATE_COLORS.restBreak,
        hold: { until: restBreakUntil },
        sentence: t('operation.state.restBreakSentence', { minutes: REST_BREAK_LENGTH_MINUTES, active: REST_BREAK_AFTER_MINUTES }),
      };
    }
    if (hold?.kind === 'retryWait' && !base.isPaused) {
      return {
        ...base, name, state: 'retrying', stateColor: STATE_COLORS.retrying,
        hold: { until: hold.until, attempt: hold.attempt, max: hold.max, answer: hold.answer },
        sentence: t('operation.state.retryingSentence', { answer: hold.answer, name }),
      };
    }
    if (hold?.kind === 'retryExhausted' && base.isPaused) {
      return {
        ...base, name, state: 'retryPaused', stateColor: STATE_COLORS.retryPaused,
        hold: { max: TRANSIENT_RETRIES, answer: hold.answer, loaded: hold.loaded },
        sentence: t('operation.state.retryPausedSentence', { answer: hold.answer, count: hold.loaded.toLocaleString() }),
      };
    }
    if (base.isPaused) return { ...base, name, state: 'paused', stateColor: STATE_COLORS.paused };
    return { ...base, name, state: 'running', stateColor: STATE_COLORS.running };
  },
);

export const selectIsOperationRunning = createSelector(
  [selectOperationSummary],
  (summary) => summary.isRunning,
);

/** True only for heavy operations that should disable buttons and show pause/cancel */
export const selectIsHeavyOperationRunning = createSelector(
  [selectOperationSummary],
  (summary) => summary.tier === 'heavy',
);
