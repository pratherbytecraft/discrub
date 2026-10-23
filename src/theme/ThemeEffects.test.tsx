import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { defaultSettings } from '@features/app/storageKeys';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import ThemeWrapper from './ThemeWrapper';
import { findThemeDescriptor } from './descriptors';

const supporter = { ...initialSupporterState, initialized: true, keyStatus: 'valid' as const, payload: { v: 2, kid: 'k', jti: 'j', name: 'Jordan', eh: 'x', ent: { themes: null }, iat: 1, exp: null }, lastRefreshAt: 1 };
const stateWith = (settings: Record<string, string>, opts: { supporter?: boolean; exporting?: boolean } = {}) => {
  const state = createBaseState();
  state.app = { ...state.app, settings: { ...defaultSettings, ...settings } };
  state.supporter = (opts.supporter ? supporter : { ...initialSupporterState, initialized: true }) as typeof state.supporter;
  if (opts.exporting) state.export = { ...state.export, isExporting: true };
  return state;
};
const renderTheme = (settings: Record<string, string>, opts?: { supporter?: boolean; exporting?: boolean }) =>
  renderWithProviders(<ThemeWrapper><div>app</div></ThemeWrapper>, { preloadedState: stateWith(settings, opts) });

afterEach(() => { vi.useRealTimers(); });

describe('Abstract theme effects', () => {
  it('is a dark supporter theme that carries the abstract effects', () => {
    const d = findThemeDescriptor('abstract');
    expect(d).toMatchObject({ name: 'Abstract', base: 'dark', tier: 'supporter', effects: 'abstract' });
  });

  it('draws the effects layer for a supporter on Abstract, moving, and out of the way of clicks', () => {
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'abstract' }, { supporter: true });
    const layer = screen.getByTestId('theme-effects-abstract');
    expect(layer).toHaveAttribute('data-moving', 'true');
    expect(layer).toHaveAttribute('aria-hidden');
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
  });

  it('draws nothing on any other theme', () => {
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'synthwave' }, { supporter: true });
    expect(screen.queryByTestId('theme-effects-abstract')).toBeNull();
  });

  it('draws nothing without supporter access, since the theme falls back', () => {
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'abstract' });
    expect(screen.queryByTestId('theme-effects-abstract')).toBeNull();
  });

  it('keeps the look but stops moving with theme animations off', () => {
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'abstract', [DiscrubSetting.APP_THEME_ANIMATIONS]: 'false' }, { supporter: true });
    expect(screen.getByTestId('theme-effects-abstract')).toHaveAttribute('data-moving', 'false');
  });

  it('stops moving while an export runs', () => {
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'abstract' }, { supporter: true, exporting: true });
    expect(screen.getByTestId('theme-effects-abstract')).toHaveAttribute('data-moving', 'false');
  });
});

describe("Christmas '26 theme effects (2.2.7)", () => {
  it('is a dark holiday theme over the year end that carries the christmas effects', () => {
    const d = findThemeDescriptor('christmas-26');
    expect(d).toMatchObject({ name: "Christmas '26", base: 'dark', tier: 'supporter', group: 'holiday', effects: 'christmas' });
    expect(d!.season).toEqual({ year: 2026, from: [12, 1], until: [1, 4] });
  });

  it('draws snow and lights for everyone in season, moving, out of the way of clicks, and never the Halloween layer', () => {
    vi.setSystemTime(new Date(2026, 11, 24));
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'christmas-26' });
    const layer = screen.getByTestId('theme-effects-christmas');
    expect(layer).toHaveAttribute('data-moving', 'true');
    expect(layer).toHaveAttribute('aria-hidden');
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.queryByTestId('theme-effects-halloween')).toBeNull();
  });

  it('still draws on January 2, and falls back without a key on January 5', () => {
    vi.setSystemTime(new Date(2027, 0, 2));
    const { unmount } = renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'christmas-26' });
    expect(screen.getByTestId('theme-effects-christmas')).toBeInTheDocument();
    unmount();
    vi.setSystemTime(new Date(2027, 0, 5));
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'christmas-26' });
    expect(screen.queryByTestId('theme-effects-christmas')).toBeNull();
  });

  it('keeps the snow still with animations off and while an export runs', () => {
    vi.setSystemTime(new Date(2026, 11, 24));
    const { unmount } = renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'christmas-26', [DiscrubSetting.APP_THEME_ANIMATIONS]: 'false' });
    expect(screen.getByTestId('theme-effects-christmas')).toHaveAttribute('data-moving', 'false');
    unmount();
    renderTheme({ [DiscrubSetting.APP_THEME_MODE]: 'christmas-26' }, { exporting: true });
    expect(screen.getByTestId('theme-effects-christmas')).toHaveAttribute('data-moving', 'false');
  });
});
