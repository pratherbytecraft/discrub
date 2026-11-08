import { describe, expect, it } from 'vitest';
import { detectBrowserLanguage, isLanguageCode, LANGUAGE_LABELS, LANGUAGE_TAGS, normalizeLanguage } from './language';

describe('language helpers (#124)', () => {
  it('detects a supported base language from region-qualified tags', () => {
    expect(detectBrowserLanguage(['de-AT', 'en-US'])).toBe('de');
    expect(detectBrowserLanguage(['de_CH'])).toBe('de');
    expect(detectBrowserLanguage(['DE'])).toBe('de');
  });

  // 2.2.9: the zh catalog is Simplified Chinese.
  it('matches Simplified Chinese tags and leaves Traditional readers alone', () => {
    expect(detectBrowserLanguage(['zh'])).toBe('zh');
    expect(detectBrowserLanguage(['zh-CN', 'en'])).toBe('zh');
    expect(detectBrowserLanguage(['zh-SG'])).toBe('zh');
    expect(detectBrowserLanguage(['zh-Hans-CN'])).toBe('zh');
    expect(detectBrowserLanguage(['zh-TW', 'en-US'])).toBe('en');
    expect(detectBrowserLanguage(['zh-HK'])).toBe('en');
    expect(detectBrowserLanguage(['zh-Hant-TW', 'de'])).toBe('de');
    // A Traditional first choice does not hide a Simplified second one.
    expect(detectBrowserLanguage(['zh-TW', 'zh-CN'])).toBe('zh');
  });

  it('labels and tags Chinese as Simplified', () => {
    expect(LANGUAGE_LABELS.zh).toBe('简体中文');
    expect(LANGUAGE_TAGS).toEqual({ en: 'en', de: 'de', zh: 'zh-CN' });
    expect(normalizeLanguage('zh')).toBe('zh');
  });

  it('takes the first supported entry, not the first entry', () => {
    expect(detectBrowserLanguage(['fr-FR', 'de-DE', 'en'])).toBe('de');
  });

  it('falls back to English when nothing is supported or nothing is known', () => {
    expect(detectBrowserLanguage(['fr-FR', 'ja'])).toBe('en');
    expect(detectBrowserLanguage([])).toBe('en');
    expect(detectBrowserLanguage(undefined)).toBe('en');
  });

  it('normalizes stored values to a supported code', () => {
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('')).toBe('en');
    expect(normalizeLanguage('xx')).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(isLanguageCode('en')).toBe(true);
    expect(isLanguageCode('pt')).toBe(false);
  });
});
