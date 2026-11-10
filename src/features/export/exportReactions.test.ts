import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { createTestStore } from '@/test/test-utils';
import { createMockMessage } from '@/test/fixtures';
import appReducer from '@features/app/appSlice';
import { defaultSettings } from '@features/app/storageKeys';
import authReducer from '@features/auth/authSlice';
import cacheReducer from '@features/cache/cacheSlice';
import historyReducer from '@features/history/historySlice';
import statusReducer from '@features/status/statusSlice';
import { getExportService } from '@services/exportService';
import { collectMessages } from '@services/messageSource';
import exportReducer, { exportMessages } from './exportSlice';

const { generateReactionMap } = vi.hoisted(() => ({ generateReactionMap: vi.fn() }));

vi.mock('discrub-core/messages', async (importOriginal) => ({
  ...await importOriginal<typeof import('discrub-core/messages')>(),
  DiscordServiceAdapter: class {},
  ReactionEnrichmentService: class {
    generateReactionMap = generateReactionMap;
  },
}));
vi.mock('@services/exportService', async (importOriginal) => ({
  ...await importOriginal<typeof import('@services/exportService')>(),
  getExportService: vi.fn(),
}));
vi.mock('@services/messageSource', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/messageSource')>();
  return { ...actual, collectMessages: vi.fn(actual.collectMessages) };
});

const message = createMockMessage({
  id: 'message-fixture',
  reactions: [{ count: 1, me: false, emoji: { id: 'emoji-fixture', name: 'wave' } }],
});
const reactionMap = {
  [message.id]: { 'wave:emoji-fixture': [{ id: 'reactor-fixture', burst: false, username: 'fixture', avatar: null }] },
};
const exportToZip = vi.fn();

function makeStore(enabled = true) {
  return createTestStore({
    app: appReducer, auth: authReducer, cache: cacheReducer,
    history: historyReducer, status: statusReducer, export: exportReducer,
  }, {
    app: {
      ...appReducer(undefined, { type: 'init' }),
      settings: { ...defaultSettings, [DiscrubSetting.REACTIONS_ENABLED]: String(enabled) },
    },
    auth: { ...authReducer(undefined, { type: 'init' }), token: 'fixture-token' },
  });
}

const params = {
  messages: [message], channelName: 'fixture-channel', format: 'html' as const,
  messagesPerPage: 100, separateThreads: false, includeMedia: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // These regression tests never make authenticated or unauthenticated requests.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network disabled in this test')));
  generateReactionMap.mockResolvedValue({ messages: [message], reactionMap });
  exportToZip.mockResolvedValue(undefined);
  vi.mocked(getExportService).mockReturnValue({
    exportToZip, setExportThemeSet: vi.fn(), setExportChannelNames: vi.fn(),
    setExportFooterConfig: vi.fn(),
  } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe('HTML reactor list failures', () => {
  it('passes retrieved users to the HTML export', async () => {
    const result = await makeStore().dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).toHaveBeenCalledWith([message]);
    expect(exportToZip.mock.calls[0][15]).toEqual(reactionMap);
  });

  it('rejects and does not write an incomplete archive when user retrieval fails', async () => {
    generateReactionMap.mockRejectedValueOnce(new Error('Reaction API unavailable'));
    const store = makeStore();
    const result = await store.dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/rejected');
    expect(result.payload).toBe('Reaction API unavailable');
    expect(exportToZip).not.toHaveBeenCalled();
    expect(store.getState().status.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('Reaction API unavailable') }),
      expect.objectContaining({ level: 'error', message: expect.stringContaining('Reaction API unavailable') }),
    ]));
  });

  it('also reports a message-source failure before enrichment starts', async () => {
    vi.mocked(collectMessages).mockRejectedValueOnce(new DOMException('Source unavailable', 'InvalidStateError'));
    const store = makeStore();
    const result = await store.dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/rejected');
    expect(result.payload).toBe('Source unavailable');
    expect(exportToZip).not.toHaveBeenCalled();
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(store.getState().status.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('Source unavailable') }),
    ]));
  });

  it('still exports when reactor lookup is disabled', async () => {
    const result = await makeStore(false).dispatch(exportMessages(params));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(exportToZip).toHaveBeenCalledTimes(1);
  });

  it('still exports messages without reactions', async () => {
    const result = await makeStore().dispatch(exportMessages({ ...params, messages: [{ ...message, reactions: [] }] }));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(exportToZip).toHaveBeenCalledTimes(1);
  });

  it.each(['json', 'csv', 'text'] as const)('does not fetch reactor lists for %s', async (format) => {
    const result = await makeStore().dispatch(exportMessages({ ...params, format }));
    expect(result.type).toBe('export/exportMessages/fulfilled');
    expect(generateReactionMap).not.toHaveBeenCalled();
    expect(exportToZip).toHaveBeenCalledTimes(1);
  });
});
