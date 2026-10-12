import { useState, useMemo, useCallback, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  Chip,
  Tabs,
  Tab,
  TextField,
  alpha, LinearProgress } from '@mui/material';
import {
  FileDownload as DownloadIcon,
  BarChart as AnalyticsIcon,
  Reply as ReplyIcon,
} from '@mui/icons-material';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import BotNudge from '@components/welcome/BotNudge';
import type { Message } from 'discrub-core/types/discord-types';
import {
  ANALYTICS_REPORTS,
  REPORT_LIST,
  exportReportCSV,
  formatHour,
  parseTerms,
  type OverviewStats,
  type ReportId,
  type ReportFold,
  type ReportResult,
  type ReportRow,
  type UserMap,
  BESTOF_MIN_REACTIONS,
} from '@/utils/analyticsReports';
import { useAppDispatch } from '@/app/hooks';
import { addStatusEntry } from '@features/status/statusSlice';
import { useTranslation } from 'react-i18next';
import { useStoreWalk, type WalkInput } from '@features/message/storeWalk';

const REPLY_MESSAGE_TYPE = 19;

interface AnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  /** The messages to count, when they are in hand (tests, stories). */
  messages?: Message[];
  /**
   * 2.2.5 W4: the list to count from the workspace store instead, a
   * message at a time. Takes the place of `messages`.
   */
  walk?: WalkInput | null;
  userMap: UserMap;
  /** The channel the feed is showing; messages elsewhere are thread messages (Threads / Overview). */
  containerId?: string | null;
  /** Thread id → name, for the Threads report labels. */
  threadNames?: Record<string, string>;
  /** Report shown first; defaults to Mentions. */
  initialReport?: ReportId;
}

type SortField = 'label' | 'count';
type SortDir = 'asc' | 'desc';

/**
 * Analytics over the messages already loaded in the feed. One tab per report,
 * mirroring Retrostat's report set (the modal is the hand-driven version of
 * what the bot runs on a schedule, which is why the nudge sits under the
 * results). With `messages` everything is computed synchronously, so a Refine
 * or a Load All changes the numbers live. With `walk` every report but
 * Keywords is counted in one walk over the store while the dialog is open,
 * and Keywords walks again when its terms change.
 */
const CLOSED_RESULT: ReportResult = { rows: [], empty: '' };
const NO_MESSAGES: Message[] = [];
const NO_WALK: WalkInput = { container: '', source: { wid: null, cid: null }, ids: [] };
const WALKED_REPORTS = REPORT_LIST.filter((r) => r.id !== 'keywords');
const KEYWORDS_DELAY_MS = 300;

interface WalkedReports {
  folds: Partial<Record<ReportId, ReportFold>>;
  /** Mentions with replies left out, for the Skip replies chip. */
  mentionsNoReplies: ReportFold;
  visited: number;
  replies: number;
}

const AnalyticsModal = ({ open, onClose, messages = NO_MESSAGES, walk = null, userMap, containerId, threadNames, initialReport = 'mentions' }: AnalyticsModalProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [reportId, setReportId] = useState<ReportId>(initialReport);
  const [sortField, setSortField] = useState<SortField>('count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [skipReplies, setSkipReplies] = useState(false);
  const [termsText, setTermsText] = useState('');

  const report = ANALYTICS_REPORTS[reportId];
  const isMentions = reportId === 'mentions';
  const isKeywords = reportId === 'keywords';
  const isOverview = reportId === 'overview';

  const scopedMessages = useMemo(
    () => (!walk && isMentions && skipReplies ? messages.filter((m) => m.type !== REPLY_MESSAGE_TYPE) : messages),
    [walk, messages, isMentions, skipReplies],
  );

  const terms = useMemo(() => parseTerms(termsText), [termsText]);

  // 2.2.5 W4: the store walks. Nothing runs while the dialog is closed.
  const walkInput = walk ?? NO_WALK;
  const walkOn = open && walk !== null;
  const walkKey = `${walkInput.container}|${walkInput.source.wid}|${walkInput.source.cid}|${containerId ?? ''}`;
  const startReports = useCallback(() => {
    const folds: Partial<Record<ReportId, ReportFold>> = {};
    for (const r of WALKED_REPORTS) folds[r.id] = r.fold({ containerId });
    const mentionsNoReplies = ANALYTICS_REPORTS.mentions.fold({ containerId, skipReplies: true });
    const steps = Object.values(folds) as ReportFold[];
    let replies = 0;
    return {
      visit(message: Message) {
        for (const fold of steps) fold.step(message);
        mentionsNoReplies.step(message);
        if (message.type === REPLY_MESSAGE_TYPE) replies += 1;
      },
      done: (visited: number): WalkedReports => ({ folds, mentionsNoReplies, visited, replies }),
    };
  }, [containerId]);
  const reportsWalk = useStoreWalk(walkOn, walkInput, walkKey, startReports);
  const startKeywords = useCallback(() => {
    const fold = ANALYTICS_REPORTS.keywords.fold({ terms });
    return { visit: (message: Message) => fold.step(message), done: () => fold };
  }, [terms]);
  const keywordsWalk = useStoreWalk(walkOn && terms.length > 0, walkInput, `${walkKey}|${terms.join('\u0000')}`, startKeywords, KEYWORDS_DELAY_MS);

  // #263: the modal stays mounted while closed, and a closed modal used to
  // recompute the report every time the feed's messages array changed (every
  // bulk-delete flush at 30K messages). Only compute while open.
  const result = useMemo<ReportResult>(() => {
    if (!open) return CLOSED_RESULT;
    if (!walk) return report.compute(scopedMessages, { userMap, terms, threadNames, containerId });
    const names = { userMap, threadNames };
    if (report.id === 'keywords') {
      if (terms.length === 0) return report.compute(NO_MESSAGES, { userMap, terms });
      return keywordsWalk.value?.finish(names) ?? CLOSED_RESULT;
    }
    const walked = reportsWalk.value;
    if (!walked) return CLOSED_RESULT;
    const fold = report.id === 'mentions' && skipReplies ? walked.mentionsNoReplies : walked.folds[report.id];
    return fold ? fold.finish(names) : CLOSED_RESULT;
  }, [open, walk, report, scopedMessages, userMap, terms, threadNames, containerId, keywordsWalk.value, reportsWalk.value, skipReplies]);
  const activeWalk = isKeywords ? keywordsWalk : reportsWalk;
  const loading = walk !== null && activeWalk.loading;
  const progress = walk !== null ? activeWalk.progress : null;
  const messageCount = walk ? (reportsWalk.value?.visited ?? walk.ids.length) : messages.length;
  const scopedCount = walk ? (skipReplies ? messageCount - (reportsWalk.value?.replies ?? 0) : messageCount) : scopedMessages.length;

  const sorted = useMemo(() => {
    const copy = [...result.rows];
    const mul = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => (sortField === 'label' ? mul * a.label.localeCompare(b.label) : mul * (a.count - b.count) || a.label.localeCompare(b.label)));
    return copy;
  }, [result.rows, sortField, sortDir]);

  const total = useMemo(() => result.rows.reduce((sum, r) => sum + r.count, 0), [result.rows]);
  // 2.2.5 W1: a fold, since a spread past about 100K rows throws.
  const maxCount = useMemo(() => result.rows.reduce((max, r) => (r.count > max ? r.count : max), result.rows.length > 0 ? -Infinity : 1), [result.rows]);
  const hasRows = result.rows.length > 0;
  const hasResults = hasRows || Boolean(result.stats && result.stats.messages > 0);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'count' ? 'desc' : 'asc');
    }
  };

  const handleExportCSV = () => {
    const csv = exportReportCSV(report, sorted);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportId === 'mentions' ? 'mention-counts' : `analytics-${reportId}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    dispatch(addStatusEntry({ level: 'info', message: t('analytics.exportedCsv', { title: t(`analytics.report.${report.id}.title`, { defaultValue: report.title }), count: sorted.length }) }));
  };

  const subtitle = isMentions
    ? t('analytics.mentionsSubtitle', {
        mentions: t('analytics.mentions', { count: total }),
        messages: t('analytics.messages', { count: scopedCount }),
        excluded: skipReplies && scopedCount < messageCount ? t('analytics.repliesExcluded', { count: messageCount - scopedCount }) : '',
      })
    : t('analytics.subtitle', {
        messages: t('analytics.loadedMessages', { count: messageCount }),
        description: t(`analytics.report.${report.id}.description`, { defaultValue: report.description, min: BESTOF_MIN_REACTIONS }),
      });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 2, pr: 5, borderBottom: 1, borderColor: 'divider' }}>
        <AnalyticsIcon sx={{ color: 'primary.main' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }} data-testid="analytics-title">
            {report.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        </Box>
        {isMentions && (
          <Chip
            icon={<ReplyIcon sx={{ fontSize: 14 }} />}
            label={t('analytics.skipReplies')}
            size="small"
            variant={skipReplies ? 'filled' : 'outlined'}
            color={skipReplies ? 'primary' : 'default'}
            onClick={() => setSkipReplies(!skipReplies)}
            sx={{ cursor: 'pointer' }}
          />
        )}
        <DialogCloseIcon onClose={onClose} label={t('analytics.close')} />
      </Box>
      <Tabs
        value={reportId}
        onChange={(_, value: ReportId) => setReportId(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label={t('analytics.reportsAria')}
        data-testid="analytics-tabs"
        sx={{ px: 1, borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5, px: 1.5, fontSize: '0.8rem', textTransform: 'none' } }}
      >
        {REPORT_LIST.map((r) => (
          <Tab key={r.id} value={r.id} label={t(`analytics.report.${r.id}.label`, { defaultValue: r.label })} />
        ))}
      </Tabs>
      <DialogContent sx={{ px: 3, py: 2 }}>
        {loading && (
          <Box sx={{ mb: 1 }}>
            <LinearProgress
              data-testid="analytics-loading"
              variant={progress && progress.total > 0 ? 'determinate' : 'indeterminate'}
              value={progress && progress.total > 0 ? (progress.seen / progress.total) * 100 : undefined}
            />
            {progress && progress.total > 0 && (
              <Typography variant="caption" color="text.secondary" data-testid="analytics-progress">
                {t('analytics.reading', { seen: progress.seen, total: progress.total })}
              </Typography>
            )}
          </Box>
        )}
        {isKeywords && (
          <TextField
            size="small"
            fullWidth
            autoFocus
            label={t('analytics.terms')}
            placeholder={t('analytics.termsPlaceholder')}
            helperText={t('analytics.termsHelp')}
            value={termsText}
            onChange={(e) => setTermsText(e.target.value)}
            inputProps={{ 'data-testid': 'analytics-terms' }}
            sx={{ mb: 2 }}
          />
        )}
        {isOverview && result.stats && result.stats.messages > 0 && <OverviewCard stats={result.stats} />}
        {!hasRows ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography color="text.secondary" data-testid="analytics-empty">{result.empty}</Typography>
          </Box>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={(theme) => ({ maxHeight: isOverview ? 260 : 400, borderColor: alpha(theme.palette.primary.main, 0.2) })}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ '& th': { bgcolor: 'background.paper', fontWeight: 600, fontSize: '0.8rem' } }}>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === 'label'}
                      direction={sortField === 'label' ? sortDir : 'asc'}
                      onClick={() => handleSort('label')}
                    >
                      {t(`analytics.report.${report.id}.subject`, { defaultValue: report.subjectLabel })}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right">
                    <TableSortLabel
                      active={sortField === 'count'}
                      direction={sortField === 'count' ? sortDir : 'desc'}
                      onClick={() => handleSort('count')}
                    >
                      {t(`analytics.report.${report.id}.value`, { defaultValue: report.valueLabel })}
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((row: ReportRow, index: number) => {
                  const barWidth = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
                  return (
                    <TableRow
                      key={row.key}
                      data-testid="analytics-row"
                      sx={{ bgcolor: index % 2 === 1 ? 'action.hover' : 'transparent' }}
                    >
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography variant="body2" noWrap>{row.label}</Typography>
                        {row.excerpt && (
                          <Typography variant="caption" color="text.primary" noWrap sx={{ display: 'block', opacity: 0.85 }}>
                            {row.excerpt}
                          </Typography>
                        )}
                        {row.detail && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                            {row.detail}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
                            <Box
                              sx={{
                                height: '100%',
                                borderRadius: 3,
                                bgcolor: 'primary.main',
                                width: `${barWidth}%`,
                                minWidth: barWidth > 0 ? 4 : 0,
                                transition: 'width 300ms ease',
                              }}
                            />
                          </Box>
                          <Typography variant="body2" sx={{ minWidth: 24, textAlign: 'right', fontWeight: 600 }}>
                            {row.count.toLocaleString()}
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {(result.summary || result.mode) && hasRows && (
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'baseline', justifyContent: 'space-between' }}>
            {result.summary && (
              <Typography variant="caption" sx={{ fontWeight: 600 }} data-testid="analytics-summary">
                {result.summary}
              </Typography>
            )}
            {result.mode && (
              <Typography variant="caption" color="text.secondary" data-testid="analytics-mode">
                {result.mode}
              </Typography>
            )}
          </Box>
        )}
        {hasResults && <BotNudge />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>{t('analytics.cancel')}</Button>
        {hasRows && (
          <Button onClick={handleExportCSV} variant="outlined" startIcon={<DownloadIcon />} size="small">
            {t('analytics.exportCsv')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 0.4, fontSize: '0.65rem' }}>
      {label}
    </Typography>
    <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
        {sub}
      </Typography>
    )}
  </Box>
);

/** Wrapped-style headline numbers for the Overview report. */
const OverviewCard = ({ stats }: { stats: OverviewStats }) => {
  const { t } = useTranslation();
  return (
  <Box data-testid="analytics-overview" sx={{ mb: 2 }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
      <Stat label={t('analytics.stat.messages')} value={stats.messages.toLocaleString()} />
      <Stat label={t('analytics.stat.people')} value={stats.people.toLocaleString()} />
      <Stat label={t('analytics.stat.reactions')} value={stats.reactions.toLocaleString()} />
      <Stat label={t('analytics.stat.attachments')} value={stats.attachments.toLocaleString()} />
      <Stat label={t('analytics.stat.replies')} value={stats.replies.toLocaleString()} />
      <Stat label={t('analytics.stat.threads')} value={stats.threads.toLocaleString()} />
      {stats.busiestDay && <Stat label={t('analytics.stat.busiestDay')} value={stats.busiestDay.label} sub={t('analytics.stat.messagesCount', { count: stats.busiestDay.count })} />}
      {stats.peakHour && <Stat label={t('analytics.stat.peakHour')} value={formatHour(stats.peakHour.hour)} sub={t('analytics.stat.messagesCount', { count: stats.peakHour.count })} />}
    </Box>
    {stats.topEmoji.length > 0 && (
      <Typography variant="caption" sx={{ display: 'block', mt: 1 }} data-testid="analytics-top-emoji">
        <Box component="span" sx={{ fontWeight: 600 }}>{t('analytics.topEmoji')}</Box>{' '}
        {stats.topEmoji.map((e) => `${e.label} ${e.count.toLocaleString()}`).join(' · ')}
      </Typography>
    )}
    {stats.best && (
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }} noWrap data-testid="analytics-best">
        <Box component="span" sx={{ fontWeight: 600 }}>Most reacted</Box>{' '}
        {stats.best.author} · {stats.best.total.toLocaleString()} reactions · {stats.best.excerpt}
      </Typography>
    )}
  </Box>
  );
};

export default AnalyticsModal;
