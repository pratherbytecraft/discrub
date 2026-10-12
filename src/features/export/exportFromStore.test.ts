/**
 * 2.2.5 WP6c: exports walk into and render from the workspace store.
 * Bulk Export writes each unit's pages to a run conversation and hands
 * the export service sources over them; a resumed run renders the units
 * that finished from disk with no fetch; single Export reads the open
 * conversation from the store, writing its first page when nothing is
 * there yet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { Channel, Message } from 'discrub-core/types/discord-types';
import { createMockChannel, createMockMessages } from '@/test/fixtures';
import { rowsOf } from '@/test/state-factories';
import messageReducer from '@features/message/messageSlice';
import workspaceReducer, { bulkRecorded, setCurrentWorkspace } from '@features/workspace/workspaceSlice';
import { workspacePersistenceMiddleware, flushPendingRecords } from '@features/workspace/workspacePersistenceMiddleware';
import channelReducer, { setSelectedChannel } from '@features/channel/channelSlice';
import dmReducer from '@features/dm/dmSlice';
import guildReducer from '@features/guild/guildSlice';
import appReducer from '@features/app/appSlice';
import authReducer from '@features/auth/authSlice';
import statusReducer from '@features/status/statusSlice';
import cacheReducer from '@features/cache/cacheSlice';
import historyReducer from '@features/history/historySlice';
import exportReducer, { bulkExportChannels, exportMessages } from './exportSlice';
import { readBulkRecord } from '@features/workspace/resumeRecords';
import { DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import { cacheMessages } from '@features/message/messageCache';
import { isExportSourceSet, type ExportSourceSet } from '@services/exportService';
import * as exportServiceModule from '@services/exportService';
import { getDiscordService } from '@services/discordService';
import {
  acquireWorkspaceLock,
  countRows,
  deleteWorkspaceDatabase,
  ensureDefaultWorkspace,
  getWorkspace,
  releaseWorkspaceLock,
  updateConversation,
  updateWorkspace,
  writePage,
} from '@services/workspaceStore';

vi.mock('@services/exportService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/exportService')>();
  return { ...actual, getExportService: vi.fn() };
});
vi.mock('@services/streamingZipService', () => ({
  StreamingZipService: class {
    async addFile() {}
    async finalize() {}
    async cancel() {}
  },
}));
vi.mock('@services/exportDiscordShell', () => ({
  generateDiscordShellBulk: vi.fn(() => '<html></html>'),
  generateDiscordShellSingle: vi.fn(() => '<html></html>'),
}));
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));
vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({ delayMs: 0, delaySec: 0, baseDelay: 0, modifier: 0, randomComponent: 0 })),
}));
vi.mock('@/utils/operationLoopUtils', async () => {
  const actual = await vi.importActual<typeof import('@/utils/operationLoopUtils')>('@/utils/operationLoopUtils');
  return {
    ...actual,
    cancellableDelay: vi.fn().mockResolvedValue(false),
    waitWhilePaused: vi.fn().mockResolvedValue(undefined),
    withTransientRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
});
vi.mock('@/extension/storage', () => {
  const adapter = () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    getMany: vi.fn().mockResolvedValue([]),
    setMany: vi.fn().mockResolvedValue(undefined),
    entries: vi.fn().mockResolvedValue([]),
  });
  return {
    storage: { settings: adapter(), state: adapter(), presets: adapter(), cache: adapter(), history: adapter(), statuslog: adapter(), package: adapter(), media: adapter() },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

const chan = (id: string, name = id): Channel => createMockChannel({ id, name, guild_id: '42' });
const seed = { kind: 'channel' as const, guildId: '42', name: 'general' };

function makeStore(messages: Message[] = []) {
  return configureStore({
    reducer: {
      message: messageReducer,
      workspace: workspaceReducer,
      channel: channelReducer,
      dm: dmReducer,
      guild: guildReducer,
      app: appReducer,
      auth: authReducer,
      status: statusReducer,
      cache: cacheReducer,
      history: historyReducer,
      export: exportReducer,
    },
    preloadedState: messages.length > 0 ? { message: { ...messageReducer(undefined, { type: 'init' }), rows: rowsOf(messages), filteredRows: rowsOf(messages) } } as never : undefined,
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(workspacePersistenceMiddleware.middleware),
  });
}
type Store = ReturnType<typeof makeStore>;

const flush = (store: Store) => flushPendingRecords({ dispatch: store.dispatch, getState: store.getState as never });

async function openDefault(messages: Message[] = []) {
  const store = makeStore(messages);
  await ensureDefaultWorkspace();
  await acquireWorkspaceLock(DEFAULT_WORKSPACE_ID);
  store.dispatch(setCurrentWorkspace(DEFAULT_WORKSPACE_ID));
  return store;
}

async function idsOf(source: { windows(d: 'asc'): AsyncIterable<Message[]> }) {
  const ids: string[] = [];
  for await (const window of source.windows('asc')) ids.push(...window.map((m) => m.id));
  return ids;
}

interface Seen {
  input: unknown;
  rowsOnDisk: Record<string, number>;
  done: string[];
}

/** An export service that records what it was handed and what was on disk at the time. */
function captureExports(store: Store) {
  const seen: Seen[] = [];
  const exportToZip = vi.fn(async (input: unknown) => {
    const workspace = await getWorkspace(DEFAULT_WORKSPACE_ID);
    const rowsOnDisk: Record<string, number> = {};
    for (const cid of Object.keys(workspace?.conversations ?? {})) rowsOnDisk[cid] = await countRows(DEFAULT_WORKSPACE_ID, cid);
    seen.push({ input, rowsOnDisk, done: (await readBulkRecord(store.getState() as never))?.done ?? [] });
  });
  vi.mocked(exportServiceModule.getExportService).mockReturnValue({
    exportToZip,
    exportMediaOnly: vi.fn(),
    setExportThemeSet: vi.fn(),
    setExportFooterConfig: vi.fn(),
    getExportThemeSet: vi.fn(() => ({ defaultId: 'discord-dark', themes: [] })),
  } as never);
  return { seen, exportToZip };
}

const pages: Record<string, Message[]> = {};
const fetchMessageData = vi.fn(async (_token: string, _last: string, channelId: string) => ({ success: true, data: pages[channelId] ?? [] }));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getDiscordService).mockReturnValue({ fetchMessageData } as never);
  pages.c1 = createMockMessages(3).map((m) => ({ ...m, channel_id: 'c1' }));
  pages.c2 = createMockMessages(2).map((m, i) => ({ ...m, id: `c2-${i}`, channel_id: 'c2' }));
  await deleteWorkspaceDatabase();
});

afterEach(async () => {
  releaseWorkspaceLock(DEFAULT_WORKSPACE_ID);
  await deleteWorkspaceDatabase();
});

const bulkArg = (extra: Partial<Parameters<typeof bulkExportChannels>[0]> = {}) => ({
  channels: [chan('c1', 'one'), chan('c2', 'two')],
  token: 'token',
  format: 'json' as const,
  messagesPerPage: 100,
  separateThreads: false,
  includeMedia: false,
  guildId: '42',
  ...extra,
});

describe('Bulk Export through the workspace', () => {
  it('writes each unit to a run conversation, renders it from there, records it done and cleans up at the end', async () => {
    const store = await openDefault();
    const { seen, exportToZip } = captureExports(store);

    const result = await store.dispatch(bulkExportChannels(bulkArg()));
    expect(result.type).toBe('export/bulkExportChannels/fulfilled');
    expect(exportToZip).toHaveBeenCalledTimes(2);

    const first = seen[0].input as ExportSourceSet;
    expect(isExportSourceSet(first)).toBe(true);
    expect(first.main.count).toBe(3);
    expect(await idsOf(first.main)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(seen[0].rowsOnDisk['run:c1']).toBe(3);
    expect(seen[0].done).toEqual([]);

    // By the second unit the first is in the record's done list, and its rows are still on disk.
    await flush(store);
    const second = seen[1].input as ExportSourceSet;
    expect(second.main.count).toBe(2);
    expect(seen[1].rowsOnDisk['run:c1']).toBe(3);
    expect(seen[1].rowsOnDisk['run:c2']).toBe(2);

    // The run is over: record cleared, run conversations gone, nothing else written.
    await flush(store);
    const workspace = await getWorkspace(DEFAULT_WORKSPACE_ID);
    expect(workspace?.bulk).toBeNull();
    expect(Object.keys(workspace?.conversations ?? {})).toEqual([]);
    expect(workspace?.bytes).toBe(0);
  });

  it('a resumed run renders the units that finished from disk and fetches only the rest', async () => {
    const store = await openDefault();
    // A run that got through c1 before the app closed.
    await writePage(DEFAULT_WORKSPACE_ID, 'run:c1', pages.c1, seed);
    await updateConversation(DEFAULT_WORKSPACE_ID, 'run:c1', (c) => {
      c.complete = true;
    });
    await updateWorkspace(DEFAULT_WORKSPACE_ID, (w) => {
      w.bulk = { kind: 'bulkExport', mode: 'channels', guildId: '42', settings: null, queue: ['c1', 'c2'], done: ['c1'], inHand: 'c2', total: 2, doneCount: 1 };
    });
    store.dispatch(bulkRecorded({ kind: 'bulkExport', mode: 'channels', guildId: '42', total: 2, doneCount: 1, remaining: 1 }));
    const { seen } = captureExports(store);

    const result = await store.dispatch(bulkExportChannels(bulkArg({ resume: true })));
    expect(result.type).toBe('export/bulkExportChannels/fulfilled');

    const fetched = fetchMessageData.mock.calls.map((call) => call[2]);
    expect(fetched).toEqual(['c2']);
    expect((seen[0].input as ExportSourceSet).main.count).toBe(3);
    expect(await idsOf((seen[0].input as ExportSourceSet).main)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    // The resumed record kept c1 done while c2 ran.
    expect(seen[1].done).toEqual(['c1']);
    expect((seen[1].input as ExportSourceSet).main.count).toBe(2);
  });

  it('a unit the earlier run was in the middle of starts over', async () => {
    const store = await openDefault();
    await writePage(DEFAULT_WORKSPACE_ID, 'run:c2', pages.c2.slice(0, 1), seed);
    await updateWorkspace(DEFAULT_WORKSPACE_ID, (w) => {
      w.bulk = { kind: 'bulkExport', mode: 'channels', guildId: '42', settings: null, queue: ['c1', 'c2'], done: [], inHand: 'c2', total: 2, doneCount: 0 };
    });
    store.dispatch(bulkRecorded({ kind: 'bulkExport', mode: 'channels', guildId: '42', total: 2, doneCount: 0, remaining: 2 }));
    const { seen } = captureExports(store);

    await store.dispatch(bulkExportChannels(bulkArg({ resume: true })));
    expect(fetchMessageData.mock.calls.map((call) => call[2])).toEqual(['c1', 'c2']);
    expect((seen[1].input as ExportSourceSet).main.count).toBe(2);
  });

  it('keeps the unit in memory and hands the array over when there is no workspace', async () => {
    const store = makeStore();
    const { seen } = captureExports(store);
    await store.dispatch(bulkExportChannels(bulkArg()));
    expect(Array.isArray(seen[0].input)).toBe(true);
    expect((seen[0].input as Message[]).map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });
});

describe('single Export through the workspace', () => {
  it('reads the refined list from the store', async () => {
    const store = await openDefault();
    await writePage(DEFAULT_WORKSPACE_ID, 'c1', createMockMessages(4), seed);
    const { seen } = captureExports(store);

    const result = await store.dispatch(exportMessages({
      store: { wid: DEFAULT_WORKSPACE_ID, cid: 'c1', container: 'main', ids: ['msg-1', 'msg-3'] },
      channelName: 'general', format: 'json', messagesPerPage: 100, separateThreads: false, includeMedia: false, guildId: '42',
    }));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    const input = seen[0].input as ExportSourceSet;
    expect(isExportSourceSet(input)).toBe(true);
    expect(input.main.count).toBe(2);
    expect(await idsOf(input.main)).toEqual(['msg-1', 'msg-3']);
  });

  it('writes a first page that was never saved before reading it back', async () => {
    const messages = createMockMessages(3);
    const store = await openDefault(messages);
    store.dispatch(setSelectedChannel(chan('c1', 'general')));
    cacheMessages('main', messages);
    const { seen } = captureExports(store);

    await store.dispatch(exportMessages({
      store: { wid: DEFAULT_WORKSPACE_ID, cid: 'c1', container: 'main', ids: messages.map((m) => m.id) },
      channelName: 'general', format: 'json', messagesPerPage: 100, separateThreads: false, includeMedia: false, guildId: '42',
    }));
    expect(await countRows(DEFAULT_WORKSPACE_ID, 'c1')).toBe(3);
    expect((seen[0].input as ExportSourceSet).main.count).toBe(3);
  });
});
