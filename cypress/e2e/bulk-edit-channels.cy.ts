const API = '**/api/v10';

/**
 * #215 — bulk edit across multi-selected CHANNELS (distinct from the in-feed
 * per-message Edit flow in bulk-edit.cy.ts). Select channels in the sidebar
 * multi-select scaffold → Edit → BulkEditDialog → overwrite every own message
 * across the selected channels.
 *
 * The dialog locks the author to the current user (Discord only permits
 * editing your own messages), so there's no UserPicker step. The thunk
 * streams own messages via the search endpoint and PATCHes each.
 */

/**
 * Search returns results on the first call, empty afterwards (pagination end,
 * mirrors the always-cap-shift iterator). PATCH is the edit endpoint.
 */
const interceptBulkEdit = () => {
  let searchCallCount = 0;
  cy.fixture('bulk-purge-search-results.json').then((searchResults) => {
    cy.fixture('bulk-purge-search-empty.json').then((emptyResults) => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCallCount++;
        req.reply({ statusCode: 200, body: searchCallCount === 1 ? searchResults : emptyResults });
      }).as('searchMessages');
      cy.intercept('GET', `${API}/channels/*/messages/search*`, (req) => {
        searchCallCount++;
        req.reply({ statusCode: 200, body: searchCallCount === 1 ? searchResults : emptyResults });
      }).as('searchChannelMessages');
    });
  });

  cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
    statusCode: 200,
    body: {},
  }).as('editMessage');
};

const selectChannels = (...channelNames: string[]) => {
  cy.get('[aria-label="Toggle multi-select"]').first().click();
  for (const name of channelNames) {
    cy.contains(name).click();
  }
};

const openEditDialog = (context: 'channels' | 'conversations' = 'channels') => {
  cy.get(`[aria-label="Edit selected ${context}"]`).click();
  cy.get('[role="dialog"]').should('be.visible');
};

// Retries until the entry appears — bulk edit has no isPurging-style flag to
// wait on, so the final "complete" entry lands a beat after the last PATCH.
const verifyStatusEntry = (text: string | RegExp) => {
  cy.window({ timeout: 30000 }).should((win) => {
    const store = (win as any).__store__;
    expect(store, 'redux store on window').to.exist;
    const messages = (store.getState().status.entries || []).map((e: any) => e.message);
    const found = typeof text === 'string'
      ? messages.some((m: string) => m.includes(text))
      : messages.some((m: string) => text.test(m));
    expect(found, `status entry matching ${text}`).to.be.true;
  });
};

describe('Bulk Edit Channels (#215)', () => {
  describe('Edit button in the multi-select scaffold', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
    });

    it('shows the Edit button when channels are selected', () => {
      selectChannels('general');
      cy.get('[aria-label="Edit selected channels"]').should('be.visible');
    });

    it('keeps the Edit button in place but disabled with no selection (row 103)', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Edit selected channels"]').should('be.disabled');
    });

    it('opens BulkEditDialog when clicking Edit', () => {
      selectChannels('general');
      openEditDialog();
      cy.contains('Edit Channels').should('be.visible');
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '1 of');
    });

    it('lists multiple selected channels in the dialog', () => {
      selectChannels('general', 'dev-chat');
      openEditDialog();
      cy.get('[role="dialog"]').contains('general').should('be.visible');
      cy.get('[role="dialog"]').contains('dev-chat').should('be.visible');
    });
  });

  describe('BulkEditDialog UI', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      selectChannels('general');
      openEditDialog();
    });

    it('explains that only your own messages can be edited', () => {
      cy.get('[role="dialog"]').contains('Only messages you authored').should('be.visible');
    });

    it('shows the irreversibility warning', () => {
      cy.get('[role="dialog"]').contains('This action is irreversible').should('be.visible');
    });

    it('disables the confirm button until content is entered', () => {
      cy.get('[role="dialog"]').contains('button', /Edit \d+ Ch/).should('be.disabled');
      cy.get('[role="dialog"]').find('textarea').first().type('redacted');
      cy.get('[role="dialog"]').contains('button', /Edit \d+ Ch/).should('not.be.disabled');
    });

    it('keeps confirm disabled for whitespace-only content', () => {
      cy.get('[role="dialog"]').find('textarea').first().type('   ');
      cy.get('[role="dialog"]').contains('button', /Edit \d+ Ch/).should('be.disabled');
    });

    it('closes on Cancel without making requests', () => {
      cy.intercept('PATCH', `${API}/channels/*/messages/*`, cy.spy().as('noEdit'));
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.get('@noEdit').should('not.have.been.called');
    });
  });

  describe('Execution', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptBulkEdit();
    });

    it('edits every own message in the selected channel', () => {
      selectChannels('general');
      openEditDialog();
      cy.get('[role="dialog"]').find('textarea').first().type('redacted by owner');
      cy.get('[role="dialog"]').contains('button', /Edit \d+ Ch/).click();

      // Dialog closes and the search + PATCH flow runs.
      cy.get('[role="dialog"]').should('not.exist');
      cy.wait('@searchMessages');
      cy.wait('@editMessage');

      // Fixture has 3 own messages → 3 PATCH calls.
      cy.get('@editMessage.all').should('have.length', 3);

      // The new content is sent on each edit.
      cy.get('@editMessage.all').then((calls) => {
        const body = (calls[0] as any).request.body;
        expect(body.content).to.eq('redacted by owner');
      });

      verifyStatusEntry(/Bulk edit complete/);
    });

    it('scopes the search to the current user (own messages only)', () => {
      selectChannels('general');
      openEditDialog();
      cy.get('[role="dialog"]').find('textarea').first().type('redacted');
      cy.get('[role="dialog"]').contains('button', /Edit \d+ Ch/).click();

      cy.wait('@searchMessages').then((interception) => {
        // The author filter is always the current user (111222333444555666).
        expect(interception.request.url).to.include('author_id=111222333444555666');
      });
    });

    it('walks each selected channel in turn', () => {
      selectChannels('general', 'dev-chat');
      openEditDialog();
      cy.get('[role="dialog"]').find('textarea').first().type('redacted');
      cy.get('[role="dialog"]').contains('button', /Edit \d+ Ch/).click();
      cy.get('[role="dialog"]').should('not.exist');

      cy.wait('@editMessage');

      // Both channels announced + a final completion entry naming the count.
      verifyStatusEntry(/Starting #general/);
      verifyStatusEntry(/Starting #dev-chat/);
      verifyStatusEntry(/Bulk edit complete/);
    });
  });
});
