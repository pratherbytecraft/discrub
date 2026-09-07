import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
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
import { selectSelectedGuild, selectRoles, selectCurrentMemberRoles, selectGuildEmojis, fetchGuildEmojis } from '@features/guild/guildSlice';
import type { SelectableEmoji } from '@/utils/emojiDataset';
import { selectAuthToken } from '@features/auth/authSlice';
import {
  selectSettings,
  selectSearchDelay,
  selectFocusedView,
  toggleFocusedView,
} from '@features/app/appSlice';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import type { Channel } from 'discrub-core/types/discord-types';
import {
  selectActiveFilteredMessages,
  selectClearSeq,
  selectActiveSelectedMessages,
  selectActiveMessages,
  selectActiveLoading,
  selectActiveError,
  selectActiveLoadAllCancelled,
  selectActivePagination,
  selectActiveTab,
  selectMessages,
  setFilteredMessages,
  setThreadFilteredMessages,
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
  enrichMessageUsers,
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

interface ServerViewProps {
  onStartShellTour?: () => void;
}

/**
 * ServerView container - displays messages for selected channel or DM
 */
const ServerView = ({ onStartShellTour }: ServerViewProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedDm = useAppSelector(selectSelectedDm);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const guildEmojis = useAppSelector(selectGuildEmojis);
  const mainMessages = useAppSelector(selectMessages);
  const allMessages = useAppSelector(selectActiveMessages);
  const messages = useAppSelector(selectActiveFilteredMessages);
  const clearSeq = useAppSelector(selectClearSeq);
  const selectedMessages = useAppSelector(selectActiveSelectedMessages);
  const isLoading = useAppSelector(selectActiveLoading);
  const error = useAppSelector(selectActiveError);
  const loadAllCancelled = useAppSelector(selectActiveLoadAllCancelled);
  const token = useAppSelector(selectAuthToken);
  const pagination = useAppSelector(selectActivePagination);
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
  const tabSearchCriteriaRef = useRef<Record<string, SearchCriteria>>({});
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
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const filterModalKeyRef = useRef(0);
  // Close filter modal when switching tabs so it re-opens with correct tab criteria
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      setFilterModalOpen(false);
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [forumExportDialogOpen, setForumExportDialogOpen] = useState(false);
  const [loadAllDialogOpen, setLoadAllDialogOpen] = useState(false);
  const [threadLoadOpen, setThreadLoadOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
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
        setFilterModalOpen(false);
      } else {
        // Bump the remount key only on open; closing leaves the
        // existing modal instance to unmount cleanly.
        filterModalKeyRef.current++;
        setFilterModalOpen(true);
      }
    },
    isChannelLoaded && !isForumChannel,
  );
  useHotkey(
    'openExport',
    () => {
      if (isForumChannel) {
        setForumExportDialogOpen((open) => !open);
      } else {
        setExportDialogOpen((open) => !open);
      }
    },
    isChannelLoaded &&
      !isOperationRunning &&
      (isForumChannel ? forumThreads.length > 0 : messages.length > 0),
  );
  useHotkey(
    'openAnalytics',
    () => setAnalyticsOpen((open) => !open),
    isChannelLoaded && !isForumChannel && messages.length > 0,
  );
  useHotkey(
    'loadAll',
    () => setLoadAllDialogOpen((open) => !open),
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
    () => setThreadLoadOpen((open) => !open),
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
  const activeContextName = activeTab && threadTabs[activeTab]
    ? threadTabs[activeTab].threadName
    : currentContext?.name || t('common.directMessage');


  // #226: search criteria are per-conversation UI state, but this component
  // stays mounted across selection changes — without this reset, the 'main'
  // ref entry survives a channel/DM switch and keeps rendering the previous
  // conversation's filter chips (and pre-filling FilterModal), even though
  // clearMessages already wiped the real Redux criteria. Keyed on ids so
  // it fires for channel→channel, channel→DM, and guild switches alike.
  useEffect(() => {
    delete tabSearchCriteriaRef.current['main'];
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
  }, [selectedChannel?.id, selectedDm?.id, clearSeq]);

  // Clean up saved search criteria for closed thread tabs.
  // Refine criteria is now per-tab in Redux and cleaned up automatically
  // when removeThreadTab fires, so it doesn't need a sweep here.
  useEffect(() => {
    const openTabIds = new Set(Object.keys(threadTabs));
    for (const key of Object.keys(tabSearchCriteriaRef.current)) {
      if (key !== 'main' && !openTabIds.has(key)) {
        delete tabSearchCriteriaRef.current[key];
      }
    }
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
  const userMap = useMemo(() => {
    const map: Record<string, { userName?: string; displayName?: string; nick?: string }> = {};

    // Start with cached data
    Object.keys(cachedUserMap).forEach((userId) => {
      const cached = cachedUserMap[userId];
      const guildData = selectedGuild?.id ? cached.guilds?.[selectedGuild.id] : null;
      map[userId] = {
        userName: cached.userName || undefined,
        displayName: cached.displayName || undefined,
        nick: guildData?.nick || undefined,
      };
    });

    // Overlay message author data
    allMessages.forEach((msg) => {
      if (msg.author) {
        map[msg.author.id] = {
          ...map[msg.author.id],
          userName: msg.author.username,
          displayName: msg.author.global_name || map[msg.author.id]?.displayName,
        };
      }
    });

    return map;
  }, [allMessages, cachedUserMap, selectedGuild?.id]);

  // Build full user map with complete User objects for profile modals
  const fullUserMap = useMemo(() => {
    const map: Record<string, User> = {};
    allMessages.forEach((msg) => {
      if (msg.author) {
        map[msg.author.id] = msg.author;
      }
    });
    return map;
  }, [allMessages]);

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

  // Trigger user enrichment when main channel messages change
  useEffect(() => {
    if (mainMessages.length > 0 && token && settings) {
      const shouldEnrich =
        settings[DiscrubSetting.DISPLAY_NAME_LOOKUP] === 'true' ||
        settings[DiscrubSetting.SERVER_NICKNAME_LOOKUP] === 'true';

      if (shouldEnrich) {
        dispatch(
          enrichMessageUsers({
            messages: mainMessages,
            guildId: selectedGuild?.id || null,
            token,
          })
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trigger set
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
  // the reducer takes care of deriving filteredMessages.

  // --- Server search handler ---
  const handleServerSearch = async (criteria: SearchCriteria) => {
    if (!currentContext || !token) return;
    tabSearchCriteriaRef.current[activeTab ?? 'main'] = criteria;

    if (isOperationRunning) return;
    // The search reducer now applies any active refineCriteria itself when
    // it writes filteredMessages, so no manual re-apply step is needed
    // after the dispatch resolves.
    const dispatchResult = activeTab
      ? dispatch(searchThreadMessages({ threadId: activeTab, token, searchCriteria: criteria }))
      : dispatch(searchMessages({ channelId: currentContext.id, guildId: selectedGuild?.id, token, searchCriteria: criteria }));
    await dispatchResult;
    setShowPartialResultsWarning(false);
  };

  // --- Local refine handler ---
  // The setRefineCriteria reducer derives filteredMessages itself from the
  // current raw `state.messages`, so this handler only needs to dispatch
  // and update the partial-results warning.
  const handleRefine = (criteria: SearchCriteria) => {
    dispatchSetRefine(criteria);
    const hasMoreMessages = pagination.hasMore || pagination.mode === 'paginated';
    setShowPartialResultsWarning(hasMoreMessages);
  };

  // --- Clear handlers ---
  const handleClearServerSearch = () => {
    tabSearchCriteriaRef.current[activeTab ?? 'main'] = defaultCriteria;
    // Restore all messages. The setFilteredMessages dispatch is then
    // shadowed by setRefineCriteria's derive logic if refine is active —
    // but since we only call setFilteredMessages here, we manually
    // re-apply refine afterward by re-dispatching the existing criteria.
    if (activeTab) {
      dispatch(setThreadFilteredMessages({ threadId: activeTab, messages: allMessages }));
    } else {
      dispatch(setFilteredMessages(allMessages));
    }
    if (currentRefineCriteria && countActiveFilters(currentRefineCriteria) > 0) {
      dispatchSetRefine(currentRefineCriteria);
    }
    setShowPartialResultsWarning(false);
  };

  const handleClearRefine = () => {
    dispatchClearRefine();
    setShowPartialResultsWarning(false);
  };

  const handleClearAll = () => {
    tabSearchCriteriaRef.current[activeTab ?? 'main'] = defaultCriteria;
    dispatchClearRefine();
    if (activeTab) {
      dispatch(setThreadFilteredMessages({ threadId: activeTab, messages: allMessages }));
    } else {
      dispatch(setFilteredMessages(allMessages));
    }
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
    const current = tabSearchCriteriaRef.current[activeTab ?? 'main'] ?? defaultCriteria;
    const updated = reduceCriteria(current, field, value);
    tabSearchCriteriaRef.current[activeTab ?? 'main'] = updated;
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

  const currentSearchCriteria = tabSearchCriteriaRef.current[activeTab ?? 'main'] ?? defaultCriteria;
  const activeFilterCount = countTotalFilters(currentSearchCriteria, currentRefineCriteria);

  const handleDelete = async (messagesToDelete: Message[]) => {
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

  const handleBulkEdit = async (messagesToEdit: Message[], newContent: string) => {
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
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.reactions || !currentUser) return [];

    const reaction = msg.reactions.find((r) => {
      const key = r.emoji?.id ? `${r.emoji.id}` : (r.emoji?.name || '');
      return key === emoji;
    });

    if (reaction?.me) {
      return [currentUser as User];
    }
    return [];
  }, [messages, currentUser]);

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
    messages: Message[];
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

  const handleBatchAddReactions = (params: { messages: Message[]; emojis: SelectableEmoji[] }) => {
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

    setThreadLoadOpen(false);
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

  const handleOpenThread = useCallback((message: Message) => {
    if (!token || isOperationRunning) return;
    const thread = (message as any).thread;
    if (!thread) return;
    dispatch(openThreadTab({ threadId: thread.id, threadName: thread.name || `Thread`, token }));
  }, [token, isOperationRunning, dispatch]);

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

    setLoadAllDialogOpen(false);

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
            <Typography variant="h6" noWrap>
              {activeContextName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary" noWrap>
                {(() => {
                  if (isForumChannel) {
                    const total = forumThreadsTotalResults || forumThreads.length;
                    return `${total} post${total !== 1 ? 's' : ''}`;
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
                        ? `${visible} visible · ${loaded} of ${displayTotal} matches loaded`
                        : `${visible} visible · ${displayTotal} matches loaded`;
                    }
                    return pagination.hasMore
                      ? `${loaded} of ${displayTotal} matches loaded (${remaining} remaining)`
                      : `${displayTotal} match${displayTotal !== 1 ? 'es' : ''}`;
                  }

                  // Paginated (no server search). Channel total is unknown,
                  // so we surface raw "loaded" instead of total — and explicitly
                  // show that scrolling can pull more, even when refine has
                  // narrowed the visible set down.
                  if (isRefined) {
                    return pagination.hasMore
                      ? `${visible} visible · ${loaded} loaded · scroll for more`
                      : `${visible} visible · ${loaded} loaded`;
                  }
                  return `${loaded} message${loaded !== 1 ? 's' : ''}`;
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
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap', maxWidth: { xs: '100%', md: 'none' }, whiteSpace: 'nowrap' }}>
            {!isForumChannel && pagination.hasMore &&
              (pagination.mode === 'paginated' || pagination.mode === 'search') && (
              <HotkeyTooltip actionId="loadAll" label={t('serverView.loadAllMessages')} arrow>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<LoadAllIcon />}
                  onClick={() => setLoadAllDialogOpen(true)}
                  disabled={isLoading || pagination.isLoadingAll || isOperationRunning}
                >
                  {t('serverView.loadAll')}
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
                onClick={() => { filterModalKeyRef.current++; setFilterModalOpen(true); }}
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
                onClick={() => setThreadLoadOpen(true)}
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
                  onClick={() => setAnalyticsOpen(true)}
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
                  onClick={() => setForumExportDialogOpen(true)}
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
                  onClick={() => setExportDialogOpen(true)}
                  data-tour="export-button"
                  disabled={messages.length === 0 || isOperationRunning}
                >
                  {t('serverView.export')}
                </Button>
              </HotkeyTooltip>
            )}
          </Box>
        </Box>
      </Paper>

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
          onClose={() => setFilterModalOpen(false)}
          onServerSearch={handleServerSearch}
          onRefine={handleRefine}
          onClearSearch={handleClearServerSearch}
          onClearRefine={handleClearRefine}
          savedSearchCriteria={tabSearchCriteriaRef.current[activeTab ?? 'main']}
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

      <ThreadTabBar channelName={currentContext?.name || t('common.directMessage')} />

      {!isForumChannel && (
        <MessageActions
          selectedMessages={selectedMessages}
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
          />
        </Box>
      )}

      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
      />

      <BulkExportDialog
        open={forumExportDialogOpen}
        onClose={() => setForumExportDialogOpen(false)}
        channels={forumThreads}
        mode="channels"
        guildId={selectedGuild?.id}
      />

      <LoadAllDialog
        open={loadAllDialogOpen}
        onClose={() => setLoadAllDialogOpen(false)}
        onConfirm={handleLoadAll}
        contextLabel={contextLabel}
      />

      <ThreadLoadModal
        open={threadLoadOpen}
        onClose={() => setThreadLoadOpen(false)}
        onLoad={handleThreadLoad}
        channel={selectedChannel}
        guildId={selectedGuild?.id ?? null}
      />

      <AnalyticsModal
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        messages={messages}
        userMap={userMap}
        containerId={activeTab ?? selectedChannel?.id ?? null}
        threadNames={analyticsThreadNames}
      />
    </Box>
  );
};

export default ServerView;
