import { t as translate } from '@/i18n';
import {
  PACKAGE_CHANNEL_TYPE,
  THREAD_CHANNEL_TYPES,
  type PackageChannel,
} from './packageTypes';

/**
 * Top-level category for a channel, used to group entries in the sidebar
 * and to pick which icon to render next to the label.
 */
export type PackageChannelCategory =
  | 'guildText'
  | 'thread'
  | 'dm'
  | 'groupDm'
  | 'orphan'
  | 'unknown';

/** Every category, in sidebar order. */
export const PACKAGE_CHANNEL_CATEGORIES: readonly PackageChannelCategory[] = [
  'guildText',
  'thread',
  'dm',
  'groupDm',
  'orphan',
  'unknown',
];

export function getPackageChannelCategory(
  channel: PackageChannel,
): PackageChannelCategory {
  if (channel.isOrphan) return 'orphan';
  if (THREAD_CHANNEL_TYPES.has(channel.type)) return 'thread';
  switch (channel.type) {
    case PACKAGE_CHANNEL_TYPE.DM:
      return 'dm';
    case PACKAGE_CHANNEL_TYPE.GROUP_DM:
      return 'groupDm';
    case PACKAGE_CHANNEL_TYPE.GUILD_TEXT:
    case PACKAGE_CHANNEL_TYPE.GUILD_FORUM:
      return 'guildText';
    default:
      // #270: a type Discrub could neither read nor infer.
      return 'unknown';
  }
}

/**
 * Returns a human-friendly display label for a package channel.
 *
 * DM labels in the Discord export are stored as `Direct Message with
 * <username>#0` — the `#0` is a leftover from Discord's pre-2023
 * discriminator system and never appears in the real client. We strip
 * it and also strip the `Direct Message with` prefix so sidebar rows
 * show just the recipient handle. Channel-type context comes from the
 * icon beside the row, not the label text.
 */
export function getPackageChannelLabel(channel: PackageChannel): string {
  const raw = channel.name?.trim();

  if (!raw) {
    if (channel.type === PACKAGE_CHANNEL_TYPE.DM) return translate('common.directMessage');
    if (channel.type === PACKAGE_CHANNEL_TYPE.GROUP_DM) return translate('package.groupDm');
    if (channel.isOrphan) return 'Unknown channel';
    return channel.id;
  }

  const stripped = stripLegacyDiscriminator(raw);

  if (
    channel.type === PACKAGE_CHANNEL_TYPE.DM ||
    channel.type === PACKAGE_CHANNEL_TYPE.GROUP_DM
  ) {
    const dmPrefix = /^Direct Message with\s+/i;
    if (dmPrefix.test(stripped)) {
      const handle = stripped.replace(dmPrefix, '').trim();
      return handle || (channel.type === PACKAGE_CHANNEL_TYPE.DM ? translate('common.directMessage') : translate('package.groupDm'));
    }
  }

  return stripped;
}

/**
 * Short subtitle describing where this channel came from. Used under
 * the display label in sidebar rows.
 */
export function getPackageChannelSubtitle(channel: PackageChannel): string {
  if (channel.isOrphan) {
    return channel.name ? 'Left server' : `Left server · ${channel.id}`;
  }
  if (channel.guildName) return channel.guildName;
  if (channel.type === PACKAGE_CHANNEL_TYPE.DM) return translate('common.directMessage');
  if (channel.type === PACKAGE_CHANNEL_TYPE.GROUP_DM) return translate('package.groupDm');
  if (THREAD_CHANNEL_TYPES.has(channel.type)) return 'Thread';
  return '';
}

/**
 * Removes a trailing `#0` discriminator from a username/DM label if
 * present. Matches both `foo#0` and `Direct Message with foo#0`.
 */
export function stripLegacyDiscriminator(input: string): string {
  return input.replace(/#0\b\s*$/g, '').trim();
}
