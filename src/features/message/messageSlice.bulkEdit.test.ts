import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestStore, type TestStore } from '@/test/test-utils';
import messageReducer, { bulkEditChannels } from './messageSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
import * as discordService from '@services/discordService';
import * as searchPagination from '@utils/searchPagination';
import type { Channel, Message } from 'discrub-core/types/discord-types';

// #215 — drive bulkEditChannels through a controlled search iterator so the
// test asserts the multi-channel orchestration (edit every own message in
// each selected channel) without hitting the network.
vi.mock('@utils/searchPagination', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@utils/searchPagination')>();
  return { ...actual, iterateSearchMessagesRedux: vi.fn() };
});

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));

vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({ delayMs: 0, delaySec: 0, baseDelay: 0, modifier: 0, randomComponent: 0 })),
}));

vi.mock('@/utils/operationLoopUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/operationLoopUtils')>();
  return {
    ...actual,
    waitWhilePaused: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockReturnValue(false),
    cancellableDelay: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('@features/status/statusSlice', () => ({
  addStatusEntry: vi.fn((payload) => ({ type: 'status/addStatusEntry', payload })),
  showOperationTip: vi.fn((message) => ({ type: 'status/showOperationTip', payload: message })),
  showToast: vi.fn((payload) => ({ type: 'status/showToast', payload })),
}));

const channel = (id: string, name: string): Channel => ({ id, name } as Channel);
const ownMsg = (id: string): Message =>
  ({ id, channel_id: 'will-be-overridden', author: { id: 'me', username: 'me' } } as unknown as Message);

const yieldPage = (messages: Message[]) =>
  vi.mocked(searchPagination.iterateSearchMessagesRedux).mockImplementation(
    // a fresh generator per channel call
    () => (async function* () { yield { messages, totalResults: messages.length } as any; })(),
  );

describe('bulkEditChannels (#215)', () => {
  let store: TestStore;
  let mockDiscordService: { editMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    store = createTestStore(
      { message: messageReducer, auth: authReducer, user: userReducer, app: appReducer },
      { auth: { token: 'tok' }, user: { currentUser: { id: 'me', username: 'me' } } } as any,
    );
    mockDiscordService = {
      editMessage: vi.fn().mockResolvedValue({ success: true, data: { id: 'x', content: 'redacted' } }),
    };
    vi.mocked(discordService.getDiscordService).mockReturnValue(mockDiscordService as any);
  });

  it('edits every own message across all selected channels', async () => {
    yieldPage([ownMsg('m1'), ownMsg('m2')]);

    const result = await store.dispatch(
      bulkEditChannels({
        channels: [channel('c1', 'general'), channel('c2', 'random')],
        content: 'redacted',
        guildId: 'g1',
      }),
    ).unwrap();

    // 2 messages × 2 channels = 4 edits
    expect(mockDiscordService.editMessage).toHaveBeenCalledTimes(4);
    expect(result.edited).toBe(4);
    expect(result.failed).toBe(0);
    // iterator opened once per channel
    expect(searchPagination.iterateSearchMessagesRedux).toHaveBeenCalledTimes(2);
  });

  it('leaves a message that already carries the text alone, so a resumed run does not edit the channel in hand twice (2.2.6)', async () => {
    yieldPage([
      { ...ownMsg('m1'), content: 'redacted' } as Message,
      { ...ownMsg('m2'), content: 'hello' } as Message,
    ]);
    const result = await store.dispatch(bulkEditChannels({ channels: [channel('c1', 'general')], content: 'redacted', guildId: 'g1' })).unwrap();
    expect(mockDiscordService.editMessage).toHaveBeenCalledTimes(1);
    expect(mockDiscordService.editMessage).toHaveBeenCalledWith('tok', 'm2', { content: 'redacted' }, expect.anything());
    expect(result).toMatchObject({ edited: 1, skipped: 1, failed: 0 });
  });

  it('scopes the per-channel search to the current user (own messages only)', async () => {
    yieldPage([ownMsg('m1')]);

    await store.dispatch(
      bulkEditChannels({ channels: [channel('c1', 'general')], content: 'redacted', guildId: 'g1' }),
    ).unwrap();

    const call = vi.mocked(searchPagination.iterateSearchMessagesRedux).mock.calls[0][0];
    expect(call.criteria.userIds).toEqual(['me']);
  });

  it('skips messages authored by someone else', async () => {
    const otherMsg = { id: 'm9', author: { id: 'someone-else' } } as unknown as Message;
    yieldPage([ownMsg('m1'), otherMsg]);

    const result = await store.dispatch(
      bulkEditChannels({ channels: [channel('c1', 'general')], content: 'redacted', guildId: 'g1' }),
    ).unwrap();

    expect(mockDiscordService.editMessage).toHaveBeenCalledTimes(1);
    expect(result.edited).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('buckets failed edits (service returns success: false) without aborting the run', async () => {
    mockDiscordService.editMessage
      .mockResolvedValueOnce({ success: true, data: { id: 'm1' } })
      .mockResolvedValueOnce({ success: false, status: 403 })
      .mockResolvedValueOnce({ success: true, data: { id: 'm3' } });
    yieldPage([ownMsg('m1'), ownMsg('m2'), ownMsg('m3')]);

    const result = await store.dispatch(
      bulkEditChannels({ channels: [channel('c1', 'general')], content: 'redacted', guildId: 'g1' }),
    ).unwrap();

    expect(result.edited).toBe(2);
    expect(result.failed).toBe(1);
    expect(mockDiscordService.editMessage).toHaveBeenCalledTimes(3);
  });

  it('stops at the channel where the sign in expired and answers signInExpired (row 134)', async () => {
    const { showToast } = await import('@features/status/statusSlice');
    mockDiscordService.editMessage
      .mockResolvedValueOnce({ success: true, data: { id: 'm1' } })
      .mockResolvedValueOnce({ success: false, status: 401 });
    yieldPage([ownMsg('m1'), ownMsg('m2'), ownMsg('m3')]);

    const result = await store.dispatch(
      bulkEditChannels({ channels: [channel('c1', 'general'), channel('c2', 'random')], content: 'redacted', guildId: 'g1' }),
    ).unwrap();

    expect(result).toMatchObject({ edited: 1, failed: 0, signInExpired: true });
    expect(mockDiscordService.editMessage).toHaveBeenCalledTimes(2);
    expect(searchPagination.iterateSearchMessagesRedux).toHaveBeenCalledTimes(1);
    expect(store.getState().message.isEditing).toBe(false);
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
  });

  it('holds isEditing true during the run and clears it on completion (#215 pause/cancel surfacing)', async () => {
    // A controllable edit promise lets us inspect state mid-flight.
    let resolveEdit: (v: unknown) => void = () => {};
    mockDiscordService.editMessage.mockReturnValue(
      new Promise((res) => { resolveEdit = res; }),
    );
    yieldPage([ownMsg('m1')]);

    const dispatched = store.dispatch(
      bulkEditChannels({ channels: [channel('c1', 'general')], content: 'redacted', guildId: 'g1' }),
    );

    // pending reducer set the flag → the "Editing messages..." indicator +
    // pause/cancel controls render.
    await Promise.resolve();
    expect(store.getState().message.isEditing).toBe(true);

    resolveEdit({ success: true, data: { id: 'm1' } });
    await dispatched;
    expect(store.getState().message.isEditing).toBe(false);
  });

  it('rejects when not authenticated', async () => {
    store = createTestStore(
      { message: messageReducer, auth: authReducer, user: userReducer, app: appReducer },
      { auth: { token: null }, user: { currentUser: { id: 'me' } } } as any,
    );
    yieldPage([ownMsg('m1')]);

    const action = await store.dispatch(
      bulkEditChannels({ channels: [channel('c1', 'general')], content: 'x', guildId: 'g1' }),
    );

    expect(bulkEditChannels.rejected.match(action)).toBe(true);
    expect(mockDiscordService.editMessage).not.toHaveBeenCalled();
  });
});
