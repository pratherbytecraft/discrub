/**
 * Compatibility matrix: what differs between the places Discrub runs.
 *
 * Columns are setups, rows are the three things that genuinely differ
 * (everything else, purge/search/bulk ops, is identical everywhere).
 * Evidence for every cell lives in
 * tooling/plans/COMPATIBILITY_AUDIT_2026_08_21.md. Used by the
 * Compatibility popover (gate card, TopBar, More menu) and by the
 * context-aware default zip part size.
 */
import { isExtensionMode } from '@/extension/messaging';
import { isIOSSafari } from './downloadWriter';

export type CompatSetup =
  | 'chrome-ext'
  | 'firefox-ext'
  | 'be-chrome'
  | 'be-firefox'
  | 'be-phone';

export type CompatRowKey = 'signIn' | 'exportSize' | 'exportMedia';

export type CompatStatus = 'ok' | 'note';

export interface CompatCell {
  status: CompatStatus;
  text: string;
}

export const COMPAT_SETUPS: { key: CompatSetup; label: string; short: string }[] = [
  { key: 'chrome-ext', label: 'Chrome extension', short: 'Chrome ext' },
  { key: 'firefox-ext', label: 'Firefox extension', short: 'Firefox ext' },
  { key: 'be-chrome', label: 'Bleeding Edge on Chrome', short: 'BE Chrome' },
  { key: 'be-firefox', label: 'Bleeding Edge on Firefox', short: 'BE Firefox' },
  { key: 'be-phone', label: 'Bleeding Edge on mobile', short: 'BE mobile' },
];

export const COMPAT_ROWS: { key: CompatRowKey; label: string }[] = [
  { key: 'signIn', label: 'Sign in' },
  { key: 'exportSize', label: 'Export size' },
  { key: 'exportMedia', label: 'Export media' },
];

const OK = (text: string): CompatCell => ({ status: 'ok', text });
const NOTE = (text: string): CompatCell => ({ status: 'note', text });

const PASTE_TOKEN = NOTE('Manual');
const SMALL_PARTS = NOTE('Smaller parts');
const SKIPPED_FILES = NOTE('Most files');

export const COMPAT_TABLE: Record<CompatSetup, Record<CompatRowKey, CompatCell>> = {
  'chrome-ext': {
    signIn: OK('Automatic'),
    exportSize: OK('No limit'),
    exportMedia: OK('All files'),
  },
  'firefox-ext': {
    signIn: OK('Automatic'),
    exportSize: SMALL_PARTS,
    exportMedia: OK('All files'),
  },
  'be-chrome': {
    signIn: PASTE_TOKEN,
    exportSize: OK('No limit'),
    exportMedia: SKIPPED_FILES,
  },
  'be-firefox': {
    signIn: PASTE_TOKEN,
    exportSize: OK('No limit'),
    exportMedia: SKIPPED_FILES,
  },
  'be-phone': {
    signIn: PASTE_TOKEN,
    exportSize: SMALL_PARTS,
    exportMedia: SKIPPED_FILES,
  },
};

export const isFirefoxUA = (nav: Pick<Navigator, 'userAgent'> = navigator): boolean =>
  /\bFirefox\//.test(nav.userAgent || '');

export const isPhoneUA = (nav: Navigator = navigator): boolean =>
  isIOSSafari(nav) || /\bAndroid\b.*\bMobile\b/.test(nav.userAgent || '');

/**
 * Which column applies to this device. Web builds (hosted Bleeding Edge
 * and the plain web app) share the same constraints, so both map to the
 * "Bleeding Edge" columns.
 */
export function detectCompatSetup(
  nav: Navigator = navigator,
  extension: boolean = isExtensionMode(),
): CompatSetup {
  if (extension) return isFirefoxUA(nav) ? 'firefox-ext' : 'chrome-ext';
  if (isPhoneUA(nav)) return 'be-phone';
  return isFirefoxUA(nav) ? 'be-firefox' : 'be-chrome';
}

export const compatSetupLabel = (setup: CompatSetup): string =>
  COMPAT_SETUPS.find((s) => s.key === setup)?.label ?? setup;

/**
 * Setups whose download writer buffers each zip part in memory
 * (Firefox extension pages have no service worker; iOS stages through
 * OPFS under Safari's quota). They get a smaller default part size.
 */
export const usesSmallZipParts = (setup: CompatSetup): boolean =>
  setup === 'firefox-ext' || setup === 'be-phone';

/**
 * Setups that offer one zip with no size limit. Chrome on a computer writes
 * a download straight to disk. Firefox and phones stage it in browser
 * storage first, which has a ceiling an export of that size would hit.
 */
export const supportsSingleZip = (setup: CompatSetup): boolean =>
  setup === 'chrome-ext' || setup === 'be-chrome';
