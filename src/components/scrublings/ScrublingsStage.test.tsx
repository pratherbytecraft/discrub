import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, act } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { defaultSettings } from '@features/app/storageKeys';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import ScrublingsStage from './ScrublingsStage';

const supporter = { ...initialSupporterState, keyStatus: 'valid' as const, payload: { v: 2, kid: 'k', jti: 'j', name: 'Jordan', eh: 'x', ent: { themes: null }, iat: 1, exp: null }, lastRefreshAt: 1 };

const stateWith = (settings: Partial<Record<string, string>> = {}, opts: { supporter?: boolean; exporting?: boolean } = {}) => {
  const state = createBaseState();
  state.app = { ...state.app, settings: { ...defaultSettings, ...settings } };
  if (opts.supporter) state.supporter = supporter as typeof state.supporter;
  if (opts.exporting) state.export = { ...state.export, isExporting: true };
  return state;
};

let widthSpy: { mockRestore: () => void };
const setWidth = (w: number) => { widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(w); };

describe('<ScrublingsStage />', () => {
  beforeEach(() => { vi.useFakeTimers(); setWidth(300); });
  afterEach(() => { widthSpy.mockRestore(); vi.useRealTimers(); });

  it('is hidden from assistive tech and shows the default pair on a wide stretch', () => {
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith() });
    const stage = screen.getByTestId('scrublings-stage');
    expect(stage).toHaveAttribute('aria-hidden', 'true');
    expect(stage).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('scrubling-suds')).toHaveAttribute('data-frame', 'idle1');
    expect(screen.getByTestId('scrubling-mage')).toBeInTheDocument();
    expect(screen.getByTestId('scrublings-door-left')).toBeInTheDocument();
    expect(screen.getByTestId('scrublings-door-right')).toBeInTheDocument();
  });

  it('shows nothing when the switch is off', () => {
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith({ [DiscrubSetting.APP_SCRUBLINGS_ENABLED]: 'false' }) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '0');
    expect(screen.queryByTestId('scrubling-suds')).toBeNull();
    expect(screen.queryByTestId('scrublings-door-left')).toBeNull();
  });

  it('shows as many picks as the stretch holds, and none on a sliver', () => {
    widthSpy.mockRestore(); setWidth(100);
    const { unmount } = renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith() });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('scrubling-suds')).toBeInTheDocument();
    expect(screen.queryByTestId('scrubling-mage')).toBeNull();
    unmount();
    widthSpy.mockRestore(); setWidth(30);
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith() });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '0');
  });

  it('hides supporter picks without a key and shows them with one', () => {
    const picked = { [DiscrubSetting.APP_SCRUBLINGS_PICKED]: '["cat","suds","ghost"]' };
    const { unmount } = renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith(picked) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '1');
    expect(screen.queryByTestId('scrubling-cat')).toBeNull();
    unmount();
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith(picked, { supporter: true }) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('scrubling-cat')).toBeInTheDocument();
    expect(screen.getByTestId('scrubling-ghost')).toBeInTheDocument();
  });

  it('freezes on the idle frame when theme animations are off, even mid run', () => {
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith({ [DiscrubSetting.APP_THEME_ANIMATIONS]: 'false' }, { exporting: true }) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-frozen', 'true');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId('scrubling-suds')).toHaveAttribute('data-frame', 'idle1');
  });

  it('plays the load activity while an export runs', () => {
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith({}, { exporting: true }) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-frozen', 'false');
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('scrubling-suds').getAttribute('data-frame')).toMatch(/^carry/);
    expect(screen.getByTestId('scrubling-mage').getAttribute('data-frame')).toMatch(/^tele|^idle/);
  });

  it('reports when a character is over the obstacle, and clears when nobody is', () => {
    const makeObstacle = (left: number, width: number) => {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => ({ left, width, top: 0, right: left + width, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) });
      return { current: el };
    };
    const onCovered = vi.fn();
    const { unmount } = renderWithProviders(<ScrublingsStage obstacle={makeObstacle(0, 300)} onObstacleCovered={onCovered} />, { preloadedState: stateWith() });
    // The obstacle spans the whole stretch, so whoever is on stage is over it.
    expect(onCovered).toHaveBeenLastCalledWith(true);
    unmount();
    // Off the bar entirely: nobody covers it, so the only report is the reset on unmount, if any.
    onCovered.mockClear();
    renderWithProviders(<ScrublingsStage obstacle={makeObstacle(1000, 50)} onObstacleCovered={onCovered} />, { preloadedState: stateWith() });
    act(() => { vi.advanceTimersByTime(400); });
    expect(onCovered).not.toHaveBeenCalledWith(true);
  });
});
