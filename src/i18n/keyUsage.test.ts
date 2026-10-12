import { describe, expect, it } from 'vitest';
import en from './locales/en.json';

/**
 * Every literal key the code hands to t() exists in en.json (2.2.5 pass 2,
 * row 74: a key added under the wrong parent printed raw in the app).
 * Keys built at run time are not checked; plural and context forms count
 * when any key starts with the literal key and an underscore.
 */
const flatten = (node: unknown, prefix = ''): string[] => {
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
};

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.stories.tsx', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const CALL = /\bt\(\s*(['"])([a-zA-Z][\w-]*(?:\.[\w-]+)+)\1/g;

describe('translation keys used in code', () => {
  it('exist in en.json', () => {
    const keys = flatten(en);
    const known = new Set(keys);
    const missing: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const match of text.matchAll(CALL)) {
        const key = match[2];
        if (known.has(key)) continue;
        if (keys.some((k) => k.startsWith(`${key}_`))) continue;
        missing.push(`${file.replace('../', 'src/')}: ${key}`);
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
