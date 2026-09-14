import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  useTheme,
  alpha,
  lighten,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import {
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  bulkExportChannels,
  bulkExportDMs,
  resetExport,
  initializeExportFromSettings,
  selectExport,
  selectExportCriteria,
  setExportCriteria,
} from '@features/export/exportSlice';
import type { ExportConfig } from '@features/export/exportTypes';
import type { Channel } from 'discrub-core/types/discord-types';
import { selectAuthToken } from '@features/auth/authSlice';
import { selectSettings } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectCurrentUser } from '@features/user/userSlice';
import ExportSettingsAccordion from './ExportSettingsAccordion';
import ExportSummaryChip from './ExportSummaryChip';
import PresetSelector from './PresetSelector';
import FilterModal from '@components/search/FilterModal';
import { countActiveFilters } from 'discrub-core/filtering';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import BulkFilterButton from '@components/search/BulkFilterButton';
import SelectedChannelsPill from '@components/dialogs/SelectedChannelsPill';
import { useFullScreenDialog } from '@/hooks/useFullScreenDialog';
import { useTranslation } from 'react-i18next';

interface BulkExportDialogProps {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  mode: 'channels' | 'dms';
  guildId?: string | null;
}

/**
 * BulkExportDialog - configure and export multiple channels/DMs
 */
const BulkExportDialog = ({ open, onClose, channels, mode, guildId }: BulkExportDialogProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const exportState = useAppSelector(selectExport);
  const token = useAppSelector(selectAuthToken);
  const settings = useAppSelector(selectSettings);
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const currentUser = useAppSelector(selectCurrentUser);
  // Initialize export preferences from settings as soon as they're
  // available. Settings load is async (IDB-backed) so this effect must
  // re-fire when null → populated to avoid the dialog opening with
  // unrelated slice-default values that get later "restored" out from
  // under the user. The reducer is idempotent and the effect short-
  // circuits once settings is non-null + initialized.
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

  // #207 Arm B: the export filter/date window now lives in the export slice
  // (selectExportCriteria) so a preset can restore a saved date range into it.
  const filterCriteria = useAppSelector(selectExportCriteria);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Bumped each time we open the filter modal. Forces FilterModal to
  // remount so its internal useState seeds from the current
  // savedSearchCriteria — otherwise typed-but-not-applied values
  // survive outer-dialog close/reopen cycles.
  const [filterModalKey, setFilterModalKey] = useState(0);

  // Reset filter state when the dialog re-opens — each bulk export
  // session starts from an unfiltered state by default.
  useEffect(() => {
    if (open) {
      dispatch(setExportCriteria(null));
      setFilterModalOpen(false);
    }
  }, [open, dispatch]);

  const filterCount = filterCriteria ? countActiveFilters(filterCriteria) : 0;

  const openFilterModal = () => {
    setFilterModalKey((k) => k + 1);
    setFilterModalOpen(true);
  };

  const isMediaOnly = exportState.exportFormat === 'media';

  const handleExport = () => {
    if (!token || channels.length === 0 || isOperationRunning) return;

    // Build ExportConfig — dateFormat/timeFormat from settings, rest from exportState
    const exportConfig: ExportConfig = {
      artistMode: exportState.artistMode,
      sortOrder: exportState.sortOrder,
      previewMedia: exportState.previewMedia,
      dateFormat: settings?.dateFormat || 'MM/dd/yyyy',
      timeFormat: settings?.timeFormat || 'h:mm aa',
      exportTemplate: exportState.exportTemplate,
    };

    const params = {
      channels,
      token,
      format: exportState.exportFormat,
      messagesPerPage: exportState.messagesPerPage,
      separateThreads: exportState.separateThreads,
      includeMedia: isMediaOnly ? true : exportState.includeMedia,
      guildId: guildId || null,
      mediaConfig: (isMediaOnly || exportState.includeMedia) ? exportState.mediaConfig : undefined,
      exportConfig,
      searchCriteria: filterCriteria,
    };

    if (mode === 'channels') {
      dispatch(bulkExportChannels(params));
    } else {
      dispatch(bulkExportDMs(params));
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
        {mode === 'channels' ? t('export.bulkTitleChannels') : t('export.bulkTitleDms')}
        <Chip
          label={t('export.selectedCount', { count: channels.length })}
          size="small"
          sx={{
            ml: 1,
            verticalAlign: 'middle',
            backgroundColor: (theme: Theme) => alpha(theme.palette.cta.main, 0.2),
            color: (theme: Theme) => (isDark ? lighten(theme.palette.primary.main, 0.4) : theme.palette.primary.main),
            fontWeight: 500,
          }}
        />
        <DialogCloseIcon onClose={handleClose} />
      </DialogTitle>
      <DialogContent sx={{ maxHeight: fullScreen ? undefined : '70vh', overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <SelectedChannelsPill channels={channels} mode={mode} />

          <PresetSelector />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('export.narrowMessages')}
            </Typography>
            <BulkFilterButton
              filterCount={filterCount}
              onOpen={openFilterModal}
              helperText={t('export.narrowHelp')}
            />
          </Box>

          <ExportSettingsAccordion isBulk={true} />

          <Typography variant="caption" color="text.secondary" data-testid="long-run-note">
            {t('longRun.note')}
          </Typography>

          {exportState.exportError && (
            <Typography color="error" variant="body2">
              {t('export.error', { error: exportState.exportError })}
            </Typography>
          )}
        </Box>
      </DialogContent>
      {/* The top padding keeps the summary strip off the scrolled options above it; the theme draws the divider. */}
      <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, px: 2, pt: 1.5, pb: 1 }}>
        <ExportSummaryChip />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button variant="outlined" onClick={handleClose}>
            {t('export.cancel')}
          </Button>
          <Button
            onClick={handleExport}
            variant="contained"
            startIcon={<DownloadIcon />}
            disabled={channels.length === 0 || isOperationRunning}
          >
            {mode === 'channels' ? t('export.exportChannels', { count: channels.length }) : t('export.exportDms', { count: channels.length })}
          </Button>
        </Box>
      </DialogActions>

      <FilterModal
        key={filterModalKey}
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onServerSearch={(criteria) => {
          dispatch(setExportCriteria(criteria));
          setFilterModalOpen(false);
        }}
        onRefine={() => { /* bulk export has no client-side refine */ }}
        onClearSearch={() => {
          dispatch(setExportCriteria(null));
          setFilterModalOpen(false);
        }}
        onClearRefine={() => { /* no-op */ }}
        savedSearchCriteria={filterCriteria ?? undefined}
        cachedUserMap={cachedUserMap}
        currentUserId={currentUser?.id || ''}
        hideRefineSection
        applyButtonLabel={t('export.applyFilters')}
      />
    </Dialog>
  );
};

export default BulkExportDialog;
