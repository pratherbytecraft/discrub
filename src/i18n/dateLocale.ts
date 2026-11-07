import { de, enUS, zhCN } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import i18next from 'i18next';
import { normalizeLanguage, type LanguageCode } from './language';

const DATE_LOCALES: Record<LanguageCode, Locale> = { en: enUS, de, zh: zhCN };

/** date-fns locale matching the active UI language (month and weekday names). */
export function getDateLocale(code: LanguageCode = normalizeLanguage(i18next.language)): Locale {
  return DATE_LOCALES[code];
}
