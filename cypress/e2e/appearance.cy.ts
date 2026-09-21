// 2.2.0 item 3: the Appearance menu (layouts + themes) and the Settings layout block.
describe('Appearance menu (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  it('names the current layout and theme, opens on click, and lists the six layouts', () => {
    cy.get('[data-testid="gift-button"]').should('have.attr', 'data-layout', 'classic').and('contain.text', 'Appearance');
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="appearance-popover"]').should('be.visible');
    cy.get('[data-testid="layout-cards"] [data-testid^="layout-card-"]').should('have.length', 6);
    cy.get('[data-testid="layout-card-classic"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('[data-testid="layout-card-classic"] [data-testid="layout-current"]').should('have.text', 'Current');
    cy.get('[data-testid="layout-mockup-classic"]').should('exist');
    // All six layouts are built, so no card is disabled; the supporter ones carry the lock without a key.
    cy.get('[data-testid="layout-card-native"]').should('not.have.attr', 'aria-disabled');
    cy.get('[data-testid="layout-card-timeline"]').should('not.have.attr', 'aria-disabled');
    cy.get('[data-testid="layout-locked-timeline"]').should('exist');
    cy.get('[data-testid="layout-locked-workbench"]').should('exist');
    cy.get('[data-testid="appearance-hint"]').should('not.exist');
    cy.get('[data-testid="appearance-tab-layout"] svg').should('not.exist');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
  });

  it('opens with Ctrl Shift L and closes with Esc', () => {
    cy.get('body').trigger('keydown', { key: 'L', ctrlKey: true, shiftKey: true });
    cy.get('[data-testid="appearance-popover"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
  });

  it('applies a theme from the Theme tab and the button names it', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="appearance-tab-theme"]').click();
    cy.get('[data-testid="appearance-theme-grid"]').should('be.visible');
    cy.get('[aria-label="Terminal"]').click();
    cy.window().its('__store__').invoke('getState').its('app.settings.appThemeMode').should('eq', 'terminal');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="gift-button"]').should('have.attr', 'data-theme-name', 'Terminal');
  });

  it('holds supporter access in its fourth segment, with the key box in view', () => {
    cy.openThemesHub();
    cy.get('[data-testid="supporter-paste-key"]').should('be.visible');
    cy.get('[data-testid="supporter-footer-controls"]').scrollIntoView().should('be.visible');
    cy.closeAppearance();
  });

  it('keeps layouts out of Settings > Display', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="appearance-open-settings"]').click();
    cy.get('[role="dialog"]').contains('[role="tab"]', 'Display').click();
    cy.get('[data-testid="display-layout-block"]').should('not.exist');
    cy.get('[data-testid="display-appearance-pointer"]').should('be.visible');
    cy.contains('Dates and language').should('be.visible');
    cy.get('body').type('{esc}');
  });

  it('the eye sits on locked cards only and starts a look-only preview that the bar ends', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-native"]').should('not.exist');
    cy.get('[data-testid="layout-preview-workbench"]').click();
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
    cy.get('[data-testid="workbench-shell"]').should('exist');
    cy.get('[data-testid="preview-bar"]').should('contain.text', 'Previewing Workbench').and('not.contain.text', 'Locked');
    cy.get('[data-testid="preview-apply"]').should('not.exist');
    // The frame is inert: the toolbar button under the bar takes no click, and hotkeys are off.
    cy.get('[data-testid="shell-frame"]').should('have.attr', 'inert');
    cy.get('body').trigger('keydown', { key: 'L', ctrlKey: true, shiftKey: true });
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
    // The store gate: a work thunk dispatched by hand is dropped while previewing.
    // main.tsx exposes a work thunk creator on the app window in dev builds for this check.
    cy.window().then((win: any) => {
      const store = win.__store__;
      const before = store.getState().guild.isLoading;
      return store.dispatch(win.__thunks__.fetchGuilds('token')).then((r: any) => {
        expect(r.type).to.eq('app/previewBlocked');
        expect(store.getState().guild.isLoading).to.eq(before);
      });
    });
    cy.get('[data-testid="preview-end"]').click();
    cy.get('[data-testid="workbench-shell"]').should('not.exist');
    cy.get('[data-testid="preview-bar"]').should('not.exist');
    cy.get('[data-testid="shell-frame"]').should('not.have.attr', 'inert');
    cy.get('[data-testid="gift-button"]').should('have.attr', 'data-layout', 'classic');
  });

  it('a click outside the bar keeps the preview, End preview or Esc ends it, and nothing is saved', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-timeline"]').click();
    cy.get('[data-testid="timeline-shell"]').should('exist');
    cy.get('body').click(640, 300);
    cy.get('[data-testid="timeline-shell"]').should('exist');
    cy.get('[data-testid="preview-bar"]').should('have.attr', 'data-nudges', '1');
    cy.get('[data-testid="preview-end"]').click();
    cy.get('[data-testid="timeline-shell"]').should('not.exist');

    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="appearance-tab-theme"]').click();
    cy.get('[data-testid="theme-preview-terminal"]').should('not.exist');
    cy.get('[data-testid="theme-preview-amoled-void"]').click();
    cy.get('[data-testid="preview-bar"]').should('contain.text', 'Previewing AMOLED Void');
    cy.get('body').should('have.css', 'background-color', 'rgb(0, 0, 0)');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="preview-bar"]').should('not.exist');
    cy.get('body').should('not.have.css', 'background-color', 'rgb(0, 0, 0)');
    cy.window().its('__store__').invoke('getState').its('app.settings.appThemeMode').should('not.eq', 'amoled-void');
    cy.reload();
    cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
    cy.get('[data-testid="preview-bar"]').should('not.exist');
  });
});
