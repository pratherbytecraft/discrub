import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Checkbox,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  exportMessages,
  resetExport,
  initializeExportFromSettings,
  selectExport,
} from '@features/export/exportSlice';
import type { ExportConfig } from '@features/export/exportTypes';
import { selectActiveFilteredMessages, selectActiveTab, selectThreadTabs } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { selectSettings } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import {
  exportPackageChannel,
  selectChannelEnrichedMessages,
  selectPackageChannelMessages,
  selectParsedPackage,
} from '@features/package/packageSlice';
import { categorizeMessageAttachments } from '@/utils/mediaUtils';
import { toDiscordMessage } from '@features/package/packageMessageAdapter';
import type { Message } from 'discrub-core/types/discord-types';
import ExportSettingsAccordion from './ExportSettingsAccordion';
import ExportSummaryChip from './ExportSummaryChip';
import PresetSelector from './PresetSelector';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useFullScreenDialog } from '@/hooks/useFullScreenDialog';
import { Trans } from 'react-i18next';
import { useTranslation } from 'react-i18next';

/**
 * Where the messages being exported come from.
 *
 * - `live`: default. Pulls from the active channel/DM, includes live
 *   features (thread separation, reaction enrichment, live media).
 * - `package`: imported Discord data-package channel. No thread
 *   separation (CSV doesn't carry thread refs); media only if the
 *   channel has been rehydrated (expired CDN signatures otherwise).
 */
export type ExportContext =
  | { source: 'live' }
  | { source: 'package'; channelId: string };

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Defaults to live. Supplying a package context flips the dialog
   *  into package mode (different data source + gated options). */
  exportContext?: ExportContext;
}

/**
 * ExportDialog - configure and export messages
 */
const ExportDialog = ({ open, onClose, exportContext = { source: 'live' } }: ExportDialogProps) => {
  const dispatch = useAppDispatch();
  const isPackageContext = exportContext.source === 'package';
  const { t } = useTranslation();
  const packageChannelId = isPackageContext ? exportContext.channelId : null;

  const liveMessages = useAppSelector(selectActiveFilteredMessages);
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedDm = useAppSelector(selectSelectedDm);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const exportState = useAppSelector(selectExport);
  const settings = useAppSelector(selectSettings);
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const activeTab = useAppSelector(selectActiveTab);
  const threadTabs = useAppSelector(selectThreadTabs);

  // Package-mode inputs — selectors always resolve but only drive the
  // dialog when the caller opts in via exportContext.
  const parsedPackage = useAppSelector(selectParsedPackage);
  const packagePmList = useAppSelector(
    selectPackageChannelMessages(packageChannelId),
  );
  const packageEnrichedMap = useAppSelector(
    selectChannelEnrichedMessages(packageChannelId ?? ''),
  );

  // Unify the two data sources behind a common shape so the rest of
  // the dialog doesn't need to branch per-context.
  const { messages, channelName, guildId } = useMemo(() => {
    if (isPackageContext && parsedPackage && packageChannelId) {
      const channel = parsedPackage.channels.find((c) => c.id === packageChannelId);
      const name =
        channel?.name ??
        (channel?.type === 1 ? t('common.directMessage') : packageChannelId);
      const pms = packagePmList ?? [];
      // Prefer enriched live messages when available; fall back to the
      // CSV adapter. Matches exportPackageChannel's thunk behavior.
      const msgs: Message[] = pms.map((pm) => {
        const live = packageEnrichedMap?.[pm.id];
        return live ?? (toDiscordMessage(pm, packageChannelId, parsedPackage.user) as Message);
      });
      return { messages: msgs, channelName: name, guildId: channel?.guildId ?? null };
    }
    const currentContext = selectedChannel || selectedDm;
    const dmName = selectedDm?.recipients?.map((r) => r.username).join(', ') || t('common.directMessage');
    const liveChannelName = activeTab && threadTabs[activeTab]
      ? threadTabs[activeTab].threadName
      : (currentContext?.name || dmName);
    return {
      messages: liveMessages,
      channelName: liveChannelName,
      guildId: selectedGuild?.id ?? null,
    };
  }, [
    isPackageContext,
    parsedPackage,
    packageChannelId,
    packagePmList,
    packageEnrichedMap,
    liveMessages,
    selectedChannel,
    selectedDm,
    selectedGuild,
    activeTab,
    threadTabs,
    t,
  ]);

  const mediaSummary = useMemo(() => categorizeMessageAttachments(messages), [messages]);

  // "Rehydrate before export" toggle — package-only; only useful when
  // the channel hasn't already been rehydrated.
  const [rehydrateFirst, setRehydrateFirst] = useState(false);
  const alreadyRehydrated = !!packageEnrichedMap;
  useEffect(() => {
    // Reset toggle when re-opening the dialog so it doesn't carry
    // stale intent from a previous export.
    if (open) setRehydrateFirst(false);
  }, [open]);

  // Initialize export preferences from settings as soon as they're
  // available. Settings load is async (IDB-backed) so this effect must
  // re-fire when null → populated to avoid the dialog opening with
  // unrelated slice-default values that get later "restored" out from
  // under the user.
  const initFromSettings = useRef(false);
  useEffect(() => {
    if (initFromSettings.current) return;
    if (settings === null) return;
    initFromSettings.current = true;
    dispatch(initializeExportFromSettings(settings));
  }, [settings, dispatch]);

  // Reset stale export progress when dialog opens (preserves user's format/template choices)
  useEffect(() => {
    if (open) {
      dispatch(resetExport());
    }
  }, [open, dispatch]);

  const isMediaOnly = exportState.exportFormat === 'media';

  const handleExport = () => {
    if (messages.length === 0 || isOperationRunning) return;

    // Build ExportConfig — dateFormat/timeFormat from settings, rest from exportState
    const exportConfig: ExportConfig = {
      artistMode: exportState.artistMode,
      sortOrder: exportState.sortOrder,
      previewMedia: exportState.previewMedia,
      dateFormat: settings?.dateFormat || 'MM/dd/yyyy',
      timeFormat: settings?.timeFormat || 'h:mm aa',
      exportTemplate: exportState.exportTemplate,
    };

    if (isPackageContext && packageChannelId) {
      dispatch(
        exportPackageChannel({
          channelId: packageChannelId,
          format: exportState.exportFormat,
          messagesPerPage: exportState.messagesPerPage,
          includeMedia: isMediaOnly ? true : exportState.includeMedia,
          mediaConfig: (isMediaOnly || exportState.includeMedia) ? exportState.mediaConfig : undefined,
          exportConfig,
          rehydrateFirst,
        }),
      );
    } else {
      dispatch(
        exportMessages({
          messages,
          channelName,
          format: exportState.exportFormat,
          messagesPerPage: exportState.messagesPerPage,
          separateThreads: exportState.separateThreads,
          includeMedia: isMediaOnly ? true : exportState.includeMedia,
          guildId: guildId,
          mediaConfig: (isMediaOnly || exportState.includeMedia) ? exportState.mediaConfig : undefined,
          exportConfig,
        })
      );
    }

    // Close dialog immediately — progress shown in TopBar
    onClose();
  };

  const handleClose = () => {
    dispatch(resetExport());
    onClose();
  };

  const fullScreen = useFullScreenDialog();
  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 5 }}>
        {t('export.title')}
        <DialogCloseIcon onClose={handleClose} />
      </DialogTitle>
      <DialogContent sx={{ maxHeight: fullScreen ? undefined : '70vh', overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              <Trans i18nKey="export.exportingFrom" values={{ count: messages.length, name: channelName }} components={{ strong: <strong /> }} />
            </Typography>
          </Box>

          <PresetSelector />

          <ExportSettingsAccordion
            isBulk={false}
            mediaSummary={mediaSummary}
            packageMode={isPackageContext}
          />

          {/* Package-specific rehydration affordance: only render when
              the channel hasn't been rehydrated yet. Once rehydrated,
              the dialog functions exactly like the live export (no
              extra checkboxes or banners) — the live Message objects
              are already in Redux and flow straight through.

              Post-2025-06-14 Discord packages ship permanently-signed
              attachment URLs (`uc=dp` discriminator) that work without
              rehydration, so this checkbox no longer gates media
              download. It now exists purely to fetch reactions, edits,
              and replies from the live API — data the package itself
              doesn't include. */}
          {isPackageContext && !alreadyRehydrated && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={rehydrateFirst}
                    onChange={(e) => setRehydrateFirst(e.target.checked)}
                  />
                }
                label={t('export.rehydrateBeforeExport')}
              />
              {parsedPackage?.isLegacyFormat && exportState.includeMedia && (
                <Alert severity="warning" icon={false} sx={{ py: 0.5, fontSize: '0.8rem' }}>
                  {t('export.oldPackageWarning')}
                </Alert>
              )}
            </Box>
          )}

          {exportState.exportError && (
            <Typography color="error" variant="body2">
              {t('export.error', { error: exportState.exportError })}
            </Typography>
          )}

          <Typography variant="caption" color="text.secondary" data-testid="long-run-note">
            {t('longRun.note')}
          </Typography>
        </Box>
      </DialogContent>
      {/* The top padding keeps the summary strip off the scrolled options above it; the theme draws the divider. */}
      <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, px: 2, pt: 1.5, pb: 1 }}>
        <ExportSummaryChip />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={handleClose} variant="outlined">
            {t('export.cancel')}
          </Button>
          <Button
            onClick={handleExport}
            variant="contained"
            startIcon={<DownloadIcon />}
            disabled={messages.length === 0 || isOperationRunning}
          >
            {t('export.export')}
          </Button>
        </Box>
      </DialogActions>

    </Dialog>
  );
};

export default ExportDialog;
