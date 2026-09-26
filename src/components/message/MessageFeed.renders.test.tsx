import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { createMockMessage, createMockUser } from '@/test/fixtures';
import { virtualizerMock } from '@/test/virtualizer-mock';
import { appendLoadAllPage, messagesRemoved } from '@features/message/messageSlice';
import { SortDirection } from 'discrub-core/common-enum';
import MessageFeed from './MessageFeed';

vi.mock('@tanstack/react-virtual', () => virtualizerMock);

// Every render of a chunk lands its key here, so a test can say which
// chunks React actually drew after a store change.
const rendered: string[] = [];
vi.mock('./MessageChunk', async () => {
  const actual = await vi.importActual<typeof import('./MessageChunk')>('./MessageChunk');
  const { memo } = await import('react');
  const Counting = (props: React.ComponentProps<typeof actual.default>) => {
    rendered.push(props.chunk.key);
    return <div data-testid="message-chunk" data-key={props.chunk.key} />;
  };
  return { default: memo(Counting, actual.chunkPropsAreEqual), chunkPropsAreEqual: actual.chunkPropsAreEqual };
});

const alice = createMockUser({ id: 'alice', username: 'alice' });
const bob = createMockUser({ id: 'bob', username: 'bob' });
const carol = createMockUser({ id: 'carol', username: 'carol' });
const at = (minute: number) => new Date(Date.UTC(2026, 6, 17, 10, minute)).toISOString();
const m = (id: string, author: typeof alice, minute: number) => createMockMessage({ id, author, timestamp: at(minute) });

const baseProps = {
  formattingContext: { userMap: {}, channelMap: {}, guildRoles: [] } as any,
  fullUserMap: {},
  onOpenThread: vi.fn(),
  canManageMessages: true,
  currentUserId: 'user-123',
};

const stateWith = (messages: ReturnType<typeof createMockMessage>[]) =>
  createAuthenticatedState({
    message: {
      ...createAuthenticatedState().message,
      messages,
      filteredMessages: messages,
      order: { order: SortDirection.DESCENDING, orderBy: 'timestamp' },
    },
  });

describe('<MessageFeed /> chunk renders across store changes (2.2.1 perf)', () => {
  beforeEach(() => {
    rendered.length = 0;
  });

  it('draws only the new chunk when a Load All page is appended', () => {
    const messages = [m('a2', alice, 5), m('a1', alice, 4), m('b1', bob, 3)];
    const { store } = renderWithProviders(<MessageFeed {...baseProps} />, { preloadedState: stateWith(messages) });
    expect(rendered).toEqual(['a2', 'b1']);
    rendered.length = 0;

    act(() => {
      store.dispatch(appendLoadAllPage({ messages: [m('c1', carol, 1)] }));
    });
    // The two chunks that did not change kept their objects and their
    // memoised rows, so only the appended chunk rendered.
    expect(rendered).toEqual(['c1']);
  });

  it('redraws only the chunk a delete batch touched', () => {
    const messages = [m('a2', alice, 5), m('a1', alice, 4), m('b1', bob, 3), m('c1', carol, 1)];
    const { store } = renderWithProviders(<MessageFeed {...baseProps} />, { preloadedState: stateWith(messages) });
    rendered.length = 0;

    act(() => {
      store.dispatch(messagesRemoved({ ids: ['a1'], containerId: null }));
    });
    expect(rendered).toEqual(['a2']);
  });

  it('drops a chunk without redrawing its neighbours', () => {
    const messages = [m('a2', alice, 5), m('b1', bob, 3), m('c1', carol, 1)];
    const { store } = renderWithProviders(<MessageFeed {...baseProps} />, { preloadedState: stateWith(messages) });
    rendered.length = 0;

    act(() => {
      store.dispatch(messagesRemoved({ ids: ['b1'], containerId: null }));
    });
    expect(rendered).toEqual([]);
  });
});
