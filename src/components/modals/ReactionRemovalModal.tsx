import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Avatar,
  Tooltip,
} from '@mui/material';
import {
  DeleteSweep as DeleteAllIcon,
  SelectAll as AllIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import type { Message, User } from 'discrub-core/types/discord-types';
import { getEmojiKey } from '@/utils/emojiUtils';
import DiscordEmoji from '@components/ui/DiscordEmoji';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useTranslation } from 'react-i18next';

const ALL_EMOJIS_KEY = '__all__';
const ALL_USERS_KEY = '__all__';
const EMOJI_SIZE = 32;
const EMOJI_GRID_MAX_HEIGHT = 120;
const REACTOR_UPDATE_THROTTLE = 5;

interface ReactionRemovalModalProps {
  open: boolean;
  onClose: () => void;
  selectedMessages: Message[];
  canManageMessages: boolean;
  currentUserId?: string;
  currentUsername?: string;
  fetchDelayMs?: number;
  onConfirm: (params: {
    messages: Message[];
    mode: 'all' | 'emoji' | 'user';
    emojis?: string[];
    userId?: string;
  }) => void;
  onFetchReactingUsers?: (messageId: string, emoji: string) => Promise<User[]>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ReactionRemovalModal — batch reaction removal from selected messages.
 * Emoji: multi-select (specific emojis or all).
 * Users: current user pre-selected, auto-fetches reactors on open, admin gets "All users" shortcut.
 */
const ReactionRemovalModal = ({
  open,
  onClose,
  selectedMessages,
  canManageMessages,
  currentUserId,
  currentUsername,
  fetchDelayMs = 1000,
  onConfirm,
  onFetchReactingUsers,
}: ReactionRemovalModalProps) => {
  const { t } = useTranslation();
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([ALL_EMOJIS_KEY]);
  const [selectedUser, setSelectedUser] = useState(canManageMessages ? ALL_USERS_KEY : currentUserId || '');
  const [reactorUsers, setReactorUsers] = useState<Map<string, User>>(new Map());
  const [loadingReactors, setLoadingReactors] = useState(false);
  const abortRef = useRef(false);

  // Messages with reactions
  // Only while open (2.2.2): the modal stays mounted and the selection changes on every delete flush.
  const messagesWithReactions = useMemo(
    () => (open ? selectedMessages.filter((m) => m.reactions && m.reactions.length > 0) : []),
    [open, selectedMessages],
  );

  // Collect unique emojis from selected messages (with full emoji data for rendering).
  // Non-admins only see emojis they've reacted to (reaction.me === true).
  const availableEmojis = useMemo(() => {
    const emojiMap = new Map<string, { id?: string | null; name?: string | null; animated?: boolean | null }>();
    for (const msg of messagesWithReactions) {
      for (const reaction of msg.reactions || []) {
        if (!canManageMessages && !reaction.me) continue;
        const key = getEmojiKey(reaction.emoji);
        if (!emojiMap.has(key)) {
          emojiMap.set(key, reaction.emoji);
        }
      }
    }
    return Array.from(emojiMap.entries()).map(([key, emoji]) => ({ key, emoji }));
  }, [messagesWithReactions, canManageMessages]);

  // Auto-fetch reacting users on open (with delay between API calls)
  useEffect(() => {
    if (!open || !onFetchReactingUsers || messagesWithReactions.length === 0 || !canManageMessages) return;

    abortRef.current = false;
    setLoadingReactors(true);
    setReactorUsers(new Map());

    const fetchAll = async () => {
      const users = new Map<string, User>();
      let callCount = 0;

      for (const msg of messagesWithReactions) {
        if (abortRef.current) break;
        for (const reaction of msg.reactions || []) {
          if (abortRef.current) break;
          const emojiKey = getEmojiKey(reaction.emoji);

          // Respect delay between API calls
          if (callCount > 0 && fetchDelayMs > 0) {
            await delay(fetchDelayMs);
            if (abortRef.current) break;
          }

          try {
            const reactors = await onFetchReactingUsers(msg.id, emojiKey);
            callCount++;
            for (const user of reactors) {
              if (!users.has(user.id)) {
                users.set(user.id, user);
              }
            }
            if (!abortRef.current && callCount % REACTOR_UPDATE_THROTTLE === 0) {
              setReactorUsers(new Map(users));
            }
          } catch {
            callCount++;
          }
        }
      }

      if (!abortRef.current) {
        setReactorUsers(new Map(users));
        setLoadingReactors(false);
      }
    };

    fetchAll();

    return () => {
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trigger set
  }, [open, messagesWithReactions]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSelectedEmojis([ALL_EMOJIS_KEY]);
      setSelectedUser(canManageMessages ? ALL_USERS_KEY : currentUserId || '');
      setReactorUsers(new Map());
      setLoadingReactors(false);
      abortRef.current = true;
    }
  }, [open, canManageMessages, currentUserId]);

  // Build user options: special options first, then fetched reactors
  const userOptions = useMemo(() => {
    const options: { id: string; label: string; special?: boolean; avatar?: string | null }[] = [];
    if (canManageMessages) {
      options.push({ id: ALL_USERS_KEY, label: t('reactionRemoval.allUsers'), special: true });
    }
    if (currentUserId) {
      const currentReactor = reactorUsers.get(currentUserId);
      const avatarHash = currentReactor?.avatar;
      options.push({
        id: currentUserId,
        label: currentUsername ? t('reactionRemoval.nameYou', { name: currentUsername }) : t('reactionRemoval.you'),
        special: true,
        avatar: avatarHash ? `https://cdn.discordapp.com/avatars/${currentUserId}/${avatarHash}.webp?size=32` : null,
      });
    }
    if (canManageMessages) {
      for (const [id, user] of reactorUsers) {
        if (id !== currentUserId) {
          const avatarHash = user.avatar;
          options.push({
            id,
            label: user.global_name || user.username || id,
            avatar: avatarHash ? `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.webp?size=32` : null,
          });
        }
      }
    }
    return options;
  }, [canManageMessages, currentUserId, currentUsername, reactorUsers, t]);

  const isAllEmojis = selectedEmojis.includes(ALL_EMOJIS_KEY);
  const isAllUsers = selectedUser === ALL_USERS_KEY;

  const toggleEmoji = (key: string) => {
    if (key === ALL_EMOJIS_KEY) {
      setSelectedEmojis([ALL_EMOJIS_KEY]);
      return;
    }
    setSelectedEmojis((prev) => {
      const withoutAll = prev.filter((k) => k !== ALL_EMOJIS_KEY);
      const isSelected = withoutAll.includes(key);
      const next = isSelected ? withoutAll.filter((k) => k !== key) : [...withoutAll, key];
      return next.length === 0 ? [ALL_EMOJIS_KEY] : next;
    });
  };

  const handleConfirm = () => {
    if (isAllUsers && isAllEmojis) {
      onConfirm({ messages: messagesWithReactions, mode: 'all' });
    } else if (isAllUsers && !isAllEmojis) {
      onConfirm({ messages: messagesWithReactions, mode: 'emoji', emojis: selectedEmojis });
    } else {
      onConfirm({
        messages: messagesWithReactions,
        mode: 'user',
        emojis: isAllEmojis ? undefined : selectedEmojis,
        userId: selectedUser,
      });
    }
    onClose();
  };

  // Check if the current user has actually reacted to any selected messages
  const hasRemovableReactions = useMemo(() => {
    if (messagesWithReactions.length === 0) return false;
    // Admin modes (all users) or non-self user: assume valid if messages have reactions
    if (selectedUser !== currentUserId) return true;
    // Self mode: check reaction.me flag on selected emojis
    return messagesWithReactions.some((msg) =>
      (msg.reactions || []).some((r) => {
        if (!r.me) return false;
        if (isAllEmojis) return true;
        return selectedEmojis.includes(getEmojiKey(r.emoji));
      })
    );
  }, [messagesWithReactions, selectedUser, currentUserId, isAllEmojis, selectedEmojis]);

  const isValid = hasRemovableReactions && selectedUser !== '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 5 }}>
        {t('reactionRemoval.title')}
        <DialogCloseIcon onClose={onClose} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* Emoji picker */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              {t('reactionRemoval.emojis')}
            </Typography>
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
                maxHeight: EMOJI_GRID_MAX_HEIGHT + 40,
                overflowY: 'auto',
              }}
            >
              {/* All emojis toggle */}
              <Box
                onClick={() => toggleEmoji(ALL_EMOJIS_KEY)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  mb: 0.5,
                  borderRadius: 1,
                  cursor: 'pointer',
                  backgroundColor: isAllEmojis ? 'action.selected' : 'transparent',
                  '&:hover': { backgroundColor: isAllEmojis ? 'action.selected' : 'action.hover' },
                }}
              >
                <AllIcon fontSize="small" color={isAllEmojis ? 'primary' : 'inherit'} />
                <Typography variant="body2" fontWeight={isAllEmojis ? 600 : 400}>{t('reactionRemoval.allEmojis')}</Typography>
              </Box>

              {/* Emoji grid */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
                {availableEmojis.map(({ key, emoji }) => {
                  const isSelected = !isAllEmojis && selectedEmojis.includes(key);
                  const tooltipName = emoji.id ? `:${emoji.name}:` : emoji.name || key;
                  return (
                    <Tooltip key={key} title={tooltipName} placement="top" arrow>
                      <Box
                        onClick={() => toggleEmoji(key)}
                        sx={{
                          width: EMOJI_SIZE + 8,
                          height: EMOJI_SIZE + 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 1,
                          cursor: 'pointer',
                          border: '2px solid',
                          borderColor: isSelected ? 'primary.main' : 'transparent',
                          backgroundColor: isSelected ? 'action.selected' : 'transparent',
                          '&:hover': {
                            backgroundColor: 'action.hover',
                          },
                        }}
                      >
                        <DiscordEmoji emoji={emoji} size={EMOJI_SIZE} />
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          </Box>

          {/* User selection */}
          <FormControl size="small" fullWidth>
            <InputLabel>{t('reactionRemoval.user')}</InputLabel>
            <Select
              value={selectedUser}
              label={t('reactionRemoval.user')}
              onChange={(e) => setSelectedUser(e.target.value)}
              endAdornment={loadingReactors ? (
                <CircularProgress size={18} sx={{ mr: 3 }} />
              ) : undefined}
            >
              {userOptions.map((option) => (
                <MenuItem key={option.id} value={option.id} sx={{ py: 0.5, minHeight: 36 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {option.id === ALL_USERS_KEY ? (
                      <AllIcon fontSize="small" color="primary" />
                    ) : option.special ? (
                      <Avatar src={option.avatar || undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
                        <PersonIcon sx={{ fontSize: 14 }} />
                      </Avatar>
                    ) : (
                      <Avatar src={option.avatar || undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
                        {(option.label[0] || '?').toUpperCase()}
                      </Avatar>
                    )}
                    <Typography fontWeight={option.special ? 500 : 400}>{option.label}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Summary */}
          <Typography variant="body2" color="text.secondary">
            {messagesWithReactions.length === 0
              ? t('reactionRemoval.noneWithReactions')
              : !hasRemovableReactions
                ? t('reactionRemoval.noneEligible')
                : t('reactionRemoval.willProcess', { count: messagesWithReactions.length })}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>{t('reactionRemoval.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          startIcon={<DeleteAllIcon />}
          disabled={!isValid}
          onClick={handleConfirm}
        >
          {t('reactionRemoval.remove')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReactionRemovalModal;
