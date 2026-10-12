import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetup = vi.fn<[], string>();
vi.mock('@services/compatibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/compatibility')>();
  return { ...actual, detectCompatSetup: () => mockSetup() };
});

describe('defaultMaxZipPartBytes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is 4 GB on streaming setups', async () => {
    mockSetup.mockReturnValue('chrome-ext');
    const m = await import('./exportTypes');
    expect(m.defaultMaxZipPartBytes()).toBe(m.DEFAULT_MAX_ZIP_PART_BYTES);
    expect(m.initialExportState.maxZipPartBytes).toBe(4_000_000_000);
    expect(m.resolveMaxZipPartBytes({})).toBe(4_000_000_000);
  });

  it('is 500 MB on the Firefox extension and phones', async () => {
    for (const setup of ['firefox-ext', 'be-phone']) {
      vi.resetModules();
      mockSetup.mockReturnValue(setup);
      const m = await import('./exportTypes');
      expect(m.defaultMaxZipPartBytes()).toBe(m.SMALL_MAX_ZIP_PART_BYTES);
      expect(m.initialExportState.maxZipPartBytes).toBe(500_000_000);
      expect(m.resolveMaxZipPartBytes({})).toBe(500_000_000);
      // Saved sizes win over the context default; the old single zip does not.
      expect(m.resolveMaxZipPartBytes({ maxZipPartBytes: null })).toBe(500_000_000);
      expect(m.resolveMaxZipPartBytes({ maxZipPartBytes: 2_000_000_000 })).toBe(2_000_000_000);
    }
  });

  it('offers 500 MB in the size options', async () => {
    mockSetup.mockReturnValue('chrome-ext');
    const m = await import('./exportTypes');
    expect(m.ZIP_SIZE_OPTIONS.map((o) => o.value)).toContain(500_000_000);
  });
});
