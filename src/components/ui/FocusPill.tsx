import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Bottom-centre pill shown while Focus is on (2.2.0, A2). Same in every
 * layout: says Focus is on and how to leave it. Purely informational.
 */
const FocusPill = () => {
  const { t } = useTranslation();
  const key = (label: string) => (
    <Box component="kbd" sx={{ fontFamily: 'inherit', fontSize: '0.7rem', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.6, color: 'text.primary', mx: 0.4 }}>{label}</Box>
  );
  return (
    <Box
      data-testid="focus-pill"
      sx={(theme) => ({
        position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1300,
        display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.6, borderRadius: 4,
        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(30, 31, 34, 0.96)' : 'rgba(255, 255, 255, 0.96)',
        border: '1px solid', borderColor: 'divider', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      })}
    >
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }} />
      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}>
        {t('focus.on')}<Box component="span" sx={{ opacity: 0.6, mx: 0.6 }}>·</Box>{key('F')}{t('focus.or')}{key('Esc')}{t('focus.toLeave')}
      </Typography>
    </Box>
  );
};

export default FocusPill;
