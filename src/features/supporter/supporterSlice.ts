import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { fetchRevokedSupporterKeys } from 'discrub-core/github-service';
import type { RootState } from '@/app/store';
import { storage } from '@/extension/storage';
import {
  isSupporterFeatureLive,
  liveSupporterFeatures,
  verifySupporterKey,
  type SupporterFeature,
  type SupporterKeyPayload,
  type SupporterKeyVerification,
} from '@services/supporterKeyService';
import {
  normalizeSupporterCode,
  requestSupporterKeyRedemption,
  requestSupporterKeyRefresh,
  SupporterClaimError,
  SUPPORTER_ACCESS_ENDED_STATUS,
} from '@services/supporterClaimService';
import type { SupporterFooterPreferences } from '@services/exportFooter';
import {
  type SupporterState,
  initialSupporterState,
  SUPPORTER_KEY_STORAGE_KEY,
  SUPPORTER_EMAIL_STORAGE_KEY,
  SUPPORTER_LAST_REFRESH_STORAGE_KEY,
  FOOTER_TEXT_STORAGE_KEY,
  FOOTER_REMOVED_STORAGE_KEY,
  FOOTER_ICON_MEDIA_KEY,
} from './supporterTypes';

/**
 * Supporter slice — pasted-key application, local Ed25519
 * verification, and the daily check-in. Keys arrive by email when a
 * purchase lands; afterwards a client holding a key presents it to the
 * server about once a day and stores whatever comes back, so new
 * purchases, upgrades, renewals, and lapses all land without the user
 * doing anything (applying a key is the consent moment, disclosure
 * lives in the hub copy, removing the key is the off-switch). No email
 * address is ever collected or stored on this device, and clients
 * without a key never contact the server at all.
 *
 * Everything fails open toward the free experience: a broken fetch,
 * an offline check-in, or an unsupported browser just means themes
 * stay (or fall back to) the free set. The one deliberate exception is
 * the server's 410 "access ended" answer, which relocks. No operation
 * here may throw into UI.
 */

/** Check a stored key against the server at most this often. */
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface VerifiedKeyState {
  keyStatus: SupporterKeyVerification['status'];
  payload: SupporterKeyPayload | null;
}

/**
 * Set the key status and raise the one-time access-ended notice when a key
 * that was valid comes back expired (A13). Any other transition is quiet.
 */
const applyKeyStatus = (state: SupporterState, next: SupporterState['keyStatus']) => {
  if (state.keyStatus === 'valid' && next === 'expired') state.accessEndedNotice = true;
  state.keyStatus = next;
};

const toVerifiedState = (verification: SupporterKeyVerification): VerifiedKeyState => ({
  keyStatus: verification.status,
  payload: verification.payload ?? null,
});

/**
 * Load and verify the stored key on app boot. If a key is stored and
 * the last server check-in is older than REFRESH_INTERVAL_MS (or never
 * happened, or was refused), present the key once and store whatever
 * comes back. Offline or server trouble just keeps the local
 * verification; a 410 means the owner holds nothing live any more, so
 * the key relocks until a new one arrives.
 */
export const initializeSupporter = createAsyncThunk(
  'supporter/initialize',
  async () => {
    const [storedKey, lastRefreshAt, footerText, footerRemoved, footerIcon] =
      await Promise.all([
        storage.state.get<string>(SUPPORTER_KEY_STORAGE_KEY),
        storage.state.get<number>(SUPPORTER_LAST_REFRESH_STORAGE_KEY),
        storage.state.get<string>(FOOTER_TEXT_STORAGE_KEY),
        storage.state.get<boolean>(FOOTER_REMOVED_STORAGE_KEY),
        storage.media.get<string>(FOOTER_ICON_MEDIA_KEY),
      ]);

    // Pre-release builds stored a claim email; the key-based refresh
    // makes it obsolete, so scrub any leftover value.
    storage.state.remove(SUPPORTER_EMAIL_STORAGE_KEY).catch(() => {});

    const base = {
      footer: {
        text: typeof footerText === 'string' && footerText ? footerText : null,
        removed: footerRemoved === true,
        iconDataUri: typeof footerIcon === 'string' && footerIcon ? footerIcon : null,
      } as SupporterFooterPreferences,
      lastRefreshAt: typeof lastRefreshAt === 'number' ? lastRefreshAt : null,
    };

    if (!storedKey) {
      return { ...base, keyStatus: 'none' as const, payload: null };
    }

    // Revocation is a rare-remedy tool riding the existing gist reads;
    // fetch failures resolve to [] inside the service (fail open).
    const revokedJtis = await fetchRevokedSupporterKeys();
    let verification = await verifySupporterKey(storedKey, { revokedJtis });
    if (verification.status === 'invalid') {
      return { ...base, ...toVerifiedState(verification) };
    }

    const now = Date.now();
    const due =
      base.lastRefreshAt === null || now - base.lastRefreshAt >= REFRESH_INTERVAL_MS;

    if (due && verification.status !== 'revoked') {
      try {
        const result = await requestSupporterKeyRefresh(storedKey);
        const refreshed = await verifySupporterKey(result.key, { revokedJtis });
        if (refreshed.status !== 'invalid') {
          await storage.state.set(SUPPORTER_KEY_STORAGE_KEY, result.key);
          verification = refreshed;
        }
        await storage.state.set(SUPPORTER_LAST_REFRESH_STORAGE_KEY, now);
        base.lastRefreshAt = now;
      } catch (error) {
        if (
          error instanceof SupporterClaimError &&
          error.status === SUPPORTER_ACCESS_ENDED_STATUS
        ) {
          // Nothing live behind this key any more: relock, and check
          // again on the next open in case a new purchase lands.
          await storage.state.remove(SUPPORTER_LAST_REFRESH_STORAGE_KEY).catch(() => {});
          base.lastRefreshAt = null;
          if (verification.payload) {
            verification = { status: 'expired', payload: verification.payload };
          }
        }
        // Anything else (offline, server down): keep the local result.
      }
    }

    return { ...base, ...toVerifiedState(verification) };
  },
);

/**
 * Manual "refresh key" — presents the stored key to the refresh
 * endpoint for a fresh merged one. Works for valid and recently-expired
 * keys alike; the server's entitlement check is the truth.
 */
export const refreshSupporterKey = createAsyncThunk(
  'supporter/refreshKey',
  async (_, { rejectWithValue }) => {
    const storedKey = await storage.state.get<string>(SUPPORTER_KEY_STORAGE_KEY);
    if (!storedKey) {
      return rejectWithValue('No key to refresh. Paste your supporter key first.');
    }
    try {
      const result = await requestSupporterKeyRefresh(storedKey);
      const verification = await verifySupporterKey(result.key);
      if (verification.status !== 'valid' || !verification.payload) {
        return rejectWithValue(
          'The server issued a key this app version could not verify. Update Discrub and try again.',
        );
      }
      const now = Date.now();
      await Promise.all([
        storage.state.set(SUPPORTER_KEY_STORAGE_KEY, result.key),
        storage.state.set(SUPPORTER_LAST_REFRESH_STORAGE_KEY, now),
      ]);
      return { keyStatus: verification.status, payload: verification.payload, lastRefreshAt: now };
    } catch (error) {
      if (error instanceof SupporterClaimError) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Something went wrong refreshing your key. Try again.');
    }
  },
);

/**
 * Apply a pasted supporter key — the primary unlock path. Emails carry
 * the short DSCRB/PBYTE-XXXX-XXXX form (exchanged with the server for the
 * full signed key, which is what gets stored); a full key pasted from
 * the archive verifies locally. Either way the stored key is replaced,
 * never stacked: one key per person. A redeemed key counts as a fresh
 * server check-in.
 */
export const applyPastedSupporterKey = createAsyncThunk(
  'supporter/applyPastedKey',
  async (key: string, { rejectWithValue }) => {
    const trimmed = key.trim();

    const code = normalizeSupporterCode(trimmed);
    if (code) {
      try {
        const result = await requestSupporterKeyRedemption(code);
        const verification = await verifySupporterKey(result.key);
        if (verification.status !== 'valid' || !verification.payload) {
          return rejectWithValue(
            'The server issued a key this app version could not verify. Update Discrub and try again.',
          );
        }
        const now = Date.now();
        await Promise.all([
          storage.state.set(SUPPORTER_KEY_STORAGE_KEY, result.key),
          storage.state.set(SUPPORTER_LAST_REFRESH_STORAGE_KEY, now),
        ]);
        return { keyStatus: verification.status, payload: verification.payload, lastRefreshAt: now };
      } catch (error) {
        if (error instanceof SupporterClaimError) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue(
          'Something went wrong applying your key. Try again.',
        );
      }
    }

    const verification = await verifySupporterKey(trimmed);
    if (verification.status === 'invalid') {
      return rejectWithValue("That doesn't look like a valid supporter key.");
    }
    if (verification.status === 'expired') {
      return rejectWithValue(
        'That key has expired. Check your email for a newer one, or use Refresh key.',
      );
    }
    if (verification.status === 'revoked') {
      return rejectWithValue('That key is no longer active.');
    }
    await Promise.all([
      storage.state.set(SUPPORTER_KEY_STORAGE_KEY, trimmed),
      storage.state.remove(SUPPORTER_LAST_REFRESH_STORAGE_KEY),
    ]);
    return { keyStatus: verification.status, payload: verification.payload!, lastRefreshAt: null };
  },
);

/**
 * The off-switch: deletes the key, which stops all refresh calls
 * entirely. (The email removal is legacy cleanup from pre-release
 * builds that stored one.)
 */
export const removeSupporterKey = createAsyncThunk('supporter/removeKey', async () => {
  await Promise.all([
    storage.state.remove(SUPPORTER_KEY_STORAGE_KEY),
    storage.state.remove(SUPPORTER_EMAIL_STORAGE_KEY),
    storage.state.remove(SUPPORTER_LAST_REFRESH_STORAGE_KEY),
  ]);
});

/**
 * Persist export-footer text/removed preferences (slot F). Empty text
 * clears the stored value back to the default.
 */
export const updateFooterPreferences = createAsyncThunk(
  'supporter/updateFooterPreferences',
  async (prefs: { text?: string; removed?: boolean }) => {
    const writes: Promise<void>[] = [];
    let text: string | null | undefined;
    if (prefs.text !== undefined) {
      text = prefs.text.trim() || null;
      writes.push(
        text === null
          ? storage.state.remove(FOOTER_TEXT_STORAGE_KEY)
          : storage.state.set(FOOTER_TEXT_STORAGE_KEY, text),
      );
    }
    if (prefs.removed !== undefined) {
      writes.push(
        prefs.removed
          ? storage.state.set(FOOTER_REMOVED_STORAGE_KEY, true)
          : storage.state.remove(FOOTER_REMOVED_STORAGE_KEY),
      );
    }
    await Promise.all(writes);
    return { text, removed: prefs.removed };
  },
);

/**
 * Persist (or clear, with null) the custom footer icon. The caller has
 * already validated and downscaled the image to a small data URI
 * (processFooterIconFile); the payload lives in Discrub-media.
 */
export const setFooterIcon = createAsyncThunk(
  'supporter/setFooterIcon',
  async (dataUri: string | null) => {
    if (dataUri === null) {
      await storage.media.remove(FOOTER_ICON_MEDIA_KEY);
    } else {
      await storage.media.set(FOOTER_ICON_MEDIA_KEY, dataUri);
    }
    return dataUri;
  },
);

const supporterSlice = createSlice({
  name: 'supporter',
  initialState: initialSupporterState,
  reducers: {
    setSupporterDialogOpen: (state, action: PayloadAction<boolean>) => {
      state.dialogOpen = action.payload;
      if (!action.payload) state.claimError = null;
    },
    clearClaimError: (state) => {
      state.claimError = null;
    },
    // Calm the gift-button attention animation for the rest of this
    // session. Deliberately NOT persisted: the glow/wiggle re-arms on
    // every app open until the user becomes a supporter.
    dismissAccessEndedNotice: (state) => {
      state.accessEndedNotice = false;
    },
    markGiftAttentionSeen: (state) => {
      state.giftAttentionSeen = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeSupporter.fulfilled, (state, action) => {
        state.initialized = true;
        applyKeyStatus(state, action.payload.keyStatus);
        state.payload = action.payload.payload;
        state.footer = action.payload.footer;
        state.lastRefreshAt = action.payload.lastRefreshAt;
      })
      .addCase(initializeSupporter.rejected, (state) => {
        // Storage failure — behave as a fresh install (free experience).
        state.initialized = true;
      })
      .addCase(refreshSupporterKey.pending, (state) => {
        state.claimInProgress = true;
        state.claimError = null;
      })
      .addCase(refreshSupporterKey.fulfilled, (state, action) => {
        state.claimInProgress = false;
        applyKeyStatus(state, action.payload.keyStatus);
        state.payload = action.payload.payload;
        state.lastRefreshAt = action.payload.lastRefreshAt;
      })
      .addCase(refreshSupporterKey.rejected, (state, action) => {
        state.claimInProgress = false;
        state.claimError =
          (action.payload as string) ?? 'Something went wrong refreshing your key.';
      })
      .addCase(applyPastedSupporterKey.pending, (state) => {
        state.claimInProgress = true;
        state.claimError = null;
      })
      .addCase(applyPastedSupporterKey.fulfilled, (state, action) => {
        state.claimInProgress = false;
        applyKeyStatus(state, action.payload.keyStatus);
        state.payload = action.payload.payload;
        state.lastRefreshAt = action.payload.lastRefreshAt;
      })
      .addCase(applyPastedSupporterKey.rejected, (state, action) => {
        state.claimInProgress = false;
        state.claimError =
          (action.payload as string) ?? "That key couldn't be verified.";
      })
      .addCase(removeSupporterKey.fulfilled, (state) => {
        state.keyStatus = 'none';
        state.payload = null;
        state.lastRefreshAt = null;
        state.claimError = null;
      })
      .addCase(updateFooterPreferences.fulfilled, (state, action) => {
        if (action.payload.text !== undefined) state.footer.text = action.payload.text;
        if (action.payload.removed !== undefined) state.footer.removed = action.payload.removed;
      })
      .addCase(setFooterIcon.fulfilled, (state, action) => {
        state.footer.iconDataUri = action.payload;
      });
  },
});

export const { setSupporterDialogOpen, clearClaimError, markGiftAttentionSeen, dismissAccessEndedNotice } =
  supporterSlice.actions;

// Selectors
export const selectSupporter = (state: RootState) => state.supporter;
/** Any live feature at all (badge, avatar ring, "thank you" framing). */
export const selectAccessEndedNotice = (state: RootState) => state.supporter.accessEndedNotice === true;
export const selectIsSupporter = (state: RootState) =>
  state.supporter.keyStatus === 'valid' &&
  liveSupporterFeatures(state.supporter.payload).length > 0;
const selectFeature = (feature: SupporterFeature) => (state: RootState) =>
  state.supporter.keyStatus === 'valid' &&
  isSupporterFeatureLive(state.supporter.payload, feature);
/** Gates the theme pack, export theming, and footer customization. */
export const selectHasThemes = selectFeature('themes');
/** Gates the hosted Bleeding Edge build. */
export const selectHasHosted = selectFeature('hosted');
export const selectSupporterLastRefreshAt = (state: RootState) =>
  state.supporter.lastRefreshAt;
export const selectSupporterKeyStatus = (state: RootState) => state.supporter.keyStatus;
export const selectSupporterPayload = (state: RootState) => state.supporter.payload;
export const selectSupporterDialogOpen = (state: RootState) => state.supporter.dialogOpen;
export const selectGiftAttentionSeen = (state: RootState) =>
  state.supporter.giftAttentionSeen;
export const selectSupporterClaimInProgress = (state: RootState) =>
  state.supporter.claimInProgress;
export const selectSupporterClaimError = (state: RootState) => state.supporter.claimError;
export const selectSupporterFooter = (state: RootState) => state.supporter.footer;

export default supporterSlice.reducer;
