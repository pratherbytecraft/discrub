import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor, act } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import StatusPanel from './StatusPanel';
import { initialStatusState } from '@features/status/statusTypes';
import { initialExportState } from '@features/export/exportTypes';
import { storage } from '@/extension/storage';
import { groupEntriesBySession } from '@features/status/statusGrouping';
import { addStatusEntry } from '@features/status/statusSlice';

// #183: transparent spy over the real grouping so memo-stability tests can
// count recomputations without changing behavior for the rest of the suite.
vi.mock('@features/status/statusGrouping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/status/statusGrouping')>();
  return {
    ...actual,
    groupEntriesBySession: vi.fn(actual.groupEntriesBySession),
  };
});

describe('StatusPanel', () => {
  it('renders with STATUS LOG header', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState(),
    });
    expect(screen.getByText('STATUS LOG')).toBeInTheDocument();
  });

  it('renders entries when panel is expanded', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Test message' },
            { id: '2', timestamp: Date.now(), level: 'error', message: 'Error occurred' },
          ],
        },
      }),
    });
    // Expand the panel
    fireEvent.click(screen.getByText('STATUS LOG'));
    // Legacy group is collapsed by default — expand it to see entries.
    fireEvent.click(screen.getByTestId('session-header-legacy'));
    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByText('Error occurred')).toBeInTheDocument();
  });

  it('shows entry count chip', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Test' },
            { id: '2', timestamp: Date.now(), level: 'info', message: 'Test 2' },
          ],
        },
      }),
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('clears log when clear button clicked', () => {
    const { store } = renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Test' },
          ],
        },
      }),
    });
    const clearBtn = screen.getByLabelText('Clear log');
    fireEvent.click(clearBtn);
    expect(store.getState().status.entries).toHaveLength(0);
  });

  it('shows empty state when no entries and expanded', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState(),
    });
    fireEvent.click(screen.getByText('STATUS LOG'));
    expect(screen.getByText('No status entries yet.')).toBeInTheDocument();
  });

  it('shows pause/resume controls when operation is running', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        export: { ...initialExportState, isExporting: true },
      }),
    });
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.getByLabelText('Stop')).toBeInTheDocument();
  });

  it('shows operation label and progress when exporting', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        export: {
          ...initialExportState,
          isExporting: true,
          exportProgress: { stage: 'avatars' as const, current: 5, total: 10 },
        },
      }),
    });
    expect(screen.getByText(/Exporting \(avatars\).*50%/)).toBeInTheDocument();
    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show controls when no operation is running', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState(),
    });
    expect(screen.queryByLabelText('Pause')).toBeNull();
    expect(screen.queryByLabelText('Stop')).toBeNull();
  });

  it('shows download log button when entries exist', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Test' },
          ],
        },
      }),
    });
    expect(screen.getByLabelText('Download log')).toBeInTheDocument();
  });

  it('shows level prefixes in terminal style', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Info msg' },
            { id: '2', timestamp: Date.now(), level: 'error', message: 'Error msg' },
            { id: '3', timestamp: Date.now(), level: 'success', message: 'Success msg' },
            { id: '4', timestamp: Date.now(), level: 'warning', message: 'Warning msg' },
            { id: '5', timestamp: Date.now(), level: 'session', message: 'Session msg' },
          ],
        },
      }),
    });
    fireEvent.click(screen.getByText('STATUS LOG'));
    fireEvent.click(screen.getByTestId('session-header-legacy'));
    expect(screen.getByText('[INFO]')).toBeInTheDocument();
    expect(screen.getByText('[ERR]')).toBeInTheDocument();
    expect(screen.getByText('[OK]')).toBeInTheDocument();
    expect(screen.getByText('[WARN]')).toBeInTheDocument();
    expect(screen.getByText('[SESSION]')).toBeInTheDocument();
  });

  it('shows "Scroll up for older entries" when entries exceed page size', () => {
    const manyEntries = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      timestamp: Date.now() - (80 - i) * 1000,
      level: 'info' as const,
      message: `Entry ${i}`,
    }));
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: manyEntries,
        },
      }),
    });
    fireEvent.click(screen.getByText('STATUS LOG'));
    expect(screen.getByText(/Scroll up for older entries/)).toBeInTheDocument();
  });

  it('shows only the latest 50 entries initially', () => {
    const manyEntries = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      timestamp: Date.now() - (80 - i) * 1000,
      level: 'info' as const,
      message: `Entry ${i}`,
    }));
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: manyEntries,
        },
      }),
    });
    fireEvent.click(screen.getByText('STATUS LOG'));
    fireEvent.click(screen.getByTestId('session-header-legacy'));
    expect(screen.getByText('Entry 79')).toBeInTheDocument();
    expect(screen.queryByText('Entry 0')).not.toBeInTheDocument();
  });

  it('does not show scroll hint when entries fit in one page', () => {
    const fewEntries = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      timestamp: Date.now(),
      level: 'info' as const,
      message: `Entry ${i}`,
    }));
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: fewEntries,
        },
      }),
    });
    fireEvent.click(screen.getByText('STATUS LOG'));
    expect(screen.queryByText(/Scroll up for older entries/)).not.toBeInTheDocument();
  });

  it('scrolls to bottom when panel is expanded', async () => {
    vi.useFakeTimers();

    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'First entry' },
            { id: '2', timestamp: Date.now(), level: 'info', message: 'Last entry' },
          ],
        },
      }),
    });

    // Expand the panel
    fireEvent.click(screen.getByText('STATUS LOG'));
    fireEvent.click(screen.getByTestId('session-header-legacy'));
    expect(screen.getByText('Last entry')).toBeInTheDocument();

    // Advance past the scroll delay (400ms for Collapse animation)
    vi.advanceTimersByTime(400);

    // The scroll container should have been scrolled to bottom
    // (scrollTop set to scrollHeight by our effect)

    vi.useRealTimers();
  });

  it('renders no entry rows while collapsed (#183 unmountOnExit)', () => {
    // MUI Collapse keeps children mounted by default; with the panel
    // collapsed, every addStatusEntry then re-rendered up to PAGE_SIZE
    // hidden terminal rows — the main-thread stall source during
    // high-rate operations (reactions purge logs each removal).
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Hidden while collapsed' },
          ],
        },
      }),
    });
    expect(screen.queryByText('Hidden while collapsed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-panel-scroll')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('STATUS LOG'));
    expect(screen.getByTestId('status-panel-scroll')).toBeInTheDocument();
  });

  it('toggles expand/collapse when clicking header', () => {
    renderWithProviders(<StatusPanel />, {
      preloadedState: createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: Date.now(), level: 'info', message: 'Test' },
          ],
        },
      }),
    });
    // Initially collapsed — expand button shows
    expect(screen.getByLabelText('Expand log')).toBeInTheDocument();

    // Expand
    fireEvent.click(screen.getByText('STATUS LOG'));
    fireEvent.click(screen.getByTestId('session-header-legacy'));
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByLabelText('Collapse log')).toBeInTheDocument();

    // Collapse — button changes back
    fireEvent.click(screen.getByText('STATUS LOG'));
    expect(screen.getByLabelText('Expand log')).toBeInTheDocument();
  });

  describe('session grouping (Backlog #126)', () => {
    const expand = () => fireEvent.click(screen.getByText('STATUS LOG'));

    it('renders entries with no sessionId under a collapsed "Earlier activity" group', () => {
      renderWithProviders(<StatusPanel />, {
        preloadedState: createBaseState({
          status: {
            ...initialStatusState,
            entries: [
              { id: '0', timestamp: 1000, level: 'info', message: 'legacy one' },
              { id: '1', timestamp: 2000, level: 'info', message: 'legacy two' },
            ],
          },
        }),
      });
      expand();
      // Header is visible but content is hidden until the user expands.
      expect(screen.getByText(/Earlier activity/)).toBeInTheDocument();
      expect(screen.queryByText('legacy one')).toBeNull();
      expect(screen.queryByText('legacy two')).toBeNull();
      // Expanding reveals the entries.
      fireEvent.click(screen.getByTestId('session-header-legacy'));
      expect(screen.getByText('legacy one')).toBeInTheDocument();
      expect(screen.getByText('legacy two')).toBeInTheDocument();
    });

    it('renders separate headers for distinct sessions', () => {
      renderWithProviders(<StatusPanel />, {
        preloadedState: createBaseState({
          status: {
            ...initialStatusState,
            entries: [
              { id: '0', timestamp: 1000, level: 'info', message: 'session A entry', sessionId: 'session-A' },
              { id: '1', timestamp: 2000, level: 'info', message: 'session B entry', sessionId: 'session-B' },
            ],
          },
        }),
      });
      expand();
      // Two session headers (one for A, one for B). Neither matches the
      // runtime current id so both render with "Session of …" labels.
      const headers = screen.getAllByText(/Session of /);
      expect(headers).toHaveLength(2);
    });

    it('collapses non-current, non-legacy sessions by default', () => {
      renderWithProviders(<StatusPanel />, {
        preloadedState: createBaseState({
          status: {
            ...initialStatusState,
            entries: [
              { id: '0', timestamp: 1000, level: 'info', message: 'old entry hidden by default', sessionId: 'old-session' },
            ],
          },
        }),
      });
      expand();
      expect(screen.getByText(/Session of /)).toBeInTheDocument();
      expect(screen.queryByText('old entry hidden by default')).toBeNull();
    });

    it('expands a collapsed session when its header is clicked', () => {
      renderWithProviders(<StatusPanel />, {
        preloadedState: createBaseState({
          status: {
            ...initialStatusState,
            entries: [
              { id: '0', timestamp: 1000, level: 'info', message: 'reveal me', sessionId: 'old-session' },
            ],
          },
        }),
      });
      expand();
      expect(screen.queryByText('reveal me')).toBeNull();
      fireEvent.click(screen.getByTestId('session-header-old-session'));
      expect(screen.getByText('reveal me')).toBeInTheDocument();
    });

    it('groups legacy entries above identified sessions; both are collapsed by default', () => {
      renderWithProviders(<StatusPanel />, {
        preloadedState: createBaseState({
          status: {
            ...initialStatusState,
            entries: [
              { id: '0', timestamp: 1000, level: 'info', message: 'pre-upgrade entry' },
              { id: '1', timestamp: 2000, level: 'info', message: 'post-upgrade entry', sessionId: 'session-A' },
            ],
          },
        }),
      });
      expand();
      // Both groups have headers visible but content hidden — neither
      // matches the runtime current sessionId, so neither auto-expands.
      expect(screen.getByText(/Earlier activity/)).toBeInTheDocument();
      expect(screen.getByText(/Session of /)).toBeInTheDocument();
      expect(screen.queryByText('pre-upgrade entry')).toBeNull();
      expect(screen.queryByText('post-upgrade entry')).toBeNull();
    });
  });

  describe('grouping memo stability (#183)', () => {
    const entriesState = () =>
      createBaseState({
        status: {
          ...initialStatusState,
          entries: [
            { id: '1', timestamp: 1000, level: 'info' as const, message: 'stable one' },
            { id: '2', timestamp: 2000, level: 'info' as const, message: 'stable two' },
          ],
        },
      });

    it('does not regroup on a re-render when entries and visibleCount are unchanged', () => {
      const { store } = renderWithProviders(<StatusPanel />, {
        preloadedState: entriesState(),
      });
      fireEvent.click(screen.getByText('STATUS LOG'));
      const callsAfterExpand = vi.mocked(groupEntriesBySession).mock.calls.length;
      expect(callsAfterExpand).toBeGreaterThan(0);

      // Unrelated store change that re-renders the panel: message.isDeleting
      // flips the operation summary (the exact render pressure a bulk delete
      // produces). Before the visibleEntries slice was memoized, every such
      // render rebuilt the slice identity and forced a full regroup.
      act(() => {
        store.dispatch({ type: 'message/deleteMessages/pending' });
      });

      expect(vi.mocked(groupEntriesBySession).mock.calls.length).toBe(callsAfterExpand);
    });

    it('regroups when a new status entry arrives', () => {
      const { store } = renderWithProviders(<StatusPanel />, {
        preloadedState: entriesState(),
      });
      fireEvent.click(screen.getByText('STATUS LOG'));
      const callsAfterExpand = vi.mocked(groupEntriesBySession).mock.calls.length;

      act(() => {
        store.dispatch(addStatusEntry({ level: 'info', message: 'fresh entry' }));
      });

      expect(vi.mocked(groupEntriesBySession).mock.calls.length).toBeGreaterThan(callsAfterExpand);
    });
  });

  describe('resizable height (Backlog #136)', () => {
    const HEIGHT_KEY = 'statusLogHeight';
    const DEFAULT_PANEL_HEIGHT = 150;

    beforeEach(async () => {
      await storage.state.clear();
      // jsdom defaults innerHeight to 768; ensure tests have predictable max.
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 768,
      });
    });

    it('renders the resize handle inside the expanded panel', () => {
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      expect(screen.getByTestId('status-panel-resize-handle')).toBeInTheDocument();
    });

    it('uses the default panel height when storage has no stored value', async () => {
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      const scroll = screen.getByTestId('status-panel-scroll');
      // Hydration runs in a useEffect; nothing in IDB → height stays at default.
      await waitFor(() =>
        expect(scroll.getAttribute('data-height')).toBe(String(DEFAULT_PANEL_HEIGHT)),
      );
    });

    it('hydrates the panel height from storage on mount', async () => {
      await storage.state.set(HEIGHT_KEY, 320);
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      const scroll = screen.getByTestId('status-panel-scroll');
      await waitFor(() =>
        expect(scroll.getAttribute('data-height')).toBe('320'),
      );
    });

    it('clamps an oversized stored height to the viewport on hydrate', async () => {
      // viewport - 80 = 688; a 9999 stored value should land at the clamp.
      await storage.state.set(HEIGHT_KEY, 9999);
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      const scroll = screen.getByTestId('status-panel-scroll');
      await waitFor(() =>
        expect(Number(scroll.getAttribute('data-height'))).toBe(768 - 80),
      );
    });

    it('ignores a stored value below the minimum panel height', async () => {
      await storage.state.set(HEIGHT_KEY, 50);
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      const scroll = screen.getByTestId('status-panel-scroll');
      // Still default — sub-minimum stored values are rejected on hydrate.
      await waitFor(() =>
        expect(scroll.getAttribute('data-height')).toBe(String(DEFAULT_PANEL_HEIGHT)),
      );
    });

    it('grows the panel when the user drags the handle upward and persists on release', async () => {
      const setSpy = vi.spyOn(storage.state, 'set');
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      const handle = screen.getByTestId('status-panel-resize-handle');
      const scroll = screen.getByTestId('status-panel-scroll');

      // Drag upward 100px → height grows from 150 to 250.
      fireEvent.mouseDown(handle, { clientY: 500 });
      fireEvent.mouseMove(document, { clientY: 400 });
      await waitFor(() => expect(scroll.getAttribute('data-height')).toBe('250'));

      fireEvent.mouseUp(document);
      expect(setSpy).toHaveBeenCalledWith(HEIGHT_KEY, 250);
      setSpy.mockRestore();
    });

    it('clamps to the minimum panel height when the user drags downward past the floor', async () => {
      const setSpy = vi.spyOn(storage.state, 'set');
      renderWithProviders(<StatusPanel />, { preloadedState: createBaseState() });
      // unmountOnExit (#183): panel internals only exist while expanded.
      fireEvent.click(screen.getByText('STATUS LOG'));
      const handle = screen.getByTestId('status-panel-resize-handle');
      const scroll = screen.getByTestId('status-panel-scroll');

      // Drag downward 999px from a starting height of 150 → would shrink
      // to -849 unclamped. Should land at PANEL_HEIGHT (150).
      fireEvent.mouseDown(handle, { clientY: 100 });
      fireEvent.mouseMove(document, { clientY: 1099 });
      await waitFor(() =>
        expect(scroll.getAttribute('data-height')).toBe(String(DEFAULT_PANEL_HEIGHT)),
      );

      fireEvent.mouseUp(document);
      expect(setSpy).toHaveBeenCalledWith(HEIGHT_KEY, DEFAULT_PANEL_HEIGHT);
      setSpy.mockRestore();
    });
  });
});
