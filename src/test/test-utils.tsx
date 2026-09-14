import { previewGuardMiddleware } from '@/middleware/previewGuardMiddleware';
import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '@/theme/theme';
import { configureStore, Middleware, Reducer, ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import { RootState, AppStore } from '@/app/store';

// Import all reducers
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
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

interface ExtendedRenderOptions extends Omit<RenderOptions, 'queries'> {
  preloadedState?: Partial<RootState>;
  store?: AppStore;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    preloadedState = {},
    store = configureStore({
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
      } as any,
      preloadedState,
    }),
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  function Wrapper({ children }: { children: ReactNode }) {
    // Components read custom palette tokens (cta, backgroundDialog, ...)
    // that only exist on the app's themes, so tests must render under a
    // real registry theme rather than MUI's default.
    return (
      <Provider store={store}>
        <ThemeProvider theme={darkTheme}>{children}</ThemeProvider>
      </Provider>
    );
  }

  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}

/**
 * Typed test store for slice tests.
 *
 * Provides properly typed `dispatch` (accepts thunks) and `getState` that
 * returns `RootState` so selectors work without casts. Use `createTestStore`
 * to create an instance.
 */
export interface TestStore {
  dispatch: ThunkDispatch<RootState, unknown, UnknownAction>;
  getState: () => RootState;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Create a typed test store from a reducer map and optional preloaded state.
 *
 * The store's `getState` returns `RootState` so selectors can be called
 * directly. Only the slices you provide reducers for will have real state;
 * accessing other slices will return `undefined` at runtime (which is fine
 * for isolated slice tests).
 *
 * Usage:
 * ```ts
 * const store = createTestStore({ auth: authReducer });
 * await store.dispatch(someThunk());
 * expect(selectAuthToken(store.getState())).toBe('...');
 * ```
 */
export function createTestStore(
  reducers: Record<string, Reducer>,
  preloadedState?: Record<string, unknown>,
  middleware?: Middleware[],
): TestStore {
  return configureStore({
    reducer: reducers,
    preloadedState,
    // The preview guard is part of every store so tests see the real gate.
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(previewGuardMiddleware).concat(...(middleware ?? [])),
  }) as unknown as TestStore;
}

// Re-export everything from testing-library
export * from '@testing-library/react';
export { userEvent } from '@testing-library/user-event';
