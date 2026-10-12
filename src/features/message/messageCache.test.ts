import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { renderHook, waitFor } from '@testing-library/react';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage } from '@/test/fixtures';
import {
  MAIN_CONTAINER,
  cacheMessages,
  cachedMessageCount,
  cachedMessagesOf,
  clearMessageCache,
  dropCachedMessages,
  evictContainer,
  getCachedMessage,
  hydrateMessages,
  messageCacheVersion,
  replaceCachedMessage,
  setMessageCacheCapacity,
  subscribeToMessageCache,
  updateCachedMessage,
  useHydratedAll,
  useHydratedMessages,
} from './messageCache';
import { deleteWorkspaceDatabase, writePage } from '@services/workspaceStore';
import { LEGACY_DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';

const msg = (id: string, content = id): Message => createMockMessage({ id, content }) as Message;
const noStore = { wid: null, cid: null };

describe('messageCache', () => {
  beforeEach(() => { clearMessageCache(); setMessageCacheCapacity(20_000); });
  afterEach(() => { clearMessageCache(); setMessageCacheCapacity(20_000); });

  it('stores and reads objects per container', () => {
    cacheMessages(MAIN_CONTAINER, [msg('1'), msg('2')]);
    cacheMessages('thread', [msg('1', 'thread copy')]);
    expect(getCachedMessage(MAIN_CONTAINER, '1')?.content).toBe('1');
    expect(getCachedMessage('thread', '1')?.content).toBe('thread copy');
    expect(getCachedMessage(MAIN_CONTAINER, '9')).toBeUndefined();
    expect(cachedMessagesOf(MAIN_CONTAINER).map((m) => m.id)).toEqual(['1', '2']);
    expect(cachedMessageCount()).toBe(3);
  });

  it('bumps the version and tells subscribers on every change', () => {
    const listener = vi.fn();
    const stop = subscribeToMessageCache(listener);
    const before = messageCacheVersion();
    cacheMessages(MAIN_CONTAINER, [msg('1')]);
    replaceCachedMessage(MAIN_CONTAINER, msg('1', 'edited'));
    updateCachedMessage(MAIN_CONTAINER, '1', (m) => ({ ...m, content: 'again' }));
    dropCachedMessages(MAIN_CONTAINER, ['1']);
    expect(messageCacheVersion()).toBe(before + 4);
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    cacheMessages(MAIN_CONTAINER, [msg('2')]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('leaves a miss alone on replace and update', () => {
    const before = messageCacheVersion();
    replaceCachedMessage(MAIN_CONTAINER, msg('1'));
    expect(updateCachedMessage(MAIN_CONTAINER, '1', (m) => m)).toBeUndefined();
    expect(messageCacheVersion()).toBe(before);
    cacheMessages(MAIN_CONTAINER, [msg('1')]);
    const held = getCachedMessage(MAIN_CONTAINER, '1');
    const v = messageCacheVersion();
    expect(updateCachedMessage(MAIN_CONTAINER, '1', (m) => m)).toBe(held);
    expect(messageCacheVersion()).toBe(v);
  });

  it('evicts the oldest objects past the capacity and refreshes a re-cached one', () => {
    setMessageCacheCapacity(3);
    cacheMessages(MAIN_CONTAINER, [msg('1'), msg('2'), msg('3')]);
    cacheMessages(MAIN_CONTAINER, [msg('1')]);
    cacheMessages(MAIN_CONTAINER, [msg('4')]);
    expect(getCachedMessage(MAIN_CONTAINER, '2')).toBeUndefined();
    expect(getCachedMessage(MAIN_CONTAINER, '1')).toBeDefined();
    expect(getCachedMessage(MAIN_CONTAINER, '4')).toBeDefined();
    expect(cachedMessageCount()).toBe(3);
  });

  it('forgets one container and keeps the others', () => {
    cacheMessages(MAIN_CONTAINER, [msg('1')]);
    cacheMessages('t1', [msg('1')]);
    evictContainer('t1');
    expect(getCachedMessage('t1', '1')).toBeUndefined();
    expect(getCachedMessage(MAIN_CONTAINER, '1')).toBeDefined();
  });

  it('hydrates from the cache alone when there is no workspace', async () => {
    cacheMessages(MAIN_CONTAINER, [msg('1'), msg('2')]);
    const out = await hydrateMessages(MAIN_CONTAINER, noStore, ['2', '9', '1']);
    expect(out.map((m) => m.id)).toEqual(['2', '1']);
  });

  describe('with the workspace store', () => {
    beforeEach(async () => { await deleteWorkspaceDatabase(); await ensureTestDefaultWorkspace(); });
    afterEach(async () => { await deleteWorkspaceDatabase(); });

    it('reads evicted objects from the store and caches them', async () => {
      await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 'c1', [msg('1'), msg('2'), msg('3')], { kind: 'channel', guildId: null, name: 'general' });
      cacheMessages(MAIN_CONTAINER, [msg('2')]);
      const out = await hydrateMessages(MAIN_CONTAINER, { wid: LEGACY_DEFAULT_WORKSPACE_ID, cid: 'c1' }, ['1', '2', '3', '9']);
      expect(out.map((m) => m.id)).toEqual(['1', '2', '3']);
      expect(getCachedMessage(MAIN_CONTAINER, '3')).toBeDefined();
    });

    it('useHydratedMessages returns cached rows at once and the rest after the read', async () => {
      await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 'c1', [msg('1'), msg('2')], { kind: 'channel', guildId: null, name: 'general' });
      cacheMessages(MAIN_CONTAINER, [msg('1')]);
      const source = { wid: LEGACY_DEFAULT_WORKSPACE_ID, cid: 'c1' };
      const ids = ['1', '2'];
      const { result } = renderHook(() => useHydratedMessages(MAIN_CONTAINER, source, ids));
      expect(result.current.has('1')).toBe(true);
      expect(result.current.has('2')).toBe(false);
      await waitFor(() => expect(result.current.has('2')).toBe(true));
    });

    it('useHydratedAll reports loading until every object is in', async () => {
      await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 'c1', [msg('1'), msg('2')], { kind: 'channel', guildId: null, name: 'general' });
      const source = { wid: LEGACY_DEFAULT_WORKSPACE_ID, cid: 'c1' };
      const ids = ['1', '2'];
      const { result } = renderHook(() => useHydratedAll(MAIN_CONTAINER, source, ids, true));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['1', '2']));
    });
  });

  it('useHydratedAll answers from the cache without a workspace', async () => {
    cacheMessages(MAIN_CONTAINER, [msg('1'), msg('2')]);
    const ids = ['1', '2'];
    const { result } = renderHook(() => useHydratedAll(MAIN_CONTAINER, noStore, ids, true));
    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toEqual(['1', '2']));
  });

  // 2.2.5 W1: it used to hydrate again on every cache change, and each
  // hydrate changes the cache, so a list longer than the cache never settled.
  it('useHydratedAll settles once on a list longer than the cache', async () => {
    await ensureTestDefaultWorkspace();
    const source = { wid: LEGACY_DEFAULT_WORKSPACE_ID, cid: 'long' };
    const ids = Array.from({ length: 25 }, (_, i) => String(100 + i));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 'long', ids.map((id) => msg(id)), { kind: 'channel', guildId: null, name: 'long' });
    setMessageCacheCapacity(10);
    const { result } = renderHook(() => useHydratedAll(MAIN_CONTAINER, source, ids, true));
    await waitFor(() => expect(result.current.messages).toHaveLength(25));
    const version = messageCacheVersion();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(messageCacheVersion()).toBe(version);
    expect(result.current.loading).toBe(false);
    await deleteWorkspaceDatabase();
  });

  it('useHydratedMessages shows a read larger than half the cache', async () => {
    await ensureTestDefaultWorkspace();
    const source = { wid: LEGACY_DEFAULT_WORKSPACE_ID, cid: 'long' };
    const ids = Array.from({ length: 30 }, (_, i) => String(100 + i));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 'long', ids.map((id) => msg(id)), { kind: 'channel', guildId: null, name: 'long' });
    setMessageCacheCapacity(10);
    const { result } = renderHook(() => useHydratedMessages(MAIN_CONTAINER, source, ids));
    await waitFor(() => expect(result.current.size).toBe(30));
    expect(cachedMessageCount()).toBe(0);
    await deleteWorkspaceDatabase();
  });

  it('hydrateMessages answers every id past the cache size and leaves the cache alone', async () => {
    await ensureTestDefaultWorkspace();
    const source = { wid: LEGACY_DEFAULT_WORKSPACE_ID, cid: 'long' };
    const ids = Array.from({ length: 1200 }, (_, i) => String(1000 + i));
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 'long', ids.map((id) => msg(id)), { kind: 'channel', guildId: null, name: 'long' });
    setMessageCacheCapacity(1000);
    cacheMessages(MAIN_CONTAINER, [msg('on-screen')]);
    const out = await hydrateMessages(MAIN_CONTAINER, source, ids);
    expect(out.map((m) => m.id)).toEqual(ids);
    expect(getCachedMessage(MAIN_CONTAINER, 'on-screen')).toBeDefined();
    expect(cachedMessageCount()).toBe(1);
    await deleteWorkspaceDatabase();
  });

  it('useHydratedAll is empty and idle while disabled', () => {
    cacheMessages(MAIN_CONTAINER, [msg('1')]);
    const { result } = renderHook(() => useHydratedAll(MAIN_CONTAINER, noStore, ['1'], false));
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
