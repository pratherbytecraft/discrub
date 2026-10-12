import { useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { resetDiscrubData } from '@/extension/storage';
import { useTranslation } from 'react-i18next';

interface ResetDiscrubButtonProps {
  /**
   * "link" — small inline text link, intended for LandingPage where
   * the affordance must not compete with the primary Sign In flow.
   * "button" — standard error-colored button, intended for the Reset
   * tab in SettingsModal.
   */
  variant?: 'link' | 'button';
}

/**
 * Defense-in-depth escape hatch (Backlog #134). Wipes every byte of
 * Discrub data on this device + reloads. See `resetDiscrubData()` in
 * `@/extension/storage`. The confirmation modal is intentionally the
 * same in both placements (consistency over targeted friction).
 */
const ResetDiscrubButton = ({ variant = 'button' }: ResetDiscrubButtonProps) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const [resetting, setResetting] = useState(false);

  const handleConfirm = async () => {
    setResetting(true);
    try {
      await resetDiscrubData();
    } catch {
      // resetDiscrubData already reloads on success; if it threw before
      // reaching reload, force it so the user gets the fresh start they
      // explicitly asked for.
      window.location.reload();
    }
  };

  const trigger =
    variant === 'link' ? (
      <Link
        component="button"
        type="button"
        variant="caption"
        color="text.secondary"
        underline="hover"
        onClick={() => setOpen(true)}
        data-testid="reset-discrub-link"
      >
        {t('resetDiscrub.stuck')}
      </Link>
    ) : (
      <Button
        variant="contained"
        color="error"
        onClick={() => setOpen(true)}
        data-testid="reset-discrub-button"
      >
        {t('resetDiscrub.button')}
      </Button>
    );

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onClose={resetting ? undefined : () => setOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper' } }}
      >
        <DialogTitle>{t('resetDiscrub.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t('resetDiscrub.intro')}
            </Typography>
            <Stack component="ul" spacing={0.5} sx={{ pl: 3, m: 0 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('resetDiscrub.itemSettings')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('resetDiscrub.itemPresets')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('resetDiscrub.itemCache')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('resetDiscrub.itemPackages')}
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                {t('resetDiscrub.itemWorkspaces')}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t('resetDiscrub.outro')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setOpen(false)}
            disabled={resetting}
            data-testid="reset-discrub-cancel"
          >
            {t('resetDiscrub.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirm}
            disabled={resetting}
            startIcon={resetting ? <CircularProgress size={16} color="inherit" /> : undefined}
            data-testid="reset-discrub-confirm"
          >
            {resetting ? t('resetDiscrub.resetting') : t('resetDiscrub.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ResetDiscrubButton;
