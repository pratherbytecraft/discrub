/**
 * Workspaces 2.2.5 WP6a: a Load All page that does not fit in browser
 * storage pauses the run with the storage full hold. The dialog opens
 * once with Stop and Workspaces, Workspaces opens the popover with the
 * hold still on the status row, and Resume carries on once there is room.
 */

const CHANNEL = 'general';

function makePage(template: Record<string, unknown>, start: number): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = start - i;
    return {
      ...template,
      id: `72000000000000${String(n).padStart(4, '0')}`,
      content: `full message ${n}`,
      timestamp: new Date(Date.UTC(2026, 1, 1) + n * 60_000).toISOString(),
      reactions: [],
      attachments: [],
      embeds: [],
    };
  });
}

/** Page A, then page B, then nothing. */
function interceptPagedChannel(template: Record<string, unknown>) {
  const pages = [makePage(template, 9000), makePage(template, 8900)];
  let calls = 0;
  cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
    const body = pages[calls] ?? [];
    calls += 1;
    req.reply({ statusCode: 200, body });
  }).as('pagedMessages');
}

/** Every put into the workspace database fails with the browser's quota error while `full` is set. */
function fillStorage(win: Cypress.AUTWindow, state: { full: boolean }) {
  const original = win.IDBObjectStore.prototype.put;
  win.IDBObjectStore.prototype.put = function put(this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
    if (state.full && this.transaction.db.name === 'Discrub-workspaces') throw new win.DOMException('full', 'QuotaExceededError');
    return original.apply(this, args);
  };
}

function startLoadAllIntoFullStorage(state: { full: boolean }) {
  cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
    interceptPagedChannel(messages[0]);
    cy.contains(CHANNEL).click();
    cy.wait('@pagedMessages');
    cy.contains('100 messages').should('be.visible');
    cy.window().then((win) => {
      fillStorage(win, state);
      state.full = true;
    });
    cy.contains('button', 'Load All').click();
    cy.get('[data-testid="load-all-confirm"]').click();
  });
}

describe('Workspace storage full (2.2.5 WP6a)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('pauses Load All, opens Workspaces from the dialog, and Resume carries on', () => {
    const state = { full: false };
    startLoadAllIntoFullStorage(state);

    cy.get('[data-testid="storage-full-dialog"]', { timeout: 15000 }).should('be.visible');
    cy.get('[data-testid="storage-full-dialog"]').should('contain', 'Browser storage is full');
    cy.get('[data-testid="storage-full-line"]').should(
      'have.text',
      'Load All is paused at 100 messages in #general. Clear room in Workspaces, then Resume from the status bar.',
    );
    cy.get('[data-testid="operation-state"]').should('have.attr', 'data-state', 'storageFull');
    cy.get('[data-testid="operation-state-headline"]').should('have.text', 'Browser storage is full');
    cy.get('[data-testid="operation-state"]').should('contain', 'paused at 100');

    cy.get('[data-testid="storage-full-open-workspaces"]').click();
    cy.get('[data-testid="storage-full-dialog"]').should('not.exist');
    cy.get('[data-testid="workspaces-popover"]').should('be.visible');
    cy.get('[data-testid="operation-state"]').should('have.attr', 'data-state', 'storageFull');

    // Room cleared: close the popover, then Resume from the status row.
    cy.get('body').type('{esc}');
    cy.get('[data-testid="workspaces-popover"]').should('not.exist');
    cy.then(() => { state.full = false; });
    cy.get('[data-testid="storage-full-workspaces"]').should('be.visible');
    cy.get('button[aria-label="Resume"]').click({ force: true });
    cy.contains('All loaded', { timeout: 15000 }).should('be.visible');
    cy.contains('200 messages').should('be.visible');
    cy.get('[data-testid="operation-state"]').should('not.exist');
  });

  it('the status row Workspaces button opens the popover, and Stop from the dialog ends the run', () => {
    const state = { full: false };
    startLoadAllIntoFullStorage(state);
    cy.get('[data-testid="storage-full-dialog"]', { timeout: 15000 }).should('be.visible');
    cy.get('[data-testid="storage-full-dialog"] [aria-label="Close"]').click();
    cy.get('[data-testid="storage-full-dialog"]').should('not.exist');
    cy.get('[data-testid="storage-full-workspaces"]').click();
    cy.get('[data-testid="workspaces-popover"]').should('be.visible');
    cy.get('body').type('{esc}');

    // Resume with storage still full holds again, and the new hold opens the dialog again.
    cy.get('button[aria-label="Resume"]').click({ force: true });
    cy.get('[data-testid="storage-full-dialog"]', { timeout: 15000 }).should('be.visible');
    cy.get('[data-testid="storage-full-stop"]').click();
    cy.get('[data-testid="storage-full-dialog"]').should('not.exist');
    cy.get('[data-testid="operation-state"]').should('not.exist');
    cy.get('button[aria-label="Resume"]').should('not.exist');
  });
});
