describe('Announcements', () => {
  describe('Announcement Modal on Load', () => {
    it('should show announcement modal when new announcement exists', () => {
      // Set up all Discord API intercepts manually (not via cy.login)
      // so we can control gist intercept ordering
      cy.interceptDiscordApi();

      // Override gist intercepts AFTER interceptDiscordApi (LIFO: last wins)
      cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
        statusCode: 200,
        body: {
          files: { 'announcement.json': { content: JSON.stringify({ rev: 'new-rev-123', version: '1.0.0' }) } },
        },
      }).as('getAnnouncementNew');

      cy.intercept('GET', '**/gists/a73736574a1a994e97cbc2d6f467c574', {
        statusCode: 200,
        body: {
          files: { 'announcement_markdown.md': { content: 'Welcome to the latest version!' } },
        },
      }).as('getAnnouncementMarkdownNew');

      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.contains('Announcement', { timeout: 10000 }).should('be.visible');
      cy.contains('Welcome to the latest version!').should('be.visible');
    });

    it('should not show announcement when fetch fails', () => {
      cy.interceptDiscordApi();

      // Override to fail
      cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
        statusCode: 500,
        body: {},
      }).as('getAnnouncementFail');

      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.contains('Announcement').should('not.exist');
    });

    it('should not show announcement when rev matches cached rev', () => {
      // Default gist mock from interceptDiscordApi returns rev '0' = cached default
      cy.login();
      cy.contains('Announcement').should('not.exist');
    });
  });

  describe('Announcement Dismiss', () => {
    it('should close modal when clicking Dismiss', () => {
      cy.interceptDiscordApi();

      cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
        statusCode: 200,
        body: {
          files: { 'announcement.json': { content: JSON.stringify({ rev: 'dismiss-test', version: '1.0.0' }) } },
        },
      }).as('getAnnouncementDismiss');

      cy.intercept('GET', '**/gists/a73736574a1a994e97cbc2d6f467c574', {
        statusCode: 200,
        body: {
          files: { 'announcement_markdown.md': { content: 'Test announcement content' } },
        },
      }).as('getAnnouncementMarkdownDismiss');

      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.contains('Announcement', { timeout: 10000 }).should('be.visible');
      cy.contains('button', 'Cancel').click();
      cy.contains('Announcement').should('not.exist');
    });

    it('should update hasNew to false after dismiss', () => {
      cy.interceptDiscordApi();

      cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
        statusCode: 200,
        body: {
          files: { 'announcement.json': { content: JSON.stringify({ rev: 'state-test', version: '1.0.0' }) } },
        },
      }).as('getAnnouncementState');

      cy.intercept('GET', '**/gists/a73736574a1a994e97cbc2d6f467c574', {
        statusCode: 200,
        body: {
          files: { 'announcement_markdown.md': { content: 'State test content' } },
        },
      }).as('getAnnouncementMarkdownState');

      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.contains('Announcement', { timeout: 10000 }).should('be.visible');
      cy.contains('button', 'Cancel').click();

      cy.window().then((win) => {
        const store = (win as any).__store__;
        if (store) {
          expect(store.getState().announcement.hasNew).to.eq(false);
        }
      });
    });
  });

  describe('Markdown Rendering', () => {
    beforeEach(() => {
      cy.interceptDiscordApi();

      cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
        statusCode: 200,
        body: {
          files: {
            'announcement.json': {
              content: JSON.stringify({ rev: 'markdown-test', version: '1.0.0' }),
            },
          },
        },
      }).as('getAnnouncementMarkdownTest');

      cy.intercept('GET', '**/gists/a73736574a1a994e97cbc2d6f467c574', {
        statusCode: 200,
        body: {
          files: {
            'announcement_markdown.md': {
              content:
                '# Big Heading\n\nThis is **bold text** here.\n\n[Click me](https://example.com)',
            },
          },
        },
      }).as('getAnnouncementMarkdownContent');

      cy.visit('/');
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.contains('Announcement', { timeout: 10000 }).should('be.visible');
    });

    it('renders markdown headings as HTML elements', () => {
      cy.get('[role="dialog"]').find('h1').contains('Big Heading').should('be.visible');
    });

    it('renders bold text', () => {
      cy.get('[role="dialog"]').find('strong').contains('bold text').should('be.visible');
    });

    it('renders links as clickable anchors', () => {
      cy.get('[role="dialog"]')
        .find('a[href="https://example.com"]')
        .contains('Click me')
        .should('be.visible');
    });
  });

  describe('Redux State', () => {
    it('should have announcement state accessible', () => {
      cy.login();
      cy.window().then((win) => {
        const store = (win as any).__store__;
        if (store) {
          const state = store.getState().announcement;
          expect(state).to.exist;
          expect(state).to.have.property('hasNew');
          expect(state).to.have.property('isLoading');
          expect(state).to.have.property('markdown');
        }
      });
    });
  });
});
