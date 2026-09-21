import { useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Skeleton,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Select,
  MenuItem,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Campaign as AnnouncementIcon,
  History as ArchiveIcon,
} from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { AnnouncementArchiveEntry } from 'discrub-core/types/discrub-types';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import FollowStamp from './FollowStamp';

interface AnnouncementModalProps {
  open: boolean;
  onDismiss: () => void;
  markdown: string | null;
  isLoading?: boolean;
  error?: string | null;
  /**
   * Past announcements for the version rail. All optional so the plain dialog
   * keeps working without an archive (stories, tests): no archive, no rail.
   */
  archive?: AnnouncementArchiveEntry[] | null;
  isLoadingArchive?: boolean;
  archiveError?: string | null;
  /** Archived version to show; null = the live announcement. */
  selectedVersion?: string | null;
  onSelectVersion?: (version: string | null) => void;
}

/** Rail key for the live announcement (never a real version string). */
export const LIVE_ENTRY_KEY = '__live__';

/** Shared markdown styling for the live announcement and archived ones. */
const MARKDOWN_SX: SxProps<Theme> = {
  pt: 1,
  minWidth: 0,
  '& h1': { fontSize: '1.5rem', fontWeight: 700, color: 'text.primary', mb: 1, mt: 2 },
  '& h2': { fontSize: '1.25rem', fontWeight: 600, color: 'text.primary', mb: 1, mt: 2 },
  '& h3': { fontSize: '1.1rem', fontWeight: 600, color: 'text.primary', mb: 0.5, mt: 1.5 },
  '& p': { color: 'text.secondary', lineHeight: 1.7, mb: 1 },
  '& ul, & ol': { color: 'text.secondary', pl: 3, mb: 1 },
  '& li': { mb: 0.5 },
  '& a': { color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
  '& code': {
    backgroundColor: 'action.hover',
    color: 'text.primary',
    px: 0.75,
    py: 0.25,
    borderRadius: 0.5,
    fontSize: '0.85em',
    fontFamily: 'Consolas, Monaco, monospace',
  },
  '& pre': {
    backgroundColor: 'action.hover',
    borderRadius: 1,
    p: 1.5,
    overflow: 'auto',
    mb: 1,
    '& code': { backgroundColor: 'transparent', p: 0 },
  },
  '& blockquote': {
    borderLeft: 3,
    borderColor: 'primary.main',
    pl: 2,
    ml: 0,
    color: 'text.secondary',
    fontStyle: 'italic',
  },
  '& hr': { border: 'none', borderTop: 1, borderColor: 'divider', my: 2 },
  '& img': { maxWidth: '100%', borderRadius: 1 },
  '& strong': { color: 'text.primary', fontWeight: 600 },
};

const LoadingSkeleton = () => (
  <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
    <Skeleton variant="text" width="60%" height={32} />
    <Skeleton variant="text" width="40%" height={24} />
    <Skeleton variant="text" width="100%" height={16} />
    <Skeleton variant="text" width="95%" height={16} />
    <Skeleton variant="text" width="80%" height={16} />
    <Skeleton variant="text" width="90%" height={16} />
  </Box>
);

/** "2026-08-23" → "August 23, 2026"; falls back to the raw string. */
export const formatArchiveDate = (iso: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

/** First non-empty line, used to match the live announcement to its archive row. */
const headingOf = (markdown: string | null | undefined): string =>
  (markdown ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';

interface RailEntry {
  key: string;
  title: string;
  date: string | null;
  /** `date` formatted once; the modal re-renders with its parent while closed (#263). */
  dateLabel: string | null;
  markdown: string | null;
}

const NO_ARCHIVE: NonNullable<AnnouncementModalProps['archive']> = [];

const AnnouncementModal = ({
  open,
  onDismiss,
  markdown,
  isLoading,
  error,
  archive,
  isLoadingArchive,
  archiveError,
  selectedVersion = null,
  onSelectVersion,
}: AnnouncementModalProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const archiveEntries = archive ?? NO_ARCHIVE;

  // The live announcement heads the rail. When the archive already holds it
  // (same first heading; the release step copies the text over), reuse that
  // row's title and date instead of listing it twice.
  // #263: built once per archive/markdown change, not per parent render;
  // the date formatting (an Intl formatter per call) showed up in the
  // bulk-delete profile while this modal was closed.
  const { rail, liveMatch } = useMemo(() => {
    const liveHeading = headingOf(markdown);
    const match = liveHeading ? archiveEntries.find((entry) => headingOf(entry.markdown) === liveHeading) : undefined;
    const entries: RailEntry[] = [
      {
        key: LIVE_ENTRY_KEY,
        title: match?.title ?? t('announcement.latest'),
        date: match?.date ?? null,
        dateLabel: match?.date ? formatArchiveDate(match.date) : null,
        markdown,
      },
      ...archiveEntries
        .filter((entry) => entry !== match)
        .map((entry) => ({
          key: entry.version,
          title: entry.title,
          date: entry.date,
          dateLabel: entry.date ? formatArchiveDate(entry.date) : null,
          markdown: entry.markdown,
        })),
    ];
    return { rail: entries, liveMatch: match };
  }, [archiveEntries, markdown, t]);
  const hasArchive = archiveEntries.length > 0;
  const selectedKey = selectedVersion ?? LIVE_ENTRY_KEY;
  const selected = rail.find((entry) => entry.key === selectedKey) ?? rail[0];
  const showingLive = selected.key === LIVE_ENTRY_KEY;

  const pick = (key: string) => onSelectVersion?.(key === LIVE_ENTRY_KEY ? null : key);

  const title = showingLive && !liveMatch ? t('announcement.title') : selected.title;
  const byline = selected.dateLabel;

  const railNode = hasArchive && (
    narrow ? (
      <Select
        size="small"
        value={selected.key}
        onChange={(event) => pick(String(event.target.value))}
        inputProps={{ 'aria-label': t('announcement.version') }}
        data-testid="announcement-archive-select"
        sx={{ mb: 1.5, alignSelf: 'flex-start', minWidth: 200 }}
      >
        {rail.map((entry) => (
          <MenuItem key={entry.key} value={entry.key}>
            {entry.title}
            {entry.dateLabel ? ` · ${entry.dateLabel}` : ''}
          </MenuItem>
        ))}
      </Select>
    ) : (
      <List
        dense
        disablePadding
        aria-label={t('announcement.list')}
        data-testid="announcement-archive-rail"
        sx={{
          width: 190,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          pr: 1,
          mr: 2,
          alignSelf: 'stretch',
        }}
      >
        {rail.map((entry) => (
          <ListItemButton
            key={entry.key}
            selected={entry.key === selected.key}
            onClick={() => pick(entry.key)}
            sx={{ borderRadius: 1, mb: 0.25 }}
          >
            <ListItemText
              primary={entry.title}
              secondary={entry.dateLabel ?? undefined}
              primaryTypographyProps={{ fontWeight: entry.key === selected.key ? 600 : 400 }}
            />
          </ListItemButton>
        ))}
      </List>
    )
  );

  const railSkeleton = !hasArchive && isLoadingArchive && !narrow && (
    <Box sx={{ width: 190, flexShrink: 0, pr: 1, mr: 2, borderRight: 1, borderColor: 'divider' }} data-testid="announcement-archive-loading">
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} sx={{ px: 2, py: 1 }}>
          <Skeleton variant="text" width="70%" height={18} />
          <Skeleton variant="text" width="55%" height={14} />
        </Box>
      ))}
    </Box>
  );

  const body = showingLive ? (
    <>
      {isLoading && <LoadingSkeleton />}
      {error && !isLoading && (
        <Typography color="error" variant="body2" sx={{ py: 2 }}>
          {error}
        </Typography>
      )}
      {markdown && !isLoading && !error && (
        <Box sx={{ ...MARKDOWN_SX, flex: 1 }} data-testid="announcement-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </Box>
      )}
    </>
  ) : (
    <Box sx={{ ...MARKDOWN_SX, flex: 1 }} data-testid="announcement-archive-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.markdown ?? ''}</ReactMarkdown>
    </Box>
  );

  const wide = hasArchive || Boolean(isLoadingArchive);

  return (
    <Dialog open={open} onClose={onDismiss} maxWidth={wide ? 'md' : 'sm'} fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 5 }}>
        {showingLive ? <AnnouncementIcon color="primary" /> : <ArchiveIcon color="primary" />}
        <Box sx={{ minWidth: 0 }}>
          <Box component="span" sx={{ display: 'block', lineHeight: 1.2 }}>
            {title}
          </Box>
          {byline && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {t('announcement.posted', { date: byline })}
            </Typography>
          )}
        </Box>
        <DialogCloseIcon onClose={onDismiss} label={t('announcement.close')} />
      </DialogTitle>
      <DialogContent>
        <Box
          data-testid="announcement-layout"
          sx={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: 'flex-start', pt: 0.5 }}
        >
          {railSkeleton}
          {railNode}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {body}
            {archiveError && !hasArchive && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }} data-testid="announcement-archive-error">
                {archiveError}
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        {open && <FollowStamp />}
        <Button onClick={onDismiss} variant="outlined">
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AnnouncementModal;
