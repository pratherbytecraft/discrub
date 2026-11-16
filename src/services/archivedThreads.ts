/**
 * 2.2.10: changes inside an archived thread.
 *
 * Discord answers 400 with code 50083 ("Thread is archived") to a delete,
 * an edit or a reaction removal inside an archived thread. The thread has
 * to be reopened first. Purge did that only for threads its own thread list
 * had marked archived; a thread opened as the conversation, a package
 * delete and every action from the feed never reopened one, so each call
 * failed with HTTP 400 (two r/discrub reports, 2026-11-16).
 *
 * A reopener is made once per run. It passes calls through, and on the
 * first 50083 for a thread it reopens the thread, repeats the call, and
 * remembers the thread so `finish()` can archive it again. A thread that
 * cannot be reopened is remembered too: later calls for it are answered
 * here without going to Discord, and the run logs one line for it.
 */
import { t } from '@/i18n';
import { addStatusEntry } from '@features/status/statusSlice';
import { getDiscordService } from '@services/discordService';

export const ARCHIVED_THREAD_CODE = 50083;

interface ApiResult {
  success: boolean;
  status?: number;
  code?: number;
}

/** Discord refused the call because the thread is archived. */
export const isArchivedThreadRefusal = (response: ApiResult | null | undefined): boolean =>
  !!response && !response.success && response.status === 400 && response.code === ARCHIVED_THREAD_CODE;

export interface ArchivedThreadReopener {
  /**
   * Runs a call that changes something inside `threadId`. When Discord
   * refuses it for an archived thread, the thread is reopened once and the
   * call is repeated; what comes back is the second answer.
   */
  call<R extends ApiResult>(threadId: string, run: () => Promise<R>): Promise<R>;
  /**
   * True when the answer is a thread that was left archived: the run was
   * told not to wake archived threads, or Discord would not reopen it. The
   * line for it is already in the log, once per thread.
   */
  leftArchived(response: ApiResult | null | undefined): boolean;
  /** Archives every thread this run reopened. Safe to call more than once. */
  finish(): Promise<void>;
}

interface ReopenerOptions {
  token: string;
  // The app's dispatch, or any function that takes a status entry action.
  dispatch: (action: any) => unknown;
  /** "Don't wake archived threads": never reopen, skip with one line per thread. */
  skipWaking?: boolean;
}

export function createArchivedThreadReopener({ token, dispatch, skipWaking = false }: ReopenerOptions): ArchivedThreadReopener {
  const reopened = new Set<string>();
  const leftThreads = new Set<string>();
  const leftAnswers = new WeakSet<object>();

  const leave = <R extends ApiResult>(threadId: string, response: R): R => {
    leftThreads.add(threadId);
    leftAnswers.add(response);
    return response;
  };

  return {
    call: async <R extends ApiResult>(threadId: string, run: () => Promise<R>): Promise<R> => {
      if (leftThreads.has(threadId)) {
        // Already known: no call, the same answer Discord gave the first time.
        return leave(threadId, { success: false, status: 400, code: ARCHIVED_THREAD_CODE } as R);
      }
      const response = await run();
      if (!isArchivedThreadRefusal(response)) return response;
      // Reopened by this run and still refused: hand the refusal back as a failure.
      if (reopened.has(threadId)) return response;

      if (skipWaking) {
        dispatch(addStatusEntry({ level: 'info', message: t('status.purge.leavingArchivedThread', { id: threadId }) }));
        return leave(threadId, response);
      }

      let status: number | undefined;
      let opened = false;
      try {
        const answer = await getDiscordService().editChannel(token, threadId, { archived: false });
        opened = answer.success;
        status = answer.status;
      } catch {
        opened = false;
      }
      if (!opened) {
        dispatch(addStatusEntry({
          level: 'warning',
          message: status === 403
            ? t('status.purge.unarchiveDenied', { id: threadId })
            : t('status.purge.unarchiveFailed', { id: threadId, status: status ?? '?' }),
        }));
        return leave(threadId, response);
      }
      reopened.add(threadId);
      dispatch(addStatusEntry({ level: 'info', message: t('status.purge.unarchivedMessages', { id: threadId }) }));
      return run();
    },

    leftArchived: (response) => !!response && leftAnswers.has(response),

    finish: async () => {
      const threads = [...reopened];
      reopened.clear();
      for (const threadId of threads) {
        try {
          const answer = await getDiscordService().editChannel(token, threadId, { archived: true });
          dispatch(addStatusEntry(answer.success
            ? { level: 'info', message: t('status.purge.rearchived', { id: threadId }) }
            : { level: 'warning', message: t('status.purge.rearchiveFailedHttp', { id: threadId, reason: t('status.purge.httpStatus', { status: answer.status ?? '?' }) }) }));
        } catch {
          dispatch(addStatusEntry({
            level: 'warning',
            message: t('status.purge.rearchiveFailedHttp', { id: threadId, reason: t('status.purge.networkError') }),
          }));
        }
      }
    },
  };
}

/** One change inside a channel from the feed: an archived thread is reopened for it and archived again after. */
export async function callInThread<R extends ApiResult>(
  token: string,
  dispatch: (action: any) => unknown,
  threadId: string,
  run: () => Promise<R>,
): Promise<R> {
  const reopener = createArchivedThreadReopener({ token, dispatch });
  try {
    return await reopener.call(threadId, run);
  } finally {
    await reopener.finish();
  }
}
