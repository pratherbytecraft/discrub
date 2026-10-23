/**
 * The holiday windows on the real clock, for specs that count locked items without pinning the
 * date (holiday.cy.ts pins it). Halloween '26 is October 1 to November 2 2026, one theme and one
 * Scrubling; Christmas '26 is December 1 2026 to January 4 2027, one theme and four Scrublings.
 */
export const halloweenToday = (now = new Date()): boolean =>
  now.getFullYear() === 2026 && (now.getMonth() === 9 || (now.getMonth() === 10 && now.getDate() <= 2));
export const christmasToday = (now = new Date()): boolean =>
  (now.getFullYear() === 2026 && now.getMonth() === 11) || (now.getFullYear() === 2027 && now.getMonth() === 0 && now.getDate() <= 4);
/** The holiday theme whose notice shows today, if any. */
export const holidayThemeToday = (now = new Date()): string | null =>
  halloweenToday(now) ? 'halloween-26' : christmasToday(now) ? 'christmas-26' : null;
/** How many holiday themes are unlocked for everyone today. */
export const holidaysInSeason = (now = new Date()): number => (halloweenToday(now) ? 1 : 0) + (christmasToday(now) ? 1 : 0);
/** How many holiday Scrublings are unlocked for everyone today. */
export const holidayScrublingsInSeason = (now = new Date()): number => (halloweenToday(now) ? 1 : 0) + (christmasToday(now) ? 4 : 0);
