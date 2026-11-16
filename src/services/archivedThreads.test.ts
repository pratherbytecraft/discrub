import { describe, it, expect, vi, beforeEach } from 'vitest';

const editChannel = vi.fn();
vi.mock('@services/discordService', () => ({
  getDiscordService: () => ({ editChannel }),
}));

import { callInThread, createArchivedThreadReopener, isArchivedThreadRefusal } from './archivedThreads';

const TOKEN = 'token';
const ok = { success: true, status: 204 };
const archived = { success: false, status: 400, code: 50083 };

const lines = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls.map(([action]) => (action as { payload: { level: string; message: string } }).payload);

describe('archived thread reopener', () => {
  beforeEach(() => {
    editChannel.mockReset();
    editChannel.mockResolvedValue({ success: true, status: 200 });
  });

  it('reads only 400 with code 50083 as an archived thread', () => {
    expect(isArchivedThreadRefusal(archived)).toBe(true);
    expect(isArchivedThreadRefusal({ success: false, status: 400, code: 50006 })).toBe(false);
    expect(isArchivedThreadRefusal({ success: false, status: 403, code: 50083 })).toBe(false);
    expect(isArchivedThreadRefusal({ success: false, status: 400 })).toBe(false);
    expect(isArchivedThreadRefusal(ok)).toBe(false);
    expect(isArchivedThreadRefusal(undefined)).toBe(false);
  });

  it('passes a call through and never touches the thread when Discord accepts it', async () => {
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch });
    const run = vi.fn().mockResolvedValue(ok);
    expect(await reopener.call('t1', run)).toBe(ok);
    await reopener.finish();
    expect(run).toHaveBeenCalledTimes(1);
    expect(editChannel).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reopens the thread once, repeats the call, and archives the thread again at the end', async () => {
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch });
    const first = vi.fn().mockResolvedValueOnce(archived).mockResolvedValue(ok);
    const second = vi.fn().mockResolvedValue(ok);

    expect(await reopener.call('t1', first)).toBe(ok);
    expect(await reopener.call('t1', second)).toBe(ok);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(editChannel.mock.calls).toEqual([[TOKEN, 't1', { archived: false }]]);

    await reopener.finish();
    await reopener.finish();
    expect(editChannel.mock.calls).toEqual([
      [TOKEN, 't1', { archived: false }],
      [TOKEN, 't1', { archived: true }],
    ]);
    expect(lines(dispatch).map((l) => l.message)).toEqual([
      'Un-archived thread t1 to process its messages (will re-archive after)',
      'Re-archived thread t1',
    ]);
  });

  it('a thread it may not reopen is left: one line, and later calls for it are not sent', async () => {
    editChannel.mockResolvedValue({ success: false, status: 403 });
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch });
    const first = vi.fn().mockResolvedValue(archived);
    const later = vi.fn().mockResolvedValue(ok);

    const a = await reopener.call('t1', first);
    const b = await reopener.call('t1', later);
    expect(reopener.leftArchived(a)).toBe(true);
    expect(reopener.leftArchived(b)).toBe(true);
    expect(b).toMatchObject({ success: false, status: 400, code: 50083 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(editChannel).toHaveBeenCalledTimes(1);

    // Another thread in the same run is not affected.
    const other = vi.fn().mockResolvedValue(ok);
    expect(await reopener.call('t2', other)).toBe(ok);

    await reopener.finish();
    expect(editChannel).toHaveBeenCalledTimes(1);
    expect(lines(dispatch)).toEqual([
      { level: 'warning', message: 'Missing permission to un-archive thread t1; its messages will be skipped' },
    ]);
  });

  it('says the HTTP status when the reopen fails for another reason', async () => {
    editChannel.mockResolvedValue({ success: false, status: 500 });
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch });
    const answer = await reopener.call('t1', vi.fn().mockResolvedValue(archived));
    expect(reopener.leftArchived(answer)).toBe(true);
    expect(lines(dispatch)[0].message).toBe('Failed to un-archive thread t1 (HTTP 500); its messages will be skipped');
  });

  it('with "Don\'t wake archived threads" it never reopens: one info line per thread', async () => {
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch, skipWaking: true });
    const run = vi.fn().mockResolvedValue(archived);
    const a = await reopener.call('t1', run);
    const b = await reopener.call('t1', run);
    await reopener.finish();
    expect(reopener.leftArchived(a)).toBe(true);
    expect(reopener.leftArchived(b)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(editChannel).not.toHaveBeenCalled();
    expect(lines(dispatch)).toEqual([
      { level: 'info', message: 'Leaving archived thread t1 untouched, "Don\'t wake archived threads" is on' },
    ]);
  });

  it('a thread it reopened that still refuses is a plain failure, with no second reopen', async () => {
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch });
    const run = vi.fn().mockResolvedValue(archived);
    const a = await reopener.call('t1', run);
    const b = await reopener.call('t1', run);
    expect(a).toBe(archived);
    expect(reopener.leftArchived(a)).toBe(false);
    expect(reopener.leftArchived(b)).toBe(false);
    expect(run).toHaveBeenCalledTimes(3);
    expect(editChannel).toHaveBeenCalledTimes(1);
  });

  it('says so when the thread cannot be archived again', async () => {
    editChannel.mockResolvedValueOnce({ success: true, status: 200 }).mockResolvedValueOnce({ success: false, status: 403 });
    const dispatch = vi.fn();
    const reopener = createArchivedThreadReopener({ token: TOKEN, dispatch });
    await reopener.call('t1', vi.fn().mockResolvedValueOnce(archived).mockResolvedValue(ok));
    await reopener.finish();
    expect(lines(dispatch).slice(-1)[0]).toEqual({
      level: 'warning',
      message: 'Could not re-archive thread t1 (HTTP 403). You may need to re-archive it manually.',
    });
  });

  it('callInThread reopens for one call and archives again right after, also when the call throws', async () => {
    const dispatch = vi.fn();
    const run = vi.fn().mockResolvedValueOnce(archived).mockResolvedValue(ok);
    expect(await callInThread(TOKEN, dispatch, 't1', run)).toBe(ok);
    expect(editChannel.mock.calls.map((c) => c[2])).toEqual([{ archived: false }, { archived: true }]);

    editChannel.mockClear();
    const throws = vi.fn().mockResolvedValueOnce(archived).mockRejectedValue(new Error('network'));
    await expect(callInThread(TOKEN, dispatch, 't2', throws)).rejects.toThrow('network');
    expect(editChannel.mock.calls.map((c) => c[2])).toEqual([{ archived: false }, { archived: true }]);
  });
});
