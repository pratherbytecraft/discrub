/**
 * Name matching for the sidebar filters (#274).
 *
 * Server names often use "fancy font" Unicode letters (mathematical bold,
 * italic, script, fullwidth, circled and so on). A plain lowercase compare
 * never matches those against what a person types, so both sides go through
 * NFKC first, which folds the compatibility forms back to the base letters,
 * then lowercase.
 */
export const normalizeName = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFKC').toLowerCase();

/** True when `name` contains the trimmed, normalized `query`. */
export const nameIncludes = (name: string | null | undefined, query: string): boolean =>
  normalizeName(name).includes(normalizeName(query).trim());
