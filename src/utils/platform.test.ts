import { describe, it, expect } from 'vitest';
import { isMacOS } from './platform';

const nav = (o: Partial<Navigator> & { userAgentData?: { platform?: string } }) => o as unknown as Navigator;

describe('isMacOS', () => {
  it('trusts the user agent hint first', () => {
    expect(isMacOS(nav({ userAgentData: { platform: 'macOS' }, platform: 'Win32', userAgent: '' }))).toBe(true);
    expect(isMacOS(nav({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel', userAgent: '' }))).toBe(false);
  });
  it('falls back to platform and the user agent', () => {
    expect(isMacOS(nav({ platform: 'MacIntel', userAgent: '' }))).toBe(true);
    expect(isMacOS(nav({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }))).toBe(true);
    expect(isMacOS(nav({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }))).toBe(false);
  });
});
