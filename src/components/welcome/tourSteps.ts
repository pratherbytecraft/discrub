import type { TFunction } from 'i18next';
import { t as defaultT } from '@/i18n';

/**
 * Catalog entry: a piece of explanatory copy keyed by a stable
 * identifier. Used by the family of inline help components —
 * `<TourButton>`, `<TourFootnote>`, and `<TourCaption>` — that render
 * a `?` affordance keyed to a stepKey. The guided walk-throughs that
 * also read this catalog were removed in 2.2.6.
 *
 * Adding a new entry here is the single source of truth — drop the
 * appropriate inline component next to a feature for individual help.
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
  // ── Channel view ───────────────────────────────────────────────────
  'multi-select-toggle': {
    title: 'Multi-Select Mode',
    content: "Click to select more than one at a time. A \"Select all\" link picks the full visible list, and any bulk actions available for the list appear below the selection count.",
  },
  'search-filters': {
    title: 'Filters',
    content: 'Two layers in one modal: Search hits Discord\'s API (author, content, date, has-types, mentions, pinned, author type) and shows "X of Y matches loaded" as results stream in. Refine narrows the already-loaded messages purely client-side, with no API calls.',
  },
  'focus-button': {
    title: 'Focus Mode',
    content: 'Hides the sidebar and status panel for distraction-free reading. Press F to toggle, Escape to exit.',
  },

  // ── Tier 1 inline-only entries ─────────────────────────────────────
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
    content: "Discord rate-limits how often user tokens can call its API. These delays insert pauses between operations to stay under the limits. Lower delays go faster but risk a 429 response (and a forced wait). The defaults are tuned conservatively, so only change them if you know what you're doing. Anything above 10s is the Safest zone, for very long runs such as a full-server export.",
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
 * Localized catalog entry (#124). The catalog above stays the English
 * source; translations live under `tour.<key>` and fall back to it.
 * Components pass their `useTranslation()` `t` so they re-render on a
 * language change.
 */
export function getTourEntry(
  key: string,
  t: TFunction = defaultT,
): TourCatalogEntry | undefined {
  const entry = tourCatalog[key];
  if (!entry) return undefined;
  return {
    title: t(`tour.${key}.title`, { defaultValue: entry.title }),
    content: t(`tour.${key}.content`, { defaultValue: entry.content }),
  };
}
