import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import type { RootState } from '@/app/store';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { getDmName } from '@/utils/dmListUtils';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';

interface WorkspaceSwitchDialogProps {
  open: boolean;
  onStay: () => void;
  onSwitch: () => void;
}

/** The running Load All's conversation and how many messages it holds, for the dialog's first line. */
export function runningLoadAll(state: RootState): { count: number; conversation: string } | null {
  const message = state.message;
  if (message.pagination.isLoadingAll) {
    const channel = state.channel?.selectedChannel;
    const dm = state.dm?.selectedDm;
    const conversation = channel ? `#${channel.name ?? channel.id}` : dm ? getDmName(dm) : '';
    return { count: message.rows.length, conversation };
  }
  for (const tab of Object.values(message.threadTabs ?? {})) {
    if (tab.pagination.isLoadingAll) return { count: tab.rows.length, conversation: tab.threadName };
  }
  return null;
}

/**
 * Asked before a switch while an action runs (plan section 5.4): Stay, or
 * Switch, which pauses the run with its record kept for Resume.
 */
const WorkspaceSwitchDialog = ({ open, onStay, onSwitch }: WorkspaceSwitchDialogProps) => {
  const { t, i18n } = useTranslation();
  const summary = useAppSelector(selectOperationSummary);
  const loadAll = useAppSelector(runningLoadAll);
  return (
    <Dialog open={open} onClose={onStay} maxWidth="xs" fullWidth data-testid="workspace-switch-dialog">
      <DialogTitle sx={{ pr: 5 }}>
        {t('workspace.switchRunningTitle', { name: summary.name })}
        <DialogCloseIcon onClose={onStay} />
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {loadAll
            ? `${t('workspace.switchLoadAllLine', { messages: loadAll.count.toLocaleString(i18n.language), conversation: loadAll.conversation })} `
            : ''}
          {t('workspace.switchNote')}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onStay} color="inherit" data-testid="workspace-switch-stay">
          {t('workspace.stay')}
        </Button>
        <Button onClick={onSwitch} variant="contained" color="primary" data-testid="workspace-switch-confirm">
          {t('workspace.switch')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default WorkspaceSwitchDialog;
