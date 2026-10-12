/**
 * 2.2.5 fix A: user lookups run one at a time and do not count as a run.
 * A switch with only a lookup going opens no dialog, and a switch during
 * Load All with lookups on stops both and opens the other workspace.
 */

const CHANNEL = 'general';
const USER_URL = /\/api\/v10\/users\/\d+$/;

/** A page of 100 with one author per message, cycling through 250 users. */
function makePage(template: Record<string, unknown>, start: number): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = start - i;
    const user = 500000 + (n % 250);
    return {
      ...template,
      id: `72000000000000${String(n).padStart(4, '0')}`,
      content: `lookup message ${n}`,
      timestamp: new Date(Date.UTC(2026, 1, 1) + n * 60_000).toISOString(),
      author: { id: String(user), username: `user${user}`, discriminator: '0', avatar: null, global_name: null },
      mentions: [],
      reactions: [],
      attachments: [],
      embeds: [],
    };
  });
}

/** First call answers the newest page, later calls walk back a page each, slowly, until `pages` run out. */
function interceptChannel(template: Record<string, unknown>, pages: number, delay: number) {
  let calls = 0;
  cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
    calls += 1;
    const body = calls <= pages ? makePage(template, 9000 - (calls - 1) * 100) : [];
    req.reply({ statusCode: 200, body, delay: calls === 1 ? 0 : delay });
  }).as('channelMessages');
}

/** Answers user lookups after `delay` and counts how often each id was asked. */
function interceptUsers(asked: Record<string, number>, delay: number) {
  cy.intercept('GET', USER_URL, (req) => {
    const id = req.url.split('/').pop() as string;
    asked[id] = (asked[id] ?? 0) + 1;
    req.reply({ statusCode: 200, delay, body: { id, username: `user${id}`, discriminator: '0', avatar: null, global_name: `Name ${id}` } });
  }).as('lookupUser');
}

const store = () => cy.window().its('__store__');

function turnLookupsOn() {
  store().then((s: any) => {
    const settings = s.getState().app.settings;
    s.dispatch({ type: 'app/setSettings', payload: { ...settings, displayNameLookup: 'true', serverNickNameLookup: 'false' } });
  });
}

const createWorkspace = (name: string) =>
  cy.window().then((win) => (win as unknown as { __workspace__: { create: (n: string) => Promise<unknown> } }).__workspace__.create(name));

const clickWorkspaceRow = (name: string) => {
  cy.get('[data-testid="workspace-pill"]').first().click();
  cy.get('[data-testid="workspaces-popover"]').should('be.visible');
  cy.contains('[data-testid^="workspace-row-"]', name).click();
};

const noRawSwitchError = () =>
  store().then((s: any) => {
    const lines: string[] = s.getState().status.entries.map((e: { message: string }) => e.message);
    expect(lines.some((m) => m.includes('workspace/switch'))).to.equal(false);
  });

describe('User lookups and switching (2.2.5 fix A)', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    turnLookupsOn();
  });

  it('a lookup on its own is not a run, so a switch opens no dialog', () => {
    const asked: Record<string, number> = {};
    interceptUsers(asked, 8000);
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptChannel(messages[0], 1, 0);
      createWorkspace('Mod work');
      cy.contains(CHANNEL).click();
      cy.wait('@channelMessages');
      cy.wait('@lookupUser');
      store().should((s: any) => expect(s.getState().message.isEnriching).to.equal(true));

      clickWorkspaceRow('Mod work');
      cy.get('[data-testid="workspace-switch-dialog"]').should('not.exist');
      cy.get('[data-testid="workspace-pill"]', { timeout: 10000 }).should('contain', 'Mod work');
      // The lookup stops at its next user rather than working through the rest.
      store().should((s: any) => expect(s.getState().message.isEnriching).to.equal(false));
      cy.then(() => expect(Object.keys(asked).length).to.be.lessThan(3));
      noRawSwitchError();
    });
  });

  it('a switch during Load All with lookups on stops both and opens the other workspace', () => {
    const asked: Record<string, number> = {};
    interceptUsers(asked, 50);
    cy.fixture('messages.json').then((messages: Record<string, unknown>[]) => {
      interceptChannel(messages[0], 40, 600);
      createWorkspace('Mod work');
      cy.contains(CHANNEL).click();
      cy.wait('@channelMessages');

      cy.contains('button', 'Load All').click();
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.contains(/[3-9]00 messages/, { timeout: 15000 }).should('be.visible');

      clickWorkspaceRow('Mod work');
      cy.get('[data-testid="workspace-switch-dialog"]').should('contain', 'Load All is running').and('contain', 'Load All is at');
      cy.get('[data-testid="workspace-switch-confirm"]').click();
      cy.get('[data-testid="workspace-pill"]', { timeout: 20000 }).should('contain', 'Mod work');
      store().should((s: any) => {
        expect(s.getState().message.isEnriching).to.equal(false);
        expect(s.getState().message.pagination.isLoadingAll).to.equal(false);
      });
      noRawSwitchError();
      // One lookup at a time: no user was asked for twice.
      cy.then(() => {
        expect(Object.keys(asked).length).to.be.greaterThan(0);
        expect(Math.max(...Object.values(asked))).to.equal(1);
      });
    });
  });
});
