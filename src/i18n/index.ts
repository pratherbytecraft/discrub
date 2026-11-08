/**
 * i18next bootstrap. Imported once from `main.tsx` (and the Vitest
 * setup) so `t()` works everywhere, including Redux thunks and
 * services that render no React. Catalogs are bundled: the extension
 * has no network path for lazy-loading them and the two files are small.
 *
 * English stays the default so the existing English-text assertions in
 * the unit and E2E suites keep describing the shipped product.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { registerSupporterResources } from '@pratherbytecraft/supporter';
import en from './locales/en.json';
import de from './locales/de.json';
import zh from './locales/zh.json';
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type LanguageCode } from './language';
import { syncCoreMessages } from './coreMessages';

export const resources = {
  en: { translation: en },
  de: { translation: de },
  zh: { translation: zh },
} as const;

void i18next.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  // Bundled resources need no loading, so init resolves synchronously and
  // `t` is usable right after this module evaluates (slices, tests).
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
});
// The supporter wall and panel's strings; the app's own wording above wins where it differs.
registerSupporterResources(i18next);

/**
 * Switch the active language everywhere it is observable: React
 * (via react-i18next), the document `lang` attribute, and the strings
 * discrub-core emits through its message catalog.
 */
export async function applyLanguage(code: LanguageCode): Promise<void> {
  if (i18next.language !== code) {
    await i18next.changeLanguage(code);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = LANGUAGE_TAGS[code];
  }
  syncCoreMessages();
}

export const t = i18next.t.bind(i18next);
export default i18next;
