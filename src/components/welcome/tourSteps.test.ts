import { describe, it, expect } from 'vitest';
import { tourCatalog } from './tourSteps';

describe('tourCatalog integrity', () => {
  it('every catalog entry has both title and content', () => {
    for (const [key, entry] of Object.entries(tourCatalog)) {
      expect(entry.title, `catalog entry "${key}" missing title`).toBeTruthy();
      expect(entry.content, `catalog entry "${key}" missing content`).toBeTruthy();
    }
  });

  it('catalog keys are kebab-case (no underscores or camelCase)', () => {
    for (const key of Object.keys(tourCatalog)) {
      expect(
        /^[a-z][a-z0-9-]*$/.test(key),
        `catalog key "${key}" should be kebab-case (lowercase + hyphens)`,
      ).toBe(true);
    }
  });
});
