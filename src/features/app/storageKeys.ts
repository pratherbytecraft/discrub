/**
 * Storage key classification + helpers — extracted from `appSlice.ts`
 * so the storage migration in `extension/storage.ts` can import them
 * without circular dependency.
 *
 * Discrub's settings are conceptually two things:
 *
 *   1. **Settings proper** — user preferences the user knowingly tunes
 *      (`searchDelay`, `apiTheme`, etc.). Persisted to `Discrub-settings`.
 *   2. **Meta-state markers** — internal app-state flags the user doesn't
 *      directly edit (`apptourshellCompleted`, `cachedAnnouncementRev`,
 *      `exportSelectedPreset`). Persisted to `Discrub-state`.
 *
 * The `selectSetting()` API stays unified — callers don't need to know
 * which DB a key lives in. The split happens in the load/save thunks.
 */

import type { AppSettings } from 'discrub-core/types/discrub-types';
import {
  DiscrubSetting,
  DateFormat,
  TimeFormat,
  UserDataRefreshRate,
} from 'discrub-core/discrub-enum';
import { SortDirection } from 'discrub-core/common-enum';

/**
 * Default values for every known DiscrubSetting key. Settings missing
 * from storage fall back here. New settings added here automatically
 * pick up defaults on next boot.
 */
export const defaultSettings: AppSettings = {
  // Operation Delays
  [DiscrubSetting.SEARCH_DELAY]: '1',
  [DiscrubSetting.DELETE_DELAY]: '2',
  [DiscrubSetting.DELAY_MODIFIER]: '0.5',

  // User Data Settings
  [DiscrubSetting.REACTIONS_ENABLED]: 'true',
  [DiscrubSetting.REPLIES_ENABLED]: 'true',
  [DiscrubSetting.SERVER_NICKNAME_LOOKUP]: 'true',
  [DiscrubSetting.DISPLAY_NAME_LOOKUP]: 'true',
  [DiscrubSetting.APP_USER_DATA_REFRESH_RATE]: UserDataRefreshRate.DAILY,

  // Export Preferences
  [DiscrubSetting.EXPORT_SEPARATE_THREAD_AND_FORUM_POSTS]: 'true',
  [DiscrubSetting.EXPORT_ARTIST_MODE]: 'false',
  [DiscrubSetting.EXPORT_MESSAGE_SORT_ORDER]: SortDirection.DESCENDING,
  [DiscrubSetting.EXPORT_PREVIEW_MEDIA]: 'true',
  [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'false',
  [DiscrubSetting.EXPORT_MESSAGES_PER_PAGE]: '500',

  // Display Options
  [DiscrubSetting.DATE_FORMAT]: DateFormat.MMDDYYYY,
  [DiscrubSetting.TIME_FORMAT]: TimeFormat._12HOUR,
  [DiscrubSetting.APP_SHOW_KOFI_FEED]: 'false',
  [DiscrubSetting.APP_THEME_MODE]: 'auto',

  // Purge Behavior
  [DiscrubSetting.PURGE_RETAIN_ATTACHED_MEDIA]: 'false',
  [DiscrubSetting.PURGE_DELETE_ATTACHMENTS_ONLY]: 'false',
  [DiscrubSetting.PURGE_REACTION_REMOVAL_FROM]: 'all',
  [DiscrubSetting.PURGE_MODE]: 'messages',

  // Export Media Type Defaults
  [DiscrubSetting.EXPORT_MEDIA_IMAGES]: 'true',
  [DiscrubSetting.EXPORT_MEDIA_VIDEOS]: 'true',
  [DiscrubSetting.EXPORT_MEDIA_AUDIO]: 'true',
  [DiscrubSetting.EXPORT_MEDIA_OTHER]: 'true',
  [DiscrubSetting.EXPORT_FORMAT]: 'html',
  // EXPORT_PRESETS / EXPORT_RECENT_HISTORY no longer live in settings —
  // they have their own slices (presetsSlice, historySlice). The defaults
  // here are kept as the empty-state sentinel for backward-compat reads.
  [DiscrubSetting.EXPORT_PRESETS]: '[]',
  [DiscrubSetting.EXPORT_RECENT_HISTORY]: '[]',
  [DiscrubSetting.EXPORT_TEMPLATE]: 'discord',

  // Browser Environment
  [DiscrubSetting.BROWSER_ENV]: 'web',

  // Cache (initialized empty)
  [DiscrubSetting.CACHED_USER_MAP]: '{}',
  [DiscrubSetting.CACHED_ANNOUNCEMENT_REV]: '0',

  // Tour State
  [DiscrubSetting.APP_TOUR_SHELL_COMPLETED]: 'false',
  [DiscrubSetting.APP_TOUR_CONTEXTUAL_COMPLETED]: 'false',
};

/**
 * Keys that route to `Discrub-state` instead of `Discrub-settings`.
 * These are app-internal markers (have-they-seen-X, transient state)
 * rather than tunable preferences.
 */
export const STATE_SETTING_KEYS = new Set<string>([
  DiscrubSetting.APP_TOUR_SHELL_COMPLETED,
  DiscrubSetting.APP_TOUR_CONTEXTUAL_COMPLETED,
  DiscrubSetting.CACHED_ANNOUNCEMENT_REV,
]);

export function isStateSettingKey(key: string): boolean {
  return STATE_SETTING_KEYS.has(key);
}

/**
 * Keys that *used to* live as JSON-array strings inside the settings
 * blob but are now extracted into their own DBs. Kept here as a string
 * constant so the migration in `storage.ts` doesn't need to import
 * `discrub-core/discrub-enum` (which would create an import cycle via
 * appSlice).
 */
export const EXPORT_PRESETS_KEY: string = DiscrubSetting.EXPORT_PRESETS;
export const EXPORT_RECENT_HISTORY_KEY: string = DiscrubSetting.EXPORT_RECENT_HISTORY;
