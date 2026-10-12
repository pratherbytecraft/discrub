import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, within } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import NativeHead from './NativeHead';

vi.mock('@components/scrublings/ScrublingsStage', () => ({ default: () => null }));

describe('<NativeHead /> Workspaces pill (pass 3, row 167)', () => {
  const base = { inspectorOpen: false, canToggleInspector: false, onToggleInspector: vi.fn(), onMenu: vi.fn() };

  it('holds the pill in the head row on a phone, where the column is a drawer', () => {
    renderWithProviders(<NativeHead {...base} showMenu />, { preloadedState: createAuthenticatedState() });
    expect(within(screen.getByTestId('native-head')).getByTestId('workspace-pill')).toBeInTheDocument();
  });

  it('leaves the pill to the column user row on a wider screen', () => {
    renderWithProviders(<NativeHead {...base} />, { preloadedState: createAuthenticatedState() });
    expect(screen.queryByTestId('workspace-pill')).toBeNull();
  });
});
