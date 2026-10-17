import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting, DateFormat, DmSortOrder, TimeFormat } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, normalizeLanguage } from '@/i18n/language';

interface DisplayTabProps {
  formValues: AppSettings;
  onChange: (key: DiscrubSetting, value: string) => void;
}

export const DisplayTab = ({ formValues, onChange }: DisplayTabProps) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: -1.5 }}>{t('appearance.datesAndLanguage')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('settings.displayTab.intro')}
      </Typography>

      {/* Layouts, themes and Scrublings live in the Appearance menu only; this line catches anyone who looks for them here. */}
      <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="display-appearance-pointer">{t('appearance.settingsPointer')}</Typography>

      <FormControl fullWidth>
        <InputLabel>{t('language.label')}</InputLabel>
        <Select
          value={normalizeLanguage(formValues[DiscrubSetting.APP_LANGUAGE])}
          label={t('language.label')}
          onChange={(e) => onChange(DiscrubSetting.APP_LANGUAGE, e.target.value)}
          inputProps={{ 'data-testid': 'language-select' }}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <MenuItem key={code} value={code} data-testid={`language-option-${code}`}>
              {LANGUAGE_LABELS[code]}
              {code !== 'en' ? ` (${t('language.machineDrafted')})` : ''}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('language.help')}
        </Typography>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>{t('settings.displayTab.dateFormat')}</InputLabel>
        <Select
          value={formValues[DiscrubSetting.DATE_FORMAT]}
          label={t('settings.displayTab.dateFormat')}
          onChange={(e) => onChange(DiscrubSetting.DATE_FORMAT, e.target.value)}
        >
          <MenuItem value={DateFormat.MMDDYYYY}>MM/DD/YYYY</MenuItem>
          <MenuItem value={DateFormat.DDMMYYYY}>DD/MM/YYYY</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('settings.displayTab.dateFormatHelp')}
        </Typography>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>{t('settings.displayTab.timeFormat')}</InputLabel>
        <Select
          value={formValues[DiscrubSetting.TIME_FORMAT]}
          label={t('settings.displayTab.timeFormat')}
          onChange={(e) => onChange(DiscrubSetting.TIME_FORMAT, e.target.value)}
        >
          <MenuItem value={TimeFormat._12HOUR}>{t('settings.displayTab.hour12')}</MenuItem>
          <MenuItem value={TimeFormat._24HOUR}>{t('settings.displayTab.hour24')}</MenuItem>
          <MenuItem value={TimeFormat._12HOUR_WITH_SECONDS}>{t('settings.displayTab.hour12Seconds')}</MenuItem>
          <MenuItem value={TimeFormat._24HOUR_WITH_SECONDS}>{t('settings.displayTab.hour24Seconds')}</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('settings.displayTab.timeFormatHelp')}
        </Typography>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>{t('settings.displayTab.dmOrder')}</InputLabel>
        <Select
          value={formValues[DiscrubSetting.APP_DM_SORT_ORDER]}
          label={t('settings.displayTab.dmOrder')}
          onChange={(e) => onChange(DiscrubSetting.APP_DM_SORT_ORDER, e.target.value)}
          inputProps={{ 'data-testid': 'dm-sort-order-select' }}
        >
          <MenuItem value={DmSortOrder.RECENT}>{t('settings.displayTab.dmRecent')}</MenuItem>
          <MenuItem value={DmSortOrder.NAME}>{t('settings.displayTab.dmName')}</MenuItem>
          <MenuItem value={DmSortOrder.DISCORD}>{t('settings.displayTab.dmDiscord')}</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('settings.displayTab.dmOrderHelp')}
        </Typography>
      </FormControl>
    </Box>
  );
};
