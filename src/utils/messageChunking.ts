import type { Message } from 'discrub-core/types/discord-types';

/**
 * Discord's heuristic for visually grouping consecutive same-author messages
 * into a single chunk. Matches the export service's constant so that the
 * live feed and exported output render with the same grouping.
 */
export const CHUNK_WINDOW_MS = 7 * 60 * 1000;

export interface MessageChunk {
  /** Stable key derived from the first message's id. */
  key: string;
  authorId: string | null;
  /** Timestamp of the chunk's first message (used for the header label). */
  firstTimestamp: string;
  messages: Message[];
}

const getAuthorId = (msg: Message): string | null => msg.author?.id ?? null;

/**
 * Two adjacent messages are groupable if:
 * 1. They share an author id
 * 2. Both are plain messages (type 0) — replies / system / thread starters
 *    break the chunk so their distinctive presentation isn't collapsed under
 *    a shared header
 * 3. Their timestamps are within CHUNK_WINDOW_MS of each other, using the
 *    absolute delta so sort direction (newest-first vs oldest-first) doesn't
 *    flip the comparison
 */
const canGroup = (a: Message, b: Message): boolean => {
  const aId = getAuthorId(a);
  const bId = getAuthorId(b);
  if (!aId || !bId || aId !== bId) return false;
  if (a.type !== 0 || b.type !== 0) return false;
  if (!a.timestamp || !b.timestamp) return false;
  const delta = Math.abs(
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  return delta < CHUNK_WINDOW_MS;
};

/**
 * Group a pre-sorted array of messages into chunks. The caller is
 * responsible for sort order — whatever order the input is in, the chunks
 * preserve that order. Grouping is symmetric w.r.t. sort direction because
 * the time-delta check uses Math.abs.
 */
/** Local calendar day of a timestamp as YYYY-MM-DD. Empty for a missing or unreadable timestamp. */
export const localDayKey = (timestamp: string | null | undefined): string => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * `splitByDay` (Timeline, 2.2.0) ends a chunk at midnight local time so a
 * day heading can sit above the first chunk of each day.
 */
export const chunkMessages = (messages: Message[], opts: { splitByDay?: boolean } = {}): MessageChunk[] => {
  if (messages.length === 0) return [];

  const chunks: MessageChunk[] = [];
  let current: Message[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = current[current.length - 1];
    const next = messages[i];
    if (canGroup(prev, next) && (!opts.splitByDay || localDayKey(prev.timestamp) === localDayKey(next.timestamp))) {
      current.push(next);
    } else {
      chunks.push(toChunk(current));
      current = [next];
    }
  }
  chunks.push(toChunk(current));
  return chunks;
};

const toChunk = (messages: Message[]): MessageChunk => {
  const first = messages[0];
  return {
    key: first.id,
    authorId: getAuthorId(first),
    firstTimestamp: first.timestamp,
    messages,
  };
};
