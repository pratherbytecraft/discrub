import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { defaultSettings } from '@features/app/storageKeys';
import AppearanceButton from './AppearanceButton';
import LayoutPreviewBar from './LayoutPreviewBar';

const withSettings = () => {
  const state = createBaseState();
  state.app = { ...state.app, settings: { ...defaultSettings } };
  return state;
};

describe('<AppearanceButton />', () => {
  it('names the current layout and theme and opens the menu', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    expect(screen.getByTestId('appearance-current-layout')).toHaveTextContent('Classic');
    expect(screen.getByTestId('appearance-current-theme')).toHaveTextContent('Dark Original');
    fireEvent.click(screen.getByLabelText('Appearance'));
    expect(await screen.findByTestId('appearance-popover')).toBeInTheDocument();
    expect(screen.getByTestId('layout-card-classic')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('appearance-hint')).toHaveTextContent('Hover to preview. Click to apply.');
  });

  it('marks supporter layouts as locked without a key, and unbuilt ones as coming soon', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    await screen.findByTestId('appearance-popover');
    expect(screen.getByTestId('layout-card-native')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByLabelText('Native')).toBeInTheDocument();
    expect(screen.getByTestId('layout-card-timeline')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('Timeline (coming soon)')).toBeInTheDocument();
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

  it('starts a layout preview from the eye, closes the menu, and the bar can stop it', async () => {
    const { store } = renderWithProviders(<><AppearanceButton onOpenSettings={vi.fn()} /><LayoutPreviewBar /></>, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('layout-preview-native'));
    expect(store.getState().app.previewLayout).toBe('native');
    await waitFor(() => expect(screen.queryByTestId('appearance-popover')).toBeNull());
    expect(screen.getByTestId('layout-preview-bar')).toHaveTextContent('Previewing Native');
    fireEvent.click(screen.getByTestId('layout-preview-stop'));
    expect(store.getState().app.previewLayout ?? null).toBeNull();
  });
});
