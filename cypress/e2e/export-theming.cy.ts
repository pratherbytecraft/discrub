/**
 * Export theming E2E (v2.1.0 slot E) — the active app theme bakes as
 * the export default, the free six always embed, and the supporter
 * eight embed only when a valid key is present at export time.
 *
 * ⚠️ RUN THIS SPEC IN CHROME (`--browser chrome`) — the supporter test
 * verifies a real Ed25519 key, and Cypress's bundled Electron
 * (Chromium 130) has no WebCrypto Ed25519 (see supporter.cy.ts).
 */

const API = '**/api/v10';

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

async function signLifetimeKey(): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const payload = {
    v: 2,
    kid: '2026-2',
    jti: Math.random().toString(16).slice(2, 18),
    name: 'Cy Exporter',
    eh: '0123456789abcdef',
    ent: { themes: null },
    iat: nowS,
    exp: null,
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
  'Discrub-settings', 'Discrub-state', 'Discrub-presets', 'Discrub-cache',
  'Discrub-history', 'Discrub-statuslog', 'Discrub-package', 'Discrub-media',
  'keyval-store',
];

function visitApp() {
  cy.interceptDiscordApi();
  cy.visit('/', {
    onBeforeLoad(win) {
      for (const name of DB_NAMES) {
        try {
          win.indexedDB.deleteDatabase(name);
        } catch {
          /* best-effort */
        }
      }
      (win as unknown as { __supporterPublicKeysOverride__: Record<string, string> })
        .__supporterPublicKeysOverride__ = { '2026-2': publicKeyPem };
    },
  });
  cy.contains('Discrub Tester', { timeout: 15000 }).should('be.visible');
}

function pasteSupporterKey() {
  cy.then(() => signLifetimeKey()).then((key) => {
    cy.openThemesHub();
    cy.get('[data-testid="supporter-paste-key"]').type(key as string, { delay: 0 });
    cy.get('[data-testid="supporter-paste-apply"]').click();
    cy.get('[data-testid="supporter-status"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();
  });
}

function saveTheme(themeId: string) {
  // Themes live in the hub only; picks apply (and persist) instantly.
  cy.openThemesHub();
  cy.get('[data-testid="supporter-theme-showcase"]').scrollIntoView().should('be.visible');
  cy.get(`[data-testid="theme-card-${themeId}"]`).click();
  cy.get('[aria-label="Close Supporter dialog"]').click();
}

function openGeneralAndExport() {
  cy.selectServer('Cypress Test Server');
  cy.intercept('GET', `${API}/channels/*/messages?*`, {
    statusCode: 200,
    body: [
      {
        id: '900000000000000001',
        channel_id: '801000000000000001',
        author: {
          id: '111222333444555666',
          username: 'discrub_tester',
          discriminator: '0',
          avatar: null,
          global_name: 'Discrub Tester',
        },
        content: 'themed export message',
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
      },
    ],
  }).as('customMessages');
  cy.contains('general').click();
  cy.wait('@customMessages');
  cy.contains('button', 'Export').click();
  cy.get('[role="dialog"]').contains('button', /^Export$/).click();
}

describe('Export theming (slot E)', () => {
  before(() => {
    cy.wrap(makeFixturePair());
  });

  it('a free theme bakes as the export default with only free themes embedded', () => {
    cy.task('downloads:clean');
    visitApp();
    saveTheme('terminal');

    openGeneralAndExport();
    cy.waitForDownload(/^general\.zip$/i, 60000).then((zipName) => {
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/general-page-1.html',
      }).then((page) => {
        expect(page).to.contain('class="export-theme-terminal"');
        expect(page).to.contain('<option value="terminal" selected>');
        expect(page).to.contain('.export-theme-discord-light {');
        expect(page).to.not.contain('synthwave');
        // Free set only: 6 dropdown options.
        expect(page.match(/<option value="/g)).to.have.length(6);
      });
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/shell.html',
      }).then((shell) => {
        expect(shell).to.contain('<option value="terminal" selected>');
        expect(shell).to.contain('.shell-theme-terminal {');
        expect(shell).to.not.contain('shell-theme-synthwave');
      });
    });
  });

  it('a supporter export embeds the full roster with the supporter theme baked', () => {
    cy.task('downloads:clean');
    visitApp();
    pasteSupporterKey();
    saveTheme('synthwave');

    openGeneralAndExport();
    cy.waitForDownload(/^general\.zip$/i, 60000).then((zipName) => {
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/general-page-1.html',
      }).then((page) => {
        expect(page).to.contain('class="export-theme-synthwave"');
        expect(page).to.contain('<option value="synthwave" selected>');
        expect(page).to.contain('.export-theme-abyss {');
        // Full roster: 14 dropdown options.
        expect(page.match(/<option value="/g)).to.have.length(14);
      });
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/shell.html',
      }).then((shell) => {
        expect(shell).to.contain('<option value="synthwave" selected>');
        expect(shell).to.contain('.shell-theme-synthwave {');
      });
    });
  });

  it('free exports carry the default Discrub footer with the bundled icon (slot F)', () => {
    cy.task('downloads:clean');
    visitApp();

    openGeneralAndExport();
    cy.waitForDownload(/^general\.zip$/i, 60000).then((zipName) => {
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/general-page-1.html',
      }).then((page) => {
        expect(page).to.contain('<footer class="export-footer">');
        expect(page).to.contain('Exported with <strong>Discrub</strong> on ');
        // The bundled 48px icon embeds as a data URI.
        expect(page).to.match(/export-footer-icon" src="data:image\/png;base64,/);
      });
    });
  });

  it('a supporter can reword the footer, upload an icon, and turn it off (slot F)', () => {
    cy.task('downloads:clean');
    visitApp();
    pasteSupporterKey();

    // Customize: text + uploaded icon.
    cy.openThemesHub();
    cy.get('[data-testid="supporter-footer-text"]').type('Archived by Cy{enter}');
    cy.get('[data-testid="supporter-footer-icon-input"]').selectFile(
      'cypress/fixtures/footer-icon-sample.png',
      { force: true },
    );
    cy.get('[data-testid="supporter-footer-icon-preview"]').should('be.visible');
    cy.get('[aria-label="Close Supporter dialog"]').click();

    openGeneralAndExport();
    cy.waitForDownload(/^general\.zip$/i, 60000).then((zipName) => {
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/general-page-1.html',
      }).then((page) => {
        expect(page).to.contain('Archived by Cy on ');
        expect(page).to.not.contain('Exported with <strong>Discrub</strong>');
        expect(page).to.match(/export-footer-icon" src="data:image\/png;base64,/);
      });
    });

    // Turn the footer off entirely and export again.
    cy.task('downloads:clean');
    cy.openThemesHub();
    cy.get('[data-testid="supporter-footer-enabled"]').click();
    cy.get('[aria-label="Close Supporter dialog"]').click();

    cy.contains('button', 'Export').click();
    cy.get('[role="dialog"]').contains('button', /^Export$/).click();
    cy.waitForDownload(/^general\.zip$/i, 60000).then((zipName) => {
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/general-page-1.html',
      }).then((page) => {
        expect(page).to.not.contain('<footer class="export-footer">');
      });
    });
  });

  it('a light-base theme bakes the light structural class', () => {
    cy.task('downloads:clean');
    visitApp();
    saveTheme('discord-light');

    openGeneralAndExport();
    cy.waitForDownload(/^general\.zip$/i, 60000).then((zipName) => {
      cy.task<string>('zip:read', {
        fileName: zipName,
        entry: 'general/general-page-1.html',
      }).then((page) => {
        expect(page).to.contain('class="export-theme-discord-light light-theme"');
        expect(page).to.contain('<option value="discord-light" selected>');
      });
    });
  });
});
