import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_PRESETS,
  defaultTextFormatOptions,
  initialExportState,
  resolveMaxZipPartBytes,
  DEFAULT_MAX_ZIP_PART_BYTES,
  ZIP_SIZE_OPTIONS,
} from './exportTypes';

describe('resolveMaxZipPartBytes (#207 Arm A)', () => {
  it('treats undefined as the safe default (protects pre-existing presets)', () => {
    expect(resolveMaxZipPartBytes({})).toBe(DEFAULT_MAX_ZIP_PART_BYTES);
    expect(resolveMaxZipPartBytes({ maxZipPartBytes: undefined })).toBe(DEFAULT_MAX_ZIP_PART_BYTES);
  });

  it('treats null from the old single zip choice as the default', () => {
    expect(resolveMaxZipPartBytes({ maxZipPartBytes: null })).toBe(DEFAULT_MAX_ZIP_PART_BYTES);
  });

  it('offers no single zip choice', () => {
    expect(ZIP_SIZE_OPTIONS.every((o) => typeof o.value === 'number' && o.value > 0)).toBe(true);
  });

  it('passes a concrete byte value through', () => {
    expect(resolveMaxZipPartBytes({ maxZipPartBytes: 2_000_000_000 })).toBe(2_000_000_000);
  });

  it('defaults the export state to the safe default and stays under 4 GiB', () => {
    expect(initialExportState.maxZipPartBytes).toBe(DEFAULT_MAX_ZIP_PART_BYTES);
    expect(DEFAULT_MAX_ZIP_PART_BYTES).toBeLessThan(0xffffffff);
  });
});

describe('exportTypes — Plain Text (#184)', () => {
  it('exposes the four defaults that match the signed-off format', () => {
    expect(defaultTextFormatOptions).toEqual({
      attachmentStyle: 'inline',
      reactions: 'include',
      replies: 'quote',
      botIndicator: 'include',
    });
  });

  it('seeds initialExportState.textOptions with the same defaults', () => {
    expect(initialExportState.textOptions).toEqual(defaultTextFormatOptions);
  });

  it('does NOT default the format to text (HTML stays the boot default)', () => {
    expect(initialExportState.exportFormat).toBe('html');
  });

  it('includes a builtin Plain Text preset with the agreed shape', () => {
    const plain = BUILT_IN_PRESETS.find((p) => p.id === 'builtin-plain-text');
    expect(plain).toBeDefined();
    expect(plain!).toMatchObject({
      id: 'builtin-plain-text',
      name: 'Plain text',
      isBuiltIn: true,
      category: 'Backup',
      format: 'text',
      includeMedia: false,
      separateThreads: false,
    });
    expect(plain!.textOptions).toEqual(defaultTextFormatOptions);
  });
});
