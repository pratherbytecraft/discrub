describe('Bulk Edit', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    // Use messages near the top of the table (newest first in descending sort)
    cy.get('[data-testid="message-feed-row"]').should('have.length.greaterThan', 0);
  });

  describe('Edit Button with Multiple Selection', () => {
    // Discord blocks PATCH on other users' messages regardless of permission,
    // so the toolbar Edit button only enables when every selected message is
    // authored by the current user. All selections below are tester-authored.
    it('should enable Edit button with single selection', () => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      cy.contains('1 selected').should('be.visible');
      cy.contains('button', 'Edit').should('not.be.disabled');
    });

    it('should enable Edit button when multiple own messages are selected', () => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      cy.contains('[data-testid="message-feed-row"]','Hello everyone! Welcome to the server.').click();
      cy.contains('2 selected').should('be.visible');
      cy.contains('button', 'Edit').should('not.be.disabled');
    });

    it('should enable Edit button with three own selections', () => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      cy.contains('[data-testid="message-feed-row"]','Hello everyone! Welcome to the server.').click();
      cy.contains('[data-testid="message-feed-row"]','Sure! Let me finish this code first.').click();
      cy.contains('3 selected').should('be.visible');
      cy.contains('button', 'Edit').should('not.be.disabled');
    });

    it('should disable Edit button when selection includes another user\'s message', () => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      cy.contains('[data-testid="message-feed-row"]',"Let's ship it!").click();
      cy.contains('2 selected').should('be.visible');
      cy.contains('button', 'Edit').should('be.disabled');
    });
  });

  describe('Bulk Edit Modal', () => {
    beforeEach(() => {
      cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
      cy.contains('[data-testid="message-feed-row"]','Hello everyone! Welcome to the server.').click();
      cy.contains('[data-testid="message-feed-row"]','Sure! Let me finish this code first.').click();
    });

    it('should open modal with correct message count', () => {
      cy.contains('button', 'Edit').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Bulk Edit').should('be.visible');
      cy.contains('Editing 3 messages').should('be.visible');
    });

    it('should have Save button disabled when text field is empty', () => {
      cy.contains('button', 'Edit').click();
      cy.get('[role="dialog"]').contains('button', 'Save').should('be.disabled');
    });

    it('should enable Save button when text is entered', () => {
      cy.contains('button', 'Edit').click();
      cy.get('[role="dialog"]').find('textarea').first().type('Updated content');
      cy.get('[role="dialog"]').contains('button', 'Save').should('not.be.disabled');
    });

    it('should close modal on Cancel without making requests', () => {
      cy.contains('button', 'Edit').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('should send PATCH requests when saving', () => {
      cy.intercept('PATCH', '**/api/v10/channels/*/messages/*', {
        statusCode: 200,
        body: {},
      }).as('editMessage');

      cy.contains('button', 'Edit').click();
      cy.get('[role="dialog"]').find('textarea').first().type('Bulk updated text');
      cy.get('[role="dialog"]').contains('button', 'Save').click();

      // Should make PATCH requests for each selected message
      cy.wait('@editMessage');
    });
  });

});

// ── Shared helpers for the #183 batching tests below ────────────────────────

const API = '**/api/v10';

const CURRENT_USER = {
  id: '111222333444555666',
  username: 'discrub_tester',
  discriminator: '0',
  avatar: 'abc123avatar',
  global_name: 'Discrub Tester',
};

/** Build N own-authored plain messages for a channel/thread intercept body. */
const buildOwnMessages = (count: number, channelId: string, idBase: string, label: string) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${idBase}${String(i + 10)}`, // 10..N+9 keeps ids fixed-width + unique
    channel_id: channelId,
    author: CURRENT_USER,
    content: `${label} ${i + 1}`,
    timestamp: `2026-03-01T10:${String(i).padStart(2, '0')}:00.000Z`,
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

/** Zero operation delays (DiscrubSetting enum keys) so a 30-message edit
 *  loop runs at test speed instead of ~2s per message. */
const zeroDelays = () => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    const zeroed = {
      ...store.getState().app.settings,
      searchDelay2: '0',
      deleteDelay2: '0',
      delayModifier2: '0',
    };
    // Dispatched as updateAllSettings.fulfilled (not plain setSettings)
    // so settingsChangeMiddleware reconstructs the discrub-core service
    // singleton: its patch/delete pacing reads a constructor-time
    // settings snapshot, not the store, and would otherwise keep the
    // ~2s default delete-delay for the whole run.
    store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: zeroed });
  });
  assertDelaysZeroed('post-dispatch');
};

/** Diagnostic: pin the store's delay settings so a clobber between
 *  zeroDelays and the operation start fails loudly instead of pacing
 *  the loop at the ~2s default. */
const assertDelaysZeroed = (label: string) => {
  cy.window({ log: false }).should((win) => {
    const s = (win as any).__store__.getState().app.settings ?? {};
    expect(s.deleteDelay2, `${label}: deleteDelay2`).to.eq('0');
    expect(s.delayModifier2, `${label}: delayModifier2`).to.eq('0');
  });
};

// ── Bulk edit batching (#183 follow-up, F13) ────────────────────────────────
// editMessages now mirrors the delete path: direct service calls with
// confirmed edits flushed through the batched `messagesEdited` reducer every
// DELETE_BATCH_SIZE (25, messageSlice.ts) edits plus a final flush, instead
// of the per-message editMessage thunk whose fulfilled reducer rewrote all
// three arrays per message (the "page unresponsive" freeze class). Batching
// changes the TABLE update cadence only — still one PATCH per message.
describe('Bulk edit batching (#183/F13)', () => {
  // 30 > DELETE_BATCH_SIZE (25) so the run spans a mid-run flush AND the
  // final partial flush.
  const MESSAGE_COUNT = 30;
  const seeded = buildOwnMessages(MESSAGE_COUNT, '801000000000000001', '7300000000000000', 'Editable message');

  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.intercept('GET', `${API}/channels/*/messages?*`, {
      statusCode: 200,
      body: seeded,
    }).as('getMessages');
    cy.selectChannel('general');
    cy.window().should((win) => {
      expect((win as any).__store__.getState().message.rows, 'seeded table loaded')
        .to.have.length(MESSAGE_COUNT);
    });
    zeroDelays();
  });

  it('edits a larger-than-batch selection: one PATCH per message, every row content updates', () => {
    let patchCount = 0;
    cy.intercept('PATCH', `${API}/channels/*/messages/*`, (req) => {
      patchCount++;
      const id = req.url.split('?')[0].split('/').pop() as string;
      const original = seeded.find((m) => m.id === id);
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      // Echo a full message object — the batched messagesEdited reducer
      // replaces the row's message with this response wholesale.
      req.reply({
        statusCode: 200,
        body: { ...original, content: body.content, edited_timestamp: '2026-03-02T00:00:00.000Z' },
      });
    }).as('bulkPatch');

    cy.get('input[aria-label="Select all messages"]').click({ force: true });
    cy.contains('30 selected').should('be.visible');

    cy.contains('button', 'Edit').click();
    cy.contains('Editing 30 messages').should('be.visible');
    cy.get('[role="dialog"]').find('textarea').first().type('Batch edited content');
    assertDelaysZeroed('pre-save');
    cy.get('[role="dialog"]').contains('button', 'Save').click();

    // Completion gate: only passes once every PATCH fired AND the final
    // messagesEdited flush landed in state.
    cy.window({ timeout: 60000 }).should((win) => {
      const st = (win as any).__store__.getState().message;
      expect(patchCount, 'one PATCH per selected message').to.eq(MESSAGE_COUNT);
      expect(st.isEditing, 'edit run completed').to.eq(false);
      // 2.2.5 WP2b: rows carry no content; the objects are in the message cache.
      const contents = (st.rows as { id: string }[]).map((r) => (win as any).__messageCache__.get('main', r.id)?.content);
      expect(contents, 'no rows lost by the batched flushes').to.have.length(MESSAGE_COUNT);
      expect(contents.every((c) => c === 'Batch edited content'),
        'every message content updated via messagesEdited').to.eq(true);
      expect(st.selectedIds, 'selection cleared on completion').to.have.length(0);
    });

    // Visible rows all show the new content (the feed virtualizes, so
    // assert the rendered subset rather than a fixed row count).
    cy.get('[data-testid="message-feed-row"]').each(($row) => {
      expect($row.text()).to.include('Batch edited content');
    });
    cy.get('[role="dialog"]').should('not.exist');
  });
});

// ── Bulk edit flush routing by starting container (#183/F14, c11e593) ───────
// The batched reducers take the containerId the operation captured at start
// instead of resolving the active tab at flush time: tab switching is allowed
// mid-operation (#237), and the pre-fix active-tab lookup silently routed a
// whole batch of confirmed edits into whichever container was focused when
// the flush landed.
describe('Bulk edit flush routing (#183/F14)', () => {
  const THREAD_ID = '802000000000000001';
  const MESSAGE_COUNT = 30;
  const threadSeed = buildOwnMessages(MESSAGE_COUNT, THREAD_ID, '7400000000000000', 'Thread seed');

  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Sounds good, deploying now.').should('exist');
    zeroDelays();
  });

  it('routes batched flushes to the thread the run started in, even after switching to Main mid-run', () => {
    // Load a thread tab seeded with 30 own-authored messages.
    cy.fixture('thread-channel.json').then((thread) => {
      cy.intercept('GET', `${API}/channels/${THREAD_ID}`, {
        statusCode: 200,
        body: thread,
      }).as('getThread');
    });
    cy.intercept('GET', `${API}/channels/${THREAD_ID}/messages?*`, {
      statusCode: 200,
      body: threadSeed,
    }).as('getThreadMessages');

    cy.contains('button', 'Load Thread').click();
    cy.get('[role="dialog"]').find('input').clear().type(THREAD_ID);
    cy.get('[role="dialog"]').contains('button', 'Load').click();
    cy.wait('@getThread');
    cy.wait('@getThreadMessages');
    cy.get('[data-testid="thread-tab-bar"]').should('be.visible');
    cy.contains('[data-testid="message-feed-row"]', 'Thread seed').should('exist');

    // Each PATCH response is delayed 150ms so the serial 30-message run
    // stays in flight (>= 4.5s) while we switch tabs.
    let patchCount = 0;
    cy.intercept('PATCH', `${API}/channels/${THREAD_ID}/messages/*`, (req) => {
      patchCount++;
      const id = req.url.split('?')[0].split('/').pop() as string;
      const original = threadSeed.find((m) => m.id === id);
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      req.reply({
        statusCode: 200,
        body: { ...original, content: body.content, edited_timestamp: '2026-03-02T00:00:00.000Z' },
        delay: 150,
      });
    }).as('bulkPatch');

    cy.get('input[aria-label="Select all messages"]').click({ force: true });
    cy.contains('30 selected').should('be.visible');
    cy.contains('button', 'Edit').click();
    cy.contains('Editing 30 messages').should('be.visible');
    cy.get('[role="dialog"]').find('textarea').first().type('Rerouted thread content');
    assertDelaysZeroed('pre-save');
    cy.get('[role="dialog"]').contains('button', 'Save').click();

    // #237: the tab bar stays interactive mid-operation — switch to Main
    // while the run is still in flight.
    cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').first().click();
    cy.contains('[data-testid="message-feed-row"]', 'Sounds good, deploying now.').should('exist');
    cy.window().should((win) => {
      expect((win as any).__store__.getState().message.isEditing,
        'edit run still in flight after the tab switch').to.eq(true);
    });

    // Completion: every edit landed in the THREAD container (captured at
    // start), none in Main (the active tab when the flushes landed).
    cy.window({ timeout: 60000 }).should((win) => {
      const st = (win as any).__store__.getState().message;
      expect(patchCount, 'one PATCH per thread message').to.eq(MESSAGE_COUNT);
      expect(st.isEditing, 'edit run completed').to.eq(false);
      const tab = st.threadTabs[THREAD_ID];
      expect(tab, 'thread tab still open').to.exist;
      const threadContents = (tab.rows as { id: string }[]).map((r) => (win as any).__messageCache__.get(THREAD_ID, r.id)?.content);
      expect(threadContents, 'thread container intact').to.have.length(MESSAGE_COUNT);
      expect(threadContents.every((c) => c === 'Rerouted thread content'),
        'all edits flushed into the starting container').to.eq(true);
      const mainContents = (st.rows as { id: string }[]).map((r) => (win as any).__messageCache__.get('main', r.id)?.content);
      expect(mainContents, 'main container untouched').to.have.length(13);
      expect(mainContents.some((c) => c === 'Rerouted thread content'),
        'no edits misrouted into Main').to.eq(false);
    });

    // UI: Main table untouched; switching back shows the edited thread.
    cy.contains('[data-testid="message-feed-row"]', 'Rerouted thread content').should('not.exist');
    cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last().click();
    cy.contains('[data-testid="message-feed-row"]', 'Rerouted thread content').should('exist');
    cy.contains('[data-testid="message-feed-row"]', 'Thread seed').should('not.exist');
  });
});
