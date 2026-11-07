import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import de from './locales/de.json';
import zh from './locales/zh.json';

const flatten = (node: unknown, prefix = ''): string[] => {
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
};

describe('locale key parity', () => {
  it('de.json carries every key en.json has, and nothing extra', () => {
    const enKeys = new Set(flatten(en));
    const deKeys = new Set(flatten(de));
    const missingInDe = [...enKeys].filter((k) => !deKeys.has(k));
    const extraInDe = [...deKeys].filter((k) => !enKeys.has(k));
    expect(missingInDe).toEqual([]);
    expect(extraInDe).toEqual([]);
  });

  it('zh.json carries every key en.json has, and nothing extra', () => {
    const enKeys = new Set(flatten(en));
    const zhKeys = new Set(flatten(zh));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const extraInZh = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(missingInZh).toEqual([]);
    expect(extraInZh).toEqual([]);
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
