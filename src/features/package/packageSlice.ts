import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { validatePackage } from '@/services/packageValidation';
import {
  importPackageToStorage,
  loadChannelMessagesFromStorage,
  resumePackageFromStorage,
  clearPackageContents,
  hasStoredPackage,
} from '@/services/packageStreamService';
import { getDiscordService } from '@/services/discordService';
import { getExportService } from '@/services/exportService';
import {
  CancelledError,
  cancellableDelay,
  checkCancelled,
  createShouldContinue,
  waitWhilePaused,
  withTransientRetry,
} from '@/utils/operationLoopUtils';
import {
  applyExportThemeSetFromState,
  applyExportFooterFromState,
  createRowErrorReporter,
  logMediaProgress,
  setExportProgress,
  type ExportDispatch,
} from '@features/export/exportSlice';
import type { MediaDownloadProgress } from '@features/export/exportTypes';
import { calculateRandomDelay } from '@/utils/delayUtils';
import { addStatusEntry } from '@features/status/statusSlice';
import {
  selectDelayModifier,
  selectDeleteDelay,
  selectSearchDelay,
  setDiscrubCancelled,
} from '@features/app/appSlice';
import {
  readDeletedCache,
  readGoneCache,
  writeDeletedCache,
  writeGoneCache,
  recordDeletions,
  externalDeletionsRecorded,
  type DeletedCacheMap,
} from './packageDeletedCache';
import {
  formatDeleteSummary,
  deleteSummaryLevel,
  formatRehydrateLogSummary,
} from '@features/package/packageStatusCopy';
import { IsPinnedType, QueryStringParam } from 'discrub-core/discord-enum';
import type {
  Message,
  SearchMessageResult,
} from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { toDiscordMessage } from './packageMessageAdapter';
import { applyPackageFilter, hasAnyPackageCriterion } from './packageFilter';
import {
  enrichmentCache,
  type EnrichedChannelCache,
} from './enrichmentCache';
import type { RootState } from '@/app/store';
import type {
  PackageMessage,
  PackageValidationResult,
  ParsedPackage,
  ImportDiagnostics,
} from './packageTypes';
import { t } from '@/i18n';

/**
 * Maximum number of channels whose parsed messages are kept in memory
 * at once. When exceeded, the least-recently-accessed channel is evicted.
 */
const LOADED_CHANNELS_LIMIT = 5;
/**
 * Live `Message` objects are heavier than CSV rows (reactions arrays,
 * embeds, mentions, attachments), so we keep fewer in memory at once.
 * The IDB cache still holds everything; eviction just frees the JS
 * heap — re-entering an evicted channel re-hydrates from IDB instantly.
 */
const ENRICHED_CHANNELS_LIMIT = 5;

export type PackageStatus =
  | 'idle'
  | 'parsing'
  | 'ready'
  | 'error';

export type TimelineStatus = 'idle' | 'loading' | 'ready' | 'error';
export type DeleteStatus = 'idle' | 'running' | 'ready' | 'error';
export type PackageExportStatus = 'idle' | 'running' | 'ready' | 'error';
export type EnrichmentStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface EnrichmentResult {
  channelId: string;
  fromCache: boolean;
  enriched: number;
  deleted: number;
  forbidden: number;
  cancelled: boolean;
  /**
   * Set when preflight returns 404 on the guild/channel search
   * endpoint — strong evidence the whole channel is gone. Distinct
   * from `cancelled` so the UI can render the appropriate status.
   */
  channelInaccessible?: boolean;
  /** HTTP status code when `channelInaccessible === true`. */
  inaccessibleStatus?: number;
}

export interface DeleteResult {
  /** Messages that returned 2xx (server accepted the delete). */
  deleted: number;
  /** Messages Discord said were already gone (404). */
  alreadyGone: number;
  /** Messages blocked by permissions (403) — typical for orphan channels. */
  forbidden: number;
  /** Unexpected errors (network, 5xx). */
  failed: number;
  /** User cancelled mid-run. */
  cancelled: boolean;
  /** IDs Discord accepted a DELETE for during this run. */
  deletedIds: string[];
  /** IDs Discord answered 404 for: already gone before this run (#271). */
  alreadyGoneIds: string[];
}

export interface PackageState {
  status: PackageStatus;
  parsed: ParsedPackage | null;
  validation: PackageValidationResult | null;
  error: string | null;
  selectedChannelId: string | null;
  loadedChannels: Record<string, PackageMessage[]>;
  loadedOrder: string[];
  loadingChannelId: string | null;
  /** Per-channel message selection (message IDs chosen for delete). */
  selectedMessageIds: Record<string, string[]>;
  timelineStatus: TimelineStatus;
  timelineTimestamps: string[];
  timelineProgress: { current: number; total: number } | null;
  timelineError: string | null;
  deleteStatus: DeleteStatus;
  deleteProgress: { current: number; total: number } | null;
  deleteResult: DeleteResult | null;
  deleteError: string | null;
  exportStatus: PackageExportStatus;
  exportError: string | null;
  /**
   * Per-channel map of message IDs that have been successfully deleted
   * (or discovered already-gone via 404) during this or any previous
   * session with the same authenticated user. Persisted to local
   * storage so re-importing the same package doesn't resurrect rows
   * the user already cleaned up.
   */
  deletedMessageIds: Record<string, string[]>;
  /**
   * #271: the subset of `deletedMessageIds` that a DELETE answered 404
   * for, i.e. the message was already gone before Discrub tried it.
   * Provenance shown to the user ("deleted via Discrub") is the union
   * minus this map. Persisted under `gone:{userId}`.
   */
  goneMessageIds: Record<string, string[]>;
  /**
   * #269: compressed bytes read so far while an import runs, for the
   * determinate bar in ImportDialog. Null when no import is running.
   */
  importProgress: { read: number; total: number } | null;
  /**
   * Tier 2 rehydration state — per-channel enrichment results fetched
   * from Discord's API. A channel with no entry here is Tier 1 (source
   * only). When a channel has been enriched, rows render with live
   * reactions / mentions / embeds / fresh CDN URLs from `live`.
   */
  enrichmentStatus: Record<string, EnrichmentStatus>;
  enrichmentProgress: Record<string, { current: number; total: number }>;
  /** channelId → messageId → live Message. Missing IDs are still source-only. */
  enrichedMessages: Record<string, Record<string, Message>>;
  enrichmentMisses: Record<string, { deleted: string[]; forbidden: string[] }>;
  enrichmentError: Record<string, string | null>;
  enrichmentLastFetched: Record<string, number>;
  /** LRU ordering of channelIds in `enrichedMessages`; oldest first. */
  enrichedOrder: string[];
  /**
   * Only one channel may enrich at a time — Discord's per-endpoint rate
   * limits would otherwise interfere with live operations (exports,
   * deletes). Non-null means an enrichment loop is actively running.
   */
  activeEnrichmentChannelId: string | null;
  /**
   * Per-channel filter criteria (#172). Persists for the session so
   * users can switch channels and come back to a filtered view. Cleared
   * when the package is re-imported or the user explicitly clicks Clear.
   */
  filterCriteria: Record<string, import('discrub-core/types/discrub-types').SearchCriteria | null>;
}

export const initialPackageState: PackageState = {
  status: 'idle',
  parsed: null,
  validation: null,
  error: null,
  selectedChannelId: null,
  loadedChannels: {},
  loadedOrder: [],
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
  importProgress: null,
  enrichmentStatus: {},
  enrichmentProgress: {},
  enrichedMessages: {},
  enrichmentMisses: {},
  enrichmentError: {},
  enrichmentLastFetched: {},
  enrichedOrder: [],
  activeEnrichmentChannelId: null,
  filterCriteria: {},
};

/**
 * F19 (#236): the deleted cache is keyed per user with no package
 * fingerprint. A FRESH package (requested after the purges ran) already
 * excludes those messages from its archive and counts, so subtracting
 * the cached ids again under-reported every affected channel (small
 * ones read "empty"). Prune the cache against the newly streamed
 * archive: a cached id is a valid subtraction only while the archive
 * still contains that message. Channels absent from the new archive
 * drop out entirely; re-importing the same package keeps every id
 * (they are all still present), which is the #236 behavior the cache
 * exists for. The pruned map is written back so later resumes stay
 * consistent without re-pruning.
 */
async function pruneDeletedCacheAgainstArchive(
  parsed: ParsedPackage,
  cache: DeletedCacheMap,
  gone: DeletedCacheMap = {},
): Promise<{ deleted: DeletedCacheMap; gone: DeletedCacheMap }> {
  const cachedChannelIds = Array.from(new Set([...Object.keys(cache), ...Object.keys(gone)]));
  if (cachedChannelIds.length === 0) return { deleted: cache, gone };

  const archiveChannelIds = new Set(parsed.channels.map((c) => c.id));
  const pruned: DeletedCacheMap = {};
  const prunedGone: DeletedCacheMap = {};
  let changed = false;
  let goneChanged = false;

  for (const channelId of cachedChannelIds) {
    const ids = cache[channelId] ?? [];
    const goneIds = gone[channelId] ?? [];
    if (!archiveChannelIds.has(channelId) || (ids.length === 0 && goneIds.length === 0)) {
      if (ids.length > 0 || channelId in cache) changed = true;
      if (goneIds.length > 0 || channelId in gone) goneChanged = true;
      continue;
    }
    try {
      const messages = await loadChannelMessagesFromStorage(parsed.user.id, channelId);
      const present = new Set(messages.map((m) => m.id));
      const kept = ids.filter((id) => present.has(id));
      if (kept.length > 0) pruned[channelId] = kept;
      if (kept.length !== ids.length) changed = true;
      // #271: the gone subset can only hold ids the union holds.
      const keptSet = new Set(kept);
      const keptGone = goneIds.filter((id) => keptSet.has(id));
      if (keptGone.length > 0) prunedGone[channelId] = keptGone;
      if (keptGone.length !== goneIds.length) goneChanged = true;
    } catch {
      // Unreadable channel: keep the cached ids rather than guessing —
      // worst case is the pre-fix behavior, for this channel only.
      if (ids.length > 0) pruned[channelId] = ids;
      if (goneIds.length > 0) prunedGone[channelId] = goneIds;
    }
  }

  if (changed) await writeDeletedCache(parsed.user.id, pruned);
  if (goneChanged) await writeGoneCache(parsed.user.id, prunedGone);
  return { deleted: pruned, gone: prunedGone };
}

/**
 * No more module-level File reference (#162). Once `streamPackageToStorage`
 * has run, every read goes through IndexedDB. The original File handle
 * is dropped on the floor by `importPackage` and not retained anywhere.
 */

/**
 * Cache-only hydrate: if an enrichment cache already exists in IDB for
 * the given channel, copy it into Redux. No network calls, no loop.
 * Intended to fire on channel open so users returning to a previously
 * rehydrated channel see their results immediately (with a "Refresh"
 * button) instead of a cold "Rehydrate" button.
 *
 * No-ops when: no authenticated user, no parsed package, no cache
 * present, or enrichment is already loaded/running for this channel.
 */
export const hydrateCachedEnrichment = createAsyncThunk<
  { channelId: string; hydrated: boolean },
  { channelId: string },
  { state: RootState }
>('package/hydrateCachedEnrichment', async ({ channelId }, { getState, dispatch }) => {
  const state = getState();
  const userId = state.package.parsed?.user.id;
  if (!userId) return { channelId, hydrated: false };

  // Skip if something already populated state for this channel — we
  // don't want to clobber a fresh in-progress enrichment's deltas.
  const already =
    state.package.enrichedMessages[channelId] !== undefined ||
    state.package.enrichmentStatus[channelId] === 'running';
  if (already) return { channelId, hydrated: false };

  const cached = await enrichmentCache.get(userId, channelId);
  if (!cached) return { channelId, hydrated: false };

  dispatch(hydrateEnrichmentFromCache({ channelId, cache: cached }));
  return { channelId, hydrated: true };
});

/**
 * Hydrate the per-channel deletedMessageIds map from persisted storage
 * for the given user. Safe to re-dispatch anytime. Import/resume no
 * longer rely on it (#236) — they fold the cache read into their own
 * payloads so hydration can't race the fulfilled reducers — but it
 * remains a valid standalone recovery path.
 */
export const hydratePackageDeletedCache = createAsyncThunk<
  { deleted: DeletedCacheMap; gone: DeletedCacheMap },
  { userId: string },
  { state: RootState }
>('package/hydrateDeletedCache', async ({ userId }) => {
  const [deleted, gone] = await Promise.all([readDeletedCache(userId), readGoneCache(userId)]);
  return { deleted, gone };
});

/**
 * Full package reset — wipes in-memory state AND purges the per-user
 * IDB entries (streamed package + enrichment cache). Use this instead
 * of the raw `clearPackage` reducer when a user clicks "Clear package"
 * or switches packages, so Discrub-package doesn't accumulate orphaned
 * records.
 */
export const resetPackage = createAsyncThunk<
  void,
  void,
  { state: RootState }
>('package/reset', async (_, { getState, dispatch }) => {
  const userId = getState().package.parsed?.user.id;
  if (userId) {
    try {
      await Promise.all([
        clearPackageContents(userId),
        enrichmentCache.clearAll(userId),
      ]);
    } catch {
      /* storage is best-effort — UI proceeds either way */
    }
  }
  dispatch(clearPackage());
});

/** Remove the persisted deleted-message history for the current user. */
export const clearPackageDeletedCache = createAsyncThunk<
  void,
  void,
  { state: RootState }
>('package/clearDeletedCache', async (_, { getState }) => {
  const userId = getState().package.parsed?.user.id;
  if (!userId) return;
  await Promise.all([writeDeletedCache(userId, {}), writeGoneCache(userId, {})]);
});

/** Parse a Discord data package file and validate it against the current auth. */
export const importPackage = createAsyncThunk<
  {
    parsed: ParsedPackage;
    validation: PackageValidationResult;
    deletedMessageIds: DeletedCacheMap;
    goneMessageIds: DeletedCacheMap;
  },
  File | Blob | ArrayBuffer,
  { state: RootState; rejectValue: string }
>('package/import', async (input, { getState, dispatch, rejectWithValue }) => {
  try {
    // Stream once into IndexedDB (#162, #269). After this returns, every
    // subsequent channel/avatar read is an O(1) IDB lookup; the
    // original File handle is no longer needed. The reader reports
    // compressed bytes as it goes; only whole-percent changes reach
    // the store.
    let lastPct = -1;
    const { parsed, diagnostics } = await importPackageToStorage(input, {
      onBytes: (read, total) => {
        const pct = total > 0 ? Math.floor((read / total) * 100) : 0;
        if (pct === lastPct && read < total) return;
        lastPct = pct;
        dispatch(setImportProgress({ read, total }));
      },
    });
    const state = getState();
    const authedUserId = state.user?.currentUser?.id ?? null;
    const validation = validatePackage(parsed, authedUserId);

    if (!validation.ok) {
      // Clean up the partially-imported package — we don't want orphan
      // pkg:* keys for a user we won't grant capabilities to.
      try {
        await clearPackageContents(parsed.user.id);
      } catch { /* best-effort */ }
      return rejectWithValue(validation.errors.join(' ') || 'Invalid package');
    }

    // Read the persisted deleted-message cache for this user so
    // already-purged messages stay hidden across sessions. Folded into
    // the payload (#236) rather than fired as a separate hydrate thunk:
    // the fulfilled reducer applies parsed + deleted ids atomically, so
    // hydration can never lose a race against the reducer's state reset.
    // F19: pruned against the just-streamed archive so a fresh package's
    // already-reduced counts aren't double-subtracted.
    const [deletedCache, goneCache] = await Promise.all([
      readDeletedCache(parsed.user.id),
      readGoneCache(parsed.user.id),
    ]);
    const { deleted: deletedMessageIds, gone: goneMessageIds } = await pruneDeletedCacheAgainstArchive(
      parsed,
      deletedCache,
      goneCache,
    );

    // #269: one line about what the reader saw. A warning when folders
    // were skipped or a channel parsed to nothing, so a package that
    // "loaded fine" with missing pieces says so where the user looks.
    const dropped =
      diagnostics.droppedMissingChannelJson +
      diagnostics.droppedMissingMessages +
      diagnostics.droppedUnparsableChannelJson;
    const troubled = dropped > 0 || diagnostics.channelsWithNoStoredRows > 0 || diagnostics.unrecognizedTypes > 0;
    dispatch(addStatusEntry({
      level: troubled ? 'warning' : 'info',
      message: formatImportDiagnostics(parsed, diagnostics),
    }));

    return { parsed, validation, deletedMessageIds, goneMessageIds };
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to parse package');
  }
});

/** #269: the status-log line written once per import. */
export function formatImportDiagnostics(parsed: ParsedPackage, d: ImportDiagnostics): string {
  const parts: string[] = [
    t('status.package.imported', {
      channels: t('package.channels', { count: parsed.channels.length }),
      messages: t('package.messages', { count: parsed.totalMessages }),
    }),
  ];
  const dropped = d.droppedMissingChannelJson + d.droppedMissingMessages + d.droppedUnparsableChannelJson;
  if (dropped > 0) {
    const reasons: string[] = [];
    if (d.droppedMissingChannelJson > 0) reasons.push(t('status.package.droppedNoChannelJson', { count: d.droppedMissingChannelJson }));
    if (d.droppedMissingMessages > 0) reasons.push(t('status.package.droppedNoMessages', { count: d.droppedMissingMessages }));
    if (d.droppedUnparsableChannelJson > 0) reasons.push(t('status.package.droppedUnreadable', { count: d.droppedUnparsableChannelJson }));
    parts.push(t('status.package.droppedFolders', { count: dropped, reasons: reasons.join(', ') }));
  }
  if (d.channelsWithNoStoredRows > 0) {
    parts.push(t('status.package.noStoredRows', {
      count: d.channelsWithNoStoredRows,
      keys: d.sampleRowKeys && d.sampleRowKeys.length > 0 ? d.sampleRowKeys.join(', ') : t('status.package.unknown'),
    }));
  }
  if (d.unrecognizedTypes > 0) {
    parts.push(t('status.package.unrecognizedTypes', { count: d.unrecognizedTypes }));
  }
  return parts.join(' ');
}

/**
 * Resume a previously-streamed package from IndexedDB without touching
 * a File handle. Returns null payload if no stored package matches the
 * current user, otherwise hydrates `state.package.parsed` so the UI
 * shows the package without a re-upload.
 */
export const resumeStoredPackage = createAsyncThunk<
  {
    parsed: ParsedPackage;
    validation: PackageValidationResult;
    deletedMessageIds: DeletedCacheMap;
    goneMessageIds: DeletedCacheMap;
  } | null,
  void,
  { state: RootState; rejectValue: string }
>('package/resume', async (_, { getState, rejectWithValue }) => {
  try {
    const authedUserId = getState().user?.currentUser?.id ?? null;
    if (!authedUserId) return null;
    const parsed = await resumePackageFromStorage(authedUserId);
    if (!parsed) return null;
    const validation = validatePackage(parsed, authedUserId);
    if (!validation.ok) return null;

    // #236: read the deleted cache here (not via a fire-and-forget
    // hydrate dispatch) so the fulfilled reducer sets deleted ids in
    // the same action that hydrates `parsed` — no ordering hazard.
    const [deletedMessageIds, goneMessageIds] = await Promise.all([
      readDeletedCache(parsed.user.id),
      readGoneCache(parsed.user.id),
    ]);
    return { parsed, validation, deletedMessageIds, goneMessageIds };
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to resume package');
  }
});

/** True iff IDB holds a stored package for the authenticated user. */
export async function hasResumablePackage(userId: string): Promise<boolean> {
  return hasStoredPackage(userId);
}

/** Lazily load (or return cached) parsed messages for one channel. */
export const loadPackageChannelMessages = createAsyncThunk<
  { channelId: string; messages: PackageMessage[] },
  string,
  { state: RootState; rejectValue: string }
>('package/loadChannel', async (channelId, { getState, rejectWithValue }) => {
  const cached = getState().package.loadedChannels[channelId];
  if (cached) return { channelId, messages: cached };

  const userId = getState().package.parsed?.user.id;
  if (!userId) return rejectWithValue('No package loaded');

  try {
    const messages = await loadChannelMessagesFromStorage(userId, channelId);
    return { channelId, messages };
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to load channel');
  }
});

/**
 * One-shot pass that loads every channel's CSV, extracts just the
 * timestamp strings, and stores them on `state.timelineTimestamps`. Used
 * by the analytics view to compute month/year/hour buckets without
 * holding full message content in memory.
 *
 * Emits progress via `package/loadAllTimestamps/progress` action so the
 * analytics view can show a progress bar.
 */
export const loadAllPackageTimestamps = createAsyncThunk<
  string[],
  void,
  { state: RootState; rejectValue: string }
>('package/loadAllTimestamps', async (_, { getState, dispatch, rejectWithValue }) => {
  const parsed = getState().package.parsed;
  if (!parsed) return rejectWithValue('No package loaded');
  const userId = parsed.user.id;

  const timestamps: string[] = [];
  const total = parsed.channels.length;

  for (let i = 0; i < total; i++) {
    const channel = parsed.channels[i];
    dispatch(setTimelineProgress({ current: i, total }));

    try {
      const cached = getState().package.loadedChannels[channel.id];
      const messages = cached ?? (await loadChannelMessagesFromStorage(userId, channel.id));
      for (const m of messages) timestamps.push(m.timestamp);
    } catch {
      // Skip unreadable channels rather than aborting the whole load.
    }
  }

  dispatch(setTimelineProgress({ current: total, total }));
  return timestamps;
});

/**
 * Deletes the messages currently selected in one package channel using
 * the Discord API. Honors the user's delete delay + pause/cancel flags
 * via the same helpers the purge loop uses. Tolerates per-message 404
 * (already deleted) and 403 (e.g. orphan channel) without aborting the
 * run — summarized outcomes land in `state.deleteResult`.
 */
export const deletePackageMessages = createAsyncThunk<
  DeleteResult,
  { channelId: string },
  { state: RootState; rejectValue: string }
>('package/deleteMessages', async ({ channelId }, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const token = state.auth.token;
  if (!token) return rejectWithValue('Not authenticated');

  const validation = state.package.validation;
  if (!validation || validation.readOnly) {
    return rejectWithValue('Package is in read-only mode');
  }

  const channel = state.package.parsed?.channels.find((c) => c.id === channelId);
  if (!channel) return rejectWithValue('Channel not found in package');
  if (channel.isOrphan) return rejectWithValue("You are no longer in this server, so messages can't be deleted");

  // Filter out messages we already know don't exist on Discord — either
  // because this user deleted them previously or because rehydration
  // confirmed a 404. Selection-time UI disables these rows as well;
  // this is the belt to that suspenders guard so any stale selection
  // (e.g., pre-rehydrate → rehydrate → delete) doesn't waste API calls.
  const rawIds = state.package.selectedMessageIds[channelId] ?? [];
  const goneSet = new Set<string>([
    ...(state.package.deletedMessageIds[channelId] ?? []),
    ...(state.package.enrichmentMisses[channelId]?.deleted ?? []),
  ]);
  const ids = rawIds.filter((id) => !goneSet.has(id));
  if (ids.length === 0) {
    if (rawIds.length > 0) {
      return rejectWithValue(
        'All selected messages were already gone on Discord.',
      );
    }
    return rejectWithValue('No messages selected.');
  }

  const deleteDelay = selectDeleteDelay(state);
  const delayModifier = selectDelayModifier(state);
  const discordService = getDiscordService();

  const result: DeleteResult = {
    deleted: 0,
    alreadyGone: 0,
    forbidden: 0,
    failed: 0,
    cancelled: false,
    deletedIds: [],
    alreadyGoneIds: [],
  };

  // #271: a run that started with a stale selection (messages removed
  // by the live purge after the package was exported) answers 404 for
  // every one. Say so as it goes, not only at the end.
  const noteAlreadyGone = (tried: number) => {
    result.alreadyGone += 1;
    if (result.alreadyGone % ALREADY_GONE_LOG_EVERY === 0) {
      dispatch(addStatusEntry({
        level: 'info',
        message: t('status.package.alreadyGoneProgress', { gone: result.alreadyGone, tried }),
      }));
    }
  };

  dispatch(addStatusEntry({
    level: 'info',
    message: t('status.package.deleting', { count: ids.length }),
  }));

  try {
    for (let i = 0; i < ids.length; i++) {
      await waitWhilePaused(getState);
      if (checkCancelled(getState)) throw new CancelledError();

      dispatch(setDeleteProgress({ current: i, total: ids.length }));

      const messageId = ids[i];
      let wasAlreadyGone = false;
      try {
        // discrub-core's `discordService.deleteMessage` does NOT throw
        // on HTTP errors; its `withRetry` wrapper catches and returns a
        // `{ success, status }` object. We inspect that. The catch is
        // kept for genuinely-thrown exceptions (CancelledError surfacing
        // through the await chain, programming errors, etc.).
        const apiResult = await discordService.deleteMessage(token, messageId, channelId);
        if (apiResult.success) {
          result.deleted += 1;
          result.deletedIds.push(messageId);
        } else if (apiResult.status === 404) {
          noteAlreadyGone(i + 1);
          result.alreadyGoneIds.push(messageId);
          wasAlreadyGone = true;
        } else if (apiResult.status === 403) {
          result.forbidden += 1;
        } else {
          result.failed += 1;
          dispatch(addStatusEntry({
            level: 'error',
            message: t('status.package.deleteFailedHttp', { id: messageId, status: apiResult.status ?? t('status.package.unknown') }),
          }));
        }
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const status = extractHttpStatus(err);
        if (status === 404) {
          noteAlreadyGone(i + 1);
          result.alreadyGoneIds.push(messageId);
          wasAlreadyGone = true;
        } else if (status === 403) {
          result.forbidden += 1;
        } else {
          result.failed += 1;
          dispatch(addStatusEntry({
            level: 'error',
            message: t('status.package.deleteFailed', { id: messageId, error: err instanceof Error ? err.message : t('status.package.unknownError') }),
          }));
        }
      }

      // Delay between deletes — unless we're on the last one. A 404 did
      // not delete anything, so it only pays a short floor (#271) instead
      // of the full Delete Delay; a stale selection of thousands would
      // otherwise wait hours for nothing.
      if (i < ids.length - 1) {
        const calc = calculateRandomDelay(deleteDelay, delayModifier);
        const delayMs = wasAlreadyGone ? Math.min(calc.delayMs, ALREADY_GONE_DELAY_MS) : calc.delayMs;
        const wasCancelled = await cancellableDelay(delayMs, getState);
        if (wasCancelled) throw new CancelledError();
      }
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      result.cancelled = true;
    } else {
      dispatch(addStatusEntry({
        level: 'error',
        message: t('status.package.deleteStopped', { error: err instanceof Error ? err.message : t('status.package.unknownError') }),
      }));
    }
  }

  dispatch(setDeleteProgress({ current: ids.length, total: ids.length }));
  dispatch(addStatusEntry({
    level: deleteSummaryLevel(result),
    message: formatDeleteSummary(result),
  }));
  if (result.alreadyGone > 0 && result.alreadyGone * 2 > ids.length) {
    dispatch(addStatusEntry({
      level: 'warning',
      message: t('status.package.mostlyGoneHint'),
    }));
  }

  // Persist the updated caches so the history survives reloads. Both
  // writes go through the serialised cache module, which re-reads the
  // persisted blob first, so a live purge feeding the cache at the same
  // time cannot be clobbered by the state captured at thunk start.
  const userId = state.package.parsed?.user.id;
  if (userId) {
    await recordDeletions(userId, channelId, result.deletedIds, 'deleted');
    await recordDeletions(userId, channelId, result.alreadyGoneIds, 'gone');
  }

  return result;
});

/** #271: log a progress line after this many already-gone answers. */
export const ALREADY_GONE_LOG_EVERY = 50;
/** #271: the wait after a 404 instead of the full Delete Delay. */
export const ALREADY_GONE_DELAY_MS = 250;

/** Best-effort HTTP-status extraction for errors surfaced by discord-service/fetch. */
function extractHttpStatus(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const maybe = err as { status?: number; statusCode?: number; response?: { status?: number } };
    if (typeof maybe.status === 'number') return maybe.status;
    if (typeof maybe.statusCode === 'number') return maybe.statusCode;
    if (maybe.response && typeof maybe.response.status === 'number') return maybe.response.status;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Export one package channel to a ZIP.
 *
 * When enriched live messages exist (Tier 2), we prefer them over the
 * package-adapted shapes so exports match the live app's message
 * rendering (reactions, edits, replies). For media downloads, package
 * attachment URLs (post-2025-06-14, with the `uc=dp` discriminator) are
 * permanently-signed by Discord and work without rehydration —
 * `includeMedia` flows directly through to mediaDownloadService and
 * downloads them locally. Pre-2025 packages have ephemeral URLs that
 * may 403; users are warned via the legacy-format banner at import time
 * and can opt into rehydration before export to refresh URLs.
 *
 * Parameters mirror `exportMessages` so the same ExportDialog can drive
 * both live and package exports with `exportContext: 'package'`.
 */
export interface ExportPackageChannelParams {
  channelId: string;
  format: 'html' | 'csv' | 'json' | 'media' | 'text';
  messagesPerPage: number;
  includeMedia: boolean;
  mediaConfig?: import('@features/export/exportTypes').MediaConfig;
  exportConfig: import('@features/export/exportTypes').ExportConfig;
  /**
   * If true and the channel hasn't been rehydrated yet, run
   * `enrichPackageChannel` before exporting. No-op when cached.
   */
  rehydrateFirst?: boolean;
}

export const exportPackageChannel = createAsyncThunk<
  { channelId: string },
  ExportPackageChannelParams,
  { state: RootState; rejectValue: string }
>(
  'package/exportChannel',
  async (params, { getState, dispatch, rejectWithValue }) => {
    const {
      channelId,
      format,
      messagesPerPage,
      includeMedia,
      mediaConfig,
      exportConfig,
      rehydrateFirst,
    } = params;

    let state = getState();
    const parsed = state.package.parsed;
    if (!parsed) return rejectWithValue('No package loaded');

    const channel = parsed.channels.find((c) => c.id === channelId);
    if (!channel) return rejectWithValue('Channel not found in package');

    // Ensure CSV messages are loaded (needed to know the set of IDs to
    // export even when we then prefer enriched objects).
    let packageMessages = state.package.loadedChannels[channelId];
    if (!packageMessages) {
      try {
        packageMessages = await loadChannelMessagesFromStorage(parsed.user.id, channelId);
      } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to read channel');
      }
    }
    if (packageMessages.length === 0) {
      return rejectWithValue('Channel has no messages to export');
    }

    // Optional pre-enrichment: run the API loop first so downstream
    // export sees live reactions/mentions/embeds and fresh CDN URLs.
    if (rehydrateFirst && !state.package.enrichedMessages[channelId]) {
      await dispatch(enrichPackageChannel({ channelId }));
      state = getState();
    }

    const enrichedMap = state.package.enrichedMessages[channelId];

    // #172: respect the active package filter for this channel. When
    // the user has refined the table view, the export should only
    // include the visible subset; otherwise the "Export" button on a
    // filtered view would silently emit every message and surprise the
    // user.
    const activeCriteria = state.package.filterCriteria[channelId] ?? null;
    const totalPackageMessages = packageMessages.length;
    const filteredPackageMessages = activeCriteria
      ? applyPackageFilter(packageMessages, activeCriteria)
      : packageMessages;

    // Discord's post-2025-06-14 package format ships permanently-signed
    // CDN URLs (the `uc=dp` discriminator), so a media-only export
    // against the package URLs is now a valid path even without
    // rehydration. Pre-2025 packages have ephemeral URLs that may 403
    // — users get the legacy-format banner at import time + a per-URL
    // download warning during export, but we don't gate the operation.
    const discordMessages: Message[] = filteredPackageMessages.map((pm) => {
      const live = enrichedMap?.[pm.id];
      // Enriched message wins; fall back to package-adapted shape.
      return live ?? (toDiscordMessage(pm, channelId, parsed.user) as Message);
    });

    const channelName =
      channel.name ?? (channel.type === 1 ? 'Direct Message' : channel.id);

    const filterScopeLabel =
      activeCriteria && hasAnyPackageCriterion(activeCriteria)
        ? ` (filtered: ${discordMessages.length} of ${totalPackageMessages})`
        : '';
    dispatch(addStatusEntry({
      level: 'info',
      message: t('status.package.exportStarting', { format: format.toUpperCase(), name: channelName, scope: filterScopeLabel }),
    }));

    const exportService = getExportService();
    applyExportThemeSetFromState(getState());
    await applyExportFooterFromState(getState());

    // Mirror the live export's progress + cancel wiring (#162). Without
    // these, package exports were silent for the entire media-download
    // phase (a 784-message DM with attachments produced 2 status-log
    // lines for 2:45 of work) and Pause/Cancel were no-ops.
    const shouldContinue = createShouldContinue(getState);
    const scope = ` for "${channelName}"`;
    const onProgress = (progress: number | MediaDownloadProgress) => {
      if (typeof progress === 'object') {
        dispatch(setExportProgress(progress));
        logMediaProgress(progress, dispatch as ExportDispatch, scope);
      }
    };

    // Surface zip-path renames in the status log (#224) — the rename itself
    // happens inside StreamingZipService regardless of this wiring.
    const zipOptions = {
      onPathCollision: ({ requestedPath, finalPath }: { requestedPath: string; finalPath: string }) => {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.export.pathCollision', { requested: requestedPath, final: finalPath }),
        }));
      },
    };

    try {
      if (format === 'media') {
        await exportService.exportMediaOnly(
          discordMessages,
          channelName,
          mediaConfig,
          onProgress,
          exportConfig,
          shouldContinue,
          undefined,   // externalZipService
          zipOptions,
        );
      } else {
        const rowErrors = createRowErrorReporter(dispatch as ExportDispatch, channelName);
        await exportService.exportToZip(
          discordMessages,
          channelName,
          format,
          messagesPerPage,
          includeMedia,
          null,  // guild
          {},    // cachedUserMap — package userMap is minimal
          channel.guildId ?? null,
          onProgress,
          mediaConfig,
          exportConfig,
          shouldContinue,
          undefined,                   // externalZipService
          undefined,                   // separateThreads
          undefined,                   // threads
          undefined,                   // reactionMap
          undefined,                   // guildRoles
          state.export?.textOptions,   // #184: thread text-format options (optional — fall back to defaults inside exportToZip when absent)
          zipOptions,
          rowErrors.onRowError,
        );
        rowErrors.flush();
      }

      dispatch(addStatusEntry({
        level: 'success',
        message: t('status.package.exportCompleted', { name: channelName }),
      }));
      return { channelId };
    } catch (err) {
      if (err instanceof CancelledError) {
        dispatch(addStatusEntry({
          level: 'warning',
          message: t('status.package.exportCancelled', { scope }),
        }));
        return rejectWithValue('Cancelled');
      }
      const msg = err instanceof Error ? err.message : 'Unknown export failure';
      dispatch(addStatusEntry({ level: 'error', message: t('status.package.exportFailed', { error: msg }) }));
      return rejectWithValue(msg);
    }
  },
);

/**
 * Author-scoped search preflight for package rehydration.
 *
 * The insight: a package only contains the user's own messages, so a
 * single Discord search filtered by `author_id={userId}` + the date
 * range of the package messages can mass-fetch live copies of most
 * messages in ~1 call per 25 messages instead of 1 call per message.
 *
 * Returns a map of `{messageId → live Message}` for messages the search
 * found. Messages absent from the search aren't marked deleted here —
 * the caller still verifies them via the per-message AROUND loop, which
 * handles indexing-lag edge cases and any messages outside the search
 * window. On 403 (no search permission) or other errors the map is
 * empty and the caller transparently falls back to the AROUND loop.
 *
 * Honors pause/cancel at page boundaries. Paces pages with the same
 * search delay the main loop uses.
 */
const SEARCH_PREFLIGHT_MAX_OFFSET = 5000;
const SEARCH_PREFLIGHT_PAGE_SIZE = 25;
// Widen the min/max snowflake bounds by this many ms on each side to
// absorb clock skew between package export time and Discord's internal
// snowflake-vs-timestamp rounding. A minute is ~2^16 ms — small
// compared to typical channel histories, generous vs. worst-case skew.
const SEARCH_PREFLIGHT_DATE_BUFFER_MS = 60_000;

async function runSearchPreflight(args: {
  token: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  messages: PackageMessage[];
  searchDelay: number;
  delayModifier: number;
  getState: () => RootState;
  dispatch: (action: any) => void;
  /**
   * Called after each successful page. Receives the total found-so-far
   * count and the new messages from this page that are in the package
   * — letting the caller paint live progress + chips during preflight
   * (instead of the user staring at "0 of 0" for the whole search).
   */
  onPageComplete?: (args: {
    foundSoFar: number;
    packageHitsOnThisPage: Message[];
    /**
     * Cumulative count of search results whose IDs match the package.
     * `foundSoFar` includes user messages outside the package (other
     * channels overlapping the date range, deleted messages re-indexed,
     * etc.), so it overstates the cache-hit budget for the AROUND loop.
     * Use `packageHitsSoFar` for any per-package progress display.
     */
    packageHitsSoFar: number;
  }) => void;
}): Promise<{
  foundById: Map<string, Message>;
  status:
    | 'ok'
    | 'forbidden'
    | 'not-found'
    | 'error'
    | 'cap-exceeded'
    | 'skipped';
  httpStatus?: number;
  pages: number;
  totalFound: number;
  packageHitsTotal: number;
}> {
  const {
    token,
    userId,
    channelId,
    guildId,
    messages,
    searchDelay,
    delayModifier,
    getState,
    onPageComplete,
  } = args;
  const foundById = new Map<string, Message>();
  // Lookup for "is this message in the package?" — drives which
  // preflight results are worth dispatching as enrichment deltas.
  const packageIdSet = new Set(messages.map((m) => m.id));
  let packageHitsTotal = 0;
  if (messages.length === 0) {
    return {
      foundById,
      status: 'skipped',
      pages: 0,
      totalFound: 0,
      packageHitsTotal: 0,
    };
  }

  // Derive date bounds from the package's timestamps. ISO-8601 sorts
  // lexicographically, so simple min/max works without Date parsing.
  let minTs = messages[0].timestamp;
  let maxTs = messages[0].timestamp;
  for (const m of messages) {
    if (m.timestamp < minTs) minTs = m.timestamp;
    if (m.timestamp > maxTs) maxTs = m.timestamp;
  }
  const minDate = new Date(
    new Date(minTs).getTime() - SEARCH_PREFLIGHT_DATE_BUFFER_MS,
  );
  const maxDate = new Date(
    new Date(maxTs).getTime() + SEARCH_PREFLIGHT_DATE_BUFFER_MS,
  );
  if (
    Number.isNaN(minDate.getTime()) ||
    Number.isNaN(maxDate.getTime())
  ) {
    // Bad timestamps in the package — skip preflight rather than
    // sending nonsense bounds to Discord.
    return {
      foundById,
      status: 'skipped',
      pages: 0,
      totalFound: 0,
      packageHitsTotal: 0,
    };
  }

  const criteria: SearchCriteria = {
    searchBeforeDate: maxDate,
    searchAfterDate: minDate,
    searchMessageContents: [],
    selectedHasTypes: [],
    userIds: [userId],
    mentionIds: [],
    channelIds: [],
    isPinned: IsPinnedType.UNSET,
  };

  const discordService = getDiscordService();
  let offset = 0;
  let pages = 0;
  let status: 'ok' | 'forbidden' | 'not-found' | 'error' | 'cap-exceeded' = 'ok';
  let httpStatus: number | undefined;

  while (offset <= SEARCH_PREFLIGHT_MAX_OFFSET) {
    await waitWhilePaused(getState);
    if (checkCancelled(getState)) throw new CancelledError();

    const response = await discordService.fetchSearchMessageData(
      token,
      offset,
      channelId,
      guildId,
      criteria,
    );
    pages += 1;

    if (!response.success) {
      httpStatus = response.status;
      // 404 on guild/channel search means the resource itself is gone
      // from the user's perspective — a stronger signal than 403
      // (which is just "no permission on this action"). Callers use
      // this to abort rather than fall through to AROUND, since every
      // per-message call will 404 for the same reason.
      status =
        response.status === 403
          ? 'forbidden'
          : response.status === 404
            ? 'not-found'
            : 'error';
      break;
    }
    if (!response.data) {
      status = 'error';
      break;
    }

    const searchResult = response.data as SearchMessageResult;
    const rawMessages = searchResult.messages ?? [];
    const rawCount = rawMessages.length;
    // Search returns either Message[] or Message[][] depending on
    // how Discord felt that millisecond — handle both shapes.
    const flat = Array.isArray(rawMessages[0])
      ? (rawMessages as unknown as Message[][]).flat()
      : (rawMessages as Message[]);

    const packageHitsOnThisPage: Message[] = [];
    for (const m of flat) {
      if (m?.id && !foundById.has(m.id)) {
        foundById.set(m.id, m);
        if (packageIdSet.has(m.id)) {
          packageHitsOnThisPage.push(m);
          packageHitsTotal += 1;
        }
      }
    }
    onPageComplete?.({
      foundSoFar: foundById.size,
      packageHitsOnThisPage,
      packageHitsSoFar: packageHitsTotal,
    });

    // #264: a short page is only the end when Discord says so. Its search
    // returns spuriously short pages mid-stream while the index lags, so
    // keep walking while total_results says there is more; a page with no
    // results, or a response without total_results, ends the scan the old way.
    if (rawCount === 0) break;
    const totalResults = searchResult.total_results;
    if (typeof totalResults === 'number'
      ? offset + rawCount >= totalResults
      : rawCount < SEARCH_PREFLIGHT_PAGE_SIZE) break;
    offset += rawCount;
    if (offset > SEARCH_PREFLIGHT_MAX_OFFSET) {
      status = 'cap-exceeded';
      break;
    }

    const calc = calculateRandomDelay(searchDelay, delayModifier);
    const wasCancelled = await cancellableDelay(calc.delayMs, getState);
    if (wasCancelled) throw new CancelledError();
  }

  return {
    foundById,
    status,
    httpStatus,
    pages,
    totalFound: foundById.size,
    packageHitsTotal,
  };
}

/**
 * Tier 2 rehydration: fetch real `Message` objects from Discord for
 * every package message in the given channel. Writes results to both
 * Redux state (live UI) and `enrichmentCache` (IDB — survives reload).
 *
 * Flow:
 *  1. Reject if another channel is currently enriching (Discord's rate
 *     limits don't like parallel per-channel loops, and the user
 *     shouldn't accidentally kick off multiple long runs).
 *  2. Unless `refresh === true`, short-circuit to the IDB cache if
 *     present — a previously enriched channel loads instantly.
 *  3. Ensure messages are loaded (lazy CSV read).
 *  4. Loop every message, calling
 *     `fetchMessageData(token, msgId, channelId, AROUND)`. Discord
 *     returns up to 50 messages around the target — we filter for the
 *     exact ID. Missing = treat as deleted.
 *  5. 404 → `misses.deleted`, 403 → `misses.forbidden`. Other errors
 *     are logged and the loop continues (one bad message shouldn't
 *     abort the whole rehydration).
 *  6. Pause/cancel honored via the shared `waitWhilePaused` /
 *     `checkCancelled` / `cancellableDelay` helpers.
 *  7. Progress dispatched throttled (every 10 msgs or 500ms) to keep
 *     Redux dispatches bounded on large channels.
 *  8. On cancel: save partial results, fulfill with `cancelled: true`.
 *  9. On success: persist full result to IDB, fulfill with counts.
 *
 * Rate limits (429) are handled inside discrub-core's `withRetry`;
 * network drops and 5xx are NOT, so each AROUND call runs under
 * `withTransientRetry` (#245) before a failure is treated as a miss.
 */
export const enrichPackageChannel = createAsyncThunk<
  EnrichmentResult,
  { channelId: string; refresh?: boolean },
  { state: RootState; rejectValue: string }
>(
  'package/enrichChannel',
  async (
    { channelId, refresh = false },
    { getState, dispatch, rejectWithValue },
  ) => {
    const state = getState();
    const token = state.auth.token;
    if (!token) return rejectWithValue('Not authenticated');

    const parsed = state.package.parsed;
    if (!parsed) return rejectWithValue('No package loaded');

    const userId = parsed.user.id;
    const channel = parsed.channels.find((c) => c.id === channelId);
    if (!channel) return rejectWithValue('Channel not found in package');

    // Belt-and-suspenders reset: the MainLayout `isOperationRunning`
    // effect also resets this flag when the previous op finished, but
    // effect scheduling can race with a fast second dispatch. Resetting
    // at thunk entry guarantees the loop doesn't immediately abort
    // from a sticky flag left behind by a previous cancelled op.
    dispatch(setDiscrubCancelled(false));

    // Cache short-circuit — the IDB layer already returns null on miss,
    // so this is just a one-shot lookup.
    if (!refresh) {
      const cached = await enrichmentCache.get(userId, channelId);
      if (cached) {
        dispatch(hydrateEnrichmentFromCache({ channelId, cache: cached }));
        return {
          channelId,
          fromCache: true,
          enriched: Object.keys(cached.messages).length,
          deleted: cached.misses.deleted.length,
          forbidden: cached.misses.forbidden.length,
          cancelled: false,
        };
      }
    }

    // Lazy-load messages if not already cached in Redux.
    let messages = getState().package.loadedChannels[channelId];
    if (!messages) {
      await dispatch(loadPackageChannelMessages(channelId));
      messages = getState().package.loadedChannels[channelId];
      if (!messages) return rejectWithValue('Failed to load channel messages');
    }
    if (messages.length === 0) {
      return rejectWithValue('Channel has no messages to rehydrate');
    }

    const searchDelay = selectSearchDelay(getState());
    const delayModifier = selectDelayModifier(getState());
    const discordService = getDiscordService();

    // Read the previous cache up front — we use it both for skip logic
    // (don't re-fetch messages we already know are 404'd) and later for
    // the cancelled-don't-overwrite path.
    const previousCache = await enrichmentCache.get(userId, channelId);

    // "Known-gone" set: messages we're certain no longer exist on Discord,
    // either because the user deleted them (persisted delete cache) or
    // because a previous enrichment pass confirmed 404. Skipping these
    // avoids pointless API calls. Forbidden (403) is NOT in this set —
    // access can be regained, so refresh retries them.
    const knownDeleted = new Set<string>([
      ...(state.package.deletedMessageIds[channelId] ?? []),
      ...(previousCache?.misses.deleted ?? []),
    ]);

    // Session-scoped cache of messages returned in the neighbor windows
    // of prior `fetchMessageData(AROUND)` calls. Discord returns up to 50
    // messages per call; previously we extracted only the target and
    // discarded the rest. With this cache, densely packed channels only
    // pay for 1 API call per ~50 messages.
    const windowCache = new Map<string, Message>();

    const enriched: Record<string, Message> = {};
    const misses: { deleted: string[]; forbidden: string[] } = {
      deleted: [],
      forbidden: [],
    };
    let cancelled = false;
    // Set when preflight reports the guild/channel itself is 404 —
    // running the AROUND loop would just produce 191 more 404s and
    // poison the "deleted" cache with false positives. Better to
    // abort and tell the user clearly.
    let channelInaccessible = false;
    let channelInaccessibleStatus: number | undefined;

    const channelLabel = channel.name ?? channelId;
    dispatch(
      addStatusEntry({
        level: 'info',
        message: t('status.package.loadingRichData', { name: channelLabel, count: messages.length }),
      }),
    );

    // Paint the real total up front — otherwise the UI displays
    // "0 of 0…" for the entire preflight phase (which can be tens of
    // API calls for large channels). We'll advance `current` during
    // preflight and again during the main loop.
    dispatch(
      setEnrichmentProgress({
        channelId,
        current: 0,
        total: messages.length,
      }),
    );

    // Monotonic progress counter — preflight drives most of it via
    // foundById.size, then the main loop fills any gaps. Tracked
    // outside the loop so main-loop dispatches can't regress the bar.
    let progressCurrent = 0;

    // Progress dispatch throttling — cap Redux traffic on large channels.
    let lastDispatchedAt = Date.now();
    let lastDispatchedIndex = 0;
    const PROGRESS_EVERY_N = 10;
    const PROGRESS_EVERY_MS = 500;

    // Accumulator for live delta dispatches. Each iteration pushes its
    // resolution into this buffer; the throttle below flushes it so
    // chips light up during the run instead of waiting for completion.
    const pendingDelta: {
      enriched: Record<string, Message>;
      deleted: string[];
      forbidden: string[];
    } = { enriched: {}, deleted: [], forbidden: [] };
    const flushDelta = () => {
      const hasAny =
        Object.keys(pendingDelta.enriched).length > 0 ||
        pendingDelta.deleted.length > 0 ||
        pendingDelta.forbidden.length > 0;
      if (!hasAny) return;
      dispatch(
        mergeEnrichmentDelta({
          channelId,
          enriched: pendingDelta.enriched,
          deleted: [...pendingDelta.deleted],
          forbidden: [...pendingDelta.forbidden],
        }),
      );
      pendingDelta.enriched = {};
      pendingDelta.deleted = [];
      pendingDelta.forbidden = [];
    };

    try {
      // Author-scoped search preflight: one call per 25 messages
      // instead of one per message. Messages not covered still fall
      // through to the AROUND loop below, so preflight failure never
      // breaks correctness — worst case, we do what we used to do.
      try {
        const preflight = await runSearchPreflight({
          token,
          userId,
          channelId,
          guildId: channel.guildId ?? null,
          messages,
          searchDelay,
          delayModifier,
          getState,
          dispatch,
          onPageComplete: ({ packageHitsSoFar, packageHitsOnThisPage }) => {
            // Advance the progress bar as pages come in so the UI
            // doesn't sit at 0/N for the whole preflight. Use the
            // package-overlap count (not foundById.size) so the bar
            // reflects real cache-hit budget; foundById can include
            // messages outside the package, which would clamp progress
            // to messages.length and freeze the bar through the entire
            // AROUND loop.
            progressCurrent = Math.min(packageHitsSoFar, messages.length);
            dispatch(
              setEnrichmentProgress({
                channelId,
                current: progressCurrent,
                total: messages.length,
              }),
            );
            // Paint chips live — every message returned by search that
            // is in our package can be flipped to "enriched" now.
            if (packageHitsOnThisPage.length > 0) {
              const enrichedPatch: Record<string, Message> = {};
              for (const msg of packageHitsOnThisPage) {
                enrichedPatch[msg.id] = msg;
              }
              dispatch(
                mergeEnrichmentDelta({
                  channelId,
                  enriched: enrichedPatch,
                  deleted: [],
                  forbidden: [],
                }),
              );
            }
          },
        });
        for (const [id, msg] of preflight.foundById) {
          // Discord's /messages/search returns reply messages without a
          // populated `referenced_message` — the reply preview lives in
          // an adjacent context slot of the per-hit array, which our
          // flatten discards. Caching such replies makes every reply in
          // the package render the "Original message was deleted" chip
          // even when the parent is alive on Discord. Skip the cache
          // for those; the AROUND fetch reliably populates the field
          // on the bulk channel-messages endpoint.
          if (
            msg.type === 19 &&
            msg.message_reference &&
            !msg.referenced_message
          ) {
            continue;
          }
          windowCache.set(id, msg);
        }
        // Always log a channel-scan summary so users can verify the
        // optimization ran. The bulk-search step lets us skip per-message
        // API calls when Discord returned the message in a search page.
        if (preflight.status === 'ok' || preflight.status === 'cap-exceeded') {
          dispatch(
            addStatusEntry({
              level: 'info',
              message:
                `Channel scan matched ${preflight.packageHitsTotal.toLocaleString()} ` +
                `of ${messages.length.toLocaleString()} package ` +
                `${messages.length === 1 ? 'message' : 'messages'}.`,
            }),
          );
        }
        if (preflight.status === 'forbidden') {
          dispatch(
            addStatusEntry({
              level: 'info',
              message:
                "Channel scan unavailable (no permission). " +
                'Checking messages one-by-one.',
            }),
          );
        } else if (preflight.status === 'cap-exceeded') {
          dispatch(
            addStatusEntry({
              level: 'warning',
              message:
                'Channel scan returned 5,000 messages, the most Discord allows in a single search. ' +
                'Checking the rest one-by-one.',
            }),
          );
        } else if (preflight.status === 'not-found') {
          // 404 on the guild/channel search endpoint means the resource
          // is gone from the user's perspective (left/kicked/deleted).
          // The AROUND loop would produce N more 404s — abort instead.
          channelInaccessible = true;
          channelInaccessibleStatus = preflight.httpStatus;
          dispatch(
            addStatusEntry({
              level: 'error',
              message:
                "This channel is no longer accessible on Discord. You may have " +
                'left or been removed from this server, or the server was ' +
                'deleted. Package data is still viewable below.',
            }),
          );
        } else if (preflight.status === 'error') {
          dispatch(
            addStatusEntry({
              level: 'warning',
              message:
                'Channel scan failed. Checking messages one-by-one.',
            }),
          );
        }
      } catch (err) {
        // Cancellation bubbles up to the outer catch so `cancelled`
        // is set and partial results still persist appropriately.
        if (err instanceof CancelledError) throw err;
        // Any other preflight failure is non-fatal — fall through.
        dispatch(
          addStatusEntry({
            level: 'info',
            message:
              'Channel scan unavailable. Checking messages one-by-one.',
          }),
        );
      }

      // Skip the per-message AROUND loop entirely when preflight
      // confirmed the channel is inaccessible. Each call would 404
      // for the same reason and pollute the "deleted" set.
      const loopLength = channelInaccessible ? 0 : messages.length;
      for (let i = 0; i < loopLength; i++) {
        await waitWhilePaused(getState);
        if (checkCancelled(getState)) throw new CancelledError();

        const targetId = messages[i].id;
        let madeApiCall = false;

        if (knownDeleted.has(targetId)) {
          // Already confirmed gone (user delete or prior 404). Preserve
          // the status in the new misses map so the visual "unavailable"
          // cue survives this enrichment pass without a wasted API call.
          misses.deleted.push(targetId);
          pendingDelta.deleted.push(targetId);
        } else if (windowCache.has(targetId)) {
          // A prior AROUND call returned this message as a neighbor of
          // another target — use the cached live message for free.
          const hit = windowCache.get(targetId)!;
          enriched[targetId] = hit;
          pendingDelta.enriched[targetId] = hit;
        } else {
          madeApiCall = true;
          try {
            const response = await withTransientRetry(
              () => discordService.fetchMessageData(
                token,
                targetId,
                channelId,
                QueryStringParam.AROUND,
              ),
              { getState, dispatch },
            );
            if (response.success && response.data) {
              // Cache the whole window so subsequent iterations can
              // short-circuit when their target is already in the window.
              for (const msg of response.data) {
                windowCache.set(msg.id, msg);
              }
              const hit = windowCache.get(targetId);
              if (hit) {
                enriched[targetId] = hit;
                pendingDelta.enriched[targetId] = hit;
              } else {
                // API returned neighboring messages but not the target —
                // message was deleted on Discord since the package export.
                misses.deleted.push(targetId);
                pendingDelta.deleted.push(targetId);
              }
            } else if (response.status === 404) {
              misses.deleted.push(targetId);
              pendingDelta.deleted.push(targetId);
            } else if (response.status === 403) {
              misses.forbidden.push(targetId);
              pendingDelta.forbidden.push(targetId);
            }
            // Other failures (5xx / network): drop silently — they'll
            // stay source-only and can be retried by the user.
          } catch (err) {
            const status = extractHttpStatus(err);
            if (status === 404) {
              misses.deleted.push(targetId);
              pendingDelta.deleted.push(targetId);
            } else if (status === 403) {
              misses.forbidden.push(targetId);
              pendingDelta.forbidden.push(targetId);
            }
            // else: continue loop, this message stays as source.
          }
        }

        const now = Date.now();
        if (
          i - lastDispatchedIndex >= PROGRESS_EVERY_N ||
          now - lastDispatchedAt >= PROGRESS_EVERY_MS
        ) {
          // Never regress the bar — preflight may have already
          // advanced it past i+1 by finding most messages already.
          progressCurrent = Math.max(progressCurrent, i + 1);
          dispatch(
            setEnrichmentProgress({
              channelId,
              current: progressCurrent,
              total: messages.length,
            }),
          );
          // Paint chips as results come in. Flushed on the same
          // throttle as progress so UI traffic stays bounded.
          flushDelta();
          lastDispatchedIndex = i;
          lastDispatchedAt = now;
        }

        // Only pay the configured per-message delay when we actually
        // hit the Discord API. Cache hits and known-gone skips cost
        // microseconds and don't consume rate-limit budget.
        if (madeApiCall && i < messages.length - 1) {
          const calc = calculateRandomDelay(searchDelay, delayModifier);
          const wasCancelled = await cancellableDelay(calc.delayMs, getState);
          if (wasCancelled) throw new CancelledError();
        }
      }
    } catch (err) {
      if (err instanceof CancelledError) {
        cancelled = true;
      } else {
        // Unexpected exception — persist what we have and fulfill
        // rather than rejecting, so partial results survive.
        dispatch(
          addStatusEntry({
            level: 'error',
            message: t('status.package.rehydrationError', { error: err instanceof Error ? err.message : t('status.package.unknown') }),
          }),
        );
      }
    }

    // Final progress snapshot — but don't falsely jump to 100% if the
    // run was cancelled or aborted due to channel inaccessibility.
    if (!cancelled && !channelInaccessible) {
      dispatch(
        setEnrichmentProgress({
          channelId,
          current: messages.length,
          total: messages.length,
        }),
      );
    }

    const enrichedCount = Object.keys(enriched).length;

    // Persist semantics:
    //   - Completed successfully → always write new result
    //   - Cancelled + no previous cache → write partial so the work
    //     isn't completely lost
    //   - Cancelled + previous cache exists → DON'T overwrite.
    //   - Channel inaccessible → DON'T overwrite. We have zero new
    //     data and would only poison the cache with false positives.
    // `previousCache` was read up front for skip-logic; reuse it here.
    const shouldPersist =
      !channelInaccessible && (!cancelled || !previousCache);
    if (shouldPersist) {
      const cache: EnrichedChannelCache = {
        lastFetched: Date.now(),
        messages: enriched,
        misses,
      };
      await enrichmentCache.put(userId, channelId, cache);
      // Mirror the persisted cache into Redux state so UI sees the same
      // data without a second IDB read. This also collapses any
      // progressive deltas into the canonical final shape.
      dispatch(hydrateEnrichmentFromCache({ channelId, cache }));
    } else if (previousCache) {
      // Cancelled refresh or inaccessible-channel abort with a previous
      // full cache — restore state to match the preserved IDB cache.
      // Without this, in-flight `mergeEnrichmentDelta` dispatches (or
      // the initial cache-hit hydrate) would leave Redux in a hybrid
      // shape even though we're intentionally keeping the old cache.
      dispatch(
        hydrateEnrichmentFromCache({ channelId, cache: previousCache }),
      );
    }
    if (channelInaccessible) {
      // Distinct completion entry so the user understands the run
      // didn't just silently finish — the channel is the problem.
      dispatch(
        addStatusEntry({
          level: 'error',
          message:
            `Couldn't load rich data for "${channelLabel}": ` +
            `the channel is no longer accessible on Discord.`,
        }),
      );
    } else if (cancelled && !shouldPersist) {
      // Refresh cancelled but we kept the previous cache — be explicit
      // so users don't think they lost their rich data.
      const keptCount = Object.keys(previousCache?.messages ?? {}).length;
      dispatch(
        addStatusEntry({
          level: 'info',
          message:
            `Refresh cancelled for "${channelLabel}". ` +
            `Kept the previous rich data (${keptCount.toLocaleString()} ${keptCount === 1 ? 'message' : 'messages'}).`,
        }),
      );
    } else {
      dispatch(
        addStatusEntry({
          level: misses.forbidden.length > 0 ? 'warning' : 'success',
          message: formatRehydrateLogSummary({
            channelLabel,
            enriched: enrichedCount,
            unavailable: misses.deleted.length,
            noAccess: misses.forbidden.length,
            cancelled,
          }),
        }),
      );
    }

    return {
      channelId,
      fromCache: false,
      enriched: enrichedCount,
      deleted: misses.deleted.length,
      forbidden: misses.forbidden.length,
      cancelled,
      channelInaccessible,
      inaccessibleStatus: channelInaccessibleStatus,
    };
  },
  {
    /**
     * Enrichment is strictly serialized — if another channel is already
     * running, don't even dispatch .pending (which would otherwise fire
     * before our guard check and overwrite `activeEnrichmentChannelId`).
     * `condition` returning false causes RTK to skip the thunk entirely;
     * dispatch() resolves to a `condition`-rejected action with no state
     * side effects.
     */
    condition: ({ channelId }, { getState }) => {
      const activeId = (getState() as RootState).package
        .activeEnrichmentChannelId;
      return !activeId || activeId === channelId;
    },
  },
);

const packageSlice = createSlice({
  name: 'package',
  initialState: initialPackageState,
  reducers: {
    selectPackageChannel(state, action: PayloadAction<string | null>) {
      state.selectedChannelId = action.payload;
    },
    setTimelineProgress(
      state,
      action: PayloadAction<{ current: number; total: number }>,
    ) {
      state.timelineProgress = action.payload;
    },
    setDeleteProgress(
      state,
      action: PayloadAction<{ current: number; total: number }>,
    ) {
      state.deleteProgress = action.payload;
    },
    toggleMessageSelection(
      state,
      action: PayloadAction<{ channelId: string; messageId: string }>,
    ) {
      const { channelId, messageId } = action.payload;
      const current = state.selectedMessageIds[channelId] ?? [];
      const idx = current.indexOf(messageId);
      if (idx === -1) {
        state.selectedMessageIds[channelId] = [...current, messageId];
      } else {
        const next = [...current];
        next.splice(idx, 1);
        if (next.length === 0) delete state.selectedMessageIds[channelId];
        else state.selectedMessageIds[channelId] = next;
      }
    },
    selectAllChannelMessages(
      state,
      action: PayloadAction<{ channelId: string; messageIds: string[] }>,
    ) {
      const { channelId, messageIds } = action.payload;
      state.selectedMessageIds[channelId] = [...messageIds];
    },
    clearChannelMessageSelection(state, action: PayloadAction<string>) {
      delete state.selectedMessageIds[action.payload];
    },
    /**
     * #172: Replace the per-channel filter criteria for `channelId`. Pass
     * `null` (or call clearPackageFilterCriteria) to remove the filter.
     * Criteria persist across channel switches so users can navigate and
     * return; only re-importing the package or explicit clear resets.
     */
    setPackageFilterCriteria(
      state,
      action: PayloadAction<{ channelId: string; criteria: import('discrub-core/types/discrub-types').SearchCriteria | null }>,
    ) {
      const { channelId, criteria } = action.payload;
      if (criteria === null) {
        delete state.filterCriteria[channelId];
      } else {
        state.filterCriteria[channelId] = criteria;
      }
    },
    clearPackageFilterCriteria(state, action: PayloadAction<string>) {
      delete state.filterCriteria[action.payload];
    },
    setImportProgress(state, action: PayloadAction<{ read: number; total: number } | null>) {
      state.importProgress = action.payload;
    },
    dismissDeleteResult(state) {
      state.deleteResult = null;
      state.deleteError = null;
      state.deleteStatus = 'idle';
    },
    setEnrichmentProgress(
      state,
      action: PayloadAction<{ channelId: string; current: number; total: number }>,
    ) {
      const { channelId, current, total } = action.payload;
      state.enrichmentProgress[channelId] = { current, total };
    },
    /**
     * Populate enriched state from a previously persisted cache — called
     * when a channel was enriched in an earlier session and we're
     * short-circuiting the API loop. Maintains an LRU ordering over
     * `enrichedMessages` so the in-memory footprint stays bounded — IDB
     * still holds everything, so evicted channels re-hydrate instantly.
     */
    hydrateEnrichmentFromCache(
      state,
      action: PayloadAction<{ channelId: string; cache: EnrichedChannelCache }>,
    ) {
      const { channelId, cache } = action.payload;
      state.enrichedMessages[channelId] = cache.messages;
      state.enrichmentMisses[channelId] = {
        deleted: [...cache.misses.deleted],
        forbidden: [...cache.misses.forbidden],
      };
      state.enrichmentStatus[channelId] = 'done';
      state.enrichmentLastFetched[channelId] = cache.lastFetched;
      state.enrichmentError[channelId] = null;

      // LRU: put this channelId at the tail.
      state.enrichedOrder = state.enrichedOrder.filter((id) => id !== channelId);
      state.enrichedOrder.push(channelId);

      // Evict oldest when over the limit — but never evict the
      // currently-active one (rare race if another enrichment is
      // mid-flight and user opens a 6th channel).
      while (state.enrichedOrder.length > ENRICHED_CHANNELS_LIMIT) {
        const oldest = state.enrichedOrder[0];
        if (oldest === state.activeEnrichmentChannelId) break;
        state.enrichedOrder.shift();
        delete state.enrichedMessages[oldest];
        delete state.enrichmentMisses[oldest];
        delete state.enrichmentStatus[oldest];
        delete state.enrichmentLastFetched[oldest];
        delete state.enrichmentError[oldest];
      }
    },
    /**
     * Incremental merge of enrichment results mid-run so the UI paints
     * "enriched"/"unavailable" chips progressively instead of all-at-once
     * when the loop finishes. Thunk throttles dispatch to the same
     * cadence as `setEnrichmentProgress` to keep Redux traffic bounded.
     *
     * Unlike `hydrateEnrichmentFromCache`, this preserves existing state
     * (refresh keeps stale enriched rows visible) and appends deltas.
     * Eviction is intentionally skipped — the final hydrate call at the
     * end of the thunk handles LRU and persistence.
     */
    mergeEnrichmentDelta(
      state,
      action: PayloadAction<{
        channelId: string;
        enriched: Record<string, Message>;
        deleted: string[];
        forbidden: string[];
      }>,
    ) {
      const { channelId, enriched, deleted, forbidden } = action.payload;

      if (!state.enrichedMessages[channelId]) {
        state.enrichedMessages[channelId] = {};
      }
      Object.assign(state.enrichedMessages[channelId], enriched);

      if (!state.enrichmentMisses[channelId]) {
        state.enrichmentMisses[channelId] = { deleted: [], forbidden: [] };
      }
      if (deleted.length > 0) {
        const existing = new Set(state.enrichmentMisses[channelId].deleted);
        for (const id of deleted) existing.add(id);
        state.enrichmentMisses[channelId].deleted = [...existing];
      }
      if (forbidden.length > 0) {
        const existing = new Set(state.enrichmentMisses[channelId].forbidden);
        for (const id of forbidden) existing.add(id);
        state.enrichmentMisses[channelId].forbidden = [...existing];
      }

      // LRU bump so this actively-enriching channel doesn't get evicted
      // by a concurrent hydrate on another channel.
      state.enrichedOrder = state.enrichedOrder.filter((id) => id !== channelId);
      state.enrichedOrder.push(channelId);
    },
    /** Drop enrichment state for one channel (used before a refresh). */
    clearChannelEnrichmentState(state, action: PayloadAction<string>) {
      const channelId = action.payload;
      delete state.enrichedMessages[channelId];
      delete state.enrichmentMisses[channelId];
      delete state.enrichmentStatus[channelId];
      delete state.enrichmentProgress[channelId];
      delete state.enrichmentLastFetched[channelId];
      delete state.enrichmentError[channelId];
      state.enrichedOrder = state.enrichedOrder.filter((id) => id !== channelId);
    },
    applyLocalMessageEdits(
      state,
      action: PayloadAction<{ channelId: string; messageIds: string[]; content: string }>,
    ) {
      const { channelId, messageIds, content } = action.payload;
      const cached = state.loadedChannels[channelId];
      if (!cached) return;
      const idSet = new Set(messageIds);
      state.loadedChannels[channelId] = cached.map((m) =>
        idSet.has(m.id) ? { ...m, content } : m,
      );
    },
    clearPackage(state) {
      if (state.parsed?.avatarBlobUrl) {
        try {
          URL.revokeObjectURL(state.parsed.avatarBlobUrl);
        } catch {
          /* ignore */
        }
      }
      Object.assign(state, initialPackageState);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(importPackage.pending, (state) => {
        state.status = 'parsing';
        state.error = null;
        state.importProgress = null;
      })
      .addCase(importPackage.fulfilled, (state, action) => {
        state.status = 'ready';
        state.parsed = action.payload.parsed;
        state.validation = action.payload.validation;
        state.error = null;
        state.selectedChannelId = null;
        state.loadedChannels = {};
        state.loadedOrder = [];
        // #236: the deleted cache rides in on the payload — applying it
        // here (instead of resetting and racing a separate hydrate
        // thunk) guarantees purged-through-Discrub ids survive import.
        state.deletedMessageIds = action.payload.deletedMessageIds;
        state.goneMessageIds = action.payload.goneMessageIds;
        state.importProgress = null;
        // #172: previous package's filters don't carry over to a new import.
        state.filterCriteria = {};
      })
      .addCase(importPackage.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.payload ?? 'Unknown error';
        state.parsed = null;
        state.validation = null;
        state.importProgress = null;
      })
      .addCase(resumeStoredPackage.fulfilled, (state, action) => {
        if (!action.payload) return; // nothing to resume
        state.status = 'ready';
        state.parsed = action.payload.parsed;
        state.validation = action.payload.validation;
        state.error = null;
        state.selectedChannelId = null;
        state.loadedChannels = {};
        state.loadedOrder = [];
        // #236: same atomic treatment as importPackage.fulfilled —
        // deleted ids come from the payload, never a racing hydrate.
        state.deletedMessageIds = action.payload.deletedMessageIds;
        state.goneMessageIds = action.payload.goneMessageIds;
        state.filterCriteria = {};
      })
      .addCase(loadPackageChannelMessages.pending, (state, action) => {
        state.loadingChannelId = action.meta.arg;
      })
      .addCase(loadPackageChannelMessages.fulfilled, (state, action) => {
        const { channelId, messages } = action.payload;
        state.loadedChannels[channelId] = messages;

        // LRU: move/insert channelId at the end of loadedOrder.
        state.loadedOrder = state.loadedOrder.filter((id) => id !== channelId);
        state.loadedOrder.push(channelId);

        while (state.loadedOrder.length > LOADED_CHANNELS_LIMIT) {
          const evictId = state.loadedOrder.shift();
          if (evictId) delete state.loadedChannels[evictId];
        }

        state.loadingChannelId = null;
      })
      .addCase(loadPackageChannelMessages.rejected, (state) => {
        state.loadingChannelId = null;
      })
      .addCase(loadAllPackageTimestamps.pending, (state) => {
        state.timelineStatus = 'loading';
        state.timelineError = null;
        state.timelineTimestamps = [];
      })
      .addCase(loadAllPackageTimestamps.fulfilled, (state, action) => {
        state.timelineStatus = 'ready';
        state.timelineTimestamps = action.payload;
        state.timelineProgress = null;
      })
      .addCase(loadAllPackageTimestamps.rejected, (state, action) => {
        state.timelineStatus = 'error';
        state.timelineError = action.payload ?? 'Failed to build timeline';
        state.timelineProgress = null;
      })
      .addCase(deletePackageMessages.pending, (state) => {
        state.deleteStatus = 'running';
        state.deleteError = null;
        state.deleteResult = null;
        state.deleteProgress = null;
      })
      .addCase(deletePackageMessages.fulfilled, (state, action) => {
        state.deleteStatus = 'ready';
        state.deleteResult = action.payload;
        state.deleteProgress = null;

        const channelId = action.meta.arg.channelId;
        const { deletedIds, alreadyGoneIds } = action.payload;

        // Merge into the persistent deleted set for this channel: the
        // union keeps its "not on Discord any more" meaning, the gone
        // subset records which of those Discrub never actually removed.
        const existing = state.deletedMessageIds[channelId] ?? [];
        state.deletedMessageIds[channelId] = Array.from(new Set([...existing, ...deletedIds, ...alreadyGoneIds]));
        if (alreadyGoneIds.length > 0) {
          const existingGone = state.goneMessageIds[channelId] ?? [];
          state.goneMessageIds[channelId] = Array.from(new Set([...existingGone, ...alreadyGoneIds]));
        }

        // Clear selection (they're gone or intended to be).
        delete state.selectedMessageIds[channelId];

        // Intentionally keep confirmed-gone messages in `loadedChannels`.
        // The table renders them with the `gone` visual treatment via
        // `deletedMessageIds`, so users can see *what* was deleted and
        // its original content — rather than rows silently vanishing.
      })
      .addCase(deletePackageMessages.rejected, (state, action) => {
        state.deleteStatus = 'error';
        state.deleteError = action.payload ?? 'Delete failed';
        state.deleteProgress = null;
      })
      .addCase(exportPackageChannel.pending, (state) => {
        state.exportStatus = 'running';
        state.exportError = null;
      })
      .addCase(exportPackageChannel.fulfilled, (state) => {
        state.exportStatus = 'ready';
      })
      .addCase(exportPackageChannel.rejected, (state, action) => {
        state.exportStatus = 'error';
        state.exportError = action.payload ?? 'Export failed';
      })
      .addCase(hydratePackageDeletedCache.fulfilled, (state, action) => {
        state.deletedMessageIds = action.payload.deleted;
        state.goneMessageIds = action.payload.gone;
      })
      .addCase(clearPackageDeletedCache.fulfilled, (state) => {
        state.deletedMessageIds = {};
        state.goneMessageIds = {};
      })
      // #271: the live purge or the message table deleted messages that
      // belong to a channel in this package.
      .addCase(externalDeletionsRecorded, (state, action) => {
        const { channelId, ids } = action.payload;
        if (!state.parsed?.channels.some((c) => c.id === channelId)) return;
        const existing = state.deletedMessageIds[channelId] ?? [];
        state.deletedMessageIds[channelId] = Array.from(new Set([...existing, ...ids]));
        const selected = state.selectedMessageIds[channelId];
        if (selected) {
          const gone = new Set(ids);
          const remaining = selected.filter((id) => !gone.has(id));
          if (remaining.length > 0) state.selectedMessageIds[channelId] = remaining;
          else delete state.selectedMessageIds[channelId];
        }
      })
      .addCase(enrichPackageChannel.pending, (state, action) => {
        const { channelId } = action.meta.arg;
        state.activeEnrichmentChannelId = channelId;
        state.enrichmentStatus[channelId] = 'running';
        state.enrichmentError[channelId] = null;
        state.enrichmentProgress[channelId] = { current: 0, total: 0 };
        // NOTE: we intentionally do NOT wipe existing enrichedMessages
        // here even on `refresh: true`. Keeping old data visible during
        // the refresh avoids the UX flicker where every row flashes back
        // to the `source` chip for the duration of the API loop. The
        // old data is overwritten by hydrateEnrichmentFromCache only on
        // successful completion — cancelled/failed runs leave it intact.
      })
      .addCase(enrichPackageChannel.fulfilled, (state, action) => {
        const { channelId, cancelled, channelInaccessible, inaccessibleStatus } =
          action.payload;
        // Messages, misses, and lastFetched are already populated by
        // the thunk's dispatch of hydrateEnrichmentFromCache (both the
        // cache-hit path and the normal path). Here we just finalize
        // the status if the run was cancelled (hydrate leaves it at
        // 'done') and release the serialization lock.
        if (channelInaccessible) {
          state.enrichmentStatus[channelId] = 'failed';
          state.enrichmentError[channelId] =
            `Channel no longer accessible on Discord (HTTP ${inaccessibleStatus ?? 404})`;
        } else if (cancelled) {
          state.enrichmentStatus[channelId] = 'cancelled';
        }
        state.activeEnrichmentChannelId = null;
      })
      .addCase(enrichPackageChannel.rejected, (state, action) => {
        const channelId = action.meta.arg.channelId;
        state.enrichmentStatus[channelId] = 'failed';
        state.enrichmentError[channelId] =
          action.payload ?? action.error.message ?? 'Enrichment failed';
        state.activeEnrichmentChannelId = null;
      });
  },
});

export const {
  selectPackageChannel,
  setTimelineProgress,
  setDeleteProgress,
  toggleMessageSelection,
  selectAllChannelMessages,
  clearChannelMessageSelection,
  dismissDeleteResult,
  applyLocalMessageEdits,
  clearPackage,
  setEnrichmentProgress,
  hydrateEnrichmentFromCache,
  mergeEnrichmentDelta,
  clearChannelEnrichmentState,
  setPackageFilterCriteria,
  clearPackageFilterCriteria,
  setImportProgress,
} = packageSlice.actions;
export default packageSlice.reducer;

/* ────────── selectors ────────── */

export const selectPackageStatus = (state: RootState) => state.package.status;
export const selectParsedPackage = (state: RootState) => state.package.parsed;
export const selectPackageValidation = (state: RootState) => state.package.validation;
export const selectPackageError = (state: RootState) => state.package.error;
export const selectSelectedPackageChannelId = (state: RootState) =>
  state.package.selectedChannelId;
export const selectPackageChannelMessages =
  (channelId: string | null) =>
  (state: RootState): PackageMessage[] | undefined =>
    channelId ? state.package.loadedChannels[channelId] : undefined;
export const selectIsPackageChannelLoading = (state: RootState) =>
  state.package.loadingChannelId !== null;
/** #172: per-channel filter criteria. `null` (or missing) means no filter. */
export const selectPackageFilterCriteria =
  (channelId: string | null) =>
  (state: RootState): import('discrub-core/types/discrub-types').SearchCriteria | null =>
    channelId ? state.package.filterCriteria?.[channelId] ?? null : null;
export const selectIsPackageReadOnly = (state: RootState) =>
  state.package.validation?.readOnly ?? true;
export const selectTimelineStatus = (state: RootState) =>
  state.package.timelineStatus;
export const selectTimelineTimestamps = (state: RootState) =>
  state.package.timelineTimestamps;
export const selectTimelineProgress = (state: RootState) =>
  state.package.timelineProgress;
export const selectTimelineError = (state: RootState) =>
  state.package.timelineError;
export const selectChannelSelectedMessageIds =
  (channelId: string) =>
  (state: RootState): string[] =>
    state.package.selectedMessageIds[channelId] ?? [];
export const selectDeleteStatus = (state: RootState) => state.package.deleteStatus;
export const selectDeleteProgress = (state: RootState) => state.package.deleteProgress;
export const selectDeleteResult = (state: RootState) => state.package.deleteResult;
export const selectDeleteError = (state: RootState) => state.package.deleteError;
/** #269: compressed bytes read so far by a running import. */
export const selectImportProgress = (state: RootState) => state.package.importProgress;
export const selectPackageExportStatus = (state: RootState) =>
  state.package.exportStatus;
export const selectChannelDeletedMessageIds =
  (channelId: string) =>
  (state: RootState): string[] =>
    state.package.deletedMessageIds[channelId] ?? [];
export const selectTotalDeletedMessageCount = (state: RootState): number =>
  Object.values(state.package.deletedMessageIds).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
/** Count of ids gone from Discord for one channel (0 when none). */
export const selectChannelDeletedMessageCount =
  (channelId: string) =>
  (state: RootState): number =>
    state.package.deletedMessageIds[channelId]?.length ?? 0;
/** #271: ids of one channel that were already gone when Discrub tried them. */
export const selectChannelGoneMessageIds =
  (channelId: string) =>
  (state: RootState): string[] =>
    state.package.goneMessageIds[channelId] ?? [];
/** #271: how many of one channel's gone ids Discrub never actually removed. */
export const selectChannelGoneMessageCount =
  (channelId: string) =>
  (state: RootState): number =>
    state.package.goneMessageIds[channelId]?.length ?? 0;
/** #271: already-gone total scoped to the parsed package's channels. */
export const selectPackageGoneMessageCount = (state: RootState): number => {
  const parsed = state.package.parsed;
  if (!parsed) return 0;
  const map = state.package.goneMessageIds;
  return parsed.channels.reduce((sum, c) => sum + (map[c.id]?.length ?? 0), 0);
};
/**
 * Deleted-via-Discrub total scoped to the currently-parsed package's
 * channels (#236). The persisted cache is keyed per user and may carry
 * channel ids from an older export of the same account; only deletions
 * attributable to this package's channels count toward the live
 * remaining totals shown in the UI. Archive counts themselves
 * (`messageCount`/`totalMessages` in pkg:meta) stay immutable.
 */
export const selectPackageDeletedMessageCount = (state: RootState): number => {
  const parsed = state.package.parsed;
  if (!parsed) return 0;
  const map = state.package.deletedMessageIds;
  return parsed.channels.reduce(
    (sum, c) => sum + (map[c.id]?.length ?? 0),
    0,
  );
};
export const selectPackageExportError = (state: RootState) =>
  state.package.exportError;

/* ────────── enrichment selectors ────────── */

export const selectActiveEnrichmentChannelId = (state: RootState) =>
  state.package.activeEnrichmentChannelId;
export const selectChannelEnrichmentStatus =
  (channelId: string) =>
  (state: RootState): EnrichmentStatus =>
    state.package.enrichmentStatus[channelId] ?? 'idle';
export const selectChannelEnrichmentProgress =
  (channelId: string) => (state: RootState) =>
    state.package.enrichmentProgress[channelId] ?? null;
export const selectChannelEnrichedMessages =
  (channelId: string) =>
  (state: RootState): Record<string, Message> | undefined =>
    state.package.enrichedMessages[channelId];
export const selectChannelEnrichmentMisses =
  (channelId: string) => (state: RootState) =>
    state.package.enrichmentMisses[channelId] ?? {
      deleted: [],
      forbidden: [],
    };
export const selectChannelEnrichmentError =
  (channelId: string) =>
  (state: RootState): string | null =>
    state.package.enrichmentError[channelId] ?? null;
export const selectChannelEnrichmentLastFetched =
  (channelId: string) =>
  (state: RootState): number | null =>
    state.package.enrichmentLastFetched[channelId] ?? null;

/** Test-only helper. */
/**
 * Test helpers retained as no-ops for backwards compatibility with
 * existing packageSlice.test.ts. The post-#162 architecture has no
 * module-level File reference; tests that previously called
 * `storeSourceFile(null)` to simulate "lost source" should instead
 * clear `pkg:msgs:*` keys via `storage.package.remove(...)`.
 */
export const __testHelpers__ = {
  storeSourceFile: (_file: File | Blob | null) => { /* no-op since #162 */ },
  getSourceFile: (): File | Blob | null => null,
};
