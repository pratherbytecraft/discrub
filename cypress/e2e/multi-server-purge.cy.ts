/**
 * #255 — Multi-server purge.
 *
 * Select several servers in the server list's multi-select mode, click
 * Purge, confirm, and the run walks every server in order: load its
 * channels, purge the signed-in user's messages in each readable
 * channel, then move to the next server. One operation, one pause /
 * cancel, per-server headers in the status log.
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

const stubThreads = () => {
  cy.intercept('GET', `${API}/guilds/*/threads/active`, { statusCode: 200, body: { threads: [], members: [] } });
  cy.intercept('GET', `${API}/channels/*/threads/archived/public*`, { statusCode: 200, body: { threads: [], has_more: false } });
  cy.intercept('GET', `${API}/channels/*/threads/archived/private*`, { statusCode: 200, body: { threads: [], has_more: false } });
  cy.intercept('GET', `${API}/channels/*/users/@me/threads/archived/private*`, { statusCode: 200, body: { threads: [], has_more: false } });  // #257: the final pass reads each channel's newest page once; keep it
  // empty so the shared messages fixture doesn't add deletions here.
  cy.intercept('GET', `${API}/channels/*/messages?*`, { statusCode: 200, body: [] }).as('getNewestPage');
};

const textChannel = (id: string, name: string, guildId: string) => ({
  id, type: 0, guild_id: guildId, position: 0, name, topic: null, nsfw: false, last_message_id: null,
});

const selectServers = (...names: string[]) => {
  cy.get('[aria-label="Toggle multi-select"]').first().click();
  for (const name of names) cy.contains(name).click();
};

const expandLog = () => cy.get('[aria-label="Expand log"]').click();

/** Zero operation delays so the walk runs at test speed. Dispatched as
 *  updateAllSettings.fulfilled so the service singleton is rebuilt. */
const zeroDelays = () => {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    const zeroed = { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0' };
    store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: zeroed });
  });
};

describe('Multi-server purge (#255)', () => {
  beforeEach(() => {
    cy.login();
    zeroDelays();
    stubThreads();
    // Distinct channel lists per server (LIFO override of the default
    // fixture registered by interceptDiscordApi).
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
    cy.intercept('DELETE', `${API}/channels/*/messages/*`, { statusCode: 204, body: {} }).as('deleteMessage');
  });

  it('shows Purge in server multi-select and opens the servers dialog', () => {
    selectServers('Gaming Lounge', 'Dev Community');
    cy.get('[aria-label="Purge selected servers"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains('Purge Servers').should('be.visible');
    cy.get('[role="dialog"]').contains('2 servers').should('be.visible');
    cy.get('[role="dialog"]').contains(/Gaming Lounge, Dev Community/).should('be.visible');
    cy.get('[role="dialog"]').contains('Server purges target your own messages').should('be.visible');
    // Reaction modes are single-server only.
    cy.get('[role="dialog"]').find('button[value="reactions"]').should('not.exist');
    cy.get('[role="dialog"]').find('button[value="messages"]').should('have.attr', 'aria-pressed', 'true');
  });

  it('purges every readable channel in each selected server, in order, as one operation', () => {
    stubSearch({
      '811000000000000001': ['1001'],
      '811000000000000002': ['1002'],
      '812000000000000001': ['2001'],
    });
    selectServers('Cypress Test Server', 'Gaming Lounge');
    cy.get('[aria-label="Purge selected servers"]').click();
    cy.contains('button', 'Purge 2 Servers').click();

    cy.wait(['@deleteMessage', '@deleteMessage', '@deleteMessage'], { timeout: 20000 }).then((interceptions) => {
      const deleted = interceptions.map((i) => i.request.url.split('/messages/')[1]);
      expect(deleted).to.deep.equal(['1001', '1002', '2001']);
    });

    cy.contains(/Server (1|2)\/2/, { timeout: 10000 }).should('exist');
    expandLog();
    cy.contains('Purge: Starting operation across 2 servers', { timeout: 10000 }).should('exist');
    cy.contains('Purge: Server 1 of 2 · Cypress Test Server').should('exist');
    cy.contains('Purge: Cypress Test Server · 2 channels to process').should('exist');
    cy.contains('Purge: Server 2 of 2 · Gaming Lounge').should('exist');
    cy.contains(/Purge: Gaming Lounge complete · 1 channel/).should('exist');
    cy.contains(/Purge: Complete · 2 of 2 servers/, { timeout: 15000 }).should('exist');
    cy.contains('Purge complete', { timeout: 10000 }).should('exist');
  });

  it('reports a server whose channels cannot be loaded and continues with the rest', () => {
    cy.intercept('GET', `${API}/guilds/901000000000000002/channels`, { statusCode: 403, body: { message: 'Missing Access' } }).as('forbiddenChannels');
    stubSearch({ '813000000000000001': ['3001'] });
    selectServers('Gaming Lounge', 'Dev Community');
    cy.get('[aria-label="Purge selected servers"]').click();
    cy.contains('button', 'Purge 2 Servers').click();

    cy.wait('@forbiddenChannels');
    cy.wait('@deleteMessage', { timeout: 20000 }).its('request.url').should('contain', '/messages/3001');

    expandLog();
    cy.contains('Purge: Gaming Lounge · could not load channels (HTTP 403), skipped').should('exist');
    cy.contains(/Purge: Complete · 1 of 2 servers/, { timeout: 15000 }).should('exist');
    cy.contains(/Purge finished, but 1 channel had errors/, { timeout: 10000 }).should('exist');
  });

  it('cancel stops after the current server', () => {
    // Slow the first server's search so Cancel lands mid-run.
    cy.intercept('GET', `${API}/guilds/901000000000000001/messages/search*`, (req) => {
      req.reply({ statusCode: 200, delay: 1500, body: { total_results: 0, messages: [] } });
    }).as('slowSearch');
    selectServers('Cypress Test Server', 'Gaming Lounge');
    cy.get('[aria-label="Purge selected servers"]').click();
    cy.contains('button', 'Purge 2 Servers').click();

    cy.wait('@slowSearch', { timeout: 20000 });
    cy.get('[aria-label="Cancel"]').click({ force: true });

    expandLog();
    cy.contains(/Purge: Cancelled · 1 of 2 servers/, { timeout: 15000 }).should('exist');
    cy.contains('Purge: Server 2 of 2').should('not.exist');
  });

  it('pause holds the run at a server boundary and resume continues into the next server', () => {
    stubSearch({ '812000000000000001': ['2001'] });
    // Registered after the general stub so it wins (LIFO) for server 1.
    cy.intercept('GET', `${API}/guilds/901000000000000001/messages/search*`, (req) => {
      req.reply({ statusCode: 200, delay: 800, body: { total_results: 0, messages: [] } });
    }).as('firstServerSearch');
    selectServers('Cypress Test Server', 'Gaming Lounge');
    cy.get('[aria-label="Purge selected servers"]').click();
    cy.contains('button', 'Purge 2 Servers').click();

    cy.wait('@firstServerSearch', { timeout: 20000 });
    cy.get('[aria-label="Pause"]').click({ force: true });
    cy.contains(/Paused/, { timeout: 10000 }).should('exist');
    // While paused, the second server is never touched.
    cy.wait(1500);
    cy.get('@getChannels.all').then((calls) => {
      const urls = (calls as { request: { url: string } }[]).map((c) => c.request.url);
      expect(urls.some((u) => u.includes('901000000000000002'))).to.equal(false);
    });

    cy.get('[aria-label="Resume"]').click({ force: true });
    cy.wait('@deleteMessage', { timeout: 20000 }).its('request.url').should('contain', '/messages/2001');
    expandLog();
    cy.contains(/Purge: Complete · 2 of 2 servers/, { timeout: 15000 }).should('exist');
  });

  it('a rate-limit storm in a later server stops the whole run (#254 + #255)', () => {
    stubSearch({ '811000000000000001': ['1001'], '811000000000000002': ['1002'] });
    // Second server's search is rate limited every time; core gives up
    // after five in a row and the app cancels the operation.
    cy.intercept('GET', `${API}/guilds/901000000000000002/messages/search*`, (req) => {
      req.reply({
        statusCode: 429,
        headers: { 'retry-after': '0' },
        body: { message: 'Too many requests', retry_after: 0, global: false },
      });
    }).as('stormSearch');
    selectServers('Cypress Test Server', 'Gaming Lounge');
    cy.get('[aria-label="Purge selected servers"]').click();
    cy.contains('button', 'Purge 2 Servers').click();

    cy.wait(['@deleteMessage', '@deleteMessage'], { timeout: 20000 });
    cy.contains(/Stopped: Discord is rate limiting this account/i, { timeout: 20000 }).should('exist');
    expandLog();
    cy.contains(/Stopped the operation to protect your account/i).should('exist');
    cy.contains(/Purge: Cancelled · /, { timeout: 15000 }).should('exist');
    cy.contains(/Purge: Complete · 2 of 2 servers/).should('not.exist');
  });
});
