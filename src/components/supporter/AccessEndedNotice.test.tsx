import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import AccessEndedNotice from './AccessEndedNotice';

describe('<AccessEndedNotice />', () => {
  it('renders nothing until a key lapses', () => {
    renderWithProviders(<AccessEndedNotice />, { preloadedState: createBaseState() });
    expect(screen.queryByTestId('access-ended-notice')).toBeNull();
  });

  it('names the fallback layout and theme, and closes', () => {
    const state = createBaseState();
    state.supporter = { ...state.supporter, accessEndedNotice: true };
    const { store } = renderWithProviders(<AccessEndedNotice />, { preloadedState: state });
    expect(screen.getByText('Your supporter access has ended.')).toBeInTheDocument();
    expect(screen.getByText(/Layout and theme are back to Classic and Dark Original\. Your settings are kept\./)).toBeInTheDocument();
    expect(screen.getByText('After renewing, open Appearance, pick Supporter and click Refresh.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(store.getState().supporter.accessEndedNotice).toBe(false);
    expect(screen.queryByTestId('access-ended-notice')).toBeNull();
  });
});
