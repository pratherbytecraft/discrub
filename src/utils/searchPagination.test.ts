import { describe, it, expect, vi, beforeEach } from 'vitest';
import { iterateSearchMessagesRedux, nextMilestone } from './searchPagination';
import type { SearchCriteria } from 'discrub-core/types/discrub-types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetchSearchMessageData = vi.fn();
const mockIterateSearchResults = vi.fn();

vi.mock('@/services/discordService', () => ({
  getDiscordService: vi.fn(() => ({
    fetchSearchMessageData: mockFetchSearchMessageData,
    iterateSearchResults: mockIterateSearchResults,
  })),
}));

vi.mock('@features/app/appSlice', () => ({
  selectSearchDelay: vi.fn(() => 1),
  selectDelayModifier: vi.fn(() => 0),
  setOperationHold: vi.fn((payload: unknown) => ({ type: 'app/setOperationHold', payload })),
}));

vi.mock('@features/status/statusSlice', () => ({
  addStatusEntry: vi.fn((payload: unknown) => ({ type: 'status/addStatusEntry', payload })),
}));

vi.mock('@utils/operationLoopUtils', () => ({
  checkCancelled: vi.fn(() => false),
  waitWhilePaused: vi.fn().mockResolvedValue(undefined),
  cancellableDelay: vi.fn().mockResolvedValue(false),
  TRANSIENT_RETRIES: 5,
  // Same predicate as the real helper: no status and 5xx retry, 4xx does not.
  isTransientApiFailure: vi.fn((r: { success: boolean; status?: number }) =>
    !r.success && (r.status === undefined || r.status >= 500)),
  transientRetryDelayMs: vi.fn((attempt: number, base: number) => base * Math.pow(2, attempt)),
  retryBaseDelayMs: vi.fn(() => 1000),
  describeAnswer: vi.fn((r: { status?: number }) =>
    r.status !== undefined ? `Discord answered HTTP ${r.status}` : 'Discord did not answer'),
}));

vi.mock('@utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({ delayMs: 0, delaySec: 0 })),
}));

const baseCriteria: SearchCriteria = {
  userIds: [],
  mentionIds: [],
  selectedHasTypes: [],
  channelIds: [],
  searchMessageContents: [],
  searchAfterDate: null,
  searchBeforeDate: null,
  isPinned: 'null',
} as unknown as SearchCriteria;

const mockGetState: any = vi.fn(() => ({
  app: { settings: { searchDelay2: 1, delayModifier2: 0 }, operationHold: null },
}));

const failedPage = (status?: number) => {
  const err = new Error(`Search request failed (HTTP ${status ?? '?'})`) as Error & { status?: number };
  err.status = status;
  return err;
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('nextMilestone', () => {
  it('returns 5 when current is 0 (small-op step)', () => {
    expect(nextMilestone(0)).toBe(5);
  });

  it('uses a 5-step ladder below 25', () => {
    expect(nextMilestone(1)).toBe(5);
    expect(nextMilestone(4)).toBe(5);
    expect(nextMilestone(5)).toBe(10);
    expect(nextMilestone(7)).toBe(10);
    expect(nextMilestone(20)).toBe(25);
    expect(nextMilestone(24)).toBe(25);
  });

  it('uses a 25-step ladder between 25 and 100', () => {
    expect(nextMilestone(25)).toBe(50);
    expect(nextMilestone(26)).toBe(50);
    expect(nextMilestone(49)).toBe(50);
    expect(nextMilestone(50)).toBe(75);
    expect(nextMilestone(99)).toBe(100);
  });

  it('uses a 100-step ladder at and above 100', () => {
    expect(nextMilestone(100)).toBe(200);
    expect(nextMilestone(101)).toBe(200);
    expect(nextMilestone(250)).toBe(300);
    expect(nextMilestone(999)).toBe(1000);
  });
});

describe('iterateSearchMessagesRedux', () => {
  beforeEach(() => {
    mockFetchSearchMessageData.mockReset();
    mockIterateSearchResults.mockReset();
  });

  it('forwards options to DiscordService.iterateSearchResults and yields each page', async () => {
    const fakePages = [
      { messages: [{ id: 'a' } as any], totalResults: 2, pageIndex: 0, aggregatedCount: 1 },
      { messages: [{ id: 'b' } as any], totalResults: 2, pageIndex: 1, aggregatedCount: 2 },
    ];
    mockIterateSearchResults.mockImplementation(async function* () {
      for (const p of fakePages) yield p;
    });

    const collected: any[] = [];
    for await (const page of iterateSearchMessagesRedux({
      token: 'tok',
      channelId: 'ch',
      guildId: 'g',
      criteria: baseCriteria,
      getState: mockGetState,
    })) {
      collected.push(page);
    }

    expect(collected).toHaveLength(2);
    expect(collected.map((p) => p.messages[0].id)).toEqual(['a', 'b']);

    // Confirm lib helper received the expected options shape
    const call = mockIterateSearchResults.mock.calls[0][0];
    expect(call.token).toBe('tok');
    expect(call.channelId).toBe('ch');
    expect(call.guildId).toBe('g');
    expect(typeof call.shouldStop).toBe('function');
    expect(typeof call.onBetweenPages).toBe('function');
  });

  it('stops yielding when checkCancelled returns true between pages', async () => {
    const opUtils = await import('@utils/operationLoopUtils');
    const checkCancelledMock = vi.mocked(opUtils.checkCancelled);
    // Cancel on the second check (after the first yield has happened)
    checkCancelledMock.mockReturnValueOnce(false);
    checkCancelledMock.mockReturnValue(true);

    mockIterateSearchResults.mockImplementation(async function* () {
      yield { messages: [{ id: '1' } as any], totalResults: 3, pageIndex: 0, aggregatedCount: 1 };
      yield { messages: [{ id: '2' } as any], totalResults: 3, pageIndex: 1, aggregatedCount: 2 };
      yield { messages: [{ id: '3' } as any], totalResults: 3, pageIndex: 2, aggregatedCount: 3 };
    });

    const collected: any[] = [];
    for await (const page of iterateSearchMessagesRedux({
      token: 'tok',
      channelId: 'ch',
      guildId: null,
      criteria: baseCriteria,
      getState: mockGetState,
    })) {
      collected.push(page);
    }

    expect(collected).toHaveLength(1);
    // reset for later tests
    checkCancelledMock.mockReturnValue(false);
  });
});

describe('iterateSearchMessagesRedux page retry (2.2.1)', () => {
  const opts = (dispatch?: (a: unknown) => unknown) => ({
    token: 'tok',
    channelId: 'ch',
    guildId: null,
    criteria: baseCriteria,
    getState: mockGetState,
    dispatch,
  });
  const collect = async (dispatch?: (a: unknown) => unknown) => {
    const pages: any[] = [];
    for await (const page of iterateSearchMessagesRedux(opts(dispatch))) pages.push(page);
    return pages;
  };

  beforeEach(async () => {
    mockIterateSearchResults.mockReset();
    const opUtils = await import('@utils/operationLoopUtils');
    vi.mocked(opUtils.cancellableDelay).mockClear().mockResolvedValue(false);
    vi.mocked(opUtils.checkCancelled).mockReturnValue(false);
  });

  it('retries a dropped request from the oldest message seen and keeps counts continuous', async () => {
    const dispatch = vi.fn();
    mockIterateSearchResults
      .mockImplementationOnce(async function* () {
        yield { messages: [{ id: 'a', timestamp: '2026-01-03T00:00:00Z' }, { id: 'b', timestamp: '2026-01-02T00:00:00Z' }] as any, totalResults: 4, pageIndex: 0, aggregatedCount: 2 };
        throw failedPage(undefined);
      })
      .mockImplementationOnce(async function* () {
        // Discord's max_id boundary can hand the frontier message back once.
        yield { messages: [{ id: 'b', timestamp: '2026-01-02T00:00:00Z' }, { id: 'c', timestamp: '2026-01-01T00:00:00Z' }] as any, totalResults: 2, pageIndex: 0, aggregatedCount: 2 };
        yield { messages: [{ id: 'd', timestamp: '2025-12-31T00:00:00Z' }] as any, totalResults: 2, pageIndex: 1, aggregatedCount: 3 };
      });

    const pages = await collect(dispatch);

    expect(pages.map((p) => p.messages.map((m: any) => m.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(pages.map((p) => p.aggregatedCount)).toEqual([2, 3, 4]);

    expect(mockIterateSearchResults).toHaveBeenCalledTimes(2);
    const second = mockIterateSearchResults.mock.calls[1][0];
    expect(second.criteria.searchBeforeDate).toEqual(new Date('2026-01-02T00:00:00Z'));

    const actions = dispatch.mock.calls.map((c) => c[0]);
    expect(actions[0]).toMatchObject({ type: 'status/addStatusEntry', payload: { level: 'warning' } });
    expect(actions[0].payload.message).toContain('Discord did not answer');
    expect(actions[0].payload.message).toContain('attempt 1/5');
    expect(actions[1]).toMatchObject({ type: 'app/setOperationHold', payload: { kind: 'retryWait', attempt: 1, max: 5 } });
    expect(actions[2]).toEqual({ type: 'app/setOperationHold', payload: null });
  });

  it('waits on the doubling curve and gives up after five retries', async () => {
    const dispatch = vi.fn();
    // eslint-disable-next-line require-yield
    mockIterateSearchResults.mockImplementation(async function* () {
      throw failedPage(503);
    });
    const opUtils = await import('@utils/operationLoopUtils');

    await expect(collect(dispatch)).rejects.toThrow('Search request failed (HTTP 503)');

    expect(mockIterateSearchResults).toHaveBeenCalledTimes(6);
    const waits = vi.mocked(opUtils.cancellableDelay).mock.calls.map((c) => c[0]);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000]);
    const lines = dispatch.mock.calls
      .map((c) => c[0])
      .filter((a) => a.type === 'status/addStatusEntry')
      .map((a) => a.payload.message);
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain('Discord answered HTTP 503');
    expect(lines[4]).toContain('attempt 5/5');
  });

  it('resets the retry budget once a page arrives', async () => {
    const dispatch = vi.fn();
    let calls = 0;
    mockIterateSearchResults.mockImplementation(async function* () {
      calls++;
      // Every odd call serves a page then drops; the budget never runs dry
      // because each page resets it.
      if (calls <= 12) {
        if (calls % 2 === 1) {
          yield { messages: [{ id: `m${calls}`, timestamp: new Date(2026, 0, 20 - calls).toISOString() }] as any, totalResults: 6, pageIndex: 0, aggregatedCount: 1 };
        }
        throw failedPage(502);
      }
    });

    const pages = await collect(dispatch);
    expect(pages).toHaveLength(6);
    expect(mockIterateSearchResults).toHaveBeenCalledTimes(13);
  });

  it('does not retry a 4xx', async () => {
    const dispatch = vi.fn();
    // eslint-disable-next-line require-yield
    mockIterateSearchResults.mockImplementation(async function* () {
      throw failedPage(403);
    });

    await expect(collect(dispatch)).rejects.toThrow('HTTP 403');
    expect(mockIterateSearchResults).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not retry without a dispatch to report through', async () => {
    // eslint-disable-next-line require-yield
    mockIterateSearchResults.mockImplementation(async function* () {
      throw failedPage(undefined);
    });

    await expect(collect()).rejects.toThrow('HTTP ?');
    expect(mockIterateSearchResults).toHaveBeenCalledTimes(1);
  });

  it('ends quietly when the run is cancelled during the retry wait', async () => {
    const dispatch = vi.fn();
    // eslint-disable-next-line require-yield
    mockIterateSearchResults.mockImplementation(async function* () {
      throw failedPage(undefined);
    });
    const opUtils = await import('@utils/operationLoopUtils');
    vi.mocked(opUtils.cancellableDelay).mockResolvedValueOnce(true);

    const pages = await collect(dispatch);
    expect(pages).toEqual([]);
    expect(mockIterateSearchResults).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'app/setOperationHold', payload: null });
  });
});
