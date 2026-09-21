/**
 * Themes hub details: the roster, the Settings pointer,
 * accents, and the animations toggle. Theme selection left Settings
 * entirely — the Display tab only points at the hub now.
 */

const LIGHT_BG = 'rgb(255, 255, 255)'; // discord-light background.default

describe('Themes hub', () => {
  beforeEach(() => {
    cy.login();
  });

  const openHub = () => {
    cy.openThemeGrid();
  };

  it('the Settings Display tab has no picker and no layout cards, only a line that points to Appearance', () => {
    cy.get('[aria-label="Settings"]').click();
    cy.get('[role="dialog"]', { timeout: 5000 }).should('be.visible');
    cy.contains('button', 'Display').click();

    cy.get('[data-testid="theme-picker"]').should('not.exist');
    cy.get('[data-testid^="theme-card-"]').should('not.exist');

    cy.get('[data-testid="display-layout-block"]').should('not.exist');
    cy.get('[data-testid="display-appearance-pointer"]').should('have.text', 'Layouts, themes and Scrublings are under Appearance on the top bar.');
  });

  it('shows the full v2.1.0 roster with supporter themes locked', () => {
    openHub();
    // Auto card + 15 registry themes
    cy.get('[data-testid^="theme-card-"]').should('have.length', 16);
    // All 9 supporter themes are locked for a free user, marked on the
    // swatch corner (the label row keeps its full width).
    cy.get('[data-testid^="theme-locked-"]').should('have.length', 9);
  });

  it('a hub pick persists across a reload', () => {
    openHub();
    cy.get('[data-testid="theme-card-discord-light"]').click();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
    // The pick applies from Redux before its IndexedDB write commits; a
    // reload in that window loses the write. Wait for the persisted value.
    cy.readIdbStore('settings').should('include', 'discord-light');

    cy.reload();
    cy.get('body').should('have.css', 'background-color', LIGHT_BG);
  });

  it('the theme animations toggle applies instantly and sticks', () => {
    openHub();
    cy.get('[data-testid="theme-animations-toggle"]').scrollIntoView().should('be.checked');
    cy.get('[data-testid="theme-animations-toggle"]').click();
    cy.get('[data-testid="theme-animations-toggle"]').should('not.be.checked');

    // No save step: reopening the hub shows the persisted value.
    cy.closeAppearance();
    openHub();
    cy.get('[data-testid="theme-animations-toggle"]')
      .scrollIntoView()
      .should('not.be.checked');
  });
});
