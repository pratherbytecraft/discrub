import { FormControl, FormLabel, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { EditMode } from '@features/message/editReplacement';

interface EditModeFieldProps {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
}

const MODES: Array<{ value: EditMode; labelKey: string }> = [
  { value: 'fixed', labelKey: 'editModal.modeFixed' },
  { value: 'words', labelKey: 'editModal.modeWords' },
  { value: 'sentences', labelKey: 'editModal.modeSentences' },
  { value: 'characters', labelKey: 'editModal.modeCharacters' },
];

/**
 * EditModeField - picks between fixed replacement text and one of the
 * random replacement modes. Used by the single/bulk edit dialog.
 */
const EditModeField = ({ mode, onChange }: EditModeFieldProps) => {
  const { t } = useTranslation();

  return (
    <FormControl component="fieldset" variant="standard" sx={{ mt: 2 }}>
      <FormLabel component="legend">{t('editModal.replacementMode')}</FormLabel>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_event, next: EditMode | null) => {
          if (next) onChange(next);
        }}
        sx={{ mt: 1, flexWrap: 'wrap' }}
      >
        {MODES.map((option) => (
          <ToggleButton key={option.value} value={option.value}>
            {t(option.labelKey)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </FormControl>
  );
};

export default EditModeField;
