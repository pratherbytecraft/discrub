/**
 * 2.2.9: the words an export carries with it, in the language the app is
 * set to when the export runs. An exported page is a file on disk with no
 * i18n runtime, so every string is resolved here at export time and written
 * into the page.
 */
import i18next from 'i18next';
import { t } from '@/i18n';
import { LANGUAGE_TAGS, normalizeLanguage, type LanguageCode } from '@/i18n/language';

/** BCP 47 tag for `<html lang>`, per app language. */
export function exportLangTag(code: LanguageCode = normalizeLanguage(i18next.language)): string {
  return LANGUAGE_TAGS[code] ?? 'en';
}

/** Families that carry Chinese, Japanese and Korean glyphs on macOS, Windows and Linux, tried after the Latin ones. */
export const CJK_FONT_FAMILIES = `'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'`;

/** The sans stack of every exported page. */
export const EXPORT_FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica', 'Arial', ${CJK_FONT_FAMILIES}, sans-serif`;

/**
 * Strings the exported page's own script shows (user card, reaction viewer,
 * message menu, search count). `{name}` marks are filled in by the script.
 */
export function viewerStrings(): Record<string, string> {
  return {
    bot: t('export.viewer.bot'),
    serverNickname: t('export.viewer.serverNickname'),
    displayName: t('export.viewer.displayName'),
    accountDetails: t('export.viewer.accountDetails'),
    userId: t('export.viewer.userId'),
    badges: t('export.viewer.badges'),
    roles: t('export.viewer.roles'),
    messagesOne: t('export.viewer.messagesOne'),
    messagesOther: t('export.viewer.messagesOther'),
    all: t('export.viewer.all'),
    searchUsers: t('export.viewer.searchUsers'),
    showMore: t('export.viewer.showMore'),
    noUsersMatching: t('export.viewer.noUsersMatching'),
    reactorsUnavailable: t('export.viewer.reactorsUnavailable'),
    copyText: t('export.viewer.copyText'),
    copyId: t('export.viewer.copyId'),
    searchCount: t('export.viewer.searchCount'),
  };
}

/** JSON that is safe inside a `<script>` block. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (ch) => (ch.charCodeAt(0) === 0x2028 ? '\\u2028' : '\\u2029'));
}
