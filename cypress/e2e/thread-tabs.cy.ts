/**
 * Thread Tabs E2E Tests
 *
 * Comprehensive tests for thread tab behavior: infinite scroll, search,
 * export, load-all, message selection/operations, thread indicators,
 * duplicate tab prevention, analytics, and purge guard.
 */

const THREAD_ID = '802000000000000001';
const THREAD_ID_2 = '803000000000000001';

/** Intercept the thread channel metadata + thread messages fetch */
const interceptThreadLoad = (messageFixture = 'thread-messages.json') => {
  cy.fixture('thread-channel.json').then((thread) => {
    cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}`, {
      statusCode: 200,
      body: thread,
    }).as('getThread');
  });

  cy.fixture(messageFixture).then((messages) => {
    cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages?*`, {
      statusCode: 200,
      body: messages,
    }).as('getThreadMessages');
  });
};

/** Load a thread via the ThreadLoadModal and wait for it to finish */
const loadThread = (messageFixture = 'thread-messages.json') => {
  interceptThreadLoad(messageFixture);
  cy.contains('button', 'Load Thread').click();
  cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
  cy.get('[role="dialog"]').contains('button', 'Load').click();
  cy.wait('@getThread');
  cy.wait('@getThreadMessages');
  // Wait for thread tab to be active
  cy.get('[data-testid="thread-tab-bar"]').should('be.visible');
};

/** Switch to main channel tab */
const switchToMain = () => {
  cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').first().click();
};

/** Switch to thread tab */
const switchToThread = () => {
  cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last().click();
};

/** Intercept the second thread channel metadata + thread messages fetch */
const interceptThread2Load = () => {
  cy.fixture('thread-channel-2.json').then((thread) => {
    cy.intercept('GET', `**/api/v10/channels/${THREAD_ID_2}`, {
      statusCode: 200,
      body: thread,
    }).as('getThread2');
  });

  cy.fixture('thread-messages-2.json').then((messages) => {
    cy.intercept('GET', `**/api/v10/channels/${THREAD_ID_2}/messages?*`, {
      statusCode: 200,
      body: messages,
    }).as('getThread2Messages');
  });
};

/** Load a second thread via the ThreadLoadModal */
const loadThread2 = () => {
  interceptThread2Load();
  cy.contains('button', 'Load Thread').click();
  cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID_2);
  cy.get('[role="dialog"]').contains('button', 'Load').click();
  cy.wait('@getThread2');
  cy.wait('@getThread2Messages');
  cy.get('[data-testid="thread-tab-bar"]').should('be.visible');
};

/** Use messages-with-thread fixture instead of default messages */
const useMessagesWithThread = () => {
  cy.fixture('messages-with-thread.json').then((messages) => {
    cy.intercept('GET', '**/api/v10/channels/801000000000000001/messages?*', {
      statusCode: 200,
      body: messages,
    }).as('getMessages');
  });
};

describe('Thread Tabs — Comprehensive', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  // ───────────────────────────────────────────────────
  // Scenario 1: Infinite scroll pagination on thread tab
  // ───────────────────────────────────────────────────
  describe('Scenario 1: Infinite scroll on thread tab', () => {
    it('should show thread messages (not main channel messages) in thread tab', () => {
      loadThread();

      // Thread messages should be visible
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('Another thread message from Bob').should('be.visible');

      // Main channel messages should NOT be visible
      cy.contains('Hello everyone! Welcome to the server.').should('not.exist');
    });

    it('should show main channel messages after switching back from thread', () => {
      loadThread();

      switchToMain();

      // Main channel messages should reappear
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');

      // Thread messages should NOT be visible
      cy.contains('This is the first thread reply').should('not.exist');
    });

    it('should show correct message count for thread tab', () => {
      loadThread();

      cy.contains('3 message').should('be.visible');
    });

    it('should show correct message count when switching back to main', () => {
      loadThread();

      switchToMain();

      cy.contains('13 message').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 2: Search from thread tab
  // ───────────────────────────────────────────────────
  describe('Scenario 2: Search from thread tab', () => {
    it('should perform server-side search scoped to thread channel', () => {
      loadThread();

      // Intercept thread-scoped search (channels endpoint, not guilds)
      cy.fixture('thread-search-results.json').then((results) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
          statusCode: 200,
          body: results,
        }).as('searchThread');
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');

      // Should show search results from thread
      cy.contains('Thread reply from Alice').should('be.visible');
    });

    // #262: a 202 means Discord is still building the thread's search
    // index. The thread search waits it out and shows the page that follows.
    it('waits out a 202 (still indexing) on the thread search and shows the results', () => {
      loadThread();

      cy.fixture('thread-search-results.json').then((results) => {
        let call = 0;
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, (req) => {
          call += 1;
          if (call === 1) {
            req.reply({ statusCode: 202, body: { retry_after: 1 } });
          } else {
            req.reply({ statusCode: 200, body: results });
          }
        }).as('searchThread');
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');
      cy.wait('@searchThread');

      cy.contains('Thread reply from Alice', { timeout: 10000 }).should('be.visible');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const messages = (store?.getState()?.status?.entries ?? []).map((e: any) => e.message);
        expect(
          messages.some((m: string) => /^Search: Discord is still indexing, retrying in 1s \(attempt 1\/5\)/.test(m)),
        ).to.be.true;
        expect(messages.some((m: string) => /searchThreadMessages: Failed/.test(m))).to.be.false;
      });
    });

    // #264: Discord's search returns spuriously short pages mid-stream. The
    // thread walk used to stop on any page under 25 and step the offset by
    // a fixed 25, ending a By User search at the first page and skipping
    // results. It now pages until total_results and steps by what came back.
    it('keeps paging the thread search after a short page (#264)', () => {
      loadThread();
      // Pass 1 reaction enrichment (#163) would fetch an around-window per
      // search hit (30 here) before the thunk commits; not what this test
      // checks, and it would push the second page past cy.wait's timeout.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateSetting/fulfilled',
          payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
        });
      });

      const page = (offset: number, count: number) => ({
        messages: Array.from({ length: count }, (_, i) => [{
          id: `700000000000000${String(offset + i).padStart(3, '0')}`,
          channel_id: THREAD_ID,
          author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: 'alice_avatar', global_name: 'Alice' },
          content: `Thread search hit ${offset + i + 1}`,
          timestamp: `2026-02-01T12:${String((offset + i) % 60).padStart(2, '0')}:00.000Z`,
          edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
        }]),
        total_results: 30,
        threads: [],
      });

      const offsets: string[] = [];
      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, (req) => {
        const offset = new URL(req.url).searchParams.get('offset') ?? '0';
        offsets.push(offset);
        req.reply({ statusCode: 200, body: offset === '0' ? page(0, 20) : page(20, 10) });
      }).as('searchThread');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('hit');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');
      // The walk pauses for the search delay between pages.
      cy.wait('@searchThread', { timeout: 15000 });

      // The thunk sorts and commits after the last page; retry until it has.
      cy.window().its('__store__').should((store: any) => {
        expect(store.getState().message.threadTabs[THREAD_ID].messages.length).to.equal(30);
      });
      cy.window().then((win) => {
        const store = (win as any).__store__;
        expect(offsets).to.deep.equal(['0', '20']);
        const messages = (store?.getState()?.status?.entries ?? []).map((e: any) => e.message);
        expect(messages.some((m: string) => /Search complete/.test(m))).to.be.true;
      });
    });

    // #262: when Discord refuses the thread search, the status log says
    // which HTTP status came back instead of a bare "Failed to search".
    it('logs the HTTP status when Discord refuses the thread search', () => {
      loadThread();

      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
        statusCode: 403,
        body: { message: 'Missing Access', code: 50001 },
      }).as('searchThread');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const entries = store?.getState()?.status?.entries ?? [];
        const failure = entries.find((e: any) => /message\/searchThreadMessages: /.test(e.message));
        expect(failure, 'thread search failure entry').to.exist;
        expect(failure.level).to.equal('error');
        expect(failure.message).to.equal('message/searchThreadMessages: Failed to search thread messages (HTTP 403)');
        // The tab is usable again: no spinner, no stuck progress.
        expect(store.getState().message.threadTabs[THREAD_ID].isLoading).to.be.false;
        expect(store.getState().message.threadTabs[THREAD_ID].pagination.loadAllProgress).to.be.null;
      });
    });

    it('should search main channel (guild endpoint) when on main tab', () => {
      loadThread();
      switchToMain();

      cy.fixture('search-results.json').then((results) => {
        cy.intercept('GET', '**/api/v10/guilds/*/messages/search*', {
          statusCode: 200,
          body: results,
        }).as('searchGuild');
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('project');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchGuild');
    });

    it('should clear client-side filter and restore all thread messages', () => {
      loadThread();

      // All 3 thread messages visible
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('Another thread message from Bob').should('be.visible');

      cy.contains('button', 'Filters').click();

      // Use Refine section for client-side filtering
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Only the matching message should be shown
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('This is the first thread reply').should('not.exist');

      // Open modal and clear refine, then close
      cy.contains('button', 'Filters').click();
      cy.get('[data-testid="clear-refine-filters"]').scrollIntoView().click({ force: true });
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      // All thread messages should be restored
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('Another thread message from Bob').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 3: Export from thread tab
  // ───────────────────────────────────────────────────
  describe('Scenario 3: Export from thread tab', () => {
    it('should show thread message count in export dialog when on thread tab', () => {
      loadThread();

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').should('be.visible');

      // Should show 3 messages (thread count), not 13 (main channel count)
      cy.contains('Exporting 3 message').should('be.visible');
    });

    it('should show main channel message count when exporting from main tab', () => {
      loadThread();
      switchToMain();

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').should('be.visible');

      cy.contains('Exporting 13 message').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 4: Load All from thread tab
  // ───────────────────────────────────────────────────
  describe('Scenario 4: Load All from thread tab', () => {
    it('should show Load All button on main tab (which has more messages) and hide on thread', () => {
      loadThread();

      // Thread has only 3 messages (< 100), no "hasMore" — Load All should not show
      // (The Load All button only shows when pagination.hasMore && mode === 'paginated')
      // Thread tab shows 3 messages, no Load All needed
      cy.contains('button', 'Load All').should('not.exist');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 5: Message selection + operations on thread tab
  // ───────────────────────────────────────────────────
  describe('Scenario 5: Message selection and operations', () => {
    it('should select thread messages and show correct selection count', () => {
      loadThread();

      // Click a thread message row to select it
      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('1 selected').should('be.visible');
    });

    it('should accumulate selections on thread tab', () => {
      loadThread();

      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('[data-testid="message-feed-row"]','Thread reply from Alice').click();
      cy.contains('2 selected').should('be.visible');
    });

    it('should keep thread selections independent from main tab', () => {
      loadThread();

      // Select a thread message
      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('1 selected').should('be.visible');

      // Switch to main — selection should reset to 0 (no main selections)
      switchToMain();
      cy.contains('0 selected').should('be.visible');

      // Switch back to thread — selection should still be there
      switchToThread();
      cy.contains('1 selected').should('be.visible');
    });

    it('should open delete modal for thread message', () => {
      loadThread();

      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('button', 'Delete').click();

      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Delete Messages').should('be.visible');
    });

    it('should send DELETE request with thread channel ID', () => {
      loadThread();

      cy.intercept('DELETE', `**/api/v10/channels/${THREAD_ID}/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteThreadMessage');

      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('button', 'Delete').click();
      cy.get('[role="dialog"]').contains('button', 'Delete').click();

      cy.wait('@deleteThreadMessage');
    });

    it('should open edit modal for thread message', () => {
      loadThread();

      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('button', 'Edit').click();

      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Edit Message').should('be.visible');
    });

    it('should send PATCH request with thread channel ID when editing', () => {
      loadThread();

      cy.fixture('thread-messages.json').then((msgs) => {
        const editedMsg = { ...msgs[0], content: 'Updated thread reply' };
        cy.intercept('PATCH', `**/api/v10/channels/${THREAD_ID}/messages/*`, {
          statusCode: 200,
          body: editedMsg,
        }).as('editThreadMessage');
      });

      cy.contains('[data-testid="message-feed-row"]','This is the first thread reply').click();
      cy.contains('button', 'Edit').click();
      cy.get('[role="dialog"]').find('textarea').first().clear().type('Updated thread reply');
      cy.get('[role="dialog"]').contains('button', 'Save').click();

      cy.wait('@editThreadMessage');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 6: Opening the same thread twice
  // ───────────────────────────────────────────────────
  describe('Scenario 6: Duplicate thread tab prevention', () => {
    it('should not create a duplicate tab when opening the same thread', () => {
      loadThread();

      // Verify one thread tab exists
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 2);

      // Switch to main
      switchToMain();

      // Re-intercept channel metadata fetch (handleThreadLoad always calls fetchChannelById)
      // but openThreadTab will skip message fetch for existing tabs
      interceptThreadLoad();

      // Try to open the same thread again via Load Thread
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');

      // Should still only have 2 tabs (main + 1 thread), not 3
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 2);

      // Thread tab should now be active (switched to it)
      cy.contains('This is the first thread reply').should('be.visible');
    });

    it('should verify Redux state has only one thread tab entry', () => {
      loadThread();
      switchToMain();

      // Re-intercept channel metadata fetch
      interceptThreadLoad();

      // Open same thread again
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');

      // Wait for thread content to confirm we're on the thread tab
      cy.contains('This is the first thread reply').should('be.visible');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const threadTabs = store.getState().message.threadTabs;
        expect(Object.keys(threadTabs)).to.have.length(1);
        expect(threadTabs[THREAD_ID]).to.exist;
      });
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 7: Thread indicator click (message.thread field)
  // ───────────────────────────────────────────────────
  describe('Scenario 7: Thread starter indicators', () => {
    beforeEach(() => {
      // Override with messages that include a thread starter
      useMessagesWithThread();
      cy.selectChannel('general');
    });

    it('should show thread icon on messages with thread field', () => {
      // The first message has a thread field
      cy.contains('[data-testid="message-chunk"]','Hello everyone! Welcome to the server.')
        .find('[data-testid="ForumIcon"]')
        .should('exist');
    });

    it('should not show thread icon on messages without thread field', () => {
      cy.contains('[data-testid="message-chunk"]','Thanks for setting this up!')
        .find('[data-testid="ForumIcon"]')
        .should('not.exist');
    });

    it('should open thread tab when clicking thread indicator', () => {
      interceptThreadLoad();

      cy.contains('[data-testid="message-chunk"]','Hello everyone! Welcome to the server.')
        .find('[data-testid="ForumIcon"]')
        .click({ force: true });

      cy.wait('@getThreadMessages');

      // Thread tab should open
      cy.get('[data-testid="thread-tab-bar"]').should('be.visible');
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 2);
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last()
        .should('contain.text', 'test-thread');
    });

    it('should show thread reply content after opening via indicator', () => {
      interceptThreadLoad();

      cy.contains('[data-testid="message-chunk"]','Hello everyone! Welcome to the server.')
        .find('[data-testid="ForumIcon"]')
        .click({ force: true });

      cy.wait('@getThreadMessages');

      // Thread messages should be visible
      cy.contains('This is the first thread reply').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 8: Analytics from thread tab
  // ───────────────────────────────────────────────────
  describe('Scenario 8: Analytics from thread tab', () => {
    it('should open analytics modal with thread message data', () => {
      loadThread();

      cy.contains('button', 'Analytics').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Analytics').should('be.visible');
    });

    it('should show analytics for main channel when on main tab', () => {
      loadThread();
      switchToMain();

      cy.contains('button', 'Analytics').click();
      cy.get('[role="dialog"]').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 9: Purge via multi-select (old single-channel purge button removed)
  // ───────────────────────────────────────────────────
  describe('Scenario 9: Purge available via multi-select', () => {
    it('should still allow multi-select mode when on thread tab', () => {
      loadThread();

      // Multi-select toggle should still be visible in channel list
      cy.get('[aria-label="Toggle multi-select"]').should('be.visible');
    });

    it('should show purge button when channels selected in multi-select mode', () => {
      loadThread();
      switchToMain();

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Purge selected channels"]').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 10: Multiple thread tabs
  // ───────────────────────────────────────────────────
  describe('Scenario 10: Multiple thread tabs', () => {
    it('should open 2 threads with independent message content', () => {
      loadThread();
      // Switch to main first so we can open another thread
      switchToMain();
      loadThread2();

      // Second thread tab is active — should show its messages
      cy.contains('Second thread first message').should('be.visible');
      cy.contains('This is the first thread reply').should('not.exist');

      // Switch to first thread
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').contains('test-thread').click();
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('Second thread first message').should('not.exist');
    });

    it('should switch between 3 tabs (main + 2 threads) with correct data', () => {
      loadThread();
      switchToMain();
      loadThread2();

      // On second thread
      cy.contains('Second thread first message').should('be.visible');

      // Switch to first thread
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').contains('test-thread').click();
      cy.contains('This is the first thread reply').should('be.visible');

      // Switch to main
      switchToMain();
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');

      // Should have 3 tabs total
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 3);
    });

    it('should close one thread tab and keep the other intact', () => {
      loadThread();
      switchToMain();
      loadThread2();

      // Wait for thread content to confirm loading is complete
      cy.contains('Second thread first message').should('be.visible');

      // Close second thread tab (the active one — last close icon)
      cy.get('[data-testid="thread-tab-bar"]').find('[data-testid="CloseIcon"]').last().click({ force: true });

      // Should fall back to main or remaining thread
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 2);

      // First thread should still exist
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').contains('test-thread').click();
      cy.contains('This is the first thread reply').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 11: Sort order isolation
  // ───────────────────────────────────────────────────
  describe('Scenario 11: Sort order on thread tab', () => {
    it('should sort thread tab independently from main', () => {
      loadThread();

      // Click the feed toolbar sort button to toggle sort on thread tab
      cy.get('[data-testid="message-feed-toolbar"] button').click();

      // Verify thread sort changed via Redux
      cy.window().then((win) => {
        const store = (win as any).__store__;
        const state = store.getState().message;
        expect(state.threadTabs[THREAD_ID].order.order).to.equal('asc');
        expect(state.order.order).to.equal('desc');
      });
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 12: Operation guards on thread tabs
  // ───────────────────────────────────────────────────
  describe('Scenario 12: Operation guards', () => {
    it('should show thread name in export dialog on thread tab', () => {
      loadThread();

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('test-thread').should('be.visible');

      // Close dialog
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
    });

    it('should show "thread" text in load-all dialog on thread tab', () => {
      // We need a thread with hasMore=true. Set up a thread with 100 messages.
      cy.fixture('thread-channel.json').then((thread) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}`, {
          statusCode: 200,
          body: thread,
        }).as('getThread');
      });

      // Return exactly 100 messages so hasMore=true
      const hundredMessages = Array.from({ length: 100 }, (_, i) => ({
        id: `750${String(i).padStart(15, '0')}`,
        channel_id: THREAD_ID,
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: `Thread message ${i + 1}`,
        timestamp: new Date(2026, 1, 1, 18, 0, i).toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      }));

      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages?*`, {
        statusCode: 200,
        body: hundredMessages,
      }).as('getThreadMessages');

      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');
      cy.wait('@getThreadMessages');
      cy.get('[data-testid="thread-tab-bar"]').should('be.visible');

      // Load All should now be visible
      cy.contains('button', 'Load All').should('be.visible').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('this thread').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 13: Server search behavior documentation
  // ───────────────────────────────────────────────────
  describe('Scenario 13: Server search replaces thread messages', () => {
    it('should replace thread messages on search, restore on reopen', () => {
      loadThread();

      // All 3 thread messages visible
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('Thread reply from Alice').should('be.visible');

      // Perform server search on thread
      cy.fixture('thread-search-results.json').then((results) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
          statusCode: 200,
          body: results,
        }).as('searchThread');
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');

      // Only search result should be visible
      cy.contains('Thread reply from Alice').should('be.visible');

      // Close thread tab
      cy.get('[data-testid="thread-tab-bar"]').find('[data-testid="CloseIcon"]').click({ force: true });

      // Reopen thread — should load all original messages
      loadThread();
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('Another thread message from Bob').should('be.visible');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 14: Thread operation status visibility
  // ───────────────────────────────────────────────────
  describe('Scenario 14: Thread operation status visibility', () => {
    it('should show status controls when Load All is running on thread tab', () => {
      // Set up thread with 100 messages so hasMore=true
      cy.fixture('thread-channel.json').then((thread) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}`, {
          statusCode: 200,
          body: thread,
        }).as('getThread');
      });

      const hundredMessages = Array.from({ length: 100 }, (_, i) => ({
        id: `750${String(i).padStart(15, '0')}`,
        channel_id: THREAD_ID,
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: `Thread message ${i + 1}`,
        timestamp: new Date(2026, 1, 1, 18, 0, i).toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      }));

      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages?*`, {
        statusCode: 200,
        body: hundredMessages,
      }).as('getThreadMessages');

      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');
      cy.wait('@getThreadMessages');
      cy.get('[data-testid="thread-tab-bar"]').should('be.visible');

      // Intercept the Load All fetch with a delayed response to keep status visible
      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages?*`, {
        statusCode: 200,
        body: hundredMessages,
        delay: 2000,
      }).as('loadAllFetch');

      // Click Load All and confirm
      cy.contains('button', 'Load All').click();
      cy.get('[role="dialog"]').contains('button', 'Load').click();

      // Pause/Cancel controls should appear (Pause button has aria-label="Pause")
      cy.get('[aria-label="Pause"]').should('be.visible');
      cy.get('[aria-label="Stop"]').should('be.visible');
    });

    it('should show status indicator when search is running on thread tab', () => {
      loadThread();

      // Intercept thread search with delay to keep loading state visible
      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
        statusCode: 200,
        body: { messages: [], total_results: 0 },
        delay: 5000,
      }).as('searchThread');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      // Search is a light operation — status panel should show loading indicator
      cy.get('[data-tour="status-panel"]', { timeout: 5000 }).should('exist');
    });

    it('should show thread tab is active during search operation', () => {
      loadThread();

      // Intercept search with delay
      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
        statusCode: 200,
        body: { messages: [], total_results: 0 },
        delay: 5000,
      }).as('searchThread');

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').type('test');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();

      // Thread tab should remain visible during the operation
      cy.get('[data-testid="thread-tab-bar"]').should('exist');
    });
  });

  // ───────────────────────────────────────────────────
  // Redux state verification
  // ───────────────────────────────────────────────────
  describe('Redux state integrity', () => {
    it('should have correct activeTab state when on thread tab', () => {
      loadThread();

      // Wait for thread content to render before checking Redux state
      cy.contains('This is the first thread reply').should('be.visible');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const state = store.getState().message;
        expect(state.activeTab).to.equal(THREAD_ID);
        expect(state.threadTabs[THREAD_ID]).to.exist;
        expect(state.threadTabs[THREAD_ID].threadName).to.equal('test-thread');
        expect(state.threadTabs[THREAD_ID].messages).to.have.length(3);
      });
    });

    it('should have null activeTab when on main tab', () => {
      loadThread();
      switchToMain();

      cy.window().then((win) => {
        const store = (win as any).__store__;
        expect(store.getState().message.activeTab).to.be.null;
        // Thread tab should still exist in state
        expect(store.getState().message.threadTabs[THREAD_ID]).to.exist;
      });
    });

    it('should remove thread tab from state when closed', () => {
      loadThread();

      // Wait for thread content to confirm loading is complete
      cy.contains('This is the first thread reply').should('be.visible');

      // Close the thread tab
      cy.get('[data-testid="thread-tab-bar"]').find('[data-testid="CloseIcon"]').click({ force: true });

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const state = store.getState().message;
        expect(state.activeTab).to.be.null;
        expect(state.threadTabs[THREAD_ID]).to.not.exist;
      });
    });

    it('should clear all thread tabs when switching channels', () => {
      loadThread();

      cy.selectChannel('dev-chat');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const state = store.getState().message;
        expect(state.activeTab).to.be.null;
        expect(Object.keys(state.threadTabs)).to.have.length(0);
      });
    });

    it('should preserve main channel messages when thread tab is open', () => {
      loadThread();

      // Wait for thread content to render before checking Redux state
      cy.contains('This is the first thread reply').should('be.visible');

      cy.window().then((win) => {
        const store = (win as any).__store__;
        const state = store.getState().message;
        // Main messages should still be in state
        expect(state.messages.length).to.be.greaterThan(0);
        // Thread messages should be in thread tab
        expect(state.threadTabs[THREAD_ID].messages.length).to.equal(3);
      });
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 15: Search criteria persistence across tabs
  // ───────────────────────────────────────────────────
  describe('Scenario 15: Search criteria persistence across tabs', () => {
    it('should preserve refine criteria when switching between main and thread', () => {
      loadThread();

      // Apply "Alice" refine on thread tab
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Switch to main tab
      switchToMain();

      // Open filter modal on main — refine should be empty
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('not.exist');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      // Switch back to thread tab
      switchToThread();

      // Open filter modal — "Alice" refine should still be there
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('contain', 'Alice');
    });

    it('should keep refine criteria independent per tab', () => {
      loadThread();

      // Apply "Alice" refine on thread tab
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Switch to main, apply "project" refine
      switchToMain();
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('project');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Switch to thread — should have "Alice"
      switchToThread();
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('contain', 'Alice');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      // Switch back to main — should have "project"
      switchToMain();
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('contain', 'project');
    });

    it('should reset criteria when thread tab is closed and reopened', () => {
      loadThread();

      // Apply refine on thread tab
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('some query');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Close the thread tab
      cy.get('[data-testid="thread-tab-bar"]').find('[data-testid="CloseIcon"]').click({ force: true });
      // Wait for main channel messages to be visible (confirms tab switch completed + cleanup ran)
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone').should('exist');

      // Reopen same thread
      loadThread();

      // Open filter modal — refine should be empty (criteria was discarded with the tab)
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('not.exist');
    });

    it('should preserve refine criteria across multiple thread tabs', () => {
      loadThread();

      // Apply refine on first thread
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('thread1-query');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Open second thread
      switchToMain();
      loadThread2();

      // Apply refine on second thread
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('thread2-query');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Switch to first thread — should have its own refine
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').contains('test-thread').click();
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('contain', 'thread1-query');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      // Switch to second thread — should have its own refine
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').contains('second-thread').click();
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('[data-testid="content-filter-refine"] .MuiChip-label').should('contain', 'thread2-query');
    });

    it('should maintain independent server search on main and refine on thread', () => {
      // Step 1: Server search on main channel
      cy.fixture('search-results-multi.json').then((results) => {
        cy.intercept('GET', '**/api/v10/guilds/*/messages/search*', {
          statusCode: 200,
          body: results,
        }).as('guildSearch');
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().type('project');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@guildSearch');

      // Main should show search results
      cy.contains('Check out this cool project').should('be.visible');
      // Search chip visible on main
      cy.contains('content: project').should('be.visible');

      // Step 2: Load thread tab
      loadThread();

      // Thread should have its own messages (no search chips from main)
      cy.contains('This is the first thread reply').should('be.visible');
      cy.contains('content: project').should('not.exist');

      // Step 3: Apply refine on thread tab
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Thread should show only Alice's message
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('This is the first thread reply').should('not.exist');
      // Refine chip visible on thread
      cy.contains('content: Alice').should('be.visible');

      // Step 4: Switch back to main — should still have server search results
      switchToMain();
      cy.contains('Check out this cool project').should('be.visible');
      // Main's search chip should be back
      cy.contains('content: project').should('be.visible');
      // Thread's refine chip should not be on main
      cy.contains('content: Alice').should('not.exist');

      // Step 5: Switch back to thread — refine should persist
      switchToThread();
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.contains('content: Alice').should('be.visible');
    });

    it('should allow server search and refine simultaneously on same tab', () => {
      // Server search on thread
      cy.fixture('thread-search-results.json').then((results) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
          statusCode: 200,
          body: results,
        }).as('searchThread');
      });

      loadThread();

      // Apply server search
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');

      // Server result visible
      cy.contains('Thread reply from Alice').should('be.visible');

      // Now apply refine on top of server results
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('reply');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Both chips should be visible (search = blurple, refine = gray)
      cy.get('.MuiChip-filled').contains('content: Alice').should('be.visible');
      cy.get('.MuiChip-outlined').contains('content: reply').should('be.visible');
    });

    it('should maintain independent server searches across main and thread (gap #1)', () => {
      // Server search on main
      cy.fixture('search-results-multi.json').then((results) => {
        cy.intercept('GET', '**/api/v10/guilds/*/messages/search*', {
          statusCode: 200,
          body: results,
        }).as('guildSearch');
      });

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().type('project');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@guildSearch');
      cy.contains('Check out this cool project').should('be.visible');

      // Server search on thread
      cy.fixture('thread-search-results.json').then((results) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages/search*`, {
          statusCode: 200,
          body: results,
        }).as('searchThread');
      });

      loadThread();

      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Search message content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').find('button[class*="contained"]').contains('Search').click();
      cy.wait('@searchThread');
      cy.contains('Thread reply from Alice').should('be.visible');

      // Switch to main — should still have its search results
      switchToMain();
      cy.contains('Check out this cool project').should('be.visible');
      cy.get('.MuiChip-filled').contains('content: project').should('be.visible');

      // Switch to thread — should still have its search results
      switchToThread();
      cy.contains('Thread reply from Alice').should('be.visible');
      cy.get('.MuiChip-filled').contains('content: Alice').should('be.visible');
    });

    it('should not affect thread filters when clearing main chip (gap #2)', () => {
      // Apply refine on main
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Hello');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.get('.MuiChip-outlined').contains('content: Hello').should('be.visible');

      // Apply refine on thread
      loadThread();
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Alice');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();
      cy.get('.MuiChip-outlined').contains('content: Alice').should('be.visible');

      // Switch to main and clear refine chip
      switchToMain();
      cy.get('.MuiChip-outlined').contains('content: Hello').parent().find('[data-testid="CancelIcon"]').click();
      cy.contains('content: Hello').should('not.exist');

      // Switch to thread — its refine should still be active
      switchToThread();
      cy.get('.MuiChip-outlined').contains('content: Alice').should('be.visible');
    });

    it('should update badge count when switching between tabs (gap #3)', () => {
      // Apply 1 refine filter on main
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('Hello');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Badge should show 1 on main
      cy.get('[data-testid="search-filters-button"]').parent().find('.MuiBadge-badge').should('contain', '1');

      // Load thread — no filters. TourButton conditionally renders the
      // Badge wrapper only when badgeContent > 0 (per #141), so a zero
      // count removes the badge from the DOM entirely.
      loadThread();
      cy.get('[data-testid="search-filters-button"]').parent().find('.MuiBadge-badge').should('not.exist');

      // Switch back to main — badge should show 1 again
      switchToMain();
      cy.get('[data-testid="search-filters-button"]').parent().find('.MuiBadge-badge').should('contain', '1');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 16: Header name updates on tab switch
  // ───────────────────────────────────────────────────
  describe('Scenario 16: Header name updates on tab switch', () => {
    it('should show thread name in header on thread tab', () => {
      loadThread();

      cy.get('h6').should('contain.text', 'test-thread');
    });

    it('should show channel name on main tab', () => {
      loadThread();
      switchToMain();

      cy.get('h6').should('contain.text', 'general');
    });

    it('should update header between multiple threads', () => {
      loadThread();
      cy.get('h6').should('contain.text', 'test-thread');

      switchToMain();
      loadThread2();
      cy.get('h6').should('contain.text', 'second-thread');

      // Switch to first thread
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').contains('test-thread').first().click();
      cy.get('h6').should('contain.text', 'test-thread');

      // Switch to main
      switchToMain();
      cy.get('h6').should('contain.text', 'general');
    });
  });

  // ───────────────────────────────────────────────────
  // Scenario 17: Per-tab partial results warning
  // ───────────────────────────────────────────────────
  describe('Scenario 17: Per-tab partial results warning', () => {
    it('should show warning only on tab where local filter was applied', () => {
      loadThread();
      switchToMain();

      // Main tab has hasMore=true (13 messages = 100 limit not hit, but mode is 'paginated')
      // Apply client-side filter on main tab
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('project');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      // Warning should be visible on main tab
      cy.contains('Filtering Loaded Messages Only').should('be.visible');

      // Switch to thread tab — warning should NOT show
      switchToThread();
      cy.contains('Filtering Loaded Messages Only').should('not.exist');

      // Switch back to main — warning should still be there
      switchToMain();
      cy.contains('Filtering Loaded Messages Only').should('be.visible');
    });

    it('should clear warning on Clear Filters', () => {
      loadThread();
      switchToMain();

      // Apply client-side filter on main tab
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('project');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      cy.contains('Filtering Loaded Messages Only').should('be.visible');

      // Clear the refine filter
      cy.contains('button', 'Filters').click();
      cy.get('[data-testid="clear-refine-filters"]').scrollIntoView().click({ force: true });
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();

      cy.contains('Filtering Loaded Messages Only').should('not.exist');
    });

    it('should not carry warning to reopened thread tab', () => {
      // Load thread with 100 messages (hasMore=true)
      cy.fixture('thread-channel.json').then((thread) => {
        cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}`, {
          statusCode: 200,
          body: thread,
        }).as('getThread');
      });

      const hundredMessages = Array.from({ length: 100 }, (_, i) => ({
        id: `750${String(i).padStart(15, '0')}`,
        channel_id: THREAD_ID,
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: `Thread message ${i + 1}`,
        timestamp: new Date(2026, 1, 1, 18, 0, i).toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      }));

      cy.intercept('GET', `**/api/v10/channels/${THREAD_ID}/messages?*`, {
        statusCode: 200,
        body: hundredMessages,
      }).as('getThreadMessages');

      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');
      cy.wait('@getThreadMessages');
      cy.get('[data-testid="thread-tab-bar"]').should('be.visible');

      // Apply local refine filter on thread (which has hasMore=true)
      cy.contains('button', 'Filters').click();
      cy.get('[role="dialog"]').find('input[placeholder="Filter by content..."]').scrollIntoView().type('message 1');
      cy.get('[role="dialog"]').contains('button', 'Apply Refine').click();

      cy.contains('Filtering Loaded Messages Only').should('be.visible');

      // Close thread tab
      cy.get('[data-testid="thread-tab-bar"]').find('[data-testid="CloseIcon"]').click({ force: true });

      // Reopen same thread (interceptThreadLoad sets up @getThread and @getThreadMessages)
      interceptThreadLoad();
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');
      cy.wait('@getThreadMessages');

      // Warning should NOT be present on the reopened tab
      cy.contains('Filtering Loaded Messages Only').should('not.exist');
    });
  });
});
