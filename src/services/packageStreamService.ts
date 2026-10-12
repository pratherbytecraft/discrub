/**
 * Package streaming + IDB-backed lazy reads (Backlog #162, #269).
 *
 * The archive is read once, in chunks, through `packageZipReader`:
 * every entry is classified by its path before anything is inflated,
 * so the Activity folders (most of a real package) never enter memory,
 * and the File is never read whole (Chrome refuses `arrayBuffer()`
 * past about 2 GiB, which is what kept full packages out).
 *
 * Two passes over the source:
 *   1. Read until `user.json` arrives, then stop. Account is first in
 *      Discord's layout, so this is a few KB; it tells us whose
 *      `pkg:*` keys to write.
 *   2. Read everything wanted: avatar, guild.json files, index.json
 *      candidates, and every channel folder's channel.json plus
 *      messages file. A folder is parsed and written to IndexedDB the
 *      moment both of its files have arrived, so peak memory is one
 *      chunk plus one channel.
 *
 * Names are resolved at the end (the index.json may arrive after the
 * channels), then `pkg:meta` is written last as the commit marker.
 *
 * IndexedDB schema (under `Discrub-package`, alongside the existing
 * `enriched:` and `deleted:` namespaces — non-conflicting prefix):
 *
 *   pkg:schema-version      → 1 (singleton, used by future migrations)
 *   pkg:meta:{userId}       → ParsedPackage minus avatarBlobUrl
 *   pkg:msgs:{userId}:{cid} → PackageMessage[]
 *   pkg:avatar:{userId}     → Uint8Array (user avatar) | absent
 */

import { strFromU8 } from 'fflate';
import { storage } from '@/extension/storage';
import { countCsvRows, parseMessagesCsv } from '@/utils/csvParser';
import { parseMessagesJsonDetailed, parseSnowflakeJson } from '@/utils/jsonParser';
import {
  GUILD_CHANNEL_TYPES,
  PACKAGE_CHANNEL_TYPE,
  normalizePackageChannelType,
  type ImportDiagnostics,
  type PackageChannel,
  type PackageChannelType,
  type PackageGuild,
  type PackageMessage,
  type PackageUser,
  type ParsedPackage,
} from '@/features/package/packageTypes';
import { PackageParseError } from './packageValidation';
import { readPackageEntries, readBlobAsArrayBuffer, type PackageZipSource } from './packageZipReader';

export const PKG_SCHEMA_VERSION = 1;

const KEY_SCHEMA = 'pkg:schema-version';
const KEY_META = (userId: string) => `pkg:meta:${userId}`;
const KEY_MSGS = (userId: string, channelId: string) =>
  `pkg:msgs:${userId}:${channelId}`;
const KEY_AVATAR = (userId: string) => `pkg:avatar:${userId}`;

const PKG_PREFIX = 'pkg:';

/**
 * Top-level dirs Discord ships in a package that we never read. Kept as
 * documentation: the reader wants entries by file shape, so anything
 * under these (and anything else unrecognised) is discarded without
 * being inflated.
 */
export const SKIPPED_TOP_DIRS = ['activity', 'activities_e', 'activities_w', 'programs'];

/**
 * Entry shapes the import reads, matched case-insensitively against the
 * full path with an optional single wrapper directory (macOS re-zips).
 * Folder names are not matched, so localised and capitalised layouts
 * (`konto/`, `Messages/`) need no sniffing.
 */
const USER_RE = /^(?:[^/]+\/)?[^/]+\/user\.json$/i;
const AVATAR_RE = /^(?:[^/]+\/)?[^/]+\/avatar\.png$/i;
const GUILD_RE = /^(?:[^/]+\/)?[^/]+\/\d+\/guild\.json$/i;
const INDEX_RE = /^(?:[^/]+\/)?[^/]+\/index\.json$/i;
const CHANNEL_RE = /^((?:[^/]+\/)?[^/]+)\/c?(\d+)\/(channel\.json|messages\.(json|csv))$/i;

export interface StreamProgress {
  current: number;
  total: number;
  path: string;
}

export interface StreamOptions {
  /** One tick per channel written, then avatar, then metadata. */
  onProgress?: (info: StreamProgress) => void;
  /** Compressed bytes read so far, for a determinate progress bar. */
  onBytes?: (readBytes: number, totalBytes: number) => void;
  shouldStop?: () => boolean | Promise<boolean>;
  /** Bytes per push into the ZIP reader. Tests use tiny values. */
  chunkSize?: number;
}

export class PackageStreamCancelledError extends Error {
  constructor() {
    super('Package import cancelled');
    this.name = 'PackageStreamCancelledError';
  }
}

export interface PackageImportResult {
  parsed: ParsedPackage;
  diagnostics: ImportDiagnostics;
}

/**
 * Stream a Discord package into IndexedDB. Returns the parsed metadata
 * plus what the reader saw on the way (#269). The File handle is not
 * retained; every later read is an IDB lookup.
 *
 * Atomicity model: if we throw or `shouldStop` fires, partially-written
 * `pkg:*` keys are cleaned up before re-raising. The `pkg:meta:{userId}`
 * key is the commit marker; it's written last.
 *
 * A NotReadableError from the source (an antivirus scan or a synced
 * folder briefly relocking the file, #203) restarts the whole import
 * once after a short wait.
 */
export async function importPackageToStorage(
  input: File | Blob | ArrayBuffer,
  opts: StreamOptions = {},
): Promise<PackageImportResult> {
  let source: PackageZipSource | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      source ??= await openSource(input);
      return await runImport(source, opts);
    } catch (err) {
      if (!isNotReadable(err) || attempt >= 1) throw err;
      // A fresh stream next time; a pre-read buffer cannot go stale.
      if (!(source instanceof ArrayBuffer)) source = null;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

/** Backward-compatible shape: just the parsed package. */
export async function streamPackageToStorage(
  input: File | Blob | ArrayBuffer,
  opts: StreamOptions = {},
): Promise<ParsedPackage> {
  return (await importPackageToStorage(input, opts)).parsed;
}

/**
 * A Blob that can stream is used as-is (each pass opens a fresh
 * stream). Anything else is read once into memory here so both passes
 * share the bytes and a flaky read is retried at one place.
 */
async function openSource(input: File | Blob | ArrayBuffer): Promise<PackageZipSource> {
  if (input instanceof ArrayBuffer) return input;
  if (typeof (input as Blob).stream === 'function') return input;
  return readBlobAsArrayBuffer(input);
}

function isNotReadable(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'NotReadableError';
}

type RawChannelJson = {
  id?: string | number;
  type?: unknown;
  name?: string;
  guild?: { id?: string; name?: string };
  recipients?: string[];
};

type RawUserJson = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar_hash?: string | null;
  email?: string;
};

type RawGuildJson = {
  id: string;
  name: string;
};

/** What one channel folder produced, before names and types are resolved. */
interface ChannelRecord {
  id: string;
  rawType: unknown;
  rawName: string | null;
  guildId?: string;
  rawGuildName?: string;
  recipients?: string[];
  messageCount: number;
  storedCount: number;
  format: 'json' | 'csv';
  /** Lower-cased parent folder of the channel folder, e.g. `messages`. */
  parent: string;
  sampleRowKeys: string[] | null;
}

interface PendingFolder {
  id: string;
  parent: string;
  channelJson?: Uint8Array;
  messages?: { bytes: Uint8Array; format: 'json' | 'csv' };
}

async function runImport(
  source: PackageZipSource,
  opts: StreamOptions,
): Promise<PackageImportResult> {
  const { onProgress, onBytes, shouldStop, chunkSize } = opts;
  const diagnostics: ImportDiagnostics = {
    entriesSeen: 0,
    channelFoldersSeen: 0,
    channelsBuilt: 0,
    droppedMissingChannelJson: 0,
    droppedMissingMessages: 0,
    droppedUnparsableChannelJson: 0,
    channelsWithNoStoredRows: 0,
    sampleRowKeys: null,
    unrecognizedTypes: 0,
    bytesRead: 0,
  };
  const totalCompressed =
    source instanceof ArrayBuffer ? source.byteLength
    : source instanceof Uint8Array ? source.length
    : source.size;

  // Pass 1: find user.json and stop.
  let user: PackageUser | null = null;
  let userPath = '';
  await readPackageEntries(source, {
    want: (path) => USER_RE.test(path),
    onEntry: (path, bytes) => {
      if (user) return;
      user = parseUserJson(bytes);
      userPath = path.toLowerCase();
    },
    shouldStop: () => user !== null,
    chunkSize,
  });
  if (!user) {
    throw new PackageParseError('Package is missing account/user.json');
  }
  const foundUser: PackageUser = user;
  const userId = foundUser.id;

  if (await shouldHalt(shouldStop)) throw new PackageStreamCancelledError();

  // Any other package's lingering pkg:* entries go now that we know who we are.
  await clearPackageContents();
  await storage.package.set(KEY_SCHEMA, PKG_SCHEMA_VERSION);

  // Pass 2: everything else, written as it arrives.
  const guilds = new Map<string, string>();
  const indexCandidates = new Map<string, Record<string, string | null>>();
  const pending = new Map<string, PendingFolder>();
  const records: ChannelRecord[] = [];
  let avatarBytes: Uint8Array | null = null;
  let processed = 0;
  let cancelled = false;

  const persistFolder = async (folder: PendingFolder) => {
    if (!folder.channelJson || !folder.messages) return;
    const record = await buildChannelRecord(folder, userId);
    if (!record) {
      diagnostics.droppedUnparsableChannelJson++;
      return;
    }
    records.push(record);
    diagnostics.channelsBuilt++;
    if (record.messageCount > 0 && record.storedCount === 0) {
      diagnostics.channelsWithNoStoredRows++;
      diagnostics.sampleRowKeys ??= record.sampleRowKeys;
    }
    processed++;
    onProgress?.({ current: processed, total: processed + 2, path: `messages/${folder.id}` });
    if (await shouldHalt(shouldStop)) cancelled = true;
  };

  try {
    await readPackageEntries(source, {
      want: (path) => {
        diagnostics.entriesSeen++;
        const lower = path.toLowerCase();
        if (lower === userPath) return false;
        return AVATAR_RE.test(path) || GUILD_RE.test(path) || INDEX_RE.test(path) || CHANNEL_RE.test(path);
      },
      onEntry: async (path, bytes) => {
        const channel = CHANNEL_RE.exec(path);
        if (channel) {
          const parent = channel[1].toLowerCase();
          const id = channel[2];
          const file = channel[3].toLowerCase();
          const key = `${parent}/${id}`;
          let folder = pending.get(key);
          if (!folder) {
            folder = { id, parent };
            pending.set(key, folder);
            diagnostics.channelFoldersSeen++;
          }
          if (file === 'channel.json') {
            folder.channelJson = bytes;
          } else {
            folder.messages = { bytes, format: file.endsWith('.csv') ? 'csv' : 'json' };
          }
          if (folder.channelJson && folder.messages) {
            pending.delete(key);
            await persistFolder(folder);
          }
          return;
        }
        if (AVATAR_RE.test(path)) {
          avatarBytes ??= bytes;
          return;
        }
        if (GUILD_RE.test(path)) {
          try {
            const raw = parseSnowflakeJson<RawGuildJson>(strFromU8(bytes));
            if (raw.id && raw.name) guilds.set(String(raw.id), raw.name);
          } catch {
            /* skip malformed guild.json */
          }
          return;
        }
        if (INDEX_RE.test(path)) {
          const parent = path.toLowerCase().replace(/\/index\.json$/, '');
          try {
            const parsed = parseSnowflakeJson<Record<string, string | null>>(strFromU8(bytes));
            if (parsed && typeof parsed === 'object') indexCandidates.set(parent, parsed);
          } catch {
            /* an unreadable index only costs names */
          }
        }
      },
      onBytes: (read, total) => {
        diagnostics.bytesRead = read;
        onBytes?.(read, total);
      },
      shouldStop: () => cancelled,
      chunkSize,
    });
    if (cancelled || (await shouldHalt(shouldStop))) throw new PackageStreamCancelledError();
  } catch (err) {
    await clearPackageContents(userId);
    throw err;
  }

  // Folders that never got both files.
  for (const folder of pending.values()) {
    if (folder.channelJson) diagnostics.droppedMissingMessages++;
    else diagnostics.droppedMissingChannelJson++;
  }

  // The name index is the index.json that sits beside the channel folders.
  const nameIndex = pickNameIndex(indexCandidates, records);

  const channels: PackageChannel[] = records.map((record) => {
    const resolved = resolveChannelType(record, nameIndex[record.id] ?? null);
    if (resolved === PACKAGE_CHANNEL_TYPE.UNKNOWN) diagnostics.unrecognizedTypes++;
    const isOrphan = GUILD_CHANNEL_TYPES.has(resolved) && !record.guildId;
    return {
      id: record.id,
      type: resolved,
      name: record.rawName ?? nameIndex[record.id] ?? null,
      guildId: record.guildId,
      guildName: record.guildId ? record.rawGuildName ?? guilds.get(record.guildId) : undefined,
      recipients: record.recipients,
      messageCount: record.messageCount,
      isOrphan,
    };
  });
  channels.sort((a, b) => b.messageCount - a.messageCount);

  // Avatar — persist the raw bytes and mint a fresh blob URL per load.
  let avatarBlobUrl: string | undefined;
  if (avatarBytes) {
    await storage.package.set(KEY_AVATAR(userId), avatarBytes);
    avatarBlobUrl = makeBlobUrl(new Blob([avatarBytes as BlobPart]));
  }
  processed++;
  onProgress?.({ current: processed, total: processed + 1, path: 'account/avatar.png' });

  const guildList: PackageGuild[] = Array.from(guilds, ([id, name]) => ({ id, name }));
  const totalMessages = channels.reduce((sum, c) => sum + c.messageCount, 0);
  const meta: ParsedPackage = {
    user: foundUser,
    guilds: guildList,
    channels,
    totalMessages,
    packageSizeBytes: totalCompressed,
    isLegacyFormat: records.some((r) => r.format === 'csv'),
    // avatarBlobUrl is intentionally NOT persisted — blob URLs are
    // realm-scoped. Resume rebuilds the URL from the stored bytes.
  };
  await storage.package.set(KEY_META(userId), meta);
  processed++;
  onProgress?.({ current: processed, total: processed, path: 'package metadata' });

  // Best-effort persistence request so browsers don't auto-evict the
  // store under disk pressure. Never gates the import.
  void requestPersistentStorage();

  return { parsed: { ...meta, avatarBlobUrl }, diagnostics };
}

function parseUserJson(bytes: Uint8Array): PackageUser {
  const raw = parseSnowflakeJson<RawUserJson>(strFromU8(bytes));
  if (!raw.id || !raw.username) {
    throw new PackageParseError('account/user.json is malformed');
  }
  return {
    id: String(raw.id),
    username: raw.username,
    globalName: raw.global_name ?? null,
    avatarHash: raw.avatar_hash ?? null,
    email: raw.email,
  };
}

/**
 * Parses one folder's channel.json and messages file, writes the rows
 * to IndexedDB, and returns the record. Null when channel.json does not
 * parse. One JSON.parse per messages file: the raw array length is the
 * channel's message count, the storable rows are what gets written.
 */
async function buildChannelRecord(folder: PendingFolder, userId: string): Promise<ChannelRecord | null> {
  let raw: RawChannelJson;
  try {
    raw = parseSnowflakeJson<RawChannelJson>(strFromU8(folder.channelJson!));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id !== undefined && raw.id !== null && String(raw.id).length > 0 ? String(raw.id) : folder.id;

  const { bytes, format } = folder.messages!;
  const text = strFromU8(bytes);
  let messages: PackageMessage[];
  let messageCount: number;
  let sampleRowKeys: string[] | null = null;
  if (format === 'json') {
    const detailed = parseMessagesJsonDetailed(text);
    messages = detailed.messages;
    messageCount = detailed.rawCount;
    sampleRowKeys = detailed.sampleDroppedKeys;
  } else {
    messages = parseMessagesCsv(text);
    messageCount = countCsvRows(text);
  }
  await storage.package.set(KEY_MSGS(userId, id), messages);

  const recipients = Array.isArray(raw.recipients)
    ? raw.recipients.map((r) => (typeof r === 'object' && r !== null && 'id' in (r as object) ? String((r as { id: unknown }).id) : String(r)))
    : undefined;
  return {
    id,
    rawType: raw.type,
    rawName: typeof raw.name === 'string' ? raw.name : null,
    guildId: raw.guild?.id ? String(raw.guild.id) : undefined,
    rawGuildName: typeof raw.guild?.name === 'string' ? raw.guild.name : undefined,
    recipients,
    messageCount,
    storedCount: messages.length,
    format,
    parent: folder.parent,
    sampleRowKeys,
  };
}

/**
 * #270: the channel type as Discord wrote it, or inferred from the rest
 * of the record when it is missing or unrecognised: recipients with no
 * guild is a DM (two or fewer) or a group DM, an index label starting
 * "Direct Message with" is a DM, a guild id is a text channel, anything
 * else is UNKNOWN.
 */
function resolveChannelType(record: ChannelRecord, indexLabel: string | null): PackageChannelType {
  const normalized = normalizePackageChannelType(record.rawType);
  if (normalized !== null) return normalized;
  if (record.recipients && !record.guildId) {
    return record.recipients.length <= 2 ? PACKAGE_CHANNEL_TYPE.DM : PACKAGE_CHANNEL_TYPE.GROUP_DM;
  }
  if (indexLabel && /^Direct Message with\s/i.test(indexLabel)) return PACKAGE_CHANNEL_TYPE.DM;
  if (record.guildId) return PACKAGE_CHANNEL_TYPE.GUILD_TEXT;
  return PACKAGE_CHANNEL_TYPE.UNKNOWN;
}

/**
 * Discord ships `servers/index.json` beside `messages/index.json`. The
 * one that names channels is the one whose folder produced the channel
 * records (all channel folders share a parent in a real package).
 */
function pickNameIndex(
  candidates: Map<string, Record<string, string | null>>,
  records: ChannelRecord[],
): Record<string, string | null> {
  if (candidates.size === 0) return {};
  const parents = new Map<string, number>();
  for (const r of records) parents.set(r.parent, (parents.get(r.parent) ?? 0) + 1);
  const ranked = Array.from(parents.entries()).sort((a, b) => b[1] - a[1]);
  const merged: Record<string, string | null> = {};
  for (const [parent] of ranked) {
    const index = candidates.get(parent);
    if (index) Object.assign(merged, index);
  }
  if (Object.keys(merged).length > 0) return merged;
  // No channel folder matched a candidate: fall back to the only one.
  return candidates.size === 1 ? Array.from(candidates.values())[0] : {};
}

/**
 * Pure IDB read for one channel's messages. Called from
 * `loadPackageChannelMessages` thunk after `streamPackageToStorage`
 * has populated the store.
 */
export async function loadChannelMessagesFromStorage(
  userId: string,
  channelId: string,
): Promise<PackageMessage[]> {
  const messages = await storage.package.get<PackageMessage[]>(KEY_MSGS(userId, channelId));
  if (!messages) {
    throw new PackageParseError(`messages file missing for channel ${channelId}`);
  }
  return messages;
}

/**
 * Detect a previously-streamed package and rebuild the in-memory
 * ParsedPackage from IDB. Returns null when nothing in IDB matches
 * the requested user.
 */
export async function resumePackageFromStorage(
  userId: string,
): Promise<ParsedPackage | null> {
  const meta = await storage.package.get<ParsedPackage>(KEY_META(userId));
  if (!meta) return null;

  // Rebuild the avatar blob URL — the prior session's URL is dead
  // (blob URLs don't survive a tab close). Bytes were persisted as
  // Uint8Array (see streamPackageToStorage), so wrap them in a fresh
  // Blob and mint a new URL.
  let avatarBlobUrl: string | undefined;
  const bytes = await storage.package.get<Uint8Array>(KEY_AVATAR(userId));
  if (bytes) {
    avatarBlobUrl = makeBlobUrl(new Blob([bytes as BlobPart]));
  }

  return { ...meta, avatarBlobUrl };
}

/**
 * #273: rewrite the stored channel list after a Left Servers recheck or a
 * manual move, so the change survives a reload. Only the channel list
 * changes; counts and everything else in pkg:meta stay as parsed.
 */
export async function updateStoredPackageChannels(
  userId: string,
  channels: PackageChannel[],
): Promise<void> {
  const meta = await storage.package.get<ParsedPackage>(KEY_META(userId));
  if (!meta) return;
  await storage.package.set(KEY_META(userId), { ...meta, channels });
}

/**
 * Wipe the `pkg:*` namespace.
 *
 * - With `userId`, deletes only entries owned by that user (`pkg:meta:{u}`,
 *   `pkg:msgs:{u}:*`, `pkg:avatar:{u}`). Use this on close-package.
 * - Without `userId`, deletes EVERY `pkg:*` key (except schema-version).
 *   Use this at the start of a new import — we only allow one package
 *   loaded at a time, so any other user's lingering data is no-longer-needed.
 *
 * Schema-version key is preserved by both paths so future migration
 * code can rely on it.
 */
export async function clearPackageContents(userId?: string): Promise<void> {
  const all = await storage.package.keys();
  const toClear = all.filter((k) => {
    if (!k.startsWith(PKG_PREFIX)) return false;
    if (k === KEY_SCHEMA) return false;
    if (!userId) return true;
    // Match keys owned by this user. Avatar and meta are exact matches;
    // msgs are prefix matches.
    return (
      k === KEY_META(userId) ||
      k === KEY_AVATAR(userId) ||
      k.startsWith(`pkg:msgs:${userId}:`)
    );
  });
  await Promise.all(toClear.map((k) => storage.package.remove(k)));
}

/**
 * True when at least one `pkg:meta:*` key exists in storage. Used by
 * the LandingPage to surface a "resume previous package" affordance
 * when the user signs in and an authenticated-user-matching package
 * is already on disk.
 */
export async function hasStoredPackage(userId: string): Promise<boolean> {
  const meta = await storage.package.get(KEY_META(userId));
  return meta != null;
}

/* ────────── internal helpers ────────── */

function makeBlobUrl(blob: Blob): string | undefined {
  try {
    if (typeof URL === 'undefined' || !('createObjectURL' in URL)) return undefined;
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

async function shouldHalt(
  shouldStop: StreamOptions['shouldStop'],
): Promise<boolean> {
  if (!shouldStop) return false;
  return await shouldStop();
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    if (typeof navigator.storage.persisted === 'function') {
      const already = await navigator.storage.persisted();
      if (already) return;
    }
    await navigator.storage.persist();
  } catch {
    /* navigator.storage is best-effort; silent failure is fine */
  }
}
