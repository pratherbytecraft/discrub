import type { Message } from 'discrub-core/types/discord-types';
import { extendedRange } from './listExtension';

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
 * 2.2.1 perf: the local day of a message, remembered per message object.
 * The feed, the Timeline strip and the chunker all ask for the day of
 * every loaded message on every appended page, and `localDayKey` builds a
 * Date and a string each time. Message objects keep their identity across
 * store updates, so the answer is cached on the object itself.
 */
const dayKeyCache = new WeakMap<object, string>();
export const messageDayKey = (message: Pick<Message, 'timestamp'>): string => {
  const hit = dayKeyCache.get(message);
  if (hit !== undefined) return hit;
  const key = localDayKey(message.timestamp);
  dayKeyCache.set(message, key);
  return key;
};

/**
 * `splitByDay` (Timeline, 2.2.0) ends a chunk at midnight local time so a
 * day heading can sit above the first chunk of each day.
 *
 * `prev` (2.2.1 perf) is the previous result for the same feed. A chunk
 * whose messages are the same objects in the same order is returned as the
 * same object, so a memoised chunk row skips its render when a page is
 * appended or a batch of deletes lands elsewhere in the list.
 */
export const chunkMessages = (
  messages: Message[],
  opts: { splitByDay?: boolean } = {},
  prev?: MessageChunk[],
): MessageChunk[] => {
  if (messages.length === 0) return [];

  // A page appended at one end: keep every previous chunk that cannot
  // have changed and chunk only the end chunk plus the new messages.
  const ext = prev ? extendedRange(sourceOf.get(prev), messages) : null;
  if (ext && prev && prev.length > 0) {
    let result: MessageChunk[];
    if (ext.at === 'tail') {
      const lastChunk = prev[prev.length - 1];
      const start = ext.from - lastChunk.messages.length;
      result = prev.slice(0, -1).concat(chunkRange(messages, start, messages.length, opts, new Map([[lastChunk.key, lastChunk]])));
    } else {
      const firstChunk = prev[0];
      const end = ext.to + firstChunk.messages.length;
      result = chunkRange(messages, 0, end, opts, new Map([[firstChunk.key, firstChunk]])).concat(prev.slice(1));
    }
    sourceOf.set(result, messages);
    return result;
  }

  // A change in the middle (2.2.2 perf, a delete flush): keep the chunks on
  // both sides of it and chunk only the stretch between them.
  const src = prev ? sourceOf.get(prev) : undefined;
  if (src && prev && prev.length > 0) {
    const spliced = rechunkChangedStretch(prev, src, messages, opts);
    if (spliced) {
      sourceOf.set(spliced, messages);
      return spliced;
    }
  }

  const prevByKey = prev && prev.length > 0 ? new Map(prev.map((c) => [c.key, c])) : null;
  const result = chunkRange(messages, 0, messages.length, opts, prevByKey);
  sourceOf.set(result, messages);
  return result;
};

/**
 * The list changed somewhere inside: the same objects lead it and end it as
 * before. Chunks that lie wholly in the unchanged lead or end are kept,
 * except the one next to the change on each side, which is chunked again
 * with the stretch because its neighbour may have changed. Returns null
 * when nothing can be kept, and the caller chunks the whole list.
 */
const rechunkChangedStretch = (
  prev: MessageChunk[],
  src: Message[],
  messages: Message[],
  opts: { splitByDay?: boolean },
): MessageChunk[] | null => {
  const shorter = Math.min(src.length, messages.length);
  let lead = 0;
  while (lead < shorter && src[lead] === messages[lead]) lead++;
  let end = 0;
  while (end < shorter - lead && src[src.length - 1 - end] === messages[messages.length - 1 - end]) end++;
  if (lead === 0 && end === 0) return null;

  // Chunks wholly inside the lead, less the last of them.
  let headCount = 0;
  let headLength = 0;
  let at = 0;
  for (const chunk of prev) {
    if (at + chunk.messages.length > lead) break;
    at += chunk.messages.length;
    headCount++;
  }
  if (headCount > 0) { headCount--; at -= prev[headCount].messages.length; }
  headLength = at;

  // Chunks wholly inside the end, less the first of them.
  let tailCount = 0;
  let tailLength = 0;
  for (let i = prev.length - 1; i >= headCount; i--) {
    if (tailLength + prev[i].messages.length > end) break;
    tailLength += prev[i].messages.length;
    tailCount++;
  }
  if (tailCount > 0) { tailCount--; tailLength -= prev[prev.length - tailCount - 1].messages.length; }
  if (headCount === 0 && tailCount === 0) return null;

  const from = headLength;
  const to = messages.length - tailLength;
  if (from > to) return null;
  const between = prev.slice(headCount, prev.length - tailCount);
  const middle = from < to ? chunkRange(messages, from, to, opts, new Map(between.map((c) => [c.key, c]))) : [];
  return prev.slice(0, headCount).concat(middle, tailCount > 0 ? prev.slice(prev.length - tailCount) : []);
};

/** The list each chunk array was built from, so the next call can tell an appended page apart. */
const sourceOf = new WeakMap<MessageChunk[], Message[]>();

const chunkRange = (
  messages: Message[],
  from: number,
  to: number,
  opts: { splitByDay?: boolean },
  prevByKey: Map<string, MessageChunk> | null,
): MessageChunk[] => {
  const chunks: MessageChunk[] = [];
  let current: Message[] = [messages[from]];
  for (let i = from + 1; i < to; i++) {
    const last = current[current.length - 1];
    const next = messages[i];
    if (canGroup(last, next) && (!opts.splitByDay || messageDayKey(last) === messageDayKey(next))) {
      current.push(next);
    } else {
      chunks.push(toChunk(current, prevByKey));
      current = [next];
    }
  }
  chunks.push(toChunk(current, prevByKey));
  return chunks;
};

const sameMessages = (a: Message[], b: Message[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const toChunk = (messages: Message[], prevByKey: Map<string, MessageChunk> | null): MessageChunk => {
  const first = messages[0];
  const reusable = prevByKey?.get(first.id);
  if (reusable && sameMessages(reusable.messages, messages)) return reusable;
  return {
    key: first.id,
    authorId: getAuthorId(first),
    firstTimestamp: first.timestamp,
    messages,
  };
};
