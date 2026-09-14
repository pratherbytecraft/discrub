import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectActivePagination } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { getDateLocale } from '@/i18n/dateLocale';
import { dayKeyToDate } from '@/utils/timelineDays';
import { useTimeline } from './useTimeline';

const card = { border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5 } as const;
const head = { fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'text.secondary', mb: 1 } as const;

/**
 * Timeline's side column: the month list (newest first, a click jumps to
 * the month's newest message, the total matches the strip and the header)
 * and a card that says what the strip does or which range is showing.
 */
const TimelineSide = ({ onPicked }: { onPicked?: () => void }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const pagination = useAppSelector(selectActivePagination);
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const hasContext = !!channel || !!dm;
  const { model, range, jumpTo } = useTimeline();
  const locale = getDateLocale();
  if (model.total === 0 || !hasContext) {
    return (
      <Box data-testid="timeline-side" sx={{ p: 1.5 }}>
        <Box sx={card}><Typography sx={head}>{t('timeline.getStarted')}</Typography><Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('timeline.getStartedBody')}</Typography></Box>
      </Box>
    );
  }
  return (
    <Box data-testid="timeline-side" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, overflowY: 'auto', minHeight: 0 }}>
      <Box sx={card}>
        <Typography sx={head}>{t('timeline.months')}</Typography>
        {model.months.map((m, i) => (
          <ButtonBase key={m.key} onClick={() => { jumpTo(m.newestId); onPicked?.(); }} data-testid="timeline-month" sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', px: 1, py: 0.75, borderRadius: 1, fontSize: 13, fontWeight: i === 0 ? 600 : 400, backgroundColor: i === 0 ? alpha(theme.palette.primary.main, 0.14) : 'transparent', '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.2) } }}>
            <span>{format(dayKeyToDate(`${m.key}-01`), 'LLL yyyy', { locale })}</span>
            <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{m.count.toLocaleString()}</Box>
          </ButtonBase>
        ))}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 1, pt: 0.75, mt: 0.5, borderTop: '1px solid', borderColor: 'divider', fontSize: 13, fontWeight: 600 }}>
          <span>{t('timeline.total')}</span><span data-testid="timeline-total">{model.total.toLocaleString()}</span>
        </Box>
        {pagination.hasMore && <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.75 }}>{t('timeline.countsAreLoaded')}</Typography>}
      </Box>
      <Box sx={card}>
        <Typography sx={head}>{t('timeline.dateRange')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {range ? `${format(dayKeyToDate(range.from), 'PP', { locale })} – ${format(dayKeyToDate(range.to), 'PP', { locale })}` : t('timeline.rangeHint')}
        </Typography>
      </Box>
    </Box>
  );
};

export default TimelineSide;
