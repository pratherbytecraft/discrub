describe('Message Operations', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    // Wait for messages to render
    cy.contains('[data-testid="message-feed-row"]', 'Sounds good, deploying now.').should('exist');
  });

  it('shows "1 selected" chip after clicking a message row', () => {
    // Click the table row directly (rows have onClick → toggleMessageSelection)
    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('1 selected').should('be.visible');
  });

  it('enables Delete and Edit with a single selection', () => {
    cy.contains('button', 'Delete').should('be.disabled');
    cy.contains('button', 'Edit').should('be.disabled');

    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();

    cy.contains('button', 'Delete').should('not.be.disabled');
    cy.contains('button', 'Edit').should('not.be.disabled');
  });

  it('opens EditMessageModal when clicking Edit', () => {
    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('button', 'Edit').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains('Edit Message').should('be.visible');
    cy.get('[role="dialog"]').find('textarea').should('exist');
  });

  it('sends PATCH request when saving edited message', () => {
    cy.fixture('message-edited.json').then((editedMsg) => {
      cy.intercept('PATCH', '**/api/v10/channels/*/messages/*', {
        statusCode: 200,
        body: editedMsg,
      }).as('editMessage');
    });

    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('button', 'Edit').click();
    cy.get('[role="dialog"]').find('textarea').first().clear().type('Updated content');
    cy.get('[role="dialog"]').contains('button', 'Save').click();
    cy.wait('@editMessage');
  });

  it('opens DeleteConfirmModal with "Delete Messages" title', () => {
    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('button', 'Delete').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains('Delete Messages').should('be.visible');
    cy.contains('This action cannot be undone.').should('be.visible');
  });

  it('closes delete modal without removing message when cancelling', () => {
    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('button', 'Delete').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();
    cy.get('[role="dialog"]').should('not.exist');
    cy.contains('[data-testid="message-feed-row"]', 'Sounds good, deploying now.').should('exist');
  });

  it('keeps Edit and Delete enabled with multi-message selection (all by current user)', () => {
    // Both messages are authored by discrub_tester (the logged-in user),
    // so #139's editBlockedByPermission gate stays clear.
    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('[data-testid="message-feed-row"]','Sure! Let me finish this code first.').click();
    cy.contains('2 selected').should('be.visible');
    cy.contains('button', 'Edit').should('not.be.disabled');
    cy.contains('button', 'Delete').should('not.be.disabled');
  });

  // Backlog #139 regression guard: Edit (PATCH) is author-only at the
  // Discord API layer, so the toolbar disables it whenever any selected
  // message is by another user. Delete behavior depends on
  // canManageMessages — that's covered separately in purge.cy.ts.
  it('disables Edit when the selection includes a message by another user (#139)', () => {
    cy.contains('[data-testid="message-feed-row"]','Sounds good, deploying now.').click();
    cy.contains('[data-testid="message-feed-row"]',"Let's ship it!").click();
    cy.contains('2 selected').should('be.visible');
    cy.contains('button', 'Edit').should('be.disabled');
  });
});

// ── System / pinned message selection (#196 Phase 3) ────────────────────────
// SystemMessageRow used to render pin/join/boost notices without a selection
// checkbox, so users couldn't select or delete them from the feed and Select
// All silently skipped them in the UI. A checkbox mirroring MessageFeedRow
// closes that gap. The default messages.json has no system messages, so these
// tests override the feed with a normal message + a type-6 pin notification
// authored by the current user (so it's deletable).
describe('System / pinned message selection (#196 Phase 3)', () => {
  const CURRENT_USER = {
    id: '111222333444555666',
    username: 'discrub_tester',
    discriminator: '0',
    avatar: 'abc123avatar',
    global_name: 'Discrub Tester',
  };

  const normalMessage = {
    id: '700000000000000091',
    channel_id: '801000000000000001',
    author: CURRENT_USER,
    content: 'A regular message in the feed',
    timestamp: '2026-02-01T10:00:00.000Z',
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    attachments: [],
    embeds: [],
    reactions: [],
    pinned: false,
    type: 0,
  };

  const pinNotification = {
    ...normalMessage,
    id: '700000000000000092',
    content: '',
    timestamp: '2026-02-01T10:05:00.000Z',
    message_reference: { message_id: '700000000000000091', channel_id: '801000000000000001' },
    type: 6,
  };

  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', {
      statusCode: 200,
      body: [normalMessage, pinNotification],
    }).as('getMessages');
    cy.selectChannel('general');
    cy.get('[data-testid="system-message-row"][data-system-kind="pin"]').should('exist');
  });

  it('renders the pin notification as a system row', () => {
    cy.get('[data-testid="system-message-row"]').should(
      'contain.text',
      'pinned a message to this channel',
    );
  });

  it('selects a pin notification via its checkbox', () => {
    cy.get('input[aria-label="Select system message 700000000000000092"]').click({ force: true });
    cy.contains('1 selected').should('be.visible');
  });

  it('selects a pin notification by clicking the row body (not just the checkbox)', () => {
    // Click the left side of the row (the icon column) to avoid the
    // trailing "See all pinned messages" link, which navigates instead.
    cy.get('[data-testid="system-message-row"][data-system-kind="pin"]')
      .first()
      .click('left');
    cy.contains('1 selected').should('be.visible');
  });

  it('Select all now visibly includes the pin notification', () => {
    cy.get('input[aria-label="Select all messages"]').click({ force: true });
    cy.contains('2 selected').should('be.visible');
    cy.get('input[aria-label="Select system message 700000000000000092"]').should('be.checked');
  });

  it('disables Edit but keeps Delete enabled for a selected system message', () => {
    cy.get('input[aria-label="Select system message 700000000000000092"]').click({ force: true });
    cy.contains('button', 'Edit').should('be.disabled');
    cy.contains('button', 'Delete').should('not.be.disabled');
  });

  it('deletes a selected pin notification (sends DELETE for its id)', () => {
    cy.intercept('DELETE', '**/api/v10/channels/*/messages/*', {
      statusCode: 204,
      body: {},
    }).as('deletePin');
    cy.get('input[aria-label="Select system message 700000000000000092"]').click({ force: true });
    cy.contains('button', 'Delete').click();
    cy.get('[role="dialog"]').contains('button', 'Delete').click();
    cy.wait('@deletePin').its('request.url').should('include', '700000000000000092');
  });
});

// ── Bulk delete batching (#183) ─────────────────────────────────────────────
// deleteMessages no longer rewrites all three message arrays per deletion
// (the "page unresponsive" freeze class): confirmed deletions accumulate and
// flush to state via the batched `messagesRemoved` reducer every
// DELETE_BATCH_SIZE (25, messageSlice.ts) deletions plus a final flush.
// Batching changes the TABLE update cadence only — still exactly one DELETE
// request per message — so the pinnable observables are: request count equals
// the selection size, every row clears, and the run completes cleanly.
describe('Bulk delete batching (#183)', () => {
  const API = '**/api/v10';

  const CURRENT_USER = {
    id: '111222333444555666',
    username: 'discrub_tester',
    discriminator: '0',
    avatar: 'abc123avatar',
    global_name: 'Discrub Tester',
  };

  // 30 > DELETE_BATCH_SIZE (25) so the run spans a mid-run flush AND the
  // final partial flush.
  const MESSAGE_COUNT = 30;
  const batchMessages = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
    id: `7200000000000000${String(i + 10)}`, // 10..39 keeps ids fixed-width + unique
    channel_id: '801000000000000001',
    author: CURRENT_USER,
    content: `Batch message ${i + 1}`,
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

  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.intercept('GET', `${API}/channels/*/messages?*`, {
      statusCode: 200,
      body: batchMessages,
    }).as('getMessages');
    cy.selectChannel('general');
    cy.window().should((win) => {
      expect((win as any).__store__.getState().message.rows, 'seeded table loaded')
        .to.have.length(MESSAGE_COUNT);
    });
    // Zero the delete/search delays (DiscrubSetting enum keys) so the
    // 30-message loop runs at test speed instead of ~2s per deletion.
    // Dispatched as updateAllSettings.fulfilled (not plain setSettings)
    // so settingsChangeMiddleware reconstructs the discrub-core service
    // singleton, whose delete pacing reads a constructor-time settings
    // snapshot rather than the store.
    cy.window().then((win) => {
      const store = (win as any).__store__;
      store.dispatch({
        type: 'app/updateAllSettings/fulfilled',
        payload: {
          ...store.getState().app.settings,
          searchDelay2: '0',
          deleteDelay2: '0',
          delayModifier2: '0',
        },
      });
    });
  });

  it('deletes a larger-than-batch selection: one DELETE per message, every row clears', () => {
    let deleteCount = 0;
    cy.intercept('DELETE', `${API}/channels/*/messages/*`, (req) => {
      deleteCount++;
      req.reply({ statusCode: 204, body: {} });
    }).as('deleteMessage');

    cy.get('input[aria-label="Select all messages"]').click({ force: true });
    cy.contains('30 selected').should('be.visible');

    cy.contains('button', 'Delete').click();
    cy.get('[role="dialog"]').contains('button', 'Delete').click();

    // Completion gate: the success status entry only exists after the
    // whole loop (and its final messagesRemoved flush) finished.
    cy.window({ timeout: 60000 }).should((win) => {
      const state = (win as any).__store__.getState();
      const msgs = (state.status.entries as { message: string }[]).map((e) => e.message);
      expect(msgs, 'completion status entry').to.include(`Deleted ${MESSAGE_COUNT} messages`);
      expect(deleteCount, 'one DELETE request per selected message').to.eq(MESSAGE_COUNT);
      expect(state.message.rows, 'rows drained').to.have.length(0);
      expect(state.message.filteredRows, 'filtered rows drained').to.have.length(0);
      expect(state.message.selectedIds, 'selection drained').to.have.length(0);
      expect(state.message.isDeleting, 'operation completed').to.eq(false);
    });

    // Every row cleared from the table; no stuck dialog or selection.
    cy.get('[data-testid="message-feed-row"]').should('not.exist');
    cy.get('[role="dialog"]').should('not.exist');
    cy.contains('0 selected').should('be.visible');
  });

  // #241: bulk operations used to pace at ~2× the configured delay — the
  // discrub-core service slept the delete delay before every DELETE/PATCH
  // (constructor-time settings snapshot) AND the app loop slept the same
  // delay again between calls. The singleton now runs with autoDelay off,
  // so the loop sleep is the only pacing. Three deletes with a 1s delay
  // means two ~1s gaps (~2s first-to-last); the old double pacing added a
  // further 1s pre-delay per call (~4s+), which the upper bound excludes.
  it('paces bulk deletes at 1x the configured delay, not 2x (#241)', () => {
    cy.window().then((win) => {
      const store = (win as any).__store__;
      store.dispatch({
        type: 'app/updateAllSettings/fulfilled',
        payload: {
          ...store.getState().app.settings,
          searchDelay2: '0',
          deleteDelay2: '1',
          delayModifier2: '0',
        },
      });
    });

    const deleteTimes: number[] = [];
    cy.intercept('DELETE', `${API}/channels/*/messages/*`, (req) => {
      deleteTimes.push(Date.now());
      req.reply({ statusCode: 204, body: {} });
    }).as('deleteMessage');

    // 21/22/23 — unlike "Batch message 1", these don't substring-match
    // any other row's content.
    cy.contains('[data-testid="message-feed-row"]', 'Batch message 21').click();
    cy.contains('[data-testid="message-feed-row"]', 'Batch message 22').click();
    cy.contains('[data-testid="message-feed-row"]', 'Batch message 23').click();
    cy.contains('3 selected').should('be.visible');

    cy.contains('button', 'Delete').click();
    cy.get('[role="dialog"]').contains('button', 'Delete').click();

    cy.window({ timeout: 30000 }).should((win) => {
      const state = (win as any).__store__.getState();
      const msgs = (state.status.entries as { message: string }[]).map((e) => e.message);
      expect(msgs, 'completion status entry').to.include('Deleted 3 messages');
    });

    cy.then(() => {
      expect(deleteTimes, 'three DELETE requests').to.have.length(3);
      const firstToLast = deleteTimes[2] - deleteTimes[0];
      expect(firstToLast, 'two ~1s gaps, no hidden service pre-delay')
        .to.be.within(1800, 3400);
    });
  });
});
