import { describe, it, expect, vi, beforeEach } from 'vitest';

const formatContentAsHtml = vi.fn((raw: string) => `<p>${raw}</p>`);
vi.mock('discrub-core/html-formatting-utils', () => ({ formatContentAsHtml: (...args: unknown[]) => formatContentAsHtml(...(args as [string])) }));

import { getContentHtml, clearContentHtmlCache, contentHtmlCacheSize, CONTENT_HTML_CACHE_LIMIT } from './contentHtmlCache';

const ctx = { userMap: {}, channelMap: {}, guildRoles: [] } as any;

describe('contentHtmlCache', () => {
  beforeEach(() => {
    clearContentHtmlCache();
    formatContentAsHtml.mockClear();
  });

  it('renders once per message and serves the second ask from the cache', () => {
    expect(getContentHtml('m1', null, 'hello', ctx)).toBe('<p>hello</p>');
    expect(getContentHtml('m1', null, 'hello', ctx)).toBe('<p>hello</p>');
    expect(formatContentAsHtml).toHaveBeenCalledTimes(1);
  });

  it('returns an empty string for empty content without rendering', () => {
    expect(getContentHtml('m1', null, '', ctx)).toBe('');
    expect(formatContentAsHtml).not.toHaveBeenCalled();
    expect(contentHtmlCacheSize()).toBe(0);
  });

  it('renders again when the message was edited', () => {
    getContentHtml('m1', null, 'hello', ctx);
    getContentHtml('m1', '2026-10-18T10:00:00.000Z', 'hello there', ctx);
    expect(formatContentAsHtml).toHaveBeenCalledTimes(2);
  });

  it('keeps one entry per formatting context, since mentions and channels resolve through it', () => {
    const other = { userMap: {}, channelMap: {}, guildRoles: [] } as any;
    getContentHtml('m1', null, 'hello', ctx);
    getContentHtml('m1', null, 'hello', other);
    expect(formatContentAsHtml).toHaveBeenCalledTimes(2);
    expect(contentHtmlCacheSize()).toBe(2);
  });

  it('drops the oldest entries past the limit and keeps a recently read one', () => {
    getContentHtml('first', null, 'x', ctx);
    for (let i = 0; i < CONTENT_HTML_CACHE_LIMIT - 1; i++) getContentHtml(`m${i}`, null, 'x', ctx);
    expect(contentHtmlCacheSize()).toBe(CONTENT_HTML_CACHE_LIMIT);
    // Reading refreshes `first`, so the next insert evicts m0 instead.
    getContentHtml('first', null, 'x', ctx);
    getContentHtml('overflow', null, 'x', ctx);
    expect(contentHtmlCacheSize()).toBe(CONTENT_HTML_CACHE_LIMIT);
    formatContentAsHtml.mockClear();
    getContentHtml('first', null, 'x', ctx);
    expect(formatContentAsHtml).not.toHaveBeenCalled();
    getContentHtml('m0', null, 'x', ctx);
    expect(formatContentAsHtml).toHaveBeenCalledTimes(1);
  });
});
