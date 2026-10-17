import { useEffect } from 'react';
import { Box, Typography, IconButton, Button, useTheme } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectToast, hideToast } from '@features/status/statusSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { fetchMessages } from '@features/message/messageSlice';
import { updateSetting } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';
import { DRAWER_WIDTH } from '@components/donations/DonationDrawer';
import { useDonationDrawerOpen } from '@components/donations/useDonationDrawerOpen';

const TOAST_RIGHT = 24;

const LEVEL_ICONS: Record<string, typeof SuccessIcon> = {
  success: SuccessIcon,
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
  session: InfoIcon,
};

const getLevelColor = (level: string, theme: Theme): string => {
  if (level === 'success') return theme.palette.success.main;
  if (level === 'error') return theme.palette.error.main;
  if (level === 'warning') return theme.palette.warning.main;
  return theme.palette.cta.main; // info / session
};

/**
 * Discord-themed toast notification.
 * Renders in the bottom-right corner, auto-dismisses after configurable duration.
 * Driven by Redux state (showToast/hideToast in statusSlice).
 */
const Toast = () => {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const toast = useAppSelector(selectToast);
  const token = useAppSelector(selectAuthToken);
  const { t } = useTranslation();
  // Row 109 of the 2.2.5 pass: with the supporter wall open as a column the
  // toast sat on its footer, so it moves left of the column. The phone
  // overlay is temporary and the toast stays put under it.
  const { inline: drawerInline } = useDonationDrawerOpen();

  useEffect(() => {
    if (!toast.isVisible) return;
    const timer = setTimeout(() => dispatch(hideToast()), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.isVisible, toast.duration, toast.message, dispatch]);

  if (!toast.isVisible) return null;

  const Icon = LEVEL_ICONS[toast.level] || InfoIcon;
  const color = getLevelColor(toast.level, theme);

  const handleAction = () => {
    if (toast.action?.type === 'reloadChannel' && token) {
      dispatch(fetchMessages({ channelId: toast.action.channelId, token }));
    } else if (toast.action?.type === 'switchLanguage') {
      dispatch(updateSetting({ key: DiscrubSetting.APP_LANGUAGE, value: toast.action.language }));
    }
    dispatch(hideToast());
  };

  return (
    <Box
      role="alert"
      sx={(theme) => ({
        position: 'fixed',
        bottom: 48,
        right: drawerInline ? TOAST_RIGHT + DRAWER_WIDTH : TOAST_RIGHT,
        transition: 'right 225ms cubic-bezier(0, 0, 0.2, 1)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 1,
        px: 1.5,
        pr: 1,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: `${color}50`,
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(40, 43, 48, 0.95)'
          : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        boxShadow: theme.palette.mode === 'dark'
          ? '0 4px 16px rgba(0, 0, 0, 0.4)'
          : '0 4px 16px rgba(0, 0, 0, 0.12)',
        animation: 'toast-slide-in 250ms ease-out',
        '@keyframes toast-slide-in': {
          from: { opacity: 0, transform: 'translateX(20px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        maxWidth: 360,
      })}
    >
      <Icon sx={{ fontSize: 20, color, flexShrink: 0 }} />
      <Typography
        variant="body2"
        sx={{
          color: 'text.primary',
          fontSize: '0.8125rem',
          lineHeight: 1.4,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {toast.message}
      </Typography>
      {toast.action && (
        <Button
          size="small"
          onClick={handleAction}
          sx={{
            color,
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'none',
            px: 1,
            minWidth: 0,
            ml: 0.5,
            '&:hover': { backgroundColor: `${color}15` },
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton
        size="small"
        onClick={() => dispatch(hideToast())}
        aria-label={t('common.dismissNotification')}
        sx={{ color: 'text.disabled', ml: 0.5, '&:hover': { color: 'text.secondary' } }}
      >
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
};

export default Toast;
