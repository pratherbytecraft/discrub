/**
 * Compatibility popover (2.1.0): the info button on the hosted gate card
 * and in the TopBar opens the five-setup table with the detected column
 * marked "You"; below `sm` the More menu opens the same table as a bottom
 * sheet that fits 390px without sideways page scroll. Cypress runs the
 * plain web build, so the detected setup is a Bleeding Edge column.
 */
const PHONE: [number, number] = [390, 844];

const expectTable = () => {
  cy.get('[data-testid="compat-setup-label"]').should('contain.text', 'Bleeding Edge');
  const matrix = () => cy.get('[data-testid="compat-matrix"]');
  for (const col of ['Extension', 'Bleeding Edge', 'Chrome', 'Firefox', 'Mobile']) {
    matrix().should('contain.text', col);
  }
  matrix().find('[data-testid="compat-status-note"]').should('have.length', 8);
  matrix().find('[data-testid="compat-status-ok"]').should('have.length', 7);
  cy.get('[data-testid="compat-cell-be-chrome-signIn"]').should('contain.text', 'Manual');
  cy.get('[data-testid="compat-cell-firefox-ext-exportSize"]').should('contain.text', 'Smaller parts');
  cy.get('[data-testid="compat-cell-chrome-ext-exportMedia"]').should('contain.text', 'All files');
};

describe('Compatibility popover', () => {
  // 2.2.4: Compatibility moved from its own bar button into the More menu; on desktop it still opens as a popover.
  it('opens from the More menu on desktop with the detected column marked', () => {
    cy.login();
    cy.get('[data-testid="compat-button-topbar"]').should('not.exist');
    cy.get('[aria-label="More options"]').click();
    cy.get('[data-testid="more-menu-compatibility"]').click();
    cy.get('[data-testid="compat-popover"]').should('be.visible');
    expectTable();
    cy.get('[data-testid="compat-col-be-chrome"]').should('contain.text', 'You');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="compat-popover"]').should('not.exist');
  });

  it('opens as a bottom sheet from the More menu on a phone without sideways scroll', () => {
    cy.viewport(...PHONE);
    cy.interceptDiscordApi();
    cy.visit('/');
    cy.get('[data-testid="sidebar-menu-button"]', { timeout: 15000 }).should('be.visible');
    cy.get('[data-testid="compat-button-topbar"]').should('not.exist');

    cy.get('[aria-label="More options"]').click();
    cy.get('[data-testid="more-menu-compatibility"]').click();
    cy.get('[data-testid="compat-sheet"]').should('be.visible');
    expectTable();
    cy.get('[data-testid="compat-matrix"]').then(($m) => {
      expect($m[0].scrollWidth, 'table fits the sheet').to.be.at.most($m[0].clientWidth + 1);
    });
  });

  it('sits top-right of the hosted gate card, before any key is entered', () => {
    cy.interceptDiscordApi();
    cy.blockAutoAuth();
    cy.intercept('POST', '**/supporter/refresh', { forceNetworkError: true });
    cy.visit('/', {
      onBeforeLoad(win) {
        (win as unknown as { __hostedGateOverride__: boolean }).__hostedGateOverride__ = true;
      },
    });
    cy.get('[data-testid="hosted-gate"]', { timeout: 15000 }).should('be.visible');
    cy.get('[data-testid="hosted-gate-phone-note"]').should('not.exist');
    cy.get('[data-testid="compat-button-gate"]').click();
    cy.get('[data-testid="compat-popover"]').should('be.visible');
    expectTable();
  });
});
