import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { onWorkspaceStoreChange } from '@services/workspaceStore';
import { refreshWorkspaces, selectCurrentWid } from '@features/workspace/workspaceSlice';

/** Writes come in pages, a few a second during Load All; the figures follow at most this often. */
export const LIST_REFRESH_MS = 1500;

/**
 * Keeps the workspace list and the storage figures current: once when a
 * workspace opens, then after store writes, at most every 1.5 s. Mounted
 * once, by the disk bar.
 */
export function useWorkspaceListSync(): void {
  const dispatch = useAppDispatch();
  const wid = useAppSelector(selectCurrentWid);
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
}
