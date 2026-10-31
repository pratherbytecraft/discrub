import { describe, it, expect } from 'vitest';
import {
  formatDeleteSummary,
  formatRehydrateEta,
  formatRehydrateEtaBreakdown,
  formatRehydrateInlineSummary,
  formatRehydrateLogSummary,
  deleteSummaryLevel,
  formatProvenanceTooltip,
} from './packageStatusCopy';
import type { DeleteResult } from './packageSlice';

const baseDeleteResult: DeleteResult = {
  deleted: 0,
  alreadyGone: 0,
  forbidden: 0,
  failed: 0,
  cancelled: false,
  deletedIds: [],
  alreadyGoneIds: [],
};

describe('formatDeleteSummary', () => {
  it('reports a clean success with only the deleted count', () => {
    expect(formatDeleteSummary({ ...baseDeleteResult, deleted: 5 })).toBe(
      'Deleted 5 messages.',
    );
  });

  it('uses singular "message" when exactly one was deleted', () => {
    expect(formatDeleteSummary({ ...baseDeleteResult, deleted: 1 })).toBe(
      'Deleted 1 message.',
    );
  });

  it('appends an "already gone" sentence only when alreadyGone > 0', () => {
    expect(
      formatDeleteSummary({ ...baseDeleteResult, deleted: 5, alreadyGone: 2 }),
    ).toBe('Deleted 5 messages. 2 messages were already gone on Discord.');
  });

  it('uses singular "was" for an alreadyGone count of one', () => {
    expect(
      formatDeleteSummary({ ...baseDeleteResult, deleted: 5, alreadyGone: 1 }),
    ).toBe('Deleted 5 messages. 1 message was already gone on Discord.');
  });

  it('replaces HTTP "forbidden" jargon with plain language', () => {
    expect(
      formatDeleteSummary({ ...baseDeleteResult, deleted: 5, forbidden: 1 }),
    ).toBe(
      "Deleted 5 messages. 1 message couldn't be deleted (no permission).",
    );
  });

  it('phrases failures naturally with singular vs plural error noun', () => {
    expect(
      formatDeleteSummary({ ...baseDeleteResult, deleted: 5, failed: 1 }),
    ).toBe('Deleted 5 messages. 1 message had an error.');
    expect(
      formatDeleteSummary({ ...baseDeleteResult, deleted: 5, failed: 3 }),
    ).toBe('Deleted 5 messages. 3 messages had errors.');
  });

  it('combines all non-zero buckets into one readable sentence', () => {
    expect(
      formatDeleteSummary({
        ...baseDeleteResult,
        deleted: 8,
        alreadyGone: 2,
        forbidden: 1,
        failed: 3,
      }),
    ).toBe(
      "Deleted 8 messages. 2 messages were already gone on Discord. 1 message couldn't be deleted (no permission). 3 messages had errors.",
    );
  });

  it('suppresses every zero bucket — the screenshot regression', () => {
    // The exact case from the user's 2026-05-03 screenshot. Banner used
    // to read "Deleted 1, already gone 0, forbidden 0, failed 0." which
    // is what filed Backlog #161 in the first place.
    expect(formatDeleteSummary({ ...baseDeleteResult, deleted: 1 })).toBe(
      'Deleted 1 message.',
    );
  });

  it('leads with failure language when nothing was successfully deleted', () => {
    expect(
      formatDeleteSummary({
        ...baseDeleteResult,
        deleted: 0,
        forbidden: 2,
        failed: 1,
      }),
    ).toBe(
      "Couldn't delete any messages. 2 messages couldn't be deleted (no permission). 1 message had an error.",
    );
  });

  it('appends "(cancelled)" when the run was cancelled', () => {
    expect(
      formatDeleteSummary({
        ...baseDeleteResult,
        deleted: 5,
        cancelled: true,
      }),
    ).toBe('Deleted 5 messages. (cancelled)');
  });

  it('handles a cancelled run that touched nothing', () => {
    expect(
      formatDeleteSummary({ ...baseDeleteResult, cancelled: true }),
    ).toBe('No messages were deleted. (cancelled)');
  });

  it('formats large counts with locale-aware thousands separators', () => {
    expect(
      formatDeleteSummary({ ...baseDeleteResult, deleted: 12345 }),
    ).toBe('Deleted 12,345 messages.');
  });
});

describe('formatRehydrateInlineSummary', () => {
  it('returns just the count when no exceptions exist', () => {
    expect(
      formatRehydrateInlineSummary({ enriched: 50, unavailable: 0, noAccess: 0 }),
    ).toBe('50 messages');
  });

  it('uses singular when exactly one message was loaded', () => {
    expect(
      formatRehydrateInlineSummary({ enriched: 1, unavailable: 0, noAccess: 0 }),
    ).toBe('1 message');
  });

  it('appends "unavailable" only when there are any', () => {
    expect(
      formatRehydrateInlineSummary({ enriched: 50, unavailable: 3, noAccess: 0 }),
    ).toBe('50 messages, 3 unavailable');
  });

  it('appends "no access" only when there are any', () => {
    expect(
      formatRehydrateInlineSummary({ enriched: 50, unavailable: 0, noAccess: 1 }),
    ).toBe('50 messages, 1 no access');
  });

  it('combines all three when all buckets have content', () => {
    expect(
      formatRehydrateInlineSummary({ enriched: 50, unavailable: 3, noAccess: 1 }),
    ).toBe('50 messages, 3 unavailable, 1 no access');
  });
});

describe('formatRehydrateLogSummary', () => {
  it('quotes the channel label and uses sentence form', () => {
    expect(
      formatRehydrateLogSummary({
        channelLabel: 'general',
        enriched: 50,
        unavailable: 0,
        noAccess: 0,
      }),
    ).toBe('Rich data loaded for "general": 50 messages.');
  });

  it('appends "(cancelled)" outside the period', () => {
    expect(
      formatRehydrateLogSummary({
        channelLabel: 'general',
        enriched: 50,
        unavailable: 3,
        noAccess: 1,
        cancelled: true,
      }),
    ).toBe(
      'Rich data loaded for "general": 50 messages, 3 unavailable, 1 no access. (cancelled)',
    );
  });
});

describe('formatRehydrateEta (Backlog #174)', () => {
  // Default search delay used in production is ~1000ms; stress the
  // helper with both fast and slow values so the formatter holds at
  // each duration band (sub-minute → minutes → hours).
  it('returns "<1s" for an empty channel', () => {
    expect(formatRehydrateEta(0, 1000)).toBe('<1s');
  });

  it('rounds sub-minute durations to whole seconds', () => {
    // 30 messages × 1000ms = 30 sec
    expect(formatRehydrateEta(30, 1000)).toBe('~30s');
    // 5 messages × 200ms = 1 sec
    expect(formatRehydrateEta(5, 200)).toBe('~1s');
  });

  it('formats minutes with the "min" suffix between 1 and 60 minutes', () => {
    expect(formatRehydrateEta(60, 1000)).toBe('~1 min');
    expect(formatRehydrateEta(300, 1000)).toBe('~5 min');
    expect(formatRehydrateEta(2700, 1000)).toBe('~45 min');
  });

  it('switches to "Xh Ym" past one hour so multi-hour runs read clearly', () => {
    // 4500 messages × 1000ms = 4500s = 1h 15m
    expect(formatRehydrateEta(4500, 1000)).toBe('~1h 15m');
    // Whole-hour case: 7200s = 2h
    expect(formatRehydrateEta(7200, 1000)).toBe('~2h');
    // 10000 × 1s = 10000s = 2h 47m
    expect(formatRehydrateEta(10000, 1000)).toBe('~2h 47m');
  });
});

describe('formatRehydrateEtaBreakdown (Backlog #174)', () => {
  it('returns a no-op message when there are zero messages', () => {
    expect(formatRehydrateEtaBreakdown(0, 1000)).toBe('No messages to rehydrate.');
  });

  it('describes message count, throughput, and headline ETA', () => {
    const out = formatRehydrateEtaBreakdown(300, 1000);
    expect(out).toContain('300 messages');
    expect(out).toContain('per second');
    expect(out).toContain('~5 min');
    expect(out).toContain('preflight'); // mentions the preflight optimization
  });

  it('localizes large counts with thousands separators', () => {
    const out = formatRehydrateEtaBreakdown(12345, 1000);
    expect(out).toContain('12,345 messages');
  });

  it('uses singular "message" for a one-message channel', () => {
    expect(formatRehydrateEtaBreakdown(1, 1000)).toContain('1 message ');
    expect(formatRehydrateEtaBreakdown(1, 1000)).not.toContain('1 messages');
  });

  it('flips throughput to "X seconds per message" when delays are slow', () => {
    // 5000ms delay = 1 message every 5 seconds
    const out = formatRehydrateEtaBreakdown(10, 5000);
    expect(out).toMatch(/5\.0s per message/);
  });


  describe('#271 already-gone runs', () => {
    it('says nothing was deleted when every message was already gone', () => {
      expect(formatDeleteSummary({ ...baseDeleteResult, alreadyGone: 3 })).toBe(
        'Nothing to delete. All 3 messages were already gone on Discord.',
      );
      expect(formatDeleteSummary({ ...baseDeleteResult, alreadyGone: 1 })).toBe(
        'Nothing to delete. 1 message was already gone on Discord.',
      );
    });

    it('keeps the cancelled suffix on the all-gone sentence', () => {
      expect(formatDeleteSummary({ ...baseDeleteResult, alreadyGone: 2, cancelled: true })).toBe(
        'Nothing to delete. All 2 messages were already gone on Discord. (cancelled)',
      );
    });

    it('falls back to the mixed wording when errors are in the run too', () => {
      expect(formatDeleteSummary({ ...baseDeleteResult, alreadyGone: 2, failed: 1 })).toBe(
        "Couldn't delete any messages. 2 messages were already gone on Discord. 1 message had an error.",
      );
    });
  });
});

describe('deleteSummaryLevel (#271)', () => {
  it('warns on errors and on runs that deleted nothing because everything was gone', () => {
    expect(deleteSummaryLevel({ ...baseDeleteResult, deleted: 3 })).toBe('success');
    expect(deleteSummaryLevel({ ...baseDeleteResult, deleted: 3, alreadyGone: 2 })).toBe('success');
    expect(deleteSummaryLevel({ ...baseDeleteResult, deleted: 0, alreadyGone: 2 })).toBe('warning');
    expect(deleteSummaryLevel({ ...baseDeleteResult, deleted: 3, failed: 1 })).toBe('warning');
    // 2.2.8: a run Discord refused outright is a warning, so a bulk run's log does not read green over a 403 channel.
    expect(deleteSummaryLevel({ ...baseDeleteResult, deleted: 0, forbidden: 2 })).toBe('warning');
    expect(deleteSummaryLevel({ ...baseDeleteResult, deleted: 3, forbidden: 1 })).toBe('warning');
  });
});

describe('formatProvenanceTooltip (#271)', () => {
  it('keeps the old sentence when nothing was already gone', () => {
    expect(formatProvenanceTooltip(1200, 300, 0)).toBe('1,200 in package, 300 deleted via Discrub');
  });

  it('splits deleted via Discrub from already gone', () => {
    expect(formatProvenanceTooltip(1200, 300, 120)).toBe('1,200 in package, 180 deleted via Discrub, 120 already gone');
  });
});
