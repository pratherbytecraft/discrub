import { describe, it, expect } from 'vitest';
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
