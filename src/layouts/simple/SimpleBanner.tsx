import { memo } from 'react';
import { Box, Button, LinearProgress, Typography, alpha } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setDiscrubPaused } from '@features/app/appSlice';
import { REST_BREAK_AFTER_MINUTES, REST_BREAK_LENGTH_MINUTES } from '@/hooks/restBreakConstants';
import { selectOperationSummary } from '@features/app/operationSelectors';
import PauseResumeControls from '@components/ui/PauseResumeControls';
import { perfCount } from '@/utils/perfCounters';

const STATE_HEX: Record<string, string> = { neutral: '#8b949e', success: '#3fb950', warning: '#d29922', info: '#58a6ff', error: '#f85149' };

/**
 * Banner above the feed while an operation runs (Simple and Timeline): the shared state block,
 * its bar, and a calm sentence. During a rest break the sentence gives way to the break's reason
 * and Skip break, since the pause is Discrub's own and the state block already counts it down
 * (pass 2, row 78: the separate RestBreakBanner showed the break a third time here).
 */
const SimpleBanner = () => {
  perfCount('SimpleBanner');
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const summary = useAppSelector(selectOperationSummary);
  if (summary.tier !== 'heavy') return null;
  const onBreak = summary.state === 'restBreak';
  const c = STATE_HEX[summary.stateColor];
  return (
    <Box data-testid="simple-banner" sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: alpha(c, 0.55), backgroundColor: alpha(c, 0.1), display: 'flex', flexDirection: 'column', gap: 1 }}>
      <PauseResumeControls label={summary.label} progress={summary.progress} />
      {summary.progress != null && <LinearProgress variant="determinate" value={summary.progress} sx={{ height: 6, borderRadius: 3, '& .MuiLinearProgress-bar': { backgroundColor: c } }} />}
      {onBreak ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
            {t('restBreakBanner.line', { minutes: REST_BREAK_LENGTH_MINUTES, active: REST_BREAK_AFTER_MINUTES })}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => dispatch(setDiscrubPaused(false))} data-testid="rest-break-skip" sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
            {t('restBreakBanner.skip')}
          </Button>
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('simple.keepReading')}</Typography>
      )}
    </Box>
  );
};

// 2.2.1 perf: rendered again only when its own store reads or props change,
// not whenever the shell above it renders (three times per Load All page).
export default memo(SimpleBanner);
