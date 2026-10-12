import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Message } from 'discrub-core/types/discord-types';
import { cacheMessages, evictContainer } from './messageCache';

const saved: { messages: Message[]; fail: boolean } = { messages: [], fail: false };

vi.mock('@services/workspaceStore', () => ({
  scan: vi.fn(async (_wid: string, _cid: string, predicate: (m: Message) => boolean, options: { onProgress?: (s: number, t: number) => void; shouldStop?: () => boolean } = {}) => {
    if (saved.fail) throw new Error('blocked');
    let seen = 0;
    for (const message of saved.messages) {
      predicate(message);
      seen++;
      options.onProgress?.(seen, saved.messages.length);
      if (options.shouldStop?.()) return { ids: [], seen, total: saved.messages.length, complete: false };
    }
    return { ids: [], seen, total: saved.messages.length, complete: true };
  }),
}));

import { walkMessages, useStoreWalk, type WalkInput } from './storeWalk';

const msg = (id: string): Message => ({ id, content: id, channel_id: 'c' }) as Message;
const source = { wid: 'w', cid: 'c' };

describe('walkMessages', () => {
  beforeEach(() => {
    saved.messages = [];
    saved.fail = false;
  });
  afterEach(() => evictContainer('walk'));

  it('visits each listed message once and skips the rest', async () => {
    saved.messages = ['1', '2', '3', '4'].map(msg);
    const seen: string[] = [];
    const result = await walkMessages({ container: 'walk', source, ids: ['2', '4'] }, (m) => seen.push(m.id));
    expect(seen.sort()).toEqual(['2', '4']);
    expect(result).toEqual({ visited: 2, complete: true });
  });

  it('takes listed messages the store does not have from the cache', async () => {
    saved.messages = [msg('1')];
    cacheMessages('walk', [msg('9')]);
    const seen: string[] = [];
    await walkMessages({ container: 'walk', source, ids: ['1', '9'] }, (m) => seen.push(m.id));
    expect(seen.sort()).toEqual(['1', '9']);
  });

  it('reads from the cache when the store walk fails', async () => {
    saved.messages = [msg('1')];
    saved.fail = true;
    cacheMessages('walk', [msg('1'), msg('2')]);
    const seen: string[] = [];
    const result = await walkMessages({ container: 'walk', source, ids: ['1', '2'] }, (m) => seen.push(m.id));
    expect(seen.sort()).toEqual(['1', '2']);
    expect(result.complete).toBe(true);
  });

  it('reports progress and stops when asked', async () => {
    saved.messages = ['1', '2', '3'].map(msg);
    const progress: number[] = [];
    const result = await walkMessages({ container: 'walk', source, ids: ['1', '2', '3'] }, () => {}, {
      onProgress: (p) => progress.push(p.seen),
      shouldStop: () => progress.length >= 2,
    });
    expect(result.complete).toBe(false);
    expect(progress).toEqual([1, 2]);
  });
});

describe('useStoreWalk', () => {
  beforeEach(() => {
    saved.messages = ['1', '2', '3'].map(msg);
    saved.fail = false;
  });

  const counter = () => {
    let n = 0;
    return { visit: () => { n++; }, done: () => n };
  };

  it('walks while enabled and keeps the value for the same list', async () => {
    const input: WalkInput = { container: 'walk', source, ids: ['1', '2'] };
    const start = vi.fn(counter);
    const { result, rerender } = renderHook(({ enabled }) => useStoreWalk(enabled, input, 'k', start), { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.value).toBe(2));
    expect(result.current.loading).toBe(false);
    rerender({ enabled: false });
    rerender({ enabled: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('walks again when the list or the key changes', async () => {
    const start = vi.fn(counter);
    const { result, rerender } = renderHook(({ ids, k }) => useStoreWalk(true, { container: 'walk', source, ids }, k, start), {
      initialProps: { ids: ['1'], k: 'a' },
    });
    await waitFor(() => expect(result.current.value).toBe(1));
    rerender({ ids: ['1', '2', '3'], k: 'a' });
    await waitFor(() => expect(result.current.value).toBe(3));
    rerender({ ids: ['1', '2', '3'], k: 'b' });
    await waitFor(() => expect(start).toHaveBeenCalledTimes(3));
  });
});
