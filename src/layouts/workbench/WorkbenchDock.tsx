import { useState } from 'react';
import { Box, LinearProgress, Tab, Tabs, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectRecentExports } from '@features/history/historySlice';
import { selectStatusEntries } from '@features/status/statusSlice';
import PauseResumeControls from '@components/ui/PauseResumeControls';

type DockTab = 'progress' | 'runs' | 'log';

/**
 * The dock (Workbench, 2.2.0): Progress shows the running operation with its
 * controls or the last log line at rest, Recent runs lists finished exports,
 * and the Status log tab opens the log sheet over the table (A3).
 */
const WorkbenchDock = ({ onOpenLog }: { onOpenLog: () => void }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DockTab>('progress');
  const summary = useAppSelector(selectOperationSummary);
  const runs = useAppSelector(selectRecentExports);
  const entries = useAppSelector(selectStatusEntries);
  const running = summary.tier === 'heavy';
  const last = entries[entries.length - 1];
  return (
    <Box data-testid="workbench-dock" sx={{ flexShrink: 0, height: 150, borderTop: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
      <Tabs value={tab} onChange={(_, v: DockTab) => { if (v === 'log') onOpenLog(); else setTab(v); }} sx={{ minHeight: 32, borderBottom: '1px solid', borderColor: 'divider', px: 1 }}>
        <Tab value="progress" label={t('workbench.progress')} data-testid="dock-tab-progress" sx={{ minHeight: 32, py: 0, textTransform: 'none', fontSize: '0.75rem' }} />
        <Tab value="runs" label={t('workbench.recentRuns')} data-testid="dock-tab-runs" sx={{ minHeight: 32, py: 0, textTransform: 'none', fontSize: '0.75rem' }} />
        <Tab value="log" label={t('workbench.statusLog')} data-testid="dock-tab-log" sx={{ minHeight: 32, py: 0, textTransform: 'none', fontSize: '0.75rem' }} />
      </Tabs>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1 }}>
        {tab === 'progress' && (
          running ? (
            <Box data-testid="dock-progress-running" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <PauseResumeControls label={summary.label} progress={summary.progress} />
              {summary.progress != null && <LinearProgress variant="determinate" value={summary.progress} sx={{ height: 6, borderRadius: 3 }} />}
            </Box>
          ) : (
            <Box data-testid="dock-progress-idle">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('workbench.nothingRunning')}</Typography>
              {last && <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'ui-monospace, Menlo, monospace' }}>{last.message}</Typography>}
            </Box>
          )
        )}
        {tab === 'runs' && (
          runs.length === 0 ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('workbench.noRuns')}</Typography>
          ) : (
            <Box data-testid="dock-runs" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {runs.slice(0, 8).map((r) => (
                <Box key={r.id} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: '0.8rem' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 'inherit' }}>{t('serverView.export')}</Typography>
                  <Typography variant="body2" noWrap sx={{ color: 'text.secondary', fontSize: 'inherit', flex: 1 }}>{r.isBulk ? t('workbench.channelCount', { count: r.channelCount ?? 0 }) : r.channelName}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{new Date(r.timestamp).toLocaleString()}</Typography>
                </Box>
              ))}
            </Box>
          )
        )}
      </Box>
    </Box>
  );
};

export default WorkbenchDock;
