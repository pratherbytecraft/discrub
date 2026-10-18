import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test/test-utils';
import { createBaseState } from '../../test/state-factories';
import { HotkeyProvider } from '@features/hotkeys/HotkeyProvider';
import OverlayControls from './OverlayControls';

const mockIsOverlayMode = vi.fn(() => false);
const mockCloseOverlay = vi.fn().mockResolvedValue(undefined);
const mockMinimizeOverlay = vi.fn().mockResolvedValue(undefined);

vi.mock('@/extension/messaging', () => ({
  isOverlayMode: () => mockIsOverlayMode(),
  closeOverlay: () => mockCloseOverlay(),
  minimizeOverlay: () => mockMinimizeOverlay(),
  isExtensionMode: () => false,
}));

const exportingState = () => createBaseState({
  export: {
    isExporting: true,
    signInExpired: false,
    exportCriteria: null,
    maxZipPartBytes: null,
    exportProgress: null,
    exportTotal: 0,
    currentPage: 0,
    totalPages: 0,
    exportError: null,
    exportFormat: 'html' as const,
    messagesPerPage: 100,
    separateThreads: false,
    includeMedia: true,
    mediaConfig: { images: true, videos: true, audio: true, other: true },
    artistMode: false,
    sortOrder: 'descending' as const,
    previewMedia: true,
    exportTemplate: 'discord',
    textOptions: { attachmentStyle: 'inline', reactions: 'include', replies: 'quote', botIndicator: 'include' },
  },
});

// overlay-close-2200: the 2.2.0 bars mount this, so the buttons and the M hotkey
// work in every layout, not only in the shared TopBar.
describe('OverlayControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOverlayMode.mockReturnValue(false);
  });

  it('renders nothing outside overlay mode', () => {
    const { container } = renderWithProviders(<OverlayControls />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText('Minimize Discrub')).toBeNull();
  });

  it('shows Minimize and Close in overlay mode and minimizes on click', async () => {
    mockIsOverlayMode.mockReturnValue(true);
    const { store } = renderWithProviders(<OverlayControls size="small" />);
    expect(screen.getByLabelText('Close Discrub')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Minimize Discrub'));
    expect(mockMinimizeOverlay).toHaveBeenCalled();
    await waitFor(() => expect(store.getState().app.isMinimized).toBe(true));
  });

  it('puts isMinimized back when the content script refuses', async () => {
    mockIsOverlayMode.mockReturnValue(true);
    mockMinimizeOverlay.mockRejectedValueOnce(new Error('fail'));
    const { store } = renderWithProviders(<OverlayControls />);
    fireEvent.click(screen.getByLabelText('Minimize Discrub'));
    await waitFor(() => expect(store.getState().app.isMinimized).toBe(false));
  });

  it('minimizes on the M hotkey', () => {
    mockIsOverlayMode.mockReturnValue(true);
    renderWithProviders(<HotkeyProvider><OverlayControls /></HotkeyProvider>);
    fireEvent.keyDown(document, { key: 'm' });
    expect(mockMinimizeOverlay).toHaveBeenCalled();
  });

  it('closes at once when nothing is running', () => {
    mockIsOverlayMode.mockReturnValue(true);
    renderWithProviders(<OverlayControls />);
    fireEvent.click(screen.getByLabelText('Close Discrub'));
    expect(mockCloseOverlay).toHaveBeenCalled();
    expect(screen.queryByText('Operation in Progress')).toBeNull();
  });

  it('asks first while an export runs, then closes on Close Anyway', () => {
    mockIsOverlayMode.mockReturnValue(true);
    renderWithProviders(<OverlayControls />, { preloadedState: exportingState() });
    fireEvent.click(screen.getByLabelText('Close Discrub'));
    expect(mockCloseOverlay).not.toHaveBeenCalled();
    expect(screen.getByText('Operation in Progress')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Anyway'));
    expect(mockCloseOverlay).toHaveBeenCalled();
  });
});
