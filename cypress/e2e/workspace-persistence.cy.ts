/**
 * Workspaces 2.2.5 WP2a: pages a conversation loads beyond its first are
 * written to the Discrub-workspaces database, a reload brings the
 * conversation back without a fetch, Load All continues from the saved
 * cursor and Start over drops the saved rows and loads from the top.
 */

const CHANNEL = 'general';

/** 100 messages per page, ids descending so `before` cursors walk down. */
function makePage(template: Record<string, unknown>, start: number, minutesApart = 1): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = start - i;
    return {
      ...template,
      id: `71000000000000${String(n).padStart(4, '0')}`,
      content: `page message ${n}`,
      timestamp: new Date(Date.UTC(2026, 1, 1, 0, 0, 0) + n * minutesApart * 60_000).toISOString(),
      reactions: [],
      attachments: [],
      embeds: [],
    };
  });
}

/**
 * A channel with two pages behind it. Call 1 answers page A, call 2 page B,
 * anything later answers nothing. With `freshFirstPageOnCall`, that call
 * answers page A again: the fresh first page Start over asks for.
 */
function interceptPagedChannel(template: Record<string, unknown>, options: { freshFirstPageOnCall?: number; minutesApart?: number } = {}) {
  const pageA = makePage(template, 9000, options.minutesApart);
  const pageB = makePage(template, 8900, options.minutesApart);
  let calls = 0;
  cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
    calls += 1;
    const body = calls === 1 || calls === options.freshFirstPageOnCall ? pageA : calls === 2 ? pageB : [];
    req.reply({ statusCode: 200, body });
  }).as('pagedMessages');
}

function countWorkspaceRows() {
  return cy.window({ log: false }).then((win) =>
    new Cypress.Promise<number>((resolve) => {
      const req = win.indexedDB.open('Discrub-workspaces');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('rows')) {
          db.close();
          resolve(0);
          return;
        }
        const count = db.transaction('rows', 'readonly').objectStore('rows').count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => {
          db.close();
          resolve(-1);
        };
      };
      req.onerror = () => resolve(-1);
    }),
  );
}

function openChannelFromDisk() {
  cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
  cy.selectServer('Cypress Test Server');
  cy.contains(CHANNEL).click();
  cy.contains('[data-testid="message-feed-row"]', 'page message 9000', { timeout: 15000 }).should('exist');
}

describe('Workspace persistence (2.2.5)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('keeps the loaded pages across a reload, restores without a fetch, and Load All continues from the cursor', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0]);

      // Opening writes nothing; the second page brings the first with it.
      cy.contains(CHANNEL).click();
      cy.wait('@pagedMessages');
      cy.contains('100 messages').should('be.visible');
      countWorkspaceRows().should('eq', 0);

      cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
      cy.wait('@pagedMessages');
      cy.contains('200 messages').should('be.visible');
      countWorkspaceRows().should('eq', 200);

      // A reload opens the same conversation from disk, no request.
      cy.reload();
      openChannelFromDisk();
      cy.contains('200 messages').should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 2);
      cy.contains('STATUS LOG').click();
      cy.contains('Restored 200 messages from this workspace').should('exist');

      // No Load All was ever cut, so the dialog reads Load All with the saved
      // count and no resume line (fix C, row 35); it still asks Discord for
      // what comes after the saved cursor.
      cy.contains('button', 'Load All').click();
      cy.get('[data-testid="load-all-restored-line"]').should('contain', '200 loaded so far in this workspace').and('not.contain', 'Resume continues');
      cy.get('[data-testid="load-all-confirm"]').should('have.text', 'Load All').click();
      cy.wait('@pagedMessages').its('request.url').should('include', 'before=710000000000008801');
      cy.contains('All loaded', { timeout: 15000 }).should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 3);
      cy.contains('200 messages').should('be.visible');
      countWorkspaceRows().should('eq', 200);
    });
  });

  it('Start over drops the saved rows and loads from the top', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0], { freshFirstPageOnCall: 3 });
      cy.contains(CHANNEL).click();
      cy.wait('@pagedMessages');
      cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
      cy.wait('@pagedMessages');
      // The page is on disk before the append reaches Redux, so the count
      // shown means the write finished.
      cy.contains('200 messages').should('be.visible');
      countWorkspaceRows().should('eq', 200);

      cy.reload();
      openChannelFromDisk();
      cy.contains('button', 'Load All').click();
      cy.get('[data-testid="load-all-start-over"]').click();

      // Fresh first page (call 3), then Load All continues from it (call 4, nothing more).
      cy.contains('All loaded', { timeout: 15000 }).should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 4);
      cy.contains('100 messages').should('be.visible');
      countWorkspaceRows().should('eq', 100);
    });
  });

  /* ─────────────── 2.2.5 WP4a: scope, action records, switching ─────────────── */

  type WorkspaceHooks = {
    switchTo: (wid: string) => Promise<unknown>;
    create: (name: string) => Promise<{ wid: string }>;
    get: (wid: string) => Promise<{ conversations: Record<string, { name: string; action: { kind: string } | null; scrollAnchorId: string | null }>; bulk: { kind: string; queue: string[]; done: string[] } | null } | null>;
  };
  const hooks = () => cy.window({ log: false }).its('__workspace__') as unknown as Cypress.Chainable<WorkspaceHooks>;

  function loadTwoPages() {
    cy.contains(CHANNEL).click();
    cy.wait('@pagedMessages');
    cy.get('[data-testid="message-feed-load-more"]').then(($btn) => { $btn[0].click(); });
    cy.wait('@pagedMessages');
    cy.contains('200 messages').should('be.visible');
    countWorkspaceRows().should('eq', 200);
  }

  it('reopens the server and channel you were in after a reload, from disk', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0]);
      loadTwoPages();
      cy.reload();
      // No click: the saved scope opens #general and its rows come back from disk.
      cy.contains('[data-testid="message-feed-row"]', 'page message 9000', { timeout: 15000 }).should('exist');
      cy.contains('200 messages').should('be.visible');
      cy.get('@pagedMessages.all').should('have.length', 2);
    });
  });

  it('saves where the feed was resting and scrolls back there after a reload', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      // Ten minutes apart so every message is its own group in the feed; the anchor is a group's first message.
      interceptPagedChannel(messages[0], { minutesApart: 10 });
      loadTwoPages();
      cy.get('[data-testid="message-feed-items"]').parent().scrollTo(0, 6000);
      cy.get('[data-testid="message-feed-items"]').parent().its('0.scrollTop').should('be.greaterThan', 1000);
      // The feed waits for scrolling to rest for 2 s before it saves the anchor.
      cy.wait(2600);
      hooks().then((h) => h.get('default')).should((record) => {
        const general = Object.values(record?.conversations ?? {}).find((c) => c.name === CHANNEL);
        expect(String(general?.scrollAnchorId), 'anchor saved below the top').to.match(/^7100/);
        expect(String(general?.scrollAnchorId), 'anchor saved below the top').not.to.eq('710000000000009000');
      });
      hooks().then((h) => h.get('default')).then((record) => {
        const anchorId = Object.values(record?.conversations ?? {}).find((c) => c.name === CHANNEL)?.scrollAnchorId as string;
        const n = Number(anchorId.slice(-4));
        cy.reload();
        cy.contains('[data-testid="message-feed-row"]', `page message ${n}`, { timeout: 15000 }).should('be.visible');
        cy.get('[data-testid="message-feed-items"]').parent().its('0.scrollTop').should('be.greaterThan', 1000);
      });
    });
  });

  it('a first Load All keeps its greyed button, reads Load All while it runs, and a Stop leaves the button there (rows 5, 27, 59)', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      const pageA = makePage(messages[0], 9000);
      const pageB = makePage(messages[0], 8900);
      let calls = 0;
      cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
        calls += 1;
        // Call 2 is the first Load All page, held so the run is still going.
        req.reply({ statusCode: 200, body: calls === 1 ? pageA : calls === 2 ? pageB : [], delay: calls === 2 ? 4000 : 0 });
      }).as('pagedMessages');
      cy.contains(CHANNEL).click();
      cy.wait('@pagedMessages');
      cy.contains('100 messages').should('be.visible');

      cy.contains('button', 'Load All').click();
      cy.get('[data-testid="load-all-confirm"]').click();
      cy.window().its('__store__').invoke('getState').its('message.pagination.isLoadingAll').should('eq', true);
      cy.contains('button', 'Load All').should('be.visible').and('be.disabled');
      cy.contains('button', 'Resume').should('not.exist');

      cy.get('[aria-label="Stop"]').first().click({ force: true });
      cy.window().its('__store__').invoke('getState').its('message.pagination.isLoadingAll', { timeout: 15000 }).should('eq', false);
      cy.contains('button', 'Load All').should('be.visible').and('not.be.disabled');
    });
  });

  it('a Load All cut short by a reload reads Resume and continues from the cursor', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      const pageA = makePage(messages[0], 9000);
      const pageB = makePage(messages[0], 8900);
      let calls = 0;
      cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
        calls += 1;
        // Call 3 is the Load All page that never answers before the reload.
        if (calls === 3) req.reply({ statusCode: 200, body: [], delay: 30000 });
        else req.reply({ statusCode: 200, body: calls === 1 ? pageA : calls === 2 ? pageB : [] });
      }).as('pagedMessages');
      loadTwoPages();

      cy.contains('button', 'Load All').click();
      cy.get('[data-testid="load-all-confirm"]').click();
      hooks().then((h) => h.get('default')).should((record) => {
        const general = Object.values(record?.conversations ?? {}).find((c) => c.name === CHANNEL);
        expect(general?.action?.kind).to.eq('loadAll');
      });

      cy.reload();
      cy.contains('[data-testid="message-feed-row"]', 'page message 9000', { timeout: 15000 }).should('exist');
      cy.contains('button', 'Resume').should('be.visible').click();
      cy.get('[data-testid="load-all-confirm"]').should('have.text', 'Resume').click();
      cy.wait('@pagedMessages').its('request.url').should('include', 'before=710000000000008801');
      cy.contains('All loaded', { timeout: 15000 }).should('be.visible');
      // Finished, so the record is cleared and the button reads Load All again.
      hooks().then((h) => h.get('default')).should((record) => {
        const general = Object.values(record?.conversations ?? {}).find((c) => c.name === CHANNEL);
        expect(general?.action ?? null).to.eq(null);
      });
    });
  });

  it('switching to another workspace clears the screen and switching back reopens the conversation from disk', () => {
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptPagedChannel(messages[0]);
      loadTwoPages();

      hooks().then((h) => h.create('Raid archive')).then((created) => {
        hooks().then((h) => h.switchTo(created.wid));
        cy.window().its('__store__').invoke('getState').its('workspace.currentName').should('eq', 'Raid archive');
        cy.contains('[data-testid="message-feed-row"]', 'page message 9000').should('not.exist');
        cy.window().its('__store__').invoke('getState').its('channel.selectedChannel').should('eq', null);

        hooks().then((h) => h.switchTo('default'));
        cy.window().its('__store__').invoke('getState').its('workspace.currentName').should('eq', 'Default');
        cy.contains('[data-testid="message-feed-row"]', 'page message 9000', { timeout: 15000 }).should('exist');
        cy.contains('200 messages').should('be.visible');
        cy.get('@pagedMessages.all').should('have.length', 2);
      });
    });
  });

  /* ─────────────── 2.2.5 WP4b: bulk run records ─────────────── */

  it('a DM purge cut short by a reload reads Resume and finishes the conversations it had left', () => {
    cy.fixture('bulk-purge-search-empty.json').then((empty) => {
      let searches = 0;
      cy.intercept('GET', '**/api/v10/channels/*/messages/search*', (req) => {
        searches += 1;
        // The first search never answers before the reload.
        if (searches === 1) req.reply({ statusCode: 200, body: empty, delay: 30000 });
        else req.reply({ statusCode: 200, body: empty });
      }).as('dmSearch');
    });
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', { statusCode: 200, body: [] }).as('finalPass');

    cy.contains('button', 'DMs').click();
    cy.wait('@getDMs');
    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.contains('alice_dev').click();
    cy.contains('bob_gamer').click();
    cy.get('[data-testid="multi-select-purge"]').click();
    cy.get('[data-testid="purge-confirm"]').should('not.be.disabled').click();
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk?.kind).to.eq('bulkPurge');
      expect(record?.bulk?.queue).to.have.length(2);
    });

    cy.reload();
    cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
    cy.contains('button', 'DMs').click();
    cy.wait('@getDMs');
    cy.get('[aria-label="Toggle multi-select"]').first().click();
    // Nothing is selected, the run's own button reads Resume.
    cy.get('[data-testid="multi-select-purge"]').should('have.text', 'Resume').click();
    cy.get('[data-testid="purge-resume-note"]').should('contain', 'This purge was running when Discrub closed.');
    cy.get('[data-testid="purge-confirm"]').should('have.text', 'Resume').and('not.be.disabled').click();
    cy.contains('Purge complete', { timeout: 20000 }).should('exist');
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk ?? null).to.eq(null);
    });
  });

  // 2.2.5 WP6c: a Bulk Export walks each channel into the workspace and a
  // resumed run renders the channels that finished from there.
  it('a Bulk Export cut short by a reload skips the channel that finished and fetches the rest', () => {
    const GENERAL = '801000000000000001';
    const DEV_CHAT = '801000000000000002';
    // Ids built as strings: number arithmetic past the safe integer range collapses them into one.
    const page = (channelId: string) =>
      Array.from({ length: 50 }, (_, i) => ({
        id: `${channelId === GENERAL ? '715' : '716'}00000000000${String(9000 - i).padStart(4, '0')}`,
        channel_id: channelId,
        author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: null, global_name: 'Alice' },
        content: `Bulk message ${i + 1}`,
        timestamp: `2026-02-${String(1 + (i % 27)).padStart(2, '0')}T12:00:00.000Z`,
        edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
      }));
    cy.task('downloads:clean');
    cy.window().then((win) => {
      const store = (win as any).__store__;
      store.dispatch({
        type: 'app/updateAllSettings/fulfilled',
        payload: { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0', reactionsEnabled: 'false' },
      });
    });
    let generalCalls = 0;
    let devChatCalls = 0;
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
      if (req.url.includes(GENERAL)) {
        generalCalls += 1;
        req.reply({ statusCode: 200, body: page(GENERAL) });
      } else {
        devChatCalls += 1;
        // The first dev-chat page never answers before the reload.
        req.reply({ statusCode: 200, body: page(DEV_CHAT), delay: devChatCalls === 1 ? 30000 : 0 });
      }
    }).as('walk');

    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.contains('general').click();
    cy.contains('dev-chat').click();
    cy.get('[data-testid="multi-select-export"]').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').find('.MuiAccordionSummary-content').contains('Files & Media').scrollIntoView().click();
    cy.get('[role="dialog"]').contains('label', 'Download files for offline viewing').find('input[type="checkbox"]').then(($input) => {
      if ($input.prop('checked')) cy.wrap($input).click({ force: true });
    });
    cy.get('[data-testid="bulk-export-confirm"]').click();

    // #general finished and its rows wait in the workspace; #dev-chat is in hand.
    // The pill's count moves once the record on disk has #general done.
    cy.window({ timeout: 20000 }).should((win) => {
      expect((win as any).__store__.getState().workspace.bulk?.remaining, 'one channel left').to.eq(1);
    });
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk?.kind).to.eq('bulkExport');
      expect(record?.bulk?.done).to.deep.eq([GENERAL]);
    });
    countWorkspaceRows().should('eq', 50);

    cy.reload();
    cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
    cy.selectServer('Cypress Test Server');
    cy.get('[aria-label="Toggle multi-select"]').first().click();
    cy.get('[data-testid="multi-select-export"]').should('have.text', 'Resume').click();
    cy.get('[data-testid="bulk-export-resume-note"]').should('contain', '1 of 2 channels finished before Discrub closed. Resume skips them and writes a new zip.');
    cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Resume').click();

    cy.waitForDownload(/^bulk-export\.zip$/i, 60000).then((fileName) => {
      cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
        const names = entries.map((e) => e.name);
        expect(names).to.include('general/general-page-1.html');
        expect(names).to.include('dev_chat/dev_chat-page-1.html');
      });
      cy.task<string>('zip:read', { fileName, entry: 'general/general-page-1.html' }).then((html) => {
        expect(html).to.include('Bulk message 1');
        expect(html).to.include('Bulk message 50');
      });
    });
    // #general was never asked for again; the run is over and its rows are gone.
    cy.window().should(() => {
      expect(generalCalls, 'general fetched once in all').to.eq(1);
      expect(devChatCalls, 'dev-chat fetched again after the reload').to.eq(2);
    });
    hooks().then((h) => h.get('default')).should((record) => {
      expect(record?.bulk ?? null).to.eq(null);
    });
    countWorkspaceRows().should('eq', 0);
  });
});
