import type { Message, Reaction } from 'discrub-core/types/discord-types';
import { generateMentionCounts } from './analyticsUtils';
import { t } from '@/i18n';

/**
 * Analytics reports over the messages already loaded in the feed (A4, 2026-08-27).
 *
 * The report set mirrors Retrostat's reducers so the modal doubles as a demo
 * for the bot: same names, same counting rules (bots excluded from people
 * counts, one count per message per domain, 2+ reactions for Best Of, …),
 * but computed synchronously over an in-memory array instead of a walk.
 * Every report is a pure function of (messages, context) so it stays easy
 * to test and the modal only has to render rows.
 */

export type UserMap = Record<string, { userName?: string; displayName?: string; nick?: string }>;

export type ReportId =
  | 'mentions'
  | 'members'
  | 'reactions'
  | 'bestof'
  | 'threads'
  | 'keywords'
  | 'links'
  | 'media'
  | 'overview';

export const REPORT_IDS: ReportId[] = ['mentions', 'members', 'reactions', 'bestof', 'threads', 'keywords', 'links', 'media', 'overview'];

export interface ReportRow {
  key: string;
  label: string;
  count: number;
  /** Optional secondary line under the label (emoji breakdown, parent channel, "12 before"…). */
  detail?: string;
  /** Message rows: a short excerpt of the message text. */
  excerpt?: string;
  /** Message rows: the channel the message lives in (for jump links later). */
  channelId?: string;
}

export interface OverviewStats {
  messages: number;
  people: number;
  reactions: number;
  attachments: number;
  replies: number;
  threads: number;
  busiestDay?: { label: string; count: number };
  peakHour?: { hour: number; count: number };
  topEmoji: { label: string; count: number }[];
  best?: { messageId: string; channelId: string; author: string; total: number; excerpt: string };
}

export interface ReportResult {
  rows: ReportRow[];
  /** One-line aggregate shown under the rows (emoji totals, media breakdown…). */
  summary?: string;
  /** Short note on the counting mode, when it is not obvious. */
  mode?: string;
  /** Text shown when there are no rows. */
  empty: string;
  /** Overview only: the headline numbers. */
  stats?: OverviewStats;
}

export interface ReportContext {
  userMap: UserMap;
  /** keywords: the terms to count. */
  terms?: string[];
  /** threads: id → name for the threads the feed knows about. */
  threadNames?: Record<string, string>;
  /** threads: the channel the feed is showing; messages in other channels are thread messages. */
  containerId?: string | null;
  /** Zone used to bucket days and hours (Overview). Defaults to the browser's. */
  timeZone?: string;
}

export interface AnalyticsReport {
  id: ReportId;
  /** Tab label. */
  label: string;
  /** Dialog heading. */
  title: string;
  /** Column heading for the row label. */
  subjectLabel: string;
  /** Column heading for the count. */
  valueLabel: string;
  /** Short description shown under the heading. */
  description: string;
  compute(messages: Message[], context: ReportContext): ReportResult;
}

const REPLY_MESSAGE_TYPE = 19;
export const BESTOF_MIN_REACTIONS = 2;
export const MAX_KEYWORD_TERMS = 10;
export const MAX_KEYWORD_TERM_LENGTH = 100;
const SUMMARY_EMOJI = 10;
const EXCERPT_LENGTH = 80;
const OVERVIEW_TOP_EMOJI = 6;

/** Discord messages that are ordinary user posts (not joins, pins, boosts…). */
function isPost(message: Message): boolean {
  return message.type === 0 || message.type === REPLY_MESSAGE_TYPE || message.type === undefined;
}

export function displayNameFor(message: Message, userMap: UserMap): string {
  const author = message.author;
  if (!author) return 'Unknown';
  const cached = userMap[author.id];
  return cached?.nick || cached?.displayName || author.global_name || cached?.userName || author.username || author.id;
}

function isBot(message: Message): boolean {
  return Boolean(message.author?.bot) || Boolean(message.webhook_id);
}

/** Renders a reaction's emoji the way Discord shows it in text: unicode as-is, custom as `:name:`. */
export function emojiLabel(emoji: Reaction['emoji']): string {
  if (emoji.id) return `:${emoji.name ?? '_'}:`;
  return emoji.name ?? '?';
}

function excerptOf(message: Message): string {
  const text = (message.content ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
  if (message.attachments?.length) return message.attachments.length === 1 ? `Attachment: ${message.attachments[0].filename}` : `${message.attachments.length} attachments`;
  if (message.embeds?.length) return '(embed)';
  if (message.sticker_items?.length) return '(sticker)';
  return '(no text)';
}

function sortDesc(rows: ReportRow[]): ReportRow[] {
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function breakdown(counts: Map<string, number>, limit = Infinity): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([emoji, count]) => `${emoji} ${count.toLocaleString()}`)
    .join(' · ');
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** `terms:` as typed: comma-separated, trimmed, deduped (case-insensitive), capped. */
export function parseTerms(raw: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of raw.split(',')) {
    const term = piece.trim().slice(0, MAX_KEYWORD_TERM_LENGTH);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
    if (terms.length >= MAX_KEYWORD_TERMS) break;
  }
  return terms;
}

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;

/** `https://www.youtube.com/watch?v=…` → `youtube.com`; unparsable → undefined. */
export function domainOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|heic)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;

function attachmentKind(a: { content_type?: string; filename?: string }): 'image' | 'video' | 'other' {
  if (a.content_type?.startsWith('image/') || IMAGE_EXT.test(a.filename ?? '')) return 'image';
  if (a.content_type?.startsWith('video/') || VIDEO_EXT.test(a.filename ?? '')) return 'video';
  return 'other';
}

/** Per-author counter shared by the user-subject reports. */
function perAuthor(messages: Message[], userMap: UserMap, weigh: (message: Message) => number): ReportRow[] {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const message of messages) {
    const author = message.author;
    if (!author?.id || isBot(message)) continue;
    const weight = weigh(message);
    if (weight <= 0) continue;
    counts.set(author.id, (counts.get(author.id) ?? 0) + weight);
    if (!names.has(author.id)) names.set(author.id, displayNameFor(message, userMap));
  }
  return sortDesc([...counts.entries()].map(([key, count]) => ({ key, label: names.get(key) ?? key, count })));
}

function reactionTotal(message: Message): number {
  return (message.reactions ?? []).reduce((sum, r) => sum + (r.count > 0 ? r.count : 0), 0);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const mentions: AnalyticsReport = {
  id: 'mentions',
  label: 'Mentions',
  title: 'Most mentioned',
  subjectLabel: 'Username',
  valueLabel: 'Mentions',
  description: 'Who gets @mentioned most in the loaded messages.',
  compute(messages, { userMap }) {
    const rows = generateMentionCounts(messages, userMap).map((m) => ({ key: m.userId, label: m.username, count: m.count }));
    return { rows, empty: 'No mentions found' };
  },
};

const members: AnalyticsReport = {
  id: 'members',
  label: 'Members',
  title: 'Most active members',
  subjectLabel: 'Member',
  valueLabel: 'Messages',
  description: 'Messages sent per person. Bots are left out.',
  compute(messages, { userMap }) {
    const rows = perAuthor(messages.filter(isPost), userMap, () => 1);
    return { rows, empty: 'No messages from people in this feed.' };
  },
};

const reactions: AnalyticsReport = {
  id: 'reactions',
  label: 'Reactions',
  title: 'Most reactions received',
  subjectLabel: 'Member',
  valueLabel: 'Reactions',
  description: 'Every reaction on a message counts for its author. Bots are left out.',
  compute(messages, { userMap }) {
    const rows = perAuthor(messages, userMap, reactionTotal);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return { rows, summary: total ? `${plural(total, 'reaction')} on ${plural(rows.length, 'person', 'people')}'s messages` : undefined, empty: 'No reactions in this feed.' };
  },
};

const bestof: AnalyticsReport = {
  id: 'bestof',
  label: 'Best Of',
  title: 'Most reacted messages',
  subjectLabel: 'Message',
  valueLabel: 'Reactions',
  description: `Messages with ${BESTOF_MIN_REACTIONS}+ reactions, with the per-emoji breakdown.`,
  compute(messages, { userMap }) {
    const emojiTotals = new Map<string, number>();
    const rows: ReportRow[] = [];
    for (const message of messages) {
      const live = (message.reactions ?? []).filter((r) => r.count > 0);
      if (live.length === 0) continue;
      const byEmoji = new Map<string, number>();
      let total = 0;
      for (const reaction of live) {
        const tag = emojiLabel(reaction.emoji);
        total += reaction.count;
        byEmoji.set(tag, (byEmoji.get(tag) ?? 0) + reaction.count);
        emojiTotals.set(tag, (emojiTotals.get(tag) ?? 0) + reaction.count);
      }
      if (total < BESTOF_MIN_REACTIONS) continue;
      rows.push({
        key: message.id,
        label: displayNameFor(message, userMap),
        count: total,
        detail: breakdown(byEmoji),
        excerpt: excerptOf(message),
        channelId: message.channel_id,
      });
    }
    rows.sort((a, b) => b.count - a.count || (BigInt(b.key) > BigInt(a.key) ? 1 : -1));
    return {
      rows,
      summary: emojiTotals.size ? breakdown(emojiTotals, SUMMARY_EMOJI) : undefined,
      mode: `${BESTOF_MIN_REACTIONS}+ reactions only`,
      empty: `No messages with ${BESTOF_MIN_REACTIONS}+ reactions in this feed.`,
    };
  },
};

const threads: AnalyticsReport = {
  id: 'threads',
  label: 'Threads',
  title: 'Most active threads',
  subjectLabel: 'Thread',
  valueLabel: 'Messages',
  description: 'Messages per thread or forum post among the loaded messages. Bots are left out.',
  compute(messages, { threadNames = {}, containerId }) {
    const counts = new Map<string, number>();
    const people = new Map<string, Set<string>>();
    for (const message of messages) {
      if (isBot(message) || !isPost(message)) continue;
      const channel = message.channel_id;
      if (!channel || channel === containerId) continue;
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
      if (message.author?.id) {
        const set = people.get(channel) ?? new Set<string>();
        set.add(message.author.id);
        people.set(channel, set);
      }
    }
    const rows = sortDesc(
      [...counts.entries()].map(([key, count]) => {
        const n = people.get(key)?.size ?? 0;
        return { key, label: threadNames[key] ?? t('analytics.threadFallback', { id: key }), count, detail: t('analytics.people', { count: n }), channelId: key };
      }),
    );
    return {
      rows,
      mode: 'thread messages only; the channel itself is left out',
      empty: 'No thread or forum activity in this feed. Load threads or search with threads included first.',
    };
  },
};

const keywords: AnalyticsReport = {
  id: 'keywords',
  label: 'Keywords',
  title: 'Keyword mentions',
  subjectLabel: 'Term',
  valueLabel: 'Messages',
  description: 'How many messages contain each term (case-insensitive, any part of the text). Bots are left out.',
  compute(messages, { terms = [] }) {
    if (terms.length === 0) return { rows: [], empty: 'Type one or more terms above, separated by commas.' };
    const lowered = terms.map((t) => t.toLowerCase());
    const hits = new Map<string, number>(terms.map((t) => [t, 0]));
    let messagesWithAny = 0;
    for (const message of messages) {
      if (isBot(message) || !message.content) continue;
      const text = message.content.toLowerCase();
      let any = false;
      lowered.forEach((needle, i) => {
        if (!text.includes(needle)) return;
        any = true;
        hits.set(terms[i], (hits.get(terms[i]) ?? 0) + 1);
      });
      if (any) messagesWithAny += 1;
    }
    const rows = sortDesc([...hits.entries()].map(([key, count]) => ({ key, label: key, count })));
    return {
      rows,
      mode: 'case-insensitive, any part of the text',
      summary: terms.length > 1 ? `${messagesWithAny.toLocaleString()} ${messagesWithAny === 1 ? 'message mentions' : 'messages mention'} at least one term` : undefined,
      empty: 'None of the terms appear in this feed.',
    };
  },
};

const links: AnalyticsReport = {
  id: 'links',
  label: 'Links',
  title: 'Most linked domains',
  subjectLabel: 'Domain',
  valueLabel: 'Messages',
  description: 'Which sites get linked most, one count per message per domain. Bots are left out.',
  compute(messages) {
    const domains = new Map<string, number>();
    let messagesWithLinks = 0;
    for (const message of messages) {
      if (isBot(message)) continue;
      const urls = [...(message.content?.match(URL_PATTERN) ?? []), ...(message.embeds ?? []).map((e) => e.url ?? '').filter(Boolean)];
      const seen = new Set<string>();
      for (const url of urls) {
        const domain = domainOf(url);
        if (domain) seen.add(domain);
      }
      if (seen.size === 0) continue;
      messagesWithLinks += 1;
      for (const domain of seen) domains.set(domain, (domains.get(domain) ?? 0) + 1);
    }
    const rows = sortDesc([...domains.entries()].map(([key, count]) => ({ key, label: key, count })));
    return {
      rows,
      mode: 'one count per message per domain',
      summary: messagesWithLinks ? `${plural(messagesWithLinks, 'message')} with links · ${plural(domains.size, 'domain')}` : undefined,
      empty: 'No links in this feed.',
    };
  },
};

const media: AnalyticsReport = {
  id: 'media',
  label: 'Media',
  title: 'Most attachments shared',
  subjectLabel: 'Member',
  valueLabel: 'Attachments',
  description: 'Files, images and videos shared per person. Bots are left out.',
  compute(messages, { userMap }) {
    let attachments = 0;
    let images = 0;
    let videos = 0;
    const rows = perAuthor(messages, userMap, (message) => {
      const list = message.attachments ?? [];
      for (const a of list) {
        attachments += 1;
        const kind = attachmentKind(a);
        if (kind === 'image') images += 1;
        else if (kind === 'video') videos += 1;
      }
      return list.length;
    });
    return {
      rows,
      summary: attachments
        ? `${attachments.toLocaleString()} total: ${plural(images, 'image')}, ${plural(videos, 'video')}, ${(attachments - images - videos).toLocaleString()} other`
        : undefined,
      empty: 'No attachments in this feed.',
    };
  },
};

const overview: AnalyticsReport = {
  id: 'overview',
  label: 'Overview',
  title: 'Overview',
  subjectLabel: 'Top posters',
  valueLabel: 'Messages',
  description: 'The headline numbers for the loaded messages, Wrapped-style.',
  compute(messages, context) {
    const { userMap, containerId } = context;
    const timeZone = context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayOf = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    const stats: OverviewStats = { messages: 0, people: 0, reactions: 0, attachments: 0, replies: 0, threads: 0, topEmoji: [] };
    const days = new Map<string, number>();
    const hours = Array.from({ length: 24 }, () => 0);
    const emoji = new Map<string, number>();
    const threadIds = new Set<string>();
    let best: OverviewStats['best'];

    for (const message of messages) {
      stats.messages += 1;
      if (containerId && message.channel_id && message.channel_id !== containerId) threadIds.add(message.channel_id);
      if (message.attachments?.length && !isBot(message)) stats.attachments += message.attachments.length;
      if (message.type === REPLY_MESSAGE_TYPE || (message.message_reference && (message.message_reference.type ?? 0) === 0)) stats.replies += 1;

      const at = new Date(message.timestamp);
      if (!Number.isNaN(at.getTime())) {
        const day = dayOf.format(at);
        days.set(day, (days.get(day) ?? 0) + 1);
        const hour = Number(hourOf.format(at));
        if (hour >= 0 && hour < 24) hours[hour] += 1;
      }

      let total = 0;
      for (const reaction of message.reactions ?? []) {
        if (reaction.count <= 0) continue;
        total += reaction.count;
        const tag = emojiLabel(reaction.emoji);
        emoji.set(tag, (emoji.get(tag) ?? 0) + reaction.count);
      }
      stats.reactions += total;
      if (total > 0 && (!best || total > best.total)) {
        best = { messageId: message.id, channelId: message.channel_id, author: displayNameFor(message, userMap), total, excerpt: excerptOf(message) };
      }
    }

    const rows = perAuthor(messages.filter(isPost), userMap, () => 1);
    stats.people = rows.length;
    stats.threads = threadIds.size;
    const busiest = [...days.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (busiest) stats.busiestDay = { label: busiest[0], count: busiest[1] };
    let peak: OverviewStats['peakHour'];
    hours.forEach((count, hour) => {
      if (count > 0 && (!peak || count > peak.count)) peak = { hour, count };
    });
    if (peak) stats.peakHour = peak;
    stats.topEmoji = [...emoji.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, OVERVIEW_TOP_EMOJI)
      .map(([label, count]) => ({ label, count }));
    if (best) stats.best = best;

    return { rows, stats, empty: 'Nothing is loaded yet.' };
  },
};

export const ANALYTICS_REPORTS: Record<ReportId, AnalyticsReport> = {
  mentions,
  members,
  reactions,
  bestof,
  threads,
  keywords,
  links,
  media,
  overview,
};

/** Every report, in tab order. */
export const REPORT_LIST: AnalyticsReport[] = REPORT_IDS.map((id) => ANALYTICS_REPORTS[id]);

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV for any report: subject, id, count, and the detail/excerpt columns when a row carries them. */
export function exportReportCSV(report: AnalyticsReport, rows: ReportRow[]): string {
  const hasDetail = rows.some((r) => r.detail);
  const hasExcerpt = rows.some((r) => r.excerpt);
  const header = [report.subjectLabel, 'ID', report.valueLabel, ...(hasDetail ? ['Detail'] : []), ...(hasExcerpt ? ['Message'] : [])];
  const lines = rows.map((r) =>
    [r.label, r.key, r.count, ...(hasDetail ? [r.detail ?? ''] : []), ...(hasExcerpt ? [r.excerpt ?? ''] : [])].map(csvCell).join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/** Hour label for the Overview peak hour, in the reader's locale. */
export function formatHour(hour: number): string {
  const d = new Date(Date.UTC(2000, 0, 1, hour));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(d);
}
