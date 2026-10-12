import { Box, Tooltip, Typography } from '@mui/material';
import type { MediaCategorySummary } from '@/utils/mediaUtils';
import { formatBytes, getTotalMediaSize } from '@/utils/mediaUtils';
import { useTranslation } from 'react-i18next';

const CATEGORY_COLORS: Record<string, string> = {
  images: '#5865F2',
  videos: '#9B59B6',
  audio: '#2ECC71',
  other: '#95A5A6',
};

interface MediaBreakdownBarProps {
  summaries: MediaCategorySummary[];
}

const CATEGORY_LABELS: Record<string, string> = {
  images: 'export.mediaImages',
  videos: 'export.mediaVideos',
  audio: 'export.mediaAudio',
  other: 'export.mediaOther',
};

const MediaBreakdownBar = ({ summaries }: MediaBreakdownBarProps) => {
  const { t } = useTranslation();
  const total = getTotalMediaSize(summaries);
  if (total === 0) return null;

  const visibleSummaries = summaries.filter((s) => s.totalBytes > 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', width: '100%' }}>
        {visibleSummaries.map((s) => {
          const percent = (s.totalBytes / total) * 100;
          return (
            <Tooltip
              key={s.category}
              title={
                <Typography variant="caption">
                  {CATEGORY_LABELS[s.category] ? t(CATEGORY_LABELS[s.category]) : s.category}: {formatBytes(s.totalBytes)} ({percent.toFixed(0)}%)
                </Typography>
              }
            >
              <Box
                data-testid={`bar-${s.category}`}
                sx={{
                  flex: percent,
                  backgroundColor: CATEGORY_COLORS[s.category] || CATEGORY_COLORS.other,
                  minWidth: 2,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        {visibleSummaries.map((s) => (
          <Box key={s.category} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: CATEGORY_COLORS[s.category] || CATEGORY_COLORS.other,
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {CATEGORY_LABELS[s.category] ? t(CATEGORY_LABELS[s.category]) : s.category} ({formatBytes(s.totalBytes)})
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default MediaBreakdownBar;
