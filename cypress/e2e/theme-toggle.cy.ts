/**
 * Theme switching from the Themes hub (the gift-button dialog). The
 * old TopBar cycle button was retired when the hub took over as the
 * single theme-switching surface. Previewing is deliberate and sticky:
 * the per-card eye (or a click on a locked card) starts it, and it
 * lasts until Stop, another preview, an apply, or the hub closing.
 */

const DARK_BG = 'rgb(30, 33, 36)'; // discord-dark background.default
const LIGHT_BG = 'rgb(255, 255, 255)'; // discord-light background.default
const TERMINAL_BG = 'rgb(10, 15, 10)'; // terminal background.default

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

  it('the eye starts a sticky preview; Stop reverts to the selection', () => {
    openHub();
    // Deterministic baseline — 'auto' resolves differently per browser.
    cy.get('[data-testid="theme-card-discord-dark"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);

    cy.get('[data-testid="theme-preview-terminal"]').click();
    cy.get('body').should('have.css', 'background-color', TERMINAL_BG);
    cy.get('[data-testid="theme-preview-bar"]').should('contain.text', 'Terminal');

    // Sticky: pointer wandering over other cards must NOT change it.
    cy.get('[data-testid="theme-card-overcast"]').trigger('mouseover');
    cy.get('body').should('have.css', 'background-color', TERMINAL_BG);

    cy.get('[data-testid="theme-preview-stop"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);
  });

  it('Apply in the preview bar selects the previewed theme', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-dark"]').click();
    cy.get('[data-testid="theme-preview-discord-light"]').click();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);

    cy.get('[data-testid="theme-preview-apply"]').click();
    cy.get('[data-testid="theme-selected-discord-light"]').should('exist');
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
  });

  it('locked supporter cards preview on click and revert when the hub closes', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-dark"]').click();

    cy.get('[data-testid="theme-card-amoled-void"]').click();
    cy.get('body').should('have.css', 'background-color', 'rgb(0, 0, 0)');
    // The bar names it and marks it locked — no Apply offered.
    cy.get('[data-testid="theme-preview-bar"]').should('contain.text', 'Locked');
    cy.get('[data-testid="theme-preview-apply"]').should('not.exist');
    cy.get('[data-testid="theme-selected-amoled-void"]').should('not.exist');

    // Closing the hub always drops the preview.
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', DARK_BG);
  });
});
