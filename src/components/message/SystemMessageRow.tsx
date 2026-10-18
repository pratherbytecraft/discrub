import { memo, useCallback } from 'react';
import { Box, Checkbox, Typography, useTheme, alpha } from '@mui/material';
import { format } from 'date-fns';
import type { Message } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import { formatSystemMessage } from 'discrub-core/system-messages';
import { formatContentAsHtml, renderEmbedAsHtml } from 'discrub-core/html-formatting-utils';
import { getSystemMessageIcon } from '@/utils/systemMessageIcons';
import { getUserRoleColor } from '@/utils/roleColorUtils';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { navigateToMessage, openThreadTab } from '@features/message/messageSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { getDateLocale } from '@/i18n/dateLocale';
import { useTranslation } from 'react-i18next';

interface SystemMessageRowProps {
  message: Message;
  formattingContext: HtmlFormattingContext;
  guildName?: string;
  guildId?: string | null;
  guildRoles?: any;
  cachedUserMap?: ExportUserMap;
  /** Deep-link flash (#123). Applied when this row is the navigation
   *  target (e.g. a pinned-message notice that was just clicked). */
  highlighted?: boolean;
  /** Selection state for the feed's multi-select (#196 Phase 3). When
   *  `onToggleSelect` is provided the row renders a checkbox mirroring
   *  MessageFeedRow, so pinned/system notices can be selected and
   *  deleted from the feed just like regular messages. */
  selected?: boolean;
  onToggleSelect?: (message: Message) => void;
}

/**
 * Post-render pass that wraps well-known Discord system-message trailing
 * phrases ("See all pinned messages", "See all threads") in a styled
 * anchor so they look like the clickable links Discord renders. The
 * click handler itself is deferred to backlog #123 — for now the anchor
 * is a visual affordance only.
 */
const LINK_PHRASES = ['See all pinned messages', 'See all threads'];
const linkify = (html: string): string => {
  let out = html;
  for (const phrase of LINK_PHRASES) {
    out = out.replace(
      new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      `<a class="system-link" role="button" tabindex="0">${phrase}</a>`,
    );
  }
  return out;
};

/**
 * Compact Discord-style system-notice row ("Alice pinned a message…",
 * "Bob started a thread: Planning", boost/join/call events, etc.).
 *
 * Visual target: match Discord's rendering exactly:
 *   [icon]  author(role-colored, bold) action text (muted) timestamp(inline)
 *
 * Notes on the parity details:
 * - NOT italic (Discord uses regular weight + muted color).
 * - Timestamp is INLINE at the end of the sentence, not right-aligned.
 * - Author name picks up its role color (same computation used elsewhere).
 * - "See all pinned messages" / "See all threads" are styled as links.
 */
const SystemMessageRow = memo(function SystemMessageRow({
  message,
  formattingContext,
  guildName,
  guildId,
  guildRoles,
  cachedUserMap,
  highlighted = false,
  selected = false,
  onToggleSelect,
}: SystemMessageRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const token = useAppSelector(selectAuthToken);
  const descriptor = formatSystemMessage(message, {
    guildName: guildName ?? formattingContext.guildName,
    // Row 99 of the 2.2.5 pass: the line reads in the app language.
    translate: (key, params) => t(key, params),
  });

  // Navigation action for the "See all …" link only. Type 6 (pinned)
  // references another message in the channel; type 18 (thread-created)
  // carries a thread object we can open in a new tab. Scoped to the
  // anchor (not the whole row) so a plain row click selects the message
  // instead of jumping away (#196 Phase 3 feedback).
  const handleNoticeClick = useCallback(() => {
    if (!descriptor) return;
    if (descriptor.kind === 'pin') {
      const targetId = message.message_reference?.message_id;
      if (targetId) dispatch(navigateToMessage({ messageId: targetId }));
    } else if (descriptor.kind === 'thread') {
      const thread = (message as any).thread;
      if (thread?.id && token) {
        dispatch(openThreadTab({
          threadId: thread.id,
          threadName: thread.name || t('common.thread'),
          token,
        }));
      }
    }
  }, [descriptor, message, token, dispatch, t]);

  // Row click toggles selection (mirrors MessageFeedRow), EXCEPT when the
  // click lands on the "See all …" link — that navigates. Other
  // interactive descendants (the selection checkbox) handle their own
  // clicks and are skipped here.
  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.system-link')) {
        handleNoticeClick();
        return;
      }
      if (target.closest('a, button, input, [role="button"], [role="link"]')) return;
      onToggleSelect?.(message);
    },
    [handleNoticeClick, onToggleSelect, message],
  );

  // Keyboard activation for the focusable "See all …" link.
  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.system-link') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleNoticeClick();
      }
    },
    [handleNoticeClick],
  );

  if (!descriptor) return null;

  const Icon = getSystemMessageIcon(descriptor.kind);
  const html = linkify(formatContentAsHtml(descriptor.text, formattingContext));

  const isClickable = descriptor.kind === 'pin' || descriptor.kind === 'thread';
  // The row is interactive when it can be selected OR carries a nav link.
  const interactive = !!onToggleSelect || isClickable;

  const roleColor =
    cachedUserMap && guildRoles && message.author?.id
      ? getUserRoleColor(message.author.id, guildId ?? null, cachedUserMap, guildRoles)
      : null;

  // Discord's compact format: "8/28/24, 9:42 PM" — same on all locales in
  // the client. Match it rather than honoring user date-format settings,
  // since system messages are Discord-native and look out of place with
  // the app's regular timestamp format.
  let shortTimestamp = '';
  try {
    shortTimestamp = format(new Date(message.timestamp), 'P, p', { locale: getDateLocale() });
  } catch {
    /* ignore bad timestamps */
  }

  return (
    <Box
      data-testid="system-message-row"
      data-message-id={message.id}
      data-system-kind={descriptor.kind}
      data-highlighted={highlighted ? 'true' : undefined}
      onClick={interactive ? handleRowClick : undefined}
      onKeyDown={isClickable ? handleRowKeyDown : undefined}
      sx={{
        // Outer container mirrors MessageChunk's shell: same `px` +
        // `gap` so the icon column sits where the avatar would, and
        // the text column starts where regular-message content does.
        // Vertical padding matches the export's `.system-message` rule
        // (8px top/bottom) so both renderers feel the same.
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 1,
        minHeight: 36,
        color: 'text.secondary',
        fontSize: '0.9rem',
        lineHeight: 1.5,
        borderRadius: 0.5,
        cursor: interactive ? 'pointer' : 'default',
        ...(selected && {
          backgroundColor: alpha(theme.palette.primary.main, 0.16),
        }),
        '&:hover .system-row-hover-actions': { opacity: 1 },
        ...(interactive && {
          '&:hover': {
            backgroundColor: selected
              ? alpha(theme.palette.primary.main, 0.22)
              : alpha(theme.palette.primary.main, 0.06),
          },
        }),
        ...(highlighted && {
          animation: 'deeplink-flash-system 2s ease-out',
          '@keyframes deeplink-flash-system': {
            '0%': { backgroundColor: 'rgba(250, 166, 26, 0.45)' },
            '100%': { backgroundColor: 'transparent' },
          },
        }),
      }}
    >
      {/* Icon column — 40px wide, matches <Avatar width=40> in MessageChunk
          so the icon sits centered where a regular message's avatar sits. */}
      <Box
        sx={{
          width: 40,
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Icon
          // @ts-expect-error — MUI icon components accept `sx` at runtime
          sx={{ fontSize: 18, color: 'text.disabled' }}
        />
      </Box>

      {/* Text column — flex:1 so it fills the content region. The text
          and inline timestamp flow on a single line (or wrap, on narrow
          viewports) so the whole notice reads like Discord's. */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: 1,
        }}
      >
        <Typography
          component="span"
          data-testid="system-message-text"
          sx={{
            minWidth: 0,
            fontSize: 'inherit',
            color: 'text.secondary',
            // Author bold — first <strong> in the rendered template —
            // picks up the role color when available. Later <strong>
            // tokens (thread names, etc.) stay primary.
            '& strong:first-of-type': {
              color: roleColor || theme.palette.text.primary,
              fontWeight: 600,
            },
            '& strong': {
              fontWeight: 600,
              color: theme.palette.text.primary,
            },
            '& .system-link': {
              color: theme.palette.primary.main,
              cursor: 'pointer',
              textDecoration: 'none',
              '&:hover': {
                textDecoration: 'underline',
              },
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: theme.palette.primary.main,
                outlineOffset: 2,
                borderRadius: '2px',
              },
            },
            '& .user-mention, & .role-mention': {
              background:
                theme.palette.mode === 'dark'
                  ? 'rgba(88, 101, 242, 0.25)'
                  : 'rgba(88, 101, 242, 0.12)',
              color: theme.palette.primary.main,
              padding: '0 3px',
              borderRadius: '3px',
            },
            '& .timestamp-mention': {
              background: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
              padding: '0 3px',
              borderRadius: '3px',
            },
            '& .subtext': {
              display: 'block',
              fontSize: '0.8em',
              color: theme.palette.text.secondary,
            },
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {shortTimestamp && (
          <Typography
            component="span"
            data-testid="system-message-timestamp"
            sx={{
              flexShrink: 0,
              fontSize: '0.72rem',
              color: 'text.disabled',
              whiteSpace: 'nowrap',
            }}
          >
            {shortTimestamp}
          </Typography>
        )}
        {descriptor.showEmbed && message.embeds && message.embeds.length > 0 && (
          <Box
            data-testid="system-message-embed"
            sx={{ pt: 0.5, flexBasis: '100%' }}
            dangerouslySetInnerHTML={{
              __html: message.embeds
                .map((e) =>
                  renderEmbedAsHtml(e, {
                    includeImages: true,
                    includeVideos: true,
                    formattingContext,
                  }),
                )
                .join(''),
            }}
          />
        )}
      </Box>

      {/* Selection checkbox (#196 Phase 3) — mirrors MessageFeedRow's
          floating bar: hidden until hover or when selected. stopPropagation
          keeps a checkbox click from triggering the row's pin/thread
          navigation. Selection is ungated app-wide; the delete API enforces
          who can actually remove the message. */}
      {onToggleSelect && (
        <Box
          className="system-row-hover-actions"
          sx={{
            position: 'absolute',
            top: 2,
            right: 8,
            opacity: selected ? 1 : 0,
            transition: 'opacity 120ms ease',
            display: 'flex',
            alignItems: 'center',
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
            inputProps={{ 'aria-label': t('feed.selectSystemMessage', { id: message.id }) }}
            sx={{ p: 0.25 }}
          />
        </Box>
      )}
    </Box>
  );
});

export default SystemMessageRow;
