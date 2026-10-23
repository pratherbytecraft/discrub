import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestStore, type TestStore } from '@/test/test-utils';
import messageReducer, { bulkEditChannels, bulkEditGuilds } from './messageSlice';
import authReducer from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import appReducer from '@features/app/appSlice';
import * as discordService from '@services/discordService';
import * as searchPagination from '@utils/searchPagination';
import type { Channel, Guild, Message } from 'discrub-core/types/discord-types';
import * as operationLoopUtils from '@/utils/operationLoopUtils';
import { addStatusEntry } from '@features/status/statusSlice';

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

describe('bulkEditGuilds, multi-Server edit (2.2.7, GitHub 16)', () => {
  let store: TestStore;
  let service: { editMessage: ReturnType<typeof vi.fn>; fetchChannels: ReturnType<typeof vi.fn>; fetchGuildUser: ReturnType<typeof vi.fn> };
  const VIEW_CHANNEL = String(1n << 10n);
  const guild = (id: string, name: string, permissions: string | undefined = String((1n << 10n) | (1n << 16n))): Guild =>
    ({ id, name, icon: null, permissions } as unknown as Guild);
  const textChannel = (id: string, name: string, extra: Record<string, unknown> = {}): Channel => ({ id, name, type: 0, ...extra }) as unknown as Channel;
  const categoryChannel = (id: string, name: string): Channel => ({ id, name, type: 4 }) as Channel;
  const channelsByGuild = (map: Record<string, Channel[] | { status: number }>) => {
    service.fetchChannels.mockImplementation((_t: string, guildId: string) => {
      const entry = map[guildId];
      if (!entry) return Promise.resolve({ success: false, status: 404 });
      if (!Array.isArray(entry)) return Promise.resolve({ success: false, status: entry.status });
      return Promise.resolve({ success: true, status: 200, data: entry });
    });
  };
  /** One page per channel keyed by channel id, then empties. */
  const pagesByChannel = (pages: Record<string, Message[]>) => {
    vi.mocked(searchPagination.iterateSearchMessagesRedux).mockImplementation(
      ({ channelId }) => (async function* () { yield { messages: pages[channelId ?? ''] ?? [], totalResults: 0 } as any; })(),
    );
  };
  const logged = () => vi.mocked(addStatusEntry).mock.calls.map((c) => (c[0] as { message: string }).message);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(operationLoopUtils.checkCancelled).mockReturnValue(false);
    store = createTestStore(
      { message: messageReducer, auth: authReducer, user: userReducer, app: appReducer },
      { auth: { token: 'tok' }, user: { currentUser: { id: 'me', username: 'me' } } } as any,
    );
    service = {
      editMessage: vi.fn().mockResolvedValue({ success: true, data: { id: 'x', content: 'redacted' } }),
      fetchChannels: vi.fn(),
      fetchGuildUser: vi.fn().mockResolvedValue({ success: true, status: 200, data: { roles: [] } }),
    };
    vi.mocked(discordService.getDiscordService).mockReturnValue(service as any);
  });

  it('walks the selected servers in order and edits every own message in each readable message channel', async () => {
    channelsByGuild({ g1: [categoryChannel('cat', 'Text'), textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
    pagesByChannel({ c1: [ownMsg('m1'), ownMsg('m2')], cat: [ownMsg('m9')], c2: [ownMsg('m3')] });

    const result = await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], content: 'redacted' })).unwrap();

    expect(result).toEqual({ edited: 3, skipped: 0, failed: 0 });
    expect(service.fetchChannels.mock.calls.map((c) => c[1])).toEqual(['g1', 'g2']);
    expect(service.editMessage.mock.calls.map((c) => c[1])).toEqual(['m1', 'm2', 'm3']);
    const searched = vi.mocked(searchPagination.iterateSearchMessagesRedux).mock.calls.map((c) => c[0]);
    expect(searched.map((c) => c.channelId)).toEqual(['c1', 'c2']);
    expect(searched.map((c) => c.guildId)).toEqual(['g1', 'g2']);
    expect(searched[0].criteria.userIds).toEqual(['me']);
    expect(logged()).toEqual(expect.arrayContaining([
      'Bulk edit: Starting across 2 servers',
      'Bulk edit: Server 1 of 2 · Alpha',
      'Bulk edit: Alpha · 1 channel to process',
      'Bulk edit: Alpha complete · 2 edited',
      'Bulk edit: Server 2 of 2 · Beta',
      'Bulk edit: Complete · 2 of 2 servers, 3 edited',
    ]));
    expect(store.getState().message.isEditing).toBe(false);
  });

  it('skips channels the user cannot read, using member roles for the overwrite check', async () => {
    const denyEveryone = { permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: VIEW_CHANNEL }] };
    channelsByGuild({ g1: [textChannel('hidden', 'staff', denyEveryone), textChannel('c1', 'general')] });
    pagesByChannel({ c1: [ownMsg('m1')], hidden: [ownMsg('m9')] });

    await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha')], content: 'redacted' })).unwrap();

    expect(service.fetchGuildUser).toHaveBeenCalledWith('g1', 'me', 'tok');
    expect(service.editMessage.mock.calls.map((c) => c[1])).toEqual(['m1']);
  });

  it('reports a server whose channels cannot be loaded and continues with the next one', async () => {
    channelsByGuild({ g1: { status: 403 }, g2: [textChannel('c2', 'chat')] });
    pagesByChannel({ c2: [ownMsg('m2')] });

    const result = await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], content: 'redacted' })).unwrap();

    expect(result).toEqual({ edited: 1, skipped: 0, failed: 0, errors: ['Alpha: could not load channels (HTTP 403)'] });
    expect(logged()).toContain('Bulk edit: Alpha · could not load channels (HTTP 403), skipped');
    expect(logged().some((m) => m.startsWith('Bulk edit: Complete · 1 of 2 servers'))).toBe(true);
  });

  it('logs a server with no readable channels and moves on', async () => {
    channelsByGuild({ g1: [categoryChannel('cat', 'Text')], g2: [textChannel('c2', 'chat')] });
    pagesByChannel({ c2: [ownMsg('m2')] });

    await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], content: 'redacted' })).unwrap();

    expect(logged()).toContain('Bulk edit: Alpha · no readable channels, skipped');
    expect(service.editMessage.mock.calls.map((c) => c[1])).toEqual(['m2']);
    expect(logged().some((m) => m.startsWith('Bulk edit: Complete · 2 of 2 servers'))).toBe(true);
  });

  it('stops after the current server when cancelled and reports a cancelled summary', async () => {
    channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
    pagesByChannel({ c1: [ownMsg('m1'), ownMsg('m2')], c2: [ownMsg('m3')] });
    // Cancel lands after the first edit, with Alpha's #general still half done.
    service.editMessage.mockImplementation(async () => {
      vi.mocked(operationLoopUtils.checkCancelled).mockReturnValue(true);
      return { success: true, data: { id: 'm1' } };
    });

    const result = await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], content: 'redacted' })).unwrap();

    expect(result).toEqual({ edited: 1, skipped: 0, failed: 0 });
    expect(service.fetchChannels.mock.calls.map((c) => c[1])).toEqual(['g1']);
    expect(logged().some((m) => m.startsWith('Bulk edit: Cancelled · 1 of 2 servers, 1 edited'))).toBe(true);
    // The cut server is not reported complete (mock pass 2026-10-27).
    expect(logged().some((m) => m.startsWith('Bulk edit: Alpha complete'))).toBe(false);
  });

  it('stops at the server where the sign in expired and answers signInExpired', async () => {
    const { showToast } = await import('@features/status/statusSlice');
    channelsByGuild({ g1: [textChannel('c1', 'general')], g2: [textChannel('c2', 'chat')] });
    pagesByChannel({ c1: [ownMsg('m1'), ownMsg('m2')], c2: [ownMsg('m3')] });
    service.editMessage
      .mockResolvedValueOnce({ success: true, data: { id: 'm1' } })
      .mockResolvedValueOnce({ success: false, status: 401 });

    const result = await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha'), guild('g2', 'Beta')], content: 'redacted' })).unwrap();

    expect(result).toMatchObject({ edited: 1, signInExpired: true });
    expect(service.fetchChannels.mock.calls.map((c) => c[1])).toEqual(['g1']);
    expect(logged().some((m) => m.startsWith('Bulk edit: Sign in expired · 1 of 2 servers'))).toBe(true);
    expect(logged().some((m) => m.startsWith('Bulk edit: Alpha complete'))).toBe(false);
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
    expect(store.getState().message.isEditing).toBe(false);
  });

  it('rejects with no servers or without a sign in, before any request', async () => {
    const none = await store.dispatch(bulkEditGuilds({ guilds: [], content: 'x' }));
    expect(bulkEditGuilds.rejected.match(none)).toBe(true);
    expect(service.fetchChannels).not.toHaveBeenCalled();
    store = createTestStore(
      { message: messageReducer, auth: authReducer, user: userReducer, app: appReducer },
      { auth: { token: null }, user: { currentUser: { id: 'me' } } } as any,
    );
    const signedOut = await store.dispatch(bulkEditGuilds({ guilds: [guild('g1', 'Alpha')], content: 'x' }));
    expect(bulkEditGuilds.rejected.match(signedOut)).toBe(true);
    expect(service.fetchChannels).not.toHaveBeenCalled();
  });
});
