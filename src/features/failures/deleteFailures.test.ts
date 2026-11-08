import { describe, it, expect } from 'vitest';
import { buildFailure, failureFileName, failureKindOf, parseSkipList, serializeFailures, SkipListError, type DeleteFailure } from './deleteFailures';

const BOM = String.fromCharCode(0xfeff);

const refused: DeleteFailure = { messageId: '1111111111', channelId: '200', guildId: 'g1', channelName: '#general', status: 403, code: 50001, kind: 'permanent', at: '2026-11-08T10:00:00.000Z' };
const flaky: DeleteFailure = { messageId: '2222222222', channelId: '200', guildId: null, channelName: 'pal, "the" one', kind: 'retryable', at: '2026-11-08T10:00:01.000Z' };

describe('failureKindOf', () => {
  it('calls no answer, 5xx, 408 and 425 retryable and every refusal permanent', () => {
    expect(failureKindOf(undefined)).toBe('retryable');
    expect(failureKindOf(500)).toBe('retryable');
    expect(failureKindOf(503)).toBe('retryable');
    expect(failureKindOf(408)).toBe('retryable');
    expect(failureKindOf(425)).toBe('retryable');
    expect(failureKindOf(403)).toBe('permanent');
    expect(failureKindOf(400)).toBe('permanent');
    expect(failureKindOf(429)).toBe('permanent');
  });
});

describe('buildFailure', () => {
  it('fills the record and leaves status and code out when there was no answer', () => {
    const f = buildFailure({ messageId: '1', channelId: '2', guildId: 'g', channelName: '#a', status: 403, code: 50001 });
    expect(f).toMatchObject({ messageId: '1', channelId: '2', guildId: 'g', channelName: '#a', status: 403, code: 50001, kind: 'permanent' });
    expect(Number.isNaN(Date.parse(f.at))).toBe(false);
    const g = buildFailure({ messageId: '1', channelId: '2' });
    expect(g).toMatchObject({ guildId: null, channelName: '', kind: 'retryable' });
    expect('status' in g).toBe(false);
    expect('code' in g).toBe(false);
  });
});

describe('serializeFailures', () => {
  it('writes JSON with the time, the version and one row per message', () => {
    const parsed = JSON.parse(serializeFailures([refused, flaky], 'json', '2.2.9'));
    expect(parsed.discrubVersion).toBe('2.2.9');
    expect(typeof parsed.generatedAt).toBe('string');
    expect(parsed.failures).toEqual([refused, flaky]);
  });

  it('writes CSV with a UTF-8 mark, a header and quoted cells', () => {
    const csv = serializeFailures([refused, flaky], 'csv', '2.2.9');
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('messageId,channelId,guildId,channelName,status,code,kind,at');
    expect(lines[1]).toBe('1111111111,200,g1,#general,403,50001,permanent,2026-11-08T10:00:00.000Z');
    expect(lines[2]).toBe('2222222222,200,,"pal, ""the"" one",,,retryable,2026-11-08T10:00:01.000Z');
  });

  it('names the file by date and format', () => {
    expect(failureFileName('json', new Date('2026-11-08T12:00:00Z'))).toBe('discrub-failed-2026-11-08.json');
    expect(failureFileName('csv', new Date('2026-11-08T12:00:00Z'))).toBe('discrub-failed-2026-11-08.csv');
  });
});

describe('parseSkipList', () => {
  it('reads back its own JSON: refused ids to skip, the rest counted as retried', () => {
    const list = parseSkipList(serializeFailures([refused, flaky], 'json', '2.2.9'));
    expect(list).toEqual({ skipIds: ['1111111111'], retryableCount: 1 });
  });

  it('reads back its own CSV, mark and quoted commas included', () => {
    const list = parseSkipList(serializeFailures([refused, flaky], 'csv', '2.2.9'));
    expect(list).toEqual({ skipIds: ['1111111111'], retryableCount: 1 });
  });

  it('takes a bare JSON array and treats a row without a kind as one to skip', () => {
    expect(parseSkipList('[{"messageId":"3333333333"},{"messageId":"3333333333"},{"messageId":"nope"}]')).toEqual({ skipIds: ['3333333333'], retryableCount: 0 });
  });

  it('skips an id listed as both refused and retryable', () => {
    const both = [{ ...flaky, messageId: '1111111111' }, refused];
    expect(parseSkipList(JSON.stringify(both))).toEqual({ skipIds: ['1111111111'], retryableCount: 0 });
  });

  it('refuses a file that is not a failed list', () => {
    expect(() => parseSkipList('')).toThrow(SkipListError);
    expect(() => parseSkipList('{not json')).toThrow(SkipListError);
    expect(() => parseSkipList('{"hello":"world"}')).toThrow(SkipListError);
    expect(() => parseSkipList('name,age\nbob,3')).toThrow(SkipListError);
    expect(() => parseSkipList('messageId,kind\n')).toThrow(SkipListError);
    expect(() => parseSkipList('[]')).toThrow(SkipListError);
  });
});
