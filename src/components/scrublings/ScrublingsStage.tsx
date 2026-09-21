import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Portal, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { keyframes } from '@mui/system';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSetting, updateSetting } from '@features/app/appSlice';
import { SCRUBLINGS, type ScrublingId } from '@features/scrublings/descriptors';
import {
  CHAR_W, MIN_STAGE_W, SLOT_W, STAGE_SCALE, createScheduler, stepScheduler, syncScheduler, viewScheduler,
  type SchedulerState, type StageView,
} from '@features/scrublings/scheduler';
import { selectScrublingsEnabled, selectScrublingsOperationView, selectScrublingsPositions, selectScrublingsVisible } from '@features/scrublings/selectors';
import { frameDataUri, headRow } from '@features/scrublings/spriteRender';
import { SPRITE_FEET_ROW, SPRITE_H } from '@features/scrublings/spriteTypes';
import { setStageSlots } from '@features/scrublings/stageSlots';

const CHAR_H = SPRITE_H * STAGE_SCALE;
/** The rows under the feet hang below the bar's edge so the feet stand on it. */
const FEET_DROP = Math.round((SPRITE_H - SPRITE_FEET_ROW) * STAGE_SCALE);
/** Half the widest caption, roughly. The caption stays this far inside the viewport so it is never cut off. */
const CAPTION_HALF = 66;
/** The caption's line box. */
const CAPTION_H = 12;
const TICK_MS = 80;
const HOLD_MS = 250;
/**
 * The overhead text sits halfway between the top of the bar and the speaker's
 * head, so the space above the text matches the space under it (owner, 2026-09-21).
 */
export const captionTop = (stageHeight: number, speaker: ScrublingId): number => {
  const head = stageHeight + FEET_DROP - CHAR_H + headRow(SCRUBLINGS[speaker].sheet) * STAGE_SCALE;
  return Math.max(1, Math.round((head - CAPTION_H) / 2));
};

/** How long the arrive and leave teleport plays. */
export const TELE_MS = 1100;
interface Tele { key: string; kind: 'in' | 'out'; id: ScrublingId; x: number; frame: string; facing: number; since: number }

// Ancient Magicks, more or less: violet motes wind up around the character
// from the feet, the body flashes pale and stretches thin, and it is gone (or here).
const teleIn = keyframes`
  0% { opacity: 0; transform: translateY(-8px) scale(0.15, 1.5); filter: brightness(4) saturate(0.2) hue-rotate(230deg); }
  55% { opacity: 1; transform: translateY(-2px) scale(0.8, 1.12); filter: brightness(2.2) saturate(0.6) hue-rotate(230deg); }
  100% { opacity: 1; transform: none; filter: none; }
`;
const teleOut = keyframes`
  0% { opacity: 1; transform: none; filter: none; }
  45% { opacity: 1; transform: translateY(-2px) scale(0.8, 1.12); filter: brightness(2.2) saturate(0.6) hue-rotate(230deg); }
  100% { opacity: 0; transform: translateY(-10px) scale(0.1, 1.6); filter: brightness(4) saturate(0.2) hue-rotate(230deg); }
`;
const moteRise = keyframes`
  0% { opacity: 0; transform: translate(var(--from), 0); }
  15% { opacity: 1; }
  50% { transform: translate(var(--to), calc(var(--rise) * -0.5)); }
  85% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--from), calc(var(--rise) * -1)); }
`;
const ringPulse = keyframes`
  0% { opacity: 0; transform: scaleX(0.2); }
  30% { opacity: 0.9; transform: scaleX(1); }
  100% { opacity: 0; transform: scaleX(1.25); }
`;
const MOTES = [
  { color: '#b36bff', from: -11, to: 11, delay: 0 },
  { color: '#6b8cff', from: 11, to: -11, delay: 90 },
  { color: '#e6d2ff', from: -8, to: 9, delay: 200 },
  { color: '#8f5bff', from: 9, to: -8, delay: 310 },
  { color: '#6b8cff', from: -11, to: 10, delay: 420 },
  { color: '#e6d2ff', from: 10, to: -11, delay: 520 },
];

const EMPTY: StageView = { chars: [], caption: null };

interface Pointer { id: ScrublingId; offset: number; startX: number; dragging: boolean; timer: number | null }

/**
 * The Scrublings' stage (2.2.0): fills a bar's free stretch, measures it, and
 * lets the scheduler place up to three picked characters on the bar's bottom
 * edge. The stretch wraps around: walk off the right door and come back in
 * the left one. Decorative and hidden from assistive tech; clicks pass
 * through except on a character (hover looks, click plays a trick, hold then
 * drag moves it and remembers where). Freezes on the idle frame when theme
 * animations are off or the OS asks for reduced motion. Never in exports.
 */
const ScrublingsStage = () => {
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
  const [rect, setRect] = useState<{ left: number; top: number; height: number } | null>(null);
  const [teles, setTeles] = useState<Tele[]>([]);
  const lastChars = useRef<StageView['chars']>([]);
  const frozenRef = useRef(false); frozenRef.current = frozen;
  /** Compare who is on the stage with who was, and start a teleport for each arrival and each departure. */
  const noteChars = (chars: StageView['chars'], now: number) => {
    const before = lastChars.current; lastChars.current = chars;
    if (frozenRef.current) return;
    const added: Tele[] = [
      ...chars.filter((c) => !before.some((b) => b.id === c.id)).map((c) => ({ key: `${c.id}-in-${now}`, kind: 'in' as const, id: c.id, x: c.x, frame: c.frame, facing: c.facing, since: now })),
      ...before.filter((b) => !chars.some((c) => c.id === b.id)).map((b) => ({ key: `${b.id}-out-${now}`, kind: 'out' as const, id: b.id, x: b.x, frame: b.frame, facing: b.facing, since: now })),
    ];
    if (added.length) setTeles((prev) => [...prev.filter((t) => now - t.since < TELE_MS && !added.some((a) => a.id === t.id)), ...added]);
  };
  useEffect(() => {
    if (teles.length === 0) return;
    const oldest = Math.min(...teles.map((t) => t.since));
    const timer = window.setTimeout(() => setTeles((prev) => prev.filter((t) => Date.now() - t.since < TELE_MS)), Math.max(0, oldest + TELE_MS - Date.now()) + 20);
    return () => window.clearTimeout(timer);
  }, [teles]);
  useEffect(() => {
    if (!enabled || ids.length === 0 || width <= 0) { sched.current = null; noteChars([], Date.now()); setView(EMPTY); return; }
    const tick = () => {
      const now = Date.now();
      const current = sched.current
        ? syncScheduler(sched.current, ids, width, positionsRef.current, now)
        : createScheduler(ids, width, positionsRef.current, now);
      sched.current = stepScheduler(current, { now, width, op: opRef.current, hover: hover.current, drag: drag.current, clicks: clicks.current, frozen, rng: Math.random });
      clicks.current = [];
      const next = viewScheduler(sched.current, now);
      noteChars(next.chars, now);
      setView(next);
      const r = ref.current?.getBoundingClientRect();
      if (r) setRect((prev) => (prev && prev.left === r.left && prev.top === r.top && prev.height === r.height ? prev : { left: r.left, top: r.top, height: r.height }));
    };
    tick();
    if (frozen) return;
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, ids, width, frozen]);

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
          const arriving = teles.some((t) => t.kind === 'in' && t.id === c.id);
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
                  position: 'absolute', left, bottom: -FEET_DROP, width: CHAR_W, height: CHAR_H,
                  imageRendering: 'pixelated',
                  transform: `translateY(${-c.lift}px) scaleX(${c.facing})`,
                  pointerEvents: 'auto', cursor: 'grab', touchAction: 'none',
                  '&:active': { cursor: 'grabbing' },
                }}
              >
                <Box sx={{ width: '100%', height: '100%', backgroundImage: `url("${uri}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', imageRendering: 'pixelated', transformOrigin: '50% 90%', animation: arriving ? `${teleIn} ${TELE_MS}ms ease-out both` : 'none' }} />
              </Box>
            </Tooltip>
          ));
        })}
        {teles.map((tele) => {
          const feet = FEET_DROP + Math.round((SPRITE_H - SPRITE_FEET_ROW) * STAGE_SCALE);
          return (
            <Box key={tele.key} data-testid={`scrubling-tele-${tele.kind}-${tele.id}`} sx={{ position: 'absolute', left: tele.x, bottom: -FEET_DROP, width: CHAR_W, height: CHAR_H, pointerEvents: 'none' }}>
              {tele.kind === 'out' && (
                <Box sx={{ width: '100%', height: '100%', transform: `scaleX(${tele.facing})` }}>
                  <Box sx={{ width: '100%', height: '100%', backgroundImage: `url("${frameDataUri(SCRUBLINGS[tele.id].sheet, tele.frame)}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', imageRendering: 'pixelated', transformOrigin: '50% 90%', animation: `${teleOut} ${TELE_MS}ms ease-in both` }} />
                </Box>
              )}
              <Box sx={{ position: 'absolute', left: '50%', bottom: feet - 2, width: CHAR_W, height: 4, ml: `${-CHAR_W / 2}px`, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(179,107,255,0.9), rgba(107,140,255,0.35) 60%, transparent)', animation: `${ringPulse} ${TELE_MS}ms ease-out both` }} />
              {MOTES.map((m, i) => (
                <Box key={i} sx={{ position: 'absolute', left: '50%', bottom: feet, width: 3, height: 3, ml: '-1.5px', backgroundColor: m.color, boxShadow: `0 0 4px ${m.color}`, opacity: 0, '--from': `${m.from}px`, '--to': `${m.to}px`, '--rise': `${CHAR_H - feet - 4}px`, animation: `${moteRise} ${TELE_MS - 520}ms linear ${m.delay}ms both` }} />
              ))}
            </Box>
          );
        })}
      </Box>
      {show && view.caption && rect && (
        <Portal>
          <Box
            data-testid="scrublings-caption"
            aria-hidden
            sx={{
              position: 'fixed', left: Math.min(Math.max(rect.left + view.caption.x, CAPTION_HALF), window.innerWidth - CAPTION_HALF), top: rect.top + captionTop(rect.height, view.caption.speaker), transform: 'translateX(-50%)',
              zIndex: theme.zIndex.appBar + 1, pointerEvents: 'none', whiteSpace: 'nowrap',
              // OSRS overhead chat: yellow, no box, a black edge on every side so it reads on any theme.
              color: '#ffff00', font: '700 11px/12px ui-monospace, Menlo, monospace', letterSpacing: '0.02em',
              textShadow: '1px 0 #000, -1px 0 #000, 0 1px #000, 0 -1px #000, 1px 1px #000, -1px -1px #000, 1px -1px #000, -1px 1px #000',
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
