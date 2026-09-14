// 2.2.0 item 5: the Workbench layout (supporter). A live key is put in the store; without one the card is locked.
const payload = { v: 1, kid: 'k', jti: 'j', name: 'Aaron', eh: 'x', ent: { themes: null }, iat: 1, exp: null };
// Wait for the app's own supporter init to finish first, or it lands after this and puts 'none' back.
const unlock = () => cy.window().its('__store__').invoke('getState').its('supporter.initialized').should('be.true').then(() => cy.window()).then((win) => {
  (win as any).__store__.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { keyStatus: 'valid', payload, lastRefreshAt: 1 } });
});
const switchTo = (key: string) => {
  cy.get('body').trigger('keydown', { key: 'L', ctrlKey: true, shiftKey: true });
  cy.get(`[data-testid="layout-card-${key}"]`).click({ force: true });
  cy.get('[data-testid="appearance-popover"]').should('not.exist');
};

describe('Workbench layout (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  afterEach(() => {
    cy.get('body').then(($b) => {
      if ($b.find('[data-testid="workbench-shell"]').length) { cy.get('body').type('{esc}'); switchTo('classic'); cy.get('[data-testid="workbench-shell"]').should('not.exist'); }
    });
  });

  it('is locked without a key: the card opens the hub and the eye gives a look-only preview', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-locked-workbench"]').should('exist');
    cy.get('[data-testid="layout-card-workbench"]').click();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-workbench"]').click();
    cy.get('[data-testid="workbench-shell"]').should('exist');
    cy.get('[data-testid="preview-bar"]').should('contain.text', 'Previewing Workbench');
    cy.get('[data-testid="shell-frame"]').should('have.attr', 'inert');
    cy.get('[data-testid="preview-end"]').click();
    cy.get('[data-testid="workbench-shell"]').should('not.exist');
  });

  it('with a key: shows the toolbar, the table, the dock and the status bar around the same messages', () => {
    unlock();
    switchTo('workbench');
    cy.get('[data-testid="workbench-shell"]').should('be.visible');
    cy.get('[data-testid="workbench-toolbar"]').should('be.visible');
    cy.get('[data-testid="message-table"]').should('be.visible');
    cy.contains('[data-testid="table-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    cy.get('[data-testid="workbench-dock"]').should('be.visible').and('contain.text', 'Nothing running');
    cy.get('[data-testid="workbench-status-bar"]').should('contain.text', 'loaded');
  });

  it('selects rows, selects all, and sorts from the table header', () => {
    unlock();
    switchTo('workbench');
    cy.get('[data-testid="table-row"]').first().click();
    cy.get('[data-testid="workbench-status-bar"]').should('contain.text', '1 selected');
    cy.get('[data-testid="table-select-all"] input').click();
    cy.window().its('__store__').invoke('getState').its('message.selectedMessages.length').should('be.greaterThan', 1);
    cy.get('[data-testid="table-select-all"] input').click();
    cy.get('[data-testid="table-sort-date"]').click();
    cy.window().its('__store__').invoke('getState').its('message.order.order').should('eq', 'asc');
  });

  it('opens Export from the toolbar and the log sheet from the dock, and Focus keeps the toolbar', () => {
    unlock();
    switchTo('workbench');
    cy.get('[data-testid="wb-export"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Export');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="dock-tab-log"]').click();
    cy.get('[data-tour="status-panel"]').should('have.attr', 'data-sheet', 'true');
    cy.get('[aria-label="Collapse log"]').click({ force: true });
    cy.get('[data-testid="wb-focus"]').click();
    cy.get('[data-testid="workbench-dock"]').should('not.exist');
    cy.get('[data-testid="workbench-toolbar"]').should('be.visible');
    cy.get('[data-testid="focus-pill"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="workbench-dock"]').should('be.visible');
  });
});
