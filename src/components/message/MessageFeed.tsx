import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Button, Paper, Skeleton, alpha } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message, User, Attachment } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { SortDirection } from 'discrub-core/common-enum';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  selectActiveFilteredRows,
  selectActiveSelectedIds,
  selectActiveContainerKey,
  selectActiveHydrationSource,
  selectActiveOrder,
  selectActivePagination,
  selectActiveTab,
  selectHighlightedMessageId,
  setHighlightedMessageId,
  toggleMessageSelection,
  selectAllMessages,
  deselectAllMessages,
  setOrder,
  fetchMoreMessages,
  fetchNextSearchPage,
  toggleThreadMessageSelection,
  selectAllThreadMessages,
  deselectAllThreadMessages,
  setSelectedIds,
  setThreadSelectedIds,
  setThreadOrder,
  fetchMoreThreadMessages,
  applyUserFilter,
} from '@features/message/messageSlice';
import { selectSelectedChannel } from '@features/channel/channelSlice';
import { selectSelectedDm } from '@features/dm/dmSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { selectSelectedGuild, selectRoles } from '@features/guild/guildSlice';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { selectSettings, setFeedScrollAnchor, selectFeedScrollAnchor } from '@features/app/appSlice';
import UserProfileModal from '@/components/modals/UserProfileModal';
import AttachmentModal from '@/components/modals/AttachmentModal';
import ReactionModal from '@/components/modals/ReactionModal';
import { chunkMessages, messageDayKey, type MessageChunk as MessageChunkType } from '@/utils/messageChunking';
import type { MessageRow } from '@features/message/messageRows';
import { getCachedMessage, useHydratedMessages } from '@features/message/messageCache';
import { createChunkSizeEstimator } from '@/utils/chunkSizeEstimator';
import MessageChunk from './MessageChunk';
import MessageFeedToolbar from './MessageFeedToolbar';
import MessageDayHeading from './MessageDayHeading';
import { useTranslation } from 'react-i18next';
import { perfCount } from '@/utils/perfCounters';

interface MessageFeedProps {
  formattingContext: HtmlFormattingContext;
  fullUserMap: Record<string, User>;
  onDeleteReaction?: (messageId: string, emoji: string, userId: string) => Promise<void>;
  onFetchReactingUsers?: (messageId: string, emoji: string) => Promise<User[]>;
  onDeleteAttachment?: (message: Message, attachment: Attachment) => Promise<void>;
  onDeleteAllAttachments?: (message: Message) => Promise<void>;
  onOpenThread?: (message: Message) => void;
  canManageMessages?: boolean;
  currentUserId?: string;
  onBulkDeleteAllReactions?: (messageId: string) => Promise<void>;
  onBulkDeleteReactionsForEmoji?: (messageId: string, emoji: string) => Promise<void>;
  /** Timeline layout (2.2.0): a heading above the first chunk of each local day, with the day's count and Select day. */
  groupByDay?: boolean;
}

const MessageFeed = ({
  formattingContext,
  fullUserMap,
  onDeleteReaction,
  onFetchReactingUsers,
  onDeleteAttachment,
  onDeleteAllAttachments,
  onOpenThread,
  canManageMessages,
  currentUserId,
  onBulkDeleteAllReactions,
  onBulkDeleteReactionsForEmoji,
  groupByDay = false,
}: MessageFeedProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  // 2.2.5 WP2b: the store holds rows; the objects behind the chunks on
  // screen come from the message cache and the workspace store.
  const messages = useAppSelector(selectActiveFilteredRows);
  perfCount('MessageFeed');
  const selectedIds = useAppSelector(selectActiveSelectedIds);
  const containerKey = useAppSelector(selectActiveContainerKey);
  const hydrationSource = useAppSelector(selectActiveHydrationSource);
  const order = useAppSelector(selectActiveOrder);
  const token = useAppSelector(selectAuthToken);
  const selectedChannel = useAppSelector(selectSelectedChannel);
  const selectedDm = useAppSelector(selectSelectedDm);
  const selectedGuild = useAppSelector(selectSelectedGuild);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const guildRoles = useAppSelector(selectRoles);
  const settings = useAppSelector(selectSettings);
  const activeTab = useAppSelector(selectActiveTab);

  const { hasMore, isLoadingMore, isLoadingAll, lastMessageId } = useAppSelector(selectActivePagination);
  const highlightedMessageId = useAppSelector(selectHighlightedMessageId);
  const currentContext = selectedChannel || selectedDm;

  // Modal state
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const [reactionModalOpen, setReactionModalOpen] = useState(false);
  const [selectedMessageIdForModal, setSelectedMessageIdForModal] = useState<string | null>(null);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // 2.2.1 perf: hand the chunker the previous result so a chunk whose
  // messages did not change keeps its object, and its memoised row skips
  // the render when a page is appended or a delete batch lands elsewhere.
  const prevChunksRef = useRef<MessageChunkType<MessageRow>[]>([]);
  const chunks = useMemo(() => {
    const next = chunkMessages(messages, { splitByDay: groupByDay }, prevChunksRef.current);
    prevChunksRef.current = next;
    return next;
  }, [messages, groupByDay]);

  // The lists behind the callbacks below, read through refs so the
  // callbacks keep their identity across pages and delete flushes (a new
  // callback would re-render every visible chunk).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Timeline: messages per local day, read by the day headings.
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!groupByDay) return counts;
    for (const m of messages) { const k = messageDayKey(m); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    return counts;
  }, [messages, groupByDay]);
  const selectedDayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!groupByDay || selectedIdSet.size === 0) return counts;
    for (const m of messages) { if (!selectedIdSet.has(m.id)) continue; const k = messageDayKey(m); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    return counts;
  }, [messages, selectedIdSet, groupByDay]);

  // Virtualize over chunks, not raw messages. Chunks have wildly variable
  // heights (short content vs embeds + attachments + reactions), so
  // measureElement is essential to avoid overlap or wasted space.
  const parentRef = useRef<HTMLDivElement>(null);

  // #190: feed the virtualizer a running average of measured chunk heights
  // instead of a flat guess, so not-yet-measured rows start close to their
  // real size and the ResizeObserver snap (the scroll-up "jump") is smaller.
  const estimatorRef = useRef<ReturnType<typeof createChunkSizeEstimator>>();
  if (!estimatorRef.current) estimatorRef.current = createChunkSizeEstimator(160);
  // Stable chunk lookup for the measure wrapper without rebinding every ref.
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;

  // The component persists across channel/DM switches (no remount), so drop
  // accumulated heights when the active context changes — otherwise the Map
  // grows unbounded and the average is skewed by other channels' chunks.
  const contextId = currentContext?.id;
  useEffect(() => {
    estimatorRef.current!.reset();
  }, [contextId]);

  const estimateSize = useCallback(() => estimatorRef.current!.estimate(), []);
  const rowVirtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 20,
    getItemKey: useCallback((index: number) => chunksRef.current[index]?.key ?? index, []),
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => { perfCount('virtualizer identity'); }, [rowVirtualizer]);

  // The objects for the chunks on screen. Keyed on the first and last
  // visible index so a scroll that shows the same chunks asks nothing.
  const visibleRange = virtualItems.length > 0 ? `${virtualItems[0].index}:${virtualItems[virtualItems.length - 1].index}` : '';
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const item of virtualItems) {
      const chunk = chunks[item.index];
      if (chunk) for (const row of chunk.messages) ids.push(row.id);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, visibleRange]);
  const hydrated = useHydratedMessages(containerKey, hydrationSource, visibleIds);
  // A chunk of objects per row chunk, kept while its objects are the same
  // ones, so the memoised chunk row skips renders the way it did with
  // message arrays.
  const hydratedChunksRef = useRef(new WeakMap<MessageChunkType<MessageRow>, MessageChunkType>());
  const hydrateChunk = (chunk: MessageChunkType<MessageRow>): MessageChunkType | null => {
    const objects: Message[] = [];
    for (const row of chunk.messages) {
      const m = hydrated.get(row.id) ?? getCachedMessage(containerKey, row.id);
      if (!m) return null;
      objects.push(m);
    }
    const held = hydratedChunksRef.current.get(chunk);
    if (held && held.messages.length === objects.length && held.messages.every((m, i) => m === objects[i])) return held;
    const next: MessageChunkType = { key: chunk.key, authorId: chunk.authorId, firstTimestamp: chunk.firstTimestamp, messages: objects };
    hydratedChunksRef.current.set(chunk, next);
    return next;
  };

  const selectedMessageForModal = selectedMessageIdForModal
    ? hydrated.get(selectedMessageIdForModal) ?? getCachedMessage(containerKey, selectedMessageIdForModal) ?? null
    : null;

  // Scroll anchor (2.2.0 layouts foundation). A layout swap or a Focus
  // toggle remounts this component; remember the first visible message on
  // unmount and scroll back to it once the same conversation and tab have
  // their chunks again. Keyed on conversation and tab so a stale anchor
  // never lands in another feed.
  const anchorKey = `${contextId ?? ''}:${activeTab ?? 'main'}`;
  const anchorKeyRef = useRef(anchorKey);
  anchorKeyRef.current = anchorKey;
  const virtualizerRef = useRef(rowVirtualizer);
  virtualizerRef.current = rowVirtualizer;
  useEffect(
    () => () => {
      const first = virtualizerRef.current.getVirtualItems()[0];
      const chunk = first ? chunksRef.current[first.index] : undefined;
      const messageId = chunk?.messages[0]?.id;
      if (messageId) dispatch(setFeedScrollAnchor({ key: anchorKeyRef.current, messageId }));
    },
    [dispatch],
  );
  const scrollAnchor = useAppSelector(selectFeedScrollAnchor);
  useEffect(() => {
    if (!scrollAnchor || scrollAnchor.key !== anchorKey || chunks.length === 0) return;
    const idx = chunks.findIndex((c) => c.messages.some((m) => m.id === scrollAnchor.messageId));
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'start' });
    dispatch(setFeedScrollAnchor(null));
  }, [scrollAnchor, anchorKey, chunks, rowVirtualizer, dispatch]);

  // Record each measured height into the estimator, then delegate to the
  // virtualizer's own measureElement. Kept ref-stable so rows don't re-attach.
  const measureChunk = useCallback(
    (el: Element | null) => {
      perfCount(el ? 'measureChunk' : 'measureChunk:detach');
      if (el) {
        const idxAttr = el.getAttribute('data-index');
        const idx = idxAttr != null ? Number(idxAttr) : NaN;
        const key = Number.isNaN(idx) ? undefined : chunksRef.current[idx]?.key;
        const height = (el as HTMLElement).offsetHeight;
        if (key) estimatorRef.current!.record(key, height);
      }
      rowVirtualizer.measureElement(el);
    },
    [rowVirtualizer],
  );

  // Deep-link scroll-to-message (#123 Phase 1). When navigateToMessage
  // sets highlightedMessageId, find the chunk that contains it, scroll
  // it into view, then clear the highlight after the flash animation
  // finishes (2s).
  //
  // Effect is intentionally keyed only on highlightedMessageId — if
  // `chunks` changes mid-highlight (new page arrives during the 2s
  // window) we don't want to re-scroll or re-arm the timer, which would
  // interrupt the in-flight animation. A fresh navigate click always
  // sets a new id, which re-triggers the effect correctly.
  useEffect(() => {
    if (!highlightedMessageId) return;
    const chunkIdx = chunks.findIndex((c) =>
      c.messages.some((m) => m.id === highlightedMessageId),
    );
    if (chunkIdx >= 0) {
      rowVirtualizer.scrollToIndex(chunkIdx, { align: 'center' });
    }
    const timer = setTimeout(() => {
      dispatch(setHighlightedMessageId(null));
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedMessageId]);

  // ────────── Callbacks ──────────

  // Set by the drag-select mouseup handler below to swallow the trailing
  // click a completed drag produces on the release row.
  const suppressToggleRef = useRef(false);

  const handleToggleSelect = useCallback(
    (message: Message) => {
      // A completed drag ends with the browser firing a click on whatever
      // row the mouse was released over; without this gate that click
      // toggles the release row right back out of the drag's selection.
      if (suppressToggleRef.current) {
        suppressToggleRef.current = false;
        return;
      }
      if (activeTab) {
        dispatch(toggleThreadMessageSelection({ threadId: activeTab, messageId: message.id }));
      } else {
        dispatch(toggleMessageSelection(message.id));
      }
    },
    [activeTab, dispatch],
  );

  // ────────── #220: click-and-drag range select ──────────
  // A drag starts on a row CHECKBOX (never on message text, so native text
  // selection and the copy button are untouched) and extends over whichever
  // rows the pointer crosses. Selection during the drag = the selection at
  // drag start ∪ the range between the anchor row and the row under the
  // pointer — recomputed per row entered, so dragging backwards shrinks the
  // range without losing the pre-drag selection. Ranges are computed over
  // the `messages` array (display order), not the DOM, so virtualization
  // unmounting offscreen rows doesn't matter.
  const dragStateRef = useRef<{ anchorId: string; baseIds: string[] } | null>(null);
  const dragMovedRef = useRef(false);

  const handleSelectDragStart = useCallback(
    (message: Message) => {
      dragStateRef.current = {
        anchorId: message.id,
        // Every selected id, not just the visible ones: refine can hide
        // selected messages from `messages`, and the union below must carry
        // them through instead of silently dropping them.
        baseIds: selectedIdsRef.current,
      };
      dragMovedRef.current = false;
    },
    [],
  );

  const handleSelectDragEnter = useCallback(
    (message: Message, e?: React.MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // If the primary button is no longer down, the mouseup happened where
      // the page couldn't see it (released over devtools, another window);
      // disarm instead of turning plain hovering into selection changes.
      if (e && (e.buttons & 1) === 0) {
        dragStateRef.current = null;
        return;
      }
      const messages = messagesRef.current;
      const a = messages.findIndex((m) => m.id === drag.anchorId);
      const b = messages.findIndex((m) => m.id === message.id);
      if (a === -1 || b === -1) return;
      const [from, to] = a <= b ? [a, b] : [b, a];
      const baseIds = new Set(drag.baseIds);
      const shown = new Set(messages.map((m) => m.id));
      const union = [
        // Visible portion in display order: pre-drag selection ∪ range.
        ...messages.filter((m, i) => baseIds.has(m.id) || (i >= from && i <= to)).map((m) => m.id),
        // Pre-drag selections hidden by an active refine filter survive.
        ...drag.baseIds.filter((id) => !shown.has(id)),
      ];
      dragMovedRef.current = true;
      if (activeTab) {
        dispatch(setThreadSelectedIds({ threadId: activeTab, ids: union }));
      } else {
        dispatch(setSelectedIds(union));
      }
    },
    [activeTab, dispatch],
  );

  // End the drag on ANY mouseup, wherever it lands (row, gutter, outside
  // the window). Listener is cheap and permanent; the ref gate makes
  // non-drag mouseups no-ops. When a drag actually changed the selection,
  // swallow the click that the same mouseup is about to produce (it fires
  // synchronously after mouseup, so the timeout clears the gate right
  // after) — otherwise releasing over a checkbox would toggle that row.
  useEffect(() => {
    const endDrag = () => {
      if (dragStateRef.current && dragMovedRef.current) {
        suppressToggleRef.current = true;
        setTimeout(() => {
          suppressToggleRef.current = false;
        }, 0);
      }
      dragStateRef.current = null;
      dragMovedRef.current = false;
    };
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, []);

  // Edge auto-scroll: dragging near the top/bottom of the feed scrolls it
  // so ranges can extend past the viewport (the virtualizer renders rows
  // as they come into view and their mouseenter extends the range).
  const handleDragAutoScroll = useCallback((e: React.MouseEvent) => {
    if (!dragStateRef.current) return;
    const el = parentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const EDGE = 48;
    const STEP = 16;
    if (e.clientY < rect.top + EDGE) {
      el.scrollTop -= STEP;
    } else if (e.clientY > rect.bottom - EDGE) {
      el.scrollTop += STEP;
    }
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    const allSelected = selectedIds.length === messages.length && messages.length > 0;
    if (allSelected) {
      if (activeTab) dispatch(deselectAllThreadMessages(activeTab));
      else dispatch(deselectAllMessages());
    } else {
      if (activeTab) dispatch(selectAllThreadMessages(activeTab));
      else dispatch(selectAllMessages());
    }
  }, [activeTab, dispatch, messages.length, selectedIds.length]);

  // Select day ticks every shown message from that day; a second click unticks them.
  const handleToggleDay = useCallback((dayKey: string) => {
    const messages = messagesRef.current;
    const selected = selectedIdsRef.current;
    const dayIds = new Set(messages.filter((m) => messageDayKey(m) === dayKey).map((m) => m.id));
    const allSelected = selected.filter((id) => dayIds.has(id)).length === dayIds.size;
    const next = allSelected
      ? selected.filter((id) => !dayIds.has(id))
      : [...selected.filter((id) => !dayIds.has(id)), ...dayIds];
    if (activeTab) dispatch(setThreadSelectedIds({ threadId: activeTab, ids: next }));
    else dispatch(setSelectedIds(next));
  }, [activeTab, dispatch]);

  const handleToggleSort = useCallback(() => {
    const newOrder = {
      order:
        order.order === SortDirection.ASCENDING
          ? SortDirection.DESCENDING
          : SortDirection.ASCENDING,
      orderBy: 'timestamp' as const,
    };
    if (activeTab) dispatch(setThreadOrder({ threadId: activeTab, order: newOrder }));
    else dispatch(setOrder(newOrder));
  }, [activeTab, dispatch, order.order]);

  const handleAuthorClick = useCallback((user: User) => {
    setSelectedUser(user);
    setProfileModalOpen(true);
  }, []);

  const handleMentionClick = useCallback((user: User) => {
    setSelectedUser(user);
    setProfileModalOpen(true);
  }, []);

  const handleOpenAttachments = useCallback((message: Message) => {
    setSelectedMessageIdForModal(message.id);
    setAttachmentModalOpen(true);
  }, []);

  const handleOpenReactions = useCallback((message: Message) => {
    setSelectedMessageIdForModal(message.id);
    setReactionModalOpen(true);
  }, []);

  const paginationMode = useAppSelector((s) => s.message.pagination.mode);
  const paginationHasMore = useAppSelector((s) => s.message.pagination.hasMore);

  // 2.2.5: a scroll into view and a click can both reach this in the same
  // frame, before Redux has set isLoadingMore, so one page was asked for
  // twice. The ref closes that window.
  const loadMoreInFlight = useRef(false);
  const handleLoadMore = useCallback(() => {
    if (!token || isLoadingMore || isLoadingAll || !paginationHasMore) return;
    if (loadMoreInFlight.current) return;
    const track = (result: { finally: (cb: () => void) => unknown }) => {
      loadMoreInFlight.current = true;
      result.finally(() => { loadMoreInFlight.current = false; });
    };

    // In search mode the cursor is an offset in Redux state, not a
    // last-message-id, so branch on mode instead of on lastMessageId.
    if (paginationMode === 'search') {
      if (activeTab) return; // thread search pagination not yet wired — thread tabs fetch eagerly
      track(dispatch(
        fetchNextSearchPage({
          // #277: a DM clears selectedChannel, so the next page has to come
          // from the current context (channel or DM), the way Load All does.
          channelId: currentContext?.id,
          guildId: selectedGuild?.id,
          token,
        }),
      ));
      return;
    }

    if (!lastMessageId) return;
    if (activeTab) {
      track(dispatch(
        fetchMoreThreadMessages({ threadId: activeTab, token, lastMessageId }),
      ));
    } else if (currentContext) {
      track(dispatch(
        fetchMoreMessages({ channelId: currentContext.id, token, lastMessageId }),
      ));
    }
  }, [
    activeTab,
    currentContext,
    dispatch,
    isLoadingMore,
    isLoadingAll,
    lastMessageId,
    paginationHasMore,
    paginationMode,
    selectedGuild?.id,
    token,
  ]);

  // Infinite scroll: trigger load-more when scrolled near the bottom.
  // Latches off during Load All (#181) — the dialog promises this; before
  // this gate, a concurrent infinite-scroll fetch could race the Load All
  // iterator and corrupt the dedup/cap-shift state.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!hasMore || isLoadingMore || isLoadingAll) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < 200) handleLoadMore();
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [handleLoadMore, hasMore, isLoadingMore, isLoadingAll]);

  return (
    <>
      <Paper
        data-tour="message-feed"
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
          borderRadius: 3,
          border: 1,
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <MessageFeedToolbar
          totalCount={messages.length}
          selectedCount={selectedIds.length}
          order={order.order}
          onToggleSelectAll={handleToggleSelectAll}
          onToggleSort={handleToggleSort}
        />

        <Box
          ref={parentRef}
          onMouseMove={handleDragAutoScroll}
          sx={(theme) => ({
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            // Rows read this width: in a narrow feed (Operator's peek column) they give up their right gutter. See MessageFeedRow.
            containerType: 'inline-size',
            '&::-webkit-scrollbar': { width: 8 },
            '&::-webkit-scrollbar-track': { backgroundColor: 'transparent', borderRadius: 3 },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: alpha(theme.palette.primary.main, 0.25),
              borderRadius: 4,
              '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.4) },
            },
          })}
        >
          <Box
            data-testid="message-feed-items"
            sx={{
              position: 'relative',
              height: rowVirtualizer.getTotalSize(),
              width: '100%',
            }}
          >
            {virtualItems.map((virtualRow) => {
              const chunk = chunks[virtualRow.index];
              if (!chunk) return null;
              const shown = hydrateChunk(chunk);
              const dayKey = groupByDay ? messageDayKey(chunk.messages[0]) : '';
              const prevChunk = virtualRow.index > 0 ? chunks[virtualRow.index - 1] : undefined;
              const startsDay = !!dayKey && (!prevChunk || messageDayKey(prevChunk.messages[0]) !== dayKey);
              // A plain element with an inline transform: the wrapper moves on
              // every scroll and page, and an sx object here would be
              // serialised by emotion for each visible chunk each time.
              return (
                <div
                  key={chunk.key}
                  data-index={virtualRow.index}
                  ref={measureChunk}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {startsDay && (
                    <MessageDayHeading
                      dayKey={dayKey}
                      count={dayCounts.get(dayKey) ?? 0}
                      selectedCount={selectedDayCounts.get(dayKey) ?? 0}
                      onToggleDay={handleToggleDay}
                    />
                  )}
                  {shown ? (
                  <MessageChunk
                    chunk={shown}
                    selectedIds={selectedIdSet}
                    highlightedMessageId={highlightedMessageId}
                    formattingContext={formattingContext}
                    fullUserMap={fullUserMap}
                    cachedUserMap={cachedUserMap}
                    guildId={selectedGuild?.id || null}
                    guildRoles={guildRoles}
                    settings={settings}
                    onToggleSelect={handleToggleSelect}
                    onSelectDragStart={handleSelectDragStart}
                    onSelectDragEnter={handleSelectDragEnter}
                    onAuthorClick={handleAuthorClick}
                    onMentionClick={handleMentionClick}
                    onOpenAttachments={handleOpenAttachments}
                    onOpenReactions={handleOpenReactions}
                    onOpenThread={onOpenThread}
                  />
                  ) : (
                    <Box data-testid="message-chunk-pending" sx={{ display: 'flex', gap: 1.25, px: 1.25, py: 0.75, minHeight: 56 }}>
                      <Skeleton variant="circular" width={40} height={40} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width={120} height={16} />
                        <Skeleton variant="text" width="60%" height={14} />
                      </Box>
                    </Box>
                  )}
                </div>
              );
            })}
          </Box>

          {isLoadingMore && (
            <Box sx={{ display: 'flex', gap: 1.25, p: 1.25 }}>
              <Skeleton variant="circular" width={40} height={40} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width={120} height={16} />
                <Skeleton variant="text" width="80%" height={14} />
                <Skeleton variant="text" width="40%" height={14} />
              </Box>
            </Box>
          )}
          {/* Explicit "Load more" affordance — covers the case where a local
              refine has narrowed the feed enough that there's no scrollbar
              to trigger the scroll-for-more listener (which only fires on
              actual scroll events). Always present when there are more pages
              to fetch and we aren't currently loading. */}
          {paginationHasMore && !isLoadingMore && !isLoadingAll && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={handleLoadMore}
                data-testid="message-feed-load-more"
              >
                {t('feed.loadMore')}
              </Button>
            </Box>
          )}
        </Box>
      </Paper>

      <UserProfileModal
        open={profileModalOpen}
        onClose={() => {
          setProfileModalOpen(false);
          setSelectedUser(null);
        }}
        user={selectedUser}
        cachedUserMap={cachedUserMap}
        guildId={selectedGuild?.id || null}
        guildRoles={guildRoles}
        onFilterByAuthor={(u) => {
          const name = cachedUserMap[u.id]?.displayName || u.global_name || u.username;
          dispatch(applyUserFilter({ userId: u.id, displayName: name, mode: 'author' }));
          setProfileModalOpen(false);
          setSelectedUser(null);
        }}
        onFilterByMentions={(u) => {
          const name = cachedUserMap[u.id]?.displayName || u.global_name || u.username;
          dispatch(applyUserFilter({ userId: u.id, displayName: name, mode: 'mentions' }));
          setProfileModalOpen(false);
          setSelectedUser(null);
        }}
      />

      <AttachmentModal
        open={attachmentModalOpen}
        onClose={() => {
          setAttachmentModalOpen(false);
          setSelectedMessageIdForModal(null);
        }}
        message={selectedMessageForModal}
        onDeleteAttachment={onDeleteAttachment}
        onDeleteAllAttachments={onDeleteAllAttachments}
        currentUserId={currentUserId}
        canManageMessages={canManageMessages}
      />

      <ReactionModal
        open={reactionModalOpen}
        onClose={() => {
          setReactionModalOpen(false);
          setSelectedMessageIdForModal(null);
        }}
        message={selectedMessageForModal}
        onDeleteReaction={
          onDeleteReaction && selectedMessageForModal
            ? (emoji, userId) => onDeleteReaction(selectedMessageForModal.id, emoji, userId)
            : undefined
        }
        onFetchReactingUsers={
          onFetchReactingUsers && selectedMessageForModal
            ? (emoji) => onFetchReactingUsers(selectedMessageForModal.id, emoji)
            : undefined
        }
        canManageMessages={canManageMessages}
        currentUserId={currentUserId}
        onBulkDeleteAllReactions={
          onBulkDeleteAllReactions && selectedMessageForModal
            ? () => onBulkDeleteAllReactions(selectedMessageForModal.id)
            : undefined
        }
        onBulkDeleteReactionsForEmoji={
          onBulkDeleteReactionsForEmoji && selectedMessageForModal
            ? (emoji) => onBulkDeleteReactionsForEmoji(selectedMessageForModal.id, emoji)
            : undefined
        }
      />
    </>
  );
};

export default MessageFeed;
