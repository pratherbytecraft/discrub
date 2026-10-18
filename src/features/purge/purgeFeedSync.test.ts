import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RootState } from '@/app/store';
import { createBaseState } from '@/test/state-factories';
import { createMockChannel, createMockMessage } from '@/test/fixtures';

const persistRowDeletes = vi.fn().mockResolvedValue('written');
const persistRowPatches = vi.fn().mockResolvedValue('written');
vi.mock('@features/message/messagePersistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/message/messagePersistence')>();
  return { ...actual, persistRowDeletes: (...a: unknown[]) => persistRowDeletes(...a), persistRowPatches: (...a: unknown[]) => persistRowPatches(...a) };
});

import { applyPurgeDeletions, applyPurgeEdits } from './purgeFeedSync';

const stateWith = (selected: string | null, threadTab?: string): RootState => {
  const base = createBaseState();
  return {
    ...base,
    channel: { ...base.channel, selectedChannel: selected ? createMockChannel({ id: selected }) : null },
    message: {
      ...base.message,
      threadTabs: threadTab ? { [threadTab]: { pagination: { mode: 'paginated' } } } : {},
    },
  } as unknown as RootState;
};

describe('purgeFeedSync (2.2.5)', () => {
  beforeEach(() => {
    persistRowDeletes.mockClear();
    persistRowPatches.mockClear();
  });

  it('removes rows from the main feed when the purged channel is the open one', () => {
    const dispatch = vi.fn();
    const state = stateWith('ch1');
    applyPurgeDeletions(() => state, dispatch, 'ch1', ['m1', 'm2']);
    expect(dispatch).toHaveBeenCalledWith({ type: 'message/messagesRemoved', payload: { ids: ['m1', 'm2'], containerId: null } });
    expect(persistRowDeletes).not.toHaveBeenCalled();
  });

  it('removes rows from an open thread tab', () => {
    const dispatch = vi.fn();
    const state = stateWith('ch1', 'th1');
    applyPurgeDeletions(() => state, dispatch, 'th1', ['m1']);
    expect(dispatch).toHaveBeenCalledWith({ type: 'message/messagesRemoved', payload: { ids: ['m1'], containerId: 'th1' } });
  });

  it('writes the deletes straight to the workspace when the conversation is not open', () => {
    const dispatch = vi.fn();
    const state = stateWith('ch-other');
    applyPurgeDeletions(() => state, dispatch, 'ch1', ['m1']);
    expect(dispatch).not.toHaveBeenCalled();
    expect(persistRowDeletes).toHaveBeenCalledTimes(1);
    expect(persistRowDeletes.mock.calls[0][1]).toBe('ch1');
    expect(persistRowDeletes.mock.calls[0][2]).toEqual(['m1']);
  });

  it('does nothing for an empty batch', () => {
    const dispatch = vi.fn();
    applyPurgeDeletions(() => stateWith('ch1'), dispatch, 'ch1', []);
    applyPurgeEdits(() => stateWith('ch1'), dispatch, 'ch1', []);
    expect(dispatch).not.toHaveBeenCalled();
    expect(persistRowDeletes).not.toHaveBeenCalled();
    expect(persistRowPatches).not.toHaveBeenCalled();
  });

  it('replaces edited messages in the open feed, and patches the workspace rows otherwise', () => {
    const dispatch = vi.fn();
    const edited = createMockMessage({ id: 'm1', content: '', attachments: [] });
    applyPurgeEdits(() => stateWith('ch1'), dispatch, 'ch1', [edited]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'message/messagesEdited', payload: { messages: [edited], containerId: null } });

    applyPurgeEdits(() => stateWith('ch-other'), dispatch, 'ch1', [edited]);
    expect(persistRowPatches).toHaveBeenCalledTimes(1);
    expect(persistRowPatches.mock.calls[0][1]).toBe('ch1');
    expect(persistRowPatches.mock.calls[0][2]).toEqual([{ id: 'm1', patch: expect.objectContaining({ content: '', attachments: [] }) }]);
  });
});
