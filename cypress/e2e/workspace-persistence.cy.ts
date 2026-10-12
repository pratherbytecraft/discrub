/**
 * Workspaces 2.2.5 WP2a: pages a conversation loads beyond its first are
 * written to the Discrub-workspaces database, a reload brings the
 * conversation back without a fetch, Load All continues from the saved
 * cursor and Start over drops the saved rows and loads from the top.
 */

const CHANNEL = 'general';

/** 100 messages per page, ids descending so `before` cursors walk down. */
function makePage(template: Record<string, unknown>, start: number): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = start - i;
    return {
      ...template,
      id: `71000000000000${String(n).padStart(4, '0')}`,
      content: `page message ${n}`,
      timestamp: new Date(Date.UTC(2026, 1, 1, 0, 0, 0) + n * 60_000).toISOString(),
      reactions: [],
      attachments: [],
      embeds: [],
    };
  });
}

/**
 * A channel with two pages behind it. Call 1 answers page A, call 2 page B,
 * anything later answers nothing. With `freshFirstPageOnCall`, that call
 * answers page A again: the fresh first page Start over asks for.
 */
function interceptPagedChannel(template: Record<string, unknown>, options: { freshFirstPageOnCall?: number } = {}) {
  const pageA = makePage(template, 9000);
  const pageB = makePage(template, 8900);
  let calls = 0;
  cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
    calls += 1;
    const body = calls === 1 || calls === options.freshFirstPageOnCall ? pageA : calls === 2 ? pageB : [];
    req.reply({ statusCode: 200, body });
  }).as('pagedMessages');
}

function countWorkspaceRows() {
  return cy.window({ log: false }).then((win) =>
    new Cypress.Promise<number>((resolve) => {
      const req = win.indexedDB.open('Discrub-workspaces');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('rows')) {
          db.close();
          resolve(0);
          return;
        }
        const count = db.transaction('rows', 'readonly').objectStore('rows').count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => {
          db.close();
          resolve(-1);
        };
      };
      req.onerror = () => resolve(-1);
    }),
  );
}

function openChannelFromDisk() {
  cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
  cy.selectServer('Cypress Test Server');
  cy.contains(CHANNEL).click();
  cy.contains('[data-testid="message-feed-row"]', 'page message 9000', { timeout: 15000 }).should('exist');
}

describe('Workspace persistence (2.2.5)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('keeps the loaded pages across a reload, restores without a fetch, and Load All continues from the cursor', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0]);

      // Opening writes nothing; the second page brings the first with it.
      cy.contains(CHANNEL).click();
      cy.wait('@pagedMessages');
      cy.contains('100 messages').should('be.visible');
      countWorkspaceRows().should('eq', 0);

      cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
      cy.wait('@pagedMessages');
      cy.contains('200 messages').should('be.visible');
      countWorkspaceRows().should('eq', 200);

      // A reload opens the same conversation from disk, no request.
      cy.reload();
      openChannelFromDisk();
      cy.contains('200 messages').should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 2);
      cy.contains('STATUS LOG').click();
      cy.contains('Restored 200 messages from this workspace').should('exist');

      // Load All offers Resume, which asks Discord for what comes after the saved cursor.
      cy.contains('button', 'Load All').click();
      cy.get('[data-testid="load-all-restored-line"]').should('contain', '200 loaded so far in this workspace');
      cy.get('[data-testid="load-all-confirm"]').should('have.text', 'Resume').click();
      cy.wait('@pagedMessages').its('request.url').should('include', 'before=710000000000008801');
      cy.contains('All loaded', { timeout: 15000 }).should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 3);
      cy.contains('200 messages').should('be.visible');
      countWorkspaceRows().should('eq', 200);
    });
  });

  it('Start over drops the saved rows and loads from the top', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0], { freshFirstPageOnCall: 3 });
      cy.contains(CHANNEL).click();
      cy.wait('@pagedMessages');
      cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
      cy.wait('@pagedMessages');
      // The page is on disk before the append reaches Redux, so the count
      // shown means the write finished.
      cy.contains('200 messages').should('be.visible');
      countWorkspaceRows().should('eq', 200);

      cy.reload();
      openChannelFromDisk();
      cy.contains('button', 'Load All').click();
      cy.get('[data-testid="load-all-start-over"]').click();

      // Fresh first page (call 3), then Load All continues from it (call 4, nothing more).
      cy.contains('All loaded', { timeout: 15000 }).should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 4);
      cy.contains('100 messages').should('be.visible');
      countWorkspaceRows().should('eq', 100);
    });
  });
});
