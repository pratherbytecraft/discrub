/**
 * Per-message replacement text for an edit run.
 *
 * "Fixed" edits (the original workflow) send the text the user typed to
 * every message. A random mode swaps that shared value for text generated
 * from the run's seed and the message's own id: each message gets its own
 * body, while the same message in a resumed run gets exactly the same body
 * again (the seed is part of the persisted run record).
 */

export type EditMode = 'fixed' | 'words' | 'sentences' | 'characters';

/** A random replacement; the fixed mode uses the dialog's content instead. */
export type EditReplacement = {
  mode: Exclude<EditMode, 'fixed'>;
  seed: number;
};

/**
 * Start a random replacement. Called once per run (or per Regenerate press)
 * so every message in that run derives from the same seed.
 */
export function createEditReplacement(mode: Exclude<EditMode, 'fixed'>): EditReplacement {
  return { mode, seed: Math.floor(Math.random() * 0x100000000) >>> 0 };
}

/**
 * Two FNV-1a lanes over the mode, seed and message id. A 64-bit starting
 * state keeps distinct message ids apart even in a very large bulk edit;
 * the text for one id only repeats if the whole random stream repeats.
 */
const hashText = (text: string): readonly [number, number] => {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return [first >>> 0, second >>> 0];
};

/** Mulberry32 twice with different steps: a small, fast, 64-bit-seeded PRNG. */
const createRandom = ([seedFirst, seedSecond]: readonly [number, number]): (() => number) => {
  let first = seedFirst >>> 0;
  let second = seedSecond >>> 0;
  return () => {
    first = (first + 0x6d2b79f5) | 0;
    let t = Math.imul(first ^ (first >>> 15), 1 | first);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    second = (second + 0x85ebca6b) | 0;
    let u = Math.imul(second ^ (second >>> 13), 1 | second);
    u = (u + Math.imul(u ^ (u >>> 9), 61 | u)) ^ u;
    return ((t ^ u) >>> 0) / 4294967296;
  };
};

const randomInt = (random: () => number, maxExclusive: number): number =>
  Math.floor(random() * maxExclusive);

/** Everyday English words, so a random body still reads like a message. */
const WORDS = [
  'acorn', 'amber', 'anchor', 'apricot', 'atlas', 'beacon', 'birch', 'blanket',
  'bloom', 'breeze', 'bridge', 'cabin', 'candle', 'canvas', 'cedar', 'chalk',
  'cinder', 'clover', 'coast', 'comet', 'copper', 'coral', 'cotton', 'creek',
  'crescent', 'dawn', 'delta', 'drift', 'dune', 'ember', 'fable', 'feather',
  'fern', 'field', 'flame', 'flint', 'forest', 'frost', 'garden', 'glade',
  'glass', 'glow', 'granite', 'grape', 'harbor', 'haze', 'hollow', 'honey',
  'horizon', 'indigo', 'island', 'ivory', 'juniper', 'kettle', 'lagoon',
  'lantern', 'leaf', 'ledger', 'lilac', 'linen', 'maple', 'marble', 'meadow',
  'mesa', 'mist', 'moss', 'moth', 'nectar', 'north', 'oak', 'ocean', 'olive',
  'onyx', 'orbit', 'orchid', 'pebble', 'pine', 'plum', 'pond', 'prairie',
  'quartz', 'quiet', 'rain', 'raven', 'reed', 'ridge', 'river', 'robin', 'rose',
  'sable', 'sage', 'sail', 'sand', 'scarlet', 'shadow', 'shell', 'silver', 'sky',
  'slate', 'snow', 'sorrel', 'spark', 'spring', 'spruce', 'star', 'stone',
  'storm', 'stream', 'summit', 'thistle', 'tide', 'timber', 'trail', 'vale',
  'velvet', 'violet', 'willow', 'wind', 'winter', 'wolf', 'wood', 'yarrow',
  'zenith',
];

const SENTENCE_SUBJECTS = [
  'The harbor',
  'A quiet meadow',
  'The old lantern',
  'A copper kettle',
  'The river bend',
  'A small garden',
  'The northern trail',
  'A cedar cabin',
  'The morning tide',
  'A silver compass',
  'The willow grove',
  'A familiar bench',
];

const SENTENCE_VERBS = [
  'holds',
  'carries',
  'waits beside',
  'glows near',
  'rests under',
  'follows',
  'keeps',
  'leans toward',
];

const SENTENCE_OBJECTS = [
  'a soft amber light',
  'the last of the rain',
  'a folded paper map',
  'a warm cup of tea',
  'the edge of the field',
  'a handful of fresh leaves',
  'the long way home',
  'a pale crescent moon',
  'the scent of pine',
];

const CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  '!@#$%^&*()-_=+[]{};:,.?/';

const generateWords = (random: () => number): string => {
  const count = 5 + randomInt(random, 5);
  const words: string[] = [];
  let previous = -1;
  for (let i = 0; i < count; i++) {
    let index = randomInt(random, WORDS.length);
    // Adjacent repeats look like a broken generator, not random words.
    if (index === previous) index = (index + 1) % WORDS.length;
    words.push(WORDS[index]);
    previous = index;
  }
  return words.join(' ');
};

const generateSentences = (random: () => number): string => {
  const count = 1 + randomInt(random, 3);
  const sentences: string[] = [];
  let previous = -1;
  for (let i = 0; i < count; i++) {
    let subjectIndex = randomInt(random, SENTENCE_SUBJECTS.length);
    // Do not repeat the subject in the sentence that follows it.
    if (subjectIndex === previous) subjectIndex = (subjectIndex + 1) % SENTENCE_SUBJECTS.length;
    const verb = SENTENCE_VERBS[randomInt(random, SENTENCE_VERBS.length)];
    const object = SENTENCE_OBJECTS[randomInt(random, SENTENCE_OBJECTS.length)];
    sentences.push(`${SENTENCE_SUBJECTS[subjectIndex]} ${verb} ${object}.`);
    previous = subjectIndex;
  }
  return sentences.join(' ');
};

const generateCharacters = (random: () => number): string => {
  const length = 16 + randomInt(random, 16);
  let text = '';
  for (let i = 0; i < length; i++) {
    text += CHARACTERS[randomInt(random, CHARACTERS.length)];
  }
  return text;
};

/**
 * The body a run sends for one message. Deterministic for a given
 * `{ mode, seed }` and message id, so a resumed run skips the messages it
 * already edited instead of spending requests on them again.
 */
export function generateEditReplacement(spec: EditReplacement, messageId: string): string {
  const random = createRandom(hashText(`${spec.mode}:${spec.seed}:${messageId}`));
  switch (spec.mode) {
    case 'words':
      return generateWords(random);
    case 'sentences':
      return generateSentences(random);
    case 'characters':
      return generateCharacters(random);
  }
}
