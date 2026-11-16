/**
 * 2.2.10: every Discord API call waits its turn at one gate, whatever
 * started it. The rest of the suite runs with the gate off (main.tsx);
 * this spec turns it on and checks that calls made together go out at
 * least half a second apart.
 */
const API = '**/api/v10/**';

describe('API call gate', () => {
  const calls: { at: number; url: string }[] = [];
  const gaps = () => calls.slice(1).map((call, i) => call.at - calls[i].at);

  beforeEach(() => {
    calls.length = 0;
    cy.login();
    cy.window().then((win) => (win as any).__callGate__({ minGapMs: 500, jitterMs: 0 }));
    // Added last, so it sees every API call first and hands it on to the stubs.
    cy.intercept(API, (req) => {
      calls.push({ at: Date.now(), url: req.url.replace(/^.*\/api\/v10/, '') });
    });
  });

  it('opening a Server and a Channel sends its calls at least 500 ms apart', () => {
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.', { timeout: 30000 }).should('exist');
    cy.wait(1500);
    cy.then(() => {
      expect(calls.length, 'API calls made').to.be.greaterThan(2);
      // 60 ms of slack for the time a request takes to reach the proxy.
      const tight = gaps().map((gap, i) => ({ gap, pair: `${calls[i].url} -> ${calls[i + 1].url}` })).filter((entry) => entry.gap < 440);
      expect(tight, 'calls under 500 ms apart').to.deep.eq([]);
    });
  });

  it('the Load Thread list and a second Channel opened beside it still take turns', () => {
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.', { timeout: 30000 }).should('exist');
    cy.then(() => { calls.length = 0; });
    cy.contains('button', 'Load Thread').click();
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();
    cy.contains('[data-testid="channel-row"]', 'dev-chat').click({ force: true });
    cy.wait(4000);
    cy.then(() => {
      expect(calls.length, 'API calls made').to.be.greaterThan(1);
      const tight = gaps().map((gap, i) => ({ gap, pair: `${calls[i].url} -> ${calls[i + 1].url}` })).filter((entry) => entry.gap < 440);
      expect(tight, 'calls under 500 ms apart').to.deep.eq([]);
    });
  });

  it('with the gate off the same calls are not held', () => {
    cy.window().then((win) => (win as any).__callGate__({ minGapMs: 0 }));
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.', { timeout: 30000 }).should('exist');
    cy.then(() => {
      expect(gaps().some((gap) => gap < 300), 'some calls go out together').to.eq(true);
    });
  });
});
