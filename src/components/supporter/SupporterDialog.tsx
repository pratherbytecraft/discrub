import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import {
  Palette as PaletteIcon,
  WorkspacePremium as BadgeIcon,
  Autorenew as RefreshIcon,
  DeleteOutline as RemoveIcon,
  FileUpload as UploadIcon,
  FavoriteBorder as HeartIcon,
  CheckCircle as IncludedIcon,
  RadioButtonUnchecked as NotIncludedIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSetting, updateSetting } from '@features/app/appSlice';
import {
  selectSupporterDialogOpen,
  selectSupporterKeyStatus,
  selectSupporterPayload,
  selectSupporterClaimInProgress,
  selectSupporterClaimError,
  selectSupporterFooter,
  selectSupporterLastRefreshAt,
  selectIsSupporter,
  selectHasThemes,
  setSupporterDialogOpen,
  refreshSupporterKey,
  applyPastedSupporterKey,
  removeSupporterKey,
  updateFooterPreferences,
  setFooterIcon,
} from '@features/supporter/supporterSlice';
import {
  isSupporterFeatureLive,
  SUPPORTER_FEATURES,
  type SupporterFeature,
} from '@services/supporterKeyService';
import {
  DEFAULT_FOOTER_TEXT,
  FOOTER_TEXT_MAX_LENGTH,
  FOOTER_ICON_ACCEPTED_TYPES,
  processFooterIconFile,
} from '@services/exportFooter';
import { ThemeGrid } from '@components/settings/tabs/ThemePicker';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import KofiIcon from './KofiIcon';

import {
  KOFI_MONTHLY_URL,
  KOFI_SUPPORTER_YEARLY_URL,
  KOFI_BLEEDING_EDGE_YEARLY_URL,
  KOFI_COMMISSIONS_URL,
  HOSTED_URL,
} from '@services/kofiLinks';
import { useFullScreenDialog } from '@/hooks/useFullScreenDialog';
import { Trans } from 'react-i18next';
import i18next from 'i18next';
import { t as translate } from '@/i18n';
import { useTranslation } from 'react-i18next';

export { KOFI_MONTHLY_URL, KOFI_SUPPORTER_YEARLY_URL, KOFI_BLEEDING_EDGE_YEARLY_URL, HOSTED_URL };


type Period = 'monthly' | 'yearly';
const PLAN: Record<SupporterFeature, Record<Period, { price: string; unit: string; url: string }>> = {
  themes: {
    monthly: { price: '$3', unit: 'supporter.perMonth', url: KOFI_MONTHLY_URL },
    yearly: { price: '$25', unit: 'supporter.perYear', url: KOFI_SUPPORTER_YEARLY_URL },
  },
  hosted: {
    monthly: { price: '$5', unit: 'supporter.perMonth', url: KOFI_MONTHLY_URL },
    yearly: { price: '$40', unit: 'supporter.perYear', url: KOFI_BLEEDING_EDGE_YEARLY_URL },
  },
};

const formatDate = (unix: number) => new Date(unix * 1000).toLocaleDateString(i18next.language);

const relativeTime = (ms: number | null): string => {
  if (ms === null) return translate('supporter.notCheckedYet');
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 2) return translate('supporter.checkedJustNow');
  if (minutes < 60) return translate('supporter.checkedMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return translate('supporter.checkedHours', { count: hours });
  return translate('supporter.checkedDays', { count: Math.round(hours / 24) });
};

const kofiButtonSx = {
  backgroundColor: '#ff5e5b',
  color: '#fff',
  fontWeight: 700,
  textTransform: 'none',
  boxShadow: '0 4px 16px rgba(255, 94, 91, 0.3)',
  '&:hover': {
    backgroundColor: '#e5524f',
    boxShadow: '0 6px 24px rgba(255, 94, 91, 0.45)',
  },
} as const;

/**
 * The Themes and Supporter hub behind the toolbar palette button: one
 * place for switching themes, supporting, and applying a key.
 *
 * Reading order (owner decision 2026-08-20): who you are and what you
 * have first, then the perks. Supporters see an access card directly
 * under the title (name, one row per feature, Refresh/Remove icon
 * buttons), then the theme grid, animations toggle, and export footer
 * controls. Non-supporters see the purchase grid and paste box first,
 * then the grid with locked previews, and the footer controls shown
 * disabled so the perk is visible rather than hidden. Nothing is
 * pinned; the dialog scrolls naturally.
 */
const SupporterDialog = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fullScreen = useFullScreenDialog();
  const open = useAppSelector(selectSupporterDialogOpen);
  const keyStatus = useAppSelector(selectSupporterKeyStatus);
  const payload = useAppSelector(selectSupporterPayload);
  const claimInProgress = useAppSelector(selectSupporterClaimInProgress);
  const claimError = useAppSelector(selectSupporterClaimError);
  const lastRefreshAt = useAppSelector(selectSupporterLastRefreshAt);
  const isSupporter = useAppSelector(selectIsSupporter);
  const hasThemes = useAppSelector(selectHasThemes);
  const themeSetting = useAppSelector(selectSetting(DiscrubSetting.APP_THEME_MODE)) || 'auto';
  const animationsSetting =
    useAppSelector(selectSetting(DiscrubSetting.APP_THEME_ANIMATIONS)) || 'true';

  const footer = useAppSelector(selectSupporterFooter);

  const [pastedKey, setPastedKey] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [footerTextDraft, setFooterTextDraft] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    dispatch(setSupporterDialogOpen(false));
  };

  const handleThemePick = (id: string) => {
    dispatch(updateSetting({ key: DiscrubSetting.APP_THEME_MODE, value: id }));
  };

  const handlePasteApply = () => {
    if (!pastedKey.trim() || claimInProgress) return;
    dispatch(applyPastedSupporterKey(pastedKey));
  };

  const handleRefresh = () => {
    if (claimInProgress) return;
    dispatch(refreshSupporterKey());
  };

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

  const featureLine = (feature: SupporterFeature): string => {
    if (!payload || !(feature in payload.ent)) return t('supporter.notIncluded');
    const exp = payload.ent[feature];
    if (exp === null) return t('supporter.neverExpires');
    const live = keyStatus === 'valid' && isSupporterFeatureLive(payload, feature);
    return live ? t('supporter.through', { date: formatDate(exp as number) }) : t('supporter.ended', { date: formatDate(exp as number) });
  };

  const renewsAutomatically =
    payload !== null && Object.values(payload.ent).some((exp) => typeof exp === 'number');

  const footerControlsDisabled = !hasThemes;
  const footerRemoved = hasThemes && footer.removed;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      PaperProps={{ sx: { bgcolor: 'background.paper' }, 'data-testid': 'supporter-dialog' } as object}
    >
      <Box sx={{ px: 3, pt: 3, pb: 1, textAlign: 'center', position: 'relative', flexShrink: 0 }}>
        <DialogCloseIcon onClose={handleClose} label={t('supporter.close')} />

        {isSupporter ? (
          <BadgeIcon sx={{ fontSize: 32, color: 'cta.main' }} />
        ) : (
          <PaletteIcon sx={{ fontSize: 32, color: 'cta.main' }} />
        )}
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {isSupporter ? t('supporter.thankYou') : t('supporter.themes')}
        </Typography>
        {!isSupporter && (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              mt: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
            }}
          >
            {t('supporter.unlocks')}
            <HeartIcon sx={{ fontSize: 14, color: '#ff5e5b' }} />
          </Typography>
        )}
      </Box>

      <DialogContent sx={{ px: 3, pt: 1, pb: 3 }}>
        {/* ---- Access (supporter) or purchase + paste (everyone else) ---- */}
        {payload && keyStatus !== 'none' && keyStatus !== 'invalid' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
            <Box
              data-testid="supporter-status"
              sx={{
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: (theme: Theme) => alpha(theme.palette.cta.main, 0.08),
                border: '1px solid',
                borderColor: (theme: Theme) => alpha(theme.palette.cta.main, 0.3),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                  {t('supporter.keyIssuedTo', { name: payload.name })}
                </Typography>
                <Tooltip title={t('supporter.refreshTooltip')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleRefresh}
                      disabled={claimInProgress}
                      aria-label={t('supporter.refreshKey')}
                      data-testid="supporter-refresh-key"
                    >
                      {claimInProgress ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('supporter.removeTooltip')}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => dispatch(removeSupporterKey())}
                      disabled={claimInProgress}
                      aria-label={t('supporter.removeKey')}
                      data-testid="supporter-remove-key"
                    >
                      <RemoveIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              <Box
                component="ul"
                data-testid="supporter-access-list"
                sx={{ listStyle: 'none', m: 0, mt: 1, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
              >
                {SUPPORTER_FEATURES.map((feature) => {
                  const live = keyStatus === 'valid' && isSupporterFeatureLive(payload, feature);
                  const included = feature in payload.ent;
                  return (
                    <Box
                      component="li"
                      key={feature}
                      data-testid={`supporter-access-${feature}`}
                      data-live={live ? 'true' : 'false'}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                      {live ? (
                        <IncludedIcon sx={{ fontSize: 18, color: 'success.main' }} />
                      ) : (
                        <NotIncludedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
                      )}
                      <Typography variant="body2" sx={{ fontWeight: 600, width: 110, flexShrink: 0 }}>
                        {t(`supporter.feature.${feature}`)}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ color: live ? 'text.primary' : 'text.secondary', flex: 1, minWidth: 0 }}
                        noWrap
                      >
                        {featureLine(feature)}
                        {!included && (
                          <>
                            {' · '}
                            <Link
                              href={feature === 'hosted' ? KOFI_MONTHLY_URL : KOFI_MONTHLY_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ color: 'cta.main' }}
                              data-testid={`supporter-get-${feature}`}
                            >
                              <KofiIcon size={12} sx={{ verticalAlign: '-2px', mr: 0.5 }} />
                              {t('supporter.getOnKofi')}
                            </Link>
                          </>
                        )}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', display: 'block', mt: 1 }}
                data-testid="supporter-checkin-note"
              >
                {relativeTime(lastRefreshAt)}.
                {renewsAutomatically
                  ? t('supporter.renewsAutomatically')
                  : ''}
              </Typography>
            </Box>

            {keyStatus === 'expired' && (
              <Typography
                variant="caption"
                sx={{ color: 'warning.main' }}
                data-testid="supporter-lapsed-note"
              >
                {t('supporter.lapsedNote')}
              </Typography>
            )}
            {keyStatus === 'revoked' && (
              <Typography variant="caption" sx={{ color: 'warning.main' }} data-testid="supporter-revoked-note">
                {t('supporter.revokedNote')}
              </Typography>
            )}
            {claimError && (
              <Typography variant="caption" color="error" data-testid="supporter-claim-error">
                {claimError}
              </Typography>
            )}
          </Box>
        ) : null}

        {!isSupporter && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }} data-testid="supporter-purchase">
            <ToggleButtonGroup
              value={period}
              exclusive
              size="small"
              onChange={(_, next: 'monthly' | 'yearly' | null) => next && setPeriod(next)}
              aria-label={t('supporter.billingPeriod')}
              data-testid="supporter-period"
              sx={{ alignSelf: 'center' }}
            >
              <ToggleButton value="monthly" data-testid="supporter-period-monthly" sx={{ textTransform: 'none', px: 2 }}>
                {t('supporter.monthly')}
              </ToggleButton>
              <ToggleButton value="yearly" data-testid="supporter-period-yearly" sx={{ textTransform: 'none', px: 2 }}>
                {t('supporter.yearly')}
                <Typography component="span" variant="caption" sx={{ ml: 0.75, color: 'success.main', fontWeight: 700 }}>
                  {t('supporter.saveAbout')}
                </Typography>
              </ToggleButton>
            </ToggleButtonGroup>
            <Box
              data-testid="supporter-purchase-grid"
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 1.5,
              }}
            >
              {(['themes', 'hosted'] as const).map((feature) => {
                const plan = PLAN[feature][period];
                return (
                  <Box
                    key={feature}
                    data-testid={`supporter-plan-${feature}`}
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {feature === 'themes' ? t('supporter.planSupporter') : t('supporter.planBleedingEdge')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {feature === 'themes'
                          ? t('supporter.blurb.themes')
                          : t('supporter.hostedPlanBlurb')}
                      </Typography>
                    </Box>
                    <Box sx={{ mt: 'auto', display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1 }} data-testid={`supporter-price-${feature}`}>
                        {plan.price}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t(plan.unit)}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="contained"
                      href={plan.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      startIcon={<KofiIcon size={16} />}
                      sx={kofiButtonSx}
                      data-testid={`supporter-kofi-${feature}-${period}`}
                    >
                      {t('supporter.supportOnKofi')}
                    </Button>
                  </Box>
                );
              })}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
              {t('supporter.oneKey', { host: HOSTED_URL.replace('https://', '') })}
            </Typography>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                label={t('supporter.keyLabel')}
                placeholder="PBYTE-..."
                value={pastedKey}
                onChange={(e) => setPastedKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasteApply()}
                inputProps={{ 'data-testid': 'supporter-paste-key' } as object}
                fullWidth
              />
              <Button
                variant="contained"
                onClick={handlePasteApply}
                disabled={!pastedKey.trim() || claimInProgress}
                startIcon={claimInProgress ? <CircularProgress size={16} /> : undefined}
                data-testid="supporter-paste-apply"
              >
                {t('supporter.apply')}
              </Button>
            </Box>
            {!payload && claimError && (
              <Typography variant="caption" color="error" data-testid="supporter-claim-error">
                {claimError}
              </Typography>
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              <Trans
                i18nKey="supporter.keyArrives"
                components={{ mail: <Link href="mailto:keys@pratherbytecraft.com" sx={{ color: 'cta.main' }} data-testid="supporter-key-email-link" /> }}
              />
            </Typography>
          </Box>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* ---- Themes ---- */}
        <Box data-testid="supporter-theme-showcase">
          <ThemeGrid
            value={themeSetting}
            onChange={handleThemePick}
            isSupporter={hasThemes}
            cardWidth={104}
            centered
          />
          <Typography
            variant="caption"
            sx={{ display: 'block', color: 'text.secondary', textAlign: 'center', mt: 1.5 }}
            data-testid="supporter-commission-note"
          >
            <Trans
              i18nKey="supporter.wantTheme"
              components={{ kofi: <Link href={KOFI_COMMISSIONS_URL} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 600 }} /> }}
            />
          </Typography>
        </Box>

        <FormControlLabel
          sx={{ mt: 1.5, alignItems: 'flex-start' }}
          control={
            <Checkbox
              size="small"
              sx={{ mt: -0.5 }}
              checked={animationsSetting === 'true'}
              onChange={(e) =>
                dispatch(
                  updateSetting({
                    key: DiscrubSetting.APP_THEME_ANIMATIONS,
                    value: e.target.checked ? 'true' : 'false',
                  }),
                )
              }
              inputProps={{ 'data-testid': 'theme-animations-toggle' } as object}
            />
          }
          label={
            <Box>
              <Typography variant="body2">{t('supporter.themeAnimations')}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('supporter.themeAnimationsHelp')}
              </Typography>
            </Box>
          }
        />

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
      </DialogContent>
    </Dialog>
  );
};

export default SupporterDialog;
