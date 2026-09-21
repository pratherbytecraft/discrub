/// <reference types="cypress" />

/**
 * A page load in a layout without the sidebar list must still load the
 * servers. Before this, only the sidebar's ServerList asked for them, so
 * Native and Operator showed DMs only after a refresh (owner, 2026-09-20).
 */

describe('Servers load on a fresh page in every layout', () => {
  beforeEach(() => {
    cy.login();
  });

  it('Native: the rail shows the servers after a reload, with DMs, Package and Settings at full size', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-card-native"]').click();
    cy.get('[data-testid="native-rail"]').should('exist');
    cy.reload();
    cy.get('[data-testid="native-rail"]', { timeout: 15000 }).should('exist');
    cy.get('[data-testid^="rail-guild-"]', { timeout: 15000 }).should('have.length.at.least', 1);
    for (const id of ['rail-dms', 'rail-package', 'rail-settings']) {
      cy.get(`[data-testid="${id}"]`).should(($b) => {
        const r = $b[0].getBoundingClientRect();
        expect(Math.round(r.width)).to.eq(48);
        expect(Math.round(r.height)).to.eq(48);
      });
    }
    // The gear opens Settings.
    cy.get('[data-testid="rail-settings"]').click();
    cy.get('[role="dialog"]').should('contain.text', 'Settings');
    cy.get('body').type('{esc}');
    // The supporter wall can be closed and reopened from Native's own bar. It is a fixed column from 1440 px up.
    cy.viewport(1500, 800);
    cy.get('[data-testid="donation-drawer"]').should('be.visible');
    cy.get('[data-testid="supporter-wall-toggle"]').should('have.attr', 'aria-pressed', 'true').click();
    cy.get('[data-testid="donation-drawer"]').should('not.be.visible');
    cy.get('[data-testid="supporter-wall-toggle"]').should('have.attr', 'aria-pressed', 'false').click();
    cy.get('[data-testid="donation-drawer"]').should('be.visible');
    // Below 1440 px the wall is an overlay in Native, so the inspector keeps its place.
    cy.viewport(1280, 720);
    cy.get('[data-testid="donation-drawer"]').should('not.exist');
    cy.get('[data-testid="native-inspector"]').should('be.visible');
    cy.get('[data-testid="supporter-wall-toggle"]').should('have.attr', 'aria-pressed', 'false').click();
    cy.get('[data-testid="donation-drawer"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="donation-drawer"]').should('not.exist');
    // Back to Classic so later specs start from the default.
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-card-classic"]').click();
  });
});
