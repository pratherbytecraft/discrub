import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockMessage } from '@/test/fixtures';
import { virtualizerMock } from '@/test/virtualizer-mock';
import { SortDirection } from 'discrub-core/common-enum';
import MessageTable from './MessageTable';

vi.mock('@tanstack/react-virtual', () => virtualizerMock);

const withMessages = () => {
  const messages = [createMockMessage({ id: 'm1', content: 'first' }), createMockMessage({ id: 'm2', content: 'second' })];
  const state = createAuthenticatedState();
  state.message = { ...state.message, messages, filteredMessages: messages };
  return state;
};

describe('<MessageTable />', () => {
  it('renders one row per message and toggles selection on click', () => {
    const { store } = renderWithProviders(<MessageTable />, { preloadedState: withMessages() });
    expect(screen.getAllByTestId('table-row')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('table-row')[0]);
    expect(store.getState().message.selectedMessages.map((m) => m.id)).toEqual(['m1']);
    fireEvent.click(screen.getAllByTestId('table-row')[0]);
    expect(store.getState().message.selectedMessages).toHaveLength(0);
  });

  it('selects and clears everything from the header checkbox', () => {
    const { store } = renderWithProviders(<MessageTable />, { preloadedState: withMessages() });
    fireEvent.click(screen.getByTestId('table-select-all').querySelector('input') as HTMLInputElement);
    expect(store.getState().message.selectedMessages).toHaveLength(2);
    fireEvent.click(screen.getByTestId('table-select-all').querySelector('input') as HTMLInputElement);
    expect(store.getState().message.selectedMessages).toHaveLength(0);
  });

  it('sorts by date from the column header', () => {
    const { store } = renderWithProviders(<MessageTable />, { preloadedState: withMessages() });
    const before = store.getState().message.order.order;
    fireEvent.click(screen.getByTestId('table-sort-date'));
    expect(store.getState().message.order.order).not.toBe(before);
    expect([SortDirection.ASCENDING, SortDirection.DESCENDING]).toContain(store.getState().message.order.order);
  });
});
