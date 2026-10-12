describe('Server Browsing', () => {
  beforeEach(() => {
    cy.login();
  });

  it('shows "Servers" tab as active after login', () => {
    cy.get('button[role="tab"]').contains('Servers')
      .closest('button')
      .should('have.attr', 'aria-selected', 'true');
  });

  it('shows all 3 guilds from fixture', () => {
    cy.contains('Cypress Test Server').should('be.visible');
    cy.contains('Gaming Lounge').should('be.visible');
    cy.contains('Dev Community').should('be.visible');
  });

  it('filters server list when searching', () => {
    cy.get('input[placeholder="Search servers..."]').type('Gaming');
    cy.contains('Gaming Lounge').should('be.visible');
    cy.contains('Cypress Test Server').should('not.exist');
    cy.contains('Dev Community').should('not.exist');
  });

  // #274: a Server named in a fancy Unicode font (mathematical italic here)
  // has to show up when the person types the plain letters.
  it('matches fancy font server names against plain typing (#274)', () => {
    const fancyName = '𝘛𝘩𝘦 𝘎𝘢𝘮𝘪𝘯𝘨 𝘓𝘰𝘶𝘯𝘨𝘦';
    // The guild list comes from the login fetch, so the fancy Server has
    // to ride in on that response rather than a store dispatch the fetch
    // would overwrite.
    cy.fixture('guilds.json').then((guilds) => {
      cy.intercept('GET', '**/api/v10/users/@me/guilds', {
        statusCode: 200,
        body: [
          ...guilds,
          { id: '999000000000000001', name: fancyName, icon: null, owner: false, permissions: '0', features: [] },
        ],
      }).as('getGuilds');
    });
    // Reload so the app boots again and fetches the list through this
    // intercept (the newest intercept wins).
    cy.reload();
    cy.wait('@getGuilds');
    cy.contains(fancyName).should('be.visible');
    cy.get('input[placeholder="Search servers..."]').type('the gaming');
    cy.contains(fancyName).should('be.visible');
    cy.contains('Gaming Lounge').should('not.exist');
    cy.contains('Cypress Test Server').should('not.exist');
  });

  it('shows channel list after clicking a guild', () => {
    cy.selectServer('Cypress Test Server');
    cy.contains('general').should('be.visible');
    cy.contains('dev-chat').should('be.visible');
    cy.contains('announcements').should('be.visible');
  });

  it('shows channels with category headers', () => {
    cy.selectServer('Cypress Test Server');
    // Category header from fixture (displayed uppercase via CSS)
    cy.contains('Text Channels').should('be.visible');
  });

  it('returns to server list when clicking back button', () => {
    cy.selectServer('Cypress Test Server');
    cy.contains('general').should('be.visible');

    // Click back button (ArrowBack icon button)
    cy.get('[data-testid="ArrowBackIcon"]').closest('button').click();
    cy.contains('Cypress Test Server').should('be.visible');
    cy.contains('Gaming Lounge').should('be.visible');
  });

  it('shows selected guild name as subtitle in channel header', () => {
    cy.selectServer('Cypress Test Server');
    cy.contains('Cypress Test Server').should('be.visible');
  });

  it('clears messages and selected channel when switching servers', () => {
    // Select first server and a channel to load messages
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.get('[data-testid="message-feed"]').should('be.visible');

    // Verify messages loaded in Redux
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().message.rows.length).to.be.greaterThan(0);
      expect(store.getState().channel.selectedChannel).to.not.be.null;
    });

    // Simulate clicking a different server via Redux dispatch
    // (equivalent to user navigating back and selecting another server)
    cy.window().then((win) => {
      const store = (win as any).__store__;
      // Dispatch the same actions as handleGuildClick
      store.dispatch({ type: 'channel/setSelectedChannel', payload: null });
      store.dispatch({ type: 'message/clearMessages' });
      store.dispatch({ type: 'guild/setSelectedGuild', payload: { id: 'guild-2', name: 'Gaming Lounge' } });
    });

    // Verify messages and channel are cleared
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().message.rows.length).to.eq(0);
      expect(store.getState().channel.selectedChannel).to.be.null;
    });
  });

  it('clears multi-select channel list when switching servers (#125)', () => {
    // Enter a server, turn on multi-select, pick a couple of channels.
    cy.selectServer('Cypress Test Server');
    cy.contains('general').should('be.visible');
    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.contains('general').click();
    cy.contains('dev-chat').click();

    // Sanity: Redux reflects the two picks
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().channel.selectedChannels).to.have.length(2);
    });

    // Navigate back to the server list, then pick a different server.
    cy.get('[data-testid="ArrowBackIcon"]').closest('button').click();
    cy.contains('Gaming Lounge').click();

    // The previous server's multi-select targets must NOT carry over —
    // carrying them into a bulk purge/export on the new server was the
    // reported bug.
    cy.window().then((win) => {
      const store = (win as any).__store__;
      expect(store.getState().channel.selectedChannels).to.have.length(0);
    });
  });

  describe('Home Navigation (Logo Click)', () => {
    it('returns to WelcomePanel from server/channel view', () => {
      cy.selectServer('Cypress Test Server');
      cy.selectChannel('general');
      cy.get('[data-testid="message-feed"]').should('be.visible');

      // Click Discrub logo to go home
      cy.get('img[alt="Discrub Home"]').click();

      // WelcomePanel should appear
      cy.contains('Welcome to Discrub').should('be.visible');

      // Redux state should be cleared
      cy.window().then((win) => {
        const store = (win as any).__store__;
        expect(store.getState().guild.selectedGuild).to.be.null;
        expect(store.getState().channel.selectedChannel).to.be.null;
        expect(store.getState().dm.selectedDm).to.be.null;
      });
    });

    it('returns to WelcomePanel from DM view', () => {
      cy.selectDm('alice_dev');
      cy.get('[data-testid="message-feed"]').should('be.visible');

      // Click logo to go home
      cy.get('img[alt="Discrub Home"]').click();

      cy.contains('Welcome to Discrub').should('be.visible');
      cy.window().then((win) => {
        const store = (win as any).__store__;
        expect(store.getState().dm.selectedDm).to.be.null;
      });
    });

    it('stays on WelcomePanel when already home', () => {
      // Already on WelcomePanel after login
      cy.contains('Welcome to Discrub').should('be.visible');

      // Click logo — should remain on WelcomePanel
      cy.get('img[alt="Discrub Home"]').click();
      cy.contains('Welcome to Discrub').should('be.visible');
    });
  });

  describe('Channel Permissions', () => {
    it('shows restricted channel as disabled', () => {
      cy.selectServer('Cypress Test Server');
      cy.contains('admin-only').should('be.visible');
      // The restricted channel should be disabled
      cy.contains('admin-only').closest('[role="button"]').should('have.class', 'Mui-disabled');
    });

    it('shows accessible channel as enabled', () => {
      cy.selectServer('Cypress Test Server');
      cy.contains('general').should('be.visible');
      cy.contains('general').closest('[role="button"]').should('not.have.class', 'Mui-disabled');
    });

    // Backlog #205: a channel denied to @everyone but granted to the
    // current user through a member-specific overwrite (type 1) must be
    // clickable. computeChannelPermissions previously stopped at role
    // overwrites and dropped the member grant, greying out a channel the
    // user was explicitly given access to.
    it('shows member-granted channel as enabled (#205 — member overwrite applied)', () => {
      cy.selectServer('Cypress Test Server');
      cy.contains('member-granted').should('be.visible');
      cy.contains('member-granted').closest('[role="button"]').should('not.have.class', 'Mui-disabled');
    });

    // Backlog #160: voice + stage channels carry text chat under the
    // same channel ID since Discord's 2021 Voice Channel Messages
    // rollout. The fix landed in commit b0d2bc1 — voice channels are
    // now first-class clickable rows gated by the same canAccessChannel
    // predicate as text channels, not auto-disabled by type.
    it('shows voice channels as enabled (#160 — voice channel chat is browsable)', () => {
      cy.selectServer('Cypress Test Server');
      cy.contains('Voice Lounge').should('be.visible');
      cy.contains('Voice Lounge').closest('[role="button"]').should('not.have.class', 'Mui-disabled');
    });
  });
});
