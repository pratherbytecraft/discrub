/**
 * 2.2.5 W1: a conversation larger than the 20,000 message cache. It is
 * seeded straight into the workspace database (rows, and since W2 the slim
 * rows and authors an open reads), then opened from disk the
 * way a reload opens it. The restore builds rows window by window, Select
 * all leaves every action ready at once, and Analytics reads the newest
 * 20,000 messages and says so, without reading for ever.
 *
 * 2.2.5 W4: Analytics walks every saved message instead, and Add Reactions
 * opens on the whole selection without reading the messages first.
 */

const CHANNEL_ID = '801000000000000001';
const GUILD_ID = '901000000000000001';
const TESTER_ID = '111222333444555666';
/** A second author, so the feed's chunks stay one message long as in a busy channel. */
const OTHER_ID = '222333444555666777';
const TOTAL = 25_000;
const BASE_ID = 720000000000000000n;
const BASE_TIME = Date.UTC(2026, 0, 1);

const pad = (id: string) => id.padStart(20, '0');

/** Puts TOTAL messages and their conversation record into the open workspace. */
function seedLargeConversation(template: Record<string, unknown>) {
  return cy.window({ log: false }).then((win) =>
    new Cypress.Promise<void>((resolve, reject) => {
      const open = win.indexedDB.open('Discrub-workspaces');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['rows', 'slimRows', 'authors', 'workspaces', 'meta'], 'readwrite');
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        const metaRequest = tx.objectStore('meta').get('meta');
        metaRequest.onsuccess = () => {
          const wid = metaRequest.result.lastWid ?? metaRequest.result.defaultWid;
          const recordRequest = tx.objectStore('workspaces').get(wid);
          recordRequest.onsuccess = () => {
            const record = recordRequest.result;
            const rows = tx.objectStore('rows');
            const slimRows = tx.objectStore('slimRows');
            const authors = tx.objectStore('authors');
            let bytes = 0;
            for (let i = 0; i < TOTAL; i++) {
              const id = String(BASE_ID + BigInt(i));
              const authorId = i % 2 === 0 ? TESTER_ID : OTHER_ID;
              const message = {
                ...template,
                id,
                channel_id: CHANNEL_ID,
                author: { ...(template.author as object), id: authorId, username: authorId === TESTER_ID ? 'discrub_tester' : 'other_user' },
                content: i % 50 === 0 ? `big message ${i} hi <@${TESTER_ID}>` : `big message ${i}`,
                timestamp: new Date(BASE_TIME + i * 60_000).toISOString(),
                reactions: [],
                attachments: [],
                embeds: [],
                mentions: [],
              };
              bytes += JSON.stringify(message).length;
              rows.put({ wid, cid: CHANNEL_ID, id: pad(id), authorId, message });
              // 2.2.5 W2: the row an open reads, and the author it names.
              slimRows.put({
                wid,
                cid: CHANNEL_ID,
                id: pad(id),
                row: { id, timestamp: message.timestamp, t: Date.parse(message.timestamp), authorId, type: 0, flags: 0, hasReactions: false },
              });
              if (i < 2) authors.put({ wid, id: authorId, user: message.author });
            }
            record.conversations[CHANNEL_ID] = {
              cid: CHANNEL_ID,
              kind: 'channel',
              guildId: GUILD_ID,
              name: 'general',
              parentName: null,
              count: TOTAL,
              bytes,
              oldestId: String(BASE_ID),
              newestId: String(BASE_ID + BigInt(TOTAL - 1)),
              complete: true,
              searchCriteria: null,
              refineCriteria: null,
              order: { order: 'desc', orderBy: 'timestamp' },
              pagination: { mode: 'paginated', lastMessageId: String(BASE_ID), hasMore: false, totalCount: null, searchOffset: 0, searchBeforeDate: null },
              scrollAnchorId: null,
              threadTabs: [],
              activeTab: null,
              action: null,
              enrichment: { reactions: 'off', replies: 'off', names: 'off' },
            };
            record.bytes += bytes;
            tx.objectStore('workspaces').put(record);
          };
        };
      };
    }),
  );
}

function openLargeConversation() {
  cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
  cy.selectServer('Cypress Test Server');
  cy.contains('general').click();
  cy.contains('[data-testid="message-feed-row"]', `big message ${TOTAL - 1}`, { timeout: 30000 }).should('exist');
}

describe('Large conversation from the workspace (2.2.5 W1)', () => {
  beforeEach(() => {
    cy.login();
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      seedLargeConversation(messages[0]);
    });
    cy.intercept('GET', '**/api/v10/channels/*/messages?*', { statusCode: 200, body: [] }).as('channelMessages');
    cy.reload();
    openLargeConversation();
  });

  it('restores every row without a fetch and prints the count with a separator', () => {
    cy.contains('25,000 messages').should('be.visible');
    cy.get('@channelMessages.all').should('have.length', 0);
    cy.contains('STATUS LOG').click();
    cy.contains(`Restored ${TOTAL} messages from this workspace`).should('exist');
  });

  it('Select all leaves every action ready at once', () => {
    cy.contains('label', 'Select all').click();
    cy.contains('25,000 selected').should('be.visible');
    // Add Reactions has no permission gate, so it shows the selection is ready.
    cy.contains('button', 'Add Reactions').should('be.enabled');
    // Still ready a moment later: nothing keeps reading in the background.
    cy.wait(1500);
    cy.contains('button', 'Add Reactions').should('be.enabled');
    cy.contains('button', 'Add Reactions').click();
    // It opens on the ids alone; nothing is read first.
    cy.get('[role="dialog"]').contains('Add Reactions').should('be.visible');
  });

  it('Analytics counts every saved message', () => {
    cy.contains('button', 'Analytics').click();
    cy.get('[role="dialog"]').should('be.visible');
    // Every 50th message mentions the tester.
    cy.get('[role="dialog"]').contains('500 mentions across 25,000 messages', { timeout: 60000 }).should('be.visible');
    cy.get('[role="dialog"]').contains('[role="tab"]', 'Members').click();
    cy.get('[role="dialog"]').find('[data-testid="analytics-row"]').should('have.length', 2).each((row) => {
      cy.wrap(row).should('contain.text', '12,500');
    });
    cy.get('[data-testid="analytics-loading"]').should('not.exist');
  });
});
