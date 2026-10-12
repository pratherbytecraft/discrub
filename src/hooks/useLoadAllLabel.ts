import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectActiveCid } from '@features/message/messageSlice';
import { selectConversationAction } from '@features/workspace/workspaceSlice';
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
export function useLoadAllLabel(): string {
  const { t } = useTranslation();
  const unfinished = useLoadAllUnfinished();
  const running = useAppSelector(selectIsHeavyOperationRunning);
  return unfinished && !running ? t('loadAll.resume') : t('serverView.loadAll');
}
