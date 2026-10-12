/**
 * Workspace store (2.2.5, backlog #278, plan tooling/plans/V225_MESSAGE_STORE.md).
 *
 * One raw IndexedDB database, `Discrub-workspaces`, opened with
 * `indexedDB.open` rather than idb-keyval because the message rows need
 * a compound key and one index. Three object stores:
 *
 *   rows        key [wid, cid, id]   one message per row, the id zero padded
 *                                    to 20 digits so key order is time order;
 *                                    index `byAuthor` on [wid, cid, authorId, id]
 *   workspaces  key wid              one WorkspaceRecord per workspace, with
 *                                    its conversation records inside
 *   meta        key 'meta'           { lastWid, order }
 *
 * Every write that changes a conversation's rows also updates its count
 * and byte estimate in the workspace record, inside the same transaction,
 * so the two never drift. Reads swallow nothing: a failure here is a real
 * problem the caller has to see. Writes that hit the browser's quota are
 * rethrown as `WorkspaceQuotaError` so the running action can pause with
 * the storage full hold (plan section 10).
 *
 * The public surface works in plain snowflake ids. Padding is internal.
 */

import type { Message } from 'discrub-core/types/discord-types';
import { SortDirection } from 'discrub-core/common-enum';
import {
  DEFAULT_WORKSPACE_COLOR,
  LEGACY_DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  WORKSPACE_SCHEMA_VERSION,
  type Conversation,
  type ConversationSeed,
  type NameRefresh,
  type WorkspaceMeta,
  type WorkspaceRecord,
  type WorkspaceScope,
} from '@features/workspace/workspaceTypes';

export const WORKSPACE_DB_NAME = 'Discrub-workspaces';
export const WORKSPACE_DB_VERSION = 1;

const STORE_ROWS = 'rows';
const STORE_WORKSPACES = 'workspaces';
const STORE_META = 'meta';
const INDEX_BY_AUTHOR = 'byAuthor';
const META_KEY = 'meta';

const SNOWFLAKE_WIDTH = 20;

/** How often `scan` reports progress and checks for a stop. */
const SCAN_PROGRESS_EVERY = 500;

/* ─────────────────── Errors ─────────────────── */

export class WorkspaceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceStoreError';
  }
}

/** A write failed because the browser's storage quota is full. */
export class WorkspaceQuotaError extends WorkspaceStoreError {
  readonly wid: string;
  readonly cid: string | null;

  constructor(wid: string, cid: string | null) {
    super('Browser storage is full');
    this.name = 'WorkspaceQuotaError';
    this.wid = wid;
    this.cid = cid;
  }
}

/**
 * True for the quota failures browsers raise from IndexedDB. The name is
 * the spec'd signal; the legacy code and the message text cover older
 * engines and errors that reached us wrapped.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (code === 22 || code === 1014) return true;
  if (typeof message === 'string') {
    const lower = message.toLowerCase();
    return lower.includes('quotaexceeded') || lower.includes('exceeded the quota') || lower.includes('not enough space');
  }
  return false;
}

/* ─────────────────── Ids and byte estimate ─────────────────── */

/** Zero pads a snowflake so string order matches numeric order. */
export function padSnowflake(id: string): string {
  return id.padStart(SNOWFLAKE_WIDTH, '0');
}

export function unpadSnowflake(padded: string): string {
  const trimmed = padded.replace(/^0+/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * The serialized length of a message, the figure every row, segment and
 * footer in the Workspaces UI is built from (plan section 3.2). It is an
 * estimate; the browser's own usage number is shown beside it when
 * `navigator.storage.estimate()` provides one.
 */
export function estimateMessageBytes(message: Message): number {
  return JSON.stringify(message).length;
}

/* ─────────────────── Row envelope ─────────────────── */

/** What sits in the `rows` store. The message is kept whole inside. */
export interface StoredRow {
  wid: string;
  cid: string;
  /** Padded snowflake, the key segment. */
  id: string;
  /** Mirrors `message.author.id` for the `byAuthor` index. */
  authorId: string;
  message: Message;
}

function toRow(wid: string, cid: string, message: Message): StoredRow {
  return {
    wid,
    cid,
    id: padSnowflake(message.id),
    authorId: message.author?.id ?? '',
    message,
  };
}

/* ─────────────────── Key ranges ─────────────────── */

/**
 * IndexedDB orders keys number < date < string < binary < array, and a
 * shorter array sorts before any longer array sharing its prefix. So
 * `[wid]` is below every `[wid, cid, id]` and `[wid, []]` is above every
 * one of them, which gives a range over a whole workspace without any
 * assumption about what cids look like.
 */
function workspaceRange(wid: string): IDBKeyRange {
  return IDBKeyRange.bound([wid], [wid, []]);
}

function conversationRange(wid: string, cid: string): IDBKeyRange {
  return IDBKeyRange.bound([wid, cid], [wid, cid, []]);
}

function authorRange(wid: string, cid: string, authorId: string): IDBKeyRange {
  return IDBKeyRange.bound([wid, cid, authorId], [wid, cid, authorId, []]);
}

/* ─────────────────── Request and transaction helpers ─────────────────── */

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new WorkspaceStoreError('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new WorkspaceStoreError('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new WorkspaceStoreError('IndexedDB transaction aborted'));
  });
}

/**
 * Runs `work` inside one transaction and waits for it to commit. A quota
 * failure anywhere in it becomes a `WorkspaceQuotaError` naming the
 * workspace and conversation the write was for.
 */
async function withTx<T>(
  mode: IDBTransactionMode,
  stores: string[],
  context: { wid: string; cid: string | null },
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openWorkspaceDatabase();
  const tx = db.transaction(stores, mode);
  const done = txDone(tx);
  let result: T;
  try {
    result = await work(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await done.catch(() => undefined);
    throw mapError(error, context);
  }
  try {
    await done;
  } catch (error) {
    throw mapError(error, context);
  }
  if (mode === 'readwrite') notifyStoreChange();
  return result;
}

/* ─────────────────── Change listeners ─────────────────── */

const storeListeners = new Set<() => void>();

/**
 * Called after every committed write, so the Workspaces popover and the
 * disk bar can refresh their figures. Returns the unsubscribe.
 */
export function onWorkspaceStoreChange(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function notifyStoreChange(): void {
  for (const listener of storeListeners) {
    try {
      listener();
    } catch (error) {
      console.error('[workspace] store listener failed', error);
    }
  }
}

function mapError(error: unknown, context: { wid: string; cid: string | null }): unknown {
  if (error instanceof WorkspaceStoreError) return error;
  if (isQuotaExceededError(error)) return new WorkspaceQuotaError(context.wid, context.cid);
  return error;
}

/* ─────────────────── Open, close, delete ─────────────────── */

let dbPromise: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_ROWS)) {
    const rows = db.createObjectStore(STORE_ROWS, { keyPath: ['wid', 'cid', 'id'] });
    rows.createIndex(INDEX_BY_AUTHOR, ['wid', 'cid', 'authorId', 'id'], { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
    db.createObjectStore(STORE_WORKSPACES, { keyPath: 'wid' });
  }
  if (!db.objectStoreNames.contains(STORE_META)) {
    db.createObjectStore(STORE_META);
  }
}

/**
 * Opens the database once and hands out the same connection. A
 * `versionchange` from another window (an update or a delete) closes it
 * so that window is not blocked; the next call reopens.
 */
export function openWorkspaceDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new WorkspaceStoreError('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new WorkspaceStoreError('Could not open the workspace database'));
    request.onblocked = () => reject(new WorkspaceStoreError('The workspace database is blocked by another window'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

// A page that goes away must not keep the connection open: the next page's
// boot (and a Cypress wipe) would otherwise queue behind a blocked delete.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    void closeWorkspaceDatabase();
  });
}

export async function closeWorkspaceDatabase(): Promise<void> {
  if (!dbPromise) return;
  const pending = dbPromise;
  dbPromise = null;
  try {
    const db = await pending;
    db.close();
  } catch {
    /* never opened */
  }
}

/** Closes the connection and drops the whole database. Used by Reset Discrub and tests. */
export async function deleteWorkspaceDatabase(): Promise<void> {
  await closeWorkspaceDatabase();
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(WORKSPACE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new WorkspaceStoreError('Could not delete the workspace database'));
    request.onblocked = () => resolve();
  });
  notifyStoreChange();
}

/* ─────────────────── Records ─────────────────── */

export function newConversation(cid: string, seed: ConversationSeed): Conversation {
  return {
    cid,
    kind: seed.kind,
    guildId: seed.guildId,
    name: seed.name,
    parentName: seed.parentName ?? null,
    count: 0,
    bytes: 0,
    oldestId: null,
    newestId: null,
    complete: false,
    searchCriteria: null,
    refineCriteria: null,
    order: { order: SortDirection.DESCENDING, orderBy: 'timestamp' },
    pagination: {
      mode: 'paginated',
      lastMessageId: null,
      hasMore: true,
      totalCount: null,
      searchOffset: 0,
      searchBeforeDate: null,
    },
    selectedIds: [],
    scrollAnchorId: null,
    threadTabs: [],
    activeTab: null,
    action: null,
    enrichment: { reactions: 'off', replies: 'off', names: 'off' },
  };
}

/**
 * The conversation record for `cid`, created from `seed` when missing and
 * otherwise brought up to date with the names the seed carries, so a
 * renamed channel or server corrects itself on the next write (2.2.5
 * ws-conv-names). The server name lands in the record's `guilds` map.
 */
function conversationFromSeed(record: WorkspaceRecord, cid: string, seed: ConversationSeed): Conversation {
  const conversation = record.conversations[cid] ?? newConversation(cid, seed);
  conversation.name = seed.name;
  if (seed.guildId) conversation.guildId = seed.guildId;
  if (seed.parentName !== undefined) conversation.parentName = seed.parentName;
  if (seed.guildId && seed.guildName) record.guilds[seed.guildId] = seed.guildName;
  return conversation;
}

const emptyScope = (): WorkspaceScope => ({ tab: null, guildId: null, channelId: null, dmId: null });

function newWorkspaceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface NewWorkspaceInput {
  wid?: string;
  name: string;
  color?: string;
  scope?: WorkspaceScope;
}

export function newWorkspaceRecord(input: NewWorkspaceInput, now = Date.now()): WorkspaceRecord {
  return {
    wid: input.wid ?? newWorkspaceId(),
    name: input.name,
    color: input.color ?? DEFAULT_WORKSPACE_COLOR,
    schema: WORKSPACE_SCHEMA_VERSION,
    appVersion: __APP_VERSION__,
    createdAt: now,
    lastOpened: now,
    bytes: 0,
    scope: input.scope ?? emptyScope(),
    conversations: {},
    bulk: null,
    authors: {},
    guilds: {},
  };
}

/**
 * A workspace written by a different schema stays on disk but is not
 * opened; the popover shows it greyed with the version it needs.
 */
export function isWorkspaceOpenable(record: WorkspaceRecord): boolean {
  return record.schema === WORKSPACE_SCHEMA_VERSION;
}

/* ─────────────────── Meta ─────────────────── */

const emptyMeta = (): WorkspaceMeta => ({ lastWid: null, order: [], defaultWid: null });

async function readMeta(tx: IDBTransaction): Promise<WorkspaceMeta> {
  const stored = await req<WorkspaceMeta | undefined>(tx.objectStore(STORE_META).get(META_KEY));
  return stored ? { ...emptyMeta(), ...stored } : emptyMeta();
}

export function getMeta(): Promise<WorkspaceMeta> {
  return withTx('readonly', [STORE_META], { wid: '', cid: null }, (tx) => readMeta(tx));
}

export function setLastWorkspace(wid: string | null): Promise<void> {
  return withTx('readwrite', [STORE_META], { wid: wid ?? '', cid: null }, async (tx) => {
    const meta = await readMeta(tx);
    tx.objectStore(STORE_META).put({ ...meta, lastWid: wid }, META_KEY);
  });
}

export function setWorkspaceOrder(order: string[]): Promise<void> {
  return withTx('readwrite', [STORE_META], { wid: '', cid: null }, async (tx) => {
    const meta = await readMeta(tx);
    tx.objectStore(STORE_META).put({ ...meta, order: [...order] }, META_KEY);
  });
}

/* ─────────────────── Workspaces ─────────────────── */

async function readWorkspace(tx: IDBTransaction, wid: string): Promise<WorkspaceRecord> {
  const record = await req<WorkspaceRecord | undefined>(tx.objectStore(STORE_WORKSPACES).get(wid));
  if (!record) throw new WorkspaceStoreError(`Workspace ${wid} not found`);
  return withGuilds(record);
}

/** A record written before the `guilds` map existed reads as an empty map. */
function withGuilds(record: WorkspaceRecord): WorkspaceRecord {
  if (!record.guilds) record.guilds = {};
  return record;
}

export function getWorkspace(wid: string): Promise<WorkspaceRecord | null> {
  return withTx('readonly', [STORE_WORKSPACES], { wid, cid: null }, async (tx) => {
    const record = await req<WorkspaceRecord | undefined>(tx.objectStore(STORE_WORKSPACES).get(wid));
    return record ? withGuilds(record) : null;
  });
}

/** Every workspace, in the order the meta row keeps, then by creation for any it does not list. */
export function listWorkspaces(): Promise<WorkspaceRecord[]> {
  return withTx('readonly', [STORE_WORKSPACES, STORE_META], { wid: '', cid: null }, async (tx) => {
    const [records, meta] = await Promise.all([
      req<WorkspaceRecord[]>(tx.objectStore(STORE_WORKSPACES).getAll()),
      readMeta(tx),
    ]);
    const rank = new Map(meta.order.map((wid, i) => [wid, i]));
    return records.map(withGuilds).sort((a, b) => {
      const ra = rank.get(a.wid);
      const rb = rank.get(b.wid);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.createdAt - b.createdAt;
    });
  });
}

/** Writes a new workspace and appends it to the order. Refuses a wid already in use. */
export function createWorkspace(input: NewWorkspaceInput): Promise<WorkspaceRecord> {
  const record = newWorkspaceRecord(input);
  return withTx('readwrite', [STORE_WORKSPACES, STORE_META], { wid: record.wid, cid: null }, async (tx) => {
    const existing = await req<WorkspaceRecord | undefined>(tx.objectStore(STORE_WORKSPACES).get(record.wid));
    if (existing) throw new WorkspaceStoreError(`Workspace ${record.wid} already exists`);
    tx.objectStore(STORE_WORKSPACES).put(record);
    const meta = await readMeta(tx);
    tx.objectStore(STORE_META).put(
      { ...meta, lastWid: meta.lastWid ?? record.wid, order: [...meta.order, record.wid] },
      META_KEY,
    );
    return record;
  });
}

/**
 * Creates Default on first run and answers it every run after. The id is
 * generated and kept in `meta.defaultWid`; a record under the fixed id
 * older builds used is adopted instead of a second Default being made.
 */
export function ensureDefaultWorkspace(now = Date.now()): Promise<WorkspaceRecord> {
  return withTx('readwrite', [STORE_WORKSPACES, STORE_META], { wid: '', cid: null }, async (tx) => {
    const workspaces = tx.objectStore(STORE_WORKSPACES);
    const meta = await readMeta(tx);
    if (meta.defaultWid) {
      const current = await req<WorkspaceRecord | undefined>(workspaces.get(meta.defaultWid));
      if (current) return withGuilds(current);
    }
    const legacy = await req<WorkspaceRecord | undefined>(workspaces.get(LEGACY_DEFAULT_WORKSPACE_ID));
    if (legacy) {
      tx.objectStore(STORE_META).put({ ...meta, defaultWid: legacy.wid }, META_KEY);
      return withGuilds(legacy);
    }
    const record = newWorkspaceRecord({ name: DEFAULT_WORKSPACE_NAME }, now);
    workspaces.add(record);
    tx.objectStore(STORE_META).put(
      { lastWid: meta.lastWid ?? record.wid, order: [...meta.order, record.wid], defaultWid: record.wid },
      META_KEY,
    );
    return record;
  });
}

/** The Default workspace's id. Only valid after `ensureDefaultWorkspace` ran once. */
export async function getDefaultWid(): Promise<string> {
  const meta = await getMeta();
  if (!meta.defaultWid) throw new WorkspaceStoreError('Default workspace not created yet');
  return meta.defaultWid;
}

/**
 * Read, modify, write in one transaction. `mutate` edits the record in
 * place or returns a replacement. Two windows updating the same record
 * are serialised by IndexedDB, so neither sees a stale read.
 */
export function updateWorkspace(
  wid: string,
  mutate: (record: WorkspaceRecord) => WorkspaceRecord | void,
): Promise<WorkspaceRecord> {
  return withTx('readwrite', [STORE_WORKSPACES], { wid, cid: null }, async (tx) => {
    const record = await readWorkspace(tx, wid);
    const next = mutate(record) ?? record;
    tx.objectStore(STORE_WORKSPACES).put(next);
    return next;
  });
}

export function touchWorkspace(wid: string, now = Date.now()): Promise<WorkspaceRecord> {
  return updateWorkspace(wid, (record) => {
    record.lastOpened = now;
  });
}

export function renameWorkspace(wid: string, name: string): Promise<WorkspaceRecord> {
  return updateWorkspace(wid, (record) => {
    record.name = name;
  });
}

/** Removes every row of the workspace and the record itself. Default cannot be deleted. */
export function deleteWorkspace(wid: string): Promise<void> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES, STORE_META], { wid, cid: null }, async (tx) => {
    const meta = await readMeta(tx);
    if (wid === meta.defaultWid) throw new WorkspaceStoreError('The Default workspace cannot be deleted');
    tx.objectStore(STORE_ROWS).delete(workspaceRange(wid));
    tx.objectStore(STORE_WORKSPACES).delete(wid);
    tx.objectStore(STORE_META).put(
      {
        ...meta,
        lastWid: meta.lastWid === wid ? meta.defaultWid : meta.lastWid,
        order: meta.order.filter((w) => w !== wid),
      },
      META_KEY,
    );
  });
}

/** Drops every row in the workspace and zeroes each conversation's count and bytes. The records stay. */
export function clearWorkspaceMessages(wid: string): Promise<WorkspaceRecord> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES], { wid, cid: null }, async (tx) => {
    tx.objectStore(STORE_ROWS).delete(workspaceRange(wid));
    const record = await readWorkspace(tx, wid);
    for (const conversation of Object.values(record.conversations)) {
      resetConversationRows(conversation);
    }
    record.bytes = 0;
    tx.objectStore(STORE_WORKSPACES).put(record);
    return record;
  });
}

/**
 * Copies the record and every row under a new wid. One transaction, so a
 * crash midway leaves nothing behind.
 */
export function duplicateWorkspace(wid: string, name: string, now = Date.now()): Promise<WorkspaceRecord> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES, STORE_META], { wid, cid: null }, async (tx) => {
    const source = await readWorkspace(tx, wid);
    const copy: WorkspaceRecord = {
      ...structuredClone(source),
      wid: newWorkspaceId(),
      name,
      createdAt: now,
      lastOpened: now,
    };
    // An export's run conversations belong to the run, not the copy (2.2.5 WP6c).
    for (const cid of Object.keys(copy.conversations)) {
      if (!isRunCid(cid)) continue;
      copy.bytes = Math.max(0, copy.bytes - copy.conversations[cid].bytes);
      delete copy.conversations[cid];
    }
    copy.bulk = null;
    tx.objectStore(STORE_WORKSPACES).put(copy);
    const rows = tx.objectStore(STORE_ROWS);
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = rows.openCursor(workspaceRange(wid));
      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        const row = cursor.value as StoredRow;
        if (!isRunCid(row.cid)) rows.put({ ...row, wid: copy.wid });
        cursor.continue();
      };
    });
    const meta = await readMeta(tx);
    tx.objectStore(STORE_META).put({ ...meta, order: [...meta.order, copy.wid] }, META_KEY);
    return copy;
  });
}

/**
 * Puts an imported workspace record in place before its rows arrive
 * (2.2.5 WP6b). Every conversation starts at zero rows and the page
 * writes that follow (`writePage`) bring the counts and sizes up, so a
 * stopped import leaves figures that match what is on disk. With
 * `replace`, the workspace's old rows go first; the order keeps its
 * place, a new workspace is appended.
 */
export function installImportedWorkspace(record: WorkspaceRecord, replace: boolean): Promise<WorkspaceRecord> {
  const installed: WorkspaceRecord = withGuilds(structuredClone(record));
  installed.bytes = 0;
  for (const conversation of Object.values(installed.conversations)) {
    conversation.count = 0;
    conversation.bytes = 0;
    conversation.oldestId = null;
    conversation.newestId = null;
  }
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES, STORE_META], { wid: installed.wid, cid: null }, async (tx) => {
    const existing = await req<WorkspaceRecord | undefined>(tx.objectStore(STORE_WORKSPACES).get(installed.wid));
    if (existing && !replace) throw new WorkspaceStoreError(`Workspace ${installed.wid} already exists`);
    if (existing) tx.objectStore(STORE_ROWS).delete(workspaceRange(installed.wid));
    tx.objectStore(STORE_WORKSPACES).put(installed);
    const meta = await readMeta(tx);
    if (!meta.order.includes(installed.wid)) {
      tx.objectStore(STORE_META).put({ ...meta, order: [...meta.order, installed.wid] }, META_KEY);
    }
    return installed;
  });
}

/** A fresh workspace id, for an import kept beside the workspace it matches. */
export function createWorkspaceId(): string {
  return newWorkspaceId();
}

/* ─────────────────── Conversations ─────────────────── */

/**
 * Empties a conversation's row figures. The cursor, selection, scroll
 * anchor, enrichment and any unfinished action pointed at those rows, so
 * they start over too; filters, sort and thread tabs stay.
 */
function resetConversationRows(conversation: Conversation): void {
  const fresh = newConversation(conversation.cid, conversation);
  conversation.count = 0;
  conversation.bytes = 0;
  conversation.oldestId = null;
  conversation.newestId = null;
  conversation.complete = false;
  conversation.pagination = fresh.pagination;
  conversation.selectedIds = [];
  conversation.scrollAnchorId = null;
  conversation.action = null;
  conversation.enrichment = fresh.enrichment;
}

export function getConversation(wid: string, cid: string): Promise<Conversation | null> {
  return withTx('readonly', [STORE_WORKSPACES], { wid, cid }, async (tx) => {
    const record = await req<WorkspaceRecord | undefined>(tx.objectStore(STORE_WORKSPACES).get(wid));
    return record?.conversations[cid] ?? null;
  });
}

/**
 * Read, modify, write of one conversation record. When the record does not
 * exist yet it is created from `seed`; without a seed a missing record is
 * an error, so a filter change on a conversation nobody wrote cannot
 * create a half record.
 */
export function updateConversation(
  wid: string,
  cid: string,
  mutate: (conversation: Conversation) => Conversation | void,
  seed?: ConversationSeed,
): Promise<Conversation> {
  return withTx('readwrite', [STORE_WORKSPACES], { wid, cid }, async (tx) => {
    const record = await readWorkspace(tx, wid);
    let conversation = record.conversations[cid];
    if (seed) conversation = conversationFromSeed(record, cid, seed);
    if (!conversation) throw new WorkspaceStoreError(`Conversation ${cid} not found in workspace ${wid}`);
    const next = mutate(conversation) ?? conversation;
    record.conversations[cid] = next;
    tx.objectStore(STORE_WORKSPACES).put(record);
    return next;
  });
}

/** Drops a conversation's rows; its filters and settings stay. */
export function clearConversation(wid: string, cid: string): Promise<Conversation | null> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES], { wid, cid }, async (tx) => {
    tx.objectStore(STORE_ROWS).delete(conversationRange(wid, cid));
    const record = await readWorkspace(tx, wid);
    const conversation = record.conversations[cid];
    if (!conversation) return null;
    record.bytes = Math.max(0, record.bytes - conversation.bytes);
    resetConversationRows(conversation);
    tx.objectStore(STORE_WORKSPACES).put(record);
    return conversation;
  });
}

/**
 * Brings the workspace's names in line with a server, channel or DM list
 * the app just fetched (2.2.5 ws-conv-names). Only a changed name writes;
 * answers whether anything changed. A conversation whose server or channel
 * is gone keeps its last name.
 */
export function refreshConversationNames(wid: string, names: NameRefresh): Promise<boolean> {
  return withTx('readwrite', [STORE_WORKSPACES], { wid, cid: null }, async (tx) => {
    const record = await readWorkspace(tx, wid);
    let changed = false;
    for (const [guildId, name] of Object.entries(names.guilds ?? {})) {
      if (record.guilds[guildId] !== name) {
        record.guilds[guildId] = name;
        changed = true;
      }
    }
    for (const conversation of Object.values(record.conversations)) {
      const list = conversation.kind === 'channel' ? names.channels : conversation.kind === 'dm' ? names.dms : undefined;
      const name = list?.[conversation.cid];
      if (name !== undefined && name !== conversation.name) {
        conversation.name = name;
        changed = true;
      }
      if (conversation.kind === 'thread' && conversation.parentName && names.channels) {
        const parent = Object.values(record.conversations).find((c) => c.kind === 'channel' && c.threadTabs.includes(conversation.cid));
        const parentName = parent ? names.channels[parent.cid] : undefined;
        if (parentName !== undefined && parentName !== conversation.parentName) {
          conversation.parentName = parentName;
          changed = true;
        }
      }
    }
    if (changed) tx.objectStore(STORE_WORKSPACES).put(record);
    return changed;
  });
}

/** Drops a conversation's rows and its record, the thread tab close case. */
export function deleteConversation(wid: string, cid: string): Promise<void> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES], { wid, cid }, async (tx) => {
    tx.objectStore(STORE_ROWS).delete(conversationRange(wid, cid));
    const record = await readWorkspace(tx, wid);
    const conversation = record.conversations[cid];
    if (!conversation) return;
    record.bytes = Math.max(0, record.bytes - conversation.bytes);
    delete record.conversations[cid];
    tx.objectStore(STORE_WORKSPACES).put(record);
  });
}

/* ─────────────────── Search sets (2.2.5 fix C) ─────────────────── */

/**
 * A search keeps its results beside the conversation's plain rows, under
 * `search:<cid>` with its own record (criteria, search pagination, action).
 * The plain rows under `<cid>` are never touched by a search, so clearing
 * the search returns to them. The record stays out of the popover's list
 * but goes with the workspace into duplicates and workspace files.
 */
export const SEARCH_PREFIX = 'search:';
export const searchCid = (cid: string): string => (cid.startsWith(SEARCH_PREFIX) ? cid : `${SEARCH_PREFIX}${cid}`);
export const isSearchCid = (cid: string): boolean => cid.startsWith(SEARCH_PREFIX);
/** The conversation a key belongs to: `search:<cid>` and `<cid>` both answer `<cid>`. */
export const plainCidOf = (cid: string): string => (isSearchCid(cid) ? cid.slice(SEARCH_PREFIX.length) : cid);

/* ─────────────────── Run conversations (2.2.5 WP6c) ─────────────────── */

/**
 * An export walks its channels into the workspace so it renders from disk
 * and a resumed run skips what finished. Those rows live under run
 * conversations, named by a prefix so they never mix with a conversation
 * the user has open under other filters, stay out of the popover and the
 * workspace file, and are deleted when the run ends.
 */
export const BULK_RUN_PREFIX = 'run:';
export const EXPORT_RUN_PREFIX = 'export:';

export const bulkRunCid = (id: string): string => `${BULK_RUN_PREFIX}${id}`;
export const exportRunCid = (id: string): string => `${EXPORT_RUN_PREFIX}${id}`;

export function isRunCid(cid: string): boolean {
  return cid.startsWith(BULK_RUN_PREFIX) || cid.startsWith(EXPORT_RUN_PREFIX);
}

/** Drops every conversation whose id starts with `prefix`, rows and records, in one transaction. */
export function deleteConversationsWithPrefix(wid: string, prefix: string): Promise<number> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES], { wid, cid: null }, async (tx) => {
    const record = await readWorkspace(tx, wid);
    const cids = Object.keys(record.conversations).filter((cid) => cid.startsWith(prefix));
    for (const cid of cids) {
      tx.objectStore(STORE_ROWS).delete(conversationRange(wid, cid));
      record.bytes = Math.max(0, record.bytes - record.conversations[cid].bytes);
      delete record.conversations[cid];
    }
    if (cids.length > 0) tx.objectStore(STORE_WORKSPACES).put(record);
    return cids.length;
  });
}

/* ─────────────────── Rows ─────────────────── */

export interface WritePageResult {
  /** Rows that were new to the store. A page already on disk adds zero. */
  added: number;
  /** Byte estimate added to the conversation. */
  bytes: number;
  /** Rows on disk for the conversation after the write. */
  count: number;
}

/**
 * Writes one fetched page before it reaches Redux (plan section 7). The
 * conversation's count, bytes, oldest and newest ids are updated in the
 * same transaction. A quota failure rejects with `WorkspaceQuotaError`
 * and leaves the conversation as it was before the page.
 */
export function writePage(
  wid: string,
  cid: string,
  messages: Message[],
  seed?: ConversationSeed,
): Promise<WritePageResult> {
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES], { wid, cid }, async (tx) => {
    const record = await readWorkspace(tx, wid);
    let conversation = record.conversations[cid];
    if (seed) conversation = conversationFromSeed(record, cid, seed);
    if (!conversation) throw new WorkspaceStoreError(`Conversation ${cid} not found in workspace ${wid}`);
    const rows = tx.objectStore(STORE_ROWS);
    let added = 0;
    let bytes = 0;
    let oldest = conversation.oldestId ? padSnowflake(conversation.oldestId) : null;
    let newest = conversation.newestId ? padSnowflake(conversation.newestId) : null;
    for (const message of messages) {
      const row = toRow(wid, cid, message);
      const existing = await req(rows.getKey([wid, cid, row.id]));
      rows.put(row);
      if (existing === undefined) {
        added++;
        bytes += estimateMessageBytes(message);
      }
      if (oldest === null || row.id < oldest) oldest = row.id;
      if (newest === null || row.id > newest) newest = row.id;
    }
    const count = await req(rows.count(conversationRange(wid, cid)));
    conversation.count = count;
    conversation.bytes += bytes;
    conversation.oldestId = oldest ? unpadSnowflake(oldest) : null;
    conversation.newestId = newest ? unpadSnowflake(newest) : null;
    record.conversations[cid] = conversation;
    record.bytes += bytes;
    tx.objectStore(STORE_WORKSPACES).put(record);
    return { added, bytes, count };
  });
}

export interface RowPatch {
  id: string;
  patch: Partial<Message>;
}

/**
 * Shallow merges each patch into its stored message, the enrichment and
 * edit path. Rows that are not on disk are skipped. Returns how many
 * rows changed.
 */
export function patchRows(wid: string, cid: string, patches: RowPatch[]): Promise<number> {
  if (patches.length === 0) return Promise.resolve(0);
  return withTx('readwrite', [STORE_ROWS], { wid, cid }, async (tx) => {
    const rows = tx.objectStore(STORE_ROWS);
    let patched = 0;
    for (const { id, patch } of patches) {
      const key = [wid, cid, padSnowflake(id)];
      const row = await req<StoredRow | undefined>(rows.get(key));
      if (!row) continue;
      const message = { ...row.message, ...patch };
      rows.put({ ...row, authorId: message.author?.id ?? row.authorId, message });
      patched++;
    }
    return patched;
  });
}

/** Removes rows by id and takes their byte estimate off the conversation. Returns how many were removed. */
export function deleteRows(wid: string, cid: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return Promise.resolve(0);
  return withTx('readwrite', [STORE_ROWS, STORE_WORKSPACES], { wid, cid }, async (tx) => {
    const rows = tx.objectStore(STORE_ROWS);
    let removed = 0;
    let bytes = 0;
    for (const id of ids) {
      const key = [wid, cid, padSnowflake(id)];
      const row = await req<StoredRow | undefined>(rows.get(key));
      if (!row) continue;
      rows.delete(key);
      removed++;
      bytes += estimateMessageBytes(row.message);
    }
    if (removed === 0) return 0;
    const record = await readWorkspace(tx, wid);
    const conversation = record.conversations[cid];
    if (conversation) {
      conversation.count = await req(rows.count(conversationRange(wid, cid)));
      conversation.bytes = Math.max(0, conversation.bytes - bytes);
      record.bytes = Math.max(0, record.bytes - bytes);
      if (conversation.count === 0) {
        conversation.oldestId = null;
        conversation.newestId = null;
      } else {
        const [first, last] = await Promise.all([
          req(rows.getKey(conversationRange(wid, cid))),
          firstKey(rows, conversationRange(wid, cid), 'prev'),
        ]);
        conversation.oldestId = first ? unpadSnowflake((first as string[])[2]) : null;
        conversation.newestId = last ? unpadSnowflake(last[2]) : null;
      }
      tx.objectStore(STORE_WORKSPACES).put(record);
    }
    return removed;
  });
}

function firstKey(store: IDBObjectStore, range: IDBKeyRange, direction: IDBCursorDirection): Promise<string[] | null> {
  return new Promise((resolve, reject) => {
    const request = store.openKeyCursor(range, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ? (request.result.primaryKey as string[]) : null);
  });
}

export interface ReadWindowOptions {
  /** Only rows newer than this id (exclusive). */
  afterId?: string;
  /** Only rows older than this id (exclusive). */
  beforeId?: string;
  /** Rows to return, 500 when omitted. */
  limit?: number;
  /** `asc` is oldest first (key order), `desc` newest first. */
  direction?: 'asc' | 'desc';
}

/** Reads a window of messages in id order. Export and the feed read in windows; hydration uses `getMessages`. */
export function readWindow(wid: string, cid: string, options: ReadWindowOptions = {}): Promise<Message[]> {
  const { afterId, beforeId, limit = 500, direction = 'asc' } = options;
  const lower = afterId ? [wid, cid, padSnowflake(afterId)] : [wid, cid];
  const upper = beforeId ? [wid, cid, padSnowflake(beforeId)] : [wid, cid, []];
  const range = IDBKeyRange.bound(lower, upper, afterId !== undefined, beforeId !== undefined);
  return withTx('readonly', [STORE_ROWS], { wid, cid }, async (tx) => {
    const rows = tx.objectStore(STORE_ROWS);
    if (direction === 'asc') {
      const found = await req<StoredRow[]>(rows.getAll(range, limit));
      return found.map((row) => row.message);
    }
    return new Promise<Message[]>((resolve, reject) => {
      const out: Message[] = [];
      const request = rows.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= limit) {
          resolve(out);
          return;
        }
        out.push((cursor.value as StoredRow).message);
        if (out.length >= limit) {
          resolve(out);
          return;
        }
        cursor.continue();
      };
    });
  });
}

/** Messages by id in the order asked, `undefined` where a row is missing. One transaction per call. */
export function getMessages(wid: string, cid: string, ids: string[]): Promise<Array<Message | undefined>> {
  if (ids.length === 0) return Promise.resolve([]);
  return withTx('readonly', [STORE_ROWS], { wid, cid }, async (tx) => {
    const rows = tx.objectStore(STORE_ROWS);
    const found = await Promise.all(ids.map((id) => req<StoredRow | undefined>(rows.get([wid, cid, padSnowflake(id)]))));
    return found.map((row) => row?.message);
  });
}

export function countRows(wid: string, cid: string): Promise<number> {
  return withTx('readonly', [STORE_ROWS], { wid, cid }, (tx) =>
    req(tx.objectStore(STORE_ROWS).count(conversationRange(wid, cid))),
  );
}

/** Ids of the rows a given author wrote, oldest first, from the `byAuthor` index. */
export function readAuthorIds(wid: string, cid: string, authorId: string): Promise<string[]> {
  return withTx('readonly', [STORE_ROWS], { wid, cid }, async (tx) => {
    const keys = await req<IDBValidKey[]>(
      tx.objectStore(STORE_ROWS).index(INDEX_BY_AUTHOR).getAllKeys(authorRange(wid, cid, authorId)),
    );
    return keys.map((key) => unpadSnowflake((key as string[])[2]));
  });
}

export interface ScanOptions {
  /** Called every 500 rows with rows seen and the total. */
  onProgress?: (seen: number, total: number) => void;
  /** Checked every 500 rows; a true stops the scan and returns what matched so far. */
  shouldStop?: () => boolean;
}

export interface ScanResult {
  ids: string[];
  seen: number;
  total: number;
  /** False when `shouldStop` ended the scan early. */
  complete: boolean;
}

/**
 * Walks a conversation's rows oldest first and collects the ids
 * `predicate` accepts. This is the content and attachment name refine,
 * the only refines that need the full objects. Both callbacks must be
 * synchronous: awaiting anything but an IndexedDB request would let the
 * transaction commit under the cursor.
 */
export function scan(
  wid: string,
  cid: string,
  predicate: (message: Message) => boolean,
  options: ScanOptions = {},
): Promise<ScanResult> {
  return withTx('readonly', [STORE_ROWS], { wid, cid }, async (tx) => {
    const rows = tx.objectStore(STORE_ROWS);
    const range = conversationRange(wid, cid);
    const total = await req(rows.count(range));
    return new Promise<ScanResult>((resolve, reject) => {
      const ids: string[] = [];
      let seen = 0;
      const request = rows.openCursor(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          options.onProgress?.(seen, total);
          resolve({ ids, seen, total, complete: true });
          return;
        }
        const row = cursor.value as StoredRow;
        seen++;
        if (predicate(row.message)) ids.push(row.message.id);
        if (seen % SCAN_PROGRESS_EVERY === 0) {
          options.onProgress?.(seen, total);
          if (options.shouldStop?.()) {
            resolve({ ids, seen, total, complete: false });
            return;
          }
        }
        cursor.continue();
      };
    });
  });
}

/* ─────────────────── Per workspace Web Lock ─────────────────── */

const WORKSPACE_LOCK_PREFIX = 'discrub-workspace-';

const heldLocks = new Map<string, () => void>();

function locksApi(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/**
 * Takes the exclusive lock for a workspace so a second window cannot open
 * it (plan section 5.6). Resolves true when this window holds it (or the
 * Locks API is missing, where one window is assumed), false when another
 * window has it. Holding it twice is a no-op.
 */
export function acquireWorkspaceLock(wid: string): Promise<boolean> {
  if (heldLocks.has(wid)) return Promise.resolve(true);
  const locks = locksApi();
  if (!locks) {
    heldLocks.set(wid, () => undefined);
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    locks
      .request(`${WORKSPACE_LOCK_PREFIX}${wid}`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        const held = new Promise<void>((release) => {
          heldLocks.set(wid, release);
        });
        resolve(true);
        return held;
      })
      .catch(() => {
        heldLocks.set(wid, () => undefined);
        resolve(true);
      });
  });
}

export function releaseWorkspaceLock(wid: string): void {
  const release = heldLocks.get(wid);
  if (!release) return;
  heldLocks.delete(wid);
  release();
}

export function holdsWorkspaceLock(wid: string): boolean {
  return heldLocks.has(wid);
}

/** True when another window holds the workspace. Our own hold answers false. */
export function isWorkspaceHeldElsewhere(wid: string): Promise<boolean> {
  if (heldLocks.has(wid)) return Promise.resolve(false);
  const locks = locksApi();
  if (!locks || typeof locks.query !== 'function') return Promise.resolve(false);
  // query() only reads; taking the lock to test it would make a switch in
  // this window, landing at the same moment, look refused (WP5 Cypress).
  const name = `${WORKSPACE_LOCK_PREFIX}${wid}`;
  return locks
    .query()
    .then((snapshot) => (snapshot.held ?? []).some((lock) => lock.name === name))
    .catch(() => false);
}

/* ─────────────────── Browser storage estimate ─────────────────── */

export interface StorageFigures {
  usage: number;
  quota: number;
  /** Quota minus usage, never below zero. */
  remaining: number;
}

/** The browser's own usage and quota, or null where the API is missing or refuses. */
export async function readStorageEstimate(): Promise<StorageFigures | null> {
  try {
    const manager = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!manager || typeof manager.estimate !== 'function') return null;
    const { usage, quota } = await manager.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return null;
    return { usage, quota, remaining: Math.max(0, quota - usage) };
  } catch {
    return null;
  }
}
