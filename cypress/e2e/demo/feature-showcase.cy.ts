/**
 * Feature Showcase — Demo Cypress spec for generating documentation screenshots.
 *
 * Run: npx cypress run --spec cypress/e2e/demo/feature-showcase.cy.ts
 * Screenshots output to: cypress/screenshots/demo/
 *
 * These are NOT fast tests — they use realistic delays so the UI
 * looks natural in screenshots. Do not run in CI.
 */

const SCREENSHOT_DIR = 'demo';

// Documentation screenshots show the release (extension) branding, not the
// Bleeding Edge wordmark the dev server wears by default.
Cypress.on('window:before:load', (win) => {
  (win as unknown as { __bleedingEdgeOverride__: boolean }).__bleedingEdgeOverride__ = false;
});
const PAUSE = 500; // ms between actions for natural feel

// Enriched roles for demo screenshots (not in standard fixtures)
const DEMO_ROLES = [
  { id: 'role-everyone', name: '@everyone', color: 0, position: 0, hoist: false, permissions: '0', managed: false, mentionable: false, flags: 0 },
  { id: 'role-member', name: 'Member', color: 0, position: 1, hoist: false, permissions: '0', managed: false, mentionable: false, flags: 0 },
  { id: 'role-moderator', name: 'Moderator', color: 0x2ecc71, position: 5, hoist: true, permissions: '0', managed: false, mentionable: false, flags: 0, unicode_emoji: '🛡️' },
  { id: 'role-developer', name: 'Developer', color: 0x3498db, position: 4, hoist: true, permissions: '0', managed: false, mentionable: false, flags: 0 },
  { id: 'role-admin', name: 'Admin', color: 0xe91e63, position: 10, hoist: true, permissions: '0', managed: false, mentionable: false, flags: 0, unicode_emoji: '👑' },
];

// Guild member with roles for demo
const DEMO_GUILD_MEMBER = {
  roles: ['role-admin', 'role-moderator'],
  nick: 'Discrub Tester',
  joined_at: '2024-01-01T00:00:00.000Z',
};

function screenshot(name: string) {
  cy.wait(PAUSE);
  cy.screenshot(`${SCREENSHOT_DIR}/${name}`, { overwrite: true });
}

/** Close the donation drawer via the TopBar Supporter Wall toggle (inline at md+, in More below) */
function hideDonationDrawer() {
  cy.wait(1500);
  cy.get('body').then(($body) => {
    if ($body.find('button:contains("Support on Ko-Fi"):visible, a[href*="ko-fi"]:visible').length === 0) {
      return;
    }
    if ($body.find('[aria-label="Supporter Wall"]').length > 0) {
      cy.get('[aria-label="Supporter Wall"]').click({ force: true });
    } else {
      cy.get('[aria-label="More options"]').click({ force: true });
      cy.contains('[role="menuitem"]', 'Supporter Wall').click({ force: true });
    }
    cy.get('body').click(0, 0);
    cy.wait(400);
  });
}

describe('Feature Showcase — Documentation Screenshots', () => {
  describe('01 — Authentication', () => {
    it('landing page with token entry', () => {
      cy.interceptDiscordApi();
      cy.blockAutoAuth();
      cy.visit('/');
      cy.wait(PAUSE);
      screenshot('auth/landing-page');
    });
  });

  describe('01b — Welcome Panel', () => {
    it('welcome panel after authentication', () => {
      cy.login();
      hideDonationDrawer();
      cy.wait(PAUSE);
      screenshot('welcome/welcome-panel');
    });
  });

  describe('02 — Server & Channel Browsing', () => {
    beforeEach(() => {
      // Use enriched roles for demo
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      }).as('getDemoRoles');

      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      }).as('getDemoGuildMember');

      cy.login();
      hideDonationDrawer();
    });

    it('server list', () => {
      screenshot('browsing/server-list');
    });

    it('channel list with categories', () => {
      cy.selectServer('Cypress Test Server');
      cy.wait(PAUSE);
      screenshot('browsing/channel-list');
    });

    it('DM list', () => {
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
      cy.wait(PAUSE);
      screenshot('browsing/dm-list');
    });
  });

  describe('03 — Message Table', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('message table with messages loaded', () => {
      cy.contains('[data-testid="message-feed-row"]', 'Sounds good, deploying now.').should('exist');
      screenshot('messages/message-table');
    });

    it('message selection and toolbar', () => {
      // Select some messages
      cy.contains('[data-testid="message-feed-row"]','Hello everyone').click();
      cy.wait(200);
      cy.contains('[data-testid="message-feed-row"]','Thanks for setting this up').click();
      cy.wait(PAUSE);
      screenshot('messages/toolbar-selection');
    });

    it('filter modal open', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.wait(PAUSE);
      screenshot('messages/search-filters');
    });

    // #182: Before + After together as a between-range
    //
    // Skipped from auto-capture for now. The DateRangeFilter's
    // ToggleButtonGroup interactions don't survive a clean Cypress
    // selector pass (the picker renders its own buttons that shadow
    // the toggle text, and MUI's class names changed across versions
    // in a way that broke `.MuiToggleButton-root`). The feature is
    // already covered in README and ONBOARDING prose; a manual
    // capture can fill the screenshot gap if a visual is needed.
    it.skip('filter modal with Before and After both active (between)', () => {
      // intentional placeholder; see comment above.
    });
  });

  describe('04 — User Profile', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('user profile modal', () => {
      // Click on author name/avatar area to open profile
      cy.contains('[data-testid="message-chunk"]', 'Hello everyone').scrollIntoView();
      cy.contains('[data-testid="message-chunk"]', 'Hello everyone').find('[class*="Avatar"]').first().click({ force: true });
      cy.get('[role="dialog"]').should('be.visible');
      cy.wait(PAUSE);
      screenshot('messages/user-profile');
    });
  });

  describe('05 — Reactions', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.fixture('reacting-users.json').then((users) => {
        cy.intercept('GET', '**/api/v10/channels/*/messages/*/reactions/*', {
          statusCode: 200,
          body: users,
        }).as('getReactingUsers');
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('reaction modal with users', () => {
      // Each reaction pill carries the same aria-label; pick first.
      cy.contains('[data-testid="message-feed-row"]','Anyone up for some gaming later?')
        .scrollIntoView()
        .find('[aria-label="View Reactions"]')
        .first()
        .click({ force: true });
      cy.wait('@getReactingUsers');
      cy.wait(PAUSE);
      screenshot('reactions/reaction-modal');
    });
  });

  describe('05b — Add Reactions (#202)', () => {
    beforeEach(() => {
      // Intercepts must be registered AFTER cy.login() (which calls
      // interceptDiscordApi and stubs defaults) so the most-recent intercept
      // wins — otherwise the default empty guild-emoji stub shadows ours.
      cy.login();
      cy.intercept('GET', '**/api/v10/guilds/*/roles', { statusCode: 200, body: DEMO_ROLES });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', { statusCode: 200, body: DEMO_GUILD_MEMBER });
      cy.fixture('guild-emojis.json').then((emojis) => {
        cy.intercept('GET', '**/api/v10/guilds/*/emojis', { statusCode: 200, body: emojis }).as('getGuildEmojis');
      });
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('add reactions modal with emoji picker', () => {
      cy.contains('[data-testid="message-feed-row"]', 'Thanks for setting this up!').scrollIntoView().click();
      cy.contains('button', 'Add Reactions').click();
      cy.get('[role="dialog"]').contains('Add Reactions').should('be.visible');
      // The unicode emoji grid renders unconditionally; server emojis are a
      // bonus when the fetch resolves. Don't gate the shot on either.
      cy.wait(PAUSE);
      screenshot('reactions/add-reactions');
    });
  });

  describe('05c — Sticker & Poll Rendering (#213)', () => {
    beforeEach(() => {
      // Register the sticker/poll message stub AFTER login so it wins over the
      // default messages stub set up by interceptDiscordApi.
      cy.login();
      cy.intercept('GET', '**/api/v10/guilds/*/roles', { statusCode: 200, body: DEMO_ROLES });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', { statusCode: 200, body: DEMO_GUILD_MEMBER });
      // Alias as getMessages — selectChannel() waits on @getMessages, and this
      // intercept (registered last) is the one that handles the request.
      cy.fixture('sticker-poll-messages.json').then((messages) => {
        cy.intercept('GET', '**/api/v10/channels/*/messages?*', { statusCode: 200, body: messages }).as('getMessages');
      });
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('feed with a rendered sticker and poll card', () => {
      cy.get('[data-testid="inline-poll"]', { timeout: 10000 }).should('be.visible');
      cy.wait(PAUSE);
      screenshot('messages/sticker-poll');
    });
  });

  describe('06 — Export', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('export dialog — format selection', () => {
      cy.contains('button', 'Export').click();
      cy.wait(PAUSE);
      screenshot('export/export-dialog');
    });

    it('export dialog — media settings', () => {
      cy.contains('button', 'Export').click();
      // Expand Files & Media section
      cy.contains('Files & Media').click();
      cy.wait(PAUSE);
      screenshot('export/media-settings');
    });

    it('export dialog — preset selector', () => {
      cy.contains('button', 'Export').click();
      cy.wait(PAUSE);
      // Open the preset dropdown
      cy.get('[role="dialog"]').find('[role="combobox"]').first().click({ force: true });
      cy.wait(PAUSE);
      screenshot('export/preset-selector');
    });

    // #184: Plain Text format reveals a dedicated options accordion
    it('export dialog — plain text options', () => {
      hideDonationDrawer();
      cy.contains('button', 'Export').click();
      cy.wait(PAUSE);
      // The Format selector is a checkbox list (one selected acts as
      // radio). Click the "Plain Text" entry to switch formats.
      cy.get('[role="dialog"]')
        .contains(/^Plain Text/)
        .closest('label')
        .find('input[type="checkbox"]')
        .click({ force: true });
      cy.wait(PAUSE);
      // The "Plain text options" accordion appears below; expand if
      // collapsed.
      cy.get('[role="dialog"]').then(($d) => {
        const accordion = $d.find(':contains("Plain text options")').last();
        if (accordion.length && accordion.attr('aria-expanded') === 'false') {
          cy.wrap(accordion).click({ force: true });
        }
      });
      cy.wait(PAUSE);
      screenshot('export/plain-text-options');
    });
  });

  describe('07 — Purge', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      hideDonationDrawer();
    });

    it('channel list in multi-select mode', () => {
      // Enter multi-select mode
      cy.get('[aria-label="Toggle multi-select"]').click();
      cy.wait(200);
      // Select some channels
      cy.contains('general').click();
      cy.wait(200);
      cy.contains('dev-chat').click();
      cy.wait(PAUSE);
      screenshot('browsing/multi-select');
    });

    it('bulk purge dialog — multi-select channels', () => {
      // Enter multi-select mode
      cy.get('[aria-label="Toggle multi-select"]').click();
      cy.wait(200);
      // Select some channels
      cy.contains('general').click();
      cy.wait(200);
      cy.contains('dev-chat').click();
      cy.wait(200);
      // Click purge icon button
      cy.get('[aria-label="Purge selected channels"]').click({ force: true });
      cy.wait(PAUSE);
      screenshot('purge/purge-dialog');
    });

    // #215 — bulk edit across multi-selected channels
    it('bulk edit dialog — multi-select channels', () => {
      cy.get('[aria-label="Toggle multi-select"]').click();
      cy.wait(200);
      cy.contains('general').click();
      cy.wait(200);
      cy.contains('dev-chat').click();
      cy.wait(200);
      cy.get('[aria-label="Edit selected channels"]').click({ force: true });
      cy.get('[role="dialog"]').should('be.visible');
      // Type sample content so the dialog reads naturally in the shot.
      cy.get('[role="dialog"]').find('textarea').first().type('[redacted]');
      cy.wait(PAUSE);
      screenshot('purge/bulk-edit-dialog');
    });
  });

  describe('08 — Forum Channels', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.fixture('forum-threads.json').then((threads) => {
        cy.intercept('GET', '**/api/v10/channels/*/threads/search*', {
          statusCode: 200,
          body: threads,
        }).as('getForumThreads');
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      hideDonationDrawer();
    });

    it('forum thread list', () => {
      cy.contains('feedback').click();
      cy.wait('@getForumThreads');
      cy.wait(PAUSE);
      screenshot('forum/thread-list');
    });
  });

  describe('09 — Settings', () => {
    beforeEach(() => {
      cy.login();
      hideDonationDrawer();
    });

    it('settings dialog', () => {
      cy.get('[aria-label="Settings"]').click({ force: true });
      cy.wait(PAUSE);
      screenshot('settings/settings-dialog');
    });
  });

  describe('10 — Status Log & Theme', () => {
    beforeEach(() => {
      cy.intercept('GET', '**/api/v10/guilds/*/roles', {
        statusCode: 200,
        body: DEMO_ROLES,
      });
      cy.intercept('GET', '**/api/v10/guilds/*/members/*', {
        statusCode: 200,
        body: DEMO_GUILD_MEMBER,
      });
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('status log expanded', () => {
      // Expand the status log
      cy.get('[aria-label="Expand log"]').click();
      cy.wait(PAUSE);
      screenshot('ui/status-log');
    });

    it('dark theme', () => {
      screenshot('ui/theme-dark');
    });

    it('light theme', () => {
      // The theme grid lives on the Appearance menu's Theme segment (2.2.0).
      cy.openThemeGrid();
      cy.get('[data-testid="theme-card-discord-light"]').click();
      cy.closeAppearance();
      cy.wait(PAUSE);
      screenshot('ui/theme-light');
    });
  });

  describe('11 — Analytics', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      hideDonationDrawer();
    });

    it('analytics modal', () => {
      cy.contains('button', 'Analytics').click();
      cy.wait(PAUSE);
      screenshot('analytics/analytics-modal');
    });
  });

  describe('10 — Data Package Import', () => {
    beforeEach(() => {
      cy.interceptDiscordApi();
      cy.login();
      hideDonationDrawer();
    });

    it('package tab empty state', () => {
      cy.openPackageTab();
      cy.contains(/Import a Discord Data Package/i).should('be.visible');
      screenshot('package/package-empty-state');
    });

    it('package analytics view', () => {
      cy.uploadPackage();
      cy.contains(/Top channels by message count/i).should('be.visible');
      screenshot('package/package-analytics');
    });

    it('package message browser (source-only)', () => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      screenshot('package/package-message-browser');
    });

    it('package message browser with rehydrated rows', () => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      // Inject enriched state for the screenshot — actual API traffic
      // is out of scope for the demo pipeline.
      cy.window().then((win) => {
        const store = (win as { __store__?: { dispatch: (a: unknown) => void } }).__store__;
        if (!store) throw new Error('Redux store not exposed');
        store.dispatch({
          type: 'package/hydrateEnrichmentFromCache',
          payload: {
            channelId: '200',
            cache: {
              lastFetched: Date.now(),
              messages: {
                '1001': {
                  id: '1001',
                  type: 0,
                  content: 'hello world 🎉',
                  author: { id: 'a', username: 'you', global_name: 'You' },
                  reactions: [
                    { emoji: { name: '👍' }, count: 4 },
                    { emoji: { name: '❤️' }, count: 9 },
                  ],
                  embeds: [],
                  mentions: [],
                  channel_id: '200',
                  timestamp: '2022-07-28T22:30:52.000Z',
                  attachments: [],
                },
                '1002': {
                  id: '1002',
                  type: 0,
                  content: 'with, comma',
                  author: { id: 'a', username: 'you', global_name: 'You' },
                  reactions: [],
                  embeds: [],
                  mentions: [],
                  channel_id: '200',
                  timestamp: '2022-07-28T22:31:00.000Z',
                  attachments: [],
                },
              },
              misses: { deleted: [], forbidden: [] },
            },
          },
        });
      });
      cy.contains(/Rich data loaded/).should('be.visible');
      screenshot('package/package-rehydrated');
    });

    // #172: package message filter modal + filtered count + active chip
    it('package message browser with active content filter', () => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      // Drawer can lazy-load after the upload completes.
      hideDonationDrawer();

      cy.get('[data-testid="package-refine-button"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]')
        .find('input[placeholder*="Search message content"]')
        .type('hello');
      cy.get('[role="dialog"]')
        .find('button[class*="contained"]')
        .contains(/Apply filters|Search/)
        .click();

      cy.get('[role="dialog"]').should('not.exist');
      cy.contains(/of \d+ messages match/).should('be.visible');
      cy.wait(PAUSE);
      screenshot('package/package-filter');
    });

    // #173: reaction chips on enriched package rows open the live ReactionModal
    it('package reactor modal opens from an enriched row', () => {
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      // Hide the donation drawer BEFORE opening the reactor modal so
      // the screenshot doesn't capture both UI surfaces stacked.
      hideDonationDrawer();

      // Same enrichment fixture as package-rehydrated above. msg 1001
      // carries two reactions (👍, ❤️) that turn into clickable chips
      // once the enriched state lands.
      cy.window().then((win) => {
        const store = (win as { __store__?: { dispatch: (a: unknown) => void } }).__store__;
        if (!store) throw new Error('Redux store not exposed');
        store.dispatch({
          type: 'package/hydrateEnrichmentFromCache',
          payload: {
            channelId: '200',
            cache: {
              lastFetched: Date.now(),
              messages: {
                '1001': {
                  id: '1001',
                  type: 0,
                  content: 'hello world 🎉',
                  author: { id: 'a', username: 'you', global_name: 'You' },
                  reactions: [
                    { emoji: { name: '👍' }, count: 4 },
                    { emoji: { name: '❤️' }, count: 9 },
                  ],
                  embeds: [],
                  mentions: [],
                  channel_id: '200',
                  timestamp: '2022-07-28T22:30:52.000Z',
                  attachments: [],
                },
              },
              misses: { deleted: [], forbidden: [] },
            },
          },
        });
      });
      cy.contains(/Rich data loaded/).should('be.visible');

      // Click the first reaction chip to open the modal. Token-less
      // package context surfaces "User list not available" rather than
      // hitting Discord, which still captures the modal's shape.
      cy.get('[data-testid="package-reaction-chip"]').first().click({ force: true });
      cy.get('[role="dialog"]').should('be.visible');
      cy.wait(PAUSE);
      screenshot('package/package-reaction-modal');
    });
  });
});
