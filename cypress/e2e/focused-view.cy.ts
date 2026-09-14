describe('Focused View Mode', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
  });

  it('Focus button is visible in the channel toolbar', () => {
    cy.get('[data-testid="focus-mode-toggle"]')
      .should('be.visible')
      .and('contain.text', 'Focus');
  });

  it('clicking Focus hides Sidebar, StatusPanel and DonationDrawer, keeps the top bar and shows the pill', () => {
    // Chrome is present before toggling.
    cy.get('[data-testid="topbar"], header').should('exist');
    cy.get('[data-tour="status-panel"]').should('exist');

    cy.get('[data-testid="focus-mode-toggle"]').click({ force: true });

    // Redux reflects the toggle.
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().app.focusedView).to.equal(true);
    });

    // 2.2.0 (A2): the top bar stays so Appearance and the user chip never vanish; the pill says how to leave.
    cy.get('[data-testid="topbar"], header').should('exist');
    cy.get('[data-tour="status-panel"]').should('not.exist');
    cy.get('[data-testid="focus-pill"]').should('be.visible').and('contain.text', 'Focus on');

    // Toolbar exit affordance is the user's escape hatch in focus mode.
    cy.get('[data-testid="focus-mode-toggle"]')
      .should('be.visible')
      .and('contain.text', 'Exit Focus');

    // Feed-side controls the user specifically asked to keep stay mounted.
    cy.get('[data-testid="search-filters-button"]').should('exist');
    cy.get('[data-tour="export-button"]').should('exist');
  });

  it('Exit Focus toggle restores chrome', () => {
    cy.get('[data-testid="focus-mode-toggle"]').click({ force: true });
    cy.get('[data-testid="focus-mode-toggle"]').should('contain.text', 'Exit Focus');

    cy.get('[data-testid="focus-mode-toggle"]').click({ force: true });

    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().app.focusedView).to.equal(false);
    });
    cy.get('[data-testid="focus-mode-toggle"]').should('contain.text', 'Focus');
  });

  it('F key toggles focus mode when not focused in an input', () => {
    cy.get('body').trigger('keydown', { key: 'f' });
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().app.focusedView).to.equal(true);
    });

    cy.get('body').trigger('keydown', { key: 'f' });
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().app.focusedView).to.equal(false);
    });
  });

  it('Escape exits focus mode', () => {
    cy.get('[data-testid="focus-mode-toggle"]').click({ force: true });
    cy.get('[data-testid="focus-mode-toggle"]').should('contain.text', 'Exit Focus');

    cy.get('body').trigger('keydown', { key: 'Escape' });
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().app.focusedView).to.equal(false);
    });
  });

  it('toggle button flips between Focus and Exit Focus labels', () => {
    cy.get('[data-testid="focus-mode-toggle"]').should('contain.text', 'Focus');
    cy.get('[data-testid="focus-mode-toggle"]').click({ force: true });
    cy.get('[data-testid="focus-mode-toggle"]').should(
      'contain.text',
      'Exit Focus',
    );
  });

  describe('Floating pause control (#237)', () => {
    // Focused view hides the StatusPanel (the only other
    // PauseResumeControls mount), so a floating pill must keep
    // pause/resume/cancel reachable during heavy operations.
    const enterFocusMode = () => {
      cy.get('[data-testid="focus-mode-toggle"]').click({ force: true });
      cy.get('[data-testid="focus-mode-toggle"]').should(
        'contain.text',
        'Exit Focus',
      );
    };

    // Same simulation mechanism as pause-resume.cy.ts "Button
    // Visibility": dispatch a heavy-tier pending action into the store.
    const startHeavyOperation = () => {
      cy.window().then((win) => {
        (win as any).__store__.dispatch({
          type: 'export/exportMessages/pending',
        });
      });
    };

    it('does not render in focused view while no operation is running', () => {
      enterFocusMode();
      cy.get('[data-testid="floating-pause-control"]').should('not.exist');
    });

    it('does not render outside focused view even during a heavy operation', () => {
      startHeavyOperation();
      // The StatusPanel mount owns the controls outside focus mode — a
      // double mount would register the pause/cancel hotkeys twice.
      cy.get('[aria-label="Pause"]').should('be.visible');
      cy.get('[data-testid="floating-pause-control"]').should('not.exist');
    });

    it('shows pause/cancel and the operation label during a heavy operation in focused view', () => {
      enterFocusMode();
      startHeavyOperation();

      cy.get('[data-testid="floating-pause-control"]')
        .should('be.visible')
        .within(() => {
          cy.get('[aria-label="Pause"]').should('be.visible');
          cy.get('[aria-label="Stop"]').should('be.visible');
          cy.contains('Exporting...').should('be.visible');
        });
    });

    it('round-trips pause and resume from the floating control', () => {
      enterFocusMode();
      startHeavyOperation();

      cy.get('[data-testid="floating-pause-control"]').within(() => {
        cy.get('[aria-label="Pause"]').click({ force: true });
      });
      cy.window().then((win) => {
        expect(
          (win as any).__store__.getState().app.discrubPaused,
        ).to.equal(true);
      });

      cy.get('[data-testid="floating-pause-control"]').within(() => {
        cy.get('[aria-label="Resume"]')
          .should('be.visible')
          .click({ force: true });
      });
      cy.window().then((win) => {
        expect(
          (win as any).__store__.getState().app.discrubPaused,
        ).to.equal(false);
      });

      // Back to a running (unpaused) state with pause reachable again.
      cy.get('[data-testid="floating-pause-control"]').within(() => {
        cy.get('[aria-label="Pause"]').should('be.visible');
      });
    });

    it('does not render for light operations (spinner-only tier)', () => {
      enterFocusMode();
      cy.window().then((win) => {
        (win as any).__store__.dispatch({
          type: 'message/fetchMessages/pending',
        });
      });
      cy.get('[data-testid="floating-pause-control"]').should('not.exist');
    });

    it('disappears when the heavy operation completes', () => {
      enterFocusMode();
      startHeavyOperation();
      cy.get('[data-testid="floating-pause-control"]').should('be.visible');

      cy.window().then((win) => {
        (win as any).__store__.dispatch({
          type: 'export/exportMessages/fulfilled',
          payload: { success: true },
        });
      });
      cy.get('[data-testid="floating-pause-control"]').should('not.exist');
    });
  });
});
