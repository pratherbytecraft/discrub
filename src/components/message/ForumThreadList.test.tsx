/**
 * 2.2.10: the forum's posts carry tick boxes, and the list tells its owner
 * what an Export covers: the whole forum, or the ticked posts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { Channel } from 'discrub-core/types/discord-types';
import { renderWithProviders } from '@/test/test-utils';
import ForumThreadList, { type ForumExportSelection } from './ForumThreadList';

const forum = { id: 'f1', name: 'help', type: 15, available_tags: [{ id: 'tag-a', name: 'Bug' }] } as unknown as Channel;
const post = (n: number, tags: string[] = []) => ({ id: `90000000000000000${n}`, name: `post ${n}`, type: 11, parent_id: 'f1', applied_tags: tags }) as unknown as Channel;
const posts = [post(1, ['tag-a']), post(2), post(3)];

const onChange = vi.fn();
const last = (): ForumExportSelection => onChange.mock.calls[onChange.mock.calls.length - 1][0];
const tick = (id: string) => fireEvent.click(screen.getByTestId(`forum-tick-${id}`).querySelector('input')!);
const box = () => screen.getByTestId('forum-select-all').querySelector('input') as HTMLInputElement;
const renderList = (extra: Partial<Parameters<typeof ForumThreadList>[0]> = {}) =>
  renderWithProviders(
    <ForumThreadList threads={posts} firstMessages={[]} totalResults={3} isLoading={false} hasMore={false} forumChannel={forum} onThreadClick={vi.fn()} onExportSelectionChange={onChange} {...extra} />,
  );

describe('ForumThreadList export selection', () => {
  beforeEach(() => onChange.mockClear());

  it('has no tick boxes without an owner to tell', () => {
    renderWithProviders(<ForumThreadList threads={posts} firstMessages={[]} totalResults={3} isLoading={false} hasMore={false} forumChannel={forum} onThreadClick={vi.fn()} />);
    expect(screen.queryByTestId('forum-select-all')).toBeNull();
    expect(screen.queryByTestId('forum-tick-900000000000000001')).toBeNull();
  });

  it('with nothing ticked and the whole forum loaded, Export covers every post and lists nothing again', () => {
    renderList();
    expect(last()).toEqual({ all: false, posts, total: 3, everything: true });
  });

  it('with nothing ticked and pages left, the run lists the forum itself and the count is the forum total', () => {
    renderList({ hasMore: true, totalResults: 300 });
    expect(last()).toEqual({ all: true, posts, total: 300, everything: true });
  });

  it('ticked posts are the export, and a tick does not open the post', () => {
    const onThreadClick = vi.fn();
    renderList({ hasMore: true, totalResults: 300, onThreadClick });
    tick('900000000000000002');
    expect(last()).toEqual({ all: false, posts: [posts[1]], total: 1, everything: false });
    expect(onThreadClick).not.toHaveBeenCalled();
    expect(box().getAttribute('data-indeterminate')).toBe('true');
  });

  it('the box for all, then one post unticked, exports every post but that one', () => {
    renderList({ hasMore: true, totalResults: 300 });
    fireEvent.click(box());
    expect(last()).toEqual({ all: true, posts, total: 300, everything: true });
    tick('900000000000000002');
    expect(last()).toEqual({ all: true, posts: [posts[0], posts[2]], total: 299, everything: false, excludedIds: ['900000000000000002'] });
    expect((screen.getByTestId('forum-tick-900000000000000001').querySelector('input') as HTMLInputElement).checked).toBe(true);
    // The box goes back to every post, then clears.
    fireEvent.click(box());
    expect(last()).toEqual({ all: true, posts, total: 300, everything: true });
    fireEvent.click(box());
    expect((screen.getByTestId('forum-tick-900000000000000001').querySelector('input') as HTMLInputElement).checked).toBe(false);
  });

  it('a tag filter narrows what Export covers to the posts it leaves, and drops earlier ticks', () => {
    renderList({ hasMore: true, totalResults: 300 });
    tick('900000000000000002');
    fireEvent.click(screen.getAllByText('Bug')[0]);
    expect(last()).toEqual({ all: false, posts: [posts[0]], total: 1, everything: true });
  });

  it('a search narrows what Export covers to its results', () => {
    renderList({ hasMore: true, totalResults: 300, onSearch: vi.fn() });
    fireEvent.change(screen.getByPlaceholderText('Search posts...'), { target: { value: 'post' } });
    expect(last()).toEqual({ all: false, posts, total: 3, everything: true });
  });
});
