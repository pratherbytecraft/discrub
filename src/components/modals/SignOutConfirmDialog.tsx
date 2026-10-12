import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { countLabel } from '@components/workspace/workspaceFormat';
import { formatDiskSize } from '@features/workspace/diskBarScale';
import type { StoredFigures } from '@/hooks/useSignOut';

interface SignOutConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  stored: StoredFigures;
}

/** The sign out question, naming what goes with it (ws-signout). */
export default function SignOutConfirmDialog({ open, onClose, onConfirm, stored }: SignOutConfirmDialogProps) {
  const { t, i18n } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="signout-confirm">
      <DialogTitle sx={{ pr: 5 }}>
        {t('workspace.signOutTitle')}
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t('workspace.signOutBody', {
            workspaces: countLabel('workspaces', stored.workspaces, i18n.language),
            messages: countLabel('messages', stored.messages, i18n.language),
            size: formatDiskSize(stored.bytes),
          })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" color="error" onClick={onConfirm} data-testid="signout-confirm-button">
          {t('workspace.signOutButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
