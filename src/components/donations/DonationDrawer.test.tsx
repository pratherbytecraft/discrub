import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import DonationDrawer from './DonationDrawer';
import { createBaseState } from '../../test/state-factories';
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import type { Donation } from 'discrub-core/types/discrub-types';

const mockDonations: Donation[] = [
  { donorId: 'donor-alice', transactionId: 'tx-001', timestamp: '2026-02-28T00:00:00.000Z', type: 'Tip', fromName: 'Alice', message: 'Great work', amount: 10, currency: 'USD' },
  { donorId: 'donor-bob', transactionId: 'tx-002', timestamp: '2026-02-27T00:00:00.000Z', type: 'Tip', fromName: 'Bob', message: '', amount: 50, currency: 'USD' },
];

vi.mock('./useDonations', () => ({
  useDonations: () => ({ donations: mockDonations, isLoading: false }),
}));

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({})),
}));

vi.mock('@/extension/storage', () => {
  function makeAdapter() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      getMany: vi.fn().mockResolvedValue([]),
      setMany: vi.fn().mockResolvedValue(undefined),
      entries: vi.fn().mockResolvedValue([]),
    };
  }
  return {
    storage: {
      settings: makeAdapter(),
      state: makeAdapter(),
      presets: makeAdapter(),
      cache: makeAdapter(),
      history: makeAdapter(),
      statuslog: makeAdapter(),
      package: makeAdapter(),
      media: makeAdapter(),
    },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

function renderDrawer(showKofi: string = 'true') {
  const settings = {
    ...defaultSettings,
    [DiscrubSetting.APP_SHOW_KOFI_FEED]: showKofi,
  } as AppSettings;

  return renderWithProviders(<DonationDrawer />, {
    preloadedState: createBaseState({
      app: {
        discrubPaused: false,
        discrubCancelled: false,
        isMinimized: false,
        focusedView: false,
        kofiOverlayOpen: false,
        sidebarView: 'server' as const,
        task: { status: 'idle', message: '' },
        settings,
      },
    }),
  });
}

describe('DonationDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render three tabs', () => {
    renderDrawer('true');
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Top')).toBeInTheDocument();
    expect(screen.getByTestId('donation-tab-sky')).toBeInTheDocument();
  });

  it('shows the Supporter Constellation on the Sky tab, one star per donor', () => {
    renderDrawer('true');
    fireEvent.click(screen.getByTestId('donation-tab-sky'));
    expect(screen.getByTestId('supporter-sky')).toBeInTheDocument();
    // The fixture has two donors, so the sky holds two stars.
    expect(screen.getAllByTestId('sky-star')).toHaveLength(2);
    expect(screen.getByTestId('sky-expand')).toBeInTheDocument();
  });

  it('keeps the Sky tab in its new-star dress, visited or not', () => {
    renderDrawer('true');
    expect(screen.getByText('Sky ✦')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('donation-tab-sky'));
    // The spark is the tab's permanent style, not a one-time attention bid.
    expect(screen.getByText('Sky ✦')).toBeInTheDocument();
  });

  it('should render donation cards in feed view', () => {
    renderDrawer('true');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('should show footer with donation stats', () => {
    renderDrawer('true');
    expect(screen.getByText(/2 supporters have raised over \$60 to keep these tools free/)).toBeInTheDocument();
  });

  it('should show Ko-Fi support button', () => {
    renderDrawer('true');
    expect(screen.getByText('Support on Ko-Fi')).toBeInTheDocument();
  });

  it('should not show subscribers header in feed view when no monthly tips exist', () => {
    renderDrawer('true');
    expect(screen.queryByText('Monthly Subscribers')).not.toBeInTheDocument();
  });
});
