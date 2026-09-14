// 2.2.0 item 3: the Appearance menu (layouts + themes) and the Settings layout block.
describe('Appearance menu (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  it('names the current layout and theme, opens on click, and lists the six layouts', () => {
    cy.get('[data-testid="appearance-current-layout"]').should('have.text', 'Classic');
    cy.get('[data-testid="appearance-current-theme"]').should('not.be.empty');
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="appearance-popover"]').should('be.visible');
    cy.get('[data-testid="layout-cards"] [data-testid^="layout-card-"]').should('have.length', 6);
    cy.get('[data-testid="layout-card-classic"]').should('have.attr', 'aria-pressed', 'true');
    // Classic and Native are built; the supporter layouts read as coming soon and cannot be picked yet.
    cy.get('[data-testid="layout-card-native"]').should('not.have.attr', 'aria-disabled');
    cy.get('[data-testid="layout-card-timeline"]').should('have.attr', 'aria-disabled', 'true');
    cy.get('[data-testid="layout-locked-workbench"]').should('exist');
    cy.get('[data-testid="appearance-hint"]').should('have.text', 'Hover to preview. Click to apply.');
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
    cy.get('[data-testid="appearance-current-theme"]').should('have.text', 'Terminal');
  });

  it('reaches the Themes and Support hub from the footer', () => {
    cy.openThemesHub();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
  });

  it('shows the layout block in Settings > Display with Classic selected', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="appearance-open-settings"]').click();
    cy.get('[role="dialog"]').contains('[role="tab"]', 'Display').click();
    cy.get('[data-testid="display-layout-block"]').should('be.visible');
    cy.get('[data-testid="settings-layout-classic"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('[data-testid="settings-layout-timeline"]').should('be.disabled');
    cy.contains('Dates and language').should('be.visible');
    cy.get('body').type('{esc}');
  });

  it('previews a layout from the eye and stops from the bar', () => {
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-preview-native"]').click();
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
    cy.get('[data-testid="native-shell"]').should('be.visible');
    cy.get('[data-testid="layout-preview-bar"]').should('contain.text', 'Previewing Native');
    cy.get('[data-testid="layout-preview-stop"]').click();
    cy.get('[data-testid="native-shell"]').should('not.exist');
    cy.get('[data-testid="appearance-current-layout"]').should('have.text', 'Classic');
  });
});
