import { describe, expect, it } from 'vitest';
import {
  createEditReplacement,
  generateEditReplacement,
  type EditReplacement,
} from './editReplacement';

const spec = (mode: EditReplacement['mode'], seed = 123456789): EditReplacement => ({ mode, seed });

describe('editReplacement', () => {
  it('creates a random replacement for the requested mode with an integer seed', () => {
    const replacement = createEditReplacement('characters');
    expect(replacement.mode).toBe('characters');
    expect(Number.isInteger(replacement.seed)).toBe(true);
    expect(replacement.seed).toBeGreaterThanOrEqual(0);
    expect(replacement.seed).toBeLessThan(0x100000000);
  });

  it.each(['words', 'sentences', 'characters'] as const)(
    '%s bodies are deterministic for one id and bounded in size',
    (mode) => {
      const first = generateEditReplacement(spec(mode), 'msg-1');
      expect(generateEditReplacement(spec(mode), 'msg-1')).toBe(first);
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBeLessThan(300);
    },
  );

  it.each(['words', 'sentences', 'characters'] as const)(
    '%s bodies differ across ids and across seeds',
    (mode) => {
      const bodies = Array.from({ length: 10 }, (_, i) =>
        generateEditReplacement(spec(mode), `msg-${i}`),
      );
      expect(new Set(bodies).size).toBe(bodies.length);
      expect(generateEditReplacement(spec(mode, 987654321), 'msg-1')).not.toBe(bodies[0]);
    },
  );

  it('words mode produces several lowercase words without adjacent repeats', () => {
    const body = generateEditReplacement(spec('words'), 'msg-1');
    const words = body.split(' ');
    expect(words.length).toBeGreaterThanOrEqual(5);
    expect(words.length).toBeLessThanOrEqual(9);
    expect(words.every((word) => /^[a-z]+$/.test(word))).toBe(true);
    for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1]);
  });

  it('sentences mode produces readable capitalized sentences', () => {
    const body = generateEditReplacement(spec('sentences'), 'msg-1');
    const sentences = body.split('. ').map((sentence) => (sentence.endsWith('.') ? sentence : `${sentence}.`));
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(sentences.every((sentence) => /^[A-Z][^.]*\.$/.test(sentence))).toBe(true);
  });

  it('characters mode produces a compact string without whitespace', () => {
    const body = generateEditReplacement(spec('characters'), 'msg-1');
    expect(body.length).toBeGreaterThanOrEqual(16);
    expect(body.length).toBeLessThanOrEqual(31);
    expect(body).not.toMatch(/\s/);
  });
});
