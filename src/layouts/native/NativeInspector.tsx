import { Box, Button, Typography, alpha, useTheme } from '@mui/material';
import { CloudDownload as LoadAllIcon, FileDownload as ExportIcon, DeleteSweep as PurgeIcon, BarChart as AnalyticsIcon, Forum as ThreadIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectSidebarView, setDialogOpen } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination, selectActiveSearchCriteria } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { selectStatusEntries } from '@features/status/statusSlice';
import { countActiveFilters } from 'discrub-core/filtering';
import PauseResumeControls from '@components/ui/PauseResumeControls';
import { ChannelType } from 'discrub-core/discord-enum';

export const INSPECTOR_WIDTH = 300;

const Card = ({ title, children, testId, action }: { title: string; children: React.ReactNode; testId?: string; action?: React.ReactNode }) => (
  <Box data-testid={testId} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, backgroundColor: 'background.paper' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
      <Typography variant="overline" sx={{ lineHeight: 1, color: 'text.secondary', letterSpacing: '0.08em' }}>{title}</Typography>
      {action}
    </Box>
    {children}
  </Box>
);

/**
 * Inspector (Native): the conversation's actions in a 2x2 block, the run
 * card while an operation is going, the filters summary, and a three line
 * status log peek with an Open link. Every action here opens the same
 * dialog the Classic header opens; the dialogs live in ServerView.
 */
const NativeInspector = ({ onOpenLog }: { onOpenLog: () => void }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const pagination = useAppSelector(selectActivePagination);
  const criteria = useAppSelector(selectActiveSearchCriteria);
  const summary = useAppSelector(selectOperationSummary);
  const entries = useAppSelector(selectStatusEntries);
  const hasContext = !!channel || !!dm;
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  const isPackage = sidebarView === 'package';
  const running = summary.tier === 'heavy';
  const filterCount = criteria ? countActiveFilters(criteria) : 0;
  const peek = entries.slice(-3);
  const open = (dialog: 'loadAll' | 'export' | 'forumExport' | 'threadLoad' | 'analytics' | 'filters') => dispatch(setDialogOpen({ dialog, open: true }));
  const startPurge = () => { if (channel || dm) dispatch(setDialogOpen({ dialog: 'purge', open: true })); };

  const actionBtn = (label: string, icon: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; color?: 'primary' | 'error' | 'inherit'; testId: string; variant?: 'outlined' | 'contained' | 'text' } ) => (
    <Button size="small" variant={opts.variant ?? 'outlined'} color={opts.color ?? 'inherit'} startIcon={icon} onClick={onClick} disabled={opts.disabled} data-testid={opts.testId} sx={{ justifyContent: 'flex-start', textTransform: 'none', borderColor: 'divider' }}>{label}</Button>
  );

  return (
    <Box data-testid="native-inspector" sx={{ width: INSPECTOR_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.25, overflowY: 'auto', borderLeft: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.12 : 0.03) }}>
      {isPackage ? (
        <Card title={t('native.thisPackage')} testId="inspector-package">
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('native.packageHint')}</Typography>
        </Card>
      ) : !hasContext ? (
        <Card title={t('native.getStarted')} testId="inspector-welcome">
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t('native.pickHint')}</Typography>
        </Card>
      ) : (
        <Card title={isForum ? t('native.thisForum') : dm ? t('native.thisConversation') : t('native.thisChannel')} testId="inspector-actions">
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
            {!isForum && actionBtn(t('serverView.loadAll'), <LoadAllIcon />, () => open('loadAll'), { disabled: running || !pagination.hasMore, color: 'primary', variant: 'contained', testId: 'inspector-load-all' })}
            {actionBtn(t('serverView.export'), <ExportIcon />, () => open(isForum ? 'forumExport' : 'export'), { disabled: running || (isForum ? false : messages.length === 0), testId: 'inspector-export' })}
            {!isForum && actionBtn(t('native.purge'), <PurgeIcon />, startPurge, { disabled: running, color: 'error', testId: 'inspector-purge' })}
            {!isForum && actionBtn(t('serverView.analytics'), <AnalyticsIcon />, () => open('analytics'), { disabled: messages.length === 0, testId: 'inspector-analytics' })}
            {channel && <Box sx={{ gridColumn: '1 / -1', display: 'grid' }}>{actionBtn(t('serverView.loadThread'), <ThreadIcon />, () => open('threadLoad'), { disabled: running, testId: 'inspector-load-thread' })}</Box>}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>{isForum ? t('native.forumHint') : t('native.actionsHint')}</Typography>
        </Card>
      )}

      {running && (
        <Card title={summary.name} testId="inspector-run">
          <PauseResumeControls label={summary.label} progress={summary.progress} />
        </Card>
      )}

      {hasContext && !isForum && !isPackage && (
        <Card title={t('serverView.filters')} testId="inspector-filters" action={<Button size="small" onClick={() => open('filters')} sx={{ textTransform: 'none', py: 0 }} data-testid="inspector-filters-edit">{t('native.edit')}</Button>}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{filterCount > 0 ? t('native.filtersActive', { count: filterCount }) : t('native.filtersNone')}</Typography>
        </Card>
      )}

      <Card title={t('statusPanel.title')} testId="inspector-log" action={<Button size="small" onClick={onOpenLog} sx={{ textTransform: 'none', py: 0 }} data-testid="inspector-log-open">{t('native.open')}</Button>}>
        <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.7rem', color: 'text.secondary', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {peek.length === 0 ? <span>{t('native.logEmpty')}</span> : peek.map((e) => <Box key={e.id ?? e.timestamp} component="span" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.message}</Box>)}
        </Box>
      </Card>
    </Box>
  );
};

export default NativeInspector;
