import { useLayoutEffect, useState, type RefObject } from 'react';
import { Box, Portal, useMediaQuery, useTheme } from '@mui/material';
import { keyframes } from '@mui/system';
import { useAppSelector } from '@/app/hooks';
import { selectSeasonalNoticeTheme } from '@features/appearance/noticeSlice';
import { SCRUBLINGS, type ScrublingId } from '@features/scrublings/descriptors';
import { frameDataUri } from '@features/scrublings/spriteRender';
import { SPRITE_H, SPRITE_W } from '@features/scrublings/spriteTypes';
import { OVERHEAD_TEXT_SX } from '@components/scrublings/overheadText';

/** Which Scrubling drops from the button for a holiday theme, and what it says. The short line is for a narrow bar. */
const NOTICES: Record<string, { scrubling: ScrublingId; frame: string; line: string; shortLine: string }> = {
  'halloween-26': { scrubling: 'spider', frame: 'dangle1', line: "Halloween '26 is in.", shortLine: "Halloween '26" },
};

const sway = keyframes`from { transform: rotate(-4deg); } to { transform: rotate(4deg); }`;
const SCALE = 2;

/**
 * The seasonal notice (2.2.3): the holiday Scrubling hangs on its thread from
 * the bottom edge of the Appearance button and says the holiday theme is in,
 * in the same overhead text the Scrublings use on the bar. Shown for
 * everyone while the theme is in season, until the button is clicked once
 * (AppearanceButton marks it seen and opens on the Theme tab). It never
 * takes clicks and never changes anyone's theme. Sways on a slow loop,
 * still under reduced motion.
 */
const SeasonalNotice = ({ anchor }: { anchor: RefObject<HTMLElement> }) => {
  const theme = useTheme();
  const notice = useAppSelector(selectSeasonalNoticeTheme);
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Follow the button: it moves when the bar reflows (the Scrublings stage claims its room after
  // mount, a drawer opens, the window resizes). A body resize observer catches most of that and a
  // slow poll catches the rest; one rectangle twice a second costs nothing, and a same-position
  // read never re-renders.
  useLayoutEffect(() => {
    if (!notice) return;
    const measure = () => {
      const next = anchor.current?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && next && prev.left === next.left && prev.bottom === next.bottom && prev.width === next.width ? prev : next));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    if (anchor.current && ro) ro.observe(anchor.current);
    window.addEventListener('resize', measure);
    const poll = window.setInterval(measure, 500);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); window.clearInterval(poll); };
  }, [anchor, notice, compact]);

  const spec = notice ? NOTICES[notice.id] : undefined;
  if (!notice || !spec || !rect) return null;
  const sheet = SCRUBLINGS[spec.scrubling].sheet;
  const w = SPRITE_W * SCALE, h = SPRITE_H * SCALE;
  const x = Math.round(rect.left + rect.width * 0.72);
  const text = compact ? spec.shortLine : spec.line;
  return (
    <Portal>
      <Box
        data-testid="seasonal-notice"
        data-theme-id={notice.id}
        aria-hidden
        sx={{
          position: 'fixed', left: x, top: Math.round(rect.bottom) - 6, zIndex: theme.zIndex.appBar + 1, pointerEvents: 'none',
          transformOrigin: '0 0', animation: reducedMotion ? 'none' : `${sway} 3.2s ease-in-out infinite alternate`,
        }}
      >
        <Box sx={{ width: w, height: h, ml: `${-Math.round(w / 2)}px`, backgroundImage: `url("${frameDataUri(sheet, spec.frame)}")`, backgroundSize: '100% 100%', imageRendering: 'pixelated' }} />
        {/* Beside the spider on a wide bar; under it and right aligned on a narrow one, where the button sits near the edge. */}
        <Box data-testid="seasonal-notice-line" sx={{ ...OVERHEAD_TEXT_SX, position: 'absolute', ...(compact ? { left: Math.round(w / 2), top: h - 2, transform: 'translateX(-100%)' } : { left: Math.round(w / 2) + 2, top: Math.round(h * 0.5) }) }}>
          {text}
        </Box>
      </Box>
    </Portal>
  );
};

export default SeasonalNotice;
