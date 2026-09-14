import { describe, it, expect } from 'vitest';
import { MAX_PICKED, PAIR_ACTIONS, SCRUBLINGS, SCRUBLING_IDS, pairActionsFor, pairKey, resolveActivity } from './descriptors';
import { activityFrames, frameDataUri } from './spriteRender';
import { SPRITE_H, SPRITE_W } from './spriteTypes';

describe('Scrubling descriptors', () => {
  it('has eight characters, two of them free, and a cap of three', () => {
    expect(SCRUBLING_IDS).toHaveLength(8);
    expect(SCRUBLING_IDS.filter((id) => SCRUBLINGS[id].tier === 'free')).toEqual(['suds', 'mage']);
    expect(MAX_PICKED).toBe(3);
  });

  it('every sheet is 20 by 28 with at least one idle frame per activity', () => {
    for (const id of SCRUBLING_IDS) {
      const { sheet } = SCRUBLINGS[id];
      expect(sheet.id).toBe(id);
      for (const [name, grid] of Object.entries(sheet.frames)) {
        expect(grid, `${id}/${name}`).toHaveLength(SPRITE_H);
        for (const row of grid) expect(row.length, `${id}/${name}`).toBeLessThanOrEqual(SPRITE_W);
      }
      for (const [activity, frames] of Object.entries(sheet.activities)) {
        expect(frames.length, `${id}/${activity}`).toBeGreaterThan(0);
        for (const f of frames) expect(sheet.frames[f], `${id}/${activity}/${f}`).toBeDefined();
      }
    }
  });

  it('every everyday, look, trick and event activity exists on its sheet', () => {
    for (const id of SCRUBLING_IDS) {
      const d = SCRUBLINGS[id];
      for (const a of [d.idle, d.walk, d.look, d.trick, ...Object.values(d.events)]) {
        expect(d.sheet.activities[a], `${id}/${a}`).toBeDefined();
      }
    }
  });

  it("the Adventurer's Dharok's set maps every everyday and event activity to a dh_ one", () => {
    const d = SCRUBLINGS.adventurer;
    for (const a of [d.idle, d.walk, d.look, ...Object.values(d.events)]) {
      const resolved = resolveActivity(d, a, 'dharok');
      expect(resolved, a).toMatch(/^dh_/);
      expect(d.sheet.activities[resolved]).toBeDefined();
    }
    expect(d.sheet.activities[d.dharok!.equip]).toBeDefined();
    expect(d.sheet.activities[d.dharok!.unequip]).toBeDefined();
    expect(resolveActivity(SCRUBLINGS.cat, 'walk', 'dharok')).toBe('walk');
  });

  it('covers all 28 pairs, with three for the Mage and the Adventurer', () => {
    const keys = new Set(PAIR_ACTIONS.map((p) => pairKey(p.a, p.b)));
    expect(keys.size).toBe(28);
    for (let i = 0; i < SCRUBLING_IDS.length; i += 1) {
      for (let j = i + 1; j < SCRUBLING_IDS.length; j += 1) {
        expect(keys.has(pairKey(SCRUBLING_IDS[i], SCRUBLING_IDS[j]))).toBe(true);
      }
    }
    expect(PAIR_ACTIONS.filter((p) => pairKey(p.a, p.b) === pairKey('mage', 'adventurer'))).toHaveLength(3);
    expect(PAIR_ACTIONS).toHaveLength(30);
  });

  it('every pair actor names an activity on its own sheet, sorted a before b, two captions each', () => {
    for (const p of PAIR_ACTIONS) {
      expect(p.a < p.b).toBe(true);
      expect(SCRUBLINGS[p.a].sheet.activities[p.actors.a.activity] ?? SCRUBLINGS[p.a].sheet.frames[p.actors.a.activity], `${p.a} ${p.actors.a.activity}`).toBeDefined();
      expect(SCRUBLINGS[p.b].sheet.activities[p.actors.b.activity] ?? SCRUBLINGS[p.b].sheet.frames[p.actors.b.activity], `${p.b} ${p.actors.b.activity}`).toBeDefined();
      expect(p.captions).toHaveLength(2);
      for (const c of p.captions) expect(c.length).toBeGreaterThan(0);
    }
  });

  it("picks the Dharok's variant only while the Adventurer wears it", () => {
    expect(pairActionsFor('mage', 'adventurer', 'rune').every((p) => !p.set)).toBe(true);
    expect(pairActionsFor('mage', 'adventurer', 'rune')).toHaveLength(2);
    const dh = pairActionsFor('adventurer', 'mage', 'dharok');
    expect(dh).toHaveLength(1);
    expect(dh[0].captions[0]).toBe('1 hp.');
    // Pairs without a set variant fall back to the rune one.
    expect(pairActionsFor('cat', 'adventurer', 'dharok')).toEqual(pairActionsFor('cat', 'adventurer', 'rune'));
  });

  it('renders a frame as a crisp SVG data URI and caches it', () => {
    const uri = frameDataUri(SCRUBLINGS.suds.sheet, 'idle1');
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(uri)).toContain("shape-rendering='crispEdges'");
    expect(decodeURIComponent(uri)).toContain(`viewBox='0 0 ${SPRITE_W} ${SPRITE_H}'`);
    // Runs of one colour collapse into one rect: the cap brim is a single 11 wide rect.
    expect(decodeURIComponent(uri)).toContain("<rect x='3' y='5' width='11' height='1'");
    expect(activityFrames(SCRUBLINGS.suds.sheet, 'nope')).toEqual(SCRUBLINGS.suds.sheet.activities.idle);
    expect(activityFrames(SCRUBLINGS.suds.sheet, 'puzzled')).toEqual(['puzzled', 'idle1']);
    expect(frameDataUri(SCRUBLINGS.suds.sheet, 'idle1')).toBe(uri);
  });
});
