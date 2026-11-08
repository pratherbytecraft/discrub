import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import { resources } from './index';
import { SUPPORTED_LANGUAGES } from './language';

const flattenEntries = (node: unknown, prefix = ''): Array<[string, unknown]> => {
  if (node === null || typeof node !== 'object') return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flattenEntries(value, prefix ? `${prefix}.${key}` : key),
  );
};
const flatten = (node: unknown): string[] => flattenEntries(node).map(([key]) => key);

/** Everything a translation must carry over untouched: placeholders in both brace styles and tags. */
const marks = (value: string): string[] =>
  (value.match(/\{\{[^}]*\}\}|\{[a-z]+\}|<[^>]+>/gi) ?? []).sort();

const others = SUPPORTED_LANGUAGES.filter((code) => code !== 'en');

describe('locale key parity', () => {
  it.each(others)('%s carries every key en.json has, and nothing extra', (code) => {
    const enKeys = new Set(flatten(en));
    const keys = new Set(flatten(resources[code].translation));
    expect([...enKeys].filter((k) => !keys.has(k))).toEqual([]);
    expect([...keys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  // 2.2.9: a dropped placeholder shows up as raw braces or a missing number in the app.
  it.each(others)('%s keeps every placeholder and tag of the English string', (code) => {
    const translated = new Map(flattenEntries(resources[code].translation));
    const broken = flattenEntries(en)
      .filter(([key, value]) => typeof value === 'string' && !key.startsWith('language.suggestion'))
      .filter(([key, value]) => marks(value as string).join('|') !== marks(String(translated.get(key) ?? '')).join('|'))
      .map(([key]) => key);
    expect(broken).toEqual([]);
  });

  it.each(others)('%s has no empty string', (code) => {
    expect(flattenEntries(resources[code].translation).filter(([, value]) => typeof value !== 'string' || value === '').map(([key]) => key)).toEqual([]);
  });

  it('keeps the system message link phrases inside their sentences in every language', () => {
    for (const code of SUPPORTED_LANGUAGES) {
      const sm = (resources[code].translation as { systemMessage: Record<string, string> }).systemMessage;
      expect(sm.pin).toContain(sm.pinLink);
      expect(sm.threadCreated).toContain(sm.threadsLink);
    }
  });

  it('offers each language in its own words', () => {
    expect((resources.de.translation as { language: Record<string, string> }).language.suggestionToast).toBe('Discrub ist auch auf Deutsch verfügbar.');
    expect((resources.zh.translation as { language: Record<string, string> }).language.suggestionToast).toBe('Discrub 现已支持简体中文。');
    expect((resources.zh.translation as { language: Record<string, string> }).language.suggestionAction).toBe('切换到简体中文');
  });

  it('carries the attachments-only purge keys (#272)', () => {
    for (const key of [
      'operation.partDeleted',
      'operation.partStripped',
      'operation.partFailed',
      'operation.purgingProgress',
      'status.purge.attachmentsOnlySkipped_one',
      'status.purge.attachmentsOnlySkipped_other',
      'status.purge.failureStreakPaused',
      'filters.hasHelp',
    ]) {
      expect(flatten(en)).toContain(key);
    }
  });
});
