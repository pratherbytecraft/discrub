import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Box, Portal, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSetting, updateSetting } from '@features/app/appSlice';
import { SCRUBLINGS, type ScrublingId } from '@features/scrublings/descriptors';
import {
  CHAR_W, MIN_STAGE_W, SLOT_W, createScheduler, stepScheduler, syncScheduler, viewScheduler,
  type SchedulerState, type StageView,
} from '@features/scrublings/scheduler';
import { selectScrublingsEnabled, selectScrublingsOperationView, selectScrublingsPositions, selectScrublingsVisible } from '@features/scrublings/selectors';
import { frameDataUri } from '@features/scrublings/spriteRender';
import { SPRITE_H } from '@features/scrublings/spriteTypes';
import { setStageSlots } from '@features/scrublings/stageSlots';

const CHAR_H = SPRITE_H * 2;
const TICK_MS = 80;
const HOLD_MS = 250;
const EMPTY: StageView = { chars: [], caption: null };

interface Pointer { id: ScrublingId; offset: number; startX: number; dragging: boolean; timer: number | null }

interface ScrublingsStageProps {
  /** Something sharing the stretch (the bot spotlight). While a character overlaps it, `onObstacleCovered(true)` fires so the bar can fade it. */
  obstacle?: RefObject<HTMLElement | null>;
  onObstacleCovered?: (covered: boolean) => void;
}

/**
 * The Scrublings' stage (2.2.0): fills a bar's free stretch, measures it, and
 * lets the scheduler place up to three picked characters on the bar's bottom
 * edge. The stretch wraps around: walk off the right door and come back in
 * the left one. Decorative and hidden from assistive tech; clicks pass
 * through except on a character (hover looks, click plays a trick, hold then
 * drag moves it and remembers where). Freezes on the idle frame when theme
 * animations are off or the OS asks for reduced motion. Never in exports.
 * Given an obstacle, reports whenever a character is passing over it.
 */
const ScrublingsStage = ({ obstacle, onObstacleCovered }: ScrublingsStageProps = {}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const enabled = useAppSelector(selectScrublingsEnabled);
  const visible = useAppSelector(selectScrublingsVisible);
  const positions = useAppSelector(selectScrublingsPositions);
  const op = useAppSelector(selectScrublingsOperationView);
  const animations = useAppSelector(selectSetting(DiscrubSetting.APP_THEME_ANIMATIONS));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // A phone shows one at most, however wide the stretch happens to be (owner, 2026-09-19).
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const frozen = animations === 'false' || reducedMotion;

  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const slots = width < MIN_STAGE_W ? 0 : Math.min(phone ? 1 : Infinity, Math.floor(width / SLOT_W));
  useEffect(() => { setStageSlots(slots); return () => setStageSlots(null); }, [slots]);
  const idsKey = visible.slice(0, slots).join(',');
  const ids = useMemo(() => (idsKey ? (idsKey.split(',') as ScrublingId[]) : []), [idsKey]);

  const sched = useRef<SchedulerState | null>(null);
  const pointer = useRef<Pointer | null>(null);
  const hover = useRef<ScrublingId | null>(null);
  const drag = useRef<{ id: ScrublingId; x: number } | null>(null);
  const clicks = useRef<ScrublingId[]>([]);
  const opRef = useRef(op); opRef.current = op;
  const positionsRef = useRef(positions); positionsRef.current = positions;
  const [view, setView] = useState<StageView>(EMPTY);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);
  const coveredRef = useRef(false);
  const onCoveredRef = useRef(onObstacleCovered); onCoveredRef.current = onObstacleCovered;
  const reportCovered = (covered: boolean) => {
    if (coveredRef.current === covered) return;
    coveredRef.current = covered;
    onCoveredRef.current?.(covered);
  };

  useEffect(() => {
    if (!enabled || ids.length === 0 || width <= 0) { sched.current = null; setView(EMPTY); reportCovered(false); return; }
    const tick = () => {
      const now = Date.now();
      const current = sched.current
        ? syncScheduler(sched.current, ids, width, positionsRef.current, now)
        : createScheduler(ids, width, positionsRef.current, now);
      sched.current = stepScheduler(current, { now, width, op: opRef.current, hover: hover.current, drag: drag.current, clicks: clicks.current, frozen, rng: Math.random });
      clicks.current = [];
      const next = viewScheduler(sched.current, now);
      setView(next);
      const r = ref.current?.getBoundingClientRect();
      if (r) setRect((prev) => (prev && prev.left === r.left && prev.top === r.top ? prev : { left: r.left, top: r.top }));
      // Is anyone standing on the obstacle? Both rects share the viewport, so
      // the obstacle's span is taken relative to the stage's left edge. The
      // wrap-around copy near the right door counts too.
      const o = obstacle?.current?.getBoundingClientRect();
      if (r && o && o.width > 0) {
        const ox = o.left - r.left;
        const covered = next.chars.some((c) => {
          const lefts = c.x > width - CHAR_W ? [c.x, c.x - width] : [c.x];
          return lefts.some((x) => x < ox + o.width && x + CHAR_W > ox);
        });
        reportCovered(covered);
      } else {
        reportCovered(false);
      }
    };
    tick();
    if (frozen) return;
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, ids, width, frozen, obstacle]);
  useEffect(() => () => reportCovered(false), []);

  const onDown = (id: ScrublingId, x: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    const p: Pointer = { id, offset: e.clientX - left - x, startX: e.clientX, dragging: false, timer: null };
    p.timer = window.setTimeout(() => { p.dragging = true; drag.current = { id, x }; }, HOLD_MS);
    pointer.current = p;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p) return;
    if (!p.dragging && Math.abs(e.clientX - p.startX) > 4) { if (p.timer) window.clearTimeout(p.timer); p.dragging = true; }
    if (!p.dragging) return;
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    drag.current = { id: p.id, x: e.clientX - left - p.offset };
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p) return;
    if (p.timer) window.clearTimeout(p.timer);
    pointer.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (p.dragging && drag.current) {
      const fraction = Math.min(1, Math.max(0, (((drag.current.x % width) + width) % width + CHAR_W / 2) / width));
      dispatch(updateSetting({ key: DiscrubSetting.APP_SCRUBLINGS_POSITIONS, value: JSON.stringify({ ...positionsRef.current, [p.id]: Number(fraction.toFixed(4)) }) }));
    } else {
      clicks.current = [...clicks.current, p.id];
    }
    drag.current = null;
  };

  const show = enabled && ids.length > 0;
  return (
    <>
      <Box
        ref={ref}
        aria-hidden
        data-testid="scrublings-stage"
        data-count={show ? view.chars.length : 0}
        data-frozen={frozen ? 'true' : 'false'}
        sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', userSelect: 'none' }}
      >
        {show && ['left', 'right'].map((side) => (
          <Box key={side} data-testid={`scrublings-door-${side}`} sx={{ position: 'absolute', [side]: 0, top: 8, bottom: 8, width: 2, bgcolor: 'primary.main', opacity: 0.25 }} />
        ))}
        {show && view.chars.flatMap((c) => {
          const d = SCRUBLINGS[c.id];
          const uri = frameDataUri(d.sheet, c.frame);
          const lefts = c.x > width - CHAR_W ? [c.x, c.x - width] : [c.x];
          return lefts.map((left, i) => (
            <Tooltip key={`${c.id}-${i}`} title={t(`scrublings.names.${c.id}`)} placement="bottom" enterDelay={400} arrow>
              <Box
                data-testid={`scrubling-${c.id}`}
                data-frame={c.frame}
                data-set={c.set}
                onPointerEnter={() => { hover.current = c.id; }}
                onPointerLeave={() => { if (hover.current === c.id) hover.current = null; }}
                onPointerDown={onDown(c.id, c.x)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                sx={{
                  position: 'absolute', left, bottom: -4, width: CHAR_W, height: CHAR_H,
                  backgroundImage: `url("${uri}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
                  imageRendering: 'pixelated',
                  transform: `translateY(${-c.lift}px) scaleX(${c.facing})`,
                  pointerEvents: 'auto', cursor: 'grab', touchAction: 'none',
                  '&:active': { cursor: 'grabbing' },
                }}
              />
            </Tooltip>
          ));
        })}
      </Box>
      {show && view.caption && rect && (
        <Portal>
          <Box
            data-testid="scrublings-caption"
            aria-hidden
            sx={{
              position: 'fixed', left: rect.left + view.caption.x, top: rect.top + 1, transform: 'translateX(-50%)',
              zIndex: theme.zIndex.tooltip - 1, pointerEvents: 'none', whiteSpace: 'nowrap',
              bgcolor: '#f7fbff', color: '#070a0f', border: '2px solid #070a0f', borderRadius: '3px', px: 0.6, py: 0,
              font: '700 10px ui-monospace, Menlo, monospace', letterSpacing: '0.02em',
            }}
          >
            {view.caption.text}
          </Box>
        </Portal>
      )}
    </>
  );
};

export default ScrublingsStage;
