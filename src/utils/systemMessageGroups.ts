import { MessageType } from 'discrub-core/discord-enum';

export interface SystemMessageGroup {
  key: string;
  label: string;
  types: MessageType[];
}

// Discord's non-DEFAULT, non-REPLY message types grouped into plain-English
// buckets. Shared by the purge dialog's "System Messages" opt-in (#196) and
// the feed Refine filter (#201) so the two surfaces never drift apart.
// DEFAULT (0) and REPLY (19) are intentionally absent — they're real
// messages, not system events.
export const SYSTEM_MESSAGE_GROUPS: SystemMessageGroup[] = [
  { key: 'pins', label: 'Pin notifications', types: [MessageType.CHANNEL_PINNED_MESSAGE] },
  {
    key: 'members',
    label: 'Member joins & leaves',
    types: [MessageType.RECIPIENT_ADD, MessageType.RECIPIENT_REMOVE, MessageType.USER_JOIN],
  },
  {
    key: 'channel',
    label: 'Channel name / icon changes',
    types: [MessageType.CHANNEL_NAME_CHANGE, MessageType.CHANNEL_ICON_CHANGE, MessageType.CHANNEL_FOLLOW_ADD],
  },
  {
    key: 'boosts',
    label: 'Boost notifications',
    types: [
      MessageType.GUILD_BOOST,
      MessageType.GUILD_BOOST_TIER_1,
      MessageType.GUILD_BOOST_TIER_2,
      MessageType.GUILD_BOOST_TIER_3,
    ],
  },
  {
    key: 'threads',
    label: 'Thread created',
    types: [MessageType.THREAD_CREATED, MessageType.THREAD_STARTER_MESSAGE],
  },
  { key: 'automod', label: 'Auto-mod actions', types: [MessageType.AUTO_MODERATION_ACTION] },
  {
    key: 'other',
    label: 'Other events',
    types: [
      MessageType.CALL,
      MessageType.GUILD_DISCOVERY_DISQUALIFIED,
      MessageType.GUILD_DISCOVERY_REQUALIFIED,
      MessageType.GUILD_DISCOVERY_GRACE_PERIOD_INITIAL_WARNING,
      MessageType.GUILD_DISCOVERY_GRACE_PERIOD_FINAL_WARNING,
      MessageType.CHAT_INPUT_COMMAND,
      MessageType.GUILD_INVITE_REMINDER,
      MessageType.CONTEXT_MENU_COMMAND,
      MessageType.ROLE_SUBSCRIPTION_PURCHASE,
      MessageType.INTERACTION_PREMIUM_UPSELL,
      MessageType.STAGE_START,
      MessageType.STAGE_END,
      MessageType.STAGE_SPEAKER,
      MessageType.STAGE_TOPIC,
      MessageType.GUILD_APPLICATION_PREMIUM_SUBSCRIPTION,
    ],
  },
];

export const ALL_SYSTEM_GROUP_KEYS: string[] = SYSTEM_MESSAGE_GROUPS.map((g) => g.key);

// Flatten the checked group keys into the union of their MessageType values
// (enum string values, e.g. "6"). Iterates SYSTEM_MESSAGE_GROUPS so the
// result order is deterministic by group, independent of click order.
export const groupsToTypes = (selectedGroupKeys: string[]): string[] =>
  SYSTEM_MESSAGE_GROUPS.filter((g) => selectedGroupKeys.includes(g.key)).flatMap(
    (g) => g.types,
  );

// Add/remove a single group key from the selected set (immutable).
export const toggleGroupKey = (selectedGroupKeys: string[], key: string): string[] =>
  selectedGroupKeys.includes(key)
    ? selectedGroupKeys.filter((k) => k !== key)
    : [...selectedGroupKeys, key];

// 2.2.5 WP4b: the groups a saved type list came from, so a resumed purge
// shows the same boxes checked. A group counts when all its types are there.
export const typesToGroups = (types: string[]): string[] =>
  SYSTEM_MESSAGE_GROUPS.filter((g) => g.types.length > 0 && g.types.every((type) => types.includes(type))).map((g) => g.key);
