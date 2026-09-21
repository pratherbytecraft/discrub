/**
 * Pass 1 reaction enrichment for live-feed search (#163).
 *
 * Discord's `/messages/search` endpoint omits the `reactions` field on
 * returned messages. Without Pass 1 enrichment in the live thunks,
 * search-loaded messages render no reaction badges, the Remove Reactions
 * button stays disabled, and downstream exports lose reactions.
 *
 * These specs pin the user-visible end of that contract:
 *   - Setting ON  → around-fetch fires → reaction badges appear in table.
 *   - Setting OFF → no around-fetch    → no badges (faster path).
 *   - Setting ON  → enriched messages re-enable Remove Reactions button.
 *
 * The export-output side of the bug is covered by Vitest in
 * exportService.output.test.ts; we don't repeat that work in Cypress.
 */

const API = '**/api/v10';

const searchViaModal = (content: string) => {
  cy.contains('button', 'Filters').click();
  cy.get('[role="dialog"]').should('be.visible');
  cy.get('[role="dialog"]')
    .find('input[placeholder="Search message content..."]')
    .clear()
    .type(content);
  cy.get('[role="dialog"]')
    .find('button[class*="contained"]')
    .contains('Search')
    .click();
};

/**
 * Search response shape: messages without reactions, mimicking real
 * Discord behavior. The wrapping group `[[...]]` matches Discord's
 * grouped-results format.
 */
const searchResponseWithoutReactions = (count: number) => ({
  messages: [
    Array.from({ length: count }, (_, i) => ({
      id: `${700000000000000000 + i}`,
      channel_id: '801000000000000001',
      author: {
        id: '222333444555666777',
        username: 'alice_dev',
        discriminator: '0',
        avatar: 'alice_avatar',
        global_name: 'Alice',
      },
      content: `search hit ${i + 1} about reactions`,
      timestamp: `2026-02-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
      // Note: NO reactions field. Real Discord search omits it.
    })),
  ],
  total_results: count,
  threads: [],
});

/**
 * Around-fetch response: returns the queried message with a populated
 * reactions array. Discord's `?around=` window normally returns ~50
 * surrounding messages with reactions inline — for the test, returning
 * just the one queried message is enough to populate trackMap.
 */
const aroundResponseWithReactions = (messageId: string, channelId: string) => [
  {
    id: messageId,
    channel_id: channelId,
    author: {
      id: '222333444555666777',
      username: 'alice_dev',
      discriminator: '0',
      avatar: 'alice_avatar',
      global_name: 'Alice',
    },
    content: 'enriched message',
    timestamp: '2026-02-01T12:00:00.000Z',
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
    reactions: [
      { emoji: { id: null, name: '👍' }, count: 3, me: false },
    ],
  },
];

describe('Pass 1 reaction enrichment for live-feed search (#163)', () => {
  describe('REACTIONS_ENABLED = true (default)', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
    });

    it('fires around-fetches after a search and shows reaction badges in the table', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 200,
        body: searchResponseWithoutReactions(2),
      }).as('guildSearch');

      // Around-fetch intercept registered AFTER getMessages so it wins
      // (Cypress LIFO). Matches `?...around=...` only — the regular
      // list endpoint at `?limit=100&before=...` falls through to the
      // default getMessages.
      let aroundCalls = 0;
      cy.intercept('GET', `${API}/channels/*/messages?*around=*`, (req) => {
        aroundCalls += 1;
        const url = new URL(req.url);
        const messageId = url.searchParams.get('around') || '';
        const pathParts = url.pathname.split('/');
        const channelId = pathParts[pathParts.indexOf('channels') + 1] || '';
        req.reply({
          statusCode: 200,
          body: aroundResponseWithReactions(messageId, channelId),
        });
      }).as('aroundFetch');

      searchViaModal('reactions');
      cy.wait('@guildSearch');

      // Reactions render as count badges next to the emoji. Two enriched
      // messages → two reaction badges visible (one per row).
      cy.contains('search hit 1 about reactions').should('be.visible');
      cy.contains('search hit 2 about reactions').should('be.visible');

      // The reaction emoji + count combo only renders when
      // message.reactions[].length > 0 (MessageFeedRow.tsx:442). If
      // Pass 1 didn't run, no badges would render.
      cy.get('[data-testid="message-feed-row"]')
        .first()
        .find('span')
        .contains('3', { timeout: 5000 })
        .should('be.visible');

      // Confirm at least one around-fetch fired (Pass 1 is happening).
      cy.then(() => {
        expect(aroundCalls, 'at least one ?around= call').to.be.greaterThan(0);
      });
    });

    it('Remove Reactions button enables for selected enriched messages', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 200,
        body: searchResponseWithoutReactions(1),
      }).as('guildSearch');

      cy.intercept('GET', `${API}/channels/*/messages?*around=*`, (req) => {
        const url = new URL(req.url);
        const messageId = url.searchParams.get('around') || '';
        const pathParts = url.pathname.split('/');
        const channelId = pathParts[pathParts.indexOf('channels') + 1] || '';
        req.reply({
          statusCode: 200,
          body: aroundResponseWithReactions(messageId, channelId),
        });
      }).as('aroundFetch');

      searchViaModal('reactions');
      cy.wait('@guildSearch');
      cy.contains('search hit 1 about reactions').should('be.visible');

      // Click the row to select it. MUI Checkbox inputs have
      // visibility: hidden in this codebase, so click the row body.
      cy.get('[data-testid="message-feed-row"]').first().click();

      // Remove Reactions button should now be enabled (predicate is
      // `selectedMessages.some(m => (m.reactions || []).some(...))` —
      // pre-Pass-1 every selected message had reactions === undefined
      // and the predicate always returned false).
      cy.contains('button', 'Remove Reactions').should('not.be.disabled');
    });
  });

  describe('REACTIONS_ENABLED = false', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');

      // Toggle the setting via the live Redux store. Going through the
      // Settings UI would test the toggle path, not the search path —
      // this keeps the spec scoped to the bug under test.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        return store.dispatch({
          type: 'app/updateAllSettings/fulfilled',
          payload: { ...store.getState().app.settings, reactionsEnabled: 'false' },
        });
      });
    });

    it('skips around-fetches and shows no reaction badges', () => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
        statusCode: 200,
        body: searchResponseWithoutReactions(2),
      }).as('guildSearch');

      let aroundCalls = 0;
      cy.intercept('GET', `${API}/channels/*/messages?*around=*`, (req) => {
        aroundCalls += 1;
        req.reply({ statusCode: 200, body: [] });
      }).as('aroundFetch');

      searchViaModal('reactions');
      cy.wait('@guildSearch');
      cy.contains('search hit 1 about reactions').should('be.visible');

      // Settle: give the thunk a beat to do nothing further.
      cy.wait(500);

      cy.then(() => {
        expect(aroundCalls, 'no ?around= calls when setting off').to.eq(0);
      });

      // No emoji-count badges should render in the rows.
      cy.get('[data-testid="message-feed-row"]')
        .first()
        .within(() => {
          cy.contains('👍').should('not.exist');
        });
    });
  });
});
