import { Box, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { dismissAccessEndedNotice, selectAccessEndedNotice } from '@features/supporter/supporterSlice';
import { selectAppLayout } from '@features/app/appSlice';
import { LAYOUT_NAMES } from '@/layouts/types';

/**
 * One-time notice when a valid supporter key comes back expired (2.2.0, A13).
 * Top centre, stays until closed. Names the layout and theme the app fell
 * back to and how to get access back after renewing.
 */
const AccessEndedNotice = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectAccessEndedNotice);
  const layout = useAppSelector(selectAppLayout);
  if (!open) return null;
  return (
    <Box
      role="status"
      data-testid="access-ended-notice"
      sx={(theme) => ({
        position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 9998,
        width: 560, maxWidth: 'calc(100vw - 32px)', display: 'flex', alignItems: 'flex-start', gap: 1.5,
        px: 1.75, py: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider',
        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(43, 45, 49, 0.98)' : 'rgba(255, 255, 255, 0.98)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
      })}
    >
      <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'warning.main', color: '#0d1117', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>!</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
          <Box component="b" sx={{ fontWeight: 600 }}>{t('supporter.accessEnded.title')}</Box>{' '}
          {t('supporter.accessEnded.body', { layout: LAYOUT_NAMES[layout], theme: t('supporter.accessEnded.baseTheme') })}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{t('supporter.accessEnded.after')}</Typography>
      </Box>
      <IconButton size="small" aria-label={t('supporter.accessEnded.close')} onClick={() => dispatch(dismissAccessEndedNotice())} sx={{ mt: -0.5, mr: -0.5 }}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
};

export default AccessEndedNotice;
