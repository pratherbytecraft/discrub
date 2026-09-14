// 2.2.0 item 8: the Timeline layout (supporter). A live key is put in the store; without one the card is locked.
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
const barTotal = () => cy.get('[data-testid="timeline-bar"]').then(($b) => $b.toArray().reduce((a, el) => a + Number(el.getAttribute('data-count')), 0));
const loaded = () => cy.window().then((win) => (win as any).__store__.getState().message.filteredMessages.length as number);

describe('Timeline layout (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  afterEach(() => {
    cy.get('body').then(($b) => {
      if ($b.find('[data-testid="timeline-shell"]').length) { cy.get('body').type('{esc}'); switchTo('classic'); cy.get('[data-testid="timeline-shell"]').should('not.exist'); }
    });
  });

  it('is locked without a key: the card opens the hub and there is no preview', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-locked-timeline"]').should('exist');
    cy.get('[data-testid="layout-card-timeline"]').click();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-timeline"]').should('not.exist');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="timeline-shell"]').should('not.exist');
  });

  it('with a key: strip, action row, month list and a feed grouped by day, and every count agrees', () => {
    unlock();
    switchTo('timeline');
    cy.get('[data-testid="timeline-shell"]').should('be.visible');
    cy.get('[data-testid="simple-picker"]').should('contain.text', 'general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    cy.get('[data-testid="day-heading"]').should('have.length.greaterThan', 0);
    loaded().then((n) => {
      barTotal().should('eq', n);
      cy.get('[data-testid="timeline-total"]').invoke('text').then((txt) => expect(Number(txt.replace(/\D/g, ''))).to.eq(n));
      cy.get('[data-testid="timeline-month"]').then(($m) => expect($m.toArray().reduce((a, el) => a + Number((el.children[1]?.textContent ?? '0').replace(/\D/g, '')), 0)).to.eq(n));
    });
    // The headings on screen never repeat a day.
    cy.get('[data-testid="day-heading"]').then(($h) => { const keys = $h.toArray().map((el) => el.getAttribute('data-day')); expect(new Set(keys).size).to.eq(keys.length); });
  });

  it('Select day ticks that day only, and a second click clears it', () => {
    unlock();
    switchTo('timeline');
    cy.get('[data-testid="day-heading"]').first().then(($h) => {
      const n = Number(($h.find('[data-testid="day-count"]').text().match(/\d+/) ?? ['0'])[0]);
      cy.wrap($h).find('[data-testid="select-day"]').click();
      cy.window().then((win) => expect((win as any).__store__.getState().message.selectedMessages.length).to.eq(n));
      cy.get('[data-testid="day-heading"]').first().find('[data-testid="select-day"]').should('have.text', 'Clear day').click();
      cy.window().then((win) => expect((win as any).__store__.getState().message.selectedMessages.length).to.eq(0));
    });
  });

  it('a click on a bar jumps without filtering, a drag sets a range the Filters dialog shows, Clear range brings everything back', () => {
    unlock();
    switchTo('timeline');
    loaded().then((n) => {
      cy.get('[data-testid="timeline-bar"][data-count!="0"]').last().trigger('pointerdown', { pointerType: 'mouse', button: 0, force: true });
      cy.window().then((win) => win.dispatchEvent(new win.PointerEvent('pointerup')));
      cy.get('[data-testid="timeline-range"]').should('not.exist');
      loaded().should('eq', n);

      cy.get('[data-testid="timeline-bar"]').then(($b) => {
        if ($b.length < 2) return;
        cy.wrap($b.eq($b.length - 1)).trigger('pointerdown', { pointerType: 'mouse', button: 0, force: true });
        cy.wrap($b.eq($b.length - 1)).trigger('pointerover', { force: true });
        cy.wrap($b.eq(Math.max(0, $b.length - 2))).trigger('pointerover', { force: true });
        cy.window().then((win) => win.dispatchEvent(new win.PointerEvent('pointerup')));
        cy.get('[data-testid="timeline-range"]').should('be.visible').and('contain.text', 'Select all and Export use this range.');
        // The strip keeps every bar while a range is on.
        cy.get('[data-testid="timeline-bar"]').should('have.length', $b.length);
        cy.get('[data-testid="timeline-bar"][data-in-range="true"]').should('have.length', 2);
        cy.get('[data-testid="timeline-range-clear"]').click();
        cy.get('[data-testid="timeline-range"]').should('not.exist');
        loaded().should('eq', n);
      });
    });
  });

  it('opens the shared dialogs from the action row and keeps the top bar in Focus', () => {
    unlock();
    switchTo('timeline');
    cy.get('[data-testid="timeline-filters"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="timeline-export"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="timeline-purge"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('[data-testid="simple-focus"]').click({ force: true });
    cy.get('[data-testid="timeline-strip"]').should('not.exist');
    cy.get('[data-testid="simple-top"]').should('be.visible');
    cy.get('[data-testid="focus-pill"]').should('exist');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="timeline-strip"]').should('be.visible');
  });

  it('phone width: the actions fold into one menu that also opens the month list', () => {
    unlock();
    switchTo('timeline');
    cy.viewport(390, 844);
    cy.get('[data-testid="timeline-menu"]').click();
    cy.get('[data-testid="timeline-menu-export"]').should('be.visible');
    cy.get('[data-testid="timeline-menu-purge"]').should('be.visible');
    cy.get('[data-testid="timeline-menu-months"]').click();
    cy.get('[data-testid="timeline-total"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.viewport(1280, 800);
  });
});
