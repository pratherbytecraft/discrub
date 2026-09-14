import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '../../test/test-utils';
import BulkExportDialog from './BulkExportDialog';
import { createBaseState } from '../../test/state-factories';
import type { Channel } from 'discrub-core/types/discord-types';
import { ChannelType } from 'discrub-core/discord-enum';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({})),
}));

vi.mock('@services/exportService', () => ({
  getExportService: vi.fn(() => ({
    exportToZip: vi.fn().mockResolvedValue(undefined),
    exportMediaOnly: vi.fn().mockResolvedValue(undefined),
    setExportThemeSet: vi.fn(),
    getExportThemeSet: vi.fn(() => ({ defaultId: 'discord-dark', themes: [] })),
  })),
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

const mockChannels: Channel[] = [
  { id: 'ch1', name: 'general', type: ChannelType.GUILD_TEXT } as Channel,
  { id: 'ch2', name: 'random', type: ChannelType.GUILD_TEXT } as Channel,
  { id: 'ch3', name: 'announcements', type: ChannelType.GUILD_ANNOUNCEMENT } as Channel,
];

const mockDms: Channel[] = [
  { id: 'dm1', name: null, type: 1, recipients: [{ id: 'u1', username: 'Alice', discriminator: '0001', avatar: null }] } as unknown as Channel,
  { id: 'dm2', name: null, type: 1, recipients: [{ id: 'u2', username: 'Bob', discriminator: '0002', avatar: null }] } as unknown as Channel,
];

describe('BulkExportDialog', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Channel mode', () => {
    it('should render dialog with channel count chip', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Bulk Export Channels')).toBeInTheDocument();
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('should list all selected channels in the pill summary', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      // SelectedChannelsPill shows the first 3 names inline in the
      // collapsed state — enough to verify the pill rendered them.
      expect(screen.getByText(/# general.*# random.*# announcements/)).toBeInTheDocument();
    });

    it('should show export button with channel count', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Export 3 Channels')).toBeInTheDocument();
    });

    it('should show three accordion sections', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Format & Output')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Files & Media')).toBeInTheDocument();
    });

    it('shows Narrow-messages section with Add filters button (#112)', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText(/Narrow messages/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add filters' })).toBeInTheDocument();
    });

    it('confirm stays enabled even without filters (#112 — filters are optional for export)', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      // Empty filter state — export still runnable (unlike bulk purge
      // Messages mode, which requires a target author via filters).
      expect(screen.getByRole('button', { name: /Export 3 Channels/ })).not.toBeDisabled();
    });

    it('should show format options', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('HTML')).toBeInTheDocument();
      expect(screen.getByText('CSV')).toBeInTheDocument();
      expect(screen.getByText('JSON')).toBeInTheDocument();
      expect(screen.getByText('Media Only')).toBeInTheDocument();
    });
  });

  describe('DM mode', () => {
    it('should render dialog with DM count', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockDms} mode="dms" onClose={mockOnClose} />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Bulk Export DMs')).toBeInTheDocument();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('should list DM recipient names', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockDms} mode="dms" onClose={mockOnClose} />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('should show export button with DM count', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockDms} mode="dms" onClose={mockOnClose} />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Export 2 DMs')).toBeInTheDocument();
    });
  });

  describe('Config options', () => {
    it('should disable messages per page when Media Only format selected', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      const input = screen.getByLabelText('Messages per page');
      expect(input).not.toBeDisabled();

      fireEvent.click(screen.getByText('Media Only'));
      expect(input).toBeDisabled();
    });

    it('should show media config checkboxes when include media is checked', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        {
          preloadedState: createBaseState({
            auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
            app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const, task: { status: 'idle', message: '' }, settings: null },
          }),
        }
      );
      // Default includeMedia is true, so Media accordion should auto-expand
      expect(screen.getByText('Media types to include:')).toBeInTheDocument();
      expect(screen.getByText('Images')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
      expect(screen.getByText('Audio')).toBeInTheDocument();
    });

    it('should have no media counts in bulk mode', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        {
          preloadedState: createBaseState({
            auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
            app: { discrubPaused: false, discrubCancelled: false, isMinimized: false, focusedView: false, kofiOverlayOpen: false, sidebarView: 'server' as const, task: { status: 'idle', message: '' }, settings: null },
          }),
        }
      );
      // No count/size text should be present
      expect(screen.queryByText(/files?,/)).not.toBeInTheDocument();
    });

    it('channel pill stays above accordion', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      // SelectedChannelsPill (shared with BulkPurgeDialog) + format accordion both visible
      expect(screen.getByRole('button', { name: 'Selected channels' })).toBeInTheDocument();
      expect(screen.getByText('Format & Output')).toBeInTheDocument();
    });
  });

  describe('Media settings restore', () => {
    it('should restore includeMedia from settings when switching away from Media Only', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        {
          preloadedState: createBaseState({
            auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
            app: {
              discrubPaused: false,
              discrubCancelled: false,
              isMinimized: false,
              focusedView: false,
              kofiOverlayOpen: false,
              sidebarView: 'server' as const,
              task: { status: 'idle', message: '' },
              settings: {
                [DiscrubSetting.EXPORT_DOWNLOAD_MEDIA]: 'false',
              },
            },
          } as any),
        }
      );

      // Expand Media accordion
      fireEvent.click(screen.getByText('Files & Media'));

      const mediaCheckbox = screen.getByLabelText('Download files for offline viewing (avatars, attachments, emojis)') as HTMLInputElement;
      expect(mediaCheckbox.checked).toBe(false);

      // Switch to Media Only — checkbox forced checked
      fireEvent.click(screen.getByText('Media Only'));
      expect(mediaCheckbox.checked).toBe(true);

      // Switch back to HTML — should restore to false from settings
      fireEvent.click(screen.getByText('HTML'));
      expect(mediaCheckbox.checked).toBe(false);
    });
  });

  describe('Operation Safety', () => {
    it('should disable export button when an operation is running', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        {
          preloadedState: createBaseState({
            auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false },
            purge: {
              isPurging: true,
              purgeProgress: null,
              purgeError: null,
            },
          } as any),
        }
      );
      expect(screen.getByRole('button', { name: /Export 3 Channels/ })).toBeDisabled();
    });
  });

  describe('Close behavior', () => {
    it('should call onClose when Cancel is clicked', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      fireEvent.click(screen.getByText('Cancel'));
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not render when open is false', () => {
      renderWithProviders(
        <BulkExportDialog open={false} channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.queryByText('Bulk Export Channels')).toBeNull();
    });
  });

  describe('Export behavior', () => {
    it('should call onClose immediately when export is clicked (fire-and-forget)', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      fireEvent.click(screen.getByText('Export 3 Channels'));
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Single channel/DM', () => {
    it('should show singular form for 1 channel', () => {
      renderWithProviders(
        <BulkExportDialog open channels={[mockChannels[0]]} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Export 1 Channel')).toBeInTheDocument();
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    it('should show singular form for 1 DM', () => {
      renderWithProviders(
        <BulkExportDialog open channels={[mockDms[0]]} mode="dms" onClose={mockOnClose} />,
        { preloadedState: createBaseState({ auth: { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false } }) }
      );
      expect(screen.getByText('Export 1 DM')).toBeInTheDocument();
    });
  });

  describe('Selected channels pill', () => {
    const authState = { token: 'test', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false };

    it('shows the first 3 channels inline in the pill summary', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: authState }) }
      );
      expect(screen.getByText(/# general.*# random.*# announcements/)).toBeInTheDocument();
    });

    it('shows the first 3 DM recipients inline in the pill summary', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockDms} mode="dms" onClose={mockOnClose} />,
        { preloadedState: createBaseState({ auth: authState }) }
      );
      expect(screen.getByText(/Alice.*Bob/)).toBeInTheDocument();
    });

    it('shows "+N more" suffix when more than 3 channels', () => {
      const manyChannels = Array.from({ length: 10 }, (_, i) => ({
        id: `ch-${i}`,
        name: `channel-${i}`,
        type: ChannelType.GUILD_TEXT,
      } as Channel));

      renderWithProviders(
        <BulkExportDialog open channels={manyChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: authState }) }
      );
      expect(screen.getByText(/\+7 more/)).toBeInTheDocument();
    });

    it('toggles aria-expanded when the pill is clicked', () => {
      const manyChannels = Array.from({ length: 10 }, (_, i) => ({
        id: `ch-${i}`,
        name: `channel-${i}`,
        type: ChannelType.GUILD_TEXT,
      } as Channel));

      renderWithProviders(
        <BulkExportDialog open channels={manyChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: authState }) }
      );

      const pill = screen.getByRole('button', { name: 'Selected channels' });
      expect(pill).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(pill);
      expect(pill).toHaveAttribute('aria-expanded', 'true');
    });

    it('does not show "+N more" when 3 or fewer channels', () => {
      renderWithProviders(
        <BulkExportDialog open channels={mockChannels} mode="channels" onClose={mockOnClose} guildId="g1" />,
        { preloadedState: createBaseState({ auth: authState }) }
      );
      expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    });
  });
});
