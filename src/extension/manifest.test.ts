import { describe, expect, it } from 'vitest';
import chromeManifest from '../../public/manifest.chrome.json';
import firefoxManifest from '../../public/manifest.firefox.json';
import { WORKSPACE_FILE_EXTENSION } from '@/services/workspaceArchive';

/**
 * On Chrome the drip-fs download frame loads an extension URL that ends in
 * the file name. Chrome refuses it without a word unless the name matches a
 * web accessible resource, so every file type Discrub saves needs a pattern
 * (the 2.2.5 workspace file was missed and never downloaded).
 */
describe('extension manifests', () => {
  const downloadTypes = ['zip', WORKSPACE_FILE_EXTENSION];

  for (const [name, manifest] of [
    ['chrome', chromeManifest],
    ['firefox', firefoxManifest],
  ] as const) {
    it(`${name} lets every download type through`, () => {
      const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
      for (const type of downloadTypes) {
        expect(resources).toContain(`*/*.${type}`);
      }
    });
  }
});
