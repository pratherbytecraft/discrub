import { Box, Button, LinearProgress, Typography, alpha } from '@mui/material';
import { CloudDownload as LoadAllIcon, FileDownload as ExportIcon, DeleteSweep as PurgeIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ChannelType } from 'discrub-core/discord-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setDialogOpen } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectSelectedChannel, selectSelectedChannels } from '@features/channel/channelSlice';
import { selectSelectedDm, selectSelectedDms } from '@features/dm/dmSlice';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { selectActivePagination } from '@features/message/messageSlice';
import PauseResumeControls from '@components/ui/PauseResumeControls';
import { getDmName } from '@/utils/dmListUtils';

const STATE_HEX: Record<string, string> = { neutral: '#8b949e', success: '#3fb950', warning: '#d29922', info: '#58a6ff', error: '#f85149' };

/**
 * The run card (Operator, 2.2.0). At rest: three start tiles. Load All works
 * on the open channel and says so; Export and Purge run over the queue
 * (option 2 of A5). While a heavy operation runs: the shared controls, a big
 * percentage, the bar, and the state name with the attempt or the reason
 * (A4, Part B).
 */
const OperatorRunCard = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const summary = useAppSelector(selectOperationSummary);
  const guild = useAppSelector(selectSelectedGuild);
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const selectedChannels = useAppSelector(selectSelectedChannels);
  const selectedDms = useAppSelector(selectSelectedDms);
  const pagination = useAppSelector(selectActivePagination);
  const sidebarView = useAppSelector(selectSidebarView);
  const running = summary.tier === 'heavy';
  const dmMode = !guild;
  const queued = dmMode ? selectedDms.length : selectedChannels.length;
  const openName = channel ? `#${channel.name}` : dm ? getDmName(dm) : '';
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  const c = STATE_HEX[summary.stateColor] ?? STATE_HEX.neutral;
  const open = (dialog: 'loadAll' | 'bulkExport' | 'purge') => dispatch(setDialogOpen({ dialog, open: true }));

  if (running) {
    const pct = summary.progress != null ? Math.round(summary.progress) : null;
    const detail = summary.hold?.attempt != null ? t('operator.attempt', { attempt: summary.hold.attempt, max: summary.hold.max ?? 0 }) : summary.hold?.answer ?? '';
    return (
      <Box data-testid="operator-run-card" data-state={summary.state} sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: alpha(c, 0.55), backgroundColor: alpha(c, 0.08), display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: c, flexShrink: 0 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{summary.name}</Typography>
          <Typography variant="body2" data-testid="operator-state" sx={{ color: 'text.secondary' }}>{t(`operator.state.${summary.state}`)}{detail ? ` · ${detail}` : ''}</Typography>
        </Box>
        {pct != null && <Typography data-testid="operator-pct" sx={{ fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{pct}<Box component="small" sx={{ fontSize: 24, color: 'text.secondary', fontWeight: 500, ml: 0.25 }}>%</Box></Typography>}
        {pct != null && <LinearProgress variant="determinate" value={pct} sx={{ height: 10, borderRadius: 5, '& .MuiLinearProgress-bar': { backgroundColor: c } }} />}
        <PauseResumeControls label={summary.label} progress={summary.progress} />
        {summary.sentence && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{summary.sentence}</Typography>}
      </Box>
    );
  }

  const tile = (icon: React.ReactNode, title: string, sub: string, onClick: () => void, opts: { disabled?: boolean; color?: 'primary' | 'error'; testId: string }) => (
    <Button variant="outlined" color={opts.color ?? 'inherit'} disabled={opts.disabled} onClick={onClick} data-testid={opts.testId} sx={{ flex: 1, minWidth: 140, textTransform: 'none', alignItems: 'flex-start', flexDirection: 'column', gap: 0.5, p: 1.5, borderColor: 'divider', borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: opts.color === 'error' ? 'error.main' : 'primary.main' }}>{icon}<Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary' }}>{title}</Typography></Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'left' }}>{sub}</Typography>
    </Button>
  );
  const isPackage = sidebarView === 'package';
  return (
    <Box data-testid="operator-run-card" data-state="idle" sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: STATE_HEX.success, flexShrink: 0 }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('workbench.nothingRunning')}</Typography>
      </Box>
      {isPackage ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('native.packageHint')}</Typography>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            {tile(<LoadAllIcon fontSize="small" />, t('serverView.loadAll'), openName ? t('operator.loadAllIn', { name: openName }) : t('operator.loadAllNone'), () => open('loadAll'), { disabled: !openName || isForum || !pagination.hasMore, testId: 'op-load-all' })}
            {tile(<ExportIcon fontSize="small" />, t('serverView.export'), queued > 0 ? t('operator.queueCount', { count: queued }) : t('operator.queueNone'), () => open('bulkExport'), { disabled: queued === 0, testId: 'op-export' })}
            {tile(<PurgeIcon fontSize="small" />, t('native.purge'), queued > 0 ? t('operator.queueCount', { count: queued }) : t('operator.queueNone'), () => open('purge'), { disabled: queued === 0, color: 'error', testId: 'op-purge' })}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('operator.queueHint')}</Typography>
        </>
      )}
    </Box>
  );
};

export default OperatorRunCard;
