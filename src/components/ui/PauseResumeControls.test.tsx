import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, act } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import PauseResumeControls from './PauseResumeControls';
import { initialExportState } from '@features/export/exportTypes';

describe('PauseResumeControls', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a ticking rest-break countdown while an automatic break holds the run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: {
          discrubPaused: true,
          discrubCancelled: false,
          restBreakUntil: Date.now() + 9 * 60 * 1000 + 32 * 1000,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings: null,
        },
      }),
    });
    expect(screen.getByTestId('operation-state-headline')).toHaveTextContent('Rest break, resumes in 9:32');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId('operation-state-headline')).toHaveTextContent('Rest break, resumes in 9:30');
    // Resume is what skips the break.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('renders nothing when no operation running', () => {
    const { container } = renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState(),
    });
    expect(container.firstChild).toBeNull();
  });

  it('shows Pause button when operation running and not paused', () => {
    renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: {
          discrubPaused: false,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings: null,
        },
      }),
    });
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('shows Resume button when paused', () => {
    renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: {
          discrubPaused: true,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings: null,
        },
      }),
    });
    expect(screen.getByLabelText('Resume')).toBeInTheDocument();
  });

  it('shows Stop button when operation running', () => {
    renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.getByLabelText('Stop')).toBeInTheDocument();
  });

  it('dispatches setDiscrubPaused(true) when Pause clicked', () => {
    const { store } = renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(store.getState().app.discrubPaused).toBe(true);
    expect(store.getState().status.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'warning', message: 'Operation Paused' })]),
    );
  });

  it('dispatches setDiscrubPaused(false) when Resume clicked', () => {
    const { store } = renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: {
          discrubPaused: true,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings: null,
        },
      }),
    });
    fireEvent.click(screen.getByLabelText('Resume'));
    expect(store.getState().app.discrubPaused).toBe(false);
    expect(store.getState().status.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'success', message: 'Operation Resumed' })]),
    );
  });

  it('dispatches cancel and clears pause when Cancel clicked', () => {
    const { store } = renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: {
          discrubPaused: true,
          discrubCancelled: false,
          isMinimized: false,
          focusedView: false,
          kofiOverlayOpen: false,
          sidebarView: 'server' as const,
          task: { status: 'idle', message: '' },
          settings: null,
        },
      }),
    });
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(store.getState().app.discrubCancelled).toBe(true);
    expect(store.getState().app.discrubPaused).toBe(false);
    expect(store.getState().status.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'warning', message: 'Operation Cancelled' })]),
    );
  });

  it('renders label when provided', () => {
    renderWithProviders(<PauseResumeControls label="Exporting (avatars)... 45%" />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.getByText('Exporting (avatars)... 45%')).toBeInTheDocument();
  });

  it('renders progress bar when progress provided', () => {
    renderWithProviders(<PauseResumeControls label="Exporting..." progress={60} />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('does not render label or progress bar when not provided', () => {
    renderWithProviders(<PauseResumeControls />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('remounts the label element on label change so the pulse animation re-fires', () => {
    const { rerender } = renderWithProviders(<PauseResumeControls label="Exporting (avatars)... 12 of 100" />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    const firstNode = screen.getByText('Exporting (avatars)... 12 of 100');
    rerender(<PauseResumeControls label="Exporting (avatars)... 13 of 100" />);
    const secondNode = screen.getByText('Exporting (avatars)... 13 of 100');
    expect(secondNode).not.toBe(firstNode);
  });
  // 2.2.0 item 2 (A4): one headline, one sentence and one colour per state.
  describe('operation states', () => {
    const running = () => createBaseState({ export: { ...initialExportState, isExporting: true } });

    it('names a rest break with its countdown and the reason', () => {
      const state = running();
      state.app = { ...state.app, discrubPaused: true, restBreakUntil: Date.now() + 271000 };
      renderWithProviders(<PauseResumeControls label="Exporting..." />, { preloadedState: state });
      expect(screen.getByTestId('operation-state')).toHaveAttribute('data-state', 'restBreak');
      expect(screen.getByTestId('operation-state-headline').textContent).toMatch(/^Rest break, resumes in 4:3\d$/);
      expect(screen.getByText(/Paused for 10 minutes after 45 minutes of activity/)).toBeInTheDocument();
      expect(screen.queryByText('Exporting...')).not.toBeInTheDocument();
    });

    it('names a retry wait with the attempt and offers Retry now, which clears the hold', () => {
      const state = running();
      state.app = { ...state.app, operationHold: { kind: 'retryWait', until: Date.now() + 4000, attempt: 2, max: 5, answer: 'Discord answered HTTP 502' } };
      const { store } = renderWithProviders(<PauseResumeControls label="Exporting..." />, { preloadedState: state });
      expect(screen.getByTestId('operation-state')).toHaveAttribute('data-state', 'retrying');
      expect(screen.getByTestId('operation-state-headline').textContent).toMatch(/^Retrying in \d s, attempt 2 of 5$/);
      expect(screen.getByText(/Discord answered HTTP 502\. Each retry waits twice as long, then Export pauses for you\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
      expect(store.getState().app.operationHold ?? null).toBeNull();
    });

    it('names a pause after five failed retries with the resume point', () => {
      const state = running();
      state.app = { ...state.app, discrubPaused: true, operationHold: { kind: 'retryExhausted', answer: 'Discord answered HTTP 502', loaded: 1250 } };
      renderWithProviders(<PauseResumeControls label="Paused · Exporting" />, { preloadedState: state });
      expect(screen.getByTestId('operation-state')).toHaveAttribute('data-state', 'retryPaused');
      expect(screen.getByTestId('operation-state-headline')).toHaveTextContent('Paused after 5 failed retries');
      expect(screen.getByText(/Wait a bit, then Resume to continue from 1,250 loaded\./)).toBeInTheDocument();
      expect(screen.getByLabelText('Resume')).toBeInTheDocument();
      expect(screen.getByLabelText('Stop')).toBeInTheDocument();
    });

    it('shows the plain label while simply running', () => {
      renderWithProviders(<PauseResumeControls label="Exporting..." />, { preloadedState: running() });
      expect(screen.queryByTestId('operation-state')).not.toBeInTheDocument();
      expect(screen.getByText('Exporting...')).toBeInTheDocument();
    });
  });
});
