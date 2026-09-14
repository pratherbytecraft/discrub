import { useEffect, useRef } from 'react';
import { REST_BREAK_AFTER_MINUTES, REST_BREAK_LENGTH_MINUTES } from './restBreakConstants';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import {
  selectDiscrubPaused,
  selectRestBreakUntil,
  selectRestBreaksEnabled,
  setDiscrubPaused,
  setRestBreakUntil,
} from '@features/app/appSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { t } from '@/i18n';

/** Active (running, not paused) time before a rest break starts. */
export const REST_BREAK_AFTER_MS = REST_BREAK_AFTER_MINUTES * 60 * 1000;
/** Length of a rest break. */
export const REST_BREAK_LENGTH_MS = REST_BREAK_LENGTH_MINUTES * 60 * 1000;
/** Wall-clock check cadence. Background throttling only delays a tick. */
export const REST_BREAK_TICK_MS = 1000;

/**
 * Automatic rest breaks for long operations (GH #14 follow-up).
 *
 * Until 2.1.2 a background tab's timers were throttled to one tick a
 * minute, which accidentally gave a day-long export a rest every time
 * the user switched away. Worker pacing (#247) removed that, and two
 * suspension reports followed within days. This restores a rest on
 * purpose: after `REST_BREAK_AFTER_MS` of active running time the
 * operation is paused through the ordinary pause flag, which every loop
 * already honors, and resumed `REST_BREAK_LENGTH_MS` later.
 *
 * The user's own pauses don't count as activity. Clicking Resume during
 * a break skips it and restarts the activity clock. Turning the setting
 * off mid-break ends the break.
 */
export function useRestBreaks(): void {
  const dispatch = useAppDispatch();
  const isRunning = useAppSelector(selectIsHeavyOperationRunning);
  const isPaused = useAppSelector(selectDiscrubPaused);
  const enabled = useAppSelector(selectRestBreaksEnabled);
  const breakUntil = useAppSelector(selectRestBreakUntil);

  // Live copies for the interval callback, so one interval spans the
  // whole operation instead of restarting (and losing the accumulated
  // active time) on every state change.
  const pausedRef = useRef(isPaused);
  const enabledRef = useRef(enabled);
  const breakUntilRef = useRef(breakUntil);
  pausedRef.current = isPaused;
  enabledRef.current = enabled;
  breakUntilRef.current = breakUntil;

  useEffect(() => {
    if (!isRunning) {
      if (breakUntilRef.current != null) dispatch(setRestBreakUntil(null));
      return;
    }

    let activeMs = 0;
    let lastTick = Date.now();

    const endBreak = (messageKey: string, level: 'success' | 'info') => {
      dispatch(setRestBreakUntil(null));
      dispatch(addStatusEntry({ level, message: t(messageKey) }));
      activeMs = 0;
    };

    const tick = () => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      const until = breakUntilRef.current;
      if (until != null) {
        if (!pausedRef.current) {
          // The user resumed into the break.
          endBreak('restBreak.skipped', 'info');
        } else if (!enabledRef.current) {
          dispatch(setDiscrubPaused(false));
          endBreak('restBreak.ended', 'success');
        } else if (now >= until) {
          dispatch(setDiscrubPaused(false));
          endBreak('restBreak.ended', 'success');
        }
        return;
      }

      if (!enabledRef.current || pausedRef.current) return;
      activeMs += delta;
      if (activeMs < REST_BREAK_AFTER_MS) return;

      const breakEnd = now + REST_BREAK_LENGTH_MS;
      dispatch(setRestBreakUntil(breakEnd));
      dispatch(setDiscrubPaused(true));
      dispatch(addStatusEntry({
        level: 'warning',
        message: t('restBreak.started', {
          active: Math.round(REST_BREAK_AFTER_MS / 60000),
          minutes: Math.round(REST_BREAK_LENGTH_MS / 60000),
        }),
      }));
    };

    const id = setInterval(tick, REST_BREAK_TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [isRunning, dispatch]);
}
