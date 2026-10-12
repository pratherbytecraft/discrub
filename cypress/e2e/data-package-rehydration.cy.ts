/// <reference types="cypress" />

/**
 * E2E coverage for the Tier 2 rehydration flow (backlog #109).
 *
 * Exercises the enrichment pipeline end-to-end via intercepted
 * `GET /channels/{id}/messages?around={id}` calls — no real Discord
 * traffic. Covers the happy path (200 → enriched chip), misses
 * (404 → unavailable, 403 → forbidden), rate-limit retry (429),
 * cache re-entry (no API calls on re-open), and cancel mid-run.
 *
 * Fixture: test-package.zip ships channel "general" (id 200) with
 * message IDs 1001 / 1002 / 1003 / 1004.
 */

const API = '**/api/v10';

/**
 * Shrink the search delay to 0 so the enrichment loop doesn't burn
 * Cypress's default command timeout on 4 real-time-spaced API calls.
 */
function setZeroDelay() {
  cy.window().then((win) => {
    const store = (win as any).__store__;
    store.dispatch({
      type: 'app/setSettings',
      payload: {
        ...store.getState().app.settings,
        searchDelay: '0',
      },
    });
  });
}

describe('Data package rehydration (Tier 2)', () => {
  beforeEach(() => {
    cy.login();
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    setZeroDelay();
    // Short-circuit the author-scoped search preflight (#109 efficiency
    // pass, post-2026-04-19) so it returns zero hits. The preflight
    // breaks out of its loop as soon as it sees a page smaller than
    // SEARCH_PREFLIGHT_PAGE_SIZE, which then lets the AROUND-based
    // enrichment loop that the individual tests DO mock actually run.
    // Without this, the preflight hits the real Discord endpoint
    // (404 CORS) and the test sees no `@enrichCall` fire.
    cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
      statusCode: 200,
      body: { messages: [], total_results: 0 },
    }).as('searchPreflight');
  });

  it('banner offers to load rich data when none has been fetched', () => {
    cy.contains('button', /Load rich data/i).should('be.enabled');
    // Rows default to the source chip.
    cy.contains('source').should('exist');
  });

  it('rehydrates via the API and flips rows to the enriched chip', () => {
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        req.reply({
          statusCode: 200,
          body: [
            {
              id: targetId,
              content: `LIVE ${targetId}`,
              author: { id: 'a1', username: 'live-author' },
              reactions: [{ emoji: { name: '👍' }, count: 1 }],
              embeds: [],
              mentions: [],
              type: 0,
              channel_id: '200',
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          ],
        });
      },
    ).as('enrichCall');

    cy.contains('button', /Load rich data/i).click();
    // Four calls, one per message. Wait for the last one.
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');

    cy.contains('enriched', { timeout: 10000 }).should('exist');
    // Status log mentions completion. Copy was polished in #161 from
    // "Package rehydration complete" to "Rich data loaded for ...".
    // Expand the panel first — #183 unmounts collapsed status rows.
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Rich data loaded for/i, { timeout: 10000 })
      .should('exist');
    // Banner flips to the done state with a Refresh button.
    cy.contains('button', /Refresh/i).should('be.visible');
  });

  it('marks 404 responses as unavailable (deleted) rows', () => {
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        if (targetId === '1002') {
          req.reply({ statusCode: 404, body: { message: 'Unknown' } });
        } else {
          req.reply({
            statusCode: 200,
            body: [
              {
                id: targetId,
                content: `LIVE ${targetId}`,
                author: { id: 'a1', username: 'u' },
                reactions: [],
                embeds: [],
                mentions: [],
                type: 0,
                channel_id: '200',
                timestamp: '2024-01-01T00:00:00.000Z',
                attachments: [],
              },
            ],
          });
        }
      },
    ).as('enrichCall');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');

    // Status log summarizes both outcomes. Pre-#161 the copy was
    // "3 enriched, 1 deleted"; polish renamed to "3 messages, 1 unavailable"
    // to match the per-row chip and avoid confusing the noun "deleted"
    // (which has a different meaning in the package-delete context).
    cy.contains(/3 messages, 1 unavailable/i, { timeout: 10000 }).should('exist');
    cy.contains('unavailable', { timeout: 10000 }).should('exist');
  });

  it('marks 403 responses as forbidden rows', () => {
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        if (targetId === '1003') {
          req.reply({ statusCode: 403, body: { message: 'Forbidden' } });
        } else {
          req.reply({
            statusCode: 200,
            body: [
              {
                id: targetId,
                content: `LIVE ${targetId}`,
                author: { id: 'a1', username: 'u' },
                reactions: [],
                embeds: [],
                mentions: [],
                type: 0,
                channel_id: '200',
                timestamp: '2024-01-01T00:00:00.000Z',
                attachments: [],
              },
            ],
          });
        }
      },
    ).as('enrichCall');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');

    // Pre-#161 the chip + log used HTTP "forbidden"; polish renamed
    // both to "no access" so users don't see protocol jargon.
    cy.contains(/3 messages.*1 no access/i, { timeout: 10000 }).should('exist');
    cy.contains('no access', { timeout: 10000 }).should('exist');
  });

  it('retries after a 429 rate-limit response', () => {
    let hitCount = 0;
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        hitCount++;
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        // First call to 1001 gets 429; subsequent calls all succeed.
        if (targetId === '1001' && hitCount === 1) {
          req.reply({
            statusCode: 429,
            headers: { 'retry-after': '0' },
            body: { message: 'Too many requests', retry_after: 0, global: false },
          });
        } else {
          req.reply({
            statusCode: 200,
            body: [
              {
                id: targetId,
                content: `LIVE ${targetId}`,
                author: { id: 'a1', username: 'u' },
                reactions: [],
                embeds: [],
                mentions: [],
                type: 0,
                channel_id: '200',
                timestamp: '2024-01-01T00:00:00.000Z',
                attachments: [],
              },
            ],
          });
        }
      },
    ).as('enrichCall');

    cy.contains('button', /Load rich data/i).click();

    // Status log surfaces the rate-limit notice from the global handler.
    // Expand the panel first — #183 unmounts collapsed status rows.
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Discord asked Discrub to wait/i, { timeout: 10000 }).should('exist');
    // Eventually the run finishes with all 4 enriched.
    cy.contains(/4 enriched/i, { timeout: 15000 }).should('exist');
  });

  it('stops the operation after a 429 storm instead of retrying forever (#254)', () => {
    // Every enrichment call is rate limited with a JSON body. discrub-core
    // gives up after five consecutive 429s on one request; the app hook
    // then cancels the operation, logs an ERROR line and shows a toast.
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        req.reply({
          statusCode: 429,
          headers: { 'retry-after': '0' },
          body: { message: 'Too many requests', retry_after: 0, global: false },
        });
      },
    ).as('stormCall');

    cy.contains('button', /Load rich data/i).click();

    cy.contains(/Stopped: Discord is rate limiting this account/i, { timeout: 15000 }).should('exist');
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Stopped the operation to protect your account/i, { timeout: 10000 }).should('exist');
    // The storm never turned into a success count.
    cy.contains(/4 enriched/i).should('not.exist');
  });

  it('short-circuits to cache on re-entry — no new API calls', () => {
    // First run — actually enrich everything.
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        req.reply({
          statusCode: 200,
          body: [
            {
              id: targetId,
              content: `LIVE ${targetId}`,
              author: { id: 'a1', username: 'u' },
              reactions: [],
              embeds: [],
              mentions: [],
              type: 0,
              channel_id: '200',
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          ],
        });
      },
    ).as('firstRun');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@firstRun');
    cy.wait('@firstRun');
    cy.wait('@firstRun');
    cy.wait('@firstRun');
    cy.contains('button', /Refresh/i, { timeout: 10000 }).should('be.visible');

    // Navigate away, then back — the cache-hit path should fire.
    cy.get('[aria-label="Back to analytics"]').click();
    cy.contains('general').click();

    // Register a SPY that would match any new API call. We do not want
    // to see any of these.
    let secondRunHits = 0;
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      () => {
        secondRunHits++;
      },
    );

    // Assert UI state came back from cache, not a fresh run.
    cy.contains(/Rich data loaded/, { timeout: 10000 }).should('be.visible');
    cy.contains('enriched').should('exist');
    cy.then(() => expect(secondRunHits).to.eq(0));
  });

  it('"Rehydrate before export" runs enrichment first, then fires the export', () => {
    let enrichHits = 0;
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        enrichHits++;
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        req.reply({
          statusCode: 200,
          body: [
            {
              id: targetId,
              content: `LIVE ${targetId}`,
              author: { id: 'a1', username: 'u' },
              reactions: [],
              embeds: [],
              mentions: [],
              type: 0,
              channel_id: '200',
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          ],
        });
      },
    ).as('enrichCall');

    // Open export dialog, tick the rehydrate checkbox, confirm.
    cy.contains('button', /^Export$/).click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains(/Rehydrate before export/).click();
    cy.get('[role="dialog"]').contains('button', /^Export$/).click();

    // Enrichment loop fires 4 calls before the export kicks in.
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
    cy.then(() => expect(enrichHits).to.eq(4));

    // Dialog closes; the post-export toolbar Export button re-enables.
    cy.contains('button', /^Export$/, { timeout: 15000 }).should('not.be.disabled');
    // Status log reflects the full flow. Rehydration completion copy
    // changed in #161; export completion copy is unchanged.
    // Expand the panel first — #183 unmounts collapsed status rows.
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Rich data loaded for/i).should('exist');
    cy.contains(/Package export: completed/i, { timeout: 10000 }).should('exist');
  });

  it('Fix A: after cancel, retrying rehydration works (cancel flag auto-resets)', () => {
    // First round — cancel mid-run.
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        req.reply({
          delay: 200,
          statusCode: 200,
          body: [
            {
              id: targetId,
              content: `LIVE ${targetId}`,
              author: { id: 'a1', username: 'u' },
              reactions: [],
              embeds: [],
              mentions: [],
              type: 0,
              channel_id: '200',
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          ],
        });
      },
    ).as('enrichCall');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@enrichCall');
    cy.contains('button', /Cancel/i).click();

    // Banner flips to a non-running state.
    cy.contains(
      /Rehydration cancelled|Rich data loaded/,
      { timeout: 10000 },
    ).should('exist');

    // Before Fix A, the discrubCancelled flag stayed true after an
    // enrichment cancel (it's only reset by MainLayout's
    // isOperationRunning effect, which didn't include enrichment).
    // Verify the flag is now false in Redux state before retrying.
    cy.window().then((win) => {
      const store = (win as { __store__?: { getState: () => unknown } }).__store__;
      const st = store?.getState() as { app: { discrubCancelled: boolean } } | undefined;
      expect(st?.app.discrubCancelled, 'discrubCancelled must reset after enrich cancel').to.eq(false);
    });

    // Retry from the banner — it should actually run (not instantly
    // re-cancel).
    cy.contains('button', /Retry rich data|Refresh/i).click({ force: true });

    // Second round should progress beyond message 1.
    cy.wait('@enrichCall');
    cy.wait('@enrichCall');
  });

  it('cancel button aborts the run and saves partial results', () => {
    // Add a tiny artificial delay so the user has time to click cancel
    // between API responses.
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        req.reply({
          delay: 200,
          statusCode: 200,
          body: [
            {
              id: targetId,
              content: `LIVE ${targetId}`,
              author: { id: 'a1', username: 'u' },
              reactions: [],
              embeds: [],
              mentions: [],
              type: 0,
              channel_id: '200',
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          ],
        });
      },
    ).as('slowEnrich');

    cy.contains('button', /Load rich data/i).click();
    // Wait for the first call to land, then cancel.
    cy.wait('@slowEnrich');
    cy.contains('button', /Cancel/i).click();

    // Banner returns to a non-running state — either cancelled prompt
    // or done-with-partial, depending on timing.
    cy.contains(
      /Rehydration cancelled|Rich data loaded/,
      { timeout: 10000 },
    ).should('exist');
  });
});

/**
 * Regression coverage for the post-#162 fixes (backlog #174):
 *  - 33a767d: messages.json snowflake precision (parser-level; URL must
 *    pass through the package's exact stored ID with no Number coercion)
 *  - 7fead58: search preflight must NOT cache type-19 replies (Discord's
 *    /messages/search response shape lacks referenced_message)
 *  - 3b14bc1: status log emits "Channel scan matched X of N package
 *    messages" so the optimization is visible to the user
 *
 * Each of these shipped after a real-user HAR found a bug that synthetic
 * tests had missed; this block pins the fixes so they can't silently
 * regress.
 */
describe('Data package rehydration robustness fixes (#174)', () => {
  beforeEach(() => {
    cy.login();
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    setZeroDelay();
  });

  it('emits "Channel scan matched X of N package messages" when preflight returns hits', () => {
    // Search preflight returns all 4 package messages — the new status
    // log entry from 3b14bc1 must surface the package-overlap count.
    cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
      statusCode: 200,
      body: {
        messages: [
          {
            id: '1001',
            content: 'preflight 1001',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
          {
            id: '1002',
            content: 'preflight 1002',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
          {
            id: '1003',
            content: 'preflight 1003',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
          {
            id: '1004',
            content: 'preflight 1004',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
        ],
        total_results: 4,
      },
    }).as('preflight');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@preflight');

    // Expand the panel first — #183 unmounts collapsed status rows.
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Channel scan matched 4 of 4 package messages/i, {
      timeout: 10000,
    }).should('exist');
  });

  it('replies returned by search preflight are re-fetched via AROUND so the parent renders', () => {
    // Search preflight returns ID 1001 as a type-19 reply WITHOUT a
    // populated referenced_message — this is what real Discord ships,
    // and it's the shape that 7fead58 protects against caching.
    cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
      statusCode: 200,
      body: {
        messages: [
          {
            id: '1001',
            content: 'reply body',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 19,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
            message_reference: {
              type: 0,
              channel_id: '200',
              message_id: 'parent-9001',
              guild_id: '901000000000000001',
            },
          },
          {
            id: '1002',
            content: 'preflight 1002',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
          {
            id: '1003',
            content: 'preflight 1003',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
          {
            id: '1004',
            content: 'preflight 1004',
            author: { id: 'a1', username: 'u' },
            reactions: [],
            embeds: [],
            mentions: [],
            type: 0,
            channel_id: '200',
            timestamp: '2024-01-01T00:00:00.000Z',
            attachments: [],
          },
        ],
        total_results: 4,
      },
    }).as('preflight');

    // AROUND for 1001 returns the same reply but WITH referenced_message
    // populated (matching real Discord bulk-endpoint behavior). Other IDs
    // should never be requested — they were served by preflight cache.
    let aroundCallCount = 0;
    const aroundIdsCalled: string[] = [];
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        aroundCallCount += 1;
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        aroundIdsCalled.push(targetId);
        if (targetId === '1001') {
          req.reply({
            statusCode: 200,
            body: [
              {
                id: '1001',
                content: 'reply body',
                author: { id: 'a1', username: 'u' },
                reactions: [],
                embeds: [],
                mentions: [],
                type: 19,
                channel_id: '200',
                timestamp: '2024-01-01T00:00:00.000Z',
                attachments: [],
                message_reference: {
                  type: 0,
                  channel_id: '200',
                  message_id: 'parent-9001',
                  guild_id: '901000000000000001',
                },
                referenced_message: {
                  id: 'parent-9001',
                  content: 'PARENT-IS-ALIVE',
                  author: { id: 'a2', username: 'parent-author' },
                  type: 0,
                  channel_id: '200',
                  timestamp: '2024-01-01T00:00:00.000Z',
                  attachments: [],
                  embeds: [],
                  mentions: [],
                  reactions: [],
                },
              },
            ],
          });
        } else {
          // Defensive — should not be hit. Reply with the cached form.
          req.reply({
            statusCode: 200,
            body: [
              {
                id: targetId,
                content: `LIVE ${targetId}`,
                author: { id: 'a1', username: 'u' },
                reactions: [],
                embeds: [],
                mentions: [],
                type: 0,
                channel_id: '200',
                timestamp: '2024-01-01T00:00:00.000Z',
                attachments: [],
              },
            ],
          });
        }
      },
    ).as('around');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@preflight');
    cy.wait('@around');

    // Expand the panel first — #183 unmounts collapsed status rows.
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Rich data loaded for/i, { timeout: 10000 }).should('exist');

    // Exactly ONE AROUND call: for the type-19 reply that the cache skipped.
    cy.then(() => {
      expect(aroundCallCount, 'AROUND call count').to.eq(1);
      expect(aroundIdsCalled, 'AROUND target IDs').to.deep.eq(['1001']);
    });

    // The parent's content must render — confirmation that the reply
    // dropped through to AROUND and got the populated referenced_message.
    cy.contains('PARENT-IS-ALIVE', { timeout: 10000 }).should('exist');
    // And the "Original message was deleted" chip must NOT appear for
    // this reply (it would render if we'd cached the search result).
    cy.contains(/Original message was deleted/i).should('not.exist');
  });

  it('AROUND URL preserves the exact package message ID', () => {
    // Snowflake-precision regression guard (33a767d). Even with the
    // fixture's small numeric IDs, the URL construction path must round-
    // trip the ID as a string with zero loss. A future regression that
    // introduces `Number(id)` anywhere in the AROUND path would corrupt
    // 19-digit snowflakes; smaller IDs would survive Number rounding,
    // so we assert exact string equality on the URL parameter.
    cy.intercept('GET', `${API}/guilds/*/messages/search*`, {
      statusCode: 200,
      body: { messages: [], total_results: 0 },
    }).as('preflight');

    const aroundIdsCalled: string[] = [];
    cy.intercept(
      'GET',
      `${API}/channels/200/messages?limit=50&around=*`,
      (req) => {
        const url = new URL(req.url);
        const targetId = url.searchParams.get('around') ?? '';
        aroundIdsCalled.push(targetId);
        req.reply({
          statusCode: 200,
          body: [
            {
              id: targetId,
              content: `LIVE ${targetId}`,
              author: { id: 'a1', username: 'u' },
              reactions: [],
              embeds: [],
              mentions: [],
              type: 0,
              channel_id: '200',
              timestamp: '2024-01-01T00:00:00.000Z',
              attachments: [],
            },
          ],
        });
      },
    ).as('around');

    cy.contains('button', /Load rich data/i).click();
    cy.wait('@around');
    cy.wait('@around');
    cy.wait('@around');
    cy.wait('@around');
    // Expand the panel first — #183 unmounts collapsed status rows.
    cy.get('[aria-label="Expand log"]').click();
    cy.contains(/Rich data loaded for/i, { timeout: 10000 }).should('exist');

    cy.then(() => {
      // Each ID arrives at AROUND exactly as it left the package — no
      // truncation, no scientific notation, no precision loss.
      expect([...aroundIdsCalled].sort()).to.deep.eq([
        '1001',
        '1002',
        '1003',
        '1004',
      ]);
      for (const id of aroundIdsCalled) {
        // Same characters, same length, same trailing digits — i.e. the
        // ID never round-tripped through Number along the way.
        expect(id).to.match(/^\d+$/);
      }
    });
  });
});

/**
 * Read-only packages (from a different user) can't rehydrate — the
 * banner button is disabled by `canEnrich` gating. Separate describe
 * so the test gets its own fixture, not the default one.
 */
describe('Data package rehydration (read-only)', () => {
  beforeEach(() => {
    cy.login();
    cy.uploadPackage('test-package-mismatched.zip');
    cy.contains(/different user/i).should('be.visible');
  });

  it('banner Load button is disabled on read-only packages', () => {
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.contains('button', /Load rich data/i).should('be.disabled');
  });
});
