import { describe, it, expect } from 'vitest';
import { LAYOUT_SHELLS, resolveShell } from './registry';
import { DEFAULT_LAYOUT, LAYOUT_KEYS, isLayoutKey } from './types';
import ClassicShell from './classic/ClassicShell';

describe('layout registry', () => {
  it('ships Classic and resolves it by default', () => {
    expect(LAYOUT_SHELLS.classic).toBe(ClassicShell);
    expect(resolveShell(undefined)).toBe(ClassicShell);
    expect(resolveShell(DEFAULT_LAYOUT)).toBe(ClassicShell);
  });

  it('resolves Native and falls back to Classic for a layout that is not built yet', () => {
    expect(resolveShell('native')).not.toBe(ClassicShell);
    expect(resolveShell('timeline')).toBe(ClassicShell);
  });

  it('recognises the six layout keys and nothing else', () => {
    for (const key of LAYOUT_KEYS) expect(isLayoutKey(key)).toBe(true);
    expect(isLayoutKey('Classic')).toBe(false);
    expect(isLayoutKey(undefined)).toBe(false);
    expect(isLayoutKey(3)).toBe(false);
  });
});
