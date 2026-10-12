import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import {
  Archive as ArchiveIcon,
  ArrowBack as ArrowBackIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  clearPackageDeletedCache,
  movePackageChannelOutOfLeftServers,
  recheckLeftServers,
  resetPackage,
  resumeStoredPackage,
  revalidatePackage,
  selectPackageValidatedUserId,
  selectLeftServersRecheckStatus,
  selectChannelDeletedMessageCount,
  selectPackageChannel,
  selectPackageDeletedMessageCount,
  selectPackageGoneMessageCount,
  selectChannelGoneMessageCount,
  selectPackageValidation,
  selectParsedPackage,
  selectSelectedPackageChannelId,
  selectTotalDeletedMessageCount,
} from '@features/package/packageSlice';
import { formatProvenanceTooltip } from '@features/package/packageStatusCopy';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectIsGuestMode } from '@features/auth/authSlice';
import { selectGuilds } from '@features/guild/guildSlice';
import { getPackageChannelLabel, getPackageChannelCategory } from '@features/package/packageDisplayUtils';
import ImportDialog from './ImportDialog';
import PackageAnalytics from './PackageAnalytics';
import PackageMessageTable from './PackageMessageTable';
import { useTranslation } from 'react-i18next';

/**
 * Main-pane view shown when the "Package" sidebar tab is active.
 *
 * - No package loaded → import prompt + ImportDialog.
 * - Package loaded, no channel selected → summary + analytics.
 * - Package loaded, channel selected → channel header + PackageMessageTable.
 */
const PackageView = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const parsed = useAppSelector(selectParsedPackage);
  const validation = useAppSelector(selectPackageValidation);
  const selectedChannelId = useAppSelector(selectSelectedPackageChannelId);
  const liveGuilds = useAppSelector(selectGuilds);
  const totalDeleted = useAppSelector(selectTotalDeletedMessageCount);
  // #236: live remaining counts. Archive counts (pkg:meta) are static;
  // deletions made through Discrub are subtracted at display time only.
  const packageDeleted = useAppSelector(selectPackageDeletedMessageCount);
  const selectedChannelDeleted = useAppSelector(
    selectChannelDeletedMessageCount(selectedChannelId ?? ''),
  );
  // #271: how many of those were already gone when Discrub tried them.
  const packageGone = useAppSelector(selectPackageGoneMessageCount);
  const selectedChannelGone = useAppSelector(
    selectChannelGoneMessageCount(selectedChannelId ?? ''),
  );
  const currentUserId = useAppSelector(selectCurrentUser)?.id ?? null;
  const isGuest = useAppSelector(selectIsGuestMode);
  const validatedUserId = useAppSelector(selectPackageValidatedUserId);
  const token = useAppSelector((s) => s.auth.token);
  const recheckStatus = useAppSelector(selectLeftServersRecheckStatus);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Resume a previously-streamed package automatically (#162). The
  // thunk no-ops when nothing matches the authenticated user, so this
  // is safe to fire on every mount and on auth changes.
  useEffect(() => {
    if (parsed) return;
    // #275: a guest resumes too, the thunk finds the stored owner itself.
    if (!currentUserId && !isGuest) return;
    void dispatch(resumeStoredPackage());
  }, [dispatch, parsed, currentUserId, isGuest]);

  // #275: a guest who signs in afterwards gets the package validated
  // against the account, so delete and the token features switch on for
  // the package owner.
  useEffect(() => {
    if (!parsed || validatedUserId === currentUserId) return;
    void dispatch(revalidatePackage());
  }, [dispatch, parsed, validatedUserId, currentUserId]);

  // #273: once per loaded package, ask Discord about every Left Servers
  // channel so a Server rejoined since the export moves back where it
  // belongs. Needs a token; the section header has a button to run it again.
  useEffect(() => {
    if (!parsed || !token || recheckStatus !== 'idle') return;
    if (!parsed.channels.some((c) => c.isOrphan)) return;
    void dispatch(recheckLeftServers());
  }, [dispatch, parsed, token, recheckStatus]);

  const leftGuilds = useMemo(() => {
    // #275: a guest has no Server list, so there is nothing to compare.
    if (!parsed || !liveGuilds || !token) return [];
    const live = new Set(liveGuilds.map((g) => g.id));
    return parsed.guilds.filter((g) => !live.has(g.id));
  }, [parsed, liveGuilds, token]);

  const selectedChannel = useMemo(
    () => parsed?.channels.find((c) => c.id === selectedChannelId) ?? null,
    [parsed, selectedChannelId],
  );

  if (!parsed) {
    return (
      <>
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
            gap: 2,
          }}
        >
          <ArchiveIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
          <Typography variant="h5">{t('package.importTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, textAlign: 'center' }}>
            {t('package.importIntro')}
          </Typography>
          <Button
            variant="contained"
            startIcon={<UploadIcon />}
            onClick={() => setDialogOpen(true)}
            sx={{ mt: 1 }}
          >
            {t('package.chooseZip')}
          </Button>
        </Box>
        <ImportDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </>
    );
  }

  if (selectedChannel) {
    const remainingCount = Math.max(
      selectedChannel.messageCount - selectedChannelDeleted,
      0,
    );
    const caption = selectedChannel.isOrphan
      ? t('package.orphanCaption')
      : selectedChannel.guildName
        ? t('package.guildCaption', { guild: selectedChannel.guildName, count: remainingCount.toLocaleString() })
        : t('package.messagesCaption', { count: remainingCount.toLocaleString() });
    const captionNode = (
      <Typography variant="caption" color="text.secondary" noWrap>
        {caption}
      </Typography>
    );
    return (
      <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <IconButton
            aria-label={t('package.backToAnalytics')}
            size="small"
            onClick={() => dispatch(selectPackageChannel(null))}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              {getPackageChannelLabel(selectedChannel)}
            </Typography>
            {selectedChannelDeleted > 0 && !selectedChannel.isOrphan ? (
              <Tooltip
                title={formatProvenanceTooltip(selectedChannel.messageCount, selectedChannelDeleted, selectedChannelGone)}
              >
                {captionNode}
              </Tooltip>
            ) : (
              captionNode
            )}
          </Box>
          {selectedChannel.isOrphan && (
            <>
              <Chip label="Read only · left server" size="small" color="warning" variant="outlined" />
              <Button
                size="small"
                variant="outlined"
                onClick={() => void dispatch(movePackageChannelOutOfLeftServers({ channelId: selectedChannel.id }))}
              >
                {t('package.moveOutOfLeftServers')}
              </Button>
            </>
          )}
        </Stack>

        <PackageMessageTable channel={selectedChannel} />
      </Box>
    );
  }

  const { user, channels, guilds, totalMessages } = parsed;
  const orphanCount = channels.filter((c) => c.isOrphan).length;
  // #270: count through the category so the chip and the sidebar agree
  // (orphans excluded, inferred DMs included).
  const dmCount = channels.filter((c) => {
    const category = getPackageChannelCategory(c);
    return category === 'dm' || category === 'groupDm';
  }).length;
  const nonEmptyChannels = channels.filter((c) => c.messageCount > 0).length;
  const channelsChipLabel =
    channels.length === nonEmptyChannels
      ? t('package.channels', { count: channels.length })
      : t('package.channelsOf', { shown: nonEmptyChannels.toLocaleString(), total: channels.length.toLocaleString() });

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Avatar
          src={parsed.avatarBlobUrl}
          sx={{ width: 64, height: 64 }}
          alt={user.username}
        >
          {user.username.charAt(0).toUpperCase()}
        </Avatar>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">{user.globalName ?? user.username}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('package.userLine', { username: user.username, id: user.id })}
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => dispatch(resetPackage())}>
          {t('package.closePackage')}
        </Button>
      </Stack>

      {validation?.warnings.map((w, i) => (
        <Alert key={i} severity="warning" sx={{ mb: 1 }}>
          {w}
        </Alert>
      ))}

      {leftGuilds.length > 0 && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {t('package.leftServers', {
            count: leftGuilds.length,
            names: leftGuilds.length > 3
              ? t('package.moreNames', { names: leftGuilds.slice(0, 3).map((g) => g.name).join(', '), count: leftGuilds.length - 3 })
              : leftGuilds.map((g) => g.name).join(', '),
          })}
        </Alert>
      )}

      {parsed.isLegacyFormat && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {t('package.legacyNotice')}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
        {packageDeleted > 0 ? (
          <Tooltip
            title={formatProvenanceTooltip(totalMessages, packageDeleted, packageGone)}
          >
            <Chip
              label={t('package.messages', { count: Math.max(totalMessages - packageDeleted, 0) })}
            />
          </Tooltip>
        ) : (
          <Chip label={t('package.messages', { count: totalMessages })} />
        )}
        <Chip label={channelsChipLabel} />
        <Chip label={t('package.servers', { count: guilds.length })} />
        <Chip label={t('package.dms', { count: dmCount })} />
        {orphanCount > 0 && (
          <Chip
            label={t('package.fromLeftServers', { count: orphanCount })}
            color="warning"
            variant="outlined"
          />
        )}
        {totalDeleted > 0 && (
          <Chip
            label={t('package.previouslyDeleted', { count: totalDeleted.toLocaleString() })}
            variant="outlined"
            onDelete={() => dispatch(clearPackageDeletedCache())}
            title={t('package.clearDeletedHistory')}
          />
        )}
      </Stack>

      <PackageAnalytics />

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
        {t('package.selectChannelHint')}
      </Typography>
    </Box>
  );
};

export default PackageView;
