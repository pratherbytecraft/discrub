/**
 * #275: browse a data package without signing in.
 *
 * The landing page offers "Browse a data package". It opens the main
 * layout as a guest with only the Package view: no Servers or DMs entry
 * points, a Sign in button where the profile chip sits. A package imports
 * and browses read-only, exports locally, and signing in afterwards
 * validates it against the account so delete switches on for the owner.
 */
describe('Browse a data package without signing in (#275)', () => {
  const API = '**/api/v10';

  const enterAsGuest = () => {
    cy.interceptDiscordApi();
    cy.blockAutoAuth();
    cy.visit('/');
    cy.get('[data-testid="landing-browse-package"]', { timeout: 10000 }).should('be.visible').click();
  };

  const importFixture = () => {
    cy.contains('button', /Choose ZIP file|Import package/).click();
    cy.get('[data-testid="package-file-input"]').selectFile('cypress/fixtures/test-package.zip', { force: true });
    cy.contains(/Not signed in/i, { timeout: 15000 }).should('be.visible');
  };

  beforeEach(() => {
    cy.task('downloads:clean');
    enterAsGuest();
  });

  it('opens only the Package view and imports a package read-only', () => {
    cy.get('[data-tour="package-tab"]').should('have.attr', 'aria-selected', 'true');
    cy.get('[data-tour="servers-tab"]').should('not.exist');
    cy.get('[data-tour="dms-tab"]').should('not.exist');
    cy.get('[data-testid="topbar-sign-in"]').should('be.visible');
    cy.get('[aria-label^="Your profile"]').should('not.exist');

    importFixture();
    cy.contains('.MuiListItemButton-root', 'general').click();
    cy.contains('hello world').should('be.visible');
    // Read-only: nothing can be selected for delete without a token.
    cy.get('input[aria-label="Select message 1001"]').should('be.disabled');
    cy.window().then((win) => {
      const state = (win as any).__store__.getState();
      expect(state.auth.guestMode).to.eq(true);
      expect(state.auth.token).to.eq(null);
      expect(state.package.validation.readOnly).to.eq(true);
    });
  });

  it('exports a channel locally as a guest', () => {
    importFixture();
    cy.contains('.MuiListItemButton-root', 'general').click();
    cy.contains('hello world').should('be.visible');
    cy.contains('button', /^Export/).click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').contains('button', /^Export$/).click();
    cy.waitForDownload(/\.zip$/i, 60000).then((fileName) => {
      cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
        const names = entries.map((e) => e.name);
        expect(names.some((n) => /general.*page-1\.html$/.test(n)), `html page in ${names.join(', ')}`).to.eq(true);
      });
    });
  });

  it('picks the stored package up again after a reload', () => {
    importFixture();
    cy.reload();
    cy.get('[data-testid="landing-browse-package"]', { timeout: 10000 }).should('be.visible').click();
    cy.contains('.MuiListItemButton-root', 'general', { timeout: 15000 }).should('be.visible');
    cy.contains(/Not signed in/i).should('be.visible');
  });

  it('signing in afterwards validates the package against the account', () => {
    importFixture();

    // The newest intercept wins: let the sign in through, then leave guest
    // mode. The landing page signs in with the dev token on its own.
    cy.fixture('user.json').then((user) => {
      cy.intercept('GET', `${API}/users/@me`, { statusCode: 200, body: user }).as('signIn');
    });
    cy.get('[data-testid="topbar-sign-in"]').click();
    cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');

    // The package is still loaded and now belongs to the signed in user.
    cy.get('[data-tour="servers-tab"]').should('exist');
    cy.get('[data-tour="dms-tab"]').should('exist');
    cy.get('[data-tour="package-tab"]').should('have.attr', 'aria-selected', 'true');
    cy.contains(/Not signed in/i).should('not.exist');
    cy.contains('.MuiListItemButton-root', 'general').click();
    cy.contains('hello world').should('be.visible');
    cy.get('input[aria-label="Select message 1001"]').should('not.be.disabled');
    cy.window().then((win) => {
      const state = (win as any).__store__.getState();
      expect(state.auth.guestMode).to.eq(false);
      expect(state.package.validation.readOnly).to.eq(false);
    });
  });
});
