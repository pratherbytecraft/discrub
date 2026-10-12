/**
 * Workspaces 2.2.5 WP7: the action kinds workspace-persistence.cy.ts does
 * not cover come back after a reload with Resume. A single Export cut in
 * its media phase, a Bulk Edit cut on its first edit, and a channel Purge
 * cut on its first search each pick up where they were.
 */

const API = '**/api/v10';
const GENERAL = '801000000000000001';

type WorkspaceHooks = {
  get: (wid: string) => Promise<{ conversations: Record<string, { name: string; action: { kind: string } | null }>; bulk: { kind: string; queue: string[] } | null } | null>;
};
const hooks = () => cy.window({ log: false }).its('__workspace__') as unknown as Cypress.Chainable<WorkspaceHooks>;

const zeroDelays = () => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    store.dispatch({
      type: 'app/updateAllSettings/fulfilled',
      payload: { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0', reactionsEnabled: 'false' },
    });
  });
};

const expectStatusEntry = (substr: string, timeout = 20000) => {
  cy.window({ log: false, timeout }).should((win) => {
    const entries = (win as any).__store__.getState().status.entries as Array<{ message: string }>;
    expect(entries.some((e) => e.message.includes(substr)), `status log contains "${substr}"`).to.eq(true);
  });
};

// The zero delays are dispatched, not saved, so a reload needs them again.
const relaunch = () => {
  cy.reload();
  cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
  cy.selectServer('Cypress Test Server');
  zeroDelays();
};

describe('Resume after a reload (2.2.5 WP7)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    zeroDelays();
  });

  it('a single Export cut in its media phase reads Resume and writes a new zip', () => {
    cy.task('downloads:clean');
    const message = {
      id: '900000000000000501',
      channel_id: GENERAL,
      author: { id: '111222333444555666', username: 'discrub_tester', discriminator: '0', avatar: null, global_name: 'Discrub Tester' },
      content: 'first attachment message',
      timestamp: '2026-02-01T12:00:00.000Z',
      edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], embeds: [], reactions: [], pinned: false, type: 0,
      attachments: [{
        id: '600000000000000501',
        filename: 'first.png',
        size: 2048,
        url: `https://cdn.discordapp.com/attachments/${GENERAL}/600000000000000501/first.png`,
        proxy_url: `https://media.discordapp.net/attachments/${GENERAL}/600000000000000501/first.png`,
        content_type: 'image/png',
      }],
    };
    cy.intercept('GET', `${API}/channels/*/messages?*`, { statusCode: 200, body: [message] }).as('customMessages');
    let mediaHits = 0;
    cy.intercept('GET', '**/attachments/**/first.png*', (req) => {
      mediaHits += 1;
      // The first download never finishes before the reload; the resumed run gets it at once.
      req.reply({ statusCode: 200, headers: { 'content-type': 'image/png' }, body: 'png-bytes', delay: mediaHits === 1 ? 30000 : 0 });
    }).as('media');

    cy.contains('general').click();
    cy.wait('@customMessages');
    cy.contains('first attachment message').should('be.visible');

    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').find('.MuiAccordionSummary-content').contains('Files & Media').scrollIntoView().click();
    cy.get('[role="dialog"]').contains('label', 'Download files for offline viewing').find('input[type="checkbox"]').then(($input) => {
      if (!$input.prop('checked')) cy.wrap($input).click({ force: true });
    });
    cy.get('[data-testid="export-confirm"]').click();
    cy.window({ timeout: 15000 }).should(() => {
      expect(mediaHits, 'the media download is in flight').to.be.greaterThan(0);
    });
    hooks().then((h) => h.get('default')).should((record) => {
      const general = Object.values(record?.conversations ?? {}).find((c) => c.name === 'general');
      expect(general?.action?.kind).to.eq('export');
    });

    relaunch();
    cy.contains('general').click();
    cy.contains('first attachment message', { timeout: 15000 }).should('be.visible');
    cy.contains('button', 'Resume').should('be.visible').click();
    cy.get('[data-testid="export-resume-note"]').should('contain', 'This export was running when Discrub closed. Resume writes a new zip.');
    cy.get('[data-testid="export-confirm"]').should('have.text', 'Resume').click();

    cy.waitForDownload(/^general\.zip$/i, 60000).then((fileName) => {
      cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
        const names = entries.map((e) => e.name);
        expect(names).to.include('general/general-page-1.html');
        expect(names.some((n) => n.startsWith('general/media/'))).to.eq(true);
      });
    });
    expectStatusEntry('Export: Completed general');
    hooks().then((h) => h.get('default')).should((record) => {
      const general = Object.values(record?.conversations ?? {}).find((c) => c.name === 'general');
      expect(general?.action ?? null).to.eq(null);
    });
    cy.contains('button', 'Export').should('be.visible');
  });

  it('a Bulk Edit cut on its first edit reads Resume and finishes', () => {
    let searches = 0;
    let edits = 0;
    cy.fixture('bulk-purge-search-results.json').then((results) => {
      cy.fixture('bulk-purge-search-empty.json').then((empty) => {
        cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
          searches += 1;
          req.reply({ statusCode: 200, body: searches === 1 || searches === 2 ? results : empty });
        }).as('search');
      });
    });
    cy.intercept('PATCH', `${API}/channels/*/messages/*`, (req) => {
      edits += 1;
      // The first edit never answers before the reload.
      req.reply({ statusCode: 200, body: {}, delay: edits === 1 ? 30000 : 0 });
    }).as('edit');

    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.contains('general').click();
    cy.contains('dev-chat').click();
    cy.get('[aria-label="Edit selected channels"]').click();
    cy.get('[role="dialog"]').find('textarea').first().type('redacted by owner');
    cy.get('[data-testid="bulk-edit-confirm"]').click();
    cy.window({ timeout: 15000 }).should(() => {
      expect(edits, 'the first edit is in flight').to.be.greaterThan(0);
    });
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk?.kind).to.eq('bulkEdit');
      expect(record?.bulk?.queue).to.have.length(2);
    });

    relaunch();
    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.get('[aria-label="Edit selected channels"]').should('have.text', 'Resume').click();
    cy.get('[data-testid="bulk-edit-resume-note"]').should('contain', 'This edit was running when Discrub closed. Resume picks it up.');
    cy.get('[role="dialog"]').find('textarea').first().should('have.value', 'redacted by owner');
    cy.get('[data-testid="bulk-edit-confirm"]').should('have.text', 'Resume').and('not.be.disabled').click();
    expectStatusEntry('Bulk edit complete', 30000);
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk ?? null).to.eq(null);
    });
  });

  it('a channel Purge cut on its first search reads Resume and finishes the channels it had left', () => {
    let searches = 0;
    cy.fixture('bulk-purge-search-empty.json').then((empty) => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searches += 1;
        req.reply({ statusCode: 200, body: empty, delay: searches === 1 ? 30000 : 0 });
      }).as('search');
    });
    cy.intercept('GET', `${API}/channels/*/messages?*`, { statusCode: 200, body: [] }).as('finalPass');
    cy.intercept('GET', `${API}/channels/*/threads/archived/*`, { statusCode: 200, body: { threads: [], has_more: false } });
    cy.intercept('GET', `${API}/guilds/*/threads/active`, { statusCode: 200, body: { threads: [] } });

    cy.intercept('GET', `${API}/users/*`, {
      statusCode: 200,
      body: { id: '111222333444555666', username: 'discrub_tester', discriminator: '0', avatar: null, global_name: 'Discrub Tester' },
    }).as('lookupUser');

    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.contains('general').click();
    cy.contains('dev-chat').click();
    cy.get('[aria-label="Purge selected channels"]').click();
    // A server purge needs a target author; the filter modal is where it is set.
    cy.get('[role="dialog"]').first().find('button[aria-label="Add filters"]').click();
    cy.get('[role="dialog"]').last().find('input[placeholder="Type to search or paste a User ID"]').first().clear().type('111222333444555666');
    cy.get('[role="listbox"]').contains(/Look up/).click();
    cy.wait('@lookupUser');
    cy.get('body').type('{esc}');
    cy.get('[role="dialog"]').last().contains('button', /Apply filters|Search/).click();
    cy.get('[data-testid="purge-confirm"]').should('not.be.disabled').click();
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk?.kind).to.eq('bulkPurge');
      expect(record?.bulk?.queue).to.have.length(2);
    });

    relaunch();
    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.get('[data-testid="multi-select-purge"]').should('have.text', 'Resume').click();
    cy.get('[data-testid="purge-resume-note"]').should('contain', 'This purge was running when Discrub closed.');
    cy.get('[data-testid="purge-confirm"]').should('have.text', 'Resume').and('not.be.disabled').click();
    cy.contains('Purge complete', { timeout: 60000 }).should('exist');
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk ?? null).to.eq(null);
    });
  });
});
