import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { defaultSettings } from '@features/app/storageKeys';
import SupporterWallToggle from './SupporterWallToggle';

const withSettings = () => {
  const state = createBaseState();
  state.app = { ...state.app, settings: { ...defaultSettings } };
  return state;
};

describe('<SupporterWallToggle />', () => {
  it('closes and reopens the supporter wall column by writing the setting', async () => {
    const { store } = renderWithProviders(<SupporterWallToggle />, { preloadedState: withSettings() });
    const button = screen.getByTestId('supporter-wall-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    await waitFor(() => expect(store.getState().app.settings?.appShowKoFiFeed).toBe('false'));
    expect(screen.getByTestId('supporter-wall-toggle')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('supporter-wall-toggle'));
    await waitFor(() => expect(store.getState().app.settings?.appShowKoFiFeed).toBe('true'));
  });
});
