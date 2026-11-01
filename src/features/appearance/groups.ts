/**
 * Groups and seasons for themes and Scrublings. The rules live in the
 * Scrublings package, since holiday Scrublings and holiday themes follow the
 * same season; this module keeps the app's import path.
 */
export { GROUPS, halloween, christmas, inSeason, isUnlocked, groupOrder, groupItems, selectDayKey } from '@pratherbytecraft/scrublings';
export type { ItemGroup, ItemTier, Season } from '@pratherbytecraft/scrublings';
