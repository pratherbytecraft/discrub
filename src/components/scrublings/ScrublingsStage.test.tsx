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
    widthSpy.mockRestore(); setWidth(70);
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
    const picked = { [DiscrubSetting.APP_SCRUBLINGS_PICKED]: '["dog","suds","ghost"]' };
    const { unmount } = renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith(picked) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '1');
    expect(screen.queryByTestId('scrubling-dog')).toBeNull();
    unmount();
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith(picked, { supporter: true }) });
    expect(screen.getByTestId('scrublings-stage')).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('scrubling-dog')).toBeInTheDocument();
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
});

describe('teleport on arrive and leave', () => {
  beforeEach(() => { vi.useFakeTimers(); setWidth(300); });
  afterEach(() => { widthSpy.mockRestore(); vi.useRealTimers(); });

  it('teleports each character in on load, then clears the effect', async () => {
    const { TELE_MS } = await import('./ScrublingsStage');
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith() });
    expect(screen.getByTestId('scrubling-tele-in-suds')).toBeInTheDocument();
    expect(screen.getByTestId('scrubling-tele-in-mage')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(TELE_MS + 200); });
    expect(screen.queryByTestId('scrubling-tele-in-suds')).toBeNull();
    expect(screen.getByTestId('scrubling-suds')).toBeInTheDocument();
  });

  it('teleports a character out when it is unpicked, and the rest stay', async () => {
    const { TELE_MS } = await import('./ScrublingsStage');
    const { store } = renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith() });
    act(() => { vi.advanceTimersByTime(TELE_MS + 200); });
    const settings = store.getState().app.settings;
    act(() => { store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...settings, [DiscrubSetting.APP_SCRUBLINGS_PICKED]: '["suds"]' } }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByTestId('scrubling-mage')).toBeNull();
    expect(screen.getByTestId('scrubling-tele-out-mage')).toBeInTheDocument();
    expect(screen.queryByTestId('scrubling-tele-out-suds')).toBeNull();
    act(() => { vi.advanceTimersByTime(TELE_MS + 200); });
    expect(screen.queryByTestId('scrubling-tele-out-mage')).toBeNull();
  });

  it('teleports everyone out when the switch goes off', async () => {
    const { TELE_MS } = await import('./ScrublingsStage');
    const { store } = renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith() });
    act(() => { vi.advanceTimersByTime(TELE_MS + 200); });
    const settings = store.getState().app.settings;
    act(() => { store.dispatch({ type: 'app/updateAllSettings/fulfilled', payload: { ...settings, [DiscrubSetting.APP_SCRUBLINGS_ENABLED]: 'false' } }); });
    expect(screen.getByTestId('scrubling-tele-out-suds')).toBeInTheDocument();
    expect(screen.getByTestId('scrubling-tele-out-mage')).toBeInTheDocument();
  });

  it('plays nothing when theme animations are off', () => {
    renderWithProviders(<ScrublingsStage />, { preloadedState: stateWith({ [DiscrubSetting.APP_THEME_ANIMATIONS]: 'false' }) });
    expect(screen.getByTestId('scrubling-suds')).toBeInTheDocument();
    expect(screen.queryByTestId('scrubling-tele-in-suds')).toBeNull();
  });
});

describe('captionTop', () => {
  it('leaves the same space above the text as between the text and the head', async () => {
    const { captionTop } = await import('./ScrublingsStage');
    // 64px bar, Suds: the head starts 28px down, the 12px line sits at 8, so 8 above and 8 below.
    expect(captionTop(64, 'suds')).toBe(8);
    expect(captionTop(56, 'mage')).toBe(4);
  });
  it('sits lower over a short character and never leaves the bar', async () => {
    const { captionTop } = await import('./ScrublingsStage');
    expect(captionTop(64, 'cat')).toBeGreaterThan(captionTop(64, 'suds'));
    expect(captionTop(48, 'suds')).toBe(1);
    // Native's head is 56 now, which gives the tall characters 4 above and 4 below.
    expect(captionTop(56, 'suds')).toBe(4);
  });
});

