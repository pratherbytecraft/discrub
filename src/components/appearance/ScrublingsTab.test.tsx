import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { defaultSettings } from '@features/app/storageKeys';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import { setStageSlots } from '@features/scrublings/stageSlots';
import AppearanceButton from './AppearanceButton';

const supporter = { ...initialSupporterState, keyStatus: 'valid' as const, payload: { v: 2, kid: 'k', jti: 'j', name: 'Jordan', eh: 'x', ent: { themes: null }, iat: 1, exp: null }, lastRefreshAt: 1 };
const stateWith = (settings: Partial<Record<string, string>> = {}, isSupporter = false) => {
  const state = createBaseState();
  state.app = { ...state.app, settings: { ...defaultSettings, ...settings } };
  if (isSupporter) state.supporter = supporter as typeof state.supporter;
  return state;
};
const openTab = async (state = stateWith()) => {
  const rendered = renderWithProviders(<AppearanceButton onOpenSettings={vi.fn()} />, { preloadedState: state });
  fireEvent.click(screen.getByLabelText('Appearance'));
  fireEvent.click(await screen.findByTestId('appearance-tab-scrublings'));
  await screen.findByTestId('scrublings-tab');
  return rendered;
};

describe('Appearance menu, Scrublings tab', () => {
  it('lists eight cards, three free, two picked, five locked without a key, and no hint line', async () => {
    await openTab();
    expect(screen.getAllByTestId(/^scrubling-card-/)).toHaveLength(8);
    expect(screen.getByTestId('scrubling-card-suds')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('scrubling-card-mage')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('scrubling-card-cat')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByTestId(/^scrubling-locked-/)).toHaveLength(5);
    expect(screen.getByLabelText('Dog (supporter Scrubling, locked)')).toBeInTheDocument();
    expect(screen.getAllByText('Free')).toHaveLength(3);
    expect(screen.getByTestId('scrublings-count')).toHaveTextContent('2 of 3 picked');
    expect(screen.getByTestId('scrublings-switch').querySelector('input')).toBeChecked();
    expect(screen.queryByTestId('appearance-hint')).toBeNull();
  });

  it('links to the Ko-fi requests page for a custom Scrubling, and shows no designer on the first eight', async () => {
    await openTab();
    const link = screen.getByTestId('scrublings-request');
    expect(link).toHaveAttribute('href', 'https://ko-fi.com/prathercc/commissions');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('Request a custom Scrubling');
    expect(screen.queryByTestId(/^scrubling-designer-/)).toBeNull();
  });

  it('goes to the Supporter segment on a locked card and never changes the picks', async () => {
    const { store } = await openTab();
    fireEvent.click(screen.getByTestId('scrubling-card-ghost'));
    expect(await screen.findByTestId('supporter-panel')).toBeInTheDocument();
    expect(store.getState().app.settings?.[DiscrubSetting.APP_SCRUBLINGS_PICKED]).toBe('["suds","mage"]');
  });

  it('unpicks and picks free ones, and the switch writes the setting', async () => {
    const { store } = await openTab();
    fireEvent.click(screen.getByTestId('scrubling-card-mage'));
    expect(store.getState().app.settings?.[DiscrubSetting.APP_SCRUBLINGS_PICKED]).toBe('["suds"]');
    fireEvent.click(screen.getByTestId('scrubling-card-mage'));
    expect(store.getState().app.settings?.[DiscrubSetting.APP_SCRUBLINGS_PICKED]).toBe('["suds","mage"]');
    fireEvent.click(screen.getByTestId('scrublings-switch').querySelector('input')!);
    expect(store.getState().app.settings?.[DiscrubSetting.APP_SCRUBLINGS_ENABLED]).toBe('false');
  });

  it('with a key: picks a supporter one, and caps at three', async () => {
    const { store } = await openTab(stateWith({}, true));
    expect(screen.queryAllByTestId(/^scrubling-locked-/)).toHaveLength(0);
    fireEvent.click(screen.getByTestId('scrubling-card-cat'));
    expect(store.getState().app.settings?.[DiscrubSetting.APP_SCRUBLINGS_PICKED]).toBe('["suds","mage","cat"]');
    expect(screen.getByTestId('scrublings-count')).toHaveTextContent('3 of 3 picked');
    expect(screen.getByTestId('scrubling-card-dog')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('scrubling-card-dog'));
    expect(store.getState().app.settings?.[DiscrubSetting.APP_SCRUBLINGS_PICKED]).toBe('["suds","mage","cat"]');
  });

  it('says how many fit when the stage is narrower than the picks', async () => {
    setStageSlots(1);
    await openTab();
    expect(screen.getByTestId('scrublings-count')).toHaveTextContent('2 of 3 picked · 1 shows on this screen');
    setStageSlots(null);
  });
});
