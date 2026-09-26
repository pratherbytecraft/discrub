import { memo } from 'react';
import { Avatar, Box, Typography, useTheme } from '@mui/material';
import { Forum as ThreadIcon } from '@mui/icons-material';
import { format } from 'date-fns';
import type { Message, User } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import { isSystemMessageType } from 'discrub-core/system-messages';
import { getDisplayName } from '@/utils/userDisplayUtils';
import { getUserRoleColor, getUserRoleIcon } from '@/utils/roleColorUtils';
import MessageFeedRow from './MessageFeedRow';
import SystemMessageRow from './SystemMessageRow';
import type { MessageChunk as MessageChunkType } from '@/utils/messageChunking';
import { getDateLocale } from '@/i18n/dateLocale';
import { useTranslation } from 'react-i18next';
import { perfCount } from '@/utils/perfCounters';

interface MessageChunkProps {
  chunk: MessageChunkType;
  selectedIds: Set<string>;
  /** Deep-link target ID (#123). Applied as a flash highlight on the
   *  matching row; ignored when null. */
  highlightedMessageId?: string | null;
  formattingContext: HtmlFormattingContext;
  fullUserMap: Record<string, User>;
  cachedUserMap: ExportUserMap;
  guildId: string | null;
  guildRoles: any;
  settings: any;
  onToggleSelect: (message: Message) => void;
  /** #220: drag-select — pointer went down on this row's checkbox. */
  onSelectDragStart?: (message: Message) => void;
  /** #220: drag-select — pointer entered this row mid-drag. */
  onSelectDragEnter?: (message: Message, e?: React.MouseEvent) => void;
  onAuthorClick: (user: User) => void;
  onMentionClick: (user: User) => void;
  onOpenAttachments: (message: Message) => void;
  onOpenReactions: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
}

const MessageChunk = function MessageChunk({
  chunk,
  selectedIds,
  highlightedMessageId,
  formattingContext,
  fullUserMap,
  cachedUserMap,
  guildId,
  guildRoles,
  settings,
  onToggleSelect,
  onSelectDragStart,
  onSelectDragEnter,
  onAuthorClick,
  onMentionClick,
  onOpenAttachments,
  onOpenReactions,
  onOpenThread,
}: MessageChunkProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  perfCount('MessageChunk');

  const first = chunk.messages[0];

  // System-message chunks are always single-message (the chunker breaks on
  // any non-type-0 message). Render them as a compact Discord-style notice
  // row — no avatar, no chunk header. Types 0/19/20/21/23 skip this branch
  // and fall through to the normal avatar + content layout below.
  if (chunk.messages.length === 1 && isSystemMessageType(first.type)) {
    return (
      <SystemMessageRow
        message={first}
        formattingContext={formattingContext}
        guildId={guildId}
        guildRoles={guildRoles}
        cachedUserMap={cachedUserMap}
        highlighted={highlightedMessageId === first.id}
        selected={selectedIds.has(first.id)}
        onToggleSelect={onToggleSelect}
      />
    );
  }

  const author = first.author;
  const roleColor = author?.id
    ? getUserRoleColor(author.id, guildId, cachedUserMap, guildRoles)
    : null;
  const roleIcon = author?.id
    ? getUserRoleIcon(author.id, guildId, cachedUserMap, guildRoles)
    : null;

  const displayName = author
    ? settings
      ? getDisplayName(author, cachedUserMap, guildId, settings)
      : author.global_name || author.username || t('feed.unknownUser')
    : t('feed.unknownUser');

  const avatarSrc = author?.avatar
    ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`
    : undefined;

  let headerTimestamp = '';
  try {
    const timeFmt = settings?.timeFormat || 'h:mm aa';
    headerTimestamp = format(
      new Date(chunk.firstTimestamp),
      `MMM d, yyyy ${timeFmt}`,
      { locale: getDateLocale() },
    );
  } catch {
    headerTimestamp = chunk.firstTimestamp;
  }

  // #191: a chunk can contain more than one message that spawned its own
  // thread (same author, type 0, within the 7-minute grouping window).
  // Collecting them all keeps every starter reachable from the chunk
  // header; pre-#191 the .find() returned only the first and the rest
  // were silently unreachable.
  const threadMessages = chunk.messages.filter(
    (m) => (m as any).thread,
  );

  return (
    <Box
      data-testid="message-chunk"
      sx={{
        display: 'flex',
        gap: 1,
        px: 1.25,
        py: 0.75,
      }}
    >
      <Avatar
        src={avatarSrc}
        onClick={() => author && onAuthorClick(author)}
        data-tour="author-avatar"
        sx={{
          width: 40,
          height: 40,
          cursor: author ? 'pointer' : 'default',
          flexShrink: 0,
          mt: 0.5,
          transition: 'opacity 120ms ease',
          '&:hover': author ? { opacity: 0.85 } : undefined,
        }}
      >
        {author?.username?.[0]?.toUpperCase()}
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 0.25,
            flexWrap: 'wrap',
          }}
        >
          <Typography
            component="span"
            fontWeight={600}
            onClick={() => author && onAuthorClick(author)}
            sx={{
              cursor: author ? 'pointer' : 'default',
              color: roleColor || 'text.primary',
              '&:hover': author ? { textDecoration: 'underline' } : undefined,
            }}
          >
            {displayName}
          </Typography>
          {roleIcon?.type === 'image' && (
            <Box
              component="img"
              src={`https://cdn.discordapp.com/role-icons/${roleIcon.roleId}/${roleIcon.hash}.webp?size=20`}
              sx={{ width: 16, height: 16, flexShrink: 0 }}
            />
          )}
          {roleIcon?.type === 'emoji' && (
            <Typography component="span" sx={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
              {roleIcon.emoji}
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.75rem' }}
          >
            {headerTimestamp}
          </Typography>
          {onOpenThread && threadMessages.map((tm) => {
            const threadName = ((tm as any).thread?.name as string | undefined)?.trim();
            // Single starter keeps the original generic label so existing
            // visuals don't shift. Multiple starters get name-suffixed
            // labels so users can tell them apart.
            const label =
              threadMessages.length > 1 && threadName
                ? t('feed.openNamedThread', { name: threadName })
                : t('feed.openThread');
            return (
              <Typography
                key={tm.id}
                component="button"
                data-testid="message-chunk-open-thread"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenThread(tm);
                }}
                sx={{
                  border: 0,
                  background: 'none',
                  p: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  fontSize: '0.75rem',
                  color: theme.palette.primary.main,
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                <ThreadIcon sx={{ fontSize: 14 }} />
                {label}
              </Typography>
            );
          })}
        </Box>

        {chunk.messages.map((message, idx) => (
          <MessageFeedRow
            key={message.id}
            message={message}
            isFirstInChunk={idx === 0}
            selected={selectedIds.has(message.id)}
            highlighted={highlightedMessageId === message.id}
            formattingContext={formattingContext}
            fullUserMap={fullUserMap}
            cachedUserMap={cachedUserMap}
            guildId={guildId}
            guildRoles={guildRoles}
            settings={settings}
            onToggleSelect={onToggleSelect}
            onSelectDragStart={onSelectDragStart}
            onSelectDragEnter={onSelectDragEnter}
            onMentionClick={onMentionClick}
            onOpenAttachments={onOpenAttachments}
            onOpenReactions={onOpenReactions}
          />
        ))}
      </Box>
    </Box>
  );
};

/**
 * #263: the feed rebuilds `selectedIds` on every selection change, which
 * would re-render every visible chunk for one click. Treat two Sets as
 * equal for a chunk when none of its messages changed membership.
 */
export const chunkPropsAreEqual = (prev: MessageChunkProps, next: MessageChunkProps): boolean => {
  for (const key of Object.keys(next) as (keyof MessageChunkProps)[]) {
    if (key === 'selectedIds') continue;
    if (prev[key] !== next[key]) {
      perfCount(`MessageChunk changed:${key}`);
      return false;
    }
  }
  if (prev.selectedIds === next.selectedIds) return true;
  return next.chunk.messages.every((m) => prev.selectedIds.has(m.id) === next.selectedIds.has(m.id));
};

export default memo(MessageChunk, chunkPropsAreEqual);
