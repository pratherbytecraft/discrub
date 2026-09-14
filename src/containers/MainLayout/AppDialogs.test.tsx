import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { setDialogOpen } from '@features/app/appSlice';
import { setSupporterDialogOpen } from '@features/supporter/supporterSlice';
import { HotkeyProvider } from '@features/hotkeys/HotkeyProvider';
import AppDialogs from './AppDialogs';

describe('<AppDialogs />', () => {
  it('mounts Settings from the store flag and the Supporter hub from its slice', async () => {
    const { store } = renderWithProviders(<HotkeyProvider><AppDialogs /></HotkeyProvider>, { preloadedState: createBaseState() });
    expect(screen.queryByRole('dialog')).toBeNull();
    store.dispatch(setDialogOpen({ dialog: 'settings', open: true }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    store.dispatch(setDialogOpen({ dialog: 'settings', open: false }));
    store.dispatch(setSupporterDialogOpen(true));
    await waitFor(() => expect(screen.getByTestId('supporter-dialog')).toBeInTheDocument());
  });

  it('toggles Settings with the openSettings hotkey', () => {
    const { store } = renderWithProviders(<HotkeyProvider><AppDialogs /></HotkeyProvider>, { preloadedState: createBaseState() });
    fireEvent.keyDown(document, { key: ',', metaKey: true });
    expect(store.getState().app.dialogs?.settings).toBe(true);
    fireEvent.keyDown(document, { key: ',', metaKey: true });
    expect(store.getState().app.dialogs?.settings).toBe(false);
  });
});
