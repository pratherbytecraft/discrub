/**
 * Theme switching from the Themes hub (the gift-button dialog). The
 * old TopBar cycle button was retired when the hub took over as the
 * single theme-switching surface. There is no live preview: the card
 * swatches are the preview, and a locked card applies nothing.
 */

const DARK_BG = 'rgb(30, 33, 36)'; // discord-dark background.default
const LIGHT_BG = 'rgb(255, 255, 255)'; // discord-light background.default

describe('Theme switching from the hub', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  const openHub = () => {
    cy.openThemesHub();
    cy.get('[data-testid="supporter-theme-showcase"]').scrollIntoView().should('be.visible');
  };

  it('the gift button opens the hub with the full theme grid', () => {
    openHub();
    cy.get('[data-testid="theme-card-auto"]').should('be.visible');
    cy.get('[data-testid="theme-card-discord-light"]').should('be.visible');
    // All 8 supporter themes locked for a free user.
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid^="theme-locked-"]').should(
      'have.length',
      8,
    );
  });

  it('picking a free theme applies instantly and persists after closing', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-light"]').click();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
  });

  it('has no live preview: no eye, and a locked supporter card changes nothing', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-dark"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);

    cy.get('[data-testid="theme-preview-terminal"]').should('not.exist');
    cy.get('[data-testid="theme-preview-bar"]').should('not.exist');

    cy.get('[data-testid="theme-card-amoled-void"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);
    cy.get('[data-testid="theme-selected-amoled-void"]').should('not.exist');
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');

    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);
  });
});
