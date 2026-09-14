import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import {
  Typography, Box, IconButton, Tooltip, Chip, CircularProgress, Collapse, keyframes,
} from '@mui/material';
import {
  Terminal as TerminalIcon,
  DeleteSweep as ClearIcon,
  Download as DownloadIcon,
  UnfoldMore as ExpandIcon,
  UnfoldLess as CollapseIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectStatusEntries, selectStatusCount, clearStatusLog, getCurrentSessionId } from '@features/status/statusSlice';
import { groupEntriesBySession, LEGACY_SESSION_ID } from '@features/status/statusGrouping';
import { storage } from '@/extension/storage';
import { selectOperationSummary, type OperationSummary } from '@features/app/operationSelectors';
import type { StatusLevel, StatusLogEntry } from '@features/status/statusTypes';
import PauseResumeControls from './PauseResumeControls';
import OperationTip from './OperationTip';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 50;
const PANEL_HEIGHT = 150;
/** Reserved viewport space so the panel can never push the rest of the app off-screen. */
const MAX_VIEWPORT_OFFSET = 80;
/** Persisted user preference for panel height (#136). Lives in `Discrub-state` IDB. */
const HEIGHT_STORAGE_KEY = 'statusLogHeight';

function clampPanelHeight(value: number): number {
  const max = Math.max(PANEL_HEIGHT, window.innerHeight - MAX_VIEWPORT_OFFSET);
  return Math.max(PANEL_HEIGHT, Math.min(value, max));
}

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
`;

// One colour per operation state (A4), shared with PauseResumeControls.
const STATUS_DOT: Record<OperationSummary['stateColor'], string> = { neutral: '#8b949e', success: '#3fb950', warning: '#d29922', info: '#58a6ff', error: '#f85149' };

const levelPrefixes: Record<StatusLevel, string> = {
  info: '[INFO]',
  warning: '[WARN]',
  error: '[ERR]',
  success: '[OK]',
  session: '[SESSION]',
};

const terminalColors: Record<StatusLevel, string> = {
  info: '#8b949e',
  warning: '#d29922',
  error: '#f85149',
  success: '#3fb950',
  session: '#bc8cff',
};

// #183: one shared formatter — toLocaleTimeString() constructs an
// Intl.DateTimeFormat on every call, which profiled as the single
// hottest leaf during a high-rate operation (7% of total CPU).
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const formatTime = (ts: number) => timeFormatter.format(ts);

/**
 * One terminal log line. Memoized (#183): appending an entry must not
 * re-render every already-visible row — with rows re-rendering per push,
 * a high-rate operation (reactions purge logs each removal) spent more
 * main-thread time re-creating identical rows than doing its own work.
 * Entry objects are immutable in the store, so identity comparison is
 * exact; only the previous last row (loses the cursor) and the new one
 * actually re-render.
 */
const EntryRow = memo(({ entry, isLast }: { entry: StatusLogEntry; isLast: boolean }) => {
  const isSession = entry.level === 'session';
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.75,
        py: '1px',
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: '0.68rem',
        lineHeight: 1.5,
        ...(isSession && {
          borderTop: '1px solid #21262d',
          borderBottom: '1px solid #21262d',
          my: 0.25,
          py: '3px',
          bgcolor: 'rgba(188, 140, 255, 0.04)',
        }),
      }}
    >
      <Box
        component="span"
        sx={{ color: '#484f58', flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {formatTime(entry.timestamp)}
      </Box>
      <Box
        component="span"
        sx={{
          color: terminalColors[entry.level],
          flexShrink: 0,
          fontWeight: 600,
          minWidth: 65,
        }}
      >
        {levelPrefixes[entry.level]}
      </Box>
      <Box
        component="span"
        sx={{ color: isSession ? '#bc8cff' : '#c9d1d9' }}
      >
        {entry.message}
        {isLast && (
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              width: 6,
              height: 12,
              bgcolor: '#58a6ff',
              ml: 0.5,
              verticalAlign: 'middle',
              animation: `${blink} 1s step-end infinite`,
            }}
          />
        )}
      </Box>
    </Box>
  );
});
EntryRow.displayName = 'EntryRow';

/**
 * Terminal-style status log panel with fixed height.
 * Shows the latest PAGE_SIZE entries, loads more on scroll-up.
 */
interface StatusPanelProps {
  /**
   * When set, the expanded log rises as a sheet over the feed column instead
   * of pushing it up: fixed to the bottom, inset from the left by this many
   * pixels (the shell's navigation width). The collapsed bar is unchanged.
   * (2.2.0, A3)
   */
  sheetInset?: number;
}

const StatusPanel = ({ sheetInset }: StatusPanelProps = {}) => {
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation();
  const entries = useAppSelector(selectStatusEntries);
  const count = useAppSelector(selectStatusCount);
  const operationSummary = useAppSelector(selectOperationSummary);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState(false);
  const sheet = expanded && sheetInset != null;
  const [panelHeight, setPanelHeight] = useState<number>(PANEL_HEIGHT);

  // Hydrate persisted panel height (#136). Clamp to the current viewport
  // so a stored value larger than the visible area doesn't take over.
  useEffect(() => {
    let cancelled = false;
    storage.state
      .get<number>(HEIGHT_STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (typeof stored === 'number' && stored >= PANEL_HEIGHT) {
          setPanelHeight(clampPanelHeight(stored));
        }
      })
      .catch(() => {
        /* missing key or storage failure — keep the default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drag-to-resize handle (#136). Only attached when the panel is open.
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startHeight = panelHeight;
      let lastHeight = startHeight;

      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        // Drag UP grows the panel (deltaY < 0); drag DOWN shrinks it.
        const deltaY = ev.clientY - startY;
        const next = clampPanelHeight(startHeight - deltaY);
        lastHeight = next;
        setPanelHeight(next);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        void storage.state.set(HEIGHT_STORAGE_KEY, lastHeight);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [panelHeight],
  );

  // #183: memoize the window slice itself. A bare `entries.slice(...)` made
  // a fresh array identity every render, so the sessionGroups memo below
  // never hit — O(visibleCount) regrouping on every re-render of the panel
  // (i.e. per status line during long operations).
  const visibleEntries = useMemo(() => entries.slice(-visibleCount), [entries, visibleCount]);
  const hasMore = visibleCount < count;

  // Session grouping (#126): contiguous-by-sessionId. Current session
  // and legacy bucket default to expanded; other identified sessions
  // collapsed by default. User toggles override the defaults per session.
  const sessionGroups = useMemo(() => groupEntriesBySession(visibleEntries), [visibleEntries]);
  const currentSid = getCurrentSessionId();
  const [userToggles, setUserToggles] = useState<Map<string, boolean>>(new Map());

  // Only the current session expands by default. The legacy bucket and
  // any past identified sessions stay collapsed so the panel reads as a
  // live feed; user can click any header to expand history on demand.
  const defaultExpanded = useCallback(
    (sessionId: string) => sessionId === currentSid,
    [currentSid],
  );

  const isSessionExpanded = useCallback(
    (sessionId: string) =>
      userToggles.has(sessionId) ? userToggles.get(sessionId)! : defaultExpanded(sessionId),
    [userToggles, defaultExpanded],
  );

  const toggleSession = useCallback(
    (sessionId: string) => {
      setUserToggles((prev) => {
        const next = new Map(prev);
        const wasExpanded = prev.has(sessionId) ? prev.get(sessionId)! : defaultExpanded(sessionId);
        next.set(sessionId, !wasExpanded);
        return next;
      });
    },
    [defaultExpanded],
  );

  // Last visible entry across expanded groups — gets the blinking cursor.
  const lastVisibleEntryId = useMemo(() => {
    for (let i = sessionGroups.length - 1; i >= 0; i--) {
      const group = sessionGroups[i];
      if (isSessionExpanded(group.sessionId) && group.entries.length > 0) {
        return group.entries[group.entries.length - 1].id;
      }
    }
    return null;
  }, [sessionGroups, isSessionExpanded]);

  // Auto-scroll to bottom when new entries arrive or panel is expanded
  useEffect(() => {
    if (!expanded || !scrollRef.current) return;
    // Delay scroll to allow Collapse animation (350ms) to complete
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, expanded ? 400 : 0);
    return () => clearTimeout(timer);
  }, [entries.length, expanded]);

  // Reset visible count when log is cleared
  useEffect(() => {
    if (count === 0) setVisibleCount(PAGE_SIZE);
  }, [count]);

  // Load more when scrolling near the top
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;
    if (el.scrollTop < 40) {
      const prevHeight = el.scrollHeight;
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, count));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    }
  }, [hasMore, count]);

  // (time formatting hoisted to module scope — see `timeFormatter`)

  return (
    <Box
      data-tour="status-panel"
      data-sheet={sheet ? 'true' : undefined}
      sx={sheet
        ? { position: 'fixed', left: sheetInset, right: 0, bottom: 0, zIndex: 1250, boxShadow: '0 -12px 32px rgba(0, 0, 0, 0.45)', borderTop: '1px solid #30363d', borderTopLeftRadius: 8, overflow: 'hidden' }
        : { position: 'relative' }}
    >
      <OperationTip />
      <Box
        sx={{
          bgcolor: '#0d1117',
          borderTop: '1px solid #21262d',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.5,
            minHeight: 32,
            borderBottom: expanded ? '1px solid #21262d' : 'none',
            cursor: 'pointer',
            userSelect: 'none',
            '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.03)' },
          }}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <TerminalIcon sx={{ fontSize: 16, color: '#8b949e' }} />
          <Typography
            variant="caption"
            sx={{
              fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
              fontWeight: 600,
              color: '#c9d1d9',
              fontSize: '0.7rem',
              letterSpacing: '0.03em',
            }}
          >
            {t('statusPanel.title')}
          </Typography>
          {operationSummary.isRunning && (
            <CircularProgress
              size={12}
              thickness={5}
              variant={operationSummary.isPaused ? 'determinate' : 'indeterminate'}
              value={operationSummary.isPaused ? 100 : undefined}
              sx={{
                color: STATUS_DOT[operationSummary.stateColor],
                flexShrink: 0,
              }}
              aria-label={operationSummary.isPaused ? t('statusPanel.operationPaused') : t('statusPanel.operationInProgress')}
            />
          )}
          {count > 0 && (
            <Chip
              label={count}
              size="small"
              sx={{
                height: 16,
                fontSize: '0.6rem',
                fontFamily: 'monospace',
                bgcolor: 'rgba(139, 148, 158, 0.15)',
                color: '#8b949e',
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          )}
          {operationSummary.tier === 'light' && operationSummary.isRunning && (
            <Typography
              variant="caption"
              sx={{
                color: '#8b949e',
                whiteSpace: 'nowrap',
                fontFamily: 'monospace',
                fontSize: '0.65rem',
              }}
            >
              {operationSummary.label}
            </Typography>
          )}
          <PauseResumeControls
            label={operationSummary.tier === 'heavy' ? operationSummary.label : undefined}
            progress={operationSummary.tier === 'heavy' ? operationSummary.progress : undefined}
          />
          <Box sx={{ flexGrow: 1 }} />
          {count > 0 && (
            <>
              <Tooltip title={t('statusPanel.downloadLog')} enterDelay={0} arrow>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    const logContent = entries
                      .map((entry) => {
                        const time = new Date(entry.timestamp).toISOString();
                        return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}`;
                      })
                      .join('\n');
                    const blob = new Blob([logContent], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `discrub-log-${new Date().toISOString().slice(0, 10)}.log`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#8b949e', p: 0.25, '&:hover': { color: '#58a6ff' } }}
                  aria-label={t('statusPanel.downloadLog')}
                >
                  <DownloadIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('statusPanel.clearLog')} enterDelay={0} arrow>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(clearStatusLog());
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#8b949e', p: 0.25, '&:hover': { color: '#f85149' } }}
                  aria-label={t('statusPanel.clearLog')}
                >
                  <ClearIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title={expanded ? t('statusPanel.collapse') : t('statusPanel.expand')} enterDelay={0} arrow>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => !prev);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{ color: '#8b949e', p: 0.25, '&:hover': { color: '#c9d1d9' } }}
              aria-label={expanded ? t('statusPanel.collapseLog') : t('statusPanel.expandLog')}
            >
              {expanded ? <CollapseIcon sx={{ fontSize: 14 }} /> : <ExpandIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Log content. unmountOnExit (#183): while collapsed, the row
            list must not exist at all — MUI Collapse keeps children
            mounted by default, so every status entry re-rendered up to
            PAGE_SIZE hidden terminal rows during high-rate operations. */}
        <Collapse in={expanded} timeout={350} unmountOnExit>
          {/* Resize handle (#136) — drag up to grow, down to shrink.
              CSS max-height keeps the panel inside the viewport even if
              `panelHeight` was set by an old window size. */}
          <Box
            data-testid="status-panel-resize-handle"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('statusPanel.resize')}
            sx={{
              height: 4,
              cursor: 'ns-resize',
              bgcolor: '#21262d',
              transition: 'background-color 120ms ease',
              '&:hover': { bgcolor: '#58a6ff' },
            }}
          />
          <Box
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="status-panel-scroll"
            data-height={panelHeight}
            sx={{
              height: panelHeight,
              maxHeight: `calc(100vh - ${MAX_VIEWPORT_OFFSET}px)`,
              overflow: 'auto',
              px: 1.5,
              py: 0.5,
              position: 'relative',
              '&::-webkit-scrollbar': { width: 6 },
              '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
              '&::-webkit-scrollbar-thumb': {
                bgcolor: 'rgba(139, 148, 158, 0.2)',
                borderRadius: 3,
                '&:hover': { bgcolor: 'rgba(139, 148, 158, 0.35)' },
              },
            }}
          >
            {count === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', justifyContent: 'center' }}>
                <Typography
                  sx={{
                    color: '#484f58',
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    fontStyle: 'italic',
                  }}
                >
                  {t('statusPanel.empty')}
                </Typography>
              </Box>
            ) : (
              <>
                {hasMore && (
                  <Typography
                    sx={{
                      color: '#484f58',
                      fontFamily: 'monospace',
                      fontSize: '0.65rem',
                      textAlign: 'center',
                      py: 0.25,
                    }}
                  >
                    Scroll up for older entries ({count - visibleCount} more)
                  </Typography>
                )}
                {sessionGroups.map((group) => {
                  const expanded = isSessionExpanded(group.sessionId);
                  const isCurrent = group.sessionId === currentSid;
                  const isLegacy = group.sessionId === LEGACY_SESSION_ID;
                  let headerLabel: string;
                  if (isLegacy) {
                    headerLabel = t('statusPanel.earlierActivity');
                  } else if (isCurrent) {
                    headerLabel = t('statusPanel.currentSession');
                  } else {
                    const start = new Date(group.startTime);
                    headerLabel = t('statusPanel.sessionOf', {
                      date: start.toLocaleDateString(i18n.language),
                      time: start.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }),
                    });
                  }
                  const entryWord = group.entries.length === 1 ? 'entry' : 'entries';

                  return (
                    <Box key={group.sessionId}>
                      <Box
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        data-testid={`session-header-${group.sessionId}`}
                        onClick={() => toggleSession(group.sessionId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleSession(group.sessionId);
                          }
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          cursor: 'pointer',
                          userSelect: 'none',
                          color: '#484f58',
                          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
                          fontSize: '0.65rem',
                          py: '2px',
                          px: 0.25,
                          '&:hover': { color: '#8b949e' },
                          '&:focus-visible': { outline: '1px solid #58a6ff', outlineOffset: 2 },
                        }}
                      >
                        <Box component="span" sx={{ width: 12, flexShrink: 0 }}>
                          {expanded ? '▼' : '▶'}
                        </Box>
                        <Box component="span" sx={{ flexGrow: 1 }}>
                          ── {headerLabel} ({group.entries.length} {entryWord}) ──
                        </Box>
                      </Box>
                      {expanded &&
                        group.entries.map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            isLast={entry.id === lastVisibleEntryId}
                          />
                        ))}
                    </Box>
                  );
                })}
              </>
            )}
            <div ref={bottomRef} />
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
};

export default StatusPanel;
