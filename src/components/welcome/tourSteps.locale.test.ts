/**
 * Row 108 (pass 2): ten help popovers stayed English in German because
 * the catalog keys and the locale keys had drifted apart. Every catalog
 * entry has a title and content in both languages.
 */
import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';
import de from '@/i18n/locales/de.json';
import { tourCatalog } from './tourSteps';

const tourOf = (locale: Record<string, unknown>) => locale.tour as Record<string, { title?: string; content?: string }>;

describe('tour catalog locale entries', () => {
  it.each(Object.keys(tourCatalog))('%s has a title and content in English and German', (key) => {
    expect(tourOf(en)[key]).toMatchObject({ title: expect.any(String), content: expect.any(String) });
    expect(tourOf(de)[key]).toMatchObject({ title: expect.any(String), content: expect.any(String) });
  });
});
