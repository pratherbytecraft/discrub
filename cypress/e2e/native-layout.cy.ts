// 2.2.0 item 4: the Native layout, switched to from the Appearance menu.
describe('Native layout (2.2.0)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    cy.get('[data-testid="gift-button"]').click();
    cy.get('[data-testid="layout-card-native"]').click();
    cy.get('[data-testid="appearance-popover"]').should('not.exist');
    cy.get('[data-testid="native-shell"]').should('be.visible');
    // Let the setting's IndexedDB write settle so a later direct dispatch is not overwritten by its fulfilled action.
    cy.wait(800);
  });

  afterEach(() => {
    cy.get('body').then(($b) => {
      if ($b.find('[data-testid="native-shell"]').length) {
        cy.get('body').type('{esc}');
        cy.get('body').trigger('keydown', { key: 'L', ctrlKey: true, shiftKey: true });
        cy.get('[data-testid="layout-card-classic"]').click({ force: true });
        cy.get('[data-testid="native-shell"]').should('not.exist');
      }
    });
  });

  it('shows the rail, the column, the head and the inspector around the same feed', () => {
    cy.get('[data-testid="native-rail"]').should('be.visible');
    cy.get('[data-testid="native-column-title"]').should('have.text', 'Cypress Test Server');
    cy.get('[data-testid="native-head-title"]').should('have.text', 'general');
    cy.get('[data-testid="native-head-strip"]').should('contain.text', 'loaded');
    cy.get('[data-testid="inspector-actions"]').should('be.visible');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    cy.get('[data-testid="gift-button"]').should('have.attr', 'data-layout', 'native');
  });

  it('opens Export, Filters and Analytics from the inspector', () => {
    cy.get('[data-testid="inspector-export"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Export');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="inspector-filters-edit"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Filters');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="inspector-analytics"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('body').type('{esc}');
  });

  it('opens the status log as a sheet from the inspector and closes it', () => {
    cy.get('[data-tour="status-panel"]').should('not.exist');
    cy.get('[data-testid="inspector-log-open"]').click();
    cy.get('[data-tour="status-panel"]').should('have.attr', 'data-sheet', 'true');
    cy.get('[aria-label="Collapse log"]').click({ force: true });
    cy.get('[data-tour="status-panel"]').should('not.exist');
  });

  it('Focus hides the rail, the column and the inspector, keeps the head row', () => {
    cy.get('[data-testid="native-focus"]').click();
    cy.get('[data-testid="native-rail"]').should('not.exist');
    cy.get('[data-testid="native-column"]').should('not.exist');
    cy.get('[data-testid="native-inspector"]').should('not.exist');
    cy.get('[data-testid="native-head"]').should('be.visible');
    cy.get('[data-testid="focus-pill"]').should('be.visible');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="native-rail"]').should('be.visible');
  });

  it('the rail switches to DMs and to the package, and back to the server', () => {
    cy.get('[data-testid="rail-dms"]').click();
    cy.get('[data-testid="native-column-title"]').should('have.text', 'DMs');
    cy.get('[data-testid="rail-package"]').click();
    cy.get('[data-testid="inspector-package"]').should('be.visible');
    cy.get('[data-testid="native-rail"] [data-tour="servers-tab"] button').first().click();
    cy.get('[data-testid="native-column-title"]').should('have.text', 'Cypress Test Server');
  });

  it('switching to Classic keeps Package mode', () => {
    // The Classic sidebar used to open on Servers every time, which threw the package view away.
    cy.get('[data-testid="rail-package"]').click();
    cy.get('[data-testid="inspector-package"]').should('be.visible');
    cy.get('body').trigger('keydown', { key: 'L', ctrlKey: true, shiftKey: true });
    cy.get('[data-testid="layout-card-classic"]').click({ force: true });
    cy.get('[data-testid="native-shell"]').should('not.exist');
    cy.get('[role="tab"][aria-selected="true"]').should('contain.text', 'Package');
    cy.window().its('__store__').invoke('getState').its('app.sidebarView').should('eq', 'package');
  });

  it('switching back to Classic from the menu keeps the open dialog and the channel', () => {
    cy.get('[data-testid="inspector-export"]').click();
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Export');
    // The menu opens over the dialog with its hotkey; picking Classic swaps the shell under the dialog.
    cy.get('body').trigger('keydown', { key: 'L', ctrlKey: true, shiftKey: true });
    cy.get('[data-testid="appearance-popover"]').should('be.visible');
    cy.get('[data-testid="layout-card-classic"]').click({ force: true });
    cy.get('[data-testid="native-shell"]').should('not.exist');
    cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'Export');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="focus-mode-toggle"]').should('exist');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });
});
