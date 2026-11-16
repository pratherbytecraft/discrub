import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  Typography,
  Box,
  Chip,
  Checkbox,
  TextField,
  InputAdornment,
  Skeleton,
  keyframes,
} from '@mui/material';
import {
  Forum as ForumIcon,
  Lock as LockedIcon,
  ChatBubbleOutline as RepliesIcon,
  Person as AuthorIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import type { Channel, Message } from 'discrub-core/types/discord-types';
import EmptyState from '@components/ui/EmptyState';
import { timeAgo } from '@/utils/timeAgo';
import { useTranslation } from 'react-i18next';

const glowPulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
`;

/** Skeleton placeholder that mirrors a real thread card layout */
const ThreadCardSkeleton = ({ index }: { index: number }) => (
  <Box
    sx={{
      p: 1.5,
      bgcolor: 'action.hover',
      borderRadius: 1,
      borderLeft: 3,
      borderColor: 'primary.main',
      animation: `${glowPulse} 1.8s ease-in-out infinite`,
      animationDelay: `${index * 0.15}s`,
    }}
  >
    {/* Title row */}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Skeleton variant="circular" width={16} height={16} />
      <Skeleton variant="text" width={`${50 + Math.random() * 30}%`} height={20} />
      <Box sx={{ flex: 1 }} />
      <Skeleton variant="text" width={40} height={16} />
    </Box>
    {/* Preview text */}
    <Box sx={{ pl: 3.5, mb: 0.5 }}>
      <Skeleton variant="text" width="90%" height={14} />
      <Skeleton variant="text" width={`${40 + Math.random() * 30}%`} height={14} />
    </Box>
    {/* Meta row */}
    <Box sx={{ display: 'flex', gap: 1.5, pl: 3.5 }}>
      <Skeleton variant="text" width={30} height={14} />
      <Skeleton variant="text" width={30} height={14} />
    </Box>
  </Box>
);

interface ForumTag {
  id: string;
  name: string;
  emoji_name?: string | null;
  emoji_id?: string | null;
}

interface ForumThreadListProps {
  threads: Channel[];
  firstMessages: Message[];
  totalResults: number;
  isLoading: boolean;
  hasMore: boolean;
  /** The forum channel object (contains available_tags) */
  forumChannel?: Channel | null;
  onThreadClick: (thread: Channel) => void;
  onLoadMore?: () => void;
  onSearch?: (query: string) => void;
  onClearSearch?: () => void;
  /**
   * Given, the posts get tick boxes and the count gets one for all of
   * them, and this is told what an Export covers each time it changes.
   */
  onExportSelectionChange?: (selection: ForumExportSelection) => void;
}

/** What the forum's Export covers. The same shape the Load Thread dialog hands over. */
export interface ForumExportSelection {
  /** The run lists every post itself: nothing narrows the list and it has pages left. */
  all: boolean;
  /** The posts to export, or with `all` the ones loaded so far. */
  posts: Channel[];
  total: number;
  /** With `all`: posts unticked after the box for all of them was ticked. */
  excludedIds?: string[];
  /** Nothing is ticked, so the Export covers everything listed. */
  everything: boolean;
}

/**
 * Displays a list of forum channel threads/posts in Discord-style cards.
 * Supports tag filtering and search.
 */
const ForumThreadList = ({
  threads, firstMessages, totalResults, isLoading, hasMore,
  forumChannel, onThreadClick, onLoadMore, onSearch, onClearSearch, onExportSelectionChange,
}: ForumThreadListProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSearchActive = searchText.trim().length > 0;

  // Extract available tags from the forum channel
  const availableTags: ForumTag[] = useMemo(() => {
    return ((forumChannel as any)?.available_tags || []) as ForumTag[];
  }, [forumChannel]);

  // Build tag name map
  const tagMap = useMemo(() => {
    const map: Record<string, ForumTag> = {};
    availableTags.forEach((tag) => { map[tag.id] = tag; });
    return map;
  }, [availableTags]);

  // Build first message map
  const firstMessageMap = useMemo(() => {
    const map: Record<string, Message> = {};
    firstMessages.forEach((msg) => {
      if (msg.channel_id) map[msg.channel_id] = msg;
    });
    return map;
  }, [firstMessages]);

  const handleScroll = useCallback(() => {
    // Disable scroll-to-load during search (matches Discord behavior)
    if (isSearchActive) return;
    if (!scrollRef.current || !hasMore || isLoading || !onLoadMore) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore, isSearchActive]);

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      // Clear search — reload default thread list
      onClearSearch?.();
      return;
    }

    // Debounce server-side search
    debounceRef.current = setTimeout(() => {
      onSearch?.(value.trim());
    }, 400);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  // Filter threads by tags only (search is server-side)
  const filteredThreads = useMemo(() => {
    if (selectedTags.size === 0) return threads;

    return threads.filter((t) => {
      const appliedTags: string[] = (t as any).applied_tags || [];
      return appliedTags.some((tagId) => selectedTags.has(tagId));
    });
  }, [threads, selectedTags]);

  // Ticks. `allTicked` is the box beside the count: every post the list
  // stands for, loaded or not, minus the ones unticked after it.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [allTicked, setAllTicked] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const forumId = forumChannel?.id;
  const tagKey = [...selectedTags].sort().join(',');
  const narrowed = isSearchActive || selectedTags.size > 0;
  // A new forum, search or tag filter is a new list, and the ticks go with the old one.
  useEffect(() => {
    setPicked(new Set());
    setAllTicked(false);
    setExcluded(new Set());
  }, [forumId, isSearchActive, tagKey]);
  // What the box for all stands for: the whole forum, or what a search or tag filter left.
  const scopeTotal = narrowed ? filteredThreads.length : Math.max(totalResults, threads.length);
  const isTicked = (id: string) => (allTicked ? !excluded.has(id) : picked.has(id));
  const togglePost = (id: string) => {
    if (allTicked) {
      const next = new Set(excluded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size >= scopeTotal) {
        setAllTicked(false);
        setExcluded(new Set());
      } else {
        setExcluded(next);
      }
      return;
    }
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const toggleAll = () => {
    const clearing = allTicked && excluded.size === 0;
    setPicked(new Set());
    setExcluded(new Set());
    setAllTicked(!clearing);
  };
  const pickedCount = useMemo(() => filteredThreads.filter((thread) => picked.has(thread.id)).length, [filteredThreads, picked]);
  const selection = useMemo<ForumExportSelection>(() => {
    if (!allTicked && pickedCount > 0) {
      const posts = filteredThreads.filter((thread) => picked.has(thread.id));
      return { all: false, posts, total: posts.length, everything: false };
    }
    const kept = allTicked && excluded.size > 0 ? filteredThreads.filter((thread) => !excluded.has(thread.id)) : filteredThreads;
    const everything = !allTicked || excluded.size === 0;
    // Only the plain list with pages left makes the run read the forum itself.
    if (!narrowed && hasMore) {
      return { all: true, posts: kept, total: Math.max(scopeTotal - (allTicked ? excluded.size : 0), 0), everything, ...(allTicked && excluded.size > 0 ? { excludedIds: [...excluded] } : {}) };
    }
    return { all: false, posts: kept, total: kept.length, everything };
  }, [allTicked, excluded, picked, pickedCount, filteredThreads, narrowed, hasMore, scopeTotal]);
  const reportSelection = useRef(onExportSelectionChange);
  reportSelection.current = onExportSelectionChange;
  useEffect(() => {
    reportSelection.current?.(selection);
  }, [selection]);
  const tickable = !!onExportSelectionChange;

  // Full skeletons: initial load or search (no existing results to show)
  const showFullSkeletons = isLoading && filteredThreads.length === 0;
  // Load-more skeleton: appending to existing list
  const showLoadMoreSkeleton = isLoading && filteredThreads.length > 0;

  return (
    <Box
      ref={scrollRef}
      onScroll={handleScroll}
      sx={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)', p: 2 }}
    >
      {/* Tag filter chips — always visible when tags exist */}
      {availableTags.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
          {availableTags.map((tag) => (
            <Chip
              key={tag.id}
              label={`${tag.emoji_name || ''} ${tag.name}`.trim()}
              size="small"
              variant={selectedTags.has(tag.id) ? 'filled' : 'outlined'}
              color={selectedTags.has(tag.id) ? 'primary' : 'default'}
              onClick={() => toggleTag(tag.id)}
              sx={{ fontSize: '0.75rem', height: 24 }}
            />
          ))}
          {selectedTags.size > 0 && (
            <Chip
              label={t('forum.clear')}
              size="small"
              variant="outlined"
              onClick={() => setSelectedTags(new Set())}
              onDelete={() => setSelectedTags(new Set())}
              sx={{ fontSize: '0.75rem', height: 24 }}
            />
          )}
        </Box>
      )}

      {/* Search and count */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        {tickable && filteredThreads.length > 0 && (
          <Checkbox
            size="small"
            checked={allTicked && excluded.size === 0}
            indeterminate={allTicked ? excluded.size > 0 : pickedCount > 0}
            onChange={toggleAll}
            inputProps={{ 'aria-label': t('forum.selectAll') }}
            data-testid="forum-select-all"
            sx={{ p: 0.5, ml: 0.75, mr: -0.25 }}
          />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, flexShrink: 0 }}>
          {t('forum.shownOf', {
            shown: searchText || selectedTags.size > 0 ? filteredThreads.length : threads.length,
            count: totalResults || threads.length,
          })}
        </Typography>
        <TextField
          size="small"
          placeholder={t('forum.searchPosts')}
          value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
          sx={{ flex: 1, '& .MuiOutlinedInput-root': { height: 32, fontSize: '0.8rem' } }}
        />
      </Box>

      {/* Empty states */}
      {!isLoading && filteredThreads.length === 0 && isSearchActive && (
        <EmptyState message={t('forum.noPostsMatching', { search: searchText })} icon={<ForumIcon />} />
      )}
      {!isLoading && filteredThreads.length === 0 && !isSearchActive && selectedTags.size > 0 && (
        <EmptyState message={t('forum.noPostsMatchingTags')} icon={<ForumIcon />} />
      )}
      {!isLoading && threads.length === 0 && !isSearchActive && selectedTags.size === 0 && (
        <EmptyState message={t('forum.noPosts')} icon={<ForumIcon />} />
      )}

      {/* Full skeleton cards — initial load or search with no results yet */}
      {showFullSkeletons && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <ThreadCardSkeleton key={i} index={i} />
          ))}
        </Box>
      )}

      {/* Thread cards — always visible when we have data */}
      {/* In a list under 360 px (Operator's peek column) the time drops under the title, or the title kept only a word. */}
      {!showFullSkeletons && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, containerType: 'inline-size', '@container (max-width: 360px)': { '& .forum-title-row': { flexWrap: 'wrap', rowGap: 0 }, '& .forum-title': { flexBasis: 'calc(100% - 32px)' }, '& .forum-time': { flexBasis: '100%', pl: 3 } } }}>
        {filteredThreads.map((thread) => {
          const metadata = (thread as any).thread_metadata;
          const isLocked = metadata?.locked;
          const messageCount = (thread as any).message_count;
          const memberCount = (thread as any).member_count;
          const appliedTags: string[] = (thread as any).applied_tags || [];
          const firstMsg = firstMessageMap[thread.id];
          const previewText = firstMsg?.content ? firstMsg.content.slice(0, 120) + (firstMsg.content.length > 120 ? '...' : '') : '';
          const authorName = firstMsg?.author?.username;
          // Show last activity time (from last_message_id snowflake), falling back to creation time
          const lastMsgId = (thread as any).last_message_id;
          const activityTimestamp = lastMsgId
            ? new Date(Number(BigInt(lastMsgId) >> 22n) + 1420070400000).toISOString()
            : (metadata?.create_timestamp || (thread.id
              ? new Date(Number(BigInt(thread.id) >> 22n) + 1420070400000).toISOString()
              : null));

          return (
            <Box
              key={thread.id}
              onClick={() => onThreadClick(thread)}
              sx={{
                p: 1.5,
                bgcolor: 'action.hover',
                borderRadius: 1,
                cursor: 'pointer',
                transition: 'background 150ms ease',
                borderLeft: 3,
                borderColor: isLocked ? 'text.disabled' : 'primary.main',
                '&:hover': { bgcolor: 'action.selected' },
              }}
            >
              {/* Tag chips row */}
              {appliedTags.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, pl: tickable ? 6.75 : 3.5 }}>
                  {appliedTags.map((tagId) => {
                    const tag = tagMap[tagId];
                    if (!tag) return null;
                    return (
                      <Chip
                        key={tagId}
                        label={`${tag.emoji_name || ''} ${tag.name}`.trim()}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.6rem' }}
                      />
                    );
                  })}
                </Box>
              )}

              {/* Title row */}
              <Box className="forum-title-row" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                {tickable && (
                  <Checkbox
                    size="small"
                    checked={isTicked(thread.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => togglePost(thread.id)}
                    inputProps={{ 'aria-label': t('forum.selectNamed', { name: thread.name || t('forum.untitledPost') }) }}
                    data-testid={`forum-tick-${thread.id}`}
                    sx={{ p: 0.5, my: -0.75, ml: -0.75, mr: -0.5 }}
                  />
                )}
                {isLocked ? (
                  <LockedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                ) : (
                  <ForumIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                )}
                <Typography
                  variant="body2"
                  className="forum-title"
                  sx={{
                    fontWeight: 600,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {thread.name || t('forum.untitledPost')}
                </Typography>
                {activityTimestamp && (
                  <Typography variant="caption" color="text.disabled" className="forum-time" sx={{ flexShrink: 0 }}>
                    {timeAgo(activityTimestamp)}
                  </Typography>
                )}
              </Box>

              {/* Preview text */}
              {previewText && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.4,
                    pl: tickable ? 6.75 : 3.5,
                    mb: 0.5,
                  }}
                >
                  {authorName && <strong>{authorName}: </strong>}{previewText}
                </Typography>
              )}

              {/* Meta row */}
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', pl: tickable ? 6.75 : 3.5 }}>
                {messageCount != null && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <RepliesIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">{messageCount}</Typography>
                  </Box>
                )}
                {memberCount != null && memberCount > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <AuthorIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">{memberCount}</Typography>
                  </Box>
                )}
                {isLocked && (
                  <Chip label="Locked" size="small" variant="outlined" color="warning" sx={{ height: 18, fontSize: '0.6rem' }} />
                )}
              </Box>
            </Box>
          );
        })}
        {/* Single skeleton at bottom during load-more */}
        {showLoadMoreSkeleton && <ThreadCardSkeleton index={0} />}
      </Box>}

    </Box>
  );
};

export default ForumThreadList;
