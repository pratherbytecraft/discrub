describe('Bulk Export', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    // Wait for channels to load
    cy.contains('general').should('be.visible');
  });

  describe('Channel Multi-Select Mode', () => {
    it('should have multi-select toggle button', () => {
      cy.get('[aria-label="Toggle multi-select"]').should('be.visible');
    });

    it('should enter multi-select mode on toggle click', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      // Multi-select bar should appear with select/deselect toggle
      cy.get('[aria-label="Select all channels"]').should('be.visible');
    });

    it('should show selected count chip when channels are selected', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      // Click on a channel to select it (multi-select mode)
      cy.contains('general').click();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '1 of');
    });

    it('should select multiple channels in multi-select mode', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.contains('dev-chat').click();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '2 of');
    });

    it('should show Export Selected button when channels are selected', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Export selected channels"]').should('be.visible');
    });

    it('should not show Export Selected button with no selections', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Export selected channels"]').should('not.exist');
    });

    it('should select all channels with Select All button', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Select all channels"]').click();
      // Should have selected text channels (not voice/category)
      cy.get('[data-testid="multi-select-count"]').should('exist');
    });

    it('should deselect all channels when multi-select toggle is clicked off', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Select all channels"]').click();
      cy.get('[data-testid="multi-select-count"]').should('exist');
      // Toggling multi-select off deselects all channels
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Export selected channels"]').should('not.exist');
    });

    it('should exit multi-select mode on second toggle click', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Select all channels"]').should('be.visible');
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.get('[aria-label="Select all channels"]').should('not.exist');
    });
  });

  describe('Bulk Export Dialog (Channels)', () => {
    beforeEach(() => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.contains('dev-chat').click();
    });

    it('should open BulkExportDialog with selected count', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Bulk Export').should('be.visible');
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '2 of');
    });

    it('should have HTML as default format', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('input[value="html"]').should('be.checked');
    });

    it('should show format options', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains('HTML').should('be.visible');
      cy.get('[role="dialog"]').contains('CSV').should('be.visible');
      cy.get('[role="dialog"]').contains('JSON').should('be.visible');
      cy.get('[role="dialog"]').contains('Media Only').should('be.visible');
    });

    it('should keep messages per page enabled for CSV and JSON formats', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains('label', 'CSV').click();
      cy.get('[role="dialog"]').find('input[type="number"]').should('not.be.disabled');
      cy.get('[role="dialog"]').contains('label', 'JSON').click();
      cy.get('[role="dialog"]').find('input[type="number"]').should('not.be.disabled');
    });

    it('should disable messages per page for Media Only format', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains('label', 'Media Only').click();
      cy.get('[role="dialog"]').find('input[type="number"]').should('be.disabled');
    });

    it('should close dialog on Cancel', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('should show three accordion sections', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains('Format & Output').should('be.visible');
      cy.get('[role="dialog"]').contains('Content').should('exist');
      cy.get('[role="dialog"]').contains('Files & Media').scrollIntoView().should('be.visible');
    });

    it('should show channel list above accordion', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      // Channel names appear before the accordion sections
      cy.get('[role="dialog"]').contains('general').should('be.visible');
      cy.get('[role="dialog"]').contains('dev-chat').should('be.visible');
    });

    it('should have no media counts in bulk mode', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      // Expand Media accordion
      cy.get('[role="dialog"]').contains('Media Only').click();
      // In bulk mode, labels should be plain without file counts
      cy.get('[role="dialog"]').contains('Images').should('exist');
      cy.get('[role="dialog"]').contains(/\d+ files?/).should('not.exist');
    });

    it('should show preset selector', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      // Selector now has a "Preset" label above and a "Choose..." placeholder
      cy.get('[role="dialog"]').contains('Preset').should('exist');
      cy.get('[role="dialog"]').contains('Choose...').should('exist');
    });

    it('should show summary chip', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains('HTML').should('exist');
      cy.get('[role="dialog"]').contains('/page').should('exist');
    });

    it('shows optional "Add filters" affordance for narrowing (#112)', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains(/Narrow messages/i).should('be.visible');
      cy.get('[role="dialog"]')
        .find('button[aria-label="Add filters"]')
        .should('be.visible');
      // Empty filter state still allows export — filters are optional here.
      cy.get('[role="dialog"]')
        .contains('button', /Export 2 Channels/)
        .should('not.be.disabled');
    });

    it('opens the filter modal with the Refine section hidden (#112)', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      // FilterModal stacks atop the export dialog — `.last()` is it.
      cy.get('[role="dialog"]').last().within(() => {
        cy.contains('Search').should('be.visible');
        // hideRefineSection on FilterModal suppresses the Refine block.
        cy.contains('Refine').should('not.exist');
        // Confirm button is relabeled "Apply filters" for bulk context.
        // (Disabled at rest because no filter deltas yet — just assert it exists.)
        cy.contains('button', 'Apply filters').should('exist');
      });
    });

    it('applying a filter shows the filter chip row back in the export dialog (#112)', () => {
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();

      // Set a simple content filter in the modal
      cy.get('[role="dialog"]').last().within(() => {
        cy.get('input[placeholder*="Search message content"]').type('hello');
        cy.contains('button', 'Apply filters').click();
      });

      // Back in the outer export dialog: single "Edit filters (N)"
      // button — no separate Clear control (FilterModal owns Clear).
      cy.get('[role="dialog"]').first().within(() => {
        cy.get('button[aria-label="Edit filters"]').should('be.visible').and('contain', '(1)');
        cy.get('button[aria-label="Clear filters"]').should('not.exist');
      });
    });

    it('filter state clears when the export dialog is closed and reopened (regression)', () => {
      // Repro: without the keyed FilterModal remount, typed-but-not-
      // applied values persisted in the modal's internal useState even
      // after the outer dialog closed and reopened (because the
      // FilterModal component stayed mounted behind the scenes).
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().within(() => {
        cy.get('input[placeholder*="Search message content"]').type('stale-value');
        // Close without applying — hit the dialog-level Cancel.
        cy.contains('button', 'Cancel').click();
      });

      // Close the outer export dialog.
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');

      // Reopen the export dialog.
      cy.get('[aria-label="Export selected channels"]').click();
      // Filter chip row should show zero state (the typed value was never applied).
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').should('be.visible');
      // Reopen the filter modal and confirm the content field is empty.
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();
      cy.get('[role="dialog"]').last().within(() => {
        cy.get('input[placeholder*="Search message content"]').should('have.value', '');
      });
    });
  });

  describe('Filter criteria threading through search API (#112)', () => {
    beforeEach(() => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
    });

    it('with filters: hits /messages/search and NOT the list endpoint, criteria in URL', () => {
      // Route both endpoints to a single handler that classifies. We
      // cap list-fetch to a quick success so the export finishes.
      const listUrls: string[] = [];
      const searchUrls: string[] = [];

      cy.intercept('GET', '**/api/v10/channels/*/messages**', (req) => {
        if (req.url.includes('/messages/search')) {
          searchUrls.push(req.url);
          req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
        } else {
          listUrls.push(req.url);
          req.reply({ statusCode: 200, body: [] });
        }
      });

      cy.intercept('GET', '**/api/v10/guilds/*/messages/search**', (req) => {
        searchUrls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
      }).as('guildSearch');

      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').find('button[aria-label="Add filters"]').click();

      cy.get('[role="dialog"]').last().within(() => {
        cy.get('input[placeholder*="Search message content"]').type('hello');
        cy.contains('button', 'Apply filters').click();
      });

      cy.get('[role="dialog"]').contains('button', /Export/).click();

      // Wait on the actual search call — auth + thread discovery + export
      // kickoff takes longer than a fixed sleep can reliably cover.
      cy.wait('@guildSearch', { timeout: 20000 });

      cy.then(() => {
        expect(searchUrls.length, 'search endpoint hit').to.be.greaterThan(0);
        expect(listUrls.length, 'list endpoint NOT hit with filters').to.eq(0);
        const withContent = searchUrls.find((u) => u.includes('content=hello'));
        expect(
          withContent,
          `expected a search URL containing content=hello — saw: ${searchUrls.join(' | ')}`,
        ).to.exist;
      });
    });

    it('without filters: hits the list endpoint, NOT search (regression guard)', () => {
      const listUrls: string[] = [];
      const searchUrls: string[] = [];

      cy.intercept('GET', '**/api/v10/channels/*/messages**', (req) => {
        if (req.url.includes('/messages/search')) {
          searchUrls.push(req.url);
          req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
        } else {
          listUrls.push(req.url);
          req.reply({ statusCode: 200, body: [] });
        }
      }).as('channelFetch');

      cy.intercept('GET', '**/api/v10/guilds/*/messages/search**', (req) => {
        searchUrls.push(req.url);
        req.reply({ statusCode: 200, body: { messages: [], total_results: 0, threads: [] } });
      });

      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').contains('button', /Export/).click();

      // Wait for the list endpoint to fire at least once.
      cy.wait('@channelFetch', { timeout: 20000 });

      cy.then(() => {
        expect(listUrls.length, 'list endpoint hit').to.be.greaterThan(0);
        expect(searchUrls.length, 'search endpoint NOT hit without filters').to.eq(0);
      });
    });
  });

  describe('Bulk Export Dialog Media Settings', () => {
    beforeEach(() => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
    });

    it('should force media checkbox checked when Media Only is selected', () => {
      cy.get('[role="dialog"]').contains('label', 'Media Only').click();
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .should('be.checked');
    });

    it('should disable media checkbox when Media Only is selected', () => {
      cy.get('[role="dialog"]').contains('label', 'Media Only').click();
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .should('be.disabled');
    });

    it('should restore media checkbox state when switching away from Media Only', () => {
      // Expand Media accordion (use AccordionSummary to avoid matching "Media Only" label)
      cy.get('[role="dialog"]').find('.MuiAccordionSummary-content').contains('Files & Media').scrollIntoView().click();

      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .invoke('prop', 'checked')
        .then((initialState) => {
          // Switch to Media Only — forced checked
          cy.get('[role="dialog"]').contains('label', 'Media Only').scrollIntoView().click();
          cy.get('[role="dialog"]')
            .contains('label', 'Download files for offline viewing')
            .find('input[type="checkbox"]')
            .should('be.checked');

          // Switch back to HTML — should restore
          cy.get('[role="dialog"]').contains('label', 'HTML').scrollIntoView().click();
          cy.get('[role="dialog"]')
            .contains('label', 'Download files for offline viewing')
            .find('input[type="checkbox"]')
            .should(initialState ? 'be.checked' : 'not.be.checked');
        });
    });

    it('should show media type checkboxes when Media Only is selected', () => {
      cy.get('[role="dialog"]').contains('label', 'Media Only').click();
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      cy.get('[role="dialog"]').contains('Images').should('exist');
      cy.get('[role="dialog"]').contains('Videos').should('exist');
    });

    it('should hide "Other files" checkbox in web app mode', () => {
      cy.get('[role="dialog"]').contains('label', 'Media Only').click();
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      cy.get('[role="dialog"]').contains('Images').should('exist');
      cy.get('[role="dialog"]').contains('Other files').should('not.exist');
    });

    it('should show artist mode in Media section', () => {
      cy.get('[role="dialog"]').contains('label', 'Media Only').click();
      // Wait for media types to appear (Collapse animation), then scroll to Artist mode
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      // Artist mode may be below the fold — scroll dialog content
      cy.get('[role="dialog"]').find('.MuiDialogContent-root').scrollTo('bottom');
      cy.get('[role="dialog"]').contains('Artist mode').should('exist');
    });
  });

  // ── #238: Forum expansion during bulk export ──────────────────────────
  // Forum/media channels have no message stream of their own (the parent
  // 400s on GET /channels/{id}/messages), so bulkExportChannels expands
  // each selected forum into its post threads via
  // GET /channels/{id}/threads/search (25 per page, offset walk) before
  // exporting. Post folders are prefixed with the forum's name and the
  // Discord shell groups them under the forum as a pseudo-category.
  // Listing failures retry under withTransientRetry (5 retries,
  // 1/2/4/8/16s backoff); exhaustion is an ERROR in the run summary, not
  // end-of-pagination (the pre-fix bug silently truncated forums).
  describe('Forum expansion during bulk export (#238)', () => {
    const API = '**/api/v10';
    // The "feedback" forum (type 15 GUILD_FORUM) from channels.json;
    // forum-threads.json lists its 3 posts with has_more: false.
    const FORUM_ID = '801000000000000007';

    /** Zero out operation delays so the export loop runs at test speed.
     *  Keys are the DiscrubSetting enum values (SEARCH_DELAY etc.).
     *  Dispatched as updateAllSettings.fulfilled (not plain setSettings)
     *  so settingsChangeMiddleware reconstructs the discrub-core service
     *  singleton, whose request pacing reads a constructor-time settings
     *  snapshot rather than the store. */
    const zeroDelays = () => {
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateAllSettings/fulfilled',
          payload: {
            ...store.getState().app.settings,
            searchDelay2: '0',
            deleteDelay2: '0',
            delayModifier2: '0',
          },
        });
      });
    };

    const statusEntries = (win: Cypress.AUTWindow) =>
      (win as any).__store__.getState().status.entries as {
        message: string;
        level: string;
      }[];

    /** Select ONLY the feedback forum and open the bulk-export dialog. */
    const openBulkExportForForum = () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      // Exact-text match — "Share your feedback" (the forum topic) also
      // contains the substring "feedback".
      cy.contains(/^feedback$/).click();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '1 of');
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
    };

    /** Ensure "Download files for offline viewing" is unchecked so the
     *  export stays fully offline — the shared messages fixture carries
     *  cdn.discordapp.com attachment/avatar URLs that would otherwise be
     *  fetched for real. State-agnostic: EXPORT_DOWNLOAD_MEDIA defaults
     *  to 'false' (storageKeys.ts), so usually this is a no-op. */
    const disableMediaDownload = () => {
      cy.get('[role="dialog"]')
        .find('.MuiAccordionSummary-content')
        .contains('Files & Media')
        .scrollIntoView()
        .click();
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .then(($input) => {
          if ($input.prop('checked')) {
            cy.wrap($input).click({ force: true });
          }
        });
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .should('not.be.checked');
    };

    const startExport = () => {
      cy.get('[role="dialog"]').contains('button', /Export 1 Channel/).click();
    };

    beforeEach(() => {
      zeroDelays();
      // One shared-fixture message has reactions; HTML export fetches
      // reacting users. Keep that offline too.
      cy.intercept('GET', `${API}/channels/*/messages/*/reactions/*`, {
        statusCode: 200,
        body: [],
      }).as('getReactingUsers');
    });

    it('expands a forum into posts, logs the expansion, and groups posts under the forum name in the zip', () => {
      cy.task('downloads:clean');

      // The forum PARENT must never be fetched as a message channel —
      // that 400s on real Discord (#238's original symptom was a
      // README-only zip that read as success).
      let forumParentMessageFetches = 0;
      cy.intercept('GET', `${API}/channels/${FORUM_ID}/messages*`, (req) => {
        forumParentMessageFetches++;
        req.reply({ statusCode: 400, body: {} });
      });

      const listingUrls: string[] = [];
      cy.fixture('forum-threads.json').then((forumThreads) => {
        cy.intercept('GET', `${API}/channels/${FORUM_ID}/threads/search*`, (req) => {
          listingUrls.push(req.url);
          req.reply({ statusCode: 200, body: forumThreads });
        }).as('forumList');
      });

      openBulkExportForForum();
      disableMediaDownload();
      startExport();

      // The post-listing endpoint pages the forum (25/page offset walk,
      // active + archived union — no `archived` param).
      cy.wait('@forumList', { timeout: 20000 })
        .its('request.url')
        .should('satisfy', (url: string) =>
          url.includes(`/channels/${FORUM_ID}/threads/search`) &&
          url.includes('limit=25') &&
          url.includes('offset=0'));

      cy.waitForDownload(/^bulk-export\.zip$/i, 60000).then((fileName) => {
        cy.then(() => {
          expect(listingUrls, 'single listing page for has_more:false').to.have.length(1);
          expect(forumParentMessageFetches, 'forum parent /messages never fetched').to.eq(0);
        });

        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const names = entries.map((e) => e.name);
          // Post folders are prefixed with the forum's name so posts
          // stay grouped and can't collide on bare post names.
          expect(names).to.include(
            'feedback_app_crashes_on_startup/feedback_app_crashes_on_startup-page-1.html');
          expect(names).to.include(
            'feedback_dark_mode_support/feedback_dark_mode_support-page-1.html');
          expect(names).to.include(
            'feedback_how_do_i_export_data/feedback_how_do_i_export_data-page-1.html');
          expect(names).to.include('shell.html');
          expect(names).to.include('README.html');
        });

        cy.task<string>('zip:read', { fileName, entry: 'shell.html' }).then((shell) => {
          // #238: forum posts are grouped under the forum's name as a
          // pseudo-category in the Discord shell sidebar.
          expect(shell).to.include('class="category-name">FEEDBACK<');
          expect(shell).to.include('App crashes on startup');
          expect(shell).to.include('Dark mode support');
          expect(shell).to.include('How do I export data?');
          expect(shell).to.include(
            'data-filename="feedback_app_crashes_on_startup/feedback_app_crashes_on_startup-page-1.html"');
        });
      });

      // Status log shows the expansion entry (exact string from
      // exportSlice). `exist` not `be.visible` — the panel renders the
      // latest 50 entries in a scrollable list, and this entry sits above
      // the auto-scrolled tail by the time the export completes.
      cy.contains('STATUS LOG').click();
      cy.contains('Bulk export: Expanded forum feedback into 3 posts').should('exist');
    });

    it('reports post-listing failure as an ERROR after retries, never a silent empty success', () => {
      // withTransientRetry: initial call + 5 retries with 1/2/4/8/16s
      // backoff — this test legitimately takes ~35s of wall time.
      let listingCalls = 0;
      cy.intercept('GET', `${API}/channels/${FORUM_ID}/threads/search*`, (req) => {
        listingCalls++;
        req.reply({ statusCode: 500, body: { message: 'Internal Server Error' } });
      }).as('forumList');

      openBulkExportForForum();
      startExport();

      // 6 total attempts (1 + 5 retries), spaced by exponential backoff.
      for (let i = 0; i < 6; i++) {
        cy.wait('@forumList', { timeout: 40000 });
      }
      cy.then(() => expect(listingCalls, 'initial attempt + 5 retries').to.eq(6));

      cy.window({ timeout: 30000 }).should((win) => {
        const entries = statusEntries(win);
        const msgs = entries.map((e) => e.message);
        // Retry WARNs fire before each backoff sleep (first and last).
        expect(msgs, 'first retry WARN').to.include(
          'Bulk export: post listing for feedback failed, retrying in 1s (attempt 1/5)');
        expect(msgs, 'final retry WARN').to.include(
          'Bulk export: post listing for feedback failed, retrying in 16s (attempt 5/5)');
        // Exhaustion lands as an ERROR entry naming the forum + status...
        const errorEntry = entries.find((e) =>
          e.message === "Bulk export: Failed to expand forum feedback: Could not list this forum's posts (500); 0 fetched before the failure");
        expect(errorEntry, 'error status entry for the failed forum').to.exist;
        expect(errorEntry?.level, 'failure logged at error level').to.eq('error');
        // ...and the run summary flags the README-only zip.
        expect(msgs, 'empty-zip warning').to.include(
          'Bulk export: 0 channels exported, the zip contains only the README. Review the entries above for skipped or failed channels.');
        // NOT the pre-fix silent outcomes: no successful expansion, and
        // no "0 posts, skipping" downgrade of the failure to a skip.
        expect(msgs.some((m) => m.includes('Expanded forum')),
          'no expansion success entry').to.eq(false);
        expect(msgs.some((m) => m.includes('No posts in feedback')),
          'failure not downgraded to an empty-forum skip').to.eq(false);
      });

      // The failure surfaces in the status log UI (see the visibility
      // note in the previous test for why `exist`).
      cy.contains('STATUS LOG').click();
      cy.contains('Bulk export: Failed to expand forum feedback').should('exist');
    });

    it('recovers from a transient listing failure: retry WARN, then successful expansion', () => {
      cy.task('downloads:clean');

      let listingCalls = 0;
      cy.fixture('forum-threads.json').then((forumThreads) => {
        cy.intercept('GET', `${API}/channels/${FORUM_ID}/threads/search*`, (req) => {
          listingCalls++;
          if (listingCalls === 1) {
            req.reply({ statusCode: 500, body: { message: 'Internal Server Error' } });
          } else {
            req.reply({ statusCode: 200, body: forumThreads });
          }
        }).as('forumList');
      });

      openBulkExportForForum();
      disableMediaDownload();
      startExport();

      cy.wait('@forumList', { timeout: 20000 }); // failing first attempt
      cy.wait('@forumList', { timeout: 20000 }); // successful retry (1s backoff)

      cy.window({ timeout: 30000 }).should((win) => {
        const msgs = statusEntries(win).map((e) => e.message);
        expect(msgs, 'retry WARN for the transient failure').to.include(
          'Bulk export: post listing for feedback failed, retrying in 1s (attempt 1/5)');
        expect(msgs, 'expansion succeeded after the retry').to.include(
          'Bulk export: Expanded forum feedback into 3 posts');
        expect(msgs.some((m) => m.includes('Failed to expand forum')),
          'no error entry after recovery').to.eq(false);
      });

      cy.then(() =>
        expect(listingCalls, 'failed page retried once, then has_more:false ended the walk').to.eq(2));

      // Let the run finish cleanly (3 posts export in seconds with zero
      // delays and media downloads disabled).
      cy.waitForDownload(/^bulk-export\.zip$/i, 60000);
    });
  });

  // #276: Stop keeps what was pulled. A stopped bulk export used to finish
  // with a zip holding only README.html; now the pages fetched before Stop
  // are written for the channel in progress and the zip downloads.
  describe('Stop keeps what was pulled (#276)', () => {
    const API = '**/api/v10';
    const page = (start: number) =>
      Array.from({ length: 100 }, (_, i) => ({
        id: `${900000000000000000 - start - i}`,
        channel_id: '801000000000000001',
        author: { id: '222333444555666777', username: 'alice_dev', discriminator: '0', avatar: null, global_name: 'Alice' },
        content: `Bulk message ${start + i + 1}`,
        timestamp: `2026-02-${String(1 + ((start + i) % 27)).padStart(2, '0')}T12:00:00.000Z`,
        edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0,
      }));

    it('a stopped bulk export still downloads a zip with the pages pulled so far', () => {
      cy.task('downloads:clean');
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateAllSettings/fulfilled',
          payload: { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0', reactionsEnabled: 'false' },
        });
      });
      let calls = 0;
      cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
        calls += 1;
        if (calls === 1) req.reply({ statusCode: 200, body: page(0) });
        else req.reply({ statusCode: 200, body: page(100), delay: 6000 });
      }).as('walk');

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('general').click();
      cy.get('[aria-label="Export selected channels"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.get('[role="dialog"]').find('.MuiAccordionSummary-content').contains('Files & Media').scrollIntoView().click();
      cy.get('[role="dialog"]').contains('label', 'Download files for offline viewing').find('input[type="checkbox"]').then(($input) => {
        if ($input.prop('checked')) cy.wrap($input).click({ force: true });
      });
      cy.get('[role="dialog"]').contains('button', /Export 1 Channel/).click();

      // Page 1 is in hand and page 2 is on its way back when Stop is hit.
      cy.wait('@walk');
      cy.window({ timeout: 15000 }).should(() => {
        expect(calls, 'second page requested').to.be.greaterThan(1);
      });
      cy.get('[aria-label="Stop"]').click({ force: true });

      cy.waitForDownload(/^bulk-export\.zip$/i, 60000).then((fileName) => {
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const names = entries.map((e) => e.name);
          expect(names).to.include('general/general-page-1.html');
          expect(names).to.include('README.html');
        });
        cy.task<string>('zip:read', { fileName, entry: 'general/general-page-1.html' }).then((html) => {
          expect(html).to.include('Bulk message 1');
          expect(html).to.include('Bulk message 100');
          expect(html).not.to.include('Bulk message 101');
        });
      });
      cy.window().then((win) => {
        const entries = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(entries.some((m) => m.startsWith('Export: Stopped · kept 100 messages from #general, oldest from '))).to.eq(true);
      });
    });
  });

  describe('DM Multi-Select Mode', () => {
    beforeEach(() => {
      // Switch to DMs tab
      cy.contains('button', 'DMs').click();
      cy.wait('@getDMs');
    });

    it('should have multi-select toggle in DM list', () => {
      cy.get('[aria-label="Toggle multi-select"]').should('be.visible');
    });

    it('should enter multi-select mode and select DMs', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('alice_dev').click();
      cy.contains('bob_gamer').click();
      cy.get('[data-testid="multi-select-count"]').should('contain.text', '2 of');
    });

    it('should show Export Selected button for DMs', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('alice_dev').click();
      cy.get('[aria-label="Export selected conversations"]').should('be.visible');
    });

    it('should open BulkExportDialog for DMs', () => {
      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('alice_dev').click();
      cy.get('[aria-label="Export selected conversations"]').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Bulk Export').should('be.visible');
    });
  });
});
