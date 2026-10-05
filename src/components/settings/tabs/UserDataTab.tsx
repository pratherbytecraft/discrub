import { Box, FormControl, InputLabel, MenuItem, Select, FormControlLabel, Checkbox, Typography } from '@mui/material';
import type { AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting, UserDataRefreshRate } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';

interface UserDataTabProps {
  formValues: AppSettings;
  onChange: (key: DiscrubSetting, value: string) => void;
}

export const UserDataTab = ({ formValues, onChange }: UserDataTabProps) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        {t('userData.intro')}
      </Typography>

      <FormControlLabel
        control={
          <Checkbox
            checked={formValues[DiscrubSetting.REACTIONS_ENABLED] === 'true'}
            onChange={(e) =>
              onChange(DiscrubSetting.REACTIONS_ENABLED, e.target.checked ? 'true' : 'false')
            }
          />
        }
        label={t('userData.enableReactions')}
      />

      <FormControlLabel
        control={
          <Checkbox
            checked={formValues[DiscrubSetting.REPLIES_ENABLED] === 'true'}
            onChange={(e) =>
              onChange(DiscrubSetting.REPLIES_ENABLED, e.target.checked ? 'true' : 'false')
            }
          />
        }
        label={t('userData.lookupReplies')}
      />

      <FormControlLabel
        control={
          <Checkbox
            checked={formValues[DiscrubSetting.SERVER_NICKNAME_LOOKUP] === 'true'}
            onChange={(e) =>
              onChange(DiscrubSetting.SERVER_NICKNAME_LOOKUP, e.target.checked ? 'true' : 'false')
            }
          />
        }
        label={t('userData.lookupNicknames')}
      />

      <FormControlLabel
        control={
          <Checkbox
            checked={formValues[DiscrubSetting.DISPLAY_NAME_LOOKUP] === 'true'}
            onChange={(e) =>
              onChange(DiscrubSetting.DISPLAY_NAME_LOOKUP, e.target.checked ? 'true' : 'false')
            }
          />
        }
        label={t('userData.lookupDisplayNames')}
      />

      <FormControl fullWidth>
        <InputLabel>{t('userData.refreshRate')}</InputLabel>
        <Select
          value={formValues[DiscrubSetting.APP_USER_DATA_REFRESH_RATE]}
          label={t('userData.refreshRate')}
          onChange={(e) => onChange(DiscrubSetting.APP_USER_DATA_REFRESH_RATE, e.target.value)}
        >
          <MenuItem value={UserDataRefreshRate.NEVER}>{t('userData.never')}</MenuItem>
          <MenuItem value={UserDataRefreshRate.DAILY}>{t('userData.daily')}</MenuItem>
          <MenuItem value={UserDataRefreshRate.WEEKLY}>{t('userData.weekly')}</MenuItem>
          <MenuItem value={UserDataRefreshRate.MONTHLY}>{t('userData.monthly')}</MenuItem>
        </Select>
        <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('userData.refreshRateHelp')}
        </Typography>
      </FormControl>
    </Box>
  );
};
