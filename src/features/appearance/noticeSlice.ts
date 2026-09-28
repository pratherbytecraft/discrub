import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { storage } from '@/extension/storage';
import { THEME_DESCRIPTORS, type ThemeDescriptor } from '@/theme/descriptors';
import { inSeason } from './groups';

/**
 * The seasonal notice (2.2.3): the holiday Scrubling hangs from the
 * Appearance button and says the holiday theme is in. It shows for everyone
 * while a holiday theme is in season and goes away for good the first time
 * the Appearance button is clicked (owner, 2026-09-30). The seen id lives in
 * Discrub-state like the supporter keys, so it survives reloads. A later
 * holiday has a different theme id, so its notice shows again.
 */
export const SEASONAL_NOTICE_SEEN_KEY = 'seasonalNoticeSeen';

interface NoticeState {
  loaded: boolean;
  seenId: string | null;
}

const initialState: NoticeState = { loaded: false, seenId: null };

export const loadSeasonalNotice = createAsyncThunk('notice/load', async () =>
  storage.state.get<string>(SEASONAL_NOTICE_SEEN_KEY),
);

export const markSeasonalNoticeSeen = createAsyncThunk('notice/seen', async (id: string) => {
  await storage.state.set(SEASONAL_NOTICE_SEEN_KEY, id);
  return id;
});

const noticeSlice = createSlice({
  name: 'notice',
  initialState,
  reducers: {
    /** Test helper: set the seen id without touching storage. */
    setSeasonalNoticeSeen: (state, action: PayloadAction<string | null>) => {
      state.seenId = action.payload;
      state.loaded = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSeasonalNotice.fulfilled, (state, action) => { state.seenId = action.payload; state.loaded = true; })
      .addCase(loadSeasonalNotice.rejected, (state) => { state.loaded = true; })
      .addCase(markSeasonalNoticeSeen.pending, (state, action) => { state.seenId = action.meta.arg; });
  },
});

export const { setSeasonalNoticeSeen } = noticeSlice.actions;
export default noticeSlice.reducer;

/** The holiday theme in season right now, if any. */
export const currentHolidayTheme = (now: Date = new Date()): ThemeDescriptor | undefined =>
  THEME_DESCRIPTORS.find((d) => d.group === 'holiday' && inSeason(d.season, now));

/** The theme the notice should announce, or null once it was seen or out of season. */
export const selectSeasonalNoticeTheme = (state: RootState): ThemeDescriptor | null => {
  const notice = state.notice;
  if (!notice?.loaded) return null;
  const theme = currentHolidayTheme();
  if (!theme || notice.seenId === theme.id) return null;
  return theme;
};
