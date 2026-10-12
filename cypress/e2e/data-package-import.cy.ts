/// <reference types="cypress" />

/**
 * E2E coverage for the Discord data package import feature (backlog #54).
 *
 * Fixtures are built by `npm run build:cypress:package-fixtures`:
 *   - test-package.zip            — user ID matches cypress/fixtures/user.json
 *   - test-package-mismatched.zip — different user ID (soft-warn read-only)
 *   - test-package-invalid.zip    — no account/user.json
 */

const API = '**/api/v10';

describe('Data package import', () => {
  beforeEach(() => {
    cy.login();
  });

  describe('Sidebar entry point', () => {
    it('renders the Package tab with an empty state', () => {
      cy.openPackageTab();
      cy.contains(/Import a Discord Data Package/i).should('be.visible');
      cy.contains('button', /Choose ZIP file/i).should('be.visible');
    });

    it('switches the main pane to the package view', () => {
      cy.openPackageTab();
      cy.contains(/Import a Discord Data Package/i).should('be.visible');
    });
  });

  describe('Upload + validation', () => {
    it('accepts a valid package and shows summary chips', () => {
      cy.uploadPackage();
      cy.contains(/6 messages/).should('be.visible');       // 4 + 1 + 1 across 3 channels
      cy.contains(/3 channels/).should('be.visible');
      cy.contains(/from a left server/i).should('be.visible');
    });

    it('writes one status line saying what was read (#269)', () => {
      cy.uploadPackage();
      cy.contains(/3 channels/).should('be.visible');
      cy.window().then((win) => {
        const entries = (win as any).__store__.getState().status.entries as { level: string; message: string }[];
        const lines = entries.filter((e) => e.message.startsWith('Package read:'));
        expect(lines).to.have.length(1);
        expect(lines[0].level).to.eq('info');
        expect(lines[0].message).to.eq('Package read: 3 channels, 6 messages.');
      });
    });

    it('soft-warns on mismatched user and enters read-only mode', () => {
      cy.uploadPackage('test-package-mismatched.zip');
      cy.contains(/different user/i).should('be.visible');
    });

    it('shows an error for a package without account/user.json', () => {
      cy.uploadPackage('test-package-invalid.zip');
      cy.get('[role="alert"]').should('contain.text', 'user.json');
    });

    it('surfaces the left-server banner cross-referenced with live guilds', () => {
      cy.uploadPackage();
      cy.contains(/no longer in 1 server/i).should('be.visible');
      cy.contains('Abandoned Server').should('be.visible');
    });
  });

  describe('Analytics', () => {
    beforeEach(() => {
      cy.uploadPackage();
    });

    it('renders metadata-driven sections immediately', () => {
      cy.contains(/Top channels by message count/i).should('be.visible');
      cy.contains('general').should('be.visible');
      cy.contains(/Messages by server/i).should('be.visible');
      cy.contains(/Channel types/i).should('be.visible');
    });

    it('opts into the activity timeline and renders charts', () => {
      cy.contains('button', /Load timeline/i).click();
      cy.contains(/Monthly activity/i, { timeout: 10000 }).should('be.visible');
      cy.contains(/Activity by hour/i).should('be.visible');
      cy.contains(/peak month/i).should('be.visible');
    });
  });

  describe('Channel browser', () => {
    beforeEach(() => {
      cy.uploadPackage();
    });

    it('selecting a channel renders its messages', () => {
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      cy.contains('with, comma').should('be.visible');
      cy.contains(/multi/).should('be.visible');
      cy.contains(/line content/).should('be.visible');
    });

    it('back button returns to the analytics view', () => {
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      cy.get('[aria-label="Back to analytics"]').click();
      cy.contains(/Top channels by message count/i).should('be.visible');
    });

    it('orphan channel shows read-only banner in its header', () => {
      // Left Servers section is collapsed by default — expand it first.
      cy.contains('Left Servers').parent().find('button').last().click();
      cy.contains('Old Guild Channel').click();
      cy.contains(/Read only · left server/i).should('be.visible');
    });

    // #273: the button in the channel header moves the channel out of Left
    // Servers by hand, and the sidebar regroups it under Servers.
    it('moves a channel out of Left Servers from its header button (#273)', () => {
      cy.contains('Left Servers').parent().find('button').last().click();
      cy.contains('Old Guild Channel').click();
      cy.contains(/Read only · left server/i).should('be.visible');
      cy.contains('button', 'Move out of Left Servers').click();
      cy.contains(/Read only · left server/i).should('not.exist');
      cy.contains('Left Servers').should('not.exist');
      cy.contains('.MuiListItemButton-root', 'Old Guild Channel').should('be.visible');
      cy.get('input[aria-label="Select message 3001"]').should('not.be.disabled');
    });
  });

  // #273: a Server rejoined since the export answers the channel lookup
  // with a guild id, so the channel leaves Left Servers on its own after
  // the import and takes the live Server name.
  describe('Left Servers recheck (#273)', () => {
    it('moves a rejoined channel out of Left Servers after import', () => {
      cy.intercept('GET', `${API}/channels/400`, {
        statusCode: 200,
        body: { id: '400', type: 0, name: 'Old Guild Channel', guild_id: '901000000000000001' },
      }).as('getOrphanChannel');
      cy.uploadPackage();
      cy.wait('@getOrphanChannel');
      cy.contains('Left Servers').should('not.exist');
      cy.contains('.MuiListItemButton-root', 'Old Guild Channel').within(() => {
        cy.contains('Cypress Test Server').should('be.visible');
      });
      cy.window().then((win) => {
        const store = (win as any).__store__;
        const messages = (store.getState().status.entries ?? []).map((e: any) => e.message);
        expect(messages).to.include('Left Servers: 1 channel moved back under a Server you rejoined');
        expect(store.getState().package.leftServersRecheckStatus).to.equal('done');
      });
    });

    it('keeps a channel under Left Servers when Discord still answers 404', () => {
      cy.uploadPackage();
      cy.wait('@getChannel');
      cy.contains('Left Servers').should('be.visible');
      cy.get('button[aria-label="Recheck left servers"]').should('exist');
    });
  });

  describe('Bulk delete', () => {
    beforeEach(() => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
    });

    it('enables Delete selected only after messages are checked', () => {
      cy.contains('button', /Delete selected/i).should('be.disabled');
      cy.get('input[aria-label="Select message 1001"]').click();
      cy.contains('button', /Delete selected/i).should('not.be.disabled');
    });

    it('confirms then processes 200 responses as deleted', () => {
      cy.intercept('DELETE', `${API}/channels/200/messages/*`, {
        statusCode: 204,
      }).as('deleteMsg');

      cy.get('input[aria-label="Select message 1001"]').click();
      cy.get('input[aria-label="Select message 1002"]').click();
      cy.contains('button', /Delete selected/i).click();
      cy.get('[role="dialog"]').contains('button', 'Delete').click();

      cy.wait('@deleteMsg');
      cy.contains(/Deleted 2/i, { timeout: 10000 }).should('be.visible');
    });

    it('categorizes 404 as already gone', () => {
      cy.intercept('DELETE', `${API}/channels/200/messages/*`, {
        statusCode: 404,
        body: { message: 'Unknown Message', code: 10008 },
      }).as('delete404');

      cy.get('input[aria-label="Select message 1001"]').click();
      cy.contains('button', /Delete selected/i).click();
      cy.get('[role="dialog"]').contains('button', 'Delete').click();

      cy.wait('@delete404');
      // #271: nothing was removed, so the result is a warning, and the
      // caption says the row is gone rather than "previously deleted".
      cy.contains(/Nothing to delete\. 1 message was already gone on Discord\./, { timeout: 10000 })
        .should('be.visible')
        .closest('[role="alert"]')
        .should('have.class', 'MuiAlert-colorWarning');
      cy.contains(/1 gone from Discord/).should('be.visible');
      cy.contains(/previously deleted/).should('not.exist');
    });

    it('disables Delete on orphan channels', () => {
      cy.get('[aria-label="Back to analytics"]').click();
      cy.contains('Left Servers').parent().find('button').last().click();
      cy.contains('Old Guild Channel').click();
      // The row checkbox is disabled in orphan mode, so selection can't happen.
      cy.get('input[aria-label="Select message 3001"]').should('be.disabled');
      cy.contains('button', /Delete selected/i).should('be.disabled');
    });
  });

  describe('Live remaining counts (#236)', () => {
    it('fresh import shows remaining counts equal to the archive totals', () => {
      cy.uploadPackage();
      // Summary chip reflects the untouched archive total.
      cy.contains(/6 messages/).should('be.visible');
      // Sidebar row for #general shows the full archive count (the
      // analytics "Top channels" list is not a ListItemButton, so this
      // scoping uniquely targets the channel-list row).
      cy.contains('.MuiListItemButton-root', 'general').within(() => {
        cy.contains(/^4$/).should('be.visible');
      });
      // Channel header caption also reads the full archive count.
      cy.contains('general').click();
      cy.contains('Cypress Test Server · 4 messages').should('be.visible');
    });

    it('deleting messages drops the remaining counts while archive totals stay fixed', () => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');

      cy.intercept('DELETE', `${API}/channels/200/messages/*`, {
        statusCode: 204,
      }).as('deleteMsg');

      cy.get('input[aria-label="Select message 1001"]').click();
      cy.get('input[aria-label="Select message 1002"]').click();
      cy.contains('button', /Delete selected/i).click();
      cy.get('[role="dialog"]').contains('button', 'Delete').click();
      cy.wait('@deleteMsg');
      cy.contains(/Deleted 2/i, { timeout: 10000 }).should('be.visible');

      // Channel header caption: 4 in the archive minus 2 deleted.
      cy.contains('Cypress Test Server · 2 messages').should('be.visible');

      cy.get('[aria-label="Back to analytics"]').click();

      // Summary chip: 6 in the archive minus 2 deleted.
      cy.contains(/4 messages/).should('be.visible');
      cy.contains(/6 messages/).should('not.exist');

      // Sidebar row for #general drops from 4 to 2.
      cy.contains('.MuiListItemButton-root', 'general').within(() => {
        cy.contains(/^2$/).should('be.visible');
      });

      // The archive total itself stays fixed — the chip's tooltip still
      // reports the immutable in-package count next to the deletions.
      cy.contains('.MuiChip-root', '4 messages').trigger('mouseover');
      cy.contains('6 in package, 2 deleted via Discrub').should('be.visible');
    });
  });

  describe('Bulk edit', () => {
    beforeEach(() => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
    });

    it('opens the edit modal with the correct message count', () => {
      cy.get('input[aria-label="Select message 1001"]').click();
      cy.get('input[aria-label="Select message 1002"]').click();
      cy.contains('button', /Edit selected/i).click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains(/Bulk Edit/i).should('be.visible');
      cy.contains(/Editing 2 messages/).should('be.visible');
    });

    it('submits edits through the API and updates the local cache', () => {
      cy.intercept('PATCH', `${API}/channels/200/messages/*`, (req) => {
        req.reply({
          statusCode: 200,
          body: {
            id: req.url.split('/').pop(),
            content: 'updated via test',
            channel_id: '200',
          },
        });
      }).as('patchMsg');

      cy.get('input[aria-label="Select message 1001"]').click();
      cy.contains('button', /Edit selected/i).click();
      cy.get('[role="dialog"]').find('textarea').first().type('updated via test');
      cy.get('[role="dialog"]').contains('button', 'Save').click();

      cy.wait('@patchMsg');
      cy.contains('updated via test', { timeout: 10000 }).should('be.visible');
    });
  });

  describe('HTML export', () => {
    beforeEach(() => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
    });

    it('opens the export dialog and runs a default HTML export', () => {
      cy.contains('button', /^Export$/).should('be.visible').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').contains(/general/).should('be.visible');
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();
      // Button re-enables (thunk resolved) and no error alert remains.
      cy.contains('button', /^Export$/, { timeout: 15000 }).should('not.be.disabled');
    });
  });
});
