describe('Authentication', () => {
  describe('Landing Page (auto-auth blocked)', () => {
    beforeEach(() => {
      // Block auto-auth so we can test the landing page
      cy.blockAutoAuth();
      cy.visit('/');
      // Wait for any auto-auth attempt to fail and the landing page to settle
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
    });

    it('shows the Bleeding Edge landing card on load (local dev is a Bleeding Edge build)', () => {
      cy.contains('Bleeding Edge').should('be.visible');
      cy.get('[data-testid="compat-button-gate"]').should('be.visible');
      cy.get('[data-testid="hosted-gate"]').should('not.exist');
    });

    it('shows token input as password type with "Discord Token" label', () => {
      cy.get('input[type="password"]').should('exist');
      cy.contains('Discord Token').should('exist');
    });

    it('disables "Sign In" button when token field is cleared', () => {
      cy.get('input[type="password"]').clear();
      cy.get('button[type="submit"]').should('be.disabled');
    });

    it('shows error helper text on invalid token', () => {
      cy.get('input[type="password"]').clear().type('bad-token', { log: false });
      cy.get('button[type="submit"]').click();
      cy.contains('Invalid token').should('be.visible');
    });

    it('has "How to find my Discord token?" link with correct href', () => {
      cy.contains('How to find my Discord token?')
        .should('have.attr', 'href')
        .and('include', 'github.com/pratherbytecraft/discrub');
    });

    it('shows disclaimer text', () => {
      cy.contains('Discrub is an unofficial tool').should('be.visible');
    });
  });

  describe('Successful login', () => {
    it('shows TopBar with username after valid token auto-auth', () => {
      cy.interceptDiscordApi();
      cy.visit('/');
      // The env token triggers auto-auth; intercept responds with valid user
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
    });
  });

  /**
   * #249 opt-in "Keep me logged in". The env token
   * auto-auths on every visit, so /users/@me answers by Authorization
   * header: only the remembered token gets a 200. That way a reload
   * signing in proves the RESTORED token did it, not the env one.
   */
  describe('Keep me logged in (#249)', () => {
    const REMEMBERED = 'remembered-token-249';
    const API = '**/api/v10';

    const acceptOnlyRememberedToken = () => {
      cy.intercept('GET', `${API}/users/@me`, (req) => {
        if (req.headers.authorization === REMEMBERED) {
          req.reply({ statusCode: 200, fixture: 'user.json' });
        } else {
          req.reply({ statusCode: 401, body: { message: '401: Unauthorized', code: 0 } });
        }
      }).as('usersMe');
    };

    it('shows the unticked opt-in with its trust note by default', () => {
      cy.blockAutoAuth();
      cy.visit('/');
      cy.get('[data-testid="landing-remember-token"]').should('not.be.checked');
      cy.contains('Keep me logged in').should('be.visible');
      cy.contains('Only do this on a device you trust').should('be.visible');
      cy.contains('only kept until you close this tab').should('be.visible');
    });

    it('remembers the token, restores it on reload, and forgets it on Logout', () => {
      cy.interceptDiscordApi();
      acceptOnlyRememberedToken();
      cy.visit('/');
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');

      cy.get('[data-testid="landing-remember-token"]').check().should('be.checked');
      cy.get('input[type="password"]').clear().type(REMEMBERED, { log: false });
      cy.get('[data-testid="landing-sign-in"]').click();
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.readIdbStore<string>('state').should('include', REMEMBERED);

      // Reload: the env token is refused, the remembered one signs in.
      cy.interceptDiscordApi();
      acceptOnlyRememberedToken();
      cy.reload();
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');

      // Settings › Reset Discrub › "Forget saved token" drops the stored
      // copy but keeps this session signed in.
      cy.get('[aria-label="Settings"]').click({ force: true });
      cy.get('[role="dialog"]').contains('button', 'Reset Discrub').click();
      cy.get('[data-testid="settings-forget-token"]').click();
      cy.readIdbStore<string>('state').should('not.include', REMEMBERED);
      cy.get('[data-testid="settings-saved-token"]').should('not.exist');
      cy.get('[role="dialog"]').contains('button', 'Cancel').click();
      cy.get('[aria-label="Your profile, Discrub Tester"]').should('be.visible');

      // Re-remember it so Logout has something to forget.
      cy.get('[aria-label="Your profile, Discrub Tester"]').click({ force: true });
      cy.get('[data-testid="profile-logout"]').click();
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="landing-remember-token"]').check();
      cy.get('input[type="password"]').clear().type(REMEMBERED, { log: false });
      cy.get('[data-testid="landing-sign-in"]').click();
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');
      cy.readIdbStore<string>('state').should('include', REMEMBERED);

      // Logout drops the stored token and lands on the gate again.
      cy.get('[aria-label="Your profile, Discrub Tester"]').click({ force: true });
      cy.get('[data-testid="profile-logout"]').click();
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
      cy.readIdbStore<string>('state').should('not.include', REMEMBERED);

      // A further reload must NOT sign in on its own any more.
      cy.interceptDiscordApi();
      acceptOnlyRememberedToken();
      cy.reload();
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
      cy.get('[aria-label="Your profile, Discrub Tester"]').should('not.exist');
    });

    it('drops a remembered token Discord no longer accepts and says so', () => {
      cy.interceptDiscordApi();
      acceptOnlyRememberedToken();
      cy.visit('/');
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="landing-remember-token"]').check();
      cy.get('input[type="password"]').clear().type(REMEMBERED, { log: false });
      cy.get('[data-testid="landing-sign-in"]').click();
      cy.get('[aria-label="Your profile, Discrub Tester"]', { timeout: 15000 }).should('be.visible');

      // Now every token is refused: the restore fails, the token is removed.
      cy.interceptDiscordApi();
      cy.blockAutoAuth();
      cy.reload();
      cy.contains('Your saved token no longer works', { timeout: 15000 }).should('be.visible');
      cy.readIdbStore<string>('state').should('not.include', REMEMBERED);
    });
  });
});
