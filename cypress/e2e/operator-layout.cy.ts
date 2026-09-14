// 2.2.0 item 7: the Operator layout (supporter). A live key is put in the store; without one the card is locked.
const payload = { v: 1, kid: 'k', jti: 'j', name: 'Aaron', eh: 'x', ent: { themes: null }, iat: 1, exp: null };
// Wait for the app's own supporter init to finish first, or it lands after this and puts 'none' back.
const unlock = () => cy.window().its('__store__').invoke('getState').its('supporter.initialized').should('be.true').then(() => cy.window()).then((win) => {
  (win as any).__store__.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { keyStatus: 'valid', payload, lastRefreshAt: 1 } });
});
const switchTo = (key: string) => {
  cy.get('[data-testid="gift-button"]').click({ force: true });
  cy.get(`[data-testid="layout-card-${key}"]`).click({ force: true });
  cy.get('[data-testid="appearance-popover"]').should('not.exist');
};

describe('Operator layout (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  afterEach(() => {
    cy.get('body').then(($b) => {
      if ($b.find('[data-testid="operator-shell"]').length) { cy.get('body').type('{esc}'); switchTo('classic'); cy.get('[data-testid="operator-shell"]').should('not.exist'); }
    });
  });

  it('is locked without a key: the card opens the hub and the preview bar says Locked', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-locked-operator"]').should('exist');
    cy.get('[data-testid="layout-card-operator"]').click();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-operator"]').click();
    cy.get('[data-testid="layout-preview-bar"]').should('contain.text', 'Previewing Operator').and('contain.text', 'Locked');
    cy.get('[data-testid="layout-preview-stop"]').click();
    cy.get('[data-testid="operator-shell"]').should('not.exist');
  });

  it('with a key: queue, run card, log, peek and recent exports around the same messages, no Focus', () => {
    unlock();
    switchTo('operator');
    cy.get('[data-testid="operator-shell"]').should('be.visible');
    cy.get('[data-testid="operator-crumb"]').should('contain.text', 'Cypress Test Server').and('contain.text', 'general');
    cy.get('[data-testid="operator-seg-servers"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('[data-testid="operator-run-card"]').should('have.attr', 'data-state', 'idle').and('contain.text', 'Nothing running');
    cy.get('[data-testid="operator-log"]').should('contain.text', 'Loaded');
    cy.get('[data-testid="operator-peek"]').within(() => { cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist'); });
    cy.get('[data-testid="operator-recent"]').should('be.visible');
    cy.get('[data-testid="focus-pill"]').should('not.exist');
  });

  it('ticks build the queue, Export opens the bulk export over it and Purge the bulk purge', () => {
    unlock();
    switchTo('operator');
    cy.get('[data-testid="op-export"]').should('be.disabled');
    cy.get('[data-testid="queue-tick"]').eq(0).click();
    cy.get('[data-testid="queue-tick"]').eq(1).click();
    cy.get('[data-testid="operator-queue-count"]').should('contain.text', '2 channels queued');
    cy.get('[data-testid="op-export"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Export').and('contain.text', '2');
    cy.get('body').type('{esc}');
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('[data-testid="op-purge"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Purge');
    cy.get('body').type('{esc}');
  });

  it('a row click still opens the channel, and Load All says which channel it works on', () => {
    unlock();
    switchTo('operator');
    cy.get('[data-testid="channel-row"]').contains('dev-chat').click({ force: true });
    cy.get('[data-testid="operator-crumb"]').should('contain.text', 'dev-chat');
    cy.get('[data-testid="op-load-all"]').should('contain.text', 'in #dev-chat');
    cy.get('[data-testid="op-filters"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Filters');
    cy.get('body').type('{esc}');
  });

  it('Open feed puts the feed in the middle and Back returns, DMs and Package segments switch the queue', () => {
    unlock();
    switchTo('operator');
    cy.get('[data-testid="op-open-feed"]').click();
    cy.get('[data-testid="operator-main"] [data-testid="message-feed-row"]').should('exist');
    cy.get('[data-testid="operator-peek"]').should('not.exist');
    cy.get('[data-testid="op-open-feed"]').click();
    cy.get('[data-testid="operator-peek"]').should('exist');
    cy.get('[data-testid="operator-seg-dms"]').click();
    cy.get('[data-testid="dm-row"]').should('exist');
    cy.get('[data-testid="operator-crumb"]').should('contain.text', 'DMs');
    cy.get('[data-testid="operator-seg-package"]').click();
    cy.get('[data-testid="operator-crumb"]').should('contain.text', 'Package');
    cy.get('[data-testid="op-load-all"]').should('not.exist');
    cy.get('[data-testid="operator-seg-servers"]').click();
    cy.get('[data-testid="operator-guild"] [role="combobox"]').click();
    cy.get('[data-testid^="operator-guild-"]').first().click();
    cy.get('[data-testid="channel-row"]').should('exist');
  });

  it('on a phone shows one panel at a time from a tab bar with an active state', () => {
    unlock();
    switchTo('operator');
    cy.viewport(390, 844);
    cy.get('[data-testid="operator-tabs"]').should('be.visible');
    cy.get('[data-testid="operator-queue"]').should('be.visible');
    cy.get('[data-testid="op-tab-run"]').click();
    cy.get('[data-testid="operator-run-card"]').should('be.visible');
    cy.get('[data-testid="op-tab-run"]').should('have.class', 'Mui-selected');
    cy.get('[data-testid="op-tab-feed"]').click();
    cy.get('[data-testid="message-feed-row"]').should('exist');
    cy.viewport(1280, 800);
    cy.get('[data-testid="operator-main"]').should('be.visible');
  });
});
