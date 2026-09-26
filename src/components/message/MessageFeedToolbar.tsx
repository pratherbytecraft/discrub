import { memo } from 'react';
import { Box, Button, Checkbox, FormControlLabel, Typography } from '@mui/material';
import {
  ArrowUpward as UpIcon,
  ArrowDownward as DownIcon,
} from '@mui/icons-material';
import { SortDirection } from 'discrub-core/common-enum';
import { useTranslation } from 'react-i18next';
import { perfCount } from '@/utils/perfCounters';

interface MessageFeedToolbarProps {
  totalCount: number;
  selectedCount: number;
  order: SortDirection;
  onToggleSelectAll: () => void;
  onToggleSort: () => void;
}

const MessageFeedToolbar = memo(function MessageFeedToolbar({
  totalCount,
  selectedCount,
  order,
  onToggleSelectAll,
  onToggleSort,
}: MessageFeedToolbarProps) {
  perfCount('MessageFeedToolbar');
  const { t } = useTranslation();
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const someSelected = selectedCount > 0 && !allSelected;
  const isNewestFirst = order === SortDirection.DESCENDING;

  return (
    <Box
      data-testid="message-feed-toolbar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.25,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: (t) => t.palette.backgroundElevated,
      }}
    >
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={allSelected}
            indeterminate={someSelected}
            onChange={onToggleSelectAll}
            inputProps={{ 'aria-label': t('feed.selectAllMessages') }}
          />
        }
        label={
          <Typography variant="caption" color="text.secondary">
            {t('feed.selectAll')}
          </Typography>
        }
        sx={{ m: 0, '.MuiFormControlLabel-label': { ml: 0.25 } }}
      />

      <Button
        size="small"
        variant="text"
        onClick={onToggleSort}
        startIcon={isNewestFirst ? <DownIcon fontSize="small" /> : <UpIcon fontSize="small" />}
        aria-label={isNewestFirst ? t('feed.sortOldestFirst') : t('feed.sortNewestFirst')}
        sx={{ textTransform: 'none' }}
      >
        {isNewestFirst ? t('feed.newestFirst') : t('feed.oldestFirst')}
      </Button>
    </Box>
  );
});

export default MessageFeedToolbar;
