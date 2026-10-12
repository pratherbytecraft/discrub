/**
 * Visual audit for the Discord data package import feature (backlog #54).
 *
 * Captures screenshots at every major UX state so the final build can be
 * reviewed by eye before shipping. Run:
 *
 *   npm run visual-audit:package
 *
 * Screenshots land in cypress/screenshots/visual-audit-package.cy.ts/audit/
 */

const DIR = 'audit';
const PAUSE = 400;

function snap(name: string) {
  cy.wait(PAUSE);
  cy.screenshot(`${DIR}/${name}`, { overwrite: true, capture: 'viewport' });
}

function closeDonationDrawer() {
  cy.get('[aria-label="Supporter Wall"]').click({ force: true });
  cy.get('body').click(0, 0);
  cy.wait(PAUSE);
}

describe('Visual Audit — Data Package', () => {
  beforeEach(() => {
    cy.login();
    closeDonationDrawer();
  });

  it('package tab empty state', () => {
    cy.openPackageTab();
    snap('01-empty-state');
  });

  it('import dialog idle', () => {
    cy.openPackageTab();
    cy.contains('button', /Choose ZIP file/i).click();
    snap('02-import-dialog-empty');
  });

  it('package loaded — summary + analytics', () => {
    cy.uploadPackage();
    cy.contains(/Top channels by message count/i).should('be.visible');
    snap('03-summary-and-analytics');
  });

  it('package loaded — scrolled to show channel types + timeline prompt', () => {
    cy.uploadPackage();
    cy.contains(/Channel types/i).should('be.visible');
    cy.contains(/Channel types/i).scrollIntoView();
    snap('04-channel-types-and-timeline-prompt');
  });

  it('timeline loaded — full analytics', () => {
    cy.uploadPackage();
    cy.contains('button', /Load timeline/i).click();
    cy.contains(/Monthly activity/i, { timeout: 10000 }).should('be.visible');
    cy.contains(/Monthly activity/i).scrollIntoView();
    snap('05-timeline-charts');
  });

  it('mismatched user banner', () => {
    cy.uploadPackage('test-package-mismatched.zip');
    cy.contains(/different user/i).should('be.visible');
    snap('06-mismatched-user-banner');
  });

  it('invalid package error', () => {
    cy.uploadPackage('test-package-invalid.zip');
    cy.get('[role="alert"]').should('contain.text', 'user.json');
    snap('07-invalid-package-error');
  });

  it('channel sidebar list populated', () => {
    cy.uploadPackage();
    snap('08-sidebar-channel-list');
  });

  it('message browser — writable guild channel', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    snap('09-message-browser-writable');
  });

  it('message browser — with selection', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.get('input[aria-label="Select message 1001"]').click();
    cy.get('input[aria-label="Select message 1002"]').click();
    snap('10-message-browser-selected');
  });

  it('delete confirmation dialog', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.get('input[aria-label="Select message 1001"]').click();
    cy.contains('button', /Delete selected/i).click();
    cy.get('[role="dialog"]').contains('Delete').should('be.visible');
    snap('11-delete-confirmation');
  });

  it('bulk edit modal', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.get('input[aria-label="Select message 1001"]').click();
    cy.get('input[aria-label="Select message 1002"]').click();
    cy.contains('button', /Edit selected/i).click();
    cy.get('[role="dialog"]').should('be.visible');
    snap('12-bulk-edit-modal');
  });

  it('orphan channel — read-only chip + disabled actions', () => {
    cy.uploadPackage();
    cy.contains('Left Servers').parent().find('button').last().click();
    cy.contains('Old Guild Channel').click();
    cy.contains(/Read only · left server/i).should('be.visible');
    snap('13-orphan-channel-readonly');
  });

  it('DM channel — writable', () => {
    cy.uploadPackage();
    cy.contains('tester-friend').click();
    cy.contains('hey').should('be.visible');
    snap('14-dm-channel');
  });

  it('export dialog open', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.contains('button', /^Export$/).click();
    cy.get('[role="dialog"]').should('be.visible');
    snap('15-export-dialog');
  });

  /* ────────── Rehydration (Tier 2 — backlog #109) ────────── */

  /**
   * Populate enrichment state directly via Redux dispatch — the actual
   * API loop needs real Discord traffic which visual audits don't do.
   */
  function seedEnrichedState() {
    cy.window().then((win) => {
      const store = (win as { __store__?: { dispatch: (a: unknown) => void } }).__store__;
      if (!store) throw new Error('Redux store not exposed in dev mode');
      store.dispatch({
        type: 'package/hydrateEnrichmentFromCache',
        payload: {
          channelId: '200',
          cache: {
            lastFetched: Date.now(),
            messages: {
              '1001': {
                id: '1001',
                type: 0,
                content: 'hello world — **edited live** 🎉',
                author: { id: 'a1', username: 'discrub_tester', global_name: 'Discrub Tester' },
                reactions: [
                  { emoji: { name: '👍' }, count: 3 },
                  { emoji: { name: '❤️' }, count: 7 },
                ],
                embeds: [],
                mentions: [],
                channel_id: '200',
                timestamp: '2022-07-28T22:30:52.000Z',
                attachments: [],
              },
              '1002': {
                id: '1002',
                type: 19,
                content: 'replying here',
                author: { id: 'a1', username: 'discrub_tester', global_name: 'Discrub Tester' },
                reactions: [],
                embeds: [],
                mentions: [],
                channel_id: '200',
                timestamp: '2022-07-28T22:31:00.000Z',
                attachments: [],
                referenced_message: {
                  id: '1000',
                  content: 'an older message',
                  author: { id: 'a2', username: 'friend', global_name: 'Friend' },
                },
              },
              '1003': {
                id: '1003',
                type: 0,
                content: 'with an embed',
                author: { id: 'a1', username: 'discrub_tester', global_name: 'Discrub Tester' },
                reactions: [],
                embeds: [{ title: 'example.com' }],
                mentions: [],
                channel_id: '200',
                timestamp: '2022-07-28T22:32:00.000Z',
                attachments: [],
              },
            },
            misses: { deleted: ['1004'], forbidden: [] },
          },
        },
      });
    });
  }

  it('rehydration banner — idle (load rich data)', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.contains('button', /Load rich data/i).should('be.enabled');
    snap('16-rehydration-idle');
  });

  it('rehydration banner — running (progress bar)', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    // Simulate a mid-run state via direct reducer dispatches.
    cy.window().then((win) => {
      const store = (win as { __store__?: { dispatch: (a: unknown) => void } }).__store__;
      if (!store) throw new Error('Redux store not exposed in dev mode');
      store.dispatch({
        type: 'package/enrichChannel/pending',
        meta: {
          arg: { channelId: '200' },
          requestId: 'audit',
          requestStatus: 'pending',
        },
      });
      store.dispatch({
        type: 'package/setEnrichmentProgress',
        payload: { channelId: '200', current: 3, total: 10 },
      });
    });
    cy.contains(/Rehydrating 3 of 10/).should('be.visible');
    snap('17-rehydration-running');
  });

  it('rehydration — done state with enriched + deleted rows', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    seedEnrichedState();
    cy.contains(/Rich data loaded today/).should('be.visible');
    cy.contains('enriched').should('exist');
    cy.contains('unavailable').should('exist');
    snap('18-rehydration-done');
  });

  it('export dialog — package mode with rehydrate toggle', () => {
    cy.uploadPackage();
    cy.contains('general').click();
    cy.contains('hello world').should('be.visible');
    cy.contains('button', /^Export$/).click();
    cy.get('[role="dialog"]').should('be.visible');
    // The checkbox label is inside the dialog — `should('exist')` is
    // enough; MUI sometimes reports positioned labels as not visible.
    cy.contains(/Rehydrate before export/).should('exist');
    snap('19-export-dialog-package-mode');
  });
});
