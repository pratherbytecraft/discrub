import { useState, useEffect, useRef, FormEvent } from 'react';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Link,
  Stack,
  Checkbox,
  FormControlLabel,
  alpha,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  authenticateWithToken,
  clearManualLogout,
  forgetRememberedToken,
  rememberToken,
  selectAuthError,
  selectAuthLoading,
  selectAuthRestoring,
  selectManuallyLoggedOut,
  selectTokenRemembered,
} from '@features/auth/authSlice';
import { isExtensionMode, requestDiscordToken } from '@/extension/messaging';
import ResetDiscrubButton from '@components/settings/ResetDiscrubButton';
import LanguageLink from '@components/ui/LanguageLink';
import { isBleedingEdgeBuild, isHostedGateEnabled } from '@services/hostedGate';
import {
  applyPastedSupporterKey,
  removeSupporterKey,
  selectHasHosted,
  selectSupporter,
  selectSupporterClaimError,
  selectSupporterClaimInProgress,
} from '@features/supporter/supporterSlice';
import { liveSupporterFeatures } from '@services/supporterKeyService';
import { KOFI_MONTHLY_URL, KOFI_BLEEDING_EDGE_YEARLY_URL } from '@services/kofiLinks';
import BleedingTitle from '@components/supporter/BleedingTitle';
import CompatibilityPopover from '@components/compatibility/CompatibilityPopover';
import { Trans } from 'react-i18next';
import { useTranslation } from 'react-i18next';

/**
 * Landing page component - handles user authentication with Discord token
 *
 * Supports three authentication methods (in order of precedence):
 * 1. Environment variable (VITE_DISCORD_TOKEN) - for development
 * 2. Extension auto-auth - automatically retrieves token from discord.com
 * 3. Manual token entry - user enters token manually
 *
 * Hosted build (VITE_HOSTED_GATE=true): a supporter key field sits
 * above the token field. The key persists (same storage as the palette
 * hub, so themes unlock through the same path). Sign-in needs a key
 * carrying the `hosted` feature; a themes-only key is told so before
 * any token is asked for.
 *
 * Web builds (not the extension) offer an opt-in "Keep me logged in"
 * checkbox (#249): the token is then stored plaintext in
 * `Discrub-state` and restored on the next visit. Logout forgets it.
 */
const LandingPage = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const authError = useAppSelector(selectAuthError);
  const isLoading = useAppSelector(selectAuthLoading);
  const manuallyLoggedOut = useAppSelector(selectManuallyLoggedOut);
  const isRestoring = useAppSelector(selectAuthRestoring);
  const tokenRemembered = useAppSelector(selectTokenRemembered);
  const hostedGate = isHostedGateEnabled();
  // Branding only (title, icon glow, Compatibility button); the key gate stays on hostedGate.
  const bleedingEdge = isBleedingEdgeBuild();
  // The dev env token would walk straight past the key gate, so the
  // hosted build never reads it (production web builds blank it anyway).
  const envToken = hostedGate ? '' : import.meta.env.VITE_DISCORD_TOKEN;

  const supporter = useAppSelector(selectSupporter);
  const hasHosted = useAppSelector(selectHasHosted);
  const keyBusy = useAppSelector(selectSupporterClaimInProgress);
  const keyError = useAppSelector(selectSupporterClaimError);
  const [keyInput, setKeyInput] = useState('');
  const keyPresent = supporter.keyStatus !== 'none' && supporter.payload !== null;
  const gateSatisfied = !hostedGate || hasHosted;
  const hostedKeyMessage = (() => {
    if (!hostedGate || !supporter.initialized || !keyPresent) return null;
    if (hasHosted) return null;
    const live = liveSupporterFeatures(supporter.payload);
    if (supporter.keyStatus !== 'valid' || live.length === 0) {
      return t('landing.supporterKeyInactive');
    }
    return t('landing.supporterKeyNoBleedingEdge');
  })();

  const [token, setToken] = useState(envToken || '');
  const [rememberMe, setRememberMe] = useState(false);
  const [isExtension, setIsExtension] = useState(false);
  const [autoAuthAttempted, setAutoAuthAttempted] = useState(false);
  const [autoAuthLoading, setAutoAuthLoading] = useState(false);
  const [autoAuthError, setAutoAuthError] = useState<string | null>(null);

  // Detect extension mode on mount
  useEffect(() => {
    const extensionMode = isExtensionMode();
    setIsExtension(extensionMode);
  }, []);

  // Auto-authenticate via env token (development) — ref prevents strict mode double-fire
  const envAuthAttempted = useRef(false);
  useEffect(() => {
    if (envToken && envToken.trim() && !manuallyLoggedOut && !envAuthAttempted.current) {
      envAuthAttempted.current = true;
      dispatch(authenticateWithToken(envToken.trim())).catch((error) => {
        console.error('Auto-authentication (env) failed:', error);
        envAuthAttempted.current = false;
      });
    }
  }, [dispatch, envToken, manuallyLoggedOut]);

  // Auto-authenticate via extension (production)
  useEffect(() => {
    if (isExtension && !autoAuthAttempted && !envToken && !manuallyLoggedOut) {
      attemptAutoAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trigger set
  }, [isExtension, autoAuthAttempted, envToken, manuallyLoggedOut]);

  const attemptAutoAuth = async () => {
    setAutoAuthAttempted(true);
    setAutoAuthLoading(true);
    setAutoAuthError(null);

    try {
      console.log('[Discrub] Attempting automatic token retrieval from Discord...');
      const response = await requestDiscordToken();

      if (response.success && response.token) {
        console.log('[Discrub] Token retrieved successfully, authenticating...');
        await dispatch(authenticateWithToken(response.token)).unwrap();
        // On success, App.tsx will automatically switch to the main layout
      } else {
        console.warn('[Discrub] Auto-auth failed:', response.error || 'No token found');
        setAutoAuthError(response.error || t('landing.autoAuthNoToken'));
      }
    } catch (error) {
      console.error('[Discrub] Auto-authentication failed:', error);
      setAutoAuthError(t('landing.autoAuthFailed'));
    } finally {
      setAutoAuthLoading(false);
    }
  };

  const handleApplyKey = () => {
    if (!keyInput.trim() || keyBusy) return;
    dispatch(applyPastedSupporterKey(keyInput)).then(() => setKeyInput(''));
  };

  const handleManualSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !gateSatisfied) {
      return;
    }

    try {
      const signedIn = await dispatch(authenticateWithToken(token.trim())).unwrap();
      // #249: persist (or drop) the token per the opt-in checkbox.
      if (!isExtension) {
        if (rememberMe) {
          await dispatch(rememberToken(signedIn));
        } else if (tokenRemembered) {
          await dispatch(forgetRememberedToken());
        }
      }
      // On success, App.tsx will automatically switch to the main layout
    } catch (error) {
      // Error is handled in Redux state and displayed via authError
      console.error('Authentication failed:', error);
    }
  };

  const handleRetryAutoAuth = () => {
    dispatch(clearManualLogout());
    setAutoAuthAttempted(false);
    setAutoAuthError(null);
  };

  // Show loading state during auto-auth, or while a remembered token
  // (#249) is being validated on boot.
  // `isRestoring` only turns on once a stored token is actually being
  // validated, so an in-flight env/extension auth never flips the panel.
  const restoringRememberedToken = isRestoring;
  if ((isExtension && autoAuthLoading && !envToken) || restoringRememberedToken) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: (theme) => `linear-gradient(135deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 100%)`,
          padding: 2,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            padding: 5,
            maxWidth: 500,
            width: '100%',
            backgroundColor: (theme) => theme.palette.backgroundGlass,
            border: 1,
            borderColor: 'divider',
            borderRadius: 4,
          }}
        >
          <Stack spacing={3} alignItems="center" data-testid={restoringRememberedToken ? 'landing-restoring' : undefined}>
            <CircularProgress size={60} />
            <Typography variant="h5" color="text.primary" textAlign="center">
              {t('landing.authenticating')}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {restoringRememberedToken
                ? t('landing.signingInSavedToken')
                : t('landing.retrievingToken')}
            </Typography>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              {t('landing.mayTakeSeconds')}
            </Typography>
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: (theme) => `linear-gradient(135deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 100%)`,
        backgroundImage: (theme: Theme) => `
          radial-gradient(circle at 20% 50%, ${alpha(theme.palette.primary.main, 0.1)} 0%, transparent 50%),
          radial-gradient(circle at 80% 80%, ${alpha(theme.palette.primary.dark, 0.1)} 0%, transparent 50%)
        `,
        padding: 2,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          padding: 5,
          maxWidth: 500,
          width: '100%',
          backgroundColor: (theme) => theme.palette.backgroundGlass,
          border: (theme: Theme) => `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          borderRadius: 4,
          boxShadow: (theme: Theme) => `0 0 20px ${alpha(theme.palette.primary.main, 0.1)}`,
          animation: 'fade-in-scale 600ms ease',
          position: 'relative',
        }}
      >
        {bleedingEdge && (
          <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
            <CompatibilityPopover placement="gate" />
          </Box>
        )}
        <form onSubmit={handleManualSignIn}>
          <Stack spacing={3} alignItems="center">
            {/* Discrub Icon */}
            <Box
              component="img"
              src="/discrub.png"
              alt="Discrub"
              sx={{
                width: 80,
                height: 80,
                filter: (theme: Theme) =>
                  bleedingEdge
                    ? 'drop-shadow(0 8px 18px rgba(220, 38, 38, 0.55))'
                    : `drop-shadow(0 8px 16px ${alpha(theme.palette.primary.main, 0.4)})`,
              }}
            />

            {bleedingEdge ? (
              <BleedingTitle caption={t('landing.earlyAccessBuild', { version: __APP_VERSION__ })} />
            ) : (
              <>
                <Typography variant="h4" color="text.primary" textAlign="center">
                  {t('landing.welcome')}
                </Typography>

                <Typography variant="body2" color="text.secondary" textAlign="center">
                  {isExtension
                    ? t('landing.enterTokenExtension')
                    : t('landing.enterToken')}
                </Typography>
              </>
            )}

            {envToken && import.meta.env.DEV && (
              <Alert severity="info" sx={{ width: '100%' }}>
                {t('landing.usingEnvToken')}
              </Alert>
            )}

            {autoAuthError && (
              <Alert severity="warning" sx={{ width: '100%' }}>
                {autoAuthError}
              </Alert>
            )}

            {authError && (
              <Alert severity="error" sx={{ width: '100%' }}>
                {authError}
              </Alert>
            )}

            {hostedGate && (
              <Box sx={{ width: '100%' }} data-testid="hosted-gate">
                {keyPresent && supporter.payload ? (
                  <Alert
                    severity={hasHosted ? 'success' : 'warning'}
                    data-testid="hosted-gate-key-status"
                    action={
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => dispatch(removeSupporterKey())}
                        data-testid="hosted-gate-forget-key"
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        {t('landing.forgetMyKey')}
                      </Button>
                    }
                  >
                    {hostedKeyMessage ?? t('landing.supporterKeyValidated')}
                  </Alert>
                ) : (
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <TextField
                        fullWidth
                        type="password"
                        label={t('landing.keyLabel')}
                        placeholder="PBYTE-..."
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyKey();
                          }
                        }}
                        error={Boolean(keyError)}
                        helperText={
                          keyError ?? (
                            <span data-testid="hosted-gate-help">
                              <Trans
                                i18nKey="landing.keyHelp"
                                components={{
                                  monthly: (
                                    <Link
                                      href={KOFI_MONTHLY_URL}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      data-testid="hosted-gate-kofi-monthly"
                                    />
                                  ),
                                  yearly: (
                                    <Link
                                      href={KOFI_BLEEDING_EDGE_YEARLY_URL}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      data-testid="hosted-gate-kofi-yearly"
                                    />
                                  ),
                                }}
                              />
                            </span>
                          )
                        }
                        disabled={keyBusy}
                        inputProps={{ 'data-testid': 'hosted-gate-key' } as object}
                        autoFocus
                      />
                      <Button
                        variant="outlined"
                        onClick={handleApplyKey}
                        disabled={!keyInput.trim() || keyBusy}
                        sx={{ alignSelf: 'flex-start', height: 40, flexShrink: 0 }}
                        data-testid="hosted-gate-apply"
                      >
                        {keyBusy ? <CircularProgress size={20} /> : t('landing.apply')}
                      </Button>
                    </Box>
                  </Stack>
                )}
              </Box>
            )}

            <TextField
              fullWidth
              type="password"
              label={t('landing.discordToken')}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              error={Boolean(authError)}
              helperText={
                <>
                  {authError && (
                    <>
                      {t('landing.invalidToken')}
                      <br />
                    </>
                  )}
                  {rememberMe ? t('landing.tokenSavedUntilLogout') : t('landing.tokenKeptUntilClose')}
                </>
              }
              disabled={isLoading || !gateSatisfied}
              autoFocus={!isExtension && !hostedGate}
              required
            />

            {!isExtension && tokenRemembered && (
              <Alert
                severity="info"
                sx={{ width: '100%' }}
                data-testid="landing-token-remembered"
                action={
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => dispatch(forgetRememberedToken())}
                    data-testid="landing-forget-token"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {t('landing.forgetSavedToken')}
                  </Button>
                }
              >
                {t('landing.tokenFromLastSession')}
              </Alert>
            )}

            {!isExtension && (
              <Box sx={{ width: '100%' }}>
                <FormControlLabel
                  sx={{ alignItems: 'flex-start', mr: 0 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={isLoading || !gateSatisfied}
                      inputProps={{ 'data-testid': 'landing-remember-token' } as object}
                      sx={{ mt: -0.5 }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" color="text.primary">
                        {t('landing.keepMeLoggedIn')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {t('landing.trustedDeviceOnly')}
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            )}

            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={!token.trim() || isLoading || !gateSatisfied}
              size="large"
              data-testid="landing-sign-in"
            >
              {isLoading ? <CircularProgress size={24} /> : t('landing.signIn')}
            </Button>

            {isExtension && (
              <Button
                fullWidth
                variant="outlined"
                onClick={handleRetryAutoAuth}
                disabled={isLoading || autoAuthLoading}
                size="large"
              >
                {t('landing.tryAutoAuthAgain')}
              </Button>
            )}

            <Stack spacing={0.75} alignItems="center">
              <Link
                href="https://github.com/pratherbytecraft/discrub#finding-your-discord-token"
                target="_blank"
                rel="noopener noreferrer"
                variant="caption"
                color="primary"
              >
                {t('landing.howToFindToken')}
              </Link>
              <ResetDiscrubButton variant="link" />
              <LanguageLink />
            </Stack>

            {isExtension && (
              <Typography variant="caption" color="text.secondary" textAlign="center">
                {t('landing.extensionModeHint')}
              </Typography>
            )}

            <Typography variant="caption" color="text.secondary" textAlign="center">
              {t('landing.unofficialTool')}
            </Typography>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
};

export default LandingPage;
