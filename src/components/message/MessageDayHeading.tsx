import { memo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { getDateLocale } from '@/i18n/dateLocale';
import { dayKeyToDate } from '@/utils/timelineDays';

interface MessageDayHeadingProps {
  dayKey: string;
  count: number;
  selectedCount: number;
  onToggleDay: (dayKey: string) => void;
}

/** Heading above the first chunk of a day (Timeline, 2.2.0): the date, that day's count and Select day. */
const MessageDayHeading = memo(function MessageDayHeading({ dayKey, count, selectedCount, onToggleDay }: MessageDayHeadingProps) {
  const { t } = useTranslation();
  const allSelected = count > 0 && selectedCount === count;
  return (
    <Box data-testid="day-heading" data-day={dayKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 0.5, mb: 0.5, backgroundColor: 'background.default', borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{format(dayKeyToDate(dayKey), 'EEEE, PPP', { locale: getDateLocale() })}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', flexShrink: 0 }} data-testid="day-count">{t('timeline.dayCount', { count })}</Typography>
      <Box sx={{ flex: 1 }} />
      <Button size="small" onClick={() => onToggleDay(dayKey)} data-testid="select-day" sx={{ textTransform: 'none', minWidth: 0, py: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {allSelected ? t('timeline.clearDay') : t('timeline.selectDay')}
      </Button>
    </Box>
  );
});

export default MessageDayHeading;
