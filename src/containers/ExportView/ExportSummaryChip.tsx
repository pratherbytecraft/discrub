import { memo } from 'react';
import { Box, Typography, alpha } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useAppSelector } from '@/app/hooks';
import { selectExport } from '@features/export/exportSlice';
import { selectSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { useTranslation } from 'react-i18next';

/** `hideThreads`: the run exports threads themselves, so the threads option is left out of the line. */
const ExportSummaryChip = memo(({ hideThreads = false }: { hideThreads?: boolean }) => {
  const { t } = useTranslation();
  const exportState = useAppSelector(selectExport);
  const settings = useAppSelector(selectSettings);
  const reactionsEnabled = settings?.[DiscrubSetting.REACTIONS_ENABLED] === 'true';

  const parts: string[] = [];

  // Format
  parts.push(exportState.exportFormat.toUpperCase());

  // Messages per page (not for media-only)
  if (exportState.exportFormat !== 'media') {
    parts.push(t('export.summary.perPage', { count: exportState.messagesPerPage }));
  }

  // Sort order
  parts.push(exportState.sortOrder === 'ascending' ? t('export.summary.oldestFirst') : t('export.summary.newestFirst'));

  // Separate threads
  if (exportState.separateThreads && !hideThreads) {
    parts.push(t('export.summary.separateThreads'));
  }

  // Media info
  const isMediaOnly = exportState.exportFormat === 'media';
  const mediaEnabled = isMediaOnly || exportState.includeMedia;

  if (!mediaEnabled) {
    parts.push(t('export.summary.noMedia'));
  } else {
    const { images, videos, audio } = exportState.mediaConfig;
    if (images && videos && audio) {
      parts.push(t('export.summary.allMedia'));
    } else {
      const types: string[] = [];
      if (images) types.push(t('export.mediaImages'));
      if (videos) types.push(t('export.mediaVideos'));
      if (audio) types.push(t('export.mediaAudio'));
      if (types.length > 0) {
        parts.push(t('export.summary.media', { types: types.join(', ') }));
      }
    }
  }

  // Artist mode
  if (exportState.artistMode && mediaEnabled) {
    parts.push(t('export.summary.artistMode'));
  }

  // Reaction info (format-specific)
  if (exportState.exportFormat === 'html' && reactionsEnabled) {
    parts.push(t('export.summary.reactionsDetailed'));
  } else if (exportState.exportFormat !== 'media') {
    parts.push(t('export.summary.reactionsCounts'));
  }

  // Template (HTML only, only show if non-default)
  if (exportState.exportFormat === 'html' && exportState.exportTemplate === 'discord') {
    parts.push(t('export.summary.discordLayout'));
  }

  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 0.75,
        px: 1.5,
        backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.06),
        border: '1px solid',
        borderColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.3),
        borderRadius: 1,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {parts.join(' \u00b7 ')}
      </Typography>
    </Box>
  );
});

ExportSummaryChip.displayName = 'ExportSummaryChip';

export default ExportSummaryChip;
