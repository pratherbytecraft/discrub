import { useState, useRef, useEffect, useMemo } from 'react';
import { ButtonGroup, Button, Box, Typography, LinearProgress, Popover, useTheme, keyframes, alpha } from '@mui/material';
import {
  Pause as PauseIcon,
  PlayArrow as ResumeIcon,
  Stop as StopIcon,
  Autorenew as RetryIcon,
  Pause as HoldIcon,
  Close as FailedIcon,
  HelpOutline as HelpIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { getTourEntry } from '@components/welcome/tourSteps';
import { selectDiscrubPaused, setDiscrubPaused, setDiscrubCancelled, setOperationHold } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning, selectOperationSummary, type OperationStateColor } from '@features/app/operationSelectors';
import { addStatusEntry } from '@features/status/statusSlice';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import { useHotkey } from '@features/hotkeys/HotkeyProvider';
import { useTranslation } from 'react-i18next';

interface PauseResumeControlsProps {
  label?: string;
  progress?: number;
}

/**
 * Brief flash animation applied to the progress label whenever the
 * counter values change. Confirms to the user that the operation is
 * making progress, even when the StatusPanel is collapsed and only
 * the label is visible. Honors prefers-reduced-motion via the wrapping
 * `@media` query.
 */
const buildLabelPulse = (pulseColor: string, restColor: string) => keyframes`
  0%   { color: ${pulseColor}; }
  60%  { color: ${pulseColor}; }
  100% { color: ${restColor}; }
`;

/**
 * "Rest break · resumes in m:ss", ticking once a second while an automatic
 * rest break (`useRestBreaks`) holds the operation. Empty otherwise.
 */
const useCountdown = (until: number | null | undefined): string => {
  const restBreakUntil = until ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (restBreakUntil == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [restBreakUntil]);
  if (restBreakUntil == null) return '';
  const remaining = Math.max(0, Math.ceil((restBreakUntil - now) / 1000));
  if (remaining < 60) return `${remaining} s`;
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

/**
 * Pause/Resume/Cancel controls for long-running operations.
 * Only visible when an operation is running.
 */
// The one colour per state (A4). Same hex the status panel uses for its dot.
const STATE_HEX: Record<OperationStateColor, string> = { neutral: '#8b949e', success: '#3fb950', warning: '#d29922', info: '#58a6ff', error: '#f85149' };
const spin = keyframes`to { transform: rotate(360deg); }`;

const PauseResumeControls = ({ label, progress }: PauseResumeControlsProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const labelPulse = useMemo(
    () => buildLabelPulse(theme.palette.primary.main, theme.palette.text.secondary),
    [theme],
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const isRunning = useAppSelector(selectIsHeavyOperationRunning);
  const isPaused = useAppSelector(selectDiscrubPaused);
  const summary = useAppSelector(selectOperationSummary);
  const countdown = useCountdown(summary.hold?.until);
  const inHold = summary.state === 'restBreak' || summary.state === 'retrying' || summary.state === 'retryPaused';
  const headline = summary.state === 'restBreak'
    ? t('operation.state.restBreak', { time: countdown })
    : summary.state === 'retrying'
      ? t('operation.state.retrying', { time: countdown, attempt: summary.hold?.attempt, max: summary.hold?.max })
      : summary.state === 'retryPaused'
        ? t('operation.state.retryPaused', { max: summary.hold?.max })
        : '';
  const stateHex = STATE_HEX[summary.stateColor];
  const [helpAnchor, setHelpAnchor] = useState<HTMLButtonElement | null>(null);
  const tourEntry = getTourEntry('pause-resume-controls', t);

  // Bump a key whenever the label text changes so the Typography below
  // remounts and re-fires the pulse keyframe. Cheap visual cue that
  // counters in the label have just ticked.
  const lastLabelRef = useRef<string | undefined>(label);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (label && label !== lastLabelRef.current) {
      lastLabelRef.current = label;
      setPulseKey((k) => k + 1);
    }
  }, [label]);

  // Hotkey wiring (#144). Both gate on `isRunning` so they only fire
  // when an operation is actually in flight; outside that window the
  // bindings (Space, mod+.) fall through and behave normally — Space
  // still scrolls the page, etc.
  const togglePause = () => {
    dispatch(setDiscrubPaused(!isPaused));
    dispatch(addStatusEntry({ level: isPaused ? 'success' : 'warning', message: isPaused ? t('pause.operationResumed') : t('pause.operationPaused') }));
  };
  const retryNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Clearing the hold ends the retry wait early (withTransientRetry watches for it).
    dispatch(setOperationHold(null));
  };
  const cancelOp = () => {
    dispatch(setDiscrubCancelled(true));
    dispatch(setDiscrubPaused(false));
    dispatch(addStatusEntry({ level: 'warning', message: t('pause.operationCancelled') }));
  };
  useHotkey('pauseResume', togglePause, isRunning);
  useHotkey('cancelOp', cancelOp, isRunning);

  if (!isRunning) return null;

  const handlePauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePause();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelOp();
  };

  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5, px: 1 }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ButtonGroup variant="text" size="small" color="inherit">
        <HotkeyTooltip
          actionId="pauseResume"
          label={isPaused ? t('pause.resume') : t('pause.pause')}
          enterDelay={0}
          arrow
        >
          <Button
            onClick={handlePauseResume}
            aria-label={isPaused ? t('pause.resume') : t('pause.pause')}
            sx={{ minWidth: 32, px: 0.5, '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.15) } }}
          >
            {isPaused ? <ResumeIcon /> : <PauseIcon />}
          </Button>
        </HotkeyTooltip>

        <HotkeyTooltip actionId="cancelOp" label={t('pause.stop')} enterDelay={0} arrow>
          <Button
            onClick={handleCancel}
            aria-label={t('pause.stop')}
            sx={{ minWidth: 32, px: 0.5, '&:hover': { backgroundColor: 'rgba(240, 71, 71, 0.15)' } }}
          >
            <StopIcon />
          </Button>
        </HotkeyTooltip>

        {tourEntry && (
          <Button
            onClick={(e) => setHelpAnchor(e.currentTarget)}
            aria-label={t('pause.help', { title: tourEntry.title })}
            data-testid="tour-spot-pause-resume-controls"
            sx={{
              minWidth: 32,
              px: 0.5,
              cursor: 'help',
              color: 'text.secondary',
              opacity: 0.6,
              transition: 'opacity 120ms ease, color 120ms ease',
              '&:hover': { opacity: 1, color: 'primary.main' },
              '&:focus-visible': { opacity: 1, color: 'primary.main' },
            }}
          >
            <HelpIcon sx={{ fontSize: 14 }} />
          </Button>
        )}
      </ButtonGroup>

      {tourEntry && (
        <Popover
          open={Boolean(helpAnchor)}
          anchorEl={helpAnchor}
          onClose={() => setHelpAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          slotProps={{
            paper: {
              sx: {
                maxWidth: 320,
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: isDark ? 'rgba(40, 43, 48, 0.98)' : 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(8px)',
              },
            },
          }}
        >
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5, fontSize: '0.85rem' }}>
              {tourEntry.title}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.primary', fontSize: '0.8rem', lineHeight: 1.5 }}>
              {tourEntry.content}
            </Typography>
          </Box>
        </Popover>
      )}

      {inHold && (
        <Box data-testid="operation-state" data-state={summary.state} sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 0.5, minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
              backgroundColor: stateHex, color: '#0d1117',
              animation: summary.state === 'retrying' ? `${spin} 1.6s linear infinite` : 'none',
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            {summary.state === 'restBreak' && <HoldIcon sx={{ fontSize: 11 }} />}
            {summary.state === 'retrying' && <RetryIcon sx={{ fontSize: 12 }} />}
            {summary.state === 'retryPaused' && <FailedIcon sx={{ fontSize: 12 }} />}
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{summary.name}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>·</Typography>
          <Typography variant="caption" data-testid="operation-state-headline" sx={{ color: stateHex, fontWeight: 600, whiteSpace: 'nowrap' }}>{headline}</Typography>
          {summary.sentence && (
            <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{summary.sentence}</Typography>
          )}
          {summary.state === 'retrying' && (
            <Button size="small" onClick={retryNow} sx={{ minWidth: 0, px: 1, py: 0, fontSize: '0.7rem', color: stateHex, whiteSpace: 'nowrap' }}>
              {t('pause.retryNow')}
            </Button>
          )}
        </Box>
      )}

      {label && !inHold && (
        <Typography
          key={pulseKey}
          variant="caption"
          sx={{
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            ml: 0.5,
            animation: `${labelPulse} 600ms ease-out`,
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
            },
          }}
        >
          {label}
        </Typography>
      )}

      {progress != null && (
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            width: 80,
            ml: 0.5,
            height: 6,
            borderRadius: 3,
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
            '& .MuiLinearProgress-bar': {
              backgroundColor: 'primary.main',
              borderRadius: 3,
            },
          }}
        />
      )}
    </Box>
  );
};

export default PauseResumeControls;
