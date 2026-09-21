import type { OperationState } from '@features/app/operationSelectors';
import {
  SCRUBLINGS, pairActionsFor, pairKey, resolveActivity,
  type PairAction, type ScrublingEvent, type ScrublingId, type ScrublingSet,
} from './descriptors';
import { activityFrames } from './spriteRender';
import { SPRITE_W } from './spriteTypes';

/**
 * How much the 20 by 28 sprites are enlarged on a bar. It was 2 until
 * 2026-09-20: at 56 px tall the heads were clipped by a 48 px bar and the
 * caption had nowhere to go. 1.5 gives 30 by 42, which clears every bar. The
 * sprites are SVG rects, so a half step stays sharp.
 */
export const STAGE_SCALE = 1.5;
/** Rendered width of one character. */
export const CHAR_W = SPRITE_W * STAGE_SCALE;
/** Room one character needs on the bar; the stage shows floor(width / SLOT_W) of the picks. */
export const SLOT_W = 40;
export const MIN_STAGE_W = 34;
/** Two characters closer than this (centre to centre) can start a pair action. */
export const PAIR_DISTANCE = 54;
/** Pair motions are written in pixels for the old 2x size; this brings them to the current one. */
const MOTION_SCALE = STAGE_SCALE / 2;
export const PAIR_MS = 4400;
export const PAIR_COOLDOWN_MS = 2 * 60 * 1000;
/** No pair scene right after the bar appears; they settle in first. */
export const PAIR_GRACE_MS = 15 * 1000;
export const ONE_SHOT_MS = 4000;
export const TRICK_MS = 1600;
export const EQUIP_MS = 4000;
export const SWAP_MIN_MS = 10 * 60 * 1000;
export const SWAP_MAX_MS = 20 * 60 * 1000;
const WALK_PX_PER_S = 24;
const LOAD_RANGE = 48;

/** What the app is doing, reduced to what the characters react to. */
export interface OperationView {
  heavy: boolean;
  kind: 'purge' | 'load' | 'other';
  state: OperationState;
  hasFailures: boolean;
  rateLimitStopped: boolean;
}
export const IDLE_OPERATION: OperationView = { heavy: false, kind: 'other', state: 'idle', hasFailures: false, rateLimitStopped: false };

type Mode = 'idle' | 'walk' | 'event' | 'pair' | 'trick' | 'look' | 'drag' | 'equip';

export interface CharState {
  id: ScrublingId;
  /** Left edge in stage pixels; wraps around the stage width. */
  x: number;
  facing: 1 | -1;
  mode: Mode;
  /** The activity name in the rune set; resolved through the worn set at view time. */
  activity: string;
  since: number;
  until: number | null;
  target: number | null;
  set: ScrublingSet;
  lift: number;
  motion: { kind: 'slide' | 'rise'; amount: number; seconds: number; origin: number } | null;
}

export interface ActivePair { key: string; a: ScrublingId; b: ScrublingId; action: PairAction; /** The exchange picked for this meeting. */ captions: [string, string]; since: number; until: number }

export interface SchedulerState {
  width: number;
  chars: CharState[];
  event: { kind: ScrublingEvent; since: number; until: number | null } | null;
  lastOp: OperationView;
  /** A failure seen at any point during the current heavy run. */
  sawFailure: boolean;
  cooldowns: Record<string, number>;
  pairsAfter: number;
  pair: ActivePair | null;
  /** The exchange each scene showed last, so the next meeting says something else. */
  lastLines: Record<string, number>;
  nextSwapAt: number;
}

export interface SchedulerInput {
  now: number;
  width: number;
  op: OperationView;
  hover: ScrublingId | null;
  drag: { id: ScrublingId; x: number } | null;
  clicks: ScrublingId[];
  /** Animations off or reduced motion: everyone holds the first idle frame. */
  frozen: boolean;
  rng: () => number;
}

export interface CharView {
  id: ScrublingId;
  x: number;
  facing: 1 | -1;
  frame: string;
  lift: number;
  set: ScrublingSet;
}
export interface CaptionView { text: string; x: number; /** Who says it, so the stage can set the text against that character's head. */ speaker: ScrublingId }
export interface StageView { chars: CharView[]; caption: CaptionView | null }

const FRAME_MS: Record<string, number> = { idle: 600, walk: 180, run: 150, equip: 500, unequip: 500 };
const frameMs = (activity: string): number => FRAME_MS[activity] ?? 260;

const wrap = (x: number, width: number): number => (width <= 0 ? 0 : ((x % width) + width) % width);
const centre = (c: CharState): number => c.x + CHAR_W / 2;
const between = (min: number, max: number, rng: () => number): number => min + rng() * (max - min);

const makeChar = (id: ScrublingId, x: number, now: number): CharState => ({
  id, x, facing: 1, mode: 'idle', activity: SCRUBLINGS[id].idle, since: now, until: null, target: null, set: 'rune', lift: 0, motion: null,
});

/** Fresh state: the picks spread evenly, or at their dragged fractions. */
export const createScheduler = (ids: ScrublingId[], width: number, positions: Record<string, number>, now: number, rng: () => number = Math.random): SchedulerState => ({
  width,
  chars: ids.map((id, i) => makeChar(id, wrap((positions[id] ?? (i + 1) / (ids.length + 1)) * width - CHAR_W / 2, width), now)),
  event: null,
  lastOp: IDLE_OPERATION,
  sawFailure: false,
  cooldowns: {},
  pairsAfter: now + PAIR_GRACE_MS,
  pair: null,
  lastLines: {},
  nextSwapAt: now + between(SWAP_MIN_MS, SWAP_MAX_MS, rng),
});

/** Keep the roster and the width in step with the stage; existing characters keep their fraction. */
export const syncScheduler = (state: SchedulerState, ids: ScrublingId[], width: number, positions: Record<string, number>, now: number): SchedulerState => {
  const scale = state.width > 0 && width > 0 ? width / state.width : 1;
  const kept = state.chars.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, x: wrap(c.x * scale, width), target: c.target == null ? null : wrap(c.target * scale, width) }));
  const added = ids.filter((id) => !kept.some((c) => c.id === id)).map((id, i) => makeChar(id, wrap((positions[id] ?? (kept.length + i + 1) / (ids.length + 1)) * width - CHAR_W / 2, width), now));
  const chars = ids.map((id) => kept.find((c) => c.id === id) ?? added.find((c) => c.id === id)!);
  const pair = state.pair && ids.includes(state.pair.a) && ids.includes(state.pair.b) ? state.pair : null;
  return { ...state, width, chars, pair };
};

const eventFromOp = (op: OperationView): ScrublingEvent | null => {
  if (!op.heavy) return null;
  if (op.state === 'restBreak' || op.state === 'retrying') return 'wait';
  if (op.state === 'paused' || op.state === 'retryPaused') return 'paused';
  return op.kind === 'purge' ? 'purge' : 'load';
};

const setMode = (c: CharState, mode: Mode, activity: string, now: number, until: number | null = null): CharState =>
  ({ ...c, mode, activity, since: now, until, target: null, motion: null, lift: 0 });

const isFree = (c: CharState): boolean => c.mode === 'idle' || c.mode === 'walk' || c.mode === 'look';

/** One tick. Pure: the same state and input give the same result. */
export const stepScheduler = (state: SchedulerState, input: SchedulerInput): SchedulerState => {
  const { now, op, rng } = input;
  let next: SchedulerState = state.width === input.width ? state : syncScheduler(state, state.chars.map((c) => c.id), input.width, {}, now);
  const width = next.width;

  // Events follow the operation's transitions; the app has no finished or failed state of its own.
  let event = next.event;
  let sawFailure = next.sawFailure || (op.heavy && (op.hasFailures || op.state === 'retryPaused'));
  if (next.lastOp.heavy && !op.heavy) {
    const failed = sawFailure || op.rateLimitStopped || next.lastOp.state === 'retryPaused';
    event = { kind: failed ? 'failed' : 'done', since: now, until: now + ONE_SHOT_MS };
    sawFailure = false;
  } else {
    const live = eventFromOp(op);
    if (live) event = event?.kind === live ? event : { kind: live, since: now, until: null };
    else if (event && event.until != null && now < event.until) { /* the one shot plays out */ }
    else event = null;
  }
  if (!op.heavy && !event) sawFailure = false;
  next = { ...next, event, sawFailure, lastOp: op };

  if (input.frozen) {
    return { ...next, pair: null, chars: next.chars.map((c) => (c.mode === 'idle' && c.activity === SCRUBLINGS[c.id].idle ? c : setMode(c, 'idle', SCRUBLINGS[c.id].idle, now))) };
  }

  const dt = Math.max(0, Math.min(1000, now - Math.max(...next.chars.map((c) => c.since), 0))) / 1000;
  let pair = next.pair && now < next.pair.until && !event ? next.pair : null;
  const cooldowns = { ...next.cooldowns };
  let lastLines = next.lastLines ?? {};
  let nextSwapAt = next.nextSwapAt;
  const clicks = new Set(input.clicks);

  let chars: CharState[] = next.chars.map((c): CharState => {
    const d = SCRUBLINGS[c.id];
    // Dragging wins over everything and pins the character under the pointer.
    if (input.drag?.id === c.id) return { ...setMode(c, 'drag', d.idle, c.mode === 'drag' ? c.since : now), x: wrap(input.drag.x, width) };
    if (c.mode === 'drag') return setMode(c, 'idle', d.idle, now, now + between(1500, 4000, rng));
    // An app event overrides pairs, tricks and wandering.
    if (event) {
      const activity = d.events[event.kind];
      const fresh = c.mode !== 'event' || c.activity !== activity ? setMode(c, 'event', activity, now) : c;
      if (event.kind !== 'load') return { ...fresh, facing: 1 };
      // Load All and Export: back and forth over a short stretch.
      const origin = fresh.motion?.origin ?? fresh.x;
      const phase = ((now - event.since) / 1000) % 4;
      const offset = phase < 2 ? phase * (LOAD_RANGE / 2) : (4 - phase) * (LOAD_RANGE / 2);
      return { ...fresh, motion: { kind: 'slide' as const, amount: LOAD_RANGE, seconds: 2, origin }, x: wrap(origin + offset, width), facing: phase < 2 ? 1 : -1 };
    }
    if (c.mode === 'event') return setMode(c, 'idle', d.idle, now, now + between(1000, 3000, rng));
    // Equip and unequip run their course, then the set flips.
    if (c.mode === 'equip') {
      if (c.until != null && now >= c.until) return { ...setMode(c, 'idle', d.idle, now, now + between(2000, 5000, rng)), set: c.set === 'rune' ? 'dharok' : 'rune' };
      return c;
    }
    if (c.mode === 'pair') {
      if (pair && (pair.a === c.id || pair.b === c.id)) {
        const actor = pair.a === c.id ? pair.action.actors.a : pair.action.actors.b;
        const other = next.chars.find((o) => o.id === (pair!.a === c.id ? pair!.b : pair!.a));
        const facing: 1 | -1 = other && centre(other) < centre(c) ? -1 : 1;
        if (!actor.motion) return { ...c, facing };
        const origin = c.motion?.origin ?? c.x;
        const t = ((now - pair.since) / 1000) / actor.motion.seconds;
        const phase = t % 2 < 1 ? t % 1 : 1 - (t % 1);
        const amount = actor.motion.amount * MOTION_SCALE * phase;
        return actor.motion.kind === 'rise'
          ? { ...c, facing, lift: amount, motion: { ...actor.motion, origin } }
          : { ...c, facing, x: wrap(origin + amount * facing, width), motion: { ...actor.motion, origin } };
      }
      return setMode(c, 'idle', d.idle, now, now + between(1500, 4000, rng));
    }
    if (c.mode === 'trick') {
      if (c.until != null && now >= c.until) return setMode(c, 'idle', d.idle, now, now + between(1500, 4000, rng));
      return c;
    }
    if (clicks.has(c.id)) return setMode(c, 'trick', d.trick, now, now + TRICK_MS);
    if (input.hover === c.id) return c.mode === 'look' ? c : setMode(c, 'look', d.look, now);
    if (c.mode === 'look') return setMode(c, 'idle', d.idle, now, now + between(1000, 3000, rng));
    if (c.mode === 'walk' && c.target != null) {
      const step = WALK_PX_PER_S * dt;
      const dist = c.target - c.x;
      if (Math.abs(dist) <= step) return setMode({ ...c, x: wrap(c.target, width) }, 'idle', d.idle, now, now + between(2000, 6000, rng));
      return { ...c, x: wrap(c.x + Math.sign(dist) * step, width) };
    }
    // Idle: sit for a while, then pick somewhere to wander to (the stage wraps, so any direction goes).
    if (c.until == null) return { ...c, until: now + between(2000, 6000, rng) };
    if (now >= c.until) {
      const dir: 1 | -1 = rng() < 0.5 ? -1 : 1;
      const target = c.x + dir * between(40, Math.max(60, Math.min(200, width)), rng);
      return { ...c, mode: 'walk', activity: d.walk, since: now, until: null, target, facing: dir };
    }
    return c;
  });

  // Pairs: two free characters standing close, nothing running, and the pair off cooldown.
  if (!event && !pair && now >= next.pairsAfter) {
    outer: for (let i = 0; i < chars.length; i += 1) {
      for (let j = i + 1; j < chars.length; j += 1) {
        const a = chars[i]; const b = chars[j];
        if (!isFree(a) || !isFree(b)) continue;
        if (Math.abs(centre(a) - centre(b)) > PAIR_DISTANCE) continue;
        const key = pairKey(a.id, b.id);
        if ((cooldowns[key] ?? 0) > now) continue;
        const adventurer = chars.find((c) => c.id === 'adventurer');
        const options = pairActionsFor(a.id, b.id, adventurer?.set ?? 'rune');
        if (options.length === 0) continue;
        const action = options[Math.floor(rng() * options.length) % options.length];
        // Any exchange but the one this scene showed last.
        const last = lastLines[action.scene];
        const pool = action.lines.map((_, n) => n).filter((n) => action.lines.length === 1 || n !== last);
        const line = pool[Math.floor(rng() * pool.length) % pool.length];
        lastLines = { ...lastLines, [action.scene]: line };
        pair = { key, a: action.a, b: action.b, action, captions: action.lines[line], since: now, until: now + PAIR_MS };
        cooldowns[key] = now + PAIR_COOLDOWN_MS;
        chars = chars.map((c): CharState => {
          if (c.id !== action.a && c.id !== action.b) return c;
          const actor = c.id === action.a ? action.actors.a : action.actors.b;
          const other = c.id === action.a ? b.id === action.b ? b : a : a.id === action.a ? a : b;
          return { ...setMode(c, 'pair', actor.activity, now, pair!.until), facing: centre(other) < centre(c) ? -1 : 1 };
        });
        break outer;
      }
    }
  }

  // The Adventurer swaps sets every so often while nothing else is going on.
  if (!event && !pair && now >= nextSwapAt) {
    const adv = chars.find((c) => c.id === 'adventurer');
    const d = SCRUBLINGS.adventurer.dharok!;
    if (adv && isFree(adv)) {
      chars = chars.map((c): CharState => (c.id === 'adventurer' ? { ...setMode(c, 'equip', c.set === 'rune' ? d.equip : d.unequip, now, now + EQUIP_MS), facing: 1 } : c));
      nextSwapAt = now + between(SWAP_MIN_MS, SWAP_MAX_MS, rng);
    } else if (!adv) {
      nextSwapAt = now + between(SWAP_MIN_MS, SWAP_MAX_MS, rng);
    }
  }

  return { ...next, chars, pair, cooldowns, lastLines, nextSwapAt };
};

/** What to draw right now: every character's frame and place, and the one caption if any. */
export const viewScheduler = (state: SchedulerState, now: number): StageView => {
  const chars = state.chars.map((c) => {
    const d = SCRUBLINGS[c.id];
    // Pair actors in the Dharok's variant name their dh_ activity directly; everything else resolves through the set.
    const activity = c.mode === 'equip' || c.activity.startsWith('dh_') ? c.activity : resolveActivity(d, c.activity, c.set);
    const frames = activityFrames(d.sheet, activity);
    const held = c.mode === 'drag' || c.mode === 'look';
    const index = held ? 0 : Math.floor((now - c.since) / frameMs(c.activity)) % frames.length;
    const oneShot = c.mode === 'trick' || (c.mode === 'event' && (state.event?.kind === 'done' || state.event?.kind === 'failed')) || c.mode === 'equip';
    const frame = frames[oneShot ? Math.min(Math.floor((now - c.since) / frameMs(c.activity)), frames.length - 1) : index];
    return { id: c.id, x: c.x, facing: c.facing, frame, lift: c.lift, set: c.set };
  });
  let caption: CaptionView | null = null;
  const adv = state.chars.find((c) => c.id === 'adventurer');
  if (state.pair) {
    const a = state.chars.find((c) => c.id === state.pair!.a); const b = state.chars.find((c) => c.id === state.pair!.b);
    if (a && b) {
      const half = now - state.pair.since < PAIR_MS / 2 ? 0 : 1;
      // Overhead text, the way players talk in OSRS: each line floats over whoever says it.
      const firstSpeaker = state.pair.action.first === a.id ? a : b;
      const speaker = half === 0 ? firstSpeaker : firstSpeaker === a ? b : a;
      caption = { text: state.pair.captions[half], x: centre(speaker), speaker: speaker.id };
    }
  } else if (adv && adv.mode === 'equip') {
    const half = now - adv.since < EQUIP_MS * 0.75 ? 0 : 1;
    caption = { text: SCRUBLINGS.adventurer.dharok!.captions[half], x: centre(adv), speaker: adv.id };
  }
  return { chars, caption };
};
