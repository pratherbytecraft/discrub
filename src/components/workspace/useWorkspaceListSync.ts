import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { t } from '@/i18n';
import { onWorkspaceStoreChange } from '@services/workspaceStore';
import { addStatusEntry, showToast } from '@features/status/statusSlice';
import { refreshWorkspaces, selectCurrentWid, selectStorageFigures } from '@features/workspace/workspaceSlice';
import { diskLevel } from '@features/workspace/diskBarScale';

/** Writes come in pages, a few a second during Load All; the figures follow at most this often. */
export const LIST_REFRESH_MS = 1500;

let nearlyFullWarned = false;

/** Tests reset the once per session warning. */
export function resetNearlyFullWarning(): void {
  nearlyFullWarned = false;
}

/**
 * Keeps the workspace list and the storage figures current: once when a
 * workspace opens, then after store writes, at most every 1.5 s. Mounted
 * once, by the disk bar. The first time usage passes 80 percent of the
 * browser's allowance in a session, one status line and one toast say so
 * (plan section 10).
 */
export function useWorkspaceListSync(): void {
  const dispatch = useAppDispatch();
  const wid = useAppSelector(selectCurrentWid);
  const storage = useAppSelector(selectStorageFigures);
  useEffect(() => {
    void dispatch(refreshWorkspaces());
  }, [dispatch, wid]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onWorkspaceStoreChange(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void dispatch(refreshWorkspaces());
      }, LIST_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [dispatch]);
  const level = diskLevel(storage?.usage, storage?.quota);
  useEffect(() => {
    if (level === 'normal' || nearlyFullWarned) return;
    nearlyFullWarned = true;
    dispatch(addStatusEntry({ level: 'warning', message: t('status.msg.storageNearlyFull') }));
    dispatch(showToast({ level: 'warning', message: t('workspace.nearlyFullToast') }));
  }, [dispatch, level]);
}
