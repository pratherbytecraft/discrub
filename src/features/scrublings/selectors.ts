import { createSelector } from '@reduxjs/toolkit';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import type { RootState } from '@/app/store';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectHasThemes } from '@features/supporter/supporterSlice';
import { DEFAULT_PICKED, MAX_PICKED, SCRUBLINGS, isScrublingId, type ScrublingId } from './descriptors';
import type { OperationView } from './scheduler';

const selectSettingsState = (state: RootState) => state.app.settings;

export const selectScrublingsEnabled = (state: RootState): boolean =>
  state.app.settings?.[DiscrubSetting.APP_SCRUBLINGS_ENABLED] !== 'false';

/** The picked ids, in order, at most three, unknown ids dropped. A bad value falls back to the default pair. */
export const parsePicked = (raw: string | undefined): ScrublingId[] => {
  if (raw == null) return DEFAULT_PICKED;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PICKED;
    const ids = parsed.filter(isScrublingId);
    return ids.filter((id, i) => ids.indexOf(id) === i).slice(0, MAX_PICKED);
  } catch {
    return DEFAULT_PICKED;
  }
};

export const parsePositions = (raw: string | undefined): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isScrublingId(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
    }
    return out;
  } catch {
    return {};
  }
};

export const selectScrublingsPicked = createSelector(
  [selectSettingsState],
  (settings) => parsePicked(settings?.[DiscrubSetting.APP_SCRUBLINGS_PICKED]),
);

export const selectScrublingsPositions = createSelector(
  [selectSettingsState],
  (settings) => parsePositions(settings?.[DiscrubSetting.APP_SCRUBLINGS_POSITIONS]),
);

/** Whether the key on hand unlocks a Scrubling: free ones always, supporter ones with themes access. */
export const selectScrublingUnlocked = (id: ScrublingId) => (state: RootState): boolean =>
  SCRUBLINGS[id].tier === 'free' || selectHasThemes(state);

/** The picks the bar may show: unlocked ones only. A lapsed key hides the locked picks but keeps the setting. */
export const selectScrublingsVisible = createSelector(
  [selectScrublingsPicked, selectHasThemes, selectScrublingsEnabled],
  (picked, hasThemes, enabled): ScrublingId[] => (enabled ? picked.filter((id) => SCRUBLINGS[id].tier === 'free' || hasThemes) : []),
);

const selectPurge = (state: RootState) => state.purge;
const selectMessage = (state: RootState) => state.message;
const selectApp = (state: RootState) => state.app;

/** The operation as the characters see it: heavy or not, purge-like or load-like, and whether anything failed. */
export const selectScrublingsOperationView = createSelector(
  [selectOperationSummary, selectPurge, selectMessage, selectApp],
  (summary, purge, message, app): OperationView => {
    const heavy = summary.tier === 'heavy';
    const purgeLike = purge.isPurging || message.isDeleting || message.isRemovingReactions;
    const progress = purge.purgeProgress;
    const hasFailures = Boolean(progress && ((progress.failed ?? 0) > 0 || (progress.bulk?.completedStats?.failed ?? 0) > 0));
    return {
      heavy,
      kind: heavy ? (purgeLike ? 'purge' : 'load') : 'other',
      state: summary.state,
      hasFailures,
      rateLimitStopped: app.rateLimitStopped === true,
    };
  },
);
