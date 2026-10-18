/**
 * The Prather Bytecraft Mac apps shown under For Mac in the Apps menu
 * (mac-apps-promo, 2.2.6). Only Mac users see the section. Adding an app is a
 * data change here, nothing else. Copy mirrors the site pages.
 */
import startbarBadge from '@/assets/startbar-badge.png';
import filedrawerBadge from '@/assets/filedrawer-badge.png';

export interface MacAppEntry {
  id: string;
  name: string;
  /** One line under the name. */
  tagline: string;
  /** Bundled badge, 96 px. */
  badge: string;
  /** Product page on pratherbytecraft.com; Get and Learn more both open it. */
  pageUrl: string;
}

const SITE = 'https://pratherbytecraft.com';

export const MAC_APPS: MacAppEntry[] = [
  {
    id: 'startbar',
    name: 'Startbar',
    tagline: 'A taskbar for macOS, with a Start button and a button per window',
    badge: startbarBadge,
    pageUrl: `${SITE}/startbar?from=discrub`,
  },
  {
    id: 'filedrawer',
    name: 'Filedrawer',
    tagline: 'A file manager for macOS, with tabs and two panes',
    badge: filedrawerBadge,
    pageUrl: `${SITE}/filedrawer?from=discrub`,
  },
];
