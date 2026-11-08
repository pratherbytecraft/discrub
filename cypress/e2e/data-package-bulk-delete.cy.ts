/// <reference types="cypress" />

/**
 * E2E coverage for the 2.2.8 package bulk delete: Multi-select on the
 * package sidebar, one confirm dialog with real counts, a serial run over
 * several channels with the Left Servers channel skipped, 404s counted as
 * already gone, the queue marks and the status log lines, and the deleted
 * cache so a second pass has nothing left. Plus the filter path and Skip.
 *
 * Fixture: test-package-many.zip. general (200) has 4 messages (one row spans two lines), the DM
 * (300) has 1, "Old Guild Channel" (400) is a Left Servers channel with 1,
 * busy (500) has 60, the named DM (600) has 1.
 */

const API = '**/api/v10';
const PACKAGE_DB = 'Discrub-package';
const PACKAGE_OBJECT_STORE = 'keyval';
const FIXTURE_USER_ID = '111222333444555666';

type CacheMap = Record<string, string[]>;

function openPackageDb(win: Cypress.AUTWindow): PromiseLike<IDBDatabase> {
  return new Cypress.Promise<IDBDatabase>((resolve, reject) => {
    const req = win.indexedDB.open(PACKAGE_DB);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PACKAGE_OBJECT_STORE)) {
        req.result.createObjectStore(PACKAGE_OBJECT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readCache(key: string): Cypress.Chainable<CacheMap | undefined> {
  return cy.window({ log: false }).then((win) =>
    openPackageDb(win).then(
      (db) =>
        new Cypress.Promise<CacheMap | undefined>((resolve, reject) => {
          const tx = db.transaction(PACKAGE_OBJECT_STORE, 'readonly');
          const get = tx.objectStore(PACKAGE_OBJECT_STORE).get(key);
          get.onsuccess = () => { db.close(); resolve(get.result as CacheMap | undefined); };
          get.onerror = () => { db.close(); reject(get.error); };
        }),
    ),
  );
}

function setDelays(settings: Record<string, string>) {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    store.dispatch({ type: 'app/setSettings', payload: { ...store.getState().app.settings, ...settings } });
  });
}

function statusMessages(): Cypress.Chainable<string[]> {
  return cy.window({ log: false }).then((win) => {
    const entries = (win as any).__store__.getState().status.entries as { message: string }[];
    return entries.map((e) => e.message);
  });
}

function tickRow(name: string) {
  cy.get('[data-testid="package-channel-row"]').contains(name).click();
}

describe('Data package bulk delete (2.2.8)', () => {
  beforeEach(() => {
    cy.login();
    cy.uploadPackage('test-package-many.zip');
    cy.contains(/Top channels by message count/i, { timeout: 30000 }).should('be.visible');
    setDelays({ deleteDelay2: '0' });
    cy.intercept('DELETE', `${API}/channels/200/messages/*`, { statusCode: 204 }).as('deleteGeneral');
    cy.intercept('DELETE', `${API}/channels/300/messages/*`, { statusCode: 204 }).as('deleteDm');
    cy.intercept('DELETE', `${API}/channels/400/messages/*`, { statusCode: 204 }).as('deleteLeft');
    cy.intercept('DELETE', `${API}/channels/500/messages/*`, {
      statusCode: 404,
      body: { message: 'Unknown Message', code: 10008 },
    }).as('deleteBusy404');
  });

  it('ticks channels, confirms once, runs them in order, skips the Left Servers one and records every id', () => {
    cy.get('[data-testid="package-multi-select-toggle"]').click();
    // The Left Servers group is collapsed by default; open it to see the row has no checkbox.
    cy.contains('li', 'Left Servers').find('button').last().click();
    cy.get('[data-testid="package-channel-row"]').contains('Old Guild Channel').closest('[data-testid="package-channel-row"]')
      .should('have.attr', 'aria-disabled', 'true')
      .find('[data-testid="package-bulk-tick"]').should('not.exist');

    tickRow('general');
    tickRow('busy');
    tickRow('tester-friend');
    cy.get('[data-testid="multi-select-count"]').should('contain', '3 of');
    cy.get('[data-testid="multi-select-purge"]').should('contain', 'Delete').click();

    cy.get('[data-testid="package-bulk-delete-dialog"]').should('be.visible');
    cy.contains('Delete your messages in 3 Channels').should('be.visible');
    cy.get('[data-testid="package-bulk-delete-row-200"]').should('contain', '4');
    cy.get('[data-testid="package-bulk-delete-row-500"]').should('contain', '60');
    cy.get('[data-testid="package-bulk-delete-row-300"]').should('contain', '1');
    cy.get('[data-testid="package-bulk-delete-total"]').should('have.text', '65');
    cy.get('[data-testid="package-bulk-delete-confirm"]').should('contain', 'Delete 65 messages').click();

    // The run shows in the sidebar and the status log takes over the controls.
    cy.get('[data-testid="package-bulk-running"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-testid="package-bulk-finished"]', { timeout: 90000 })
      .should('contain', 'Done. 5 deleted, 60 already gone, 0 failed.');

    cy.get('@deleteGeneral.all').should('have.length', 4);
    cy.get('@deleteDm.all').should('have.length', 1);
    cy.get('@deleteBusy404.all').should('have.length', 60);
    cy.get('@deleteLeft.all').should('have.length', 0);

    // Every channel of the run carries a done mark, and nothing is ticked any more.
    cy.get('[data-testid="package-bulk-mark-done"]').should('have.length', 3);
    cy.get('[data-testid="package-bulk-tick"]').should('not.exist');

    statusMessages().then((messages) => {
      expect(messages).to.include('Deleting 65 messages across 3 Channels.');
      expect(messages.some((m) => /Deleting 4 messages in general \(Cypress Test Server\)\./.test(m))).to.be.true;
      expect(messages).to.include('Bulk delete finished. 5 deleted, 60 already gone, 0 failed. 3 Channels done, 0 skipped.');
    });

    // The sidebar counts now show what is left, and the caches hold the ids.
    cy.get('[data-testid="package-channel-row"]').contains('general').closest('[data-testid="package-channel-row"]').should('contain', '0');
    readCache(`deleted:${FIXTURE_USER_ID}`).then((cache) => {
      expect(cache).to.have.property('200');
      expect(cache!['200']).to.have.length(4);
      expect(cache!['500']).to.have.length(60);
      expect(cache!['300']).to.have.length(1);
    });
    readCache(`gone:${FIXTURE_USER_ID}`).then((cache) => {
      expect(cache!['500']).to.have.length(60);
      expect(cache).to.not.have.property('200');
    });

    // A second pass over the same channels has nothing left and sends no DELETE.
    cy.get('[data-testid="package-bulk-finished"]').find('button').click();
    cy.get('[data-testid="package-multi-select-toggle"]').click();
    tickRow('general');
    tickRow('busy');
    cy.get('[data-testid="multi-select-purge"]').click();
    cy.get('[data-testid="package-bulk-delete-nothing"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-testid="package-bulk-delete-confirm"]').should('be.disabled');
    cy.get('@deleteGeneral.all').should('have.length', 4);
  });

  // 2.2.9 (GitHub issue 23): the sidebar groups channels under their Server and
  // the Server header's checkbox ticks everything under it.
  it('ticks a whole Server from its header and deletes every channel under it', () => {
    cy.get('[data-testid="package-server-group"]').should('have.length', 1)
      .and('contain', 'Cypress Test Server').and('contain', '2 channels · 64 messages');
    cy.get('[data-testid="package-server-tick"]').should('not.exist');
    cy.get('[data-testid="package-multi-select-toggle"]').click();
    cy.get('[data-testid="package-server-tick"] input').click();
    cy.get('[data-testid="multi-select-count"]').should('contain', '2 of');
    cy.get('[data-testid="package-bulk-tick"] input:checked').should('have.length', 2);

    // One row cleared puts the header on a dash; the header then ticks it back.
    tickRow('busy');
    cy.get('[data-testid="package-server-tick"] input').should('have.attr', 'data-indeterminate', 'true');
    cy.get('[data-testid="package-server-tick"] input').click();
    cy.get('[data-testid="multi-select-count"]').should('contain', '2 of');

    cy.get('[data-testid="multi-select-purge"]').click();
    cy.contains('Delete your messages in 2 Channels').should('be.visible');
    cy.get('[data-testid="package-bulk-delete-total"]').should('have.text', '64');
    cy.get('[data-testid="package-bulk-delete-confirm"]').should('contain', 'Delete 64 messages').click();
    cy.get('[data-testid="package-bulk-finished"]', { timeout: 90000 })
      .should('contain', 'Done. 4 deleted, 60 already gone, 0 failed.');
    cy.get('@deleteGeneral.all').should('have.length', 4);
    cy.get('@deleteBusy404.all').should('have.length', 60);
    cy.get('@deleteDm.all').should('have.length', 0);
  });

  it('applies a content filter to every channel in the run', () => {
    cy.get('[data-testid="package-multi-select-toggle"]').click();
    tickRow('general');
    tickRow('busy');
    cy.get('[data-testid="multi-select-purge"]').click();
    cy.get('[data-testid="package-bulk-delete-total"]').should('have.text', '64');

    cy.get('[data-testid="package-bulk-delete-filters"]').click();
    cy.get('[role="dialog"]').last().find('input[placeholder*="Search message content"]').type('busy message 1');
    cy.get('[role="dialog"]').last().contains('button', /Apply filters/).click();
    // "busy message 1", "busy message 10" to "busy message 19": eleven rows, none in general.
    cy.get('[data-testid="package-bulk-delete-total"]').should('have.text', '11');
    cy.get('[data-testid="package-bulk-delete-row-200"]').should('contain', '0');
    cy.get('[data-testid="package-bulk-delete-filters"]').should('contain', 'Edit filters (1)');
    cy.get('[data-testid="package-bulk-delete-confirm"]').should('contain', 'Delete 11 messages').click();

    cy.get('[data-testid="package-bulk-finished"]', { timeout: 60000 }).should('contain', '0 deleted, 11 already gone');
    cy.get('@deleteBusy404.all').should('have.length', 11);
    cy.get('@deleteGeneral.all').should('have.length', 0);
    statusMessages().then((messages) => {
      expect(messages.some((m) => /^general \(Cypress Test Server\): nothing left to delete\.$/.test(m))).to.be.true;
    });
  });

  it('Skip moves on to the next channel and Stop ends the run', () => {
    // Slow the run down enough to press the controls mid channel.
    setDelays({ deleteDelay2: '1' });
    cy.get('[data-testid="package-multi-select-toggle"]').click();
    tickRow('general');
    tickRow('tester-friend');
    tickRow('named-friend');
    cy.get('[data-testid="multi-select-purge"]').click();
    cy.get('[data-testid="package-bulk-delete-confirm"]', { timeout: 10000 }).should('contain', 'Delete 6 messages').click();

    cy.get('[data-testid="package-bulk-running"]', { timeout: 10000 }).should('contain', 'Deleting Channel 1 of 3');
    cy.wait('@deleteGeneral');
    cy.get('[data-testid="package-bulk-skip"]').click();
    cy.get('[data-testid="package-bulk-running"]', { timeout: 10000 }).should('contain', 'Deleting Channel 2 of 3');
    cy.get('[data-testid="package-bulk-mark-skipped"]').should('have.length', 1);

    // Stop: the status log's stop control sets the shared cancel flag; set it the same way.
    cy.window().then((win) => (win as any).__store__.dispatch({ type: 'app/setDiscrubCancelled', payload: true }));
    cy.get('[data-testid="package-bulk-finished"]', { timeout: 20000 }).should('contain', 'Stopped.');
    cy.get('@deleteGeneral.all').its('length').should('be.lessThan', 4);
    cy.get('@deleteDm.all').its('length').should('be.lessThan', 2);
    statusMessages().then((messages) => {
      expect(messages.some((m) => /skipped at your request/.test(m))).to.be.true;
      expect(messages.some((m) => m.startsWith('Bulk delete stopped.'))).to.be.true;
    });
  });
});
