import { Box, alpha, type SxProps, type Theme } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';

/** The theme picker's red lock on a locked supporter item (plan section 9). */
const LockMark = ({ sx }: { sx?: SxProps<Theme> }) => (
  <Box
    data-testid="workspace-lock"
    sx={[
      (theme) => ({
        width: 14,
        height: 14,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: alpha(theme.palette.background.paper, 0.85),
        pointerEvents: 'none',
      }),
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    <LockIcon sx={{ fontSize: 10, color: 'error.main' }} />
  </Box>
);

export default LockMark;
