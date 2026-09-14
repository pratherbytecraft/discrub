import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { CalendarMonth as CalendarIcon } from '@mui/icons-material';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setDialogOpen } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActivePagination } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { getDateLocale } from '@/i18n/dateLocale';
import { dayKeyToDate, type TimelineBar } from '@/utils/timelineDays';
import { useTimeline } from './useTimeline';

const BAR_HEIGHT = 46;
const BAR_GAP = 2;
const MONTH_GAP = 10;

/**
 * The strip (Timeline, 2.2.0): one bar per day (per week or month on long
 * histories), oldest on the left. Hover names the day and its count, a click
 * jumps the feed there, a mouse drag across bars shows only those days (touch taps jump, so the strip can still be swiped). The
 * line above says what the strip covers and how much is loaded.
 */
const TimelineStrip = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarView = useAppSelector(selectSidebarView);
  const pagination = useAppSelector(selectActivePagination);
  const running = useAppSelector(selectOperationSummary).tier === 'heavy';
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const hasContext = !!channel || !!dm;
  const { model, shown, range, setRange, clearRange, jumpTo } = useTimeline();
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  // Mirrors `drag` for the window listener; written in the handlers so it never lags a render behind.
  const dragRef = useRef<{ start: number; end: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = useState(0);
  const dateInput = useRef<HTMLInputElement | null>(null);
  const locale = getDateLocale();
  const fmt = (key: string, pattern: string) => format(dayKeyToDate(key), pattern, { locale });

  const empty = model.total === 0 || !hasContext;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    setStripWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setStripWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  // Newest day stays on screen when the bars are wider than the strip.
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [model.bars.length]);

  // One listener for the life of the strip: a release always ends the drag, however fast the click was.
  const finishRef = useRef<() => void>(() => undefined);
  finishRef.current = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null; setDrag(null);
    const a = model.bars[Math.min(d.start, d.end)]; const b = model.bars[Math.max(d.start, d.end)];
    if (!a || !b) return;
    if (d.start === d.end) jumpTo(a.newestId); else setRange(a.from, b.to);
  };
  useEffect(() => {
    const finish = () => finishRef.current();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => { window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
  }, []);

  if (empty) {
    return (
      <Box data-testid="timeline-strip" sx={{ px: phone ? 1.25 : 2.5, py: 1.25, backgroundColor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="timeline-empty">{sidebarView === 'package' ? t('timeline.packageHint') : t('timeline.emptyHint')}</Typography>
      </Box>
    );
  }

  const max = Math.max(1, ...model.bars.map((b) => b.count));
  const inRange = (b: TimelineBar, i: number) => (drag ? i >= Math.min(drag.start, drag.end) && i <= Math.max(drag.start, drag.end) : !!range && b.to >= range.from && b.from <= range.to);
  const barLabel = (b: TimelineBar) => `${model.unit === 'day' ? fmt(b.from, 'PP') : model.unit === 'week' ? `${fmt(b.from, 'MMM d')} – ${fmt(b.to, 'PP')}` : fmt(b.from, 'LLLL yyyy')} · ${t('timeline.dayCount', { count: b.count })}`;
  // Bars sit in month groups so each month carries one label under its first bar.
  const groups: Array<{ month: string; bars: Array<{ bar: TimelineBar; index: number }> }> = [];
  model.bars.forEach((bar, index) => { const g = groups[groups.length - 1]; if (g && g.month === bar.month) g.bars.push({ bar, index }); else groups.push({ month: bar.month, bars: [{ bar, index }] }); });
  // One width for every bar: as wide as fits, between the minimum (the strip scrolls past that) and 22 px.
  const barWidth = Math.max(phone ? 7 : 5, Math.min(22, Math.floor((stripWidth - (groups.length - 1) * MONTH_GAP) / Math.max(1, model.bars.length)) - BAR_GAP));
  const labelEvery = model.unit === 'month' ? Math.ceil(groups.length / 12) : 1;
  const loadedLine = `${t('timeline.messageCount', { count: model.total })}${pagination.hasMore ? '' : `, ${t('timeline.allLoaded')}`}`;
  const jumpToDate = (value: string) => {
    if (!value) return;
    const hit = [...model.bars].reverse().find((b) => b.from <= value && b.count > 0) ?? model.bars.find((b) => b.count > 0);
    jumpTo(hit?.newestId ?? null);
  };

  return (
    <Box data-testid="timeline-strip" sx={{ px: phone ? 1.25 : 2.5, pt: 1, pb: 0.75, backgroundColor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, minHeight: 26, flexWrap: 'wrap' }}>
        {!phone && (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('timeline.jumpTo')}</Typography>
            <Chip size="small" variant="outlined" label={t('timeline.newest')} data-testid="timeline-jump-newest" onClick={() => jumpTo([...model.bars].reverse().find((b) => b.count > 0)?.newestId ?? null)} />
            <Chip size="small" variant="outlined" label={t('timeline.oldest')} data-testid="timeline-jump-oldest" onClick={() => jumpTo(model.bars.find((b) => b.count > 0)?.newestId ?? null)} />
            <Chip size="small" variant="outlined" icon={<CalendarIcon sx={{ fontSize: 15 }} />} label={t('timeline.pickDate')} data-testid="timeline-pick-date" onClick={() => { const el = dateInput.current; if (!el) return; if (typeof el.showPicker === 'function') el.showPicker(); else el.focus(); }} />
            <Box component="input" type="date" ref={dateInput} min={model.firstDay} max={model.lastDay} aria-label={t('timeline.pickDate')} data-testid="timeline-date-input" onChange={(e: React.ChangeEvent<HTMLInputElement>) => jumpToDate(e.target.value)} sx={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }} />
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }} data-testid="timeline-summary">
          <Box component="b" sx={{ color: 'text.primary', fontWeight: 600 }}>{fmt(model.firstDay, 'MMM d')} – {fmt(model.lastDay, 'PP')}</Box>
          {' · '}{loadedLine}{pagination.hasMore && !running && sidebarView !== 'package' ? ` · ${t('timeline.olderNeedLoadAll')}` : ''}
        </Typography>
      </Box>
      <Box ref={scroller} sx={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'thin' }}>
        <Box data-testid="timeline-bars" onPointerOver={(e: React.PointerEvent) => { const d = dragRef.current; if (!d) return; const el = (e.target as HTMLElement).closest('[data-index]'); if (el) { dragRef.current = { start: d.start, end: Number(el.getAttribute('data-index')) }; setDrag(dragRef.current); } }} sx={{ display: 'flex', alignItems: 'flex-end', gap: `${MONTH_GAP}px`, width: 'max-content', userSelect: 'none', touchAction: 'pan-x' }}>
          {groups.map((g, gi) => (
            <Box key={g.month} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, flexShrink: 0, width: g.bars.length * (barWidth + BAR_GAP) - BAR_GAP }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: `${BAR_GAP}px`, height: BAR_HEIGHT }}>
                {g.bars.map(({ bar, index }) => (
                  <Tooltip key={bar.from} title={barLabel(bar)} arrow placement="top" disableInteractive>
                    <Box
                      role="button" tabIndex={0} aria-label={barLabel(bar)} data-testid="timeline-bar" data-index={index} data-from={bar.from} data-count={bar.count} data-in-range={inRange(bar, index) ? 'true' : 'false'}
                      onPointerDown={(e: React.PointerEvent) => { if (e.pointerType !== 'touch' && e.pointerType !== 'pen' && !e.button) { e.preventDefault(); dragRef.current = { start: index, end: index }; setDrag(dragRef.current); } }}
                      onClick={(e: React.MouseEvent) => { const kind = (e.nativeEvent as PointerEvent).pointerType; if (kind === 'touch' || kind === 'pen') jumpTo(bar.newestId); }}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(bar.newestId); } }}
                      sx={{ flex: 'none', width: barWidth, height: BAR_HEIGHT, display: 'flex', alignItems: 'flex-end', cursor: 'pointer', backgroundColor: inRange(bar, index) ? alpha(theme.palette.primary.main, 0.16) : 'transparent', '&:hover > span, &:focus-visible > span': { backgroundColor: 'text.primary' }, outline: 'none' }}
                    >
                      <Box component="span" sx={{ display: 'block', width: '100%', borderRadius: '2px 2px 0 0', height: bar.count ? Math.max(4, Math.round((bar.count / max) * BAR_HEIGHT)) : 2, backgroundColor: bar.count === 0 ? 'divider' : inRange(bar, index) ? 'primary.main' : alpha(theme.palette.primary.main, 0.55) }} />
                    </Box>
                  </Tooltip>
                ))}
              </Box>
              <Typography variant="caption" noWrap sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.3, overflow: 'visible', minHeight: 14 }}>{gi % labelEvery === 0 && (model.unit === 'month' || g.bars.length * (barWidth + BAR_GAP) >= 44 || gi === groups.length - 1) ? fmt(`${g.month}-01`, model.unit === 'month' ? 'yyyy' : 'MMM yyyy') : ''}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      {range && (
        <Box data-testid="timeline-range" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, px: 1.25, py: 0.5, borderRadius: 1, flexWrap: 'wrap', border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.4), backgroundColor: alpha(theme.palette.primary.main, 0.1) }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmt(range.from, 'MMM d')} – {fmt(range.to, 'PP')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, minWidth: 180 }}>{t('timeline.rangeShown', { shown, total: model.total })}</Typography>
          <Button size="small" onClick={() => dispatch(setDialogOpen({ dialog: 'filters', open: true }))} data-testid="timeline-range-filters" sx={{ textTransform: 'none' }}>{t('timeline.openInFilters')}</Button>
          <Button size="small" onClick={clearRange} data-testid="timeline-range-clear" sx={{ textTransform: 'none' }}>{t('timeline.clearRange')}</Button>
        </Box>
      )}
    </Box>
  );
};

export default TimelineStrip;
