import { useEffect, useRef, useState } from 'react';
import { Box, Tooltip, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentWid, selectStorageFigures, selectWorkspaceList } from '@features/workspace/workspaceSlice';
import { diskLevel, formatDiskSize, segmentPercents, shelfBytes } from '@features/workspace/diskBarScale';
import { useWorkspaceListSync } from './useWorkspaceListSync';
import WorkspacesPopover from './WorkspacesPopover';

/** How long the bar glows after it moves. */
const GLOW_MS = 1200;

/**
 * Three pixels along the bottom edge of the window in every layout,
 * Focus included (plan 5.3): one segment per workspace in its colour on
 * a 10 GB shelf that doubles when passed, amber from 80 percent of the
 * browser's allowance and red when it is full. Hover lists the sizes,
 * click opens the Workspaces popover. Also keeps the list current.
 */
const DiskBar = () => {
  useWorkspaceListSync();
  const { t } = useTranslation();
  const theme = useTheme();
  const list = useAppSelector(selectWorkspaceList);
  const storage = useAppSelector(selectStorageFigures);
  const currentWid = useAppSelector(selectCurrentWid);
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [glow, setGlow] = useState(false);

  const total = list.reduce((sum, w) => sum + w.bytes, 0);
  const previous = useRef(total);
  useEffect(() => {
    if (previous.current === total) return;
    previous.current = total;
    setGlow(true);
    const timer = setTimeout(() => setGlow(false), GLOW_MS);
    return () => clearTimeout(timer);
  }, [total]);

  if (list.length === 0) return null;
  const shelf = shelfBytes(total, storage?.quota);
  const widths = segmentPercents(list.map((w) => w.bytes), shelf);
  const level = diskLevel(storage?.usage, storage?.quota);
  const levelColor = level === 'full' ? theme.palette.error.main : level === 'warning' ? theme.palette.warning.main : null;
  const remaining = storage ? storage.remaining : Math.max(0, shelf - total);

  const tip = (
    <Box sx={{ minWidth: 240, fontSize: '0.75rem', lineHeight: 1.6 }} data-testid="disk-bar-tooltip">
      <Box sx={{ fontWeight: 600, mb: 0.5 }}>{t('workspace.barHead', { size: formatDiskSize(total), count: list.length })}</Box>
      {list.map((w) => (
        <Box key={w.wid} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: 0.25, backgroundColor: w.color }} />
          <Box component="span" sx={{ flex: 1 }}>{w.name}</Box>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatDiskSize(w.bytes)}</Box>
        </Box>
      ))}
      <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid', borderColor: 'divider', color: levelColor ?? undefined }}>
        {t('workspace.remaining', { size: formatDiskSize(remaining) })}
      </Box>
    </Box>
  );

  return (
    <>
      <Tooltip title={tip} placement="top" enterDelay={300} slotProps={{ tooltip: { sx: { bgcolor: 'background.paper', color: 'text.secondary', border: '1px solid', borderColor: 'divider', boxShadow: 6, maxWidth: 360 } } }}>
        <Box
          ref={ref}
          role="button"
          tabIndex={-1}
          aria-label={t('workspace.title')}
          data-testid="disk-bar"
          data-level={level}
          onClick={() => setOpen(true)}
          sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 6, zIndex: 1250, display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}
        >
          <Box sx={{ display: 'flex', width: '100%', height: 3, backgroundColor: 'rgba(128,128,128,.18)' }}>
            {list.map((w, i) => {
              const color = levelColor ?? w.color;
              const current = w.wid === currentWid;
              return (
                <Box
                  key={w.wid}
                  data-testid={`disk-bar-segment-${w.wid}`}
                  sx={{
                    height: '100%',
                    width: `${widths[i]}%`,
                    backgroundColor: color,
                    opacity: current ? 1 : 0.7,
                    boxShadow: current ? `0 0 ${glow ? 12 : 6}px ${color}` : 'none',
                    transition: 'width 400ms ease, box-shadow 400ms ease',
                  }}
                />
              );
            })}
          </Box>
        </Box>
      </Tooltip>
      <WorkspacesPopover
        anchorEl={ref.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
};

export default DiskBar;
