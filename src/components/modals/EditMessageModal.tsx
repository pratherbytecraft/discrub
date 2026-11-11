import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Alert,
  Box,
  Paper,
  Collapse,
} from '@mui/material';
import type { Message } from 'discrub-core/types/discord-types';
import {
  createEditReplacement,
  generateEditReplacement,
  type EditMode,
  type EditReplacement,
} from '@features/message/editReplacement';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useTranslation } from 'react-i18next';
import EditModeField from './EditModeField';

interface EditMessageModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (newContent: string, replacement?: EditReplacement) => void;
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
 * Replacement mode: fixed text (default) sends the field's content; a random
 * mode sends a seeded replacement so each message gets its own text.
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
  // Fixed text is the default; random modes carry a seed so the generated
  // text for a given message id is stable across retries and resumes.
  const [mode, setMode] = useState<EditMode>('fixed');
  const [replacement, setReplacement] = useState<EditReplacement | null>(null);
  const isBulkMode = messageCount > 1;
  const isRandom = mode !== 'fixed';
  const isEmpty = !content.trim();

  // In single mode, check the one message; in bulk mode, check if any lack attachments/embeds
  const hasBareBareMessages = isBulkMode
    ? hasBareMessages ?? messages.some((m) => !hasAttachmentsOrEmbeds(m))
    : message != null && !hasAttachmentsOrEmbeds(message);
  // Random modes always produce non-empty text, so only fixed text can fail
  // Discord's content requirement.
  const wouldFailEmpty = !isRandom && isEmpty && hasBareBareMessages;
  const preview = useMemo(
    () => (replacement ? generateEditReplacement(replacement, message?.id ?? 'preview') : ''),
    [replacement, message?.id],
  );

  useEffect(() => {
    if (open) {
      setContent(message?.content || '');
      setMode('fixed');
      setReplacement(null);
    }
  }, [open, message]);

  const handleModeChange = (nextMode: EditMode) => {
    setMode(nextMode);
    setReplacement(nextMode === 'fixed' ? null : createEditReplacement(nextMode));
  };

  const handleRegenerate = () => {
    if (replacement) setReplacement(createEditReplacement(replacement.mode));
  };

  const handleSave = () => {
    if (replacement) onSave(content, replacement);
    else onSave(content);
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
          autoFocus={isBulkMode && !isRandom}
          fullWidth
          multiline
          disabled={isRandom}
          {...(isBulkMode ? { minRows: 3 } : { rows: 6 })}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          label={isBulkMode ? t('editModal.newContent') : t('editModal.messageContent')}
          variant="outlined"
          sx={isBulkMode ? undefined : { mt: 2 }}
        />
        <EditModeField mode={mode} onChange={handleModeChange} />
        {isRandom && replacement && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">{t('editModal.randomPreview')}</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, mt: 1, bgcolor: 'action.hover' }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {preview}
              </Typography>
            </Paper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Button size="small" onClick={handleRegenerate}>
                {t('editModal.regenerate')}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {t('editModal.randomHint')}
              </Typography>
            </Box>
          </Box>
        )}
        <Collapse in={wouldFailEmpty}>
          <Alert severity="error" sx={{ mt: 2 }}>
            {isBulkMode
              ? t('editModal.emptyBulkError')
              : t('editModal.emptyError')}
          </Alert>
        </Collapse>
        <Collapse in={!isRandom && isEmpty && !wouldFailEmpty}>
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
