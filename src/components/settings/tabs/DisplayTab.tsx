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
        Customize how dates, times, and other information are displayed.
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
        <InputLabel>Date Format</InputLabel>
        <Select
          value={formValues[DiscrubSetting.DATE_FORMAT]}
          label="Date Format"
          onChange={(e) => onChange(DiscrubSetting.DATE_FORMAT, e.target.value)}
        >
          <MenuItem value={DateFormat.MMDDYYYY}>MM/DD/YYYY</MenuItem>
          <MenuItem value={DateFormat.DDMMYYYY}>DD/MM/YYYY</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          How dates are formatted throughout the application
        </Typography>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>Time Format</InputLabel>
        <Select
          value={formValues[DiscrubSetting.TIME_FORMAT]}
          label="Time Format"
          onChange={(e) => onChange(DiscrubSetting.TIME_FORMAT, e.target.value)}
        >
          <MenuItem value={TimeFormat._12HOUR}>12 Hour (AM/PM)</MenuItem>
          <MenuItem value={TimeFormat._24HOUR}>24 Hour</MenuItem>
          <MenuItem value={TimeFormat._12HOUR_WITH_SECONDS}>12 Hour with Seconds</MenuItem>
          <MenuItem value={TimeFormat._24HOUR_WITH_SECONDS}>24 Hour with Seconds</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          How times are formatted throughout the application
        </Typography>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel>DM List Order</InputLabel>
        <Select
          value={formValues[DiscrubSetting.APP_DM_SORT_ORDER]}
          label="DM List Order"
          onChange={(e) => onChange(DiscrubSetting.APP_DM_SORT_ORDER, e.target.value)}
          inputProps={{ 'data-testid': 'dm-sort-order-select' }}
        >
          <MenuItem value={DmSortOrder.RECENT}>Recent activity</MenuItem>
          <MenuItem value={DmSortOrder.NAME}>Name</MenuItem>
          <MenuItem value={DmSortOrder.DISCORD}>Discord's order</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          How conversations are ordered in the Direct Messages list
        </Typography>
      </FormControl>
    </Box>
  );
};
