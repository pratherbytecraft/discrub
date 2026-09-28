// 2.2.2: the Scrublings say what the app is doing, on the top bar.
const dispatch = (action: Record<string, unknown>) => cy.window().then((win) => (win as any).__store__.dispatch(action));
const settings = (patch: Record<string, string>) => {
  // Boot can still be writing settings; wait for it, patch, and check the patch stuck.
  cy.window().its('__store__').invoke('getState').its('app.settings.appLanguage').should('not.eq', '');
  cy.window().then((win) => { const st = (win as any).__store__; st.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...st.getState().app.settings, ...patch } }); });
  for (const [k, v] of Object.entries(patch)) cy.window().its('__store__').invoke('getState').its(`app.settings.${k}`).should('eq', v);
};
/** Starts a purge (which resets its progress) and reports progress, the way the real thunk does. */
const startPurge = (deleted: number) => cy.window().then((win) => {
  const st = (win as any).__store__;
  st.dispatch({ type: 'purge/bulkPurgeChannels/pending', meta: { requestId: 'r1', requestStatus: 'pending', arg: {} } });
  st.dispatch({
    type: 'purge/setPurgeProgress',
    payload: { processed: deleted + 10, deleted, skipped: 0, reactionsRemoved: 0, failed: 0, bulk: { currentIndex: 0, totalChannels: 1, currentChannelName: 'general', completedStats: { deleted: 0, skipped: 0, reactionsRemoved: 0 } } },
  });
});
const endPurge = () => dispatch({ type: 'purge/bulkPurgeChannels/fulfilled', payload: { success: true }, meta: { requestId: 'r1', requestStatus: 'fulfilled', arg: {} } });
const stage = '.MuiAppBar-root [data-testid="scrublings-stage"]';

describe('Scrublings lines (2.2.2)', () => {
  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  it('says a purge line with the count and the channel, then the finish line', () => {
    settings({ appScrublingsEnabled: 'true', appScrublingsPicked: '["suds"]' });
    cy.get(stage).should('have.attr', 'data-count', '1');
    startPurge(1204);
    cy.contains('[data-testid="scrublings-caption"]', '1,204 scrubbed in #general').should('exist');
    cy.get('[data-testid="scrubling-suds"]').invoke('attr', 'data-frame').should('match', /^scrub/);
    endPurge();
    cy.contains('[data-testid="scrublings-caption"]', '#general is clean.').should('exist');
    cy.get(stage).should('have.attr', 'data-count', '1');
  });

  it('stays on the top bar during a rest break and says the rest break line there', () => {
    settings({ appScrublingsEnabled: 'true', appScrublingsPicked: '["suds","mage","cat"]' });
    cy.get(stage).should('have.attr', 'data-count', '3');
    dispatch({ type: 'export/exportMessages/pending', meta: { requestId: 'e1', requestStatus: 'pending', arg: {} } });
    dispatch({ type: 'app/setDiscrubPaused', payload: true });
    cy.window().then((win) => (win as any).__store__.dispatch({ type: 'app/setRestBreakUntil', payload: Date.now() + 3 * 60_000 }));
    cy.contains('[data-testid="scrublings-caption"]', 'Rest break. Back in 3 min.').should('exist');
    cy.get(stage).should('have.attr', 'data-count', '3');
    cy.get('[data-testid="status-rest-scene"]').should('not.exist');
  });
});
