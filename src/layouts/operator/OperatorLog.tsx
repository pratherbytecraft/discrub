import { useEffect, useRef } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { clearStatusLog, selectStatusEntries } from '@features/status/statusSlice';

const LEVEL_COLOR: Record<string, string> = { info: 'text.secondary', success: 'success.main', warning: 'warning.main', error: 'error.main' };

/**
 * The status log as a main panel (Operator, 2.2.0, A3): the log is already
 * full width here, so it lists inline and follows the newest line.
 */
const OperatorLog = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const entries = useAppSelector(selectStatusEntries);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [entries.length]);
  const shown = entries.slice(-300);
  return (
    <Box data-testid="operator-log" sx={{ flex: 1, minHeight: 0, borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="overline" sx={{ lineHeight: 1, color: 'text.secondary', letterSpacing: '0.08em', flex: 1 }}>{t('statusPanel.title')}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', mr: 1 }}>{entries.length}</Typography>
        <Button size="small" onClick={() => dispatch(clearStatusLog())} disabled={entries.length === 0} data-testid="operator-log-clear" sx={{ textTransform: 'none', py: 0 }}>{t('statusPanel.clearLog')}</Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.75rem' }}>
        {shown.length === 0 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('native.logEmpty')}</Typography>}
        {shown.map((e) => (
          <Box key={e.id} sx={{ display: 'flex', gap: 1.25, py: 0.25, whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0, minWidth: '11ch' }}>{new Date(e.timestamp).toLocaleTimeString()}</Box>
            <Box component="span" sx={{ color: LEVEL_COLOR[e.level] ?? 'text.secondary', flexShrink: 0, textTransform: 'uppercase', width: '7ch' }}>{e.level}</Box>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'text.primary' }}>{e.message}</Box>
          </Box>
        ))}
        <div ref={endRef} />
      </Box>
    </Box>
  );
};

export default OperatorLog;
