import { useRef, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { ExpandLess as ChevronIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectAnyUnfinishedWork, selectCurrentWorkspaceName } from '@features/workspace/workspaceSlice';
import WorkspaceIcon from './WorkspaceIcon';
import WorkspacesPopover from './WorkspacesPopover';

export type WorkspacePillVariant = 'log' | 'bar';

/** The status log header keeps its own dark palette whatever the theme. */
const LOG_COLORS = { border: '#30363d', text: '#c9d1d9', icon: '#58a6ff', paper: '#0d1117' };

/**
 * The open workspace's name with a chevron (plan 5.1), and a dot when any
 * workspace has unfinished work. Click opens the Workspaces popover above
 * it. `log` sits in the status log header (Classic, Simple, Timeline),
 * `bar` in the Workbench status bar, Native's user row and Operator's
 * queue footer, and Native's head row on a phone (row 167, pass 3: the
 * floating pill there covered the feed). `opensDown` opens the popover
 * below a pill near the top of the screen.
 */
/** `yieldRoom`: a hold line (a retry wait, a rest break) needs the row, so the pill gives way as in a bar. */
const WorkspacePill = ({ variant, yieldRoom = false, opensDown = false }: { variant: WorkspacePillVariant; yieldRoom?: boolean; opensDown?: boolean }) => {
  const { t } = useTranslation();
  const name = useAppSelector(selectCurrentWorkspaceName);
  const dot = useAppSelector(selectAnyUnfinishedWork);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const log = variant === 'log';
  const keepName = log && !yieldRoom;
  return (
    <>
      <ButtonBase
        ref={ref}
        data-testid="workspace-pill"
        aria-haspopup="dialog"
        aria-label={`${t('workspace.title')}: ${name ?? ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        sx={{
          position: 'relative',
          height: 20,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          pl: 0.875,
          pr: 0.75,
          ml: log ? 1 : 0,
          borderRadius: '12px',
          border: '1px solid',
          borderColor: log ? LOG_COLORS.border : 'divider',
          color: log ? LOG_COLORS.text : 'text.primary',
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          // Gives up room first in a crowded bar, down to the icon and chevron. In the
          // status header the run text truncates first and the name stays (row 14),
          // unless a hold line needs the room.
          flexShrink: keepName ? 0 : 10,
          minWidth: 44,
          maxWidth: 200,
          overflow: 'visible',
          '&:hover': { borderColor: log ? '#8b949e' : 'text.secondary' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
        }}
      >
        <WorkspaceIcon sx={{ fontSize: 14, flexShrink: 0, color: log ? LOG_COLORS.icon : 'primary.main' }} />
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{name ?? t('workspace.title')}</Box>
        <ChevronIcon sx={{ fontSize: 14, flexShrink: 0 }} />
        {dot && (
          <Box
            data-testid="workspace-pill-dot"
            sx={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', backgroundColor: 'warning.main', border: '2px solid', borderColor: log ? LOG_COLORS.paper : 'background.paper' }}
          />
        )}
      </ButtonBase>
      {/* React events bubble out of portals through the component tree; without this a click
          inside the popover or its dialogs would reach the status log header and toggle it. */}
      <Box component="span" sx={{ display: 'contents' }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <WorkspacesPopover
          anchorEl={ref.current}
          open={open}
          onClose={() => setOpen(false)}
          {...(opensDown ? { anchorOrigin: { vertical: 'bottom', horizontal: 'right' }, transformOrigin: { vertical: 'top', horizontal: 'right' } } as const : {})}
        />
      </Box>
    </>
  );
};

export default WorkspacePill;
