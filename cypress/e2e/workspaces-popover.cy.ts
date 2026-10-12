/**
 * Workspaces 2.2.5 WP5: the pill, the Workspaces popover and the disk bar.
 * Free account: New and Duplicate carry the supporter lock, Clear, Rename,
 * switching and Delete work for everyone.
 */

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

/** Call 1 and any call from `freshOn` answer page A, call 2 page B, the rest nothing. */
function interceptPagedChannel(template: Record<string, unknown>, freshOn = 3) {
  const pageA = makePage(template, 9000);
  const pageB = makePage(template, 8900);
  let calls = 0;
  cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
    calls += 1;
    const body = calls === 1 || calls === freshOn ? pageA : calls === 2 ? pageB : [];
    req.reply({ statusCode: 200, body });
  }).as('pagedMessages');
}

function loadTwoPages() {
  cy.contains(CHANNEL).click();
  cy.wait('@pagedMessages');
  cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
  cy.wait('@pagedMessages');
  cy.contains('200 messages').should('be.visible');
}

const payload = { v: 1, kid: 'k', jti: 'j', name: 'Aaron', eh: 'x', ent: { themes: null }, iat: 1, exp: null };
// Wait for the app's own supporter init first, or it lands after this and puts 'none' back.
const unlock = () => cy.window().its('__store__').invoke('getState').its('supporter.initialized').should('be.true').then(() => cy.window()).then((win) => {
  (win as any).__store__.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { keyStatus: 'valid', payload, lastRefreshAt: 1 } });
});

const openPopover = () => {
  cy.get('[data-testid="workspace-pill"]').first().click();
  cy.get('[data-testid="workspaces-popover"]').should('be.visible');
};

describe('Workspaces popover (2.2.5 WP5)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('shows the open workspace, its figures and the supporter marks, and clears a conversation', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0]);
      loadTwoPages();

      cy.get('[data-testid="workspace-pill"]').should('contain', 'Default');
      cy.get('[data-testid="disk-bar"]').should('exist');
      openPopover();
      cy.get('[data-testid="workspace-row-default"]').should('contain', 'Open now').and('contain', '1 conversation · 200 messages');
      cy.get('[data-testid="workspace-supporter-only"]').should('contain', 'Supporter only');
      cy.get('[data-testid="workspace-new"]').parent().find('[data-testid="workspace-lock"]').should('exist');

      cy.get('[data-testid="workspace-row-toggle-default"]').click();
      cy.get('[data-testid="workspace-duplicate"]').parent().find('[data-testid="workspace-lock"]').should('exist');
      cy.get('[data-testid="workspace-delete"]').should('not.exist');
      cy.get('[data-testid^="workspace-conversation-clear-"]').first().click();
      cy.get('[data-testid="workspace-confirm"]').should('contain', 'Removes 200 messages');
      cy.get('[data-testid="workspace-confirm-button"]').click();

      // The open conversation starts over on a fresh first page.
      cy.wait('@pagedMessages');
      cy.contains('100 messages').should('be.visible');
      cy.get('[data-testid="workspace-row-default"]', { timeout: 10000 }).should('contain', '0 conversations');
    });
  });

  it('renames the open workspace inline', () => {
    openPopover();
    cy.get('[data-testid="workspace-row-toggle-default"]').click();
    cy.get('[data-testid="workspace-rename"]').click();
    cy.get('[data-testid="workspace-rename-input"]').clear().type('Main{enter}');
    cy.get('[data-testid="workspace-row-default"]').should('contain', 'Main');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="workspace-pill"]').should('contain', 'Main');
  });

  it('switches to another workspace from its row and deletes it back to Default', () => {
    cy.window().then((win) => (win as unknown as { __workspace__: { create: (n: string) => Promise<unknown> } }).__workspace__.create('Raid archive'));
    openPopover();
    cy.contains('[data-testid^="workspace-row-"]', 'Raid archive').click();
    cy.get('[data-testid="workspace-pill"]').should('contain', 'Raid archive');

    openPopover();
    cy.contains('[data-testid^="workspace-row-"]', 'Raid archive').find('[data-testid^="workspace-row-toggle-"]').click();
    cy.get('[data-testid="workspace-delete"]').click();
    cy.get('[data-testid="workspace-confirm-button"]').click();
    cy.get('[data-testid="workspace-pill"]').should('contain', 'Default');
    cy.contains('[data-testid^="workspace-row-"]', 'Raid archive').should('not.exist');
  });

  it('a supporter makes a new workspace, names it, and duplicates one', () => {
    unlock();
    openPopover();
    cy.get('[data-testid="workspace-supporter-only"]').should('not.exist');
    cy.get('[data-testid="workspace-new"]').click();
    cy.get('[data-testid="workspace-rename-input"]').should('have.value', 'Workspace 2').type('Mod cleanup{enter}');
    cy.contains('[data-testid^="workspace-row-"]', 'Mod cleanup').should('exist');
    // The status log stays as it was; popover clicks do not reach its header.
    cy.contains('Current session').should('not.exist');

    cy.get('[data-testid="workspace-row-toggle-default"]').click();
    cy.get('[data-testid="workspace-duplicate"]').click();
    cy.get('[data-testid="workspace-confirm"]').should('contain', 'Duplicate Default');
    cy.get('[data-testid="workspace-confirm-button"]').click();
    cy.contains('[data-testid^="workspace-row-"]', 'Default copy').should('exist');
    cy.get('[data-testid="workspace-pill"]').should('contain', 'Default');
  });
});
