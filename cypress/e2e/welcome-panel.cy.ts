describe('Welcome Panel', () => {
  describe('Welcome Panel', () => {
    beforeEach(() => {
      cy.login();
    });

    it('should show WelcomePanel when no server/channel selected', () => {
      cy.contains('Welcome to Discrub').should('be.visible');
      cy.contains('Take a Tour').should('not.exist');
      cy.contains('Explore Features').should('be.visible');
      cy.contains('Coming from Classic?').should('be.visible');
    });

    it('should show Getting Started steps', () => {
      cy.contains('Getting Started').should('be.visible');
      cy.contains('Select a server from the sidebar').should('be.visible');
    });

    it('should show feature cards', () => {
      cy.contains('h6', 'Features').scrollIntoView().should('be.visible');
      cy.contains('h6', 'Features').parent().within(() => {
        cy.contains('Export').should('exist');
        cy.contains('Purge').should('exist');
        cy.contains('Analytics').should('exist');
      });
    });

    it('should show Classic migration section', () => {
      cy.contains('Coming from Discrub Classic?').scrollIntoView().should('be.visible');
      cy.contains('Read the full migration guide').should('exist');
      // Migration guide is now a button that opens an in-app modal
      cy.contains('Read the full migration guide').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('body').type('{esc}');
    });

    it('should smooth scroll to Features when Explore Features clicked', () => {
      cy.contains('Explore Features').click();
      cy.wait(500);
      cy.contains('h6', 'Features').should('be.visible');
    });

    it('should disappear when a server and channel are selected', () => {
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.contains('Welcome to Discrub').should('not.exist');
    });
  });
});
