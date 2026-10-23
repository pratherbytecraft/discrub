import type { SpriteSheet } from './spriteTypes';
import suds from './sprites/suds';
import mage from './sprites/mage';
import cat from './sprites/cat';
import dog from './sprites/dog';
import adventurer from './sprites/adventurer';
import pker from './sprites/pker';
import alien from './sprites/alien';
import ghost from './sprites/ghost';
import spider from './sprites/spider';
import elf from './sprites/elf';
import snowman from './sprites/snowman';
import reindeer from './sprites/reindeer';
import gingerbread from './sprites/gingerbread';
import { EXTRA_LINES, type Exchange } from './pairLines';
import { christmas, halloween, type ItemGroup, type Season } from '@features/appearance/groups';

export type ScrublingId = 'suds' | 'mage' | 'cat' | 'dog' | 'adventurer' | 'pker' | 'alien' | 'ghost' | 'spider' | 'elf' | 'snowman' | 'reindeer' | 'gingerbread';
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
  /** Who commissioned a custom Scrubling. Shown as "Designed by" on its card (owner, 2026-09-21). None of the first eight has one. */
  designedBy?: string;
  /** Where the picker lists it (2.2.3). Missing means Standard; a commissioned one belongs in Commissioned. */
  group?: ItemGroup;
  /** A holiday Scrubling is free for everyone inside its season, then supporter only. */
  season?: Season;
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

export const SCRUBLING_IDS: ScrublingId[] = ['suds', 'mage', 'cat', 'dog', 'adventurer', 'pker', 'alien', 'ghost', 'spider', 'elf', 'snowman', 'reindeer', 'gingerbread'];
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
    id: 'cat', tier: 'free', sheet: cat, idle: 'idle', walk: 'walk', look: 'look', trick: 'stretch',
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
  // Spider '26: the Halloween Scrubling (2.2.3). Free for everyone through its season, supporter only after.
  spider: {
    id: 'spider', tier: 'supporter', group: 'holiday', season: halloween(2026), sheet: spider, idle: 'idle', walk: 'walk', look: 'look', trick: 'boo',
    events: { purge: 'wrap', load: 'spin', wait: 'hang', done: 'dangle', failed: 'tangled', paused: 'sleep' },
  },
  // Christmas '26 (2.2.7): four holiday Scrublings, free for everyone December 1 to January 4, supporter only after.
  elf: {
    id: 'elf', tier: 'supporter', group: 'holiday', season: christmas(2026), sheet: elf, idle: 'idle', walk: 'walk', look: 'look', trick: 'jingle',
    events: { purge: 'stamp', load: 'wrap', wait: 'list', done: 'cheer', failed: 'drop', paused: 'nap' },
  },
  snowman: {
    id: 'snowman', tier: 'supporter', group: 'holiday', season: christmas(2026), sheet: snowman, idle: 'idle', walk: 'walk', look: 'look', trick: 'tip',
    events: { purge: 'shovel', load: 'roll', wait: 'melt', done: 'star', failed: 'puddle', paused: 'sleep' },
  },
  reindeer: {
    id: 'reindeer', tier: 'supporter', group: 'holiday', season: christmas(2026), sheet: reindeer, idle: 'idle', walk: 'walk', look: 'look', trick: 'glow',
    events: { purge: 'stomp', load: 'haul', wait: 'graze', done: 'fly', failed: 'tangled', paused: 'sleep' },
  },
  gingerbread: {
    id: 'gingerbread', tier: 'supporter', group: 'holiday', season: christmas(2026), sheet: gingerbread, idle: 'idle', walk: 'walk', look: 'look', trick: 'dance',
    events: { purge: 'bite', load: 'frost', wait: 'cool', done: 'frosted', failed: 'crumbs', paused: 'rest' },
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
 * wears Dharok's. The first character written says the first line and the
 * other answers; each line shows over its speaker's head.
 */
export interface PairAction {
  /** `first+second:firstActivity/secondActivity` as written below; the key into EXTRA_LINES. */
  scene: string;
  /** Who says the first line; the other one answers. */
  first: ScrublingId;
  a: ScrublingId;
  b: ScrublingId;
  actors: { a: PairActor; b: PairActor };
  /** The scene's original exchange. */
  captions: [string, string];
  /** Every exchange the scene can show: the original first, then the extras. One is picked per meeting. */
  lines: Exchange[];
  set?: ScrublingSet;
}

const P = (
  first: ScrublingId, second: ScrublingId,
  firstActor: PairActor, secondActor: PairActor,
  captions: [string, string], set?: ScrublingSet,
): PairAction => {
  const [a, b] = [first, second].sort() as [ScrublingId, ScrublingId];
  const actors = a === first ? { a: firstActor, b: secondActor } : { a: secondActor, b: firstActor };
  const scene = `${first}+${second}:${firstActor.activity}/${secondActor.activity}`;
  return { scene, first, a, b, actors, captions, lines: [captions, ...(EXTRA_LINES[scene] ?? [])], ...(set ? { set } : {}) };
};
const slide = (amount: number, seconds: number): PairMotion => ({ kind: 'slide', amount, seconds });
const rise = (amount: number, seconds: number): PairMotion => ({ kind: 'rise', amount, seconds });

/** Every pair has one; the Mage and the Adventurer have three (the mockup's 30 scenes). */
export const PAIR_ACTIONS: PairAction[] = [
  P('suds', 'cat', { activity: 'scrub' }, { activity: 'onbucket' }, ['Bucket, please.', 'Occupied.']),
  P('suds', 'dog', { activity: 'wring' }, { activity: 'run', motion: slide(80, 1.6) }, ['Fetch!', 'Woof!']),
  P('suds', 'adventurer', { activity: 'carry', motion: slide(110, 2.4) }, { activity: 'look' }, ['Trimming armor...', 'He logged out.']),
  P('suds', 'alien', { activity: 'scrub' }, { activity: 'idle' }, ['Saucer wash, 5 gp.', 'What is gp.']),
  P('suds', 'ghost', { activity: 'scrub' }, { activity: 'giggle' }, ['Hold still.', 'Hehe.']),
  P('cat', 'dog', { activity: 'walk', motion: slide(70, 2) }, { activity: 'run', motion: slide(70, 2) }, ['Zoom.', 'Truce.']),
  P('cat', 'adventurer', { activity: 'hatbat' }, { activity: 'hatoff' }, ['Bap.', 'Hey! Not a toy.']),
  P('cat', 'alien', { activity: 'annoyed', motion: rise(26, 1.4) }, { activity: 'lift' }, ['Mrow?!', 'Abducting...']),
  P('cat', 'ghost', { activity: 'arch' }, { activity: 'stare' }, ['...', '......']),
  P('dog', 'adventurer', { activity: 'stick', motion: slide(60, 1.8) }, { activity: 'whip' }, ['Again! Again!', 'Fetch the whip!']),
  P('dog', 'alien', { activity: 'skyward' }, { activity: 'lift' }, ['Stick?', 'Stick...']),
  P('dog', 'ghost', { activity: 'hide' }, { activity: 'walk' }, ['Whine.', 'Boo!']),
  P('adventurer', 'alien', { activity: 'whip' }, { activity: 'walk', motion: rise(18, 1) }, ['Duel?', 'Draw.']),
  P('adventurer', 'ghost', { activity: 'check' }, { activity: 'hat', motion: rise(6, 1.2) }, ['My hat!', 'Ho ho.']),
  P('mage', 'suds', { activity: 'cast' }, { activity: 'wring' }, ['Humidify.', 'Thanks?']),
  P('mage', 'cat', { activity: 'cast' }, { activity: 'arch' }, ['Ice Barrage!', 'Mrow. Cold.']),
  P('mage', 'dog', { activity: 'walk', motion: slide(60, 2) }, { activity: 'stick', motion: slide(70, 2) }, ['Give it back.', 'Woof. No.']),
  P('mage', 'adventurer', { activity: 'cast' }, { activity: 'whip' }, ['Duel?', 'gf']),
  P('mage', 'adventurer', { activity: 'alch' }, { activity: 'hatoff' }, ['High Alch.', 'That was my hat.']),
  P('mage', 'adventurer', { activity: 'cast' }, { activity: 'dh_swing' }, ['Barrage.', '1 hp. Perfect.'], 'dharok'),
  P('mage', 'alien', { activity: 'tele' }, { activity: 'walk', motion: rise(20, 0.9) }, ['Tele.', "Where'd he go."]),
  P('mage', 'ghost', { activity: 'walk', motion: slide(50, 2.2) }, { activity: 'walk', motion: slide(50, 2.2) }, ['Brother?', 'Not you.']),
  P('pker', 'suds', { activity: 'skulled' }, { activity: 'scrub' }, ['Skulled.', 'Sit.']),
  P('pker', 'cat', { activity: 'noscim' }, { activity: 'drag', motion: slide(60, 2) }, ['Give it back.', 'Yoink.']),
  P('pker', 'dog', { activity: 'run', motion: slide(70, 1.8) }, { activity: 'run', motion: slide(70, 1.8) }, ['Rushed.', 'Teleport!']),
  P('pker', 'adventurer', { activity: 'slash' }, { activity: 'idle' }, ['Come to the wildy.', 'No.']),
  P('pker', 'mage', { activity: 'tb' }, { activity: 'cast' }, ['Teleblock!', 'sit']),
  P('pker', 'alien', { activity: 'noscim' }, { activity: 'lift' }, ["Where's my scim.", 'Beamed.']),
  P('pker', 'ghost', { activity: 'eat' }, { activity: 'giggle' }, ['Died to a pker?', 'Same.']),
  P('alien', 'ghost', { activity: 'wave', motion: rise(14, 2) }, { activity: 'wave', motion: rise(14, 2) }, ['beep', 'boo']),
  // Spider '26 (2.2.3): one scene with each of the eight.
  P('suds', 'spider', { activity: 'scrub' }, { activity: 'boo' }, ['Cobwebs. Out.', 'Hey. I live there.']),
  P('mage', 'spider', { activity: 'cast' }, { activity: 'dangle' }, ['Levitate.', 'I do that already.']),
  P('cat', 'spider', { activity: 'bat' }, { activity: 'dangle' }, ['Bap.', 'Rude.']),
  P('dog', 'spider', { activity: 'hide' }, { activity: 'walk', motion: slide(40, 2) }, ['Whine.', 'Eight legs, zero bark.']),
  P('adventurer', 'spider', { activity: 'check' }, { activity: 'spin' }, ['Giant spider?', 'Regular sized.']),
  P('pker', 'spider', { activity: 'eat' }, { activity: 'tangled' }, ['Spider on a stick?', 'No.']),
  P('alien', 'spider', { activity: 'lift' }, { activity: 'hang' }, ['Specimen.', 'Put me down.']),
  P('ghost', 'spider', { activity: 'wave', motion: rise(10, 1.5) }, { activity: 'boo' }, ['Boo.', 'Boo yourself.']),
  // Christmas '26 (2.2.7): one scene for each of the four with everyone, including each other.
  P('elf', 'suds', { activity: 'stamp' }, { activity: 'scrub' }, ['Stamped.', 'Scrubbed.']),
  P('mage', 'elf', { activity: 'cast' }, { activity: 'wrap' }, ['Snap. Wrapped.', 'I had a system.']),
  P('cat', 'elf', { activity: 'bat' }, { activity: 'wrap' }, ['Ribbon!', 'Not for you.']),
  P('dog', 'elf', { activity: 'fetch', motion: slide(50, 1.8) }, { activity: 'drop' }, ['Got it!', 'Oops.']),
  P('adventurer', 'elf', { activity: 'check' }, { activity: 'stamp' }, ['Finders keepers.', 'That hat is ours.']),
  P('pker', 'elf', { activity: 'skulled' }, { activity: 'list' }, ['Worth it.', 'Naughty list.']),
  P('alien', 'elf', { activity: 'lift' }, { activity: 'jingle' }, ['Small one. Bells.', 'Put me down.']),
  P('ghost', 'elf', { activity: 'wave', motion: rise(10, 1.5) }, { activity: 'cheer' }, ['Christmas past.', 'Christmas present.']),
  P('spider', 'elf', { activity: 'dangle' }, { activity: 'look' }, ['Web is warm.', 'Still here?']),
  P('suds', 'snowman', { activity: 'scrub' }, { activity: 'melt' }, ['Hold still.', 'Warm water. No.']),
  P('mage', 'snowman', { activity: 'cast' }, { activity: 'star' }, ['Ice Barrage!', 'Finally. Cold.']),
  P('cat', 'snowman', { activity: 'bat' }, { activity: 'tip' }, ['Carrot!', 'My nose.']),
  P('dog', 'snowman', { activity: 'skyward' }, { activity: 'shovel' }, ['Stick arm!', 'Not a stick.']),
  P('adventurer', 'snowman', { activity: 'mine' }, { activity: 'roll' }, ['Snow rocks?', 'Snowballs.']),
  P('pker', 'snowman', { activity: 'slash' }, { activity: 'puddle' }, ['ez', 'That was my head.']),
  P('alien', 'snowman', { activity: 'scan' }, { activity: 'melt' }, ['Water based.', 'Mostly.']),
  P('ghost', 'snowman', { activity: 'wave', motion: rise(10, 1.5) }, { activity: 'look' }, ['Cold in here.', 'Thanks.']),
  P('spider', 'snowman', { activity: 'hang' }, { activity: 'melt' }, ['Web is cold.', 'Web is wet.']),
  P('suds', 'reindeer', { activity: 'carry', motion: slide(60, 2) }, { activity: 'haul', motion: slide(60, 2) }, ['Heavy.', 'Get a sleigh.']),
  P('mage', 'reindeer', { activity: 'cast' }, { activity: 'fly', motion: rise(16, 1.4) }, ['Levitate.', 'Already can.']),
  P('cat', 'reindeer', { activity: 'loaf' }, { activity: 'graze' }, ['Hay?', 'Nap spot.']),
  P('dog', 'reindeer', { activity: 'run', motion: slide(70, 1.8) }, { activity: 'stomp' }, ['Race!', 'Fine.']),
  P('adventurer', 'reindeer', { activity: 'check' }, { activity: 'glow' }, ['Nose is on.', 'Fog tonight.']),
  P('pker', 'reindeer', { activity: 'noscim' }, { activity: 'tangled' }, ['My scim.', 'Your lines.']),
  P('alien', 'reindeer', { activity: 'lift' }, { activity: 'fly' }, ['Flying deer.', 'Flying saucer.']),
  P('ghost', 'reindeer', { activity: 'hat', motion: rise(6, 1.2) }, { activity: 'stomp' }, ['Boo.', 'Snort.']),
  P('spider', 'reindeer', { activity: 'spin' }, { activity: 'tangled' }, ['Web.', 'Great. Lines.']),
  P('suds', 'gingerbread', { activity: 'scrub' }, { activity: 'crumbs' }, ['Crumbs. Everywhere.', 'Sorry.']),
  P('mage', 'gingerbread', { activity: 'cast' }, { activity: 'frosted' }, ['Enchant.', 'Already sweet.']),
  P('cat', 'gingerbread', { activity: 'bat' }, { activity: 'dance' }, ['Snack!', 'Run run run.']),
  P('dog', 'gingerbread', { activity: 'fetch', motion: slide(50, 1.8) }, { activity: 'dance' }, ['Cookie!', 'Catch me first.']),
  P('adventurer', 'gingerbread', { activity: 'check' }, { activity: 'cool' }, ['Food?', 'Decoration.']),
  P('pker', 'gingerbread', { activity: 'eat' }, { activity: 'crumbs' }, ['Shark.', 'Cookie. Rude.']),
  P('alien', 'gingerbread', { activity: 'scan' }, { activity: 'frost' }, ['Edible.', 'Decorative.']),
  P('ghost', 'gingerbread', { activity: 'inhale' }, { activity: 'dance' }, ['Smells good.', 'Stop that.']),
  P('spider', 'gingerbread', { activity: 'wrap' }, { activity: 'crumbs' }, ['Snack for later.', 'Crumbs for later.']),
  P('elf', 'snowman', { activity: 'list' }, { activity: 'star' }, ['Nice list.', 'Top of it.']),
  P('elf', 'reindeer', { activity: 'wrap' }, { activity: 'haul' }, ['Load it up.', 'More?']),
  P('elf', 'gingerbread', { activity: 'stamp' }, { activity: 'frosted' }, ['Fresh batch.', 'Fresh icing.']),
  P('reindeer', 'snowman', { activity: 'graze' }, { activity: 'look' }, ['Carrot?', 'Mine.']),
  P('gingerbread', 'snowman', { activity: 'cool' }, { activity: 'melt' }, ['Cooling.', 'Melting.']),
  P('reindeer', 'gingerbread', { activity: 'graze' }, { activity: 'dance' }, ['Snack?', 'Run run run.']),
];

export const pairKey = (x: ScrublingId, y: ScrublingId): string => [x, y].sort().join('+');

/** The pair actions for two ids, preferring the set variant when the Adventurer wears it. */
export const pairActionsFor = (x: ScrublingId, y: ScrublingId, set: ScrublingSet): PairAction[] => {
  const [a, b] = [x, y].sort();
  const all = PAIR_ACTIONS.filter((p) => p.a === a && p.b === b);
  const forSet = all.filter((p) => (p.set ?? 'rune') === set);
  return forSet.length > 0 ? forSet : all.filter((p) => !p.set);
};
