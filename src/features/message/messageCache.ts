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
 * out. Cache hits are free; the rest is read from the store in batches
 * and cached on the way back.
 */
export async function hydrateMessages(container: string, source: HydrationSource, ids: string[]): Promise<Message[]> {
  const missing: string[] = [];
  for (const id of ids) if (!cache.has(keyOf(container, id))) missing.push(id);
  if (missing.length > 0 && source.wid && source.cid) {
    for (let at = 0; at < missing.length; at += READ_BATCH) {
      const batch = missing.slice(at, at + READ_BATCH);
      let found: Array<Message | undefined>;
      try {
        found = await getMessages(source.wid, source.cid, batch);
      } catch (error) {
        console.error('[workspace] hydrate failed', error);
        break;
      }
      const read: Message[] = [];
      for (const message of found) if (message) read.push(message);
      cacheMessages(container, read);
    }
  }
  const out: Message[] = [];
  for (const id of ids) {
    const message = cache.get(keyOf(container, id));
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
 */
export function useHydratedMessages(container: string, source: HydrationSource, ids: readonly string[]): ReadonlyMap<string, Message> {
  const seen = useSyncExternalStore(subscribeToMessageCache, messageCacheVersion, messageCacheVersion);
  const map = useMemo(() => {
    const out = new Map<string, Message>();
    for (const id of ids) {
      const message = cache.get(keyOf(container, id));
      if (message) out.set(id, message);
    }
    return out;
    // `seen` is the cache version; a change in it is a change in the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, ids, seen]);

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
    void hydrateMessages(container, source, missing);
  }, [container, source.wid, source.cid, ids, map, source]);

  return map;
}

/**
 * Every object behind `ids`, for a modal, an export or analytics that
 * works on the whole list. Hydrates while `enabled`; `loading` is true
 * until the read is back. The list is rebuilt when the ids, the cache
 * or the source change.
 */
export function useHydratedAll(
  container: string,
  source: HydrationSource,
  ids: readonly string[],
  enabled: boolean,
): { messages: Message[]; loading: boolean } {
  const seen = useSyncExternalStore(subscribeToMessageCache, messageCacheVersion, messageCacheVersion);
  const [state, setState] = useState<{ ids: readonly string[]; seen: number; messages: Message[]; loading: boolean }>({ ids, seen, messages: [], loading: false });
  const runRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const run = ++runRef.current;
    const settled = (messages: Message[]) => {
      if (runRef.current === run) setState({ ids, seen, messages, loading: false });
    };
    const cached: Message[] = [];
    let complete = true;
    for (const id of ids) {
      const message = cache.get(keyOf(container, id));
      if (message) cached.push(message); else { complete = false; break; }
    }
    if (complete) { settled(cached); return; }
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
    void hydrateMessages(container, source, ids as string[]).then(settled, () => settled(cached));
  }, [container, source, ids, enabled, seen]);
  if (!enabled) return EMPTY_HYDRATION;
  return state;
}

const EMPTY_HYDRATION = { messages: [] as Message[], loading: false };
