describe('Channel Messages', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
  });

  it('loads and displays messages after selecting a channel', () => {
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  it('shows channel name and message count in header', () => {
    cy.selectChannel('general');
    cy.contains('general').should('be.visible');
    cy.contains('13 messages').should('be.visible');
  });

  it('displays message author, content, and timestamp', () => {
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    cy.get('[aria-label="Your profile, Discrub Tester"]').should('exist');
  });

  // Backlog #204/#213: a sticker-only message (empty content) carries real
  // payload — it now renders the sticker image (#213), never "(no content)".
  // Scoped intercept keeps the shared fixture's count assertions untouched.
  it('renders a sticker-only message as an image, not "(no content)" (#213)', () => {
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', {
      statusCode: 200,
      body: [
        {
          id: '700000000000000999',
          channel_id: '801000000000000001',
          author: {
            id: '111222333444555666',
            username: 'discrub_tester',
            discriminator: '0',
            avatar: 'abc123avatar',
            global_name: 'Discrub Tester',
          },
          content: '',
          timestamp: '2026-02-24T00:00:00.000Z',
          edited_timestamp: null,
          tts: false,
          mention_everyone: false,
          mentions: [],
          attachments: [],
          embeds: [],
          reactions: [],
          pinned: false,
          type: 0,
          sticker_items: [{ id: 's1', name: 'wave', format_type: 1 }],
        },
      ],
    }).as('getStickerMsg');

    cy.contains('general').click();
    cy.wait('@getStickerMsg');
    cy.get('img[alt="wave"]').should('exist');
    cy.contains('Sticker: wave').should('not.exist');
    cy.contains('(no content)').should('not.exist');
  });

  it('shows "Load All" button when there may be more messages', () => {
    // Override messages intercept to return exactly 100 messages (signals hasMore=true)
    const manyMessages = Array.from({ length: 100 }, (_, i) => ({
      id: `700000000000000${String(i + 1).padStart(3, '0')}`,
      channel_id: '801000000000000001',
      author: {
        id: '111222333444555666',
        username: 'discrub_tester',
        discriminator: '0',
        avatar: 'abc123avatar',
        global_name: 'Discrub Tester',
      },
      content: `Message ${i + 1}`,
      timestamp: new Date(2026, 1, 1, 0, 0, i).toISOString(),
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

    cy.intercept('GET', '**/api/v10/channels/*/messages?*', {
      statusCode: 200,
      body: manyMessages,
    }).as('getMessages100');

    cy.contains('general').click();
    cy.wait('@getMessages100');
    cy.contains('button', 'Load All').should('be.visible');
  });

  it('opens LoadAllDialog when clicking "Load All"', () => {
    const manyMessages = Array.from({ length: 100 }, (_, i) => ({
      id: `700000000000000${String(i + 1).padStart(3, '0')}`,
      channel_id: '801000000000000001',
      author: {
        id: '111222333444555666',
        username: 'discrub_tester',
        discriminator: '0',
        avatar: 'abc123avatar',
        global_name: 'Discrub Tester',
      },
      content: `Message ${i + 1}`,
      timestamp: new Date(2026, 1, 1, 0, 0, i).toISOString(),
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

    cy.intercept('GET', '**/api/v10/channels/*/messages?*', {
      statusCode: 200,
      body: manyMessages,
    }).as('getMessages100');

    cy.contains('general').click();
    cy.wait('@getMessages100');
    cy.contains('button', 'Load All').click();
    cy.get('[role="dialog"]').should('be.visible');
  });

  it('does not show "Load All" when fewer than 100 messages loaded', () => {
    cy.selectChannel('general');
    // Fixture has 13 messages (< 100), so hasMore=false — no Load All button
    cy.contains('button', 'Load All').should('not.exist');
  });

  it('shows "Export" button that is disabled when no messages', () => {
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', {
      statusCode: 200,
      body: [],
    }).as('getEmptyMessages');

    cy.contains('general').click();
    cy.wait('@getEmptyMessages');
    cy.contains('button', 'Export').should('be.disabled');
  });

  // #185 Bug A: transient network failures during Load All must be retried
  // (up to 5 attempts) before giving up. This validates the consumer side:
  // a single forceNetworkError on the second batch is followed by a retry
  // that succeeds, and the operation completes with the full message set.
  it('retries the second Load All batch on transient network failure and completes', () => {
    const makeBatch = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `700000000000000${String(offset + i + 1).padStart(3, '0')}`,
        channel_id: '801000000000000001',
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: `Message ${offset + i + 1}`,
        timestamp: new Date(2026, 1, 1, 0, 0, offset + i).toISOString(),
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

    let call = 0;
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
      call += 1;
      if (call === 1) {
        // First page — opens the channel + makes the Load All button appear
        req.reply({ statusCode: 200, body: makeBatch(0, 100) });
      } else if (call === 2) {
        // Load All's first batch (during the loop)
        req.reply({ statusCode: 200, body: makeBatch(100, 100) });
      } else if (call === 3) {
        // Transient blip — server-side 503 is unambiguously transient
        req.reply({ statusCode: 503, body: 'Service Unavailable' });
      } else {
        // Retry succeeds and the loop reaches a < 100 batch to end
        req.reply({ statusCode: 200, body: makeBatch(200, 50) });
      }
    }).as('messagesFlaky');

    cy.contains('general').click();
    cy.wait('@messagesFlaky');
    cy.contains('button', 'Load All').click();
    cy.get('[role="dialog"]').contains('button', 'Load All').click();

    // Loop should finish with 250 messages (100 + 100 + 50) despite the
    // transient blip. Surface visible in the header count.
    cy.contains('250 messages', { timeout: 20000 }).should('be.visible');

    // Retry warning should have surfaced in the status log.
    cy.window().then((win) => {
      const store = (win as any).__store__;
      const entries = store?.getState()?.status?.entries ?? [];
      const messages = entries.map((e: any) => e.message);
      expect(
        messages.some((m: string) => /Load All: Discord answered HTTP 503, retrying in/.test(m)),
      ).to.be.true;
    });
  });
  // #265: the Retry wait setting sets the first retry wait Load All announces.
  it('waits the configured retry wait before retrying a Load All batch (#265)', () => {
    const makeBatch = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `720000000000000${String(offset + i + 1).padStart(3, '0')}`,
        channel_id: '801000000000000001',
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: 'abc123avatar',
          global_name: 'Discrub Tester',
        },
        content: `Retry wait ${offset + i + 1}`,
        timestamp: new Date(2026, 1, 1, 0, 0, offset + i).toISOString(),
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

    let call = 0;
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
      call += 1;
      if (call === 1) req.reply({ statusCode: 200, body: makeBatch(0, 100) });
      else if (call === 2) req.reply({ statusCode: 503, body: 'Service Unavailable' });
      else req.reply({ statusCode: 200, body: makeBatch(100, 20) });
    }).as('messagesRetryWait');

    cy.contains('general').click();
    cy.wait('@messagesRetryWait');
    cy.window().then((win) => {
      const store = (win as any).__store__;
      store.dispatch({
        type: 'app/updateAllSettings/fulfilled',
        payload: { ...store.getState().app.settings, retryWait: '3' },
      });
    });
    cy.contains('button', 'Load All').click();
    cy.get('[role="dialog"]').contains('button', 'Load All').click();
    cy.contains('120 messages', { timeout: 20000 }).should('be.visible');

    cy.window().then((win) => {
      const entries = (win as any).__store__.getState().status.entries ?? [];
      const messages = entries.map((e: any) => e.message);
      expect(messages.some((m: string) => /Load All: Discord answered HTTP 503, retrying in 3s \(attempt 1\/5\)/.test(m))).to.be.true;
    });
  });

  // #263: Load All merges each page at the end of the list instead of
  // re-sorting everything. Pages must still land in feed order.
  it('keeps the feed newest-first across Load All pages (#263)', () => {
    const makeBatch = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const n = offset + i;
        return {
          id: `710000000000000${String(999 - n).padStart(3, '0')}`,
          channel_id: '801000000000000001',
          author: {
            id: '111222333444555666',
            username: 'discrub_tester',
            discriminator: '0',
            avatar: 'abc123avatar',
            global_name: 'Discrub Tester',
          },
          content: `Ordered ${n}`,
          // Later batches are older, like Discord's history walk.
          timestamp: new Date(2026, 1, 1, 12, 0, 0, 0 - n * 1000).toISOString(),
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
      });

    let call = 0;
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
      call += 1;
      if (call === 1) req.reply({ statusCode: 200, body: makeBatch(0, 100) });
      else if (call === 2) req.reply({ statusCode: 200, body: makeBatch(100, 100) });
      else req.reply({ statusCode: 200, body: makeBatch(200, 30) });
    }).as('messagesOrdered');

    cy.contains('general').click();
    cy.wait('@messagesOrdered');
    cy.contains('button', 'Load All').click();
    cy.get('[role="dialog"]').contains('button', 'Load All').click();
    cy.contains('230 messages', { timeout: 20000 }).should('be.visible');

    cy.window().its('__store__').should((store: any) => {
      const messages = store.getState().message.messages;
      expect(messages).to.have.length(230);
      const times = messages.map((m: any) => new Date(m.timestamp).getTime());
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]).to.be.at.most(times[i - 1]);
      }
      expect(messages[0].content).to.equal('Ordered 0');
      expect(messages[229].content).to.equal('Ordered 229');
      expect(store.getState().message.filteredMessages).to.equal(messages);
    });
  });
});
