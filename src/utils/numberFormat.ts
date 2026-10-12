import i18n from '@/i18n';

/**
 * Numbers for the UI language (pass 2, row 100): "39,0 KB" in German,
 * "39.0 KB" in English. One formatter per language and digit count is
 * kept, since Intl.NumberFormat is slow to build.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(minDigits: number, maxDigits: number): Intl.NumberFormat {
  const language = i18n.language || 'en';
  const key = `${language}:${minDigits}:${maxDigits}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.NumberFormat(language, { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
    formatters.set(key, found);
  }
  return found;
}

/** Exactly `digits` decimals, like toFixed, in the UI language. */
export const formatFixed = (value: number, digits: number): string => formatter(digits, digits).format(value);

/** Up to `digits` decimals, trailing zeros dropped, in the UI language. */
export const formatUpTo = (value: number, digits: number): string => formatter(0, digits).format(value);
