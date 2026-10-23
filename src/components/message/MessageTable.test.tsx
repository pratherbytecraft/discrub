import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createAuthenticatedState, messageStateWith } from '@/test/state-factories';
import { createMockMessage } from '@/test/fixtures';
import { virtualizerMock } from '@/test/virtualizer-mock';
import { SortDirection } from 'discrub-core/common-enum';
import MessageTable from './MessageTable';

vi.mock('@tanstack/react-virtual', () => virtualizerMock);

const withMessages = () => {
  const messages = [createMockMessage({ id: 'm1', content: 'first' }), createMockMessage({ id: 'm2', content: 'second' })];
  const state = createAuthenticatedState();
  state.message = messageStateWith(state.message, messages);
  return state;
};

describe('<MessageTable />', () => {
  it('renders one row per message and toggles selection on click', () => {
    const { store } = renderWithProviders(<MessageTable />, { preloadedState: withMessages() });
    expect(screen.getAllByTestId('table-row')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('table-row')[0]);
    expect(store.getState().message.selectedIds).toEqual(['m1']);
    fireEvent.click(screen.getAllByTestId('table-row')[0]);
    expect(store.getState().message.selectedIds).toHaveLength(0);
  });

  it('selects and clears everything from the header checkbox', () => {
    const { store } = renderWithProviders(<MessageTable />, { preloadedState: withMessages() });
    fireEvent.click(screen.getByTestId('table-select-all').querySelector('input') as HTMLInputElement);
    expect(store.getState().message.selectedIds).toHaveLength(2);
    fireEvent.click(screen.getByTestId('table-select-all').querySelector('input') as HTMLInputElement);
    expect(store.getState().message.selectedIds).toHaveLength(0);
  });

  it('resolves mentions and custom emoji in the Message cell and keeps it to one line (wb-mention-cell)', () => {
    const messages = [
      createMockMessage({ id: 'm1', content: '<@1541>' }),
      createMockMessage({ id: 'm2', content: 'see <#345> and <@&777>\nsecond line <:wave:9>' }),
      createMockMessage({ id: 'm3', content: '<b>x</b> & y' }),
    ];
    const state = createAuthenticatedState();
    state.message = messageStateWith(state.message, messages);
    const formattingContext = { userMap: { '1541': { displayName: 'Prather Bytecraft' } }, channelMap: { '345': { name: 'general' } }, guildRoles: [{ id: '777', name: 'Admin' }] } as never;
    renderWithProviders(<MessageTable formattingContext={formattingContext} />, { preloadedState: state });
    const cells = screen.getAllByTestId('table-content').map((el) => el.innerHTML);
    expect(cells[0]).toBe('<span class="user-mention" data-user-id="1541" style="cursor: pointer;">@Prather Bytecraft</span>');
    expect(cells[1]).toBe('see <span class="channel-mention">#general</span> and <span class="role-mention">@Admin</span> second line <img src="https://cdn.discordapp.com/emojis/9.png?size=32" class="custom-emoji" alt=":wave:" title=":wave:">');
    expect(cells[2]).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(screen.queryByTestId('table-standin')).toBeNull();
  });

  it('a message with no text says what it holds: the embed title, a plain embed, or a sticker', () => {
    const messages = [
      createMockMessage({ id: 'e1', content: '', embeds: [{ title: 'Most attachments shared' }] as never }),
      createMockMessage({ id: 'e2', content: '', embeds: [{ description: 'all   channels\nAug 2' }] as never }),
      createMockMessage({ id: 'e3', content: '', embeds: [{ url: 'https://example.com' }] as never }),
      createMockMessage({ id: 's1', content: '', sticker_items: [{ id: '1', name: 'Wave', format_type: 1 }] as never }),
      createMockMessage({ id: 'c1', content: '', type: 3, call: { participants: ['1'], ended_timestamp: null } as never }),
      createMockMessage({ id: 't1', content: 'plain text' }),
    ];
    const state = createAuthenticatedState();
    state.message = messageStateWith(state.message, messages);
    renderWithProviders(<MessageTable />, { preloadedState: state });
    expect(screen.getAllByTestId('table-standin').map((el) => el.textContent)).toEqual(['Embed: Most attachments shared', 'Embed: all channels Aug 2', 'Embed', 'Sticker: Wave', expect.stringMatching(/call/i)]);
  });

  it('sorts by date from the column header', () => {
    const { store } = renderWithProviders(<MessageTable />, { preloadedState: withMessages() });
    const before = store.getState().message.order.order;
    fireEvent.click(screen.getByTestId('table-sort-date'));
    expect(store.getState().message.order.order).not.toBe(before);
    expect([SortDirection.ASCENDING, SortDirection.DESCENDING]).toContain(store.getState().message.order.order);
  });
});
