import { useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { WarningAmber as WarningIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { shallowEqual } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectOperationHold, setDiscrubCancelled, setDiscrubPaused } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { addStatusEntry } from '@features/status/statusSlice';
import { selectStorageFigures, selectWorkspaceList, workspacesPopoverToggled } from '@features/workspace/workspaceSlice';
import { formatDiskSize, shelfBytes } from '@features/workspace/diskBarScale';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { runningLoadAll } from './WorkspaceSwitchDialog';

/**
 * Opens once each time a page write fills the browser's storage and the
 * run pauses (plan section 10). One sentence names the paused run, the
 * disk line sits over a full bar, and the choice is Stop or Workspaces.
 * Closing it leaves the hold on the status row; Resume lives there.
 */
const StorageFullDialog = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const hold = useAppSelector(selectOperationHold);
  const summary = useAppSelector(selectOperationSummary);
  // Mounted for the whole session: compare by value so a new object per store change does not render it.
  const loadAll = useAppSelector(runningLoadAll, shallowEqual);
  const list = useAppSelector(selectWorkspaceList);
  const storage = useAppSelector(selectStorageFigures);
  const [open, setOpen] = useState(false);
  const full = hold?.kind === 'storageFull';
  const wasFull = useRef(false);

  useEffect(() => {
    if (full && !wasFull.current) setOpen(true);
    if (!full) setOpen(false);
    wasFull.current = full;
  }, [full]);

  const total = list.reduce((sum, w) => sum + w.bytes, 0);
  const remaining = storage ? storage.remaining : Math.max(0, shelfBytes(total, null) - total);
  const loaded = hold?.kind === 'storageFull' ? hold.loaded : 0;
  const line = loadAll
    ? t('workspace.fullLoadAll', { messages: loadAll.count.toLocaleString(i18n.language), conversation: loadAll.conversation })
    : t('workspace.fullRun', { name: summary.name, messages: loaded.toLocaleString(i18n.language) });

  const stop = () => {
    setOpen(false);
    dispatch(setDiscrubCancelled(true));
    dispatch(setDiscrubPaused(false));
    dispatch(addStatusEntry({ level: 'warning', message: t('pause.operationCancelled') }));
  };
  const openWorkspaces = () => {
    setOpen(false);
    dispatch(workspacesPopoverToggled(true));
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth data-testid="storage-full-dialog">
      <DialogTitle sx={{ pr: 5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon sx={{ color: 'warning.main' }} />
        {t('workspace.fullTitle')}
        <DialogCloseIcon onClose={() => setOpen(false)} />
      </DialogTitle>
      <DialogContent>
        <DialogContentText data-testid="storage-full-line">{`${line} ${t('workspace.fullNext')}`}</DialogContentText>
        <Box sx={{ mt: 1.5, fontSize: '0.71875rem', fontWeight: 500 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.625 }}>
            <Box component="span" sx={{ color: 'text.primary' }}>{t('workspace.onDisk', { size: formatDiskSize(total) })}</Box>
            <Box component="span" data-testid="storage-full-remaining" sx={{ color: 'warning.main' }}>{t('workspace.remaining', { size: formatDiskSize(remaining) })}</Box>
          </Box>
          <Box sx={{ height: 4, borderRadius: 0.5, backgroundColor: 'warning.main' }} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={stop} color="inherit" data-testid="storage-full-stop">
          {t('pause.stop')}
        </Button>
        <Button onClick={openWorkspaces} variant="contained" color="primary" data-testid="storage-full-open-workspaces">
          {t('workspace.title')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StorageFullDialog;
