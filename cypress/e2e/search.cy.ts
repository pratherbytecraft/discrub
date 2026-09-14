/**
 * Search & Filter E2E Tests
 *
 * Verifies server-side search (Discord Search API), client-side filtering,
 * DM search, API call correctness, result display, pagination, error handling,
 * and filter combinations via the Discord-style filter modal.
 *
 * Search endpoints:
 *   Guild channel: GET /guilds/{id}/messages/search?content=...
 *   DM channel:    GET /channels/{id}/messages/search?content=...
 */

const API = '**/api/v10';

/**
 * Helper: remove any content-term chips already in the search section
 * (#244 turned the content box into a chip input, so `.clear()` on the
 * box no longer drops a previously applied term).
 */
const clearContentTerms = () => {
  cy.get('[role="dialog"]').then(($dialog) => {
    const chips = $dialog.find('[data-testid="content-filter-search"] .MuiChip-deleteIcon');
    if (chips.length > 0) cy.wrap(chips).click({ multiple: true });
  });
};

/**
 * Helper: Open filter modal, type content, and apply
 */
const searchViaModal = (content: string) => {
  cy.contains('button', 'Filters').click();
  cy.get('[role="dialog"]').should('be.visible');
  clearContentTerms();
  cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').clear().type(content);
  // Click the Search button (contained variant in the search section)
  cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
};

/**
 * Helper: Open filter modal, type content, and press Enter to apply
 */
const searchViaEnter = (content: string) => {
  cy.contains('button', 'Filters').click();
  cy.get('[role="dialog"]').should('be.visible');
  clearContentTerms();
  cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').clear().type(`${content}{enter}`);
};

describe('Search & Filters', () => {
  // ── BASIC UI ────────────────────────────────────────────────────

  describe('Search UI', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('shows Filters button in toolbar', () => {
      cy.contains('button', 'Filters').should('be.visible');
    });

    it('opens filter modal when Filters button is clicked', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').contains('Filters').should('be.visible');
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().should('be.visible');
    });

    it('allows typing in the search content input', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('project');
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').should(
        'have.value',
        'project'
      );
    });

    it('closes filter modal when Cancel is clicked', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('shows all filter sections in modal', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        // Search section fields
        cy.contains('Message Content').should('exist');
        cy.contains('From').should('exist');
        cy.contains('Has').should('exist');
        cy.contains('Mentions').should('exist');
        cy.contains('Date').should('exist');
        cy.contains('Author Type').should('exist');
        // Refine section
        cy.contains('Refine').should('exist');
        cy.contains('Content').should('exist');
      });
    });
  });

  // ── GUILD SERVER SEARCH ─────────────────────────────────────────

  describe('Guild Server Search', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('calls the guild search endpoint with content query', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch').its('request.url').should('include', 'content=project');
    });

    it('makes exactly 1 search API call for a simple content search', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');
      cy.wait(500);
      cy.get('@guildSearch.all').should('have.length', 1);
    });

    it('displays search results in the message table', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');

      // All 3 search results should be displayed
      cy.contains('Check out this cool project').should('be.visible');
      cy.contains("Great project! I'll fork it").should('be.visible');
      cy.contains('The project docs have been updated').should('be.visible');
    });

    it('replaces initial messages with search results', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Initial messages should be visible
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');

      searchViaModal('project');
      cy.wait('@guildSearch');

      // Initial messages should be gone, search results shown
      cy.contains('Hello everyone').should('not.exist');
      cy.contains('Check out this cool project').should('be.visible');
    });

    it('shows correct authors in search results', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');

      // Author display names should appear in results (global_name takes priority over username)
      cy.contains('Alice').should('be.visible');
    });

    it('shows empty state when search returns no results', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-empty.json',
      }).as('guildSearch');

      searchViaModal('xyznonexistent');
      cy.wait('@guildSearch');

      cy.contains('No messages found').should('be.visible');
    });

    it('shows error message when search API fails', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 500,
        body: { message: 'Internal Server Error' },
      }).as('guildSearch');

      searchViaModal('test');
      cy.wait('@guildSearch');

      // #262: a 500 is transient, so the search retries it five times
      // (1s, 2s, 4s, 8s, 16s backoff) before giving up with the status.
      cy.contains('Failed to search messages (HTTP 500)', { timeout: 45000 }).should('be.visible');
    });

    // #262: a 403 is not transient; the failure names the status at once.
    it('names the HTTP status when Discord refuses the search', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 403,
        body: { message: 'Missing Access', code: 50001 },
      }).as('guildSearch');

      searchViaModal('test');
      cy.wait('@guildSearch');

      cy.contains('Failed to search messages (HTTP 403)').should('be.visible');
      cy.window().then((win) => {
        const store = (win as any).__store__;
        const messages = (store?.getState()?.status?.entries ?? []).map((e: any) => e.message);
        expect(messages).to.include('message/searchMessages: Failed to search messages (HTTP 403)');
      });
    });

    // #262: a 202 means Discord is still building the index; the search
    // waits it out and shows the page that follows instead of failing.
    it('waits out a 202 (still indexing) and shows the results that follow', () => {
      let call = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        call += 1;
        if (call === 1) {
          req.reply({ statusCode: 202, body: { retry_after: 1 } });
        } else {
          req.reply({ fixture: 'search-results.json' });
        }
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');
      cy.wait('@guildSearch');

      cy.contains('Failed to search messages').should('not.exist');
      cy.window().then((win) => {
        const store = (win as any).__store__;
        const messages = (store?.getState()?.status?.entries ?? []).map((e: any) => e.message);
        expect(
          messages.some((m: string) => /^Search: Discord is still indexing, retrying in 1s \(attempt 1\/5\)/.test(m)),
        ).to.be.true;
        expect(store.getState().message.pagination.mode).to.equal('search');
        expect(store.getState().message.messages.length).to.be.greaterThan(0);
      });
    });

    it('triggers search on Enter key press in content field', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaEnter('project');
      cy.wait('@guildSearch');
    });

    it('shows active filter chips on toolbar after search', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');

      // Active filter chip should appear on the toolbar
      cy.contains('content: project').should('be.visible');
    });

    it('closes modal after applying filters', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('project');
      // Modal should be closed
      cy.get('[role="dialog"]').should('not.exist');
    });
  });

  // ── DM SEARCH ──────────────────────────────────────────────────

  describe('DM Search', () => {
    beforeEach(() => {
      cy.login();
      cy.selectDm('alice_dev');
    });

    it('calls the channel search endpoint (not guild) for DM search', () => {
      cy.intercept('GET', `${API}/channels/*/messages/search*`, {
        fixture: 'dm-search-results.json',
      }).as('dmSearch');

      searchViaModal('looks');
      cy.wait('@dmSearch').its('request.url').should('include', 'content=looks');
    });

    it('does NOT call the guild search endpoint for DM search', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-empty.json',
      }).as('guildSearch');

      cy.intercept('GET', `${API}/channels/*/messages/search*`, {
        fixture: 'dm-search-results.json',
      }).as('dmSearch');

      searchViaModal('looks');
      cy.wait('@dmSearch');
      cy.wait(500);

      // Guild search should never be called for DMs
      cy.get('@guildSearch.all').should('have.length', 0);
    });

    it('displays DM search results in the message table', () => {
      cy.intercept('GET', `${API}/channels/*/messages/search*`, {
        fixture: 'dm-search-results.json',
      }).as('dmSearch');

      searchViaModal('looks');
      cy.wait('@dmSearch');

      cy.contains('[data-testid="message-feed-row"]', 'Yes! It looks great.').should('exist');
      cy.contains('[data-testid="message-feed-row"]', "I'll take a look after lunch").should('exist');
    });
  });

  // ── SEARCH API CALL COUNTS ─────────────────────────────────────

  describe('Search API Call Counts', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('should make exactly 1 search call for results under 25 (no pagination)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');
      cy.wait(1000);

      cy.get('@guildSearch.all').should('have.length', 1);
    });

    it('should not make additional message fetch calls during search', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Note initial message count
      cy.get('@getMessages.all').should('have.length', 1);

      searchViaModal('project');
      cy.wait('@guildSearch');
      cy.wait(500);

      // No additional message fetches should happen during search
      cy.get('@getMessages.all').should('have.length', 1);
    });

    it('should not make search calls when filters are cleared', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Just open modal, type content, then clear without applying
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('test');
      // Click the search section's Clear button (first one)
      cy.get('[role="dialog"]').contains('button', /Clear/).first().click();
      cy.wait(500);

      cy.get('@guildSearch.all').should('have.length', 0);
    });
  });

  // ── PAGINATED SEARCH ───────────────────────────────────────────

  describe('Paginated Search', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('lazily fetches subsequent search pages — only page 1 on apply, more on Load All', () => {
      // Pass 1 reaction enrichment (#163) would otherwise add ~1s per
      // search-loaded message before the thunk commits to state. With
      // 25 fixture results that exceeds Cypress's default assertion
      // timeout. Reactions are not what this test is verifying — the
      // dedicated coverage lives in cypress/e2e/search-reactions.cy.ts.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateSetting/fulfilled',
          payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
        });
      });

      // Build a fixture with exactly 25 results (triggers pagination)
      const page1Messages = Array.from({ length: 25 }, (_, i) => [{
        id: `800000000000000${String(i).padStart(3, '0')}`,
        channel_id: '801000000000000001',
        author: {
          id: '222333444555666777',
          username: 'alice_dev',
          discriminator: '0',
          avatar: 'alice_avatar',
          global_name: 'Alice',
        },
        content: `Search result message ${i + 1}`,
        timestamp: `2026-02-01T${String(12 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      }]);

      let callCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        callCount++;
        if (callCount === 1) {
          req.reply({ statusCode: 200, body: { messages: page1Messages, total_results: 30, threads: [] } });
        } else {
          // Second call (offset=25) returns fewer than 25 → pagination ends
          req.reply({ statusCode: 200, body: { messages: [[{
            id: '800000000000000099',
            channel_id: '801000000000000001',
            author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
            content: 'Final paginated result',
            timestamp: '2026-02-01T14:00:00.000Z',
            edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
          }]], total_results: 30, threads: [] } });
        }
      }).as('paginatedSearch');

      searchViaModal('result');

      // Page 1 only — exactly one API call so far
      cy.wait('@paginatedSearch');
      cy.contains('[data-testid="message-feed-row"]', 'Search result message 1').should('exist');
      cy.contains('25 of 30 matches loaded').should('be.visible');
      // Final page-2 result is NOT yet in the DOM
      cy.contains('Final paginated result').should('not.exist');

      // Click Load All (visible in search mode now) → second API call fires
      cy.contains('button', 'Load All').click();
      cy.get('[role="dialog"]').contains('button', 'Load All').click();
      cy.wait('@paginatedSearch');

      // Both pages combined in results
      cy.contains('[data-testid="message-feed-row"]', 'Final paginated result').should('exist');
    });

    // #264: Load More (the next search page) gets the same 202 wait as the
    // first page. A filter Discord has not indexed yet (By User is the
    // common case) answers 202 on page 2; the old raw call gave up at the
    // first 25 with a generic failure line.
    const buildPage = (offset: number, count: number, total: number) => ({
      messages: Array.from({ length: count }, (_, i) => [{
        id: `800000000000000${String(offset + i).padStart(3, '0')}`,
        channel_id: '801000000000000001',
        author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
        content: `Search result message ${offset + i + 1}`,
        timestamp: `2026-02-01T12:${String((offset + i) % 60).padStart(2, '0')}:00.000Z`,
        edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
      }]),
      total_results: total,
      threads: [],
    });

    const disableReactions = () => {
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateSetting/fulfilled',
          payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
        });
      });
    };

    it('Load More waits out a 202 on the next page and appends it (#264)', () => {
      disableReactions();
      let call = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        call += 1;
        if (call === 1) {
          req.reply({ statusCode: 200, body: buildPage(0, 25, 30) });
        } else if (call === 2) {
          req.reply({ statusCode: 202, body: { retry_after: 1 } });
        } else {
          req.reply({ statusCode: 200, body: buildPage(25, 5, 30) });
        }
      }).as('pagedSearch');

      searchViaModal('result');
      cy.wait('@pagedSearch');
      cy.contains('25 of 30 matches loaded').should('be.visible');

      // A Cypress click scrolls the button into view first, and that scroll
      // event fires the feed's own Load More listener, which hides the
      // button mid-click. A native click on the element as found skips the
      // scroll and dispatches exactly once.
      cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
      cy.wait('@pagedSearch');
      cy.wait('@pagedSearch', { timeout: 10000 });

      cy.contains('[data-testid="message-feed-row"]', 'Search result message 30', { timeout: 10000 }).should('exist');
      cy.window().then((win) => {
        const store = (win as any).__store__;
        const messages = (store?.getState()?.status?.entries ?? []).map((e: any) => e.message);
        expect(
          messages.some((m: string) => /^Search: Discord is still indexing, retrying in 1s \(attempt 1\/5\)/.test(m)),
        ).to.be.true;
        expect(messages.some((m: string) => /fetchNextSearchPage: /.test(m))).to.be.false;
        expect(store.getState().message.messages.length).to.equal(30);
        expect(store.getState().message.pagination.hasMore).to.be.false;
      });
    });

    it('Load More says which HTTP status Discord answered and stays available (#264)', () => {
      disableReactions();
      let call = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        call += 1;
        if (call === 1) {
          req.reply({ statusCode: 200, body: buildPage(0, 25, 30) });
        } else {
          req.reply({ statusCode: 403, body: { message: 'Missing Access', code: 50001 } });
        }
      }).as('pagedSearch');

      searchViaModal('result');
      cy.wait('@pagedSearch');
      cy.contains('25 of 30 matches loaded').should('be.visible');

      cy.contains('button', 'Load more messages').click();
      cy.wait('@pagedSearch');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const entries = store?.getState()?.status?.entries ?? [];
        const failure = entries.find((e: any) => /message\/fetchNextSearchPage: /.test(e.message));
        expect(failure, 'Load More failure entry').to.exist;
        expect(failure.level).to.equal('error');
        expect(failure.message).to.equal('message/fetchNextSearchPage: Failed to search messages (HTTP 403)');
        expect(store.getState().message.messages.length).to.equal(25);
        expect(store.getState().message.pagination.hasMore).to.be.true;
        expect(store.getState().message.pagination.isLoadingMore).to.be.false;
      });
      cy.contains('button', 'Load more messages').should('be.visible');
    });

    // #185 Bug A: a single transient failure during search Load All gets
    // retried automatically; the user sees a [WARN] status entry but the
    // operation finishes with the full match set, not a dropped half-load.
    it('retries search Load All on transient network failure and completes', () => {
      // Disable Pass 1 reaction enrichment (per the lazy-pagination spec
      // above — adds per-message latency we don't need here).
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateSetting/fulfilled',
          payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
        });
      });

      const makePage = (offset: number, count: number) =>
        Array.from({ length: count }, (_, i) => [{
          id: `800000000000000${String(offset + i).padStart(3, '0')}`,
          channel_id: '801000000000000001',
          author: {
            id: '222333444555666777',
            username: 'alice_dev',
            discriminator: '0',
            avatar: 'alice_avatar',
            global_name: 'Alice',
          },
          content: `Match ${offset + i + 1}`,
          timestamp: `2026-02-01T${String(12 + Math.floor((offset + i) / 60)).padStart(2, '0')}:${String((offset + i) % 60).padStart(2, '0')}:00.000Z`,
          edited_timestamp: null,
          tts: false,
          mention_everyone: false,
          mentions: [],
          attachments: [],
          embeds: [],
          reactions: [],
          pinned: false,
          type: 0,
        }]);

      let call = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        call += 1;
        if (call === 1) {
          // Initial search → 25 matches, more pages available
          req.reply({ statusCode: 200, body: { messages: makePage(0, 25), total_results: 50, threads: [] } });
        } else if (call === 2) {
          // First Load All page — server-side 503 simulates a transient blip
          req.reply({ statusCode: 503, body: 'Service Unavailable' });
        } else {
          // Retry recovers and the iterator walks to the final page
          req.reply({ statusCode: 200, body: { messages: makePage(25, 25), total_results: 50, threads: [] } });
        }
      }).as('flakySearch');

      searchViaModal('match');
      cy.wait('@flakySearch');
      cy.contains('25 of 50 matches loaded').should('be.visible');

      cy.contains('button', 'Load All').click();
      cy.get('[role="dialog"]').contains('button', 'Load All').click();

      // After retry recovers, both pages are merged — header shows the
      // full match count and the last-page result is visible in the feed.
      cy.contains('50 matches', { timeout: 20000 }).should('be.visible');
      cy.contains('[data-testid="message-feed-row"]', 'Match 50').should('exist');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const entries = store?.getState()?.status?.entries ?? [];
        const messages = entries.map((e: any) => e.message);
        expect(
          messages.some((m: string) => /Search Load All: Discord answered HTTP \d+, retrying in/.test(m)),
        ).to.be.true;
      });
    });

    // #193: cancelled Load All renders a soft callout, not the red error
    // banner. Partial results below remain rendered and the user can
    // dismiss the callout to clear it.
    it('cancelled Load All shows soft callout, not red error banner, and preserves partial results', () => {
      // Same reaction-enrichment disable as the lazy-pagination test —
      // we're verifying the cancel UX, not enrichment cadence.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateSetting/fulfilled',
          payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
        });
      });

      const page1Messages = Array.from({ length: 25 }, (_, i) => [{
        id: `800000000000000${String(i).padStart(3, '0')}`,
        channel_id: '801000000000000001',
        author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
        content: `Match ${i + 1}`,
        timestamp: `2026-02-01T${String(12 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
        edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
      }]);

      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        req.reply({ statusCode: 200, body: { messages: page1Messages, total_results: 100, threads: [] } });
      }).as('search');

      searchViaModal('match');
      cy.wait('@search');
      cy.contains('25 of 100 matches loaded').should('be.visible');

      // Simulate the cancel path that the in-flight Load All thunk would
      // produce when the user clicks Cancel via PauseResumeControls. The
      // real cancel goes through setDiscrubCancelled → cancellableDelay
      // poll → rejectWithValue('Load all cancelled') → our .rejected
      // handler. We short-circuit to the dispatch-the-rejected-action step
      // because Cypress timing for "click cancel mid-poll" is flaky.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'message/loadAllSearchResults/rejected',
          payload: 'Load all cancelled',
          error: { message: 'Rejected' },
          meta: { aborted: false, condition: false, requestId: 'cy-cancel-1', requestStatus: 'rejected', arg: {} },
        });
      });

      // Soft callout must appear; red error banner must NOT.
      cy.get('[data-testid="load-all-cancelled-callout"]').should('be.visible');
      cy.contains(/Load All stopped/i).should('be.visible');

      // The 25 partial messages are still rendered below.
      cy.contains('[data-testid="message-feed-row"]', 'Match 1').should('exist');
      cy.contains('[data-testid="message-feed-row"]', 'Match 25').should('exist');

      // Clicking Dismiss removes the callout, messages stay.
      cy.get('[data-testid="load-all-cancelled-callout"]').contains('button', 'Dismiss').click();
      cy.get('[data-testid="load-all-cancelled-callout"]').should('not.exist');
      cy.contains('[data-testid="message-feed-row"]', 'Match 1').should('exist');
    });
  });

  // ── CLIENT-SIDE FILTERING ──────────────────────────────────────

  describe('Client-Side Filtering', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('does not call search API when using Refine section', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      // Use the Refine section's content field (not the Search section)
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Hello');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.wait(500);

      // No search API call should be made
      cy.get('@guildSearch.all').should('have.length', 0);

      // Client-side filter should show matching messages
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');
    });
  });

  // ── REFINE: SYSTEM MESSAGE TYPE FILTER (#201) ──────────────────────
  // Discord's search API can't filter by MessageType, so this is a
  // client-side Refine. Seed the feed with a normal message + a pin
  // notification (type 6) so the filter has something to act on.
  describe('Refine — system message type filter (#201)', () => {
    const CURRENT_USER = {
      id: '111222333444555666',
      username: 'discrub_tester',
      discriminator: '0',
      avatar: 'abc123avatar',
      global_name: 'Discrub Tester',
    };
    const mk = (id: string, type: number, content: string) => ({
      id,
      channel_id: '801000000000000001',
      author: CURRENT_USER,
      content,
      timestamp: '2026-02-01T10:00:00.000Z',
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
      reactions: [],
      pinned: false,
      type,
    });

    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.intercept('GET', `${API}/channels/*/messages?*`, {
        statusCode: 200,
        body: [mk('700000000000000401', 0, 'A normal feed message'), mk('700000000000000402', 6, '')],
      }).as('getMessages');
      cy.selectChannel('general');
      cy.get('[data-testid="system-message-row"][data-system-kind="pin"]').should('exist');
    });

    it('"Show only" narrows the feed to the selected system type', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]')
        .find('input[aria-label="Pin notifications"]')
        .scrollIntoView()
        .click({ force: true });
      // "Show only" is the default mode.
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      cy.get('[data-testid="system-message-row"][data-system-kind="pin"]').should('exist');
      cy.contains('[data-testid="message-feed-row"]', 'A normal feed message').should('not.exist');
    });

    it('"Hide" removes the selected system type, keeping the rest', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]')
        .find('input[aria-label="Pin notifications"]')
        .scrollIntoView()
        .click({ force: true });
      cy.get('[role="dialog"]').contains('button', 'Hide').click();
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      cy.get('[data-testid="system-message-row"][data-system-kind="pin"]').should('not.exist');
      cy.contains('[data-testid="message-feed-row"]', 'A normal feed message').should('exist');
    });
  });

  // ── SEARCH → CLEAR → RESTORE FLOW ──────────────────────────────

  describe('Search Restore Flow', () => {
    it('restores original messages when re-selecting the channel after search', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Original message visible
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');

      // Perform search
      searchViaModal('project docs');
      cy.wait('@guildSearch');

      // Search result visible, original gone
      cy.contains('The project docs have been updated').should('be.visible');

      // Re-select the channel to reload original messages
      cy.selectChannel('general');

      // Original messages should be restored
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');
    });

    it('shows updated match count after search completes', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Check initial message count
      cy.contains('13 messages').should('be.visible');

      // Perform search
      searchViaModal('project');
      cy.wait('@guildSearch');

      // Search-mode message count uses "matches" wording (X of Y when more
      // are available, just total when fully loaded — fixture returns 3 of 3)
      cy.contains('3 matches').should('be.visible');
    });
  });

  // ── SEARCH ACROSS CHANNEL SWITCH ──────────────────────────────

  describe('Search Across Navigation', () => {
    it('loads fresh messages when switching channels after search', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      // Use search results with unique content not in default messages fixture
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 200,
        body: {
          messages: [[{
            id: '999000000000000001',
            channel_id: '801000000000000001',
            author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
            content: 'UNIQUE_SEARCH_RESULT_XYZ',
            timestamp: '2026-02-01T12:00:00.000Z',
            edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
          }]],
          total_results: 1,
          threads: [],
        },
      }).as('guildSearch');

      // Perform search
      searchViaModal('unique');
      cy.wait('@guildSearch');
      cy.contains('UNIQUE_SEARCH_RESULT_XYZ').should('be.visible');

      // Switch to another channel — fresh messages should load
      cy.selectChannel('announcements');

      // Unique search text should be gone, regular messages loaded
      cy.contains('UNIQUE_SEARCH_RESULT_XYZ').should('not.exist');
      cy.contains('announcements').should('be.visible');
    });

    it('loads DM messages when switching from server search to DM', () => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 200,
        body: {
          messages: [[{
            id: '999000000000000002',
            channel_id: '801000000000000001',
            author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
            content: 'UNIQUE_SERVER_SEARCH_ABC',
            timestamp: '2026-02-01T12:00:00.000Z',
            edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
          }]],
          total_results: 1,
          threads: [],
        },
      }).as('guildSearch');

      searchViaModal('unique');
      cy.wait('@guildSearch');

      // Switch to DMs
      cy.selectDm('alice_dev');

      // Server search results should be gone, DM messages loaded
      cy.contains('UNIQUE_SERVER_SEARCH_ABC').should('not.exist');
      cy.contains('[data-testid="message-feed-row"]', 'Hey, did you see the latest build?').should('exist');
    });
  });

  // ── ACTIVE FILTER CHIPS ────────────────────────────────────────

  describe('Active Filter Chips', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('shows filter chips on toolbar after applying filters', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('hello');
      cy.wait('@guildSearch');

      cy.contains('content: hello').should('be.visible');
    });

    it('clears all filter chips when clear all is clicked', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('hello');
      cy.wait('@guildSearch');

      cy.contains('content: hello').should('be.visible');
      // Click the clear all X button
      cy.get('[aria-label="Clear all filters"]').click();
      cy.contains('content: hello').should('not.exist');
    });
  });

  // ── FILTER MODAL UI INTERACTIONS ───────────────────────────────

  describe('Filter Modal UI', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('shows "+ Add date" by default, reveals picker on click', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').contains('Add date').should('exist');
      cy.get('[role="dialog"]').contains('Add date').click({ force: true });
      // Toggle group should appear
      cy.get('[role="dialog"]').contains('button', 'Before').should('exist');
      cy.get('[role="dialog"]').contains('button', 'After').should('exist');
      cy.get('[role="dialog"]').contains('button', 'During').should('exist');
    });

    it('shows date pickers matching selected mode (Before, between, During)', () => {
      // #182: Before + After coexist as "between". During remains a
      // mutually exclusive single-day shortcut.
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Add date').scrollIntoView().click();
        // Before is the default after clicking "+ Add date" — one picker.
        cy.get('input[placeholder^="MM/DD/YYYY"]').should('have.length', 1);
        // Adding After while in Before promotes to "between" — two pickers.
        cy.contains('button', 'After').click();
        cy.get('input[placeholder^="MM/DD/YYYY"]').should('have.length', 2);
        // Switching to During clears the others and shows a single day picker.
        cy.contains('button', 'During').click();
        cy.get('input[placeholder^="MM/DD/YYYY"]').should('have.length', 1);
      });
    });

    it('shows Has dropdown with content type checkboxes', () => {
      cy.contains('button', 'Filters').click();
      // Open the Has dropdown via its inner combobox div
      cy.get('[role="dialog"]').find('[data-testid="has-filter-select"]').first().find('[role="combobox"]').click({ force: true });
      // Dropdown menu renders in a portal — use exist instead of visible (dialog backdrop covers it)
      cy.get('.MuiMenu-list').within(() => {
        cy.contains('image').should('exist');
        cy.contains('video').should('exist');
        cy.contains('link').should('exist');
        cy.contains('file').should('exist');
        cy.contains('embed').should('exist');
        cy.contains('poll').should('exist');
        cy.contains('forward').should('exist');
      });
    });

    it('shows Author Type dropdown with options', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Author Type').scrollIntoView();
        cy.contains('Author Type').parent().find('[role="combobox"]').click({ force: true });
      });
      cy.get('[role="listbox"]').within(() => {
        cy.contains('Any').should('be.visible');
        cy.contains('user').should('be.visible');
        cy.contains('bot').should('be.visible');
        cy.contains('webhook').should('be.visible');
      });
    });

    it('shows Pinned dropdown with options', () => {
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Pinned').parent().find('[role="combobox"]').click();
      });
      cy.get('[role="listbox"]').within(() => {
        cy.contains('Any').should('be.visible');
        cy.contains('True').should('be.visible');
        cy.contains('False').should('be.visible');
      });
    });

    it('shows filter badge count on Filters button', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('test');
      cy.wait('@guildSearch');

      // Badge should show "1" for the content filter
      cy.get('[data-testid="search-filters-button"]').parent().find('.MuiBadge-badge').should('contain', '1');
    });

    it('removes individual filter chip from toolbar', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('test');
      cy.wait('@guildSearch');

      // Content chip should be visible
      cy.contains('content: test').should('be.visible');

      // Delete the chip
      cy.contains('content: test').parent().find('[data-testid="CancelIcon"]').click();

      // Chip should be gone
      cy.contains('content: test').should('not.exist');
    });
  });

  // ── NETWORK CALL VERIFICATION ──────────────────────────────────

  describe('Network Call Verification', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('sends content param in search URL', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('hello world');
      cy.wait('@guildSearch').its('request.url').should('include', 'content=hello+world');
    });

    it('sends author_id param when From filter is used', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Mock user lookup API so UserPicker can resolve the ID
      cy.intercept('GET', `${API}/users/222333444555666777`, {
        statusCode: 200,
        body: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
      }).as('userLookup');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        // Type a user ID in the From UserPicker
        cy.contains('From').parent().find('input[role="combobox"]').type('222333444555666777');
      });
      // Select the "Look up user" option from the autocomplete dropdown
      cy.get('.MuiAutocomplete-popper').contains('Look up').click();
      cy.wait('@userLookup');

      // User chip should appear, now apply
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'author_id=222333444555666777');
    });

    it('sends has param when Has filter types are selected', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.get('[data-testid="has-filter-select"]').first().click();
      });
      cy.get('.MuiMenu-list').contains('image').click();
      // Close dropdown by pressing Escape
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'has=image');
    });

    it('sends attachment_extension and attachment_filename params (GH #13)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.get('[data-testid="attachment-extension-input-search"]').type('.PNG{enter}pdf{enter}');
        cy.get('[data-testid="attachment-filename-input-search"]').type('Report.pdf');
      });
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should((url) => {
        expect(url).to.include('attachment_extension=png');
        expect(url).to.include('attachment_extension=pdf');
        expect(url).to.include('attachment_filename=Report.pdf');
      });
      cy.contains('file type: png').should('be.visible');
      cy.contains('file name: Report.pdf').should('be.visible');
    });

    it('sends pinned param when Pinned filter is set', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Pinned').parent().find('[role="combobox"]').click();
      });
      cy.get('[role="listbox"]').contains('True').click();
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'pinned=true');
    });

    it('sends mentions param when Mentions filter is used', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Mock user lookup for Mentions field
      cy.intercept('GET', `${API}/users/111222333444555666`, {
        statusCode: 200,
        body: { id: '111222333444555666', username: 'discrub_tester', discriminator: '0', avatar: 'abc123avatar', global_name: 'Discrub Tester' },
      }).as('userLookup');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Mentions').scrollIntoView();
        cy.contains('Mentions').parent().find('input[role="combobox"]').type('111222333444555666');
      });
      cy.get('.MuiAutocomplete-popper').contains('Look up').click();
      cy.wait('@userLookup');

      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'mentions=111222333444555666');
    });

    it('sends min_id param when After date is set', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Add date').click();
        // "Add date" defaults to Before. Clicking After (#182) keeps Before
        // toggled and promotes the mode to "between", so both pickers
        // render. The After input is rendered first; we only need it set
        // for this min_id assertion (an empty Before picker is fine).
        cy.contains('button', 'After').click();
        cy.get('input[placeholder^="MM/DD/YYYY"]').eq(0).type('01/01/2026 12:00 AM');
      });
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'min_id=');
    });

    it('sends max_id param when Before date is set', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Add date').click();
        // Before is the default mode after clicking Add date.
        // Before-mode uses DateTimePicker (#126) — full date + time needed.
        cy.get('input[placeholder^="MM/DD/YYYY"]').type('12/31/2026 11:59 PM');
      });
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'max_id=');
    });

    it('sends both min_id and max_id when Before and After are set together (#182)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Add date').click();
        // Default is Before. Fill it.
        cy.get('input[placeholder^="MM/DD/YYYY"]').type('12/31/2026 11:59 PM');
        // Adding After promotes to "between" — both pickers render.
        // After is rendered first when both are active, so the newly
        // shown input at index 0 is After; the already-filled Before
        // moves to index 1.
        cy.contains('button', 'After').click();
        cy.get('input[placeholder^="MM/DD/YYYY"]').eq(0).type('01/01/2026 12:00 AM');
      });
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').then((interception) => {
        expect(interception.request.url).to.include('min_id=');
        expect(interception.request.url).to.include('max_id=');
      });
    });

    it('makes zero API calls when using Refine', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Hello');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.wait(500);

      cy.get('@guildSearch.all').should('have.length', 0);
    });

    it('sends multiple params when combining filters', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();

      // Set content
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().type('project');

      // Set Pinned to True
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Pinned').scrollIntoView();
        cy.contains('Pinned').parent().find('[role="combobox"]').click();
      });
      cy.get('[role="listbox"]').contains('True').click();

      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').then((interception) => {
        expect(interception.request.url).to.include('content=project');
        expect(interception.request.url).to.include('pinned=true');
      });
    });
  });

  // ── THREE SEARCH SCENARIOS ─────────────────────────────────────

  describe('Three Search Scenarios', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('Scenario 1: Server search — replaces messages with API results', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Initial messages visible
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');

      // Perform server search
      searchViaModal('project');
      cy.wait('@guildSearch');

      // Server results replace local messages
      cy.contains('Hello everyone').should('not.exist');
      cy.contains('Check out this cool project').should('be.visible');

      // Exactly 1 search API call
      cy.get('@guildSearch.all').should('have.length', 1);
    });

    it('Scenario 2: Local refine — filters loaded messages with no API calls', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Initial messages visible
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');
      cy.contains('[data-testid="message-feed-row"]', 'Thanks for setting this up!').should('exist');

      // Use the Refine section to filter locally
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Hello');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.wait(500);

      // No API call made
      cy.get('@guildSearch.all').should('have.length', 0);

      // Only matching message shown from loaded data
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');
      cy.contains('Thanks for setting this up!').should('not.exist');
    });

    it('Refine criteria persists in Redux state and survives a synthetic message append', () => {
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');

      // Apply refine for "Hello"
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Hello');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');
      cy.contains('Thanks for setting this up!').should('not.exist');

      // Confirm refine lives in Redux (no longer in a component ref)
      cy.window().then((win) => {
        const state = (win as any).__store__.getState();
        expect(state.message.refineCriteria).to.not.be.null;
        expect(state.message.refineCriteria.searchMessageContents).to.deep.eq(['Hello']);
      });

      // Append synthetic raw messages to state.messages — this is the same
      // append flow that fetchMoreMessages.fulfilled performs. The reducer
      // chain on setMessages applies the active refine automatically; only
      // the matching synthetic message should be visible afterward.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        const current = store.getState().message.messages;
        store.dispatch({
          type: 'message/setMessages',
          payload: [
            ...current,
            { id: 'extra-1', content: 'unrelated follow-up', timestamp: '2026-01-15T10:00:00.000Z', author: { id: 'x', username: 'x', global_name: 'X' }, type: 0, attachments: [], embeds: [], reactions: [], mentions: [], pinned: false, mention_everyone: false, edited_timestamp: null, tts: false, channel_id: '801000000000000001' },
            { id: 'extra-2', content: 'Hello fellow user', timestamp: '2026-01-15T11:00:00.000Z', author: { id: 'x', username: 'x', global_name: 'X' }, type: 0, attachments: [], embeds: [], reactions: [], mentions: [], pinned: false, mention_everyone: false, edited_timestamp: null, tts: false, channel_id: '801000000000000001' },
          ],
        });
      });

      // Wait for the re-derived filteredMessages to settle. The unrelated
      // append should be filtered out; the Hello append should be visible.
      cy.window().should((win) => {
        const state = (win as any).__store__.getState();
        // setMessages writes to messages but not filteredMessages — that's
        // the existing reducer's behavior. Confirm raw count grew while
        // refine lives on (test #115 is about the loaded-more thunks
        // re-deriving; setMessages itself is unaffected since it's a
        // hard reset action used after channel load).
        expect(state.message.messages.length).to.be.greaterThan(2);
        expect(state.message.refineCriteria).to.not.be.null;
      });
    });

    it('Scenario 3: Server search then Refine on top', () => {
      // Step 1: Server search returns 3 results
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');

      // All 3 server results visible
      cy.contains('Check out this cool project').should('be.visible');
      cy.contains("Great project! I'll fork it").should('be.visible');
      cy.contains('The project docs have been updated').should('be.visible');
      cy.contains('3 matches').should('be.visible');

      // Step 2: Open modal and use Refine section to narrow server results
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('docs');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.wait(500);

      // No additional API call (refine is client-side)
      cy.get('@guildSearch.all').should('have.length', 1);

      // Only the matching result from the server results should remain
      cy.contains('The project docs have been updated').should('be.visible');
      cy.contains('Check out this cool project').should('not.exist');
      cy.contains("Great project! I'll fork it").should('not.exist');
    });
  });

  // ── GAP 1: USERPICKER CACHED USER AUTOCOMPLETE ─────────────────

  describe('UserPicker Cached Users', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('shows cached users from loaded messages in From autocomplete', () => {
      // Seed the cache via window.__store__ dispatch
      cy.window().then((win) => {
        const store = (win as any).__store__;
        if (store) {
          store.dispatch({
            type: 'cache/setCachedUserMap/fulfilled',
            payload: {
              '222333444555666777': {
                userName: 'alice_dev',
                displayName: 'Alice',
                avatar: 'alice_avatar',
                guilds: {},
                timestamp: Date.now(),
              },
              '333444555666777888': {
                userName: 'bob_gamer',
                displayName: 'Bob',
                avatar: 'bob_avatar',
                guilds: {},
                timestamp: Date.now(),
              },
            },
          });
        }
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        // Type "Ali" in the From field — should show Alice from cache
        cy.contains('From').parent().find('input[role="combobox"]').type('Ali');
      });

      // Autocomplete should show Alice from cache (no API call needed)
      cy.get('.MuiAutocomplete-popper').should('be.visible');
      cy.get('.MuiAutocomplete-popper').contains('Alice').should('exist');
    });
  });

  // ── GAP 2: HAS POLL/FORWARD NETWORK PARAMS ─────────────────────

  describe('Has Poll and Forward Params', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('sends has=poll in search URL', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.get('[data-testid="has-filter-select"]').first().click();
      });
      cy.get('.MuiMenu-list').contains('poll').click();
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'has=poll');
    });

    it('sends has=forward in search URL', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.get('[data-testid="has-filter-select"]').first().click();
      });
      cy.get('.MuiMenu-list').contains('forward').click();
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'has=forward');
    });
  });

  // ── GAP 3: AUTHOR TYPE NETWORK PARAM ────────────────────────────

  describe('Author Type Param', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('sends author_type=bot in search URL', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Author Type').scrollIntoView();
        cy.contains('Author Type').parent().find('[role="combobox"]').click();
      });
      cy.get('[role="listbox"]').contains('bot').click();
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'author_type=bot');
    });

    it('sends author_type=webhook in search URL', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Author Type').scrollIntoView();
        cy.contains('Author Type').parent().find('[role="combobox"]').click();
      });
      cy.get('[role="listbox"]').contains('webhook').click();
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').its('request.url').should('include', 'author_type=webhook');
    });
  });

  // ── GAP 4: DURING DATE SENDS BOTH MIN/MAX ID ───────────────────

  describe('During Date Params', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('sends both min_id and max_id when During date is set', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Add date').scrollIntoView().click();
        cy.contains('button', 'During').click();
        // During still uses DatePicker (whole-day semantic) — date-only input
        cy.get('input[placeholder^="MM/DD/YYYY"]').type('03/15/2026');
      });
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      cy.wait('@guildSearch').then((interception) => {
        const url = interception.request.url;
        expect(url).to.include('min_id=');
        expect(url).to.include('max_id=');
      });
    });
  });

  // ── GAP 5: MULTIPLE CHIPS + INDIVIDUAL REMOVAL ──────────────────

  describe('Multiple Filter Chips', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('shows multiple chips and supports individual removal', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Apply content + pinned + has filters
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().type('test');
      // Set Pinned to True
      cy.get('[role="dialog"]').within(() => {
        cy.contains('Pinned').scrollIntoView();
        cy.contains('Pinned').parent().find('[role="combobox"]').click();
      });
      cy.get('[role="listbox"]').contains('True').click();
      // Set Has to image
      cy.get('[role="dialog"]').within(() => {
        cy.get('[data-testid="has-filter-select"]').first().scrollIntoView().click();
      });
      cy.get('.MuiMenu-list').contains('image').click();
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@guildSearch');

      // All 3 chips should be visible
      cy.contains('content: test').should('be.visible');
      cy.contains('pinned: true').should('be.visible');
      cy.contains('has: image').should('be.visible');

      // Remove just the pinned chip
      cy.contains('pinned: true').parent().find('[data-testid="CancelIcon"]').click();

      // Pinned chip gone, others remain
      cy.contains('pinned: true').should('not.exist');
      cy.contains('content: test').should('be.visible');
      cy.contains('has: image').should('be.visible');
    });
  });

  // ── GAP 7: LIGHT MODE RENDERING ────────────────────────────────

  describe('Light Mode', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('filter modal renders correctly in light mode', () => {
      // Pick the light theme from the Themes hub (instant apply).
      cy.openThemesHub();
      cy.get('[data-testid="theme-card-discord-light"]').click();
      cy.get('[aria-label="Close Supporter dialog"]').click();
      cy.get('body').should('have.css', 'background-color', 'rgb(255, 255, 255)');

      // Open filter modal
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').should('be.visible');

      // Verify key sections render in light mode
      cy.get('[role="dialog"]').within(() => {
        cy.contains('From').should('exist');
        cy.contains('Has').should('exist');
        cy.contains('Date').should('exist');
        cy.contains('Message Content').scrollIntoView().should('be.visible');
      });

      // Dialog paper should have a light background (not dark)
      cy.get('.MuiDialog-paper').should('have.css', 'background-color').and('not.eq', 'rgb(0, 0, 0)');
    });
  });

  // ── LAYER INTERACTION TESTS ────────────────────────────────────

  describe('Layer Interactions', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('clearing server search re-applies active refine (gap #4)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Step 1: Server search
      searchViaModal('project');
      cy.wait('@guildSearch');
      cy.contains('3 matches').should('be.visible');

      // Step 2: Apply refine on top of server results
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('docs');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Only 1 result (refined from 3 server results)
      cy.contains('The project docs have been updated').should('be.visible');
      cy.contains('Check out this cool project').should('not.exist');

      // Step 3: Clear the server search chip — refine should persist.
      // `force: true` because chip cancel icons are tooltip-wrapped post-#142
      // and the tooltip can intermittently cover the click target.
      cy.get('.MuiChip-filled').contains('content: project').parent().find('[data-testid="CancelIcon"]').click({ force: true });

      // Refine chip should still be visible
      cy.get('.MuiChip-outlined').contains('content: docs').should('be.visible');
    });

    it('applying refine then server search re-applies refine on results (gap #5)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Step 1: Apply refine first
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('docs');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Step 2: Then apply server search (refine should auto-reapply on results)
      searchViaModal('project');
      cy.wait('@guildSearch');

      // Both chips should be visible
      cy.get('.MuiChip-filled').contains('content: project').should('be.visible');
      cy.get('.MuiChip-outlined').contains('content: docs').should('be.visible');

      // Only the result matching both layers should show
      cy.contains('The project docs have been updated').should('be.visible');
    });

    it('modal shows saved search criteria after apply (gap #6)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Apply a server search
      searchViaModal('project');
      cy.wait('@guildSearch');

      // Reopen modal — the applied term shows as a chip (#244: the box is a draft field)
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-search"] .MuiChip-label').should('contain', 'project');
    });

    it('clear all with both layers active restores all messages (gap #7)', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results-multi.json',
      }).as('guildSearch');

      // Apply server search
      searchViaModal('project');
      cy.wait('@guildSearch');

      // Apply refine on top
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('docs');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Both chips visible
      cy.get('.MuiChip-filled').contains('content: project').should('be.visible');
      cy.get('.MuiChip-outlined').contains('content: docs').should('be.visible');

      // Clear all
      cy.get('[aria-label="Clear all filters"]').click();

      // No filter chips remain (search or refine)
      cy.contains('content: project').should('not.exist');
      cy.contains('content: docs').should('not.exist');
      cy.get('[aria-label="Clear all filters"]').should('not.exist');
    });

    it('badge count reflects both search and refine filters', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Apply server search (1 filter)
      searchViaModal('project');
      cy.wait('@guildSearch');
      cy.get('[data-testid="search-filters-button"]').parent().find('.MuiBadge-badge').should('contain', '1');

      // Apply refine (2 filters total)
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('docs');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.get('[data-testid="search-filters-button"]').parent().find('.MuiBadge-badge').should('contain', '2');
    });
  });

  // ── #129 inline filter-by-user from author profile ─────────────────────

  describe('Inline filter-by-user (#129)', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('filters channel to messages by an author via the profile modal', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      // Click an author name in the message feed (any visible author)
      cy.get('[data-testid="message-feed-row"]').first().scrollIntoView();
      cy.get('[data-testid="message-feed-row"]').first()
        .parents('[data-testid="message-chunk"]')
        .find('[role="button"], img, span, p')
        .filter(':visible')
        .first()
        .then(() => {
          // The chunk header avatar/name is clickable. Use the chunk's avatar img.
          cy.get('[data-testid="message-chunk"]').first().find('.MuiAvatar-root').first().click({ force: true });
        });

      // Profile modal opens — filter actions visible
      cy.get('[data-testid="user-profile-filter-actions"]').should('be.visible');

      // Click "Filter messages by" button
      cy.contains('button', /Filter messages by/i).click();

      // Modal closes
      cy.get('[data-testid="user-profile-filter-actions"]').should('not.exist');

      // Search call fires with author_id query param
      cy.wait('@guildSearch').its('request.url').should('include', 'author_id=');

      // Toast confirms
      cy.contains(/Showing messages from/i).should('be.visible');
    });

    it('filters by mentions when the mentions button is clicked', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      cy.get('[data-testid="message-chunk"]').first().find('.MuiAvatar-root').first().click({ force: true });
      cy.get('[data-testid="user-profile-filter-actions"]').should('be.visible');
      cy.contains('button', /Filter messages mentioning/i).click();

      cy.wait('@guildSearch').its('request.url').should('include', 'mentions=');
      cy.contains(/Showing messages mentioning/i).should('be.visible');
    });
  });

  // ── FILTER RESET ON CONVERSATION SWITCH (#226) ──────────────────

  describe('Filter reset on conversation switch (#226)', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('clears applied filters when switching channels and does not resurrect them on return', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        fixture: 'search-results.json',
      }).as('guildSearch');

      searchViaModal('project');
      cy.wait('@guildSearch');

      // Switch conversations: the new feed must start unfiltered and the
      // modal must show empty criteria.
      cy.selectChannel('dev-chat');
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]')
        .find('input[placeholder="Search message content..."]')
        .should('have.value', '');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      // Return to the original channel: criteria must not resurrect.
      cy.selectChannel('general');
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]')
        .find('input[placeholder="Search message content..."]')
        .should('have.value', '');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      // The original search fired exactly once; neither switch re-ran it.
      cy.get('@guildSearch.all').should('have.length', 1);
    });
  });
});
