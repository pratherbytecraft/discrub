import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { defaultSettings } from '@features/app/storageKeys';
import AppearanceButton from './AppearanceButton';
import PreviewBar from './PreviewBar';

const withSettings = () => {
  const state = createBaseState();
  state.app = { ...state.app, settings: { ...defaultSettings } };
  return state;
};

describe('<AppearanceButton />', () => {
  it('carries the current layout and theme as data and opens the menu', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    expect(screen.getByTestId('gift-button')).toHaveAttribute('data-layout', 'classic');
    expect(screen.getByTestId('gift-button')).toHaveAttribute('data-theme-name', 'Dark Original');
    expect(screen.getByTestId('gift-button')).toHaveTextContent('Appearance');
    expect(screen.queryByTestId('appearance-current-layout')).toBeNull();
    fireEvent.click(screen.getByLabelText('Appearance'));
    expect(await screen.findByTestId('appearance-popover')).toBeInTheDocument();
    expect(screen.getByTestId('layout-card-classic')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('appearance-hint')).toHaveTextContent('Click to apply. The eye previews a locked one.');
  });

  it('marks supporter layouts as locked without a key, and none as coming soon now that all six are built', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    await screen.findByTestId('appearance-popover');
    expect(screen.getByTestId('layout-card-native')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByLabelText('Native')).toBeInTheDocument();
    expect(screen.getByTestId('layout-card-timeline')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByLabelText('Timeline (supporter layout, locked)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/coming soon/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Simple (supporter layout, locked)')).toBeInTheDocument();
  });

  it('opens the Themes and Support hub from the footer and Display settings from the gear', async () => {
    const onOpenSettings = vi.fn();
    const { store } = renderWithProviders(<AppearanceButton onOpenSettings={onOpenSettings} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-open-hub'));
    expect(store.getState().supporter.dialogOpen).toBe(true);
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('shows the theme grid on the Theme tab and applies a pick', async () => {
    const { store } = renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-tab-theme'));
    expect(await screen.findByTestId('appearance-theme-grid')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Terminal'));
    expect(store.getState().app.settings?.appThemeMode).toBe('terminal');
  });

  it('shows a Current tag on the current layout card and an eye on locked cards only', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    expect(await screen.findByTestId('layout-card-classic')).toContainElement(screen.getByTestId('layout-current'));
    expect(screen.getByTestId('layout-current')).toHaveTextContent('Current');
    expect(screen.queryByTestId('layout-preview-native')).toBeNull();
    expect(screen.getByTestId('layout-preview-workbench')).toBeInTheDocument();
  });

  it('the eye starts a live preview, closes the menu, and the bar ends it', async () => {
    const { store } = renderWithProviders(<><AppearanceButton onOpenSettings={vi.fn()} /><PreviewBar /></>, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('layout-preview-workbench'));
    expect(store.getState().app.preview).toEqual({ layout: 'workbench', theme: null });
    await waitFor(() => expect(screen.queryByTestId('appearance-popover')).toBeNull());
    expect(screen.getByTestId('preview-bar')).toHaveTextContent('Previewing Workbench');
    expect(screen.queryByTestId('preview-apply')).toBeNull();
    fireEvent.click(screen.getByTestId('preview-end'));
    expect(store.getState().app.preview).toEqual({ layout: null, theme: null });
    expect(store.getState().app.settings?.appLayout ?? 'classic').toBe('classic');
  });

  it('a locked theme card opens the hub, its eye previews the theme', async () => {
    const { store } = renderWithProviders(<><AppearanceButton onOpenSettings={vi.fn()} /><PreviewBar /></>, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-tab-theme'));
    expect(screen.queryByTestId('theme-preview-terminal')).toBeNull();
    fireEvent.click(await screen.findByTestId('theme-preview-amoled-void'));
    expect(store.getState().app.preview?.theme).toBe('amoled-void');
    expect(screen.getByTestId('preview-bar')).toHaveTextContent('Previewing AMOLED Void');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().app.preview?.theme).toBeNull();

    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-tab-theme'));
    fireEvent.click(await screen.findByLabelText('AMOLED Void (supporter theme, locked)'));
    expect(store.getState().supporter.dialogOpen).toBe(true);
    expect(store.getState().app.settings?.appThemeMode).not.toBe('amoled-void');
  });
});
