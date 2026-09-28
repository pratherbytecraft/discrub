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

export const formatCount = (n: number): string => Math.max(0, Math.floor(n)).toLocaleString('en-US');

/** Fills every placeholder; a missing value reads as 0 or the fallback channel. */
export const fillLine = (template: string, values: { n?: number; ch?: string; s?: number; f?: number; m?: number }): string =>
  template
    .replace(/\{n\}/g, formatCount(values.n ?? 0))
    .replace(/\{f\}/g, formatCount(values.f ?? 0))
    .replace(/\{s\}/g, formatCount(values.s ?? 0))
    .replace(/\{m\}/g, formatCount(values.m ?? 0))
    .replace(/\{ch\}/g, (values.ch ?? EMPTY_LINE_CONTEXT.ch).replace(/^#/, ''));

/** The line a character says for an event right now; a rest break wait uses the shared line. */
export const lineFor = (id: ScrublingId, event: ScrublingEvent, ctx: LineContext, now: number): string => {
  const left = ctx.holdUntil == null ? 0 : Math.max(0, ctx.holdUntil - now);
  if (event === 'wait' && ctx.restBreak) return fillLine(REST_BREAK_LINE, { m: Math.max(1, Math.ceil(left / 60_000)) });
  return fillLine(LINES[id][event], { n: ctx.n, ch: ctx.ch, f: ctx.f, s: Math.ceil(left / 1000) });
};
