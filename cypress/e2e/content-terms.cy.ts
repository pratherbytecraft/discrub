/**
 * Multi-term (OR) content filtering, #244. Discord's search takes ONE
 * `content` param per request, so a search with several terms runs one
 * cap-shifted search per term and merges the results (deduped by id).
 * Refine legs match any term locally. These cases pin the wire shape on
 * every flow that builds SearchCriteria: search, Load All, chips, DM
 * search, bulk export, bulk purge, and package refine.
 */
const API = '**/api/v10';

const msg = (id: string, content: string) => ({
  id,
  channel_id: '801000000000000001',
  author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
  content,
  timestamp: `2026-02-01T12:00:${id.slice(-2)}.000Z`,
  edited_timestamp: null,
  tts: false,
  mention_everyone: false,
  mentions: [],
  attachments: [],
  embeds: [],
  reactions: [],
  pinned: false,
  type: 0,
});

const contentParams = (url: string) => new URL(url).searchParams.getAll('content');

/** Serve one data page per term (keyed by the single `content` param), then empties. */
const searchByTerm = (pages: Record<string, ReturnType<typeof msg>[]>, urls: string[], alias: string, pattern = `${API}/guilds/*/messages/search*`) => {
  const served = new Set<string>();
  cy.intercept('GET', pattern, (req) => {
    urls.push(req.url);
    const [term] = contentParams(req.url);
    const first = !served.has(term);
    served.add(term);
    const hits = first ? (pages[term] ?? []) : [];
    req.reply({ statusCode: 200, body: { messages: hits.map((m) => [m]), total_results: (pages[term] ?? []).length, threads: [] } });
  }).as(alias);
};

const disableReactionEnrichment = () => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...store.getState().app.settings, reactionsEnabled: 'false' } });
  });
};

const openFilters = () => {
  cy.contains('button', 'Filters').click();
  cy.get('[role="dialog"]').should('be.visible');
};

/** Type terms into the search section's content box; a comma commits each. */
const addTerms = (scope: () => Cypress.Chainable, ...terms: string[]) => {
  scope().find('[data-testid="content-filter-search-input"]').type(terms.map((t) => `${t},`).join(''));
};

const applySearch = () => {
  cy.get('[role="dialog"]').last().find('button[class*="contained"]').contains(/Search|Apply filters/).click();
};

const expectOneTermPerRequest = (urls: string[], ...terms: string[]) => {
  expect(urls.length, 'at least one request per term').to.be.gte(terms.length);
  urls.forEach((u) => expect(contentParams(u), `single content param in ${u}`).to.have.length(1));
  terms.forEach((t) => expect(urls.some((u) => contentParams(u)[0] === t), `a request for "${t}"`).to.be.true);
};

describe('Content terms — any-of across search, refine, export, purge (#244)', () => {
  describe('guild search', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      disableReactionEnrichment();
    });

    it('runs one search per term, merges and dedupes the hits, and shows a chip per term', () => {
      const urls: string[] = [];
      searchByTerm({
        alpha: [msg('800000000000000001', 'alpha only'), msg('800000000000000002', 'alpha and beta')],
        beta: [msg('800000000000000002', 'alpha and beta'), msg('800000000000000003', 'beta only')],
      }, urls, 'search');

      openFilters();
      addTerms(() => cy.get('[role="dialog"]'), 'alpha', 'beta');
      cy.get('[role="dialog"]').contains(/Any of 2 terms/).should('be.visible');
      applySearch();
      cy.wait('@search');

      cy.contains('[data-testid="message-feed-row"]', 'alpha only').should('exist');
      cy.contains('[data-testid="message-feed-row"]', 'beta only').should('exist');
      cy.get('[data-testid="message-feed-row"]').should('have.length', 3);
      cy.contains('content: alpha').should('be.visible');
      cy.contains('content: beta').should('be.visible');
      cy.then(() => expectOneTermPerRequest(urls, 'alpha', 'beta'));

      // Drop beta: a fresh single-term search for alpha only.
      cy.then(() => { urls.length = 0; });
      cy.contains('.MuiChip-root', 'content: beta').find('.MuiChip-deleteIcon').click();
      cy.wait('@search');
      cy.contains('content: beta').should('not.exist');
      cy.then(() => {
        expect(urls.length).to.be.gte(1);
        urls.forEach((u) => expect(contentParams(u)).to.deep.equal(['alpha']));
      });
    });

    it('Enter still searches with the single term just typed', () => {
      const urls: string[] = [];
      searchByTerm({ solo: [msg('800000000000000005', 'solo hit')] }, urls, 'search');
      openFilters();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-search-input"]').type('solo{enter}');
      cy.wait('@search');
      cy.contains('[data-testid="message-feed-row"]', 'solo hit').should('exist');
      cy.then(() => expectOneTermPerRequest(urls, 'solo'));
    });
  });

  describe('DM search', () => {
    it('iterates terms on the channel-level endpoint', () => {
      cy.login();
      cy.selectDm('alice_dev');
      const urls: string[] = [];
      searchByTerm({ one: [msg('800000000000000011', 'one')], two: [msg('800000000000000012', 'two')] }, urls, 'dmSearch', `${API}/channels/*/messages/search*`);
      openFilters();
      addTerms(() => cy.get('[role="dialog"]'), 'one', 'two');
      applySearch();
      cy.wait('@dmSearch');
      cy.contains('[data-testid="message-feed-row"]', 'two').should('exist');
      cy.then(() => expectOneTermPerRequest(urls, 'one', 'two'));
    });
  });

  describe('bulk export', () => {
    it('searches every term on the export leg', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      const urls: string[] = [];
      cy.intercept('GET', `${API}/channels/*/messages**`, (req) => {
        if (req.url.includes('/messages/search')) urls.push(req.url);
        req.reply({ statusCode: 200, body: req.url.includes('/messages/search') ? { messages: [], total_results: 0, threads: [] } : [] });
      });
      searchByTerm({}, urls, 'guildSearch');

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      addTerms(() => cy.get('[role="dialog"]').last(), 'foo', 'bar');
      applySearch();
      cy.get('[role="dialog"]').contains('button', /Export/).click();

      // The iterator paces between terms with the configured search delay,
      // so wait for a request per term rather than a fixed pause.
      cy.wait('@guildSearch', { timeout: 20000 });
      cy.wait('@guildSearch', { timeout: 20000 });
      cy.then(() => expectOneTermPerRequest(urls, 'foo', 'bar'));
    });
  });

  describe('bulk purge', () => {
    it('Messages mode searches every term', () => {
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
      });
      const urls: string[] = [];
      searchByTerm({}, urls, 'purgeSearch');
      cy.intercept('DELETE', `${API}/channels/*/messages/*`, { statusCode: 204, body: {} });

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Purge selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().find('input[placeholder="Type to search or paste a User ID"]').first().clear().type('111222333444555666');
      cy.get('[role="listbox"]').contains(/Look up/).click();
      cy.get('body').type('{esc}');
      addTerms(() => cy.get('[role="dialog"]').last(), 'spam', 'ads');
      applySearch();
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').contains('button', /Purge/).click({ force: true });
      cy.get('[role="dialog"]').should('not.exist');

      cy.wait('@purgeSearch', { timeout: 20000 });
      cy.wait('@purgeSearch', { timeout: 20000 });
      cy.then(() => {
        expectOneTermPerRequest(urls, 'spam', 'ads');
        urls.forEach((u) => expect(u).to.include('author_id=111222333444555666'));
      });
    });
  });

  describe('package mode', () => {
    it('refines by any term locally and never calls search', () => {
      cy.login();
      cy.uploadPackage();
      cy.contains('general').click();
      cy.contains('hello world').should('be.visible');
      cy.intercept('GET', `${API}/**/messages/search*`, { statusCode: 200, body: { messages: [], total_results: 0, threads: [] } }).as('anySearch');

      cy.get('[data-testid="package-refine-button"]').click();
      addTerms(() => cy.get('[role="dialog"]'), 'hello', 'attached');
      applySearch();
      cy.get('[role="dialog"]').should('not.exist');

      cy.contains('hello world').should('be.visible');
      cy.contains('attached file').should('be.visible');
      cy.contains(/^2 of 4 messages match$/).should('be.visible');
      cy.contains('content: hello').should('be.visible');
      cy.contains('content: attached').should('be.visible');
      cy.wait(300);
      cy.get('@anySearch.all').should('have.length', 0);
    });
  });
});
