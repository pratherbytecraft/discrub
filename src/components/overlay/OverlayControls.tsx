import { useState } from 'react';
import { Box, Dialog, DialogContent, Divider, IconButton, Tooltip, Typography } from '@mui/material';
import { Minimize as MinimizeIcon, Close as CloseIcon, WarningAmber as WarningIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectIsMinimized, setMinimized } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning, selectOperationSummary } from '@features/app/operationSelectors';
import { isOverlayMode, closeOverlay, minimizeOverlay } from '@/extension/messaging';
import { useHotkey } from '@features/hotkeys/HotkeyProvider';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';

interface OverlayControlsProps {
  /** Button size; the 2.2.0 bars use small, the shared TopBar medium. */
  size?: 'small' | 'medium';
  /** A thin vertical divider before the buttons (TopBar groups). */
  divider?: boolean;
}

/**
 * Minimize and Close for the extension overlay, with the M hotkey and the
 * "Operation in Progress" confirm. Renders nothing outside overlay mode, so
 * every layout's bar can mount it. Until 2.2.6 these lived only in the shared
 * TopBar, so Native, Simple, Operator and Timeline had no way to minimize or
 * close the overlay (overlay-close-2200).
 */
const OverlayControls = ({ size = 'medium', divider = false }: OverlayControlsProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isMinimized = useAppSelector(selectIsMinimized);
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const operationSummary = useAppSelector(selectOperationSummary);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const overlay = isOverlayMode();

  const handleMinimize = async () => {
    dispatch(setMinimized(true));
    try {
      await minimizeOverlay();
    } catch {
      dispatch(setMinimized(false));
    }
  };

  // Minimize is one-shot (no restore-from-minimized hotkey in v1, see backlog).
  useHotkey('minimize', handleMinimize, overlay && !isMinimized);

  const handleCloseConfirm = async () => {
    setCloseDialogOpen(false);
    try {
      await closeOverlay();
    } catch {
      // closeOverlay already logs errors internally
    }
  };

  if (!overlay) return null;

  return (
    <>
      {divider && <Divider orientation="vertical" flexItem sx={{ my: 1.25, borderColor: 'divider', opacity: 0.7 }} />}
      <HotkeyTooltip actionId="minimize" label={t('topbar.minimizeToDiscord')} enterDelay={0} arrow>
        <IconButton size={size} color="inherit" onClick={handleMinimize} aria-label={t('topbar.minimizeDiscrub')} data-testid="overlay-minimize">
          <MinimizeIcon />
        </IconButton>
      </HotkeyTooltip>
      <Tooltip title={t('topbar.closeDiscrub')} enterDelay={0} arrow>
        <IconButton
          size={size}
          color="inherit"
          onClick={() => (isOperationRunning ? setCloseDialogOpen(true) : handleCloseConfirm())}
          aria-label={t('topbar.closeDiscrub')}
          data-testid="overlay-close"
          sx={{ transition: 'background-color 200ms ease', '&:hover': { backgroundColor: 'rgba(240, 71, 71, 0.15)' } }}
        >
          <CloseIcon />
        </IconButton>
      </Tooltip>

      <Dialog
        open={closeDialogOpen}
        onClose={() => setCloseDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper' } }}
      >
        <DialogContent sx={{ textAlign: 'center', py: 4, px: 3, position: 'relative' }}>
          <DialogCloseIcon onClose={() => setCloseDialogOpen(false)} />
          <WarningIcon sx={{ fontSize: 40, color: 'warning.main', mb: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            {t('topbar.operationInProgress')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {operationSummary.label}
          </Typography>
          <Typography variant="body2" color="warning.main" sx={{ mb: 3 }}>
            {t('topbar.closingCancels')}
          </Typography>
          <Box
            component="button"
            onClick={handleCloseConfirm}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5,
              px: 2, py: 1.25, borderRadius: 1, border: 'none', cursor: 'pointer',
              bgcolor: 'action.hover', color: 'text.secondary', width: '100%',
              transition: 'background-color 150ms ease',
              '&:hover': { bgcolor: 'rgba(240, 71, 71, 0.15)', color: 'error.main' },
            }}
          >
            <CloseIcon sx={{ fontSize: 18, color: 'error.main' }} />
            <Typography variant="body2">{t('topbar.closeAnyway')}</Typography>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default OverlayControls;
