import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import RestBreakBanner from './RestBreakBanner';
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

describe('RestBreakBanner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing while the run is going', () => {
    renderWithProviders(<RestBreakBanner />, {
      preloadedState: createBaseState({ export: { ...initialExportState, isExporting: true }, app: appState({}) }),
    });
    expect(screen.queryByTestId('rest-break-banner')).not.toBeInTheDocument();
  });

  it('names the run and the time left during a rest break, and Skip break resumes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const { store } = renderWithProviders(<RestBreakBanner />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: appState({ discrubPaused: true, restBreakUntil: Date.now() + 9 * 60 * 1000 + 32 * 1000 }),
      }),
    });
    expect(screen.getByTestId('rest-break-banner')).toHaveTextContent('Export is on a rest break, resumes in 9:32');
    expect(screen.getByTestId('rest-break-banner')).toHaveTextContent('rests 10 minutes after every 45 minutes');
    fireEvent.click(screen.getByTestId('rest-break-skip'));
    expect(store.getState().app.discrubPaused).toBe(false);
  });
});
