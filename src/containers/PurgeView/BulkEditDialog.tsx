import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  Alert,
  TextField,
  useTheme,
  alpha,
  lighten,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { Edit as EditIcon } from '@mui/icons-material';
import type { Channel } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { useAppDispatch, useAppSelector, useAppStore } from '@/app/hooks';
import { useBulkResume } from '@/hooks/useResume';
import { discardBulkRecord, readBulkRecord, resolveQueue } from '@features/workspace/resumeRecords';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import { bulkEditChannels } from '@features/message/messageSlice';
import { countActiveFilters } from 'discrub-core/filtering';
import FilterModal from '@components/search/FilterModal';
import BulkFilterButton from '@components/search/BulkFilterButton';
import SelectedChannelsPill from '@components/dialogs/SelectedChannelsPill';
import { useTranslation } from 'react-i18next';

interface BulkEditDialogProps {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  mode: 'channels' | 'dms';
  guildId?: string | null;
}

/**
 * Backlog #215 — multi-channel "Edit Messages".
 *
 * The single-channel Edit Messages flow lives in ServerView/EditMessageModal.
 * This dialog extends it to the multi-select channel scaffold (#155): every
 * message the current user authored across the selected channels is rewritten
 * to the same content. Discord only permits editing your own messages, so the
 * author target is locked to self — the optional FilterModal only narrows by
 * date / content, never author. Mirrors BulkPurgeDialog's shell.
 */
const BulkEditDialog = ({ open, onClose, channels: selectedChannels, mode, guildId }: BulkEditDialogProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const dispatch = useAppDispatch();
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const currentUser = useAppSelector(selectCurrentUser);
  const currentUserId = currentUser?.id || '';

  const [content, setContent] = useState('');
  const [filterCriteria, setFilterCriteria] = useState<SearchCriteria | null>(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Bumped on each open so the keyed FilterModal remounts fresh (mirrors the
  // stale-typed-values fix in BulkPurgeDialog).
  const [filterModalKey, setFilterModalKey] = useState(0);

  // 2.2.5 WP4b: an edit that was running when Discrub closed comes back
  // with its text, its filter and the channels it had not finished.
  const store = useAppStore();
  const bulkResume = useBulkResume('bulkEdit', mode, guildId);
  const resumable = bulkResume !== null;
  const [resumeChannels, setResumeChannels] = useState<Channel[] | null>(null);
  useEffect(() => {
    if (!open || !resumable) {
      setResumeChannels(null);
      return;
    }
    let live = true;
    void readBulkRecord(store.getState()).then((record) => {
      if (!live || !record || record.kind !== 'bulkEdit') return;
      const saved = record.settings as { content?: string; searchCriteria?: SearchCriteria | null } | undefined;
      setContent(saved?.content ?? '');
      setFilterCriteria(saved?.searchCriteria ?? null);
      const state = store.getState();
      const remaining = record.queue.filter((id) => !record.done.includes(id));
      setResumeChannels(resolveQueue(remaining, [state.channel.channels, state.channel.forumThreads, state.dm.dms]));
    });
    return () => {
      live = false;
    };
  }, [open, resumable, store]);
  const resuming = resumeChannels !== null;
  const channels = resumeChannels ?? selectedChannels;
  const handleStartOver = () => {
    void dispatch(discardBulkRecord());
    setResumeChannels(null);
    setContent('');
    setFilterCriteria(null);
  };

  const isDmMode = mode === 'dms';
  const scopeContext = isDmMode ? 'dm' : 'channel';
  const count = channels.length;
  const filterCount = filterCriteria ? countActiveFilters(filterCriteria) : 0;

  const openFilterModal = () => {
    setFilterModalKey((k) => k + 1);
    setFilterModalOpen(true);
  };

  const handleConfirm = () => {
    dispatch(bulkEditChannels({
      channels,
      content,
      guildId,
      searchCriteria: filterCriteria,
    }));
    onClose();
  };

  const confirmLabel = t('bulkEdit.confirm', { count, context: scopeContext });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 5 }}>
        {isDmMode ? t('bulkEdit.titleDms') : t('bulkEdit.titleChannels')}
        <Chip
          label={t('bulkEdit.selectedCount', { count })}
          size="small"
          sx={{
            ml: 1,
            verticalAlign: 'middle',
            backgroundColor: (theme: Theme) => alpha(theme.palette.cta.main, 0.2),
            color: (theme: Theme) => (isDark ? lighten(theme.palette.primary.main, 0.4) : theme.palette.primary.main),
            fontWeight: 500,
          }}
        />
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          {resuming && (
            <Typography variant="body2" data-testid="bulk-edit-resume-note">
              {t('workspace.resumeEditNote')}
            </Typography>
          )}
          <SelectedChannelsPill channels={channels} mode={isDmMode ? 'dms' : 'channels'} />

          <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
            {t('bulkEdit.ownOnly')}
          </Alert>

          <TextField
            label={t('bulkEdit.newContent')}
            placeholder={t('bulkEdit.newContentPlaceholder')}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            inputProps={{ 'aria-label': t('bulkEdit.newContentAria') }}
          />

          <Box>
            <BulkFilterButton
              filterCount={filterCount}
              onOpen={openFilterModal}
              helperText={t('bulkEdit.narrowHelp')}
            />
          </Box>

          <Alert severity="warning" variant="outlined">
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t('bulkEdit.irreversible')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('bulkEdit.summary', { count, context: scopeContext, filter: filterCount > 0 ? t('bulkEdit.matchingFilter') : '' })}
            </Typography>
          </Alert>

          {/* #206 wake lock + #247 worker pacing: same caveat wording as the purge dialog. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('bulkEdit.longRun')}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        {resuming && (
          <Button onClick={handleStartOver} color="inherit" sx={{ mr: 'auto' }} data-testid="bulk-edit-start-over">
            {t('workspace.startOver')}
          </Button>
        )}
        <Button variant="outlined" onClick={onClose}>{t('bulkEdit.cancel')}</Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="primary"
          startIcon={<EditIcon />}
          disabled={count === 0 || content.trim().length === 0 || isOperationRunning}
          data-testid="bulk-edit-confirm"
        >
          {resuming ? t('workspace.resume') : confirmLabel}
        </Button>
      </DialogActions>

      <FilterModal
        key={filterModalKey}
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onServerSearch={(criteria) => {
          setFilterCriteria(criteria);
          setFilterModalOpen(false);
        }}
        onRefine={() => { /* bulk edit has no client-side refine */ }}
        onClearSearch={() => {
          setFilterCriteria(null);
          setFilterModalOpen(false);
        }}
        onClearRefine={() => { /* no-op */ }}
        savedSearchCriteria={filterCriteria ?? undefined}
        cachedUserMap={cachedUserMap}
        currentUserId={currentUserId}
        hideRefineSection
        applyButtonLabel={t('bulkEdit.applyFilters')}
        // Author is locked to the current user (edit only works on own
        // messages), so hide the author picker entirely.
        hideAuthorFilters
      />
    </Dialog>
  );
};

export default BulkEditDialog;
