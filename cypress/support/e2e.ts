/// <reference types="cypress" />

import './commands';

// Suppress uncaught exceptions from the app (e.g., extension-mode checks)
Cypress.on('uncaught:exception', () => {
  return false;
});

/**
 * Cypress wipes localStorage and cookies between tests automatically,
 * but NOT IndexedDB. After our storage migration to IDB-backed
 * `storage.ts` (per-purpose databases under the `Discrub-` prefix),
 * persisted settings/cache/etc. leak across tests and cause
 * order-dependent flakes.
 *
 * Defense in depth — clear in both places:
 *   1. `beforeEach` here, against whatever AUT window the previous test
 *      left behind. Handles the most common case (test N→N+1).
 *   2. Inside `cy.login()` (see commands.ts), AFTER `cy.visit()` puts
 *      the AUT on localhost:3000. Handles the first-test-of-session
 *      case where (1) might run against about:blank.
 *
 * Also wipes the legacy `keyval-store` database so tests that exercise
 * the migration path can reseed it deterministically.
 */
const DBS_TO_WIPE = [
  'Discrub-settings',
  'Discrub-state',
  'Discrub-presets',
  'Discrub-cache',
  'Discrub-history',
  'Discrub-statuslog',
  'Discrub-package',
  'Discrub-media',
  'Discrub-workspaces',
  'keyval-store',
];

function deleteAll(win: Cypress.AUTWindow) {
  return new Cypress.Promise<void>((resolve) => {
    let remaining = DBS_TO_WIPE.length;
    const done = () => {
      if (--remaining <= 0) resolve();
    };
    for (const name of DBS_TO_WIPE) {
      try {
        const req = win.indexedDB.deleteDatabase(name);
        req.onsuccess = done;
        req.onerror = done;
        req.onblocked = done;
      } catch {
        done();
      }
    }
  });
}

beforeEach(() => {
  cy.window({ log: false }).then((win) => deleteAll(win));
});
