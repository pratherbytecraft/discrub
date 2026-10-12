import { memo } from 'react';
import { Paper, Box, Typography, Button } from '@mui/material';
import { Pause as HoldIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { setDiscrubPaused } from '@features/app/appSlice';
import { useCountdown } from '@components/ui/PauseResumeControls';
import { REST_BREAK_AFTER_MINUTES, REST_BREAK_LENGTH_MINUTES } from '@/hooks/restBreakConstants';

/**
 * A rest break in the main area (W4 gate finding). The bottom bar's
 * countdown is small and cut off at a normal width, so a run on a 45
 * minute break looked frozen. This says what is happening above the
 * messages, with the time left and a way to skip the break. Skip resumes,
 * which `useRestBreaks` reads as skipping.
 */
const RestBreakBanner = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const summary = useAppSelector(selectOperationSummary);
  const onBreak = summary.state === 'restBreak';
  const countdown = useCountdown(onBreak ? summary.hold?.until : null);
  if (!onBreak) return null;
  return (
    <Paper
      data-testid="rest-break-banner"
      sx={{ p: 1.5, backgroundColor: 'warning.dark', mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}
    >
      <HoldIcon sx={{ color: 'warning.contrastText', flexShrink: 0 }} />
      <Box sx={{ flex: 1, color: 'warning.contrastText', fontSize: '0.875rem', minWidth: 0 }}>
        <Typography sx={{ fontSize: 'inherit', fontWeight: 600 }}>
          {t('restBreakBanner.title', { name: summary.name, time: countdown })}
        </Typography>
        <Typography sx={{ fontSize: 'inherit' }}>
          {t('restBreakBanner.line', { minutes: REST_BREAK_LENGTH_MINUTES, active: REST_BREAK_AFTER_MINUTES })}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="outlined"
        onClick={() => dispatch(setDiscrubPaused(false))}
        data-testid="rest-break-skip"
        sx={{ color: 'warning.contrastText', borderColor: 'warning.contrastText', textTransform: 'none', whiteSpace: 'nowrap' }}
      >
        {t('restBreakBanner.skip')}
      </Button>
    </Paper>
  );
};

export default memo(RestBreakBanner);
