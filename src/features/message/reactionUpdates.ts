/**
 * The reaction changes the reaction thunks make, as plain functions on a
 * message (2.2.5 W1). The reducers apply them to the cached objects and
 * the persistence middleware applies the same function to the stored
 * messages, so a message the cache evicted is changed on disk too.
 */

import type { Message } from 'discrub-core/types/discord-types';
import { getEmojiKey } from '@/utils/emojiUtils';

export type ReactionUpdate = (message: Message) => Message;

type ReactionLike = { emoji: { id?: string | null; name?: string | null } };

export const emojiMatches = (r: ReactionLike, emoji: string): boolean => {
  const emojiKey = r.emoji.id || r.emoji.name;
  return emojiKey === emoji || `${r.emoji.name}:${r.emoji.id}` === emoji;
};

/** One of the user's own reactions of `emoji` removed. */
export const removeOneReaction = (emoji: string): ReactionUpdate => (m) => {
  if (!m.reactions) return m;
  const reactions = m.reactions
    .map((r) => (emojiMatches(r, emoji) ? { ...r, count: (r.count || 1) - 1 } : r))
    .filter((r) => (r.count || 0) > 0);
  return { ...m, reactions };
};

/** Every reaction of `emoji` removed. */
export const removeEmoji = (emoji: string): ReactionUpdate => (m) => {
  if (!m.reactions) return m;
  return { ...m, reactions: m.reactions.filter((r) => !emojiMatches(r, emoji)) };
};

/** Every reaction removed. */
export const clearReactions: ReactionUpdate = (m) => ({ ...m, reactions: [] });

/** What a Remove Reactions run did to each message it processed. */
export const batchRemoval = (mode: 'all' | 'emoji' | 'user', emojis?: string[] | null): ReactionUpdate => {
  const emojiSet = emojis ? new Set(emojis) : null;
  return (m) => {
    if (!m.reactions) return m;
    if (mode === 'all') return { ...m, reactions: [] };
    if (mode === 'emoji' && emojiSet) {
      return { ...m, reactions: m.reactions.filter((r) => !emojiSet.has(getEmojiKey(r.emoji))) };
    }
    return {
      ...m,
      reactions: m.reactions
        .map((r) => {
          if (emojiSet && !emojiSet.has(getEmojiKey(r.emoji))) return r;
          return { ...r, count: Math.max(0, (r.count || 1) - 1), me: false };
        })
        .filter((r) => r.count > 0),
    };
  };
};

export type AddedEmoji = { id?: string | null; name?: string | null; animated?: boolean | null };

/** The user's reactions an Add Reactions run put on each message, merged in. */
export const batchAddition = (byId: ReadonlyMap<string, AddedEmoji[]>): ReactionUpdate => (m) => {
  const toAdd = byId.get(m.id);
  if (!toAdd) return m;
  let reactions = [...(m.reactions || [])];
  for (const emoji of toAdd) {
    const key = getEmojiKey(emoji);
    const idx = reactions.findIndex((r) => getEmojiKey(r.emoji) === key);
    if (idx >= 0) {
      const r = reactions[idx];
      // Idempotent: only bump count if this @me reaction wasn't already present.
      if (!r.me) {
        reactions = reactions.map((rx, i) => (i === idx ? { ...rx, count: (rx.count || 0) + 1, me: true } : rx));
      }
    } else {
      reactions = [
        ...reactions,
        {
          count: 1,
          count_details: { burst: 0, normal: 1 },
          me: true,
          me_burst: false,
          emoji: {
            id: emoji.id ?? undefined,
            name: emoji.name ?? undefined,
            animated: emoji.animated ?? undefined,
          },
          burst_colors: [],
        },
      ];
    }
  }
  return { ...m, reactions };
};
