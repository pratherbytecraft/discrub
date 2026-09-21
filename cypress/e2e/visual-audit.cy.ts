/**
 * Visual Audit — Captures screenshots at key interaction points for visual review.
 *
 * Run: npm run visual-audit
 * Screenshots output to: cypress/screenshots/visual-audit.cy.ts/audit/
 *
 * This spec walks through all major app flows capturing ~50 screenshots.
 * It does NOT modify existing test runs — it's a separate on-demand pipeline.
 */

const DIR = 'audit';
const PAUSE = 300;

function snap(name: string) {
  cy.wait(PAUSE);
  cy.screenshot(`${DIR}/${name}`, { overwrite: true });
}

/** Close the donation drawer via the TopBar Supporter Wall toggle */
function closeDonationDrawer() {
  cy.get('[aria-label="Supporter Wall"]').click({ force: true });
  // Dismiss any lingering tooltip by clicking the main content area
  cy.get('body').click(0, 0);
  cy.wait(PAUSE);
}

describe('Visual Audit', () => {
  describe('Auth & Landing', () => {
    it('landing page (unauthenticated)', () => {
      cy.blockAutoAuth();
      cy.visit('/');
      snap('auth/landing-page');
    });

    // Launcher screenshot must be captured manually — the launcher is designed
    // to overlay Discord's page with semi-transparency, so it renders as a
    // near-black rectangle in headless Cypress without that backdrop.
  });

  describe('Navigation', () => {
    beforeEach(() => {
      cy.login();
      closeDonationDrawer();
    });

    it('welcome panel', () => {
      snap('navigation/welcome-panel');
    });

    it('server list', () => {
      snap('navigation/server-list');
    });

    it('channel list with categories', () => {
      cy.selectServer('Cypress Test Server');
      snap('navigation/channel-list');
    });

    it('DM list', () => {
      cy.get('button[role="tab"]').contains('DMs').click();
      cy.wait(PAUSE);
      snap('navigation/dm-list');
    });
  });

  describe('Message Table', () => {
    beforeEach(() => {
      cy.login();
      closeDonationDrawer();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.get('[data-testid="message-feed"]').should('be.visible');
    });

    it('messages loaded (default view)', () => {
      snap('messages/default-view');
    });

    it('message selected (toolbar visible)', () => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      snap('messages/single-selected');
    });

    it('filter modal open', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.wait(PAUSE);
      snap('messages/search-filters');
    });
  });

  describe('Settings Dialog', () => {
    beforeEach(() => {
      cy.login();
      closeDonationDrawer();
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]').should('be.visible');
    });

    it('operation delays tab', () => {
      snap('settings/operation-delays');
    });

    it('export preferences tab', () => {
      cy.contains('button', 'Export Preferences').click();
      snap('settings/export-preferences');
    });

    it('user data tab', () => {
      cy.contains('button', 'User Data').click();
      snap('settings/user-data');
    });

    it('display tab', () => {
      cy.contains('button', 'Display').click();
      snap('settings/display');
    });

    it('purge behavior tab', () => {
      cy.contains('button', 'Purge Behavior').click();
      snap('settings/purge-behavior');
    });
  });

  describe('Export Dialog', () => {
    beforeEach(() => {
      cy.login();
      closeDonationDrawer();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.get('[data-testid="message-feed"]').should('be.visible');
    });

    it('export dialog default state', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').should('be.visible');
      snap('export/default-state');
    });

    it('export dialog with preset dropdown', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').find('[role="combobox"]').first().click({ force: true });
      cy.wait(PAUSE);
      snap('export/preset-dropdown');
    });
  });

  describe('Modals', () => {
    beforeEach(() => {
      cy.login();
      closeDonationDrawer();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.get('[data-testid="message-feed"]').should('be.visible');
    });

    it('reaction modal', () => {
      // Each reaction pill carries aria-label="View Reactions", so the
      // find() returns one element per reaction — pick the first.
      // Matches the pattern used in reaction-deletion.cy.ts.
      cy.contains('[data-testid="message-feed-row"]','Anyone up for some gaming later?')
        .scrollIntoView()
        .find('[aria-label="View Reactions"]')
        .first()
        .click({ force: true });
      cy.get('[role="dialog"]').should('be.visible');
      snap('modals/reaction-modal');
    });

    it('delete confirm modal', () => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      cy.contains('button', 'Delete').click();
      cy.get('[role="dialog"]').should('be.visible');
      snap('modals/delete-confirm');
    });

    it('analytics modal', () => {
      cy.contains('button', 'Analytics').click();
      cy.get('[role="dialog"]').should('be.visible');
      snap('modals/analytics');
    });

    it('ideas & contact modal', () => {
      cy.get('[data-testid="topbar-ideas"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      snap('modals/ideas-contact');
    });
  });

  describe('Theme', () => {
    beforeEach(() => {
      cy.login();
      closeDonationDrawer();
    });

    it('dark mode', () => {
      snap('theme/dark-mode');
    });

    it('light mode', () => {
      // Pick the light theme from the Themes hub (instant apply).
      cy.openThemeGrid();
      cy.get('[data-testid="theme-card-discord-light"]').click();
      cy.closeAppearance();
      cy.wait(PAUSE);
      snap('theme/light-mode');
    });
  });

  describe('Donation Drawer', () => {
    it('donation feed visible', () => {
      cy.login();
      // Drawer defaults to open — wait for ko-fi link to appear
      cy.get('a[href*="ko-fi"]', { timeout: 10000 }).should('exist');
      cy.wait(PAUSE);
      snap('features/donation-drawer');
    });
  });

  describe('Status Log', () => {
    it('status log expanded', () => {
      cy.login();
      closeDonationDrawer();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.get('[data-testid="message-feed"]').should('be.visible');
      // Expand status log
      cy.contains('STATUS LOG').click({ force: true });
      cy.wait(PAUSE);
      snap('features/status-log');
    });
  });

  describe('DM Context', () => {
    it('DM message view', () => {
      cy.login();
      closeDonationDrawer();
      cy.selectDm('alice_dev');
      cy.get('[data-testid="message-feed"]').should('be.visible');
      snap('dm/message-view');
    });
  });

  describe('Forum Channels', () => {
    it('forum thread list', () => {
      cy.login();
      closeDonationDrawer();
      cy.selectServer('Cypress Test Server');
      cy.intercept('GET', '**/threads/search*', { fixture: 'forum-threads.json' }).as('getForumThreads');
      cy.contains('feedback').click();
      cy.wait('@getForumThreads');
      cy.wait(PAUSE);
      snap('forum/thread-list');
    });
  });
});
