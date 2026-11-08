import { useEffect } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { loadFailures, saveFailedList, selectFailureCount } from '@features/failures/failuresSlice';
import type { DeleteFailureSource } from '@features/failures/deleteFailures';

interface LastRunFailuresProps {
  source: DeleteFailureSource;
}

/**
 * 2.2.9 (GitHub issue 23): one line in a delete dialog when the last run of
 * that kind left messages undeleted, with Save failed list. Renders nothing
 * when the last run was clean.
 */
const LastRunFailures = ({ source }: LastRunFailuresProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const count = useAppSelector(selectFailureCount(source));

  useEffect(() => {
    void dispatch(loadFailures());
  }, [dispatch]);

  if (count === 0) return null;
  return (
    <Box
      data-testid="last-run-failures"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, px: 1.5, py: 1 }}
    >
      <Typography variant="body2" sx={{ flex: 1 }}>{t('failures.lastRun', { count })}</Typography>
      <SaveFailedListLink source={source} />
    </Box>
  );
};

/** The Save failed list link on its own, for the package finished note. */
export const SaveFailedListLink = ({ source, block = false }: { source: DeleteFailureSource; block?: boolean }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  return (
    <Link
      component="button"
      type="button"
      variant="body2"
      underline="hover"
      onClick={() => void dispatch(saveFailedList(source))}
      data-testid="save-failed-list"
      sx={{ whiteSpace: 'nowrap', fontSize: 'inherit', ...(block ? { display: 'block', mt: 0.25, textDecoration: 'underline' } : {}) }}
    >
      {t('failures.save')}
    </Link>
  );
};

export default LastRunFailures;
