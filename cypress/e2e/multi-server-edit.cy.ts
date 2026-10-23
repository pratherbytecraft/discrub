/**
 * 2.2.7 (GitHub 16): multi-Server edit.
 *
 * Select several servers in the server list's multi-select mode, click
 * Edit, type the new text, confirm, and the run walks every server in
 * order: load its channels, rewrite the signed-in user's messages in each
 * readable channel, then move to the next server. One operation, one
 * pause / cancel, per-server headers in the status log. Mirrors
 * multi-server-purge.cy.ts.
 */
const API = 'https://discord.com/api/v10';
const CURRENT_USER_ID = '111222333444555666';

const stubSearch = (perChannelMessages: Record<string, string[]>) => {
  const served = new Set<string>();
  cy.intercept('GET', `${API}/guilds/*/messages/search*`, (req) => {
    const url = new URL(req.url);
    const channelId = url.searchParams.get('channel_id') ?? '';
    const ids = perChannelMessages[channelId] ?? [];
    if (ids.length === 0 || served.has(channelId)) {
      req.reply({ statusCode: 200, body: { total_results: 0, messages: [] } });
      return;
    }
    served.add(channelId);
    req.reply({
      statusCode: 200,
      body: {
        total_results: ids.length,
        messages: ids.map((id) => [{
          id,
          type: 0,
          content: `hello from ${id}`,
          channel_id: channelId,
          author: { id: CURRENT_USER_ID, username: 'Discrub Tester', discriminator: '0', avatar: null },
          attachments: [],
          embeds: [],
          mentions: [],
          reactions: [],
          pinned: false,
          timestamp: '2024-01-01T00:00:00.000Z',
          hit: true,
        }]),
      },
    });
  }).as('search');
};

const textChannel = (id: string, name: string, guildId: string) => ({
  id, type: 0, guild_id: guildId, position: 0, name, topic: null, nsfw: false, last_message_id: null,
});

const selectServers = (...names: string[]) => {
  cy.get('[aria-label="Toggle multi-select"]').first().click();
  for (const name of names) cy.contains(name).click();
};

const openEdit = (text = 'redacted') => {
  cy.get('[aria-label="Edit selected servers"]').click();
  cy.get('[role="dialog"]').should('be.visible');
  cy.get('[aria-label="New message content"]').type(text);
  cy.contains('button', /^Edit 2 servers$/).click();
};

/** Bulk edit has no isEditing-style wait helper in the log; retry until the entry lands. */
const verifyStatusEntry = (text: string | RegExp) => {
  cy.window({ timeout: 30000 }).should((win) => {
    const store = (win as any).__store__;
    const messages = (store.getState().status.entries || []).map((e: any) => e.message);
    const found = typeof text === 'string' ? messages.some((m: string) => m.includes(text)) : messages.some((m: string) => text.test(m));
    expect(found, `status entry ${String(text)}`).to.equal(true);
  });
};

/** Zero operation delays so the walk runs at test speed. */
const zeroDelays = () => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    const zeroed = { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0' };
    store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: zeroed });
  });
};

describe('Multi-server edit (2.2.7)', () => {
  beforeEach(() => {
    cy.login();
    zeroDelays();
    cy.intercept('GET', `${API}/guilds/*/channels`, (req) => {
      const guildId = req.url.split('/guilds/')[1].split('/')[0];
      const byGuild: Record<string, unknown[]> = {
        '901000000000000001': [
          { id: '801000000000000005', type: 4, guild_id: guildId, position: 0, name: 'Text Channels' },
          textChannel('811000000000000001', 'general', guildId),
          textChannel('811000000000000002', 'dev-chat', guildId),
        ],
        '901000000000000002': [textChannel('812000000000000001', 'lobby', guildId)],
        '901000000000000003': [textChannel('813000000000000001', 'announcements', guildId)],
      };
      req.reply({ statusCode: 200, body: byGuild[guildId] ?? [] });
    }).as('getChannels');
    cy.intercept('PATCH', `${API}/channels/*/messages/*`, { statusCode: 200, body: {} }).as('editMessage');
  });

  it('shows Edit in server multi-select and opens the servers dialog', () => {
    selectServers('Gaming Lounge', 'Dev Community');
    cy.get('[aria-label="Edit selected servers"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains('Edit Servers').should('be.visible');
    cy.get('[role="dialog"]').contains('2 servers').should('be.visible');
    cy.get('[role="dialog"]').contains(/Gaming Lounge, Dev Community/).should('be.visible');
    cy.get('[role="dialog"]').contains('Server edits target your own messages').should('be.visible');
    cy.get('[data-testid="bulk-edit-confirm"]').should('be.disabled');
    cy.get('[aria-label="New message content"]').type('x');
    cy.get('[data-testid="bulk-edit-confirm"]').should('be.enabled').and('have.text', 'Edit 2 servers');
  });

  it('edits every own message in each readable channel of each selected server, in order, as one operation', () => {
    stubSearch({
      '811000000000000001': ['1001'],
      '811000000000000002': ['1002'],
      '812000000000000001': ['2001'],
    });
    selectServers('Cypress Test Server', 'Gaming Lounge');
    openEdit();

    cy.wait(['@editMessage', '@editMessage', '@editMessage'], { timeout: 20000 }).then((interceptions) => {
      const edited = interceptions.map((i) => i.request.url.split('/messages/')[1]);
      expect(edited).to.deep.equal(['1001', '1002', '2001']);
      for (const i of interceptions) expect(i.request.body).to.deep.equal({ content: 'redacted' });
    });
    cy.get('@search.all').then((calls) => {
      const authors = (calls as { request: { url: string } }[]).map((c) => new URL(c.request.url).searchParams.get('author_id'));
      expect(authors.every((a) => a === CURRENT_USER_ID)).to.equal(true);
    });

    verifyStatusEntry('Bulk edit: Starting across 2 servers');
    verifyStatusEntry('Bulk edit: Server 1 of 2 · Cypress Test Server');
    verifyStatusEntry('Bulk edit: Cypress Test Server · 2 channels to process');
    verifyStatusEntry('Bulk edit: Server 2 of 2 · Gaming Lounge');
    verifyStatusEntry('Bulk edit: Gaming Lounge complete · 1 edited');
    verifyStatusEntry(/Bulk edit: Complete · 2 of 2 servers, 3 edited/);
  });

  it('reports a server whose channels cannot be loaded and continues with the rest', () => {
    cy.intercept('GET', `${API}/guilds/901000000000000002/channels`, { statusCode: 403, body: { message: 'Missing Access' } }).as('forbiddenChannels');
    stubSearch({ '813000000000000001': ['3001'] });
    selectServers('Gaming Lounge', 'Dev Community');
    openEdit();

    cy.wait('@forbiddenChannels');
    cy.wait('@editMessage', { timeout: 20000 }).its('request.url').should('contain', '/messages/3001');
    verifyStatusEntry('Bulk edit: Gaming Lounge · could not load channels (HTTP 403), skipped');
    verifyStatusEntry(/Bulk edit: Complete · 1 of 2 servers, 1 edited/);
  });

  it('cancel stops after the current server', () => {
    cy.intercept('GET', `${API}/guilds/901000000000000001/messages/search*`, (req) => {
      req.reply({ statusCode: 200, delay: 1500, body: { total_results: 0, messages: [] } });
    }).as('slowSearch');
    selectServers('Cypress Test Server', 'Gaming Lounge');
    openEdit();

    cy.wait('@slowSearch', { timeout: 20000 });
    cy.get('[aria-label="Stop"]').click({ force: true });

    verifyStatusEntry(/Bulk edit: Cancelled · 1 of 2 servers/);
    cy.window().then((win) => {
      const messages = ((win as any).__store__.getState().status.entries || []).map((e: any) => e.message);
      expect(messages.some((m: string) => m.includes('Bulk edit: Server 2 of 2'))).to.equal(false);
    });
  });
});
