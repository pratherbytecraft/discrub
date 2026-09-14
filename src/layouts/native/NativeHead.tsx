import { Box, Button, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Tag as HashIcon, AlternateEmail as AtIcon, ViewSidebar as InspectorIcon, FullscreenExit as ExitFocusIcon, Fullscreen as FocusIcon, Menu as MenuIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectFocusedView, selectSidebarView, setDialogOpen, toggleFocusedView } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination, selectActiveSelectedMessages } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { ChannelType } from 'discrub-core/discord-enum';
import { selectSelectedDm } from '@features/dm/dmSlice';
import AppearanceButton from '@components/appearance/AppearanceButton';
import PauseResumeControls from '@components/ui/PauseResumeControls';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import { getDmName } from '@/utils/dmListUtils';

interface NativeHeadProps {
  inspectorOpen: boolean;
  canToggleInspector: boolean;
  onToggleInspector: () => void;
  /** Phone tier: a menu button opens the navigation drawer. */
  showMenu?: boolean;
  onMenu?: () => void;
}

/**
 * Head row (Native): the conversation name, the summary strip (loaded, more
 * available, selected, or the live operation with its pause controls), the
 * Appearance button, Filters, Focus and the inspector toggle. This is
 * Native's top bar, so it stays in Focus.
 */
const NativeHead = ({ inspectorOpen, canToggleInspector, onToggleInspector, showMenu = false, onMenu }: NativeHeadProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const channel = useAppSelector(selectSelectedChannel);
  const dm = useAppSelector(selectSelectedDm);
  const sidebarView = useAppSelector(selectSidebarView);
  const focusedView = useAppSelector(selectFocusedView);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const selected = useAppSelector(selectActiveSelectedMessages);
  const pagination = useAppSelector(selectActivePagination);
  const summary = useAppSelector(selectOperationSummary);
  const isPackage = sidebarView === 'package';
  const name = isPackage ? t('sidebar.tabPackage') : channel?.name ?? (dm ? getDmName(dm) : '');
  const hasContext = isPackage || !!channel || !!dm;
  const running = summary.tier === 'heavy';
  // A forum's own header counts posts; the strip would only show message counts that mean nothing there.
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;

  return (
    <Box
      data-testid="native-head"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.25, height: 48, px: 1.5, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', flexShrink: 0 }}
    >
      {showMenu && (
        <IconButton size="small" aria-label={t('topbar.menu')} onClick={onMenu} data-testid="native-menu"><MenuIcon /></IconButton>
      )}
      {hasContext ? (
        <>
          {!isPackage && (dm ? <AtIcon sx={{ fontSize: 20, color: 'text.secondary' }} /> : <HashIcon sx={{ fontSize: 20, color: 'text.secondary' }} />)}
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, maxWidth: 320 }} data-testid="native-head-title">{name}</Typography>
        </>
      ) : (
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.secondary' }}>{t('native.pickOne')}</Typography>
      )}
      {hasContext && !isPackage && !isForum && (
        <Box data-testid="native-head-strip" sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, borderRadius: 1.5, backgroundColor: alpha(theme.palette.text.primary, 0.05), minWidth: 0 }}>
          {running ? (
            <PauseResumeControls label={summary.label} progress={summary.progress} />
          ) : (
            <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
              {t('native.loaded', { count: messages.length })}
              {pagination.hasMore ? ` · ${t('serverView.moreAvailable')}` : ''}
              {selected.length > 0 ? ` · ${t('native.selected', { count: selected.length })}` : ''}
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ flex: 1 }} />
      <AppearanceButton onOpenSettings={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} />
      {hasContext && !isPackage && (
        <HotkeyTooltip actionId="openFilters" label={t('serverView.filters')} arrow>
          <Button size="small" variant="outlined" onClick={() => dispatch(setDialogOpen({ dialog: 'filters', open: true }))} data-testid="native-filters">{t('serverView.filters')}</Button>
        </HotkeyTooltip>
      )}
      {hasContext && !isPackage && (
        <HotkeyTooltip actionId="toggleFocus" label={focusedView ? t('serverView.exitFocusMode') : t('serverView.enterFocusMode')} arrow>
          <IconButton size="small" aria-label={focusedView ? t('serverView.exitFocus') : t('serverView.focus')} onClick={() => dispatch(toggleFocusedView())} data-testid="native-focus" data-tour="focus-button">
            {focusedView ? <ExitFocusIcon /> : <FocusIcon />}
          </IconButton>
        </HotkeyTooltip>
      )}
      {canToggleInspector && (
        <Tooltip title={t('native.inspector')} enterDelay={0} arrow>
          <IconButton size="small" aria-label={t('native.inspector')} aria-pressed={inspectorOpen} onClick={onToggleInspector} data-testid="native-inspector-toggle" sx={{ color: inspectorOpen ? 'primary.main' : 'text.secondary' }}>
            <InspectorIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

export default NativeHead;
