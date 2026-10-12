import { Box, Button, Divider, Link, Stack, Typography } from '@mui/material';
import {
  Download as DownloadIcon,
  DeleteSweep as PurgeIcon,
  ContentCopy as CopyIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export interface MultiSelectControlsProps {
  /** Whether multi-select mode is active. Component renders nothing when false. */
  active: boolean;
  /** How many items in the filtered list are currently selected. */
  selectedCount: number;
  /** Total selectable items in the filtered list (denominator for "X of Y"). */
  totalCount: number;
  /** True when every selectable item is selected — toggles link label to "Deselect all". */
  allSelected: boolean;
  /** Toggle between Select all / Deselect all. */
  onToggleAll: () => void;
  /** Open the bulk-export dialog. Omit to hide the Export button (e.g. ServerList v1). */
  onExport?: () => void;
  /** Open the bulk-purge dialog. Omit to hide the Purge button (e.g. ServerList v1). */
  onPurge?: () => void;
  /** Open the bulk-edit dialog (#215). Omit to hide the Edit button (e.g. ServerList / DMList). */
  onEdit?: () => void;
  /** Copy the names of currently-selected items to the clipboard. */
  onCopyNames: () => void;
  /** Plural noun for aria labels — e.g. "channels", "conversations". */
  noun: string;
  /**
   * 2.2.5 WP4b: the action an unfinished run can resume. Its button reads
   * Resume and the actions show even with nothing selected, since the
   * dialog brings back the run's own channels.
   */
  resume?: { export?: boolean; purge?: boolean; edit?: boolean };
}

/**
 * Shared toolbar that renders below the multi-select toggle button in
 * `ChannelList` and `DMList`. Layout principles (#135):
 * - Status (count + select-all toggle link) is plain text + a quiet
 *   link, not buttons. It conveys state, not actions.
 * - Action buttons (Export / Purge) reserve the visual weight of a
 *   filled button. They only appear when the user has something
 *   selected — the status row implies "you need to select first."
 * - Thin divider separates status from actions when both are visible,
 *   for clear hierarchy without excess chrome.
 */
const MultiSelectControls = ({
  active,
  selectedCount,
  totalCount,
  allSelected,
  onToggleAll,
  onExport,
  onPurge,
  onEdit,
  onCopyNames,
  noun,
  resume,
}: MultiSelectControlsProps) => {
  const { t } = useTranslation();
  if (!active) return null;

  const toggleLabel = allSelected ? t('nav.deselectAll') : t('nav.selectAll');
  const resumable = !!(resume?.export || resume?.purge || resume?.edit);
  const showActions = selectedCount > 0 || resumable;
  const resumeLabel = t('workspace.resume');

  return (
    <Stack spacing={1} sx={{ px: 2, pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="multi-select-count"
        >
          {t('nav.selectedOf', { selected: selectedCount, total: totalCount })}
        </Typography>
        <Typography variant="caption" color="text.disabled" component="span">
          ·
        </Typography>
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          onClick={onToggleAll}
          aria-label={t('nav.toggleAllAria', { toggle: toggleLabel, noun })}
          sx={{ color: 'primary.main', cursor: 'pointer' }}
          data-testid="multi-select-toggle-all"
        >
          {toggleLabel}
        </Link>
      </Box>

      {showActions && (
        <>
          <Divider sx={{ my: 0.25 }} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {onExport && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<DownloadIcon fontSize="small" />}
                onClick={onExport}
                aria-label={t('nav.exportSelectedAria', { noun })}
                data-testid="multi-select-export"
                sx={{ textTransform: 'none' }}
              >
                {resume?.export ? resumeLabel : t('nav.export')}
              </Button>
            )}
            {onEdit && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<EditIcon fontSize="small" />}
                onClick={onEdit}
                aria-label={t('nav.editSelectedAria', { noun })}
                data-testid="multi-select-edit"
                sx={{ textTransform: 'none' }}
              >
                {resume?.edit ? resumeLabel : t('nav.edit')}
              </Button>
            )}
            {onPurge && (
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<PurgeIcon fontSize="small" />}
                onClick={onPurge}
                aria-label={t('nav.purgeSelectedAria', { noun })}
                data-testid="multi-select-purge"
                sx={{ textTransform: 'none' }}
              >
                {resume?.purge ? resumeLabel : t('nav.purge')}
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<CopyIcon fontSize="small" />}
              onClick={onCopyNames}
              aria-label={t('nav.copySelectedNamesAria', { noun })}
              data-testid="multi-select-copy"
              sx={{ textTransform: 'none' }}
            >
              {t('nav.copy')}
            </Button>
          </Box>
        </>
      )}
    </Stack>
  );
};

export default MultiSelectControls;
