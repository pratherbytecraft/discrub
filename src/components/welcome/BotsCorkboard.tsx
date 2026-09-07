import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Collapse, IconButton, Link, Typography, Tooltip } from '@mui/material';
import {
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  ExpandMore as ExpandIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { storage } from '@/extension/storage';
import { BOTS, BOT_IDEA_MAILTO, CORKBOARD_COLLAPSED_STORAGE_KEY, type BotEntry } from './bots';
import RetrostatMark from './RetrostatMark';
import ScourMark from './ScourMark';
import VestedMark from './VestedMark';
import DeveloperCard from './DeveloperCard';
import { Trans } from 'react-i18next';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';

/**
 * "What else we make": a pinboard strip on the WelcomePanel showing the
 * Prather Bytecraft Discord bots. Deliberately styled unlike the feature
 * cards (those are what Discrub does) so it reads as a board, not a banner.
 *
 * - Data-driven from `bots.ts`; one carousel slot showing the active bot's
 *   card on top of a stack of paper backs (so the slot visibly holds more
 *   than one card), the developer's card (`DeveloperCard`: avatar, name,
 *   Follow link), plus sticky notes.
 * - Collapsible; the folded state persists in `Discrub-state` and the board
 *   never re-expands on its own.
 * - Gentle auto-rotate: pauses on hover, waits out a longer grace after a
 *   manual pick, and sits still under prefers-reduced-motion.
 * - A red thread runs from each bot's sticker note to that bot's pin, drawn
 *   as an SVG overlay from measured pin positions (re-measured on resize).
 */

const MARKS: Record<string, (size: number) => React.ReactNode> = {
  retrostat: (size) => <RetrostatMark size={size} />,
  scour: (size) => <ScourMark size={size} />,
  vested: (size) => <VestedMark size={size} />,
};

/** Small seeded tilt so the pins look hand-placed but never move between renders. */
const tiltFor = (index: number) => [-1.6, 1.2, -0.8, 1.8][index % 4];

/** How long a bot holds the carousel slot before it flips on its own. */
const AUTO_ADVANCE_MS = 7000;

/**
 * After a manual pick, how long the rotation waits before resuming. Long
 * enough to read the chosen card in peace, short enough that the board
 * doesn't die the first time someone touches it (owner ask 2026-08-31).
 */
const MANUAL_RESUME_MS = 20000;

/**
 * Animates to its content's measured height so bot flips glide instead of
 * jumping (cards and stickies differ per bot). Height stays `auto` where
 * ResizeObserver is missing (jsdom), so tests and old hosts see no change.
 */
const AnimatedHeight = ({ children }: { children: React.ReactNode }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Box sx={{ height, transition: 'height 240ms ease', overflow: 'visible' }}>
      <Box ref={innerRef}>{children}</Box>
    </Box>
  );
};

const Pin = ({ id }: { id?: string }) => (
  <Box
    aria-hidden
    data-pin={id}
    sx={{
      position: 'absolute',
      top: -7,
      left: '50%',
      width: 14,
      height: 14,
      ml: '-7px',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 35%, #ff8a80, #c62828 70%)',
      boxShadow: '0 2px 3px rgba(0,0,0,0.45)',
    }}
  />
);

const PinnedCard = ({ bot, index, active = true }: { bot: BotEntry; index: number; active?: boolean }) => (
  <Box
    data-testid={active ? `corkboard-bot-${bot.id}` : `corkboard-bot-${bot.id}-stowed`}
    sx={{
      position: 'relative',
      width: { xs: '100%', sm: 300 },
      p: 2,
      pt: 2.25,
      borderRadius: 1,
      bgcolor: 'background.paper',
      color: 'text.primary',
      transform: `rotate(${tiltFor(index)}deg)`,
      transition: 'transform 160ms ease, box-shadow 160ms ease',
      boxShadow: '0 6px 14px rgba(0,0,0,0.35)',
      '&:hover': {
        transform: `rotate(${tiltFor(index)}deg) translateY(-3px)`,
        boxShadow: '0 10px 20px rgba(0,0,0,0.4)',
      },
    }}
  >
    <Pin id={`bot-${bot.id}`} />
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
      {MARKS[bot.id]?.(40)}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {bot.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
          {bot.tagline}
        </Typography>
      </Box>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5, mb: 1.25 }}>
      {bot.pitch}
    </Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
      {bot.chips.map((chip) => (
        <Chip key={chip} label={chip} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
      ))}
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Button
        variant="contained"
        size="small"
        component="a"
        href={bot.installUrl}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        {translate('corkboard.addToDiscord')}
      </Button>
      <Link
        href={bot.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem', fontWeight: 600 }}
      >
        Learn more <OpenIcon sx={{ fontSize: 14 }} />
      </Link>
    </Box>
  </Box>
);

interface StickyNoteProps {
  testId: string;
  tilt: number;
  tint: string;
  pinId?: string;
  children: React.ReactNode;
}

const StickyNote = ({ testId, tilt, tint, pinId, children }: StickyNoteProps) => (
  <Box
    data-testid={testId}
    sx={{
      position: 'relative',
      width: { xs: '100%', sm: 190 },
      alignSelf: { xs: 'stretch', sm: 'flex-start' },
      p: 1.75,
      pt: 2,
      bgcolor: tint,
      color: '#2b2400',
      transform: `rotate(${tilt}deg)`,
      boxShadow: '0 6px 12px rgba(0,0,0,0.3)',
      fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
      fontSize: '0.9rem',
      lineHeight: 1.35,
      '& a': { color: 'inherit', fontWeight: 700, textDecorationThickness: 2 },
    }}
  >
    <Pin id={pinId} />
    {children}
  </Box>
);

interface Thread {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Measures the pins named in `pairs` relative to the board and returns one
 * thread per pair that resolved. Re-measures whenever the board resizes
 * (wrapping changes pin positions) and hides nothing on failure: a pair whose
 * pins are missing just has no thread.
 */
const useThreads = (boardRef: React.RefObject<HTMLDivElement | null>, pairs: [string, string][], active: boolean) => {
  const [threads, setThreads] = useState<Thread[]>([]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board || !active) {
      setThreads([]);
      return;
    }
    const measure = () => {
      const origin = board.getBoundingClientRect();
      const center = (id: string) => {
        const el = board.querySelector<HTMLElement>(`[data-pin="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - origin.left, y: r.top + r.height / 2 - origin.top };
      };
      setThreads(
        pairs.flatMap(([from, to]) => {
          const a = center(from);
          const b = center(to);
          return a && b ? [{ from, to, x1: a.x, y1: a.y, x2: b.x, y2: b.y }] : [];
        })
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [boardRef, pairs, active]);

  return threads;
};

/** Slack the thread like real string: a quadratic curve sagging below the pins. */
const threadPath = ({ x1, y1, x2, y2 }: Thread) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sag = 10 + Math.hypot(dx, dy) * 0.06;
  const cx = (x1 + x2) / 2;
  const cy = Math.max(y1, y2) + sag;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
};

const Threads = ({ threads }: { threads: Thread[] }) => (
  <Box
    component="svg"
    aria-hidden
    data-testid="corkboard-threads"
    sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
  >
    {threads.map((thread) => (
      <g key={`${thread.from}->${thread.to}`} data-testid={`corkboard-thread-${thread.from}-${thread.to}`}>
        <path d={threadPath(thread)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={2.5} transform="translate(0 1.5)" />
        <path d={threadPath(thread)} fill="none" stroke="#c62828" strokeWidth={1.6} strokeLinecap="round" />
      </g>
    ))}
  </Box>
);

const BotsCorkboard = () => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Bumped by every manual pick; the rotation effect restarts and waits the
  // longer MANUAL_RESUME_MS grace before flipping again.
  const [interactions, setInteractions] = useState(0);
  const [hovered, setHovered] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const open = loaded && !collapsed;
  const activeBot = BOTS[Math.min(activeIndex, BOTS.length - 1)];
  // One carousel slot: only the active bot's card is pinned, so only its
  // sticker (when it has one) gets a thread.
  const threadPairs = useMemo<[string, string][]>(
    () => (activeBot?.sticker ? [[`sticky-${activeBot.id}`, `bot-${activeBot.id}`]] : []),
    [activeBot],
  );
  const threads = useThreads(boardRef, threadPairs, open);

  useEffect(() => {
    let cancelled = false;
    storage.state
      .get<boolean>(CORKBOARD_COLLAPSED_STORAGE_KEY)
      .then((value) => {
        if (!cancelled) setCollapsed(Boolean(value));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    storage.state.set(CORKBOARD_COLLAPSED_STORAGE_KEY, next).catch(() => {});
  };

  // Gentle auto-rotate (owner ask 2026-08-30): flips on its own, pauses
  // while the pointer is over the board, waits out a longer grace after a
  // manual pick instead of stopping for good (owner ask 2026-08-31), and
  // sits still for anyone who asked their OS for reduced motion.
  useEffect(() => {
    if (!open || hovered || BOTS.length < 2) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setActiveIndex((i) => (i + 1) % BOTS.length);
      timer = setTimeout(tick, AUTO_ADVANCE_MS);
    };
    timer = setTimeout(tick, interactions > 0 ? MANUAL_RESUME_MS : AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [open, hovered, interactions]);

  if (BOTS.length === 0 || !activeBot) return null;
  const showControls = BOTS.length > 1;
  const step = (delta: number) => {
    setInteractions((n) => n + 1);
    setActiveIndex((i) => (i + delta + BOTS.length) % BOTS.length);
  };
  const jumpTo = (index: number) => {
    setInteractions((n) => n + 1);
    setActiveIndex(index);
  };

  return (
    <Box data-testid="bots-corkboard" sx={{ mb: 5, maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('corkboard.title')}
        </Typography>
        <Tooltip title={collapsed ? t('corkboard.showBoard') : t('corkboard.hideBoard')}>
          <IconButton
            size="small"
            onClick={toggle}
            aria-label={collapsed ? t('corkboard.showBoard') : t('corkboard.hideBoard')}
            aria-expanded={!collapsed}
            sx={{
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 160ms ease',
            }}
          >
            <ExpandIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <Collapse in={open} timeout={160} unmountOnExit>
        <AnimatedHeight>
        <Box
          ref={boardRef}
          data-testid="corkboard-board"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          sx={(theme) => ({
            position: 'relative',
            width: 'fit-content',
            maxWidth: '100%',
            mx: 'auto',
            minWidth: { sm: 560 },
            p: { xs: 2, sm: 3 },
            pt: { xs: 3, sm: 3.5 },
            borderRadius: 2,
            border: '6px solid',
            borderColor: theme.palette.mode === 'dark' ? '#4a3524' : '#8a6a4a',
            backgroundColor: theme.palette.mode === 'dark' ? '#7a5a3c' : '#c9a57c',
            backgroundImage:
              'radial-gradient(rgba(0,0,0,0.18) 1px, transparent 1.4px), radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1.4px)',
            backgroundSize: '9px 9px, 13px 13px',
            backgroundPosition: '0 0, 4px 6px',
            boxShadow: 'inset 0 0 40px rgba(0,0,0,0.25)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            gap: { xs: 3, sm: 4 },
          })}
        >
          <Threads threads={threads} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, width: { xs: '100%', sm: 'auto' } }}>
            <Box sx={{ position: 'relative', display: 'grid' }}>
              {/* Paper backs peeking out behind the active card, one per
                  other bot (capped at two), so the slot visibly holds a
                  stack — the "there's more here" cue the lone card lacked. */}
              {showControls &&
                [
                  { rotate: 3.2, x: 9, y: 5 },
                  { rotate: -2.4, x: -8, y: 9 },
                ]
                  .slice(0, Math.min(2, BOTS.length - 1))
                  .map((back) => (
                    <Box
                      key={`${back.rotate}`}
                      aria-hidden
                      data-testid="corkboard-stack-back"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                        filter: 'brightness(0.72)',
                        transform: `rotate(${back.rotate}deg) translate(${back.x}px, ${back.y}px)`,
                        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                      }}
                    >
                      <Pin />
                    </Box>
                  ))}
              {/* Every card occupies the same grid cell, so the slot always
                  reserves the tallest bot's height and the board never
                  grows or shrinks on a flip (owner ask 2026-08-31). The
                  inactive cards are invisible, inert, and out of the
                  accessibility tree; the flip is a crossfade. */}
              {BOTS.map((bot, index) => {
                const active = index === activeIndex;
                return (
                  <Box
                    key={bot.id}
                    aria-hidden={!active}
                    style={{ visibility: active ? 'visible' : 'hidden' }}
                    sx={{
                      gridArea: '1 / 1',
                      position: 'relative',
                      opacity: active ? 1 : 0,
                      transition: 'opacity 220ms ease, visibility 220ms',
                      pointerEvents: active ? 'auto' : 'none',
                    }}
                  >
                    <PinnedCard bot={bot} index={index} active={active} />
                  </Box>
                );
              })}
            </Box>
            {showControls && (
              <Box
                data-testid="corkboard-carousel-controls"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.75,
                  alignSelf: 'center',
                  width: 'fit-content',
                  mx: 'auto',
                  // The stack's lower paper back reaches ~9px below the slot,
                  // so the plaque needs its own clearance on top of the
                  // column gap.
                  mt: 1.5,
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 999,
                  bgcolor: 'background.paper',
                  boxShadow: '0 6px 14px rgba(0,0,0,0.35)',
                }}
              >
                <IconButton
                  size="small"
                  onClick={() => step(-1)}
                  aria-label={t('corkboard.previousBot')}
                  data-testid="corkboard-prev"
                  sx={{
                    color: '#3d2f10',
                    bgcolor: '#f7ecd8',
                    border: '1px solid rgba(0,0,0,0.3)',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.45)',
                    '&:hover': { bgcolor: '#fff8e8', color: '#1f1703' },
                  }}
                >
                  <PrevIcon fontSize="small" />
                </IconButton>
                {BOTS.map((bot, index) => (
                  <Box
                    key={bot.id}
                    component="button"
                    type="button"
                    onClick={() => jumpTo(index)}
                    aria-label={t('corkboard.showBot', { name: bot.name })}
                    aria-current={index === activeIndex}
                    data-testid={`corkboard-dot-${bot.id}`}
                    sx={{
                      width: 11,
                      height: 11,
                      p: 0,
                      borderRadius: '50%',
                      border: '1px solid rgba(0,0,0,0.4)',
                      cursor: 'pointer',
                      background:
                        index === activeIndex
                          ? 'radial-gradient(circle at 35% 35%, #ff8a80, #c62828 70%)'
                          : 'rgba(255,255,255,0.28)',
                      boxShadow: index === activeIndex ? '0 1px 2px rgba(0,0,0,0.45)' : 'none',
                    }}
                  />
                ))}
                <IconButton
                  size="small"
                  onClick={() => step(1)}
                  aria-label={t('corkboard.nextBot')}
                  data-testid="corkboard-next"
                  sx={{
                    color: '#3d2f10',
                    bgcolor: '#f7ecd8',
                    border: '1px solid rgba(0,0,0,0.3)',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.45)',
                    '&:hover': { bgcolor: '#fff8e8', color: '#1f1703' },
                  }}
                >
                  <NextIcon fontSize="small" />
                </IconButton>
                <Typography
                  variant="caption"
                  data-testid="corkboard-counter"
                  sx={{
                    ml: 0.5,
                    color: '#f7ecd8',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textShadow: '0 1px 2px rgba(0,0,0,0.55)',
                    userSelect: 'none',
                  }}
                >
                  {activeIndex + 1} / {BOTS.length}
                </Typography>
              </Box>
            )}
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              mt: { xs: 0, sm: 1.5 },
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            {/* Same fixed-size trick as the card slot: every sticker note
                shares one grid cell, so a stickerless bot leaves a quiet
                gap instead of reflowing the column. */}
            {BOTS.some((bot) => bot.sticker) && (
              <Box sx={{ display: 'grid' }}>
                {BOTS.filter((bot) => bot.sticker).map((bot) => {
                  const active = bot.id === activeBot.id;
                  return (
                    <Box
                      key={bot.id}
                      aria-hidden={!active}
                      style={{ visibility: active ? 'visible' : 'hidden' }}
                      sx={{
                        gridArea: '1 / 1',
                        opacity: active ? 1 : 0,
                        transition: 'opacity 220ms ease, visibility 220ms',
                        pointerEvents: active ? 'auto' : 'none',
                      }}
                    >
                      <StickyNote
                        testId={active ? 'corkboard-sticky' : `corkboard-sticky-${bot.id}-stowed`}
                        tilt={2.2}
                        tint="#fff3a3"
                        pinId={`sticky-${bot.id}`}
                      >
                        {bot.sticker}
                      </StickyNote>
                    </Box>
                  );
                })}
              </Box>
            )}
            <StickyNote testId="corkboard-idea" tilt={-1.5} tint="#b9e6ff">
              <Trans i18nKey="corkboard.ideaPrompt" components={{ idea: <Link href={BOT_IDEA_MAILTO} underline="always" /> }} />
            </StickyNote>
          </Box>
          <DeveloperCard pin={<Pin />} tilt={1.4} />
        </Box>
        </AnimatedHeight>
      </Collapse>
    </Box>
  );
};

export default BotsCorkboard;
