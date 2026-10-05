/**
 * Error Logging & Status Log E2E Tests
 *
 * Verifies that errors are captured in the status log,
 * persisted across page reloads, downloadable, and that
 * navigation actions produce status entries.
 */

const API = '**/api/v10';

describe('Error Logging & Status Log', () => {
  // ── REJECTED THUNK → STATUS LOG ───────────────────────────────

  describe('Failed API calls', () => {
    it('logs error to status log when message fetch fails', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');

      // Override the messages intercept to return 500
      cy.intercept('GET', `${API}/channels/*/messages?*`, {
        statusCode: 500,
        body: { message: 'Internal Server Error' },
      }).as('failedMessages');

      cy.contains('general').click();
      cy.wait('@failedMessages');

      // Status log should contain the error
      cy.contains('STATUS LOG').click();
      cy.contains('Failed to fetch messages').should('be.visible');
    });

    it('logs error to status log when search fails', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      // #262: a 5xx is retried with backoff before it fails, so refuse
      // the search with a 403 (not transient) to get the error entry at once.
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 403,
        body: { message: 'Missing Access', code: 50001 },
      }).as('failedSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('test');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@failedSearch');

      cy.contains('STATUS LOG').click();
      cy.contains('Failed to search messages (HTTP 403)').should('be.visible');
    });
  });

  // ── NAVIGATION STATUS ENTRIES ─────────────────────────────────

  describe('Navigation status entries', () => {
    it('logs "Loading servers..." on initial load', () => {
      cy.login();
      cy.contains('STATUS LOG').click();
      cy.contains('Loading servers...').should('be.visible');
    });

    it('logs server name when selecting a server', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('STATUS LOG').click();
      cy.contains('Loading server: Cypress Test Server').should('be.visible');
    });

    it('logs channel name when selecting a channel', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.contains('STATUS LOG').click();
      cy.contains('Loading messages for #general').should('be.visible');
    });

    it('logs "Loading DMs..." when switching to DM tab', () => {
      cy.login();
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
      cy.contains('STATUS LOG').click();
      cy.contains('Loading DMs...').should('be.visible');
    });

    it('logs DM recipient name when selecting a DM', () => {
      cy.login();
      cy.selectDm('alice_dev');
      cy.contains('STATUS LOG').click();
      cy.contains('Loading conversation with alice_dev').should('be.visible');
    });
  });

  // ── DOWNLOAD LOG ──────────────────────────────────────────────

  describe('Download log', () => {
    it('shows download and clear buttons when log has entries', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      // Status log should have entries from loading
      cy.contains('STATUS LOG').should('be.visible');

      // Download and clear buttons should be visible in the header
      cy.get('[aria-label="Download log"]').should('exist');
      cy.get('[aria-label="Clear log"]').should('exist');
    });
  });

  // ── PERSISTENCE ───────────────────────────────────────────────

  describe('Log persistence', () => {
    it('persists status log entries across page reloads', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      // Wait for some status entries to be logged
      cy.contains('STATUS LOG').click();
      cy.wait(500);

      // Verify entries exist via the per-purpose Discrub-statuslog DB.
      cy.readIdbStore('statuslog').then((entries) => {
        expect(entries.length).to.be.greaterThan(0);
      });

      // Reload (without wiping IDB — the global beforeEach already ran for
      // this test and the migration marker prevents anything from getting
      // re-seeded). cy.visit on the same origin keeps the existing DB.
      cy.interceptDiscordApi();
      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');

      // Status log should still have entries from previous session
      cy.contains('STATUS LOG').click();
      cy.readIdbStore('statuslog').then((entries) => {
        expect(entries.length).to.be.greaterThan(0);
      });
    });

    it('clears persisted log when Clear button is clicked', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      // Wait for entries
      cy.contains('STATUS LOG').click();
      cy.wait(500);

      // Verify entries exist
      cy.readIdbStore('statuslog').then((entries) => {
        expect(entries.length).to.be.greaterThan(0);
      });

      // Click clear button
      cy.get('[aria-label="Clear log"]').click({ force: true });

      // IDB statuslog DB should be empty after clear.
      cy.readIdbStore('statuslog').then((entries) => {
        expect(entries.length).to.equal(0);
      });
    });
  });

  // ── SCROLL-TO-LOAD ────────────────────────────────────────────

  describe('Log capacity', () => {
    it('persists status entries to the Discrub-statuslog IDB store', () => {
      cy.login();

      // #183 introduced a 250ms coalesced write buffer in front of the
      // statuslog IDB store; entries sit in memory briefly before
      // flushing. The buffer's tick is fixed, so a single short wait
      // is sufficient and avoids polling churn.
      cy.wait(300);
      cy.readIdbStore<{ message: string }>('statuslog').then((entries) => {
        expect(entries.length).to.be.greaterThan(0);
        expect(entries.some((e) => e.message === 'New session established')).to.be.true;
      });
    });
  });

  // ── SESSION MARKER ─────────────────────────────────────────────

  describe('Session marker', () => {
    it('logs "New session established" on app startup', () => {
      cy.login();
      cy.contains('STATUS LOG').click();
      cy.contains('New session established').should('be.visible');
    });

    it('shows a new session marker after page reload', () => {
      cy.login();

      // #183 buffers status writes for 250ms. We must let the first
      // session marker hit IDB before reloading; otherwise the
      // in-memory buffer is discarded when the page unloads and we end
      // up with only the post-reload marker. The buffer flush on
      // unload is a separate gap tracked under #183's remaining arms.
      cy.wait(300);

      // Reload
      cy.interceptDiscordApi();
      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');

      cy.contains('STATUS LOG').click();
      cy.wait(300);
      cy.readIdbStore<{ level: string }>('statuslog').then((entries) => {
        const sessionEntries = entries.filter((e) => e.level === 'session');
        expect(sessionEntries.length).to.be.greaterThan(1);
      });
    });
  });

  // ── ERROR BOUNDARY ────────────────────────────────────────────

  describe('Error Boundary', () => {
    it('app loads without showing error boundary', () => {
      cy.login();
      cy.contains('Something went wrong').should('not.exist');
      cy.get('[aria-label="Your profile, Discrub Tester"]').should('be.visible');
    });
  });
});
