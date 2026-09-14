import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import FloatingPauseControl from './FloatingPauseControl';
import { initialAppState } from '@features/app/appTypes';
import { initialExportState } from '@features/export/exportTypes';

describe('FloatingPauseControl', () => {
  it('renders nothing when no heavy operation is running', () => {
    const { container } = renderWithProviders(<FloatingPauseControl />, {
      preloadedState: createBaseState(),
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing during a light operation (no empty floating shell)', () => {
    const { container } = renderWithProviders(<FloatingPauseControl />, {
      preloadedState: createBaseState({
        guild: {
          ...createBaseState().guild,
          isLoading: true,
        },
      }),
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders the pill with pause and cancel controls during a heavy operation', () => {
    renderWithProviders(<FloatingPauseControl />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.getByTestId('floating-pause-control')).toBeInTheDocument();
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.getByLabelText('Stop')).toBeInTheDocument();
  });

  it('clicking Pause pauses the operation and shows Resume', () => {
    const { store } = renderWithProviders(<FloatingPauseControl />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(store.getState().app.discrubPaused).toBe(true);
    expect(screen.getByLabelText('Resume')).toBeInTheDocument();
  });

  it('shows Resume while paused and clicking it resumes', () => {
    const { store } = renderWithProviders(<FloatingPauseControl />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
        app: { ...initialAppState, discrubPaused: true },
      }),
    });
    fireEvent.click(screen.getByLabelText('Resume'));
    expect(store.getState().app.discrubPaused).toBe(false);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('passes the heavy-tier operation label through to the controls', () => {
    renderWithProviders(<FloatingPauseControl />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.getByText('Exporting...')).toBeInTheDocument();
  });
});
