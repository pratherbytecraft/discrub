import type {
  SupporterKeyPayload,
  SupporterKeyStatus,
} from '@services/supporterKeyService';
import type { SupporterFooterPreferences } from '@services/exportFooter';

/**
 * Supporter platform state. Key material persists in `Discrub-state`
 * under `supporter:*` keys (owned by supporterSlice, deliberately
 * OUTSIDE AppSettings so SettingsModal's whole-object batch save can
 * never clobber a key claimed while the modal is open).
 */

export const SUPPORTER_KEY_STORAGE_KEY = 'supporter:key';
/** Legacy (pre-release builds stored a claim email; scrubbed on boot). */
export const SUPPORTER_EMAIL_STORAGE_KEY = 'supporter:email';
/** Legacy (attention calm is per-session now; stored value is ignored). */
export const GIFT_ATTENTION_SEEN_STORAGE_KEY = 'supporter:giftAttentionSeen';
/** Unix ms of the last successful (or 410-refused) daily check-in. */
export const SUPPORTER_LAST_REFRESH_STORAGE_KEY = 'supporter:lastRefreshAt';
export const FOOTER_TEXT_STORAGE_KEY = 'supporter:footerText';
export const FOOTER_REMOVED_STORAGE_KEY = 'supporter:footerRemoved';
/** Lives in Discrub-media (binary-ish payload), not Discrub-state. */
export const FOOTER_ICON_MEDIA_KEY = 'supporter:footerIcon';

export interface SupporterState {
  /** True once initializeSupporter has resolved (gates load-time UI). */
  initialized: boolean;
  /** 'none' = no stored key; otherwise last verification outcome. */
  keyStatus: SupporterKeyStatus | 'none';
  /**
   * A valid key just became expired (the server answered that access ended).
   * MainLayout shows the one-time notice and clears it. Transient. (2.2.0, A13)
   */
  accessEndedNotice?: boolean;
  /** Verified payload — present for valid/expired/revoked keys. */
  payload: SupporterKeyPayload | null;
  /** When the key was last checked against the server (ms), null = never. */
  lastRefreshAt: number | null;
  dialogOpen: boolean;
  /** Gift-button attention animation calms permanently once true. */
  giftAttentionSeen: boolean;
  claimInProgress: boolean;
  claimError: string | null;
  /**
   * Export-footer customization (slot F). Stored regardless of key
   * validity — export-time resolution applies it only for a valid
   * supporter, so preferences survive a lapse and return on re-claim.
   */
  footer: SupporterFooterPreferences;
}

export const initialSupporterState: SupporterState = {
  initialized: false,
  keyStatus: 'none',
  accessEndedNotice: false,
  payload: null,
  lastRefreshAt: null,
  dialogOpen: false,
  giftAttentionSeen: false,
  claimInProgress: false,
  claimError: null,
  footer: { text: null, removed: false, iconDataUri: null },
};
