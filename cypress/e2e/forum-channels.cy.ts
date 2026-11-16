describe('Forum Channels', () => {
  beforeEach(() => {
    cy.login();
    cy.selectServer('Cypress Test Server');

    // Intercept the forum threads/search API call
    cy.intercept('GET', '**/threads/search*', { fixture: 'forum-threads.json' }).as('getForumThreads');
  });

  it('shows forum channel in channel list', () => {
    cy.contains('feedback').should('be.visible');
  });

  it('loads forum thread list when clicking a forum channel', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.contains('3 of 3 posts').should('be.visible');
  });

  it('shows forum post titles', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.contains('App crashes on startup').should('be.visible');
    cy.contains('Dark mode support').should('be.visible');
    cy.contains('How do I export data?').should('be.visible');
  });

  it('shows preview text from first messages', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.contains('The app crashes whenever I try to open it').should('be.visible');
  });

  it('shows tag filter chips', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.contains('🐛 Bug').should('be.visible');
    cy.contains('✨ Feature').should('be.visible');
    cy.contains('❓ Question').should('be.visible');
  });

  it('filters posts by tag when tag chip is clicked', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    // Click Bug tag
    cy.contains('🐛 Bug').click();
    // Should only show the bug post
    cy.contains('App crashes on startup').should('be.visible');
    cy.contains('Dark mode support').should('not.exist');
    cy.contains('How do I export data?').should('not.exist');
  });

  it('clears tag filter when Clear chip is clicked', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.contains('🐛 Bug').click();
    // Only bug post visible
    cy.contains('Dark mode support').should('not.exist');
    // Click Clear chip
    cy.contains('.MuiChip-root', 'Clear').click();
    // All posts visible again
    cy.contains('Dark mode support').should('be.visible');
  });

  it('shows search input', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.get('input[placeholder="Search posts..."]').should('be.visible');
  });

  it('performs server-side search with debounce', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');

    // Intercept search call
    cy.intercept('GET', '**/threads/search*name=crash*', {
      threads: [
        {
          id: '900000000000000001',
          type: 11,
          name: 'App crashes on startup',
          parent_id: '801000000000000007',
          message_count: 5,
          member_count: 3,
          last_message_id: '900000000000000010',
          thread_metadata: { archived: true, locked: false },
          applied_tags: ['tag-bug'],
        },
      ],
      members: [],
      has_more: false,
      first_messages: [],
      total_results: 1,
    }).as('searchThreads');

    cy.get('input[placeholder="Search posts..."]').type('crash');
    cy.wait('@searchThreads');
    cy.contains('App crashes on startup').should('be.visible');
  });

  it('shows empty state with search bar when search returns no results', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');

    cy.intercept('GET', '**/threads/search*name=nonexistent*', {
      threads: [],
      members: [],
      has_more: false,
      first_messages: [],
      total_results: 0,
    }).as('emptySearch');

    cy.get('input[placeholder="Search posts..."]').type('nonexistent');
    cy.wait('@emptySearch');
    // Search bar should still be visible
    cy.get('input[placeholder="Search posts..."]').should('be.visible');
    // Empty state message
    cy.contains('No posts matching').should('be.visible');
  });

  it('shows post count in header instead of message count', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    cy.contains('3 posts').should('be.visible');
    cy.contains('0 messages').should('not.exist');
  });

  it('shows locked indicator on locked posts', () => {
    cy.contains('feedback').click();
    cy.wait('@getForumThreads');
    // "How do I export data?" is locked
    cy.contains('Locked').should('be.visible');
  });

  describe('Forum View Toolbar', () => {
    beforeEach(() => {
      cy.contains('feedback').click();
      cy.wait('@getForumThreads');
    });

    it('hides Load All button in forum view', () => {
      cy.contains('button', 'Load All').should('not.exist');
    });

    it('hides Analytics button in forum view', () => {
      cy.contains('button', 'Analytics').should('not.exist');
    });

    it('shows Export button enabled in forum view', () => {
      cy.contains('button', 'Export').should('be.visible').and('not.be.disabled');
    });

    it('shows Load Thread button in forum view', () => {
      cy.contains('button', 'Load Thread').should('be.visible');
    });

    it('hides message action buttons (Delete, Edit, selected) in forum view', () => {
      cy.contains('button', 'Delete').should('not.exist');
      cy.contains('button', 'Edit').should('not.exist');
      cy.contains('selected').should('not.exist');
    });

    it('hides Filters button in forum view', () => {
      cy.get('[data-testid="search-filters-button"]').should('not.exist');
    });

    it('opens the export dialog for the posts when Export is clicked', () => {
      cy.get('[data-testid="forum-export-button"]').should('have.text', 'Export all posts (3)').click();
      cy.get('[role="dialog"]').should('contain.text', 'Export Posts').and('contain.text', '3 posts').and('not.contain.text', 'Bulk Export Channels');
      cy.contains('3 selected').should('be.visible');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 3 Posts');
    });

    it('ticked posts are what Export covers', () => {
      cy.get('[data-testid="forum-tick-900000000000000002"] input').check();
      // Ticking a box does not open the post.
      cy.contains('3 of 3 posts').should('be.visible');
      cy.get('[data-testid="forum-export-button"]').should('have.text', 'Export 1 post').click();
      cy.get('[role="dialog"]').should('contain.text', '1 post').and('contain.text', 'Dark mode support');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 1 Post');
    });
  });

  // 2.2.10: Export covers the forum, not the posts that happen to be loaded.
  describe('Export of a forum with more posts than are loaded', () => {
    const FORUM_ID = '801000000000000007';
    const post = (n: number) => ({
      id: `9050000000000000${String(n).padStart(2, '0')}`,
      name: `post-${n}`,
      type: 11,
      parent_id: FORUM_ID,
      message_count: n,
      member_count: 1,
      thread_metadata: { archived: false, locked: false, archive_timestamp: '2026-02-15T10:00:00.000Z' },
    });
    const urls: string[] = [];
    const fetched: string[] = [];

    beforeEach(() => {
      urls.length = 0;
      fetched.length = 0;
      const all = Array.from({ length: 30 }, (_, i) => post(i + 1));
      cy.intercept('GET', `**/api/v10/channels/${FORUM_ID}/threads/search*`, (req) => {
        urls.push(req.url);
        const offset = Number(new URL(req.url).searchParams.get('offset') ?? 0);
        req.reply({ statusCode: 200, body: { threads: all.slice(offset, offset + 25), members: [], first_messages: [], has_more: offset + 25 < 30, total_results: 30 } });
      }).as('getPosts');
      cy.fixture('messages.json').then((messages) => {
        cy.intercept('GET', '**/api/v10/channels/*/messages?*', (req) => {
          const id = req.url.match(/channels\/(\d+)\/messages/)![1];
          fetched.push(id);
          req.reply({ statusCode: 200, body: req.url.includes('before=') ? [] : messages.map((m: object) => ({ ...m, channel_id: id })) });
        });
      });
      cy.intercept('GET', '**/api/v10/channels/*/messages/*/reactions/*', { statusCode: 200, body: [] });
      cy.window().then((win) => {
        const store = (win as any).__store__;
        store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...store.getState().app.settings, searchDelay2: '0', deleteDelay2: '0', delayModifier2: '0' } });
      });
      cy.contains('feedback').click();
      cy.wait('@getPosts');
      cy.contains('25 of 30 posts').should('be.visible');
    });

    it('exports every post, the ones not loaded too, into a zip named after the forum', () => {
      cy.task('downloads:clean');
      cy.get('[data-testid="forum-export-button"]').should('have.text', 'Export all posts (30)').click();
      cy.get('[role="dialog"]').should('contain.text', 'Export Posts').and('contain.text', '30 posts');
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 30 Posts').click();
      cy.waitForDownload(/^feedback-posts\.zip$/i, 90000).then((fileName) => {
        cy.then(() => {
          expect(urls.slice(1).map((url) => new URL(url).searchParams.get('offset')), 'the run reads the list page by page').to.deep.eq(['0', '25']);
          expect(new Set(fetched).size, 'posts read').to.eq(30);
          expect(fetched, 'the forum itself is not read').to.not.include(FORUM_ID);
        });
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const pages = entries.map((e) => e.name).filter((name) => /^post_\d+\/post_\d+-page-1\.html$/.test(name));
          expect(pages, 'one folder per post, named after the post').to.have.length(30);
        });
      });
      cy.window().then((win) => {
        const messages = ((win as any).__store__.getState().status.entries as { message: string }[]).map((e) => e.message);
        expect(messages).to.include('Bulk export: Expanded forum feedback into 30 posts');
        expect(messages).to.include('Bulk export: Finished, 30 of 30 posts exported, 0 failed');
      });
    });

    it('the box for all, then one post unticked, leaves that post out of the run', () => {
      cy.task('downloads:clean');
      cy.get('[data-testid="forum-select-all"] input').check();
      cy.get(`[data-testid="forum-tick-${post(2).id}"] input`).uncheck();
      cy.get('[data-testid="forum-export-button"]').should('have.text', 'Export 29 posts').click();
      cy.get('[data-testid="bulk-export-confirm"]').should('have.text', 'Export 29 Posts').click();
      cy.waitForDownload(/^feedback-posts\.zip$/i, 90000).then((fileName) => {
        cy.then(() => {
          expect(new Set(fetched).size, 'posts read').to.eq(29);
          expect(fetched).to.not.include(post(2).id);
        });
        cy.task<{ name: string }[]>('zip:list', fileName).then((entries) => {
          const pages = entries.map((e) => e.name).filter((name) => /^post_\d+\/post_\d+-page-1\.html$/.test(name));
          expect(pages).to.have.length(29);
        });
      });
    });
  });
});
