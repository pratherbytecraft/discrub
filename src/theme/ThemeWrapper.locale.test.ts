import { describe, it, expect } from 'vitest';
import { createTheme } from '@mui/material/styles';
import { MUI_LOCALES } from './ThemeWrapper';
import { SUPPORTED_LANGUAGES } from '@/i18n/language';

describe('MUI locale table (2.2.9)', () => {
  it('has an entry for every language but English', () => {
    expect(Object.keys(MUI_LOCALES).sort()).toEqual(SUPPORTED_LANGUAGES.filter((c) => c !== 'en').sort());
  });

  it('gives MUI its Chinese labels', () => {
    const locale = MUI_LOCALES.zh!;
    const theme = createTheme({}, locale.core, locale.pickers) as unknown as { components: Record<string, { defaultProps: Record<string, unknown> }> };
    expect(theme.components.MuiAutocomplete.defaultProps.clearText).toBe('清空');
    expect(theme.components.MuiLocalizationProvider.defaultProps.localeText).toBeTruthy();
  });
});
