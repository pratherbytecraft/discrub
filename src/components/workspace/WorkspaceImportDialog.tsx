import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { DashboardOutlined as WorkspaceIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { WorkspaceSummary } from '@features/workspace/workspaceSummary';
import type { WorkspaceManifest } from '@services/workspaceArchive';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { countLabel, workLabel } from './workspaceFormat';

interface WorkspaceImportDialogProps {
  /** The workspace already here under the file's id. */
  here: WorkspaceSummary;
  file: WorkspaceManifest;
  /** At the workspace cap: Keep both needs a free slot. */
  atCap?: boolean;
  onCancel: () => void;
  onKeepBoth: () => void;
  onReplace: () => void;
}

const Panel = ({ label, name, lines, testid }: { label: string; name: string; lines: Array<{ text: string; warn?: boolean }>; testid: string }) => (
  <Box data-testid={testid} sx={{ flex: 1, minWidth: 0, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
    <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'primary.main', mb: 0.5 }}>{label}</Typography>
    <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, mb: 0.25 }}>{name}</Typography>
    {lines.map((line) => (
      <Typography key={line.text} sx={{ fontSize: '0.75rem', lineHeight: 1.6, color: line.warn ? 'warning.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{line.text}</Typography>
    ))}
  </Box>
);

/**
 * Asked before an import writes over a workspace already here (plan
 * section 8): what is here beside what is in the file, no sentence, then
 * Cancel, Keep both or Replace.
 */
const WorkspaceImportDialog = ({ here, file, atCap = false, onCancel, onKeepBoth, onReplace }: WorkspaceImportDialogProps) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const exported = new Date(file.exportedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const hereLines = [
    { text: countLabel('messages', here.count, locale) },
    { text: countLabel('conversations', here.conversationCount, locale) },
    ...(here.work ? [{ text: workLabel(here.work, locale), warn: true }] : []),
  ];
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="workspace-import-dialog">
      <DialogTitle sx={{ pr: 5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <WorkspaceIcon sx={{ color: 'primary.main' }} />
        {t('workspace.alreadyHereTitle')}
        <DialogCloseIcon onClose={onCancel} />
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', gap: 1.25 }}>
        <Panel label={t('workspace.here')} name={here.name} lines={hereLines} testid="workspace-import-here" />
        <Panel
          label={t('workspace.inTheFile')}
          name={file.name}
          lines={[
            { text: countLabel('messages', file.messages, locale) },
            { text: countLabel('conversations', file.conversations, locale) },
            { text: t('workspace.exportedOn', { date: exported }) },
          ]}
          testid="workspace-import-file"
        />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onCancel} data-testid="workspace-import-cancel">{t('common.cancel')}</Button>
        <Button variant="outlined" color="inherit" onClick={onKeepBoth} disabled={atCap} data-testid="workspace-import-keep-both" sx={{ borderColor: 'divider' }}>
          {t('workspace.keepBoth')}
        </Button>
        <Button variant="contained" color="primary" onClick={onReplace} data-testid="workspace-import-replace">{t('workspace.replace')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default WorkspaceImportDialog;
