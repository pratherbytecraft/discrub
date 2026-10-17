import { describe, it, expect, afterEach } from 'vitest';
import i18next from 'i18next';
import { renderWithProviders, screen } from '@/test/test-utils';
import PackageAnalytics from './PackageAnalytics';
import type { ParsedPackage } from '@features/package/packageTypes';
import { PACKAGE_CHANNEL_TYPE } from '@features/package/packageTypes';

function makeState(overrides?: Partial<ParsedPackage>): ParsedPackage {
  return {
    user: {
      id: 'u1',
      username: 'tester',
      globalName: 'Tester',
      avatarHash: null,
    },
    guilds: [{ id: 'g1', name: 'Guild A' }],
    channels: [
      {
        id: '200',
        type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
        name: 'general',
        guildId: 'g1',
        guildName: 'Guild A',
        messageCount: 120,
        isOrphan: false,
      },
      {
        id: '300',
        type: PACKAGE_CHANNEL_TYPE.DM,
        name: null,
        recipients: ['u1', 'other'],
        messageCount: 45,
        isOrphan: false,
      },
      {
        id: '400',
        type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
        name: null,
        messageCount: 8,
        isOrphan: true,
      },
    ],
    totalMessages: 173,
    packageSizeBytes: 1000,
    ...overrides,
  };
}

describe('<PackageAnalytics />', () => {
  afterEach(() => { i18next.changeLanguage('en'); });

  // Row 175 (pass 4): the card numbers follow the app language.
  it('prints the counts with the app language separators', () => {
    i18next.changeLanguage('de');
    const parsed = makeState();
    parsed.channels[0].messageCount = 1800;
    renderWithProviders(<PackageAnalytics />, {
      preloadedState: { package: { status: 'ready', parsed, validation: { ok: true, readOnly: false, warnings: [], errors: [] }, error: null, selectedChannelId: null, loadedChannels: {}, loadedOrder: [], loadingChannelId: null, timelineStatus: 'idle', timelineTimestamps: [], timelineProgress: null, timelineError: null, deleteStatus: 'idle', deleteProgress: null, deleteResult: null, deleteError: null, exportStatus: 'idle', exportError: null, deletedMessageIds: {}, goneMessageIds: {}, enrichmentStatus: {}, enrichmentProgress: {}, enrichedMessages: {}, enrichmentMisses: {}, enrichmentError: {}, enrichmentLastFetched: {}, activeEnrichmentChannelId: null } } as never,
    });
    expect(screen.getAllByText('1.800').length).toBeGreaterThan(0);
  });

  it('renders nothing when no package is loaded', () => {
    renderWithProviders(<PackageAnalytics />);
    expect(screen.queryByText(/Top channels/i)).not.toBeInTheDocument();
  });

  it('renders metadata-driven sections from parsed package', () => {
    renderWithProviders(<PackageAnalytics />, {
      preloadedState: {
        package: {
          status: 'ready',
          parsed: makeState(),
          validation: { ok: true, readOnly: false, warnings: [], errors: [] },
          error: null,
          selectedChannelId: null,
          loadedChannels: {},
          loadedOrder: [],
          loadingChannelId: null,
          timelineStatus: 'idle',
          timelineTimestamps: [],
          timelineProgress: null,
          timelineError: null,
          deleteStatus: 'idle',
          deleteProgress: null,
          deleteResult: null,
          deleteError: null,
          exportStatus: 'idle',
          exportError: null,
          deletedMessageIds: {},
          goneMessageIds: {},
      enrichmentStatus: {},
      enrichmentProgress: {},
      enrichedMessages: {},
      enrichmentMisses: {},
      enrichmentError: {},
      enrichmentLastFetched: {},
      activeEnrichmentChannelId: null,
        },
      } as never,
    });

    expect(screen.getByText(/Top channels by message count/i)).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText(/Messages by server/i)).toBeInTheDocument();
    expect(screen.getByText('Guild A')).toBeInTheDocument();
    expect(screen.getByText(/Channel types/i)).toBeInTheDocument();
  });

  it('shows "Load timeline" button when timeline status is idle', () => {
    renderWithProviders(<PackageAnalytics />, {
      preloadedState: {
        package: {
          status: 'ready',
          parsed: makeState(),
          validation: { ok: true, readOnly: false, warnings: [], errors: [] },
          error: null,
          selectedChannelId: null,
          loadedChannels: {},
          loadedOrder: [],
          loadingChannelId: null,
          timelineStatus: 'idle',
          timelineTimestamps: [],
          timelineProgress: null,
          timelineError: null,
          deleteStatus: 'idle',
          deleteProgress: null,
          deleteResult: null,
          deleteError: null,
          exportStatus: 'idle',
          exportError: null,
          deletedMessageIds: {},
          goneMessageIds: {},
      enrichmentStatus: {},
      enrichmentProgress: {},
      enrichedMessages: {},
      enrichmentMisses: {},
      enrichmentError: {},
      enrichmentLastFetched: {},
      activeEnrichmentChannelId: null,
        },
      } as never,
    });

    expect(screen.getByRole('button', { name: /load timeline/i })).toBeInTheDocument();
  });

  it('renders timeline charts when timeline is ready', () => {
    renderWithProviders(<PackageAnalytics />, {
      preloadedState: {
        package: {
          status: 'ready',
          parsed: makeState(),
          validation: { ok: true, readOnly: false, warnings: [], errors: [] },
          error: null,
          selectedChannelId: null,
          loadedChannels: {},
          loadedOrder: [],
          loadingChannelId: null,
          timelineStatus: 'ready',
          timelineTimestamps: [
            '2022-07-01 22:00:00.000000+00:00',
            '2022-07-15 22:00:00.000000+00:00',
            '2022-08-01 05:00:00.000000+00:00',
          ],
          timelineProgress: null,
          timelineError: null,
          deleteStatus: 'idle',
          deleteProgress: null,
          deleteResult: null,
          deleteError: null,
          exportStatus: 'idle',
          exportError: null,
          deletedMessageIds: {},
          goneMessageIds: {},
      enrichmentStatus: {},
      enrichmentProgress: {},
      enrichedMessages: {},
      enrichmentMisses: {},
      enrichmentError: {},
      enrichmentLastFetched: {},
      activeEnrichmentChannelId: null,
        },
      } as never,
    });

    expect(screen.getByText(/Monthly activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Activity by hour/i)).toBeInTheDocument();
    expect(screen.getByText(/peak month/i)).toBeInTheDocument();
  });
});
