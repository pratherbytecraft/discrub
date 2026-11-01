import { useRef, useState } from 'react';
import { Box, Button, Checkbox, Divider, FormControlLabel, TextField, Typography, alpha } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { FileUpload as UploadIcon, Lock as LockIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectHasThemes, selectSupporterFooter, setFooterIcon, updateFooterPreferences } from '@features/supporter/supporterSlice';
import { DEFAULT_FOOTER_TEXT, FOOTER_ICON_ACCEPTED_TYPES, FOOTER_TEXT_MAX_LENGTH, processFooterIconFile } from '@services/exportFooter';

/**
 * The export footer controls under the supporter panel (slot F): live for
 * supporters, shown disabled otherwise so the perk is visible rather than
 * hidden. Discrub's own, the panel itself lives in the supporter package.
 */
const SupporterFooterControls = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const hasThemes = useAppSelector(selectHasThemes);
  const footer = useAppSelector(selectSupporterFooter);
  const [footerTextDraft, setFooterTextDraft] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const commitFooterText = () => {
    if (footerTextDraft === null) return;
    dispatch(updateFooterPreferences({ text: footerTextDraft }));
    setFooterTextDraft(null);
  };

  const handleIconFile = async (file: File | undefined) => {
    if (!file) return;
    setIconError(null);
    try {
      const dataUri = await processFooterIconFile(file);
      dispatch(setFooterIcon(dataUri));
    } catch (error) {
      setIconError(error instanceof Error ? error.message : t('supporter.imageNotUsable'));
    }
    if (iconInputRef.current) iconInputRef.current.value = '';
  };

  const footerControlsDisabled = !hasThemes;
  const footerRemoved = hasThemes && footer.removed;

  return (
    <>
        {/* ---- Export footer (live for supporters, shown disabled otherwise) ---- */}
        <Divider sx={{ my: 2 }} />
        <Box
          data-testid="supporter-footer-controls"
          data-locked={footerControlsDisabled ? 'true' : 'false'}
          sx={(theme: Theme) => ({
            position: 'relative',
            opacity: footerControlsDisabled ? 0.75 : 1,
            ...(footerControlsDisabled && {
              // Locked: diagonal hatching over the whole section so the
              // controls stay readable but clearly fenced off.
              borderRadius: 1.5,
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: -8,
                borderRadius: 1.5,
                pointerEvents: 'none',
                backgroundImage: `repeating-linear-gradient(-45deg, ${alpha(theme.palette.text.primary, 0.07)} 0 6px, transparent 6px 18px)`,
              },
            }),
          })}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('supporter.exportFooter')}
            </Typography>
            {footerControlsDisabled && (
              <LockIcon sx={{ fontSize: 14, color: 'error.main' }} data-testid="supporter-footer-lock" />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {footerControlsDisabled ? (
              <>
                {t('supporter.footerHelpLocked')}
              </>
            ) : (
              <>
                {t('supporter.footerHelp')}
              </>
            )}
          </Typography>

          <FormControlLabel
            control={
              <Checkbox
                checked={!footerRemoved}
                disabled={footerControlsDisabled}
                onChange={(e) =>
                  dispatch(updateFooterPreferences({ removed: !e.target.checked }))
                }
                inputProps={{ 'data-testid': 'supporter-footer-enabled' } as object}
              />
            }
            label={<Typography variant="body2">{t('supporter.includeFooter')}</Typography>}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            <TextField
              size="small"
              label={t('supporter.footerText')}
              placeholder={DEFAULT_FOOTER_TEXT}
              value={
                footerControlsDisabled
                  ? DEFAULT_FOOTER_TEXT
                  : (footerTextDraft ?? footer.text ?? '')
              }
              onChange={(e) => setFooterTextDraft(e.target.value)}
              onBlur={commitFooterText}
              onKeyDown={(e) => e.key === 'Enter' && commitFooterText()}
              disabled={footerControlsDisabled || footerRemoved}
              inputProps={
                {
                  'data-testid': 'supporter-footer-text',
                  maxLength: FOOTER_TEXT_MAX_LENGTH,
                } as object
              }
              helperText={footerControlsDisabled ? t('supporter.footerFreeLine') : t('supporter.footerBlankDefault')}
              fullWidth
            />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {!footerControlsDisabled && footer.iconDataUri ? (
                <Box
                  component="img"
                  src={footer.iconDataUri}
                  alt={t('supporter.customFooterIcon')}
                  data-testid="supporter-footer-icon-preview"
                  sx={{ width: 32, height: 32, borderRadius: 1, flexShrink: 0 }}
                />
              ) : (
                <Box
                  component="img"
                  src="/icons/icon-48.png"
                  alt={t('supporter.defaultFooterIcon')}
                  sx={{ width: 32, height: 32, borderRadius: 1, flexShrink: 0, opacity: 0.7 }}
                />
              )}
              <Button
                size="small"
                startIcon={<UploadIcon />}
                onClick={() => iconInputRef.current?.click()}
                disabled={footerControlsDisabled || footerRemoved}
                data-testid="supporter-footer-upload"
              >
                {t('supporter.customIcon')}
              </Button>
              {!footerControlsDisabled && footer.iconDataUri && (
                <Button
                  size="small"
                  color="error"
                  onClick={() => dispatch(setFooterIcon(null))}
                  data-testid="supporter-footer-icon-remove"
                >
                  {t('supporter.useDefault')}
                </Button>
              )}
              <input
                ref={iconInputRef}
                type="file"
                accept={FOOTER_ICON_ACCEPTED_TYPES.join(',')}
                style={{ display: 'none' }}
                data-testid="supporter-footer-icon-input"
                onChange={(e) => handleIconFile(e.target.files?.[0])}
              />
            </Box>
            {iconError && (
              <Typography variant="caption" color="error" data-testid="supporter-footer-icon-error">
                {iconError}
              </Typography>
            )}
          </Box>
        </Box>
    </>
  );
};

export default SupporterFooterControls;
