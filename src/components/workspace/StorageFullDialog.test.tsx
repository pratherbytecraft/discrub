import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState, messageStateWith } from '@/test/state-factories';
import { createMockChannel, createMockMessage } from '@/test/fixtures';
import { setDiscrubPaused, setOperationHold } from '@features/app/appSlice';
import StorageFullDialog from './StorageFullDialog';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn(() => ({})) }));

const loadAllState = () => {
  const base = createBaseState();
  const message = messageStateWith(base.message, [createMockMessage({ id: '2' }), createMockMessage({ id: '1' })]);
  return createBaseState({
    channel: { ...base.channel, selectedChannel: createMockChannel({ id: 'c1', name: 'general' }) },
    message: { ...base.message, ...message, pagination: { ...base.message.pagination, isLoadingAll: true } },
    workspace: { ...base.workspace, storage: { usage: 10e9, quota: 10e9, remaining: 0 } },
  });
};

describe('StorageFullDialog', () => {
  it('opens once when the hold appears, names the run and offers Stop and Workspaces', () => {
    const { store } = renderWithProviders(<StorageFullDialog />, { preloadedState: loadAllState() });
    expect(screen.queryByTestId('storage-full-dialog')).not.toBeInTheDocument();
    act(() => {
      store.dispatch(setDiscrubPaused(true));
      store.dispatch(setOperationHold({ kind: 'storageFull', loaded: 2 }));
    });
    expect(screen.getByText('Browser storage is full')).toBeInTheDocument();
    expect(screen.getByTestId('storage-full-line')).toHaveTextContent(
      'Load All is paused at 2 messages in #general. Clear room in Workspaces, then Resume from the status bar.',
    );
    expect(screen.getByTestId('storage-full-remaining')).toHaveTextContent('remaining');
    fireEvent.click(screen.getByTestId('storage-full-open-workspaces'));
    expect(store.getState().workspace.popoverOpen).toBe(true);
    // The hold stays for Resume on the status row.
    expect(store.getState().app.operationHold).toEqual({ kind: 'storageFull', loaded: 2 });
  });

  it('Stop cancels the run', () => {
    const { store } = renderWithProviders(<StorageFullDialog />, { preloadedState: loadAllState() });
    act(() => {
      store.dispatch(setDiscrubPaused(true));
      store.dispatch(setOperationHold({ kind: 'storageFull', loaded: 2 }));
    });
    fireEvent.click(screen.getByTestId('storage-full-stop'));
    expect(store.getState().app.discrubCancelled).toBe(true);
    expect(store.getState().app.discrubPaused).toBe(false);
  });
});
