import { useState, useEffect, useMemo } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Checkbox,
  Radio,
  Box,
  Collapse,
  Alert,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  setExportFormat,
  setMessagesPerPage,
  setSeparateThreads,
  setIncludeMedia,
  setMediaConfig,
  setArtistMode,
  setSortOrder,
  setPreviewMedia,
  setMaxZipPartBytes,
  setExportTemplate,
  setTextOptions,
  selectExport,
} from '@features/export/exportSlice';
import { ZIP_SIZE_OPTIONS } from '@features/export/exportTypes';
import type {
  ExportFormat,
  ExportTemplate,
  TextAttachmentStyle,
  TextReactionsStyle,
  TextRepliesStyle,
  TextBotIndicatorStyle,
} from '@features/export/exportTypes';
import type { MediaCategorySummary } from '@/utils/mediaUtils';
import { formatBytes, getTotalMediaSize, SIZE_WARNING_THRESHOLD } from '@/utils/mediaUtils';
import MediaBreakdownBar from './MediaBreakdownBar';
import MediaPreviewPanel from './MediaPreviewPanel';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { isExtensionMode } from '@/extension/messaging';
import { selectSettings, updateSetting } from '@features/app/appSlice';
const ZIP_LABEL_KEYS: Record<string, string> = {
  'Single zip (no limit)': 'export.zipSingle',
  '4 GB (recommended)': 'export.zipRecommended',
};
import { useTranslation } from 'react-i18next';

interface ExportSettingsAccordionProps {
  isBulk: boolean;
  mediaSummary?: MediaCategorySummary[];
  onFormatChange?: (format: ExportFormat) => void;
  /**
   * Hide options that only apply to live Discord channels. Packages
   * don't carry thread-reference metadata in their CSVs, and package
   * rehydration handles reactions via its own API loop.
   */
  packageMode?: boolean;
}

const ExportSettingsAccordion = ({ isBulk, mediaSummary, onFormatChange, packageMode = false }: ExportSettingsAccordionProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const exportState = useAppSelector(selectExport);
  const settings = useAppSelector(selectSettings);

  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({
    formatOutput: true,
    content: false,
    media: false,
  });

  const isMediaOnly = exportState.exportFormat === 'media';
  const mediaEnabled = isMediaOnly || exportState.includeMedia;

  // Filter summaries by enabled media types
  const enabledSummaries = useMemo(() => {
    if (!mediaSummary) return [];
    const { images, videos, audio, other } = exportState.mediaConfig;
    return mediaSummary.filter((s) => {
      if (s.category === 'images') return images;
      if (s.category === 'videos') return videos;
      if (s.category === 'audio') return audio;
      if (s.category === 'other') return other;
      return false;
    });
  }, [mediaSummary, exportState.mediaConfig]);

  const enabledSize = useMemo(() => getTotalMediaSize(enabledSummaries), [enabledSummaries]);
  const showSizeWarning = mediaEnabled && enabledSize > SIZE_WARNING_THRESHOLD;
  const largestCategory = useMemo(
    () => enabledSummaries.length > 0
      ? enabledSummaries.reduce((a, b) => (a.totalBytes > b.totalBytes ? a : b))
      : null,
    [enabledSummaries]
  );

  // Auto-expand media section when media is enabled
  useEffect(() => {
    if (mediaEnabled && !expandedPanels.media) {
      setExpandedPanels((prev) => ({ ...prev, media: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trigger set
  }, [mediaEnabled]);

  const handlePanelChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedPanels((prev) => ({ ...prev, [panel]: isExpanded }));
  };

  const handleFormatChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFormat = event.target.value as ExportFormat;
    dispatch(setExportFormat(newFormat));

    // When switching away from Media Only, restore includeMedia from settings
    if (newFormat !== 'media' && isMediaOnly) {
      const includeMedia = settings?.[DiscrubSetting.EXPORT_DOWNLOAD_MEDIA] === 'true';
      dispatch(setIncludeMedia(includeMedia));
    }

    onFormatChange?.(newFormat);
  };

  const handleMessagesPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value);
    if (value > 0) {
      dispatch(setMessagesPerPage(value));
    }
  };

  const getMediaLabel = (category: string, label: string) => {
    if (!mediaSummary || isBulk) return label;

    const summary = mediaSummary.find((s) => s.category === category);
    if (!summary) return t('export.mediaLabelEmpty', { label });

    const parts: string[] = [];
    if (summary.count > 0) {
      parts.push(t('export.mediaLabelFiles', { count: summary.count, size: formatBytes(summary.totalBytes) }));
    }
    if (summary.embedCount > 0) {
      parts.push(t(summary.count > 0 ? 'export.mediaLabelEmbedsPlus' : 'export.mediaLabelEmbeds', { count: summary.embedCount }));
    }

    if (parts.length > 0) return t('export.mediaLabelWith', { label, details: parts.join(' ') });
    return t('export.mediaLabelEmpty', { label });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Format & Output */}
      <Accordion
        expanded={expandedPanels.formatOutput}
        onChange={handlePanelChange('formatOutput')}
        TransitionProps={{ unmountOnExit: false }}
        disableGutters
        elevation={0}
        sx={{ '&:before': { display: 'none' }, backgroundColor: 'transparent' }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2">{t('export.formatAndOutput')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl component="fieldset">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {[
                  'html', 'csv', 'json', 'text', 'media',
                ].map((value) => ({ value, label: t(isBulk ? `export.formatShort.${value}` : `export.format.${value}`) })).map(({ value, label }) => (
                  <FormControlLabel
                    key={value}
                    value={value}
                    control={
                      <Radio
                        checked={exportState.exportFormat === value}
                        onChange={handleFormatChange}
                        value={value}
                        size="small"
                        sx={{ '& .MuiSvgIcon-root': { fontSize: 18 } }}
                      />
                    }
                    label={<Typography variant="body2">{label}</Typography>}
                    sx={{ ml: 0 }}
                  />
                ))}
              </Box>
            </FormControl>

            <TextField
              label={t('export.messagesPerPage')}
              type="number"
              value={exportState.messagesPerPage}
              onChange={handleMessagesPerPageChange}
              disabled={isMediaOnly}
              size="small"
              inputProps={{ min: 1, max: 1000 }}
              helperText={t('export.messagesPerPageHelp')}
            />

            <FormControl size="small">
              <InputLabel>{t('export.sortOrder')}</InputLabel>
              <Select
                value={exportState.sortOrder}
                label={t('export.sortOrder')}
                onChange={(e) => dispatch(setSortOrder(e.target.value as 'ascending' | 'descending'))}
              >
                <MenuItem value="ascending">{t('export.oldestFirst')}</MenuItem>
                <MenuItem value="descending">{t('export.newestFirst')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small">
              <InputLabel>{t('export.maxZipSize')}</InputLabel>
              <Select
                value={exportState.maxZipPartBytes === null ? 'none' : String(exportState.maxZipPartBytes)}
                label={t('export.maxZipSize')}
                onChange={(e) => {
                  const v = e.target.value;
                  dispatch(setMaxZipPartBytes(v === 'none' ? null : Number(v)));
                }}
              >
                {ZIP_SIZE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.label} value={opt.value === null ? 'none' : String(opt.value)}>
                    {ZIP_LABEL_KEYS[opt.label] ? t(ZIP_LABEL_KEYS[opt.label]) : opt.label}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('export.maxZipHelp')}
              </Typography>
            </FormControl>

            {exportState.exportFormat === 'html' && (
              <FormControl size="small">
                <InputLabel>{t('export.template')}</InputLabel>
                <Select
                  value={exportState.exportTemplate}
                  label={t('export.template')}
                  onChange={(e) => {
                    const newTemplate = e.target.value as ExportTemplate;
                    dispatch(setExportTemplate(newTemplate));
                    dispatch(updateSetting({ key: DiscrubSetting.EXPORT_TEMPLATE, value: newTemplate }));
                  }}
                >
                  <MenuItem value="standard">{t('export.templateStandard')}</MenuItem>
                  <MenuItem value="discord">{t('export.templateDiscord')}</MenuItem>
                </Select>
                {exportState.exportTemplate === 'discord' && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                    {t('export.templateDiscordHelp')}
                  </Typography>
                )}
              </FormControl>
            )}

            {exportState.exportFormat === 'text' && (
              <Box
                data-testid="text-format-options"
                sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t('export.plainTextOptions')}
                </Typography>
                <FormControl size="small">
                  <InputLabel id="text-attachment-style-label">{t('export.attachments')}</InputLabel>
                  <Select
                    labelId="text-attachment-style-label"
                    value={exportState.textOptions.attachmentStyle}
                    label={t('export.attachments')}
                    onChange={(e) => dispatch(setTextOptions({ attachmentStyle: e.target.value as TextAttachmentStyle }))}
                  >
                    <MenuItem value="inline">{t('export.inlineUrl')}</MenuItem>
                    <MenuItem value="sidecar">{t('export.sidecarFolder')}</MenuItem>
                    <MenuItem value="skip">{t('export.skip')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <InputLabel id="text-reactions-label">{t('export.reactions')}</InputLabel>
                  <Select
                    labelId="text-reactions-label"
                    value={exportState.textOptions.reactions}
                    label={t('export.reactions')}
                    onChange={(e) => dispatch(setTextOptions({ reactions: e.target.value as TextReactionsStyle }))}
                  >
                    <MenuItem value="include">{t('export.include')}</MenuItem>
                    <MenuItem value="skip">{t('export.skip')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <InputLabel id="text-replies-label">{t('export.replies')}</InputLabel>
                  <Select
                    labelId="text-replies-label"
                    value={exportState.textOptions.replies}
                    label={t('export.replies')}
                    onChange={(e) => dispatch(setTextOptions({ replies: e.target.value as TextRepliesStyle }))}
                  >
                    <MenuItem value="quote">{t('export.quoteLine')}</MenuItem>
                    <MenuItem value="link">{t('export.authorOnly')}</MenuItem>
                    <MenuItem value="skip">{t('export.skip')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <InputLabel id="text-bot-indicator-label">{t('export.botTag')}</InputLabel>
                  <Select
                    labelId="text-bot-indicator-label"
                    value={exportState.textOptions.botIndicator}
                    label={t('export.botTag')}
                    onChange={(e) => dispatch(setTextOptions({ botIndicator: e.target.value as TextBotIndicatorStyle }))}
                  >
                    <MenuItem value="include">{t('export.include')}</MenuItem>
                    <MenuItem value="skip">{t('export.skip')}</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            )}
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Content — live channels only. Package CSVs don't carry thread
          refs, so the separate-threads pipeline has nothing to fetch. */}
      {!packageMode && (
        <Accordion
          expanded={expandedPanels.content}
          onChange={handlePanelChange('content')}
          TransitionProps={{ unmountOnExit: false }}
          disableGutters
          elevation={0}
          sx={{ '&:before': { display: 'none' }, backgroundColor: 'transparent' }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2">{t('export.content')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportState.separateThreads}
                  onChange={(e) => {
                    dispatch(setSeparateThreads(e.target.checked));
                  }}
                  disabled={isMediaOnly}
                />
              }
              label={t('export.downloadThreads')}
            />
          </AccordionDetails>
        </Accordion>
      )}

      {/* Media */}
      <Accordion
        expanded={expandedPanels.media}
        onChange={handlePanelChange('media')}
        TransitionProps={{ unmountOnExit: false }}
        disableGutters
        elevation={0}
        sx={{ '&:before': { display: 'none' }, backgroundColor: 'transparent' }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2">{t('export.filesAndMedia')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={isMediaOnly ? true : exportState.includeMedia}
                  onChange={(e) => {
                    dispatch(setIncludeMedia(e.target.checked));
                  }}
                  disabled={isMediaOnly}
                />
              }
              label={t('export.downloadFiles')}
            />

            <Collapse in={mediaEnabled} timeout="auto">
              <Box sx={{ pl: 4, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                  {t('export.mediaTypesToInclude')}
                </Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={exportState.mediaConfig.images}
                      onChange={(e) => dispatch(setMediaConfig({ images: e.target.checked }))}
                    />
                  }
                  label={<Typography variant="body2">{getMediaLabel('images', t('export.mediaImages'))}</Typography>}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={exportState.mediaConfig.videos}
                      onChange={(e) => dispatch(setMediaConfig({ videos: e.target.checked }))}
                    />
                  }
                  label={<Typography variant="body2">{getMediaLabel('videos', t('export.mediaVideos'))}</Typography>}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={exportState.mediaConfig.audio}
                      onChange={(e) => dispatch(setMediaConfig({ audio: e.target.checked }))}
                    />
                  }
                  label={<Typography variant="body2">{getMediaLabel('audio', t('export.mediaAudio'))}</Typography>}
                />
                {isExtensionMode() && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={exportState.mediaConfig.other}
                        onChange={(e) => dispatch(setMediaConfig({ other: e.target.checked }))}
                      />
                    }
                    label={<Typography variant="body2">{getMediaLabel('other', t('export.mediaOtherFiles'))}</Typography>}
                  />
                )}
              </Box>

              <Box sx={{ pl: 4, mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                  {t('export.displayOptions')}
                </Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={exportState.artistMode}
                      onChange={(e) => dispatch(setArtistMode(e.target.checked))}
                    />
                  }
                  label={<Typography variant="body2">{t('export.artistMode')}</Typography>}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={exportState.previewMedia}
                      onChange={(e) => dispatch(setPreviewMedia(e.target.checked))}
                    />
                  }
                  label={<Typography variant="body2">{t('export.previewMedia')}</Typography>}
                />
              </Box>

              {/* Breakdown bar + preview + size warning (single-channel only) */}
              {mediaSummary && !isBulk && (
                <Box sx={{ pl: 4, mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <MediaBreakdownBar summaries={enabledSummaries} />
                  <MediaPreviewPanel summaries={enabledSummaries} />
                </Box>
              )}

              <Collapse in={showSizeWarning}>
                <Box sx={{ pl: 4, mt: 1 }}>
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    {t('export.estimatedSize', { size: formatBytes(enabledSize) })}
                    {largestCategory && t('export.largestCategory', { category: t(`export.media${largestCategory.category.charAt(0).toUpperCase()}${largestCategory.category.slice(1)}`, { defaultValue: largestCategory.category }), percent: Math.round((largestCategory.totalBytes / enabledSize) * 100) })}
                  </Alert>
                </Box>
              </Collapse>
            </Collapse>
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default ExportSettingsAccordion;
