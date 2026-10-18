import { formatContentAsHtml } from 'discrub-core/html-formatting-utils';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';

/**
 * Rendered message HTML, kept across row mounts (2.2.5, scroll skeletons).
 *
 * A feed row's `useMemo` only lives as long as the row: scrolling a chunk out
 * of the virtual window and back ran the markdown to HTML conversion again.
 * This map keeps the result per message and formatting context, so a row that
 * returns to the screen only has to paint. Capped so a long session over many
 * conversations does not grow without bound; the oldest entries go first.
 */
export const CONTENT_HTML_CACHE_LIMIT = 5000;

const cache = new Map<string, string>();
const contextIds = new WeakMap<object, number>();
let nextContextId = 1;

const contextId = (context: HtmlFormattingContext): number => {
  let id = contextIds.get(context);
  if (id === undefined) {
    id = nextContextId++;
    contextIds.set(context, id);
  }
  return id;
};

/** HTML for a message's content, from the cache when the same text and context were rendered before. */
export function getContentHtml(
  messageId: string,
  editedTimestamp: string | null | undefined,
  rawContent: string,
  context: HtmlFormattingContext,
): string {
  if (!rawContent) return '';
  const key = `${contextId(context)}:${messageId}:${editedTimestamp ?? ''}:${rawContent.length}`;
  const held = cache.get(key);
  if (held !== undefined) {
    // Refresh the entry's place so a row on screen is the last to be dropped.
    cache.delete(key);
    cache.set(key, held);
    return held;
  }
  const html = formatContentAsHtml(rawContent, context);
  cache.set(key, html);
  if (cache.size > CONTENT_HTML_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return html;
}

/** Test and memory hook: drop every cached entry. */
export function clearContentHtmlCache(): void {
  cache.clear();
}

/** Test hook: how many entries are held. */
export function contentHtmlCacheSize(): number {
  return cache.size;
}
