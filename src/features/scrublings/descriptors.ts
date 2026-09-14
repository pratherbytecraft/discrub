import type { SpriteSheet } from './spriteTypes';
import suds from './sprites/suds';
import mage from './sprites/mage';
import cat from './sprites/cat';
import dog from './sprites/dog';
import adventurer from './sprites/adventurer';
import pker from './sprites/pker';
import alien from './sprites/alien';
import ghost from './sprites/ghost';

export type ScrublingId = 'suds' | 'mage' | 'cat' | 'dog' | 'adventurer' | 'pker' | 'alien' | 'ghost';
export type ScrublingTier = 'free' | 'supporter';
/** The six app events a Scrubling answers. */
export type ScrublingEvent = 'purge' | 'load' | 'wait' | 'done' | 'failed' | 'paused';
export type ScrublingSet = 'rune' | 'dharok';

export interface ScrublingDescriptor {
  id: ScrublingId;
  tier: ScrublingTier;
  sheet: SpriteSheet;
  /** Activity names on the sheet for the everyday states. */
  idle: string;
  walk: string;
  /** Played while the pointer rests on the character. */
  look: string;
  /** Played on a click. */
  trick: string;
  events: Record<ScrublingEvent, string>;
  /**
   * The Adventurer's second set (Dharok's). Activity names in the rune set map to
   * their Dharok's version here; anything unmapped plays the rune frames.
   */
  dharok?: {
    alias: Record<string, string>;
    equip: string;
    unequip: string;
    captions: [string, string];
  };
}

export const SCRUBLING_IDS: ScrublingId[] = ['suds', 'mage', 'cat', 'dog', 'adventurer', 'pker', 'alien', 'ghost'];
export const MAX_PICKED = 3;
export const DEFAULT_PICKED: ScrublingId[] = ['suds', 'mage'];

export const SCRUBLINGS: Record<ScrublingId, ScrublingDescriptor> = {
  suds: {
    id: 'suds', tier: 'free', sheet: suds, idle: 'idle', walk: 'walk', look: 'idle', trick: 'cheer',
    events: { purge: 'scrub', load: 'carry', wait: 'sit', done: 'cheer', failed: 'puzzled', paused: 'sleep' },
  },
  mage: {
    id: 'mage', tier: 'free', sheet: mage, idle: 'idle', walk: 'walk', look: 'look', trick: 'tele',
    events: { purge: 'cast', load: 'tele', wait: 'read', done: 'levelup', failed: 'splash', paused: 'doze' },
  },
  cat: {
    id: 'cat', tier: 'supporter', sheet: cat, idle: 'idle', walk: 'walk', look: 'look', trick: 'stretch',
    events: { purge: 'bat', load: 'drag', wait: 'loaf', done: 'stretch', failed: 'knock', paused: 'sleep' },
  },
  dog: {
    id: 'dog', tier: 'supporter', sheet: dog, idle: 'idle', walk: 'walk', look: 'look', trick: 'run',
    events: { purge: 'bark', load: 'fetch', wait: 'sit', done: 'run', failed: 'sad', paused: 'sleep' },
  },
  adventurer: {
    id: 'adventurer', tier: 'supporter', sheet: adventurer, idle: 'idle', walk: 'walk', look: 'look', trick: 'levelup',
    events: { purge: 'whip', load: 'mine', wait: 'fish', done: 'levelup', failed: 'hatoff', paused: 'doze' },
    dharok: {
      alias: { idle: 'dh_idle', walk: 'dh_walk', look: 'dh_look', whip: 'dh_swing', mine: 'dh_chop', fish: 'dh_fish', levelup: 'dh_levelup', hatoff: 'dh_lowhp', doze: 'dh_doze', check: 'dh_look' },
      equip: 'equip', unequip: 'unequip', captions: ['Equipping...', 'gl hf'],
    },
  },
  pker: {
    id: 'pker', tier: 'supporter', sheet: pker, idle: 'idle', walk: 'walk', look: 'look', trick: 'ez',
    events: { purge: 'slash', load: 'run', wait: 'eat', done: 'ez', failed: 'died', paused: 'logout' },
  },
  alien: {
    id: 'alien', tier: 'supporter', sheet: alien, idle: 'idle', walk: 'walk', look: 'look', trick: 'spin',
    events: { purge: 'beam', load: 'scan', wait: 'land', done: 'spin', failed: 'sputter', paused: 'closed' },
  },
  ghost: {
    id: 'ghost', tier: 'supporter', sheet: ghost, idle: 'idle', walk: 'walk', look: 'look', trick: 'pop',
    events: { purge: 'inhale', load: 'trail', wait: 'faint', done: 'pop', failed: 'small', paused: 'still' },
  },
};

export const isScrublingId = (value: unknown): value is ScrublingId =>
  typeof value === 'string' && (SCRUBLING_IDS as string[]).includes(value);

/** Resolve an activity for the set the character is wearing. */
export const resolveActivity = (d: ScrublingDescriptor, activity: string, set: ScrublingSet): string =>
  set === 'dharok' && d.dharok ? d.dharok.alias[activity] ?? activity : activity;

export interface PairMotion { kind: 'slide' | 'rise'; amount: number; seconds: number }
export interface PairActor { activity: string; motion?: PairMotion }
/**
 * What two Scrublings do when they meet on the bar and nothing is running. `a`
 * and `b` are sorted ids; `set` marks the variant played while the Adventurer
 * wears Dharok's. The captions show one after the other above the pair.
 */
export interface PairAction {
  a: ScrublingId;
  b: ScrublingId;
  actors: { a: PairActor; b: PairActor };
  captions: [string, string];
  set?: ScrublingSet;
}

const P = (
  first: ScrublingId, second: ScrublingId,
  firstActor: PairActor, secondActor: PairActor,
  captions: [string, string], set?: ScrublingSet,
): PairAction => {
  const [a, b] = [first, second].sort() as [ScrublingId, ScrublingId];
  const actors = a === first ? { a: firstActor, b: secondActor } : { a: secondActor, b: firstActor };
  return { a, b, actors, captions, ...(set ? { set } : {}) };
};
const slide = (amount: number, seconds: number): PairMotion => ({ kind: 'slide', amount, seconds });
const rise = (amount: number, seconds: number): PairMotion => ({ kind: 'rise', amount, seconds });

/** Every pair has one; the Mage and the Adventurer have three (the mockup's 30 scenes). */
export const PAIR_ACTIONS: PairAction[] = [
  P('suds', 'cat', { activity: 'scrub' }, { activity: 'onbucket' }, ['Occupied.', 'Still occupied.']),
  P('suds', 'dog', { activity: 'wring' }, { activity: 'run', motion: slide(80, 1.6) }, ['Fetch!', 'Good dog.']),
  P('suds', 'adventurer', { activity: 'carry', motion: slide(110, 2.4) }, { activity: 'look' }, ['Trimming armor...', 'Suds has logged out.']),
  P('suds', 'alien', { activity: 'scrub' }, { activity: 'idle' }, ['Saucer wash, 5 gp', 'No refunds.']),
  P('suds', 'ghost', { activity: 'scrub' }, { activity: 'giggle' }, ['Hold still.', 'Hehe.']),
  P('cat', 'dog', { activity: 'walk', motion: slide(70, 2) }, { activity: 'run', motion: slide(70, 2) }, ['Zoom.', 'Truce.']),
  P('cat', 'adventurer', { activity: 'hatbat' }, { activity: 'hatoff' }, ['Hey!', 'Not a toy.']),
  P('cat', 'alien', { activity: 'annoyed', motion: rise(26, 1.4) }, { activity: 'lift' }, ['Abducting...', 'Returned. Unhappy.']),
  P('cat', 'ghost', { activity: 'arch' }, { activity: 'stare' }, ['...', '......']),
  P('dog', 'adventurer', { activity: 'stick', motion: slide(60, 1.8) }, { activity: 'whip' }, ['Fetch the whip!', 'Again!']),
  P('dog', 'alien', { activity: 'skyward' }, { activity: 'lift' }, ['Stick?', 'Stick...']),
  P('dog', 'ghost', { activity: 'hide' }, { activity: 'walk' }, ['Boo!', 'Whine.']),
  P('adventurer', 'alien', { activity: 'whip' }, { activity: 'walk', motion: rise(18, 1) }, ['Duel?', 'Draw.']),
  P('adventurer', 'ghost', { activity: 'check' }, { activity: 'hat', motion: rise(6, 1.2) }, ['My hat!', 'Ho ho.']),
  P('mage', 'suds', { activity: 'cast' }, { activity: 'wring' }, ['Humidify.', 'Thanks?']),
  P('mage', 'cat', { activity: 'cast' }, { activity: 'arch' }, ['Ice Barrage!', 'Cat is frozen.']),
  P('mage', 'dog', { activity: 'walk', motion: slide(60, 2) }, { activity: 'stick', motion: slide(70, 2) }, ['Give it back.', 'Good boy.']),
  P('mage', 'adventurer', { activity: 'cast' }, { activity: 'whip' }, ['Duel?', 'gf']),
  P('mage', 'adventurer', { activity: 'alch' }, { activity: 'hatoff' }, ['High Alch.', 'That was my hat.']),
  P('mage', 'adventurer', { activity: 'cast' }, { activity: 'dh_swing' }, ['1 hp.', 'Barrage.'], 'dharok'),
  P('mage', 'alien', { activity: 'tele' }, { activity: 'walk', motion: rise(20, 0.9) }, ['Tele.', "Where'd he go."]),
  P('mage', 'ghost', { activity: 'walk', motion: slide(50, 2.2) }, { activity: 'walk', motion: slide(50, 2.2) }, ['Brother?', 'Not you.']),
  P('pker', 'suds', { activity: 'skulled' }, { activity: 'scrub' }, ['Skulled.', 'Sit.']),
  P('pker', 'cat', { activity: 'noscim' }, { activity: 'drag', motion: slide(60, 2) }, ['Yoink.', 'Give it back.']),
  P('pker', 'dog', { activity: 'run', motion: slide(70, 1.8) }, { activity: 'run', motion: slide(70, 1.8) }, ['Rushed.', 'Teleport!']),
  P('pker', 'adventurer', { activity: 'slash' }, { activity: 'idle' }, ['Come to the wildy.', 'No.']),
  P('pker', 'mage', { activity: 'tb' }, { activity: 'cast' }, ['Teleblock!', 'sit']),
  P('pker', 'alien', { activity: 'noscim' }, { activity: 'lift' }, ["Where's my scim.", 'Beamed.']),
  P('pker', 'ghost', { activity: 'eat' }, { activity: 'giggle' }, ['Died to a pker?', 'Same.']),
  P('alien', 'ghost', { activity: 'wave', motion: rise(14, 2) }, { activity: 'wave', motion: rise(14, 2) }, ['beep', 'boo']),
];

export const pairKey = (x: ScrublingId, y: ScrublingId): string => [x, y].sort().join('+');

/** The pair actions for two ids, preferring the set variant when the Adventurer wears it. */
export const pairActionsFor = (x: ScrublingId, y: ScrublingId, set: ScrublingSet): PairAction[] => {
  const [a, b] = [x, y].sort();
  const all = PAIR_ACTIONS.filter((p) => p.a === a && p.b === b);
  const forSet = all.filter((p) => (p.set ?? 'rune') === set);
  return forSet.length > 0 ? forSet : all.filter((p) => !p.set);
};
