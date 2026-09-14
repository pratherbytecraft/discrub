import { Box, Button, FormControl, InputLabel, MenuItem, Select, Typography, alpha, useTheme } from '@mui/material';
import { LockOutlined as LockIcon, Check as CheckIcon } from '@mui/icons-material';
import { useAppSelector } from '@/app/hooks';
import { selectAppLayout, updateSetting } from '@features/app/appSlice';
import { selectHasThemes } from '@features/supporter/supporterSlice';
import { LAYOUT_META } from '@/layouts/types';
import { isLayoutBuilt } from '@/layouts/registry';
import LayoutGlyph from '@components/appearance/LayoutGlyph';
import { Palette as PaletteIcon } from '@mui/icons-material';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting, DateFormat, DmSortOrder, TimeFormat } from 'discrub-core/discrub-enum';
import { useAppDispatch } from '@/app/hooks';
import { setSupporterDialogOpen } from '@features/supporter/supporterSlice';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, normalizeLanguage } from '@/i18n/language';

interface DisplayTabProps {
  formValues: AppSettings;
  onChange: (key: DiscrubSetting, value: string) => void;
}

export const DisplayTab = ({ formValues, onChange }: DisplayTabProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const theme = useTheme();
  const layout = useAppSelector(selectAppLayout);
  const isSupporter = useAppSelector(selectHasThemes);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Layout (2.2.0, A7): the selected card follows the active layout and the lock follows the key. Picking applies live; a locked card opens the hub. */}
      <Box data-testid="display-layout-block">
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('appearance.layout')}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>{t('appearance.layoutHelp')}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1 }}>
          {LAYOUT_META.map((m) => {
            const current = m.key === layout;
            const locked = !m.free && !isSupporter;
            const built = isLayoutBuilt(m.key);
            return (
              <Box
                key={m.key}
                component="button"
                type="button"
                disabled={!built}
                aria-pressed={current}
                aria-label={!built ? t('appearance.soonLayout', { name: m.name }) : locked ? t('appearance.lockedLayout', { name: m.name }) : m.name}
                data-testid={`settings-layout-${m.key}`}
                onClick={() => { if (!built) return; if (locked) dispatch(setSupporterDialogOpen(true)); else dispatch(updateSetting({ key: DiscrubSetting.APP_LAYOUT, value: m.key })); }}
                sx={{
                  position: 'relative', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: built ? 'pointer' : 'default',
                  p: '8px 8px 6px', borderRadius: 1.5, border: '1px solid', borderColor: current ? 'primary.main' : 'divider',
                  backgroundColor: current ? alpha(theme.palette.primary.main, 0.1) : 'transparent', opacity: built ? 1 : 0.55,
                  boxShadow: locked && built ? `0 0 0 1px ${alpha(theme.palette.error.main, 0.35)}` : 'none',
                }}
              >
                <Box sx={{ display: 'grid', placeItems: 'center', height: 40, mb: 0.75 }}><LayoutGlyph layout={m.key} color={current ? theme.palette.primary.main : theme.palette.text.primary} width={52} height={32} /></Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.name}{!built && <Box component="span" sx={{ ml: 0.75, fontSize: '0.65rem', color: 'text.secondary', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.5 }}>{t('appearance.soon')}</Box>}</Typography>
                {locked && built && <LockIcon sx={{ position: 'absolute', right: 6, top: 6, fontSize: 14, color: 'error.main' }} />}
                {current && !locked && <CheckIcon sx={{ position: 'absolute', right: 6, top: 6, fontSize: 14, color: 'primary.main' }} />}
              </Box>
            );
          })}
        </Box>
      </Box>
      <Typography variant="subtitle2" sx={{ mb: -1.5 }}>{t('appearance.datesAndLanguage')}</Typography>
      <Typography variant="body2" color="text.secondary">
        Customize how dates, times, and other information are displayed.
      </Typography>

      {/* Themes live in the Themes hub only; this pointer catches
          anyone who comes looking for them here. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Looking for themes?
        </Typography>
        <Button
          size="small"
          startIcon={<PaletteIcon />}
          onClick={() => dispatch(setSupporterDialogOpen(true))}
          data-testid="display-open-themes-hub"
        >
          Open the Themes hub
        </Button>
      </Box>

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
