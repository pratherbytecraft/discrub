/**
 * Language codes Discrub ships a catalog for. English is the source
 * language and the fallback; every other entry is a machine-drafted
 * catalog that community members can correct in `src/i18n/locales/`.
 */
export const SUPPORTED_LANGUAGES = ['en', 'de', 'zh'] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** Native-script display names for the pickers. */
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  de: 'Deutsch',
  zh: '简体中文',
};

/**
 * BCP 47 tag per catalog, for `lang` attributes. The zh catalog is
 * Simplified Chinese, so it is tagged zh-CN.
 */
export const LANGUAGE_TAGS: Record<LanguageCode, string> = {
  en: 'en',
  de: 'de',
  zh: 'zh-CN',
};

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Best supported match for the browser's preferred languages
 * (`navigator.languages`, then `navigator.language`). Region subtags are
 * ignored, so "de-AT" and "de-CH" both resolve to "de". Chinese is the
 * exception: the catalog is Simplified, so zh, zh-CN, zh-SG and zh-Hans
 * match it while zh-TW, zh-HK, zh-MO and zh-Hant do not (a Traditional
 * reader gets the next candidate, or English). Falls back to English when
 * nothing matches or when there is no navigator (tests).
 */
export function detectBrowserLanguage(
  candidates: readonly string[] | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : undefined,
): LanguageCode {
  for (const candidate of candidates ?? []) {
    const parts = candidate.toLowerCase().split(/[-_]/);
    const base = parts[0];
    if (base === 'zh' && parts.slice(1).some((p) => p === 'tw' || p === 'hk' || p === 'mo' || p === 'hant')) continue;
    if (isLanguageCode(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** Coerce a stored setting value to a supported code (English when unset or unknown). */
export function normalizeLanguage(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE;
}
