// 2.2.3: the Halloween '26 drop. The Appearance menu lists themes and Scrublings in groups
// (Standard, Holiday, Commissioned), a holiday item is free for everyone through its season,
// and the Spider '26 hangs from the Appearance button with a line until the button is clicked once.
const IN_SEASON = new Date(2026, 9, 10, 12).getTime();
const OUT_OF_SEASON = new Date(2026, 8, 15, 12).getTime();

const openTab = (tab: 'theme' | 'scrublings') => {
  cy.get('[data-testid="gift-button"]').click({ force: true });
  cy.get('[data-testid="appearance-popover"]').should('be.visible');
  cy.get(`[data-testid="appearance-tab-${tab}"]`).click();
};

describe('Halloween drop (2.2.3)', () => {
  describe('in season', () => {
    beforeEach(() => {
      cy.clock(IN_SEASON, ['Date']);
      cy.login();
      cy.contains('Welcome to Discrub').should('exist');
    });

    it('hangs the Spider from the Appearance button with its line, and the first click opens Theme and puts it away for good', () => {
      cy.get('[data-testid="seasonal-notice"]').should('have.attr', 'data-theme-id', 'halloween-26');
      cy.get('[data-testid="seasonal-notice-line"]').should('have.text', "Halloween '26 is in.");
      cy.get('[data-testid="gift-button"]').click({ force: true });
      cy.get('[data-testid="appearance-popover"]').should('be.visible');
      cy.get('[data-testid="appearance-tab-theme"]').should('have.attr', 'aria-pressed', 'true');
      cy.get('[data-testid="appearance-theme-grid"]').should('be.visible');
      cy.get('[data-testid="seasonal-notice"]').should('not.exist');
      cy.window().its('__store__').invoke('getState').its('notice.seenId').should('eq', 'halloween-26');
      cy.get('body').type('{esc}');
      cy.reload();
      cy.contains('Welcome to Discrub').should('exist');
      cy.get('[data-testid="gift-button"]').should('exist');
      cy.get('[data-testid="seasonal-notice"]').should('not.exist');
    });

    it('lists Holiday first with the theme unlocked, applies it, and Commissioned says nothing is there yet', () => {
      openTab('theme');
      cy.get('[data-testid^="theme-group-section-"]').first().should('have.attr', 'data-testid', 'theme-group-section-holiday');
      cy.get('[data-testid="theme-group-holiday-open"]').should('contain.text', "Halloween '26 is open to everyone through November 2.");
      cy.get('[data-testid="theme-locked-halloween-26"]').should('not.exist');
      cy.get('[data-testid="theme-group-empty-commissioned"]').should('have.text', 'Nothing here yet.');
      cy.get('[data-testid="theme-card-halloween-26"]').click();
      cy.get('[data-testid="theme-selected-halloween-26"]').should('exist');
      cy.get('[data-testid="gift-button"]').should('have.attr', 'data-theme-name', "Halloween '26");
      cy.get('[data-testid="theme-effects-halloween"]').should('exist');
    });

    it('lists the Spider under Holiday, unlocked, and it walks onto the bar when picked', () => {
      openTab('scrublings');
      cy.get('[data-testid^="scrublings-group-section-"]').first().should('have.attr', 'data-testid', 'scrublings-group-section-holiday');
      cy.get('[data-testid="scrubling-locked-spider"]').should('not.exist');
      cy.get('[data-testid="scrublings-group-empty-commissioned"]').should('have.text', 'Nothing here yet.');
      cy.get('[data-testid="scrubling-card-spider"]').click();
      cy.get('[data-testid="scrubling-card-spider"]').should('have.attr', 'aria-checked', 'true');
      cy.get('body').type('{esc}');
      cy.get('[data-testid="scrubling-spider"]').should('exist');
      cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '3');
    });
  });

  describe('out of season', () => {
    beforeEach(() => {
      cy.clock(OUT_OF_SEASON, ['Date']);
      cy.login();
      cy.contains('Welcome to Discrub').should('exist');
    });

    it('shows no notice, lists Holiday after Standard, and locks the theme and the Spider like any supporter item', () => {
      cy.get('[data-testid="gift-button"]').should('exist');
      cy.get('[data-testid="seasonal-notice"]').should('not.exist');
      openTab('theme');
      cy.get('[data-testid^="theme-group-section-"]').then(($s) => {
        expect([...$s].map((el) => el.getAttribute('data-testid'))).to.deep.equal(['theme-group-section-standard', 'theme-group-section-holiday', 'theme-group-section-commissioned']);
      });
      cy.get('[data-testid="theme-locked-halloween-26"]').should('exist');
      cy.get('[data-testid="theme-group-holiday-open"]').should('not.exist');
      cy.get('[data-testid="theme-card-halloween-26"]').click();
      cy.get('[data-testid="appearance-tab-supporter"]').should('have.attr', 'aria-pressed', 'true');
      cy.get('[data-testid="appearance-tab-scrublings"]').click();
      cy.get('[data-testid="scrubling-locked-spider"]').should('exist');
    });

    it('drops a leftover Halloween pick back to the default quietly', () => {
      cy.window().then((win) => {
        const store = win.__store__;
        store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...store.getState().app.settings, appThemeMode: 'halloween-26', appScrublingsPicked: '["suds","spider"]' } });
      });
      cy.get('[data-testid="gift-button"]').should('have.attr', 'data-theme-name', "Halloween '26");
      cy.get('[data-testid="theme-effects-halloween"]').should('not.exist');
      cy.get('[data-testid="scrubling-spider"]').should('not.exist');
      cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '1');
    });
  });
});
