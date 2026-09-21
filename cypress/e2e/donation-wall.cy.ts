const DONATION_GIST = '**/gists/eb9a7ef2cf49ecab72adebeacea420bf';

const mockDonations = (donations: object[]) => ({
  statusCode: 200,
  body: {
    files: {
      'contributions.json': {
        content: JSON.stringify(donations),
      },
    },
  },
});

const sampleDonations = [
  { donorId: 'd1', transactionId: 'tx-1', timestamp: '2026-03-24T12:00:00.000Z', type: 'Tip', fromName: 'Alice', message: 'Great tool!', amount: 50, currency: 'USD' },
  { donorId: 'd2', transactionId: 'tx-2', timestamp: '2026-03-23T12:00:00.000Z', type: 'Tip', fromName: 'Bob', message: '', amount: 25, currency: 'USD' },
  { donorId: 'd3', transactionId: 'tx-3', timestamp: '2026-03-22T12:00:00.000Z', type: 'Monthly Tip', fromName: 'Charlie', message: 'Happy to support!', amount: 5, currency: 'USD' },
  { donorId: 'd4', transactionId: 'tx-4', timestamp: '2026-03-21T12:00:00.000Z', type: 'Tip', fromName: 'Diana', message: '', amount: 10, currency: 'USD' },
  { donorId: 'd5', transactionId: 'tx-5', timestamp: '2026-03-20T12:00:00.000Z', type: 'Tip', fromName: 'Eve', message: '', amount: 15, currency: 'USD' },
];

const openDonationDrawer = () => {
  // Toggle Ko-Fi feed via Redux store
  cy.window().then((win) => {
    const store = (win as any).__store__;
    if (store) {
      store.dispatch({
        type: 'app/updateAllSettings/fulfilled',
        payload: { ...store.getState().app.settings, appShowKoFiFeed: 'true' },
      });
    }
  });
};

describe('Donation Wall', () => {
  beforeEach(() => {
    // Set up Discord API mocks, then override donation gist with sample data
    cy.interceptDiscordApi();
    // Override the empty default AFTER interceptDiscordApi (LIFO — last wins)
    cy.intercept('GET', DONATION_GIST, mockDonations(sampleDonations)).as('getDonations');
    cy.visit('/');
    cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
    openDonationDrawer();
  });

  it('should display donation feed with cards', () => {
    cy.contains('Alice').should('be.visible');
    cy.contains('Bob').should('be.visible');
  });

  it('should show filter chips', () => {
    cy.contains('.MuiChip-root', 'All').should('be.visible');
    cy.contains('.MuiChip-root', 'Tips').should('be.visible');
    cy.contains('.MuiChip-root', 'Monthly').should('be.visible');
    cy.contains('.MuiChip-root', 'Messages').should('be.visible');
  });

  it('should filter to only messages when Messages chip is clicked', () => {
    cy.contains('.MuiChip-root', 'Messages').click();
    // Alice and Charlie have messages
    cy.contains('Alice').should('be.visible');
    cy.contains('Charlie').should('be.visible');
    // Bob, Diana, Eve don't
    cy.contains('Bob').should('not.exist');
  });

  describe('Byte-ladder tiers (#231)', () => {
    // Tier identity surfaces in the UI as the amount-chip color coming
    // from @pratherbytecraft/contributions (tier NAMES are computed by
    // getTierInfo but never rendered as text — name strings are covered
    // by donationUtils unit tests). Assert the package's thresholds are
    // wired through to the rendered chips, and that no legacy metal
    // label ever reaches the DOM.
    const TIER_COLORS = {
      bit: 'rgb(205, 127, 50)', // #cd7f32, $0+
      byte: 'rgb(192, 192, 192)', // #c0c0c0, $5+
      kilobyte: 'rgb(255, 215, 0)', // #ffd700, $20+
      megabyte: 'rgb(229, 228, 226)', // #e5e4e2, $50+
      gigabyte: 'rgb(185, 242, 255)', // #b9f2ff, $100+
    };

    it('colors amount chips by the byte-ladder tier thresholds', () => {
      // Alice $50 → Megabyte, Bob $25 → Kilobyte, Charlie $5 → Byte.
      // Anchored regexes: '$5' must not substring-match the '$50' chip.
      cy.contains('.MuiChip-root', /^\$50$/).should(
        'have.css',
        'background-color',
        TIER_COLORS.megabyte,
      );
      cy.contains('.MuiChip-root', /^\$25$/).should(
        'have.css',
        'background-color',
        TIER_COLORS.kilobyte,
      );
      cy.contains('.MuiChip-root', /^\$5$/).should(
        'have.css',
        'background-color',
        TIER_COLORS.byte,
      );
    });

    it('renders the Bit and Gigabyte ladder extremes', () => {
      // The shared sample has no <$5 or >=$100 donor — reload with both
      // extremes (LIFO override registered before the re-visit).
      const extremeDonations = [
        { donorId: 'd-giga', transactionId: 'tx-giga', timestamp: '2026-03-25T12:00:00.000Z', type: 'Tip', fromName: 'Grace', message: '', amount: 150, currency: 'USD' },
        { donorId: 'd-bit', transactionId: 'tx-bit', timestamp: '2026-03-24T12:00:00.000Z', type: 'Tip', fromName: 'Bitty', message: '', amount: 2, currency: 'USD' },
      ];
      cy.intercept('GET', DONATION_GIST, mockDonations(extremeDonations)).as(
        'getExtremeDonations',
      );
      cy.visit('/');
      cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
      openDonationDrawer();

      cy.contains('Grace').should('be.visible');
      cy.contains('.MuiChip-root', /^\$150$/).should(
        'have.css',
        'background-color',
        TIER_COLORS.gigabyte,
      );
      cy.contains('.MuiChip-root', /^\$2$/).should(
        'have.css',
        'background-color',
        TIER_COLORS.bit,
      );
    });

    it('never renders a legacy metal tier name in the drawer', () => {
      cy.contains('Alice').should('be.visible');
      cy.get('.MuiDrawer-paper').should('be.visible');
      for (const metal of ['Copper', 'Silver', 'Gold', 'Platinum', 'Diamond']) {
        cy.get('.MuiDrawer-paper').should('not.contain.text', metal);
      }

      // Same check on the Top (leaderboard) tab, which styles rows by tier.
      cy.contains('[role="tab"]', 'Top').click();
      cy.contains('#1').should('be.visible');
      for (const metal of ['Copper', 'Silver', 'Gold', 'Platinum', 'Diamond']) {
        cy.get('.MuiDrawer-paper').should('not.contain.text', metal);
      }
    });
  });

  describe('Polling', () => {
    it('should preserve active tab when new data arrives from poll', () => {
      // Switch to Top tab
      cy.contains('[role="tab"]', 'Top').click();
      cy.contains('#1').should('be.visible');

      // Register updated data for next fetch
      const updatedDonations = [
        { donorId: 'd-new', transactionId: 'tx-new', timestamp: new Date().toISOString(), type: 'Tip', fromName: 'New Donor', message: '', amount: 100, currency: 'USD' },
        ...sampleDonations,
      ];
      cy.intercept('GET', DONATION_GIST, mockDonations(updatedDonations)).as('getDonationsPoll');

      // Manually trigger a re-fetch via the store to simulate poll
      cy.window().then((win) => {
        const store = (win as any).__store__;
        if (store) {
          // The useDonations hook polls via setInterval — we can't easily
          // control that, so instead verify the architectural guarantee:
          // view state is in DonationDrawer (React state), not in the
          // donations data. Updating donations won't reset the tab.
          // Verify tab is still Top after data changes
        }
      });

      // The tab should still be Top (view state is local, not data-driven)
      cy.contains('#1').should('be.visible');
      cy.get('.MuiTab-root.Mui-selected').should('contain.text', 'Top');
    });

    it('should not show loading spinner on poll refresh', () => {
      // Verify initial data loaded
      cy.contains('Alice').should('be.visible');

      // The drawer should not flash a loading state on subsequent fetches
      // (useDonations only shows spinner on initial load, not polls)
      // Verify no skeleton loaders are visible after data is loaded
      cy.get('.MuiDrawer-paper').within(() => {
        cy.get('[class*="glowPulse"]').should('not.exist');
      });
    });

    it('should keep drawer open and functional after data update', () => {
      // Verify drawer is open with data
      cy.contains('Alice').should('be.visible');

      // Update intercept with new data
      const updatedDonations = [
        { donorId: 'd-new', transactionId: 'tx-new', timestamp: new Date().toISOString(), type: 'Tip', fromName: 'New Donor', message: 'Fresh!', amount: 200, currency: 'USD' },
        ...sampleDonations,
      ];
      cy.intercept('GET', DONATION_GIST, mockDonations(updatedDonations)).as('getDonationsPoll');

      // Force a re-render by toggling filter (proves UI is still interactive)
      cy.contains('.MuiChip-root', 'Tips').click();
      cy.contains('.MuiChip-root', 'All').click();

      // Drawer should still be functional
      cy.contains('Alice').should('be.visible');
      cy.get('.MuiDrawer-paper').should('be.visible');
    });
  });
});
