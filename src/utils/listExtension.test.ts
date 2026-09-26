import { describe, it, expect } from 'vitest';
import { extendedRange, removedFrom } from './listExtension';

describe('extendedRange (2.2.1 perf)', () => {
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' }; const d = { id: 'd' };

  it('finds a page appended at the tail', () => {
    expect(extendedRange([a, b], [a, b, c, d])).toEqual({ from: 2, to: 4, at: 'tail' });
  });

  it('finds a page added at the head', () => {
    expect(extendedRange([c, d], [a, b, c, d])).toEqual({ from: 0, to: 2, at: 'head' });
  });

  it('returns null for the same list, a shorter list, an empty base, or a reordered list', () => {
    const list = [a, b];
    expect(extendedRange(list, list)).toBeNull();
    expect(extendedRange([a, b, c], [a, b])).toBeNull();
    expect(extendedRange([], [a])).toBeNull();
    expect(extendedRange(null, [a])).toBeNull();
    expect(extendedRange([a, b], [b, a, c])).toBeNull();
    expect(extendedRange([a, c], [a, b, c])).toBeNull();
  });
});

describe('removedFrom (2.2.1 perf)', () => {
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' }; const d = { id: 'd' };

  it('lists the elements a delete flush took out', () => {
    expect(removedFrom([a, b, c, d], [a, c])).toEqual([b, d]);
    expect(removedFrom([a, b, c, d], [b, c, d])).toEqual([a]);
  });

  it('returns null for a longer list, a reorder, or a replacement', () => {
    expect(removedFrom([a, b], [a, b, c])).toBeNull();
    expect(removedFrom([a, b, c], [c, a])).toBeNull();
    expect(removedFrom([a, b, c], [a, d])).toBeNull();
    expect(removedFrom([a, b, c], [a, b, c])).toBeNull();
  });
});
