/**
 * GH #13 attachment filters: stress the ACTUAL network calls, not just the
 * first FilterModal → search URL (that one lives in search.cy.ts).
 *
 * Covered here:
 *   1. multi-page search + Load All keeps the params on every page
 *   2. DM search sends them on the channel-level endpoint
 *   3. chip removal re-searches without the removed param
 *   4. URL encoding of odd extensions / filenames
 *   5. bulk export with an attachment-only filter uses search, not list
 *   6. bulk purge (Messages mode) carries the params
 *   7. package-mode refine filters locally and makes no search call
 */

const API = '**/api/v10';

const result = (id: string, content: string, filename?: string) => [{
  id,
  channel_id: '801000000000000001',
  author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
  content,
  timestamp: '2026-02-01T12:00:00.000Z',
  edited_timestamp: null,
  tts: false,
  mention_everyone: false,
  mentions: [],
  attachments: filename ? [{ id: `${id}-a`, filename, size: 10, url: `https://cdn.discordapp.com/attachments/1/${id}/${filename}`, proxy_url: '' }] : [],
  embeds: [],
  reactions: [],
  pinned: false,
  type: 0,
}];

const disableReactionEnrichment = () => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    store.dispatch({
      type: 'app/updateAllSettings/fulfilled',
      payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
    });
  });
};

const openFilters = () => {
  cy.contains('button', 'Filters').click();
  cy.get('[role="dialog"]').should('be.visible');
};

const addExtensions = (scope: () => Cypress.Chainable, ...exts: string[]) => {
  scope().find('[data-testid="attachment-extension-input-search"]').type(exts.map((e) => `${e}{enter}`).join(''));
};

const applySearch = () => {
  cy.get('[role="dialog"]').last().find('button[class*="contained"]').contains(/Search|Apply filters/).click();
};

describe('Attachment filters — network call stress (GH #13)', () => {
  describe('guild search', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      disableReactionEnrichment();
    });

    it('keeps attachment params on every search page through Load All', () => {
      const page1 = Array.from({ length: 25 }, (_, i) => result(`80000000000000${String(i).padStart(4, '0')}`, `page one ${i}`, `img${i}.png`)[0]).map((m) => [m]);
      const urls: string[] = [];
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        urls.push(req.url);
        const page = urls.length === 1 ? page1 : [result('800000000000009999', 'last page', 'final.png')];
        req.reply({ statusCode: 200, body: { messages: page, total_results: 26, threads: [] } });
      }).as('search');

      openFilters();
      addExtensions(() => cy.get('[role="dialog"]'), '.PNG', 'jpg');
      cy.get('[role="dialog"]').find('[data-testid="attachment-filename-input-search"]').type('final.png');
      applySearch();
      cy.wait('@search');
      cy.contains('25 of 26 matches loaded').should('be.visible');

      cy.contains('button', 'Load All').click();
      cy.get('[role="dialog"]').contains('button', 'Load All').click();
      cy.wait('@search');
      cy.contains('[data-testid="message-feed-row"]', 'last page').should('exist');

      cy.then(() => {
        expect(urls.length, 'two search pages').to.be.gte(2);
        urls.forEach((u, i) => {
          expect(u, `page ${i + 1} extension png`).to.include('attachment_extension=png');
          expect(u, `page ${i + 1} extension jpg`).to.include('attachment_extension=jpg');
          expect(u, `page ${i + 1} filename`).to.include('attachment_filename=final.png');
        });
        // Load All continues via the cap-shift cursor (#188/#208): max_id set, params intact.
        expect(urls[1], 'page 2 uses the max_id cursor').to.include('max_id=');
      });
    });

    it('re-searches without the removed param when a chip is deleted', () => {
      const urls: string[] = [];
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        urls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [result('800000000000000001', 'hit', 'a.png')], total_results: 1, threads: [] } });
      }).as('search');

      openFilters();
      addExtensions(() => cy.get('[role="dialog"]'), 'png', 'pdf');
      cy.get('[role="dialog"]').find('[data-testid="attachment-filename-input-search"]').type('a.png');
      applySearch();
      cy.wait('@search');

      // Drop pdf: png + filename remain.
      cy.contains('.MuiChip-root', 'file type: pdf').find('.MuiChip-deleteIcon').click();
      cy.wait('@search');
      cy.contains('file type: pdf').should('not.exist');
      cy.then(() => {
        const last = urls[urls.length - 1];
        expect(last).to.include('attachment_extension=png');
        expect(last).not.to.include('attachment_extension=pdf');
        expect(last).to.include('attachment_filename=a.png');
      });

      // Drop the filename: only png remains.
      cy.contains('.MuiChip-root', 'file name: a.png').find('.MuiChip-deleteIcon').click();
      cy.wait('@search');
      cy.then(() => {
        const last = urls[urls.length - 1];
        expect(last).to.include('attachment_extension=png');
        expect(last).not.to.include('attachment_filename');
      });

      // Drop png: no filter left → search cleared, no further search call.
      cy.then(() => { urls.length = 0; });
      cy.contains('.MuiChip-root', 'file type: png').find('.MuiChip-deleteIcon').click();
      cy.contains('file type: png').should('not.exist');
      cy.wait(500);
      cy.then(() => expect(urls, 'no search after last chip removed').to.have.length(0));
    });

    it('URL-encodes odd extensions and filenames', () => {
      const urls: string[] = [];
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        urls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
      }).as('search');

      openFilters();
      addExtensions(() => cy.get('[role="dialog"]'), 'tar.gz', ' JPEG ');
      cy.get('[role="dialog"]').find('[data-testid="attachment-filename-input-search"]').type('my file ü (1) & co.png');
      applySearch();
      cy.wait('@search');
      cy.then(() => {
        const u = urls[0];
        expect(u).to.include('attachment_extension=tar.gz');
        expect(u).to.include('attachment_extension=jpeg');
        expect(u).to.include('attachment_filename=my+file+%C3%BC+%281%29+%26+co.png');
        expect(u).not.to.include('attachment_extension=&');
      });
      cy.contains('file type: tar.gz').should('be.visible');
    });
  });

  describe('DM search', () => {
    it('sends attachment params on the channel-level endpoint', () => {
      cy.login();
      cy.selectDm('alice_dev');
      cy.intercept('GET', `${API}/channels/*/messages/search*`, {
        statusCode: 200,
        body: { messages: [result('800000000000000001', 'dm hit', 'x.pdf')], total_results: 1, threads: [] },
      }).as('dmSearch');
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, { statusCode: 200, body: { messages: [], total_results: 0, threads: [] } }).as('guildSearch');

      openFilters();
      addExtensions(() => cy.get('[role="dialog"]'), 'pdf');
      applySearch();
      cy.wait('@dmSearch').its('request.url').should('include', 'attachment_extension=pdf');
      cy.wait(300);
      cy.get('@guildSearch.all').should('have.length', 0);
    });
  });

  describe('bulk export', () => {
    it('attachment-only filter routes through search (not the list endpoint) with the params', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      const listUrls: string[] = [];
      const searchUrls: string[] = [];
      cy.intercept('GET', `${API}/channels/*/messages**`, (req) => {
        if (req.url.includes('/messages/search')) {
          searchUrls.push(req.url);
          req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
        } else {
          listUrls.push(req.url);
          req.reply({ statusCode: 200, body: [] });
        }
      });
      cy.intercept('GET', `${API}/guilds/*/messages/search**`, (req) => {
        searchUrls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
      }).as('guildSearch');

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      addExtensions(() => cy.get('[role="dialog"]').last(), 'png');
      cy.get('[role="dialog"]').last().find('[data-testid="attachment-filename-input-search"]').type('shot.png');
      applySearch();
      cy.get('[role="dialog"]').contains('button', /Export/).click();

      cy.wait('@guildSearch', { timeout: 20000 });
      cy.then(() => {
        expect(listUrls, 'list endpoint not used').to.have.length(0);
        expect(searchUrls.some((u) => u.includes('attachment_extension=png') && u.includes('attachment_filename=shot.png')),
          `expected params in a search URL, saw: ${searchUrls.join(' | ')}`).to.be.true;
      });
    });
  });

  describe('bulk purge', () => {
    it('Messages mode carries attachment params on the purge search', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      cy.fixture('active-guild-threads.json').then((threads) => {
        cy.intercept('GET', `${API}/guilds/*/threads/active`, { statusCode: 200, body: threads });
      });
      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, { statusCode: 200, body: { threads: [], has_more: false } });
      cy.intercept('GET', `${API}/channels/*/users/@me/threads/archived/private*`, { statusCode: 200, body: { threads: [], has_more: false } });
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: { id: '111222333444555666', username: 'discrub_tester', discriminator: '0', avatar: 'abc123avatar', global_name: 'Discrub Tester' },
      }).as('lookupUser');
      const searchUrls: string[] = [];
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchUrls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
      }).as('purgeSearch');
      cy.intercept('DELETE', `${API}/channels/*/messages/*`, { statusCode: 204, body: {} });

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Purge selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().find('input[placeholder="Type to search or paste a User ID"]').first().clear().type('111222333444555666');
      cy.get('[role="listbox"]').contains(/Look up/).click();
      cy.get('body').type('{esc}');
      addExtensions(() => cy.get('[role="dialog"]').last(), 'png');
      applySearch();
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').contains('button', /Purge/).click({ force: true });
      cy.get('[role="dialog"]').should('not.exist');

      cy.wait('@purgeSearch', { timeout: 20000 });
      cy.then(() => {
        expect(searchUrls.length).to.be.gte(1);
        searchUrls.forEach((u) => {
          expect(u).to.include('attachment_extension=png');
          expect(u).to.include('author_id=111222333444555666');
        });
      });
    });
  });

  describe('package mode', () => {
    it('refines by extension locally and never calls search', () => {
      cy.login();
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      cy.intercept('GET', `${API}/**/messages/search*`, { statusCode: 200, body: { messages: [], total_results: 0, threads: [] } }).as('anySearch');

      cy.get('[data-testid="package-refine-button"]').click();
      cy.get('[role="dialog"]').find('[data-testid="attachment-extension-input-refine"]').type('png{enter}');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains(/Apply filters|Search/).click();
      cy.get('[role="dialog"]').should('not.exist');

      cy.contains('attached file').should('be.visible');
      cy.contains('hello world').should('not.exist');
      cy.contains(/^1 of 4 messages match$/).should("be.visible");
      cy.contains('file type: png').should('be.visible');
      cy.wait(300);
      cy.get('@anySearch.all').should('have.length', 0);

      // Filename substring on the refine side.
      cy.get('[data-testid="package-refine-button"]').click();
      cy.get('[role="dialog"]').find('[data-testid="attachment-filename-input-refine"]').type('PHOTO');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains(/Apply filters|Search/).click();
      cy.contains('attached file').should('be.visible');
      cy.get('[data-testid="package-refine-button"]').click();
      cy.get('[role="dialog"]').find('[data-testid="attachment-filename-input-refine"]').clear().type('nomatch');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains(/Apply filters|Search/).click();
      cy.contains('attached file').should('not.exist');
      cy.get('@anySearch.all').should('have.length', 0);
    });
  });
});
