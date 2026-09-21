import { Box, Button, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Tag as HashIcon, AlternateEmail as AtIcon, ViewSidebar as InspectorIcon, FullscreenExit as ExitFocusIcon, Fullscreen as FocusIcon, Menu as MenuIcon, FilterList as FilterIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectFocusedView, selectSidebarView, setDialogOpen, toggleFocusedView } from '@features/app/appSlice';
import { selectOperationSummary } from '@features/app/operationSelectors';
import { selectActiveFilteredMessages, selectActivePagination, selectActiveSelectedMessages } from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { ChannelType } from 'discrub-core/discord-enum';
import { selectSelectedDm } from '@features/dm/dmSlice';
import AppearanceButton from '@components/appearance/AppearanceButton';
import { NATIVE_HEAD_HEIGHT } from './NativeColumn';
import BotsButton from '@components/welcome/BotsButton';
import SupporterWallToggle from '@components/donations/SupporterWallToggle';
import ScrublingsStage from '@components/scrublings/ScrublingsStage';
import { selectStageRoom } from '@features/scrublings/selectors';
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
  const stageRoom = useAppSelector(selectStageRoom);
  const isPackage = sidebarView === 'package';
  const name = isPackage ? t('sidebar.tabPackage') : channel?.name ?? (dm ? getDmName(dm) : '');
  const hasContext = isPackage || !!channel || !!dm;
  const running = summary.tier === 'heavy';
  // A forum's own header counts posts; the strip would only show message counts that mean nothing there.
  const isForum = channel?.type === ChannelType.GUILD_FORUM || channel?.type === ChannelType.GUILD_MEDIA;

  return (
    <Box
      data-testid="native-head"
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, height: NATIVE_HEAD_HEIGHT, px: 1.5, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper', flexShrink: 0,
        // The bar never spills onto the inspector: it clips, and the Scrublings keep their room (selectStageRoom)
        // at every desktop width. The rest gives way in order as the bar narrows: the strip goes, the Appearance
        // button drops its word, then Filters becomes an icon. At 1512 px with the inspector and the supporter
        // wall open the bar is 570 px, and before 2026-09-21 that left the stage 40 px, one character.
        overflow: 'hidden', minWidth: 0, containerType: 'inline-size',
        '@container (max-width: 760px)': { '& [data-testid="native-head-strip"]': { display: 'none' } },
        '@container (max-width: 660px)': { '& .appearance-label': { display: 'none' } },
        '@container (max-width: 560px)': { '& .native-filters-label': { display: 'none' }, '& [data-testid="native-filters"]': { minWidth: 0, px: 0.75, '& .MuiButton-startIcon': { m: 0 } } },
        '@container (max-width: 430px)': { '& [data-testid="native-stage"]': { minWidth: 0 } },
      }}
    >
      {showMenu && (
        <IconButton size="small" aria-label={t('topbar.menu')} onClick={onMenu} data-testid="native-menu"><MenuIcon /></IconButton>
      )}
      {/* With nothing open the bar says nothing: the welcome page and the inspector already say what to pick, and the stretch goes to the Scrublings (owner, 2026-09-20). */}
      {hasContext ? (
        <>
          {!isPackage && (dm ? <AtIcon sx={{ fontSize: 20, color: 'text.secondary' }} /> : <HashIcon sx={{ fontSize: 20, color: 'text.secondary' }} />)}
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, maxWidth: 320, minWidth: 72, flexShrink: 1 }} data-testid="native-head-title">{name}</Typography>
        </>
      ) : null}
      {hasContext && !isPackage && !isForum && (
        <Box data-testid="native-head-strip" sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, borderRadius: 1.5, backgroundColor: alpha(theme.palette.text.primary, 0.05), minWidth: 0, flexShrink: 4 }}>
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
      {/* The free stretch, the Scrublings' stage. */}
      <Box data-testid="native-stage" sx={{ flex: 1, alignSelf: 'stretch', position: 'relative', minWidth: stageRoom }}><ScrublingsStage /></Box>
      <AppearanceButton onOpenSettings={() => dispatch(setDialogOpen({ dialog: 'settings', open: true }))} />
      {hasContext && !isPackage && (
        <HotkeyTooltip actionId="openFilters" label={t('serverView.filters')} arrow>
          <Button size="small" variant="outlined" onClick={() => dispatch(setDialogOpen({ dialog: 'filters', open: true }))} startIcon={<FilterIcon />} aria-label={t('serverView.filters')} data-testid="native-filters"><span className="native-filters-label">{t('serverView.filters')}</span></Button>
        </HotkeyTooltip>
      )}
      {/* No Focus button on a phone: the rail and column are already a drawer there, and the bar has no room for it. F still works. */}
      {hasContext && !isPackage && !showMenu && (
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
      {/* The supporter wall is the column at the far right, so its switch sits at the far right of the bar. */}
      <BotsButton label={false} hideOnPhone />
      <SupporterWallToggle />
    </Box>
  );
};

export default NativeHead;
