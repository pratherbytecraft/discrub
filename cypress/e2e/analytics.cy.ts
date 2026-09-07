describe('Analytics', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  const openTab = (label: string) => cy.get('[data-testid="analytics-tabs"]').contains('[role="tab"]', label).click();

  describe('Analytics Button', () => {
    it('should show Analytics button in ServerView toolbar', () => {
      cy.contains('button', 'Analytics').should('be.visible');
    });

    it('should open AnalyticsModal on the Mentions report', () => {
      cy.contains('button', 'Analytics').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[data-testid="analytics-title"]').should('have.text', 'Most mentioned');
      cy.get('[data-testid="analytics-tabs"]').find('[role="tab"]').should('have.length', 9);
    });
  });

  describe('Mentions report', () => {
    beforeEach(() => {
      cy.contains('button', 'Analytics').click();
      cy.get('[role="dialog"]').should('be.visible');
    });

    it('should show message count summary', () => {
      cy.get('[role="dialog"]').contains(/across \d+ messages/).should('be.visible');
    });

    it('should show mention counts table with data', () => {
      // Fixture messages contain <@userId> mentions in content
      cy.get('[role="dialog"]').find('table').should('exist');
      cy.get('[role="dialog"]').contains('Username').should('be.visible');
      cy.get('[role="dialog"]').find('[data-testid="analytics-row"]').should('have.length.at.least', 1);
    });

    it('should show Export CSV button when mentions exist', () => {
      cy.get('[role="dialog"]').contains('button', 'Export CSV').should('be.visible');
    });

    it('should sort by clicking column headers', () => {
      cy.get('[role="dialog"]').contains('Username').click();
      cy.get('[role="dialog"]').find('table').should('exist');
    });

    it('should close modal on Close button', () => {
      cy.get('[role="dialog"]').find('[aria-label="Close analytics"]').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('should show skip replies chip', () => {
      cy.get('[role="dialog"]').contains('Skip replies').should('be.visible');
    });

    it('should exclude reply messages when skip replies is checked', () => {
      // Fixture has a type 19 reply message with a mention
      cy.get('[role="dialog"]').contains(/across \d+ messages/).invoke('text').then((before) => {
        cy.get('[role="dialog"]').contains('Skip replies').click();
        cy.get('[role="dialog"]').contains(/replies excluded/).should('be.visible');
        cy.get('[role="dialog"]').contains(/across \d+ messages/).invoke('text').should('not.equal', before);
      });
    });
  });

  describe('Other reports', () => {
    beforeEach(() => {
      cy.contains('button', 'Analytics').click();
      cy.get('[role="dialog"]').should('be.visible');
    });

    it('Members ranks the fixture authors by messages sent', () => {
      openTab('Members');
      cy.get('[data-testid="analytics-title"]').should('have.text', 'Most active members');
      cy.get('[data-testid="analytics-row"]').should('have.length.at.least', 3);
      cy.get('[data-testid="analytics-row"]').first().invoke('text').should('match', /\d/);
      cy.get('[role="dialog"]').contains('Skip replies').should('not.exist');
    });

    it('Best Of lists the reacted message with its emoji breakdown', () => {
      openTab('Best Of');
      cy.get('[data-testid="analytics-title"]').should('have.text', 'Most reacted messages');
      cy.get('[data-testid="analytics-row"]').should('have.length', 1).and('contain.text', 'Anyone up for some gaming later?');
      cy.get('[data-testid="analytics-summary"]').should('contain.text', '👍 2');
      cy.get('[data-testid="analytics-mode"]').should('contain.text', '2+ reactions only');
    });

    it('Reactions credits the reacted message to its author', () => {
      openTab('Reactions');
      cy.get('[data-testid="analytics-row"]').should('have.length', 1).invoke('text').should('match', /[3-9]/);
    });

    it('Threads shows an empty state on a plain channel feed', () => {
      openTab('Threads');
      cy.get('[data-testid="analytics-empty"]').should('contain.text', 'No thread or forum activity');
      cy.get('[role="dialog"]').contains('button', 'Export CSV').should('not.exist');
    });

    it('Keywords counts typed terms', () => {
      openTab('Keywords');
      cy.get('[data-testid="analytics-empty"]').should('contain.text', 'terms');
      cy.get('[data-testid="analytics-terms"]').type('screenshot, ship');
      cy.get('[data-testid="analytics-row"]').should('have.length', 2);
      cy.get('[data-testid="analytics-row"]').first().should('contain.text', 'screenshot').and('contain.text', '2');
      cy.get('[data-testid="analytics-summary"]').should('contain.text', 'at least one term');
    });

    it('Links counts the fixture link domain', () => {
      openTab('Links');
      cy.get('[data-testid="analytics-row"]').should('have.length', 1).and('contain.text', 'github.com');
    });

    it('Media counts the fixture attachments', () => {
      openTab('Media');
      cy.get('[data-testid="analytics-row"]').should('have.length', 1).and('contain.text', '2');
      cy.get('[data-testid="analytics-summary"]').should('contain.text', '2 total: ');
    });

    it('Overview shows the headline tiles and top posters', () => {
      openTab('Overview');
      cy.get('[data-testid="analytics-overview"]').should('be.visible');
      cy.get('[data-testid="analytics-overview"]').contains('Messages').next().should('have.text', '13');
      cy.get('[data-testid="analytics-overview"]').contains('People').next().invoke('text').should('match', /^[34]$/);
      cy.get('[data-testid="analytics-overview"]').contains('Reactions').next().invoke('text').should('match', /^[3-9]$/);
      cy.get('[data-testid="analytics-best"]').should('contain.text', 'Anyone up for some gaming later?');
      cy.get('[role="dialog"]').contains('Top posters').should('be.visible');
      cy.get('[data-testid="bot-nudge"]').should('exist');
    });

    it('Export CSV names the file after the report', () => {
      openTab('Members');
      cy.window().then((win) => {
        const clicks: string[] = [];
        const original = win.HTMLAnchorElement.prototype.click;
        cy.stub(win.HTMLAnchorElement.prototype, 'click').callsFake(function (this: HTMLAnchorElement) {
          clicks.push(this.download);
        });
        cy.get('[role="dialog"]').contains('button', 'Export CSV').click().then(() => {
          expect(clicks).to.deep.equal(['analytics-members.csv']);
          win.HTMLAnchorElement.prototype.click = original;
        });
      });
    });
  });
});
