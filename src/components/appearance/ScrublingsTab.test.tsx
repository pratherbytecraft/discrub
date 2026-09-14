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
  it('lists eight cards, two free and picked, six locked without a key, with the free hint', async () => {
    await openTab();
    expect(screen.getAllByTestId(/^scrubling-card-/)).toHaveLength(8);
    expect(screen.getByTestId('scrubling-card-suds')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('scrubling-card-mage')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('scrubling-card-cat')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByTestId(/^scrubling-locked-/)).toHaveLength(6);
    expect(screen.getByLabelText('Cat (supporter Scrubling, locked)')).toBeInTheDocument();
    expect(screen.getAllByText('Free')).toHaveLength(2);
    expect(screen.getByTestId('scrublings-count')).toHaveTextContent('2 of 3 picked');
    expect(screen.getByTestId('scrublings-switch').querySelector('input')).toBeChecked();
    expect(screen.getByTestId('appearance-hint')).toHaveTextContent('Suds and the Mage are free. The rest come with supporter access.');
  });

  it('opens the hub on a locked card and never changes the picks', async () => {
    const { store } = await openTab();
    fireEvent.click(screen.getByTestId('scrubling-card-ghost'));
    expect(store.getState().supporter.dialogOpen).toBe(true);
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

  it('with a key: picks a supporter one, caps at three, and shows the supporter hint', async () => {
    const { store } = await openTab(stateWith({}, true));
    expect(screen.queryAllByTestId(/^scrubling-locked-/)).toHaveLength(0);
    expect(screen.getByTestId('appearance-hint')).toHaveTextContent('Custom Scrublings are made to order on Ko-fi.');
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
