import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import MessageChunk, { chunkPropsAreEqual } from './MessageChunk';
import { createMockMessage } from '../../test/fixtures';

// Row 124: one row that throws must not take the chunk down.
vi.mock('./MessageFeedRow', () => ({
  default: ({ message }: { message: { id: string; content: string } }) => {
    if (message.id === 'bad') throw new Error('t.map is not a function');
    return <div data-testid={`row-${message.id}`}>{message.content}</div>;
  },
}));

// #263: one selection click must not re-render every visible chunk.
describe('chunkPropsAreEqual', () => {
  const a = createMockMessage({ id: 'a' });
  const b = createMockMessage({ id: 'b' });
  const base = {
    chunk: { key: 'a', authorId: 'u', firstTimestamp: a.timestamp, messages: [a, b] },
    selectedIds: new Set<string>(),
    formattingContext: {} as any,
    fullUserMap: {},
    cachedUserMap: {},
    guildId: null,
    guildRoles: null,
    settings: null,
    onToggleSelect: () => {},
    onAuthorClick: () => {},
    onMentionClick: () => {},
    onOpenAttachments: () => {},
    onOpenReactions: () => {},
  };

  it('is equal when a new Set has the same membership for this chunk', () => {
    expect(chunkPropsAreEqual(base, { ...base, selectedIds: new Set(['zzz']) })).toBe(true);
  });

  it('is not equal when one of the chunk messages changed selection', () => {
    expect(chunkPropsAreEqual(base, { ...base, selectedIds: new Set(['b']) })).toBe(false);
    const prev = { ...base, selectedIds: new Set(['a']) };
    expect(chunkPropsAreEqual(prev, { ...base, selectedIds: new Set() })).toBe(false);
  });

  it('still re-renders when any other prop changes', () => {
    expect(chunkPropsAreEqual(base, { ...base, highlightedMessageId: 'a' })).toBe(false);
    expect(chunkPropsAreEqual(base, { ...base, fullUserMap: {} })).toBe(false);
  });
});

describe('MessageChunk row boundary (row 124)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows a line in place of a row that cannot render and keeps the rows around it', () => {
    const good = createMockMessage({ id: 'good', content: 'fine' });
    const bad = createMockMessage({ id: 'bad', content: 'broken' });
    const after = createMockMessage({ id: 'after', content: 'also fine' });
    renderWithProviders(
      <MessageChunk
        chunk={{ key: 'k', authorId: 'u', firstTimestamp: good.timestamp, messages: [good, bad, after] }}
        selectedIds={new Set()}
        formattingContext={{} as any}
        fullUserMap={{}}
        cachedUserMap={{}}
        guildId={null}
        guildRoles={null}
        settings={null}
        onToggleSelect={() => {}}
        onAuthorClick={() => {}}
        onMentionClick={() => {}}
        onOpenAttachments={() => {}}
        onOpenReactions={() => {}}
      />,
    );
    expect(screen.getByTestId('row-good')).toHaveTextContent('fine');
    expect(screen.getByTestId('row-after')).toHaveTextContent('also fine');
    expect(screen.getByTestId('message-row-failed')).toHaveTextContent('This message could not be shown.');
  });
});
