const interceptThreadLoad = () => {
  cy.fixture('thread-channel.json').then((thread) => {
    cy.intercept('GET', '**/api/v10/channels/802000000000000001', {
      statusCode: 200,
      body: thread,
    }).as('getThread');
  });

  cy.fixture('messages.json').then((messages) => {
    cy.intercept('GET', '**/api/v10/channels/802000000000000001/messages?*', {
      statusCode: 200,
      body: messages,
    }).as('getThreadMessages');
  });
};

const loadThread = () => {
  interceptThreadLoad();
  cy.contains('button', 'Load Thread').click();
  cy.get('[role="dialog"]').find('input').type('802000000000000001');
  cy.get('[role="dialog"]').contains('button', 'Load').click();
  cy.wait('@getThread');
  cy.wait('@getThreadMessages');
};

const API = '**/api/v10';

const PARENT_ID = '801000000000000001';
const archivedThread = {
  id: '802000000000000099',
  name: 'retired-thread',
  type: 11,
  parent_id: PARENT_ID,
  message_count: 12,
  member_count: 4,
  thread_metadata: { archived: true, archive_timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString() },
};

/**
 * The Load Thread dialog reads a channel's threads from Discord's thread
 * search, one call per 25 (GitHub 24). The active thread comes from the
 * fixture, plus one archived thread so the #252 row styling has both.
 */
const interceptThreadDiscovery = () => {
  cy.fixture('active-guild-threads.json').then((active) => {
    const threads = [...active.threads.filter((t: { parent_id: string }) => t.parent_id === PARENT_ID), archivedThread];
    cy.intercept('GET', `${API}/channels/${PARENT_ID}/threads/search*`, {
      statusCode: 200,
      body: { threads, members: [], has_more: false, total_results: threads.length },
    }).as('getThreads');
  });
};

describe('Thread Load', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');
    cy.selectChannel('general');
    cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
  });

  // GitHub 24: tick threads or take them all, and export them through the
  // dialog a forum's posts use, without exporting the channel again.
  describe('Thread export (GitHub 24)', () => {
    const zeroDelays = () => {
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({
          type: 'app/updateAllSettings/fulfilled',
          payload: { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0' },
        });
      });
    };
    const thread = (n: number) => ({
      id: `8030000000000000${String(n).padStart(2, '0')}`,
      name: `thread-${n}`,
      type: 11,
      parent_id: PARENT_ID,
      total_message_sent: n,
      member_count: 1,
      thread_metadata: { archived: n % 2 === 0, archive_timestamp: '2026-02-15T10:00:00.000Z' },
    });
    /** The thread search for the channel, in pages of 25, with every request URL kept. */
    const interceptThreadPages = (count: number, urls: string[]) => {
      const all = Array.from({ length: count }, (_, i) => thread(i + 1));
      cy.intercept('GET', `${API}/channels/${PARENT_ID}/threads/search*`, (req) => {
        urls.push(req.url);
        const offset = Number(new URL(req.url).searchParams.get('offset') ?? 0);
        req.reply({ statusCode: 200, body: { threads: all.slice(offset, offset + 25), members: [], has_more: offset + 25 < count, total_results: count } });
      }).as('getThreads');
    };
    const interceptThreadMessages = (fetched: string[]) => {
      cy.fixture('messages.json').then((messages) => {
        cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
          const id = req.url.match(/channels\/(\d+)\/messages/)![1];
          fetched.push(id);
          req.reply({ statusCode: 200, body: req.url.includes('before=') ? [] : messages.map((m: object) => ({ ...m, channel_id: id })) });
        });
      });
      cy.intercept('GET', `${API}/channels/*/messages/*/reactions/*`, { statusCode: 200, body: [] });
    };

    beforeEach(() => zeroDelays());

    it('shows the count, a box per thread, and names the ticked ones on the button', () => {
      interceptThreadDiscovery();
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads').its('request.url').should('satisfy', (url: string) => url.includes('limit=25') && url.includes('offset=0') && !url.includes('archived='));
      cy.get('[data-testid="thread-total"]').should('contain.text', '2 found');
      cy.get('[data-testid="export-threads"]').should('have.text', 'Export all threads (2)');
      cy.get('[data-testid="thread-tick-802000000000000099"] input').check();
      cy.get('[data-testid="export-threads"]').should('have.text', 'Export 1 thread');
      // Ticking a box does not load the thread.
      cy.get('[role="dialog"]').should('contain.text', 'Load Thread');
      cy.get('[data-testid="thread-select-all"] input').check();
      cy.get('[data-testid="export-threads"]').should('have.text', 'Export all threads (2)');
      cy.get('[data-testid="thread-tick-802000000000000001"] input').should('be.checked');
    });

    it('a ticked thread opens the export dialog named for threads', () => {
      interceptThreadDiscovery();
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
      cy.get('[data-testid="thread-tick-802000000000000099"] input').check();
      cy.get('[data-testid="export-threads"]').click();
      cy.get('[role="dialog"]').should('contain.text', 'Export Threads').and('contain.text', '1 thread').and('contain.text', 'retired-thread');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 1 Thread');
      // Cancel leaves no thread export behind for the next dialog.
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('exports every thread into a zip named after the channel, with one listing call and no read of the channel itself', () => {
      cy.task('downloads:clean');
      const urls: string[] = [];
      const fetched: string[] = [];
      interceptThreadPages(3, urls);
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
      cy.then(() => interceptThreadMessages(fetched));
      cy.get('[data-testid="export-threads"]').should('have.text', 'Export all threads (3)').click();
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 3 Threads').click();
      cy.waitForDownload(/^general-threads\.zip$/i, 60000).then((fileName) => {
        cy.then(() => {
          expect(urls, 'the list is read once, when the dialog opens').to.have.length(1);
          expect(fetched.filter((id) => id === PARENT_ID), 'the channel itself is not read').to.have.length(0);
          expect([...new Set(fetched)].sort()).to.deep.eq([thread(1).id, thread(2).id, thread(3).id]);
        });
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const names = entries.map((e) => e.name);
          expect(names).to.include('thread_1/thread_1-page-1.html');
          expect(names).to.include('thread_2/thread_2-page-1.html');
          expect(names).to.include('thread_3/thread_3-page-1.html');
        });
      });
    });

    it('a long list loads 25 at a time on scroll, and an export of all reads the whole list', () => {
      cy.task('downloads:clean');
      const urls: string[] = [];
      const fetched: string[] = [];
      interceptThreadPages(27, urls);
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
      cy.get('[data-testid="thread-total"]').should('contain.text', '27 found');
      cy.get('[data-testid^="discovered-thread-"]').should('have.length', 25);
      cy.get('[data-testid="threads-loading-more"]').should('exist');
      cy.then(() => expect(urls, 'opening reads one page').to.have.length(1));

      cy.then(() => interceptThreadMessages(fetched));
      cy.get('[data-testid="export-threads"]').should('have.text', 'Export all threads (27)').click();
      cy.get('[role="dialog"]').should('contain.text', '27 threads');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 27 Threads').click();
      cy.waitForDownload(/^general-threads\.zip$/i, 90000).then((fileName) => {
        cy.then(() => {
          const offsets = urls.slice(1).map((url) => new URL(url).searchParams.get('offset'));
          expect(offsets, 'the run reads the list from the start, page by page').to.deep.eq(['0', '25']);
          expect(new Set(fetched).size).to.eq(27);
          expect(fetched).to.not.include(PARENT_ID);
        });
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const pages = entries.map((e) => e.name).filter((name) => /^thread_\d+\/thread_\d+-page-1\.html$/.test(name));
          expect(pages).to.have.length(27);
        });
      });
      // From the log's data: the panel shows its latest 50 lines and a 27 thread run writes more.
      cy.window().then((win) => {
        const messages = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(messages).to.include('Bulk export: Found 27 threads in general');
      });
    });

    it('the heading box, then one thread unticked, exports every thread but that one', () => {
      cy.task('downloads:clean');
      const urls: string[] = [];
      const fetched: string[] = [];
      interceptThreadPages(27, urls);
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
      cy.get('[data-testid="thread-select-all"] input').check();
      cy.get(`[data-testid="thread-tick-${thread(2).id}"] input`).uncheck();
      // The box stays on for the rest, and the rows under it stay ticked.
      cy.get('[data-testid="thread-select-all"] input').should('have.attr', 'data-indeterminate', 'true');
      cy.get(`[data-testid="thread-tick-${thread(1).id}"] input`).should('be.checked');
      cy.get('[data-testid="export-threads"]').should('have.text', 'Export 26 threads').click();
      cy.then(() => interceptThreadMessages(fetched));
      cy.get('[role="dialog"]').should('contain.text', '26 threads').and('not.contain.text', '# thread-');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 26 Threads').click();
      cy.waitForDownload(/^general-threads\.zip$/i, 90000).then((fileName) => {
        cy.then(() => {
          expect(new Set(fetched).size, 'threads read').to.eq(26);
          expect(fetched, 'the unticked thread is not read').to.not.include(thread(2).id);
        });
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const pages = entries.map((e) => e.name).filter((name) => /^thread_\d+\/thread_\d+-page-1\.html$/.test(name));
          expect(pages).to.have.length(26);
          expect(pages).to.not.include('thread_2/thread_2-page-1.html');
        });
      });
      cy.window().then((win) => {
        const messages = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(messages).to.include('Bulk export: Found 26 threads in general');
        expect(messages).to.include('Bulk export: Finished, 26 of 26 threads exported, 0 failed');
      });
    });

    it('an export cut by a reload is found again from Load Thread and resumes with no listing call', () => {
      cy.task('downloads:clean');
      const urls: string[] = [];
      const fetched: string[] = [];
      interceptThreadPages(27, urls);
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
      // The third thread hangs, so the run is two threads in when the page reloads.
      cy.fixture('messages.json').then((messages) => {
        cy.intercept('GET', `${API}/channels/*/messages?*`, (req) => {
          const id = req.url.match(/channels\/(\d+)\/messages/)![1];
          fetched.push(id);
          req.reply({ statusCode: 200, delay: id === thread(3).id && !req.url.includes('before=') ? 60000 : 0, body: req.url.includes('before=') ? [] : messages.map((m: object) => ({ ...m, channel_id: id })) });
        });
      });
      cy.intercept('GET', `${API}/channels/*/messages/*/reactions/*`, { statusCode: 200, body: [] });
      cy.get('[data-testid="export-threads"]').click();
      cy.get('[data-testid="bulk-export-confirm"]').click();
      const record = () => (cy.window({ log: false }).its('__workspace__') as unknown as Cypress.Chainable<{ get: (wid: string) => Promise<any> }>).then((h) => h.get('default'));
      // The record is read once, so wait until the run is on its third thread first.
      cy.window({ timeout: 30000 }).should((win) => {
        const messages = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(messages).to.include('Bulk export: Starting thread 3/27: thread-3');
      });
      cy.wait(1500);
      record().should((saved) => {
        expect(saved?.bulk?.queue, 'the record keeps the listed threads').to.have.length(27);
        expect(saved?.bulk?.done, 'two threads finished').to.have.length(2);
        expect(saved?.bulk?.settings?.threadTargets).to.have.length(27);
        expect(saved?.bulk?.settings?.threadExport?.all).to.eq(false);
      });

      cy.reload();
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.window({ timeout: 15000 }).should((win) => {
        const messages = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(messages.filter((m) => m.includes('stopped before it finished')), 'the line at open').to.deep.eq(['An export of the threads in general stopped before it finished, 2 of 27 done. Open that channel and press Resume thread export.']);
      });
      cy.selectServer('Cypress Test Server');
      // The channel comes back from the workspace, so no message call is made to wait on.
      cy.contains('[data-testid="channel-row"]', 'general').click({ force: true });
      cy.get('[data-testid="load-thread-button"]', { timeout: 20000 }).should('exist');
      zeroDelays();
      cy.then(() => { urls.length = 0; fetched.length = 0; });
      cy.then(() => interceptThreadMessages(fetched));
      cy.get('[data-testid="load-thread-button"]').should('have.text', 'Resume thread export').click();
      cy.get('[data-testid="export-threads"]').should('have.text', 'Resume export (2 of 27 done)').click();
      cy.get('[data-testid="bulk-export-resume-note"]').should('contain.text', '2 of 27 threads finished before Discrub closed');
      cy.get('[role="dialog"]').should('contain.text', 'Export Threads').and('contain.text', '27 threads');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Resume').click();
      cy.waitForDownload(/^general-threads\.zip$/i, 90000).then((fileName) => {
        cy.then(() => {
          // The Load Thread dialog read its first page when it opened. The run itself listed nothing.
          expect(urls.map((url) => new URL(url).searchParams.get('offset')), 'listing calls after the reload').to.deep.eq(['0']);
          const read = [...new Set(fetched)];
          expect(read, 'the first finished thread is not read again').to.not.include(thread(1).id);
          expect(read, 'the second finished thread is not read again').to.not.include(thread(2).id);
          expect(read.filter((id) => id !== PARENT_ID).sort(), 'the 25 threads that were left').to.deep.eq(Array.from({ length: 25 }, (_, i) => thread(i + 3).id).sort());
        });
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const pages = entries.map((e) => e.name).filter((name) => /^thread_\d+\/thread_\d+-page-1\.html$/.test(name));
          expect(pages, 'the new zip has every thread').to.have.length(27);
        });
      });
      cy.get('[data-testid="load-thread-button"]', { timeout: 20000 }).should('have.text', 'Load Thread');
    });

    it('scrolling the list to its end loads the next page', () => {
      const urls: string[] = [];
      interceptThreadPages(27, urls);
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
      cy.get('[data-testid="discovered-threads"]').scrollTo('bottom');
      cy.get('[data-testid^="discovered-thread-"]').should('have.length', 27);
      cy.get('[data-testid="threads-loading-more"]').should('not.exist');
      cy.then(() => expect(urls.map((url) => new URL(url).searchParams.get('offset'))).to.deep.eq(['0', '25']));
    });

    // The list gives up height in a short window so the ID field and the
    // buttons stay on screen, and only the list scrolls.
    ([[1280, 520], [1280, 600], [1280, 720], [1280, 900], [360, 640]] as const).forEach(([width, height]) => {
      it(`keeps the ID field and the buttons in view at ${width} by ${height}`, () => {
        cy.viewport(width, height);
        interceptThreadPages(60, []);
        cy.contains('button', 'Load Thread').click({ force: true });
        cy.wait('@getThreads');
        cy.get('[data-testid="discovered-threads"]').should('be.visible');
        cy.window().then((win) => {
          const dialog = win.document.querySelector('[role="dialog"]') as HTMLElement;
          const inView = (el: Element, name: string) => {
            const box = el.getBoundingClientRect();
            expect(box.top, `${name} top`).to.be.at.least(0);
            expect(box.bottom, `${name} bottom`).to.be.at.most(height);
          };
          inView(dialog.querySelector('input[inputmode="numeric"]')!, 'ID field');
          inView(dialog.querySelector('[data-testid="export-threads"]')!, 'export button');
          const content = dialog.querySelector('.MuiDialogContent-root') as HTMLElement;
          expect(content.scrollHeight, 'the dialog body does not scroll').to.be.at.most(content.clientHeight + 1);
          const list = dialog.querySelector('[data-testid="discovered-threads"]') as HTMLElement;
          expect(list.clientHeight, 'list height').to.be.at.least(119);
          expect(list.scrollHeight, 'the list scrolls').to.be.greaterThan(list.clientHeight);
        });
      });
    });

    // Found in the VM 2026-11-17: under about 500 px the list kept its
    // minimum and slid over the "or" line and the hint below it.
    it('in a window too short for everything, the body scrolls and nothing overlaps the list', () => {
      cy.viewport(1280, 420);
      interceptThreadPages(60, []);
      cy.contains('button', 'Load Thread').click({ force: true });
      cy.wait('@getThreads');
      cy.get('[data-testid="discovered-threads"]').should('be.visible');
      cy.window().then((win) => {
        const dialog = win.document.querySelector('[role="dialog"]') as HTMLElement;
        const list = dialog.querySelector('[data-testid="discovered-threads"]') as HTMLElement;
        const divider = dialog.querySelector('.MuiDivider-root') as HTMLElement;
        // The list is at its minimum here: 120 px with its border.
        expect(list.getBoundingClientRect().height, 'list height').to.be.at.least(119);
        expect(divider.getBoundingClientRect().top, 'the "or" line starts under the list').to.be.at.least(list.getBoundingClientRect().bottom - 1);
        const exportButton = dialog.querySelector('[data-testid="export-threads"]')!.getBoundingClientRect();
        expect(exportButton.bottom, 'export button bottom').to.be.at.most(420);
      });
    });

    it('a window tall enough to show a whole page still loads the next one', () => {
      cy.viewport(1280, 2400);
      const urls: string[] = [];
      interceptThreadPages(27, urls);
      cy.contains('button', 'Load Thread').click({ force: true });
      cy.get('[data-testid^="discovered-thread-"]').should('have.length', 27);
      cy.get('[data-testid="threads-loading-more"]').should('not.exist');
    });

    it('a listing Discord refuses says so and leaves the ID field usable', () => {
      cy.intercept('GET', `${API}/channels/${PARENT_ID}/threads/search*`, { statusCode: 403, body: { message: 'Missing Access' } }).as('getThreads');
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').should('contain.text', "Couldn't load threads");
      cy.get('[data-testid="export-threads"]').should('be.disabled');
      cy.get('[role="dialog"]').find('input[type="text"], input:not([type])').last().should('not.be.disabled');
    });
  });

  // Backlog #252: discovered rows carry counts, an archived state, and
  // active threads list first. Clicking a row loads that thread.
  describe('Discovered thread rows (#252)', () => {
    beforeEach(() => {
      interceptThreadDiscovery();
      cy.contains('button', 'Load Thread').click();
      cy.wait('@getThreads');
    });

    it('shows message and member counts under each thread name', () => {
      cy.get('[data-testid="discovered-thread-802000000000000001"]')
        .should('contain.text', 'test-thread')
        .and('contain.text', '5 messages · 3 members');
    });

    it('marks archived threads and says when they were archived', () => {
      cy.get('[data-testid="discovered-thread-802000000000000099"]')
        .should('contain.text', 'retired-thread')
        .and('contain.text', '12 messages · 4 members · archived 2 days ago')
        .and('contain.text', 'Archived');
    });

    it('lists active threads before archived ones', () => {
      cy.get('[data-testid="discovered-threads"] [data-testid^="discovered-thread-"]').then(($rows) => {
        const ids = $rows.toArray().map((el) => el.getAttribute('data-testid'));
        expect(ids.indexOf('discovered-thread-802000000000000001')).to.be.lessThan(ids.indexOf('discovered-thread-802000000000000099'));
      });
    });

    it('loads the thread when its row is clicked', () => {
      interceptThreadLoad();
      cy.get('[data-testid="discovered-thread-802000000000000001"]').click();
      cy.wait('@getThread');
      cy.wait('@getThreadMessages');
      cy.get('[role="dialog"]').should('not.exist');
    });
  });

  describe('Thread Load Button', () => {
    it('should show Load Thread button in ServerView toolbar', () => {
      cy.contains('button', 'Load Thread').should('be.visible');
    });

    it('should open ThreadLoadModal when clicking Load Thread', () => {
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Load Thread').should('be.visible');
    });
  });

  describe('ThreadLoadModal', () => {
    beforeEach(() => {
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').should('be.visible');
    });

    it('should show instruction text', () => {
      cy.contains('Enter a thread or forum post ID').should('be.visible');
    });

    it('should have thread ID input field', () => {
      cy.get('[role="dialog"]').find('input').should('be.visible');
    });

    it('should have Load button disabled when input is empty', () => {
      cy.get('[role="dialog"]').contains('button', 'Load').should('be.disabled');
    });

    it('should enable Load button when ID is entered', () => {
      cy.get('[role="dialog"]').find('input').type('802000000000000001');
      cy.get('[role="dialog"]').contains('button', 'Load').should('not.be.disabled');
    });

    it('should close modal on Cancel', () => {
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[role="dialog"]').should('not.exist');
    });

    it('should fetch thread channel when Load is clicked', () => {
      interceptThreadLoad();
      cy.get('[role="dialog"]').find('input').type('802000000000000001');
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');
    });

    it('should close modal and log error for invalid thread ID', () => {
      cy.intercept('GET', '**/api/v10/channels/999999999999999999', {
        statusCode: 404,
        body: { message: 'Unknown Channel', code: 10003 },
      }).as('getThreadNotFound');

      cy.get('[role="dialog"]').find('input').type('999999999999999999');
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.wait('@getThreadNotFound');

      cy.get('[aria-label="Expand log"]').click();
      cy.contains('Failed to load thread').should('be.visible');
    });

    it('should close modal and log error for no access thread', () => {
      cy.intercept('GET', '**/api/v10/channels/888888888888888888', {
        statusCode: 403,
        body: { message: 'Missing Access', code: 50001 },
      }).as('getThreadForbidden');

      cy.get('[role="dialog"]').find('input').type('888888888888888888');
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.wait('@getThreadForbidden');

      cy.get('[aria-label="Expand log"]').click();
      cy.contains('Failed to load thread').should('be.visible');
    });

    it('should only accept numeric input', () => {
      cy.get('[role="dialog"]').find('input').type('abc123xyz');
      // Non-numeric chars should be filtered out, leaving only "123"
      cy.get('[role="dialog"]').find('input').should('have.value', '123');
    });
  });

  describe('Status Log Entries', () => {
    it('should show info status entry when loading thread', () => {
      interceptThreadLoad();
      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').type('802000000000000001');
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThread');
      cy.wait('@getThreadMessages');

      cy.get('[aria-label="Expand log"]').click();
      cy.contains('Loading thread...').should('be.visible');
    });

    it('should show success status entry on successful load', () => {
      loadThread();

      // Expand Status Log accordion and verify success entry
      cy.get('[aria-label="Expand log"]').click();
      cy.contains('Thread loaded successfully').should('be.visible');
    });

    it('should show error status entry on failed load', () => {
      cy.intercept('GET', '**/api/v10/channels/999999999999999999', {
        statusCode: 404,
        body: { message: 'Unknown Channel', code: 10003 },
      }).as('getThreadNotFound');

      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').type('999999999999999999');
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThreadNotFound');

      // Expand Status Log accordion and verify error entry
      cy.get('[aria-label="Expand log"]').click();
      cy.contains('Failed to load thread').should('be.visible');
    });
  });

  describe('Thread Tabs', () => {
    it('should show tab bar after loading a thread', () => {
      loadThread();

      cy.get('[data-testid="thread-tab-bar"]').should('be.visible');
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 2);
    });

    it('should show main channel tab with channel name', () => {
      loadThread();

      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').first().should('contain.text', 'general');
    });

    it('should show thread tab with thread name', () => {
      loadThread();

      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last().should('contain.text', 'test-thread');
    });

    it('should have thread tab active after loading', () => {
      loadThread();

      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last()
        .should('have.attr', 'aria-selected', 'true');
    });

    it('should switch to main channel tab when clicked', () => {
      loadThread();

      // Click main channel tab
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').first().click();
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').first()
        .should('have.attr', 'aria-selected', 'true');

      // Main channel messages should be visible
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    });

    it('should switch back to thread tab when clicked', () => {
      loadThread();

      // Switch to main, then back to thread
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').first().click();
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last().click();
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').last()
        .should('have.attr', 'aria-selected', 'true');
    });

    it('should close thread tab and return to main when close button clicked', () => {
      loadThread();

      // Wait for loading to fully complete (isOperationRunning guards the close handler)
      cy.window().should((win) => {
        const store = (win as any).__store__;
        if (store) {
          const threadTabs = store.getState().message.threadTabs ?? {};
          const anyLoading = Object.values(threadTabs).some((tab: any) => tab.isLoading);
          expect(anyLoading).to.eq(false);
        }
      });

      // Close the thread tab (X button) — click the IconButton parent, not the SVG
      cy.get('[data-testid="thread-tab-bar"]')
        .find('[data-testid="CloseIcon"]')
        .parent('button')
        .click({ force: true });

      // Tab bar should only show main tab (no thread tabs)
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 1);

      // Should be back on main channel
      cy.contains('[data-testid="message-feed-row"]', 'Hello everyone! Welcome to the server.').should('exist');
    });

    it('should only show main tab when no thread tabs are open', () => {
      // Tab bar is always visible but should only have the main tab
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 1);
    });

    it('should only show main tab after failed thread load', () => {
      cy.intercept('GET', '**/api/v10/channels/999999999999999999', {
        statusCode: 404,
        body: { message: 'Unknown Channel', code: 10003 },
      }).as('getThreadNotFound');

      cy.contains('button', 'Load Thread').click();
      cy.get('[role="dialog"]').find('input').type('999999999999999999');
      cy.get('[role="dialog"]').contains('button', 'Load').click();
      cy.wait('@getThreadNotFound');

      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 1);
    });

    it('should clear thread tabs when switching channels', () => {
      loadThread();

      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 2);

      // Switch to a different channel
      cy.selectChannel('dev-chat');

      // After switching, only main tab should remain
      cy.get('[data-testid="thread-tab-bar"]').find('[role="tab"]').should('have.length', 1);
    });
  });
});
