/// <reference types="cypress" />

/**
 * E2E coverage for #271: a package purge over messages that are already
 * gone on Discord (deleted by the live purge after the package was
 * exported). Every DELETE answers 404. The run must say so as it goes,
 * finish far faster than one Delete Delay per message, end on a warning
 * rather than a green "success", record the ids as gone (not "deleted
 * via Discrub"), and skip them on the next run.
 *
 * Fixture: test-package-many.zip ships channel "busy" (id 500) with
 * message IDs 5001..5060 on top of the base package.
 */

const API = '**/api/v10';
const PACKAGE_DB = 'Discrub-package';
const PACKAGE_OBJECT_STORE = 'keyval';
const FIXTURE_USER_ID = '111222333444555666';
const BUSY_IDS = Array.from({ length: 60 }, (_, i) => String(5001 + i));

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
          get.onsuccess = () => {
            db.close();
            resolve(get.result as CacheMap | undefined);
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        }),
    ),
  );
}

function setDelays(settings: Record<string, string>) {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    store.dispatch({
      type: 'app/setSettings',
      payload: { ...store.getState().app.settings, ...settings },
    });
  });
}

function statusMessages(): Cypress.Chainable<string[]> {
  return cy.window({ log: false }).then((win) => {
    const entries = (win as any).__store__.getState().status.entries as { message: string }[];
    return entries.map((e) => e.message);
  });
}

describe('Data package purge over already-gone messages (#271)', () => {
  describe('every DELETE answers 404', () => {
    beforeEach(() => {
      cy.login();
      cy.uploadPackage('test-package-many.zip');
      cy.contains('busy').click();
      cy.contains('busy message 60').should('be.visible');
      // One second per message would be a minute for 60 rows. A 404 only
      // pays a short floor, so the whole run should take a fraction.
      setDelays({ deleteDelay2: '1' });
      cy.intercept('DELETE', `${API}/channels/500/messages/*`, {
        statusCode: 404,
        body: { message: 'Unknown Message', code: 10008 },
      }).as('delete404');
    });

    it('reports progress, finishes fast, warns, and records the ids as gone', () => {
      cy.get('input[aria-label="Select all messages"]').click();
      cy.contains(/60 selected/).should('be.visible');
      cy.contains('button', /Delete selected/i).click();
      // 60 rows is under the hint threshold.
      cy.get('[data-testid="package-delete-rehydrate-hint"]').should('not.exist');

      let startedAt = 0;
      cy.then(() => {
        startedAt = Date.now();
      });
      cy.get('[role="dialog"]').contains('button', 'Delete').click();

      // "Deleting N of 60" advances while the run is going.
      cy.contains(/Deleting \d+ of 60/, { timeout: 10000 }).should('exist');

      cy.contains(/Nothing to delete\. All 60 messages were already gone on Discord\./, { timeout: 45000 })
        .should('be.visible')
        .closest('[role="alert"]')
        .should('have.class', 'MuiAlert-colorWarning');
      cy.then(() => {
        const elapsed = Date.now() - startedAt;
        // 59 full waits would be about 59 s; the floor makes it about 15 s.
        expect(elapsed, 'run time with the 404 floor').to.be.lessThan(35000);
      });

      cy.get('@delete404.all').should('have.length', 60);

      // The periodic line at 50 and the rehydrate hint at the end.
      statusMessages().then((messages) => {
        expect(messages).to.include('50 of the 50 messages tried so far were already gone on Discord.');
        expect(messages.some((m) => /Rehydrate this channel first to skip messages that are already gone/.test(m))).to.be.true;
      });

      // Honest caption and provenance: gone, not "deleted via Discrub".
      cy.contains(/60 gone from Discord/).should('be.visible');
      cy.contains(/previously deleted/).should('not.exist');
      // Newest first, so 5060 is the row that is actually rendered.
      cy.get('input[aria-label="Select message 5060"]').should('be.disabled');

      // Both caches hold the ids: the union under deleted:, the subset under gone:.
      readCache(`deleted:${FIXTURE_USER_ID}`).then((cache) => {
        expect(cache).to.have.property('500');
        expect([...(cache!['500'] ?? [])].sort()).to.deep.equal([...BUSY_IDS].sort());
      });
      readCache(`gone:${FIXTURE_USER_ID}`).then((cache) => {
        expect(cache).to.have.property('500');
        expect([...(cache!['500'] ?? [])].sort()).to.deep.equal([...BUSY_IDS].sort());
      });

      // A second attempt has nothing selectable left, so no DELETE goes out.
      cy.get('input[aria-label="Select all messages"]').should('be.disabled');
      cy.contains('button', /Delete selected/i).should('be.disabled');
      cy.get('@delete404.all').should('have.length', 60);
    });
  });

  // 2.2.10: a package channel can be an archived thread. Discord refuses a
  // delete inside one with 400 code 50083 until the thread is reopened.
  describe('the channel is an archived thread', () => {
    beforeEach(() => {
      cy.login();
      cy.uploadPackage('test-package-many.zip');
      cy.contains('busy').click();
      cy.contains('busy message 60').should('be.visible');
      setDelays({ deleteDelay2: '0', delayModifier2: '0' });
    });

    it('reopens the thread once, deletes every message, and archives it again', () => {
      let open = false;
      const toggles: boolean[] = [];
      const answers: number[] = [];
      cy.intercept('PATCH', `${API}/channels/500`, (req) => {
        toggles.push(req.body.archived);
        open = !req.body.archived;
        req.reply({ statusCode: 200, body: {} });
      });
      cy.intercept('DELETE', `${API}/channels/500/messages/*`, (req) => {
        answers.push(open ? 204 : 400);
        if (open) req.reply({ statusCode: 204, body: {} });
        else req.reply({ statusCode: 400, body: { message: 'Thread is archived', code: 50083 } });
      });

      cy.get('input[aria-label="Select all messages"]').click();
      cy.contains(/60 selected/).should('be.visible');
      cy.contains('button', /Delete selected/i).click();
      cy.get('[role="dialog"]').contains('button', 'Delete').click();

      cy.window({ timeout: 60000 }).should((win) => {
        const messages = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(messages).to.include('Re-archived thread 500');
      });
      cy.then(() => {
        expect(toggles, 'reopened once, archived again at the end').to.deep.eq([false, true]);
        expect(answers.filter((a) => a === 400), 'one refusal').to.have.length(1);
        expect(answers.filter((a) => a === 204), 'every message deleted').to.have.length(60);
      });
      statusMessages().then((messages) => {
        expect(messages).to.include('Un-archived thread 500 to process its messages (will re-archive after)');
        expect(messages.some((m) => /HTTP 400/.test(m)), 'no failed delete line').to.eq(false);
      });
      cy.get('input[aria-label="Select all messages"]').should('be.disabled');
    });

    it('a thread that cannot be reopened makes one call and one line, not sixty failures', () => {
      const answers: number[] = [];
      cy.intercept('PATCH', `${API}/channels/500`, { statusCode: 403, body: { message: 'Missing Permissions', code: 50013 } }).as('reopen');
      cy.intercept('DELETE', `${API}/channels/500/messages/*`, (req) => {
        answers.push(400);
        req.reply({ statusCode: 400, body: { message: 'Thread is archived', code: 50083 } });
      });

      cy.get('input[aria-label="Select all messages"]').click();
      cy.contains('button', /Delete selected/i).click();
      cy.get('[role="dialog"]').contains('button', 'Delete').click();

      cy.window({ timeout: 60000 }).should((win) => {
        expect((win as any).__store__.getState().package.deleteStatus).to.eq('ready');
        expect((win as any).__store__.getState().package.deleteResult?.forbidden).to.eq(60);
      });
      cy.then(() => expect(answers, 'only the first delete was sent').to.have.length(1));
      cy.get('@reopen.all').should('have.length', 1);
      statusMessages().then((messages) => {
        expect(messages.filter((m) => /un-archive thread 500/.test(m))).to.have.length(1);
        expect(messages.some((m) => /HTTP 400/.test(m))).to.eq(false);
      });
    });
  });

  describe('rehydrate first, then purge', () => {
    beforeEach(() => {
      cy.login();
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      setDelays({ searchDelay2: '0', deleteDelay2: '0' });
      // Short-circuit the author-scoped search preflight so the AROUND
      // loop the test mocks actually runs (see data-package-rehydration).
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 200,
        body: { messages: [], total_results: 0 },
      }).as('searchPreflight');
      cy.intercept('GET', `${API}/channels/200/messages?limit=50&around=*`, {
        statusCode: 404,
        body: { message: 'Unknown Message', code: 10008 },
      }).as('enrichCall');
      cy.intercept('DELETE', `${API}/channels/200/messages/*`, {
        statusCode: 204,
      }).as('deleteMsg');
    });

    it('selects no rows rehydration found gone and sends no DELETE', () => {
      cy.contains('button', /Load rich data/i).click();
      cy.wait('@enrichCall');
      cy.wait('@enrichCall');
      cy.wait('@enrichCall');
      cy.wait('@enrichCall');
      cy.contains(/4 unavailable/i, { timeout: 10000 }).should('exist');

      cy.get('input[aria-label="Select all messages"]').should('be.disabled');
      cy.contains('button', /Delete selected/i).should('be.disabled');
      cy.get('input[aria-label="Select message 1001"]').should('be.disabled');
      cy.get('@deleteMsg.all').should('have.length', 0);
    });
  });
});
