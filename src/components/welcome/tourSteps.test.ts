import { describe, it, expect } from 'vitest';
import { shellTourSteps, contextualTourSteps, tourCatalog } from './tourSteps';

/**
 * Integrity guards for the tour-step target catalog.
 *
 * Bug 3 (2026-04-17): a contextual tour step targeted
 * `[data-tour="multi-select-toggle"]` which only existed on ChannelList.
 * When a user landed in DMs on cold boot, the target was missing and
 * Joyride rendered an orphan gray overlay blocking all clicks.
 *
 * These tests don't render the app (too expensive and fragile) —
 * instead, they validate the shape of every step target string and
 * assert that each selector is one of a known-stable set. Whenever
 * someone adds a new tour step, they have to also declare the
 * selector safe by adding it to `KNOWN_SAFE_SELECTORS` below, which
 * forces a human check that the target is always rendered in every
 * view where the tour could fire.
 */

/**
 * Selectors that are always rendered in the UI shell (Sidebar /
 * TopBar / StatusPanel / message view). Safe to use as tour targets.
 */
const KNOWN_SAFE_SELECTORS: readonly string[] = [
  // Sidebar (Servers / DMs / Package tabs + search)
  '[data-tour="servers-tab"]',
  '[data-tour="dms-tab"]',
  '[data-tour="package-tab"]',
  '[data-tour="sidebar-search"]',
  // TopBar actions
  '[aria-label="Settings"]',
  '[data-testid="gift-button"]',
  '[data-tour="topbar-extras"]',
  '[data-tour="user-profile"]',
  // StatusPanel — always in MainLayout
  '[data-tour="status-panel"]',
  // Multi-select — both ChannelList and DMList must carry this
  '[data-tour="multi-select-toggle"]',
  // Channel/DM message-view elements (ServerView)
  '[data-tour="export-button"]',
  '[data-tour="analytics-button"]',
  '[data-tour="search-filters"]',
  // 2.0.2 refresh: message-table → message-feed (the table component
  // was deleted in #111; this anchor lives on the MessageFeed Paper).
  '[data-tour="message-feed"]',
  // First message chunk's avatar — anchor for the "Author actions"
  // tour step that introduces #129's quick-filter buttons.
  '[data-tour="author-avatar"]',
  // Focus-mode toolbar button (#118).
  '[data-tour="focus-button"]',
];

describe('tour step integrity', () => {
  for (const [name, steps] of [
    ['shellTourSteps', shellTourSteps],
    ['contextualTourSteps', contextualTourSteps],
  ] as const) {
    describe(name, () => {
      it('every step has a non-empty target selector', () => {
        for (const step of steps) {
          expect(typeof step.target).toBe('string');
          expect((step.target as string).length).toBeGreaterThan(0);
        }
      });

      it('every step target is in the known-safe selector list', () => {
        for (const step of steps) {
          expect(
            KNOWN_SAFE_SELECTORS.includes(step.target as string),
            `Tour step "${step.title ?? step.target}" uses selector "${step.target}" ` +
              'which is not in KNOWN_SAFE_SELECTORS. Either ensure the selector is ' +
              'always rendered in every view where this tour can fire and add it to ' +
              'the list, or pick a different selector. See Bug 3 in ' +
              'memory/project_active_bugs.md for context.',
          ).toBe(true);
        }
      });

      it('every step has a title and content for UX completeness', () => {
        for (const step of steps) {
          expect(step.title, `step ${step.target} missing title`).toBeTruthy();
          expect(step.content, `step ${step.target} missing content`).toBeTruthy();
        }
      });
    });
  }
});

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

  it('every shell-tour step pulls its title/content from the catalog', () => {
    // The composing step() helper guarantees this — but if someone hand-
    // writes a step with literal strings, this catches the drift.
    for (const step of shellTourSteps) {
      const matchingEntry = Object.values(tourCatalog).find(
        (e) => e.title === step.title && e.content === step.content,
      );
      expect(
        matchingEntry,
        `shell tour step "${step.title}" copy doesn't match any catalog entry`,
      ).toBeDefined();
    }
  });

  it('every contextual-tour step pulls its title/content from the catalog', () => {
    for (const step of contextualTourSteps) {
      const matchingEntry = Object.values(tourCatalog).find(
        (e) => e.title === step.title && e.content === step.content,
      );
      expect(
        matchingEntry,
        `contextual tour step "${step.title}" copy doesn't match any catalog entry`,
      ).toBeDefined();
    }
  });
});
