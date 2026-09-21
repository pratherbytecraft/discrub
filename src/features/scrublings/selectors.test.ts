import { describe, it, expect } from 'vitest';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { createBaseState } from '@/test/state-factories';
import { defaultSettings } from '@features/app/storageKeys';
import { parsePicked, parsePositions, selectScrublingsOperationView, selectScrublingsPicked, selectScrublingsVisible } from './selectors';

const stateWith = (settings: Partial<Record<string, string>>, extra: Record<string, unknown> = {}) => {
  const base = createBaseState() as any;
  return { ...base, app: { ...base.app, settings: { ...defaultSettings, ...settings } }, ...extra };
};

describe('Scrublings selectors', () => {
  it('defaults to Suds and the Mage, drops unknown ids, keeps order and caps at three', () => {
    expect(parsePicked(undefined)).toEqual(['suds', 'mage']);
    expect(parsePicked('nonsense')).toEqual(['suds', 'mage']);
    expect(parsePicked('{"a":1}')).toEqual(['suds', 'mage']);
    expect(parsePicked('["ghost","x","cat","ghost","dog","suds"]')).toEqual(['ghost', 'cat', 'dog']);
    expect(parsePicked('[]')).toEqual([]);
  });

  it('parses positions as clamped fractions keyed by known ids', () => {
    expect(parsePositions(undefined)).toEqual({});
    expect(parsePositions('[1]')).toEqual({});
    expect(parsePositions('{"suds":0.25,"nope":0.5,"cat":7,"dog":"x"}')).toEqual({ suds: 0.25, cat: 1 });
  });

  it('shows free picks without a key and hides supporter picks until one is present', () => {
    const state = stateWith({ [DiscrubSetting.APP_SCRUBLINGS_PICKED]: '["dog","suds","ghost"]' });
    expect(selectScrublingsPicked(state)).toEqual(['dog', 'suds', 'ghost']);
    expect(selectScrublingsVisible(state)).toEqual(['suds']);
  });

  it('shows nothing when the switch is off but keeps the picks', () => {
    const state = stateWith({ [DiscrubSetting.APP_SCRUBLINGS_ENABLED]: 'false' });
    expect(selectScrublingsPicked(state)).toEqual(['suds', 'mage']);
    expect(selectScrublingsVisible(state)).toEqual([]);
  });

  it('reduces the operation to heavy, purge or load, and failures', () => {
    const base = stateWith({});
    expect(selectScrublingsOperationView(base)).toEqual({ heavy: false, kind: 'other', state: 'idle', hasFailures: false, rateLimitStopped: false });
    const purging = { ...base, purge: { ...base.purge, isPurging: true, purgeProgress: { processed: 3, deleted: 1, failed: 2 } } };
    const view = selectScrublingsOperationView(purging);
    expect(view.heavy).toBe(true);
    expect(view.kind).toBe('purge');
    expect(view.hasFailures).toBe(true);
    const exporting = { ...base, export: { ...base.export, isExporting: true } };
    expect(selectScrublingsOperationView(exporting).kind).toBe('load');
    const stopped = { ...base, app: { ...base.app, rateLimitStopped: true } };
    expect(selectScrublingsOperationView(stopped).rateLimitStopped).toBe(true);
  });
});
