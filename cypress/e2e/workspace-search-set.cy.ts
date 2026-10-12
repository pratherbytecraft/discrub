/**
 * 2.2.5 fix C: a search keeps its results beside the conversation's plain
 * rows. A search never overwrites the saved conversation, clearing it
 * returns to the plain rows, leaving and coming back shows the search, and
 * the filtered Load All dialog does not read the plain figures.
 */

const API = '**/api/v10';
const CHANNEL = 'general';

function makePage(template: Record<string, unknown>, start: number): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = start - i;
    return {
      ...template,
      id: `71000000000000${String(n).padStart(4, '0')}`,
      content: `page message ${n}`,
      timestamp: new Date(Date.UTC(2026, 1, 1) + n * 60_000).toISOString(),
      reactions: [],
      attachments: [],
      embeds: [],
    };
  });
}

/** Call 1 answers page A, call 2 page B, any later call page A again (a fresh open). */
function interceptPagedChannel(template: Record<string, unknown>) {
  const pageA = makePage(template, 9000);
  const pageB = makePage(template, 8900);
  let calls = 0;
  cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
    calls += 1;
    req.reply({ statusCode: 200, body: calls === 2 ? pageB : pageA });
  }).as('pagedMessages');
}

function countRowsUnder(prefix: string) {
  return cy.window({ log: false }).then((win) =>
    new Cypress.Promise<number>((resolve) => {
      const req = win.indexedDB.open('Discrub-workspaces');
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction('rows', 'readonly').objectStore('rows').getAllKeys();
        all.onsuccess = () => {
          db.close();
          resolve((all.result as string[][]).filter((k) => k[1] === prefix).length);
        };
        all.onerror = () => { db.close(); resolve(-1); };
      };
      req.onerror = () => resolve(-1);
    }),
  );
}

const channelId = () => cy.window().its('__store__').then((s: any) => s.getState().channel.selectedChannel.id as string);

const searchFor = (content: string) => {
  cy.contains('button', 'Filters').click();
  cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').clear().type(content);
  cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
};

function loadTwoPagesAndSearch(totalResults?: number, reopenFirst = false) {
  cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
    interceptPagedChannel(messages[0]);
    cy.contains(CHANNEL).click();
    cy.wait('@pagedMessages');
    cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
    cy.wait('@pagedMessages');
    cy.contains('200 messages').should('be.visible');
  });
  if (reopenFirst) {
    // Opened again from disk, so the view carries the restored figures.
    cy.contains('dev-chat').click();
    cy.contains(CHANNEL).click();
    cy.contains('200 messages').should('be.visible');
  }
  cy.fixture('search-results-multi.json').then((body: Record<string, unknown>) => {
    cy.intercept('GET', `${API}/guilds/*/messages/search*`, { body: totalResults ? { ...body, total_results: totalResults } : body }).as('guildSearch');
  });
  searchFor('project');
  cy.wait('@guildSearch');
  cy.contains('The project docs have been updated').should('be.visible');
}

describe('Search sets (2.2.5 fix C)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('a search leaves the saved conversation alone, and clearing it brings the plain rows straight back', () => {
    loadTwoPagesAndSearch();
    channelId().then((cid) => {
      countRowsUnder(cid).should('eq', 200);
      countRowsUnder(`search:${cid}`).should('eq', 3);
    });

    cy.get('@pagedMessages.all').its('length').then((before) => {
      cy.get('[aria-label="Clear all filters"]').click();
      // Back on the plain view without re-selecting the channel (row 44), from disk.
      cy.contains('200 messages').should('be.visible');
      cy.contains('[data-testid="message-feed-row"]', 'page message 9000').should('exist');
      cy.get('@pagedMessages.all').should('have.length', before);
    });
    channelId().then((cid) => {
      countRowsUnder(cid).should('eq', 200);
      countRowsUnder(`search:${cid}`).should('eq', 0);
    });
  });

  it('leaving and coming back shows the search again, with its chip', () => {
    loadTwoPagesAndSearch();
    cy.contains('dev-chat').click();
    cy.contains(CHANNEL).click();
    cy.contains('The project docs have been updated').should('be.visible');
    cy.contains('page message 9000').should('not.exist');
    cy.get('@guildSearch.all').should('have.length', 1);
    cy.get('[aria-label="Clear all filters"]').should('exist');
  });

  it('the filtered Load All dialog does not read the plain conversation (row 45)', () => {
    loadTwoPagesAndSearch(50, true);
    cy.contains('button', 'Load All').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[data-testid="load-all-restored-line"]').should('not.exist');
    cy.get('[data-testid="load-all-start-over"]').should('not.exist');
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();
  });
});
