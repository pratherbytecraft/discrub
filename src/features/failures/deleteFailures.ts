/**
 * 2.2.9 (GitHub issue 23): a record of each message a delete run could not
 * delete, the file it is saved as, and the reader for that file when a later
 * run loads it as a skip list.
 */

export type DeleteFailureKind = 'permanent' | 'retryable';
export type DeleteFailureSource = 'purge' | 'package';

export interface DeleteFailure {
  messageId: string;
  channelId: string;
  guildId: string | null;
  channelName: string;
  /** HTTP status Discord answered with; absent when the request never got an answer. */
  status?: number;
  /** Discord's own error code, when the answer carried one. */
  code?: number;
  /** `permanent`: Discord refused, a retry gets the same answer. `retryable`: the connection or Discord's side failed. */
  kind: DeleteFailureKind;
  /** ISO time of the failed request. */
  at: string;
}

/**
 * No answer at all, a 5xx, a 408 or a 425 can pass on their own. Everything
 * else (403, other 4xx, a 429 Discrub already gave up on) is Discord refusing.
 */
export function failureKindOf(status: number | undefined): DeleteFailureKind {
  if (status === undefined) return 'retryable';
  if (status >= 500 || status === 408 || status === 425) return 'retryable';
  return 'permanent';
}

export function buildFailure(input: {
  messageId: string;
  channelId: string;
  guildId?: string | null;
  channelName?: string;
  status?: number;
  code?: number;
}): DeleteFailure {
  return {
    messageId: input.messageId,
    channelId: input.channelId,
    guildId: input.guildId ?? null,
    channelName: input.channelName ?? '',
    ...(typeof input.status === 'number' ? { status: input.status } : {}),
    ...(typeof input.code === 'number' ? { code: input.code } : {}),
    kind: failureKindOf(typeof input.status === 'number' ? input.status : undefined),
    at: new Date().toISOString(),
  };
}

export type FailureFileFormat = 'json' | 'csv';

const CSV_COLUMNS = ['messageId', 'channelId', 'guildId', 'channelName', 'status', 'code', 'kind', 'at'] as const;
const BOM = String.fromCharCode(0xfeff);

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeFailures(failures: readonly DeleteFailure[], format: FailureFileFormat, discrubVersion: string): string {
  if (format === 'csv') {
    const lines = [CSV_COLUMNS.join(',')];
    for (const f of failures) lines.push(CSV_COLUMNS.map((c) => csvCell(f[c])).join(','));
    // The mark at the front makes spreadsheet programs read the file as UTF-8.
    return BOM + lines.join('\r\n') + '\r\n';
  }
  return JSON.stringify({ generatedAt: new Date().toISOString(), discrubVersion, failures }, null, 2);
}

export function failureFileName(format: FailureFileFormat, now: Date = new Date()): string {
  return `discrub-failed-${now.toISOString().slice(0, 10)}.${format}`;
}

export interface SkipList {
  /** Messages Discord refused. A run that loads the list leaves these alone. */
  skipIds: string[];
  /** Messages that failed for a passing reason. They are tried again. */
  retryableCount: number;
}

export class SkipListError extends Error {}

const SNOWFLAKE = /^\d{1,25}$/;

function fromRows(rows: Array<{ messageId?: unknown; kind?: unknown }>): SkipList {
  const skip = new Set<string>();
  const retry = new Set<string>();
  for (const row of rows) {
    const id = typeof row.messageId === 'string' ? row.messageId.trim() : typeof row.messageId === 'number' ? String(row.messageId) : '';
    if (!SNOWFLAKE.test(id)) continue;
    if (row.kind === 'retryable') retry.add(id);
    else skip.add(id);
  }
  for (const id of skip) retry.delete(id);
  if (skip.size === 0 && retry.size === 0) throw new SkipListError('empty');
  return { skipIds: Array.from(skip), retryableCount: retry.size };
}

/** Split one CSV line, honouring quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/**
 * Read a saved failed list, JSON or CSV. Throws `SkipListError` for a file
 * that is neither or that names no message.
 */
export function parseSkipList(text: string): SkipList {
  const body = (text.startsWith(BOM) ? text.slice(1) : text).trim();
  if (!body) throw new SkipListError('empty');
  if (body.startsWith('{') || body.startsWith('[')) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new SkipListError('unreadable'); }
    const rows = Array.isArray(parsed) ? parsed : (parsed as { failures?: unknown }).failures;
    if (!Array.isArray(rows)) throw new SkipListError('unreadable');
    return fromRows(rows.filter((r): r is { messageId?: unknown; kind?: unknown } => typeof r === 'object' && r !== null));
  }
  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idAt = header.indexOf('messageId');
  if (idAt < 0) throw new SkipListError('unreadable');
  const kindAt = header.indexOf('kind');
  return fromRows(lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return { messageId: cells[idAt], kind: kindAt >= 0 ? cells[kindAt]?.trim() : undefined };
  }));
}

/** Hand the list to the browser as a download. */
export function downloadFailures(failures: readonly DeleteFailure[], format: FailureFileFormat, discrubVersion: string): void {
  const blob = new Blob([serializeFailures(failures, format, discrubVersion)], {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = failureFileName(format);
  a.click();
  URL.revokeObjectURL(url);
}
