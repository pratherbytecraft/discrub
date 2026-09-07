const API = '**/api/v10';

/**
 * Set up thread discovery intercepts (guild channels only).
 * Public archived, private archived, joined private archived.
 */
/**
 * #257: after search runs dry the purge reads the channel's newest page
 * once (list endpoint, no cursor). Default it to empty so the shared
 * messages.json fixture (5 by the current user) doesn't add final-pass
 * deletions to the exact-count assertions below. Tests that exercise the
 * final pass override this LIFO.
 */
const interceptFinalPassEmpty = () => {
  cy.intercept('GET', `${API}/channels/*/messages?*`, {
    statusCode: 200,
    body: [],
  }).as('getNewestPage');
};

const interceptThreadDiscovery = (options?: {
  publicThreads?: object;
  privateThreads?: object;
  joinedPrivateThreads?: object;
}) => {
  // Public archived threads (default includes threads from active-guild-threads.json)
  cy.fixture('active-guild-threads.json').then((activeData) => {
    cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
      statusCode: 200,
      body: options?.publicThreads ?? activeData,
    }).as('getPublicThreads');
  });

  // Private archived threads
  cy.fixture('archived-threads-empty.json').then((data) => {
    cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, {
      statusCode: 200,
      body: options?.privateThreads ?? data,
    }).as('getPrivateThreads');
  });

  // Joined private archived threads (fallback)
  cy.fixture('archived-threads-empty.json').then((data) => {
    cy.intercept(
      'GET',
      `${API}/channels/*/users/@me/threads/archived/private*`,
      {
        statusCode: 200,
        body: options?.joinedPrivateThreads ?? data,
      },
    ).as('getJoinedPrivateThreads');
  });
  interceptFinalPassEmpty();
};

/**
 * Set up search + delete intercepts for messages mode purge.
 * Returns search results on first call, empty on second (pagination end).
 */
const interceptMessagesPurge = (options?: {
  searchFixture?: string;
  channelPattern?: string;
}) => {
  const searchFixture = options?.searchFixture ?? 'bulk-purge-search-results.json';
  const channelPattern = options?.channelPattern ?? '*';

  // Track search call count for pagination simulation
  let searchCallCount = 0;

  cy.fixture(searchFixture).then((searchResults) => {
    cy.fixture('bulk-purge-search-empty.json').then((emptyResults) => {
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCallCount++;
        // First call returns results, subsequent calls return empty (simulates all deleted)
        req.reply({
          statusCode: 200,
          body: searchCallCount === 1 ? searchResults : emptyResults,
        });
      }).as('searchMessages');

      // Also intercept channel-level search (for DMs)
      cy.intercept('GET', `${API}/channels/${channelPattern}/messages/search*`, (req) => {
        searchCallCount++;
        req.reply({
          statusCode: 200,
          body: searchCallCount === 1 ? searchResults : emptyResults,
        });
      }).as('searchChannelMessages');
    });
  });

  interceptFinalPassEmpty();

  // Delete message
  cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
    statusCode: 204,
    body: {},
  }).as('deleteMessage');

  // Edit message (for retain attachments)
  cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
    statusCode: 200,
    body: {},
  }).as('editMessage');
};

/**
 * Set up intercepts for reactions mode purge.
 */
const interceptReactionsPurge = () => {
  // Messages with reactions (for cursor-based channel fetch)
  cy.fixture('bulk-purge-messages-with-reactions.json').then((messages) => {
    cy.intercept('GET', `${API}/channels/*/messages?*`, {
      statusCode: 200,
      body: messages,
    }).as('getMessagesForReactions');
  });

  // Get reactors for a specific emoji
  cy.fixture('reacting-users.json').then((users) => {
    cy.intercept('GET', `${API}/channels/*/messages/*/reactions/*`, {
      statusCode: 200,
      body: users,
    }).as('getReactions');
  });

  // Delete reaction
  cy.intercept('DELETE', `${API}/channels/*/messages/*/reactions/*/*`, {
    statusCode: 204,
    body: {},
  }).as('deleteReaction');
};

/**
 * Enter multi-select mode and select channels by name.
 */
const selectChannelsForPurge = (...channelNames: string[]) => {
  cy.get('[aria-label="Toggle multi-select"]').first().click();
  for (const name of channelNames) {
    cy.contains(name).click();
  }
};

/**
 * Open BulkPurgeDialog by clicking the purge button.
 */
const openPurgeDialog = (context: 'channels' | 'DMs' = 'channels') => {
  // #135 cleanup renamed the DM bulk action aria-label to use the
  // existing "conversations" terminology convention.
  const label = context === 'channels' ? 'Purge selected channels' : 'Purge selected conversations';
  cy.get(`[aria-label="${label}"]`).click();
  cy.get('[role="dialog"]').should('be.visible');
};

/**
 * Select a user in the UserPicker by typing their ID and clicking the lookup option.
 *
 * Handles both the legacy inline UserPicker (Reactions mode, DM disabled
 * mode) AND the post-#112 filter-modal flow for guild Messages /
 * Attachments Only. If an "Add filters" button is present in the outer
 * dialog, we open the filter modal, set the "From" author there, and
 * apply. Otherwise we fall back to the inline picker path.
 */
const addUserById = (userId: string) => {
  cy.get('[role="dialog"]').first().then(($outer) => {
    // Reactions mode renders an inline UserPicker for the reactor target
    // (its "Add filters" button only controls optional narrowing, not the
    // target). Messages / Attachments Only modes have no inline picker —
    // the FilterModal IS the target. Detect by presence of the inline
    // input rather than by the Add-filters button.
    const inlineInput = $outer.find('input[placeholder="Type to search or paste a User ID"]');
    if (inlineInput.length > 0) {
      // Inline UserPicker path (Reactions mode, DM info banner)
      cy.wrap(inlineInput).first().clear().type(userId);
      cy.get('[role="listbox"]').contains(/Look up/).click();
    } else {
      // Filter-modal path (guild Messages / Attachments Only)
      const addFilters = $outer.find('button[aria-label="Add filters"]');
      cy.wrap(addFilters).click();
      // FilterModal is the most recently opened dialog
      cy.get('[role="dialog"]')
        .last()
        .find('input[placeholder="Type to search or paste a User ID"]')
        .first()
        .clear()
        .type(userId);
      cy.get('[role="listbox"]').contains(/Look up/).click();
      cy.get('body').type('{esc}');
      // Apply and close the filter modal
      cy.get('[role="dialog"]')
        .last()
        .contains('button', /Apply filters|Search/)
        .click();
    }
  });
};

/**
 * Click the confirm button in BulkPurgeDialog.
 * Covers all four mode button labels: "Purge N Ch.s", "Strip Attachments (N)",
 * "Remove Reactions (N)", "Clear Reactions (N)".
 */
const confirmPurge = () => {
  // Close any open autocomplete dropdown first
  cy.get('body').type('{esc}');
  cy.get('[role="dialog"]')
    .contains('button', /Purge|Strip Attachments|Remove Reactions|Clear Reactions/)
    .click({ force: true });
};

/**
 * Wait for the purge to complete by checking Redux state.
 */
const waitForPurgeComplete = (timeout = 30000) => {
  cy.window({ timeout }).should((win) => {
    const store = (win as any).__store__;
    if (store) {
      const purgeState = store.getState().purge;
      expect(purgeState.isPurging).to.eq(false);
    }
  });
};

/**
 * Verify purge Redux state.
 */
const verifyPurgeState = (assertions: (purgeState: any) => void) => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    if (store) {
      assertions(store.getState().purge);
    }
  });
};

/**
 * Verify status log contains an entry matching the given text.
 */
const verifyStatusEntry = (text: string | RegExp) => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    if (store) {
      const statusState = store.getState().status;
      const entries = statusState.entries || [];
      const messages = entries.map((e: any) => e.message);
      if (typeof text === 'string') {
        expect(messages.some((m: string) => m.includes(text))).to.be.true;
      } else {
        expect(messages.some((m: string) => text.test(m))).to.be.true;
      }
    }
  });
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Bulk Purge Operations', () => {
  describe('Channel Multi-Select Purge Button', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
    });

    it('should show Purge button when channels are selected in multi-select mode', () => {
      selectChannelsForPurge('general');
      cy.get('[aria-label="Purge selected channels"]').should('be.visible');
    });

    it('should not show Purge button with no selections', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Purge selected channels"]').should('not.exist');
    });

    it('should open BulkPurgeDialog when clicking Purge', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();
      cy.contains('Purge Channels').should('be.visible');
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '1 of');
    });

    it('should show multiple selected channels in dialog', () => {
      selectChannelsForPurge('general', 'dev-chat');
      openPurgeDialog();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '2 of');
      cy.get('[role="dialog"]').contains('general').should('be.visible');
      cy.get('[role="dialog"]').contains('dev-chat').should('be.visible');
    });
  });

  describe('BulkPurgeDialog UI', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      selectChannelsForPurge('general');
      openPurgeDialog();
    });

    it('should show all four mode buttons (Messages / Attachments Only / Reactions / Clear All Reactions)', () => {
      cy.get('[role="dialog"]').find('button[value="messages"]').should('be.visible');
      cy.get('[role="dialog"]').find('button[value="attachmentsOnly"]').should('be.visible');
      cy.get('[role="dialog"]').find('button[value="reactions"]').should('be.visible');
      // clearReactions only surfaces when canManageMessages is true; that path is exercised in the Clear-All-Reactions describe below.
    });

    it('should default to Messages mode', () => {
      cy.get('[role="dialog"]')
        .find('button[value="messages"]')
        .should('have.attr', 'aria-pressed', 'true');
    });

    it('should show Target messages section with Add filters button in Messages mode (#112)', () => {
      cy.get('[role="dialog"]').contains('Target messages').should('be.visible');
      // Filter modal is the target surface in guild Messages mode.
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').should('be.visible');
    });

    it('should switch to Reactions mode and relabel picker', () => {
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();
      cy.get('[role="dialog"]')
        .find('button[value="reactions"]')
        .should('have.attr', 'aria-pressed', 'true');
      cy.get('[role="dialog"]')
        .contains('Remove reactions from')
        .should('be.visible');
    });

    it('should show inline "Clear text, keep attachments" checkbox in Messages mode', () => {
      // MUI wraps its checkbox input with opacity: 0; assert on the visible label text.
      cy.get('[role="dialog"]')
        .contains('Clear text, keep attachments')
        .should('be.visible');
    });

    it('should hide the "Clear text, keep attachments" checkbox in Attachments Only mode', () => {
      cy.get('[role="dialog"]').find('button[value="attachmentsOnly"]').click();
      cy.get('[role="dialog"]')
        .contains('Clear text, keep attachments')
        .should('not.exist');
    });

    it('should hide the "Clear text, keep attachments" checkbox in Reactions mode', () => {
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();
      cy.get('[role="dialog"]')
        .contains('Clear text, keep attachments')
        .should('not.exist');
    });

    it('should not render the old Advanced Options / Delete attachments only UI', () => {
      cy.get('[role="dialog"]').contains('Advanced Options').should('not.exist');
      cy.get('[role="dialog"]')
        .find('input[aria-label="Delete attachments only"]')
        .should('not.exist');
    });

    it('should show irreversibility warning', () => {
      cy.get('[role="dialog"]')
        .contains('irreversible')
        .scrollIntoView()
        .should('be.visible');
    });

    it('should close dialog on Cancel', () => {
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('should disable confirm button when no users selected', () => {
      cy.get('[role="dialog"]')
        .find('button.MuiButton-containedError')
        .should('be.disabled');
    });

    it('shows ID-only helper text and placeholder inside the filter modal', () => {
      // Post-#112: in guild Messages mode the UserPicker lives inside
      // FilterModal, not at the dialog top level. Open the modal and
      // verify the ID-only guidance renders there.
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().within(() => {
        cy.contains(/right-click a user in Discord.*Copy User ID/i).should('be.visible');
        cy.get('input[placeholder="Type to search or paste a User ID"]').first().should('be.visible');
      });
    });

    it('filter modal: Refine section is hidden for bulk purge (#112)', () => {
      // hideRefineSection prop on FilterModal suppresses the "Refine"
      // block since bulk ops don't load messages into a table first.
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().within(() => {
        cy.contains('Search').should('be.visible'); // Search section header
        cy.contains('Refine').should('not.exist');
      });
    });

    it('filter modal: applying a target author surfaces a filter chip row and enables confirm (#112)', () => {
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      // Confirm is disabled at rest (no filter, no author).
      cy.get('[role="dialog"]')
        .contains('button', /Purge/)
        .should('be.disabled');

      addUserById('111222333444555666');
      cy.wait('@lookupUser');

      // Back in the outer dialog: single "Edit filters (N)" button
      // replaces the old chip + Clear pair. Clearing lives inside the
      // FilterModal itself ("Clear (N)" in its Search action bar).
      cy.get('[role="dialog"]').first().within(() => {
        cy.get('button[aria-label="Edit filters"]').should('be.visible').and('contain', '(1)');
        cy.get('button[aria-label="Clear filters"]').should('not.exist');
      });
      cy.get('[role="dialog"]')
        .contains('button', /Purge/)
        .should('not.be.disabled');
    });
  });

  describe('Permission gating (Backlog #139)', () => {
    // The Cypress Test Server guild perms include MANAGE_MESSAGES, but a
    // per-channel @everyone overwrite can deny it. We override the channels
    // intercept before login so the guild loads with one allowed and one
    // permission-denied channel, then verify the dialog locks the target
    // picker with the channel-name copy variant.
    const DENY_MANAGE_MESSAGES = String(1 << 13);
    const GUILD_ID = '901000000000000001';

    beforeEach(() => {
      // Login first (which registers default channel intercepts via
      // interceptDiscordApi), then register a LIFO override that wins for
      // the channel-list fetch on the upcoming selectServer.
      cy.login();
      cy.intercept('GET', `${API}/guilds/*/channels`, {
        statusCode: 200,
        body: [
          {
            id: '801000000000000005',
            type: 4,
            guild_id: GUILD_ID,
            position: 0,
            name: 'Text Channels',
            topic: null,
            nsfw: false,
            last_message_id: null,
          },
          {
            id: '801000000000000001',
            type: 0,
            guild_id: GUILD_ID,
            position: 1,
            name: 'general',
            topic: 'General discussion',
            nsfw: false,
            last_message_id: null,
            parent_id: '801000000000000005',
          },
          {
            id: '801000000000000099',
            type: 0,
            guild_id: GUILD_ID,
            position: 2,
            name: 'staff-only',
            topic: 'Mods only',
            nsfw: false,
            last_message_id: null,
            parent_id: '801000000000000005',
            permission_overwrites: [
              { id: GUILD_ID, type: 0, allow: '0', deny: DENY_MANAGE_MESSAGES },
            ],
          },
        ],
      }).as('getChannels');

      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
    });

    it('locks target picker with channel-name copy when MANAGE missing in some selected channels', () => {
      selectChannelsForPurge('general', 'staff-only');
      openPurgeDialog();

      cy.get('[role="dialog"]')
        .contains('You can only target your own messages. Manage Messages missing in #staff-only. Deselect to unlock.')
        .should('be.visible');

      // Confirm the locked target dispatches with current user (no Add-filters required)
      cy.get('[role="dialog"]')
        .contains('button', /Purge 2 Ch\.s/)
        .should('not.be.disabled');
    });

    it('does not lock when only fully-permitted channels are selected', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      cy.get('[role="dialog"]')
        .contains(/Manage Messages missing/)
        .should('not.exist');
      // BulkFilterButton is the target surface when no lock applies
      cy.get('[role="dialog"]')
        .find('button[aria-label="Add filters"]')
        .should('be.visible');
    });
  });

  describe('Selected Channels Summary Pill', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
    });

    it('shows a compact summary pill by default (no scrollable list)', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();
      // Pill is a click-to-expand affordance with aria-label
      cy.get('[role="dialog"]')
        .find('[aria-label="Selected channels"]')
        .should('be.visible')
        .and('have.attr', 'aria-expanded', 'false');
    });

    it('expands the channel list when the pill is clicked', () => {
      selectChannelsForPurge('general', 'dev-chat');
      openPurgeDialog();
      cy.get('[role="dialog"]')
        .find('[aria-label="Selected channels"]')
        .click()
        .should('have.attr', 'aria-expanded', 'true');
      // Full channel labels render inside the expanded list
      cy.get('[role="dialog"]').contains('# general').should('be.visible');
      cy.get('[role="dialog"]').contains('# dev-chat').should('be.visible');
    });

    it('collapses the channel list on a second click', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();
      const pill = () =>
        cy.get('[role="dialog"]').find('[aria-label="Selected channels"]');
      pill().click().should('have.attr', 'aria-expanded', 'true');
      pill().click().should('have.attr', 'aria-expanded', 'false');
    });
  });

  describe('Messages Mode — Guild Channels with Thread Discovery', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      // Set up thread discovery intercepts
      interceptThreadDiscovery();
      // Set up search + delete intercepts
      interceptMessagesPurge();

      // Mock user lookup for adding target user
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('should execute messages mode purge with thread discovery', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      // Add target user via lookup (routes through filter modal in guild Messages mode)
      addUserById('111222333444555666');
      cy.wait('@lookupUser');

      // Post-#112: outer dialog shows a single "Edit filters (N)" button
      // instead of the old user chip. The chip naming the user lives
      // inside the (now-closed) FilterModal.
      cy.get('[role="dialog"]').first().find('button[aria-label="Edit filters"]').should('be.visible');

      // Confirm purge
      confirmPurge();

      // Dialog should close
      cy.get('[role="dialog"]').should('not.exist');

      // Wait for purge to complete
      waitForPurgeComplete();

      // Verify thread discovery was called
      cy.get('@getPublicThreads.all').should('have.length.gte', 1);

      // Verify search was called (includes thread IDs in search criteria)
      cy.get('@searchMessages.all').should('have.length.gte', 1);

      // Verify messages were deleted
      cy.get('@deleteMessage.all').should('have.length.gte', 1);

      // Verify purge state is clean
      verifyPurgeState((purge) => {
        expect(purge.isPurging).to.eq(false);
        expect(purge.purgeError).to.eq(null);
      });

      // Verify status log has completion entry
      verifyStatusEntry(/Purge: Complete/);
    });

    it('should include thread IDs in search criteria', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // The search call should include thread channel_id params
      cy.get('@searchMessages.all').then((calls) => {
        const firstCall = calls[0] as any;
        const url = firstCall.request.url;
        // Thread ID 802000000000000001 from active-guild-threads.json
        expect(url).to.include('channel_id');
      });
    });

    it('#257: final pass deletes a matching message the search index missed and reports it', () => {
      // Search returns 3 messages by the target (fixture). The newest page
      // holds one more by the target that search never surfaced, plus one
      // by someone else, plus one already seen via search.
      cy.fixture('bulk-purge-search-results.json').then((searchResults) => {
        const seen = searchResults.messages[0][0];
        const fresh = { ...seen, id: '780000000000000099', content: 'posted a second ago' };
        const theirs = { ...seen, id: '780000000000000098', author: { ...seen.author, id: '222333444555666777', username: 'someone_else' } };
        cy.intercept('GET', `${API}/channels/*/messages?*`, {
          statusCode: 200,
          body: [fresh, theirs, seen],
        }).as('getNewestPage');
      });

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();

      cy.get('@getNewestPage.all').should('have.length', 1);
      cy.get('@deleteMessage.all').should('have.length', 4);
      cy.get('@deleteMessage.all').then((calls) => {
        const urls = (calls as any[]).map((c) => c.request.url as string);
        expect(urls.some((u) => u.includes('780000000000000099')), 'fresh message deleted').to.be.true;
        expect(urls.some((u) => u.includes('780000000000000098')), 'other author untouched').to.be.false;
      });
      verifyStatusEntry('Final pass over the newest messages in #general: found 1 more to process');
      verifyStatusEntry('4 messages deleted, 1 from the final pass');
    });

    it('should purge multiple channels sequentially', () => {
      selectChannelsForPurge('general', 'dev-chat');
      openPurgeDialog();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '2 of');

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      // Sequential 2-channel purge legitimately overshoots the default
      // 30s window under CI/parallel-Vitest load (each channel runs the
      // full search + thread-discovery + delete loop with delay
      // randomization). 60s matches the explicit override used for the
      // larger "mix of empty and non-empty channels" test below.
      waitForPurgeComplete(60000);

      // Verify completion status log
      verifyStatusEntry(/Purge: Complete.*2 channel/);
    });
  });

  describe('Messages Mode — Deleted-Account History Scan (#223)', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      interceptThreadDiscovery();
      interceptMessagesPurge();
      // The history scan walks the list endpoint, so restore the shared
      // messages fixture over the #257 empty default (LIFO).
      cy.fixture('messages.json').then((messages) => {
        cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
          req.reply({ statusCode: 200, body: req.url.includes('before=') ? [] : messages });
        }).as('getMessages');
      });

      // Deleted-account placeholder: the post-pomelo `deleted_user_` name
      // pattern flips the purge onto the full-history scan, since Discord's
      // author_id search returns nothing for deleted accounts (#223).
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'deleted_user_a1b2c3d4',
          discriminator: '0',
          avatar: null,
          global_name: null,
        },
      }).as('lookupUser');
    });

    it('bypasses search and deletes via history scan for a deleted account', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      // The scan walks the parent channel plus every discovered thread, and
      // each one yields fixture matches — the per-delete delay randomization
      // legitimately overshoots the default 30s window (same reasoning as
      // the multi-channel test above).
      waitForPurgeComplete(90000);

      // The fallback announces itself and reports a completed scan.
      verifyStatusEntry(/account is deleted/);
      verifyStatusEntry(/Scan of .* complete/);

      // messages.json is authored by 111222333444555666, so the client-side
      // author filter matches and real deletions go out — with zero calls
      // to the search endpoint the fallback exists to avoid.
      cy.get('@deleteMessage.all').should('have.length.gte', 1);
      cy.get('@searchMessages.all').should('have.length', 0);

      verifyStatusEntry(/Purge: Complete/);
      verifyPurgeState((purge) => {
        expect(purge.isPurging).to.eq(false);
        expect(purge.purgeError).to.eq(null);
      });
    });
  });

  describe('Messages Mode — System Message Handling', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();

      // Mock user lookup
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('should skip system messages and cap-shift past them', () => {
      // First search returns 25 system messages (type 7 = member join).
      // Per #188, the iterator cap-shifts via `searchBeforeDate` (max_id)
      // on every iteration after the first, so the second call carries
      // a `max_id` derived from the oldest system-message timestamp.
      const systemMessages = {
        messages: Array.from({ length: 25 }, (_, i) => [
          {
            id: `780000000000000${String(100 + i).padStart(3, '0')}`,
            channel_id: '801000000000000001',
            author: {
              id: '111222333444555666',
              username: 'discrub_tester',
              discriminator: '0',
              avatar: 'abc123avatar',
              global_name: 'Discrub Tester',
            },
            content: '',
            timestamp: '2026-02-01T10:00:00.000Z',
            edited_timestamp: null,
            tts: false,
            mention_everyone: false,
            mentions: [],
            attachments: [],
            embeds: [],
            reactions: [],
            pinned: false,
            type: 7,
          },
        ]),
        total_results: 25,
        threads: [],
      };

      let callCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        callCount++;
        req.reply({
          statusCode: 200,
          body: callCount === 1 ? systemMessages : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // No messages should have been deleted (all were system messages)
      cy.get('@deleteMessage.all').should('have.length', 0);

      // Search should have been called twice: once with results, once returning empty.
      cy.get('@searchMessages.all').should('have.length.gte', 2);

      // First search has no max_id; second carries a cap-shifted max_id.
      cy.get('@searchMessages.all').then((calls) => {
        const firstUrl = (calls[0] as any).request.url;
        const secondUrl = (calls[1] as any).request.url;
        expect(firstUrl, 'first call').to.not.include('max_id=');
        expect(secondUrl, 'second call (cap-shifted)').to.include('max_id=');
      });
    });

    // ── Backlog #196 Phase 2 — opt-in pin-notification deletion ──────────
    // A real purge leaves the "X pinned a message" trail (type-6
    // CHANNEL_PINNED_MESSAGE) behind because the predicate skips all
    // system types. The BulkPurgeDialog "Also delete system messages"
    // section lets the user opt those types into the sweep.

    const makeSystemHandlingMsg = (id: string, type: number) => ({
      id,
      channel_id: '801000000000000001',
      author: {
        id: '111222333444555666',
        username: 'discrub_tester',
        discriminator: '0',
        avatar: 'abc123avatar',
        global_name: 'Discrub Tester',
      },
      content: type === 0 ? `msg-${id}` : '',
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

    // 2 normal (type-0) + 2 pin notifications (type-6), all by the target.
    const seedPinNotificationSearch = () => {
      const body = {
        messages: [
          [makeSystemHandlingMsg('780000000000000201', 0)],
          [makeSystemHandlingMsg('780000000000000202', 6)],
          [makeSystemHandlingMsg('780000000000000203', 0)],
          [makeSystemHandlingMsg('780000000000000204', 6)],
        ],
        total_results: 4,
        threads: [],
      };
      let callCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        callCount++;
        req.reply({
          statusCode: 200,
          body: callCount === 1 ? body : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');
      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');
    };

    it('leaves type-6 pin notifications in place when the system-message section is untouched', () => {
      seedPinNotificationSearch();
      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();
      // Only the two type-0 messages go; both pin notifications survive.
      cy.get('@deleteMessage.all').should('have.length', 2);
    });

    it('deletes type-6 pin notifications when "Pin notifications" is opted in (#196 Phase 2)', () => {
      seedPinNotificationSearch();
      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');

      // Expand the section and opt the pin-notification type into the sweep.
      cy.get('[role="dialog"]').first().contains('Also delete system messages').click();
      cy.get('[role="dialog"]')
        .first()
        .find('input[aria-label="Pin notifications"]')
        .click({ force: true });

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();
      // All four go: 2 normal + 2 pin notifications.
      cy.get('@deleteMessage.all').should('have.length', 4);
    });
  });

  describe('Reactions Mode — Guild Channels with Threads', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      interceptThreadDiscovery();
      interceptReactionsPurge();

      // Mock user lookup
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      // Thread messages for reactions mode (thread processed as sub-channel)
      cy.fixture('thread-messages.json').then((threadMsgs) => {
        // Override messages for thread channel specifically
        cy.intercept(
          'GET',
          `${API}/channels/802000000000000001/messages?*`,
          {
            statusCode: 200,
            body: threadMsgs,
          },
        ).as('getThreadMessages');
      });
    });

    it('should execute reactions mode purge', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      // Switch to Reactions mode
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();

      // Add target user
      addUserById('111222333444555666');
      cy.wait('@lookupUser');

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Verify reactions were fetched
      cy.get('@getReactions.all').should('have.length.gte', 1);

      // Verify reactions were deleted for target user
      cy.get('@deleteReaction.all').should('have.length.gte', 1);

      // Verify thread messages were also scanned for reactions
      cy.get('@getThreadMessages.all').should('have.length.gte', 1);

      // Verify status log
      verifyStatusEntry(/Reaction purge: Complete/);
    });

    // Backlog #140: cancelling mid-purge used to drop the in-flight
    // accumulator on the floor, so the summary read "Cancelled — 0
    // reactions removed" even when N had really been removed. Fix
    // attaches a partial result to CancelledError so the bulk-loop
    // catch can recover the count before breaking.
    it('reports partial count in cancel summary when cancelled mid-purge (#140)', () => {
      // Re-intercept deleteReaction with a delay so we have time to
      // fire the cancel signal mid-flight after a few removals land.
      cy.intercept('DELETE', `${API}/channels/*/messages/*/reactions/*/*`, (req) => {
        req.reply({ statusCode: 204, body: {}, delay: 150 });
      }).as('slowDeleteReaction');

      selectChannelsForPurge('general');
      openPurgeDialog();
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      // Wait until at least 1 reaction has ACTUALLY been removed
      // (status log shows the per-removal entry). The delete intercept's
      // call count counts initiated requests, not completed ones, so
      // gating on intercept count would race against the 150ms delay
      // and let cancel fire before any totalReactionsRemoved increment.
      // Threshold is 1 because the cypress reactors fixture only has a
      // single match for the target user — enough to verify the partial
      // recovers (1 > 0 distinguishes the fix from the buggy 0 behavior).
      cy.window({ timeout: 10000 }).should((win) => {
        const entries = (win as { __store__?: any }).__store__.getState().status.entries;
        const removedCount = entries.filter((e: { message: string }) =>
          /^Removed reaction \d+/.test(e.message),
        ).length;
        expect(removedCount, 'at least 1 reaction removed before cancel').to.be.gte(1);
      });

      // Cancel via Redux — same effect as clicking the cancel button
      // in PauseResumeControls but lets us trigger at a precise moment.
      cy.window().then((win) => {
        const store = (win as { __store__?: any }).__store__;
        store.dispatch({ type: 'app/setDiscrubCancelled', payload: true });
      });

      waitForPurgeComplete();

      // The summary entry should NOT read "Cancelled — 0 reactions
      // removed" — at least the deletes that already landed should
      // appear in the count.
      cy.window().should((win) => {
        const entries = (win as { __store__?: any }).__store__.getState().status.entries;
        const cancelEntry = entries.find(
          (e: { message: string }) =>
            e.message.includes('Cancelled') && e.message.includes('reactions removed'),
        );
        expect(cancelEntry, 'cancel summary entry should exist').to.not.be.undefined;
        const match = cancelEntry.message.match(/(\d+) reactions removed/);
        const count = Number(match?.[1] ?? 0);
        expect(count, 'partial count should be > 0').to.be.greaterThan(0);
      });
    });

    it('should scan parent channel and threads for reactions', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Parent channel messages should be fetched
      cy.get('@getMessagesForReactions.all').should('have.length.gte', 1);

      // Thread messages should also be fetched (thread is processed as sub-channel)
      cy.get('@getThreadMessages.all').should('have.length.gte', 1);
    });
  });

  describe('DM Purge — No Thread Discovery', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      // Switch to DMs tab
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
    });

    it('should open BulkPurgeDialog for DMs', () => {
      selectChannelsForPurge('alice_dev');
      openPurgeDialog('DMs');
      cy.contains('Purge DMs').should('be.visible');
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '1 of');
    });

    it('should restrict messages mode to current user in DMs', () => {
      selectChannelsForPurge('alice_dev');
      openPurgeDialog('DMs');

      // UserPicker should show current user and be disabled
      cy.get('[role="dialog"]')
        .contains('You can only target your own messages in DMs')
        .should('be.visible');
    });

    describe('FilterModal hideAuthorFilters wiring (Backlog #137)', () => {
      it('hides Search From + Author Type when DM Messages mode is active', () => {
        selectChannelsForPurge('alice_dev');
        openPurgeDialog('DMs');
        // Default uiMode for DMs is "messages" — target is locked to self,
        // so the FilterModal should open with author fields hidden.
        cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
        // FilterModal renders inside the same dialog tree.
        cy.get('[data-testid="filter-modal-search-from"]').should('not.exist');
        cy.get('[data-testid="filter-modal-search-author-type"]').should('not.exist');
        // Other Search fields still visible (sanity).
        cy.contains('Mentions').should('be.visible');
      });

      it('KEEPS Search From + Author Type rendered in DM Reactions mode (regression guard)', () => {
        // Critical: in DM Reactions, the reactor is locked but the
        // message-author filter is independent and required for the
        // "remove my reactions only from the other person's messages"
        // workflow. Hiding From here would silently break that.
        // Use `should('exist')` rather than `be.visible` — Author Type
        // sits below the FilterModal's initial scroll position; the
        // assertion we care about is "this UI element is rendered (the
        // conditional gate is open)", not "happens to be in viewport".
        selectChannelsForPurge('alice_dev');
        openPurgeDialog('DMs');
        cy.get('[role="dialog"]').contains('button', 'Reactions').click();
        cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
        cy.get('[data-testid="filter-modal-search-from"]').should('exist');
        cy.get('[data-testid="filter-modal-search-author-type"]').should('exist');
      });
    });

    it('should execute DM purge without thread discovery', () => {
      // Set up DM search intercepts
      let dmSearchCallCount = 0;
      cy.fixture('dm-search-results.json').then((searchResults) => {
        cy.intercept('GET', `${API}/channels/*/messages/search*`, (req) => {
          dmSearchCallCount++;
          req.reply({
            statusCode: 200,
            body: dmSearchCallCount === 1 ? searchResults : { messages: [], total_results: 0, threads: [] },
          });
        }).as('dmSearchMessages');
      });

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('dmDeleteMessage');

      selectChannelsForPurge('alice_dev');
      openPurgeDialog('DMs');

      // In DM messages mode, current user is auto-selected
      // Just confirm
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Verify messages were deleted
      cy.get('@dmDeleteMessage.all').should('have.length.gte', 1);

      // Verify status log
      verifyStatusEntry(/Purge: Complete.*1 conversation/);
    });
  });

  describe('Multi-Channel with Empty Channels', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('should handle mix of empty and non-empty channels', () => {
      // Simple counter-based approach: first search returns results, all others empty
      let searchCount = 0;

      cy.fixture('bulk-purge-search-results.json').then((searchResults) => {
        cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
          searchCount++;
          // Only the very first search call returns messages
          if (searchCount === 1) {
            req.reply({ statusCode: 200, body: searchResults });
          } else {
            req.reply({
              statusCode: 200,
              body: { messages: [], total_results: 0, threads: [] },
            });
          }
        }).as('searchMessages');
      });

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      selectChannelsForPurge('general', 'dev-chat', 'announcements');
      openPurgeDialog();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '3 of');

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete(60000);

      // First channel's messages should have been deleted
      cy.get('@deleteMessage.all').should('have.length', 3);

      // Verify status log shows empty channel warnings for channels 2 and 3
      verifyStatusEntry(/no messages from target users/);

      // Verify completion summary
      verifyStatusEntry(/Purge: Complete.*3 channel/);
    });
  });

  describe('Thread Discovery Fallback', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      interceptMessagesPurge();
    });

    it('should fall back to joined private threads when MANAGE_THREADS fails', () => {
      // Public threads succeed (empty)
      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
        statusCode: 200,
        body: { threads: [], members: [], has_more: false },
      }).as('getPublicThreads');

      // Private threads FAIL (user lacks MANAGE_THREADS)
      cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, {
        statusCode: 403,
        body: { message: 'Missing Permissions', code: 50013 },
      }).as('getPrivateThreadsFail');

      // Joined private threads succeed (fallback)
      cy.intercept(
        'GET',
        `${API}/channels/*/users/@me/threads/archived/private*`,
        {
          statusCode: 200,
          body: { threads: [], members: [], has_more: false },
        },
      ).as('getJoinedPrivateThreadsFallback');

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Private threads endpoint was called and failed
      cy.get('@getPrivateThreadsFail.all').should('have.length.gte', 1);

      // Fallback endpoint was called
      cy.get('@getJoinedPrivateThreadsFallback.all').should('have.length.gte', 1);

      // Purge still completed successfully
      verifyPurgeState((purge) => {
        expect(purge.isPurging).to.eq(false);
        expect(purge.purgeError).to.eq(null);
      });

      verifyStatusEntry(/Purge: Complete/);
    });

    it('should continue purge even if all thread discovery fails', () => {
      // ALL archived thread endpoints fail
      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
        statusCode: 500,
        body: { message: 'Internal Server Error' },
      }).as('getPublicThreadsFail');

      cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, {
        statusCode: 500,
        body: { message: 'Internal Server Error' },
      }).as('getPrivateThreadsFail');

      cy.intercept(
        'GET',
        `${API}/channels/*/users/@me/threads/archived/private*`,
        {
          statusCode: 500,
          body: { message: 'Internal Server Error' },
        },
      ).as('getJoinedPrivateThreadsFail');

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Messages should still have been deleted (purge continues without threads)
      cy.get('@deleteMessage.all').should('have.length.gte', 1);

      // Purge completed successfully
      verifyStatusEntry(/Purge: Complete/);
    });
  });

  describe('Purge State Management', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
    });

    it('should have clean purge state initially', () => {
      verifyPurgeState((purge) => {
        expect(purge.isPurging).to.eq(false);
        expect(purge.purgeProgress).to.eq(null);
        expect(purge.purgeError).to.eq(null);
      });
    });

    it('should set isPurging during operation', () => {
      interceptThreadDiscovery();
      interceptMessagesPurge();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      // Purge should eventually complete
      waitForPurgeComplete();

      // State should be clean after completion
      verifyPurgeState((purge) => {
        expect(purge.isPurging).to.eq(false);
      });
    });
  });

  describe('Filter criteria threading through search API (#112)', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      interceptThreadDiscovery();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('threads author + content filters into the Discord search URL', () => {
      // Capture every search request's URL — we assert below that the
      // filter criteria round-trip into URL query params correctly.
      const searchUrls: string[] = [];
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchUrls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
      }).as('filteredSearch');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, { statusCode: 204, body: {} }).as('deleteMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();

      // Open the filter modal and apply author + content filters.
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().within(() => {
        // "From" — first Paste-ID input in the modal (Mentions is second).
        cy.get('input[placeholder="Type to search or paste a User ID"]').first().type('111222333444555666');
      });
      // Lookup option sits in an MUI listbox portaled to the body.
      cy.get('[role="listbox"]').contains(/Look up/).click();
      cy.wait('@lookupUser');

      cy.get('[role="dialog"]').last().within(() => {
        cy.get('input[placeholder*="Search message content"]').type('hello');
        cy.contains('button', 'Apply filters').click();
      });

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();

      // Verify at least one search fired with BOTH criteria in the URL.
      cy.then(() => {
        expect(searchUrls.length, 'search fired').to.be.greaterThan(0);
        const withBothFilters = searchUrls.find(
          (u) => u.includes('author_id=111222333444555666') && u.includes('content=hello'),
        );
        expect(
          withBothFilters,
          `expected a search URL containing author_id + content — saw: ${searchUrls.join(' | ')}`,
        ).to.exist;
      });
    });
  });

  describe('DM Reactions Mode', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
    });

    it('should allow reactions mode in DMs with current user pre-selected', () => {
      // Set up reaction intercepts
      interceptReactionsPurge();

      selectChannelsForPurge('alice_dev');
      openPurgeDialog('DMs');

      // Switch to reactions mode — in DMs, current user is auto-selected (no Manage Messages)
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();

      // User picker should be disabled with current user pre-selected
      cy.get('[role="dialog"]')
        .contains('only remove your own reactions')
        .should('be.visible');

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      verifyStatusEntry(/Reaction purge: Complete.*1 conversation/);
    });
  });

  describe('Retain Attachments Option', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('should edit messages with attachments instead of deleting when retain is enabled', () => {
      // Search returns messages with and without attachments
      const searchWithAttachments = {
        messages: [
          [
            {
              id: '780000000000000010',
              channel_id: '801000000000000001',
              author: {
                id: '111222333444555666',
                username: 'discrub_tester',
                discriminator: '0',
                avatar: 'abc123avatar',
                global_name: 'Discrub Tester',
              },
              content: 'Message with attachment',
              timestamp: '2026-02-01T10:00:00.000Z',
              edited_timestamp: null,
              tts: false,
              mention_everyone: false,
              mentions: [],
              attachments: [
                {
                  id: '600000000000000010',
                  filename: 'photo.jpg',
                  size: 102400,
                  url: 'https://cdn.discordapp.com/attachments/test/photo.jpg',
                  proxy_url: 'https://media.discordapp.net/test/photo.jpg',
                  width: 800,
                  height: 600,
                  content_type: 'image/jpeg',
                },
              ],
              embeds: [],
              reactions: [],
              pinned: false,
              type: 0,
            },
          ],
          [
            {
              id: '780000000000000011',
              channel_id: '801000000000000001',
              author: {
                id: '111222333444555666',
                username: 'discrub_tester',
                discriminator: '0',
                avatar: 'abc123avatar',
                global_name: 'Discrub Tester',
              },
              content: 'Message without attachment',
              timestamp: '2026-02-01T11:00:00.000Z',
              edited_timestamp: null,
              tts: false,
              mention_everyone: false,
              mentions: [],
              attachments: [],
              embeds: [],
              reactions: [],
              pinned: false,
              type: 0,
            },
          ],
        ],
        total_results: 2,
        threads: [],
      };

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body: searchCount === 1 ? searchWithAttachments : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
        statusCode: 200,
        body: {},
      }).as('editMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();

      // Enable retain attachments (now an inline checkbox — no Advanced Options panel)
      cy.get('[role="dialog"]')
        .find('input[aria-label="Clear text, keep attachments"]')
        .click();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Message with attachment should have been edited, not deleted
      cy.get('@editMessage.all').should('have.length', 1);
      // Message without attachment should have been deleted
      cy.get('@deleteMessage.all').should('have.length', 1);
    });
  });

  describe('Keep Messages With Files or Links Option (#239)', () => {
    // #239 — the "Keep messages with files or links" checkbox preserves
    // any message carrying an attachment or an http(s) link ENTIRELY:
    // no DELETE, no content-clearing PATCH. Precedence: preserve wins
    // over "Clear text, keep attachments" when both are checked, so a
    // message both options could claim keeps its text too.
    const author = {
      id: '111222333444555666',
      username: 'discrub_tester',
      discriminator: '0',
      avatar: 'abc123avatar',
      global_name: 'Discrub Tester',
    };

    const baseMsg = {
      channel_id: '801000000000000001',
      author,
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      embeds: [],
      reactions: [],
      pinned: false,
      type: 0,
    };

    const attachmentMsgId = '780000000000000020';
    const linkMsgId = '780000000000000021';
    const plainMsgId = '780000000000000022';

    // One page with three messages: one bearing an attachment, one whose
    // content contains an http(s) link, one plain-text.
    const searchResults = {
      messages: [
        [
          {
            ...baseMsg,
            id: attachmentMsgId,
            content: 'Message with an attached photo',
            timestamp: '2026-02-01T10:00:00.000Z',
            attachments: [
              {
                id: '600000000000000020',
                filename: 'photo.jpg',
                size: 102400,
                url: 'https://cdn.discordapp.com/attachments/test/photo.jpg',
                proxy_url: 'https://media.discordapp.net/test/photo.jpg',
                width: 800,
                height: 600,
                content_type: 'image/jpeg',
              },
            ],
          },
        ],
        [
          {
            ...baseMsg,
            id: linkMsgId,
            content: 'check this out https://example.com/cool-thing',
            timestamp: '2026-02-01T11:00:00.000Z',
            attachments: [],
          },
        ],
        [
          {
            ...baseMsg,
            id: plainMsgId,
            content: 'plain text message with no media',
            timestamp: '2026-02-01T12:00:00.000Z',
            attachments: [],
          },
        ],
      ],
      total_results: 3,
      threads: [],
    };

    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: author,
      }).as('lookupUser');

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body: searchCount === 1 ? searchResults : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
        statusCode: 200,
        body: {},
      }).as('editMessage');
    });

    it('preserves attachment- and link-bearing messages when enabled, deletes plain ones, and reports the preserved count', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      cy.get('[role="dialog"]')
        .find('input[aria-label="Keep messages with files or links"]')
        .click();

      addUserById(author.id);
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Only the plain message is deleted; the attachment and link
      // messages are preserved — no DELETE for their IDs, no PATCH at all.
      cy.get('@deleteMessage.all').should('have.length', 1);
      cy.get('@deleteMessage.all').then((calls) => {
        const urls: string[] = (calls as any).map((c: any) => c.request.url);
        expect(urls[0], 'plain message deleted').to.include(plainMsgId);
        expect(urls.some((u) => u.includes(attachmentMsgId)), 'attachment message not deleted').to.be.false;
        expect(urls.some((u) => u.includes(linkMsgId)), 'link message not deleted').to.be.false;
      });
      cy.get('@editMessage.all').should('have.length', 0);

      // Single summary line for the two preserved messages.
      verifyStatusEntry('Preserved 2 messages with files or links, "Keep messages with files or links" is on.');
    });

    it('deletes every message, including attachment/link bearers, when the option is left off', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      // Checkbox present in Messages mode and unchecked by default.
      cy.get('[role="dialog"]')
        .find('input[aria-label="Keep messages with files or links"]')
        .should('not.be.checked');

      addUserById(author.id);
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Pre-#239 behavior intact: all three messages deleted, none edited.
      cy.get('@deleteMessage.all').should('have.length', 3);
      cy.get('@editMessage.all').should('have.length', 0);

      // No preserved-summary line when the option is off.
      cy.window().then((win) => {
        const store = (win as any).__store__;
        if (store) {
          const entries = store.getState().status.entries || [];
          const messages = entries.map((e: any) => e.message);
          expect(
            messages.some((m: string) => m.includes('Keep messages with files or links')),
            'no preserved summary when option is off',
          ).to.be.false;
        }
      });
    });

    it('preserve wins over "Clear text, keep attachments" when both are checked', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();

      // Both options are independent checkboxes and can be enabled
      // together; #239's preserve takes precedence, so the attachment
      // message keeps its text instead of being content-cleared.
      cy.get('[role="dialog"]')
        .find('input[aria-label="Clear text, keep attachments"]')
        .click();
      cy.get('[role="dialog"]')
        .find('input[aria-label="Keep messages with files or links"]')
        .click();

      addUserById(author.id);
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Retain-media alone would PATCH the attachment message; preserve
      // wins, so zero edits fire. The link message (no attachment) would
      // have been DELETEd under retain alone; preserve keeps it too.
      cy.get('@editMessage.all').should('have.length', 0);
      cy.get('@deleteMessage.all').should('have.length', 1);
      cy.get('@deleteMessage.all').then((calls) => {
        const urls: string[] = (calls as any).map((c: any) => c.request.url);
        expect(urls[0], 'only the plain message deleted').to.include(plainMsgId);
      });

      verifyStatusEntry('Preserved 2 messages with files or links, "Keep messages with files or links" is on.');
    });
  });

  describe('Attachments Only Mode', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    const makeAttachment = () => ({
      id: '600000000000000020',
      filename: 'photo.jpg',
      size: 102400,
      url: 'https://cdn.discordapp.com/attachments/test/photo.jpg',
      proxy_url: 'https://media.discordapp.net/test/photo.jpg',
      width: 800,
      height: 600,
      content_type: 'image/jpeg',
    });

    const makeMessage = (id: string, content: string, withAttachment: boolean) => ({
      id,
      channel_id: '801000000000000001',
      author: {
        id: '111222333444555666',
        username: 'discrub_tester',
        discriminator: '0',
        avatar: 'abc123avatar',
        global_name: 'Discrub Tester',
      },
      content,
      timestamp: '2026-02-01T10:00:00.000Z',
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: withAttachment ? [makeAttachment()] : [],
      embeds: [],
      reactions: [],
      pinned: false,
      type: 0,
    });

    it('strips attachments from messages that have them and leaves attachment-free messages alone', () => {
      const searchResult = {
        messages: [
          [makeMessage('780000000000000020', 'Has media', true)],
          [makeMessage('780000000000000021', 'Plain text only', false)],
        ],
        total_results: 2,
        threads: [],
      };

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body: searchCount === 1 ? searchResult : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      cy.intercept('PATCH', `${API}/channels/*/messages/*`, (req) => {
        expect(req.body).to.have.property('attachments');
        req.reply({ statusCode: 200, body: {} });
      }).as('editMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();

      // Attachments Only is now a first-class mode button, no Advanced Options
      cy.get('[role="dialog"]').find('button[value="attachmentsOnly"]').click();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // One edit (attachment stripped). The plain-text message is
      // skipped — "Attachments Only" must never DELETE
      // attachment-free messages (guards against a real regression
      // where a user lost non-attachment messages during a live purge).
      cy.get('@editMessage.all').should('have.length', 1);
      cy.get('@editMessage').its('request.body.attachments').should('deep.equal', []);
      cy.get('@deleteMessage.all').should('have.length', 0);
    });

    it('routes PATCH to message.channel_id when messages live inside threads', () => {
      // Message reports channel_id as a thread ID, distinct from the
      // top-level channel we're purging. Discord 404s the PATCH if we
      // use the parent channel (real-world pre-existing bug exposed
      // during #113 dogfood).
      const threadMsg = {
        ...makeMessage('780000000000000030', 'In a thread', true),
        channel_id: '900000000000000099',
      };

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body:
            searchCount === 1
              ? { messages: [[threadMsg]], total_results: 1, threads: [] }
              : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
        statusCode: 200,
        body: {},
      }).as('editMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();

      cy.get('[role="dialog"]').find('button[value="attachmentsOnly"]').click();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      cy.get('@editMessage').its('request.url').should('include', '/channels/900000000000000099/messages/');
    });

    it('pre-skips messages authored by other users (no PATCH call, info log)', () => {
      // Discord's PATCH (edit) endpoint is author-only. MANAGE_MESSAGES
      // grants delete powers, not edit powers. We pre-check authorship
      // and skip cleanly rather than burn an API call on a guaranteed 403.
      const othersMsg = {
        ...makeMessage('780000000000000040', 'Not my message', true),
        author: {
          id: '999000000000000000',
          username: 'other_user',
          discriminator: '0',
          avatar: null,
          global_name: 'Other User',
        },
      };

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body:
            searchCount === 1
              ? { messages: [[othersMsg]], total_results: 1, threads: [] }
              : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
        statusCode: 200,
        body: {},
      }).as('editMessage');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();
      cy.get('[role="dialog"]').find('button[value="attachmentsOnly"]').click();

      // Target: the "other user" we just authored the message as
      addUserById('999000000000000000');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // No API mutations attempted on the other user's message
      cy.get('@editMessage.all').should('have.length', 0);
      cy.get('@deleteMessage.all').should('have.length', 0);

      // Single aggregated info-level summary for the channel
      verifyStatusEntry(/authored by other users/);
    });
  });

  describe('Retain (Clear Text, Keep Attachments) — author pre-skip', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '999000000000000000',
          username: 'other_user',
          discriminator: '0',
          avatar: null,
          global_name: 'Other User',
        },
      }).as('lookupUser');
    });

    it('pre-skips messages authored by other users in Clear-text mode (no PATCH call)', () => {
      const attachment = {
        id: '600000000000000030',
        filename: 'photo.jpg',
        size: 102400,
        url: 'https://cdn.discordapp.com/attachments/test/photo.jpg',
        proxy_url: 'https://media.discordapp.net/test/photo.jpg',
        width: 800,
        height: 600,
        content_type: 'image/jpeg',
      };
      const othersMsg = {
        id: '780000000000000050',
        channel_id: '801000000000000001',
        author: {
          id: '999000000000000000',
          username: 'other_user',
          discriminator: '0',
          avatar: null,
          global_name: 'Other User',
        },
        content: 'Not my message, has media',
        timestamp: '2026-02-01T10:00:00.000Z',
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [attachment],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      };

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body:
            searchCount === 1
              ? { messages: [[othersMsg]], total_results: 1, threads: [] }
              : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('PATCH', `${API}/channels/*/messages/*`, {
        statusCode: 200,
        body: {},
      }).as('editMessage');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      selectChannelsForPurge('general');
      openPurgeDialog();

      // Enable "Clear text, keep attachments" in Messages mode
      cy.get('[role="dialog"]')
        .find('input[aria-label="Clear text, keep attachments"]')
        .click();

      addUserById('999000000000000000');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      cy.get('@editMessage.all').should('have.length', 0);
      cy.get('@deleteMessage.all').should('have.length', 0);
      verifyStatusEntry(/authored by other users/);
    });
  });

  describe('Archived Thread Un-archive (#122)', () => {
    // Thread discovery fixture where the (only) thread is archived. Each
    // test overrides the intercept locally so we can drive different
    // un-archive outcomes.
    const archivedThreadFixture = {
      threads: [
        {
          id: '802000000000000099',
          type: 11,
          guild_id: '901000000000000001',
          parent_id: '801000000000000001',
          name: 'old-archived-thread',
          owner_id: '111222333444555666',
          message_count: 5,
          member_count: 1,
          thread_metadata: {
            archived: true,
            auto_archive_duration: 4320,
            archive_timestamp: '2025-10-01T00:00:00.000Z',
            locked: false,
          },
        },
      ],
      members: [],
      has_more: false,
    };

    const emptyThreads = { threads: [], members: [], has_more: false };

    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      // Override public-archived to return the single archived thread.
      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
        statusCode: 200,
        body: archivedThreadFixture,
      }).as('getPublicThreads');
      cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, {
        statusCode: 200,
        body: emptyThreads,
      }).as('getPrivateThreads');
      cy.intercept(
        'GET',
        `${API}/channels/*/users/@me/threads/archived/private*`,
        { statusCode: 200, body: emptyThreads },
      ).as('getJoinedPrivateThreads');
      interceptFinalPassEmpty();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      // Search returns one message whose channel_id matches the archived thread.
      const msgInArchived = {
        id: '780000000000009999',
        channel_id: '802000000000000099',
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: 'Message inside archived thread',
        timestamp: '2025-10-01T10:00:00.000Z',
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

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body:
            searchCount === 1
              ? { messages: [[msgInArchived]], total_results: 1, threads: [] }
              : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');
    });

    it('un-archives the thread, processes the message, then re-archives (PATCH archived toggles both ways)', () => {
      // Two distinct PATCH calls will hit /channels/{threadId}: one with
      // archived=false (un-archive), then later archived=true (restore).
      // Track them via a req-body predicate intercept.
      const archiveCalls: Array<{ archived: boolean; url: string }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived, url: req.url });
          req.reply({ statusCode: 200, body: {} });
        } else {
          // Message-level PATCH (edit) — not exercised in this mode but
          // let it pass through for safety.
          req.reply({ statusCode: 200, body: {} });
        }
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // The message inside the archived thread was processed (DELETE fired).
      cy.get('@deleteMessage.all').should('have.length.gte', 1);

      // Un-archive first (archived: false), re-archive second (archived: true).
      cy.then(() => {
        const toggles = archiveCalls.filter((c) => c.url.includes('802000000000000099'));
        expect(toggles, 'both archive toggles fired').to.have.length(2);
        expect(toggles[0].archived, 'un-archive first').to.eq(false);
        expect(toggles[1].archived, 're-archive after').to.eq(true);
      });

      // Status log narrates both sides.
      verifyStatusEntry(/Un-archived thread/);
      verifyStatusEntry(/Re-archived thread/);
    });

    it('falls back to skipping the thread when un-archive returns 403', () => {
      // PATCH rejected — simulates a user without MANAGE_THREADS who also
      // doesn't own the thread.
      const archiveCalls: Array<{ archived: boolean; status: number }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived, status: 403 });
          req.reply({ statusCode: 403, body: { message: 'Missing Permissions', code: 50013 } });
        } else {
          req.reply({ statusCode: 200, body: {} });
        }
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // We TRIED to un-archive exactly once — cached result means no retry
      // per message. And there's no re-archive call because we never got
      // the thread out of its archived state.
      cy.then(() => {
        const toggles = archiveCalls.filter((c) => c.archived === false);
        expect(toggles, 'one un-archive attempt, no retry').to.have.length(1);
        const reArchives = archiveCalls.filter((c) => c.archived === true);
        expect(reArchives, 'no re-archive because un-archive failed').to.have.length(0);
      });

      // Message was NOT processed — fell back to skip behavior.
      cy.get('@deleteMessage.all').should('have.length', 0);

      // Single per-thread warning in the status log.
      verifyStatusEntry(/Missing permission to un-archive/);
    });
  });

  describe("Don't Wake Archived Threads Option (#233)", () => {
    // #233 — the "Don't wake archived threads" checkbox skips messages in
    // archived threads (counted + summarized) instead of the #122
    // un-archive → process → re-archive dance, so the thread never
    // resurfaces for other members. Setup mirrors the #122 block: one
    // archived thread under #general, one target message inside it.
    const archivedThreadId = '802000000000000099';

    const archivedThreadFixture = {
      threads: [
        {
          id: archivedThreadId,
          type: 11,
          guild_id: '901000000000000001',
          parent_id: '801000000000000001',
          name: 'old-archived-thread',
          owner_id: '111222333444555666',
          message_count: 5,
          member_count: 1,
          thread_metadata: {
            archived: true,
            auto_archive_duration: 4320,
            archive_timestamp: '2025-10-01T00:00:00.000Z',
            locked: false,
          },
        },
      ],
      members: [],
      has_more: false,
    };

    const emptyThreads = { threads: [], members: [], has_more: false };

    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
        statusCode: 200,
        body: archivedThreadFixture,
      }).as('getPublicThreads');
      cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, {
        statusCode: 200,
        body: emptyThreads,
      }).as('getPrivateThreads');
      cy.intercept(
        'GET',
        `${API}/channels/*/users/@me/threads/archived/private*`,
        { statusCode: 200, body: emptyThreads },
      ).as('getJoinedPrivateThreads');
      interceptFinalPassEmpty();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      // Search returns one message whose channel_id is the archived thread.
      const msgInArchived = {
        id: '780000000000009999',
        channel_id: archivedThreadId,
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: 'Message inside archived thread',
        timestamp: '2025-10-01T10:00:00.000Z',
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

      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        req.reply({
          statusCode: 200,
          body:
            searchCount === 1
              ? { messages: [[msgInArchived]], total_results: 1, threads: [] }
              : { messages: [], total_results: 0, threads: [] },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');
    });

    it('skips messages in archived threads without any un-archive PATCH when enabled, and reports both skip lines', () => {
      // Record any archive-toggling PATCH — with the opt-out on, NONE may fire.
      const archiveCalls: Array<{ archived: boolean; url: string }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived, url: req.url });
        }
        req.reply({ statusCode: 200, body: {} });
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();

      cy.get('[role="dialog"]')
        .find(`input[aria-label="Don't wake archived threads"]`)
        .click();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // The thread was never woken: zero archive toggles in either direction.
      cy.then(() => {
        expect(archiveCalls, 'no un-archive or re-archive PATCH fired').to.have.length(0);
      });

      // The message inside the archived thread was left untouched.
      cy.get('@deleteMessage.all').should('have.length', 0);

      // Per-thread announcement + end-of-run summary.
      verifyStatusEntry(`Leaving archived thread ${archivedThreadId} untouched, "Don't wake archived threads" is on`);
      verifyStatusEntry(`Left 1 message in archived threads untouched, "Don't wake archived threads" is on.`);
    });

    it('keeps the #122 un-archive path intact when the option is left off', () => {
      const archiveCalls: Array<{ archived: boolean; url: string }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived, url: req.url });
        }
        req.reply({ statusCode: 200, body: {} });
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();

      // Checkbox is present for guild purges and unchecked by default.
      cy.get('[role="dialog"]')
        .find(`input[aria-label="Don't wake archived threads"]`)
        .should('not.be.checked');

      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Pre-#233 behavior: un-archive first, delete, re-archive after.
      cy.get('@deleteMessage.all').should('have.length.gte', 1);
      cy.then(() => {
        const toggles = archiveCalls.filter((c) => c.url.includes(archivedThreadId));
        expect(toggles, 'both archive toggles fired').to.have.length(2);
        expect(toggles[0].archived, 'un-archive first').to.eq(false);
        expect(toggles[1].archived, 're-archive after').to.eq(true);
      });
      verifyStatusEntry(/Un-archived thread/);
      verifyStatusEntry(/Re-archived thread/);
    });

    it('counts archived threads the deleted-account scan excludes under the opt-out (#233/5288f33)', () => {
      // Deleted-account placeholder flips the purge onto the full-history
      // scan (#223). With the opt-out on, opted-out archived threads are
      // excluded from the walk up-front — announced per channel and
      // summarized at thread granularity, since the scan never sees the
      // messages inside them.
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'deleted_user_a1b2c3d4',
          discriminator: '0',
          avatar: null,
          global_name: null,
        },
      }).as('lookupDeletedUser');

      // Record every history fetch the scan makes; empty pages end each
      // channel's walk immediately.
      const historyUrls: string[] = [];
      cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
        historyUrls.push(req.url);
        req.reply({ statusCode: 200, body: [] });
      }).as('historyFetch');

      const archiveCalls: Array<{ archived: boolean }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived });
        }
        req.reply({ statusCode: 200, body: {} });
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();

      cy.get('[role="dialog"]')
        .find(`input[aria-label="Don't wake archived threads"]`)
        .click();

      addUserById('111222333444555666');
      cy.wait('@lookupDeletedUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // The scan announced the fallback, walked the parent channel, and
      // never fetched history for the excluded archived thread.
      verifyStatusEntry(/account is deleted/);
      cy.get('@searchMessages.all').should('have.length', 0);
      cy.then(() => {
        expect(historyUrls.length, 'parent channel history was walked').to.be.gte(1);
        expect(
          historyUrls.some((u) => u.includes(archivedThreadId)),
          'archived thread history never fetched',
        ).to.be.false;
        expect(archiveCalls, 'no archive toggles during the scan').to.have.length(0);
      });

      // Exclusion is announced per channel and counted into the run summary.
      verifyStatusEntry(`Leaving 1 archived thread in #general unscanned, "Don't wake archived threads" is on`);
      verifyStatusEntry(`Left 1 archived thread unscanned, "Don't wake archived threads" is on. Any messages inside them were not touched.`);
    });

    it('reactions mode: drops archived threads up-front and skips cross-channel hits without waking (#233)', () => {
      // Reactions family behavior differs from messages mode in two ways
      // (purgeSlice ~1840): archived threads are dropped from the
      // per-thread pass up-front (scanning them only to skip wastes API
      // budget), and cross-channel hits landing in archived siblings are
      // denied by the skipWaking guard instead of un-archived.
      const hitWithReaction = {
        id: '780000000000009999',
        channel_id: archivedThreadId,
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: 'Reacted inside the archived thread',
        timestamp: '2025-10-01T10:00:00.000Z',
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        reactions: [
          {
            emoji: { id: null, name: '❤️' },
            count: 1,
            me: true,
            me_burst: false,
            count_details: { burst: 0, normal: 1 },
            burst_colors: [],
          },
        ],
        pinned: false,
        type: 0,
      };

      // LIFO overrides of the beforeEach intercepts: the parent search
      // surfaces the reaction-bearing cross-channel hit; the around-fetch
      // returns it in full.
      const searchUrls: string[] = [];
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchUrls.push(req.url);
        req.reply({
          statusCode: 200,
          body: searchUrls.length === 1
            ? { messages: [[hitWithReaction]], total_results: 1, threads: [] }
            : { messages: [], total_results: 0, threads: [] },
        });
      }).as('reactionSearch');
      cy.intercept('GET', `${API}/channels/*/messages?*`, {
        statusCode: 200,
        body: [hitWithReaction],
      }).as('aroundFetch');
      cy.intercept('GET', `${API}/channels/*/messages/*/reactions/*`, {
        statusCode: 200,
        body: [
          {
            id: '111222333444555666',
            username: 'discrub_tester',
            discriminator: '0',
            avatar: 'abc123avatar',
            global_name: 'Discrub Tester',
          },
        ],
      }).as('getReactions');
      cy.intercept('DELETE', `${API}/channels/*/messages/*/reactions/*/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteReaction');

      const archiveCalls: Array<{ archived: boolean }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived });
        }
        req.reply({ statusCode: 200, body: {} });
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();

      cy.get('[role="dialog"]').find('button[value="reactions"]').click();

      cy.get('[role="dialog"]')
        .find(`input[aria-label="Don't wake archived threads"]`)
        .click();

      addUserById('111222333444555666');
      cy.wait('@lookupUser');

      // Content filter routes the purge through search + around-fetch —
      // the path that produces cross-channel hits (mirrors the guard
      // registry block below).
      cy.contains('button', /Add filters|Edit filters/).click();
      cy.get('[role="dialog"]')
        .last()
        .find('input[placeholder*="content"], input[placeholder*="Content"], textarea')
        .first()
        .type('archived');
      cy.get('[role="dialog"]')
        .last()
        .contains('button', /Apply filters|Search/)
        .click();

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();

      // The thread was never woken and its reaction was never removed.
      cy.then(() => {
        expect(archiveCalls, 'no archive toggles in either direction').to.have.length(0);
      });
      cy.get('@deleteReaction.all').should('have.length', 0);

      // Up-front drop means the archived thread never got a search pass of
      // its own (the filter-preview search and the parent's cap-shifted
      // follow-ups still run — count is >1 — but none scope to the thread).
      cy.then(() => {
        expect(
          searchUrls.every((u) => !u.includes(archivedThreadId)),
          'no search scoped to the dropped archived thread',
        ).to.eq(true);
      });

      // Both #233 announcements: the up-front per-channel drop and the
      // skipWaking guard denying the cross-channel hit.
      verifyStatusEntry(`Leaving 1 archived thread in #general untouched, "Don't wake archived threads" is on`);
      verifyStatusEntry(`Leaving archived thread ${archivedThreadId} untouched, "Don't wake archived threads" is on; its reactions will be skipped`);
      verifyStatusEntry(/Reaction purge: Completed/);
    });
  });

  describe('Reactions Mode — Archived Thread + Cross-Channel Routing', () => {
    // Extends the #122 un-archive flow to reactions mode, + covers the
    // 2026-04-23 dogfood follow-ups: (a) per-channel guard registry so
    // cross-channel archived-thread hits get un-archived, and (b)
    // shared seenIds dedupe so parent + thread passes don't duplicate
    // the around-fetch for the same message.

    const archivedThreadId = '802000000000000099';
    const parentChannelId = '801000000000000001'; // guild's "general"
    const thisUserId = '111222333444555666';

    const archivedThreadFixture = {
      threads: [
        {
          id: archivedThreadId,
          type: 11,
          guild_id: '901000000000000001',
          parent_id: parentChannelId,
          name: 'old-archived-thread',
          owner_id: thisUserId,
          message_count: 1,
          member_count: 1,
          thread_metadata: {
            archived: true,
            auto_archive_duration: 4320,
            archive_timestamp: '2025-10-01T00:00:00.000Z',
            locked: false,
          },
        },
      ],
      members: [],
      has_more: false,
    };

    const emptyThreads = { threads: [], members: [], has_more: false };

    // A message inside the archived thread whose channel_id points at
    // the thread, with a reaction authored by the current user. This is
    // the cross-channel hit pattern — surfaced by searching the PARENT
    // channel but hosted inside the archived sibling thread.
    const crossChannelHitMessage = {
      id: '780000000000009999',
      channel_id: archivedThreadId, // ← the cross-channel signal
      author: {
        id: thisUserId,
        username: 'discrub_tester',
        discriminator: '0',
        avatar: 'abc123avatar',
        global_name: 'Discrub Tester',
      },
      content: 'Inside the archived thread',
      timestamp: '2025-10-01T10:00:00.000Z',
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
      reactions: [
        {
          emoji: { id: null, name: '❤️' },
          count: 1,
          me: true,
          me_burst: false,
          count_details: { burst: 0, normal: 1 },
          burst_colors: [],
        },
      ],
      pinned: false,
      type: 0,
    };

    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
        statusCode: 200,
        body: archivedThreadFixture,
      }).as('getPublicThreads');
      cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, {
        statusCode: 200,
        body: emptyThreads,
      }).as('getPrivateThreads');
      cy.intercept(
        'GET',
        `${API}/channels/*/users/@me/threads/archived/private*`,
        { statusCode: 200, body: emptyThreads },
      ).as('getJoinedPrivateThreads');
      interceptFinalPassEmpty();

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: thisUserId,
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');

      // getReactions returns the current user as a reactor on the
      // targeted emoji. Covers the reactor-pagination fetch inside
      // purgeChannelReactions.
      cy.intercept('GET', `${API}/channels/*/messages/*/reactions/*`, {
        statusCode: 200,
        body: [
          {
            id: thisUserId,
            username: 'discrub_tester',
            discriminator: '0',
            avatar: 'abc123avatar',
            global_name: 'Discrub Tester',
          },
        ],
      }).as('getReactions');

      // DELETE /reactions succeeds unconditionally — assertion happens
      // on the URL that the DELETE targets.
      cy.intercept('DELETE', `${API}/channels/*/messages/*/reactions/*/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteReaction');
    });

    it('un-archives cross-channel archived thread via guard registry, re-archives in cleanup', () => {
      // Parent search surfaces a hit whose channel_id is the archived
      // thread. Thread search returns empty (no additional hits). Expect:
      //  - editChannel(archivedThreadId, {archived: false}) fires once
      //  - DELETE /reactions targets the THREAD channel (not the parent)
      //  - editChannel(archivedThreadId, {archived: true}) fires once
      let searchCount = 0;
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        searchCount++;
        if (searchCount === 1) {
          // Parent scan: surfaces cross-channel hit
          req.reply({
            statusCode: 200,
            body: {
              messages: [[crossChannelHitMessage]],
              total_results: 1,
              threads: [],
            },
          });
        } else {
          // Thread's own scan: no new hits (parent already covered it
          // via sharedSeenIds dedup)
          req.reply({
            statusCode: 200,
            body: { messages: [], total_results: 0, threads: [] },
          });
        }
      }).as('searchMessages');

      // Around-fetch returns the full message (with reactions) from the
      // thread channel. We don't differentiate list vs around via URL
      // here — Discord's `around=` param arrives as a query string on
      // the same endpoint.
      cy.intercept('GET', `${API}/channels/*/messages?*`, {
        statusCode: 200,
        body: [crossChannelHitMessage],
      }).as('aroundFetch');

      // Track every PATCH /channels/{threadId} so we can assert
      // un-archive (archived:false) and re-archive (archived:true)
      // fired in that order against the correct thread id.
      const archiveCalls: Array<{ archived: boolean; url: string }> = [];
      cy.intercept('PATCH', `${API}/channels/*`, (req) => {
        if (req.body && typeof req.body.archived === 'boolean') {
          archiveCalls.push({ archived: req.body.archived, url: req.url });
          req.reply({ statusCode: 200, body: {} });
        } else {
          req.reply({ statusCode: 200, body: {} });
        }
      }).as('patchChannel');

      selectChannelsForPurge('general');
      openPurgeDialog();

      // Switch to Reactions mode
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();

      // Target: the current user (reactor picker)
      addUserById(thisUserId);
      cy.wait('@lookupUser');

      // Apply a content filter so the purge routes through search +
      // around-fetch instead of the plain list endpoint.
      cy.contains('button', /Add filters|Edit filters/).click();
      cy.get('[role="dialog"]')
        .last()
        .find('input[placeholder*="content"], input[placeholder*="Content"], textarea')
        .first()
        .type('archived');
      cy.get('[role="dialog"]')
        .last()
        .contains('button', /Apply filters|Search/)
        .click();

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();

      // Un-archive fired BEFORE the re-archive, both on the archived
      // thread's id (not the parent).
      cy.then(() => {
        const threadToggles = archiveCalls.filter((c) =>
          c.url.includes(archivedThreadId),
        );
        expect(threadToggles, 'both archive toggles fired').to.have.length(2);
        expect(threadToggles[0].archived, 'un-archive first').to.eq(false);
        expect(threadToggles[1].archived, 're-archive after').to.eq(true);
      });

      // DELETE landed on the THREAD's channel, not the parent
      cy.get('@deleteReaction.all').then((calls) => {
        expect((calls as any).length, 'exactly one DELETE').to.eq(1);
        const url = (calls as any)[0].request.url as string;
        expect(url).to.include(`/channels/${archivedThreadId}/messages/`);
        expect(url).to.not.include(`/channels/${parentChannelId}/messages/`);
      });

      verifyStatusEntry(/Un-archived thread 802000000000000099/);
      verifyStatusEntry(/Re-archived thread 802000000000000099/);
      verifyStatusEntry(/Reaction purge: Completed/);
    });

    it('shares seenIds across parent + thread passes — only one around-fetch for cross-channel hit', () => {
      // Same cross-channel hit surfaced by BOTH the parent search AND
      // the thread's own search. With shared seenIds, the thread pass
      // skips the already-seen hit id and does NOT re-around-fetch.
      const activeThreadFixture = {
        ...archivedThreadFixture,
        threads: [
          {
            ...archivedThreadFixture.threads[0],
            thread_metadata: {
              ...archivedThreadFixture.threads[0].thread_metadata,
              archived: false, // active, to avoid un-archive noise
            },
          },
        ],
      };
      cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, {
        statusCode: 200,
        body: activeThreadFixture,
      }).as('getPublicThreads2');

      // Each pass (parent + thread) gets its own iterator. Per #188's
      // always-cap-shift model, the first call has no max_id; the
      // iterator's second call carries a cap-shifted max_id. Discord's
      // max_id is exclusive, so the cross-channel hit is structurally
      // unreachable on cap-shifted calls — return empty there.
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        const url = new URL(req.url);
        if (url.searchParams.has('max_id')) {
          req.reply({
            statusCode: 200,
            body: { messages: [], total_results: 0, threads: [] },
          });
          return;
        }
        req.reply({
          statusCode: 200,
          body: {
            messages: [[{ ...crossChannelHitMessage, reactions: [] }]],
            total_results: 1,
            threads: [],
          },
        });
      }).as('searchMessages');

      // Count around-fetches (any call with around= query param)
      let aroundCount = 0;
      cy.intercept('GET', `${API}/channels/*/messages?*around=*`, (req) => {
        aroundCount++;
        req.reply({
          statusCode: 200,
          body: [{ ...crossChannelHitMessage, reactions: [] }],
        });
      }).as('aroundFetch');

      // Fallback for any list-endpoint fetch that isn't an around call
      cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
        if (!req.url.includes('around=')) {
          req.reply({ statusCode: 200, body: [] });
        }
      });

      selectChannelsForPurge('general');
      openPurgeDialog();
      cy.get('[role="dialog"]').find('button[value="reactions"]').click();
      addUserById(thisUserId);
      cy.wait('@lookupUser');

      cy.contains('button', /Add filters|Edit filters/).click();
      cy.get('[role="dialog"]')
        .last()
        .find('input[placeholder*="content"], input[placeholder*="Content"], textarea')
        .first()
        .type('archived');
      cy.get('[role="dialog"]')
        .last()
        .contains('button', /Apply filters|Search/)
        .click();

      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete();

      // Both parent + thread searches ran (>=2 calls), but the thread
      // pass's hit was already in seenIds so only ONE around-fetch fired.
      cy.get('@searchMessages.all').should('have.length.gte', 2);
      cy.then(() => {
        expect(aroundCount, 'exactly one around-fetch across both passes').to.eq(1);
      });
    });
  });

  describe('Forum Channel Purge', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      interceptThreadDiscovery();
      interceptMessagesPurge();

      // Mock user lookup
      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('forum channel can be selected in multi-select mode', () => {
      selectChannelsForPurge('feedback');
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '1 of');
    });

    it('forum channel appears in purge dialog', () => {
      selectChannelsForPurge('feedback');
      openPurgeDialog();
      cy.get('[role="dialog"]').contains('feedback').should('be.visible');
    });

    it('purge on forum channel triggers thread discovery', () => {
      selectChannelsForPurge('feedback');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      // Thread discovery should run
      cy.wait('@getPublicThreads');
    });

    it('purge on forum channel completes without error', () => {
      selectChannelsForPurge('feedback');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');

      waitForPurgeComplete();

      // Status log should show completion
      cy.window().then((win) => {
        const store = (win as any).__store__;
        if (store) {
          const entries = store.getState().status.entries;
          const completion = entries.find((e: any) =>
            e.level === 'success' && e.message.includes('feedback')
          );
          expect(completion).to.exist;
        }
      });
    });

    it('forum channel can be purged alongside regular channels', () => {
      selectChannelsForPurge('general', 'feedback');
      openPurgeDialog();
      // Dialog displays the SelectedChannelsPill ("2 channels"), not a "selected" count.
      cy.get('[role="dialog"]').contains('2 channels').should('be.visible');
      cy.get('[role="dialog"]').contains('general').should('be.visible');
      cy.get('[role="dialog"]').contains('feedback').should('be.visible');
    });
  });

  // ── Cap-shift pagination (Backlog #186 / #188) ─────────────────────────
  //
  // scorpihoe-420 r/discrub bug: a 20,550-match channel purge stopped
  // at 98 deleted / 22 skipped. Root cause was the iterator terminating
  // after dedup-empty pages when Discord's search re-served the same
  // top-of-search slice post-reset. The lib fix (#186, generalized by
  // #188 into always-cap-shift) narrows `searchBeforeDate` to the
  // oldest yielded timestamp on every iteration, advancing past
  // already-seen messages into the older window. Discord's `max_id`
  // is exclusive so previously-yielded messages are structurally
  // unreachable on subsequent calls.
  //
  // This Cypress spec exercises the fix end-to-end through the actual
  // BulkPurgeDialog flow: select channel → configure purge → confirm →
  // verify all messages across both windows get DELETE'd.

  describe('Cap-shift pagination (Backlog #186 / #188)', () => {
    beforeEach(() => {
      cy.login();
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');

      interceptThreadDiscovery();

      // Build messages with descending timestamps so cap-shift
      // (searchBeforeDate=oldestSeenTimestamp) advances meaningfully.
      const targetUserId = '111222333444555666';
      const buildMsg = (idx: number, daysAgo: number) => ({
        id: `780000000000000${String(idx).padStart(3, '0')}`,
        channel_id: '801000000000000001',
        author: {
          id: targetUserId,
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: `cap-shift test message ${idx}`,
        timestamp: new Date(2025, 0, 30 - daysAgo).toISOString(),
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
      // Compact scenario (3 + 3 = 6 messages) so the per-delete
      // cancellableDelay budget fits in a Cypress timeout. The fix
      // mechanism is identical at any scale; 6 is enough to prove
      // cap-shift fires (need at least 1 in initial window + 1 in
      // cap-shifted window to demonstrate both branches).
      const initialWindow = Array.from({ length: 3 }, (_, i) => buildMsg(i + 1, i));
      const olderWindow = Array.from({ length: 3 }, (_, i) => buildMsg(i + 4, 3 + i));

      // Simulate Discord's max_id-exclusive cap-shift: the initial
      // window comes back when no max_id is set; once the iterator
      // narrows searchBeforeDate to the initial-window tail, the next
      // call returns the older window; any subsequent cap-shift past
      // the older-window tail returns empty (no more messages).
      const initialTailMs = new Date(
        initialWindow[initialWindow.length - 1].timestamp,
      ).getTime();
      cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
        const url = new URL(req.url);
        const maxIdParam = url.searchParams.get('max_id');
        if (!maxIdParam) {
          req.reply({
            statusCode: 200,
            body: { messages: initialWindow.map((m) => [m]), total_results: 6 },
          });
          return;
        }
        // Decode the snowflake's embedded timestamp. Discord's epoch
        // is 2015-01-01T00:00:00Z (1420070400000). Round-trips
        // exactly with the lib's generateSnowflake.
        const snowflake = BigInt(maxIdParam);
        const tsMs = Number((snowflake >> 22n) + 1420070400000n);
        // First cap-shift: max_id sits at the initial-window tail →
        // serve the older window. Any subsequent cap-shift sits at the
        // older-window tail (older still) → no more matches.
        if (tsMs === initialTailMs) {
          req.reply({
            statusCode: 200,
            body: { messages: olderWindow.map((m) => [m]), total_results: 3 },
          });
          return;
        }
        req.reply({
          statusCode: 200,
          body: { messages: [], total_results: 0 },
        });
      }).as('searchMessages');

      cy.intercept('DELETE', `${API}/channels/*/messages/*`, {
        statusCode: 204,
        body: {},
      }).as('deleteMessage');

      cy.intercept('GET', `${API}/users/*`, {
        statusCode: 200,
        body: {
          id: targetUserId,
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
      }).as('lookupUser');
    });

    it('deletes all 6 messages across initial + cap-shifted search windows', () => {
      selectChannelsForPurge('general');
      openPurgeDialog();
      addUserById('111222333444555666');
      cy.wait('@lookupUser');
      confirmPurge();
      cy.get('[role="dialog"]').should('not.exist');
      waitForPurgeComplete(60000);

      // Without #186 this would have been 3 (iterator terminated after
      // dedup-empty pages on the initial window). Cap-shift lets the
      // iterator advance past `seen` into the older window and surface
      // the remaining 3.
      cy.get('@deleteMessage.all').should('have.length', 6);

      // Sanity: the search call sequence proves cap-shift fired.
      // At least one search hit with no max_id (initial window) AND
      // at least one with max_id (cap-shifted window).
      cy.get('@searchMessages.all').then((calls) => {
        const urls = (calls as unknown as any[]).map((c) => c.request.url);
        const initialSearches = urls.filter((u: string) => !u.includes('max_id='));
        const capShiftedSearches = urls.filter((u: string) => u.includes('max_id='));
        expect(initialSearches.length, 'initial-window searches').to.be.gte(1);
        expect(capShiftedSearches.length, 'cap-shifted searches (proves #186 fix engaged)').to.be.gte(1);
      });

      verifyPurgeState((purge) => {
        expect(purge.isPurging).to.eq(false);
        expect(purge.purgeError).to.eq(null);
      });
      verifyStatusEntry(/Purge: Complete/);
    });
  });
});
