import type { Message, User } from 'discrub-core/types/discord-types';
import { snowflakeTime, type MessageRow } from './messageRows';

/**
 * Row 124 (pass 2): a message read back from the workspace store with a
 * shape the app cannot render. A row written by an older build or by a
 * write that was cut can hold a string where an array belongs, no
 * author, or a timestamp that is not a date. One such row took the whole
 * app down on every boot. The fields the feed, the modals and the export
 * walk are put back to a shape they can use; everything else is left as
 * it was. A sound message is returned as is, with no copy.
 */

const LIST_FIELDS = ['attachments', 'embeds', 'mentions', 'reactions', 'mention_roles', 'sticker_items', 'components', 'message_snapshots'] as const;

/** The author shown when the row has none. */
export const UNKNOWN_AUTHOR: User = { id: '0', username: 'Unknown', discriminator: '0', avatar: null, bot: false } as User;

const isListField = (message: Message, field: (typeof LIST_FIELDS)[number]): boolean =>
  field in message && !Array.isArray((message as Record<string, unknown>)[field]);

const hasBadAuthor = (message: Message): boolean => typeof message.author !== 'object' || message.author === null || typeof message.author.id !== 'string';

const hasBadTimestamp = (message: Message): boolean => typeof message.timestamp !== 'string' || Number.isNaN(Date.parse(message.timestamp));

/**
 * Row 153 (pass 3): the slim row of a message whose stored timestamp is
 * not a date gets its time from the snowflake, like `repairMessage` does
 * for the full message, so the date slot and the sort see a real time.
 * A sound row is returned as is.
 */
export function repairRow(row: MessageRow): MessageRow {
  if (typeof row.timestamp === 'string' && Number.isFinite(row.t) && !Number.isNaN(Date.parse(row.timestamp))) return row;
  const fromId = snowflakeTime(row.id);
  const t = Number.isFinite(fromId) ? fromId : 0;
  return { ...row, timestamp: new Date(t).toISOString(), t };
}

export function repairMessage(message: Message): Message {
  if (typeof message !== 'object' || message === null) return message;
  const badLists = LIST_FIELDS.filter((field) => isListField(message, field));
  const badAuthor = hasBadAuthor(message);
  const badTimestamp = hasBadTimestamp(message);
  if (badLists.length === 0 && !badAuthor && !badTimestamp) return message;
  const fixed = { ...message } as Message & Record<string, unknown>;
  for (const field of badLists) fixed[field] = [];
  if (badAuthor) fixed.author = UNKNOWN_AUTHOR;
  if (badTimestamp) {
    const fromId = typeof message.id === 'string' ? snowflakeTime(message.id) : NaN;
    fixed.timestamp = new Date(Number.isFinite(fromId) ? fromId : 0).toISOString();
  }
  return fixed;
}
