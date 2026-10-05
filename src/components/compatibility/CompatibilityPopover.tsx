import { useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Box,
  Chip,
  Drawer,
  IconButton,
  Popover,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  InfoOutlined as InfoIcon,
  CheckCircleOutline as OkIcon,
  ErrorOutline as NoteIcon,
} from '@mui/icons-material';
import {
  COMPAT_ROWS,
  COMPAT_TABLE,
  compatSetupLabel,
  detectCompatSetup,
} from '@services/compatibility';
import type { CompatCell, CompatSetup } from '@services/compatibility';
import { useTranslation } from 'react-i18next';

/** Column groups: product on top, browser/device below. */
const MATRIX_GROUPS: { label: string; columns: { key: CompatSetup; label: string }[] }[] = [
  {
    label: 'compat.extension',
    columns: [
      { key: 'chrome-ext', label: 'Chrome' },
      { key: 'firefox-ext', label: 'Firefox' },
    ],
  },
  {
    label: 'compat.bleedingEdge',
    columns: [
      { key: 'be-chrome', label: 'Chrome' },
      { key: 'be-firefox', label: 'Firefox' },
      { key: 'be-phone', label: 'compat.mobile' },
    ],
  },
];

const StatusIcon = ({ status }: { status: CompatCell['status'] }) =>
  status === 'ok' ? (
    <OkIcon fontSize="small" color="success" data-testid="compat-status-ok" />
  ) : (
    <NoteIcon fontSize="small" color="warning" data-testid="compat-status-note" />
  );

/**
 * The compatibility table: five setups × three rows, each cell an icon plus
 * a one-word label (touch has no hover, so the label is the meaning). The
 * detected column is tinted and carries a "You" chip. `compact` tightens
 * type and padding so the five columns fit a 390px phone sheet.
 */
export const CompatibilityContent = ({
  setup,
  compact = false,
}: {
  setup: CompatSetup;
  compact?: boolean;
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const detectedSx = { backgroundColor: alpha(theme.palette.primary.main, 0.1) };
  const cellPx = compact ? 0.25 : 1;
  // The first Bleeding Edge column carries a divider so the two groups read apart.
  const groupEdgeSx = { borderLeft: `1px solid ${theme.palette.divider}` };

  return (
    <Box sx={{ p: compact ? 1.5 : 2 }} data-testid="compat-content">
      <Typography variant="subtitle1" fontWeight={600} data-testid="compat-setup-label">
        {compatSetupLabel(setup)}
      </Typography>

      <Box sx={{ mt: 1, overflowX: 'auto' }} data-testid="compat-matrix">
        <Table size="small" sx={{ '& .MuiTableCell-root': { px: cellPx } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ borderBottom: 'none' }} />
              {MATRIX_GROUPS.map((g) => (
                <TableCell
                  key={t(g.label, { defaultValue: g.label })}
                  align="center"
                  colSpan={g.columns.length}
                  sx={{
                    borderBottom: 'none',
                    pb: 0,
                    ...(g.label === 'compat.bleedingEdge' && groupEdgeSx),
                    color: 'text.secondary',
                    fontSize: compact ? '0.6rem' : '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(g.label, { defaultValue: g.label })}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell />
              {MATRIX_GROUPS.flatMap((g) =>
                g.columns.map((c) => (
                  <TableCell
                    key={c.key}
                    align="center"
                    sx={{
                      whiteSpace: 'nowrap',
                      pt: 0.5,
                      fontSize: compact ? '0.7rem' : undefined,
                      ...(c.key === 'be-chrome' && groupEdgeSx),
                      ...(c.key === setup && detectedSx),
                    }}
                    data-testid={`compat-col-${c.key}`}
                  >
                    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center">
                      <span>{t(c.label, { defaultValue: c.label })}</span>
                      {c.key === setup && (
                        <Chip
                          label={t('compat.you')}
                          size="small"
                          color="primary"
                          sx={{ height: 20, fontSize: '0.65rem', '& .MuiChip-label': { px: 1 } }}
                        />
                      )}
                    </Stack>
                  </TableCell>
                )),
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {COMPAT_ROWS.map((row) => (
              <TableRow key={row.key} data-testid={`compat-row-${row.key}`}>
                <TableCell
                  sx={{
                    whiteSpace: compact ? 'normal' : 'nowrap',
                    color: 'text.secondary',
                    fontSize: compact ? '0.7rem' : undefined,
                    lineHeight: 1.2,
                    maxWidth: compact ? 56 : undefined,
                  }}
                >
                  {row.label}
                </TableCell>
                {MATRIX_GROUPS.flatMap((g) =>
                  g.columns.map((c) => {
                    const cell = COMPAT_TABLE[c.key][row.key];
                    return (
                      <TableCell
                        key={c.key}
                        align="center"
                        sx={{
                          ...(c.key === 'be-chrome' && groupEdgeSx),
                          ...(c.key === setup && detectedSx),
                        }}
                        data-testid={`compat-cell-${c.key}-${row.key}`}
                      >
                        <Stack alignItems="center" spacing={0.25}>
                          <StatusIcon status={cell.status} />
                          <Typography
                            variant="caption"
                            sx={{
                              whiteSpace: compact ? 'normal' : 'nowrap',
                              textAlign: 'center',
                              lineHeight: 1.2,
                              fontSize: compact ? '0.6rem' : '0.7rem',
                              maxWidth: compact ? 48 : undefined,
                            }}
                          >
                            {cell.text}
                          </Typography>
                        </Stack>
                      </TableCell>
                    );
                  }),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
};

/** Phone bottom sheet, opened from the TopBar's More menu below `sm`. */
export const CompatibilitySheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <Drawer
    anchor="bottom"
    open={open}
    onClose={onClose}
    PaperProps={{
      sx: (theme) => ({
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        backgroundColor: 'backgroundElevated',
        backgroundImage: 'none',
        borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
      }),
    }}
    data-testid="compat-sheet"
  >
    {open && <CompatibilityContent setup={detectCompatSetup()} compact />}
  </Drawer>
);

/** Desktop popover, anchored to whichever button opened it (the TopBar's More menu since 2.2.4). */
export const CompatibilityPopup = ({ anchor, onClose, setup }: { anchor: HTMLElement | null; onClose: () => void; setup?: CompatSetup }) => {
  const theme = useTheme();
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: -8, horizontal: 'center' }}
      marginThreshold={24}
      slotProps={{
        paper: {
          sx: {
            maxWidth: 'calc(100vw - 48px)',
            backgroundColor: 'backgroundElevated',
            backgroundImage: 'none',
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            boxShadow: `0 12px 32px rgba(0, 0, 0, 0.5), 0 0 16px ${alpha(theme.palette.primary.main, 0.15)}`,
          },
        },
      }}
      data-testid="compat-popover"
    >
      {anchor && <CompatibilityContent setup={setup ?? detectCompatSetup()} />}
    </Popover>
  );
};

interface CompatibilityPopoverProps {
  /** Where the button lives; only affects test ids and icon sizing. */
  placement: 'gate' | 'topbar';
}

/**
 * Info icon button + popover (desktop) or bottom sheet (below `sm`).
 * Lives top-right of the hosted gate card and in the TopBar between the
 * themes button and Settings.
 */
const CompatibilityPopover = ({ placement }: CompatibilityPopoverProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const setup = detectCompatSetup();

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    if (isCompact) setSheetOpen(true);
    else setAnchor(e.currentTarget);
  };

  return (
    <>
      <Tooltip title={t('compat.title')} enterDelay={0} arrow>
        <IconButton
          color="inherit"
          size={placement === 'gate' ? 'small' : 'medium'}
          onClick={handleOpen}
          aria-label={t('compat.title')}
          data-testid={`compat-button-${placement}`}
          sx={placement === 'gate' ? { color: 'text.secondary' } : undefined}
        >
          <InfoIcon fontSize={placement === 'gate' ? 'small' : 'medium'} />
        </IconButton>
      </Tooltip>
      <CompatibilityPopup anchor={anchor} onClose={() => setAnchor(null)} setup={setup} />
      <CompatibilitySheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
};

export default CompatibilityPopover;
