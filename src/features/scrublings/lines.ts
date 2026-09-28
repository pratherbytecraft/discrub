import type { ScrublingEvent, ScrublingId } from './descriptors';

/**
 * 2.2.1: what a Scrubling says about the app's own events, one line per
 * character per event, from the round two page. Placeholders: {n} the count
 * so far, {ch} the channel, {s} the seconds Discord asked for, {f} the failed
 * count, {m} minutes left on a rest break. English only, like the pair
 * lines. Lines never contain instructions.
 */
export interface LineContext {
  /** Messages handled so far in this run. */
  n: number;
  /** The channel or conversation the run is in. */
  ch: string;
  /** Failed so far in this run. */
  f: number;
  /** When the current hold ends (retry wait or rest break), or null. */
  holdUntil: number | null;
  /** True while the hold is a rest break, which has its own shared line. */
  restBreak: boolean;
}

export const EMPTY_LINE_CONTEXT: LineContext = { n: 0, ch: 'chat', f: 0, holdUntil: null, restBreak: false };

export const LINES: Record<ScrublingId, Record<ScrublingEvent, string>> = {
  suds: { purge: '{n} scrubbed in #{ch}', load: 'Hauling #{ch}, {n} so far', wait: 'Coffee. Discord says wait {s}s', done: '#{ch} is clean.', failed: "Stopped. {f} wouldn't come off.", paused: 'Zzz.' },
  mage: { purge: '{n} alched in #{ch}', load: 'Teleporting {n} in from #{ch}', wait: 'Reading up. {s}s.', done: 'Spell complete. {n} gone.', failed: 'Splash. {f} resisted.', paused: 'Napping on the staff.' },
  cat: { purge: '{n} knocked off the table', load: 'Dragged {n} home from #{ch}', wait: 'Loaf. {s}s.', done: '#{ch}, {n} gone. Mrow.', failed: "Wasn't me. {f} left.", paused: 'zzz' },
  dog: { purge: '{n} fetched from #{ch}', load: 'Fetching #{ch}, {n} so far', wait: 'Sit. {s}s.', done: 'Good boy. {n} gone.', failed: 'Whine. {f} left.', paused: 'Sleeping.' },
  adventurer: { purge: '{n} xp in #{ch}', load: 'Mining #{ch}, {n} so far', wait: 'Fishing. {s}s.', done: 'Level up. {n} gone.', failed: 'Stopped. {f} would not delete.', paused: 'AFK.' },
  pker: { purge: '{n} kills in #{ch}', load: 'Running #{ch}, {n} so far', wait: 'Eating. {s}s.', done: 'ez. {n} gone.', failed: 'Died. {f} left.', paused: 'Paused. Logging out.' },
  alien: { purge: '{n} beamed up from #{ch}', load: 'Scanning #{ch}, {n} so far', wait: 'Landed. {s}s.', done: 'Beep. {n} gone.', failed: 'Sputter. {f} missed.', paused: 'Hatch closed.' },
  ghost: { purge: '{n} eaten in #{ch}', load: 'Trailing #{ch}, {n} so far', wait: 'Fading. {s}s.', done: 'Boo. {n} gone.', failed: 'Small now. {f} left.', paused: 'Still.' },
};

/** Shared by everyone during a rest break. */
export const REST_BREAK_LINE = 'Rest break. Back in {m} min.';

/**
 * The short lines (2.2.2). A window narrower than SHORT_LINE_MAX_W gets these,
 * because the stage on a phone is narrower than a full line. They drop the
 * channel and keep the number. Same order and placeholders as LINES, less {ch}.
 */
export const SHORT_LINES: Record<ScrublingId, Record<ScrublingEvent, string>> = {
  suds: { purge: '{n} scrubbed', load: '{n} hauled', wait: 'Coffee. {s}s', done: 'Clean.', failed: '{f} stuck.', paused: 'Zzz.' },
  mage: { purge: '{n} alched', load: '{n} ported in', wait: 'Reading. {s}s', done: '{n} gone.', failed: 'Splash. {f}', paused: 'Napping.' },
  cat: { purge: '{n} knocked', load: '{n} dragged', wait: 'Loaf. {s}s', done: 'Mrow. {n}', failed: '{f} left.', paused: 'zzz' },
  dog: { purge: '{n} fetched', load: 'Fetching {n}', wait: 'Sit. {s}s', done: '{n} gone.', failed: '{f} left.', paused: 'Asleep.' },
  adventurer: { purge: '{n} xp', load: 'Mining {n}', wait: 'Fishing. {s}s', done: 'Level up.', failed: '{f} left.', paused: 'AFK.' },
  pker: { purge: '{n} kills', load: 'Running {n}', wait: 'Eating. {s}s', done: 'ez. {n}', failed: 'Died. {f}', paused: 'Logged out.' },
  alien: { purge: '{n} beamed', load: 'Scanning {n}', wait: 'Landed. {s}s', done: 'Beep. {n}', failed: '{f} missed.', paused: 'Hatch shut.' },
  ghost: { purge: '{n} eaten', load: 'Trailing {n}', wait: 'Fading. {s}s', done: 'Boo. {n}', failed: '{f} left.', paused: 'Still.' },
};

/** The short rest break line (2.2.2). */
export const SHORT_REST_BREAK_LINE = 'Break. {m} min';

/** A window narrower than this many pixels gets the short lines (2.2.2). */
export const SHORT_LINE_MAX_W = 600;

/** A channel name longer than this is cut with an ellipsis so the line stays short enough for a narrow bar. */
export const CHANNEL_MAX = 18;
const shortChannel = (ch: string): string => { const chars = Array.from(ch.replace(/^#/, '')); return chars.length > CHANNEL_MAX ? `${chars.slice(0, CHANNEL_MAX - 1).join('')}…` : chars.join(''); };

export const formatCount = (n: number): string => Math.max(0, Math.floor(n)).toLocaleString('en-US');

/** Fills every placeholder; a missing value reads as 0 or the fallback channel. */
export const fillLine = (template: string, values: { n?: number; ch?: string; s?: number; f?: number; m?: number }): string =>
  template
    .replace(/\{n\}/g, formatCount(values.n ?? 0))
    .replace(/\{f\}/g, formatCount(values.f ?? 0))
    .replace(/\{s\}/g, formatCount(values.s ?? 0))
    .replace(/\{m\}/g, formatCount(values.m ?? 0))
    .replace(/\{ch\}/g, shortChannel(values.ch ?? EMPTY_LINE_CONTEXT.ch));

/** The line a character says for an event right now; a rest break wait uses the shared line. `short` picks the short lines (2.2.2). */
export const lineFor = (id: ScrublingId, event: ScrublingEvent, ctx: LineContext, now: number, short = false): string => {
  const left = ctx.holdUntil == null ? 0 : Math.max(0, ctx.holdUntil - now);
  if (event === 'wait' && ctx.restBreak) return fillLine(short ? SHORT_REST_BREAK_LINE : REST_BREAK_LINE, { m: Math.max(1, Math.ceil(left / 60_000)) });
  return fillLine((short ? SHORT_LINES : LINES)[id][event], { n: ctx.n, ch: ctx.ch, f: ctx.f, s: Math.ceil(left / 1000) });
};
