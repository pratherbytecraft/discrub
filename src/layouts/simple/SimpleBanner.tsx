import { Box, LinearProgress, Typography, alpha } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectOperationSummary } from '@features/app/operationSelectors';
import PauseResumeControls from '@components/ui/PauseResumeControls';

const STATE_HEX: Record<string, string> = { neutral: '#8b949e', success: '#3fb950', warning: '#d29922', info: '#58a6ff', error: '#f85149' };

/** Banner above the feed while an operation runs (Simple): the shared state block, its bar, and a calm sentence. */
const SimpleBanner = () => {
  const { t } = useTranslation();
  const summary = useAppSelector(selectOperationSummary);
  if (summary.tier !== 'heavy') return null;
  const c = STATE_HEX[summary.stateColor];
  return (
    <Box data-testid="simple-banner" sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: alpha(c, 0.55), backgroundColor: alpha(c, 0.1), display: 'flex', flexDirection: 'column', gap: 1 }}>
      <PauseResumeControls label={summary.label} progress={summary.progress} />
      {summary.progress != null && <LinearProgress variant="determinate" value={summary.progress} sx={{ height: 6, borderRadius: 3, '& .MuiLinearProgress-bar': { backgroundColor: c } }} />}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('simple.keepReading')}</Typography>
    </Box>
  );
};

export default SimpleBanner;
