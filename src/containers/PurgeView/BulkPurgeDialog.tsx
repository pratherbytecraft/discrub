import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControlLabel,
  Checkbox,
  Box,
  Typography,
  Chip,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
} from '@mui/material';
import {
  DeleteSweep as PurgeIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { groupsToTypes } from '@/utils/systemMessageGroups';
import SystemMessageTypePicker from '@components/message/SystemMessageTypePicker';
import type { Channel, Guild } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import TourFootnote from '@components/welcome/TourFootnote';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { selectSettings } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectSelectedGuild, selectCurrentMemberRoles } from '@features/guild/guildSlice';
import { bulkPurgeChannels, bulkPurgeDMs, purgeGuilds } from '@features/purge/purgeSlice';
import type { PurgeMode } from '@features/purge/purgeTypes';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import UserPicker from '@components/ui/UserPicker';
import FilterModal from '@components/search/FilterModal';
import { countActiveFilters } from 'discrub-core/filtering';
import BulkFilterButton from '@components/search/BulkFilterButton';
import SelectedChannelsPill from '@components/dialogs/SelectedChannelsPill';
import { canManageMessages as channelCanManageMessages } from '@/utils/permissionUtils';
import { useFullScreenDialog } from '@/hooks/useFullScreenDialog';
import { useTranslation } from 'react-i18next';

// UI-level mode — promotes "Attachments Only" to a first-class choice.
// Maps to the underlying PurgeMode + deleteAttachmentsOnly flag on dispatch.
type UiPurgeMode = 'messages' | 'attachmentsOnly' | 'reactions' | 'clearReactions';

interface BulkPurgeDialogProps {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  /**
   * 'channels' = selected channels of the current server
   * 'dms'      = selected conversations
   * 'servers'  = #255 multi-server purge: every readable channel in each
   *              selected server, own messages only. `channels` is empty;
   *              the servers come from `guilds`.
   */
  mode: 'channels' | 'dms' | 'servers';
  guilds?: Guild[];
  guildId?: string | null;
  canManageMessages?: boolean;
}

const deriveUiMode = (
  savedMode: string | undefined,
  deleteAttachmentsOnly: boolean,
  canManageMessages: boolean,
): UiPurgeMode => {
  if (savedMode === 'reactions') return 'reactions';
  if (savedMode === 'clearReactions' && canManageMessages) return 'clearReactions';
  if (deleteAttachmentsOnly) return 'attachmentsOnly';
  return 'messages';
};

const BulkPurgeDialog = ({ open, onClose, channels, mode, guilds = [], guildId, canManageMessages = false }: BulkPurgeDialogProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const dispatch = useAppDispatch();
  const settings = useAppSelector(selectSettings);
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const currentUser = useAppSelector(selectCurrentUser);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const memberRoles = useAppSelector(selectCurrentMemberRoles);

  const [uiMode, setUiMode] = useState<UiPurgeMode>('messages');
  const [retainAttachedMedia, setRetainAttachedMedia] = useState(false);
  // #239 — dialog-local, defaults to false on every open (mirrors #233's
  // skipArchivedThreads). A persisted settings default would need a new
  // DiscrubSetting enum member, which lives in discrub-core.
  const [preserveMediaAndLinks, setPreserveMediaAndLinks] = useState(false);
  const [skipArchivedThreads, setSkipArchivedThreads] = useState(false);
  const [selectedSystemGroups, setSelectedSystemGroups] = useState<string[]>([]);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [filterCriteria, setFilterCriteria] = useState<SearchCriteria | null>(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Bumped each time we open the filter modal. Keyed FilterModal below
  // forces a fresh mount so its internal state always seeds from the
  // current savedSearchCriteria (fixes stale-typed-values-on-reopen).
  const [filterModalKey, setFilterModalKey] = useState(0);
  const openFilterModal = () => {
    setFilterModalKey((k) => k + 1);
    setFilterModalOpen(true);
  };

  const currentUserId = currentUser?.id || '';

  // Initialize from settings when dialog opens
  useEffect(() => {
    if (open && settings) {
      const rawMode = settings[DiscrubSetting.PURGE_MODE];
      const deleteAttachmentsOnlySetting =
        settings[DiscrubSetting.PURGE_DELETE_ATTACHMENTS_ONLY] === 'true';
      const derived = deriveUiMode(rawMode, deleteAttachmentsOnlySetting, canManageMessages);
      // Server mode (#255) has no reaction modes; a saved reactions
      // preference falls back to Messages instead of dispatching a mode
      // the dialog does not show.
      setUiMode(mode === 'servers' && (derived === 'reactions' || derived === 'clearReactions') ? 'messages' : derived);
      setRetainAttachedMedia(settings[DiscrubSetting.PURGE_RETAIN_ATTACHED_MEDIA] === 'true');
      setPreserveMediaAndLinks(false);
      setSkipArchivedThreads(false);
      setSelectedSystemGroups([]);
      setTargetUserIds([]);
      setFilterCriteria(null);
      setFilterModalOpen(false);
    }
  }, [open, settings, currentUserId, canManageMessages, mode]);

  const isDmMode = mode === 'dms';
  const isServerMode = mode === 'servers';
  // Server mode counts servers; the other modes count channels.
  const targetCount = isServerMode ? guilds.length : channels.length;

  // In DM mode, restrict UserPicker to only DM participants
  const dmParticipantUserMap = useMemo(() => {
    if (!isDmMode) return cachedUserMap;

    const participantIds = new Set<string>();
    if (currentUserId) participantIds.add(currentUserId);
    channels.forEach((ch) => {
      ch.recipients?.forEach((r) => participantIds.add(r.id));
    });

    const filtered: typeof cachedUserMap = {};
    participantIds.forEach((id) => {
      if (cachedUserMap[id]) {
        filtered[id] = cachedUserMap[id];
      }
    });
    return filtered;
  }, [isDmMode, cachedUserMap, channels, currentUserId]);

  const effectiveUserMap = isDmMode ? dmParticipantUserMap : cachedUserMap;

  const isMessagesFamily = uiMode === 'messages' || uiMode === 'attachmentsOnly';
  const isReactionsFamily = uiMode === 'reactions' || uiMode === 'clearReactions';
  const isClearReactions = uiMode === 'clearReactions';

  // Targeting is hidden only for Clear All Reactions
  const showTargetSection = !isClearReactions;

  // Per-channel MANAGE_MESSAGES audit for guild mode. DMs short-circuit (no
  // guild perms apply) and the result is unused there.
  const guildPermissions = selectedGuild?.permissions;
  const guildPermissionAudit = useMemo(() => {
    if (isDmMode || !guildId || !guildPermissions) {
      return { blockedChannels: [] as Channel[], allBlocked: false, someBlocked: false };
    }
    const blocked = channels.filter(
      (ch) => !channelCanManageMessages(guildPermissions, memberRoles, ch, guildId, currentUserId),
    );
    return {
      blockedChannels: blocked,
      allBlocked: channels.length > 0 && blocked.length === channels.length,
      someBlocked: blocked.length > 0,
    };
  }, [isDmMode, guildId, guildPermissions, memberRoles, channels, currentUserId]);

  const { blockedChannels, allBlocked, someBlocked } = guildPermissionAudit;

  // In DM messages/attachments mode, in reactions without MANAGE_MESSAGES,
  // or in guild messages mode where any selected channel lacks MANAGE_MESSAGES,
  // the target is locked to the current user.
  // Server mode (#255) is always self-only: permissions differ per server
  // and the channel lists are not loaded until the run starts.
  const isTargetLockedToSelf =
    isServerMode
    || (isDmMode && isMessagesFamily)
    || (uiMode === 'reactions' && !canManageMessages)
    || (isMessagesFamily && !isDmMode && someBlocked);

  // Filter-modal-driven target for guild Messages/Attachments Only modes.
  // For DMs / self-locked reactions, target is the current user. For
  // Reactions (with MANAGE) the top-level picker still governs.
  const effectiveTargetUserIds = isTargetLockedToSelf
    ? (currentUserId ? [currentUserId] : [])
    : isMessagesFamily
      ? (filterCriteria?.userIds ?? [])
      : targetUserIds;

  const filterCount = filterCriteria ? countActiveFilters(filterCriteria) : 0;

  // Backlog #196 Phase 2 — flatten the checked group buckets into the
  // MessageType value list the purge predicate consults. Only meaningful
  // in pure Messages mode (full delete); other modes pass an empty list.
  const selectedSystemTypes = useMemo(
    () => groupsToTypes(selectedSystemGroups),
    [selectedSystemGroups],
  );

  const handleConfirm = () => {
    const underlyingMode: PurgeMode = isReactionsFamily
      ? (uiMode === 'clearReactions' ? 'clearReactions' : 'reactions')
      : 'messages';

    const purgeConfig = {
      mode: underlyingMode,
      targetUserIds: isClearReactions ? [] : effectiveTargetUserIds,
      retainAttachedMedia: uiMode === 'messages' ? retainAttachedMedia : false,
      // #239 — Messages mode only, mirroring retainAttachedMedia's gating:
      // the other modes never delete or content-clear whole messages.
      preserveMediaAndLinks: uiMode === 'messages' ? preserveMediaAndLinks : false,
      deleteAttachmentsOnly: uiMode === 'attachmentsOnly',
      // Opt-in system-message deletion only applies to full Messages mode.
      systemMessageTypesToDelete: uiMode === 'messages' ? selectedSystemTypes : [],
      // #233 — guild-only: DMs have no threads to wake.
      skipArchivedThreads: !isDmMode && skipArchivedThreads,
    };

    // All modes now thread filterCriteria — messages family consumes it as
    // the primary target surface, reactions family uses it purely for
    // message-narrowing (orthogonal to the reactor UserPicker).
    const payloadSearchCriteria = filterCriteria;

    if (isServerMode) {
      dispatch(purgeGuilds({ guilds, config: purgeConfig, searchCriteria: payloadSearchCriteria }));
    } else if (isDmMode) {
      dispatch(bulkPurgeDMs({ channels, config: purgeConfig, searchCriteria: payloadSearchCriteria }));
    } else {
      dispatch(bulkPurgeChannels({ channels, config: purgeConfig, guildId, searchCriteria: payloadSearchCriteria }));
    }

    onClose();
  };

  const scopeContext = isDmMode ? 'dm' : 'channel';
  const getSummaryText = () => {
    const count = targetCount;
    const users = t('purge.users', { count: effectiveTargetUserIds.length });
    const targets = t('purge.targets', { count, context: scopeContext });
    if (isServerMode) {
      const scope = t('purge.scopeServers', { count });
      if (uiMode === 'attachmentsOnly') {
        return t('purge.summaryServerAttachments', { scope });
      }
      return t('purge.summaryServerMessages', { scope });
    }
    if (uiMode === 'messages') {
      const base = t('purge.summaryMessages', { targets, users });
      const sysCount = selectedSystemGroups.length;
      if (sysCount > 0) {
        return base + t('purge.summarySystem', { count: sysCount });
      }
      return base;
    }
    if (uiMode === 'attachmentsOnly') {
      return t('purge.summaryAttachments', { users, targets });
    }
    if (uiMode === 'clearReactions') {
      return t('purge.summaryClearReactions', { targets });
    }
    return t('purge.summaryReactions', { users, targets });
  };

  const getConfirmLabel = () => {
    const noun = t('purge.noun', { count: targetCount, context: isServerMode ? 'server' : isDmMode ? 'dm' : 'channel' });
    if (uiMode === 'messages') return t('purge.confirmMessages', { noun });
    if (uiMode === 'attachmentsOnly') return t('purge.confirmAttachments', { noun });
    if (uiMode === 'clearReactions') return t('purge.confirmClearReactions', { noun });
    return t('purge.confirmReactions', { noun });
  };

  const hasNoTargetUsers = !showTargetSection
    ? false
    : effectiveTargetUserIds.length === 0;

  const disabledHint = isOperationRunning
    ? t('purge.hintRunning')
    : targetCount === 0
      ? t('purge.hintNoTargets')
      : hasNoTargetUsers
        ? (isMessagesFamily ? t('purge.hintPickAuthor') : t('purge.hintPickUser'))
        : '';

  const targetLabel = isReactionsFamily ? t('purge.targetReactions') : t('purge.targetAuthor');

  const getLockReasonText = () => {
    if (isServerMode) {
      return t('purge.lockServer');
    }
    if (isDmMode && isMessagesFamily) {
      return t('purge.lockDm');
    }
    if (isMessagesFamily && !isDmMode && someBlocked) {
      if (allBlocked) {
        return t('purge.lockAllBlocked');
      }
      const named = blockedChannels.slice(0, 2).map((c) => `#${c.name}`).join(', ');
      const tail = blockedChannels.length > 2
        ? t('purge.lockSomeBlockedCount', { count: blockedChannels.length })
        : t('purge.lockSomeBlockedNamed', { names: named });
      return t('purge.lockOwnOnly', { tail });
    }
    return t('purge.lockReactions');
  };

  const fullScreen = useFullScreenDialog();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 5 }}>
        {isServerMode ? t('purge.titleServers') : isDmMode ? t('purge.titleDms') : t('purge.titleChannels')}
        <Chip
          label={t('purge.selectedCount', { count: targetCount })}
          size="small"
          sx={{
            ml: 1,
            verticalAlign: 'middle',
            backgroundColor: 'rgba(237, 66, 69, 0.2)',
            color: isDark ? '#f5a6a8' : 'error.main',
            fontWeight: 500,
          }}
        />
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          <SelectedChannelsPill channels={channels} guilds={guilds} mode={isServerMode ? 'servers' : isDmMode ? 'dms' : 'channels'} />

          {/* Mode selection — 4 first-class modes */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mb: 0.75 }}>
              <Typography variant="subtitle2">
                {t('purge.whatToPurge')}
                <TourFootnote stepKey="purge-mode-toggle" />
              </Typography>
            </Box>
            <ToggleButtonGroup
              exclusive
              value={uiMode}
              onChange={(_, newMode: UiPurgeMode | null) => { if (newMode !== null) setUiMode(newMode); }}
              size="small"
              fullWidth
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value="messages">{t('purge.modeMessages')}</ToggleButton>
              <ToggleButton value="attachmentsOnly">{t('purge.modeAttachmentsOnly')}</ToggleButton>
              {/* Reaction modes stay single-server: they need per-channel
                  Manage Messages checks that server mode cannot make up front. */}
              {!isServerMode && (
                <ToggleButton value="reactions">{t('purge.modeReactions')}</ToggleButton>
              )}
              {!isServerMode && canManageMessages && (
                <ToggleButton value="clearReactions">{t('purge.modeClearReactions')}</ToggleButton>
              )}
            </ToggleButtonGroup>
            {uiMode === 'attachmentsOnly' && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {t('purge.attachmentsOnlyHelp')}
              </Typography>
            )}
            {uiMode === 'clearReactions' && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {t('purge.clearReactionsHelp', { context: scopeContext })}
              </Typography>
            )}
          </Box>

          {/* Target messages section — shown for all modes except Clear All Reactions */}
          {showTargetSection && (
            <>
              <Divider textAlign="left" sx={{ '& .MuiDivider-wrapper': { pl: 0 } }}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
                  {t('purge.targetMessages')}
                </Typography>
              </Divider>

              <Box>
                {isTargetLockedToSelf ? (
                  <>
                    <UserPicker
                      selectedUserIds={currentUserId ? [currentUserId] : []}
                      onChange={() => {}}
                      cachedUserMap={effectiveUserMap}
                      currentUserId={currentUserId}
                      disabled
                      label={targetLabel}
                    />
                    <Alert severity="info" variant="outlined" sx={{ py: 0.5, mt: 1 }}>
                      {getLockReasonText()}
                    </Alert>
                    {(isMessagesFamily || isReactionsFamily) && (
                      <Box sx={{ mt: 1.5 }}>
                        <BulkFilterButton
                          filterCount={filterCount}
                          onOpen={openFilterModal}
                          helperText={isMessagesFamily
                            ? t('purge.narrowMessagesHelp')
                            : t('purge.narrowScanHelp')}
                        />
                      </Box>
                    )}
                  </>
                ) : isMessagesFamily ? (
                  // Guild Messages / Attachments Only: filter modal is the
                  // primary target surface. Author + any narrowing goes
                  // through the modal; confirm stays disabled until the
                  // user has set at least one author there.
                  <BulkFilterButton
                    filterCount={filterCount}
                    onOpen={openFilterModal}
                    helperText={t('purge.pickAuthorHelp')}
                  />
                ) : (
                  <>
                    <UserPicker
                      selectedUserIds={targetUserIds}
                      onChange={setTargetUserIds}
                      cachedUserMap={effectiveUserMap}
                      currentUserId={currentUserId}
                      label={targetLabel}
                    />
                    {isReactionsFamily && (
                      <Box sx={{ mt: 1.5 }}>
                        <BulkFilterButton
                          filterCount={filterCount}
                          onOpen={openFilterModal}
                          helperText={t('purge.narrowScanIndependentHelp')}
                        />
                      </Box>
                    )}
                  </>
                )}
              </Box>
            </>
          )}

          {/* Clear All Reactions: no target picker, but still offer narrowing */}
          {isClearReactions && (
            <Box>
              <BulkFilterButton
                filterCount={filterCount}
                onOpen={openFilterModal}
                helperText={t('purge.narrowClearHelp')}
              />
            </Box>
          )}

          {/* Clear-text-keep-attachments checkbox — only meaningful in Messages mode */}
          {uiMode === 'messages' && (
            <FormControlLabel
              sx={{ m: 0, alignItems: 'flex-start' }}
              control={
                <Checkbox
                  size="small"
                  checked={retainAttachedMedia}
                  onChange={(e) => setRetainAttachedMedia(e.target.checked)}
                  inputProps={{ 'aria-label': t('purge.clearTextKeepAttachments') }}
                  sx={{ mt: '-4px' }}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('purge.clearTextKeepAttachments')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('purge.clearTextKeepAttachmentsHelp')}
                  </Typography>
                </Box>
              }
            />
          )}

          {/* #239 — keep messages with files or links. Messages mode only,
              same gating as the retain-media checkbox above: the other
              modes never delete or content-clear whole messages. Preserve
              wins over retain-media when both are checked. */}
          {uiMode === 'messages' && (
            <FormControlLabel
              sx={{ m: 0, alignItems: 'flex-start' }}
              control={
                <Checkbox
                  size="small"
                  checked={preserveMediaAndLinks}
                  onChange={(e) => setPreserveMediaAndLinks(e.target.checked)}
                  inputProps={{ 'aria-label': t('purge.keepWithFiles') }}
                  sx={{ mt: '-4px' }}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('purge.keepWithFiles')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('purge.keepWithFilesHelp')}
                  </Typography>
                </Box>
              }
            />
          )}

          {/* #233 — leave archived threads untouched. Acting inside an
              archived thread requires briefly un-archiving it (Discord
              error 50083), which resurfaces the thread for every member
              until it's re-archived at the end of the run. Guild mode
              only: DMs have no threads. */}
          {!isDmMode && (
            <FormControlLabel
              sx={{ m: 0, alignItems: 'flex-start' }}
              control={
                <Checkbox
                  size="small"
                  checked={skipArchivedThreads}
                  onChange={(e) => setSkipArchivedThreads(e.target.checked)}
                  inputProps={{ 'aria-label': t('purge.dontWakeThreads') }}
                  sx={{ mt: '-4px' }}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('purge.dontWakeThreads')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('purge.dontWakeThreadsHelp')}
                  </Typography>
                </Box>
              }
            />
          )}

          {/* Backlog #196 Phase 2 — opt-in deletion of Discord system
              messages. Messages mode only: attachments-only / reactions
              modes can't act on contentless system events. */}
          {uiMode === 'messages' && (
            <Accordion
              disableGutters
              elevation={0}
              square
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                backgroundColor: 'transparent',
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2">{t('purge.alsoDeleteSystem')}</Typography>
                {selectedSystemGroups.length > 0 && (
                  <Chip
                    label={selectedSystemGroups.length}
                    size="small"
                    color="error"
                    sx={{ ml: 1, height: 20, '& .MuiChip-label': { px: 1 } }}
                  />
                )}
              </AccordionSummary>
              <AccordionDetails>
                <SystemMessageTypePicker
                  selectedGroups={selectedSystemGroups}
                  onChange={setSelectedSystemGroups}
                  description={t('purge.systemDescription')}
                />
              </AccordionDetails>
            </Accordion>
          )}

          {/* Summary */}
          <Alert severity="warning" variant="outlined">
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t('purge.irreversible')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {getSummaryText()}
            </Typography>
          </Alert>

          {/* #206 wake lock + #247 worker pacing: deletes keep full pace in a
              backgrounded tab, but a tab the browser discards (memory saver /
              tab-sleep) is gone entirely — that's the one remaining caveat. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {isServerMode
              ? t('purge.longRunServer')
              : t('purge.longRun')}
            {t('purge.wakeLockNote')}{' '}
            <span data-testid="long-run-note">{t('longRun.note')}</span>
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        {/* One line that says why the confirm button is off (2.2.0, round 3 review). */}
        {disabledHint && (
          <Typography variant="caption" color="text.secondary" data-testid="purge-disabled-hint" sx={{ flex: 1, pl: 2, textAlign: 'left' }}>
            {disabledHint}
          </Typography>
        )}
        <Button variant="outlined" onClick={onClose}>{t('purge.cancel')}</Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="error"
          startIcon={<PurgeIcon />}
          disabled={targetCount === 0 || hasNoTargetUsers || isOperationRunning}
        >
          {getConfirmLabel()}
        </Button>
      </DialogActions>

      {/* Nested FilterModal — the target picker for Messages/Attachments
          Only modes and the optional narrowing surface elsewhere. */}
      <FilterModal
        key={filterModalKey}
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onServerSearch={(criteria) => {
          setFilterCriteria(criteria);
          setFilterModalOpen(false);
        }}
        onRefine={() => { /* bulk purge has no client-side refine */ }}
        onClearSearch={() => {
          setFilterCriteria(null);
          setFilterModalOpen(false);
        }}
        onClearRefine={() => { /* no-op */ }}
        savedSearchCriteria={filterCriteria ?? undefined}
        cachedUserMap={effectiveUserMap}
        currentUserId={currentUserId}
        hideRefineSection
        applyButtonLabel={t('purge.applyFilters')}
        // Hide From + Author Type only when the message-author concept
        // itself is locked to self by the parent dialog (#137). For
        // Reactions / Clear All Reactions, the reactor is locked but
        // the message-author filter is independent and required for
        // the "remove my reactions only from the other person's
        // messages" workflow.
        hideAuthorFilters={isTargetLockedToSelf && isMessagesFamily}
      />
    </Dialog>
  );
};

export default BulkPurgeDialog;
