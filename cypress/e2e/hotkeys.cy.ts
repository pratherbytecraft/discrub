/// <reference types="cypress" />

/**
 * E2E coverage for the hotkey customization system (#144).
 *
 * Existing F/Esc behavior is exercised by `focused-view.cy.ts` and
 * keeps working through the new HotkeyProvider — this spec covers
 * the additions: `/` for filters, `?` for the reference modal, the
 * Settings → Hotkeys tab, capture-mode rebind, and the master toggle.
 */

describe('Hotkeys (#144)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
  });

  describe('Built-in bindings', () => {
    it('? opens the keyboard-shortcuts reference modal', () => {
      cy.get('body').trigger('keydown', { key: '?' });
      // Modal title is the most stable anchor; group sections live
      // inside a scrollable DialogContent so "be.visible" is unreliable
      // on smaller viewports — `should('exist')` is enough to confirm
      // the modal rendered with its full content tree.
      cy.contains('Keyboard Shortcuts').should('be.visible');
      cy.contains('During an operation').should('exist');
      cy.contains('In a channel').should('exist');
      cy.contains('App-wide').should('exist');
    });

    it('/ opens the Filters dialog from a loaded channel', () => {
      cy.get('body').trigger('keydown', { key: '/' });
      // Anchor on a FilterModal-specific testid rather than the Apply
      // button — the button starts disabled (no filters set) and may
      // render outside the immediately-visible viewport.
      cy.get('[data-testid="filter-modal-search-from"]', { timeout: 5000 })
        .should('exist');
    });

    it('does not fire / while focus is in an input', () => {
      cy.get('body').trigger('keydown', { key: '/' });
      cy.get('[data-testid="filter-modal-search-from"]').should('exist');
      // Find an input inside the modal, focus it, type "/" — the
      // literal slash should land in the input rather than triggering
      // the hotkey toggle behavior. Pins the input-gating contract.
      cy.get('[role="dialog"] input[type="text"]').first().as('searchInput');
      cy.get('@searchInput').focus().type('/');
      cy.get('@searchInput').should('have.value', '/');
    });

    // ─── Toggle behavior (#144 follow-up) ────────────────────────
    // Pressing the same hotkey while its dialog is open closes the
    // dialog. Mirrors how F has always toggled focus mode and gives
    // users a single muscle-memory rule across every dialog hotkey.
    it('/ toggles Filters: pressing again closes the dialog', () => {
      cy.get('body').trigger('keydown', { key: '/' });
      cy.get('[data-testid="filter-modal-search-from"]').should('exist');
      // Click somewhere outside an input first so the next keystroke
      // reaches the document-level listener instead of the modal's
      // input field.
      cy.contains('Filters').click({ force: true });
      cy.focused().blur();
      cy.get('body').trigger('keydown', { key: '/' });
      cy.get('[data-testid="filter-modal-search-from"]').should('not.exist');
    });

    it('? toggles the reference modal: pressing again closes it', () => {
      cy.get('body').trigger('keydown', { key: '?' });
      cy.contains('Keyboard Shortcuts').should('be.visible');
      cy.get('body').trigger('keydown', { key: '?' });
      cy.contains('Keyboard Shortcuts').should('not.exist');
    });

    it('mod+, toggles Settings: pressing again closes the dialog', () => {
      cy.get('body').trigger('keydown', { key: ',', ctrlKey: true });
      cy.contains('button', 'Save Settings').should('be.visible');
      cy.get('body').trigger('keydown', { key: ',', ctrlKey: true });
      cy.contains('button', 'Save Settings').should('not.exist');
    });

    it('E toggles Export: pressing again closes the dialog', () => {
      cy.get('body').trigger('keydown', { key: 'e' });
      // ExportDialog renders a "Format" section — anchor on that
      // since the dialog title varies by channel context.
      cy.contains(/Export/i).should('be.visible');
      cy.get('[role="dialog"]', { timeout: 5000 }).should('exist');
      cy.get('body').trigger('keydown', { key: 'e' });
      cy.get('[role="dialog"]').should('not.exist');
    });
  });

  describe('Settings → Hotkeys tab', () => {
    beforeEach(() => {
      // Open Settings via its hotkey for end-to-end coverage of the
      // Cmd/Ctrl+, binding alongside the tab itself.
      cy.get('body').trigger('keydown', { key: ',', ctrlKey: true });
      cy.contains('Settings').should('be.visible');
      cy.contains('button', /Hotkeys/i).click();
    });

    it('renders every group with the master toggle on by default', () => {
      cy.contains('Enable hotkeys').should('be.visible');
      // Group section headers live inside the scrollable tab body —
      // "exist" is the contract; "visible" depends on viewport height.
      cy.contains('During an operation').should('exist');
      cy.contains('In a channel').should('exist');
      cy.contains('App-wide').should('exist');
    });

    it('master toggle commits on Save Settings and disables F app-wide', () => {
      cy.get('input[aria-label="Enable hotkeys"]').click();
      cy.contains('Hotkeys are off').should('be.visible');
      // Commit the change via the dialog footer (single Save story —
      // no per-row Save). Cancel would discard.
      cy.contains('button', 'Save Settings').click();
      cy.window().should((win) => {
        expect((win as any).__store__.getState().hotkeys.enabled).to.equal(false);
      });
      // The dialog stays open after Save (#260); close it before testing keys.
      cy.get('[role="dialog"]').contains('Settings saved').should('be.visible');
      cy.get('[role="dialog"]').contains('button', /^Cancel$/).click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.get('body').trigger('keydown', { key: 'f' });
      cy.window().then((win) => {
        const after = (win as any).__store__.getState().app.focusedView;
        expect(after).to.equal(false); // F is inert after master toggle off
      });
    });

    it('Cancel discards hotkey edits without persisting', () => {
      cy.get('input[aria-label="Enable hotkeys"]').click();
      cy.contains('Hotkeys are off').should('be.visible');
      cy.contains('button', /Cancel/i).click();
      // Master toggle should still be on in Redux.
      cy.window().should((win) => {
        expect((win as any).__store__.getState().hotkeys.enabled).to.equal(true);
      });
    });

    it('master toggle persists across a reload after Save Settings', () => {
      cy.get('input[aria-label="Enable hotkeys"]').click();
      cy.contains('button', 'Save Settings').click();
      cy.window().should((win) => {
        expect((win as any).__store__.getState().hotkeys.enabled).to.equal(false);
      });
      cy.wait(300); // let the IDB write flush before reload
      cy.reload();
      cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
      cy.window({ timeout: 10000 }).should((win) => {
        const enabled = (win as any).__store__.getState().hotkeys.enabled;
        expect(enabled).to.equal(false);
      });
    });

    it('rebinding via capture mode auto-commits to the form, then Save Settings persists', () => {
      cy.get('[data-testid="hotkey-chip-toggleFocus"]').click();
      cy.contains('Press a key…').should('be.visible');
      // Auto-commit on key release — capture mode exits, no Save
      // button per row. Redux state is unchanged at this point; only
      // the form has the new binding.
      cy.get('body').trigger('keydown', { key: 'x' });
      cy.contains('Press a key…').should('not.exist');
      cy.window().then((win) => {
        const bindings = (win as any).__store__.getState().hotkeys.bindings;
        expect(bindings.toggleFocus).to.equal('F'); // not persisted yet
      });
      cy.contains('button', 'Save Settings').click();
      cy.window().should((win) => {
        const bindings = (win as any).__store__.getState().hotkeys.bindings;
        expect(bindings.toggleFocus).to.equal('X');
      });
    });
  });
});
