/**
 * Past-announcements rail: the announcement dialog loads the archive gist
 * once per session and shows a version rail beside the live announcement,
 * both on auto-show (new rev) and from the top bar's View Announcement button.
 */
describe('Announcement archive rail', () => {
  const openLiveAnnouncement = () => {
    cy.login();
    // Let boot settle so the test exercises the rail, not the reopen race
    // (the slice guards that race separately; see announcementSlice tests).
    cy.wait('@getAnnouncementGist');
    cy.get('[aria-label="View Announcement"]').click();
    cy.contains('Announcement', { timeout: 10000 }).should('be.visible');
  };

  it('shows the rail beside the live announcement and switches versions', () => {
    openLiveAnnouncement();
    cy.wait('@getAnnouncementArchiveGist');

    cy.get('[data-testid="announcement-archive-rail"]').should('be.visible');
    cy.get('[data-testid="announcement-archive-rail"]').should('contain', 'Latest');
    cy.get('[data-testid="announcement-archive-rail"]').should('contain', 'Discrub 2.1.0');
    cy.get('[data-testid="announcement-archive-rail"]').should('contain', 'August 23, 2026');
    cy.get('[data-testid="announcement-body"]').should('contain', 'Test');

    cy.get('[data-testid="announcement-archive-rail"]').contains('Discrub 2.0.10').click();
    cy.get('[data-testid="announcement-archive-body"]').should('contain', 'Archived notes for 2.0.10');
    cy.contains('Posted August 16, 2026').should('be.visible');

    cy.get('[data-testid="announcement-archive-rail"]').contains('Latest').click();
    cy.get('[data-testid="announcement-body"]').should('contain', 'Test');

    cy.contains('button', 'Cancel').click();
    cy.get('[data-testid="announcement-layout"]').should('not.exist');
  });

  it('shows the rail on a brand-new announcement too, folded into its archive row', () => {
    cy.interceptDiscordApi();
    cy.intercept('GET', '**/gists/e5558088744dbe52edca729425900a69', {
      statusCode: 200,
      body: { files: { 'announcement.json': { content: JSON.stringify({ rev: 'new-rev-777', version: '1.0.0' }) } } },
    }).as('getAnnouncementNew');
    cy.intercept('GET', '**/gists/a73736574a1a994e97cbc2d6f467c574', {
      statusCode: 200,
      body: { files: { 'announcement_markdown.md': { content: '# Archived notes for 2.1.0\n\nLive copy.' } } },
    }).as('getAnnouncementMarkdownNew');

    cy.visit('/');
    cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
    cy.contains('Discrub 2.1.0', { timeout: 10000 }).should('be.visible');
    cy.wait('@getAnnouncementArchiveGist');
    cy.get('[data-testid="announcement-archive-rail"]').should('not.contain', 'Latest');
    cy.get('[data-testid="announcement-archive-rail"]').contains('Discrub 2.1.0').should('be.visible');
    cy.contains('Posted August 23, 2026').should('be.visible');
    cy.get('[data-testid="announcement-body"]').should('contain', 'Live copy.');
  });

  it('reuses the cached archive on a second open (one gist request per session)', () => {
    openLiveAnnouncement();
    cy.wait('@getAnnouncementArchiveGist');
    cy.contains('button', 'Cancel').click();

    cy.get('[aria-label="View Announcement"]').click();
    cy.get('[data-testid="announcement-archive-rail"]').should('be.visible');
    cy.get('@getAnnouncementArchiveGist.all').should('have.length', 1);
  });

  it('keeps the live announcement readable when the archive cannot be loaded', () => {
    cy.login();
    cy.wait('@getAnnouncementGist');
    cy.intercept('GET', '**/gists/d57525174377b474cb7c90210d3ab979', { statusCode: 500, body: {} }).as('archiveDown');
    cy.get('[aria-label="View Announcement"]').click();
    cy.get('[data-testid="announcement-body"]').should('contain', 'Test');
    cy.get('[data-testid="announcement-archive-error"]').should('contain', 'No previous announcements are available right now');
    cy.get('[data-testid="announcement-archive-rail"]').should('not.exist');
  });
});
