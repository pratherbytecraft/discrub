import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import ExportSummaryChip from './ExportSummaryChip';
import { initialExportState } from '@features/export/exportTypes';
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

describe('ExportSummaryChip', () => {
  function renderChip(exportOverrides: Record<string, any> = {}, settingsOverrides: Record<string, any> = {}) {
    return renderWithProviders(<ExportSummaryChip />, {
      preloadedState: {
        export: { ...initialExportState, ...exportOverrides },
        app: {
          discrubPaused: false,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          task: { status: 'idle', message: '' },
          settings: { ...defaultSettings, ...settingsOverrides },
        },
      } as any,
    });
  }

  it('shows format', () => {
    renderChip({ exportFormat: 'html' });
    expect(screen.getByText(/HTML/)).toBeInTheDocument();
  });

  it('shows messages per page', () => {
    renderChip({ messagesPerPage: 50 });
    expect(screen.getByText(/50\/page/)).toBeInTheDocument();
  });

  it('shows sort order', () => {
    renderChip({ sortOrder: 'ascending' });
    expect(screen.getByText(/Oldest first/)).toBeInTheDocument();
  });

  it('shows enabled media types', () => {
    renderChip({
      includeMedia: true,
      mediaConfig: { images: true, videos: false, audio: true, other: false },
    });
    expect(screen.getByText(/Media: Images, Audio/)).toBeInTheDocument();
  });

  it('shows "No media" when disabled', () => {
    renderChip({ includeMedia: false });
    expect(screen.getByText(/No media/)).toBeInTheDocument();
  });

  it('shows "Artist mode" when enabled', () => {
    renderChip({ artistMode: true, includeMedia: true });
    expect(screen.getByText(/Artist mode/)).toBeInTheDocument();
  });

  it('omits per page for Media Only', () => {
    renderChip({ exportFormat: 'media' });
    expect(screen.queryByText(/\/page/)).toBeNull();
  });

  it('names Other files when it is ticked and another type is not', () => {
    renderChip({
      includeMedia: true,
      mediaConfig: { images: false, videos: true, audio: true, other: true },
    });
    expect(screen.getByText(/Media: Videos, Audio, Other files/)).toBeInTheDocument();
  });

  it('lists the three types, not "All media", when Other files is unticked', () => {
    renderChip({
      includeMedia: true,
      mediaConfig: { images: true, videos: true, audio: true, other: false },
    });
    expect(screen.getByText(/Media: Images, Videos, Audio/)).toBeInTheDocument();
    expect(screen.queryByText(/All media/)).toBeNull();
  });

  it('shows "All media" when all enabled', () => {
    renderChip({
      includeMedia: true,
      mediaConfig: { images: true, videos: true, audio: true, other: true },
    });
    expect(screen.getByText(/All media/)).toBeInTheDocument();
  });

  it('shows "Separate threads" when enabled', () => {
    renderChip({ separateThreads: true });
    expect(screen.getByText(/Separate threads/)).toBeInTheDocument();
  });

  it('omits "Separate threads" when disabled', () => {
    renderChip({ separateThreads: false });
    expect(screen.queryByText(/Separate threads/)).toBeNull();
  });

  it('shows CSV when format is csv', () => {
    renderChip({ exportFormat: 'csv' });
    expect(screen.getByText(/CSV/)).toBeInTheDocument();
  });

  describe('Reaction info', () => {
    it('shows "Reactions: detailed" for HTML with reactions enabled', () => {
      renderChip(
        { exportFormat: 'html' },
        { [DiscrubSetting.REACTIONS_ENABLED]: 'true' },
      );
      expect(screen.getByText(/Reactions: detailed/)).toBeInTheDocument();
    });

    it('shows "Reactions: counts only" for HTML with reactions disabled', () => {
      renderChip(
        { exportFormat: 'html' },
        { [DiscrubSetting.REACTIONS_ENABLED]: 'false' },
      );
      expect(screen.getByText(/Reactions: counts only/)).toBeInTheDocument();
    });

    it('shows "Reactions: counts only" for CSV format', () => {
      renderChip(
        { exportFormat: 'csv' },
        { [DiscrubSetting.REACTIONS_ENABLED]: 'true' },
      );
      expect(screen.getByText(/Reactions: counts only/)).toBeInTheDocument();
    });

    it('shows "Reactions: counts only" for JSON format', () => {
      renderChip(
        { exportFormat: 'json' },
        { [DiscrubSetting.REACTIONS_ENABLED]: 'true' },
      );
      expect(screen.getByText(/Reactions: counts only/)).toBeInTheDocument();
    });

    it('omits reaction info for Media Only format', () => {
      renderChip({ exportFormat: 'media' });
      expect(screen.queryByText(/Reactions/)).toBeNull();
    });
  });
});
