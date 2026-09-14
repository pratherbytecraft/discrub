import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import supporterReducer, {
  initializeSupporter,
  updateFooterPreferences,
  setFooterIcon,
  refreshSupporterKey,
  applyPastedSupporterKey,
  removeSupporterKey,
  markGiftAttentionSeen,
  dismissAccessEndedNotice,
  setSupporterDialogOpen,
  selectIsSupporter,
  selectHasThemes,
  selectHasHosted,
  selectSupporterKeyStatus,
  REFRESH_INTERVAL_MS,
} from './supporterSlice';
import {
  SUPPORTER_KEY_STORAGE_KEY,
  SUPPORTER_EMAIL_STORAGE_KEY,
  SUPPORTER_LAST_REFRESH_STORAGE_KEY,
  GIFT_ATTENTION_SEEN_STORAGE_KEY,
  FOOTER_TEXT_STORAGE_KEY,
  FOOTER_REMOVED_STORAGE_KEY,
  FOOTER_ICON_MEDIA_KEY,
} from './supporterTypes';
import type { SupporterKeyPayload } from '@services/supporterKeyService';

// In-memory stand-in for the Discrub-state store (same shape the
// appSlice tests use).
const { stateStore, stateData, mediaStore, mediaData } = vi.hoisted(() => {
  const makeStore = () => {
    const data: Record<string, unknown> = {};
    return {
      data,
      adapter: {
        get: vi.fn(async (key: string) => data[key] ?? null),
        set: vi.fn(async (key: string, value: unknown) => {
          data[key] = value;
        }),
        remove: vi.fn(async (key: string) => {
          delete data[key];
        }),
      },
    };
  };
  const state = makeStore();
  const media = makeStore();
  return {
    stateData: state.data,
    stateStore: state.adapter,
    mediaData: media.data,
    mediaStore: media.adapter,
  };
});

vi.mock('@/extension/storage', () => ({
  storage: { state: stateStore, media: mediaStore },
}));

const { mockFetchRevoked } = vi.hoisted(() => ({
  mockFetchRevoked: vi.fn(async () => [] as string[]),
}));
vi.mock('discrub-core/github-service', () => ({
  fetchRevokedSupporterKeys: mockFetchRevoked,
}));

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));
vi.mock('@services/supporterKeyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/supporterKeyService')>();
  return { ...actual, verifySupporterKey: mockVerify };
});

const { mockRequestKey, mockRedeemCode, MockClaimError } = vi.hoisted(() => {
  class MockClaimError extends Error {
    status: number | null;
    constructor(message: string, status: number | null) {
      super(message);
      this.name = 'SupporterClaimError';
      this.status = status;
    }
  }
  return { mockRequestKey: vi.fn(), mockRedeemCode: vi.fn(), MockClaimError };
});
vi.mock('@services/supporterClaimService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@services/supporterClaimService')>();
  return {
    ...actual,
    // Pure input classifier — the real one keeps code/key routing honest.
    normalizeSupporterCode: actual.normalizeSupporterCode,
    requestSupporterKeyRefresh: mockRequestKey,
    requestSupporterKeyRedemption: mockRedeemCode,
    SupporterClaimError: MockClaimError,
  };
});

const DAY_S = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

function makePayload(overrides: Partial<SupporterKeyPayload> = {}): SupporterKeyPayload {
  return {
    v: 2,
    kid: '2026-2',
    jti: 'jti-1',
    name: 'Aaron P.',
    eh: 'hash',
    ent: { themes: nowS() + 30 * DAY_S },
    iat: nowS() - DAY_S,
    exp: nowS() + 30 * DAY_S,
    ...overrides,
  };
}

const makeStore = () => configureStore({ reducer: { supporter: supporterReducer } });
type Store = ReturnType<typeof makeStore>;
const rootState = (store: Store) => store.getState() as never;

describe('supporterSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(stateData)) delete stateData[key];
    for (const key of Object.keys(mediaData)) delete mediaData[key];
    mockFetchRevoked.mockResolvedValue([]);
  });

  describe('initializeSupporter', () => {
    it('resolves to none with no stored key and never fetches revocations', async () => {
      const store = makeStore();
      await store.dispatch(initializeSupporter());

      const state = store.getState().supporter;
      expect(state.initialized).toBe(true);
      expect(state.keyStatus).toBe('none');
      expect(state.giftAttentionSeen).toBe(false);
      expect(mockFetchRevoked).not.toHaveBeenCalled();
    });

    it('verifies a stored key against the fetched revocation list', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-key';
      // A legacy stored gift-attention flag is ignored: the calm is
      // per-session now, so every boot starts un-seen.
      stateData[GIFT_ATTENTION_SEEN_STORAGE_KEY] = true;
      mockFetchRevoked.mockResolvedValue(['bad-jti']);
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });

      const store = makeStore();
      await store.dispatch(initializeSupporter());

      expect(mockVerify).toHaveBeenCalledWith('DSCRB-key', { revokedJtis: ['bad-jti'] });
      const state = store.getState().supporter;
      expect(state.keyStatus).toBe('valid');
      expect(state.payload?.name).toBe('Aaron P.');
      expect(state.giftAttentionSeen).toBe(false);
      expect(selectIsSupporter(rootState(store))).toBe(true);
    });

    it('checks in with the server on first boot with a key (never checked) and stores the merged key', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-old';
      const current = makePayload();
      const merged = makePayload({ jti: 'jti-2', ent: { themes: nowS() + 37 * DAY_S, hosted: nowS() + 400 * DAY_S } });
      mockVerify
        .mockResolvedValueOnce({ status: 'valid', payload: current })
        .mockResolvedValueOnce({ status: 'valid', payload: merged });
      mockRequestKey.mockResolvedValue({
        key: 'DSCRB-new',
        ent: merged.ent,
        name: 'Aaron P.',
        expiresAt: 'whenever',
      });

      const store = makeStore();
      await store.dispatch(initializeSupporter());

      expect(mockRequestKey).toHaveBeenCalledWith('DSCRB-old');
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-new');
      expect(typeof stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY]).toBe('number');
      const state = store.getState().supporter;
      expect(state.payload?.jti).toBe('jti-2');
      expect(state.lastRefreshAt).not.toBeNull();
      expect(selectHasThemes(rootState(store))).toBe(true);
      expect(selectHasHosted(rootState(store))).toBe(true);
    });

    it('checks in again once the last check is older than a day', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-old';
      stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY] = Date.now() - REFRESH_INTERVAL_MS - 1000;
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });
      mockRequestKey.mockResolvedValue({ key: 'DSCRB-new', ent: { themes: null }, name: 'Aaron P.', expiresAt: null });

      await makeStore().dispatch(initializeSupporter());
      expect(mockRequestKey).toHaveBeenCalledTimes(1);
    });

    it('also checks in for an already-expired key (renewal case)', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-old';
      mockVerify
        .mockResolvedValueOnce({
          status: 'expired',
          payload: makePayload({ exp: nowS() - 10 * DAY_S, ent: { themes: nowS() - 10 * DAY_S } }),
        })
        .mockResolvedValueOnce({ status: 'valid', payload: makePayload({ jti: 'jti-3' }) });
      mockRequestKey.mockResolvedValue({
        key: 'DSCRB-new',
        ent: { themes: nowS() + 37 * DAY_S },
        name: 'Aaron P.',
        expiresAt: 'whenever',
      });

      const store = makeStore();
      await store.dispatch(initializeSupporter());

      expect(store.getState().supporter.keyStatus).toBe('valid');
    });

    it('relocks on the 410 "access ended" answer and re-checks next open', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-old';
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });
      mockRequestKey.mockRejectedValue(new MockClaimError('Your supporter access has ended', 410));

      const store = makeStore();
      await store.dispatch(initializeSupporter());

      const state = store.getState().supporter;
      expect(state.keyStatus).toBe('expired');
      expect(state.payload?.name).toBe('Aaron P.');
      expect(state.lastRefreshAt).toBeNull();
      expect(stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY]).toBeUndefined();
      // The key itself stays so Refresh works after a renewal.
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-old');
      expect(selectIsSupporter(rootState(store))).toBe(false);
    });

    it('fails open onto the old verification when the check-in fails (offline)', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-old';
      mockVerify.mockResolvedValue({
        status: 'valid',
        payload: makePayload({ exp: nowS() + 2 * DAY_S }),
      });
      mockRequestKey.mockRejectedValue(new MockClaimError('offline', null));

      const store = makeStore();
      await store.dispatch(initializeSupporter());

      expect(store.getState().supporter.keyStatus).toBe('valid');
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-old');
      expect(stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY]).toBeUndefined();
    });

    it('scrubs a leftover pre-release claim email on boot', async () => {
      stateData[SUPPORTER_EMAIL_STORAGE_KEY] = 'user@example.com';

      await makeStore().dispatch(initializeSupporter());

      expect(stateData[SUPPORTER_EMAIL_STORAGE_KEY]).toBeUndefined();
    });

    it('does not check in within a day of the last check, or when revoked', async () => {
      const cases: Array<{ lastRefreshAt?: number; status: 'valid' | 'revoked' }> = [
        { lastRefreshAt: Date.now() - 60_000, status: 'valid' },
        { status: 'revoked' },
      ];
      for (const c of cases) {
        for (const key of Object.keys(stateData)) delete stateData[key];
        mockRequestKey.mockClear();
        stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-old';
        if (c.lastRefreshAt) stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY] = c.lastRefreshAt;
        mockVerify.mockResolvedValue({ status: c.status, payload: makePayload() });

        await makeStore().dispatch(initializeSupporter());
        expect(mockRequestKey).not.toHaveBeenCalled();
      }
    });

    it('never contacts the server for an unverifiable stored key', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'garbage';
      mockVerify.mockResolvedValue({ status: 'invalid' });
      await makeStore().dispatch(initializeSupporter());
      expect(mockRequestKey).not.toHaveBeenCalled();
    });

    it('per-feature selectors follow the entitlement map, not the overall status', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-key';
      stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY] = Date.now();
      // Themes lapsed, hosted still running: the key is valid overall.
      mockVerify.mockResolvedValue({
        status: 'valid',
        payload: makePayload({ ent: { themes: nowS() - 10 * DAY_S, hosted: nowS() + 100 * DAY_S }, exp: nowS() + 100 * DAY_S }),
      });
      const store = makeStore();
      await store.dispatch(initializeSupporter());
      expect(selectIsSupporter(rootState(store))).toBe(true);
      expect(selectHasThemes(rootState(store))).toBe(false);
      expect(selectHasHosted(rootState(store))).toBe(true);
    });
  });

  describe('refreshSupporterKey', () => {
    it('presents the stored key for a fresh one', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-current';
      mockRequestKey.mockResolvedValue({
        key: 'DSCRB-fresh',
        ent: { themes: nowS() + 37 * DAY_S },
        name: 'Aaron P.',
        expiresAt: 'whenever',
      });
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload({ jti: 'jti-9' }) });

      const store = makeStore();
      await store.dispatch(refreshSupporterKey());

      expect(mockRequestKey).toHaveBeenCalledWith('DSCRB-current');
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-fresh');
      expect(store.getState().supporter.payload?.jti).toBe('jti-9');
      expect(store.getState().supporter.lastRefreshAt).not.toBeNull();
    });

    it('surfaces the server error message on a refused refresh', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-current';
      mockRequestKey.mockRejectedValue(
        new MockClaimError('That key does not match an active supporter membership', 404),
      );

      const store = makeStore();
      await store.dispatch(refreshSupporterKey());

      expect(store.getState().supporter.claimError).toBe(
        'That key does not match an active supporter membership',
      );
    });

    it('errors cleanly when no key is stored', async () => {
      const store = makeStore();
      await store.dispatch(refreshSupporterKey());

      expect(store.getState().supporter.claimError).toContain('No key to refresh');
      expect(mockRequestKey).not.toHaveBeenCalled();
    });
  });

  describe('applyPastedSupporterKey', () => {
    it('stores a valid pasted key without an email', async () => {
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('  DSCRB-pasted  '));

      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-pasted');
      expect(store.getState().supporter.keyStatus).toBe('valid');
    });

    it.each([
      ['invalid', "doesn't look like a valid"],
      ['expired', 'expired'],
      ['revoked', 'no longer active'],
    ])('rejects a %s key with matching copy', async (status, copy) => {
      mockVerify.mockResolvedValue({ status, payload: makePayload() });

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('DSCRB-bad'));

      expect(store.getState().supporter.claimError).toContain(copy);
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBeUndefined();
    });

    it('redeems the short key form for the full key and stores THE KEY', async () => {
      mockRedeemCode.mockResolvedValue({
        key: 'DSCRB-full.key',
        ent: { themes: null },
        name: 'Aaron P.',
        expiresAt: null,
      });
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('  dscrb aaaa 2222  '));

      expect(mockRedeemCode).toHaveBeenCalledWith('DSCRB-AAAA-2222');
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-full.key');
      expect(store.getState().supporter.keyStatus).toBe('valid');
    });

    it('surfaces the server error copy when a short key is refused', async () => {
      mockRedeemCode.mockRejectedValue(
        new MockClaimError('That key does not match an active supporter key', 404),
      );

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('DSCRB-AAAA-2222'));

      expect(store.getState().supporter.claimError).toBe(
        'That key does not match an active supporter key',
      );
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBeUndefined();
    });

    it('rejects when the redeemed key does not verify locally', async () => {
      mockRedeemCode.mockResolvedValue({
        key: 'DSCRB-full.key',
        ent: { themes: null },
        name: 'Aaron P.',
        expiresAt: null,
      });
      mockVerify.mockResolvedValue({ status: 'invalid' });

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('DSCRB-AAAA-2222'));

      expect(store.getState().supporter.claimError).toContain('Update Discrub');
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBeUndefined();
    });

    it('uses generic copy when redemption fails without a claim error', async () => {
      mockRedeemCode.mockRejectedValue(new Error('boom'));

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('DSCRB-AAAA-2222'));

      expect(store.getState().supporter.claimError).toContain(
        'applying your key',
      );
    });

    it('never calls the redeem endpoint for a full key paste', async () => {
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });

      const store = makeStore();
      await store.dispatch(applyPastedSupporterKey('DSCRB-payload.signature'));

      expect(mockRedeemCode).not.toHaveBeenCalled();
      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBe('DSCRB-payload.signature');
    });
  });

  describe('removeSupporterKey', () => {
    it('deletes the key (the auto-refresh off-switch)', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-key';
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });

      const store = makeStore();
      await store.dispatch(initializeSupporter());
      await store.dispatch(removeSupporterKey());

      expect(stateData[SUPPORTER_KEY_STORAGE_KEY]).toBeUndefined();
      expect(stateData[SUPPORTER_LAST_REFRESH_STORAGE_KEY]).toBeUndefined();
      const state = store.getState().supporter;
      expect(state.keyStatus).toBe('none');
      expect(state.payload).toBeNull();
      expect(state.lastRefreshAt).toBeNull();
      expect(selectSupporterKeyStatus(rootState(store))).toBe('none');
    });
  });

  describe('export footer preferences (slot F)', () => {
    it('loads stored footer preferences on init', async () => {
      stateData[FOOTER_TEXT_STORAGE_KEY] = 'My archive';
      stateData[FOOTER_REMOVED_STORAGE_KEY] = true;
      mediaData[FOOTER_ICON_MEDIA_KEY] = 'data:image/png;base64,abc';

      const store = makeStore();
      await store.dispatch(initializeSupporter());

      expect(store.getState().supporter.footer).toEqual({
        text: 'My archive',
        removed: true,
        iconDataUri: 'data:image/png;base64,abc',
      });
    });

    it('persists text and removed preferences', async () => {
      const store = makeStore();
      await store.dispatch(updateFooterPreferences({ text: '  My archive  ', removed: true }));

      expect(stateData[FOOTER_TEXT_STORAGE_KEY]).toBe('My archive');
      expect(stateData[FOOTER_REMOVED_STORAGE_KEY]).toBe(true);
      expect(store.getState().supporter.footer.text).toBe('My archive');
      expect(store.getState().supporter.footer.removed).toBe(true);
    });

    it('blank text clears the stored value back to the default', async () => {
      stateData[FOOTER_TEXT_STORAGE_KEY] = 'old';
      const store = makeStore();
      await store.dispatch(updateFooterPreferences({ text: '   ' }));

      expect(stateData[FOOTER_TEXT_STORAGE_KEY]).toBeUndefined();
      expect(store.getState().supporter.footer.text).toBeNull();
    });

    it('re-enabling the footer removes the stored flag', async () => {
      stateData[FOOTER_REMOVED_STORAGE_KEY] = true;
      const store = makeStore();
      await store.dispatch(updateFooterPreferences({ removed: false }));
      expect(stateData[FOOTER_REMOVED_STORAGE_KEY]).toBeUndefined();
    });

    it('stores and clears the custom icon in Discrub-media', async () => {
      const store = makeStore();
      await store.dispatch(setFooterIcon('data:image/png;base64,xyz'));
      expect(mediaData[FOOTER_ICON_MEDIA_KEY]).toBe('data:image/png;base64,xyz');
      expect(store.getState().supporter.footer.iconDataUri).toBe('data:image/png;base64,xyz');

      await store.dispatch(setFooterIcon(null));
      expect(mediaData[FOOTER_ICON_MEDIA_KEY]).toBeUndefined();
      expect(store.getState().supporter.footer.iconDataUri).toBeNull();
    });

    it('preferences survive removeSupporterKey (return on re-claim)', async () => {
      stateData[SUPPORTER_KEY_STORAGE_KEY] = 'DSCRB-key';
      stateData[FOOTER_TEXT_STORAGE_KEY] = 'My archive';
      mockVerify.mockResolvedValue({ status: 'valid', payload: makePayload() });

      const store = makeStore();
      await store.dispatch(initializeSupporter());
      await store.dispatch(removeSupporterKey());

      expect(stateData[FOOTER_TEXT_STORAGE_KEY]).toBe('My archive');
      expect(store.getState().supporter.footer.text).toBe('My archive');
    });
  });

  describe('gift attention + dialog', () => {
    it('marks the gift attention seen for this session only (nothing persisted)', () => {
      const store = makeStore();
      store.dispatch(markGiftAttentionSeen());
      expect(store.getState().supporter.giftAttentionSeen).toBe(true);
      // Deliberately NOT written to storage: the attention animation
      // re-arms on every app open until the user becomes a supporter.
      expect(stateData[GIFT_ATTENTION_SEEN_STORAGE_KEY]).toBeUndefined();
    });

    it('closing the dialog clears any claim error', async () => {
      mockVerify.mockResolvedValue({ status: 'invalid' });
      const store = makeStore();
      store.dispatch(setSupporterDialogOpen(true));
      await store.dispatch(applyPastedSupporterKey('DSCRB-bad'));
      expect(store.getState().supporter.claimError).toContain("doesn't look like");

      store.dispatch(setSupporterDialogOpen(false));
      expect(store.getState().supporter.dialogOpen).toBe(false);
      expect(store.getState().supporter.claimError).toBeNull();
    });
  });
  // 2.2.0 A13: a valid key that comes back expired raises a one-time notice.
  describe('access ended notice', () => {
    const valid = { keyStatus: 'valid' as const, payload: { v: 1, kid: 'k', jti: 'j', name: 'Aaron', eh: 'x', ent: { themes: null }, iat: 1, exp: null } as any, lastRefreshAt: 1 };
    it('is raised when a valid key becomes expired, and only then', () => {
      const store = makeStore();
      expect((store.getState().supporter.accessEndedNotice === true)).toBe(false);
      store.dispatch({ type: refreshSupporterKey.fulfilled.type, payload: { ...valid } });
      expect((store.getState().supporter.accessEndedNotice === true)).toBe(false);
      store.dispatch({ type: refreshSupporterKey.fulfilled.type, payload: { ...valid, keyStatus: 'expired' } });
      expect(store.getState().supporter.keyStatus).toBe('expired');
      expect((store.getState().supporter.accessEndedNotice === true)).toBe(true);
      store.dispatch(dismissAccessEndedNotice());
      expect((store.getState().supporter.accessEndedNotice === true)).toBe(false);
      // Already expired, still expired: quiet.
      store.dispatch({ type: refreshSupporterKey.fulfilled.type, payload: { ...valid, keyStatus: 'expired' } });
      expect((store.getState().supporter.accessEndedNotice === true)).toBe(false);
    });

    it('a fresh install that loads an expired key says nothing', () => {
      const store = makeStore();
      store.dispatch({ type: initializeSupporter.fulfilled.type, payload: { ...valid, keyStatus: 'expired', footer: store.getState().supporter.footer } });
      expect((store.getState().supporter.accessEndedNotice === true)).toBe(false);
    });
  });
});
