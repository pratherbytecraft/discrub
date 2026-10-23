// 2.2.3: the Halloween '26 drop. The Appearance menu lists themes and Scrublings in groups
// (Standard, Holiday, Commissioned), a holiday item is free for everyone through its season,
// and the Spider '26 hangs from the Appearance button with a line until the button is clicked once.
const IN_SEASON = new Date(2026, 9, 10, 12).getTime();
const OUT_OF_SEASON = new Date(2026, 8, 15, 12).getTime();
// 2.2.7: Christmas '26 runs December 1 2026 to January 4 2027, over the year end.
const CHRISTMAS = new Date(2026, 11, 20, 12).getTime();
const NEW_YEAR = new Date(2027, 0, 3, 12).getTime();
const CHRISTMAS_IDS = ['elf', 'snowman', 'reindeer', 'gingerbread'];

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

    // 2.2.4: Commissioned leads every list, and the "open to everyone" caption is gone.
    it('lists Holiday right after Commissioned with the theme unlocked, applies it, and Commissioned ends with the New theme card', () => {
      openTab('theme');
      cy.get('[data-testid^="theme-group-section-"]').then(($s) => {
        expect([...$s].map((el) => el.getAttribute('data-testid'))).to.deep.equal(['theme-group-section-commissioned', 'theme-group-section-holiday', 'theme-group-section-standard']);
      });
      cy.get('[data-testid="theme-group-holiday-open"]').should('not.exist');
      cy.get('[data-testid="theme-locked-halloween-26"]').should('not.exist');
      cy.get('[data-testid="theme-card-commission"]').should('contain.text', 'New theme').and('have.attr', 'href', 'https://ko-fi.com/prathercc/commissions');
      cy.get('[data-testid="theme-card-halloween-26"]').click();
      cy.get('[data-testid="theme-selected-halloween-26"]').should('exist');
      cy.get('[data-testid="gift-button"]').should('have.attr', 'data-theme-name', "Halloween '26");
      cy.get('[data-testid="theme-effects-halloween"]').should('exist');
    });

    it('lists the Spider under Holiday, unlocked, and it walks onto the bar when picked', () => {
      openTab('scrublings');
      cy.get('[data-testid^="scrublings-group-section-"]').eq(1).should('have.attr', 'data-testid', 'scrublings-group-section-holiday');
      cy.get('[data-testid="scrubling-locked-spider"]').should('not.exist');
      cy.get('[data-testid="scrubling-card-commission"]').should('contain.text', 'New Scrubling').and('have.attr', 'href', 'https://ko-fi.com/prathercc/commissions');
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
        expect([...$s].map((el) => el.getAttribute('data-testid'))).to.deep.equal(['theme-group-section-commissioned', 'theme-group-section-standard', 'theme-group-section-holiday']);
      });
      cy.get('[data-testid="theme-locked-halloween-26"]').should('exist');
      cy.get('[data-testid="theme-locked-christmas-26"]').should('exist');
      cy.get('[data-testid="theme-group-holiday-open"]').should('not.exist');
      cy.get('[data-testid="theme-card-halloween-26"]').click();
      cy.get('[data-testid="appearance-tab-supporter"]').should('have.attr', 'aria-pressed', 'true');
      cy.get('[data-testid="appearance-tab-scrublings"]').click();
      cy.get('[data-testid="scrubling-locked-spider"]').should('exist');
      for (const id of CHRISTMAS_IDS) cy.get(`[data-testid="scrubling-locked-${id}"]`).should('exist');
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

describe("Christmas '26 drop (2.2.7)", () => {
  describe('in season', () => {
    beforeEach(() => {
      cy.clock(CHRISTMAS, ['Date']);
      cy.login();
      cy.contains('Welcome to Discrub').should('exist');
    });

    it('stands the Elf under the Appearance button with the workshop line, and the first click opens Theme and puts it away', () => {
      cy.get('[data-testid="seasonal-notice"]').should('have.attr', 'data-theme-id', 'christmas-26').and('have.attr', 'data-pose', 'stand');
      cy.get('[data-testid="seasonal-notice-line"]').should('have.text', "Straight from the workshop. Christmas '26.");
      // The Elf stays inside the window.
      cy.get('[data-testid="seasonal-notice"]').then(($n) => {
        const r = $n[0].getBoundingClientRect();
        expect(r.left).to.be.at.least(0);
        expect(r.left + 40).to.be.at.most(Cypress.config('viewportWidth'));
      });
      cy.get('[data-testid="gift-button"]').click({ force: true });
      cy.get('[data-testid="appearance-tab-theme"]').should('have.attr', 'aria-pressed', 'true');
      cy.get('[data-testid="seasonal-notice"]').should('not.exist');
      cy.window().its('__store__').invoke('getState').its('notice.seenId').should('eq', 'christmas-26');
    });

    it('unlocks the theme for everyone with snow and lights over the app, and keeps Halloween locked', () => {
      openTab('theme');
      cy.get('[data-testid^="theme-group-section-"]').eq(1).should('have.attr', 'data-testid', 'theme-group-section-holiday');
      cy.get('[data-testid="theme-locked-christmas-26"]').should('not.exist');
      cy.get('[data-testid="theme-locked-halloween-26"]').should('exist');
      cy.get('[data-testid="theme-card-christmas-26"]').click();
      cy.get('[data-testid="theme-selected-christmas-26"]').should('exist');
      cy.get('[data-testid="gift-button"]').should('have.attr', 'data-theme-name', "Christmas '26");
      cy.get('[data-testid="theme-effects-christmas"]').should('exist').and('have.attr', 'data-moving', 'true');
      cy.get('[data-testid="theme-effects-halloween"]').should('not.exist');
    });

    it('lists the four under Holiday, unlocked, the Spider locked, and the Elf walks onto the bar when picked', () => {
      openTab('scrublings');
      cy.get('[data-testid^="scrublings-group-section-"]').eq(1).should('have.attr', 'data-testid', 'scrublings-group-section-holiday');
      for (const id of CHRISTMAS_IDS) {
        cy.get(`[data-testid="scrublings-group-section-holiday"] [data-testid="scrubling-card-${id}"]`).should('exist');
        cy.get(`[data-testid="scrubling-locked-${id}"]`).should('not.exist');
      }
      cy.get('[data-testid="scrubling-locked-spider"]').should('exist');
      cy.get('[data-testid="scrubling-card-elf"]').click();
      cy.get('[data-testid="scrubling-card-elf"]').should('have.attr', 'aria-checked', 'true');
      cy.get('body').type('{esc}');
      cy.get('[data-testid="scrubling-elf"]').should('exist');
      cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '3');
    });
  });

  it('is still in on January 3, over the year end', () => {
    cy.clock(NEW_YEAR, ['Date']);
    cy.login();
    cy.contains('Welcome to Discrub').should('exist');
    cy.get('[data-testid="seasonal-notice"]').should('have.attr', 'data-theme-id', 'christmas-26');
    openTab('theme');
    cy.get('[data-testid="theme-locked-christmas-26"]').should('not.exist');
    cy.get('[data-testid="appearance-tab-scrublings"]').click();
    cy.get('[data-testid="scrubling-locked-reindeer"]').should('not.exist');
  });

  it('drops a leftover Christmas pick back to the default quietly after January 4', () => {
    cy.clock(new Date(2027, 0, 5, 12).getTime(), ['Date']);
    cy.login();
    cy.contains('Welcome to Discrub').should('exist');
    cy.get('[data-testid="seasonal-notice"]').should('not.exist');
    cy.window().then((win) => {
      const store = win.__store__;
      store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...store.getState().app.settings, appThemeMode: 'christmas-26', appScrublingsPicked: '["suds","elf","snowman"]' } });
    });
    cy.get('[data-testid="gift-button"]').should('have.attr', 'data-theme-name', "Christmas '26");
    cy.get('[data-testid="theme-effects-christmas"]').should('not.exist');
    cy.get('[data-testid="scrubling-elf"]').should('not.exist');
    cy.get('[data-testid="scrublings-stage"]').should('have.attr', 'data-count', '1');
  });
});
