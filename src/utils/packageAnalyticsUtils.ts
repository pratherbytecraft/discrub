import { getPackageChannelCategory } from '@/features/package/packageDisplayUtils';
import {
  PACKAGE_CHANNEL_TYPE,
  type PackageChannel,
} from '@/features/package/packageTypes';
import { getPackageChannelLabel } from '@/features/package/packageDisplayUtils';

/* ────────── metadata-only stats (available immediately after parse) ────────── */

export interface ChannelStat {
  channelId: string;
  label: string;
  guildName: string | null;
  messageCount: number;
  isOrphan: boolean;
}

export type GuildBreakdownKind = 'guild' | 'dms' | 'leftServers' | 'unknown';

export interface GuildBreakdownEntry {
  guildId: string | null;
  /** English label; the view names the dms, leftServers and unknown rows itself. */
  guildName: string;
  kind: GuildBreakdownKind;
  messageCount: number;
  channelCount: number;
}

export interface ChannelTypeBreakdown {
  guildText: number;
  dms: number;
  groupDms: number;
  threads: number;
  orphans: number;
  other: number;
}

export function computeTopChannels(
  channels: PackageChannel[],
  limit = 10,
): ChannelStat[] {
  return [...channels]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, limit)
    .map((c) => ({
      channelId: c.id,
      label: labelForChannel(c),
      guildName: c.guildName ?? null,
      messageCount: c.messageCount,
      isOrphan: c.isOrphan,
    }));
}

export function computeGuildBreakdown(
  channels: PackageChannel[],
): GuildBreakdownEntry[] {
  const byGuild = new Map<string | null, GuildBreakdownEntry>();

  for (const channel of channels) {
    const isDm =
      channel.type === PACKAGE_CHANNEL_TYPE.DM ||
      channel.type === PACKAGE_CHANNEL_TYPE.GROUP_DM;
    const key = isDm ? '__dms__' : channel.guildId ?? '__orphan__';
    const name = isDm
      ? 'Direct Messages'
      : channel.guildName ?? (channel.isOrphan ? 'Left servers' : 'Unknown server');
    const kind: GuildBreakdownKind = isDm
      ? 'dms'
      : channel.guildName ? 'guild' : channel.isOrphan ? 'leftServers' : 'unknown';

    const existing = byGuild.get(key) ?? {
      guildId: isDm ? null : channel.guildId ?? null,
      guildName: name,
      kind,
      messageCount: 0,
      channelCount: 0,
    };
    existing.messageCount += channel.messageCount;
    existing.channelCount += 1;
    byGuild.set(key, existing);
  }

  return [...byGuild.values()].sort((a, b) => b.messageCount - a.messageCount);
}

export function computeChannelTypeBreakdown(
  channels: PackageChannel[],
): ChannelTypeBreakdown {
  const result: ChannelTypeBreakdown = {
    guildText: 0,
    dms: 0,
    groupDms: 0,
    threads: 0,
    orphans: 0,
    other: 0,
  };
  // #270: one classification for the sidebar, the chip, and this card.
  for (const c of channels) {
    switch (getPackageChannelCategory(c)) {
      case 'orphan':
        result.orphans += 1;
        break;
      case 'guildText':
        result.guildText += 1;
        break;
      case 'dm':
        result.dms += 1;
        break;
      case 'groupDm':
        result.groupDms += 1;
        break;
      case 'thread':
        result.threads += 1;
        break;
      case 'unknown':
        result.other += 1;
        break;
    }
  }
  return result;
}

function labelForChannel(channel: PackageChannel): string {
  return getPackageChannelLabel(channel);
}

/* ────────── timeline stats (require loaded timestamps) ────────── */

export interface MonthBucket {
  /** `YYYY-MM` */
  key: string;
  count: number;
}

export interface YearBucket {
  year: number;
  count: number;
}

export interface HourBucket {
  /** 0–23, UTC */
  hour: number;
  count: number;
}

export interface TimelineStats {
  total: number;
  byMonth: MonthBucket[];
  byYear: YearBucket[];
  byHour: HourBucket[];
  peakMonth: MonthBucket | null;
  peakHour: HourBucket | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

/**
 * Compute timeline statistics from an array of ISO-ish timestamp strings
 * ("YYYY-MM-DD HH:MM:SS.ffffff+00:00" as Discord packages produce them).
 * Invalid timestamps are skipped.
 */
export function computeTimelineStats(timestamps: string[]): TimelineStats {
  const monthCounts = new Map<string, number>();
  const yearCounts = new Map<number, number>();
  const hourCounts = new Array<number>(24).fill(0);
  let first: string | null = null;
  let last: string | null = null;
  let total = 0;

  for (const ts of timestamps) {
    const date = parseDiscordTimestamp(ts);
    if (!date) continue;
    total += 1;

    const year = date.getUTCFullYear();
    const monthKey = `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    hourCounts[date.getUTCHours()] += 1;

    if (!first || ts < first) first = ts;
    if (!last || ts > last) last = ts;
  }

  const byMonth: MonthBucket[] = [...monthCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const byYear: YearBucket[] = [...yearCounts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  const byHour: HourBucket[] = hourCounts.map((count, hour) => ({ hour, count }));

  const peakMonth =
    byMonth.length === 0
      ? null
      : byMonth.reduce((a, b) => (b.count > a.count ? b : a));

  const peakHour =
    byHour.every((h) => h.count === 0)
      ? null
      : byHour.reduce((a, b) => (b.count > a.count ? b : a));

  return {
    total,
    byMonth,
    byYear,
    byHour,
    peakMonth,
    peakHour,
    firstTimestamp: first,
    lastTimestamp: last,
  };
}

/** Parses a Discord data-package timestamp into a Date (UTC). */
export function parseDiscordTimestamp(raw: string): Date | null {
  if (!raw) return null;
  // Format: "2022-07-28 22:30:52.800000+00:00" — convert space to T for Date.
  const normalized = raw.replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}
