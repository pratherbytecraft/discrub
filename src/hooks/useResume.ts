import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { selectActiveCid } from '@features/message/messageSlice';
import {
  selectConversationAction,
  selectUnfinishedBulk,
  type UnfinishedAction,
  type UnfinishedBulk,
} from '@features/workspace/workspaceSlice';
import type { ActionKind, BulkKind, BulkMode } from '@features/workspace/workspaceTypes';

/**
 * The open workspace's unfinished bulk run when it belongs to this dialog
 * (2.2.5 WP4b): same action, same list, and for channels the same server.
 */
export function useBulkResume(kind: BulkKind, mode: BulkMode, guildId: string | null | undefined): UnfinishedBulk | null {
  const bulk = useAppSelector(selectUnfinishedBulk);
  if (!bulk || bulk.kind !== kind || bulk.mode !== mode) return null;
  if (mode === 'channels' && bulk.guildId !== (guildId ?? null)) return null;
  return bulk;
}

/** The open conversation's unfinished action of this kind, if any. */
export function useConversationResume(kind: ActionKind): UnfinishedAction | null {
  const cid = useAppSelector(selectActiveCid);
  const action = useAppSelector(selectConversationAction(cid));
  return action?.kind === kind ? action : null;
}

/**
 * The labels of the buttons that open Export, Purge and the bulk Export in
 * the open server or the DM list: Resume while a matching run is recorded
 * and nothing runs. A run records itself when it starts, so without the
 * running check its own button read Resume while it ran.
 */
export function useResumeLabels(listMode?: 'channels' | 'dms') {
  const { t } = useTranslation();
  const guildId = useAppSelector(selectSelectedGuild)?.id ?? null;
  // A list knows what it shows; the toolbars go by whether a server is open.
  const mode: BulkMode = listMode ?? (guildId ? 'channels' : 'dms');
  const exportResume = useConversationResume('export');
  const purgeResume = useBulkResume('bulkPurge', mode, guildId);
  const bulkExportResume = useBulkResume('bulkExport', mode, guildId);
  const editResume = useBulkResume('bulkEdit', mode, guildId);
  const running = useAppSelector(selectIsHeavyOperationRunning);
  const resume = t('workspace.resume');
  return {
    exportResumable: !running && exportResume !== null,
    purgeResumable: !running && purgeResume !== null,
    bulkExportResumable: !running && bulkExportResume !== null,
    editResumable: !running && editResume !== null,
    exportLabel: !running && exportResume ? resume : t('serverView.export'),
    purgeLabel: !running && purgeResume ? resume : t('native.purge'),
    bulkExportLabel: !running && bulkExportResume ? resume : t('serverView.export'),
    editLabel: !running && editResume ? resume : t('nav.edit'),
  };
}
