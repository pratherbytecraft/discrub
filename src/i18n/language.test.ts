import { describe, expect, it } from 'vitest';
import { detectBrowserLanguage, isLanguageCode, normalizeLanguage } from './language';

describe('language helpers (#124)', () => {
  it('detects a supported base language from region-qualified tags', () => {
    expect(detectBrowserLanguage(['de-AT', 'en-US'])).toBe('de');
    expect(detectBrowserLanguage(['de_CH'])).toBe('de');
    expect(detectBrowserLanguage(['DE'])).toBe('de');
    expect(detectBrowserLanguage(['zh-CN', 'en-US'])).toBe('zh');
    expect(detectBrowserLanguage(['zh_TW'])).toBe('zh');
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
    expect(normalizeLanguage('zh')).toBe('zh');
    expect(normalizeLanguage('')).toBe('en');
    expect(normalizeLanguage('xx')).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(isLanguageCode('en')).toBe(true);
    expect(isLanguageCode('zh')).toBe(true);
    expect(isLanguageCode('pt')).toBe(false);
  });
});
