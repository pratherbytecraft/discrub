import { describe, it, expect } from 'vitest';
import { useTheme } from '@mui/material/styles';
import { screen, renderWithProviders } from '@/test/test-utils';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import ThemeWrapper from './ThemeWrapper';
import { THEME_DESCRIPTORS, findThemeDescriptor, DISCORD_DARK_ID } from './theme';
import { createBaseState } from '@/test/state-factories';
import { defaultSettings } from '@features/app/appSlice';
import { initialAppState } from '@features/app/appTypes';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import type { SupporterKeyPayload } from '@services/supporterKeyService';

/** Probe that reports the applied theme via its background color. */
const ThemeProbe = () => {
  const theme = useTheme();
  return <div data-testid="probe">{theme.palette.background.default}</div>;
};

const SUPPORTER_ID = THEME_DESCRIPTORS.find((d) => d.tier === 'supporter')!.id;
const supporterBackground = findThemeDescriptor(SUPPORTER_ID)!.palette.background.default;
const defaultDarkBackground = findThemeDescriptor(DISCORD_DARK_ID)!.palette.background.default;

const payload: SupporterKeyPayload = {
  v: 2,
  kid: '2026-2',
  jti: 'jti-1',
  name: 'Aaron P.',
  eh: 'hash',
  ent: { themes: null },
  iat: 0,
  exp: null,
};

const renderWrapper = (opts: {
  themeSetting: string;
  supporter?: Partial<typeof initialSupporterState>;
}) =>
  renderWithProviders(
    <ThemeWrapper>
      <ThemeProbe />
    </ThemeWrapper>,
    {
      preloadedState: createBaseState({
        app: {
          ...initialAppState,
          settings: {
            ...defaultSettings,
            [DiscrubSetting.APP_THEME_MODE]: opts.themeSetting,
          },
        },
        supporter: { ...initialSupporterState, ...opts.supporter },
      }) as never,
    },
  );

describe('ThemeWrapper supporter fallback', () => {
  it('renders a saved supporter theme for a valid supporter', () => {
    renderWrapper({
      themeSetting: SUPPORTER_ID,
      supporter: { initialized: true, keyStatus: 'valid', payload },
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(supporterBackground);
  });

  it('falls back to auto when a supporter theme is stored without a valid key', () => {
    renderWrapper({
      themeSetting: SUPPORTER_ID,
      supporter: { initialized: true, keyStatus: 'none' },
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(defaultDarkBackground);
  });

  it('falls back for an expired key too', () => {
    renderWrapper({
      themeSetting: SUPPORTER_ID,
      supporter: { initialized: true, keyStatus: 'expired', payload },
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(defaultDarkBackground);
  });

  it('honors the stored theme until verification resolves (no boot flash)', () => {
    renderWrapper({
      themeSetting: SUPPORTER_ID,
      supporter: { initialized: false, keyStatus: 'none' },
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(supporterBackground);
  });

  it('leaves free themes alone for non-supporters', () => {
    renderWrapper({
      themeSetting: DISCORD_DARK_ID,
      supporter: { initialized: true, keyStatus: 'none' },
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(defaultDarkBackground);
  });
});
