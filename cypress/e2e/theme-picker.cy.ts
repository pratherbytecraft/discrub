/**
 * Themes hub details: the roster, the Settings pointer, preview
 * accents, and the animations toggle. Theme selection left Settings
 * entirely — the Display tab only points at the hub now.
 */

const LIGHT_BG = 'rgb(255, 255, 255)'; // discord-light background.default

describe('Themes hub', () => {
  beforeEach(() => {
    cy.login();
  });

  const openHub = () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="supporter-theme-showcase"]').scrollIntoView().should('be.visible');
  };

  it('the Settings Display tab has no picker, only a pointer that opens the hub', () => {
    cy.get('[aria-label="Settings"]').click();
    cy.get('[role="dialog"]', { timeout: 5000 }).should('be.visible');
    cy.contains('button', 'Display').click();

    cy.get('[data-testid="theme-picker"]').should('not.exist');
    cy.get('[data-testid^="theme-card-"]').should('not.exist');

    cy.get('[data-testid="display-open-themes-hub"]').click();
    cy.get('[data-testid="supporter-theme-showcase"]').scrollIntoView().should('be.visible');
  });

  it('shows the full v2.1.0 roster with supporter themes locked', () => {
    openHub();
    // Auto card + 14 registry themes
    cy.get('[data-testid^="theme-card-"]').should('have.length', 15);
    // All 8 supporter themes are locked for a free user, marked on the
    // swatch corner (the label row keeps its full width).
    cy.get('[data-testid^="theme-locked-"]').should('have.length', 8);
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

  it('supporter theme preview shows the animated accent strip', () => {
    openHub();
    cy.get('[data-testid="theme-accent-strip"]').should('not.exist');
    cy.get('[data-testid="theme-preview-synthwave"]').click();
    cy.get('[data-testid="theme-accent-strip"]').should('exist');
    cy.get('[data-testid="theme-preview-stop"]').click();
    cy.get('[data-testid="theme-accent-strip"]').should('not.exist');
  });

  it('the theme animations toggle applies instantly and sticks', () => {
    openHub();
    cy.get('[data-testid="theme-animations-toggle"]').scrollIntoView().should('be.checked');
    cy.get('[data-testid="theme-animations-toggle"]').click();
    cy.get('[data-testid="theme-animations-toggle"]').should('not.be.checked');

    // No save step: reopening the hub shows the persisted value.
    cy.get('[aria-label="Close Supporter dialog"]').click();
    openHub();
    cy.get('[data-testid="theme-animations-toggle"]')
      .scrollIntoView()
      .should('not.be.checked');
  });
});
