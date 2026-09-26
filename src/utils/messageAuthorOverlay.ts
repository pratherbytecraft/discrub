import type { Message, User } from 'discrub-core/types/discord-types';

export interface AuthorOverlayEntry {
  userName?: string;
  displayName?: string;
  nick?: string;
}

/**
 * Overlay message authors onto a user map used for markdown rendering.
 *
 * #263: ServerView rebuilds its user map whenever the loaded list changes
 * (every Load All page, every bulk-delete flush), so this runs over every
 * loaded message each time. An author already recorded with the same
 * username and display name is left as is instead of being re-spread.
 * A changed username or a new global name still replaces the entry, and a
 * cached nickname survives the replacement.
 */
export const overlayMessageAuthors = (
  map: Record<string, AuthorOverlayEntry>,
  messages: Message[],
): Record<string, AuthorOverlayEntry> => {
  messages.forEach((msg) => {
    const author = msg.author;
    if (!author) return;
    const cur = map[author.id];
    const displayName = author.global_name || cur?.displayName;
    if (cur && cur.userName === author.username && cur.displayName === displayName) return;
    map[author.id] = { ...cur, userName: author.username, displayName };
  });
  return map;
};

/** True when both maps hold the same ids with the same name fields. */
export const sameAuthorEntries = (
  a: Record<string, AuthorOverlayEntry>,
  b: Record<string, AuthorOverlayEntry>,
): boolean => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const id of aKeys) {
    const x = a[id];
    const y = b[id];
    if (!y || x.userName !== y.userName || x.displayName !== y.displayName || x.nick !== y.nick) return false;
  }
  return true;
};

/** True when both maps hold the same ids pointing at the same objects. */
export const sameEntriesByRef = <T,>(a: Record<string, T>, b: Record<string, T>): boolean => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const id of aKeys) if (a[id] !== b[id]) return false;
  return true;
};

/** True when two author copies show the same person the same way. */
export const sameAuthorFields = (a: User, b: User): boolean =>
  a === b || (a.id === b.id && a.username === b.username && a.global_name === b.global_name && a.avatar === b.avatar && a.discriminator === b.discriminator && a.bot === b.bot);
