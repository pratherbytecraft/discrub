/// <reference types="cypress" />

describe('Export', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
  });

  it('opens ExportDialog with "Export Messages" title', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains('Export Messages').should('be.visible');
  });

  it('shows three accordion sections', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Format & Output').should('be.visible');
    cy.get('[role="dialog"]').contains('Content').should('exist');
    cy.get('[role="dialog"]').contains('Files & Media').scrollIntoView().should('be.visible');
  });

  it('Format & Output is expanded by default', () => {
    cy.contains('button', 'Export').click();
    // Format radios should be visible without clicking
    cy.get('[role="dialog"]').contains('HTML - Styled').should('be.visible');
  });

  it('has HTML as the default export format', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('HTML - Styled').should('be.visible');
  });

  it('keeps "Messages per page" enabled for CSV and JSON formats', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('CSV - Spreadsheet').click();
    cy.get('[role="dialog"]').find('input[type="number"]').should('not.be.disabled');
    cy.get('[role="dialog"]').contains('JSON - Raw').click();
    cy.get('[role="dialog"]').find('input[type="number"]').should('not.be.disabled');
  });

  // #184: Plain text format
  it('lists Plain Text as a format option', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Plain Text - Human-readable').should('be.visible');
  });

  // #207 Arm A: zip-splitting control
  it('shows the Max zip size control defaulting to 4 GB', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Max zip size').scrollIntoView().should('be.visible');
    cy.get('[role="dialog"]').contains('4 GB (recommended)').should('exist');
  });

  it('reveals the text-format options panel when Plain Text is selected', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Plain Text - Human-readable').click();
    cy.get('[role="dialog"]').find('[data-testid="text-format-options"]').should('be.visible');
    // The four gated selectors should be present.
    cy.get('[data-testid="text-format-options"]').contains('Attachments').scrollIntoView().should('be.visible');
    cy.get('[data-testid="text-format-options"]').contains('Reactions').scrollIntoView().should('be.visible');
    cy.get('[data-testid="text-format-options"]').contains('Replies').scrollIntoView().should('be.visible');
    cy.get('[data-testid="text-format-options"]').contains('Bot tag').scrollIntoView().should('be.visible');
  });

  it('hides the text-format options panel when switching back to HTML', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Plain Text - Human-readable').click();
    cy.get('[data-testid="text-format-options"]').should('be.visible');
    cy.get('[role="dialog"]').contains('HTML - Styled').click();
    cy.get('[data-testid="text-format-options"]').should('not.exist');
  });

  it('hides the HTML Template dropdown when Plain Text is selected', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Plain Text - Human-readable').click();
    // Template dropdown is HTML-only.
    cy.get('[role="dialog"]').contains('Template').should('not.exist');
  });

  it('disables "Messages per page" input when Media Only is selected', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Media Only').click();
    cy.get('[role="dialog"]').find('input[type="number"]').should('be.disabled');
  });

  it('shows message count and channel name', () => {
    cy.contains('button', 'Export').click();
    cy.contains('Exporting 13 messages from').should('be.visible');
    cy.contains('general').should('be.visible');
  });

  it('closes dialog when clicking Cancel without exporting', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();
    cy.get('[role="dialog"]').should('not.exist');
  });

  it('Content accordion expands on click', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Content').click();
    cy.get('[role="dialog"]').contains('Download threads').should('be.visible');
  });

  it('Sort order dropdown in Format section', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Sort Order').should('exist');
  });

  it('shows summary chip above export button', () => {
    cy.contains('button', 'Export').click();
    // Summary chip shows format info
    cy.get('[role="dialog"]').contains('HTML').should('exist');
    cy.get('[role="dialog"]').contains('/page').should('exist');
  });

  it('shows preset selector', () => {
    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('Choose...').should('exist');
  });

  describe('Preset application', () => {
    it('selecting a preset updates dialog format and settings', () => {
      cy.contains('button', 'Export').click();
      // Open preset dropdown
      cy.get('[role="dialog"]').find('[role="combobox"]').first().click({ force: true });
      // Select "Spreadsheet export" preset
      cy.get('[role="option"]').contains('Spreadsheet export').click();
      // Verify CSV is now selected
      cy.get('[role="dialog"]').find('input[value="csv"]').should('be.checked');
      // Messages per page should be enabled for CSV
      cy.get('[role="dialog"]').find('input[type="number"]').should('not.be.disabled');
    });

    it('selecting Media gallery preset enables artist mode', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').find('[role="combobox"]').first().click({ force: true });
      cy.get('[role="option"]').contains('Media gallery').click();
      // Media Only should be selected
      cy.get('[role="dialog"]').find('input[value="media"]').should('be.checked');
      // Artist mode should be checked (scroll into view first)
      cy.get('[role="dialog"]').contains('Artist mode').then(($el) => {
        $el[0].scrollIntoView({ block: 'center' });
      });
      cy.get('[role="dialog"]')
        .contains('label', 'Artist mode')
        .find('input[type="checkbox"]')
        .should('be.checked');
    });

    it('preset dropdown is clean-slate on reopen (does not persist across sessions)', () => {
      // Post-4ce3759 behavior: selecting a preset is session-local —
      // closing the dialog drops the selection so a fresh open starts
      // empty again. See memory/SESSION_2026_04_19 + EXPORT_SELECTED_PRESET
      // removal commits (4ce3759, 8ccf9d1, 9f3fe33).
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').find('[role="combobox"]').first().click({ force: true });
      cy.get('[role="option"]').contains('Spreadsheet export').click();
      // Close dialog
      cy.contains('button', 'Cancel').click();
      // Reopen — preset dropdown should be empty, NOT "Spreadsheet export"
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]')
        .find('[role="combobox"]')
        .first()
        .should('not.contain.text', 'Spreadsheet export');
    });

    it('manual format changes persist across reopen (settings are still saved globally)', () => {
      // The preset selection is session-local (clean-slate on reopen),
      // but the underlying export settings — format, pagination, etc. —
      // still persist via IndexedDB. A preset-selected-then-overridden
      // format should still be the manually-chosen format next time
      // the dialog opens, it just no longer carries the "(Modified)"
      // tag since the preset dropdown is cleared on close.
      cy.contains('button', 'Export').click();
      // Select Spreadsheet export preset (applies CSV + 100/page)
      cy.get('[role="dialog"]').find('[role="combobox"]').first().click({ force: true });
      cy.get('[role="option"]').contains('Spreadsheet export').click();
      cy.get('[role="dialog"]').find('input[value="csv"]').should('be.checked');
      // Manually override format to JSON
      cy.get('[role="dialog"]').find('input[value="json"]').parent().click();
      cy.get('[role="dialog"]').find('input[value="json"]').should('be.checked');
      // Close and reopen
      cy.contains('button', 'Cancel').click();
      cy.contains('button', 'Export').click();
      // Preset dropdown is clean-slate (empty), no "(Modified)" label
      cy.get('[role="dialog"]')
        .find('[role="combobox"]')
        .first()
        .should('not.contain.text', 'Modified');
      // But JSON format persisted because export settings still live in storage
      cy.get('[role="dialog"]').find('input[value="json"]').should('be.checked');
    });
  });

  describe('Template persistence', () => {
    it('selected template persists when dialog is closed and reopened', () => {
      cy.contains('button', 'Export').click();
      // Expand Content section to find template dropdown
      cy.get('[role="dialog"]').contains('Content').click();
      // Change template to Standard (default is Discord Layout)
      cy.get('[role="dialog"]').find('[role="combobox"]').last().click({ force: true });
      cy.get('[role="option"]').contains('Standard').click();
      // Close and reopen
      cy.contains('button', 'Cancel').click();
      cy.contains('button', 'Export').click();
      // Template should be persisted — summary chip should show "Standard"
      cy.get('[role="dialog"]').contains('Standard').should('exist');
    });
  });

  describe('Display options', () => {
    it('shows Display options sub-header with preview control', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').find('.MuiDialogContent-root').scrollTo('bottom');
      cy.get('[role="dialog"]').contains('Display options:').should('exist');
      cy.get('[role="dialog"]').contains('Preview media in export').should('exist');
    });
  });

  describe('Template selector', () => {
    it('shows template dropdown for HTML format', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Template').should('exist');
    });

    it('hides template dropdown for non-HTML formats', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('CSV - Spreadsheet').click();
      cy.get('[role="dialog"]').contains('Template').should('not.exist');
    });

    it('summary chip shows template name when changed', () => {
      cy.contains('button', 'Export').click();
      // Default is Discord Layout — switch to Standard
      cy.get('[role="dialog"]').find('[role="combobox"]').last().click({ force: true });
      cy.get('[role="option"]').contains('Standard').click();
      cy.get('[role="dialog"]').contains('Standard').should('exist');
    });
  });

  describe('Media file counts', () => {
    it('shows "(0 files)" for categories with no attachments', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      // general channel has 1 image attachment, 0 videos, 0 audio
      cy.get('[role="dialog"]').contains(/Videos \(0 files\)/).should('exist');
      cy.get('[role="dialog"]').contains(/Audio \(0 files\)/).should('exist');
    });

    it('shows file count and size for categories with attachments', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      // general channel has 1 image attachment
      cy.get('[role="dialog"]').contains(/Images \(1 file/).should('exist');
    });
  });

  describe('Summary chip updates', () => {
    it('updates summary chip when switching format to CSV', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('CSV - Spreadsheet').click();
      cy.get('[role="dialog"]').contains('CSV').should('exist');
      cy.get('[role="dialog"]').contains('/page').should('exist');
    });

    it('summary chip omits per page for Media Only', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      // Summary should show MEDIA but not /page
      cy.get('[role="dialog"]').contains('MEDIA').should('exist');
    });

    it('summary chip shows "Reactions: detailed" for HTML format', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Reactions: detailed').should('exist');
    });

    it('summary chip shows "Reactions: counts only" for CSV format', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('CSV - Spreadsheet').click();
      cy.get('[role="dialog"]').contains('Reactions: counts only').should('exist');
    });

    it('summary chip omits reaction info for Media Only', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('Reactions').should('not.exist');
    });
  });

  describe('Recent exports panel', () => {
    it('does not show recent exports when no history exists', () => {
      cy.contains('button', 'Export').click();
      // With no export history, the recent exports panel should not be visible
      cy.get('[role="dialog"]').contains('Recent exports').should('not.exist');
    });
  });

  describe('Media settings restore', () => {
    it('forces media checkbox checked when Media Only is selected', () => {
      cy.contains('button', 'Export').click();
      // Expand Media accordion
      cy.get('[role="dialog"]').contains('Media Only').click();
      // Media accordion should auto-expand
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .should('be.checked');
    });

    it('disables media checkbox when Media Only is selected', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .should('be.disabled');
    });

    it('restores media checkbox state when switching away from Media Only', () => {
      cy.contains('button', 'Export').click();

      // Expand Media accordion (use AccordionSummary to avoid matching "Media Only" label)
      cy.get('[role="dialog"]').find('.MuiAccordionSummary-content').contains('Files & Media').scrollIntoView().click();

      // Capture the initial checkbox state
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

          // Switch back to HTML — should restore original state
          cy.get('[role="dialog"]').contains('label', 'HTML - Styled').scrollIntoView().click();
          cy.get('[role="dialog"]')
            .contains('label', 'Download files for offline viewing')
            .find('input[type="checkbox"]')
            .should(initialState ? 'be.checked' : 'not.be.checked');
        });
    });

    it('shows media type checkboxes when media is enabled', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      cy.get('[role="dialog"]').contains('Images').should('exist');
      cy.get('[role="dialog"]').contains('Videos').should('exist');
      cy.get('[role="dialog"]').contains('Audio').should('exist');
    });

    it('hides "Other files" checkbox in web app mode', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      cy.get('[role="dialog"]').contains('Images').should('exist');
      cy.get('[role="dialog"]').contains('Other files').should('not.exist');
    });

    it('Artist mode checkbox in Media section', () => {
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      // Wait for media types to appear (Collapse animation), then scroll dialog to bottom
      cy.get('[role="dialog"]').contains('Media types to include:').should('exist');
      cy.get('[role="dialog"]').find('.MuiDialogContent-root').scrollTo('bottom');
      cy.get('[role="dialog"]').contains('Artist mode').should('exist');
    });
  });
});

/**
 * End-to-end coverage of the exported zip's actual contents, using the
 * downloads:clean / waitForDownload / zip:list / zip:read capture
 * infrastructure. Covers:
 *
 * - #230 per-message render isolation (0102c15 + ae551f5): a message
 *   whose row rendering throws costs one placeholder row, not the export.
 * - #234/#235 (ff955e7): media downloads retry on the second CDN leg,
 *   WARN with per-leg status detail when both fail, and exported media
 *   entries carry the source message's timestamp as their zip date.
 * - #219 residue (eb3bce4): gifv embeds whose video is downloaded skip
 *   the orphaned thumbnail entirely.
 * - #227 residue (eb3bce4): bulk DM exports name a named group DM's
 *   folder after dm.name (sanitized), not the recipient-username join.
 * - F26 (1b22b8d): Cancel aborts an in-flight media download instead of
 *   waiting for the between-files gate.
 */
describe('Export zip contents (#230/#234/#235 + gifv skip, group DM naming, F26 cancel)', () => {
  const API = '**/api/v10';

  interface ZipEntry {
    name: string;
    size: number;
    date: string; // MM-DD-YYYY (from unzip -l)
    time: string; // HH:MM
  }

  const AUTHOR = {
    id: '111222333444555666',
    username: 'discrub_tester',
    discriminator: '0',
    // No avatar hash — keeps media-enabled exports from downloading
    // avatars, so each test's media traffic is exactly what it seeds.
    avatar: null,
    global_name: 'Discrub Tester',
  };

  const makeMessage = (overrides: Record<string, unknown>) => ({
    id: '900000000000000001',
    channel_id: '801000000000000001',
    author: AUTHOR,
    content: 'plain message',
    timestamp: '2026-02-01T12:00:00.000Z',
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    attachments: [],
    embeds: [],
    reactions: [],
    pinned: false,
    type: 0,
    ...overrides,
  });

  /**
   * Select the test server and open #general with a custom message body.
   * Registered after login so it LIFO-overrides the messages.json
   * intercept; uses its own alias because the fixture intercept's
   * @getMessages alias never fires once overridden.
   */
  const openChannelWithMessages = (messages: Array<Record<string, unknown>>) => {
    cy.selectServer('Cypress Test Server');
    cy.intercept('GET', `${API}/channels/*/messages?*`, {
      statusCode: 200,
      body: messages,
    }).as('customMessages');
    cy.contains('general').click();
    cy.wait('@customMessages');
  };

  /** Retry-assert that a status-log entry containing `substr` exists. */
  const expectStatusEntry = (substr: string, timeout = 15000) => {
    cy.window({ log: false, timeout }).should((win) => {
      const entries = (win as any).__store__.getState().status
        .entries as Array<{ message: string }>;
      expect(
        entries.some((e) => e.message.includes(substr)),
        `status log contains "${substr}"`,
      ).to.eq(true);
    });
  };

  /** One-shot assert that no status-log entry contains `substr`. */
  const expectNoStatusEntry = (substr: string) => {
    cy.window({ log: false }).then((win) => {
      const entries = (win as any).__store__.getState().status
        .entries as Array<{ message: string }>;
      expect(
        entries.some((e) => e.message.includes(substr)),
        `status log does NOT contain "${substr}"`,
      ).to.eq(false);
    });
  };

  /** Poll a closure condition (e.g. an intercept-counter) until true. */
  const waitForCondition = (
    cond: () => boolean,
    label: string,
    timeoutMs = 15000,
  ) => {
    const started = Date.now();
    const attempt = (): Cypress.Chainable => {
      return cy.wait(200, { log: false }).then(() => {
        if (cond()) return undefined;
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Timed out waiting for: ${label}`);
        }
        return attempt();
      });
    };
    return attempt();
  };

  beforeEach(() => {
    cy.login();
  });

  describe('#230 per-message render isolation', () => {
    it('HTML export survives a message whose render throws: placeholder row + ID-bearing WARN', () => {
      cy.task('downloads:clean');

      // Poison: an unparsable edited_timestamp. The feed never reads
      // edited_timestamp (only the exporter's "(edited)" indicator does,
      // via date-fns format(new Date(...)) which throws RangeError
      // "Invalid time value" on an Invalid Date) — so the app renders the
      // message fine and only the export row builder blows up, exactly
      // the #230 catch path. msg.timestamp itself stays valid because the
      // HTML date-divider is computed outside the guard by design.
      const poisonId = '900000000000000102';
      openChannelWithMessages([
        makeMessage({
          id: '900000000000000101',
          content: 'healthy before the poison',
        }),
        makeMessage({
          id: poisonId,
          content: 'this row explodes during export',
          timestamp: '2026-02-01T12:05:00.000Z',
          edited_timestamp: 'not-a-date',
        }),
        makeMessage({
          id: '900000000000000103',
          content: 'healthy after the poison',
          timestamp: '2026-02-01T12:10:00.000Z',
        }),
      ]);
      cy.contains('healthy after the poison').should('be.visible');

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();

      // (a) The export completes — the zip download lands.
      cy.waitForDownload(/^general\.zip$/i).then((zipName) => {
        // (b) The page carries the placeholder row for the poison ID and
        // both healthy neighbors survive intact.
        cy.task<string>('zip:read', {
          fileName: zipName,
          entry: 'general/general-page-1.html',
        }).then((page) => {
          expect(page).to.contain(
            `This message could not be rendered and was skipped. Message ID: <code>${poisonId}</code>`,
          );
          expect(page).to.contain('message-render-error');
          expect(page).to.contain('healthy before the poison');
          expect(page).to.contain('healthy after the poison');
        });
      });

      // (c) The ID-bearing WARN and the flush summary hit the status log.
      expectStatusEntry(
        `Export: Could not render message ${poisonId}, replaced with a placeholder (Invalid time value)`,
      );
      expectStatusEntry('could not be rendered and was replaced with placeholder');
      expectStatusEntry('Export: Completed general');
    });

    it('CSV export survives a message whose row serialization throws (ae551f5 non-HTML isolation)', () => {
      cy.task('downloads:clean');

      // Poison: an unparsable msg.timestamp. The CSV row builder formats
      // it inside the per-row guard (formatMessageTimestamp throws
      // RangeError "Invalid time value"); the feed guards its own
      // timestamp formatting with try/catch, so the app stays healthy.
      const poisonId = '900000000000000202';
      openChannelWithMessages([
        makeMessage({
          id: '900000000000000201',
          content: 'csv healthy before',
        }),
        makeMessage({
          id: poisonId,
          content: 'csv poison row',
          timestamp: 'not-a-date',
        }),
        makeMessage({
          id: '900000000000000203',
          content: 'csv healthy after',
          timestamp: '2026-02-01T12:10:00.000Z',
        }),
      ]);
      cy.contains('csv healthy after').should('be.visible');

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('CSV - Spreadsheet').click();
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();

      cy.waitForDownload(/^general\.zip$/i).then((zipName) => {
        cy.task<string>('zip:read', {
          fileName: zipName,
          entry: 'general/general-page-1.csv',
        }).then((page) => {
          expect(page).to.contain('csv healthy before');
          expect(page).to.contain('csv healthy after');
          const poisonLine = page
            .split('\n')
            .find((line) => line.includes(poisonId));
          expect(poisonLine, 'placeholder row for the poison ID').to.exist;
          expect(poisonLine).to.contain(
            '[This message could not be rendered and was skipped]',
          );
        });
      });

      expectStatusEntry(`Export: Could not render message ${poisonId}`);
      expectStatusEntry('Invalid time value');
      expectStatusEntry('Export: Completed general');
    });
  });

  describe('#234/#235 two-leg CDN retry + media timestamps', () => {
    const ATTACHMENT_MESSAGE = () =>
      makeMessage({
        id: '900000000000000301',
        content: 'message with an attachment',
        timestamp: '2026-02-01T13:00:00.000Z',
        attachments: [
          {
            id: '600000000000000301',
            filename: 'screenshot.png',
            size: 1024,
            url: 'https://cdn.discordapp.com/attachments/801000000000000001/600000000000000301/screenshot.png',
            proxy_url:
              'https://media.discordapp.net/attachments/801000000000000001/600000000000000301/screenshot.png',
            content_type: 'image/png',
          },
        ],
      });

    it('falls back to cdn.discordapp.com when the proxy leg 500s; media entry is dated by the message timestamp (#235)', () => {
      cy.task('downloads:clean');

      // Web mode leads with the media.discordapp.net proxy leg
      // (useProxyUrl = !isExtensionMode()); the direct cdn.discordapp.com
      // URL is the second leg. The feed only ever uses proxy_url for its
      // inline preview, so any cdn.discordapp.com hit is the export's
      // fallback leg.
      let cdnHits = 0;
      cy.intercept('GET', 'https://media.discordapp.net/attachments/**', {
        statusCode: 500,
        body: '',
      }).as('proxyLeg');
      cy.intercept('GET', 'https://cdn.discordapp.com/attachments/**', (req) => {
        cdnHits++;
        req.reply({
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
          body: 'fake-png-bytes',
        });
      }).as('cdnLeg');

      openChannelWithMessages([ATTACHMENT_MESSAGE()]);
      cy.contains('message with an attachment').should('be.visible');

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();

      // The fallback leg fires and the zip lands with the media entry —
      // the proxy leg always 500s, so bytes in the zip can only have come
      // from the cdn.discordapp.com leg.
      cy.wait('@cdnLeg', { timeout: 20000 });
      cy.waitForDownload(/^general\.zip$/i).then((zipName) => {
        cy.task<ZipEntry[]>('zip:list', zipName).then((entries) => {
          const media = entries.find((e) =>
            /^general\/media\/attachments\/.+\.png$/.test(e.name),
          );
          expect(media, 'downloaded media entry in the zip').to.exist;
          // #235: the entry's zip date is the source message's timestamp
          // (2026-02-01T13:00:00Z), not the day the export ran.
          expect(media!.date).to.eq('02-01-2026');
          const now = new Date();
          const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${now.getFullYear()}`;
          expect(media!.date).to.not.eq(today);
        });
      });
      cy.then(() => {
        expect(cdnHits, 'cdn fallback leg requested').to.be.greaterThan(0);
      });

      expectStatusEntry('Export: Completed general');
      // The fallback SUCCEEDED, so no download-failure WARN is emitted —
      // the per-leg WARN only fires when every leg fails (by design).
      expectNoStatusEntry('Export: Could not download screenshot.png');
    });

    it('WARNs with per-leg status detail when both CDN legs fail (#234)', () => {
      cy.task('downloads:clean');

      cy.intercept('GET', 'https://media.discordapp.net/attachments/**', {
        statusCode: 500,
        body: '',
      }).as('proxyLeg');
      cy.intercept('GET', 'https://cdn.discordapp.com/attachments/**', {
        statusCode: 404,
        body: '',
      }).as('cdnLeg');

      openChannelWithMessages([ATTACHMENT_MESSAGE()]);
      cy.contains('message with an attachment').should('be.visible');

      // HTML + "Download files" (instead of Media Only) so the zip still
      // gets page entries and finalizes even though zero media downloaded.
      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]')
        .find('.MuiAccordionSummary-content')
        .contains('Files & Media')
        .scrollIntoView()
        .click();
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .scrollIntoView()
        .click();
      cy.get('[role="dialog"]')
        .contains('label', 'Download files for offline viewing')
        .find('input[type="checkbox"]')
        .should('be.checked');
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();

      cy.wait('@proxyLeg', { timeout: 20000 });
      cy.wait('@cdnLeg', { timeout: 20000 });

      // Both legs failed → the status-bearing WARN carries each leg's
      // HTTP status (exact wording from mediaDownloadService).
      expectStatusEntry(
        'Export: Could not download screenshot.png (proxy 500, direct 404)',
      );

      // The export still completes and the page links the original CDN
      // URL instead of a local copy.
      cy.waitForDownload(/^general\.zip$/i).then((zipName) => {
        cy.task<ZipEntry[]>('zip:list', zipName).then((entries) => {
          const names = entries.map((e) => e.name);
          expect(names).to.include('general/general-page-1.html');
          expect(
            names.some((n) => n.startsWith('general/media/')),
            'no media entries in the zip',
          ).to.eq(false);
        });
      });
      expectStatusEntry('Export: Completed general');
    });
  });

  describe('gifv orphaned-thumbnail skip (#219 residue)', () => {
    it('downloads the gifv video but never requests its orphaned thumbnail', () => {
      cy.task('downloads:clean');

      // Skip condition (mediaDownloadService.collectMedia):
      //   embed.type === EmbedType.GIFV && !!embed.video?.url
      // → the thumbnail is orphaned (never referenced by the HTML) and
      //   must not be requested at all.
      const thumbRequests: string[] = [];
      // exportPhase gates the counters: the FEED legitimately loads the
      // thumbnail as the <video poster> when the message renders; only
      // requests made once the export starts count against the skip.
      let exportPhase = false;

      cy.intercept('GET', 'https://media.discordapp.net/**', (req) => {
        if (exportPhase && req.url.includes('thumb')) thumbRequests.push(req.url);
        req.reply({
          statusCode: 200,
          headers: {
            'content-type': req.url.includes('.mp4') ? 'video/mp4' : 'image/gif',
          },
          body: 'fake-media-bytes',
        });
      }).as('discordMedia');
      cy.intercept('GET', 'https://media.tenor.com/**', (req) => {
        if (exportPhase && req.url.includes('thumb')) thumbRequests.push(req.url);
        req.reply({
          statusCode: 200,
          headers: { 'content-type': 'image/gif' },
          body: 'fake-gif-bytes',
        });
      }).as('tenorMedia');

      openChannelWithMessages([
        makeMessage({
          id: '900000000000000401',
          content: 'https://tenor.com/view/funny-gif',
          timestamp: '2026-03-05T10:00:00.000Z',
          embeds: [
            {
              type: 'gifv',
              url: 'https://tenor.com/view/funny-gif',
              video: {
                url: 'https://media.tenor.com/abc123/gifclip.mp4',
                proxy_url:
                  'https://media.discordapp.net/external/vid123/gifclip.mp4',
                width: 480,
                height: 320,
              },
              thumbnail: {
                url: 'https://media.tenor.com/abc123/gifclip-thumb.gif',
                proxy_url:
                  'https://media.discordapp.net/external/thumb123/gifclip-thumb.gif',
                width: 480,
                height: 320,
              },
            },
          ],
        }),
      ]);
      // Let the feed finish rendering (its poster/video loads are the
      // pre-export traffic the exportPhase flag excludes).
      cy.get('[data-testid="message-feed-row"]').should('exist');
      cy.wait(500);

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();
      // Arm the counters only once the export is running — the media
      // download phase starts after a paced delay, so this lands first.
      cy.then(() => {
        exportPhase = true;
      });

      // The export completes and the video landed in the zip...
      cy.waitForDownload(/^general\.zip$/i).then((zipName) => {
        cy.task<ZipEntry[]>('zip:list', zipName).then((entries) => {
          const video = entries.find((e) =>
            /^general\/media\/embed-videos\/.+\.mp4$/.test(e.name),
          );
          expect(video, 'gifv video entry in the zip').to.exist;
          // #235 applies to embed media too: stamped with the message date.
          expect(video!.date).to.eq('03-05-2026');
          // ...and no thumbnail file was planted.
          expect(
            entries.some((e) => e.name.includes('embed-thumbnail')),
            'no orphaned thumbnail entry',
          ).to.eq(false);
        });
      });
      expectStatusEntry('Export: Completed general');
      cy.then(() => {
        expect(
          thumbRequests,
          'no thumbnail request during the export',
        ).to.have.length(0);
      });
    });
  });

  describe('group DM export folder naming (#227 residue)', () => {
    it('bulk DM export names the folder after dm.name (sanitized), not the username join', () => {
      cy.task('downloads:clean');

      // dmExportName: dm.name → recipient-username join → dm-<id>.
      // buildUniqueFolderNames sanitizes: non-alphanumerics → _,
      // lowercased, runs collapsed → "Movie Night" becomes movie_night.
      cy.fixture('dms.json').then((dms) => {
        cy.intercept('GET', `${API}/users/@me/channels`, {
          statusCode: 200,
          body: [
            dms[0], // alice_dev 1:1
            {
              id: '910000000000000005',
              type: 3,
              name: 'Movie Night',
              last_message_id: null,
              recipients: [dms[0].recipients[0], dms[1].recipients[0]],
            },
          ],
        }).as('getGroupDms');
      });
      cy.contains('button', 'DMs').click();
      cy.wait('@getGroupDms');

      cy.get('[aria-label="Toggle multi-select"]').first().click();
      cy.contains('Movie Night').click();
      cy.get('[aria-label="Export selected conversations"]').click();
      // JSON keeps the flow lean (no reaction enrichment, no shell).
      cy.get('[role="dialog"]').contains('label', 'JSON').click();
      cy.get('[role="dialog"]').contains('button', /Export 1 DM/).click();

      cy.waitForDownload(/^bulk-export\.zip$/i).then((zipName) => {
        cy.task<ZipEntry[]>('zip:list', zipName).then((entries) => {
          const names = entries.map((e) => e.name);
          expect(names).to.include('movie_night/movie_night-page-1.json');
          // The pre-fix fallback name (username join) must not appear.
          expect(
            names.some((n) => n.includes('alice_dev')),
            'no username-join folder',
          ).to.eq(false);
        });
      });
      expectStatusEntry('Bulk export: Completed Movie Night');
    });
  });

  describe('F26: Cancel reaches an in-flight media download', () => {
    it('aborts the running download and makes no further media requests after Cancel', () => {
      cy.task('downloads:clean');

      const att = (id: string, name: string) => ({
        id,
        filename: name,
        size: 2048,
        url: `https://cdn.discordapp.com/attachments/801000000000000001/${id}/${name}`,
        proxy_url: `https://media.discordapp.net/attachments/801000000000000001/${id}/${name}`,
        content_type: 'image/png',
      });

      openChannelWithMessages([
        makeMessage({
          id: '900000000000000501',
          content: 'first attachment message',
          attachments: [att('600000000000000501', 'first.png')],
        }),
        makeMessage({
          id: '900000000000000502',
          content: 'second attachment message',
          timestamp: '2026-02-01T12:05:00.000Z',
          attachments: [att('600000000000000502', 'second.png')],
        }),
      ]);
      cy.contains('second attachment message').should('be.visible');
      // Feed <img> previews for both attachments load at render time.
      // Registering the counting intercepts only now means the counters
      // see the export's transport traffic, not the feed's.
      cy.wait(500);

      let firstHits = 0;
      let firstFallbackHits = 0;
      const secondHits: string[] = [];
      // Counters only arm once the export is running (exportPhase): the
      // feed's own <img> previews (load-time or dialog-driven re-renders)
      // must not be mistaken for export transport traffic.
      let exportPhase = false;
      cy.intercept('GET', 'https://media.discordapp.net/attachments/**/first.png*', (req) => {
        if (exportPhase) firstHits++;
        // Slow response: the download stays in flight long enough for
        // Cancel to have to reach INTO it (the between-files gate never
        // runs while a download is pending).
        req.reply({
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
          body: 'slow-png-bytes',
          delay: 8000,
        });
      }).as('slowFirst');
      // An aborted leg must NOT be treated as a failed leg: cancel during
      // the proxy attempt may never fall through to the direct CDN leg.
      cy.intercept('GET', 'https://cdn.discordapp.com/attachments/**/first.png*', (req) => {
        if (exportPhase) firstFallbackHits++;
        req.reply({
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
          body: 'fallback-png-bytes',
        });
      }).as('firstFallback');
      cy.intercept('GET', '**/attachments/**/second.png*', (req) => {
        if (exportPhase) secondHits.push(req.url);
        req.reply({
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
          body: 'fast-png-bytes',
        });
      }).as('secondMedia');

      cy.contains('button', 'Export').click();
      cy.get('[role="dialog"]').contains('Media Only').click();
      cy.get('[role="dialog"]').contains('button', /^Export$/).click();
      cy.then(() => {
        exportPhase = true;
      });

      // Wait until the slow download is actually in flight, then cancel.
      // NOTE: exports process newest-first, so the fast second.png (newer
      // message) may legitimately complete BEFORE first.png starts —
      // snapshot both counters at cancel time and assert nothing moves
      // afterwards, rather than assuming a processing order.
      let firstAtCancel = -1;
      let secondAtCancel = -1;
      waitForCondition(() => firstHits >= 1, 'slow media download in flight');
      cy.then(() => {
        firstAtCancel = firstHits;
        secondAtCancel = secondHits.length;
      });
      cy.get('[aria-label="Stop"]').click({ force: true });

      // The operation unwinds: cancellation status entry + controls gone.
      expectStatusEntry('Export: Cancelled · general');
      cy.get('[aria-label="Stop"]').should('not.exist');

      // Cancel reached INTO the in-flight download: no re-attempt of the
      // aborted leg, no fall-through to its direct-CDN leg, and no new
      // media requests of any kind after Cancel.
      cy.wait(1500);
      cy.then(() => {
        expect(firstHits, 'slow attachment not re-attempted after Cancel').to.eq(firstAtCancel);
        expect(firstFallbackHits, 'aborted proxy leg never fell through to the direct leg').to.eq(0);
        expect(secondHits.length, 'no new media requests after Cancel').to.eq(secondAtCancel);
      });
    });
  });
});
