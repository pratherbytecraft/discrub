import { describe, it, expect } from 'vitest';
import { EMPTY_LINE_CONTEXT, LINES, REST_BREAK_LINE, SHORT_LINES, SHORT_LINE_MAX_W, SHORT_REST_BREAK_LINE, fillLine, lineFor } from './lines';
import { SCRUBLING_IDS, type ScrublingEvent } from './descriptors';

const EVENTS: ScrublingEvent[] = ['purge', 'load', 'wait', 'done', 'failed', 'paused'];

describe('Scrubling event lines', () => {
  it('gives every character a line for all six events', () => {
    for (const id of SCRUBLING_IDS) {
      for (const e of EVENTS) expect(LINES[id][e].length, `${id} ${e}`).toBeGreaterThan(0);
    }
  });

  it('never contains an instruction', () => {
    const all = SCRUBLING_IDS.flatMap((id) => EVENTS.map((e) => LINES[id][e])).concat(REST_BREAK_LINE);
    for (const line of all) expect(line).not.toMatch(/\b(click|open|try|press|use)\b/i);
  });

  it('fills every placeholder with formatted numbers and a bare channel name', () => {
    expect(fillLine('{n} in #{ch}, {f} failed, {s}s, {m} min', { n: 1204, ch: '#general', f: 2, s: 7, m: 3 })).toBe('1,204 in #general, 2 failed, 7s, 3 min');
    expect(fillLine('{n} {ch}', {})).toBe('0 chat');
    expect(fillLine('{n}', { n: -4 })).toBe('0');
  });

  it('picks the shared rest break line for a rest break wait, rounding minutes up', () => {
    const ctx = { ...EMPTY_LINE_CONTEXT, holdUntil: 1000 + 4 * 60_000 + 1, restBreak: true };
    expect(lineFor('suds', 'wait', ctx, 1000)).toBe('Rest break. Back in 5 min.');
    expect(lineFor('suds', 'wait', { ...ctx, holdUntil: 1000 }, 1000)).toBe('Rest break. Back in 1 min.');
  });

  it('fills a retry wait with the seconds left and a purge line with the count and channel', () => {
    expect(lineFor('mage', 'wait', { ...EMPTY_LINE_CONTEXT, holdUntil: 1000 + 12_400 }, 1000)).toBe('Reading up. 13s.');
    expect(lineFor('suds', 'purge', { ...EMPTY_LINE_CONTEXT, n: 2500, ch: 'general' }, 0)).toBe('2,500 scrubbed in #general');
    expect(lineFor('cat', 'failed', { ...EMPTY_LINE_CONTEXT, f: 3 }, 0)).toBe("Wasn't me. 3 left.");
  });

  it('cuts a long channel name so the line stays short', () => {
    expect(fillLine('{ch}', { ch: '#a-very-long-channel-name-indeed' })).toBe('a-very-long-chann…');
    expect(fillLine('{ch}', { ch: 'exactly-eighteen-c' })).toBe('exactly-eighteen-c');
    expect(fillLine('{ch}', { ch: '📰┊server-news' })).toBe('📰┊server-news');
  });
});

describe('Scrubling short lines (2.2.2)', () => {
  const allShort = SCRUBLING_IDS.flatMap((id) => EVENTS.map((e) => ({ key: `${id} ${e}`, line: SHORT_LINES[id][e] }))).concat({ key: 'rest break', line: SHORT_REST_BREAK_LINE });
  /** The owner approved this line as written. It is one character over with a six digit count. */
  const OVER: Record<string, number> = { 'mage load': 17 };

  it('gives every character a short line for all six events', () => {
    for (const id of SCRUBLING_IDS) {
      for (const e of EVENTS) expect(SHORT_LINES[id][e].length, `${id} ${e}`).toBeGreaterThan(0);
    }
  });

  it('never names the channel and never contains an instruction', () => {
    for (const { key, line } of allShort) {
      expect(line, key).not.toContain('{ch}');
      expect(line, key).not.toMatch(/\b(click|open|try|press|use)\b/i);
    }
  });

  it('stays within 16 characters with six digit counts and two digit times', () => {
    for (const { key, line } of allShort) {
      expect(fillLine(line, { n: 123456, f: 123456, s: 99, m: 99 }).length, key).toBeLessThanOrEqual(OVER[key] ?? 16);
    }
  });

  it('cuts over to the short lines under 600 px', () => {
    expect(SHORT_LINE_MAX_W).toBe(600);
  });

  it('returns the full line by default and the short line when asked', () => {
    const ctx = { ...EMPTY_LINE_CONTEXT, n: 2500, ch: 'general', f: 3 };
    expect(lineFor('suds', 'purge', ctx, 0)).toBe('2,500 scrubbed in #general');
    expect(lineFor('suds', 'purge', ctx, 0, false)).toBe('2,500 scrubbed in #general');
    expect(lineFor('suds', 'purge', ctx, 0, true)).toBe('2,500 scrubbed');
    expect(lineFor('pker', 'failed', ctx, 0, true)).toBe('Died. 3');
    expect(lineFor('mage', 'wait', { ...EMPTY_LINE_CONTEXT, holdUntil: 1000 + 12_400 }, 1000, true)).toBe('Reading. 13s');
  });

  it('picks the short rest break line for a rest break wait when asked', () => {
    const ctx = { ...EMPTY_LINE_CONTEXT, holdUntil: 1000 + 4 * 60_000 + 1, restBreak: true };
    expect(lineFor('suds', 'wait', ctx, 1000)).toBe('Rest break. Back in 5 min.');
    expect(lineFor('suds', 'wait', ctx, 1000, true)).toBe('Break. 5 min');
  });
});
