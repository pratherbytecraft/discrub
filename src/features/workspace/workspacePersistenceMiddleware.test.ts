import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { configureStore } from '@reduxjs/toolkit';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage, createMockChannel, createMockReaction } from '@/test/fixtures';
import messageReducer, {
  addThreadTab,
  deleteMessage,
  editMessage,
  messagesEdited,
  messagesRemoved,
  removeThreadTab,
  setRefineCriteria,
  setSearchCriteria,
  setThreadMessages,
  toggleMessageSelection,
  deleteReaction,
  setMessages,
  clearSavedSearch,
} from '@features/message/messageSlice';
import { initialMessageState } from '@features/message/messageTypes';
import workspaceReducer, { setCurrentWorkspace } from './workspaceSlice';
import channelReducer, { fetchChannels, setSelectedChannel } from '@features/channel/channelSlice';
import dmReducer from '@features/dm/dmSlice';
import guildReducer, { fetchGuilds } from '@features/guild/guildSlice';
import appReducer from '@features/app/appSlice';
import statusReducer from '@features/status/statusSlice';
import { workspacePersistenceMiddleware, flushPendingRecords, editPatch } from './workspacePersistenceMiddleware';
import { LEGACY_DEFAULT_WORKSPACE_ID } from './workspaceTypes';
import { persistThreadTabs } from '@features/message/messagePersistence';
import {
  countRows,
  deleteWorkspaceDatabase,
  getConversation,
  getMessages,
  getWorkspace,
  searchCid,
  updateConversation,
  writePage,
} from '@services/workspaceStore';

const CID = '1000';
const seed = { kind: 'channel' as const, guildId: '42', name: 'general' };
const msg = (id: string, overrides: Partial<Message> = {}): Message => createMockMessage({ id, channel_id: CID, ...overrides });

function makeStore() {
  const store = configureStore({
    reducer: {
      message: messageReducer,
      workspace: workspaceReducer,
      channel: channelReducer,
      dm: dmReducer,
      guild: guildReducer,
      app: appReducer,
      status: statusReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(workspacePersistenceMiddleware.middleware),
  });
  store.dispatch(setCurrentWorkspace(LEGACY_DEFAULT_WORKSPACE_ID));
  store.dispatch(setSelectedChannel(createMockChannel({ id: CID, name: 'general', guild_id: '42' })));
  return store;
}

type Store = ReturnType<typeof makeStore>;
const api = (store: Store) => ({ dispatch: store.dispatch as (a: unknown) => unknown, getState: store.getState as never });

/** Listener effects run after dispatch returns; let them settle. The record
 * tests call flushPendingRecords instead of waiting out the 500 ms debounce. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('editPatch', () => {
  it('keeps only the fields an edit can change', () => {
    const patch = editPatch(msg('1', { content: 'new', reactions: [createMockReaction()] }));
    expect(patch.id).toBe('1');
    expect(patch.patch.content).toBe('new');
    expect('reactions' in patch.patch).toBe(false);
  });
});

describe('workspacePersistenceMiddleware', () => {
  it('mirrors batched removals into the rows', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1'), msg('2'), msg('3')], seed);
    store.dispatch(setMessages([msg('1'), msg('2'), msg('3')]));
    store.dispatch(messagesRemoved({ ids: ['1', '3'], containerId: null }));
    await settle();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(1);
  });

  it('mirrors a single delete and an edit by the thunk argument channel', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1'), msg('2')], seed);
    store.dispatch(deleteMessage.fulfilled('1', 'req', { messageId: '1', channelId: CID, token: 't' }));
    store.dispatch(editMessage.fulfilled(msg('2', { content: 'edited' }), 'req', { messageId: '2', channelId: CID, content: 'edited', token: 't' }));
    await settle();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(1);
    const [two] = await getMessages(LEGACY_DEFAULT_WORKSPACE_ID, CID, ['2']);
    expect(two?.content).toBe('edited');
  });

  it('mirrors batched edits', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], seed);
    store.dispatch(setMessages([msg('1')]));
    store.dispatch(messagesEdited({ messages: [msg('1', { content: 'bulk' })], containerId: null }));
    await settle();
    const [one] = await getMessages(LEGACY_DEFAULT_WORKSPACE_ID, CID, ['1']);
    expect(one?.content).toBe('bulk');
  });

  it('mirrors a reaction change from the state the reducer produced', async () => {
    const store = makeStore();
    const reaction = createMockReaction({ count: 2, emoji: { id: undefined, name: '👍' } as never });
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1', { reactions: [reaction] })], seed);
    store.dispatch(setMessages([msg('1', { reactions: [reaction] })]));
    store.dispatch(deleteReaction.fulfilled({ messageId: '1', emoji: '👍' } as never, 'req', { messageId: '1', channelId: CID, emoji: '👍', token: 't' } as never));
    await settle();
    const [one] = await getMessages(LEGACY_DEFAULT_WORKSPACE_ID, CID, ['1']);
    expect(one?.reactions?.[0]?.count).toBe(1);
  });

  it('writes criteria and sort to the record after the debounce, seeding it', async () => {
    const store = makeStore();
    store.dispatch(setMessages([msg('1', { pinned: true }), msg('2')]));
    store.dispatch(setRefineCriteria({ ...initialMessageState.refineCriteria, isPinned: 1 } as never));
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();
    await flushPendingRecords(api(store));
    const record = await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID);
    expect(record?.name).toBe('general');
    expect((record?.refineCriteria as { isPinned?: number } | null)?.isPinned).toBe(1);
  });

  it('a channel, server or DM list that arrives renames the records (ws-conv-names)', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], { ...seed, guildName: 'Old' });
    store.dispatch(fetchChannels.fulfilled([createMockChannel({ id: CID, name: 'general-chat', guild_id: '42' })], 'r', { guildId: '42', token: 't' }));
    store.dispatch(fetchGuilds.fulfilled([{ id: '42', name: 'Sandbox' } as never], 'r', 't'));
    await settle();
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.name).toBe('general-chat');
    expect((await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))?.guilds).toEqual({ '42': 'Sandbox' });
  });

  it('writes the selection only when the record exists', async () => {
    const store = makeStore();
    store.dispatch(setMessages([msg('1'), msg('2')]));
    store.dispatch(toggleMessageSelection('2'));
    await flushPendingRecords(api(store));
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBeNull();

    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1'), msg('2')], seed);
    store.dispatch(toggleMessageSelection('1'));
    await flushPendingRecords(api(store));
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.selectedIds).toEqual(['2', '1']);
  });

  it('clearSavedSearch drops the search set and keeps the plain rows (fix C)', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], seed);
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID), [msg('2')], seed);
    await store.dispatch(clearSavedSearch({ cid: CID }));
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(1);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID))).toBe(0);
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID))).toBeNull();
  });

  it('a delete reaches the plain rows and the search set (fix C)', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1'), msg('2')], seed);
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID), [msg('2')], seed);
    store.dispatch(setMessages([msg('1'), msg('2')]));
    store.dispatch(messagesRemoved({ containerId: null, ids: ['2'] }));
    await settle();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(1);
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, searchCid(CID))).toBe(0);
  });

  it('the per switch criteria reset writes nothing, so it cannot overwrite a saved sort (row 11)', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], seed);
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID, (c) => { c.order = { ...c.order, order: 'asc' } as never; });
    const before = (await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.order;
    store.dispatch(setSearchCriteria(null));
    await flushPendingRecords(api(store));
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.order).toEqual(before);
  });

  it('the per switch criteria reset does not touch the saved rows (#226)', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], seed);
    store.dispatch(setMessages([msg('1')]));
    store.dispatch(setSearchCriteria(null));
    await settle();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, CID)).toBe(1);
  });

  it('closing a thread tab forgets its record and updates the parent', async () => {
    const store = makeStore();
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, CID, [msg('1')], seed);
    await writePage(LEGACY_DEFAULT_WORKSPACE_ID, 't1', [msg('9', { channel_id: 't1' })], { kind: 'thread', guildId: '42', name: 'Plans' });
    store.dispatch(addThreadTab({ threadId: 't1', threadName: 'Plans' }));
    store.dispatch(setThreadMessages({ threadId: 't1', messages: [msg('9', { channel_id: 't1' })] }));
    await persistThreadTabs(api(store), CID, store.getState() as never);
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.threadTabs).toEqual(['t1']);
    store.dispatch(removeThreadTab('t1'));
    await settle();
    expect(await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, 't1')).toBeNull();
    expect(await countRows(LEGACY_DEFAULT_WORKSPACE_ID, 't1')).toBe(0);
    expect((await getConversation(LEGACY_DEFAULT_WORKSPACE_ID, CID))?.threadTabs).toEqual([]);
  });
});
