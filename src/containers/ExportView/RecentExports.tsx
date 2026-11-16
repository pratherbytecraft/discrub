import { useState, useMemo } from 'react';
import { Box, Button, Chip, Collapse, Typography } from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { applyPreset } from '@features/export/exportSlice';
import {
  clearRecentExports,
  selectRecentExports,
} from '@features/history/historySlice';
import type { RecentExport } from '@features/export/exportTypes';
import { timeAgo } from '@/utils/timeAgo';
import { useTranslation } from 'react-i18next';

const MAX_RECENT = 5;

const RecentExports = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const allRecent = useAppSelector(selectRecentExports);
  const [expanded, setExpanded] = useState(false);

  const recentExports = useMemo(() => allRecent.slice(0, MAX_RECENT), [allRecent]);

  if (recentExports.length === 0) return null;

  const handleClick = (entry: RecentExport) => {
    dispatch(applyPreset(entry.config));
  };

  const handleClearAll = () => {
    dispatch(clearRecentExports());
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          {t('export.recentExports', { count: recentExports.length })}
        </Typography>
        {expanded ? (
          <ExpandLessIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        ) : (
          <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        )}
      </Box>

      <Collapse in={expanded} timeout="auto">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 1.5, pb: 1 }}>
          {recentExports.map((entry, index) => (
            <Box
              key={entry.id}
              onClick={() => handleClick(entry)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.5,
                borderRadius: 0.5,
                cursor: 'pointer',
                backgroundColor: index % 2 === 1 ? 'action.hover' : 'transparent',
                '&:hover': { backgroundColor: 'action.selected' },
              }}
            >
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                {entry.channelName}
                {entry.isBulk && entry.channelCount && (
                  <Typography component="span" variant="caption" color="text.secondary">
                    {t('export.channelsCount', { count: entry.channelCount, context: entry.unit })}
                  </Typography>
                )}
              </Typography>
              <Chip
                label={entry.config.format.toUpperCase()}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
              <Typography variant="caption" color="text.secondary" noWrap>
                {timeAgo(entry.timestamp)}
              </Typography>
            </Box>
          ))}

          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleClearAll();
            }}
            sx={{ textTransform: 'none', alignSelf: 'flex-start', mt: 0.5 }}
          >
            {t('export.clearAll')}
          </Button>
        </Box>
      </Collapse>
    </Box>
  );
};

export default RecentExports;
