import { useCallback, useMemo, useState, memo } from 'react';
import { Paper, Box, Button, Chip, Tooltip } from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Code as CodeIcon,
  DeleteSweep as ReactionRemoveIcon,
  AddReaction as ReactionAddIcon,
} from '@mui/icons-material';
import type { Emoji, Message, User } from 'discrub-core/types/discord-types';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { isSystemMessageType } from 'discrub-core/system-messages';
import type { SelectableEmoji } from '@/utils/emojiDataset';
import DeleteConfirmModal from '@components/modals/DeleteConfirmModal';
import EditMessageModal from '@components/modals/EditMessageModal';
import EmbedModal from '@components/modals/EmbedModal';
import ReactionRemovalModal from '@components/modals/ReactionRemovalModal';
import AddReactionsModal from '@components/modals/AddReactionsModal';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectActiveContainerKey, selectActiveHydrationSource, selectActiveRows, selectActiveSelectedIds } from '@features/message/messageSlice';
import { hydrateMessages, useHydratedAll } from '@features/message/messageCache';
import { RowFlag, type MessageRow } from '@features/message/messageRows';
import { perfCount } from '@/utils/perfCounters';

interface MessageActionsProps {
  /** #263: read from the store when omitted, so the parent view does not
   *  re-render its whole tree on every selection change. Tests and stories
   *  may still pass it. */
  selectedMessages?: Message[];
  onDelete: (messages: Message[]) => Promise<void>;
  onEdit: (message: Message, newContent: string) => Promise<void>;
  onBulkEdit?: (messages: Message[], newContent: string) => Promise<void>;
  formattingContext: HtmlFormattingContext;
  isOperationRunning?: boolean;
  canManageMessages?: boolean;
  currentUserId?: string;
  currentUsername?: string;
  fetchDelayMs?: number;
  isDm?: boolean;
  onBatchRemoveReactions?: (params: {
    messages: Message[];
    mode: 'all' | 'emoji' | 'user';
    emojis?: string[];
    userId?: string;
  }) => void;
  onBatchAddReactions?: (params: { messages: Message[]; emojis: SelectableEmoji[] }) => void;
  guildEmojis?: Emoji[];
  onFetchReactingUsers?: (messageId: string, emoji: string) => Promise<User[]>;
}

/**
 * MessageActions - toolbar for message operations
 */
const MessageActions = ({
  selectedMessages: selectedMessagesProp,
  onDelete,
  onEdit,
  onBulkEdit,
  formattingContext,
  isOperationRunning = false,
  canManageMessages = false,
  currentUserId,
  currentUsername,
  fetchDelayMs,
  isDm = false,
  onBatchRemoveReactions,
  onBatchAddReactions,
  guildEmojis,
  onFetchReactingUsers,
}: MessageActionsProps) => {
  perfCount('MessageActions');
  const { t } = useTranslation();
  // 2.2.5 W1: the buttons are gated from the rows of the selection (author,
  // type, reactions), so a selection of any size is ready at once. The
  // message objects are read when an action needs them, not on every
  // selection change; the single message the Edit and Embed modals show is
  // read ahead.
  const selectedIds = useAppSelector(selectActiveSelectedIds);
  const rows = useAppSelector(selectActiveRows);
  const containerKey = useAppSelector(selectActiveContainerKey);
  const hydrationSource = useAppSelector(selectActiveHydrationSource);
  const fromProp = !!selectedMessagesProp;
  const selectedCount = fromProp ? selectedMessagesProp.length : selectedIds.length;
  const singleIds = useMemo(() => (!fromProp && selectedIds.length === 1 ? selectedIds : NO_IDS), [fromProp, selectedIds]);
  const { messages: singleFromStore, loading: singleLoading } = useHydratedAll(containerKey, hydrationSource, singleIds, singleIds.length === 1);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [embedModalOpen, setEmbedModalOpen] = useState(false);
  const [reactionRemovalOpen, setReactionRemovalOpen] = useState(false);
  const [addReactionsOpen, setAddReactionsOpen] = useState(false);
  /** The objects an open modal works on, read when it opened. */
  const [hydrated, setHydrated] = useState<Message[]>(NO_MESSAGES);
  const [reading, setReading] = useState(false);

  const selectedRows = useMemo<SelectionRow[]>(() => {
    if (fromProp) return selectedMessagesProp.map(rowOfMessage);
    if (selectedIds.length === 0) return [];
    const wanted = new Set(selectedIds);
    const out: SelectionRow[] = [];
    for (const row of rows) if (wanted.has(row.id)) out.push(row);
    return out;
  }, [fromProp, selectedMessagesProp, selectedIds, rows]);

  const singleMessage = selectedCount === 1
    ? (fromProp ? selectedMessagesProp[0] : singleFromStore[0] ?? null)
    : null;
  const selectionReady = !reading && (selectedCount !== 1 || fromProp || (!singleLoading && singleMessage !== null));

  // Discord requires MANAGE_MESSAGES to delete messages authored by others,
  // and PATCH (edit) is author-only regardless of permission. Surface both
  // constraints up front so users hit a disabled control with explanation
  // instead of a 403 in the status log.
  const hasNonSelfSelection = currentUserId
    ? selectedRows.some((r) => r.authorId !== currentUserId)
    : false;
  const deleteBlockedByPermission = hasNonSelfSelection && !canManageMessages;
  // System messages (pin/join/boost notices etc.) carry no editable body —
  // Discord's PATCH endpoint only accepts your own DEFAULT/REPLY messages.
  // Now that they're selectable in the feed (#196 Phase 3), guard Edit so a
  // mixed selection doesn't offer an action that can only 403. Delete stays
  // available — removing system messages is the whole point of #196.
  const hasSystemSelection = selectedRows.some((r) => isSystemMessageType(r.type));
  const editBlocked = hasNonSelfSelection || hasSystemSelection;
  // A user without Manage Messages can only take off their own reactions.
  const canRemoveReactions = selectedRows.some((r) => r.hasReactions && (canManageMessages || (r.flags & RowFlag.MY_REACTION) !== 0));
  const deleteLockReason = isDm
    ? t('messageActions.deleteLockDm')
    : t('messageActions.deleteLockChannel');
  const editLockReason = hasSystemSelection
    ? t('messageActions.editLockSystem')
    : t('messageActions.editLockOthers');

  /** The selected objects: the prop, or a read of the cache and the workspace store. */
  const readSelected = useCallback(async (): Promise<Message[]> => {
    if (fromProp) return selectedMessagesProp;
    setReading(true);
    try {
      return await hydrateMessages(containerKey, hydrationSource, selectedIds);
    } finally {
      setReading(false);
    }
  }, [fromProp, selectedMessagesProp, containerKey, hydrationSource, selectedIds]);

  const openWithSelection = async (open: (value: boolean) => void) => {
    if (fromProp) {
      setHydrated(selectedMessagesProp);
      open(true);
      return;
    }
    setHydrated(await readSelected());
    open(true);
  };
  const closeModal = (open: (value: boolean) => void) => {
    open(false);
    setHydrated(NO_MESSAGES);
  };

  const handleDelete = async () => {
    setDeleteModalOpen(false);
    await onDelete(await readSelected());
  };

  const handleEdit = async (newContent: string) => {
    setEditModalOpen(false);
    const bulk = hydrated;
    setHydrated(NO_MESSAGES);
    if (selectedCount === 1 && singleMessage) {
      await onEdit(singleMessage, newContent);
    } else if (selectedCount > 1 && onBulkEdit) {
      await onBulkEdit(bulk, newContent);
    }
  };

  return (
    <>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Chip
            label={t('messageActions.selected', { count: selectedCount })}
            color={selectedCount > 0 ? 'primary' : 'default'}
          />

          <Tooltip title={deleteBlockedByPermission ? deleteLockReason : ''} disableHoverListener={!deleteBlockedByPermission}>
            <span>
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                disabled={selectedCount === 0 || !selectionReady || isOperationRunning || deleteBlockedByPermission}
                onClick={() => setDeleteModalOpen(true)}
              >
                {t('messageActions.delete')}
              </Button>
            </span>
          </Tooltip>

          <Tooltip title={editBlocked ? editLockReason : ''} disableHoverListener={!editBlocked}>
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditIcon />}
                disabled={selectedCount === 0 || !selectionReady || (selectedCount > 1 && isOperationRunning) || editBlocked}
                onClick={() => (selectedCount > 1 ? void openWithSelection(setEditModalOpen) : setEditModalOpen(true))}
              >
                {t('messageActions.edit')}
              </Button>
            </span>
          </Tooltip>

          {singleMessage?.embeds && singleMessage.embeds.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<CodeIcon />}
              onClick={() => setEmbedModalOpen(true)}
            >
              {t('messageActions.embeds', { count: singleMessage.embeds.length })}
            </Button>
          )}

          {onBatchAddReactions && (
            <Button
              variant="outlined"
              size="small"
              color="primary"
              startIcon={<ReactionAddIcon />}
              // Adding your own reaction only needs Add Reactions perm, which
              // Discord enforces per message — no manage-messages gate here.
              disabled={selectedCount === 0 || !selectionReady || isOperationRunning}
              onClick={() => void openWithSelection(setAddReactionsOpen)}
            >
              {t('messageActions.addReactions')}
            </Button>
          )}

          {onBatchRemoveReactions && (
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<ReactionRemoveIcon />}
              disabled={selectedCount === 0 || !selectionReady || isOperationRunning || !canRemoveReactions}
              onClick={() => void openWithSelection(setReactionRemovalOpen)}
            >
              {t('messageActions.removeReactions')}
            </Button>
          )}
        </Box>
      </Paper>

      <DeleteConfirmModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        messageCount={selectedCount}
      />

      <EditMessageModal
        open={editModalOpen}
        onClose={() => closeModal(setEditModalOpen)}
        onSave={handleEdit}
        message={singleMessage}
        messages={hydrated}
        messageCount={selectedCount}
      />

      <EmbedModal
        open={embedModalOpen}
        onClose={() => setEmbedModalOpen(false)}
        message={singleMessage}
        formattingContext={formattingContext}
      />

      {onBatchRemoveReactions && (
        <ReactionRemovalModal
          open={reactionRemovalOpen}
          onClose={() => closeModal(setReactionRemovalOpen)}
          selectedMessages={hydrated}
          canManageMessages={canManageMessages}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          fetchDelayMs={fetchDelayMs}
          onConfirm={onBatchRemoveReactions}
          onFetchReactingUsers={onFetchReactingUsers}
        />
      )}

      {onBatchAddReactions && (
        <AddReactionsModal
          open={addReactionsOpen}
          onClose={() => closeModal(setAddReactionsOpen)}
          selectedMessages={hydrated}
          guildEmojis={guildEmojis}
          onConfirm={onBatchAddReactions}
        />
      )}
    </>
  );
};

/** The row fields the buttons are gated on. */
type SelectionRow = Pick<MessageRow, 'authorId' | 'type' | 'hasReactions' | 'flags'>;

const rowOfMessage = (m: Message): SelectionRow => ({
  authorId: m.author?.id ?? '',
  type: m.type,
  hasReactions: !!m.reactions && m.reactions.length > 0,
  flags: m.reactions?.some((r) => r.me) ? RowFlag.MY_REACTION : 0,
});

const NO_IDS: string[] = [];
const NO_MESSAGES: Message[] = [];

// 2.2.1 perf: rendered again only when its own store reads or props change,
// not whenever the shell above it renders (three times per Load All page).
export default memo(MessageActions);
