/**
 * Data behind the WelcomePanel corkboard: the Discord bots Prather Bytecraft
 * ships alongside Discrub. Adding a bot is a data change here, nothing else.
 *
 * Copy mirrors `BOTS` in the pratherbytecraft.com catalog so the site and the
 * board agree. Install links go through the site's counted redirect
 * (`/go/<slug>?from=discrub`) so installs that start in Discrub are countable
 * without Discrub itself doing any analytics.
 */

export interface BotEntry {
  /** Stable id, also the redirect slug on pratherbytecraft.com. */
  id: string;
  name: string;
  /** One line under the name; identical to the site tagline. */
  tagline: string;
  /** Counted redirect to the Discord install flow. */
  installUrl: string;
  /** Product page on pratherbytecraft.com. */
  pageUrl: string;
}

const SITE = 'https://pratherbytecraft.com';

export const BOTS: BotEntry[] = [
  {
    id: 'retrostat',
    name: 'Retrostat',
    tagline: 'Retrospective statistics for any date range',
    installUrl: `${SITE}/go/retrostat?from=discrub`,
    pageUrl: `${SITE}/retrostat`,
  },
  {
    id: 'scour',
    name: 'Scour',
    tagline: 'Delete messages by rule, any age, with a receipt',
    installUrl: `${SITE}/go/scour?from=discrub`,
    pageUrl: `${SITE}/scour`,
  },
  {
    id: 'vested',
    name: 'Vested',
    tagline: 'Timed roles that expire on their own',
    installUrl: `${SITE}/go/vested?from=discrub`,
    pageUrl: `${SITE}/vested`,
  },
];

/**
 * Counted install redirect with a per-placement source, so the site's
 * analytics can tell the corkboard and the TopBar spotlight apart.
 */
export const installUrlFor = (botId: string, source: string) => `${SITE}/go/${botId}?from=${source}`;

/** Where bot ideas go; mirrors the site's workbench address. */
export const BOT_IDEA_MAILTO = 'mailto:workbench@pratherbytecraft.com?subject=Bot%20idea';

