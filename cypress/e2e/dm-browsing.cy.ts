describe('DM Browsing', () => {
  beforeEach(() => {
    cy.login();
  });

  it('switches to DM list when clicking "DMs" tab', () => {
    cy.contains('button', 'DMs').click();
    cy.contains('Direct Messages').should('be.visible');
  });

  it('shows DM recipients from fixture', () => {
    cy.contains('button', 'DMs').click();
    cy.wait('@getDMs');
    cy.contains('alice_dev').should('be.visible');
    cy.contains('bob_gamer').should('be.visible');
    cy.contains('charlie_mod').should('be.visible');
  });

  it('filters DM list when searching', () => {
    cy.contains('button', 'DMs').click();
    cy.wait('@getDMs');
    cy.get('input[placeholder="Search DMs..."]').type('alice');
    cy.contains('alice_dev').should('be.visible');
    cy.contains('bob_gamer').should('not.exist');
  });

  it('loads DM messages and shows header after selecting a DM', () => {
    cy.selectDm('alice_dev');
    cy.contains('Direct Message').should('be.visible');
    cy.contains('[data-testid="message-feed-row"]', 'Hey, did you see the latest build?').should('exist');
  });

  it('shows message action buttons for DM messages', () => {
    cy.selectDm('alice_dev');
    cy.contains('0 selected').should('be.visible');
    cy.contains('button', 'Delete').should('exist');
    cy.contains('button', 'Edit').should('exist');
  });

  describe('Group DM distinction (#227)', () => {
    const API = '**/api/v10';

    const recipient = (id: string, username: string, globalName: string) => ({
      id,
      username,
      discriminator: '0',
      avatar: null,
      global_name: globalName,
    });

    beforeEach(() => {
      // LIFO override of the login-time DM intercept: one 1:1 DM plus a
      // named and an unnamed group (type 3).
      cy.fixture('dms.json').then((dms) => {
        cy.intercept('GET', `${API}/users/@me/channels`, {
          statusCode: 200,
          body: [
            dms[0], // alice_dev 1:1
            {
              id: '910000000000000001',
              type: 3,
              name: 'Book Club',
              last_message_id: null,
              recipients: [
                recipient('911000000000000001', 'dana_reads', 'Dana'),
                recipient('911000000000000002', 'eli_reads', 'Eli'),
              ],
            },
            {
              id: '910000000000000002',
              type: 3,
              name: null,
              last_message_id: null,
              recipients: [recipient('911000000000000003', 'frank_lurks', 'Frank')],
            },
          ],
        }).as('getDMs');
      });
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
    });

    it('shows a Group chip with member count on group DMs only', () => {
      cy.get('[data-testid="group-dm-indicator"]').should('have.length', 2);
      cy.contains('[data-testid="group-dm-indicator"]', 'Group · 3 members').should('exist');
      cy.contains('[data-testid="group-dm-indicator"]', 'Group · 2 members').should('exist');
      cy.contains('alice_dev').should('be.visible');
    });

    it('titles a named group by its custom name and an unnamed one by member usernames', () => {
      cy.contains('Book Club').should('be.visible');
      // Unnamed groups derive their title from usernames, never a
      // recipient's display name (that would read as a 1:1 DM).
      cy.contains('frank_lurks').should('be.visible');
    });
  });

  describe('Open DM by ID (#240)', () => {
    const API = '**/api/v10';
    const CLOSED_DM_ID = '502000000000000009';

    // A closed 1:1 DM (type 1) that GET /users/@me/channels never returns —
    // exactly the channel the Open-DM-by-ID escape hatch exists for.
    const closedDm = {
      id: CLOSED_DM_ID,
      type: 1,
      last_message_id: null,
      recipients: [
        {
          id: '999888777666555444',
          username: 'ghost_user',
          discriminator: '0',
          avatar: null,
          global_name: 'Ghost',
        },
      ],
    };

    const submitChannelInput = (input: string) => {
      // Tooltip-wrapped IconButton in the list header.
      cy.get('[data-testid="open-dm-by-id-button"]').click({ force: true });
      cy.get('[data-testid="open-dm-by-id-input"]').type(input);
      cy.get('[data-testid="open-dm-by-id-confirm"]').click();
    };

    // #242: each failure mode surfaces its own inline guidance, mapped in
    // DMList from the thunk's distinct rejection payloads. Beyond the
    // message we assert the shared user-facing outcome: dialog stays open,
    // nothing gets upserted into the list, nothing gets selected.
    const expectInlineFailure = (message: string) => {
      cy.contains(message).should('be.visible');
      cy.get('[data-testid="open-dm-by-id-input"]').should('exist');
      cy.window().then((win) => {
        const state = (win as any).__store__.getState().dm;
        expect(state.dms.map((d: { id: string }) => d.id)).to.not.include(
          CLOSED_DM_ID,
        );
        expect(state.selectedDm).to.equal(null);
      });
    };

    beforeEach(() => {
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
    });

    it('opens a closed DM by channel ID: upserts it into the list and selects it', () => {
      cy.intercept('GET', `${API}/channels/${CLOSED_DM_ID}`, {
        statusCode: 200,
        body: closedDm,
      }).as('getChannelById');

      submitChannelInput(CLOSED_DM_ID);
      cy.wait('@getChannelById');

      // Dialog closes as soon as the channel is confirmed.
      cy.get('[data-testid="open-dm-by-id-input"]').should('not.exist');

      // Channel is prepended to the sidebar list and selected like a
      // clicked row, which kicks off the message load.
      cy.contains('ghost_user').should('be.visible');
      cy.wait('@getMessages');
      cy.window().then((win) => {
        const state = (win as any).__store__.getState().dm;
        expect(state.selectedDm?.id).to.equal(CLOSED_DM_ID);
        expect(state.dms.map((d: { id: string }) => d.id)).to.include(
          CLOSED_DM_ID,
        );
      });
    });

    it('accepts a pasted discord.com/channels/@me link', () => {
      cy.intercept('GET', `${API}/channels/${CLOSED_DM_ID}`, {
        statusCode: 200,
        body: closedDm,
      }).as('getChannelById');

      submitChannelInput(
        `https://discord.com/channels/@me/${CLOSED_DM_ID}`,
      );
      cy.wait('@getChannelById');

      cy.get('[data-testid="open-dm-by-id-input"]').should('not.exist');
      cy.contains('ghost_user').should('be.visible');
    });

    it('shows the inline error on 403 (missing access) and keeps the dialog open', () => {
      cy.intercept('GET', `${API}/channels/${CLOSED_DM_ID}`, {
        statusCode: 403,
        body: { message: 'Missing Access', code: 50001 },
      }).as('getChannelForbidden');

      submitChannelInput(CLOSED_DM_ID);
      cy.wait('@getChannelForbidden');
      expectInlineFailure('Discord refused access to that channel.');
    });

    it('shows the inline error on 404 (unknown channel) and keeps the dialog open', () => {
      cy.intercept('GET', `${API}/channels/${CLOSED_DM_ID}`, {
        statusCode: 404,
        body: { message: 'Unknown Channel', code: 10003 },
      }).as('getChannelMissing');

      submitChannelInput(CLOSED_DM_ID);
      cy.wait('@getChannelMissing');
      expectInlineFailure('Discord has no channel with that ID.');
    });

    it('rejects a fetched channel that is not a DM (guild text channel)', () => {
      // 200 response, but ChannelType 0 (GUILD_TEXT) — the thunk must
      // refuse to upsert it into the DM list.
      cy.intercept('GET', `${API}/channels/${CLOSED_DM_ID}`, {
        statusCode: 200,
        body: {
          id: CLOSED_DM_ID,
          type: 0,
          guild_id: '901000000000000001',
          position: 1,
          name: 'general',
          nsfw: false,
          last_message_id: null,
        },
      }).as('getGuildChannel');

      submitChannelInput(CLOSED_DM_ID);
      cy.wait('@getGuildChannel');
      expectInlineFailure('That ID belongs to a server channel, not a DM.');
    });

    it('rejects unparseable input locally without any network call', () => {
      cy.get('[data-testid="open-dm-by-id-button"]').click({ force: true });
      cy.get('[data-testid="open-dm-by-id-input"]').type('not-a-channel-id');
      cy.get('[data-testid="open-dm-by-id-confirm"]').click();

      cy.contains(
        'Enter a 17-20 digit channel ID or a discord.com/channels/@me link.',
      ).should('be.visible');
      cy.get('[data-testid="open-dm-by-id-input"]').should('exist');
    });

    // #223 Facet B: user-id mode. createDm (POST /users/@me/channels)
    // returns the existing DM channel or creates one, so a single call
    // covers both closed and never-opened conversations.
    describe('user-id mode (#223 Facet B)', () => {
      const GHOST_USER_ID = '999888777666555444';

      const submitUserInput = (input: string, toggleMode = true) => {
        cy.get('[data-testid="open-dm-by-id-button"]').click({ force: true });
        if (toggleMode) {
          cy.get('[data-testid="open-dm-by-id-mode-user"]').click();
        }
        cy.get('[data-testid="open-dm-by-id-input"]').type(input);
        cy.get('[data-testid="open-dm-by-id-confirm"]').click();
      };

      it('opens the DM for a user ID: resolves the channel, upserts and selects it', () => {
        cy.intercept('POST', `${API}/users/@me/channels`, {
          statusCode: 200,
          body: closedDm,
        }).as('createDm');

        submitUserInput(GHOST_USER_ID);
        cy.wait('@createDm').its('request.body').should('deep.equal', {
          recipient_id: GHOST_USER_ID,
        });

        cy.get('[data-testid="open-dm-by-id-input"]').should('not.exist');
        cy.contains('ghost_user').should('be.visible');
        cy.wait('@getMessages');
        cy.window().then((win) => {
          const state = (win as any).__store__.getState().dm;
          expect(state.selectedDm?.id).to.equal(CLOSED_DM_ID);
        });
      });

      it('shows the cannot-open guidance on a 400 (invalid or deleted recipient)', () => {
        cy.intercept('POST', `${API}/users/@me/channels`, {
          statusCode: 400,
          body: { message: 'Invalid Recipient(s)', code: 50033 },
        }).as('createDmRejected');

        submitUserInput(GHOST_USER_ID);
        cy.wait('@createDmRejected');

        cy.contains("deleted accounts can't be messaged").should('be.visible');
        cy.get('[data-testid="open-dm-by-id-input"]').should('exist');
        cy.window().then((win) => {
          const state = (win as any).__store__.getState().dm;
          expect(state.selectedDm).to.equal(null);
        });
      });

      it('auto-switches to user mode for a pasted discord.com/users link', () => {
        cy.intercept('POST', `${API}/users/@me/channels`, {
          statusCode: 200,
          body: closedDm,
        }).as('createDm');

        // No toggle click — the profile URL flips the mode by itself.
        submitUserInput(`https://discord.com/users/${GHOST_USER_ID}`, false);
        cy.wait('@createDm');
        cy.contains('ghost_user').should('be.visible');
      });
    });
  });

  describe('DM sort order (#248)', () => {
    const API = '**/api/v10';

    // Snowflake for a given ms timestamp: (ms - epoch) << 22. The shared
    // dms.json fixture can't exercise the sort — its last_message_ids
    // differ only below bit 22, so they decode to the same millisecond.
    const snowflakeAt = (ms: number) =>
      ((BigInt(ms) - 1420070400000n) << 22n).toString();

    const sortDm = (id: string, username: string, lastMessageMs: number | null) => ({
      id,
      type: 1,
      last_message_id: lastMessageMs === null ? null : snowflakeAt(lastMessageMs),
      recipients: [
        { id: `${id}9`, username, discriminator: '0', avatar: null, global_name: username },
      ],
    });

    beforeEach(() => {
      // LIFO override of the login-time DM intercept: API order is
      // alice (oldest), bob, charlie (newest).
      cy.intercept('GET', `${API}/users/@me/channels`, {
        statusCode: 200,
        body: [
          sortDm('501000000000000001', 'alice_dev', Date.UTC(2023, 0, 1)),
          sortDm('501000000000000002', 'bob_gamer', Date.UTC(2024, 0, 1)),
          sortDm('501000000000000003', 'charlie_mod', Date.UTC(2025, 0, 1)),
        ],
      }).as('getDMs');
    });

    it('sorts by recent activity by default and honours the Display setting', () => {
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');

      // charlie has the newest last message, so the default recent-first
      // sort reverses the API order.
      cy.get('[data-testid="dm-row"] .MuiListItemText-primary').eq(0).should('contain.text', 'charlie_mod');
      cy.get('[data-testid="dm-row"] .MuiListItemText-primary').eq(1).should('contain.text', 'bob_gamer');
      cy.get('[data-testid="dm-row"] .MuiListItemText-primary').eq(2).should('contain.text', 'alice_dev');

      // Flip to Discord's order in Settings › Display and save.
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]').contains('button', 'Display').click();
      // Language, Date Format, Time Format, DM List Order.
      cy.get('[role="dialog"]').find('[role="combobox"]').eq(3).click();
      cy.get('[role="listbox"]').contains("Discord's order").click();
      cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
      cy.get('[role="dialog"]').contains('Settings saved').should('be.visible');
      cy.get('[role="dialog"]').contains('button', /^Cancel$/).click();
      cy.get('[role="dialog"]').should('not.exist');

      // The sidebar re-sorts live to the API's order.
      cy.get('[data-testid="dm-row"] .MuiListItemText-primary').eq(0).should('contain.text', 'alice_dev');
      cy.get('[data-testid="dm-row"] .MuiListItemText-primary').eq(1).should('contain.text', 'bob_gamer');
      cy.get('[data-testid="dm-row"] .MuiListItemText-primary').eq(2).should('contain.text', 'charlie_mod');
    });
  });
});
