import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor, act } from '@/test/test-utils';
import { setSupporterPanelOpen } from '@features/supporter/supporterSlice';
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
    // No hint lines in the menu (owner, 2026-09-20).
    expect(screen.queryByTestId('appearance-hint')).toBeNull();
    // The segments are text only.
    expect(screen.getByTestId('appearance-tab-layout').querySelector('svg')).toBeNull();
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

  it('opens Display settings from the gear', async () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(<AppearanceButton onOpenSettings={onOpenSettings} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('holds supporter access in its fourth segment: plans, the key box and the export footer', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-tab-supporter'));
    expect(await screen.findByTestId('supporter-panel')).toBeInTheDocument();
    expect(screen.getByTestId('supporter-paste-key')).toBeInTheDocument();
    expect(screen.getByTestId('supporter-purchase-grid')).toBeInTheDocument();
    expect(screen.getByTestId('supporter-footer-controls')).toBeInTheDocument();
  });

  it('opens on the Supporter segment when the app asks for it, and clears the flag on close', async () => {
    const { store } = renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    act(() => { store.dispatch(setSupporterPanelOpen(true)); });
    expect(await screen.findByTestId('supporter-panel')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('appearance-popover'), { key: 'Escape' });
    await waitFor(() => expect(store.getState().supporter.panelOpen).toBe(false));
  });

  it('sends a locked layout pick to the Supporter segment', async () => {
    renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('layout-card-timeline'));
    expect(await screen.findByTestId('supporter-panel')).toBeInTheDocument();
  });

  it('keeps the animations toggle and the commission link with the themes', async () => {
    const { store } = renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: withSettings() });
    fireEvent.click(screen.getByLabelText('Appearance'));
    fireEvent.click(await screen.findByTestId('appearance-tab-theme'));
    expect(await screen.findByTestId('supporter-commission-note')).toHaveTextContent('Want a theme of your own?');
    expect(screen.getByRole('link', { name: 'Commission one on Ko-fi' })).toHaveAttribute('href', 'https://ko-fi.com/prathercc/commissions');
    const toggle = screen.getByTestId('theme-animations-toggle');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(store.getState().app.settings?.appThemeAnimations).toBe('false'));
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

  it('a locked theme card goes to the Supporter segment, its eye previews the theme', async () => {
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
    expect(await screen.findByTestId('supporter-panel')).toBeInTheDocument();
    expect(store.getState().app.settings?.appThemeMode).not.toBe('amoled-void');
  });
});
