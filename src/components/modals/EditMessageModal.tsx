import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Alert,
  Collapse,
} from '@mui/material';
import type { Message } from 'discrub-core/types/discord-types';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useTranslation } from 'react-i18next';

interface EditMessageModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (newContent: string) => void;
  message: Message | null;
  messages?: Message[];
  /**
   * 2.2.5 W4: bulk mode, true when a selected message has no attachment
   * or embed. Read from the rows, so the messages need not be read.
   */
  hasBareMessages?: boolean;
  messageCount: number;
}

/**
 * EditMessageModal - dialog for editing one or more messages
 * Single mode (messageCount === 1): pre-populates with existing content
 * Bulk mode (messageCount > 1): empty field, sets all messages to the same content
 */
const hasAttachmentsOrEmbeds = (msg: Message) =>
  (msg.attachments && msg.attachments.length > 0) ||
  (msg.embeds && msg.embeds.length > 0);

const EditMessageModal = ({
  open,
  onClose,
  onSave,
  message,
  messages = [],
  hasBareMessages,
  messageCount,
}: EditMessageModalProps) => {
  const { t } = useTranslation();
  const [content, setContent] = useState(message?.content || '');
  const isBulkMode = messageCount > 1;
  const isEmpty = !content.trim();

  // In single mode, check the one message; in bulk mode, check if any lack attachments/embeds
  const hasBareBareMessages = isBulkMode
    ? hasBareMessages ?? messages.some((m) => !hasAttachmentsOrEmbeds(m))
    : message != null && !hasAttachmentsOrEmbeds(message);
  const wouldFailEmpty = isEmpty && hasBareBareMessages;

  useEffect(() => {
    if (open) {
      setContent(message?.content || '');
    }
  }, [open, message]);

  const handleSave = () => {
    onSave(content);
    if (isBulkMode) setContent('');
  };

  const handleClose = () => {
    if (isBulkMode) setContent('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          animation: 'fade-in-scale 300ms ease',
        },
      }}
    >
      <DialogTitle sx={{ pr: 5 }}>
        {isBulkMode ? t('editModal.bulkTitle') : t('editModal.title')}
        <DialogCloseIcon onClose={handleClose} />
      </DialogTitle>
      <DialogContent>
        {isBulkMode && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('editModal.editing', { count: messageCount })}
          </Typography>
        )}
        <TextField
          autoFocus={isBulkMode}
          fullWidth
          multiline
          {...(isBulkMode ? { minRows: 3 } : { rows: 6 })}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          label={isBulkMode ? t('editModal.newContent') : t('editModal.messageContent')}
          variant="outlined"
          sx={isBulkMode ? undefined : { mt: 2 }}
        />
        <Collapse in={wouldFailEmpty}>
          <Alert severity="error" sx={{ mt: 2 }}>
            {isBulkMode
              ? t('editModal.emptyBulkError')
              : t('editModal.emptyError')}
          </Alert>
        </Collapse>
        <Collapse in={isEmpty && !wouldFailEmpty}>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('editModal.emptyWarning')}
          </Alert>
        </Collapse>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {t('editModal.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={wouldFailEmpty}
        >
          {t('editModal.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditMessageModal;
