import type { Step } from 'react-joyride';

/**
 * Catalog entry: a piece of explanatory copy keyed by a stable
 * identifier. Used by both the auto-running joyride tours (via
 * `shellTourSteps` / `contextualTourSteps` below) and the family of
 * inline help components — `<TourButton>`, `<TourFootnote>`, and
 * `<TourCaption>` — that render a `?` affordance keyed to a stepKey.
 *
 * Adding a new entry here is the single source of truth — drop the
 * appropriate inline component next to a feature for individual help,
 * or include the key in one of the tour arrays for orientation
 * walkthroughs.
 */
export interface TourCatalogEntry {
  /** Heading shown at the top of the tooltip / popover. */
  title: string;
  /** One short paragraph. Plain text — no markdown. */
  content: string;
}

/**
 * The flat catalog. Keep keys kebab-case and stable — they're used
 * as React keys in the inline help components and persisted nowhere,
 * so renaming is safe but should still be deliberate.
 */
export const tourCatalog: Record<string, TourCatalogEntry> = {
  // ── Shell (always-rendered chrome) ────────────────────────────────
  'servers-tab': {
    title: 'Servers',
    content: 'Your Discord servers appear here. Click one to browse its channels.',
  },
  'dms-tab': {
    title: 'Direct Messages',
    content: 'Switch here to browse your direct messages and group chats.',
  },
  'sidebar-search': {
    title: 'Search',
    content: 'Filter servers, channels, or DMs by name.',
  },
  settings: {
    title: 'Settings',
    content: 'Customize operation delays, export defaults, display preferences, and more.',
  },
  theme: {
    title: 'Theme',
    content: 'Switch between dark, light, and auto (system) themes.',
  },
  more: {
    title: 'More',
    content: 'Access Ideas & Contact, the subreddit, and Announcements from here.',
  },
  'status-panel': {
    title: 'Status Log',
    content: 'All operations show real-time progress here. Expand for full details, or download the log file.',
  },
  'user-profile': {
    title: 'Your Profile',
    content: 'Click to view your account details and profile info.',
  },
  logout: {
    title: 'Sign Out',
    content: "Sign out when you're done. Your token is never stored. It's cleared immediately.",
  },

  // ── Contextual (channel-view) ──────────────────────────────────────
  'multi-select-toggle': {
    title: 'Multi-Select Mode',
    content: "Click to select more than one at a time. A \"Select all\" link picks the full visible list, and any bulk actions available for the list appear below the selection count.",
  },
  'author-avatar': {
    title: 'Author Actions',
    content: "Click any author's avatar or name in the feed to open their profile. From there, you can filter the channel to just their messages, or to messages that mention them, with one click.",
  },
  'search-filters': {
    title: 'Filters',
    content: 'Two layers in one modal: Search hits Discord\'s API (author, content, date, has-types, mentions, pinned, author type) and shows "X of Y matches loaded" as results stream in. Refine narrows the already-loaded messages purely client-side, with no API calls.',
  },
  'export-button': {
    title: 'Export',
    content: 'Export messages in HTML, CSV, JSON, or media-only. Pick a preset (9 built-in) or roll your own with your saved settings.',
  },
  'analytics-button': {
    title: 'Analytics',
    content: 'See mention frequency, who you talk to most, engagement over time. Export the analytics to CSV for further crunching.',
  },
  'focus-button': {
    title: 'Focus Mode',
    content: 'Hides the sidebar and status panel for distraction-free reading. Press F to toggle, Escape to exit.',
  },
  'message-feed': {
    title: 'Message Feed',
    content: 'Click a message to select it, then use the toolbar to delete, edit, or manage attachments. Click reply bars or pinned-message notices to jump to the referenced message.',
  },

  // ── Tier 1 inline-only entries (not part of any walkthrough) ──
  'refine-section': {
    title: 'Refine vs Search',
    content: "Refine narrows the messages already loaded in your feed: instant, client-side, no API calls. Search above hits Discord's API and pulls fresh results. Use Refine to slice what you have, and Search when you need to find more.",
  },
  'profile-quick-filters': {
    title: 'Quick Filter Buttons',
    content: 'These buttons narrow the channel to messages by this user, or messages that mention them. Other active filters (date, content, etc.) are preserved. Only the user scope changes.',
  },

  // ── Tier 2 spot-only entries ──────────────────────────────────────
  'purge-mode-toggle': {
    title: 'Purge Modes',
    content: 'Messages deletes the whole message. Attachments Only edits the message to strip its attachments without deleting the text. Reactions removes specific reactions. Clear All Reactions wipes every reaction (requires Manage Messages permission). All four are destructive, so read the summary before confirming.',
  },
  'pause-resume-controls': {
    title: 'Pause & Resume',
    content: "Long operations can be paused mid-run and resumed later. Useful when you hit a rate-limit warning or just want to step away. Cancel ends the run entirely; partial work is preserved where it makes sense (e.g. enrichment caches).",
  },
  'operation-delays': {
    title: 'Operation Delays',
    content: "Discord rate-limits how often user tokens can call its API. These delays insert pauses between operations to stay under the limits. Lower delays go faster but risk a 429 response (and a forced wait). The defaults are tuned conservatively, so only change them if you know what you're doing.",
  },
  'export-presets': {
    title: 'Export Presets',
    content: "A preset is a saved snapshot of every export setting: format, page size, template, media options. Pick one to apply all those settings at once. The 9 built-in presets cover common scenarios (Discord-style HTML, Spreadsheet, Media-only). Drift from a preset clears the dropdown.",
  },
  'search-match-counter': {
    title: 'Search Match Count',
    content: '"X of Y matches loaded" means: Discord found Y messages matching your search, but only X are loaded so far. Scroll down (or click Load All) to fetch the rest in 25-message pages. Discord caps each search at 5000 matches, but Load All transparently chains queries past that.',
  },
  'package-rehydrate': {
    title: 'Rehydrate (Load Rich Data)',
    content: "Your data package contains the bare facts: message text, timestamps, attachment URLs. Rehydration fetches live Message objects from Discord so you also get reactions, reply previews, named mentions, embeds, and fresh signed CDN URLs. The button shows an estimated runtime on hover. A guild-wide search preflight covers most messages in a single pass before per-message lookups begin. Results persist to IndexedDB so a rehydrated channel reopens instantly.",
  },
  'package-import': {
    title: 'Discord Data Package',
    content: "Drop in the ZIP from Discord's Request All My Data export. Discrub decompresses it once into IndexedDB, so reopening the page or browsing back to a channel never re-extracts the archive. Reload the page and your package auto-resumes without re-importing. Multi-gigabyte packages and any Discord locale (English, French, German, Spanish, Simplified Chinese, Cyrillic, etc.) are supported.",
  },
};

/**
 * Helper that turns a catalog key + extra Joyride options into a Step.
 * Keeps the tour arrays terse without losing the catalog as the
 * single source of truth for copy.
 */
function step(
  key: keyof typeof tourCatalog,
  target: string,
  extra: Partial<Step> = {},
): Step {
  return {
    target,
    title: tourCatalog[key].title,
    content: tourCatalog[key].content,
    ...extra,
  };
}

/**
 * Phase 1: Shell tour — visible on the idle screen before any server is selected.
 * Triggered from WelcomePanel "Take a Tour" button.
 */
export const shellTourSteps: Step[] = [
  step('servers-tab', '[data-tour="servers-tab"]', { placement: 'right' }),
  step('dms-tab', '[data-tour="dms-tab"]', { placement: 'right' }),
  step('sidebar-search', '[data-tour="sidebar-search"]', { placement: 'right' }),
  step('settings', '[aria-label="Settings"]'),
  step('theme', '[aria-label="Toggle theme"]'),
  step('more', '[aria-label="More options"]'),
  step('status-panel', '[data-tour="status-panel"]', { placement: 'top' }),
  step('user-profile', '[data-tour="user-profile"]'),
  step('logout', '[aria-label="Logout"]'),
];

/**
 * Phase 2: Contextual tips — shown once after the user first loads messages.
 * Covers features only visible when a channel is selected.
 *
 * Refreshed for 2.0.2: replaced broken message-table anchor (deleted in
 * #111) with message-feed; added Author actions step (covers profile
 * + #129 inline filters); added Focus mode step. Search filters copy
 * mentions Search vs Refine and the lazy "X of Y" pagination.
 */
export const contextualTourSteps: Step[] = [
  step('multi-select-toggle', '[data-tour="multi-select-toggle"]', { placement: 'right' }),
  step('author-avatar', '[data-tour="author-avatar"]', { placement: 'right' }),
  step('search-filters', '[data-tour="search-filters"]'),
  step('export-button', '[data-tour="export-button"]'),
  step('analytics-button', '[data-tour="analytics-button"]'),
  step('focus-button', '[data-tour="focus-button"]'),
  step('message-feed', '[data-tour="message-feed"]', { placement: 'top' }),
];
