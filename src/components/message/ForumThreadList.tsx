import { useRef, useCallback, useState, useMemo } from 'react';
import {
  Typography,
  Box,
  Chip,
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
}

/**
 * Displays a list of forum channel threads/posts in Discord-style cards.
 * Supports tag filtering and search.
 */
const ForumThreadList = ({
  threads, firstMessages, totalResults, isLoading, hasMore,
  forumChannel, onThreadClick, onLoadMore, onSearch, onClearSearch,
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
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, flexShrink: 0 }}>
          {searchText || selectedTags.size > 0
            ? `${filteredThreads.length} of ${totalResults || threads.length}`
            : `${threads.length} of ${totalResults || threads.length}`} post{filteredThreads.length !== 1 ? 's' : ''}
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
                <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, pl: 3.5 }}>
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
                    pl: 3.5,
                    mb: 0.5,
                  }}
                >
                  {authorName && <strong>{authorName}: </strong>}{previewText}
                </Typography>
              )}

              {/* Meta row */}
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', pl: 3.5 }}>
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
