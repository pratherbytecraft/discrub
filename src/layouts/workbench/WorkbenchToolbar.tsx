import { Box, Button, IconButton, Typography } from '@mui/material';
import { CloudDownload as LoadAllIcon, FileDownload as ExportIcon, DeleteSweep as PurgeIcon, FilterList as FilterIcon, Forum as ThreadIcon, BarChart as AnalyticsIcon, Fullscreen as FocusIcon, FullscreenExit as ExitFocusIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ChannelType } from 'discrub-core/discord-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectFocusedView, selectSidebarView, setDialogOpen, toggleFocusedView } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';

/**
 * One toolbar row with every action (Workbench, 2.2.0): Load All, Export,
 * Purge, Filters, Load Thread, Analytics, and Focus at the end. Each opens the
 * same store-driven dialog the other layouts use.
 */
/**
 * The labels need about 680 px. The bar measures itself, not the window: it is
 * 580 px wide in a 900 px window and 640 px beside the supporter wall at
 * 1280 px, and a window breakpoint let the buttons shrink into each other there.
 */
const COMPACT = '@container (max-width: 700px)';

const WorkbenchToolbar = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const focusedView = useAppSelector(selectFocusedView);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const pagination = useAppSelector(selectActivePagination);
  const summary = useAppSelector(selectOperationSummary);
  const running = summary.tier === 'heavy';
  const isPackage = sidebarView === 'package';
  const hasContext = !isPackage && (!!channel || !!dm);
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;
  const open = (dialog: 'loadAll' | 'export' | 'forumExport' | 'purge' | 'filters' | 'threadLoad' | 'analytics') => dispatch(setDialogOpen({ dialog, open: true }));
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, testId: string, opts: { disabled?: boolean; color?: 'primary' | 'error' | 'inherit'; variant?: 'contained' | 'outlined' | 'text'; tour?: string } = {}) => (
    <Button size="small" variant={opts.variant ?? 'outlined'} color={opts.color ?? 'inherit'} startIcon={icon} onClick={onClick} disabled={opts.disabled} data-testid={testId} data-tour={opts.tour} aria-label={label} sx={{ textTransform: 'none', borderColor: 'divider', whiteSpace: 'nowrap', minWidth: 0, flexShrink: 0, [COMPACT]: { px: 1, '& .MuiButton-startIcon': { m: 0 }, '& .wb-label': { display: 'none' } } }}><span className="wb-label">{label}</span></Button>
  );
  return (
    <Box data-testid="workbench-toolbar" sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 44, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', flexShrink: 0, overflowX: 'auto', containerType: 'inline-size' }}>
      {hasContext ? (
        <>
          {!isForum && btn(t('serverView.loadAll'), <LoadAllIcon />, () => open('loadAll'), 'wb-load-all', { disabled: running || !pagination.hasMore, color: 'primary', variant: 'contained' })}
          {btn(t('serverView.export'), <ExportIcon />, () => open(isForum ? 'forumExport' : 'export'), 'wb-export', { disabled: running || (!isForum && messages.length === 0), tour: 'export-button' })}
          {!isForum && btn(t('native.purge'), <PurgeIcon />, () => open('purge'), 'wb-purge', { disabled: running, color: 'error' })}
          {!isForum && btn(t('serverView.filters'), <FilterIcon />, () => open('filters'), 'wb-filters', { tour: 'search-filters' })}
          {channel && btn(t('serverView.loadThread'), <ThreadIcon />, () => open('threadLoad'), 'wb-load-thread', { disabled: running })}
          {!isForum && btn(t('serverView.analytics'), <AnalyticsIcon />, () => open('analytics'), 'wb-analytics', { disabled: messages.length === 0, tour: 'analytics-button' })}
        </>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{isPackage ? t('native.packageHint') : t('workbench.pickHint')}</Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {hasContext && (
        <HotkeyTooltip actionId="toggleFocus" label={focusedView ? t('serverView.exitFocusMode') : t('serverView.enterFocusMode')} arrow>
          <IconButton size="small" aria-label={focusedView ? t('serverView.exitFocus') : t('serverView.focus')} onClick={() => dispatch(toggleFocusedView())} data-testid="wb-focus" data-tour="focus-button">
            {focusedView ? <ExitFocusIcon /> : <FocusIcon />}
          </IconButton>
        </HotkeyTooltip>
      )}
    </Box>
  );
};

export default WorkbenchToolbar;
