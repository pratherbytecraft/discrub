import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectActiveCid, selectActivePagination, selectActiveTab, selectRestored } from '@features/message/messageSlice';
import { selectConversationAction, selectConversationSavedCount } from '@features/workspace/workspaceSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';

/** True when the open conversation (or thread tab) has an unfinished Load All recorded (2.2.5 WP4a). */
export function useLoadAllUnfinished(): boolean {
  const cid = useAppSelector(selectActiveCid);
  const action = useAppSelector(selectConversationAction(cid));
  return action?.kind === 'loadAll';
}

/**
 * The Load All button's label: Resume while an unfinished Load All is
 * recorded and nothing runs (plan section 6). The record is written as
 * soon as a run starts, so a running Load All still reads Load All.
 */
/**
 * True while Load All has something to offer (2.2.5 B): more pages, a run in
 * progress, or a plain conversation the open workspace restored or holds, where
 * the dialog's Start over fetches it again. Every layout's Load All button
 * reads this; before it the button went away or greyed with the last page.
 */
export function useLoadAllAvailable(): boolean {
  const pagination = useAppSelector(selectActivePagination);
  const activeTab = useAppSelector(selectActiveTab);
  const restored = useAppSelector(selectRestored);
  const cid = useAppSelector(selectActiveCid);
  const saved = useAppSelector(selectConversationSavedCount(cid));
  if (pagination.hasMore || pagination.isLoadingAll) return true;
  return !activeTab && pagination.mode !== 'search' && (restored !== null || saved > 0);
}

export function useLoadAllLabel(): string {
  const { t } = useTranslation();
  const unfinished = useLoadAllUnfinished();
  const running = useAppSelector(selectIsHeavyOperationRunning);
  const pagination = useAppSelector(selectActivePagination);
  const activeTab = useAppSelector(selectActiveTab);
  const restored = useAppSelector(selectRestored);
  const cid = useAppSelector(selectActiveCid);
  const saved = useAppSelector(selectConversationSavedCount(cid));
  if (unfinished && !running) return t('loadAll.resume');
  // 2.2.9: a plain conversation saved in full has nothing left to load all; the
  // button says what its dialog will do (second VM pass: nothing on screen
  // hinted that Fetch newer existed).
  const completeOnDisk = !running && !activeTab && pagination.mode !== 'search' && !pagination.hasMore && (restored !== null || saved > 0);
  if (completeOnDisk) return t('loadAll.fetchNewer');
  return t('serverView.loadAll');
}
