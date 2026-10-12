import { useLoadAllLabel } from '@/hooks/useLoadAllLabel';
import { useResumeLabels } from '@/hooks/useResume';
import { useState, useRef, useMemo, useEffect, useCallback, memo } from 'react';
import { Box, Typography, Paper, Button, Alert, AlertTitle, Chip } from '@mui/material';
import { Joyride } from 'react-joyride';
import {
  FileDownload as ExportIcon,
  CloudDownload as LoadAllIcon,
  Forum as ThreadIcon,
  Analytics as AnalyticsIcon,
  CheckCircle as CheckCircleIcon,
  MoreHoriz as MoreHorizIcon,
  FilterList as FilterListIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  ChatBubbleOutline,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { FeedDialog } from '@features/app/appTypes';
import WelcomePanel from '@components/welcome/WelcomePanel';
import TourTooltip from '@components/welcome/TourTooltip';
import TourButton from '@components/welcome/TourButton';
import TourFootnote from '@components/welcome/TourFootnote';
import { buildContextualTourSteps } from '@components/welcome/tourSteps';
import { useTour } from '@/hooks/useTour';
import { HotkeyTooltip } from '@components/ui/HotkeyTooltip';
import DmAvatar from '@components/ui/DmAvatar';
import ChannelAvatar from '@components/ui/ChannelAvatar';
import { useHotkey } from '@features/hotkeys/HotkeyProvider';
import { selectSelectedChannel, selectChannels, fetchChannelById } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { getDmDisplayName, getDmName } from '@/utils/dmListUtils';
import { selectSelectedGuild, selectRoles, selectCurrentMemberRoles, selectGuildEmojis, fetchGuildEmojis } from '@features/guild/guildSlice';
import type { SelectableEmoji } from '@/utils/emojiDataset';
import { selectAuthToken } from '@features/auth/authSlice';
import {
  selectSettings,
  selectSearchDelay,
  selectFocusedView,
  toggleFocusedView,
  selectDialogs,
  setDialogOpen,
  toggleDialog,
} from '@features/app/appSlice';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import type { Channel } from 'discrub-core/types/discord-types';
import { overlayAuthors, sameAuthorEntries, type AuthorOverlayEntry } from '@/utils/messageAuthorOverlay';
import { getCachedMessage } from '@features/message/messageCache';
import {
  selectActiveFilteredRows,
  selectActiveContainerKey,
  selectActiveHydrationSource,
  selectAuthors,
  selectClearSeq,
  selectActiveRows,
  selectActiveLoading,
  selectActiveError,
  selectActiveLoadAllCancelled,
  selectRestored,
  selectActivePagination,
  selectActiveTab,
  selectRows,
  setSearchCriteria,
  setThreadSearchCriteria,
  selectSearchCriteria,
  deleteMessages,
  dismissLoadAllCancelled,
  editMessage,
  editMessages,
  fetchReactingUsers,
  deleteReaction,
  bulkDeleteAllReactions,
  bulkDeleteReactionsForEmoji,
  batchRemoveReactions,
  batchAddReactions,
  deleteAttachment,
  deleteAllAttachments,
  fetchAllMessages,
  fetchAllThreadMessages,
  searchMessages,
  searchThreadMessages,
  loadAllSearchResults,
  clearMessages,
  clearSavedMessages,
  clearSavedSearch,
  fetchMessages,
  enrichMessageUsers,
  takeArrivedUserIds,
  openThreadTab,
  selectThreadTabs,
  setRefineCriteria,
  clearRefineCriteria,
  setThreadRefineCriteria,
  clearThreadRefineCriteria,
} from '@features/message/messageSlice';
import type { Message, User, Attachment } from 'discrub-core/types/discord-types';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { IsPinnedType } from 'discrub-core/discord-enum';
import MessageFeed from '@components/message/MessageFeed';
import MessageActions from '@containers/ServerView/MessageActions';
import FilterModal from '@components/search/FilterModal';
import { countActiveFilters, countTotalFilters } from 'discrub-core/filtering';
import ActiveFilterChips from '@components/search/ActiveFilterChips';
import { defaultCriteria } from '@components/search/searchConstants';
import { isDeletedUserEntry } from '@utils/userDisplayUtils';
import ExportDialog from '@containers/ExportView/ExportDialog';
import BulkExportDialog from '@containers/ExportView/BulkExportDialog';
import LoadAllDialog from '@components/message/LoadAllDialog';
import ThreadLoadModal from '@components/modals/ThreadLoadModal';
import MessageTable from '@components/message/MessageTable';
import AnalyticsModal from '@components/modals/AnalyticsModal';
import { addStatusEntry } from '@features/status/statusSlice';
import { canManageMessages } from '@/utils/permissionUtils';
import { selectUser } from '@features/user/userSlice';
import EmptyState from '@components/ui/EmptyState';
import MessageTableSkeleton from '@components/message/MessageTableSkeleton';
import ThreadTabBar from '@components/message/ThreadTabBar';
import ForumThreadList from '@components/message/ForumThreadList';
import { ChannelType } from 'discrub-core/discord-enum';
import {
  selectForumThreads,
  selectForumFirstMessages,
  selectIsLoadingForumThreads,
  selectHasMoreForumThreads,
  selectForumThreadsNextOffset,
  selectForumThreadsTotalResults,
  loadMoreForumThreads,
  searchForumThreads,
  fetchForumThreads,
  selectDiscoveredThreadsForChannel,
} from '@features/channel/channelSlice';
import { useTranslation } from 'react-i18next';
import { perfCount } from '@/utils/perfCounters';

interface ServerViewProps {
  onStartShellTour?: () => void;
  /**
   * Which shell hosts the view (2.2.0). Classic keeps the channel header with
   * its action buttons; Native draws its own head row and inspector, so the
   * header here is skipped. Dialogs, alerts, tabs and the feed stay.
   */
  variant?: 'classic' | 'native' | 'workbench' | 'simple' | 'operator' | 'timeline';
}

/**
 * ServerView container - displays messages for selected channel or DM
 */
const ServerView = ({ onStartShellTour, variant = 'classic' }: ServerViewProps) => {
  perfCount('ServerView');
  const { t, i18n } = useTranslation();
  const loadAllLabel = useLoadAllLabel();
  const { exportLabel } = useResumeLabels();
  const dispatch = useAppDispatch();
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedDm = useAppSelector(selectSelectedDm);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const guildEmojis = useAppSelector(selectGuildEmojis);
  const mainMessages = useAppSelector(selectRows);
  const allMessages = useAppSelector(selectActiveRows);
  const messages = useAppSelector(selectActiveFilteredRows);
  const authors = useAppSelector(selectAuthors);
  const containerKey = useAppSelector(selectActiveContainerKey);
  const hydrationSource = useAppSelector(selectActiveHydrationSource);
  const clearSeq = useAppSelector(selectClearSeq);
  const isLoading = useAppSelector(selectActiveLoading);
  const error = useAppSelector(selectActiveError);
  const loadAllCancelled = useAppSelector(selectActiveLoadAllCancelled);
  const restored = useAppSelector(selectRestored);
  const token = useAppSelector(selectAuthToken);
  const pagination = useAppSelector(selectActivePagination);
  const restoredSearchShowing = useAppSelector((state) => state.message.pagination.mode === 'search' && !!state.message.restored);
  const activeTab = useAppSelector(selectActiveTab);
  const channels = useAppSelector(selectChannels);
  const guildRoles = useAppSelector(selectRoles);
  const settings = useAppSelector(selectSettings);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const isOperationRunning = useAppSelector(selectIsHeavyOperationRunning);
  const memberRoles = useAppSelector(selectCurrentMemberRoles);
  const currentUser = useAppSelector(selectUser).currentUser;
  const searchDelay = useAppSelector(selectSearchDelay);
  const focusedView = useAppSelector(selectFocusedView);
  const threadTabs = useAppSelector(selectThreadTabs);
  const forumThreads = useAppSelector(selectForumThreads);
  const discoveredThreads = useAppSelector(selectDiscoveredThreadsForChannel(selectedChannel?.id));
  const isLoadingForumThreads = useAppSelector(selectIsLoadingForumThreads);
  const forumFirstMessages = useAppSelector(selectForumFirstMessages);
  const hasMoreForumThreads = useAppSelector(selectHasMoreForumThreads);
  const forumThreadsNextOffset = useAppSelector(selectForumThreadsNextOffset);
  const forumThreadsTotalResults = useAppSelector(selectForumThreadsTotalResults);
  const isForumChannelType = selectedChannel?.type === ChannelType.GUILD_FORUM || selectedChannel?.type === ChannelType.GUILD_MEDIA;
  // Show forum thread list only when on the main tab (not when viewing a thread tab's messages)
  const isForumChannel = isForumChannelType && !activeTab;
  // Server search criteria live in the message slice (main and per thread
  // tab), the same place the search thunks write them, so they survive a
  // layout swap (2.2.0 foundation) and the chips, the Filters dialog and the
  // click-to-search thunks all read one value. clearMessages nulls the main
  // entry on every conversation switch (#226) and removeThreadTab drops a
  // tab's entry with the tab.
  const mainSearchCriteria = useAppSelector(selectSearchCriteria);
  const savedSearchCriteria: SearchCriteria | undefined =
    (activeTab ? threadTabs[activeTab]?.searchCriteria : mainSearchCriteria) ?? undefined;
  const saveSearchCriteria = (criteria: SearchCriteria | null) => {
    if (activeTab) dispatch(setThreadSearchCriteria({ threadId: activeTab, criteria }));
    else dispatch(setSearchCriteria(criteria));
  };
  // Refine criteria now lives in Redux (state.message.refineCriteria,
  // state.message.threadTabs[id].refineCriteria) so data-arrival reducers
  // can re-apply it as new pages stream in. Reading via selectors.
  const mainRefineCriteria = useAppSelector((s) => s.message.refineCriteria);
  const threadRefineCriteria = useAppSelector((s) =>
    activeTab ? s.message.threadTabs[activeTab]?.refineCriteria ?? null : null,
  );
  const currentRefineCriteria =
    (activeTab ? threadRefineCriteria : mainRefineCriteria) ?? defaultCriteria;
  // Helper: dispatch the right refine setter for the active context.
  const dispatchSetRefine = (criteria: SearchCriteria | null) => {
    if (activeTab) {
      dispatch(setThreadRefineCriteria({ threadId: activeTab, criteria }));
    } else {
      dispatch(setRefineCriteria(criteria));
    }
  };
  const dispatchClearRefine = () => {
    if (activeTab) {
      dispatch(clearThreadRefineCriteria(activeTab));
    } else {
      dispatch(clearRefineCriteria());
    }
  };
  const filterModalKeyRef = useRef(0);
  // Dialog open state lives in the app slice (2.2.0 layouts foundation) so a
  // layout swap that remounts this view keeps an open dialog open.
  const dialogs = useAppSelector(selectDialogs);
  const filterModalOpen = dialogs.filters;
  // Every open remounts the Filters dialog so it reads the saved criteria,
  // whoever opened it: the 2.2.0 layouts open it through the store, and the
  // Timeline strip writes the refine dates from outside the dialog.
  const prevFilterModalOpenRef = useRef(filterModalOpen);
  if (filterModalOpen && !prevFilterModalOpenRef.current) filterModalKeyRef.current++;
  prevFilterModalOpenRef.current = filterModalOpen;
  const exportDialogOpen = dialogs.export;
  const forumExportDialogOpen = dialogs.forumExport;
  const loadAllDialogOpen = dialogs.loadAll;
  const threadLoadOpen = dialogs.threadLoad;
  const analyticsOpen = dialogs.analytics;
  // 2.2.5 W4: analytics walks the workspace store over the listed messages
  // while the dialog is open, so a large conversation is never read into
  // memory whole. The ids are taken only while it is open.
  const analyticsWalk = useMemo(
    () => (analyticsOpen ? { container: containerKey, source: hydrationSource, ids: messages.map((r) => r.id) } : null),
    [analyticsOpen, containerKey, hydrationSource, messages],
  );
  const openDialog = useCallback((dialog: FeedDialog) => dispatch(setDialogOpen({ dialog, open: true })), [dispatch]);
  const closeDialog = useCallback((dialog: FeedDialog) => dispatch(setDialogOpen({ dialog, open: false })), [dispatch]);
  // Close filter modal when switching tabs so it re-opens with correct tab criteria
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      closeDialog('filters');
      prevTabRef.current = activeTab;
    }
  }, [activeTab, closeDialog]);
  // Analytics Threads report: thread id → name from every source the feed knows
  // (discovered threads for this channel, forum posts, open thread tabs).
  const analyticsThreadNames = useMemo(() => {
    const names: Record<string, string> = {};
    (discoveredThreads ?? []).forEach((t) => { if (t.name) names[t.id] = t.name; });
    forumThreads.forEach((t) => { if (t.name) names[t.id] = t.name; });
    Object.values(threadTabs).forEach((tab) => { if (tab.threadName) names[tab.threadId] = tab.threadName; });
    return names;
  }, [discoveredThreads, forumThreads, threadTabs]);
  const [partialResultsWarnings, setPartialResultsWarnings] = useState<Record<string, boolean>>({});

  // Wire #144 hotkeys for the channel toolbar. Each `enabled` flag
  // mirrors the condition the corresponding button uses for
  // `disabled`, so the hotkey is unavailable in exactly the cases
  // the user can't click the button. The dialog-opening hotkeys
  // toggle: pressing the same key while the dialog is open closes
  // it, matching F's existing toggle behavior. Esc continues to
  // close any modal via MUI Dialog's built-in handler.
  const isChannelLoaded = !!selectedChannel || !!selectedDm;
  useHotkey(
    'openFilters',
    () => {
      if (filterModalOpen) {
        closeDialog('filters');
      } else {
        // Bump the remount key only on open; closing leaves the
        // existing modal instance to unmount cleanly.
        filterModalKeyRef.current++;
        openDialog('filters');
      }
    },
    isChannelLoaded && !isForumChannel,
  );
  useHotkey(
    'openExport',
    () => {
      if (isForumChannel) {
        dispatch(toggleDialog('forumExport'));
      } else {
        dispatch(toggleDialog('export'));
      }
    },
    isChannelLoaded &&
      !isOperationRunning &&
      (isForumChannel ? forumThreads.length > 0 : messages.length > 0),
  );
  useHotkey(
    'openAnalytics',
    () => dispatch(toggleDialog('analytics')),
    isChannelLoaded && !isForumChannel && messages.length > 0,
  );
  useHotkey(
    'loadAll',
    () => dispatch(toggleDialog('loadAll')),
    isChannelLoaded &&
      !isForumChannel &&
      pagination.hasMore &&
      (pagination.mode === 'paginated' || pagination.mode === 'search') &&
      !isLoading &&
      !pagination.isLoadingAll &&
      !isOperationRunning,
  );
  useHotkey(
    'loadThread',
    () => dispatch(toggleDialog('threadLoad')),
    isChannelLoaded,
  );
  const showPartialResultsWarning = partialResultsWarnings[activeTab ?? 'main'] ?? false;
  const setShowPartialResultsWarning = (show: boolean) => {
    setPartialResultsWarnings((prev) => ({ ...prev, [activeTab ?? 'main']: show }));
  };

  // The hook itself now validates the first-step target on `.start()`
  // and marks the tour completed if missing — so we don't keep auto-
  // triggering every session on a cold-boot-to-DM user.
  const contextualTourSteps = useMemo(() => buildContextualTourSteps(t), [t]);
  const contextualTour = useTour('contextual', {
    steps: contextualTourSteps,
    markCompletedOnMissingTarget: true,
  });
  const contextualTourTriggered = useRef(false);

  // Trigger contextual tour once after first message load.
  // Skip in Cypress test environment to avoid blocking interactions.
  useEffect(() => {
    if (
      messages.length > 0 &&
      !isLoading &&
      !contextualTour.completed &&
      !contextualTour.running &&
      !contextualTourTriggered.current &&
      !(window as unknown as { Cypress?: unknown }).Cypress
    ) {
      contextualTourTriggered.current = true;
      // Small delay to let the UI settle before start() checks targets.
      const timer = setTimeout(() => contextualTour.start(), 800);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trigger set
  }, [messages.length, isLoading, contextualTour.completed, contextualTour.running, contextualTour.start]);

  // Store dispatch results so we can abort operations
  const loadAllAbortController = useRef<{ abort: () => void } | null>(null);

  const currentContext = selectedChannel || selectedDm;
  const isDm = !!selectedDm && !selectedChannel;
  const contextLabel = isDm ? 'conversation' : 'channel';
  const scopeContext = isDm ? 'dm' : 'channel';
  const hasManageMessages = useMemo(() => {
    if (!selectedGuild?.id || !currentContext) return false;
    return canManageMessages(selectedGuild.permissions, memberRoles, currentContext, selectedGuild.id, currentUser?.id);
  }, [selectedGuild?.id, selectedGuild?.permissions, memberRoles, currentContext, currentUser?.id]);

  // Resolve active context name (thread name when on thread tab, channel/DM name otherwise)
  // A one to one DM has no name of its own, so it takes the person's: display name first, then username.
  // Until 2026-09-21 the header and the tab said "Direct Message" for every DM while the other layouts' bars named the person.
  const baseContextName = currentContext?.name || (selectedDm ? getDmDisplayName(selectedDm) || getDmName(selectedDm) : '') || t('common.directMessage');
  const activeContextName = activeTab && threadTabs[activeTab]
    ? threadTabs[activeTab].threadName
    : baseContextName;


  // #226: search criteria and the partial-results warning are per-conversation
  // UI state, but this component stays mounted across selection changes, so
  // both reset on every switch. Keyed on ids so it fires for channel to
  // channel, channel to DM and guild switches alike; clearSeq covers the
  // id-unchanged re-click, which dispatches clearMessages. The criteria live
  // in the message slice, so the reset is a dispatch (a no-op when already null).
  // 2.2.5 fix C: an open can bring a saved search back from the workspace
  // before this effect runs; the reset must not wipe that search's criteria.
  // The restored marker is cleared with the messages, so only a search this
  // open restored is kept.
  const restoredSearchRef = useRef(restoredSearchShowing);
  restoredSearchRef.current = restoredSearchShowing;
  useEffect(() => {
    if (!restoredSearchRef.current) dispatch(setSearchCriteria(null));
    setPartialResultsWarnings((prev) => {
      if (!('main' in prev)) return prev;
      const next = { ...prev };
      delete next['main'];
      return next;
    });
    // clearSeq covers the id-unchanged path: re-clicking the CURRENT
    // conversation dispatches clearMessages (wiping the real criteria) but
    // leaves both ids alone, which used to strand stale chips + FilterModal
    // pre-fill here.
  }, [selectedChannel?.id, selectedDm?.id, clearSeq, dispatch]);

  // Clean up the partial-results warning for closed thread tabs. Search and
  // refine criteria are per-tab in Redux and go with the tab on removeThreadTab.
  useEffect(() => {
    const openTabIds = new Set(Object.keys(threadTabs));
    setPartialResultsWarnings((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (key !== 'main' && !openTabIds.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [threadTabs]);

  // Build userMap from message authors for markdown rendering
  // Merge with cached data to include nicknames and display names
  // 2.2.1 perf: `userMap` feeds `formattingContext`, so a new object here
  // re-runs the markdown formatting of every visible row. When the rebuilt
  // map says the same thing as the last one, the last one is kept.
  // 2.2.5 WP2b: the authors come from the slice's author map, which keeps
  // its identity across pages, instead of a walk over every message.
  const userMapRef = useRef<Record<string, AuthorOverlayEntry>>({});
  const userMap = useMemo(() => {
    const guildId = selectedGuild?.id ?? null;
    const map: Record<string, AuthorOverlayEntry> = {};
    // Start with cached data
    Object.keys(cachedUserMap).forEach((userId) => {
      const cached = cachedUserMap[userId];
      const guildData = guildId ? cached.guilds?.[guildId] : null;
      map[userId] = {
        userName: cached.userName || undefined,
        displayName: cached.displayName || undefined,
        nick: guildData?.nick || undefined,
      };
    });
    overlayAuthors(map, Object.values(authors));
    const next = sameAuthorEntries(userMapRef.current, map) ? userMapRef.current : map;
    userMapRef.current = next;
    return next;
  }, [authors, cachedUserMap, selectedGuild?.id]);

  // Full User objects for profile modals: the slice's author map.
  const fullUserMap = authors;

  // Build channelMap from channels for channel mentions
  const channelMap = useMemo(() => {
    const map: Record<string, { name: string }> = {};
    channels.forEach((channel) => {
      map[channel.id] = { name: channel.name || 'unknown-channel' };
    });
    return map;
  }, [channels]);

  // Build formatting context for message preview
  const formattingContext: HtmlFormattingContext = useMemo(() => ({
    userMap,
    channelMap,
    guildRoles,
  }), [userMap, channelMap, guildRoles]);

  // Trigger user enrichment when main channel messages change. 2.2.1 perf:
  // a list that only shrank (a delete flush) holds no author the last pass
  // did not see, so it is skipped. 2.2.5 fix A: only ids this view has not
  // handed over yet go to the lookup queue. 2.2.5 W1: the ids come from the
  // pages that arrived (takeArrivedUserIds), not a walk over every row.
  const enrichedLengthRef = useRef(0);
  const handedIdsRef = useRef<{ guildId: string | null; ids: Set<string> }>({ guildId: null, ids: new Set() });
  useEffect(() => {
    const grew = mainMessages.length > enrichedLengthRef.current;
    enrichedLengthRef.current = mainMessages.length;
    // An emptied view (switch, clear) starts over, since a switch drops the
    // lookups it had queued.
    if (mainMessages.length === 0) handedIdsRef.current = { guildId: null, ids: new Set() };
    if (!grew) return;
    const arrived = takeArrivedUserIds();
    if (arrived.length > 0 && token && settings) {
      const shouldEnrich =
        settings[DiscrubSetting.DISPLAY_NAME_LOOKUP] === 'true' ||
        settings[DiscrubSetting.SERVER_NICKNAME_LOOKUP] === 'true';

      if (shouldEnrich) {
        const guildId = selectedGuild?.id || null;
        if (handedIdsRef.current.guildId !== guildId) handedIdsRef.current = { guildId, ids: new Set() };
        const handed = handedIdsRef.current.ids;
        const fresh: string[] = [];
        for (const id of arrived) {
          if (handed.has(id)) continue;
          handed.add(id);
          fresh.push(id);
        }
        if (fresh.length > 0) {
          dispatch(enrichMessageUsers({ userIds: fresh, guildId, token }));
        }
      }
    }
  }, [mainMessages.length, token, settings, selectedGuild?.id, dispatch]);

  // Fetch the guild's custom emojis for the bulk-add-reactions picker (#202).
  // The thunk caches per guild, so re-dispatch on guild switch is cheap.
  useEffect(() => {
    if (selectedGuild?.id && token) {
      dispatch(fetchGuildEmojis({ guildId: selectedGuild.id, token }));
    }
  }, [selectedGuild?.id, token, dispatch]);

  // Local refine filter logic moved to `src/features/message/messageFiltering.ts`
  // (`applyRefineCriteria`) so the message slice can re-apply it as new pages
  // arrive. This component dispatches setRefineCriteria/setThreadRefineCriteria;
  // the reducer takes care of deriving the filtered rows.

  // --- Server search handler ---
  const handleServerSearch = async (criteria: SearchCriteria) => {
    if (!currentContext || !token) return;
    // Recorded before the search so the chips and dialog show it even when an
    // operation is running and the search itself has to wait.
    saveSearchCriteria(criteria);

    if (isOperationRunning) return;
    // The search reducer applies any active refineCriteria itself when it
    // writes the filtered rows, so no manual re-apply step is needed after
    // the dispatch resolves.
    const dispatchResult = activeTab
      ? dispatch(searchThreadMessages({ threadId: activeTab, token, searchCriteria: criteria }))
      : dispatch(searchMessages({ channelId: currentContext.id, guildId: selectedGuild?.id, token, searchCriteria: criteria }));
    await dispatchResult;
    setShowPartialResultsWarning(false);
  };

  // --- Local refine handler ---
  // The setRefineCriteria thunk derives the filtered rows itself (and scans
  // the message objects for a content refine), so this handler only needs
  // to dispatch and update the partial-results warning.
  const handleRefine = (criteria: SearchCriteria) => {
    dispatchSetRefine(criteria);
    const hasMoreMessages = pagination.hasMore || pagination.mode === 'paginated';
    setShowPartialResultsWarning(hasMoreMessages);
  };

  // --- Clear handlers ---
  const handleClearServerSearch = async () => {
    saveSearchCriteria(null);
    // 2.2.5 fix C: the search set goes and the view returns to the plain
    // rows (restored from disk, or the first page fresh) before the refine
    // is applied again over them (plan section 11, rows 43 and 44).
    if (pagination.mode === 'search') await dispatch(clearSavedSearch({ cid: activeTab ?? currentContext?.id ?? '' }));
    if (currentRefineCriteria && countActiveFilters(currentRefineCriteria) > 0) {
      dispatchSetRefine(currentRefineCriteria);
    }
    setShowPartialResultsWarning(false);
  };

  const handleClearRefine = () => {
    dispatchClearRefine();
    setShowPartialResultsWarning(false);
  };

  const handleClearAll = async () => {
    saveSearchCriteria(null);
    if (pagination.mode === 'search') await dispatch(clearSavedSearch({ cid: activeTab ?? currentContext?.id ?? '' }));
    dispatchClearRefine();
    setShowPartialResultsWarning(false);
  };

  // --- Individual chip clear helpers ---
  const reduceCriteria = (current: SearchCriteria, field: keyof SearchCriteria, value?: string): SearchCriteria => {
    if (field === 'userIds' && value) return { ...current, userIds: current.userIds.filter((id) => id !== value) };
    if (field === 'selectedHasTypes' && value) return { ...current, selectedHasTypes: current.selectedHasTypes.filter((t) => t !== value) };
    if (field === 'mentionIds' && value) return { ...current, mentionIds: (current.mentionIds || []).filter((id) => id !== value) };
    if (field === 'searchAfterDate') return { ...current, searchAfterDate: null };
    if (field === 'searchBeforeDate') return { ...current, searchBeforeDate: null };
    if (field === 'isPinned') return { ...current, isPinned: IsPinnedType.UNSET };
    if (field === 'authorType') return { ...current, authorType: null };
    if (field === 'searchMessageContents' && value) return { ...current, searchMessageContents: (current.searchMessageContents || []).filter((t) => t !== value) };
    if (field === 'attachmentExtensions' && value) return { ...current, attachmentExtensions: (current.attachmentExtensions || []).filter((e) => e !== value) };
    if (field === 'attachmentFilename') return { ...current, attachmentFilename: null };
    return current;
  };

  const handleClearSearchFilter = (field: keyof SearchCriteria, value?: string) => {
    const updated = reduceCriteria(savedSearchCriteria ?? defaultCriteria, field, value);
    if (countActiveFilters(updated) > 0) {
      handleServerSearch(updated);
    } else {
      handleClearServerSearch();
    }
  };

  const handleClearRefineFilter = (field: keyof SearchCriteria, value?: string) => {
    const updated = reduceCriteria(currentRefineCriteria, field, value);
    if (countActiveFilters(updated) > 0) {
      dispatchSetRefine(updated);
    } else {
      handleClearRefine();
    }
  };

  const currentSearchCriteria = savedSearchCriteria ?? defaultCriteria;
  const activeFilterCount = countTotalFilters(currentSearchCriteria, currentRefineCriteria);

  const handleDelete = async (messagesToDelete: Array<Pick<Message, 'id'>>) => {
    if (!token || isOperationRunning) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      deleteMessages({
        messages: messagesToDelete,
        channelId,
        token,
      })
    );
  };

  const handleEdit = async (message: Message, newContent: string) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      editMessage({
        messageId: message.id,
        channelId,
        content: newContent,
        token,
      })
    );
  };

  const handleBulkEdit = async (messagesToEdit: Array<Pick<Message, 'id'>>, newContent: string) => {
    if (!token || isOperationRunning) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      editMessages({
        messages: messagesToEdit,
        channelId,
        content: newContent,
        token,
      })
    );
  };

  // #190 phase 1: useCallback on every handler that flows down into the
  // MessageFeed → MessageChunk → MessageFeedRow tree. Without this each
  // ServerView render minted a fresh function ref per handler, defeating
  // the React.memo wrappers on MessageChunk and MessageFeedRow and
  // re-rendering every row in the visible viewport on every parent state
  // tick (status log appends, progress counters, enrichment ticks).
  const handleFetchReactingUsers = useCallback(async (messageId: string, emoji: string): Promise<User[]> => {
    if (!token) return [];
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return [];

    const result = await dispatch(
      fetchReactingUsers({
        channelId,
        messageId,
        emoji,
        token,
      })
    ).unwrap();

    return result.users;
  }, [token, activeTab, currentContext?.id, dispatch]);

  // DM context: return current user from reaction.me without API calls
  const handleFetchReactingUsersDm = useCallback(async (messageId: string, emoji: string): Promise<User[]> => {
    const msg = getCachedMessage(containerKey, messageId);
    if (!msg?.reactions || !currentUser) return [];

    const reaction = msg.reactions.find((r) => {
      const key = r.emoji?.id ? `${r.emoji.id}` : (r.emoji?.name || '');
      return key === emoji;
    });

    if (reaction?.me) {
      return [currentUser as User];
    }
    return [];
  }, [containerKey, currentUser]);

  const handleDeleteReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      deleteReaction({
        channelId,
        messageId,
        emoji,
        userId,
        token,
      })
    );
  }, [token, activeTab, currentContext?.id, dispatch]);

  const handleBulkDeleteAllReactions = useCallback(async (messageId: string) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      bulkDeleteAllReactions({ channelId, messageId, token })
    );
  }, [token, activeTab, currentContext?.id, dispatch]);

  const handleBatchRemoveReactions = (params: {
    messages: Array<Pick<Message, 'id' | 'reactions'>>;
    mode: 'all' | 'emoji' | 'user';
    emojis?: string[];
    userId?: string;
  }) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    // Strip to plain serializable objects — full Message objects contain Date instances
    // which trigger Redux serialization warnings and can prevent dispatch
    const serializableMessages = params.messages.map((m) => ({
      id: m.id,
      reactions: (m.reactions || []).map((r) => ({
        emoji: { id: r.emoji.id, name: r.emoji.name },
        count: r.count,
        me: r.me,
      })),
    }));

    dispatch(
      batchRemoveReactions({
        channelId,
        messages: serializableMessages,
        mode: params.mode,
        emojis: params.emojis,
        userId: params.userId,
        token,
      })
    );
  };

  const handleBatchAddReactions = (params: { messages: Array<Pick<Message, 'id'>>; emojis: SelectableEmoji[] }) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    // The add thunk only needs message ids; strip to avoid Date serialization warnings.
    dispatch(
      batchAddReactions({
        channelId,
        messages: params.messages.map((m) => ({ id: m.id })),
        emojis: params.emojis,
        token,
      })
    );
  };

  const handleBulkDeleteReactionsForEmoji = useCallback(async (messageId: string, emoji: string) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      bulkDeleteReactionsForEmoji({ channelId, messageId, emoji, token })
    );
  }, [token, activeTab, currentContext?.id, dispatch]);

  const handleDeleteAttachment = useCallback(async (message: Message, attachment: Attachment) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      deleteAttachment({
        message,
        attachment,
        channelId,
        token,
      })
    );
  }, [token, activeTab, currentContext?.id, dispatch]);

  const handleDeleteAllAttachments = useCallback(async (message: Message) => {
    if (!token) return;
    const channelId = activeTab || currentContext?.id;
    if (!channelId) return;

    await dispatch(
      deleteAllAttachments({
        message,
        channelId,
        token,
      })
    );
  }, [token, activeTab, currentContext?.id, dispatch]);

  const handleThreadLoad = async (threadId: string) => {
    if (!token) return;

    closeDialog('threadLoad');
    dispatch(addStatusEntry({ level: 'info', message: t('serverView.loadingThread') }));

    try {
      // Fetch thread metadata to get the name
      const channel = await dispatch(fetchChannelById({ channelId: threadId, token })).unwrap();

      // Open as a tab instead of navigating away
      await dispatch(
        openThreadTab({ threadId: channel.id, threadName: channel.name || t('common.thread'), token })
      );

      dispatch(addStatusEntry({ level: 'success', message: t('serverView.threadLoaded') }));
    } catch (error) {
      dispatch(addStatusEntry({ level: 'error', message: t('serverView.threadLoadFailed', { error: String(error) }) }));
    }
  };

  // Read through a ref so the callback keeps its identity while a run
  // starts and ends; a new callback here re-renders every visible chunk.
  const openThreadGateRef = useRef({ token, isOperationRunning });
  openThreadGateRef.current = { token, isOperationRunning };
  const handleOpenThread = useCallback((message: Message) => {
    const { token, isOperationRunning } = openThreadGateRef.current;
    if (!token || isOperationRunning) return;
    const thread = (message as any).thread;
    if (!thread) return;
    dispatch(openThreadTab({ threadId: thread.id, threadName: thread.name || `Thread`, token }));
  }, [dispatch]);

  // #190 phase 1: the DM-vs-guild ternary used to pick a fresh function
  // ref on every render. Memoize the chosen handler so MessageFeed's
  // prop reference stays stable across re-renders where isDm hasn't
  // flipped.
  const onFetchReactingUsers = useMemo(
    () => (isDm ? handleFetchReactingUsersDm : handleFetchReactingUsers),
    [isDm, handleFetchReactingUsersDm, handleFetchReactingUsers],
  );

  const handleOpenForumThread = (thread: Channel) => {
    if (!token || isOperationRunning) return;
    dispatch(openThreadTab({ threadId: thread.id, threadName: thread.name || 'Post', token }));
  };

  const handleLoadAll = async () => {
    if (!token || isOperationRunning) return;
    closeDialog('loadAll');
    await runLoadAll();
  };

  // 2.2.5: Start over drops the messages the workspace saved for this
  // conversation, opens it fresh and then runs Load All from the top.
  const handleStartOver = async () => {
    if (!token || isOperationRunning || !currentContext || activeTab) return;
    closeDialog('loadAll');
    await dispatch(clearSavedMessages({ cid: currentContext.id }));
    dispatch(clearMessages());
    await dispatch(fetchMessages({ guildId: selectedGuild?.id, channelId: currentContext.id, token }));
    await runLoadAll();
  };

  const runLoadAll = async () => {
    if (!token) return;

    let dispatchResult;
    if (activeTab) {
      dispatchResult = dispatch(
        fetchAllThreadMessages({ threadId: activeTab, token })
      );
    } else if (pagination.mode === 'search') {
      // In search mode, Load All loops through remaining pages of the
      // currently-active search (rather than re-fetching the channel from
      // scratch via fetchAllMessages, which would drop the filter).
      dispatchResult = dispatch(
        loadAllSearchResults({
          channelId: currentContext?.id,
          guildId: selectedGuild?.id,
          token,
        })
      );
    } else {
      if (!currentContext) return;
      dispatchResult = dispatch(
        fetchAllMessages({ channelId: currentContext.id, token })
      );
    }
    loadAllAbortController.current = dispatchResult;

    await dispatchResult;

    loadAllAbortController.current = null;
  };

  if (!currentContext) {
    return (
      <WelcomePanel onStartTour={onStartShellTour ?? (() => {})} />
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Joyride
        steps={contextualTourSteps}
        run={contextualTour.running}
        stepIndex={contextualTour.stepIndex}
        onEvent={contextualTour.handleEvent}
        continuous
        scrollToFirstStep
        tooltipComponent={TourTooltip}
        options={{
          overlayClickAction: false,
          blockTargetInteraction: true,
          overlayColor: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          skipBeacon: true,
        }}
      />
      {variant === 'classic' && (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ minWidth: 0, flexShrink: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            {/*
              Avatar anchors the message-feed header (#166).
              - DM context → recipient avatar (or group icon, #167).
              - Server channel context → universal "#" placeholder via
                ChannelAvatar. Discord doesn't expose a per-channel
                icon for text/voice/forum/stage channels; the visual
                consistency with the DM header is the goal — every
                view has an avatar to the left of the name, eye lands
                in the same spot.
            */}
            {isDm
              ? <DmAvatar dm={selectedDm} size={28} />
              : selectedChannel && <ChannelAvatar channel={selectedChannel} size={28} />}
            <Typography variant="h6" noWrap data-testid="context-title">
              {activeContextName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary" noWrap>
                {(() => {
                  // 2.2.5 W1 (finding 8): counts print with the locale's separator.
                  const n = (value: number) => value.toLocaleString(i18n.language);
                  if (isForumChannel) {
                    const total = forumThreadsTotalResults || forumThreads.length;
                    return `${n(total)} post${total !== 1 ? 's' : ''}`;
                  }
                  // Three counts to keep separate when a local refine is on
                  // top of a server search:
                  //   visible — what's in the feed (post-refine)
                  //   loaded  — what the server has returned so far (raw,
                  //             pre-refine but post-search)
                  //   total   — server-reported total matches (search mode)
                  const visible = messages.length;
                  const loaded = allMessages.length;
                  const total = pagination.totalCount;
                  const isRefined = visible !== loaded;

                  if (pagination.mode === 'search' && total !== null) {
                    // #221: defensive clamp. The Load All denominator is frozen
                    // upstream (messageSlice), but never let the header show
                    // loaded > total or a negative remaining if any path leaves
                    // totalCount as a shrunk cap-shift window total.
                    const displayTotal = Math.max(total, loaded);
                    const remaining = Math.max(0, displayTotal - loaded);
                    if (isRefined) {
                      return pagination.hasMore
                        ? `${n(visible)} visible · ${n(loaded)} of ${n(displayTotal)} matches loaded`
                        : `${n(visible)} visible · ${n(displayTotal)} matches loaded`;
                    }
                    return pagination.hasMore
                      ? `${n(loaded)} of ${n(displayTotal)} matches loaded (${n(remaining)} remaining)`
                      : `${n(displayTotal)} match${displayTotal !== 1 ? 'es' : ''}`;
                  }

                  // Paginated (no server search). Channel total is unknown,
                  // so we surface raw "loaded" instead of total — and explicitly
                  // show that scrolling can pull more, even when refine has
                  // narrowed the visible set down.
                  if (isRefined) {
                    return pagination.hasMore
                      ? `${n(visible)} visible · ${n(loaded)} loaded · scroll for more`
                      : `${n(visible)} visible · ${n(loaded)} loaded`;
                  }
                  return `${n(loaded)} message${loaded !== 1 ? 's' : ''}`;
                })()}
              </Typography>
              {!isForumChannel && pagination.mode === 'search' && (
                <TourFootnote stepKey="search-match-counter" />
              )}
              {!isForumChannel && pagination.hasMore && pagination.mode === 'paginated' && (
                <Chip
                  icon={<MoreHorizIcon />}
                  label={t('serverView.moreAvailable')}
                  size="small"
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 14 } }}
                />
              )}
              {!isForumChannel && pagination.hasMore && pagination.mode === 'search' && (
                <Chip
                  icon={<MoreHorizIcon />}
                  label={t('serverView.scrollOrLoadAll')}
                  size="small"
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 14 } }}
                />
              )}
              {!isForumChannel && !pagination.hasMore && messages.length > 0 && (
                <Chip
                  icon={<CheckCircleIcon />}
                  label={t('serverView.allLoaded')}
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.72rem', '& .MuiChip-icon': { fontSize: 14 } }}
                />
              )}
            </Box>
          </Box>
          {/* Capped at the card's width at every size: the column can be 580 px wide in a 900 px window, and uncapped the row pushed Export off the edge. */}
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap', maxWidth: '100%', whiteSpace: 'nowrap' }}>
            {/* 2.2.5: a restored conversation keeps the button even when complete, so Start over can refresh it. A running or stopped Load All keeps it too (rows 5 and 59: the button left with mode 'all'). */}
            {!isForumChannel && (pagination.hasMore || restored !== null || pagination.isLoadingAll) && (
              <HotkeyTooltip actionId="loadAll" label={t('serverView.loadAllMessages')} arrow>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<LoadAllIcon />}
                  onClick={() => openDialog('loadAll')}
                  disabled={isLoading || pagination.isLoadingAll || isOperationRunning}
                >
                  {loadAllLabel}
                </Button>
              </HotkeyTooltip>
            )}
            {!isForumChannel && (
              <TourButton
                stepKey="search-filters"
                badgeContent={activeFilterCount}
                variant="outlined"
                size="small"
                startIcon={<FilterListIcon />}
                onClick={() => { filterModalKeyRef.current++; openDialog('filters'); }}
                data-tour="search-filters"
                data-testid="search-filters-button"
                hotkeyActionId="openFilters"
                hotkeyLabel={t('serverView.searchAndRefine')}
              >
                {t('serverView.filters')}
              </TourButton>
            )}
            <HotkeyTooltip actionId="loadThread" label={t('serverView.loadAThread')} arrow>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ThreadIcon />}
                onClick={() => openDialog('threadLoad')}
              >
                {t('serverView.loadThread')}
              </Button>
            </HotkeyTooltip>
            {!isForumChannel && (
              <HotkeyTooltip actionId="openAnalytics" label={t('serverView.channelAnalytics')} arrow>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AnalyticsIcon />}
                  onClick={() => openDialog('analytics')}
                  disabled={messages.length === 0}
                  data-tour="analytics-button"
                >
                  {t('serverView.analytics')}
                </Button>
              </HotkeyTooltip>
            )}
            {!isForumChannel && (
              <TourButton
                stepKey="focus-button"
                variant="outlined"
                size="small"
                startIcon={focusedView ? <FullscreenExitIcon /> : <FullscreenIcon />}
                onClick={() => dispatch(toggleFocusedView())}
                data-testid="focus-mode-toggle"
                data-tour="focus-button"
                hotkeyActionId="toggleFocus"
                hotkeyLabel={focusedView ? t('serverView.exitFocusMode') : t('serverView.enterFocusMode')}
              >
                {focusedView ? t('serverView.exitFocus') : t('serverView.focus')}
              </TourButton>
            )}
            {isForumChannel ? (
              <HotkeyTooltip actionId="openExport" label={t('serverView.exportForumThreads')} arrow>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ExportIcon />}
                  onClick={() => openDialog('forumExport')}
                  disabled={forumThreads.length === 0 || isOperationRunning}
                  data-tour="export-button"
                >
                  {t('serverView.export')}
                </Button>
              </HotkeyTooltip>
            ) : (
              <HotkeyTooltip actionId="openExport" label={t('serverView.exportMessages')} arrow>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ExportIcon />}
                  onClick={() => openDialog('export')}
                  data-tour="export-button"
                  disabled={messages.length === 0 || isOperationRunning}
                >
                  {exportLabel}
                </Button>
              </HotkeyTooltip>
            )}
          </Box>
        </Box>
      </Paper>
      )}

      {!isForumChannel && activeFilterCount > 0 && (
        <ActiveFilterChips
          searchCriteria={currentSearchCriteria}
          refineCriteria={currentRefineCriteria}
          onClearSearchFilter={handleClearSearchFilter}
          onClearRefineFilter={handleClearRefineFilter}
          onClearAll={handleClearAll}
        />
      )}

      {!isForumChannel && (
        <FilterModal
          key={filterModalKeyRef.current}
          open={filterModalOpen}
          onClose={() => closeDialog('filters')}
          onServerSearch={handleServerSearch}
          onRefine={handleRefine}
          onClearSearch={handleClearServerSearch}
          onClearRefine={handleClearRefine}
          savedSearchCriteria={savedSearchCriteria}
          savedRefineCriteria={currentRefineCriteria}
          cachedUserMap={cachedUserMap}
          currentUserId={currentUser?.id || ''}
        />
      )}

      {!isForumChannel && showPartialResultsWarning && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <AlertTitle>{t('serverView.partialTitle')}</AlertTitle>
          {t('serverView.partialBody', { count: allMessages.length })}{' '}
          {pagination.hasMore && `${t('serverView.moreMayExist', { context: scopeContext })} `}
          {t('serverView.partialHint')}
        </Alert>
      )}

      {/* #223: Discord's author search returns nothing for DELETED accounts
          even though the messages still exist. When an author-filtered
          search comes back empty and a target is a deleted-account
          placeholder, explain the situation and teach the path that works. */}
      {!isForumChannel &&
        pagination.mode === 'search' &&
        !isLoading &&
        allMessages.length === 0 &&
        (currentSearchCriteria.userIds ?? []).some((id) =>
          isDeletedUserEntry(cachedUserMap[id]),
        ) && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>{t('serverView.deletedAccountTitle')}</AlertTitle>
            {t('serverView.deletedAccountBody', { context: scopeContext })}
            {/* DM purges only ever target your own messages, so the scan
                fallback never runs there — don't promise it. */}
            {!isDm && t('serverView.deletedAccountPurgeHint')}
          </Alert>
        )}

      <ThreadTabBar channelName={baseContextName} />

      {!isForumChannel && (
        <MessageActions
          onDelete={handleDelete}
          onEdit={handleEdit}
          onBulkEdit={handleBulkEdit}
          formattingContext={formattingContext}
          isOperationRunning={isOperationRunning}
          canManageMessages={hasManageMessages}
          currentUserId={currentUser?.id}
          currentUsername={currentUser?.global_name || currentUser?.username}
          fetchDelayMs={searchDelay}
          isDm={isDm}
          onBatchRemoveReactions={handleBatchRemoveReactions}
          onBatchAddReactions={handleBatchAddReactions}
          guildEmojis={guildEmojis}
          onFetchReactingUsers={onFetchReactingUsers}
        />
      )}

      {!isForumChannel && isLoading && (
        <MessageTableSkeleton />
      )}

      {error && (
        <Paper sx={{ p: 2, backgroundColor: 'error.dark', mb: 2 }}>
          <Typography color="error.contrastText">{error}</Typography>
        </Paper>
      )}

      {/* #193: cancelled Load All renders a soft info callout, not the red
          error banner. state.messages is preserved across cancel, so the
          partial results stay rendered below. Dismissable. */}
      {loadAllCancelled && !error && (
        <Paper
          data-testid="load-all-cancelled-callout"
          sx={{
            p: 1.5,
            backgroundColor: 'info.dark',
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Typography sx={{ flex: 1, color: 'info.contrastText', fontSize: '0.875rem' }}>
            {t('serverView.loadAllStopped', { count: messages.length })}
          </Typography>
          <Button
            size="small"
            onClick={() => dispatch(dismissLoadAllCancelled())}
            sx={{ color: 'info.contrastText', textTransform: 'none', minWidth: 'auto' }}
          >
            {t('serverView.dismiss')}
          </Button>
        </Paper>
      )}

      {isForumChannel && (
        <ForumThreadList
          threads={forumThreads}
          firstMessages={forumFirstMessages}
          totalResults={forumThreadsTotalResults}
          isLoading={isLoadingForumThreads}
          hasMore={hasMoreForumThreads}
          forumChannel={selectedChannel}
          onThreadClick={handleOpenForumThread}
          onLoadMore={() => {
            if (token && selectedChannel) {
              dispatch(loadMoreForumThreads({
                channelId: selectedChannel.id,
                token,
                offset: forumThreadsNextOffset,
              }));
            }
          }}
          onSearch={(query) => {
            if (token && selectedChannel) {
              dispatch(searchForumThreads({
                channelId: selectedChannel.id,
                token,
                name: query,
              }));
            }
          }}
          onClearSearch={() => {
            if (token && selectedChannel) {
              dispatch(fetchForumThreads({
                channelId: selectedChannel.id,
                token,
              }));
            }
          }}
        />
      )}

      {!isForumChannel && !isLoading && !error && messages.length === 0 && (
        <EmptyState message={t('serverView.noMessagesFound', { context: scopeContext })} icon={<ChatBubbleOutline fontSize="inherit" />} />
      )}

      {!isForumChannel && !isLoading && !error && messages.length > 0 && (
        <Box data-tour="message-table" data-testid="message-feed" sx={{ flexGrow: 1, minHeight: 0, overflow: 'hidden' }}>
          {variant === 'workbench' ? <MessageTable /> : (
          <MessageFeed
            formattingContext={formattingContext}
            fullUserMap={fullUserMap}
            onDeleteReaction={handleDeleteReaction}
            onFetchReactingUsers={onFetchReactingUsers}
            onDeleteAttachment={handleDeleteAttachment}
            onDeleteAllAttachments={handleDeleteAllAttachments}
            onOpenThread={handleOpenThread}
            canManageMessages={hasManageMessages}
            currentUserId={currentUser?.id}
            onBulkDeleteAllReactions={handleBulkDeleteAllReactions}
            onBulkDeleteReactionsForEmoji={handleBulkDeleteReactionsForEmoji}
            groupByDay={variant === 'timeline'}
          />
          )}
        </Box>
      )}

      <ExportDialog
        open={exportDialogOpen}
        onClose={() => closeDialog('export')}
      />

      <BulkExportDialog
        open={forumExportDialogOpen}
        onClose={() => closeDialog('forumExport')}
        channels={forumThreads}
        mode="channels"
        guildId={selectedGuild?.id}
      />

      <LoadAllDialog
        open={loadAllDialogOpen}
        onClose={() => closeDialog('loadAll')}
        onConfirm={handleLoadAll}
        onStartOver={handleStartOver}
        contextLabel={contextLabel}
      />

      <ThreadLoadModal
        open={threadLoadOpen}
        onClose={() => closeDialog('threadLoad')}
        onLoad={handleThreadLoad}
        channel={selectedChannel}
        guildId={selectedGuild?.id ?? null}
      />

      <AnalyticsModal
        open={analyticsOpen}
        onClose={() => closeDialog('analytics')}
        walk={analyticsWalk}
        userMap={userMap}
        containerId={activeTab ?? selectedChannel?.id ?? null}
        threadNames={analyticsThreadNames}
      />
    </Box>
  );
};

// 2.2.1 perf: rendered again only when its own store reads or props change,
// not whenever the shell above it renders (three times per Load All page).
export default memo(ServerView);
