/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable {
    /**
     * Set up all common Discord API intercepts
     */
    interceptDiscordApi(): Chainable<void>;

    /**
     * Block auto-authentication from VITE_DISCORD_TOKEN.
     * Must be called BEFORE cy.visit('/').
     */
    blockAutoAuth(): Chainable<void>;

    /**
     * Log in (auto-auth via env token with mocked API)
     */
    login(): Chainable<void>;

    /**
     * Select a server by name from the sidebar
     */
    selectServer(name: string): Chainable<void>;

    /**
     * Select a channel by name from the channel list
     */
    selectChannel(name: string): Chainable<void>;

    /**
     * Switch to DMs tab and select a DM by recipient name
     */
    selectDm(name: string): Chainable<void>;

    /**
     * Read every value from a `Discrub-<store>` IndexedDB database.
     */
    readIdbStore<T = unknown>(store: string): Chainable<T[]>;

    /**
     * Read every key from one of the per-purpose `Discrub-<store>`
     * IndexedDB databases. Useful for asserting on namespace structure
     * (`pkg:meta:*`, `pkg:msgs:*`, etc.) without inspecting payloads.
     */
    readIdbStoreKeys(store: string): Chainable<string[]>;

    /**
     * Upload a data-package ZIP fixture into the ImportDialog.
     * Default fixture: cypress/fixtures/test-package.zip
     */
    uploadPackage(fixture?: string): Chainable<void>;

    /**
     * Click the "Package" sidebar tab.
     */
    openPackageTab(): Chainable<void>;
    /** Opens the Appearance menu on its Supporter segment (2.2.0). */
    openThemesHub(): Chainable<void>;
    /** Opens the Appearance menu on its Theme segment. */
    openThemeGrid(): Chainable<void>;
    /** Closes the Appearance menu. */
    closeAppearance(): Chainable<void>;

    /**
     * Wait for a completed browser download whose filename matches
     * `pattern`; yields the filename. Pair with the `downloads:clean`,
     * `zip:list`, and `zip:read` tasks for exported-zip assertions.
     */
    waitForDownload(pattern: RegExp, timeoutMs?: number): Chainable<string>;
  }
}
