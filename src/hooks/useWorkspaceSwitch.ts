import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectIsOperationRunning } from '@features/app/operationSelectors';
import { switchWorkspace } from '@features/workspace/workspaceThunks';

/**
 * What the Workspaces popover (WP5) calls to open a workspace. With nothing
 * running it switches straight away; with an action running it asks first
 * through WorkspaceSwitchDialog, fed by `dialogProps`.
 */
export function useWorkspaceSwitch() {
  const dispatch = useAppDispatch();
  const running = useAppSelector(selectIsOperationRunning);
  const [pending, setPending] = useState<string | null>(null);

  const requestSwitch = useCallback(
    (wid: string) => {
      if (running) setPending(wid);
      else void dispatch(switchWorkspace({ wid }));
    },
    [running, dispatch],
  );

  const dialogProps = {
    open: pending !== null,
    onStay: () => setPending(null),
    onSwitch: () => {
      const wid = pending;
      setPending(null);
      if (wid) void dispatch(switchWorkspace({ wid }));
    },
  };

  return { requestSwitch, dialogProps };
}
