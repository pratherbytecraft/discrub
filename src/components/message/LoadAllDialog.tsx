import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';
import { useAppSelector } from '@/app/hooks';
import {
  selectActiveRows,
  selectActiveTab,
  selectActiveSearchCriteria,
  selectActivePagination,
  selectRestored,
} from '@features/message/messageSlice';
import { countActiveFilters } from 'discrub-core/filtering';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { Trans } from 'react-i18next';
import { useLoadAllUnfinished } from '@/hooks/useLoadAllLabel';
import { useTranslation } from 'react-i18next';

interface LoadAllDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** 2.2.5: drop the saved messages for this conversation and load from the top. Shown when the conversation was restored from the workspace. */
  onStartOver?: () => void;
  contextLabel: string;
}

/**
 * LoadAllDialog component - confirmation dialog before loading all messages
 */
const LoadAllDialog = ({ open, onClose, onConfirm, onStartOver, contextLabel }: LoadAllDialogProps) => {
  const messages = useAppSelector(selectActiveRows);
  const { t, i18n } = useTranslation();
  const activeTab = useAppSelector(selectActiveTab);
  const restored = useAppSelector(selectRestored);
  // 2.2.5: a conversation restored from the workspace continues from its
  // saved cursor (plan section 6). Thread tabs keep the plain dialog.
  const searchCriteria = useAppSelector(selectActiveSearchCriteria);
  const pagination = useAppSelector(selectActivePagination);
  const resumable = !activeTab && restored !== null && !!onStartOver;
  // An unfinished Load All recorded in the workspace (a thread tab too) also reads Resume.
  const unfinished = useLoadAllUnfinished();
  // Nothing left to resume once the saved walk reached the end: Start over
  // is the only action, and it is what refreshes a complete conversation.
  const completeOnDisk = resumable && !pagination.hasMore;
  const resumeDate = resumable && restored.oldestTimestamp
    ? new Date(restored.oldestTimestamp).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;
  const scope = activeTab ? 'thread' : contextLabel === 'conversation' ? 'dm' : 'channel';

  const isFilteredSearch =
    pagination.mode === 'search' && !!searchCriteria && countActiveFilters(searchCriteria) > 0;
  const filterCount = isFilteredSearch && searchCriteria
    ? countActiveFilters(searchCriteria)
    : 0;

  const title = isFilteredSearch ? t('loadAll.titleFiltered') : t('loadAll.title');
  const alertCopy = isFilteredSearch
    ? t('loadAll.alertFiltered', { count: filterCount, scope: t('loadAll.scope', { context: scope }) })
    : t('loadAll.alert', { context: scope });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="warning" />
          {title}
        </Box>
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {alertCopy}
        </Alert>
        <DialogContentText>
          <Trans i18nKey="loadAll.currentlyLoaded" values={{ count: messages.length }} components={{ strong: <strong /> }} />
        </DialogContentText>
        {resumable && (
          <DialogContentText sx={{ mt: 1 }} data-testid="load-all-restored-line">
            {resumeDate && !completeOnDisk
              ? t('loadAll.restoredLine', { count: restored.count.toLocaleString(i18n.language), date: resumeDate })
              : t('loadAll.restoredLineNoDate', { count: restored.count.toLocaleString(i18n.language) })}
          </DialogContentText>
        )}
        <DialogContentText sx={{ mt: 1 }}>
          {isFilteredSearch ? t('loadAll.willFiltered') : t('loadAll.will')}
        </DialogContentText>
        <Box component="ul" sx={{ mt: 1, pl: 3 }}>
          <li>
            <Typography variant="body2">
              {t('loadAll.bulletBatches')}
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              {t('loadAll.bulletMinutes', { context: scope })}
            </Typography>
          </li>
          <li>
            <Typography variant="body2">{t('loadAll.bulletScroll')}</Typography>
          </li>
        </Box>
        <DialogContentText sx={{ mt: 2 }}>
          {t('loadAll.confirmQuestion')}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        {resumable && !completeOnDisk && (
          <Button onClick={onStartOver} color="inherit" sx={{ mr: 'auto' }} data-testid="load-all-start-over">
            {t('loadAll.startOver')}
          </Button>
        )}
        <Button onClick={onClose} color="inherit">
          {t('common.cancel')}
        </Button>
        {completeOnDisk ? (
          <Button onClick={onStartOver} variant="contained" color="primary" data-testid="load-all-start-over">
            {t('loadAll.startOver')}
          </Button>
        ) : (
          <Button onClick={onConfirm} variant="contained" color="primary" data-testid="load-all-confirm">
            {resumable || unfinished ? t('loadAll.resume') : t('loadAll.confirm')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default LoadAllDialog;
