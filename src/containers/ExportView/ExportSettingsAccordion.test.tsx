import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders, screen, fireEvent, within } from '@/test/test-utils';
import ExportSettingsAccordion from './ExportSettingsAccordion';
import { initialExportState } from '@features/export/exportTypes';

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
      settings: makeAdapter(), state: makeAdapter(), presets: makeAdapter(),
      cache: makeAdapter(), history: makeAdapter(), statuslog: makeAdapter(),
      package: makeAdapter(), media: makeAdapter(),
    },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

describe('ExportSettingsAccordion — text format (#184)', () => {
  it('lists "Plain Text" as a selectable format option', () => {
    renderWithProviders(<ExportSettingsAccordion isBulk={false} />);
    expect(screen.getByText(/Plain Text - Human-readable .txt file/)).toBeInTheDocument();
  });

  it('lists the compact "Plain Text" label in bulk mode', () => {
    renderWithProviders(<ExportSettingsAccordion isBulk={true} />);
    const items = screen.getAllByText('Plain Text');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT render the text-format options block when format is HTML', () => {
    renderWithProviders(<ExportSettingsAccordion isBulk={false} />);
    expect(screen.queryByTestId('text-format-options')).toBeNull();
  });

  it('reveals the gated text-format options when text is selected', () => {
    renderWithProviders(<ExportSettingsAccordion isBulk={false} />, {
      preloadedState: {
        export: {
          ...initialExportState,
          exportFormat: 'text',
        },
      },
    });
    const panel = screen.getByTestId('text-format-options');
    expect(panel).toBeInTheDocument();
    // Each MUI Select renders the label twice (InputLabel + legend); use
    // getAllByText so the assertion stays robust to that duplication.
    expect(within(panel).getAllByText('Attachments').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText('Reactions').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText('Replies').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText('Bot tag').length).toBeGreaterThanOrEqual(1);
  });

  it('hides the text-format block when the user switches away from text', async () => {
    const { store } = renderWithProviders(<ExportSettingsAccordion isBulk={false} />, {
      preloadedState: {
        export: { ...initialExportState, exportFormat: 'text' },
      },
    });
    expect(screen.getByTestId('text-format-options')).toBeInTheDocument();
    const { setExportFormat } = await import('@features/export/exportSlice');
    act(() => {
      store.dispatch(setExportFormat('html'));
    });
    expect(screen.queryByTestId('text-format-options')).toBeNull();
  });

  it('does NOT render the HTML Template selector when text format is active', () => {
    renderWithProviders(<ExportSettingsAccordion isBulk={false} />, {
      preloadedState: {
        export: { ...initialExportState, exportFormat: 'text' },
      },
    });
    expect(screen.queryByText('Template')).toBeNull();
  });

  it('changing the Attachments selector dispatches setTextOptions and updates state', async () => {
    const { store } = renderWithProviders(<ExportSettingsAccordion isBulk={false} />, {
      preloadedState: {
        export: { ...initialExportState, exportFormat: 'text' },
      },
    });

    const panel = screen.getByTestId('text-format-options');
    // The MUI Select that controls attachments — open it and pick "Skip"
    const combobox = within(panel).getAllByRole('combobox')[0];
    fireEvent.mouseDown(combobox);
    const skipOption = await screen.findByRole('option', { name: 'Skip' });
    fireEvent.click(skipOption);

    expect(store.getState().export.textOptions.attachmentStyle).toBe('skip');
  });

  it('toggling Reactions to Skip preserves the other text options', async () => {
    const { store } = renderWithProviders(<ExportSettingsAccordion isBulk={false} />, {
      preloadedState: {
        export: { ...initialExportState, exportFormat: 'text' },
      },
    });

    const panel = screen.getByTestId('text-format-options');
    const reactionsCombobox = within(panel).getAllByRole('combobox')[1];
    fireEvent.mouseDown(reactionsCombobox);
    const skipOption = await screen.findByRole('option', { name: 'Skip' });
    fireEvent.click(skipOption);

    const t = store.getState().export.textOptions;
    expect(t.reactions).toBe('skip');
    expect(t.attachmentStyle).toBe('inline');
    expect(t.replies).toBe('quote');
    expect(t.botIndicator).toBe('include');
  });

  it('Max zip size defaults to 4 GB, offers no single zip, and switching dispatches the size (#207 Arm A)', async () => {
    const { store } = renderWithProviders(<ExportSettingsAccordion isBulk={false} />);
    expect(store.getState().export.maxZipPartBytes).toBe(4_000_000_000);

    // The select renders its current value as text; open it from there.
    fireEvent.mouseDown(screen.getByText('4 GB (recommended)'));
    const twoGb = await screen.findByRole('option', { name: '2 GB' });
    expect(screen.queryByRole('option', { name: /single zip/i })).toBeNull();
    fireEvent.click(twoGb);

    expect(store.getState().export.maxZipPartBytes).toBe(2_000_000_000);
  });

  it('shows the default size when older saved state still has the single zip choice', () => {
    renderWithProviders(<ExportSettingsAccordion isBulk={false} />, {
      preloadedState: { export: { ...initialExportState, maxZipPartBytes: null } },
    });
    expect(screen.getByText('4 GB (recommended)')).toBeInTheDocument();
  });
});
