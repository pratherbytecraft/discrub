describe('Settings', () => {
  beforeEach(() => {
    cy.login();
  });

  it('opens SettingsModal when clicking Settings icon', () => {
    cy.get('[aria-label="Settings"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').contains('Settings').should('be.visible');
    cy.get('[role="dialog"]').contains('Operation Delays').should('be.visible');
  });

  it('can navigate settings tabs', () => {
    cy.get('[aria-label="Settings"]').click();
    cy.contains('button', 'Export Preferences').click();
    cy.contains('button', 'User Data').click();
    cy.contains('button', 'Display').click();
    cy.contains('button', 'Purge Behavior').click();
  });

  it('returns to LandingPage after clicking Logout', () => {
    // Block auto-auth BEFORE clicking logout so the app stays on LandingPage
    cy.blockAutoAuth();
    cy.get('[aria-label="Logout"]').click();
    cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
  });

  it('persists settings in IndexedDB across sessions', () => {
    cy.get('[aria-label="Settings"]').click();
    cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
    // Per-key writes land in the Discrub-settings DB. After a Save we
    // expect at least one row to exist.
    cy.readIdbStore('settings').then((values) => {
      expect(values.length).to.be.greaterThan(0);
    });
  });

  // ─── Safest zone (2.1.3): delay sliders reach 30s ─────────────────
  it('lets the search delay reach 30s in the Safest zone and persists it', () => {
    cy.get('[aria-label="Settings"]').click();
    // The rail's last tick is 14: ten 0.1s ticks to 10s, then 0.5s ticks to 30s.
    cy.get('[role="dialog"] input[type="range"]')
      .first()
      .should('have.attr', 'aria-valuemax', '30')
      .then(($input) => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf($input[0]), 'value')!.set!;
        setter.call($input[0], '14');
        $input[0].dispatchEvent(new Event('input', { bubbles: true }));
      });
    cy.get('[role="dialog"]').contains('Safest').should('be.visible');
    cy.get('[role="dialog"]').contains('Effective delay: 30s to 30.5s').should('be.visible');
    cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
    // Store first: it settles only after the IDB write resolved, so the read below is not racing the save.
    cy.window().its('__store__').invoke('getState').its('app.settings.searchDelay2').should('eq', '30.0');
    cy.readIdbStore('settings').then((values) => {
      expect(values).to.include('30.0');
    });
  });

  it('shows rest breaks on by default and persists turning them off', () => {
    cy.get('[aria-label="Settings"]').click();
    // The switch sits below the three sliders, past the dialog's fold.
    cy.get('[role="dialog"] input[aria-label="Rest breaks"]').scrollIntoView().should('be.checked');
    cy.get('[role="dialog"]').contains('Rest breaks').should('be.visible');
    cy.get('[role="dialog"]').contains('Pause for 10 minutes after every 45 minutes of activity').should('be.visible');
    cy.get('[role="dialog"] input[aria-label="Rest breaks"]').click();
    cy.get('[role="dialog"] input[aria-label="Rest breaks"]').should('not.be.checked');
    cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
    cy.window().its('__store__').invoke('getState').its('app.settings.restBreaks').should('eq', 'false');
    cy.readIdbStore('settings').then((values) => {
      expect(values).to.include('false');
    });
    // The dialog stays open after Save (#260); close it and reopen: the
    // switch reflects the saved value.
    cy.get('[role="dialog"]').contains('Settings saved').should('be.visible');
    cy.get('[role="dialog"]').contains('button', /^Cancel$/).click();
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('[aria-label="Settings"]').click();
    cy.get('[role="dialog"] input[aria-label="Rest breaks"]').scrollIntoView().should('not.be.checked');
  });

  // ─── Unsaved-changes prompt (#164) ───────────────────────────────
  // Cancel/X/backdrop/Esc all route through handleClose; when there
  // are unsaved edits, a confirmation appears before discarding.
  // Save Settings bypasses the prompt because the changes are
  // committing, not being thrown away.
  describe('unsaved-changes prompt', () => {
    function openWithEdit() {
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]', { timeout: 5000 }).should('be.visible');
      // Toggle the Hotkeys master switch to dirty the form. Using the
      // hotkeys form rather than an AppSettings field keeps the test
      // self-contained — no dependency on the exact controls in any
      // particular tab.
      cy.contains('button', 'Hotkeys').click();
      cy.get('input[aria-label="Enable hotkeys"]').click();
    }

    it('Cancel with unsaved changes shows the prompt', () => {
      openWithEdit();
      cy.contains('button', /^Cancel$/).click();
      cy.contains('Discard unsaved changes?').should('be.visible');
      cy.contains('button', 'Keep editing').should('be.visible');
      cy.contains('button', 'Discard').should('be.visible');
    });

    it('Keep editing returns to the dialog with edits intact', () => {
      openWithEdit();
      cy.contains('button', /^Cancel$/).click();
      cy.contains('button', 'Keep editing').click();
      cy.contains('Discard unsaved changes?').should('not.exist');
      // Settings dialog still open + the toggle is still off in the
      // form (the edit wasn't reverted).
      cy.contains('button', 'Save Settings').should('be.visible');
      cy.get('input[aria-label="Enable hotkeys"]').should('not.be.checked');
    });

    it('Discard closes the dialog and reverts the form on next open', () => {
      openWithEdit();
      cy.contains('button', /^Cancel$/).click();
      cy.contains('button', 'Discard').click();
      cy.contains('button', 'Save Settings').should('not.exist');
      // Reopen — the form should be re-synced from Redux, so the
      // toggle is back to its default ON state.
      cy.get('[aria-label="Settings"]').click();
      cy.contains('button', 'Hotkeys').click();
      cy.get('input[aria-label="Enable hotkeys"]').should('be.checked');
    });

    it('Cancel with no edits closes immediately, no prompt', () => {
      cy.get('[aria-label="Settings"]').click();
      cy.contains('button', /^Cancel$/).click();
      cy.contains('Discard unsaved changes?').should('not.exist');
      cy.contains('button', 'Save Settings').should('not.exist');
    });

    it('Save Settings keeps the dialog open, confirms inline, and Cancel then closes without the prompt (#260)', () => {
      openWithEdit();
      cy.contains('button', 'Save Settings').click();
      cy.contains('Discard unsaved changes?').should('not.exist');
      cy.get('[role="dialog"]').contains('Settings saved').should('be.visible');
      cy.contains('button', 'Save Settings').should('be.visible');
      // The change actually persisted in Redux.
      cy.window().should((win) => {
        expect((win as any).__store__.getState().hotkeys.enabled).to.equal(false);
      });
      // Saved edits are the new baseline: Cancel closes without asking.
      cy.contains('button', /^Cancel$/).click();
      cy.contains('Discard unsaved changes?').should('not.exist');
      cy.contains('button', 'Save Settings').should('not.exist');
    });
  });

  describe('Export Preferences Tab', () => {
    beforeEach(() => {
      cy.get('[aria-label="Settings"]').click();
      cy.contains('button', 'Export Preferences').click();
    });

    it('shows sort order dropdown', () => {
      cy.get('[role="dialog"]').contains('Message Sort Order').should('be.visible');
    });

    it('shows download files checkbox', () => {
      cy.get('[role="dialog"]').contains('Download files for offline viewing').should('be.visible');
    });

    it('shows messages per page input', () => {
      cy.get('[role="dialog"]').contains('Messages Per Page').scrollIntoView().should('be.visible');
    });

    it('shows artist mode checkbox', () => {
      cy.get('[role="dialog"]').contains('Artist mode').scrollIntoView().should('be.visible');
    });
  });

  describe('Ideas & Contact', () => {
    it('should open Ideas dialog when clicking lightbulb icon', () => {
      cy.get('[data-testid="topbar-ideas"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Feature ideas, bug reports').should('be.visible');
    });

    it('should show email link', () => {
      cy.get('[data-testid="topbar-ideas"]').click();
      cy.contains('support@pratherbytecraft.com').should('be.visible');
    });

    it('should close dialog on Escape', () => {
      cy.get('[data-testid="topbar-ideas"]').click();
      cy.contains('Feature ideas, bug reports').should('be.visible');
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').should('not.exist');
    });
  });
});
