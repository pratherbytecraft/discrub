/**
 * #124 — UI language.
 *
 * German ships as the first translation. The language lives in the
 * Display tab, on the login screen as a one-word link, and resolves from
 * the browser on a fresh install. An existing install stays English and
 * gets one toast offering the switch.
 */
const IDB_NAMES = [
  'Discrub-settings', 'Discrub-state', 'Discrub-presets', 'Discrub-cache',
  'Discrub-history', 'Discrub-statuslog', 'Discrub-package', 'Discrub-media', 'keyval-store',
];

const wipeIdb = (win: Window) => {
  for (const name of IDB_NAMES) {
    try { win.indexedDB.deleteDatabase(name); } catch { /* best-effort */ }
  }
};

const setBrowserLanguage = (win: Window, languages: string[]) => {
  Object.defineProperty(win.navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(win.navigator, 'language', { value: languages[0], configurable: true });
};

/** Remove the resolved language key so the next boot behaves like a pre-2.1.4 install. */
const forgetStoredLanguage = () =>
  cy.window({ log: false }).then((win) =>
    new Cypress.Promise<void>((resolve) => {
      const req = win.indexedDB.open('Discrub-settings');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keyval')) { db.close(); resolve(); return; }
        const tx = db.transaction('keyval', 'readwrite');
        tx.objectStore('keyval').delete('appLanguage');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    }),
  );

describe('Localization (#124)', () => {
  describe('Display tab picker', () => {
    beforeEach(() => {
      cy.login();
    });

    it('switches the app to German on Save, persists across reload, and switches back', () => {
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]').contains('button', 'Display').click();
      cy.get('[data-testid="language-select"]').parent().click();
      cy.get('[data-testid="language-option-de"]').click();
      cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
      cy.get('[role="dialog"]').contains('Einstellungen gespeichert').should('be.visible');
      cy.get('[role="dialog"]').contains('button', /^Abbrechen$/).click();
      cy.get('[role="dialog"]').should('not.exist');

      cy.contains('[role="tab"]', 'Paket').should('be.visible');
      cy.get('[aria-label="Einstellungen"]').should('exist');
      cy.get('html').should('have.attr', 'lang', 'de');

      cy.reload();
      cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
      cy.contains('[role="tab"]', 'Paket').should('be.visible');
      cy.readIdbStore('settings').then((values) => {
        expect(values).to.include('de');
      });

      cy.get('[aria-label="Einstellungen"]').click();
      cy.get('[role="dialog"]').contains('button', 'Anzeige').click();
      cy.get('[data-testid="language-select"]').parent().click();
      cy.get('[data-testid="language-option-en"]').click();
      cy.get('[role="dialog"]').contains('button', 'Einstellungen speichern').click();
      cy.contains('[role="tab"]', 'Package').should('be.visible');
      cy.get('html').should('have.attr', 'lang', 'en');
    });

    it('translates the status log and operation labels, not only the chrome', () => {
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]').contains('button', 'Display').click();
      cy.get('[data-testid="language-select"]').parent().click();
      cy.get('[data-testid="language-option-de"]').click();
      cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
      cy.get('[role="dialog"]').contains('Einstellungen gespeichert').should('be.visible');
      cy.get('[role="dialog"]').contains('button', /^Abbrechen$/).click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.contains('STATUSPROTOKOLL').should('be.visible');
      cy.selectServer('Test Server');
      cy.contains('Kanäle').should('be.visible');
    });
  });

  describe('Login screen link', () => {
    beforeEach(() => {
      cy.blockAutoAuth();
      cy.visit('/', { onBeforeLoad: wipeIdb });
      cy.get('[data-testid="landing-sign-in"]', { timeout: 10000 }).should('be.visible');
    });

    it('offers Deutsch, applies it immediately, and offers English back', () => {
      cy.get('[data-testid="landing-language-de"]').should('have.text', 'Deutsch').click();
      cy.contains('button', 'Anmelden').should('be.visible');
      cy.contains('label', 'Discord-Token').should('exist');
      cy.get('[data-testid="landing-language-de"]').should('not.exist');
      cy.get('[data-testid="landing-language-en"]').should('have.text', 'English').click();
      cy.contains('button', 'Sign In').should('be.visible');
    });
  });

  describe('Browser language', () => {
    it('follows a German browser on a fresh install without asking', () => {
      cy.blockAutoAuth();
      cy.visit('/', {
        onBeforeLoad(win) {
          wipeIdb(win);
          setBrowserLanguage(win, ['de-DE', 'en-US']);
        },
      });
      cy.contains('button', 'Anmelden', { timeout: 10000 }).should('be.visible');
      cy.contains('Discrub ist auch auf Deutsch verfügbar.').should('not.exist');
    });

    it('keeps an existing install on English and offers the switch once', () => {
      // An existing install: settings saved before the language key existed.
      cy.login();
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
      // Wait for the save to land before removing the key, or the write re-pins English after the delete.
      cy.get('[role="dialog"]').contains('Settings saved').should('be.visible');
      forgetStoredLanguage();

      cy.interceptDiscordApi();
      cy.visit('/', { onBeforeLoad: (win) => setBrowserLanguage(win, ['de-DE']) });
      // The toast auto-dismisses after 15s, so assert it before anything slower.
      cy.contains('Discrub ist auch auf Deutsch verfügbar.', { timeout: 20000 }).should('be.visible');
      cy.contains('[role="tab"]', 'Package').should('be.visible');
      cy.get('[role="alert"]').contains('button', 'Auf Deutsch wechseln').click();
      cy.contains('[role="tab"]', 'Paket').should('be.visible');

      // Pinned now: a further German-browser boot neither re-suggests nor flips back.
      cy.interceptDiscordApi();
      cy.visit('/', { onBeforeLoad: (win) => setBrowserLanguage(win, ['de-DE']) });
      cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
      cy.contains('[role="tab"]', 'Paket').should('be.visible');
      cy.contains('Discrub ist auch auf Deutsch verfügbar.').should('not.exist');
    });

    it('never suggests anything to an English browser', () => {
      cy.login();
      cy.get('[aria-label="Settings"]').click();
      cy.get('[role="dialog"]').contains('button', 'Save Settings').click();
      // Wait for the save to land before removing the key, or the write re-pins English after the delete.
      cy.get('[role="dialog"]').contains('Settings saved').should('be.visible');
      forgetStoredLanguage();
      cy.interceptDiscordApi();
      cy.visit('/', { onBeforeLoad: (win) => setBrowserLanguage(win, ['en-GB']) });
      cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
      cy.contains('Discrub ist auch auf Deutsch verfügbar.').should('not.exist');
      cy.contains('[role="tab"]', 'Package').should('be.visible');
    });
  });
});
