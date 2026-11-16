import { useMemo, useState } from 'react';
import { Box, Collapse, Typography, useTheme } from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import type { Channel, Guild } from 'discrub-core/types/discord-types';
import { useTranslation } from 'react-i18next';

interface SelectedChannelsPillProps {
  channels?: Channel[];
  /** #255 — selected servers, used when mode is 'servers'. */
  guilds?: Guild[];
  /**
   * 'channels' = guild text channels (#name prefix)
   * 'dms'      = DMs (recipient usernames, no prefix)
   * 'servers'  = whole servers (#255 multi-server purge)
   */
  mode: 'channels' | 'dms' | 'servers';
  /** The entries are threads of one channel, or a forum's posts: counted and named as such, with no # mark. */
  threads?: boolean | 'post';
  /** How many the run covers when the list holds only the ones loaded so far. */
  totalCount?: number;
}

/**
 * Compact selected-channels summary used at the top of bulk dialogs
 * (BulkPurgeDialog, BulkExportDialog). Shows count + first 3 names
 * inline; click to expand the full list. Keeps destructive / heavy
 * operations above the fold on standard viewports.
 */
const SelectedChannelsPill = ({ channels = [], guilds = [], mode, threads = false, totalCount }: SelectedChannelsPillProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const isDmMode = mode === 'dms';
  const isServerMode = mode === 'servers';
  const pillContext = isServerMode ? 'server' : isDmMode ? 'dm' : threads === 'post' ? 'post' : threads ? 'thread' : 'channel';

  const getChannelName = (channel: Channel) => {
    if (isDmMode) {
      return channel.recipients?.map((r) => r.username).join(', ') || t('common.directMessage');
    }
    return channel.name || `channel-${channel.id}`;
  };

  const getChannelLabel = (channel: Channel) =>
    isDmMode || threads ? getChannelName(channel) : `# ${getChannelName(channel)}`;

  // Servers and channels share one label list so the rest of the pill
  // (count, summary, expanded list) needs no mode branches.
  const labels = isServerMode
    ? guilds.map((g) => g.name || `server-${g.id}`)
    : channels.map(getChannelLabel);
  const count = Math.max(totalCount ?? 0, labels.length);

  const summary = useMemo(() => {
    const names = labels;
    const visible = names.slice(0, 3);
    const remaining = Math.max(totalCount ?? 0, names.length) - visible.length;
    const joined = visible.join(', ');
    return remaining > 0 ? t('pill.more', { names: joined, count: remaining }) : joined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, guilds, isDmMode, isServerMode, threads, totalCount, t]);

  return (
    <Box>
      <Box
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        aria-label={isServerMode ? t('pill.selectedServers') : isDmMode ? t('pill.selectedConversations') : threads === 'post' ? t('pill.selectedPosts') : threads ? t('pill.selectedThreads') : t('pill.selectedChannels')}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderRadius: 1,
          border: `1px solid ${theme.palette.divider}`,
          backgroundColor: 'action.hover',
          cursor: 'pointer',
          '&:hover': { backgroundColor: 'action.selected' },
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
          {t('pill.count', { count, context: pillContext })}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary}
        </Typography>
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            color: 'text.secondary',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease',
          }}
        />
      </Box>
      <Collapse in={expanded}>
        <Box
          sx={{
            mt: 0.5,
            maxHeight: 140,
            overflow: 'auto',
            borderRadius: 1,
            border: `1px solid ${theme.palette.divider}`,
            p: 1,
          }}
        >
          {labels.map((label, index) => (
            <Typography
              key={`${index}-${label}`}
              variant="body2"
              sx={{
                py: 0.25,
                px: 1,
                borderRadius: 0.5,
                backgroundColor: index % 2 === 0 ? 'transparent' : 'action.hover',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

export default SelectedChannelsPill;
