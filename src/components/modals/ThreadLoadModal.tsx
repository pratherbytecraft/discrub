import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  List,
  ListItemButton,
  ListItemText,
  Chip,
  Divider,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { Channel } from 'discrub-core/types/discord-types';
import { timeAgo } from '@utils/timeAgo';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  fetchChannelThreads,
  selectDiscoveredThreadsForChannel,
} from '@features/channel/channelSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { t as translate } from '@/i18n';
import { useTranslation } from 'react-i18next';

interface ThreadLoadModalProps {
  open: boolean;
  onClose: () => void;
  onLoad: (threadId: string) => void;
  /**
   * The currently-selected channel — used to discover its threads
   * automatically when the modal opens. When null (no channel context,
   * e.g. modal opened from a global affordance) the discovery list is
   * hidden and the manual ID field is the only path. Backlog #150.
   */
  channel?: Channel | null;
  /** Guild that owns the channel — needed for the active-threads endpoint. */
  guildId?: string | null;
}

const ThreadLoadModal = ({
  open,
  onClose,
  onLoad,
  channel,
  guildId,
}: ThreadLoadModalProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const token = useAppSelector(selectAuthToken);
  const cached = useAppSelector(selectDiscoveredThreadsForChannel(channel?.id));
  const [threadId, setThreadId] = useState('');
  const [discovered, setDiscovered] = useState<Channel[]>(cached ?? []);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // Discovery loader (#165). Cache hits in the slice short-circuit
  // the network calls and resolve instantly with the existing list.
  // The Refresh button passes force=true to re-run the fetch.
  const runDiscovery = useCallback(
    (force: boolean) => {
      if (!channel || !guildId || !token) return;
      let cancelled = false;
      setDiscovering(true);
      setDiscoverError(null);

      dispatch(fetchChannelThreads({ channel, guildId, token, force }))
        .unwrap()
        .then((threads) => {
          if (!cancelled) setDiscovered(threads);
        })
        .catch((err) => {
          if (!cancelled) {
            setDiscoverError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (!cancelled) setDiscovering(false);
        });

      return () => {
        cancelled = true;
      };
    },
    [channel, guildId, token, dispatch],
  );

  // Auto-discover on modal open. Cache-hit path is essentially free
  // (one selector read + a no-op thunk that returns the cached list);
  // cold path makes up to 3 parallel API calls. Either way the user
  // sees the list as soon as it's available, plus a Refresh icon for
  // when they think the cache is stale.
  useEffect(() => {
    if (!open) return;
    return runDiscovery(false);
  }, [open, runDiscovery]);

  const handleLoad = () => {
    const trimmed = threadId.trim();
    if (trimmed) {
      onLoad(trimmed);
      setThreadId('');
    }
  };

  const handlePickThread = (thread: Channel) => {
    onLoad(thread.id);
    setThreadId('');
  };

  const handleClose = () => {
    setThreadId('');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && threadId.trim()) {
      handleLoad();
    }
  };

  const showDiscoveryList = !!channel && !!guildId;
  const rows = useMemo(() => sortThreadsForList(discovered), [discovered]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 5 }}>
        {t('threadLoad.title')}
        <DialogCloseIcon onClose={handleClose} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {showDiscoveryList && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="subtitle2">
                  {t('threadLoad.threadsInChannel')}
                </Typography>
                <Tooltip title={t('threadLoad.refresh')} arrow>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => runDiscovery(true)}
                      disabled={discovering}
                      aria-label={t('threadLoad.refresh')}
                      data-testid="refresh-threads"
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              {discovering && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    {t('threadLoad.looking')}
                  </Typography>
                </Box>
              )}
              {!discovering && discoverError && (
                <Typography variant="body2" color="error.main">
                  {t('threadLoad.loadFailed', { error: discoverError })}
                </Typography>
              )}
              {!discovering && !discoverError && discovered.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('threadLoad.none')}
                </Typography>
              )}
              {!discovering && discovered.length > 0 && (
                <List
                  dense
                  disablePadding
                  data-testid="discovered-threads"
                  sx={{
                    maxHeight: 264,
                    overflowY: 'auto',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.default',
                  }}
                >
                  {rows.map((thread, index) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      last={index === rows.length - 1}
                      onPick={handlePickThread}
                    />
                  ))}
                </List>
              )}
            </Box>
          )}

          {showDiscoveryList && <Divider>{t('threadLoad.or')}</Divider>}

          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('threadLoad.enterId')}
            </Typography>
            <TextField
              autoFocus
              label={t('threadLoad.idLabel')}
              value={threadId}
              onChange={(e) => setThreadId(e.target.value.replace(/\D/g, ''))}
              onKeyDown={handleKeyDown}
              size="small"
              fullWidth
              placeholder={t('threadLoad.idPlaceholder')}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleLoad}
          variant="contained"
          disabled={!threadId.trim()}
        >
          {t('threadLoad.load')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/** Discord channel types for the two thread flavours that carry a lock. */
const PRIVATE_THREAD = 12;

/** Active threads first, then archived, keeping each group's server order. */
export const sortThreadsForList = (threads: Channel[]): Channel[] => {
  const active = threads.filter((t) => !t.thread_metadata?.archived);
  const archived = threads.filter((t) => t.thread_metadata?.archived);
  return [...active, ...archived];
};


/**
 * One line of facts under the thread name: message count, member count,
 * and when it was archived. Fields the API left out are simply skipped, so
 * a thread with no counts still gets a sensible line.
 */
export const describeThread = (thread: Channel): string => {
  const parts: string[] = [];
  const messages = thread.total_message_sent ?? thread.message_count;
  if (typeof messages === 'number') parts.push(translate('threadLoad.messageCount', { count: messages }));
  if (typeof thread.member_count === 'number') parts.push(translate('threadLoad.memberCount', { count: thread.member_count }));
  const meta = thread.thread_metadata;
  if (meta?.archived) {
    parts.push(meta.archive_timestamp ? translate('threadLoad.archivedAgo', { ago: timeAgo(meta.archive_timestamp) }) : translate('threadLoad.archived'));
  }
  return parts.length > 0 ? parts.join(' · ') : `ID ${thread.id}`;
};

const ThreadRow = ({
  thread,
  last,
  onPick,
}: {
  thread: Channel;
  last: boolean;
  onPick: (thread: Channel) => void;
}) => {
  const archived = !!thread.thread_metadata?.archived;
  // Row 101 (pass 2): the Private chip is for private threads only; a locked public thread keeps the lock icon.
  const isPrivate = thread.type === PRIVATE_THREAD;
  const locked = isPrivate || !!thread.thread_metadata?.locked;
  const Icon = archived ? ArchiveOutlinedIcon : locked ? LockOutlinedIcon : ForumOutlinedIcon;
  return (
    <ListItemButton
      onClick={() => onPick(thread)}
      data-testid={`discovered-thread-${thread.id}`}
      title={translate('threadLoad.loadNamed', { name: thread.name || thread.id })}
      sx={{
        gap: 1.25,
        py: 0.75,
        borderBottom: last ? 'none' : '1px solid',
        borderColor: 'divider',
        opacity: archived ? 0.72 : 1,
        '&:hover': { opacity: 1 },
        '&:hover .thread-row-go': { opacity: 1, transform: 'translateX(0)' },
      }}
    >
      <Box
        sx={{
          width: 30,
          height: 30,
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          bgcolor: 'action.hover',
          color: archived ? 'text.secondary' : 'primary.main',
        }}
      >
        <Icon sx={{ fontSize: 18 }} />
      </Box>
      <ListItemText
        primary={thread.name || translate('threadLoad.threadFallback', { id: thread.id })}
        secondary={describeThread(thread)}
        primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 600, noWrap: true }}
        secondaryTypographyProps={{ fontSize: '0.75rem', noWrap: true }}
        sx={{ my: 0 }}
      />
      {archived && (
        <Chip label={translate('threadLoad.archivedChip')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
      )}
      {!archived && isPrivate && (
        <Chip label={translate('threadLoad.privateChip')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
      )}
      <ChevronRightIcon
        className="thread-row-go"
        fontSize="small"
        sx={{
          color: 'text.secondary',
          opacity: 0,
          transform: 'translateX(-4px)',
          transition: 'opacity 120ms, transform 120ms',
        }}
      />
    </ListItemButton>
  );
};

export default ThreadLoadModal;
