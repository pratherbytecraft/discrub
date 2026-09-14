// 2.2.0 item 6: the Simple layout (supporter). A live key is put in the store; without one the card is locked.
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

describe('Simple layout (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  afterEach(() => {
    cy.get('body').then(($b) => {
      if ($b.find('[data-testid="simple-shell"]').length) { cy.get('body').type('{esc}'); switchTo('classic'); cy.get('[data-testid="simple-shell"]').should('not.exist'); }
    });
  });

  it('is locked without a key: the card opens the hub and there is no preview', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-locked-simple"]').should('exist');
    cy.get('[data-testid="layout-card-simple"]').click();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-simple"]').should('not.exist');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="simple-shell"]').should('not.exist');
  });

  it('with a key: one column with the picker breadcrumb, the search card, the hint bar and the same messages', () => {
    unlock();
    switchTo('simple');
    cy.get('[data-testid="simple-shell"]').should('be.visible');
    cy.get('[data-testid="simple-picker"]').should('contain.text', 'Cypress Test Server').and('contain.text', 'general');
    cy.get('[data-testid="simple-version"]').should('not.be.empty');
    cy.get('[data-testid="simple-search-card"]').should('be.visible').and('contain.text', 'messages loaded');
    cy.get('[data-testid="simple-hint-bar"]').should('be.visible').and('contain.text', 'Filters');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  it('picks another conversation through the picker drawer', () => {
    unlock();
    switchTo('simple');
    cy.get('[data-testid="simple-picker"]').click();
    cy.get('[data-testid="native-column"]').should('be.visible');
    cy.get('[data-testid="native-column"]').contains('dev-chat').click({ force: true });
    cy.get('[data-testid="simple-picker"]').should('contain.text', 'dev-chat');
    cy.get('[data-testid="native-column"]').should('not.be.visible');
  });

  it('opens Filters, Export and Purge from the search card and Analytics from the top bar', () => {
    unlock();
    switchTo('simple');
    cy.get('[data-testid="simple-filters"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Filters');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="simple-export"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Export');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="simple-purge"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Purge');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="simple-analytics"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Most mentioned');
    cy.get('body').type('{esc}');
  });

  it('opens the log sheet from the bottom bar, and Focus keeps the top bar and hides the card, hint bar and log', () => {
    unlock();
    switchTo('simple');
    cy.get('[aria-label="Expand log"]').click({ force: true });
    cy.get('[data-tour="status-panel"]').should('have.attr', 'data-sheet', 'true');
    cy.get('[aria-label="Collapse log"]').click({ force: true });
    cy.get('[data-testid="simple-focus"]').click();
    cy.get('[data-testid="simple-search-card"]').should('not.exist');
    cy.get('[data-testid="simple-hint-bar"]').should('not.exist');
    cy.get('[data-tour="status-panel"]').should('not.exist');
    cy.get('[data-testid="simple-top"]').should('be.visible');
    cy.get('[data-testid="focus-pill"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="simple-search-card"]').should('be.visible');
  });

  it('on a phone drops the wordmark and chip, keeps the picker, and labels Export and Purge', () => {
    unlock();
    switchTo('simple');
    cy.viewport(390, 844);
    cy.get('[data-testid="simple-version"]').should('not.exist');
    cy.get('[data-testid="simple-top"] [data-tour="user-profile"]').should('not.exist');
    cy.get('[data-testid="simple-picker"]').should('be.visible');
    cy.get('[data-testid="simple-export"]').should('be.visible').and('contain.text', 'Export');
    cy.get('[data-testid="simple-purge"]').should('be.visible').and('contain.text', 'Purge');
    cy.get('[data-testid="simple-hint-bar"]').should('not.exist');
    cy.viewport(1280, 800);
  });
});
