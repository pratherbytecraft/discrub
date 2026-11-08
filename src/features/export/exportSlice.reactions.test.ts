import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { createTestStore } from '@/test/test-utils';
import { createMockMessage } from '@/test/fixtures';
import appReducer, { defaultSettings } from '@features/app/appSlice';
import authReducer from '@features/auth/authSlice';
import cacheReducer from '@features/cache/cacheSlice';
import historyReducer from '@features/history/historySlice';
import statusReducer from '@features/status/statusSlice';
import { getExportService } from '@services/exportService';
import exportReducer, { exportMessages } from './exportSlice';

// 2.2.9: an HTML export with Reactions on must not finish with empty reactor
// lists when the lookup fails. The lookup is discrub-core's
// ReactionEnrichmentService, loaded on demand, so it is mocked at that module.
const { generateReactionMap } = vi.hoisted(() => ({ generateReactionMap: vi.fn() }));

vi.mock('discrub-core/messages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('discrub-core/messages')>()),
  DiscordServiceAdapter: class {},
  ReactionEnrichmentService: class {
    generateReactionMap = generateReactionMap;
  },
}));

vi.mock('@services/exportService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@services/exportService')>()),
  getExportService: vi.fn(),
}));

const withReaction = createMockMessage({
  id: 'm-reacted',
  reactions: [{ count: 2, count_details: { burst: 0, normal: 2 }, me: false, me_burst: false, burst_colors: [], emoji: { id: null, name: '👍' } }],
});
const reactionMap = {
  [withReaction.id]: { '👍': [{ id: 'u-1', username: 'one', avatar: null, burst: false }] },
};
const exportToZip = vi.fn();

function makeStore(reactionsEnabled = true) {
  return createTestStore(
    { app: appReducer, auth: authReducer, cache: cacheReducer, history: historyReducer, status: statusReducer, export: exportReducer },
    {
      app: {
        ...appReducer(undefined, { type: 'init' }),
        settings: { ...defaultSettings, [DiscrubSetting.REACTIONS_ENABLED]: reactionsEnabled ? 'true' : 'false' },
      },
      auth: { ...authReducer(undefined, { type: 'init' }), token: 'token-1' },
    },
  );
}

const params = {
  messages: [withReaction],
  channelName: 'reacted-channel',
  format: 'html' as const,
  messagesPerPage: 100,
  separateThreads: false,
  includeMedia: false,
};

const statusMessages = (store: ReturnType<typeof makeStore>) =>
  (store.getState() as { status: { entries: Array<{ level: string; message: string }> } }).status.entries;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in this test')));
  generateReactionMap.mockResolvedValue({ messages: [withReaction], reactionMap, failed: 0, failedMessageIds: [], failures: [], signInExpired: false });
  exportToZip.mockResolvedValue(undefined);
  vi.mocked(getExportService).mockReturnValue({
    exportToZip,
    setExportThemeSet: vi.fn(),
    setExportChannelNames: vi.fn(),
    setExportFooterConfig: vi.fn(),
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exportMessages, HTML reactor lookup', () => {
  it('hands the reactor map to the HTML writer when the lookup succeeds', async () => {
    const result = await makeStore().dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).toHaveBeenCalledWith([withReaction]);
    expect(exportToZip).toHaveBeenCalledTimes(1);
    expect(exportToZip.mock.calls[0]).toContainEqual(reactionMap);
  });

  it('fails the export and writes no archive when the lookup rejects', async () => {
    generateReactionMap.mockRejectedValueOnce(new Error('Discord answered 502'));
    const store = makeStore();
    const result = await store.dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/rejected');
    expect(result.payload).toBe('Discord answered 502');
    expect(exportToZip).not.toHaveBeenCalled();
    const entries = statusMessages(store);
    expect(entries).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('Discord answered 502') }));
    expect(entries).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('reacted-channel') }));
  });

  it('finishes the export with a warning when some reactor lists were refused (deleted or unreadable)', async () => {
    const partial = { [withReaction.id]: { '👍': [] } };
    generateReactionMap.mockResolvedValueOnce({
      messages: [withReaction], reactionMap: partial, failed: 3, failedMessageIds: [withReaction.id],
      failures: [{ messageId: withReaction.id, emoji: '👍', status: 404 }], signInExpired: false,
    });
    const store = makeStore();
    const result = await store.dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(exportToZip).toHaveBeenCalledTimes(1);
    expect(exportToZip.mock.calls[0]).toContainEqual(partial);
    expect(statusMessages(store)).toContainEqual(expect.objectContaining({ level: 'warning', message: 'Export: Reactor list missing for 1 message (deleted or no longer readable)' }));
  });

  it('fails the export when the sign in expired during the lookup', async () => {
    generateReactionMap.mockResolvedValueOnce({
      messages: [withReaction], reactionMap: {}, failed: 1, failedMessageIds: [withReaction.id],
      failures: [{ messageId: withReaction.id, emoji: '👍', status: 401 }], signInExpired: true,
    });
    const store = makeStore();
    const result = await store.dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/rejected');
    expect(result.payload).toBe('Sign in expired while fetching reaction data');
    expect(exportToZip).not.toHaveBeenCalled();
    expect(statusMessages(store)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('Sign in expired') }));
    expect(statusMessages(store)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('reacted-channel') }));
  });

  it('reports the message of a DOMException the same way', async () => {
    generateReactionMap.mockRejectedValueOnce(new DOMException('storage went away', 'InvalidStateError'));
    const store = makeStore();
    const result = await store.dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/rejected');
    expect(result.payload).toBe('storage went away');
    expect(exportToZip).not.toHaveBeenCalled();
  });

  it('still exports when Reactions is off', async () => {
    const result = await makeStore(false).dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(exportToZip).toHaveBeenCalledTimes(1);
  });

  it('still exports when no message carries a reaction', async () => {
    const result = await makeStore().dispatch(exportMessages({ ...params, messages: [{ ...withReaction, reactions: [] }] }));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(exportToZip).toHaveBeenCalledTimes(1);
  });

  it.each(['json', 'csv', 'text'] as const)('never looks reactors up for a %s export', async (format) => {
    const result = await makeStore().dispatch(exportMessages({ ...params, format }));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(exportToZip).toHaveBeenCalledTimes(1);
  });
});
