/**
 * Supporter platform E2E — the Themes hub, paste-a-key unlock,
 * unlock/relock, and the key-based daily check-in (payload v2: one key
 * per person carrying a per-feature entitlement map).
 *
 * ⚠️ RUN THIS SPEC IN CHROME (`--browser chrome`). Cypress's bundled
 * Electron (Chromium 130) has no WebCrypto Ed25519, so the app's key
 * verification fails closed there and every unlock test would fail.
 * The fixture keypair is generated per-run in the spec browser and
 * injected through the dev-only `__supporterPublicKeysOverride__`
 * seam, so the real verification path runs end to end.
 */

const DARK_BG = 'rgb(30, 33, 36)'; // discord-dark background.default
const AMOLED_BG = 'rgb(0, 0, 0)'; // amoled-void background.default

const DAY_S = 24 * 60 * 60;

let publicKeyPem: string;
let privateKey: CryptoKey;

function bytesToB64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeFixturePair(): Promise<void> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

async function signKey(overrides: Record<string, unknown> = {}): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const payload = {
    v: 2,
    kid: '2026-2',
    jti: Math.random().toString(16).slice(2, 18),
    name: 'Cy Tester',
    eh: '0123456789abcdef',
    ent: { themes: nowS + 30 * DAY_S },
    iat: nowS,
    exp: nowS + 30 * DAY_S,
    ...overrides,
  };
  const body = bytesToB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    new TextEncoder().encode(body),
  );
  return `DSCRB-${body}.${bytesToB64Url(new Uint8Array(signature))}`;
}

const DB_NAMES = [
  'Discrub-settings',
  'Discrub-state',
  'Discrub-presets',
  'Discrub-cache',
  'Discrub-history',
  'Discrub-statuslog',
  'Discrub-package',
  'Discrub-media',
  'keyval-store',
];

/**
 * Like cy.login(), but injects the fixture public key before app boot.
 * freshDbs=false keeps IndexedDB so persistence across reloads can be
 * asserted.
 */
function visitApp({
  freshDbs = true,
  stubRefresh = true,
}: { freshDbs?: boolean; stubRefresh?: boolean } = {}) {
  cy.interceptDiscordApi();
  // The daily check-in fires on the first boot with a key; keep it
  // offline by default (fail-open) so tests only see the calls they
  // deliberately set up. Intercepts are LIFO, so a test that registers
  // its own refresh intercept BEFORE calling visitApp must pass
  // stubRefresh=false or this one shadows it.
  if (stubRefresh) {
    cy.intercept('POST', '**/supporter/refresh', { forceNetworkError: true }).as('refreshOffline');
  }
  cy.visit('/', {
    onBeforeLoad(win) {
      if (freshDbs) {
        for (const name of DB_NAMES) {
          try {
            win.indexedDB.deleteDatabase(name);
          } catch {
            /* best-effort */
          }
        }
      }
      (win as unknown as { __supporterPublicKeysOverride__: Record<string, string> })
        .__supporterPublicKeysOverride__ = { '2026-2': publicKeyPem };
    },
  });
  cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
}

/** Open the hub and apply a key through the paste box (the primary path). */
function applyKeyViaDialog(key: string) {
  cy.openThemesHub();
  cy.get('[data-testid="supporter-dialog"]').should('be.visible');
  cy.get('[data-testid="supporter-paste-key"]').type(key, { delay: 0 });
  cy.get('[data-testid="supporter-paste-apply"]').click();
}

describe('Supporter platform', () => {
  before(() => {
    cy.wrap(makeFixturePair());
  });

  it('gift button opens the hub with the purchase grid first, then the theme grid', () => {
    visitApp();
    cy.openThemesHub();
    cy.get('[data-testid="supporter-dialog"]').should('be.visible');
    cy.contains('growing pack of cosmetic themes').should('be.visible');
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid^="theme-locked-"]').should(
      'have.length',
      8,
    );
    // Two tiers, one Ko-fi button each; the period toggle swaps price + URL.
    cy.get('[data-testid="supporter-kofi-themes-monthly"]').should(
      'have.attr',
      'href',
      'https://ko-fi.com/prathercc/tiers',
    );
    cy.get('[data-testid="supporter-kofi-hosted-monthly"]').should('be.visible');
    cy.get('[data-testid="supporter-price-themes"]').should('have.text', '$3');
    cy.get('[data-testid="supporter-period-yearly"]').click();
    cy.get('[data-testid="supporter-kofi-themes-yearly"]').should(
      'have.attr',
      'href',
      'https://ko-fi.com/s/0b4f9b2bdf',
    );
    cy.get('[data-testid="supporter-kofi-hosted-yearly"]').should('be.visible');
    cy.get('[data-testid="supporter-price-themes"]').should('have.text', '$25');
    cy.get('[data-testid="supporter-period-monthly"]').click();
    cy.get('[data-testid="supporter-dialog"]').should('not.contain.text', 'Lifetime');
    // The purchase grid renders above the theme grid.
    cy.get('[data-testid="supporter-purchase-grid"]').then(($grid) => {
      cy.get('[data-testid="supporter-theme-showcase"]').then(($themes) => {
        expect($grid[0].getBoundingClientRect().top).to.be.lessThan(
          $themes[0].getBoundingClientRect().top,
        );
      });
    });
    // Export footer controls are shown, locked, with the real default line.
    cy.get('[data-testid="supporter-footer-controls"]').should('have.attr', 'data-locked', 'true');
    cy.get('[data-testid="supporter-footer-text"]')
      .should('be.disabled')
      .and('have.value', 'Exported with Discrub');
    // The key delivery + check-in disclosure, with the sender address
    // as a mailto link, and never the word "code".
    cy.get('[data-testid="supporter-key-email-link"]').should(
      'have.attr',
      'href',
      'mailto:keys@pratherbytecraft.com',
    );
    cy.contains('right after you join').should('be.visible');
    cy.contains('about once a day').should('be.visible');
    cy.get('[data-testid="supporter-dialog"]')
      .invoke('text')
      .then((text) => expect(text.toLowerCase()).not.to.contain('code'));
  });

  it('applying a key unlocks supporter themes end to end', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[data-testid="supporter-status"]').should('contain.text', 'issued to Cy Tester');
    cy.get('[data-testid="supporter-access-themes"]').should('have.attr', 'data-live', 'true');
    cy.get('[data-testid="supporter-access-hosted"]')
      .should('have.attr', 'data-live', 'false')
      .and('contain.text', 'Not included');
    // Footer controls are live for a themes key.
    cy.get('[data-testid="supporter-footer-controls"]').should('have.attr', 'data-locked', 'false');
    cy.get('[data-testid="supporter-footer-text"]').should('not.be.disabled');
    // The access card sits above the theme grid.
    cy.get('[data-testid="supporter-status"]').then(($status) => {
      cy.get('[data-testid="supporter-theme-showcase"]').then(($themes) => {
        expect($status[0].getBoundingClientRect().top).to.be.lessThan(
          $themes[0].getBoundingClientRect().top,
        );
      });
    });
    // The hub's own grid unlocks in place; switch right here.
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid^="theme-locked-"]').should(
      'have.length',
      0,
    );
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid="theme-card-amoled-void"]').click();
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', AMOLED_BG);

    // Reopening the hub shows the applied pick as selected.
    cy.openThemesHub();
    cy.get('[data-testid="theme-selected-amoled-void"]').should('exist');
  });

  it('the gift button becomes the supporter badge and the avatar gains its ring', () => {
    visitApp();
    cy.get('[data-testid="supporter-badge"]').should('not.exist');
    cy.get('[data-testid="supporter-avatar-pip"]').should('not.exist');
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[aria-label="Close Supporter dialog"]').click();

    cy.get('[data-testid="supporter-badge"]').should('be.visible');
    cy.get('[data-testid="supporter-avatar-pip"]').should('be.visible');
    cy.get('[data-testid="gift-button"]')
      .should('have.attr', 'aria-label', 'Appearance')
      .and('have.css', 'animation-name', 'none');

    // The badge still opens the hub, and removing the key restores the gift.
    cy.openThemesHub();
    cy.get('[data-testid="supporter-remove-key"]').click();
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('[data-testid="supporter-badge"]').should('not.exist');
    cy.get('[data-testid="supporter-avatar-pip"]').should('not.exist');
    cy.get('[data-testid="gift-button"]').should('have.attr', 'aria-label', 'Appearance');
  });

  it('an applied key and theme survive a reload even when the check-in is offline', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid="theme-card-amoled-void"]').click();
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', AMOLED_BG);

    // visitApp forces the refresh call offline: fail-open keeps the key.
    visitApp({ freshDbs: false });
    cy.wait('@refreshOffline');
    cy.get('body').should('have.css', 'background-color', AMOLED_BG);
    cy.get('[data-testid="supporter-badge"]').should('exist');
  });

  it('checks in once a day: the first boot with a key calls refresh, the next one does not', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[aria-label="Close Supporter dialog"]').click();

    // First reload: the key has never been checked, so it is presented
    // and the merged answer (now carrying hosted too) is stored.
    cy.then(() =>
      signKey({
        ent: {
          themes: Math.floor(Date.now() / 1000) + 40 * DAY_S,
          hosted: Math.floor(Date.now() / 1000) + 400 * DAY_S,
        },
      }),
    ).then((merged) => {
      cy.intercept('POST', '**/supporter/refresh', (req) => {
        expect(req.body.email).to.be.undefined;
        req.reply({
          statusCode: 200,
          body: { key: merged, ent: { themes: 1, hosted: 1 }, name: 'Cy Tester', expiresAt: null },
        });
      }).as('refresh');
    });
    visitApp({ freshDbs: false, stubRefresh: false });
    cy.wait('@refresh');
    cy.openThemesHub();
    cy.get('[data-testid="supporter-access-hosted"]').should('have.attr', 'data-live', 'true');
    cy.get('[data-testid="supporter-checkin-note"]').should('contain.text', 'Checked just now');
    cy.get('[aria-label="Close Supporter dialog"]').click();

    // Second reload inside the day: no call at all.
    cy.intercept('POST', '**/supporter/refresh', cy.spy().as('refreshSpy'));
    visitApp({ freshDbs: false, stubRefresh: false });
    cy.get('[data-testid="supporter-badge"]').should('exist');
    cy.get('@refreshSpy').should('not.have.been.called');
  });

  it('relocks on the 410 "access ended" answer without losing the key', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid="theme-card-amoled-void"]').click();
    cy.get('[aria-label="Close Supporter dialog"]').click();

    cy.intercept('POST', '**/supporter/refresh', {
      statusCode: 410,
      body: { status: 410, error: 'Your supporter access has ended' },
    }).as('ended');
    visitApp({ freshDbs: false, stubRefresh: false });
    cy.wait('@ended');
    cy.get('body').should('have.css', 'background-color', DARK_BG);
    cy.get('[data-testid="supporter-badge"]').should('not.exist');
    cy.openThemesHub();
    cy.get('[data-testid="supporter-lapsed-note"]').should('be.visible');
    // The key is kept so Refresh works after a renewal.
    cy.get('[data-testid="supporter-refresh-key"]').should('exist');
  });

  it('redeems the short emailed key for the full key and unlocks', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      // The server exchanges the short form for the merged full key;
      // the app then verifies THAT locally before unlocking.
      cy.intercept('POST', '**/supporter/redeem', (req) => {
        expect(req.body.code).to.equal('DSCRB-AAAA-2222');
        req.reply({
          key: key as string,
          ent: { themes: 1 },
          name: 'Cy Tester',
          expiresAt: null,
        });
      }).as('redeem');
    });
    // Lowercase with spaces — normalization must handle a sloppy paste.
    applyKeyViaDialog('dscrb aaaa 2222');
    cy.wait('@redeem');
    cy.get('[data-testid="supporter-status"]').should('contain.text', 'Cy Tester');

    // The FULL key (not the short form) is what persists across reloads,
    // offline-verifiable; a redeem counts as a check-in so the reload
    // makes no refresh call either.
    cy.intercept('POST', '**/supporter/redeem', cy.spy().as('redeemSpy'));
    cy.intercept('POST', '**/supporter/refresh', cy.spy().as('refreshSpy'));
    visitApp({ freshDbs: false });
    cy.get('[data-testid="supporter-badge"]').should('exist');
    cy.get('@redeemSpy').should('not.have.been.called');
    cy.get('@refreshSpy').should('not.have.been.called');
  });

  it('shows the server error copy when a short key is refused', () => {
    visitApp();
    cy.intercept('POST', '**/supporter/redeem', {
      statusCode: 404,
      body: { error: 'That key does not match an active supporter key' },
    }).as('redeem');
    applyKeyViaDialog('DSCRB-AAAA-2222');
    cy.wait('@redeem');
    cy.get('[data-testid="supporter-claim-error"]').should(
      'contain.text',
      'That key does not match an active supporter key',
    );
  });

  it('shows the server error copy when a manual refresh is refused', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[data-testid="supporter-status"]').should('be.visible');
    cy.intercept('POST', '**/supporter/refresh', {
      statusCode: 404,
      body: { status: 404, error: 'That key does not match an active supporter membership' },
    }).as('refresh');
    cy.get('[data-testid="supporter-refresh-key"]').click();
    cy.wait('@refresh');
    cy.get('[data-testid="supporter-claim-error"]').should(
      'contain.text',
      'That key does not match an active supporter membership',
    );
  });

  it('accepts a valid pasted key and rejects a tampered one', () => {
    visitApp();
    cy.openThemesHub();

    // Tampered: flip a character in the signature.
    cy.then(() => signKey({ ent: { themes: null }, exp: null })).then((key) => {
      const k = key as string;
      const tampered = k.slice(0, -4) + (k.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      cy.get('[data-testid="supporter-paste-key"]').type(tampered, { delay: 0 });
      cy.get('[data-testid="supporter-paste-apply"]').click();
      cy.get('[data-testid="supporter-claim-error"]').should(
        'contain.text',
        "doesn't look like a valid supporter key",
      );

      cy.get('[data-testid="supporter-paste-key"]').clear().type(k, { delay: 0 });
      cy.get('[data-testid="supporter-paste-apply"]').click();
      cy.get('[data-testid="supporter-access-themes"]').should('contain.text', 'Never expires');
    });
  });

  it('removing the key relocks supporter themes and falls back to a free theme', () => {
    visitApp();
    cy.then(() => signKey()).then((key) => {
      applyKeyViaDialog(key as string);
    });
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid="theme-card-amoled-void"]').click();
    cy.get('[aria-label="Close Supporter dialog"]').click();
    cy.get('body').should('have.css', 'background-color', AMOLED_BG);

    cy.openThemesHub();
    cy.get('[data-testid="supporter-remove-key"]').click();
    cy.contains('growing pack of cosmetic themes').scrollIntoView().should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();

    // Theme falls back without touching the saved setting.
    cy.get('body').should('have.css', 'background-color', DARK_BG);
    cy.openThemesHub();
    cy.get('[data-testid="supporter-theme-showcase"] [data-testid^="theme-locked-"]').should(
      'have.length',
      8,
    );
    // The relocked-but-still-saved theme shows its lock (the corner
    // badge shows lock over check; the selection border remains).
    cy.get('[data-testid="theme-locked-amoled-void"]').should('exist');
    cy.get('[data-testid="theme-selected-amoled-void"]').should('not.exist');
  });

  it('gift attention animation calms for the session and re-arms on reload', () => {
    visitApp();
    cy.get('[data-testid="gift-button"]').should(
      'have.css',
      'animation-name',
      'giftGlow, giftWiggle',
    );
    cy.get('[data-testid="gift-button"]').click();
    cy.get('body').type('{esc}');
    cy.get('[data-testid="gift-button"]').should('have.css', 'animation-name', 'none');

    // Per-session by design: a fresh app open re-arms the intrigue
    // until the user becomes a supporter.
    visitApp({ freshDbs: false });
    cy.get('[data-testid="gift-button"]').should(
      'have.css',
      'animation-name',
      'giftGlow, giftWiggle',
    );
  });
});
