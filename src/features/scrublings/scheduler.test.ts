import { describe, it, expect } from 'vitest';
import {
  CHAR_W, EQUIP_MS, IDLE_OPERATION, ONE_SHOT_MS, PAIR_COOLDOWN_MS, PAIR_GRACE_MS, PAIR_MS, SWAP_MAX_MS, TRICK_MS,
  createScheduler, stepScheduler, syncScheduler, viewScheduler,
  type OperationView, type SchedulerInput, type SchedulerState,
} from './scheduler';
import { PAIR_ACTIONS, SCRUBLINGS, type ScrublingId } from './descriptors';

const W = 400;
const rng = () => 0.5;
const input = (now: number, over: Partial<SchedulerInput> = {}): SchedulerInput =>
  ({ now, width: W, op: IDLE_OPERATION, hover: null, drag: null, clicks: [], frozen: false, rng, ...over });
const op = (over: Partial<OperationView>): OperationView => ({ ...IDLE_OPERATION, ...over });
const purge = op({ heavy: true, kind: 'purge', state: 'running' });
const load = op({ heavy: true, kind: 'load', state: 'running' });
const char = (s: SchedulerState, id: ScrublingId) => s.chars.find((c) => c.id === id)!;
const run = (s: SchedulerState, from: number, to: number, over: Partial<SchedulerInput> = {}, stepMs = 100) => {
  let state = s;
  for (let t = from; t <= to; t += stepMs) state = stepScheduler(state, input(t, over));
  return state;
};

describe('Scrublings scheduler', () => {
  it('spreads new characters evenly and keeps dragged fractions', () => {
    const s = createScheduler(['suds', 'mage'], W, { mage: 0.9 }, 0, rng);
    expect(char(s, 'suds').x).toBeCloseTo(W / 3 - CHAR_W / 2);
    expect(char(s, 'mage').x).toBeCloseTo(0.9 * W - CHAR_W / 2);
    expect(s.chars.every((c) => c.mode === 'idle' && c.activity === 'idle')).toBe(true);
  });

  it('syncs the roster and scales positions when the stage resizes', () => {
    let s = createScheduler(['suds', 'mage'], W, {}, 0, rng);
    s = syncScheduler(s, ['mage', 'cat'], W * 2, {}, 0);
    expect(s.chars.map((c) => c.id)).toEqual(['mage', 'cat']);
    expect(char(s, 'mage').x).toBeCloseTo((2 * W / 3 - CHAR_W / 2) * 2);
    expect(s.width).toBe(W * 2);
  });

  it('idles, then wanders and wraps around the stage', () => {
    let s = createScheduler(['suds'], W, { suds: 0.95 }, 0, rng);
    s = run(s, 0, 4100);
    expect(char(s, 'suds').mode).toBe('walk');
    expect(char(s, 'suds').activity).toBe('walk');
    s = run(s, 4200, 14000);
    const x = char(s, 'suds').x;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(W);
  });

  it('plays the purge activity while a purge runs and the finished one when it returns to idle', () => {
    let s = createScheduler(['suds', 'mage'], W, {}, 0, rng);
    s = stepScheduler(s, input(100, { op: purge }));
    expect(s.event?.kind).toBe('purge');
    expect(char(s, 'suds').activity).toBe(SCRUBLINGS.suds.events.purge);
    expect(char(s, 'mage').activity).toBe(SCRUBLINGS.mage.events.purge);
    s = stepScheduler(s, input(200, { op: IDLE_OPERATION }));
    expect(s.event?.kind).toBe('done');
    expect(char(s, 'suds').activity).toBe(SCRUBLINGS.suds.events.done);
    s = stepScheduler(s, input(200 + ONE_SHOT_MS + 1));
    expect(s.event).toBeNull();
    expect(char(s, 'suds').mode).toBe('idle');
  });

  it('plays the failed activity after a purge with failures, a retry that gave up, or a rate limit stop', () => {
    let s = createScheduler(['cat'], W, {}, 0, rng);
    s = stepScheduler(s, input(100, { op: op({ heavy: true, kind: 'purge', state: 'running', hasFailures: true }) }));
    s = stepScheduler(s, input(200, { op: op({ heavy: true, kind: 'purge', state: 'running' }) }));
    s = stepScheduler(s, input(300));
    expect(s.event?.kind).toBe('failed');
    expect(char(s, 'cat').activity).toBe(SCRUBLINGS.cat.events.failed);

    let r = createScheduler(['cat'], W, {}, 0, rng);
    r = stepScheduler(r, input(100, { op: load }));
    r = stepScheduler(r, input(200, { op: op({ heavy: true, kind: 'load', state: 'retryPaused' }) }));
    expect(r.event?.kind).toBe('paused');
    r = stepScheduler(r, input(300));
    expect(r.event?.kind).toBe('failed');

    let q = createScheduler(['cat'], W, {}, 0, rng);
    q = stepScheduler(q, input(100, { op: load }));
    q = stepScheduler(q, input(200, { op: op({ rateLimitStopped: true }) }));
    expect(q.event?.kind).toBe('failed');
  });

  it('maps rest breaks and retries to waiting, a pause to paused, Load All to the load activity with motion', () => {
    let s = createScheduler(['dog'], W, {}, 0, rng);
    s = stepScheduler(s, input(100, { op: op({ heavy: true, kind: 'load', state: 'restBreak' }) }));
    expect(char(s, 'dog').activity).toBe(SCRUBLINGS.dog.events.wait);
    s = stepScheduler(s, input(200, { op: op({ heavy: true, kind: 'load', state: 'retrying' }) }));
    expect(char(s, 'dog').activity).toBe(SCRUBLINGS.dog.events.wait);
    s = stepScheduler(s, input(300, { op: op({ heavy: true, kind: 'load', state: 'paused' }) }));
    expect(char(s, 'dog').activity).toBe(SCRUBLINGS.dog.events.paused);
    const x0 = char(s, 'dog').x;
    s = stepScheduler(s, input(400, { op: load }));
    s = stepScheduler(s, input(1400, { op: load }));
    expect(char(s, 'dog').activity).toBe(SCRUBLINGS.dog.events.load);
    expect(char(s, 'dog').x).not.toBe(x0);
  });

  it('never shows the same exchange twice in a row for a scene', () => {
    const scene = PAIR_ACTIONS.find((p) => p.scene === 'cat+dog:walk/run')!;
    let s = createScheduler(['cat', 'dog'], W, { cat: 0.5, dog: 0.55 }, -PAIR_GRACE_MS, rng);
    let now = 100;
    let last: string | undefined;
    const seen = new Set<string>();
    for (let round = 0; round < 12; round += 1) {
      s = stepScheduler(s, { ...input(now), rng: () => (round * 0.37) % 1 });
      expect(s.pair, `round ${round}`).not.toBeNull();
      const first = viewScheduler(s, now).caption!.text;
      expect(scene.lines.some(([l]) => l === first)).toBe(true);
      expect(first).not.toBe(last);
      last = first; seen.add(first);
      now += PAIR_COOLDOWN_MS + PAIR_MS + 10;
      // Put them back side by side: the scene slides them apart.
      s = { ...s, pair: null, chars: s.chars.map((c) => ({ ...c, mode: 'idle' as const, until: now + 60000, motion: null, x: c.id === 'cat' ? W * 0.5 : W * 0.55 })) };
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('starts a pair action when two free characters stand close, after a grace period, with a two minute cooldown', () => {
    let s = createScheduler(['cat', 'dog'], W, { cat: 0.5, dog: 0.55 }, 0, rng);
    s = stepScheduler(s, input(100));
    expect(s.pair).toBeNull();
    s = createScheduler(['cat', 'dog'], W, { cat: 0.5, dog: 0.55 }, -PAIR_GRACE_MS, rng);
    s = stepScheduler(s, input(100));
    expect(s.pair).not.toBeNull();
    expect(s.pair!.key).toBe('cat+dog');
    expect(char(s, 'cat').mode).toBe('pair');
    expect(char(s, 'cat').facing).toBe(1);
    expect(char(s, 'dog').facing).toBe(-1);
    // One of the scene's exchanges: its first line, then its second.
    const scene = PAIR_ACTIONS.find((p) => p.scene === 'cat+dog:walk/run')!;
    const picked = scene.lines.find(([first]) => first === viewScheduler(s, 100).caption?.text);
    expect(picked).toBeDefined();
    expect(viewScheduler(s, 100 + PAIR_MS / 2 + 1).caption?.text).toBe(picked![1]);
    s = stepScheduler(s, input(100 + PAIR_MS + 1));
    expect(s.pair).toBeNull();
    expect(char(s, 'cat').mode).toBe('idle');
    expect(s.cooldowns['cat+dog']).toBe(100 + PAIR_COOLDOWN_MS);
    // Still close, still cooling down: no second action.
    s = stepScheduler(s, input(100 + PAIR_MS + 200));
    expect(s.pair).toBeNull();
  });

  it('does not pair while something runs, and an event cuts a pair short', () => {
    let s = createScheduler(['cat', 'dog'], W, { cat: 0.5, dog: 0.55 }, -PAIR_GRACE_MS, rng);
    s = stepScheduler(s, input(100, { op: purge }));
    expect(s.pair).toBeNull();
    let r = createScheduler(['cat', 'dog'], W, { cat: 0.5, dog: 0.55 }, -PAIR_GRACE_MS, rng);
    r = stepScheduler(r, input(100));
    expect(r.pair).not.toBeNull();
    r = stepScheduler(r, input(200, { op: purge }));
    expect(r.pair).toBeNull();
    expect(char(r, 'cat').mode).toBe('event');
  });

  it('looks on hover, plays the trick on a click, and follows a drag', () => {
    let s = createScheduler(['ghost'], W, {}, 0, rng);
    s = stepScheduler(s, input(100, { hover: 'ghost' }));
    expect(char(s, 'ghost').activity).toBe(SCRUBLINGS.ghost.look);
    s = stepScheduler(s, input(200, { clicks: ['ghost'] }));
    expect(char(s, 'ghost').mode).toBe('trick');
    expect(char(s, 'ghost').activity).toBe(SCRUBLINGS.ghost.trick);
    s = stepScheduler(s, input(200 + TRICK_MS + 1));
    expect(char(s, 'ghost').mode).toBe('idle');
    s = stepScheduler(s, input(3000, { drag: { id: 'ghost', x: 123 } }));
    expect(char(s, 'ghost').mode).toBe('drag');
    expect(char(s, 'ghost').x).toBe(123);
    s = stepScheduler(s, input(3100));
    expect(char(s, 'ghost').mode).toBe('idle');
    expect(char(s, 'ghost').x).toBe(123);
  });

  it('the Adventurer equips Dharok\'s piece by piece with the captions, then swaps back later', () => {
    let s = createScheduler(['adventurer'], W, {}, 0, rng);
    const swapAt = s.nextSwapAt;
    expect(swapAt).toBeLessThanOrEqual(SWAP_MAX_MS);
    s = stepScheduler(s, input(swapAt));
    expect(char(s, 'adventurer').mode).toBe('equip');
    expect(char(s, 'adventurer').activity).toBe('equip');
    expect(viewScheduler(s, swapAt).caption?.text).toBe('Equipping...');
    expect(viewScheduler(s, swapAt + EQUIP_MS * 0.8).caption?.text).toBe('gl hf');
    s = stepScheduler(s, input(swapAt + EQUIP_MS + 1));
    expect(char(s, 'adventurer').set).toBe('dharok');
    expect(viewScheduler(s, swapAt + EQUIP_MS + 1).chars[0].frame).toMatch(/^dh_/);
    s = stepScheduler(s, input(s.nextSwapAt));
    expect(char(s, 'adventurer').activity).toBe('unequip');
    s = stepScheduler(s, input(s.nextSwapAt + EQUIP_MS + 1));
    expect(char(s, 'adventurer').set).toBe('rune');
  });

  it("uses the Dharok's pair variant while the set is worn", () => {
    let s = createScheduler(['adventurer', 'mage'], W, { adventurer: 0.5, mage: 0.55 }, -PAIR_GRACE_MS, rng);
    s = { ...s, chars: s.chars.map((c) => (c.id === 'adventurer' ? { ...c, set: 'dharok' as const } : c)) };
    s = stepScheduler(s, input(100));
    expect(s.pair?.action.set).toBe('dharok');
    expect(viewScheduler(s, 100).chars.find((c) => c.id === 'adventurer')?.frame).toMatch(/^dh_swing/);
  });

  it('holds the first idle frame when frozen, even during a run', () => {
    let s = createScheduler(['suds', 'mage'], W, {}, 0, rng);
    s = stepScheduler(s, input(100, { op: purge, frozen: true }));
    s = stepScheduler(s, input(5000, { op: purge, frozen: true }));
    const view = viewScheduler(s, 5000);
    expect(view.chars.map((c) => c.frame)).toEqual(['idle1', 'idle1']);
    expect(view.chars.every((c) => c.x === char(s, c.id).x)).toBe(true);
  });

  it('steps frames from the activity clock and clamps one shots at their last frame', () => {
    let s = createScheduler(['suds'], W, {}, 0, rng);
    s = stepScheduler(s, input(0, { op: purge }));
    expect(viewScheduler(s, 0).chars[0].frame).toBe('scrub1');
    expect(viewScheduler(s, 270).chars[0].frame).toBe('scrub2');
    s = stepScheduler(s, input(1000));
    expect(viewScheduler(s, 1000 + 10 * 260).chars[0].frame).toBe('cheer2');
  });
});
