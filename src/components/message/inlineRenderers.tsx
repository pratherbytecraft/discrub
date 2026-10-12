import { formatFixed } from '@/utils/numberFormat';
import { t as translate } from '@/i18n';
import { memo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import {
  InsertDriveFile as FileIcon,
  Download as DownloadIcon,
  PlayArrow as PlayIcon,
  VolumeUp as AudioIcon,
  EmojiEmotions as StickerIcon,
  BarChart as PollIcon,
} from '@mui/icons-material';
import type { Message, Attachment, Embed, StickerItemObject, PollObject } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { EmbedType } from 'discrub-core/discord-enum';
import { isBareMediaEmbed } from 'discrub-core/html-formatting-utils';
import { formatEmbedContent } from '@/utils/messageLightFormatting';
import { reserveMediaBox } from '@/utils/reserveMediaBox';

const isImageAttachment = (a: Attachment): boolean => {
  const ct = (a.content_type || '').toLowerCase();
  const ext = (a.filename || '').split('.').pop()?.toLowerCase() || '';
  return (
    ct.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)
  );
};

const isVideoAttachment = (a: Attachment): boolean => {
  const ct = (a.content_type || '').toLowerCase();
  const ext = (a.filename || '').split('.').pop()?.toLowerCase() || '';
  return (
    ct.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)
  );
};

const isAudioAttachment = (a: Attachment): boolean => {
  const ct = (a.content_type || '').toLowerCase();
  const ext = (a.filename || '').split('.').pop()?.toLowerCase() || '';
  return (
    ct.startsWith('audio/') || ['mp3', 'ogg', 'wav', 'm4a', 'flac'].includes(ext)
  );
};

const formatFileSize = (bytes: number | undefined): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatFixed(bytes / 1024, 1)} KB`;
  return `${formatFixed(bytes / (1024 * 1024), 1)} MB`;
};

/* ───────────────────────── Inline attachments ───────────────────────── */

interface InlineAttachmentsProps {
  attachments: Attachment[];
  onOpenGallery?: () => void;
}

export const InlineAttachments = memo(function InlineAttachments({
  attachments,
  onOpenGallery,
}: InlineAttachmentsProps) {
  // Row 124: a stored row can hold something other than a list here.
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  return (
    <Stack spacing={0.75} sx={{ mt: 0.75 }}>
      {attachments.map((a) => {
        if (isImageAttachment(a)) {
          return (
            <Box
              key={a.id}
              role={onOpenGallery ? 'button' : undefined}
              tabIndex={onOpenGallery ? 0 : undefined}
              aria-label={onOpenGallery ? translate('messageActions.viewAttachments') : undefined}
              onClick={onOpenGallery}
              onKeyDown={(e) => {
                if (onOpenGallery && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onOpenGallery();
                }
              }}
              sx={{
                display: 'inline-block',
                cursor: onOpenGallery ? 'pointer' : 'default',
                borderRadius: 1,
                transition: 'opacity 150ms ease',
                '&:hover': onOpenGallery ? { opacity: 0.85 } : undefined,
              }}
            >
              <Box
                component="img"
                src={a.proxy_url || a.url}
                alt={a.filename}
                sx={{
                  ...reserveMediaBox(a, 300, 400),
                  borderRadius: 1,
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </Box>
          );
        }

        if (isVideoAttachment(a)) {
          return (
            <Box
              key={a.id}
              component="video"
              controls
              src={a.proxy_url || a.url}
              sx={{
                ...reserveMediaBox(a, 300, 400),
                borderRadius: 1,
                display: 'block',
              }}
            />
          );
        }

        if (isAudioAttachment(a)) {
          return (
            <Box
              key={a.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                maxWidth: 400,
              }}
            >
              <AudioIcon fontSize="small" color="action" />
              <Box component="audio" controls src={a.proxy_url || a.url} sx={{ flex: 1 }} />
            </Box>
          );
        }

        return (
          <Chip
            key={a.id}
            icon={<FileIcon />}
            label={
              <Box sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'baseline' }}>
                <Typography variant="body2" component="span">
                  {a.filename}
                </Typography>
                {a.size ? (
                  <Typography variant="caption" color="text.secondary" component="span">
                    · {formatFileSize(a.size)}
                  </Typography>
                ) : null}
              </Box>
            }
            component="a"
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            clickable
            deleteIcon={<DownloadIcon />}
            onDelete={() => {
              window.open(a.url, '_blank', 'noopener,noreferrer');
            }}
            sx={{
              maxWidth: 'max-content',
              bgcolor: 'action.hover',
              '& .MuiChip-label': { display: 'inline-flex' },
            }}
          />
        );
      })}
    </Stack>
  );
});

/* ───────────────────────── Inline embeds ───────────────────────── */

const isDirectlyPlayable = (url: string): boolean =>
  url.includes('.mp4') || url.includes('.webm');

// #219: single source of truth for "this embed renders as bare inline media"
// lives in discrub-core next to renderEmbedAsHtml, so the feed and the HTML
// export can never disagree about which embeds are cards.
export { isBareMediaEmbed };

/**
 * #219: bare image/gifv embed → the media IS the message. Renders at the
 * same size caps as inline attachments, with no Card wrapper, color stripe,
 * or padding. GIFV plays like a GIF (muted autoplay loop); a non-playable
 * gifv video URL falls back to the thumbnail, which GIF services serve as an
 * actual .gif.
 */
const BareMediaEmbed = ({ embed }: { embed: Embed }) => {
  const video = embed.video;
  if (
    embed.type === EmbedType.GIFV &&
    video?.url &&
    isDirectlyPlayable(video.url)
  ) {
    return (
      <Box
        component="video"
        autoPlay
        loop
        muted
        playsInline
        poster={embed.thumbnail?.proxy_url || embed.thumbnail?.url}
        src={video.proxy_url || video.url}
        sx={{
          ...reserveMediaBox(video, 300, 400),
          borderRadius: 0.5,
          display: 'block',
        }}
      />
    );
  }
  const thumb = embed.thumbnail;
  if (!thumb?.url) return null;
  const img = (
    <Box
      component="img"
      src={thumb.proxy_url || thumb.url}
      alt=""
      sx={{
        ...reserveMediaBox(thumb, 300, 400),
        borderRadius: 0.5,
        display: 'block',
      }}
    />
  );
  return embed.url ? (
    <Link href={embed.url} target="_blank" rel="noopener noreferrer" sx={{ display: 'block', width: 'fit-content' }}>
      {img}
    </Link>
  ) : (
    img
  );
};

interface InlineEmbedsProps {
  embeds: Embed[];
  formattingContext?: HtmlFormattingContext;
}

export const InlineEmbeds = memo(function InlineEmbeds({
  embeds,
  formattingContext,
}: InlineEmbedsProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  if (!embeds?.length) return null;

  const ctx = formattingContext ?? ({ userMap: {} } as HtmlFormattingContext);

  const mentionStyles = {
    '& .user-mention': {
      background: isDark ? 'rgba(88, 101, 242, 0.3)' : 'rgba(88, 101, 242, 0.15)',
      color: isDark ? '#c9d1ff' : theme.palette.primary.main,
      padding: '0 2px',
      borderRadius: '3px',
      fontWeight: 500,
    },
    '& .channel-mention': {
      background: isDark ? 'rgba(60, 66, 112, 0.5)' : 'rgba(60, 66, 112, 0.15)',
      color: isDark ? '#b5c7ff' : theme.palette.primary.dark,
      padding: '0 2px',
      borderRadius: '3px',
      fontWeight: 500,
    },
    '& .role-mention': {
      background: isDark ? 'rgba(88, 101, 242, 0.3)' : 'rgba(88, 101, 242, 0.15)',
      color: isDark ? '#c9d1ff' : theme.palette.primary.main,
      padding: '0 2px',
      borderRadius: '3px',
      fontWeight: 500,
    },
    '& .custom-emoji': {
      width: 18,
      height: 18,
      verticalAlign: 'middle',
      margin: '0 1px',
    },
    '& a': {
      color: isDark ? '#00b0f4' : '#0969da',
      textDecoration: 'none',
      '&:hover': { textDecoration: 'underline' },
    },
  } as const;

  return (
    <Stack spacing={0.75} sx={{ mt: 0.75 }}>
      {embeds.map((embed, index) => {
        // #219: bare image/gifv unfurls skip the card entirely.
        if (isBareMediaEmbed(embed)) {
          return <BareMediaEmbed key={index} embed={embed} />;
        }
        return (
        <Card
          key={index}
          variant="outlined"
          sx={{
            maxWidth: 520,
            borderLeft: embed.color
              ? `4px solid #${embed.color.toString(16).padStart(6, '0')}`
              : '4px solid',
            borderLeftColor: embed.color ? undefined : 'divider',
          }}
        >
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {embed.author?.name && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 0.5 }}
                  >
                    {embed.author.name}
                  </Typography>
                )}
                {embed.title && (
                  <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
                    {embed.url ? (
                      <Link href={embed.url} target="_blank" rel="noopener noreferrer">
                        {embed.title}
                      </Link>
                    ) : (
                      embed.title
                    )}
                  </Typography>
                )}
                {embed.description && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    component="div"
                    sx={{ ...mentionStyles, lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{
                      __html: formatEmbedContent(embed.description, ctx),
                    }}
                  />
                )}
                {embed.fields && embed.fields.length > 0 && (
                  <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                    {embed.fields.map((field, fieldIndex) => (
                      <Box
                        key={fieldIndex}
                        sx={{
                          gridColumn: field.inline ? 'auto' : '1 / -1',
                        }}
                      >
                        <Typography variant="caption" fontWeight={700} sx={{ display: 'block' }}>
                          {field.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                          sx={{ ...mentionStyles }}
                          dangerouslySetInnerHTML={{
                            __html: formatEmbedContent(field.value, ctx),
                          }}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
              {/* #219 sweep: card embeds always render the thumbnail as
                  Discord's corner thumb — presence of image/fields no longer
                  decides its size. Bare image embeds never reach this path. */}
              {embed.thumbnail?.url && (
                <Box
                  component="img"
                  src={embed.thumbnail.proxy_url || embed.thumbnail.url}
                  alt=""
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: 0.5,
                    objectFit: 'cover',
                    flexShrink: 0,
                  }}
                />
              )}
            </Box>
            {embed.image?.url && (
              <Box
                component="img"
                src={embed.image.proxy_url || embed.image.url}
                alt=""
                sx={{
                  ...reserveMediaBox(embed.image, 300),
                  borderRadius: 0.5,
                  display: 'block',
                  mt: 1,
                }}
              />
            )}
            {embed.video?.url && (
              isDirectlyPlayable(embed.video.url) ? (
                <Box
                  component="video"
                  controls
                  src={embed.video.proxy_url || embed.video.url}
                  sx={{
                    ...reserveMediaBox(embed.video, 300),
                    borderRadius: 0.5,
                    display: 'block',
                    mt: 1,
                  }}
                />
              ) : (
                <Link
                  href={embed.url || embed.video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 1 }}
                >
                  <PlayIcon fontSize="small" /> View video
                </Link>
              )
            )}
            {embed.footer && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 1, display: 'block' }}
              >
                {embed.footer.text}
              </Typography>
            )}
          </CardContent>
        </Card>
        );
      })}
    </Stack>
  );
});

/* ───────────────────────── Inline reactions ───────────────────────── */

interface InlineReactionsProps {
  reactions: NonNullable<Message['reactions']>;
  onReactionClick?: () => void;
}

export const InlineReactions = memo(function InlineReactions({
  reactions,
  onReactionClick,
}: InlineReactionsProps) {
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  if (!reactions?.length) return null;

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}
    >
      {reactions.map((r, i) => {
        const emoji = r.emoji;
        const key = emoji?.id ? String(emoji.id) : (emoji?.name ?? String(i));
        const meReacted = (r as { me?: boolean }).me === true;
        const failed = imgFailed[key];
        return (
          <Box
            key={key}
            role={onReactionClick ? 'button' : undefined}
            tabIndex={onReactionClick ? 0 : undefined}
            aria-label={onReactionClick ? 'View Reactions' : undefined}
            onClick={onReactionClick}
            onKeyDown={(e) => {
              if (onReactionClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onReactionClick();
              }
            }}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              backgroundColor: meReacted ? 'primary.50' : 'action.hover',
              border: meReacted ? '1px solid' : '1px solid transparent',
              borderColor: meReacted ? 'primary.main' : 'transparent',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: onReactionClick ? 'pointer' : 'default',
              transition: 'background-color 100ms ease, border-color 100ms ease',
              '&:hover': onReactionClick
                ? { backgroundColor: 'action.selected' }
                : undefined,
            }}
          >
            {emoji?.id && !failed ? (
              <Box
                component="img"
                src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=32`}
                alt={emoji.name ?? ''}
                onError={() => setImgFailed((s) => ({ ...s, [key]: true }))}
                sx={{ width: 16, height: 16, verticalAlign: 'middle' }}
              />
            ) : (
              <span>{emoji?.name ?? '?'}</span>
            )}
            <span>{r.count ?? 0}</span>
          </Box>
        );
      })}
    </Stack>
  );
});

// Discord sticker CDN. format_type: 1=PNG, 2=APNG, 3=Lottie, 4=GIF.
// Lottie is a JSON animation and can't be shown as an <img>, so it falls back
// to a labeled placeholder (#213).
const STICKER_CDN = 'https://media.discordapp.net/stickers';
const STICKER_SIZE = 160;
const LOTTIE_FORMAT = 3;

/** Renders a labeled placeholder for a sticker we can't show as an image. */
function StickerPlaceholder({ name }: { name: string }) {
  return (
    <Box
      title={name}
      sx={{
        width: STICKER_SIZE,
        height: STICKER_SIZE,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        borderRadius: 1.5,
        border: '1px dashed',
        borderColor: 'divider',
        backgroundColor: 'action.hover',
        color: 'text.secondary',
        p: 1,
      }}
    >
      <StickerIcon fontSize="large" />
      <Typography variant="caption" sx={{ textAlign: 'center', wordBreak: 'break-word' }}>
        {name}
      </Typography>
    </Box>
  );
}

export const InlineSticker = memo(function InlineSticker({
  stickers,
}: {
  stickers?: StickerItemObject[];
}) {
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  if (!stickers?.length) return null;

  return (
    <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
      {stickers.map((s) => {
        const name = s.name || 'sticker';
        // Lottie can't be <img>'d; a failed raster load also falls back.
        if (s.format_type === LOTTIE_FORMAT || imgFailed[s.id]) {
          return <StickerPlaceholder key={s.id} name={name} />;
        }
        const ext = s.format_type === 4 ? 'gif' : 'png';
        return (
          <Box
            component="img"
            key={s.id}
            src={`${STICKER_CDN}/${s.id}.${ext}`}
            alt={name}
            title={name}
            loading="lazy"
            onError={() => setImgFailed((m) => ({ ...m, [s.id]: true }))}
            sx={{
              width: STICKER_SIZE,
              height: STICKER_SIZE,
              objectFit: 'contain',
              borderRadius: 1.5,
            }}
          />
        );
      })}
    </Stack>
  );
});

// The poll shape now lives on the discrub-core Message as PollObject (#214
// review cleanup). Kept as a local alias so existing imports stay stable.
// `results` only exists on fetched/closed polls.
export type InlinePollData = PollObject;

export const InlinePoll = memo(function InlinePoll({ poll }: { poll?: InlinePollData | null }) {
  if (!poll) return null;

  const question = poll.question?.text || 'Poll';
  const answers = poll.answers ?? [];
  const counts = poll.results?.answer_counts ?? null;
  const totalVotes = counts ? counts.reduce((sum, c) => sum + (c.count || 0), 0) : 0;

  return (
    <Box
      data-testid="inline-poll"
      sx={{
        mt: 0.75,
        maxWidth: 400,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        backgroundColor: 'action.hover',
        p: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <PollIcon fontSize="small" color="action" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {question}
        </Typography>
      </Box>
      <Stack spacing={0.75}>
        {answers.map((a) => {
          const count = counts?.find((c) => c.id === a.answer_id)?.count;
          const pct = totalVotes > 0 && count != null ? Math.round((count / totalVotes) * 100) : null;
          const emoji = a.poll_media?.emoji;
          return (
            <Box key={a.answer_id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {emoji?.id ? (
                  <Box
                    component="img"
                    src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=32`}
                    alt={emoji.name ?? ''}
                    sx={{ width: 16, height: 16 }}
                  />
                ) : emoji?.name ? (
                  <span>{emoji.name}</span>
                ) : null}
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {a.poll_media?.text || ''}
                </Typography>
                {pct != null && (
                  <Typography variant="caption" color="text.secondary">
                    {pct}%
                  </Typography>
                )}
              </Box>
              {pct != null && (
                <Box
                  sx={{
                    mt: 0.25,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: 'action.selected',
                    overflow: 'hidden',
                  }}
                >
                  <Box sx={{ width: `${pct}%`, height: '100%', backgroundColor: 'primary.main' }} />
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>
      {totalVotes > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </Typography>
      )}
    </Box>
  );
});
