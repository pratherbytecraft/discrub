/**
 * Theme switching from the Themes hub (the gift-button dialog). The
 * old TopBar cycle button was retired when the hub took over as the
 * single theme-switching surface. Locked cards carry an eye that starts a
 * look-only live preview and closes the hub; clicking a locked card itself
 * applies nothing.
 */

const DARK_BG = 'rgb(30, 33, 36)'; // discord-dark background.default
const LIGHT_BG = 'rgb(255, 255, 255)'; // discord-light background.default

describe('Theme switching from the hub', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  const openHub = () => {
    cy.openThemeGrid();
  };

  it('the gift button opens the hub with the full theme grid', () => {
    openHub();
    cy.get('[data-testid="theme-card-auto"]').should('be.visible');
    cy.get('[data-testid="theme-card-discord-light"]').should('be.visible');
    // All 9 supporter themes locked for a free user.
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid^="theme-locked-"]').should(
      'have.length',
      9,
    );
  });

  it('picking a free theme applies instantly and persists after closing', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-light"]').click();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
    cy.closeAppearance();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
  });

  it('free cards have no eye; a locked card changes nothing on click and its eye previews from the hub', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-dark"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);

    cy.get('[data-testid="theme-preview-terminal"]').should('not.exist');
    cy.get('[data-testid="theme-preview-amoled-void"]').click();
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
    cy.get('[data-testid="preview-bar"]').should('contain.text', 'Previewing AMOLED Void');
    cy.get('body').should('have.css', 'background-color', 'rgb(0, 0, 0)');
    cy.get('[data-testid="preview-end"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);

    openHub();

    cy.get('[data-testid="theme-card-amoled-void"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);
    cy.get('[data-testid="theme-selected-amoled-void"]').should('not.exist');
    cy.get('[data-testid="supporter-panel"]').should('be.visible');

    cy.closeAppearance();
    cy.get('body').should('have.css', 'background-color', DARK_BG);
  });
});
