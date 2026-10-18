import type { Message, Reaction } from 'discrub-core/types/discord-types';
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
 *
 * 2.2.5 W4: each report is a fold, one message at a time, so the modal can
 * run every report in one walk over the workspace store instead of holding
 * the conversation in memory. Names are applied when a fold finishes, so a
 * finished walk takes new names from user lookups without walking again.
 */

export type UserMap = Record<string, { userName?: string; displayName?: string; nick?: string }>;

export type ReportId =
  | 'mentions'
  | 'members'
  | 'people'
  | 'reactions'
  | 'bestof'
  | 'threads'
  | 'keywords'
  | 'links'
  | 'media'
  | 'overview';

export const REPORT_IDS: ReportId[] = ['mentions', 'members', 'people', 'reactions', 'bestof', 'threads', 'keywords', 'links', 'media', 'overview'];

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
  /** mentions: leave reply messages out. */
  skipReplies?: boolean;
}

/** What a fold needs while it walks; names come in when it finishes. */
export type WalkContext = Pick<ReportContext, 'terms' | 'containerId' | 'timeZone' | 'skipReplies'>;

/** What a fold needs to finish: the names of users and threads. */
export type NameContext = Pick<ReportContext, 'userMap' | 'threadNames'>;

/** A report in progress. `finish` can be called again with new names. */
export interface ReportFold {
  step(message: Message): void;
  finish(names: NameContext): ReportResult;
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
  /** CSV heading for the detail column, when the rows carry one that is not a plain note. */
  detailLabel?: string;
  /** Short description shown under the heading. */
  description: string;
  /** A fold over messages one at a time (2.2.5 W4). */
  fold(context: WalkContext): ReportFold;
  /** The fold run over an array. */
  compute(messages: Message[], context: ReportContext): ReportResult;
}

type ReportDefinition = Omit<AnalyticsReport, 'compute'>;

const REPLY_MESSAGE_TYPE = 19;
export const BESTOF_MIN_REACTIONS = 2;
/** Best Of keeps this many messages (2.2.5 W4). */
export const BESTOF_LIMIT = 1_000;
export const MAX_KEYWORD_TERMS = 10;
export const MAX_KEYWORD_TERM_LENGTH = 100;
const SUMMARY_EMOJI = 10;
const EXCERPT_LENGTH = 80;
const OVERVIEW_TOP_EMOJI = 6;

/** Discord messages that are ordinary user posts (not joins, pins, boosts…). */
function isPost(message: Message): boolean {
  return message.type === 0 || message.type === REPLY_MESSAGE_TYPE || message.type === undefined;
}

type Author = Message['author'] | undefined;

function nameOf(author: Author, userMap: UserMap): string {
  if (!author) return 'Unknown';
  const cached = userMap[author.id];
  return cached?.nick || cached?.displayName || author.global_name || cached?.userName || author.username || author.id;
}

export function displayNameFor(message: Message, userMap: UserMap): string {
  return nameOf(message.author, userMap);
}

/** True when snowflake `a` is newer than `b`. */
function newer(a: string, b: string): boolean {
  return a.length !== b.length ? a.length > b.length : a > b;
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

/**
 * Per-author counter shared by the user-subject reports. The name comes
 * from the author's newest message, whatever order the messages arrive in.
 */
function authorTally(weigh: (message: Message) => number) {
  const counts = new Map<string, number>();
  const authors = new Map<string, { author: Author; at: string }>();
  return {
    step(message: Message): void {
      const author = message.author;
      if (!author?.id || isBot(message)) return;
      const weight = weigh(message);
      if (weight <= 0) return;
      counts.set(author.id, (counts.get(author.id) ?? 0) + weight);
      const held = authors.get(author.id);
      if (!held || newer(message.id, held.at)) authors.set(author.id, { author, at: message.id });
    },
    rows(userMap: UserMap): ReportRow[] {
      return sortDesc([...counts.entries()].map(([key, count]) => ({ key, label: nameOf(authors.get(key)?.author, userMap), count })));
    },
  };
}

function reactionTotal(message: Message): number {
  return (message.reactions ?? []).reduce((sum, r) => sum + (r.count > 0 ? r.count : 0), 0);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const MENTION_PATTERN = /<@!?(\d+)>/g;
const CODE_PATTERN = /```[\s\S]*?```|`[^`]+`/g;

const mentions: ReportDefinition = {
  id: 'mentions',
  label: 'Mentions',
  title: 'Most mentioned',
  subjectLabel: 'Username',
  valueLabel: 'Mentions',
  description: 'Who gets @mentioned most in the loaded messages.',
  fold({ skipReplies = false }) {
    const counts = new Map<string, number>();
    // Row 162 of the 2.2.5 pass: each message carries the mentioned users, so
    // a name is known even when the user is not in the lookup cache.
    const mentioned = new Map<string, Message['author']>();
    return {
      step(message) {
        if (!message.content || (skipReplies && message.type === REPLY_MESSAGE_TYPE)) return;
        // Code blocks are left out of the count.
        const text = message.content.replace(CODE_PATTERN, '');
        for (const match of text.matchAll(MENTION_PATTERN)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
        for (const user of message.mentions ?? []) if (!mentioned.has(user.id)) mentioned.set(user.id, user);
      },
      finish({ userMap }) {
        const rows = [...counts.entries()].map(([key, count]) => {
          const user = mentioned.get(key) ?? ({ id: key } as Message['author']);
          return { key, label: nameOf(user, userMap), count };
        });
        return { rows: sortDesc(rows), empty: 'No mentions found' };
      },
    };
  },
};

const members: ReportDefinition = {
  id: 'members',
  label: 'Members',
  title: 'Most active members',
  subjectLabel: 'Member',
  valueLabel: 'Messages',
  description: 'Messages sent per person. Bots are left out.',
  fold() {
    const tally = authorTally(() => 1);
    return {
      step(message) {
        if (isPost(message)) tally.step(message);
      },
      finish({ userMap }) {
        return { rows: tally.rows(userMap), empty: 'No messages from people in this feed.' };
      },
    };
  },
};

/**
 * Everyone seen in the feed, bots included, with the username next to the
 * display name so the CSV is a people list (author-list-export, 2.2.6).
 */
const people: ReportDefinition = {
  id: 'people',
  label: 'Users',
  title: 'Everyone who posted',
  subjectLabel: 'User',
  valueLabel: 'Messages',
  detailLabel: 'Username',
  description: 'Every user seen in this feed with their username and ID. Bots included.',
  fold() {
    const counts = new Map<string, number>();
    const authors = new Map<string, { author: Author; at: string; bot: boolean }>();
    return {
      step(message) {
        const author = message.author;
        if (!author?.id) return;
        counts.set(author.id, (counts.get(author.id) ?? 0) + 1);
        const held = authors.get(author.id);
        if (!held || newer(message.id, held.at)) authors.set(author.id, { author, at: message.id, bot: isBot(message) });
      },
      finish({ userMap }) {
        const rows = sortDesc([...counts.entries()].map(([key, count]) => {
          const held = authors.get(key);
          const username = held?.author?.username || userMap[key]?.userName || key;
          return { key, label: nameOf(held?.author, userMap), count, detail: held?.bot ? `@${username} · bot` : `@${username}` };
        }));
        return { rows, empty: 'No messages in this feed.' };
      },
    };
  },
};

const reactions: ReportDefinition = {
  id: 'reactions',
  label: 'Reactions',
  title: 'Most reactions received',
  subjectLabel: 'Member',
  valueLabel: 'Reactions',
  description: 'Every reaction on a message counts for its author. Bots are left out.',
  fold() {
    const tally = authorTally(reactionTotal);
    return {
      step: tally.step,
      finish({ userMap }) {
        const rows = tally.rows(userMap);
        const total = rows.reduce((sum, r) => sum + r.count, 0);
        return { rows, summary: total ? `${plural(total, 'reaction')} on ${plural(rows.length, 'person', 'people')}'s messages` : undefined, empty: 'No reactions in this feed.' };
      },
    };
  },
};

interface BestCandidate {
  id: string;
  author: Author;
  count: number;
  detail: string;
  excerpt: string;
  channelId: string;
}

const byReactionsThenNewest = (a: BestCandidate, b: BestCandidate): number => b.count - a.count || (newer(b.id, a.id) ? 1 : -1);

const bestof: ReportDefinition = {
  id: 'bestof',
  label: 'Best Of',
  title: 'Most reacted messages',
  subjectLabel: 'Message',
  valueLabel: 'Reactions',
  description: `Messages with ${BESTOF_MIN_REACTIONS}+ reactions, with the per-emoji breakdown.`,
  fold() {
    const emojiTotals = new Map<string, number>();
    let kept: BestCandidate[] = [];
    let dropped = false;
    // Held to the top BESTOF_LIMIT, trimmed whenever the list doubles.
    const trim = () => {
      kept.sort(byReactionsThenNewest);
      if (kept.length > BESTOF_LIMIT) {
        kept = kept.slice(0, BESTOF_LIMIT);
        dropped = true;
      }
    };
    return {
      step(message) {
        const live = (message.reactions ?? []).filter((r) => r.count > 0);
        if (live.length === 0) return;
        const byEmoji = new Map<string, number>();
        let total = 0;
        for (const reaction of live) {
          const tag = emojiLabel(reaction.emoji);
          total += reaction.count;
          byEmoji.set(tag, (byEmoji.get(tag) ?? 0) + reaction.count);
          emojiTotals.set(tag, (emojiTotals.get(tag) ?? 0) + reaction.count);
        }
        if (total < BESTOF_MIN_REACTIONS) return;
        kept.push({ id: message.id, author: message.author, count: total, detail: breakdown(byEmoji), excerpt: excerptOf(message), channelId: message.channel_id });
        if (kept.length >= BESTOF_LIMIT * 2) trim();
      },
      finish({ userMap }) {
        trim();
        const rows: ReportRow[] = kept.map((c) => ({ key: c.id, label: nameOf(c.author, userMap), count: c.count, detail: c.detail, excerpt: c.excerpt, channelId: c.channelId }));
        return {
          rows,
          summary: emojiTotals.size ? breakdown(emojiTotals, SUMMARY_EMOJI) : undefined,
          mode: dropped ? `${BESTOF_MIN_REACTIONS}+ reactions only, the top ${BESTOF_LIMIT.toLocaleString()}` : `${BESTOF_MIN_REACTIONS}+ reactions only`,
          empty: `No messages with ${BESTOF_MIN_REACTIONS}+ reactions in this feed.`,
        };
      },
    };
  },
};

const threads: ReportDefinition = {
  id: 'threads',
  label: 'Threads',
  title: 'Most active threads',
  subjectLabel: 'Thread',
  valueLabel: 'Messages',
  description: 'Messages per thread or forum post among the loaded messages. Bots are left out.',
  fold({ containerId }) {
    const counts = new Map<string, number>();
    const people = new Map<string, Set<string>>();
    return {
      step(message) {
        if (isBot(message) || !isPost(message)) return;
        const channel = message.channel_id;
        if (!channel || channel === containerId) return;
        counts.set(channel, (counts.get(channel) ?? 0) + 1);
        if (message.author?.id) {
          const set = people.get(channel) ?? new Set<string>();
          set.add(message.author.id);
          people.set(channel, set);
        }
      },
      finish({ threadNames = {} }) {
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
  },
};

const keywords: ReportDefinition = {
  id: 'keywords',
  label: 'Keywords',
  title: 'Keyword mentions',
  subjectLabel: 'Term',
  valueLabel: 'Messages',
  description: 'How many messages contain each term (case-insensitive, any part of the text). Bots are left out.',
  fold({ terms = [] }) {
    const lowered = terms.map((term) => term.toLowerCase());
    const hits = new Map<string, number>(terms.map((term) => [term, 0]));
    let messagesWithAny = 0;
    return {
      step(message) {
        if (terms.length === 0 || isBot(message) || !message.content) return;
        const text = message.content.toLowerCase();
        let any = false;
        lowered.forEach((needle, i) => {
          if (!text.includes(needle)) return;
          any = true;
          hits.set(terms[i], (hits.get(terms[i]) ?? 0) + 1);
        });
        if (any) messagesWithAny += 1;
      },
      finish() {
        if (terms.length === 0) return { rows: [], empty: 'Type one or more terms above, separated by commas.' };
        const rows = sortDesc([...hits.entries()].map(([key, count]) => ({ key, label: key, count })));
        return {
          rows,
          mode: 'case-insensitive, any part of the text',
          summary: terms.length > 1 ? `${messagesWithAny.toLocaleString()} ${messagesWithAny === 1 ? 'message mentions' : 'messages mention'} at least one term` : undefined,
          empty: 'None of the terms appear in this feed.',
        };
      },
    };
  },
};

const links: ReportDefinition = {
  id: 'links',
  label: 'Links',
  title: 'Most linked domains',
  subjectLabel: 'Domain',
  valueLabel: 'Messages',
  description: 'Which sites get linked most, one count per message per domain. Bots are left out.',
  fold() {
    const domains = new Map<string, number>();
    let messagesWithLinks = 0;
    return {
      step(message) {
        if (isBot(message)) return;
        const urls = [...(message.content?.match(URL_PATTERN) ?? []), ...(message.embeds ?? []).map((e) => e.url ?? '').filter(Boolean)];
        const seen = new Set<string>();
        for (const url of urls) {
          const domain = domainOf(url);
          if (domain) seen.add(domain);
        }
        if (seen.size === 0) return;
        messagesWithLinks += 1;
        for (const domain of seen) domains.set(domain, (domains.get(domain) ?? 0) + 1);
      },
      finish() {
        const rows = sortDesc([...domains.entries()].map(([key, count]) => ({ key, label: key, count })));
        return {
          rows,
          mode: 'one count per message per domain',
          summary: messagesWithLinks ? `${plural(messagesWithLinks, 'message')} with links · ${plural(domains.size, 'domain')}` : undefined,
          empty: 'No links in this feed.',
        };
      },
    };
  },
};

const media: ReportDefinition = {
  id: 'media',
  label: 'Media',
  title: 'Most attachments shared',
  subjectLabel: 'Member',
  valueLabel: 'Attachments',
  description: 'Files, images and videos shared per person. Bots are left out.',
  fold() {
    let attachments = 0;
    let images = 0;
    let videos = 0;
    const tally = authorTally((message) => {
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
      step: tally.step,
      finish({ userMap }) {
        return {
          rows: tally.rows(userMap),
          summary: attachments
            ? `${attachments.toLocaleString()} total: ${plural(images, 'image')}, ${plural(videos, 'video')}, ${(attachments - images - videos).toLocaleString()} other`
            : undefined,
          empty: 'No attachments in this feed.',
        };
      },
    };
  },
};

const overview: ReportDefinition = {
  id: 'overview',
  label: 'Overview',
  title: 'Overview',
  subjectLabel: 'Top posters',
  valueLabel: 'Messages',
  description: 'The headline numbers for the loaded messages, Wrapped-style.',
  fold(context) {
    const { containerId } = context;
    const timeZone = context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayOf = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    let messages = 0;
    let reactionCount = 0;
    let attachments = 0;
    let replies = 0;
    const days = new Map<string, number>();
    const hours = Array.from({ length: 24 }, () => 0);
    const emoji = new Map<string, number>();
    const threadIds = new Set<string>();
    const posters = authorTally(() => 1);
    let best: (Omit<NonNullable<OverviewStats['best']>, 'author'> & { author: Author }) | undefined;

    return {
      step(message) {
        messages += 1;
        if (isPost(message)) posters.step(message);
        if (containerId && message.channel_id && message.channel_id !== containerId) threadIds.add(message.channel_id);
        if (message.attachments?.length && !isBot(message)) attachments += message.attachments.length;
        if (message.type === REPLY_MESSAGE_TYPE || (message.message_reference && (message.message_reference.type ?? 0) === 0)) replies += 1;

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
        reactionCount += total;
        // A tie goes to the newer message, whatever order the walk runs in.
        if (total > 0 && (!best || total > best.total || (total === best.total && newer(message.id, best.messageId)))) {
          best = { messageId: message.id, channelId: message.channel_id, author: message.author, total, excerpt: excerptOf(message) };
        }
      },
      finish({ userMap }) {
        const rows = posters.rows(userMap);
        const stats: OverviewStats = { messages, people: rows.length, reactions: reactionCount, attachments, replies, threads: threadIds.size, topEmoji: [] };
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
        if (best) stats.best = { ...best, author: nameOf(best.author, userMap) };
        return { rows, stats, empty: 'Nothing is loaded yet.' };
      },
    };
  },
};

function withCompute(definition: ReportDefinition): AnalyticsReport {
  return {
    ...definition,
    compute(messages, context) {
      const fold = definition.fold(context);
      for (const message of messages) fold.step(message);
      return fold.finish(context);
    },
  };
}

export const ANALYTICS_REPORTS: Record<ReportId, AnalyticsReport> = {
  mentions: withCompute(mentions),
  members: withCompute(members),
  people: withCompute(people),
  reactions: withCompute(reactions),
  bestof: withCompute(bestof),
  threads: withCompute(threads),
  keywords: withCompute(keywords),
  links: withCompute(links),
  media: withCompute(media),
  overview: withCompute(overview),
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
  const header = [report.subjectLabel, 'ID', report.valueLabel, ...(hasDetail ? [report.detailLabel ?? 'Detail'] : []), ...(hasExcerpt ? ['Message'] : [])];
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
