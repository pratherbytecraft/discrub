describe('Welcome Panel & Guided Tour', () => {
  describe('Welcome Panel', () => {
    beforeEach(() => {
      cy.login();
    });

    it('should show WelcomePanel when no server/channel selected', () => {
      cy.contains('Welcome to Discrub').should('be.visible');
      cy.contains('Take a Tour').should('be.visible');
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

  describe('Phase 1 — Shell Tour', () => {
    beforeEach(() => {
      cy.login();
    });

    it('should start tour when Take a Tour is clicked', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');
      cy.contains('1 of 9').should('be.visible');
    });

    it('should navigate through tour steps with Next', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');
      cy.contains('button', 'Next').click();

      cy.contains('Switch here to browse your direct messages').should('be.visible');
      cy.contains('2 of 9').should('be.visible');
      cy.contains('button', 'Next').click();

      cy.contains('Filter servers, channels, or DMs by name').should('be.visible');
      cy.contains('3 of 9').should('be.visible');
    });

    it('should navigate back with Back button', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');
      cy.contains('button', 'Next').click();
      cy.contains('Switch here to browse your direct messages').should('be.visible');
      cy.contains('button', 'Back').click();
      cy.contains('Your Discord servers appear here').should('be.visible');
    });

    it('should show Skip button only on first step', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');
      cy.get('[data-action="skip"]').should('be.visible');
      cy.contains('button', 'Next').click();
      cy.contains('Switch here to browse your direct messages').should('be.visible');
      cy.get('[data-action="skip"]').should('not.exist');
    });

    it('should close tour when Skip is clicked', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');
      cy.get('[data-action="skip"]').click();
      cy.contains('Your Discord servers appear here').should('not.exist');
    });

    it('should show Finish on last step and complete tour', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');

      for (let i = 0; i < 8; i++) {
        cy.contains('button', 'Next').click();
      }

      cy.contains('button', 'Finish').should('be.visible');
      cy.contains('9 of 9').should('be.visible');
      cy.contains('button', 'Finish').click();

      // Tour tooltip content should be gone
      cy.contains('Sign out when you\'re done').should('not.exist');
    });

    it('should show progress bar during tour', () => {
      cy.contains('Take a Tour').click();
      cy.contains('Your Discord servers appear here', { timeout: 5000 }).should('be.visible');
      cy.get('[role="progressbar"]').should('be.visible');
    });
  });

  // Phase 2 (Contextual Tips) auto-trigger is skipped in Cypress to avoid
  // blocking other tests. Tour logic is covered by unit tests in TourTooltip.test.tsx.
});
