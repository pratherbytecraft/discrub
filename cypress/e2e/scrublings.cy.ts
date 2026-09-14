// 2.2.0 item 9: the Scrublings, pixel characters on the top bar, and their Appearance tab.
const KEY = { keyStatus: 'valid', payload: { v: 2, kid: 'k', jti: 'j', name: 'Jordan', eh: 'x', ent: { themes: null }, iat: 1, exp: null }, lastRefreshAt: 1 };
const giveKey = () =>
  cy.window().its('__store__').invoke('getState').its('supporter.initialized').should('be.true')
    .then(() => cy.window()).then((win) => (win as any).__store__.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: KEY }));
const openTab = () => {
  cy.get('[data-testid="gift-button"]').click();
  cy.get('[data-testid="appearance-tab-scrublings"]').click();
  cy.get('[data-testid="scrublings-tab"]').should('be.visible');
};
const picked = () => cy.window().its('__store__').invoke('getState').its('app.settings.appScrublingsPicked');
const setLayout = (key: string) => { cy.get('[data-testid="gift-button"]').click({ force: true }); cy.get(`[data-testid="layout-card-${key}"]`).click({ force: true }); cy.wait(500); };

describe('Scrublings (2.2.0)', () => {
  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  it('shows Suds and the Mage on the bar by default, hidden from assistive tech, with the door ticks', () => {
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'aria-hidden', 'true').and('have.attr', 'data-count', '2').and('have.attr', 'data-frozen', 'false');
    cy.get('[data-testid="scrubling-suds"]').should('exist');
    cy.get('[data-testid="scrubling-mage"]').should('exist');
    cy.get('[data-testid="scrublings-door-left"]').should('exist');
    cy.get('[data-testid="scrublings-door-right"]').should('exist');
    cy.get('[data-testid="scrubling-suds"]').should('have.css', 'image-rendering', 'pixelated');
  });

  it('looks on hover and plays a trick on a click', () => {
    // Alone on the bar, so no pair scene can start mid test.
    cy.window().then((win) => (win as any).__store__.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...(win as any).__store__.getState().app.settings, appScrublingsPicked: '["mage"]' } }));
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '1');
    cy.get('[data-testid="scrubling-mage"]').trigger('pointerover');
    cy.get('[data-testid="scrubling-mage"]', { timeout: 2000 }).should('have.attr', 'data-frame', 'look');
    cy.get('[data-testid="scrubling-mage"]').trigger('pointerout');
    cy.get('[data-testid="scrubling-mage"]').trigger('pointerdown', { button: 0, clientX: 600, pointerId: 1 }).trigger('pointerup', { button: 0, clientX: 600, pointerId: 1 });
    cy.get('[data-testid="scrubling-mage"]', { timeout: 2000 }).invoke('attr', 'data-frame').should('match', /^tele/);
  });

  it('remembers where a character is dragged to', () => {
    cy.get('[data-testid="scrubling-suds"]')
      .trigger('pointerdown', { button: 0, clientX: 500, pointerId: 1 })
      .trigger('pointermove', { clientX: 540, pointerId: 1 })
      .trigger('pointermove', { clientX: 560, pointerId: 1 })
      .trigger('pointerup', { button: 0, clientX: 560, pointerId: 1 });
    cy.window().its('__store__').invoke('getState').its('app.settings.appScrublingsPositions').should('contain', '"suds"');
  });

  it('lists the eight in the Appearance tab, two free, six locked, and a locked pick opens the hub', () => {
    openTab();
    cy.get('[data-testid="scrublings-cards"] [data-testid^="scrubling-card-"]').should('have.length', 8);
    cy.get('[data-testid="scrubling-card-suds"]').should('have.attr', 'aria-checked', 'true');
    cy.get('[data-testid="scrubling-card-mage"]').should('have.attr', 'aria-checked', 'true');
    cy.get('[data-testid^="scrubling-locked-"]').should('have.length', 6);
    cy.get('[data-testid="scrublings-count"]').should('have.text', '2 of 3 picked');
    cy.get('[data-testid="appearance-hint"]').should('have.text', 'Suds and the Mage are free. The rest come with supporter access.');
    cy.get('[data-testid="scrubling-card-ghost"]').click();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
    picked().should('eq', '["suds","mage"]');
  });

  it('unpicks and picks, and the switch hides them all while keeping the picks', () => {
    openTab();
    cy.get('[data-testid="scrubling-card-mage"]').click();
    picked().should('eq', '["suds"]');
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '1');
    cy.get('[data-testid="scrubling-card-mage"]').click();
    picked().should('eq', '["suds","mage"]');
    cy.get('[data-testid="scrublings-switch"] input').click();
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '0');
    cy.get('[data-testid="scrubling-suds"]').should('not.exist');
    picked().should('eq', '["suds","mage"]');
    cy.get('[data-testid="scrublings-switch"] input').click();
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
  });

  it('with a key: picks a supporter one, caps at three, and shows the supporter hint', () => {
    giveKey();
    openTab();
    cy.get('[data-testid^="scrubling-locked-"]').should('have.length', 0);
    cy.get('[data-testid="appearance-hint"]').should('have.text', 'Custom Scrublings are made to order on Ko-fi.');
    cy.get('[data-testid="scrubling-card-cat"]').click();
    picked().should('eq', '["suds","mage","cat"]');
    cy.get('[data-testid="scrublings-count"]').should('have.text', '3 of 3 picked');
    cy.get('[data-testid="scrubling-card-dog"]').should('have.attr', 'aria-disabled', 'true').click();
    picked().should('eq', '["suds","mage","cat"]');
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '3');
    cy.get('[data-testid="scrubling-cat"]').should('exist');
  });

  it('keeps a lapsed key from showing a supporter pick, but keeps the pick', () => {
    giveKey();
    openTab();
    cy.get('[data-testid="scrubling-card-ghost"]').click();
    picked().should('eq', '["suds","mage","ghost"]');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="scrubling-ghost"]').should('exist');
    cy.window().then((win) => (win as any).__store__.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { ...KEY, keyStatus: 'expired' } }));
    cy.get('[data-testid="scrubling-ghost"]').should('not.exist');
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
    picked().should('eq', '["suds","mage","ghost"]');
  });

  it('follows the layout: the stage moves to every top bar', () => {
    giveKey();
    // The Ko-fi column would leave Native's head no free stretch at this width.
    cy.window().then((win) => (win as any).__store__.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...(win as any).__store__.getState().app.settings, appShowKoFiFeed: 'false' } }));
    setLayout('native');
    cy.get('[data-testid="native-head"] [data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
    setLayout('workbench');
    cy.get('.MuiAppBar-root [data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
    setLayout('simple');
    cy.get('[data-testid="simple-top"] [data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
    setLayout('operator');
    cy.get('[data-testid="operator-top"] [data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
    setLayout('timeline');
    cy.get('[data-testid="simple-top"] [data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
    setLayout('classic');
    cy.get('.MuiAppBar-root [data-testid="scrublings-stage"]').should('have.attr', 'data-count', '2');
  });

  it('freezes on the idle frame when theme animations are off', () => {
    cy.window().then((win) => (win as any).__store__.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...(win as any).__store__.getState().app.settings, appThemeAnimations: 'false' } }));
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-frozen', 'true');
    cy.wait(1500);
    cy.get('[data-testid="scrubling-suds"]').should('have.attr', 'data-frame', 'idle1');
    cy.get('[data-testid="scrubling-mage"]').should('have.attr', 'data-frame', 'idle1');
  });

  it('shows one on a phone width', () => {
    cy.viewport(390, 844);
    cy.get('[data-testid="scrublings-stage"]').should(($el) => expect(Number($el.attr('data-count'))).to.be.at.most(1));
  });
});
