import type { Message } from 'discrub-core/types/discord-types';
import { readWindow, countRows } from './workspaceStore';

/**
 * Messages an export reads a window at a time (2.2.5 WP6c, plan section
 * 11). The render path never holds a whole conversation: the media
 * passes, the formatting context and the page loop each walk the
 * windows, so memory stays flat whatever the size.
 *
 * Two sources exist. The array source wraps messages already in hand
 * (a data package, a stopped run's pages, tests). The store source
 * reads a conversation from the workspace store in id order, which is
 * time order, optionally keeping only the ids a refine accepted.
 */
export type ReadDirection = 'asc' | 'desc';

export interface MessageSource {
  /** How many messages the windows will yield in total. */
  readonly count: number;
  /** Windows of messages in time order, oldest first for `asc`. */
  windows(direction: ReadDirection): AsyncIterable<Message[]>;
}

export const WINDOW_SIZE = 500;

const timeOf = (message: Message): number => new Date(message.timestamp || 0).getTime();

export function isMessageSource(value: unknown): value is MessageSource {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as MessageSource).windows === 'function';
}

/** Messages already in memory, sorted on each walk. */
export function arraySource(messages: Message[]): MessageSource {
  return {
    count: messages.length,
    async *windows(direction) {
      const sorted = [...messages].sort((a, b) => (direction === 'asc' ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)));
      for (let at = 0; at < sorted.length; at += WINDOW_SIZE) yield sorted.slice(at, at + WINDOW_SIZE);
    },
  };
}

/**
 * A conversation in the workspace store. `ids`, when given, keeps only
 * those messages (the refined list the dialog shows) and `count` must be
 * their number; otherwise `count` is the conversation's row count.
 */
export function storeSource(wid: string, cid: string, count: number, ids?: ReadonlySet<string>): MessageSource {
  return {
    count,
    async *windows(direction) {
      let cursor: string | undefined;
      while (true) {
        const read = await readWindow(wid, cid, {
          ...(direction === 'asc' ? { afterId: cursor } : { beforeId: cursor }),
          limit: WINDOW_SIZE,
          direction,
        });
        if (read.length === 0) return;
        cursor = read[read.length - 1].id;
        const kept = ids ? read.filter((message) => ids.has(message.id)) : read;
        if (kept.length > 0) yield kept;
        if (read.length < WINDOW_SIZE) return;
      }
    },
  };
}

/** A store source whose count is read from the store, or `ids.size` when a refine is on. */
export async function storeSourceOf(wid: string, cid: string, ids?: ReadonlySet<string>): Promise<MessageSource> {
  const count = ids ? ids.size : await countRows(wid, cid);
  return storeSource(wid, cid, count, ids);
}

/** Either shape as a source. */
export function toSource(messages: Message[] | MessageSource): MessageSource {
  return isMessageSource(messages) ? messages : arraySource(messages);
}

/** One source after another, for a pass over a channel and its threads. */
export function concatSources(sources: MessageSource[]): MessageSource {
  return {
    count: sources.reduce((sum, source) => sum + source.count, 0),
    async *windows(direction) {
      for (const source of sources) yield* source.windows(direction);
    },
  };
}

/** Walks every message oldest first. `index` counts from zero across windows. */
export async function forEachMessage(source: MessageSource, fn: (message: Message, index: number) => void): Promise<void> {
  let index = 0;
  for await (const window of source.windows('asc')) {
    for (const message of window) fn(message, index++);
  }
}

/** The messages `predicate` accepts, oldest first. For the few a pass needs whole, like thread starters. */
export async function collectMessages(source: MessageSource, predicate: (message: Message) => boolean): Promise<Message[]> {
  const out: Message[] = [];
  await forEachMessage(source, (message) => {
    if (predicate(message)) out.push(message);
  });
  return out;
}

export interface MessagePage {
  pageNumber: number;
  messages: Message[];
}

/** Pages of `size` messages a page at a time. */
export function pageCount(count: number, size: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.ceil(count / Math.max(1, size)));
}

/** Windows regrouped into export pages, in the export's order. */
export async function* pagesOf(source: MessageSource, size: number, direction: ReadDirection): AsyncGenerator<MessagePage> {
  const perPage = Math.max(1, size);
  let page: Message[] = [];
  let pageNumber = 0;
  for await (const window of source.windows(direction)) {
    for (const message of window) {
      page.push(message);
      if (page.length === perPage) {
        yield { pageNumber: ++pageNumber, messages: page };
        page = [];
      }
    }
  }
  if (page.length > 0) yield { pageNumber: ++pageNumber, messages: page };
}
