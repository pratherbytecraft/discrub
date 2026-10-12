/**
 * Whole list work over the workspace store (2.2.5 W4).
 *
 * A conversation can hold more messages than memory should. Work that
 * needs every message of a list (Analytics) walks the store once, a
 * message at a time, and keeps only what it counts. Messages the store
 * does not have yet (a first page is written only once something happens
 * in the conversation) come from the message cache afterwards.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from 'discrub-core/types/discord-types';
import { scan } from '@services/workspaceStore';
import { hydrateMessages, type HydrationSource } from './messageCache';

export interface WalkInput {
  /** The message cache container of the list. */
  container: string;
  /** Where the list is saved. */
  source: HydrationSource;
  /** The ids of the list; other saved messages are skipped. */
  ids: readonly string[];
}

export interface WalkProgress {
  /** Saved messages read so far. */
  seen: number;
  /** Saved messages in the conversation. */
  total: number;
}

export interface WalkOptions {
  onProgress?: (progress: WalkProgress) => void;
  shouldStop?: () => boolean;
}

export interface WalkResult {
  /** Messages handed to `visit`. */
  visited: number;
  /** False when `shouldStop` ended the walk. */
  complete: boolean;
}

const CACHE_BATCH = 500;

/**
 * Hands every message of `input.ids` to `visit` once, in no set order.
 * `visit` must be synchronous (it runs under an IndexedDB cursor).
 */
export async function walkMessages(input: WalkInput, visit: (message: Message) => void, options: WalkOptions = {}): Promise<WalkResult> {
  const wanted = new Set(input.ids);
  let visited = 0;
  const take = (message: Message) => {
    if (!wanted.delete(message.id)) return;
    visited++;
    visit(message);
  };
  const { wid, cid } = input.source;
  if (wid && cid && wanted.size > 0) {
    try {
      const result = await scan(wid, cid, (message) => {
        take(message);
        return false;
      }, {
        onProgress: (seen, total) => options.onProgress?.({ seen, total }),
        shouldStop: options.shouldStop,
      });
      if (!result.complete) return { visited, complete: false };
    } catch (error) {
      console.error('[workspace] walk falls back to the cache', error);
    }
  }
  // What the store did not have: the cache, or a read by id.
  const rest = [...wanted];
  for (let at = 0; at < rest.length; at += CACHE_BATCH) {
    if (options.shouldStop?.()) return { visited, complete: false };
    for (const message of await hydrateMessages(input.container, input.source, rest.slice(at, at + CACHE_BATCH))) take(message);
  }
  return { visited, complete: true };
}

export interface StoreWalkState<T> {
  /** The last finished walk's value, null before the first. */
  value: T | null;
  /** Progress of the walk under way, null when none is. */
  progress: WalkProgress | null;
  loading: boolean;
}

export interface WalkPlan<T> {
  visit(message: Message): void;
  done(visited: number): T;
}

/**
 * Runs a walk while `enabled` and keeps its value. A change of `key`
 * (what is counted, or the conversation) stops a walk under way and
 * starts again. A change of `input.ids` alone (a page arrived) lets the
 * walk under way finish first, so a Load All does not restart it on
 * every page. `start` makes a fresh plan for each walk.
 */
export function useStoreWalk<T>(enabled: boolean, input: WalkInput, key: string, start: () => WalkPlan<T>, delayMs = 0): StoreWalkState<T> {
  const [state, setState] = useState<StoreWalkState<T>>({ value: null, progress: null, loading: false });
  const latest = useRef({ input, key, start, enabled });
  latest.current = { input, key, start, enabled };
  const running = useRef<{ key: string; stop: boolean } | null>(null);
  const pending = useRef(false);
  const doneFor = useRef<{ input: WalkInput; key: string } | null>(null);

  const launch = useCallback(() => {
    const { input: runInput, key: runKey, start: runStart } = latest.current;
    const token = { key: runKey, stop: false };
    running.current = token;
    pending.current = false;
    setState((prev) => ({ ...prev, loading: true, progress: null }));
    const plan = runStart();
    void walkMessages(runInput, plan.visit, {
      onProgress: (progress) => {
        if (!token.stop) setState((prev) => ({ ...prev, progress }));
      },
      shouldStop: () => token.stop,
    }).then(
      ({ visited, complete }) => {
        if (token.stop || !complete) return;
        running.current = null;
        doneFor.current = { input: runInput, key: runKey };
        setState({ value: plan.done(visited), progress: null, loading: false });
        if (pending.current && latest.current.enabled) launch();
      },
      (error) => {
        console.error('[workspace] walk failed', error);
        if (token.stop) return;
        running.current = null;
        setState((prev) => ({ ...prev, progress: null, loading: false }));
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (running.current) running.current.stop = true;
      running.current = null;
      pending.current = false;
      setState((prev) => (prev.loading ? { ...prev, progress: null, loading: false } : prev));
      return;
    }
    const done = doneFor.current;
    if (!running.current && done && done.input.ids === input.ids && done.input.source === input.source && done.key === key) return;
    const timer = setTimeout(() => {
      const current = running.current;
      if (!current) launch();
      else if (current.key !== key) {
        current.stop = true;
        running.current = null;
        launch();
      } else pending.current = true;
    }, delayMs);
    return () => clearTimeout(timer);
  }, [enabled, input, key, delayMs, launch]);

  useEffect(() => () => {
    if (running.current) running.current.stop = true;
  }, []);

  return state;
}
