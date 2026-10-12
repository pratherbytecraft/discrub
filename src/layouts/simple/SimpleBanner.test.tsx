import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import SimpleBanner from './SimpleBanner';
import { initialExportState } from '@features/export/exportTypes';

const appState = (overrides: Record<string, unknown>) => ({
  discrubPaused: false,
  discrubCancelled: false,
  restBreakUntil: null,
  isMinimized: false,
  focusedView: false,
  kofiOverlayOpen: false,
  sidebarView: 'server' as const,
  task: { status: 'idle' as const, message: '' },
  settings: null,
  ...overrides,
});

describe('SimpleBanner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says the reader can keep reading while the run is going', () => {
    renderWithProviders(<SimpleBanner />, {
      preloadedState: createBaseState({ export: { ...initialExportState, isExporting: true }, app: appState({}) }),
    });
    expect(screen.getByTestId('simple-banner')).toHaveTextContent('You can keep reading');
    expect(screen.queryByTestId('rest-break-skip')).not.toBeInTheDocument();
  });

  it('carries the rest break itself: the reason replaces the Discord line and Skip break resumes', () => {
    // Pass 2, row 78: the Discord wait line is wrong during Discrub's own break.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const { store } = renderWithProviders(<SimpleBanner />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: appState({ discrubPaused: true, restBreakUntil: Date.now() + 9 * 60 * 1000 + 32 * 1000 }),
      }),
    });
    const card = screen.getByTestId('simple-banner');
    expect(card).toHaveTextContent('Resumes in 9:32');
    expect(card).toHaveTextContent('pauses for 10 minutes after every 45 minutes');
    expect(card).not.toHaveTextContent('Discord may ask us to wait');
    fireEvent.click(screen.getByTestId('rest-break-skip'));
    expect(store.getState().app.discrubPaused).toBe(false);
  });
});
