// 2.2.5 scroll skeletons: a scrollbar drag through the feed shows skeleton
// rows instead of empty space, and the real rows come back once it rests.
describe('Feed scroll skeletons', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.get('[data-testid="message-feed-row"]').should('have.length.greaterThan', 0);
  });

  // The fixture channel is short, so the list is stretched first to give the
  // scroller room; the velocity reading only needs scrollTop to move between
  // events.
  const drag = (el: HTMLElement, steps: number, px: number) => {
    const list = el.querySelector('[data-testid="message-feed-items"]') as HTMLElement | null;
    if (list) list.style.height = '40000px';
    for (let i = 0; i < steps; i++) {
      el.scrollTop += px;
      el.dispatchEvent(new Event('scroll'));
    }
  };

  it('keeps the rows on screen through a fast drag and opens the skeleton layer for the rest', () => {
    cy.get('[data-testid="message-chunk"]').its('length').then((mounted) => {
      cy.get('[data-testid="message-feed-scroller"]').then(($el) => {
        // Two fast events enter; the rest keep it alive across this tick.
        drag($el[0], 6, 400);
      });
      // The fixture's rows were all on screen, so they stay real and the layer is empty.
      cy.get('[data-testid="message-feed-fast-layer"]').should('exist');
      cy.get('[data-testid="message-chunk"]').should('have.length', mounted);
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
      // Once the scroll rests the layer goes and nothing fades, since no row was a skeleton.
      cy.get('[data-testid="message-feed-fast-layer"]').should('not.exist');
      cy.get('[data-testid="message-chunk-skeleton-fading"]').should('not.exist');
      cy.get('[data-testid="message-chunk"]').should('have.length', mounted);
    });
  });

  it('a single jump keeps the real rows', () => {
    cy.get('[data-testid="message-feed-scroller"]').then(($el) => { drag($el[0], 1, 5000); });
    cy.get('[data-testid="message-chunk-skeleton"]').should('not.exist');
    cy.get('[data-testid="message-chunk"]').should('exist');
  });

  it('slow scrolling keeps the real rows', () => {
    cy.get('[data-testid="message-feed-scroller"]').then(($el) => { drag($el[0], 4, 20); });
    cy.get('[data-testid="message-chunk-skeleton"]').should('not.exist');
    cy.get('[data-testid="message-chunk"]').should('exist');
  });
});
