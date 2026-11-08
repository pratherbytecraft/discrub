import { useRef, useState } from 'react';
import { Box, Button, Link, Typography } from '@mui/material';
import { UploadFile as SkipListIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { parseSkipList } from '@features/failures/deleteFailures';

/** A failed list the person loaded into a delete dialog. It lives with the dialog and is never stored. */
export interface LoadedSkipList {
  fileName: string;
  skipIds: string[];
  retryableCount: number;
}

interface SkipListRowProps {
  value: LoadedSkipList | null;
  onChange: (next: LoadedSkipList | null) => void;
}

/**
 * 2.2.9 (GitHub issue 23): load a failed list saved from an earlier run so
 * the messages Discord refused are left alone this time. One small button
 * and one line beside it, the look of the filters row in the package delete
 * dialog. Messages that failed for a passing reason are tried again.
 */
const SkipListRow = ({ value, onChange }: SkipListRowProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [badFile, setBadFile] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const list = parseSkipList(await file.text());
      setBadFile(false);
      onChange({ fileName: file.name, skipIds: list.skipIds, retryableCount: list.retryableCount });
    } catch {
      setBadFile(true);
      onChange(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }} data-testid="skip-list-row">
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        hidden
        data-testid="skip-list-input"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Button
        size="small"
        variant={value ? 'contained' : 'outlined'}
        color={value ? 'primary' : 'inherit'}
        startIcon={<SkipListIcon fontSize="small" />}
        onClick={() => inputRef.current?.click()}
        data-testid="skip-list-button"
        sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
      >
        {value ? t('failures.skipListCount', { count: value.skipIds.length }) : t('failures.skipList')}
      </Button>
      <Typography variant="caption" color={badFile ? 'error' : 'text.secondary'} sx={{ flex: 1, minWidth: 180 }} data-testid="skip-list-line">
        {badFile ? (
          t('failures.badFile')
        ) : value ? (
          <>
            {t('failures.skipLoaded', { file: value.fileName, count: value.skipIds.length })}
            {value.retryableCount > 0 && <> {t('failures.skipRetry', { count: value.retryableCount })}</>}{' '}
            <Link component="button" type="button" variant="caption" underline="hover" onClick={() => onChange(null)} data-testid="skip-list-clear">
              {t('failures.clear')}
            </Link>
          </>
        ) : (
          t('failures.skipHint')
        )}
      </Typography>
    </Box>
  );
};

export default SkipListRow;
