import { useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, InputBase, Typography, alpha, useTheme } from '@mui/material';
import {
  ExpandMore as ChevronIcon,
  EditOutlined as RenameIcon,
  ContentCopyOutlined as DuplicateIcon,
  CleaningServicesOutlined as ClearIcon,
  DeleteOutline as DeleteIcon,
  FileDownloadOutlined as ExportIcon,
  PlayArrow as WorkIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ConversationSummary, WorkspaceSummary } from '@features/workspace/workspaceSummary';
import { formatDiskSize } from '@features/workspace/diskBarScale';
import { timeAgo } from '@/utils/timeAgo';
import LockMark from './LockMark';
import { countLabel, workLabel } from './workspaceFormat';

/** Conversations listed under an open row before "N more". */
export const CONVERSATIONS_SHOWN = 5;

export interface WorkspaceRowProps {
  workspace: WorkspaceSummary;
  current: boolean;
  expanded: boolean;
  renaming: boolean;
  /** Free accounts see Duplicate with the supporter lock. */
  locked: boolean;
  /** A supporter at the workspace cap: Duplicate waits until one is deleted. */
  atCap?: boolean;
  /** Clear and Delete wait while an action runs in the open workspace. */
  busy: boolean;
  /** Row 154 (pass 3): a copy is being made, so Duplicate waits for it. */
  duplicating?: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRenameStart: () => void;
  onRenameEnd: (name: string | null) => void;
  onDuplicate: () => void;
  onExport: () => void;
  onClear: () => void;
  onDelete: () => void;
  onClearConversation: (conversation: ConversationSummary) => void;
}

/** "# general", "# general › thread" or the DM's name. */
const conversationName = (c: ConversationSummary) =>
  c.kind === 'dm' ? c.name : c.kind === 'thread' && c.parentName ? `# ${c.parentName} › ${c.name}` : `# ${c.name}`;

/**
 * One workspace in the popover (plan 5.2): a colour dot, the name with its
 * state beside it and one muted line of figures under it, then a chevron.
 * The row opens the workspace; the chevron opens it like an accordion with
 * labeled actions and the conversations, each with a Clear.
 */
const WorkspaceRow = ({
  workspace: w,
  current,
  expanded,
  renaming,
  locked,
  atCap = false,
  busy,
  duplicating = false,
  onOpen,
  onToggle,
  onRenameStart,
  onRenameEnd,
  onDuplicate,
  onExport,
  onClear,
  onDelete,
  onClearConversation,
}: WorkspaceRowProps) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const locale = i18n.language;
  // Test ids name the Default row "default" whatever id it was given.
  const rowId = w.isDefault ? 'default' : w.wid;
  const [draft, setDraft] = useState(w.name);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (renaming) {
      setDraft(w.name);
      setTimeout(() => input.current?.select(), 0);
    }
  }, [renaming, w.name]);

  const dimmed = w.heldElsewhere || !w.openable;
  const meta = [
    countLabel('conversations', w.conversationCount, locale),
    countLabel('messages', w.count, locale),
    formatDiskSize(w.bytes),
    timeAgo(new Date(w.lastOpened).toISOString()),
  ].join(' · ');
  const state = current ? (
    <Typography component="span" data-testid="workspace-row-current" sx={{ ml: 1, fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'primary.main' }}>
      {t('workspace.openNow')}
    </Typography>
  ) : !w.openable ? (
    <Typography component="span" sx={{ ml: 1, fontSize: '0.6875rem', color: 'text.secondary' }}>
      {t('workspace.needsVersion', { version: w.appVersion })}
    </Typography>
  ) : w.work ? (
    <Typography component="span" data-testid="workspace-row-work" sx={{ ml: 1, display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: '0.6875rem', fontWeight: 600, color: 'warning.main' }}>
      <WorkIcon sx={{ fontSize: 13 }} />
      {workLabel(w.work, locale)}
    </Typography>
  ) : w.heldElsewhere ? (
    <Typography component="span" sx={{ ml: 1, fontSize: '0.6875rem', color: 'text.secondary' }}>
      {t('workspace.anotherWindow')}
    </Typography>
  ) : null;
  // The open workspace can show its unfinished work too, beside "Open now".
  const currentWork = current && w.work ? (
    <Typography component="span" sx={{ ml: 1, display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: '0.6875rem', fontWeight: 600, color: 'warning.main' }}>
      <WorkIcon sx={{ fontSize: 13 }} />
      {workLabel(w.work, locale)}
    </Typography>
  ) : null;

  const commit = () => onRenameEnd(draft);
  const act = (label: string, icon: React.ReactNode, onClick: () => void, opts: { danger?: boolean; lock?: boolean; disabled?: boolean; testid: string }) => (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        size="small"
        variant="outlined"
        color={opts.danger ? 'error' : 'inherit'}
        startIcon={icon}
        disabled={opts.disabled}
        onClick={onClick}
        data-testid={opts.testid}
        sx={{ textTransform: 'none', py: 0.125, px: 1, fontSize: '0.75rem', borderColor: opts.danger ? undefined : 'divider', '& .MuiButton-startIcon': { mr: 0.5, '& svg': { fontSize: 14 } } }}
      >
        {label}
      </Button>
      {opts.lock && <LockMark sx={{ position: 'absolute', top: -6, right: -6 }} />}
    </Box>
  );

  return (
    <Box
      data-testid={`workspace-row-${rowId}`}
      sx={{
        borderLeft: '2px solid',
        borderLeftColor: current ? 'primary.main' : 'transparent',
        backgroundColor: current ? alpha(theme.palette.primary.main, 0.07) : expanded ? alpha(theme.palette.text.primary, 0.05) : 'transparent',
        opacity: dimmed ? 0.65 : 1,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label={w.name}
        onClick={() => { if (!renaming) onOpen(); }}
        onKeyDown={(e) => { if (!renaming && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, py: 1.125, pl: 1.75, pr: 1.25,
          cursor: current || dimmed ? 'default' : 'pointer',
          '&:hover': current || dimmed ? {} : { backgroundColor: alpha(theme.palette.text.primary, 0.05) },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <Box sx={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: w.color, flex: 'none' }} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', minWidth: 0 }}>
            {renaming ? (
              <InputBase
                inputRef={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') onRenameEnd(null);
                }}
                inputProps={{ maxLength: 60, 'aria-label': t('workspace.nameLabel'), 'data-testid': 'workspace-rename-input' }}
                sx={{ height: 24, px: 0.75, border: '1px solid', borderColor: 'primary.main', borderRadius: 1, backgroundColor: 'background.default', fontSize: '0.8125rem', fontWeight: 600 }}
              />
            ) : (
              <Typography component="span" noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>{w.name}</Typography>
            )}
            {state}
            {currentWork}
          </Box>
          <Typography component="span" noWrap sx={{ fontSize: '0.71875rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {meta}
          </Typography>
        </Box>
        <IconButton
          size="small"
          aria-label={w.name}
          aria-expanded={expanded}
          data-testid={`workspace-row-toggle-${rowId}`}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          sx={{ color: expanded ? 'text.primary' : 'text.secondary', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
        >
          <ChevronIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      {expanded && (
        <>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', pt: 0.25, pb: 1, pl: 4.375, pr: 1.75 }}>
            {act(t('workspace.rename'), <RenameIcon />, onRenameStart, { testid: 'workspace-rename', disabled: !w.openable })}
            {act(t('workspace.duplicate'), <DuplicateIcon />, onDuplicate, { testid: 'workspace-duplicate', lock: locked, disabled: !w.openable || atCap || duplicating })}
            {act(t('workspace.export'), <ExportIcon />, onExport, { testid: 'workspace-export', disabled: !w.openable })}
            {act(t('workspace.clear'), <ClearIcon />, onClear, { testid: 'workspace-clear', disabled: (current && busy) || w.count === 0 })}
            {!w.isDefault && act(t('workspace.delete'), <DeleteIcon />, onDelete, { testid: 'workspace-delete', danger: true, disabled: (current && busy) || w.heldElsewhere })}
          </Box>
          {/* Row 118 (pass 3): says why Rename, Duplicate and Export are off on a workspace from a newer build. */}
          {!w.openable && (
            <Typography data-testid="workspace-newer-note" sx={{ pl: 4.375, pr: 1.75, pb: 1, mt: -0.5, fontSize: '0.71875rem', color: 'text.secondary' }}>
              {t('workspace.newerNote', { version: w.appVersion })}
            </Typography>
          )}
          {w.conversations.length > 0 && (
            <Box sx={{ pt: 0.5, pb: 1, pl: 4.375, mr: 1.75, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {w.conversations.slice(0, CONVERSATIONS_SHOWN).map((c) => (
                <Box key={c.cid} data-testid={`workspace-conversation-${c.cid}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 28, fontSize: '0.75rem', color: 'text.secondary' }}>
                  <Typography component="span" noWrap sx={{ fontSize: 'inherit', color: 'text.primary', maxWidth: 260 }}>
                    {conversationName(c)}
                    {c.guildName && <Box component="span" sx={{ color: 'text.secondary' }}> · {c.guildName}</Box>}
                  </Typography>
                  <Typography component="span" noWrap sx={{ fontSize: 'inherit', flex: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {countLabel('messages', c.count, locale)} · {formatDiskSize(c.bytes)}
                  </Typography>
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<ClearIcon />}
                    disabled={current && busy}
                    onClick={() => onClearConversation(c)}
                    data-testid={`workspace-conversation-clear-${c.cid}`}
                    sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.75rem', py: 0, minWidth: 0, '& .MuiButton-startIcon': { mr: 0.5, '& svg': { fontSize: 14 } } }}
                  >
                    {t('workspace.clear')}
                  </Button>
                </Box>
              ))}
              {w.conversations.length > CONVERSATIONS_SHOWN && (
                <Typography sx={{ height: 24, display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: 'text.secondary' }}>
                  {t('workspace.more', { count: w.conversations.length - CONVERSATIONS_SHOWN })}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default WorkspaceRow;
