import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, renderWithProviders } from '@/test/test-utils';
import SupporterPanel from './SupporterPanel';
import { createBaseState } from '@/test/state-factories';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import type { SupporterKeyPayload } from '@services/supporterKeyService';

const { stateStore, mediaStore, settingsStore } = vi.hoisted(() => {
  const makeAdapter = () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    getMany: vi.fn(async () => []),
    setMany: vi.fn(async () => {}),
  });
  return { stateStore: makeAdapter(), mediaStore: makeAdapter(), settingsStore: makeAdapter() };
});
vi.mock('@/extension/storage', () => ({
  storage: { state: stateStore, media: mediaStore, settings: settingsStore },
}));

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));
vi.mock('@services/supporterKeyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/supporterKeyService')>();
  return { ...actual, verifySupporterKey: mockVerify };
});

const { mockRequestRefresh, MockClaimError } = vi.hoisted(() => {
  class MockClaimError extends Error {
    status: number | null;
    constructor(message: string, status: number | null) {
      super(message);
      this.name = 'SupporterClaimError';
      this.status = status;
    }
  }
  return { mockRequestRefresh: vi.fn(), MockClaimError };
});
vi.mock('@services/supporterClaimService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@services/supporterClaimService')>();
  return {
    ...actual,
    // Pure input classifier — keep the real code/key routing.
    normalizeSupporterCode: actual.normalizeSupporterCode,
    requestSupporterKeyRefresh: mockRequestRefresh,
    requestSupporterKeyRedemption: vi.fn(),
    SupporterClaimError: MockClaimError,
  };
});

const DAY_S = 24 * 60 * 60;

const payload: SupporterKeyPayload = {
  v: 2,
  kid: '2026-2',
  jti: 'jti-1',
  name: 'Aaron P.',
  eh: 'hash',
  ent: { themes: Math.floor(Date.now() / 1000) + 30 * DAY_S },
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 30 * DAY_S,
};

const renderDialog = (supporterOverrides = {}) =>
  renderWithProviders(<SupporterPanel />, {
    preloadedState: createBaseState({
      supporter: { ...initialSupporterState, initialized: true, ...supporterOverrides },
    }) as never,
  });

describe('SupporterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-supporter state', () => {
    it('shows the pitch and the purchase grid, and leaves the theme grid to the Theme segment', () => {
      renderDialog();

      expect(screen.getByText(/growing pack of cosmetics/i)).toBeInTheDocument();

      expect(screen.queryByTestId('theme-card-auto')).toBeNull();

      // Two tiers, one Ko-fi button each; the period toggle swaps price + URL.
      expect(screen.getByTestId('supporter-kofi-themes-monthly')).toHaveAttribute(
        'href',
        'https://ko-fi.com/prathercc/tiers',
      );
      expect(screen.getByTestId('supporter-kofi-hosted-monthly')).toHaveAttribute(
        'href',
        'https://ko-fi.com/prathercc/tiers',
      );
      expect(screen.getByTestId('supporter-price-themes')).toHaveTextContent('$3');
      expect(screen.getByTestId('supporter-price-hosted')).toHaveTextContent('$5');
      expect(screen.queryByTestId('supporter-kofi-themes-yearly')).toBeNull();

      fireEvent.click(screen.getByTestId('supporter-period-yearly'));
      expect(screen.getByTestId('supporter-kofi-themes-yearly')).toHaveAttribute(
        'href',
        'https://ko-fi.com/s/0b4f9b2bdf',
      );
      expect(screen.getByTestId('supporter-kofi-hosted-yearly')).toHaveAttribute(
        'href',
        'https://ko-fi.com/s/3b0ad65948',
      );
      expect(screen.getByTestId('supporter-price-themes')).toHaveTextContent('$25');
      expect(screen.getByTestId('supporter-price-hosted')).toHaveTextContent('$40');
      expect(screen.queryByTestId('supporter-kofi-themes-monthly')).toBeNull();
      expect(screen.queryByText(/lifetime/i)).toBeNull();
    });

    it('discloses key delivery and the daily check-in, and never says "code"', () => {
      renderDialog();
      // The sender address is a mailto link for support questions.
      expect(screen.getByTestId('supporter-key-email-link')).toHaveAttribute(
        'href',
        'mailto:keys@pratherbytecraft.com',
      );
      expect(screen.getByText(/right after you join/i)).toBeInTheDocument();
      expect(screen.getByText(/about once a day/i)).toBeInTheDocument();
      expect(screen.getByTestId('supporter-panel').textContent?.toLowerCase()).not.toContain(
        'code',
      );
    });

    it('shows the export footer controls disabled with the real default line', () => {
      renderDialog();
      const controls = screen.getByTestId('supporter-footer-controls');
      expect(controls).toHaveAttribute('data-locked', 'true');
      expect(screen.getByTestId('supporter-footer-lock')).toBeInTheDocument();
      expect(screen.getByTestId('supporter-footer-text')).toBeDisabled();
      expect(screen.getByTestId('supporter-footer-text')).toHaveValue(
        'Exported with Discrub',
      );
      expect(screen.getByTestId('supporter-footer-enabled')).toBeDisabled();
      expect(screen.getByTestId('supporter-footer-enabled')).toBeChecked();
      expect(screen.getByTestId('supporter-footer-upload')).toBeDisabled();
    });

    it('disables Apply until a key is pasted, then unlocks', async () => {
      mockVerify.mockResolvedValue({ status: 'valid', payload });

      renderDialog();
      const apply = screen.getByTestId('supporter-paste-apply');
      expect(apply).toBeDisabled();

      fireEvent.change(screen.getByTestId('supporter-paste-key'), {
        target: { value: 'DSCRB-pasted' },
      });
      expect(apply).not.toBeDisabled();
      fireEvent.click(apply);

      await waitFor(() => {
        expect(screen.getByTestId('supporter-status')).toBeInTheDocument();
      });
      expect(screen.getByText(/issued to Aaron P\./i)).toBeInTheDocument();
    });

    it('shows matching copy for an invalid pasted key', async () => {
      mockVerify.mockResolvedValue({ status: 'invalid' });

      renderDialog();
      fireEvent.change(screen.getByTestId('supporter-paste-key'), {
        target: { value: 'DSCRB-bad' },
      });
      fireEvent.click(screen.getByTestId('supporter-paste-apply'));

      await waitFor(() => {
        expect(screen.getByTestId('supporter-claim-error')).toHaveTextContent(
          /doesn't look like a valid supporter key/,
        );
      });
    });

    it('shows the lapsed note when the stored key expired', () => {
      renderDialog({ keyStatus: 'expired', payload });
      expect(screen.getByTestId('supporter-lapsed-note')).toBeInTheDocument();
    });
  });

  describe('supporter state', () => {
    it('shows the access card with one row per feature', () => {
      renderDialog({ keyStatus: 'valid', payload, lastRefreshAt: Date.now() - 3 * 60 * 60 * 1000 });

      expect(screen.getByText(/issued to Aaron P\./i)).toBeInTheDocument();
      expect(screen.getByTestId('supporter-access-themes')).toHaveAttribute('data-live', 'true');
      expect(screen.getByTestId('supporter-access-themes')).toHaveTextContent(/Through/);
      expect(screen.getByTestId('supporter-access-hosted')).toHaveAttribute('data-live', 'false');
      expect(screen.getByTestId('supporter-access-hosted')).toHaveTextContent(/Not included/);
      expect(screen.getByTestId('supporter-get-hosted')).toHaveAttribute('href');
      expect(screen.getByTestId('supporter-checkin-note')).toHaveTextContent(/Checked 3 hours ago/);
      expect(screen.getByTestId('supporter-checkin-note')).toHaveTextContent(/Renews automatically/);
      expect(screen.getByTestId('supporter-refresh-key')).not.toBeDisabled();
      // No purchase grid for supporters.
      expect(screen.queryByTestId('supporter-purchase-grid')).toBeNull();
    });

    it('marks both rows live for a key carrying hosted access', () => {
      renderDialog({
        keyStatus: 'valid',
        payload: { ...payload, ent: { themes: null, hosted: payload.exp } },
      });
      expect(screen.getByTestId('supporter-access-themes')).toHaveTextContent(/Never expires/);
      expect(screen.getByTestId('supporter-access-hosted')).toHaveAttribute('data-live', 'true');
    });

    it('refreshes by presenting the stored key', async () => {
      stateStore.get.mockResolvedValue('DSCRB-current' as never);
      mockRequestRefresh.mockResolvedValue({
        key: 'DSCRB-fresh',
        ent: payload.ent,
        name: 'Aaron P.',
        expiresAt: 'whenever',
      });
      mockVerify.mockResolvedValue({ status: 'valid', payload: { ...payload, jti: 'jti-2' } });

      renderDialog({ keyStatus: 'valid', payload });
      fireEvent.click(screen.getByTestId('supporter-refresh-key'));

      await waitFor(() => {
        expect(mockRequestRefresh).toHaveBeenCalledWith('DSCRB-current');
      });
    });

    it('keeps Refresh for perpetual keys (a later purchase can still grow them)', () => {
      renderDialog({
        keyStatus: 'valid',
        payload: { ...payload, ent: { themes: null }, exp: null },
      });

      expect(screen.getByTestId('supporter-access-themes')).toHaveTextContent(/Never expires/);
      expect(screen.getByTestId('supporter-refresh-key')).toBeInTheDocument();
      expect(screen.getByTestId('supporter-checkin-note')).not.toHaveTextContent(/Renews automatically/);
    });

    it('shows footer controls with working text, toggle, and icon-clear actions', async () => {
      const { store } = renderDialog({
        keyStatus: 'valid',
        payload,
        footer: { text: null, removed: false, iconDataUri: 'data:image/png;base64,abc' },
      });

      expect(screen.getByTestId('supporter-footer-controls')).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('supporter-footer-text'), {
        target: { value: 'My archive' },
      });
      fireEvent.blur(screen.getByTestId('supporter-footer-text'));
      await waitFor(() => {
        expect(store.getState().supporter.footer.text).toBe('My archive');
      });

      fireEvent.click(screen.getByTestId('supporter-footer-enabled'));
      await waitFor(() => {
        expect(store.getState().supporter.footer.removed).toBe(true);
      });

      expect(screen.getByTestId('supporter-footer-icon-preview')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('supporter-footer-icon-remove'));
      await waitFor(() => {
        expect(store.getState().supporter.footer.iconDataUri).toBeNull();
      });
    });

    it('shows an error for a rejected icon upload (SVG)', async () => {
      renderDialog({ keyStatus: 'valid', payload });

      const input = screen.getByTestId('supporter-footer-icon-input');
      const svg = new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' });
      fireEvent.change(input, { target: { files: [svg] } });

      await waitFor(() => {
        expect(screen.getByTestId('supporter-footer-icon-error')).toHaveTextContent(
          /PNG, JPEG, or WebP/,
        );
      });
    });

    it('enables the footer controls only while the themes feature is live', () => {
      renderDialog({
        keyStatus: 'valid',
        payload: { ...payload, ent: { hosted: payload.exp } },
      });
      expect(screen.getByTestId('supporter-footer-controls')).toHaveAttribute('data-locked', 'true');
      expect(screen.getByTestId('supporter-footer-text')).toBeDisabled();
    });

    it('remove key clears supporter state back to the pitch', async () => {
      renderDialog({ keyStatus: 'valid', payload });

      fireEvent.click(screen.getByTestId('supporter-remove-key'));

      await waitFor(() => {
        expect(screen.queryByTestId('supporter-status')).not.toBeInTheDocument();
      });
      expect(stateStore.remove).toHaveBeenCalledTimes(3);
    });
  });


});
