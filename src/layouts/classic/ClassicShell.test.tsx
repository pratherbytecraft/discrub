import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import ClassicShell from './ClassicShell';

const props = { sidebarOpen: false, onSidebarOpen: vi.fn(), onSidebarClose: vi.fn(), drawerOpen: false, onStartShellTour: vi.fn() };

describe('<ClassicShell />', () => {
  it('shows the top bar, the sidebar and the status panel at rest', () => {
    renderWithProviders(<ClassicShell {...props} focusedView={false} />, { preloadedState: createAuthenticatedState() });
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('[data-tour="status-panel"]')).not.toBeNull();
    expect(screen.queryByTestId('focus-pill')).toBeNull();
  });

  // 2.2.0 (A2): Focus hides navigation and the dock, keeps the top bar, shows the pill.
  it('in Focus keeps the top bar, hides the status panel and shows the pill', () => {
    const state = createAuthenticatedState();
    state.app = { ...state.app, focusedView: true };
    renderWithProviders(<ClassicShell {...props} focusedView />, { preloadedState: state });
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('[data-tour="status-panel"]')).toBeNull();
    expect(screen.getByTestId('focus-pill')).toHaveTextContent('Focus on');
  });
});
