/// <reference types="cypress" />

const API = '**/api/v10';

/**
 * Set up all common Discord API intercepts at once.
 * Intercept order matters in Cypress (LIFO — last registered wins).
 * More specific patterns are registered last so they take priority.
 */
Cypress.Commands.add('interceptDiscordApi', () => {
  // Mock GitHub gist API calls to prevent AnnouncementModal/DonationDrawer crashes.
  // Donation gist (new contributions format)
  cy.intercept('GET', '**/gists/eb9a7ef2cf49ecab72adebeacea420bf', {
    statusCode: 200,
    body: {
      files: { 'contributions.json': { content: '[]' } },
    },
  }).as('getDonationGist');

  // Announcement data gist — rev '0' matches default CACHED_ANNOUNCEMENT_REV (no modal)
  cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
    statusCode: 200,
    body: {
      files: { 'announcement.json': { content: JSON.stringify({ rev: '0', version: '1.0.0' }) } },
    },
  }).as('getAnnouncementGist');

  // Announcement markdown gist
  cy.intercept('GET', '**/gists/a73736574a1a994e97cbc2d6f467c574', {
    statusCode: 200,
    body: {
      files: { 'announcement_markdown.md': { content: '# Test' } },
    },
  }).as('getAnnouncementMarkdownGist');

  // Past-announcements archive gist (browse mode); two entries, newest first
  cy.intercept('GET', '**/gists/d57525174377b474cb7c90210d3ab979', {
    statusCode: 200,
    body: {
      files: {
        'index.json': {
          content: JSON.stringify([
            { version: '2.1.0', date: '2026-08-23', title: 'Discrub 2.1.0', file: '2.1.0.md' },
            { version: '2.0.10', date: '2026-08-16', title: 'Discrub 2.0.10', file: '2.0.10.md' },
          ]),
        },
        '2.1.0.md': { content: '# Archived notes for 2.1.0' },
        '2.0.10.md': { content: '# Archived notes for 2.0.10' },
      },
    },
  }).as('getAnnouncementArchiveGist');

  // Guild member lookup
  cy.intercept('GET', `${API}/guilds/*/members/*`, {
    statusCode: 200,
    body: {},
  }).as('getGuildMember');

  // Roles endpoint
  cy.intercept('GET', `${API}/guilds/*/roles`, {
    statusCode: 200,
    body: [],
  }).as('getRoles');

  // Guild emojis endpoint (#202 reaction picker). Default empty; specs that
  // exercise server emojis override this with a fixture.
  cy.intercept('GET', `${API}/guilds/*/emojis`, {
    statusCode: 200,
    body: [],
  }).as('getGuildEmojis');

  cy.fixture('channels.json').then((channels) => {
    cy.intercept('GET', `${API}/guilds/*/channels`, {
      statusCode: 200,
      body: channels,
    }).as('getChannels');
  });

  cy.fixture('messages.json').then((messages) => {
    cy.intercept('GET', `${API}/channels/*/messages?*`, {
      statusCode: 200,
      body: messages,
    }).as('getMessages');
  });

  cy.fixture('dms.json').then((dms) => {
    cy.intercept('GET', `${API}/users/@me/channels`, {
      statusCode: 200,
      body: dms,
    }).as('getDMs');
  });

  cy.fixture('guilds.json').then((guilds) => {
    cy.intercept('GET', `${API}/users/@me/guilds`, {
      statusCode: 200,
      body: guilds,
    }).as('getGuilds');
  });

  // Most specific last (LIFO: last registered wins)
  cy.fixture('user.json').then((user) => {
    cy.intercept('GET', `${API}/users/@me`, {
      statusCode: 200,
      body: user,
    }).as('getUser');
  });
});

/**
 * Block auto-authentication from VITE_DISCORD_TOKEN env variable.
 * Intercepts /users/@me with 401 so the app stays on LandingPage.
 * Must be called BEFORE cy.visit('/').
 */
Cypress.Commands.add('blockAutoAuth', () => {
  cy.intercept('GET', `${API}/users/@me`, {
    statusCode: 401,
    body: { message: '401: Unauthorized', code: 0 },
  }).as('blockedAutoAuth');
});

/**
 * Log in by visiting the page with all API intercepts.
 * The dev server has VITE_DISCORD_TOKEN set, so the app auto-authenticates
 * when the /users/@me intercept returns a valid user.
 *
 * Resets IndexedDB on the AUT origin before letting the app boot — the
 * blanket `beforeEach` in support/e2e.ts may have run against a stale
 * window (about:blank on first test). Defense in depth ensures storage
 * never leaks between tests after the #110 migration.
 */
Cypress.Commands.add('login', () => {
  cy.interceptDiscordApi();
  cy.visit('/', {
    onBeforeLoad(win) {
      // Wipe any stale per-purpose databases on the AUT origin before
      // app boot. Mirrors the global beforeEach in support/e2e.ts —
      // see that file for the full rationale.
      for (const name of [
        'Discrub-settings',
        'Discrub-state',
        'Discrub-presets',
        'Discrub-cache',
        'Discrub-history',
        'Discrub-statuslog',
        'Discrub-package',
        'Discrub-media',
        'keyval-store',
      ]) {
        try {
          win.indexedDB.deleteDatabase(name);
        } catch {
          /* best-effort */
        }
      }
    },
  });
  // The env token triggers auto-auth; wait for the main layout
  cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
});

/**
 * Select a server by name from the sidebar server list
 */
Cypress.Commands.add('selectServer', (name: string) => {
  cy.contains(name).click();
  cy.wait('@getChannels');
});

/**
 * Select a channel by name from the channel list.
 */
Cypress.Commands.add('selectChannel', (name: string) => {
  cy.contains(name).click();
  cy.wait('@getMessages');
});

/**
 * Switch to DMs tab and select a DM by recipient name
 */
Cypress.Commands.add('selectDm', (name: string) => {
  // Click DMs tab
  cy.contains('button', 'DMs').click();
  cy.wait('@getDMs');

  // Override the default messages intercept with DM messages
  cy.fixture('dm-messages.json').then((dmMessages) => {
    cy.intercept('GET', `${API}/channels/*/messages?*`, {
      statusCode: 200,
      body: dmMessages,
    }).as('getDmMessages');
  });

  cy.contains(name).click();
  cy.wait('@getDmMessages');
});

/**
 * Upload a data-package ZIP fixture into the ImportDialog.
 *
 * Navigates to the "Package" sidebar tab, opens the import dialog, and
 * selects the given fixture (relative to cypress/fixtures). Default
 * fixture is `test-package.zip`.
 */
Cypress.Commands.add('uploadPackage', (fixture = 'test-package.zip') => {
  cy.contains('button', 'Package').click();
  cy.contains('button', /Choose ZIP file|Import package/).click();
  cy.get('[data-testid="package-file-input"]').selectFile(
    `cypress/fixtures/${fixture}`,
    { force: true },
  );
});

/**
 * Click the "Package" sidebar tab.
 */
Cypress.Commands.add('openPackageTab', () => {
  cy.contains('button', 'Package').click();
});

/**
 * Read every value out of one of the per-purpose `Discrub-<store>`
 * IndexedDB databases. Returns an array of values (key order is not
 * guaranteed). Used by tests that need to assert on persisted state
 * since localStorage is no longer the storage backend.
 */
Cypress.Commands.add('readIdbStore', (store: string) => {
  return cy.window({ log: false }).then((win) => {
    return new Cypress.Promise<unknown[]>((resolve) => {
      const req = win.indexedDB.open(`Discrub-${store}`);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keyval')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('keyval', 'readonly');
        const objStore = tx.objectStore('keyval');
        const all = objStore.getAll();
        all.onsuccess = () => {
          db.close();
          resolve(all.result || []);
        };
        all.onerror = () => {
          db.close();
          resolve([]);
        };
      };
      req.onerror = () => resolve([]);
      req.onblocked = () => resolve([]);
    });
  });
});

/**
 * Same shape as `readIdbStore` but returns the keys instead of the values.
 * Useful for asserting on the namespace structure (`pkg:meta:*`,
 * `pkg:msgs:*`, etc.) without caring about the stored payloads.
 */
Cypress.Commands.add('readIdbStoreKeys', (store: string) => {
  return cy.window({ log: false }).then((win) => {
    return new Cypress.Promise<string[]>((resolve) => {
      const req = win.indexedDB.open(`Discrub-${store}`);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keyval')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('keyval', 'readonly');
        const objStore = tx.objectStore('keyval');
        const all = objStore.getAllKeys();
        all.onsuccess = () => {
          db.close();
          resolve((all.result || []).filter((k): k is string => typeof k === 'string'));
        };
        all.onerror = () => {
          db.close();
          resolve([]);
        };
      };
      req.onerror = () => resolve([]);
      req.onblocked = () => resolve([]);
    });
  });
});

/**
 * Wait for a browser download matching `pattern` to land in the Cypress
 * downloads folder and finish writing (size stable across two polls,
 * `.crdownload` partials excluded). Yields the matching filename so
 * follow-up `zip:list` / `zip:read` tasks can inspect the archive.
 *
 * Call `cy.task('downloads:clean')` at the start of any test that uses
 * this, so stale files from earlier tests can't satisfy the match.
 */
Cypress.Commands.add(
  'waitForDownload',
  (pattern: RegExp, timeoutMs = 30000) => {
    const started = Date.now();
    const poll = (
      lastSize: number | null,
      lastName: string | null,
    ): Cypress.Chainable<string> => {
      return cy
        .task<{ name: string; size: number }[]>('downloads:list', null, { log: false })
        .then((files) => {
          const match = files.find((f) => pattern.test(f.name));
          if (match && lastName === match.name && lastSize === match.size) {
            return cy.wrap(match.name, { log: false });
          }
          if (Date.now() - started > timeoutMs) {
            throw new Error(
              `Download matching ${pattern} did not complete within ${timeoutMs}ms ` +
                `(saw: ${files.map((f) => f.name).join(', ') || 'none'})`,
            );
          }
          return cy
            .wait(500, { log: false })
            .then(() => poll(match?.size ?? null, match?.name ?? null));
        });
    };
    return poll(null, null);
  },
);

/**
 * 2.2.0: the Themes and Support hub opens from the Appearance menu's footer.
 * The top bar button keeps the gift-button test id.
 */
Cypress.Commands.add('openThemesHub', () => {
  cy.get('[data-testid="gift-button"]').click();
  cy.get('[data-testid="appearance-open-hub"]').click();
});
