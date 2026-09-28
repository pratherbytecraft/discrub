import i18n from '@/i18n';
import type { Season } from './groups';

/** The last day of a season as a short date in the app's language, for the group heading. */
export const formatSeasonEnd = (season: Season): string =>
  new Date(season.year, season.until[0] - 1, season.until[1]).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' });
