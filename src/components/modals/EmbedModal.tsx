import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Card,
  CardContent,
  Link,
  useTheme,
} from '@mui/material';
import type { Message } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { formatEmbedContent } from '@/utils/messageLightFormatting';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useTranslation } from 'react-i18next';

interface EmbedModalProps {
  open: boolean;
  onClose: () => void;
  message: Message | null;
  formattingContext?: HtmlFormattingContext;
}

/**
 * EmbedModal - displays message embeds with Discord markdown and mention formatting
 */
const EmbedModal = ({ open, onClose, message, formattingContext }: EmbedModalProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  if (!message || !message.embeds || message.embeds.length === 0) {
    return null;
  }

  const defaultContext: HtmlFormattingContext = { userMap: {} };
  const ctx = formattingContext || defaultContext;

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
    '& .everyone-mention': {
      background: isDark ? 'rgba(250, 166, 26, 0.3)' : 'rgba(250, 166, 26, 0.15)',
      color: isDark ? '#faa61a' : '#b47615',
      padding: '0 2px',
      borderRadius: '3px',
      fontWeight: 600,
    },
    '& .timestamp-mention': {
      background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      padding: '0 2px',
      borderRadius: '3px',
    },
    '& .subtext': {
      display: 'block',
      fontSize: '0.8em',
      color: theme.palette.text.secondary,
    },
    '& .custom-emoji': {
      width: 20,
      height: 20,
      verticalAlign: 'middle',
      margin: '0 1px',
    },
    '& a': {
      color: '#00aff4',
      textDecoration: 'none',
      '&:hover': { textDecoration: 'underline' },
    },
    '& code': {
      background: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.06)',
      padding: '1px 4px',
      borderRadius: '3px',
      fontSize: '0.85em',
      fontFamily: 'monospace',
    },
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          animation: 'fade-in-scale 300ms ease',
        },
      }}
    >
      <DialogTitle sx={{ pr: 5 }}>
        {t('embedModal.title', { count: message.embeds.length })}
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {message.embeds.map((embed, index) => (
            <Card
              key={index}
              variant="outlined"
              sx={{
                borderLeft: embed.color
                  ? `4px solid #${embed.color.toString(16).padStart(6, '0')}`
                  : '4px solid',
                borderLeftColor: embed.color ? undefined : 'divider',
              }}
            >
              <CardContent>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                {embed.author?.name && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {embed.author.name}
                  </Typography>
                )}
                {embed.title && (
                  <Typography variant="h6" gutterBottom>
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
                    paragraph
                    component="div"
                    sx={{ ...mentionStyles, lineHeight: 1.6 }}
                    dangerouslySetInnerHTML={{
                      __html: formatEmbedContent(embed.description, ctx),
                    }}
                  />
                )}
                {embed.fields && embed.fields.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    {embed.fields.map((field, fieldIndex) => (
                      <Box key={fieldIndex} sx={{ mb: 1 }}>
                        <Typography variant="subtitle2">{field.name}</Typography>
                        <Typography
                          variant="body2"
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
                  {embed.thumbnail?.url && embed.image?.url && (
                    <Box
                      component="img"
                      src={embed.thumbnail.proxy_url || embed.thumbnail.url}
                      alt="Embed thumbnail"
                      sx={{
                        width: 80,
                        height: 80,
                        borderRadius: 1,
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
                {embed.image?.url && (
                  <Box sx={{ mt: 1.5 }}>
                    <Box
                      component="img"
                      src={embed.image.proxy_url || embed.image.url}
                      alt="Embed image"
                      sx={{
                        maxWidth: '100%',
                        maxHeight: 400,
                        borderRadius: 1,
                        display: 'block',
                      }}
                    />
                  </Box>
                )}
                {embed.thumbnail?.url && !embed.image?.url && !embed.video?.url && (
                  <Box sx={{ mt: 1.5 }}>
                    <Box
                      component="img"
                      src={embed.thumbnail.proxy_url || embed.thumbnail.url}
                      alt="Embed thumbnail"
                      sx={{
                        maxWidth: '100%',
                        maxHeight: 300,
                        borderRadius: 1,
                        display: 'block',
                      }}
                    />
                  </Box>
                )}
                {embed.video?.url && (
                  <Box sx={{ mt: 1.5 }}>
                    {embed.video.url.includes('.mp4') || embed.video.url.includes('.webm') ? (
                      <Box
                        component="video"
                        controls
                        src={embed.video.proxy_url || embed.video.url}
                        sx={{
                          maxWidth: '100%',
                          maxHeight: 400,
                          borderRadius: 1,
                          display: 'block',
                        }}
                      />
                    ) : (
                      <Link
                        href={embed.url || embed.video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ display: 'block', mt: 0.5 }}
                      >
                        {t('embedModal.viewVideo')}
                      </Link>
                    )}
                  </Box>
                )}
                {embed.provider?.name && (
                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
                    {embed.provider.name}
                  </Typography>
                )}
                {embed.footer && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {embed.footer.text}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
};

export default EmbedModal;
