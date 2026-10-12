import type { ReactNode } from 'react';
import { Box, Button, Checkbox, FormControlLabel, Typography } from '@mui/material';
import {
  SYSTEM_MESSAGE_GROUPS,
  ALL_SYSTEM_GROUP_KEYS,
  toggleGroupKey,
} from '@/utils/systemMessageGroups';
import { useTranslation } from 'react-i18next';

interface SystemMessageTypePickerProps {
  /** Selected group keys (e.g. ['pins', 'boosts']). */
  selectedGroups: string[];
  onChange: (groups: string[]) => void;
  /** Optional helper text rendered on the same row as Select all / Clear all. */
  description?: ReactNode;
}

/**
 * Grouped multi-select over Discord's system MessageTypes (the 7 buckets in
 * systemMessageGroups). Renders the Select all / Clear all control plus the
 * checkbox grid; callers own the outer framing (accordion, header, count
 * chip) and supply their own `description`. Shared by the purge dialog's
 * "System Messages" opt-in (#196) and the feed Refine filter (#201) so the
 * grouping and select-all behavior never diverge between the two surfaces.
 */
const SystemMessageTypePicker = ({
  selectedGroups,
  onChange,
  description,
}: SystemMessageTypePickerProps) => {
  const { t } = useTranslation();
  const allSelected = selectedGroups.length === ALL_SYSTEM_GROUP_KEYS.length;

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 1,
          mb: 1,
        }}
      >
        {description ? (
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        ) : (
          <span />
        )}
        <Button
          size="small"
          onClick={() => onChange(allSelected ? [] : ALL_SYSTEM_GROUP_KEYS)}
          sx={{ textTransform: 'none', flexShrink: 0, alignSelf: 'center' }}
        >
          {allSelected ? t('systemGroups.clearAll') : t('systemGroups.selectAll')}
        </Button>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          columnGap: 1,
        }}
      >
        {SYSTEM_MESSAGE_GROUPS.map((group) => (
          <FormControlLabel
            key={group.key}
            sx={{ m: 0 }}
            control={
              <Checkbox
                size="small"
                checked={selectedGroups.includes(group.key)}
                onChange={() => onChange(toggleGroupKey(selectedGroups, group.key))}
                inputProps={{ 'aria-label': t(`systemGroups.${group.key}`, { defaultValue: group.label }) }}
              />
            }
            label={<Typography variant="body2">{t(`systemGroups.${group.key}`, { defaultValue: group.label })}</Typography>}
          />
        ))}
      </Box>
    </>
  );
};

export default SystemMessageTypePicker;
