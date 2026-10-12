import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAuthToken, selectIsGuestMode } from '@features/auth/authSlice';
import { selectSidebarView } from '@features/app/appSlice';
import { selectCurrentWid, selectScopeRestoredWid } from '@features/workspace/workspaceSlice';
import { restoreWorkspaceScope } from '@features/workspace/workspaceThunks';

/**
 * Opens the open workspace's saved scope once per workspace (2.2.5 WP4a,
 * plan sections 5.4 and 5.5): after boot, and again after every switch,
 * since a switch clears the restored marker. Package mode and guest
 * sessions keep their own view.
 */
export function useWorkspaceScopeRestore(): void {
  const dispatch = useAppDispatch();
  const wid = useAppSelector(selectCurrentWid);
  const restoredWid = useAppSelector(selectScopeRestoredWid);
  const token = useAppSelector(selectAuthToken);
  const isGuest = useAppSelector(selectIsGuestMode);
  const sidebarView = useAppSelector(selectSidebarView);

  useEffect(() => {
    if (!wid || !token || isGuest || sidebarView !== 'server') return;
    if (restoredWid === wid) return;
    void dispatch(restoreWorkspaceScope());
  }, [wid, restoredWid, token, isGuest, sidebarView, dispatch]);
}
