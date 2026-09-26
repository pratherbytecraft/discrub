import { Box, keyframes } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { selectDiscrubPaused } from '@features/app/appSlice';
import {
  selectIsHeavyOperationRunning,
  selectOperationSummary,
} from '@features/app/operationSelectors';
import PauseResumeControls from '@components/ui/PauseResumeControls';
import { perfCount } from '@/utils/perfCounters';

/**
 * Amber glow pulse applied to the floating pill while the operation is
 * paused. Makes the resume affordance conspicuous in focused view,
 * mirroring the amber paused indicator the StatusPanel header uses
 * (#d29922). Honors prefers-reduced-motion via the wrapping `@media`
 * query on the sx below.
 */
const pausedPulse = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(210, 153, 34, 0.5); }
  70%  { box-shadow: 0 0 0 10px rgba(210, 153, 34, 0); }
  100% { box-shadow: 0 0 0 0 rgba(210, 153, 34, 0); }
`;

/**
 * Floating pause/resume affordance for focused (fullscreen feed) view
 * (#237). The StatusPanel — the only other mount of
 * PauseResumeControls — is hidden in focused view, which previously
 * left long-running operations with no reachable pause/resume/cancel
 * control (and a dead Space hotkey, since it registers inside
 * PauseResumeControls). This pill floats above the feed in the bottom
 * corner while a heavy operation is running and reuses
 * PauseResumeControls unchanged, so hotkeys, tooltips, and aria-labels
 * come along for free.
 *
 * Gates on the same selector PauseResumeControls self-nulls on, so no
 * empty shell is left behind when the operation finishes. MainLayout
 * only mounts this in focused view, keeping the component mutually
 * exclusive with the StatusPanel mount (a double mount would register
 * the pause/cancel hotkeys twice and double-toggle).
 */
const FloatingPauseControl = () => {
  perfCount('FloatingPauseControl');
  const isRunning = useAppSelector(selectIsHeavyOperationRunning);
  const isPaused = useAppSelector(selectDiscrubPaused);
  const operationSummary = useAppSelector(selectOperationSummary);

  if (!isRunning) return null;

  return (
    <Box
      data-testid="floating-pause-control"
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        // Above the feed content but below modals (MUI modal = 1300).
        zIndex: (theme) => theme.zIndex.fab,
        display: 'flex',
        alignItems: 'center',
        px: 0.5,
        bgcolor: 'rgba(13, 17, 23, 0.95)',
        border: '1px solid',
        borderColor: isPaused ? '#d29922' : '#21262d',
        borderRadius: 999,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(6px)',
        animation: isPaused ? `${pausedPulse} 1.6s ease-out infinite` : 'none',
        '@media (prefers-reduced-motion: reduce)': {
          animation: 'none',
        },
      }}
    >
      <PauseResumeControls
        label={operationSummary.tier === 'heavy' ? operationSummary.label : undefined}
        progress={operationSummary.tier === 'heavy' ? operationSummary.progress : undefined}
      />
    </Box>
  );
};

export default FloatingPauseControl;
