import { memo, useCallback, useMemo, useState } from 'react';
import {
  Box,
  Checkbox,
  IconButton,
  Link,
  Tooltip,
  Typography,
  useTheme,
  alpha,
} from '@mui/material';
import { ContentCopy as CopyIcon, Reply as ReplyIcon } from '@mui/icons-material';
import { format } from 'date-fns';
import type { Message, User } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import { formatContentAsHtml } from 'discrub-core/html-formatting-utils';
import { getMessageContent } from 'discrub-core/discrub-utils';
import { formatMessageContentLight } from '@/utils/messageLightFormatting';
import { getUserRoleColor } from '@/utils/roleColorUtils';
import { useAppDispatch } from '@/app/hooks';
import { navigateToMessage } from '@features/message/messageSlice';
import {
  InlineAttachments,
  InlineEmbeds,
  isBareMediaEmbed,
  InlineReactions,
  InlineSticker,
  InlinePoll,
} from './inlineRenderers';
import { getDateLocale } from '@/i18n/dateLocale';
import { useTranslation } from 'react-i18next';

/** Collapse content bodies past this pixel height behind a "Show more" toggle. */
const COLLAPSED_MAX_HEIGHT = 220;

/**
 * Static heuristic for deciding whether a message's content should be
 * collapsed behind a "Show more" affordance. Uses raw character count and
 * newline density so the decision is stable across renders — if we measured
 * the rendered DOM instead, the post-mount size change would feed back into
 * the virtualizer and trigger an infinite re-measurement loop.
 */
const shouldCollapseContent = (raw: string | null | undefined): boolean => {
  if (!raw) return false;
  if (raw.length > 500) return true;
  const newlines = raw.match(/\n/g)?.length ?? 0;
  return newlines > 6;
};

interface MessageFeedRowProps {
  message: Message;
  /** True for the first message in a chunk — its timestamp already appears
   *  in the chunk header next to the author's name, so we skip the per-row
   *  timestamp for it. */
  isFirstInChunk: boolean;
  selected: boolean;
  /** Deep-link flash (#123). When true, the row plays a 2s yellow flash
   *  animation so a user jumping to this row via a reply-bar or pin
   *  click sees exactly which row was landed on. */
  highlighted?: boolean;
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
  onMentionClick: (user: User) => void;
  onOpenAttachments: (message: Message) => void;
  onOpenReactions: (message: Message) => void;
}

const MessageFeedRow = memo(function MessageFeedRow({
  message,
  isFirstInChunk,
  selected,
  highlighted = false,
  formattingContext,
  fullUserMap,
  cachedUserMap,
  guildId,
  guildRoles,
  settings,
  onToggleSelect,
  onSelectDragStart,
  onSelectDragEnter,
  onMentionClick,
  onOpenAttachments,
  onOpenReactions,
}: MessageFeedRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const isDark = theme.palette.mode === 'dark';

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const rawContent = getMessageContent(message);

  // Stickers and polls render their own inline sections lower in the row
  // (#213, replacing the #204 plain-text labels). Detecting them here keeps
  // a sticker/poll-only message from falling through to "(no content)".
  const hasSticker = !!message.sticker_items && message.sticker_items.length > 0;
  const poll = message.poll;
  const hasPoll = !!poll;

  // A forwarded message (#197) carries its payload in message_snapshots and
  // renders its own "Forwarded" box lower in the row, but the outer message
  // typically has empty content/attachments/embeds — so without counting it
  // here a forward-only message stacks a spurious "(no content)" line above
  // the forwarded body. Confirmed via the #204 render investigation.
  const hasForward =
    Array.isArray((message as { message_snapshots?: unknown[] }).message_snapshots) &&
    (message as { message_snapshots: unknown[] }).message_snapshots.length > 0;

  // Attachments, embeds, and forwarded snapshots render their own inline
  // sections lower in the row, so an empty content area for them is expected
  // (no placeholder needed).
  const hasInlineBody =
    (!!message.attachments && message.attachments.length > 0) ||
    (!!message.embeds && message.embeds.length > 0) ||
    hasForward;

  const hasAnyBody = !!rawContent || hasInlineBody || hasSticker || hasPoll;

  // #190 phase 2: cache the markdown→HTML transformation per row. Before
  // this, formatContentAsHtml ran on every render even though the row is
  // wrapped in React.memo at the export boundary — because the call sat
  // outside any useMemo. With formattingContext stabilized at the
  // ServerView level (memoized userMap/channelMap/guildRoles), this
  // useMemo only recomputes when the actual message content changes.
  const contentHtml = useMemo(
    () => (rawContent ? formatContentAsHtml(rawContent, formattingContext) : ''),
    [rawContent, formattingContext],
  );

  // #219: a bare image/GIF URL that Discord unfurled into its embed is not
  // shown as text by Discord's client — the media IS the message. Hide the
  // duplicate blue link when the entire content is exactly the single
  // embed's source URL. Any additional text (or multiple embeds) keeps the
  // content visible.
  const contentIsBareEmbedUrl = useMemo(() => {
    if (!rawContent || message.embeds?.length !== 1) return false;
    const embed = message.embeds[0];
    return isBareMediaEmbed(embed) && embed.url === rawContent.trim();
  }, [rawContent, message.embeds]);

  const overflowing = useMemo(() => shouldCollapseContent(rawContent), [rawContent]);

  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('user-mention')) {
        e.stopPropagation();
        const userId = target.getAttribute('data-user-id');
        if (userId && fullUserMap[userId]) {
          onMentionClick(fullUserMap[userId]);
        }
      }
    },
    [fullUserMap, onMentionClick],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawContent || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard permission denied — silently skip */
    }
  }, [rawContent]);

  const mentionStyles = {
    '& .user-mention': {
      background: isDark ? 'rgba(88, 101, 242, 0.3)' : 'rgba(88, 101, 242, 0.15)',
      color: isDark ? '#c9d1ff' : theme.palette.primary.main,
      padding: '0 3px',
      borderRadius: '3px',
      fontWeight: 500,
      cursor: 'pointer',
      '&:hover': {
        backgroundColor: isDark ? 'rgba(88, 101, 242, 0.5)' : 'rgba(88, 101, 242, 0.25)',
        textDecoration: 'underline',
      },
    },
    '& .channel-mention': {
      background: isDark ? 'rgba(60, 66, 112, 0.5)' : 'rgba(60, 66, 112, 0.15)',
      color: isDark ? '#b5c7ff' : theme.palette.primary.dark,
      padding: '0 3px',
      borderRadius: '3px',
      fontWeight: 500,
    },
    '& .role-mention': {
      background: isDark ? 'rgba(88, 101, 242, 0.3)' : 'rgba(88, 101, 242, 0.15)',
      color: isDark ? '#c9d1ff' : theme.palette.primary.main,
      padding: '0 3px',
      borderRadius: '3px',
      fontWeight: 500,
    },
    '& .everyone-mention': {
      background: isDark ? 'rgba(250, 166, 26, 0.3)' : 'rgba(250, 166, 26, 0.15)',
      color: isDark ? '#faa61a' : '#b47615',
      padding: '0 3px',
      borderRadius: '3px',
      fontWeight: 600,
    },
    '& .custom-emoji': {
      width: 20,
      height: 20,
      verticalAlign: 'middle',
      margin: '0 2px',
    },
    '& a': {
      color: isDark ? '#00b0f4' : '#0969da',
      textDecoration: 'none',
      '&:hover': { textDecoration: 'underline' },
    },
    '& pre': {
      background: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.04)',
      padding: 1,
      borderRadius: 1,
      overflow: 'auto',
      fontFamily: 'monospace',
      fontSize: '0.85em',
      m: 0,
      my: 0.5,
    },
    '& code': {
      background: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.06)',
      padding: '1px 4px',
      borderRadius: '3px',
      fontSize: '0.85em',
      fontFamily: 'monospace',
    },
    '& blockquote': {
      borderLeft: '3px solid',
      borderColor: 'divider',
      pl: 1.25,
      color: 'text.secondary',
      m: 0,
      my: 0.5,
    },
  } as const;

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't steal clicks from interactive children. `closest()` uses CSS
      // selectors, so [role="button"] (attachment thumbnails, reaction chips,
      // any Box with role=button) has to be listed explicitly — it's not
      // covered by `button`, which only matches the <button> tag.
      if (
        target.closest(
          'a, button, input, img, video, audio, [role="button"], [role="link"]',
        )
      )
        return;
      if (target.classList.contains('user-mention')) return;
      onToggleSelect(message);
    },
    [message, onToggleSelect],
  );

  let shortTimestamp = '';
  try {
    shortTimestamp = format(
      new Date(message.timestamp),
      settings?.timeFormat || 'h:mm aa',
      { locale: getDateLocale() },
    );
  } catch {
    /* ignore bad timestamps */
  }

  return (
    <Box
      data-testid="message-feed-row"
      data-message-id={message.id}
      data-highlighted={highlighted ? 'true' : undefined}
      onClick={handleRowClick}
      // #220: extend an in-flight drag-select over this row. No-op unless a
      // drag started on some row's checkbox (MessageFeed gates on its ref).
      onMouseEnter={(e) => onSelectDragEnter?.(message, e)}
      sx={{
        position: 'relative',
        display: 'block',
        py: 0.25,
        pr: 6,
        // The gutter keeps text clear of the hover bar at the top right. In a feed under 420 px it cost a fifth of
        // the line (Operator's peek wrapped a sentence over five lines), and the bar only covers the name line, so it goes.
        '@container (max-width: 420px)': { pr: 1 },
        borderRadius: 0.5,
        cursor: 'pointer',
        transition: 'background-color 100ms ease',
        ...(selected
          ? {
              backgroundColor: alpha(theme.palette.primary.main, 0.16),
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
            }
          : {
              borderLeft: '3px solid transparent',
            }),
        ...(highlighted && {
          animation: 'deeplink-flash 2s ease-out',
          '@keyframes deeplink-flash': {
            '0%': { backgroundColor: 'rgba(250, 166, 26, 0.45)' },
            '100%': {
              backgroundColor: selected
                ? alpha(theme.palette.primary.main, 0.16)
                : 'transparent',
            },
          },
        }),
        '&:hover': {
          backgroundColor: selected
            ? alpha(theme.palette.primary.main, 0.2)
            : alpha(theme.palette.primary.main, 0.06),
          '& .feed-row-hover-actions': {
            opacity: 1,
          },
          '& .feed-row-gutter-time': {
            opacity: 1,
          },
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {/* Reply quote (type 19) */}
        {message.type === 19 && message.referenced_message && (
          <Box
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              const targetId = message.referenced_message?.id;
              if (targetId) dispatch(navigateToMessage({ messageId: targetId }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                const targetId = message.referenced_message?.id;
                if (targetId) dispatch(navigateToMessage({ messageId: targetId }));
              }
            }}
            aria-label={t('feed.jumpToReplied')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mb: 0.5,
              pl: 1,
              borderLeft: '2px solid',
              borderColor: 'text.disabled',
              opacity: 0.75,
              cursor: 'pointer',
              borderRadius: 0.5,
              '&:hover': { opacity: 1, backgroundColor: alpha(theme.palette.primary.main, 0.08) },
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
            }}
          >
            <ReplyIcon sx={{ fontSize: 12, transform: 'scaleX(-1)' }} />
            <Typography
              variant="caption"
              fontWeight={600}
              noWrap
              sx={{
                color: message.referenced_message.author?.id
                  ? getUserRoleColor(
                      message.referenced_message.author.id,
                      guildId,
                      cachedUserMap,
                      guildRoles,
                    ) || undefined
                  : undefined,
              }}
            >
              {message.referenced_message.author?.global_name ||
                message.referenced_message.author?.username ||
                t('feed.unknownUser')}
            </Typography>
            <Typography
              variant="caption"
              color="text.disabled"
              noWrap
              sx={{
                flex: 1,
                minWidth: 0,
                '& .custom-emoji': { height: 14, verticalAlign: 'middle' },
              }}
              dangerouslySetInnerHTML={{
                __html: formatMessageContentLight(
                  getMessageContent(message.referenced_message) || '(attachment)',
                  formattingContext,
                  120,
                ),
              }}
            />
          </Box>
        )}
        {message.type === 19 &&
          message.message_reference &&
          !message.referenced_message && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                mb: 0.5,
                pl: 1,
                borderLeft: '2px solid',
                borderColor: 'text.disabled',
                opacity: 0.5,
              }}
            >
              <ReplyIcon sx={{ fontSize: 12, transform: 'scaleX(-1)' }} />
              <Typography variant="caption" color="text.disabled" fontStyle="italic">
                {t('feed.originalDeleted')}
              </Typography>
            </Box>
          )}

        {/* Content body */}
        {contentHtml && !contentIsBareEmbedUrl ? (
          <Box sx={{ position: 'relative' }}>
            <Box
              onClick={handleContentClick}
              sx={{
                fontSize: '0.9rem',
                lineHeight: 1.5,
                color: 'text.primary',
                wordBreak: 'break-word',
                maxHeight: expanded ? 'none' : `${COLLAPSED_MAX_HEIGHT}px`,
                overflow: expanded ? 'visible' : 'hidden',
                ...mentionStyles,
              }}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
            {!expanded && overflowing && (
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 40,
                  pointerEvents: 'none',
                  background: isDark
                    ? 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(30,30,40,0.95))'
                    : 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.95))',
                }}
              />
            )}
            {overflowing && (
              <Link
                component="button"
                onClick={() => setExpanded((e) => !e)}
                sx={{
                  display: 'inline-block',
                  mt: 0.25,
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {expanded ? t('feed.showLess') : t('feed.showMore')}
              </Link>
            )}
          </Box>
        ) : !hasAnyBody ? (
          <Typography
            variant="body2"
            color="text.disabled"
            fontStyle="italic"
            sx={{ fontSize: '0.85rem' }}
          >
            {t('feed.noContent')}
          </Typography>
        ) : null}

        {/* Forwarded message (#197). The forwarding message itself
            typically has empty content; the payload sits on
            message_snapshots[0].message. Discord strips the original
            author for privacy, so there's no "@author" attribution to
            render. */}
        {Array.isArray((message as any).message_snapshots) &&
          (message as any).message_snapshots.length > 0 &&
          (() => {
            const snapshot = (message as any).message_snapshots[0]?.message;
            if (!snapshot) return null;
            const snapHtml = snapshot.content
              ? formatContentAsHtml(snapshot.content, formattingContext)
              : '';
            return (
              <Box
                sx={{
                  mt: 1,
                  pl: 1.5,
                  py: 0.75,
                  borderLeft: '3px solid',
                  borderColor: 'text.disabled',
                  backgroundColor: 'action.hover',
                  borderRadius: '0 4px 4px 0',
                }}
                data-message-snapshot="true"
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <ReplyIcon sx={{ fontSize: 12, transform: 'scaleX(-1)' }} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}
                  >
                    Forwarded
                  </Typography>
                </Box>
                {snapHtml ? (
                  <Box
                    sx={{
                      fontSize: '0.9rem',
                      lineHeight: 1.5,
                      color: 'text.primary',
                      wordBreak: 'break-word',
                      ...mentionStyles,
                    }}
                    dangerouslySetInnerHTML={{ __html: snapHtml }}
                  />
                ) : null}
                {Array.isArray(snapshot.attachments) && snapshot.attachments.length > 0 && (
                  <Box sx={{ mt: 0.5 }}>
                    {snapshot.attachments.map((att: any) => (
                      <Typography
                        key={att.id || att.url}
                        component="a"
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="body2"
                        sx={{
                          display: 'block',
                          color: 'primary.main',
                          textDecoration: 'none',
                          fontSize: '0.85rem',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {att.filename || 'attachment'}
                      </Typography>
                    ))}
                  </Box>
                )}
                {/* #219 sweep: HTML exports render forwarded embeds (#214);
                    the feed's forward box previously dropped them, so a
                    forwarded GIF or image link showed nothing visual. */}
                {Array.isArray(snapshot.embeds) && snapshot.embeds.length > 0 && (
                  <InlineEmbeds embeds={snapshot.embeds} formattingContext={formattingContext} />
                )}
              </Box>
            );
          })()}

        {/* Inline attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <InlineAttachments
            attachments={message.attachments}
            onOpenGallery={() => onOpenAttachments(message)}
          />
        )}

        {/* Inline embeds */}
        {message.embeds && message.embeds.length > 0 && (
          <InlineEmbeds embeds={message.embeds} formattingContext={formattingContext} />
        )}

        {/* Inline stickers (#213) */}
        {hasSticker && <InlineSticker stickers={message.sticker_items} />}

        {/* Inline poll (#213) */}
        {hasPoll && <InlinePoll poll={poll} />}

        {/* Inline reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <InlineReactions
            reactions={message.reactions}
            onReactionClick={() => onOpenReactions(message)}
          />
        )}
      </Box>

      {/* Hover-only per-message timestamp in the left gutter (Discord
          style). First message in a chunk shows the full date+time in the
          chunk header next to the author; subsequent messages reveal just
          the clock time on hover in the avatar column.
          `whiteSpace: nowrap` keeps "h:mm a" on a single line — the 40px
          avatar column isn't wide enough for "10:57 PM" at this font size,
          so we let it overflow slightly leftward into the chunk padding
          rather than wrap. */}
      {!isFirstInChunk && shortTimestamp && (
        <Typography
          className="feed-row-gutter-time"
          sx={{
            position: 'absolute',
            left: '-56px',
            top: 5,
            width: 48,
            textAlign: 'right',
            fontSize: '0.65rem',
            color: 'text.disabled',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none',
            opacity: 0,
            transition: 'opacity 120ms ease',
          }}
        >
          {shortTimestamp}
        </Typography>
      )}

      {/* Floating action bar at top-right. Visible when the row is selected
          (so the tick is always legible) and on hover (to let users quick-
          select without clicking the row body). Covers the timestamp while
          visible — the bar's content is more valuable. */}
      <Box
        className="feed-row-hover-actions"
        sx={{
          position: 'absolute',
          top: 2,
          right: 8,
          opacity: selected ? 1 : 0,
          transition: 'opacity 120ms ease',
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          boxShadow: 1,
          px: 0.5,
          py: 0.25,
        }}
      >
        <Checkbox
          size="small"
          checked={selected}
          onChange={() => onToggleSelect(message)}
          onClick={(e) => e.stopPropagation()}
          // #220: a drag-select starts here — on the checkbox, never on
          // message text, so native text selection stays intact.
          // preventDefault stops the browser starting a text-drag; the
          // subsequent click still fires so plain toggling is unaffected.
          onMouseDown={(e) => {
            e.preventDefault();
            onSelectDragStart?.(message);
          }}
          inputProps={{
            'aria-label': t('feed.selectMessage', { id: message.id }),
          }}
          sx={{ p: 0.25 }}
        />
        <Tooltip
          title={copied ? t('feed.copied') : t('feed.copyText')}
          placement="top"
          arrow
        >
          <span>
            <IconButton
              size="small"
              disabled={!rawContent}
              onClick={handleCopy}
              aria-label={t('feed.copyMessageText')}
              sx={{ p: 0.5 }}
            >
              <CopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
});

export default MessageFeedRow;
