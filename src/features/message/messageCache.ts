/**
 * The message objects behind the rows (2.2.5 WP2b, plan section 4.5).
 *
 * Redux holds rows; this module holds the Discord message objects the
 * screen needs, keyed by container and id, with the workspace store as
 * the source when an object is not here. A container key is `'main'` for
 * the open channel or DM and the thread id for a thread tab, which is
 * what the reducers know; the store needs the real conversation id, so
 * readers pass both.
 *
 * Reducers write here as pages arrive and as deletes, edits and reaction
 * changes land, so a message on screen is always current. Hydration reads
 * from here first and from the store for what was evicted.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Message } from 'discrub-core/types/discord-types';
import { getMessages } from '@services/workspaceStore';

export const MAIN_CONTAINER = 'main';

/** Objects kept in memory across every container. */
const DEFAULT_CAPACITY = 20_000;
let capacity = DEFAULT_CAPACITY;

/** Tests shrink the cache to prove eviction. */
export function setMessageCacheCapacity(next: number): void {
  capacity = next;
  trim();
}

const cache = new Map<string, Message>();
let version = 0;
const listeners = new Set<() => void>();

const keyOf = (container: string, id: string): string => `${container}\u0000${id}`;

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function trim(): void {
  while (cache.size > capacity) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function subscribeToMessageCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function messageCacheVersion(): number {
  return version;
}

export function cachedMessageCount(): number {
  return cache.size;
}

/** Puts a page in. A key already present moves to the newest end. */
export function cacheMessages(container: string, messages: Message[]): void {
  if (messages.length === 0) return;
  for (const message of messages) {
    const key = keyOf(container, message.id);
    if (cache.has(key)) cache.delete(key);
    cache.set(key, message);
  }
  trim();
  bump();
}

export function getCachedMessage(container: string, id: string): Message | undefined {
  return cache.get(keyOf(container, id));
}

/** Replaces one object; a miss is left alone (the store copy is patched by the middleware). */
export function replaceCachedMessage(container: string, message: Message): void {
  const key = keyOf(container, message.id);
  if (!cache.has(key)) return;
  cache.set(key, message);
  bump();
}

/** Rewrites one object through `update` when it is here. Returns the new object, or undefined on a miss. */
export function updateCachedMessage(container: string, id: string, update: (message: Message) => Message): Message | undefined {
  const key = keyOf(container, id);
  const held = cache.get(key);
  if (!held) return undefined;
  const next = update(held);
  if (next !== held) {
    cache.set(key, next);
    bump();
  }
  return next;
}

export function dropCachedMessages(container: string, ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) changed = cache.delete(keyOf(container, id)) || changed;
  if (changed) bump();
}

/** Forgets a whole container: the conversation was left or the tab closed. */
export function evictContainer(container: string): void {
  const prefix = `${container}\u0000`;
  let changed = false;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) { cache.delete(key); changed = true; }
  }
  if (changed) bump();
}

export function clearMessageCache(): void {
  if (cache.size === 0) return;
  cache.clear();
  bump();
}

/* ─────────────────── Hydration ─────────────────── */

export interface HydrationSource {
  /** The open workspace, or null when there is none (tests, a store failure). */
  wid: string | null;
  /** The conversation id in the store. */
  cid: string | null;
}

const READ_BATCH = 500;

/**
 * The message objects for `ids`, in the order given, missing ones left
 * out. Cache hits are free; the rest is read from the store in batches.
 *
 * 2.2.5 W1: the answer is built from what was found and read, not read
 * back from the cache, so a list longer than the cache comes back whole.
 * Reads are cached only when the list fits in half the cache, so a large
 * read (a whole selection, Analytics) does not evict the rows on screen.
 */
export async function hydrateMessages(container: string, source: HydrationSource, ids: readonly string[]): Promise<Message[]> {
  const found = new Map<string, Message>();
  const missing: string[] = [];
  for (const id of ids) {
    const held = cache.get(keyOf(container, id));
    if (held) found.set(id, held);
    else missing.push(id);
  }
  const keep = ids.length <= capacity / 2;
  if (missing.length > 0 && source.wid && source.cid) {
    for (let at = 0; at < missing.length; at += READ_BATCH) {
      const batch = missing.slice(at, at + READ_BATCH);
      let read: Array<Message | undefined>;
      try {
        read = await getMessages(source.wid, source.cid, batch);
      } catch (error) {
        console.error('[workspace] hydrate failed', error);
        break;
      }
      const page: Message[] = [];
      for (const message of read) {
        if (!message) continue;
        found.set(message.id, message);
        page.push(message);
      }
      if (keep) cacheMessages(container, page);
    }
  }
  const out: Message[] = [];
  for (const id of ids) {
    const message = found.get(id);
    if (message) out.push(message);
  }
  return out;
}

/** Everything cached for a container, for a scan when the store is not available. */
export function cachedMessagesOf(container: string): Message[] {
  const prefix = `${container}\u0000`;
  const out: Message[] = [];
  for (const [key, message] of cache) if (key.startsWith(prefix)) out.push(message);
  return out;
}

/**
 * The objects for the rows a component draws. Cached ones come back at
 * once; the rest arrive from the store a moment later and the component
 * renders again. A row whose object is not here yet draws as a skeleton.
 *
 * 2.2.5 W1: what the store read answers is kept here too, since a read
 * larger than half the cache (one author posting all day makes a chunk of
 * thousands) is not cached. The cache still wins, so an edit shows.
 */
export function useHydratedMessages(container: string, source: HydrationSource, ids: readonly string[]): ReadonlyMap<string, Message> {
  const seen = useSyncExternalStore(subscribeToMessageCache, messageCacheVersion, messageCacheVersion);
  const [fetched, setFetched] = useState<{ key: string; byId: ReadonlyMap<string, Message> }>(EMPTY_FETCHED);
  const fetchedKey = `${container}|${source.cid}`;
  const map = useMemo(() => {
    const out = new Map<string, Message>();
    const read = fetched.key === fetchedKey ? fetched.byId : null;
    for (const id of ids) {
      const message = cache.get(keyOf(container, id)) ?? read?.get(id);
      if (message) out.set(id, message);
    }
    return out;
    // `seen` is the cache version; a change in it is a change in the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, ids, seen, fetched, fetchedKey]);

  // Ask the store for what is missing, once per set of missing ids.
  const askedRef = useRef<string>('');
  useEffect(() => {
    if (!source.wid || !source.cid) return;
    const missing = ids.filter((id) => !map.has(id));
    if (missing.length === 0) return;
    const signature = `${container}|${source.cid}|${missing.join(',')}`;
    if (askedRef.current === signature) return;
    askedRef.current = signature;
    // The signature stays, so ids the store does not have either are not
    // asked for again until the set of missing ids changes.
    void hydrateMessages(container, source, missing).then((read) => {
      if (askedRef.current !== signature || read.length === 0) return;
      setFetched((prev) => {
        const byId = new Map(prev.key === fetchedKey ? prev.byId : undefined);
        // Only what this component draws is kept.
        const wanted = new Set(ids);
        for (const id of byId.keys()) if (!wanted.has(id)) byId.delete(id);
        for (const message of read) byId.set(message.id, message);
        return { key: fetchedKey, byId };
      });
    });
  }, [container, source.wid, source.cid, ids, map, source, fetchedKey]);

  return map;
}

const EMPTY_FETCHED = { key: '', byId: new Map<string, Message>() as ReadonlyMap<string, Message> };

/**
 * Every object behind `ids`, for a modal that works on a short list (the
 * single message the Edit and Embed modals show). Hydrates while
 * `enabled`; `loading` is true until the read is back.
 *
 * 2.2.5 W1: the read runs once per set of ids, not again on every cache
 * change. Each hydrate changes the cache, so a list longer than the cache
 * used to hydrate for ever. Whole list work reads the store in windows.
 */
export function useHydratedAll(
  container: string,
  source: HydrationSource,
  ids: readonly string[],
  enabled: boolean,
): { messages: Message[]; loading: boolean } {
  const [state, setState] = useState<{ messages: Message[]; loading: boolean }>(EMPTY_HYDRATION);
  const runRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const run = ++runRef.current;
    const settled = (messages: Message[]) => {
      if (runRef.current === run) setState({ messages, loading: false });
    };
    const cached: Message[] = [];
    let complete = true;
    for (const id of ids) {
      const message = cache.get(keyOf(container, id));
      if (message) cached.push(message); else { complete = false; break; }
    }
    if (complete) { settled(cached); return; }
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
    void hydrateMessages(container, source, ids).then(settled, () => settled([]));
  }, [container, source, ids, enabled]);
  if (!enabled) return EMPTY_HYDRATION;
  return state;
}

const EMPTY_HYDRATION = { messages: [] as Message[], loading: false };
