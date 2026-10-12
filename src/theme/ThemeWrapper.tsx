import { useMemo } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { deDE as coreDeDE } from '@mui/material/locale';
import { deDE as pickersDeDE } from '@mui/x-date-pickers/locales';
import { useTranslation } from 'react-i18next';
import CssBaseline from '@mui/material/CssBaseline';
import { GlobalStyles } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectSettings, selectPreview } from '@features/app/appSlice';
import { selectHasThemes, selectSupporter } from '@features/supporter/supporterSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { getThemeById, findThemeDescriptor, resolveThemeIdFromSetting } from './theme';
import { globalStyles } from './globalStyles';
import ThemeEffects from './ThemeEffects';
import { isUnlocked } from '@features/appearance/groups';

interface ThemeWrapperProps {
  children: React.ReactNode;
}

const ThemeWrapper = ({ children }: ThemeWrapperProps) => {
  const settings = useAppSelector(selectSettings);
  const themeModeSetting = settings?.[DiscrubSetting.APP_THEME_MODE];
  // Live preview from the Appearance menu: rendered over the saved setting, never persisted.
  const previewTheme = useAppSelector(selectPreview).theme;
  const isSupporter = useAppSelector(selectHasThemes);
  const supporterInitialized = useAppSelector(selectSupporter).initialized;

  const themeId = useMemo(() => {
    let id = resolveThemeIdFromSetting(previewTheme ?? themeModeSetting);
    // A stored supporter theme without a valid key falls back to auto
    // (setting untouched — re-claiming brings the theme straight back).
    // A holiday theme stays unlocked through its season (2.2.3).
    // Until key verification resolves on boot, honor the stored choice
    // so legitimate supporters never see a theme flash.
    if (!previewTheme && supporterInitialized && !isSupporter) {
      const d = findThemeDescriptor(id);
      if (d && !isUnlocked(d, false)) {
        id = resolveThemeIdFromSetting('auto');
      }
    }
    return id;
  }, [previewTheme, themeModeSetting, supporterInitialized, isSupporter]);

  const baseTheme = useMemo(() => getThemeById(themeId), [themeId]);
  // 2.2.5 pass 2 (row 71): MUI's own labels (Autocomplete Open and Close,
  // picker buttons) follow the app language. English is MUI's default.
  const { i18n } = useTranslation();
  const language = i18n.language;
  const theme = useMemo(() => (language === 'de' ? createTheme(baseTheme, coreDeDE, pickersDeDE) : baseTheme), [baseTheme, language]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={globalStyles} />
      <ThemeEffects />
      {children}
    </ThemeProvider>
  );
};

export default ThemeWrapper;
