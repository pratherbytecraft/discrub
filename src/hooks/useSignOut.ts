import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { clearToken, forgetRememberedToken } from '@features/auth/authSlice';
import { clearCurrentUser } from '@features/user/userSlice';
import { clearGuilds } from '@features/guild/guildSlice';
import { clearChannels } from '@features/channel/channelSlice';
import { clearDMs } from '@features/dm/dmSlice';
import { clearMessages } from '@features/message/messageSlice';
import { clearAllWorkspaces } from '@features/workspace/workspaceThunks';
import { refreshWorkspaces, selectWorkspaceList } from '@features/workspace/workspaceSlice';

export interface StoredFigures {
  workspaces: number;
  messages: number;
  bytes: number;
}

/**
 * Sign out, shared by the top bar and the profile window (row 112). Sign
 * out clears every workspace (plan decision 9), so when any holds
 * messages the user is asked first and sees what goes (ws-signout, owner
 * 2026-10-14). Nothing stored, no question.
 */
export function useSignOut() {
  const dispatch = useAppDispatch();
  const workspaces = useAppSelector(selectWorkspaceList);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const stored: StoredFigures = {
    workspaces: workspaces.length,
    messages: workspaces.reduce((sum, w) => sum + w.count, 0),
    bytes: workspaces.reduce((sum, w) => sum + w.bytes, 0),
  };

  const signOut = () => {
    setConfirmOpen(false);
    dispatch(clearToken());
    // #249: a remembered token must not outlive an explicit sign-out.
    dispatch(forgetRememberedToken());
    dispatch(clearCurrentUser());
    dispatch(clearGuilds());
    dispatch(clearChannels());
    dispatch(clearDMs());
    dispatch(clearMessages());
    // Messages never stay on disk after signing out (2.2.5 workspaces).
    void dispatch(clearAllWorkspaces());
  };

  const requestSignOut = async () => {
    // The list follows store writes with a short delay, so read it fresh
    // before deciding; a page loaded a moment ago still counts.
    const result = await dispatch(refreshWorkspaces());
    const list = refreshWorkspaces.fulfilled.match(result) ? result.payload.list : workspaces;
    if (list.some((w) => w.count > 0)) {
      setConfirmOpen(true);
      return;
    }
    signOut();
  };

  return { requestSignOut, signOut, confirmOpen, closeConfirm: () => setConfirmOpen(false), stored };
}
