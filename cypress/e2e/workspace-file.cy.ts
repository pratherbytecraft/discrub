/**
 * Workspaces 2.2.5 WP6b: Export writes a .discrub-workspace file, Import
 * reads it back. The file's workspace is already here, so the dialog
 * shows both side by side and Replace writes the saved messages back.
 */

const CHANNEL = 'general';

function makePage(template: Record<string, unknown>, start: number): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = start - i;
    return {
      ...template,
      id: `73000000000000${String(n).padStart(4, '0')}`,
      content: `file message ${n}`,
      timestamp: new Date(Date.UTC(2026, 1, 1) + n * 60_000).toISOString(),
      reactions: [],
      attachments: [],
      embeds: [],
    };
  });
}

/** Page A, then page B, then page A again for the fresh open after Clear. */
function interceptPagedChannel(template: Record<string, unknown>) {
  const pageA = makePage(template, 9000);
  const pageB = makePage(template, 8900);
  let calls = 0;
  cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
    calls += 1;
    const body = calls === 2 ? pageB : calls === 1 || calls === 3 ? pageA : [];
    req.reply({ statusCode: 200, body });
  }).as('pagedMessages');
}

const openPopover = () => {
  cy.get('[data-testid="workspace-pill"]').first().click();
  cy.get('[data-testid="workspaces-popover"]').should('be.visible');
};

describe('Workspace file (2.2.5 WP6b)', () => {
  beforeEach(() => {
    cy.task('downloads:clean');
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('exports Default, and importing the file over a cleared Default brings the messages back', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0]);
      cy.contains(CHANNEL).click();
      cy.wait('@pagedMessages');
      cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
      cy.wait('@pagedMessages');
      cy.contains('200 messages').should('be.visible');

      // Export asks first and says the file holds message content.
      openPopover();
      cy.get('[data-testid="workspace-row-toggle-default"]').click();
      cy.get('[data-testid="workspace-export"]').click();
      cy.get('[data-testid="workspace-confirm"]').should('contain', 'Export Default').and('contain', 'Saves 200 messages').and('contain', 'The file holds message content.');
      cy.get('[data-testid="workspace-confirm-button"]').click();
      cy.contains('Saved Default to a workspace file', { timeout: 15000 }).should('exist');
      cy.task('downloads:list', null, { timeout: 15000 }).should((files) => {
        expect((files as Array<{ name: string }>).map((f) => f.name)).to.include('Default.discrub-workspace');
      });

      // Clear Default, the open conversation starts over on a fresh first page.
      cy.get('[data-testid="workspace-clear"]').click();
      cy.get('[data-testid="workspace-confirm-button"]').click();
      cy.contains('100 messages', { timeout: 15000 }).should('be.visible');

      // Import the file: Default is already here, so both show side by side.
      cy.get('[data-testid="workspace-import-input"]').selectFile(`${Cypress.config('downloadsFolder')}/Default.discrub-workspace`, { force: true });
      cy.get('[data-testid="workspace-import-dialog"]').should('contain', 'Workspace already here');
      cy.get('[data-testid="workspace-import-file"]').should('contain', '200 messages').and('contain', '1 conversation');
      cy.get('[data-testid="workspace-import-replace"]').click();
      cy.contains('Imported Default with 200 messages', { timeout: 15000 }).should('exist');

      // Default opens again where it was, from disk, with both pages.
      cy.contains('200 messages', { timeout: 15000 }).should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 3);
    });
  });

  it('refuses a file that is not a workspace', () => {
    openPopover();
    cy.get('[data-testid="workspace-import-input"]').selectFile({ contents: Cypress.Buffer.from('not a zip'), fileName: 'notes.discrub-workspace' }, { force: true });
    cy.contains('This file is not a Discrub workspace').should('exist');
    cy.get('[data-testid="workspace-import-dialog"]').should('not.exist');
  });
});
