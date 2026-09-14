// 2.2.0 item 2: shared behaviours every layout reads (A3 log sheet, A13 access-ended notice).
// Focus (A2) lives in focused-view.cy.ts.
describe('Shell behaviours (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  describe('status log sheet', () => {
    it('rises over the feed column when expanded and drops back when collapsed', () => {
      cy.get('[data-tour="status-panel"]').should('not.have.attr', 'data-sheet');
      cy.get('[aria-label="Expand log"]').click({ force: true });
      cy.get('[data-tour="status-panel"]').should('have.attr', 'data-sheet', 'true').then(($p) => {
        const r = $p[0].getBoundingClientRect();
        expect(r.left).to.be.greaterThan(200);
        expect(Math.round(r.bottom)).to.eq(Cypress.config('viewportHeight'));
      });
      cy.get('[aria-label="Collapse log"]').click({ force: true });
      cy.get('[data-tour="status-panel"]').should('not.have.attr', 'data-sheet');
    });
  });

  describe('access-ended notice', () => {
    const payload = { v: 1, kid: 'k', jti: 'j', name: 'Aaron', eh: 'x', ent: { themes: null }, iat: 1, exp: null };
    it('appears once when a valid key comes back expired, names the fallback, and closes', () => {
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { keyStatus: 'valid', payload, lastRefreshAt: 1 } });
        store.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { keyStatus: 'expired', payload, lastRefreshAt: null } });
      });
      cy.get('[data-testid="access-ended-notice"]').should('be.visible')
        .and('contain.text', 'Your supporter access has ended.')
        .and('contain.text', 'Layout and theme are back to Classic and Dark Original. Your settings are kept.')
        .and('contain.text', 'After renewing, open Themes and Support and click Refresh.');
      cy.get('[data-testid="access-ended-notice"] [aria-label="Close"]').click();
      cy.get('[data-testid="access-ended-notice"]').should('not.exist');
      // Still expired on the next refresh: quiet.
      cy.window().then((win) => {
        (win as any).__store__.dispatch({ type: 'supporter/refreshKey/fulfilled', payload: { keyStatus: 'expired', payload, lastRefreshAt: null } });
      });
      cy.get('[data-testid="access-ended-notice"]').should('not.exist');
    });
  });
});
