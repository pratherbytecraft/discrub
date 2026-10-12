import { getDiscordService } from '@services/discordService';
import type { RateLimitInfo } from 'discrub-core/discord-service';
import { wait } from 'discrub-core/common-utils';
import { EmbedType } from 'discrub-core/discord-enum';
import filenamify from 'filenamify';
import { isExtensionMode } from '@/extension/messaging';
import { addStatusEntry } from '@features/status/statusSlice';
import type { Message, Guild } from 'discrub-core/types/discord-types';
import type { ExportReactionMap } from 'discrub-core/types/discrub-types';
import type { MediaDownloadProgress, MediaMaps, MediaConfig } from '@features/export/exportTypes';
import type { StreamingZipService } from './streamingZipService';
import { forEachMessage, toSource, type MessageSource } from './messageSource';
import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS } from '@/constants/mediaExtensions';
import { t } from '@/i18n';

export type ShouldContinueFn = () => Promise<void>;

/** Transport result — matches discrub-core's DiscordApiResponse<Blob> shape. */
export type MediaDownloadResult = { success: boolean; data: Blob | null; status?: number };
export type MediaTransport = (url: string, signal?: AbortSignal) => Promise<MediaDownloadResult>;
export type MediaWarnFn = (message: string) => void;

/**
 * #234 default WARN sink: the status log. Lazy store import mirrors
 * discordService's onRateLimit wiring (store → slices → services → store).
 */
const dispatchStatusWarning: MediaWarnFn = (message) => {
  void import('@/app/store').then(({ store }) => {
    store.dispatch(addStatusEntry({ level: 'warning', message }));
  });
};

/**
 * #232: window of NO byte progress after which a download is abandoned.
 * A stall window (rather than a total-time cap) means a slow connection
 * that is still receiving data never gets cut off, no matter how large
 * the attachment — Discord allows 500MB, which a flat cap structurally
 * fails on slow links — while a dead link still fails fast.
 */
const STALL_TIMEOUT_MS = 30_000;

/**
 * Absolute per-file ceiling. The stall guard alone lets a trickling
 * download (one byte inside every stall window) run forever; this bounds
 * every single file even unattended. Generous by design: cutting off a
 * slow-but-progressing link is the exact failure #232 removed, so this
 * only catches pathological trickles, and Cancel (which aborts the
 * in-flight fetch via the transport's signal) is the responsive path.
 */
const MAX_FILE_DOWNLOAD_MS = 30 * 60_000;

/**
 * Cap on per-item download-failure WARNs, mirroring the #230 render
 * reporter's RENDER_FAILURE_WARN_CAP: an export with hundreds of dead
 * CDN links must not flood the 2000-entry status log. A summary entry
 * carries the total once the cap is passed.
 */
const MEDIA_FAILURE_WARN_CAP = 10;

/**
 * #232 default media transport: streaming fetch with a stall-based abort.
 *
 * Replaces `discordService.downloadFile` (a buffered fetch raced against a
 * flat 10s timer that never aborted the losing fetch — GitHub #12). Parity
 * is preserved with the lib transport it replaces:
 * - jittered searchDelay pacing before each fetch (the lib's
 *   `withDelay('search')`), read off the live DiscordService instance
 * - bounded 429 handling honoring Retry-After, surfaced via `onRateLimit`
 * - resolves to the same `{ success, data }` shape
 */
export async function streamDownloadWithStallGuard(
  url: string,
  signal?: AbortSignal,
): Promise<MediaDownloadResult> {
  const discordService = getDiscordService();

  const baseDelay = discordService.searchDelaySecs;
  if (baseDelay > 0) {
    const min = Math.max(baseDelay - discordService.delayModifierSecs, 0);
    const max = baseDelay + discordService.delayModifierSecs;
    await wait(discordService.calculateRandomNumber(max, min));
  }

  let consecutive429 = 0;
  for (;;) {
    if (signal?.aborted) return { success: false, data: null };
    const controller = new AbortController();
    // F26: the caller's signal (Cancel) must reach the in-flight fetch —
    // pre-change, the pause/cancel gate only ran between files.
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    const ceilingTimer = setTimeout(() => controller.abort(), MAX_FILE_DOWNLOAD_MS);

    try {
      armStallTimer();
      const response = await fetch(url, { signal: controller.signal });

      if (response.status === 429) {
        // Parity with the lib's withRetry (#254): read retry_after from
        // the JSON body, then the Retry-After header, then 1s for CDN
        // 429s that carry neither. Bounded the same way the lib is:
        // past the wait cap or the consecutive limit, give up with a
        // real 429 and let the host stop the operation.
        clearTimeout(stallTimer);
        consecutive429 += 1;
        let retryAfterSecs = 0;
        let source: RateLimitInfo['source'] = 'default';
        let global = false;
        try {
          const body = (await response.json()) as { retry_after?: number; global?: boolean };
          if (typeof body?.retry_after === 'number') { retryAfterSecs = body.retry_after; source = 'json'; }
          global = body?.global === true;
        } catch { /* non-JSON 429 body */ }
        if (!retryAfterSecs) {
          const header = Number(response.headers.get('retry-after'));
          if (header > 0) { retryAfterSecs = header; source = 'header'; } else { retryAfterSecs = 1; }
        }
        const { maxWaitSecs, maxConsecutive } = discordService.rateLimit;
        const capped = retryAfterSecs > maxWaitSecs;
        const info: RateLimitInfo = {
          retryAfter: capped ? maxWaitSecs : retryAfterSecs,
          global,
          source,
          consecutive: consecutive429,
          capped,
        };
        if (capped || consecutive429 >= maxConsecutive) {
          discordService.onRateLimitExceeded?.(info);
          return { success: false, data: null, status: 429 };
        }
        discordService.onRateLimit?.(info.retryAfter, info);
        await wait(info.retryAfter);
        continue;
      }

      if (!response.ok) {
        return { success: false, data: null, status: response.status };
      }

      if (!response.body) {
        // Environment without body streaming — buffered fallback. blob()
        // exposes no byte progress, so stall detection is impossible
        // here; leaving the pre-fetch stall timer armed turned it into a
        // flat 30s total cap that killed actively-progressing downloads
        // (the exact failure class #232 removed). Headers arriving
        // proved the connection alive; the per-file ceiling and the
        // external signal still bound a body that dies mid-transfer.
        clearTimeout(stallTimer);
        const blob = await response.blob();
        return { success: true, data: blob, status: response.status };
      }

      armStallTimer();
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        armStallTimer(); // any byte progress resets the stall clock
      }
      const type = response.headers.get('content-type') || '';
      return {
        success: true,
        data: new Blob(chunks, type ? { type } : undefined),
        status: response.status,
      };
    } catch {
      // Includes the stall/ceiling/external aborts — caller falls back
      // to an external link (or unwinds, when the abort was a Cancel)
      return { success: false, data: null };
    } finally {
      clearTimeout(stallTimer);
      clearTimeout(ceilingTimer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * MediaDownloadService - Orchestrates media downloads with progress tracking
 * Downloads avatars, attachments, emojis, and role icons for offline export
 */
export class MediaDownloadService {
  /**
   * Transport seam (#232): production uses the stall-guard streaming
   * fetch; unit tests inject a stub with the same response shape.
   */
  private transport?: MediaTransport;

  /**
   * WARN seam (#234): production dispatches to the status log; unit tests
   * inject a stub so no store is pulled into the test environment.
   */
  private warn: MediaWarnFn;

  constructor(transport?: MediaTransport, warn?: MediaWarnFn) {
    this.transport = transport;
    this.warn = warn ?? dispatchStatusWarning;
  }

  private maps: MediaMaps = {
    avatarMap: {},
    mediaMap: {},
    emojiMap: {},
    roleMap: {},
  };

  /**
   * Per-instance sequence appended to attachment/embed filenames. Two
   * attachments on the same message download within the same millisecond,
   * so `${messageIndex}_${Date.now()}` alone can collide — which used to
   * kill the whole export at the zip writer (#224).
   */
  private mediaFileSeq = 0;

  /**
   * Count of failed media items this instance has warned about; used by
   * {@link warnMediaFailure} to cap status-log entries (F9) and by
   * {@link flushMediaFailureSummary} to report the real total.
   */
  private mediaFailureCount = 0;

  /** Capped per-item failure WARN — see MEDIA_FAILURE_WARN_CAP. */
  private warnMediaFailure(message: string): void {
    this.mediaFailureCount++;
    if (this.mediaFailureCount <= MEDIA_FAILURE_WARN_CAP) {
      this.warn(message);
    }
  }

  /** Summary WARN for failures the per-item cap suppressed. */
  private flushMediaFailureSummary(): void {
    if (this.mediaFailureCount > MEDIA_FAILURE_WARN_CAP) {
      this.warn(
        `Export: ${this.mediaFailureCount} media files could not be downloaded (first ${MEDIA_FAILURE_WARN_CAP} logged above). The export links to the originals online where possible.`,
      );
    }
  }

  /**
   * Single download attempt through the transport, preserving the HTTP
   * status of a failure so callers can diagnose it (#234). A thrown
   * network/CORS error collapses to `{ success: false }` with no status.
   *
   * F26: when a pause/cancel gate is provided, a watcher polls it while
   * the download runs and aborts the in-flight fetch on Cancel — the
   * between-files gate alone left a trickling download unreachable by
   * Cancel (it re-arms the stall clock on every byte). The gate's
   * CancelledError is rethrown so the operation unwinds exactly as if
   * the between-files gate had fired.
   */
  private async downloadAttempt(
    url: string,
    shouldContinue?: ShouldContinueFn,
  ): Promise<MediaDownloadResult> {
    const transport = this.transport ?? streamDownloadWithStallGuard;
    if (!shouldContinue) {
      try {
        return await transport(url);
      } catch {
        return { success: false, data: null };
      }
    }

    const controller = new AbortController();
    let downloadSettled = false;
    let releaseWatcher: () => void = () => {};
    const settledSignal = new Promise<void>((resolve) => { releaseWatcher = resolve; });
    let cancelError: unknown = null;
    const watcher = (async () => {
      while (!downloadSettled) {
        try {
          await shouldContinue(); // waits out a pause; throws on cancel
        } catch (error) {
          cancelError = error;
          controller.abort();
          return;
        }
        if (downloadSettled) return;
        // Poll sleep is released the instant the download settles so the
        // watcher never adds latency to a completed file.
        await Promise.race([settledSignal, wait(0.5)]);
      }
    })();

    let result: MediaDownloadResult;
    try {
      result = await transport(url, controller.signal);
    } catch {
      result = { success: false, data: null };
    } finally {
      downloadSettled = true;
      releaseWatcher();
    }
    await watcher;
    if (cancelError) throw cancelError;
    return result;
  }

  /**
   * Check if a filename matches the media config filter
   */
  private shouldDownloadFile(filename: string, mediaConfig?: MediaConfig): boolean {
    if (!mediaConfig) return true;

    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (IMAGE_EXTS.includes(ext)) return mediaConfig.images;
    if (VIDEO_EXTS.includes(ext)) return mediaConfig.videos;
    if (AUDIO_EXTS.includes(ext)) return mediaConfig.audio;
    // Non-media files can only be downloaded in extension mode (CDN direct access)
    if (!isExtensionMode()) return false;
    return mediaConfig.other;
  }

  /**
   * Download all media types for the given messages
   */
  async downloadAllMedia(
    messages: Message[] | MessageSource,
    guild: Guild | null,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    mediaConfig?: MediaConfig,
    artistMode?: boolean,
    shouldContinue?: ShouldContinueFn,
    reactionMap?: ExportReactionMap,
  ): Promise<MediaMaps> {
    // 2.2.5 WP6c: every pass walks the source a window at a time.
    const source = toSource(messages);
    // 1. Download avatars (message authors + reaction users)
    await this.downloadAvatars(source, entityName, zipService, onProgress, shouldContinue, reactionMap);

    // 2. Download attachments (filtered by mediaConfig)
    await this.downloadAttachments(source, entityName, zipService, onProgress, mediaConfig, artistMode, shouldContinue);

    // 3. Download custom emojis
    await this.downloadEmojis(source, entityName, zipService, onProgress, shouldContinue);

    // 4. Download stickers (#213)
    await this.downloadStickers(source, entityName, zipService, onProgress, shouldContinue);

    // 5. Download role icons (if guild export)
    if (guild) {
      await this.downloadRoleIcons(guild, entityName, zipService, onProgress, shouldContinue);
    }

    this.flushMediaFailureSummary();
    return this.maps;
  }

  /**
   * Download media only (attachments) without generating content files
   * Used for the "media only" export format
   */
  async downloadMediaOnly(
    messages: Message[] | MessageSource,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    mediaConfig?: MediaConfig,
    artistMode?: boolean,
    shouldContinue?: ShouldContinueFn
  ): Promise<void> {
    await this.downloadAttachments(toSource(messages), entityName, zipService, onProgress, mediaConfig, artistMode, shouldContinue);
    this.flushMediaFailureSummary();
  }

  /**
   * Download user avatars from messages
   */
  private async downloadAvatars(
    messages: MessageSource,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    shouldContinue?: ShouldContinueFn,
    reactionMap?: ExportReactionMap,
  ): Promise<void> {
    // Collect unique user avatars from message authors
    const avatarSet = new Set<string>();
    await forEachMessage(messages, (msg) => {
      if (msg.author?.id && msg.author.avatar) {
        avatarSet.add(`${msg.author.id}/${msg.author.avatar}`);
      }
    });

    // Also collect avatars from reaction users (if reaction enrichment data is available)
    if (reactionMap) {
      for (const msgReactions of Object.values(reactionMap)) {
        for (const reactors of Object.values(msgReactions)) {
          for (const reactor of reactors) {
            if (reactor.id && reactor.avatar) {
              avatarSet.add(`${reactor.id}/${reactor.avatar}`);
            }
          }
        }
      }
    }

    const avatars = Array.from(avatarSet);
    let downloaded = 0;

    for (const idAndAvatar of avatars) {
      if (shouldContinue) await shouldContinue();
      const [userId, avatarHash] = idAndAvatar.split('/');
      const cdnUrl = `https://media.discordapp.net/avatars/${userId}/${avatarHash}.png`;

      if (!this.maps.avatarMap[idAndAvatar]) {
        const result = await this.downloadAttempt(cdnUrl, shouldContinue);
        if (result.success && result.data) {
          const blob = result.data;
          const ext = this.getFileExtension(blob) || 'webp';
          const filePath = `${entityName}/avatars/${userId}/${avatarHash}.${ext}`;
          // Record the path the zip actually stored — addFile renames on
          // collision (#224), and the map must point at the real entry.
          this.maps.avatarMap[idAndAvatar] = await zipService.addFile(blob, filePath);
        } else {
          this.warnMediaFailure(
            `Export: Could not download the avatar for user ${userId} (${result.status ?? 'CORS/network'})`,
          );
          console.warn(`Failed to download avatar: ${cdnUrl}`);
        }
      }

      downloaded++;
      onProgress({
        stage: 'avatars',
        current: downloaded,
        total: avatars.length,
        message: t('status.media.downloadingAvatar', { current: downloaded, total: avatars.length }),
      });
    }
  }

  /**
   * Download message attachments and embedded media
   */
  private async downloadAttachments(
    messages: MessageSource,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    mediaConfig?: MediaConfig,
    artistMode?: boolean,
    shouldContinue?: ShouldContinueFn
  ): Promise<void> {
    // Collect all attachment URLs with type categorization
    const attachmentUrls: Array<{
      url: string;
      downloadUrl: string;
      fallbackUrl?: string;
      messageIndex: number;
      filename: string;
      type: 'attachment' | 'embed-image' | 'embed-video' | 'embed-thumbnail';
      authorName: string;
      timestamp?: string;
    }> = [];

    const useProxyUrl = !isExtensionMode();

    // #234: every media item keeps BOTH its URLs. Web mode leads with the
    // proxy (the direct cdn.discordapp.com URL is CORS-dead there) but the
    // proxy 415s some formats (webp); extension mode leads with the direct
    // URL but external-CDN embeds can be unreachable while the Discord-proxy
    // copy IS fetchable under the extension's discordapp.net host
    // permissions. Either way the other distinct URL is the second leg.
    const resolveLegs = (url: string, proxyUrl?: string) => {
      const downloadUrl = useProxyUrl && proxyUrl ? proxyUrl : url;
      const other = downloadUrl === url ? proxyUrl : url;
      return { downloadUrl, fallbackUrl: other && other !== downloadUrl ? other : undefined };
    };

    // Collect attachment + embed media from a single message-like source.
    // Used for the top-level message AND for each forwarded snapshot's
    // payload (#214) so forwarded attachments/embedded images are downloaded
    // and URL-rewritten exactly like top-level media.
    const collectMedia = (
      source: Pick<Message, 'attachments' | 'embeds'> | Partial<Message> | null | undefined,
      authorName: string,
      index: number,
      timestamp?: string
    ) => {
      if (!source) return;
      const attachments = source.attachments || [];
      attachments.forEach((att) => {
        if (att.url && this.shouldDownloadFile(att.filename || 'unknown', mediaConfig)) {
          attachmentUrls.push({
            url: att.url,
            ...resolveLegs(att.url, att.proxy_url),
            messageIndex: index,
            filename: att.filename || 'unknown',
            type: 'attachment',
            authorName,
            timestamp,
          });
        }
      });

      // Also get media from embeds
      const embeds = source.embeds || [];
      embeds.forEach((embed) => {
        if (embed.image?.url) {
          attachmentUrls.push({
            url: embed.image.url,
            ...resolveLegs(embed.image.url, embed.image.proxy_url),
            messageIndex: index,
            filename: 'embed_image',
            type: 'embed-image',
            authorName,
            timestamp,
          });
        }
        if (embed.video?.url) {
          attachmentUrls.push({
            url: embed.video.url,
            ...resolveLegs(embed.video.url, embed.video.proxy_url),
            messageIndex: index,
            filename: 'embed_video',
            type: 'embed-video',
            authorName,
            timestamp,
          });
        }
        // #219 residue: a gifv embed (Tenor/Giphy) renders as its video —
        // the thumbnail .gif is never referenced by the HTML, so
        // downloading it just plants a dead file in the zip. Skip it
        // whenever the gifv's video is being downloaded instead.
        const isGifvWithVideo = embed.type === EmbedType.GIFV && !!embed.video?.url;
        if (embed.thumbnail?.url && !isGifvWithVideo) {
          attachmentUrls.push({
            url: embed.thumbnail.url,
            ...resolveLegs(embed.thumbnail.url, embed.thumbnail.proxy_url),
            messageIndex: index,
            filename: 'embed_thumbnail',
            type: 'embed-thumbnail',
            authorName,
            timestamp,
          });
        }
      });
    };

    await forEachMessage(messages, (msg, index) => {
      const authorName = msg.author?.username || 'unknown';
      collectMedia(msg, authorName, index, msg.timestamp);

      // #214: forwarded messages (message_reference.type === 1) carry their
      // real payload — including attachments and embedded media — inside
      // message_snapshots[].message, NOT on the top-level message. Without
      // this pass that media is rendered in the feed/HTML but never downloaded,
      // leaving dead CDN links offline. Only snapshot[0] is collected: both the
      // feed and the HTML emitter render only message_snapshots[0], so deeper
      // snapshots would download orphaned files that are never linked.
      collectMedia(msg.message_snapshots?.[0]?.message, authorName, index, msg.timestamp);
    });

    // Report progress even if there are no attachments
    if (attachmentUrls.length === 0) {
      onProgress({
        stage: 'attachments',
        current: 0,
        total: 0,
        message: t('status.media.noAttachments'),
      });
      return;
    }

    let downloaded = 0;

    for (const { url, downloadUrl, fallbackUrl, messageIndex, filename, type, authorName, timestamp } of attachmentUrls) {
      if (shouldContinue) await shouldContinue();
      if (!this.maps.mediaMap[url]) {
        // Try the preferred leg first, then the other distinct URL (#234) —
        // Discord's media proxy reliably serves images but 415s some formats
        // (webp) and has historically been flaky for external video CDNs
        // (Tenor mp4s in particular), while the direct URL's CORS
        // characteristics cut the other way. Both legs run through the same
        // transport, so pacing and 429 handling apply to each attempt.
        const attempts: Array<{ attemptedUrl: string; result: MediaDownloadResult }> = [];
        let blob: Blob | null = null;
        for (const attemptUrl of fallbackUrl ? [downloadUrl, fallbackUrl] : [downloadUrl]) {
          const result = await this.downloadAttempt(attemptUrl, shouldContinue);
          attempts.push({ attemptedUrl: attemptUrl, result });
          if (result.success && result.data) {
            blob = result.data;
            break;
          }
        }
        if (blob) {
          const ext = this.getFileExtension(blob) || this.getExtensionFromFilename(filename);
          const sanitizedFilename = filenamify(`${messageIndex}_${Date.now()}_${this.mediaFileSeq++}.${ext}`, {
            replacement: '_',
          });

          let filePath: string;
          let relativePath: string;
          if (artistMode) {
            const safeAuthor = filenamify(authorName, { replacement: '_' });
            filePath = `${entityName}/media/${safeAuthor}/${sanitizedFilename}`;
            relativePath = `media/${safeAuthor}/${sanitizedFilename}`;
          } else {
            const typeFolder = type === 'attachment' ? 'attachments' : type + 's';
            filePath = `${entityName}/media/${typeFolder}/${sanitizedFilename}`;
            relativePath = `media/${typeFolder}/${sanitizedFilename}`;
          }

          // #235: message-derived media carries the source message's
          // timestamp as its zip modified date (1.x parity).
          const storedPath = await zipService.addFile(
            blob,
            filePath,
            timestamp ? new Date(timestamp) : undefined,
          );
          // Re-derive the relative path from the stored path in case the
          // zip renamed a colliding entry (#224); renames only touch the
          // basename, so stripping the entity prefix stays valid.
          this.maps.mediaMap[url] = storedPath.startsWith(`${entityName}/`)
            ? storedPath.slice(entityName.length + 1)
            : relativePath;
        } else {
          // #234: surface per-leg failure detail in the status log — the
          // proxy leg is any attempt at proxy_url, the direct leg the
          // original url; a missing status means the fetch itself threw
          // (CORS, network, or a stall abort).
          const detail = attempts
            .map(({ attemptedUrl, result }) =>
              `${attemptedUrl === url ? 'direct' : 'proxy'} ${result.status ?? 'CORS/network'}`)
            .join(', ');
          this.warnMediaFailure(`Export: Could not download ${filename} (${detail})`);
          console.warn(
            `[mediaDownloadService] Failed to download ${type}`,
            { original: url, attempted: attempts.map((a) => a.attemptedUrl), detail },
          );
        }
      }

      downloaded++;
      onProgress({
        stage: 'attachments',
        current: downloaded,
        total: attachmentUrls.length,
        message: t('status.media.downloadingAttachment', { current: downloaded, total: attachmentUrls.length }),
      });
    }
  }

  /**
   * Download custom emojis from message content
   */
  private async downloadEmojis(
    messages: MessageSource,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    shouldContinue?: ShouldContinueFn
  ): Promise<void> {
    // Extract custom emoji IDs from message content AND reactions
    const emojiIds = new Set<string>();
    const emojiRegex = /<(a)?:(\w+):(\d+)>/g;

    await forEachMessage(messages, (msg) => {
      // Extract from content
      let match;
      while ((match = emojiRegex.exec(msg.content || '')) !== null) {
        const emojiId = match[3]; // emoji ID
        emojiIds.add(emojiId);
      }

      // Extract from reactions
      msg.reactions?.forEach((reaction) => {
        if (reaction.emoji?.id) {
          emojiIds.add(reaction.emoji.id);
        }
      });
    });

    const emojis = Array.from(emojiIds);

    // Report progress even if there are no emojis
    if (emojis.length === 0) {
      onProgress({
        stage: 'emojis',
        current: 0,
        total: 0,
        message: t('status.media.noEmojis'),
      });
      return;
    }

    let downloaded = 0;

    for (const emojiId of emojis) {
      if (shouldContinue) await shouldContinue();
      // Download as webp with animated parameter
      const cdnUrl = `https://media.discordapp.net/emojis/${emojiId}.webp?animated=true`;

      if (!this.maps.emojiMap[emojiId]) {
        const result = await this.downloadAttempt(cdnUrl, shouldContinue);
        if (result.success && result.data) {
          const blob = result.data;
          const ext = this.getFileExtension(blob) || 'webp';
          const filePath = `${entityName}/emojis/${emojiId}.${ext}`;
          this.maps.emojiMap[emojiId] = await zipService.addFile(blob, filePath);
        } else {
          this.warnMediaFailure(
            `Export: Could not download emoji ${emojiId} (${result.status ?? 'CORS/network'})`,
          );
          console.warn(`Failed to download emoji: ${cdnUrl}`);
        }
      }

      downloaded++;
      onProgress({
        stage: 'emojis',
        current: downloaded,
        total: emojis.length,
        message: t('status.media.downloadingEmoji', { current: downloaded, total: emojis.length }),
      });
    }
  }

  /**
   * Download message stickers into the offline bundle (#213). Raster stickers
   * (PNG/APNG/GIF) become stickers/{id}.{ext}; Lottie (format_type 3) is skipped
   * — it can't be an <img>, so the emitter renders a placeholder instead. The
   * file path is deterministic and matches the exportService sticker emitter.
   */
  private async downloadStickers(
    messages: MessageSource,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    shouldContinue?: ShouldContinueFn
  ): Promise<void> {
    const stickers = new Map<string, { id: string; format_type: number }>();
    await forEachMessage(messages, (msg) => {
      (msg as { sticker_items?: Array<{ id: string; format_type: number }> }).sticker_items?.forEach((s) => {
        if (s.format_type !== 3) stickers.set(s.id, s); // skip Lottie
      });
    });

    const items = Array.from(stickers.values());
    if (items.length === 0) {
      onProgress({ stage: 'stickers', current: 0, total: 0, message: t('status.media.noStickers') });
      return;
    }

    let downloaded = 0;
    for (const s of items) {
      if (shouldContinue) await shouldContinue();
      const ext = s.format_type === 4 ? 'gif' : 'png';
      const cdnUrl = `https://media.discordapp.net/stickers/${s.id}.${ext}`;
      const filePath = `${entityName}/stickers/${s.id}.${ext}`;
      const result = await this.downloadAttempt(cdnUrl, shouldContinue);
      if (result.success && result.data) {
        await zipService.addFile(result.data, filePath);
      } else {
        this.warnMediaFailure(
          `Export: Could not download sticker ${s.id} (${result.status ?? 'CORS/network'})`,
        );
        console.warn(`Failed to download sticker: ${cdnUrl}`);
      }
      downloaded++;
      onProgress({
        stage: 'stickers',
        current: downloaded,
        total: items.length,
        message: t('status.media.downloadingSticker', { current: downloaded, total: items.length }),
      });
    }
  }

  /**
   * Download guild role icons
   */
  private async downloadRoleIcons(
    guild: Guild,
    entityName: string,
    zipService: StreamingZipService,
    onProgress: (progress: MediaDownloadProgress) => void,
    shouldContinue?: ShouldContinueFn
  ): Promise<void> {
    const roles = guild.roles?.filter((r) => r.icon) || [];

    // Report progress even if there are no role icons
    if (roles.length === 0) {
      onProgress({
        stage: 'roles',
        current: 0,
        total: 0,
        message: t('status.media.noRoleIcons'),
      });
      return;
    }

    let downloaded = 0;

    for (const role of roles) {
      if (shouldContinue) await shouldContinue();
      // Canonical key shape (#171): match what the HTML emitters render
      // live so the templates can do a direct roleMap[cdnUrl] lookup
      // without normalization. Discord's CDN serves both .webp?size=20
      // and the .png variants; we read whichever Discord returns and
      // store under the canonical key.
      const cdnUrl = `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.webp?size=20`;

      if (!this.maps.roleMap[cdnUrl]) {
        const result = await this.downloadAttempt(cdnUrl, shouldContinue);
        if (result.success && result.data) {
          const blob = result.data;
          const ext = this.getFileExtension(blob) || 'webp';
          const fileName = filenamify(`${role.name}_${role.id}.${ext}`, { replacement: '_' });
          const filePath = `${entityName}/roles/${fileName}`;
          this.maps.roleMap[cdnUrl] = await zipService.addFile(blob, filePath);
        } else {
          this.warnMediaFailure(
            `Export: Could not download the icon for role ${role.name} (${result.status ?? 'CORS/network'})`,
          );
          console.warn(`Failed to download role icon: ${cdnUrl}`);
        }
      }

      downloaded++;
      onProgress({
        stage: 'roles',
        current: downloaded,
        total: roles.length,
        message: t('status.media.downloadingRoleIcon', { current: downloaded, total: roles.length }),
      });
    }
  }

  /**
   * Detect file extension from MIME type
   */
  private getFileExtension(blob: Blob): string | null {
    const mimeMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'application/pdf': 'pdf',
    };

    return mimeMap[blob.type] || null;
  }

  /**
   * Extract extension from filename
   */
  private getExtensionFromFilename(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : 'bin';
  }

  /**
   * Get the media maps
   */
  getMaps(): MediaMaps {
    return this.maps;
  }
}
