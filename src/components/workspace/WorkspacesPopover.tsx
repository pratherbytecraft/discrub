import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Popover,
  Typography,
  type PopoverOrigin,
} from '@mui/material';
import { Add as NewIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import { selectHasThemes, setSupporterPanelOpen } from '@features/supporter/supporterSlice';
import { selectCurrentWid, selectStorageFigures, selectWorkspaceList } from '@features/workspace/workspaceSlice';
import {
  clearConversationThunk,
  clearWorkspaceThunk,
  createNewWorkspace,
  deleteWorkspaceThunk,
  duplicateWorkspaceThunk,
  renameWorkspaceThunk,
} from '@features/workspace/workspaceThunks';
import type { WorkspaceSummary } from '@features/workspace/workspaceSummary';
import { formatDiskSize, segmentPercents, shelfBytes } from '@features/workspace/diskBarScale';
import { useWorkspaceSwitch } from '@/hooks/useWorkspaceSwitch';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import WorkspaceSwitchDialog from './WorkspaceSwitchDialog';
import WorkspaceRow from './WorkspaceRow';
import LockMark from './LockMark';
import { countLabel } from './workspaceFormat';

/** Eight rows show before the list scrolls (plan 5.2). */
const LIST_MAX_H = 8 * 58;

interface Confirm {
  title: string;
  body: string;
  label: string;
  danger: boolean;
  run: () => unknown;
}

interface WorkspacesPopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}

/**
 * The Workspaces popover (plan 5.2): New in the header, one row per
 * workspace, and the disk line and bar in the footer. Free accounts keep
 * Default only, so New and Duplicate carry the supporter lock and open the
 * supporter hub, and a faint struck "Supporter only" row sits under the list.
 */
const WorkspacesPopover = ({
  anchorEl,
  open,
  onClose,
  anchorOrigin = { vertical: 'top', horizontal: 'left' },
  transformOrigin = { vertical: 'bottom', horizontal: 'left' },
}: WorkspacesPopoverProps) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const dispatch = useAppDispatch();
  const list = useAppSelector(selectWorkspaceList);
  const storage = useAppSelector(selectStorageFigures);
  const currentWid = useAppSelector(selectCurrentWid);
  const supporter = useAppSelector(selectHasThemes);
  const busy = useAppSelector(selectIsOperationRunning);
  const { requestSwitch, dialogProps } = useWorkspaceSwitch();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const openHub = () => {
    onClose();
    dispatch(setSupporterPanelOpen(true));
  };
  const size = (w: { bytes: number }) => formatDiskSize(w.bytes);
  const messages = (count: number) => countLabel('messages', count, locale);

  const onNew = async () => {
    if (!supporter) return openHub();
    const wid = await dispatch(createNewWorkspace()).unwrap();
    setExpanded(null);
    setRenaming(wid);
  };
  const onOpen = (w: WorkspaceSummary) => {
    if (w.wid === currentWid || w.heldElsewhere || !w.openable) return;
    onClose();
    requestSwitch(w.wid);
  };
  const onDuplicate = (w: WorkspaceSummary) => {
    if (!supporter) return openHub();
    setConfirm({
      title: t('workspace.duplicateTitle', { name: w.name }),
      body: t('workspace.duplicateBody', { messages: messages(w.count), size: size(w) }),
      label: t('workspace.duplicate'),
      danger: false,
      run: () => dispatch(duplicateWorkspaceThunk({ wid: w.wid })),
    });
  };
  const onClear = (w: WorkspaceSummary) =>
    setConfirm({
      title: t('workspace.clearWorkspaceTitle', { name: w.name }),
      body: t('workspace.clearWorkspaceBody', { messages: messages(w.count), size: size(w), conversations: countLabel('conversations', w.conversationCount, locale) }),
      label: t('workspace.clear'),
      danger: true,
      run: () => dispatch(clearWorkspaceThunk({ wid: w.wid })),
    });
  const onDelete = (w: WorkspaceSummary) =>
    setConfirm({
      title: t('workspace.deleteTitle', { name: w.name }),
      body: t('workspace.deleteBody', { messages: messages(w.count), size: size(w) }),
      label: t('workspace.delete'),
      danger: true,
      run: () => dispatch(deleteWorkspaceThunk({ wid: w.wid })),
    });

  const total = list.reduce((sum, w) => sum + w.bytes, 0);
  const shelf = shelfBytes(total, storage?.quota);
  const widths = segmentPercents(list.map((w) => w.bytes), shelf);
  const remaining = storage ? storage.remaining : Math.max(0, shelf - total);

  return (
    <>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={onClose}
        anchorOrigin={anchorOrigin}
        transformOrigin={transformOrigin}
        slotProps={{ paper: { sx: { width: 560, maxWidth: 'calc(100vw - 24px)', mb: 1, border: '1px solid', borderColor: 'divider' }, 'data-testid': 'workspaces-popover' } as never }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>{t('workspace.title')}</Typography>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<NewIcon sx={{ color: 'primary.main' }} />}
              onClick={onNew}
              data-testid="workspace-new"
              sx={{ textTransform: 'none', py: 0.125, px: 1, fontSize: '0.75rem', borderColor: 'divider' }}
            >
              {t('workspace.new')}
            </Button>
            {!supporter && <LockMark sx={{ position: 'absolute', top: -6, right: -6 }} />}
          </Box>
        </Box>
        <Box sx={{ py: 0.5, maxHeight: LIST_MAX_H, overflowY: 'auto' }}>
          {list.map((w) => (
            <WorkspaceRow
              key={w.wid}
              workspace={w}
              current={w.wid === currentWid}
              expanded={expanded === w.wid}
              renaming={renaming === w.wid}
              locked={!supporter}
              busy={busy}
              onOpen={() => onOpen(w)}
              onToggle={() => setExpanded((prev) => (prev === w.wid ? null : w.wid))}
              onRenameStart={() => setRenaming(w.wid)}
              onRenameEnd={(name) => {
                setRenaming(null);
                if (name !== null && name.trim() && name.trim() !== w.name) void dispatch(renameWorkspaceThunk({ wid: w.wid, name }));
              }}
              onDuplicate={() => onDuplicate(w)}
              onClear={() => onClear(w)}
              onDelete={() => onDelete(w)}
              onClearConversation={(c) =>
                setConfirm({
                  title: t('workspace.clearConversationTitle', { name: c.kind === 'dm' ? c.name : `#${c.name}` }),
                  body: t('workspace.clearConversationBody', { messages: messages(c.count), size: formatDiskSize(c.bytes) }),
                  label: t('workspace.clear'),
                  danger: true,
                  run: () => dispatch(clearConversationThunk({ wid: w.wid, cid: c.cid })),
                })
              }
            />
          ))}
          {!supporter && (
            <Box
              role="button"
              tabIndex={0}
              onClick={openHub}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHub(); } }}
              data-testid="workspace-supporter-only"
              sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mx: 1.75, mt: 0.75, mb: 0.5, px: 1.5, py: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 1.5, color: 'text.secondary', fontSize: '0.75rem', fontWeight: 500, opacity: 0.5, cursor: 'pointer' }}
            >
              <LockMark />
              <Box component="span" sx={{ textDecoration: 'line-through' }}>{t('workspace.supporterOnly')}</Box>
            </Box>
          )}
        </Box>
        <Box sx={{ px: 1.75, pt: 1, pb: 1.25, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.71875rem', fontWeight: 500, color: 'text.secondary' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.625 }}>
            <Box component="span" sx={{ color: 'text.primary' }} data-testid="workspace-on-disk">{t('workspace.onDisk', { size: formatDiskSize(total) })}</Box>
            <Box component="span" data-testid="workspace-remaining" sx={{ color: remaining === 0 ? 'warning.main' : undefined }}>{t('workspace.remaining', { size: formatDiskSize(remaining) })}</Box>
          </Box>
          <Box sx={{ display: 'flex', height: 4, borderRadius: 0.5, overflow: 'hidden', backgroundColor: 'rgba(128,128,128,.2)' }}>
            {list.map((w, i) => (
              <Box key={w.wid} sx={{ height: '100%', width: `${widths[i]}%`, backgroundColor: w.color }} />
            ))}
          </Box>
        </Box>
      </Popover>
      <WorkspaceSwitchDialog {...dialogProps} />
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth data-testid="workspace-confirm">
        <DialogTitle sx={{ pr: 5 }}>
          {confirm?.title}
          <DialogCloseIcon onClose={() => setConfirm(null)} />
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm?.body}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color={confirm?.danger ? 'error' : 'primary'}
            data-testid="workspace-confirm-button"
            onClick={() => {
              const run = confirm?.run;
              setConfirm(null);
              run?.();
            }}
          >
            {confirm?.label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default WorkspacesPopover;
