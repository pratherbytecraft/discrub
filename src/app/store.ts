import { configureStore, ThunkAction, Action } from '@reduxjs/toolkit';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer, { settingsChangeMiddleware } from '@features/app/appSlice';
import { errorLoggingMiddleware } from '@/middleware/errorLoggingMiddleware';
import { previewGuardMiddleware } from '@/middleware/previewGuardMiddleware';
import guildReducer from '@features/guild/guildSlice';
import channelReducer from '@features/channel/channelSlice';
import dmReducer from '@features/dm/dmSlice';
import messageReducer from '@features/message/messageSlice';
import exportReducer from '@features/export/exportSlice';
import cacheReducer from '@features/cache/cacheSlice';
import statusReducer from '@features/status/statusSlice';
import purgeReducer from '@features/purge/purgeSlice';
import announcementReducer from '@features/announcement/announcementSlice';
import presetsReducer from '@features/presets/presetsSlice';
import historyReducer from '@features/history/historySlice';
import packageReducer from '@features/package/packageSlice';
import hotkeysReducer from '@features/hotkeys/hotkeysSlice';
import devReducer from '@features/dev/devSlice';
import supporterReducer from '@features/supporter/supporterSlice';

/**
 * Redux store configuration
 * Combines all feature slices and provides typed hooks
 */
export const store = configureStore({
  reducer: {
    auth: authReducer,
    user: userReducer,
    app: appReducer,
    guild: guildReducer,
    channel: channelReducer,
    dm: dmReducer,
    message: messageReducer,
    export: exportReducer,
    cache: cacheReducer,
    status: statusReducer,
    purge: purgeReducer,
    announcement: announcementReducer,
    presets: presetsReducer,
    history: historyReducer,
    package: packageReducer,
    hotkeys: hotkeysReducer,
    dev: devReducer,
    supporter: supporterReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // RTK's dev-only immutable/serializable checks deep-walk the entire
      // state tree on EVERY dispatch — O(state size) per action. They are
      // stripped from production builds, so with Cypress driving the dev
      // server they make the app measurably jankier than what users run
      // (the #183 perf spec's main-thread-stall measurement was dominated
      // by them). Disable both under Cypress for production-fidelity E2E;
      // dev sessions and Vitest stores keep them.
      immutableCheck: typeof window !== 'undefined' && 'Cypress' in window ? false : true,
      serializableCheck: typeof window !== 'undefined' && 'Cypress' in window
        ? false
        : {
            // Ignore these paths in the state for serializability checks
            // This is useful for storing Date objects or other non-serializable data
            // export.exportCriteria holds Date bounds (#207 Arm B), like search
            // criteria elsewhere; exclude it from the dev-only serializability check.
            ignoredActions: ['auth/setToken', 'export/setExportCriteria', 'export/applyPreset'],
            ignoredPaths: ['auth.token', 'export.exportCriteria'],
          },
    }).prepend(previewGuardMiddleware).concat(settingsChangeMiddleware, errorLoggingMiddleware),
});

export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
export type AppThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  RootState,
  unknown,
  Action<string>
>;
