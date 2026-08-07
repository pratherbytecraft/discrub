import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { fetchAnnouncementData, fetchAnnouncementMarkdown } from 'discrub-core/github-service';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { initialAnnouncementState } from './announcementTypes';
import type { RootState } from '@/app/store';
import { selectSettings, updateSetting } from '@features/app/appSlice';
import { defaultSettings } from '@features/app/storageKeys';

/**
 * Fetch announcement data and markdown from GitHub gist
 */
export const fetchAnnouncement = createAsyncThunk(
  'announcement/fetchAnnouncement',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const settings = selectSettings(state);
      // Caller is responsible for waiting until settings have loaded.
      // If they fire this thunk while settings is still null (e.g. a
      // race against loadSettings on cold boot), the cached rev would
      // be misread and a previously-dismissed announcement could pop
      // back up. Fail closed: skip the check until settings exist.
      if (!settings) {
        return rejectWithValue('Settings not loaded yet — try again');
      }
      // Settings can also be PARTIAL during boot if an `updateSetting`
      // landed before `loadSettings.fulfilled`. Fall back to the default
      // rev when the key is missing so a partial-state race doesn't
      // manifest as cachedRev='' -> "new announcement".
      const cachedRev =
        settings[DiscrubSetting.CACHED_ANNOUNCEMENT_REV] ??
        defaultSettings[DiscrubSetting.CACHED_ANNOUNCEMENT_REV] ??
        '';

      const announcementData = await fetchAnnouncementData();
      const currentRev = announcementData.rev;
      const hasNew = currentRev !== cachedRev;

      // Only fetch markdown if there's a new announcement (auto-show modal)
      // Otherwise, markdown is fetched lazily when user clicks re-view button
      const markdown = hasNew ? await fetchAnnouncementMarkdown() : null;

      return { rev: currentRev, markdown, hasNew };
    } catch {
      return rejectWithValue('Failed to fetch announcement');
    }
  }
);

/**
 * Lazily fetch announcement markdown (for re-view button)
 */
export const fetchAnnouncementMarkdownThunk = createAsyncThunk(
  'announcement/fetchMarkdown',
  async (_, { rejectWithValue }) => {
    try {
      const markdown = await fetchAnnouncementMarkdown();
      return markdown || '';
    } catch {
      return rejectWithValue('Failed to fetch announcement content');
    }
  }
);

/**
 * Dismiss announcement and cache the revision
 */
export const dismissAnnouncement = createAsyncThunk(
  'announcement/dismissAnnouncement',
  async (_, { getState, dispatch }) => {
    const state = getState() as RootState;
    const rev = state.announcement.rev;
    if (rev) {
      await dispatch(updateSetting({ key: DiscrubSetting.CACHED_ANNOUNCEMENT_REV, value: rev }));
    }
  }
);

const announcementSlice = createSlice({
  name: 'announcement',
  initialState: initialAnnouncementState,
  reducers: {
    reopenAnnouncement: (state) => {
      state.hasNew = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAnnouncement.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchAnnouncement.fulfilled, (state, action) => {
        state.isLoading = false;
        state.rev = action.payload.rev;
        state.markdown = action.payload.markdown;
        state.hasNew = action.payload.hasNew;
      })
      .addCase(fetchAnnouncement.rejected, (state) => {
        state.isLoading = false;
        state.hasNew = false;
      })
      .addCase(dismissAnnouncement.fulfilled, (state) => {
        state.hasNew = false;
        state.dismissed = true;
      })
      .addCase(fetchAnnouncementMarkdownThunk.pending, (state) => {
        state.isLoadingMarkdown = true;
        state.markdownError = null;
      })
      .addCase(fetchAnnouncementMarkdownThunk.fulfilled, (state, action) => {
        state.isLoadingMarkdown = false;
        state.markdown = action.payload;
      })
      .addCase(fetchAnnouncementMarkdownThunk.rejected, (state) => {
        state.isLoadingMarkdown = false;
        state.markdownError = 'Failed to load announcement content';
      });
  },
});

export const { reopenAnnouncement } = announcementSlice.actions;

export const selectAnnouncement = (state: RootState) => state.announcement;
export const selectHasNewAnnouncement = (state: RootState) => state.announcement.hasNew;
export const selectAnnouncementMarkdown = (state: RootState) => state.announcement.markdown;
export const selectIsLoadingMarkdown = (state: RootState) => state.announcement.isLoadingMarkdown;
export const selectMarkdownError = (state: RootState) => state.announcement.markdownError;

export default announcementSlice.reducer;
