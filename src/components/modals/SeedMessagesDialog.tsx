import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import { ChannelType } from 'discrub-core/discord-enum';
import type { Channel } from 'discrub-core/types/discord-types';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectChannels } from '@features/channel/channelSlice';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { selectDeleteDelay } from '@features/app/appSlice';
import { seedChannelMessages, selectIsSeeding } from '@features/dev/devSlice';
import type { SeedVarietyOptions } from '@features/dev/devTypes';

interface SeedMessagesDialogProps {
  open: boolean;
  onClose: () => void;
}

const HARD_CAP = 100;

const TEXT_CHANNEL_TYPES = new Set<number>([
  ChannelType.GUILD_TEXT,
  ChannelType.GUILD_ANNOUNCEMENT,
]);

const DEFAULT_OPTIONS: SeedVarietyOptions = {
  includeMentions: true,
  includeReactions: true,
  includeReplies: true,
  includeForwards: true,
  includeEdits: true,
  includePins: true,
};

const VARIETY_LABELS: Array<{ key: keyof SeedVarietyOptions; label: string; hint: string }> = [
  { key: 'includeMentions', label: 'Self-mentions', hint: '~15% of messages' },
  { key: 'includeReactions', label: 'Self-reactions', hint: '~30% of messages, +1 API call each' },
  { key: 'includeReplies', label: 'Replies to earlier seeded messages', hint: '~20% of messages' },
  { key: 'includeForwards', label: 'Forwards of earlier seeded messages', hint: '~15% of messages' },
  { key: 'includeEdits', label: 'Edits after post', hint: '~15% of messages, +1 API call each' },
  { key: 'includePins', label: 'Pins', hint: '~5% of messages, +1 API call each' },
];

/**
 * Multi-channel seed dialog (#153). Visible only when devTools is on
 * AND the user owns the active server. Posts test messages with
 * configurable variety, paced by DELETE_DELAY.
 */
const SeedMessagesDialog = ({ open, onClose }: SeedMessagesDialogProps) => {
  const dispatch = useAppDispatch();
  const guild = useAppSelector(selectSelectedGuild);
  const channels = useAppSelector(selectChannels);
  const deleteDelay = useAppSelector(selectDeleteDelay);
  const isSeeding = useAppSelector(selectIsSeeding);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(25);
  const [options, setOptions] = useState<SeedVarietyOptions>(DEFAULT_OPTIONS);

  // Filter to text-capable channels in the current guild. Forums and
  // categories aren't valid POST targets; threads aren't surfaced
  // here (the user can pick the parent and posts land in that
  // channel — threads are a separate concern).
  const textChannels = useMemo(
    () =>
      channels.filter(
        (c: Channel) => TEXT_CHANNEL_TYPES.has(c.type as number) && !!c.name,
      ),
    [channels],
  );

  const enabledOptionCount = (
    Object.keys(options) as Array<keyof SeedVarietyOptions>
  ).filter((k) => options[k]).length;

  const totalMessages = selectedIds.size * count;
  // Rough overhead: each enabled option that adds an API call (reactions,
  // edits, pins) contributes a probability-weighted extra delay per message.
  // Mentions/replies don't add calls (mentions are inline content,
  // replies are part of the POST). Round to whole seconds for display.
  const extraDelayPerMessage =
    (options.includeReactions ? 0.3 : 0) +
    (options.includeEdits ? 0.15 : 0) +
    (options.includePins ? 0.05 : 0);
  const estimatedSeconds = Math.round(
    totalMessages * (deleteDelay * (1 + extraDelayPerMessage)),
  );

  const formatEta = (s: number): string => {
    if (s < 60) return `~${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem === 0 ? `~${m}m` : `~${m}m ${rem}s`;
  };

  const toggleChannel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(textChannels.map((c) => c.id)));
  const clearAll = () => setSelectedIds(new Set());

  const handleStart = () => {
    const targets = textChannels
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name ?? c.id }));
    if (targets.length === 0) return;
    dispatch(
      seedChannelMessages({
        channels: targets,
        countPerChannel: count,
        options,
      }),
    );
    onClose();
  };

  const startDisabled = selectedIds.size === 0 || isSeeding;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 5 }}>
        Seed test messages
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent sx={{ overflow: 'auto' }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          Developer tool. Posts test messages in the selected channels using
          your account. Available only in servers you own.
        </Alert>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Server: <strong>{guild?.name ?? '(none)'}</strong>
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
          Select channels
        </Typography>
        <Box
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: 220,
            overflow: 'auto',
            mb: 1,
          }}
        >
          {textChannels.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              No text channels in this server.
            </Typography>
          ) : (
            <List dense disablePadding>
              {textChannels.map((c) => (
                <ListItem key={c.id} disablePadding>
                  <ListItemButton
                    role="button"
                    onClick={() => toggleChannel(c.id)}
                    data-testid={`seed-channel-${c.id}`}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Checkbox
                        edge="start"
                        checked={selectedIds.has(c.id)}
                        tabIndex={-1}
                        disableRipple
                        size="small"
                      />
                    </ListItemIcon>
                    <ListItemText primary={`#${c.name}`} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button size="small" onClick={selectAll}>Select all</Button>
          <Button size="small" onClick={clearAll}>Clear</Button>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Message variety
        </Typography>
        <Stack spacing={0}>
          {VARIETY_LABELS.map(({ key, label, hint }) => (
            <FormControlLabel
              key={key}
              control={
                <Checkbox
                  size="small"
                  checked={options[key]}
                  onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {hint}
                  </Typography>
                </Box>
              }
            />
          ))}
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Messages per channel: <strong>{count}</strong>
        </Typography>
        <Slider
          value={count}
          onChange={(_, v) => setCount(typeof v === 'number' ? v : v[0])}
          min={1}
          max={HARD_CAP}
          step={1}
          marks={[
            { value: 1, label: '1' },
            { value: 25, label: '25' },
            { value: 50, label: '50' },
            { value: 100, label: '100' },
          ]}
          aria-label="Messages per channel"
        />

        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color={totalMessages > 200 ? 'warning.main' : 'text.secondary'}>
            {selectedIds.size} {selectedIds.size === 1 ? 'channel' : 'channels'} × {count} =
            {' '}
            <strong>{totalMessages.toLocaleString()}</strong> messages.
            {' '}
            Estimated {formatEta(estimatedSeconds)} at DELETE_DELAY = {deleteDelay}s.
            {enabledOptionCount > 0 && ` (${enabledOptionCount} variety options on.)`}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={isSeeding}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleStart}
          disabled={startDisabled}
          data-testid="seed-start"
        >
          Start seeding
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SeedMessagesDialog;
