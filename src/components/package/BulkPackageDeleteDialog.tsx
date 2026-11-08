import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import {
  AlternateEmail as DmIcon,
  Archive as ArchiveIcon,
  DeleteForever as DeleteIcon,
  Forum as ThreadIcon,
  GroupAdd as GroupDmIcon,
  Tag as TextChannelIcon,
  Tune as FilterIcon,
} from '@mui/icons-material';
import LastRunFailures from '@components/failures/LastRunFailures';
import SkipListRow, { type LoadedSkipList } from '@components/failures/SkipListRow';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import { countActiveFilters } from 'discrub-core/filtering';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import FilterModal from '@components/search/FilterModal';
import { useFullScreenDialog } from '@/hooks/useFullScreenDialog';
import {
  bulkDeletePackageChannels,
  countBulkDeleteTargets,
  selectBulkDelete,
  selectParsedPackage,
} from '@features/package/packageSlice';
import type { PackageChannel } from '@features/package/packageTypes';
import {
  getPackageChannelCategory,
  getPackageChannelLabel,
  getPackageChannelSubtitle,
} from '@features/package/packageDisplayUtils';

interface BulkPackageDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  /** Channel ids ticked in the sidebar, in sidebar order. */
  channelIds: string[];
}

/**
 * 2.2.8: one confirmation for a package bulk delete. Lists every ticked
 * channel with the count the run would really delete (filtered, minus
 * already gone), the total, an optional filter that applies to every
 * channel, and the warning that there is no second prompt. The button
 * names the number so the person reads it before pressing.
 */
const BulkPackageDeleteDialog = ({ open, onClose, channelIds }: BulkPackageDeleteDialogProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const parsed = useAppSelector(selectParsedPackage);
  const bulk = useAppSelector(selectBulkDelete);
  const fullScreen = useFullScreenDialog();
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  // 2.2.9: a failed list loaded as a skip list. Like the filter, it belongs to one run.
  const [skipList, setSkipList] = useState<LoadedSkipList | null>(null);
  const skipMessageIds = skipList?.skipIds;

  const channels = useMemo(() => {
    const byId = new Map((parsed?.channels ?? []).map((c) => [c.id, c] as const));
    return channelIds.map((id) => byId.get(id)).filter((c): c is PackageChannel => !!c);
  }, [parsed, channelIds]);

  // A filter belongs to one run: the next open starts clean, so a filter left
  // over from an earlier run cannot shrink the counts without being noticed
  // (found on the 2.2.8 VM pass).
  useEffect(() => {
    if (open) {
      setCriteria(null);
      setSkipList(null);
    }
  }, [open]);

  // Count what the run would delete whenever the dialog opens or the filter changes.
  useEffect(() => {
    if (!open || channelIds.length === 0) return;
    void dispatch(countBulkDeleteTargets({ channelIds, criteria, skipMessageIds }));
  }, [dispatch, open, channelIds, criteria, skipMessageIds]);

  const counting = bulk.status === 'counting';
  const counts = bulk.counts;
  const total = channels.reduce((n, c) => n + (c.isOrphan ? 0 : counts[c.id] ?? 0), 0);
  const filterCount = criteria ? countActiveFilters(criteria) : 0;
  const fmt = (n: number) => n.toLocaleString(i18next.language);

  const handleConfirm = () => {
    void dispatch(bulkDeletePackageChannels({ channelIds, criteria, skipMessageIds }));
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen} data-testid="package-bulk-delete-dialog">
      <DialogTitle sx={{ pr: 5 }}>
        {t('package.bulk.title', { count: channels.length })}
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('package.bulk.intro')}
          </Typography>

          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.75 }}>
              <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1, letterSpacing: 1, lineHeight: 1.6 }}>
                {t('package.bulk.colChannel')}
              </Typography>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1, lineHeight: 1.6 }}>
                {t('package.bulk.colMessages')}
              </Typography>
            </Box>
            {channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                count={channel.isOrphan ? null : counts[channel.id]}
                counting={counting}
                fmt={fmt}
              />
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{t('package.bulk.total')}</Typography>
              <Typography variant="subtitle2" data-testid="package-bulk-delete-total" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {counting ? t('package.bulk.counting') : fmt(total)}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant={filterCount > 0 ? 'contained' : 'outlined'}
              color={filterCount > 0 ? 'primary' : 'inherit'}
              startIcon={<FilterIcon fontSize="small" />}
              onClick={() => setFilterOpen(true)}
              data-testid="package-bulk-delete-filters"
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              {filterCount > 0 ? t('package.bulk.editFilters', { count: filterCount }) : t('package.bulk.addFilters')}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 180 }}>
              {filterCount > 0 ? t('package.bulk.filtersActive') : t('package.bulk.filtersHint')}
            </Typography>
          </Box>

          <SkipListRow value={skipList} onChange={setSkipList} />
          <LastRunFailures source="package" />

          {!counting && total === 0 ? (
            <Alert severity="info" variant="outlined" sx={{ py: 0.5 }} data-testid="package-bulk-delete-nothing">
              {t('package.bulk.nothing')}
            </Alert>
          ) : (
            <Alert severity="error" variant="outlined" sx={{ py: 0.5 }}>
              {t('package.bulk.warning')}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          startIcon={<DeleteIcon />}
          disabled={counting || total === 0}
          onClick={handleConfirm}
          data-testid="package-bulk-delete-confirm"
          sx={{ textTransform: 'none' }}
        >
          {t('package.bulk.confirm', { count: total })}
        </Button>
      </DialogActions>

      <FilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onServerSearch={(next: SearchCriteria) => setCriteria(next)}
        onRefine={() => { /* Refine section is hidden in packageMode */ }}
        onClearSearch={() => setCriteria(null)}
        onClearRefine={() => { /* unused in packageMode */ }}
        savedSearchCriteria={criteria ?? undefined}
        cachedUserMap={{}}
        currentUserId={parsed?.user?.id ?? ''}
        packageMode
        applyButtonLabel={t('purge.applyFilters')}
      />
    </Dialog>
  );
};

interface ChannelRowProps {
  channel: PackageChannel;
  /** Null for a Left Servers channel, which the run skips. */
  count: number | null | undefined;
  counting: boolean;
  fmt: (n: number) => string;
}

const ChannelRow = ({ channel, count, counting, fmt }: ChannelRowProps) => {
  const { t } = useTranslation();
  const category = getPackageChannelCategory(channel);
  const Icon =
    category === 'dm' ? DmIcon
      : category === 'groupDm' ? GroupDmIcon
        : category === 'thread' ? ThreadIcon
          : category === 'orphan' ? ArchiveIcon
            : TextChannelIcon;
  return (
    <Box
      data-testid={`package-bulk-delete-row-${channel.id}`}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', opacity: channel.isOrphan ? 0.6 : 1 }}
    >
      <Icon sx={{ fontSize: 18, color: channel.isOrphan ? 'warning.main' : 'text.secondary', flexShrink: 0 }} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{getPackageChannelLabel(channel)}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{getPackageChannelSubtitle(channel)}</Typography>
      </Box>
      {channel.isOrphan ? (
        <Chip label={t('package.bulk.leftServer')} size="small" color="warning" variant="outlined" />
      ) : counting && count === undefined ? (
        <CircularProgress size={14} />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {fmt(count ?? 0)}
        </Typography>
      )}
    </Box>
  );
};

export default BulkPackageDeleteDialog;
