import { prepareExportData } from 'discrub-core/export-data-service';
import type { Message, Guild, Channel } from 'discrub-core/types/discord-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import { renderEmojiAsHtml } from 'discrub-core/export-utils';
import { formatContentAsHtml, renderEmbedAsHtml, isBareMediaEmbed } from 'discrub-core/html-formatting-utils';
import {
  formatSystemMessage,
  SystemMessageKind,
} from 'discrub-core/system-messages';

// Inline SVG path data for system-message icons in HTML exports. Sourced
// from Material Icons (Apache 2.0) — same set the in-app MUI icons are
// built on, so exports and in-app feed use visually identical glyphs.
// Using `fill="currentColor"` lets the stylesheet control the color (and
// lets light/dark theme propagate naturally).
const SYSTEM_MESSAGE_ICON_PATHS: Record<SystemMessageKind, string> = {
  [SystemMessageKind.RECIPIENT_ADD]:
    'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
  [SystemMessageKind.RECIPIENT_REMOVE]:
    'M14 8c0-2.21-1.79-4-4-4S6 5.79 6 8s1.79 4 4 4 4-1.79 4-4m3 2v2h6v-2zM2 18v2h16v-2c0-2.66-5.33-4-8-4s-8 1.34-8 4',
  [SystemMessageKind.CALL]:
    'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02z',
  [SystemMessageKind.CHANNEL_EDIT]:
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  [SystemMessageKind.PIN]:
    'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3',
  [SystemMessageKind.JOIN]:
    'm2 22 14-5-9-9zm12.53-9.47 5.59-5.59c.49-.49 1.28-.49 1.77 0l.59.59 1.06-1.06-.59-.59c-1.07-1.07-2.82-1.07-3.89 0l-5.59 5.59zm-4.47-5.65-.59.59 1.06 1.06.59-.59c1.07-1.07 1.07-2.82 0-3.89l-.59-.59-1.06 1.07.59.59c.48.48.48 1.28 0 1.76m7 5-1.59 1.59 1.06 1.06 1.59-1.59c.49-.49 1.28-.49 1.77 0l1.61 1.61 1.06-1.06-1.61-1.61c-1.08-1.07-2.82-1.07-3.89 0m-2-6-3.59 3.59 1.06 1.06 3.59-3.59c1.07-1.07 1.07-2.82 0-3.89l-1.59-1.59-1.06 1.06 1.59 1.59c.48.49.48 1.29 0 1.77',
  [SystemMessageKind.BOOST]:
    'm19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z',
  [SystemMessageKind.CHANNEL_FOLLOW]:
    'M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56m0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9',
  [SystemMessageKind.DISCOVERY]:
    'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  [SystemMessageKind.THREAD]:
    'M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1m-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1',
  [SystemMessageKind.INVITE_REMINDER]:
    'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2m0 14H4V8l8 5 8-5zm-8-7L4 6h16z',
  [SystemMessageKind.AUTO_MOD]:
    'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5z',
  [SystemMessageKind.ROLE_SUBSCRIPTION]:
    'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  [SystemMessageKind.PREMIUM_UPSELL]:
    'M9.68 13.69 12 11.93l2.31 1.76-.88-2.85L15.75 9h-2.84L12 6.19 11.09 9H8.25l2.31 1.84zM20 10c0-4.42-3.58-8-8-8s-8 3.58-8 8c0 2.03.76 3.87 2 5.28V23l6-2 6 2v-7.72c1.24-1.41 2-3.25 2-5.28m-8-6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6 2.69-6 6-6',
  [SystemMessageKind.STAGE]:
    'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72z',
  [SystemMessageKind.APP_PREMIUM]:
    'M9.68 13.69 12 11.93l2.31 1.76-.88-2.85L15.75 9h-2.84L12 6.19 11.09 9H8.25l2.31 1.84zM20 10c0-4.42-3.58-8-8-8s-8 3.58-8 8c0 2.03.76 3.87 2 5.28V23l6-2 6 2v-7.72c1.24-1.41 2-3.25 2-5.28m-8-6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6 2.69-6 6-6',
  [SystemMessageKind.INCIDENT]:
    'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5z',
  [SystemMessageKind.PURCHASE]:
    'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2M1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2',
  [SystemMessageKind.POLL_RESULT]:
    'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M9 17H7v-7h2zm4 0h-2V7h2zm4 0h-2v-4h2z',
  [SystemMessageKind.OTHER]:
    'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8',
};

const getSystemMessageIconHtml = (kind: SystemMessageKind): string => {
  const path =
    SYSTEM_MESSAGE_ICON_PATHS[kind] ??
    SYSTEM_MESSAGE_ICON_PATHS[SystemMessageKind.OTHER];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
};
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { format } from 'date-fns';
import { StreamingZipService } from './streamingZipService';
import type { StreamingZipOptions } from './streamingZipService';
import { MediaDownloadService } from './mediaDownloadService';
import type { MediaDownloadProgress, MediaMaps, MediaConfig, ExportConfig, TextFormatOptions } from '@features/export/exportTypes';
import { defaultTextFormatOptions } from '@features/export/exportTypes';
import { generateTextPage } from 'discrub-core/export-utils';
import type { ShouldContinueFn } from './mediaDownloadService';
import { getUserDisplayData, formatMessageTimestamp, getMessageContent, getForwardedSnapshot } from 'discrub-core/discrub-utils';
import { buildExportPageData, generateEmbeddedJs } from './exportHtmlJs';
import {
  type ExportThemeSet,
  defaultExportThemeSet,
  buildContentThemeCSS,
  buildThemeSelectHtml,
} from './exportThemes';
import {
  type ExportFooterConfig,
  defaultExportFooterConfig,
  buildExportFooterHtml,
} from './exportFooter';
import { getUserRoleColor, getUserRoleIcon } from '@/utils/roleColorUtils';

/**
 * Generate a README.html to include in exported ZIPs explaining how to navigate the export.
 */
/**
 * Plain-text README for the 'text' format. Mirrors generateExportReadme but
 * stays text-only so it lives comfortably alongside the .txt page files.
 */
/** File-type kinds for the inline attachment icons in HTML exports. */
type FileIconKind = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'sticker' | 'file';

export function generatePlainTextReadme(options: {
  isBulk: boolean;
  channelName?: string;
}): string {
  const { isBulk, channelName } = options;
  const lines: string[] = [];
  lines.push('Discrub Export');
  lines.push('==============');
  lines.push('');
  lines.push(`Format: PLAIN TEXT`);
  lines.push('Generated by Discrub (https://github.com/prathercc/discrub)');
  lines.push('');
  lines.push('Getting Started');
  lines.push('---------------');
  if (isBulk) {
    lines.push('Each channel has its own folder containing .txt files. Open any file in');
    lines.push('a text editor.');
  } else if (channelName) {
    lines.push(`Open ${channelName}-page-1.txt in a text editor.`);
  } else {
    lines.push('Open the .txt file(s) in a text editor.');
  }
  lines.push('');
  lines.push('File Structure');
  lines.push('--------------');
  lines.push('*.txt          Exported message data, one or more pages per channel');
  lines.push('threads/       Thread message files (if threads were exported separately)');
  lines.push('');
  return lines.join('\n');
}

export function generateExportReadme(options: {
  format: string;
  isDiscordShell: boolean;
  isBulk: boolean;
  channelName?: string;
}): string {
  const { format, isDiscordShell, isBulk, channelName } = options;

  const shellInstructions = isDiscordShell
    ? `<li><strong>Open <code>shell.html</code></strong>: This is the main entry point. It provides a Discord-like interface with a server sidebar, channel list, and top bar.</li>
      <li><strong>Navigate channels</strong>: ${isBulk ? 'Click channels in the left sidebar to switch between them.' : 'Your exported channel is loaded automatically.'}</li>
      <li><strong>Pick a theme</strong>: Use the theme dropdown in the top bar to restyle the export. It opens in the theme the app was using when you exported.</li>`
    : `<li><strong>Open the HTML file${isBulk ? 's' : ''}</strong>: ${isBulk ? 'Each channel has its own HTML file. Open any of them directly in your browser.' : `Open <code>${channelName || 'the HTML file'}</code> in your browser.`}</li>
      <li><strong>Pick a theme</strong>: Use the theme dropdown in the top-right corner to restyle the export. It opens in the theme the app was using when you exported.</li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Export Guide</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #2e3338; line-height: 1.6; }
    h1 { color: #5865f2; margin-bottom: 4px; }
    h2 { color: #4f5660; margin-top: 28px; }
    code { background: #f2f3f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    .meta { color: #747f8d; font-size: 0.85em; }
    hr { border: none; border-top: 1px solid #e3e5e8; margin: 24px 0; }
    a { color: #5865f2; }
  </style>
</head>
<body>
  <h1>Discrub Export</h1>
  <p class="meta">Format: ${format.toUpperCase()}${isDiscordShell ? ' (Discord Layout)' : ''} · Generated by <a href="https://github.com/prathercc/discrub">Discrub</a></p>
  <hr>

  <h2>Getting Started</h2>
  <ul>
    ${shellInstructions}
  </ul>

  <h2>Viewing on a phone</h2>
  <p>Open this export on a computer. Phone file viewers block the scripts and local media the pages need, so they look empty there. The files are intact; copy the folder to a computer and open ${isDiscordShell ? '<code>shell.html</code>' : 'any <code>.html</code> file'} in a browser.</p>

  <h2>Features</h2>
  <ul>
    <li><strong>Search</strong>: Use the search bar to find messages by content. Matches are highlighted in yellow.</li>
    <li><strong>Pagination</strong>: Large exports are split into pages. Use the navigation buttons at the bottom to move between pages.</li>
    <li><strong>Media</strong>: If media was included, avatars, attachments, and emojis are in the <code>avatars/</code>, <code>media/</code>, and <code>emojis/</code> folders. Images can be clicked to open a full-size lightbox.</li>
    <li><strong>User profiles</strong>: Click any avatar or username to see user details, badges, and message count.</li>
    <li><strong>Reactions</strong>: Click reaction counts to see who reacted (if detailed reaction data was exported).</li>
    <li><strong>Threads</strong>: Thread messages may be in separate files inside a <code>threads/</code> folder.</li>
  </ul>

  <h2>File Structure</h2>
  <ul>
    ${isDiscordShell ? '<li><code>shell.html</code>: Main entry point (Discord layout)</li>' : ''}
    <li><code>*.html</code> / <code>*.csv</code> / <code>*.json</code>: Exported message data</li>
    <li><code>avatars/</code>: Downloaded user avatars</li>
    <li><code>media/</code>: Downloaded attachments (images, videos, audio)</li>
    <li><code>emojis/</code>: Downloaded custom emojis</li>
    <li><code>threads/</code>: Thread message files (if threads were exported separately)</li>
  </ul>
</body>
</html>`;
}

/**
 * Export service - handles message export to various formats with ZIP packaging
 */
class ExportService {
  /**
   * Prepare export data using discrub-core prepareExportData
   */
  prepareExportData = prepareExportData;

  /**
   * Theme set baked into generated HTML (slot E). The export thunks
   * set this from app state (active theme + supporter validity) before
   * each export; the default matches pre-theming behavior. A field
   * rather than a parameter because generateHTMLPageParts' positional
   * signature is already fourteen arguments deep.
   */
  private exportThemeSet: ExportThemeSet = defaultExportThemeSet();

  setExportThemeSet(themeSet: ExportThemeSet): void {
    this.exportThemeSet = themeSet;
  }

  getExportThemeSet(): ExportThemeSet {
    return this.exportThemeSet;
  }

  /**
   * Footer baked into generated HTML (slot F) — same baked-field
   * pattern and lifecycle as the theme set above.
   */
  private exportFooterConfig: ExportFooterConfig = defaultExportFooterConfig();

  setExportFooterConfig(config: ExportFooterConfig): void {
    this.exportFooterConfig = config;
  }

  getExportFooterConfig(): ExportFooterConfig {
    return this.exportFooterConfig;
  }

  /**
   * Export messages to ZIP file with optional media download
   */
  /**
   * Export media files only (no HTML/CSV/JSON content)
   */
  async exportMediaOnly(
    messages: Message[],
    channelName: string,
    mediaConfig?: MediaConfig,
    onProgress?: (progress: MediaDownloadProgress | number) => void,
    exportConfig?: ExportConfig,
    shouldContinue?: ShouldContinueFn,
    externalZipService?: StreamingZipService,
    zipOptions?: StreamingZipOptions
  ): Promise<void> {
    const sanitizedName = this.sanitizeFilename(channelName);
    const zipService = externalZipService ?? new StreamingZipService(sanitizedName, zipOptions);
    const ownsZip = !externalZipService;

    try {
      const mediaService = new MediaDownloadService();

      await mediaService.downloadMediaOnly(
        messages,
        sanitizedName,
        zipService,
        (progress) => {
          if (typeof onProgress === 'function') {
            onProgress(progress);
          }
        },
        mediaConfig,
        exportConfig?.artistMode,
        shouldContinue
      );

      if (ownsZip) {
        if (typeof onProgress === 'function') {
          onProgress({
            stage: 'finalizing',
            current: 1,
            total: 1,
            message: 'Finalizing media export...',
          });
        }

        await zipService.finalize();
      }
    } catch (error) {
      if (ownsZip) await zipService.cancel();
      throw error;
    }
  }

  /**
   * Export messages to ZIP file with optional media download
   */
  async exportToZip(
    messages: Message[],
    channelName: string,
    exportFormat: 'html' | 'csv' | 'json' | 'text',
    messagesPerPage: number,
    includeMedia: boolean,
    guild: Guild | null,
    cachedUserMap: ExportUserMap,
    guildId: string | null,
    onProgress?: (progress: MediaDownloadProgress | number) => void,
    mediaConfig?: MediaConfig,
    exportConfig?: ExportConfig,
    shouldContinue?: ShouldContinueFn,
    externalZipService?: StreamingZipService,
    separateThreads?: boolean,
    threads?: Channel[],
    reactionMap?: import('discrub-core/types/discrub-types').ExportReactionMap,
    guildRoles?: any[],
    textOptions?: TextFormatOptions,
    zipOptions?: StreamingZipOptions,
    onRowError?: (messageId: string, error: unknown) => void,
  ): Promise<void> {
    const textOpts: TextFormatOptions = textOptions ?? defaultTextFormatOptions;
    const sanitizedName = this.sanitizeFilename(channelName);
    const zipService = externalZipService ?? new StreamingZipService(sanitizedName, zipOptions);
    const ownsZip = !externalZipService;

    // Sort messages based on exportConfig.sortOrder before pagination
    const sortedMessages = [...messages];
    if (exportConfig?.sortOrder === 'ascending') {
      sortedMessages.sort((a, b) =>
        new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
      );
    } else {
      // Default 'descending' - newest first
      sortedMessages.sort((a, b) =>
        new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
      );
    }

    try {
      let mediaMaps: MediaMaps | null = null;

      // Phase 1: Download media if requested
      if (includeMedia) {
        const mediaService = new MediaDownloadService();

        mediaMaps = await mediaService.downloadAllMedia(
          sortedMessages,
          guild,
          sanitizedName,
          zipService,
          (progress) => {
            if (typeof onProgress === 'function') {
              onProgress(progress);
            }
          },
          mediaConfig,
          exportConfig?.artistMode,
          shouldContinue,
          reactionMap,
        );
      }

      // Check cancel between phases
      if (shouldContinue) await shouldContinue();

      // Phase 2: Generate HTML/CSV/JSON with local paths
      const exportData = prepareExportData({
        messages: sortedMessages,
        messagesPerPage,
        entityName: sanitizedName,
        entityMainDirectory: sanitizedName,
        format: exportFormat,
        threads: threads || [],
        separateThreads: separateThreads || false,
      });

      const threadPages = exportData.threadExports.reduce((sum, te) => sum + te.pages.length, 0);
      const totalPages = exportData.totalPages + threadPages;
      let processedPages = 0;

      // Build formatting context once (needed for HTML, shared between main pages and threads)
      let formattingContext: HtmlFormattingContext | null = null;
      if (exportFormat === 'html') {
        formattingContext = this.buildFormattingContext(
          messages, guild, cachedUserMap, guildId, mediaMaps, sanitizedName, guildRoles
        );
      }

      // Generate files based on format
      if (exportFormat === 'json') {
        for (const page of exportData.mainPages) {
          if (shouldContinue) await shouldContinue();
          const parts = this.buildJSONPageParts(page.messages, onRowError);
          const filename = `${sanitizedName}-page-${page.pageNumber}.json`;
          const blob = new Blob(parts, { type: 'application/json' });
          await zipService.addFile(blob, `${sanitizedName}/${filename}`);
          processedPages++;

          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'html',
              current: processedPages,
              total: totalPages,
              message: `Generated JSON page ${processedPages}/${totalPages}`,
            });
          }
        }
      } else if (exportFormat === 'csv') {
        for (const page of exportData.mainPages) {
          if (shouldContinue) await shouldContinue();
          const parts = this.buildCSVPageParts(page.messages, cachedUserMap, guildId, exportConfig, onRowError);
          const filename = `${sanitizedName}-page-${page.pageNumber}.csv`;
          const blob = new Blob(parts, { type: 'text/csv' });
          await zipService.addFile(blob, `${sanitizedName}/${filename}`);
          processedPages++;

          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'html',
              current: processedPages,
              total: totalPages,
              message: `Generated CSV page ${processedPages}/${totalPages}`,
            });
          }
        }
      } else if (exportFormat === 'text') {
        for (const page of exportData.mainPages) {
          if (shouldContinue) await shouldContinue();
          const parts = this.buildTextPageParts(page.messages, {
            cachedUserMap,
            guildId,
            exportConfig,
            mediaMaps,
            textOptions: textOpts,
          }, onRowError);
          const filename = `${sanitizedName}-page-${page.pageNumber}.txt`;
          const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
          await zipService.addFile(blob, `${sanitizedName}/${filename}`);
          processedPages++;

          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'html',
              current: processedPages,
              total: totalPages,
              message: `Generated text page ${processedPages}/${totalPages}`,
            });
          }
        }
      } else {
        // HTML - multiple pages
        for (const page of exportData.mainPages) {
          if (shouldContinue) await shouldContinue();
          // #185 Bug B: parts-array variant. Each per-message HTML row
          // stays its own Blob part; Blob stitches them together
          // without ever allocating one mega-string that could cross
          // V8's ~512MB cap.
          const pageParts = this.generateHTMLPageParts(
            page.messages,
            channelName,
            page.pageNumber,
            totalPages,
            mediaMaps,
            sanitizedName,
            formattingContext!,
            exportConfig,
            undefined,
            reactionMap,
            cachedUserMap,
            guildId,
            undefined, // backLinkPage
            onRowError,
          );

          const filename = `${sanitizedName}-page-${page.pageNumber}.html`;

          const blob = new Blob(pageParts, { type: 'text/html' });
          await zipService.addFile(blob, `${sanitizedName}/${filename}`);

          processedPages++;

          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'html',
              current: processedPages,
              total: totalPages,
              message: `Generating HTML page ${processedPages}/${totalPages}`,
            });
          }
        }
      }

      // Build map of threadId → main page number (for "Back to" links)
      const threadStarterPageMap: Record<string, number> = {};
      for (const page of exportData.mainPages) {
        for (const msg of page.messages) {
          const thread = (msg as any).thread;
          if (thread?.id) {
            threadStarterPageMap[thread.id] = page.pageNumber;
          }
        }
      }

      // Phase 2b: Generate thread files if separateThreads is enabled
      for (const threadExport of exportData.threadExports) {
        // #175: pass the thread id as the dedupe suffix so channels with
        // many auto-spawned threads (Needle-bot promotes every message
        // into a thread) can't collide on sanitization. Without this,
        // "GT3 RS" + "GT3 RS!" both became "gt_rs" and the second
        // zipService.addFile threw JSZip's "File already exists".
        const threadName = this.sanitizeFilename(
          threadExport.thread.name || `thread-${threadExport.thread.id}`,
          threadExport.thread.id,
        );
        const threadTotalPages = threadExport.pages.length;

        for (const page of threadExport.pages) {
          if (shouldContinue) await shouldContinue();

          let parts: string[];
          let filename: string;
          let mimeType: string;

          if (exportFormat === 'json') {
            parts = this.buildJSONPageParts(page.messages, onRowError);
            filename = threadTotalPages > 1
              ? `${threadName}-page-${page.pageNumber}.json`
              : `${threadName}.json`;
            mimeType = 'application/json';
          } else if (exportFormat === 'csv') {
            parts = this.buildCSVPageParts(page.messages, cachedUserMap, guildId, exportConfig, onRowError);
            filename = threadTotalPages > 1
              ? `${threadName}-page-${page.pageNumber}.csv`
              : `${threadName}.csv`;
            mimeType = 'text/csv';
          } else if (exportFormat === 'text') {
            parts = this.buildTextPageParts(page.messages, {
              cachedUserMap,
              guildId,
              exportConfig,
              mediaMaps,
              textOptions: textOpts,
            }, onRowError);
            filename = threadTotalPages > 1
              ? `${threadName}-page-${page.pageNumber}.txt`
              : `${threadName}.txt`;
            mimeType = 'text/plain;charset=utf-8';
          } else {
            // #185 Bug B: same parts-array path as the main-page loop above.
            const threadParts = this.generateHTMLPageParts(
              page.messages,
              threadExport.thread.name || `Thread ${threadExport.thread.id}`,
              page.pageNumber,
              threadTotalPages,
              mediaMaps,
              sanitizedName,
              formattingContext!,
              exportConfig,
              '../',
              reactionMap,
              cachedUserMap,
              guildId,
              threadStarterPageMap[threadExport.thread.id],
              onRowError,
            );
            filename = threadTotalPages > 1
              ? `${threadName}-page-${page.pageNumber}.html`
              : `${threadName}.html`;
            // Add the thread blob directly here so we don't fall through to
            // the generic Blob below (which assumes a single `content` string).
            const blob = new Blob(threadParts, { type: 'text/html' });
            await zipService.addFile(blob, `${sanitizedName}/threads/${filename}`);
            processedPages++;

            if (typeof onProgress === 'function') {
              onProgress({
                stage: 'html',
                current: processedPages,
                total: totalPages,
                message: `Generating thread ${threadExport.threadNumber}/${threadExport.totalThreads} page ${page.pageNumber}/${threadTotalPages}`,
              });
            }
            continue;
          }

          const blob = new Blob(parts, { type: mimeType });
          await zipService.addFile(blob, `${sanitizedName}/threads/${filename}`);
          processedPages++;

          if (typeof onProgress === 'function') {
            onProgress({
              stage: 'html',
              current: processedPages,
              total: totalPages,
              message: `Generating thread ${threadExport.threadNumber}/${threadExport.totalThreads} page ${page.pageNumber}/${threadTotalPages}`,
            });
          }
        }
      }

      // Phase 2c: Generate Discord shell wrapper if template is 'discord'
      // Skip for bulk exports (externalZipService) — the bulk thunk generates its own shell
      if (exportFormat === 'html' && exportConfig?.exportTemplate === 'discord' && !externalZipService) {
        const { generateDiscordShellSingle, generateDiscordShellBulk } = await import('./exportDiscordShell');

        const shellChannels = [{
          id: sanitizedName,
          name: channelName,
          filename: `${sanitizedName}-page-1.html`,
        }];

        // Add thread channels to sidebar
        for (const threadExport of exportData.threadExports) {
          // #175: same dedupe-by-id strategy as the Phase 2b loop — the
          // shell's sidebar links must resolve to the same on-disk
          // filenames that got written.
          const threadName = this.sanitizeFilename(
            threadExport.thread.name || `thread-${threadExport.thread.id}`,
            threadExport.thread.id,
          );
          shellChannels.push({
            id: threadName,
            name: threadExport.thread.name || threadName,
            filename: `threads/${threadName}.html`,
            type: 'thread',
          } as any);
        }

        const shellOptions = {
          serverName: guild?.name || (guildId ? 'Server' : 'Direct Message'),
          serverIcon: guild?.icon ? `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png` : undefined,
          channels: shellChannels,
          activeChannelId: sanitizedName,
          isDM: !guildId,
          exportDate: format(new Date(), 'MMMM d, yyyy'),
          // #222: every entry in shellChannels has an actually-written page
          // (the main channel + each exported thread). Marking only the main
          // channel as "exported" greyed out + disabled the thread sidebar
          // links even though threads/<name>.html exists. List them all.
          exportedChannelIds: shellChannels.map((c) => c.id),
          themeSet: this.exportThemeSet,
        };

        // For single-channel: read the first page content and wrap it
        void `${sanitizedName}-page-1.html`; // reserved for future single-page shell

        // Use iframe-based approach — shell references the page files
        const shellHtml = shellChannels.length === 1 && totalPages === 1
          ? generateDiscordShellSingle(
              this.generateHTMLPage(
                exportData.mainPages[0].messages,
                channelName, 1, 1, mediaMaps, sanitizedName,
                formattingContext!, exportConfig, undefined, reactionMap,
                cachedUserMap, guildId,
              ),
              shellOptions,
            )
          : generateDiscordShellBulk({
              ...shellOptions,
              channels: shellChannels.map((ch) => ({
                ...ch,
                filename: ch.filename,
              })),
            });

        const shellBlob = new Blob([shellHtml], { type: 'text/html' });
        await zipService.addFile(shellBlob, `${sanitizedName}/shell.html`);
      }

      // Add README to export (only for single-channel; bulk exports add their own)
      if (ownsZip) {
        if (exportFormat === 'text') {
          const readmeTxt = generatePlainTextReadme({ isBulk: false, channelName: sanitizedName });
          await zipService.addFile(
            new Blob([readmeTxt], { type: 'text/plain;charset=utf-8' }),
            `${sanitizedName}/README.txt`,
          );
        } else {
          const isDiscordShell = exportFormat === 'html' && exportConfig?.exportTemplate === 'discord';
          const readmeHtml = generateExportReadme({
            format: exportFormat,
            isDiscordShell,
            isBulk: false,
            channelName: sanitizedName,
          });
          await zipService.addFile(new Blob([readmeHtml], { type: 'text/html' }), `${sanitizedName}/README.html`);
        }
      }

      // Phase 3: Finalize ZIP (only if we created it)
      if (ownsZip) {
        if (typeof onProgress === 'function') {
          onProgress({
            stage: 'finalizing',
            current: 1,
            total: 1,
            message: 'Finalizing export...',
          });
        }

        await zipService.finalize();
      }
    } catch (error) {
      if (ownsZip) await zipService.cancel();
      throw error;
    }
  }

  /**
   * Generate CSV content from messages. Kept as a join over
   * {@link buildCSVPageParts} — the page-writing loops hand the parts
   * straight to Blob instead so no whole-page string is materialized.
   */
  generateCSV(messages: Message[], cachedUserMap: ExportUserMap, guildId: string | null, exportConfig?: ExportConfig): string {
    return this.buildCSVPageParts(messages, cachedUserMap, guildId, exportConfig).join('');
  }

  /**
   * #230: the render-failure guard originally wrapped only the HTML row
   * builder — the same poison message still killed JSON/CSV/text exports
   * whole while the error reporter flushed zero failures. Each non-HTML
   * format now serializes per message under its own guard (placeholder
   * row + onRowError, matching the HTML semantics), and pages are handed
   * to Blob as parts so no whole-page string is ever joined (the #185
   * Bug B string-cap reasoning applies to every format, not just HTML).
   */
  private buildCSVPageParts(
    messages: Message[],
    cachedUserMap: ExportUserMap,
    guildId: string | null,
    exportConfig?: ExportConfig,
    onRowError?: (messageId: string, error: unknown) => void,
  ): string[] {
    const headers = ['ID', 'Timestamp', 'Username', 'Display Name', 'Server Nickname', 'Content', 'Forwarded Content', 'Attachments', 'Embeds', 'Reactions'];
    const parts = [headers.join(',')];

    messages.forEach((msg) => {
      const id = msg.id || '';
      let row: string;
      try {
        const timestamp = msg.timestamp
          ? (exportConfig?.dateFormat && exportConfig?.timeFormat
              ? formatMessageTimestamp(msg.timestamp, exportConfig.dateFormat, exportConfig.timeFormat)
              : format(new Date(msg.timestamp), 'yyyy-MM-dd HH:mm:ss'))
          : '';

        // Get user display data from cache
        const userData = getUserDisplayData(
          msg.author?.id || '',
          cachedUserMap,
          guildId
        );
        const username = this.escapeCSV(userData.username || msg.author?.username || 'Unknown');
        const displayName = this.escapeCSV(userData.displayName || msg.author?.global_name || '');
        const nickname = this.escapeCSV(userData.nickname || '');

        const content = this.escapeCSV(getMessageContent(msg));

        // #197 — a forwarded message carries no body of its own; the
        // payload lives in message_snapshots. Surface its text in a
        // dedicated column and fold the snapshot's attachment/embed
        // counts into the totals so a forward isn't reported as empty.
        const snapshot = getForwardedSnapshot(msg);
        const forwardedContent = this.escapeCSV(snapshot?.content || '');
        const attachments =
          (msg.attachments?.length || 0) + (snapshot?.attachments?.length || 0);
        const embeds = (msg.embeds?.length || 0) + (snapshot?.embeds?.length || 0);
        const reactions = msg.reactions?.reduce((sum, r) => sum + (r.count || 0), 0) || 0;

        row = `"${id}","${timestamp}","${username}","${displayName}","${nickname}","${content}","${forwardedContent}",${attachments},${embeds},${reactions}`;
      } catch (error) {
        if (onRowError) onRowError(String(msg.id ?? 'unknown'), error);
        row = `"${id}","","","","","[This message could not be rendered and was skipped]","",0,0,0`;
      }
      parts.push('\n', row);
    });

    return parts;
  }

  /**
   * Per-message-guarded JSON page. Joined, the parts are byte-identical
   * to `JSON.stringify(messages, null, 2)`; a message whose
   * serialization throws becomes a placeholder object carrying its ID.
   * See {@link buildCSVPageParts} for the #230 background.
   */
  private buildJSONPageParts(
    messages: Message[],
    onRowError?: (messageId: string, error: unknown) => void,
  ): string[] {
    if (messages.length === 0) return ['[]'];
    const parts: string[] = ['[\n'];
    messages.forEach((msg, idx) => {
      let body: string;
      try {
        body = JSON.stringify(msg, null, 2);
      } catch (error) {
        const safeId = String(msg.id ?? 'unknown');
        if (onRowError) onRowError(safeId, error);
        body = JSON.stringify(
          { id: safeId, export_error: 'This message could not be serialized and was skipped' },
          null,
          2,
        );
      }
      parts.push(`  ${body.replace(/\n/g, '\n  ')}`);
      parts.push(idx < messages.length - 1 ? ',\n' : '\n');
    });
    parts.push(']');
    return parts;
  }

  /**
   * Per-message-guarded text page. `generateTextPage` renders each
   * message independently (blocks joined by a blank line, trailing
   * newline), so calling it per message reproduces its output exactly.
   * See {@link buildCSVPageParts} for the #230 background.
   */
  private buildTextPageParts(
    messages: Message[],
    opts: Parameters<typeof generateTextPage>[1],
    onRowError?: (messageId: string, error: unknown) => void,
  ): string[] {
    if (messages.length === 0) return [''];
    const parts: string[] = [];
    messages.forEach((msg, idx) => {
      let block: string;
      try {
        // Single-message page = "<block>\n"; strip the page's trailing
        // newline so the separators below rebuild the multi-block form.
        block = generateTextPage([msg], opts).slice(0, -1);
      } catch (error) {
        const safeId = String(msg.id ?? 'unknown');
        if (onRowError) onRowError(safeId, error);
        block = `[This message could not be rendered and was skipped. Message ID: ${safeId}]`;
      }
      parts.push(block);
      parts.push(idx < messages.length - 1 ? '\n\n' : '\n');
    });
    return parts;
  }

  /**
   * Build formatting context from messages and guild data
   */
  private buildFormattingContext(
    messages: Message[],
    guild: Guild | null,
    cachedUserMap: ExportUserMap,
    guildId: string | null,
    mediaMaps?: MediaMaps | null,
    sanitizedName?: string,
    externalGuildRoles?: any[],
  ): HtmlFormattingContext {
    // Build userMap from cached data and message authors
    const userMap: Record<string, { userName?: string; displayName?: string; nick?: string }> = {};

    // Start with cached data
    Object.keys(cachedUserMap).forEach((userId) => {
      const cached = cachedUserMap[userId];
      const guildData = guildId ? cached.guilds?.[guildId] : null;
      userMap[userId] = {
        userName: cached.userName || undefined,
        displayName: cached.displayName || undefined,
        nick: guildData?.nick || undefined,
      };
    });

    // Overlay message author data and mentioned user data
    messages.forEach((msg) => {
      if (msg.author) {
        userMap[msg.author.id] = {
          ...userMap[msg.author.id],
          userName: msg.author.username,
          displayName: msg.author.global_name || userMap[msg.author.id]?.displayName,
        };
      }
      // Discord provides full User objects for mentioned users — use them
      if (msg.mentions && msg.mentions.length > 0) {
        msg.mentions.forEach((mentioned) => {
          if (mentioned.id && !userMap[mentioned.id]) {
            userMap[mentioned.id] = {
              userName: mentioned.username,
              displayName: mentioned.global_name || undefined,
            };
          }
        });
      }
    });

    // channelMap is empty for now since Guild type doesn't include channels
    // Channel mentions will fall back to 'unknown-channel' in formatContentAsHtml
    const channelMap: Record<string, { name: string }> = {};

    // Get guild roles: prefer explicitly passed roles, fall back to guild object
    const guildRoles = externalGuildRoles?.length ? externalGuildRoles : (guild?.roles || []);

    return {
      userMap,
      channelMap,
      guildRoles,
      emojiMap: mediaMaps?.emojiMap,
      sanitizedName,
      guildName: guild?.name,
    };
  }

  /**
   * Generate HTML page from messages with local media path resolution
   */
  generateHTMLPage(
    messages: Message[],
    channelName: string,
    pageNumber: number,
    totalPages: number,
    mediaMaps?: MediaMaps | null,
    sanitizedName?: string,
    formattingContext?: HtmlFormattingContext,
    exportConfig?: ExportConfig,
    mediaPathPrefix?: string,
    reactionMap?: import('discrub-core/types/discrub-types').ExportReactionMap,
    cachedUserMap?: ExportUserMap,
    guildId?: string | null,
    backLinkPage?: number,
  ): string {
    return this.generateHTMLPageParts(
      messages, channelName, pageNumber, totalPages, mediaMaps, sanitizedName,
      formattingContext, exportConfig, mediaPathPrefix, reactionMap, cachedUserMap,
      guildId, backLinkPage,
    ).join('');
  }

  /**
   * Parts-array variant of {@link generateHTMLPage}. The page-writing
   * loops in `exportToZip` use this and hand the array straight to
   * `new Blob(parts)`, which never materializes one mega-string.
   *
   * Background: a single ~200k-message channel ("znone" in
   * testaccounta_1's r/discrub report) tripped V8's ~512MB string cap
   * during the final template-literal evaluation here. The crash
   * surfaced as `RangeError: Invalid string length` caught at
   * `exportSlice.ts:386` ("Failed on znone — Invalid string length").
   * Per-message row HTML stayed in scope as an array instead of being
   * pre-joined, and the head/foot are emitted as separate parts so
   * the Blob can stitch them together at addFile time. See #185 Bug B.
   */
  generateHTMLPageParts(
    messages: Message[],
    channelName: string,
    pageNumber: number,
    totalPages: number,
    mediaMaps?: MediaMaps | null,
    sanitizedName?: string,
    formattingContext?: HtmlFormattingContext,
    exportConfig?: ExportConfig,
    mediaPathPrefix?: string,
    reactionMap?: import('discrub-core/types/discrub-types').ExportReactionMap,
    cachedUserMap?: ExportUserMap,
    guildId?: string | null,
    backLinkPage?: number,
    onRowError?: (messageId: string, error: unknown) => void,
  ): string[] {
    const previewMedia = exportConfig?.previewMedia !== false; // default true

    const GROUPING_WINDOW_MS = 7 * 60 * 1000; // 7 minutes
    let imageIndex = 0;

    const messageRowParts: string[] = messages
      .map((msg, idx) => {
        const prevMsg = idx > 0 ? messages[idx - 1] : null;

        // Date divider: insert between messages from different days
        let dateDividerHtml = '';
        if (msg.timestamp) {
          const msgDate = new Date(msg.timestamp);
          const prevDate = prevMsg?.timestamp ? new Date(prevMsg.timestamp) : null;
          if (!prevDate || msgDate.toDateString() !== prevDate.toDateString()) {
            const dateStr = format(msgDate, 'MMMM d, yyyy');
            const dateId = format(msgDate, 'yyyy-MM-dd');
            dateDividerHtml = `<div class="date-divider" id="date-${dateId}"><span class="date-divider-text">${dateStr}</span></div>`;
          }
        }

        // #230: a single message whose formatting explodes (e.g. a
        // markdown/embed blowup crossing V8's string cap) must cost one
        // row, not the whole export. The divider above is computed
        // outside the guard (plain date math, cannot blow up) so day
        // grouping survives even when the row itself is replaced.
        const buildRow = (): string => {

        // System-message branch (types 1-18, 22, 24-46 excluding normal-message
        // types). formatSystemMessage returns null for types we render as
        // regular messages (0 default, 19 reply, 20/23 slash commands, 21
        // thread starter), so we fall through in those cases.
        const systemDescriptor = formatSystemMessage(msg, {
          guildName: formattingContext?.guildName,
        });
        if (systemDescriptor) {
          const systemTextRaw = formattingContext
            ? formatContentAsHtml(systemDescriptor.text, formattingContext)
            : this.escapeHtml(systemDescriptor.text);
          // Wrap known trailing link phrases ("See all pinned messages",
          // "See all threads") in anchor-styled spans so they look like
          // the clickable links Discord renders. Click handling is
          // deferred (backlog #123) — these are visual affordances only
          // in the export.
          const systemText = systemTextRaw
            .replace(
              /See all pinned messages/g,
              '<span class="system-link">See all pinned messages</span>',
            )
            .replace(
              /See all threads/g,
              '<span class="system-link">See all threads</span>',
            );
          // Discord's system messages use a compact "M/d/yy, h:mm a" format
          // regardless of locale — match it rather than honoring the user's
          // exportConfig date/time format, which is tuned for regular
          // messages and reads awkwardly on a terse one-line system notice.
          const systemTimestamp = msg.timestamp
            ? format(new Date(msg.timestamp), 'M/d/yy, h:mm a')
            : '';
          const systemIcon = getSystemMessageIconHtml(systemDescriptor.kind);
          // Author's role color applied via inline style — same pattern
          // the normal-message branch uses at line ~820 for the .author
          // span. Note: this colors the span wrapping the whole text, so
          // the CSS selector `.system-message-text strong` picks it up via
          // CSS specificity. We set it as a CSS custom property that the
          // stylesheet reads on the author <strong>, which is always the
          // first bold token in formatSystemMessage output.
          const authorColor = cachedUserMap && msg.author?.id
            ? getUserRoleColor(msg.author.id, guildId || null, cachedUserMap, (formattingContext?.guildRoles || []) as any)
            : null;
          const authorStyleAttr = authorColor
            ? ` style="--system-author-color:${authorColor}"`
            : '';
          // Auto-mod (24) and poll result (46) carry their meaning in
          // `embeds[0]` — show the embed beneath the notice line. Other
          // types don't populate embeds, so the block is empty.
          const systemEmbedHtml =
            systemDescriptor.showEmbed && msg.embeds && msg.embeds.length > 0
              ? `<div class="system-message-embed">${msg.embeds
                  .map((e) =>
                    renderEmbedAsHtml(e, {
                      includeImages: true,
                      includeVideos: true,
                      mediaMap: mediaMaps?.mediaMap,
                    }),
                  )
                  .join('')}</div>`
              : '';
          return `${dateDividerHtml}
            <div class="system-message" data-message-id="${msg.id}" data-system-kind="${systemDescriptor.kind}"${authorStyleAttr}>
              <span class="system-message-icon" aria-hidden="true">${systemIcon}</span>
              <span class="system-message-text">${systemText} <span class="system-message-timestamp">${systemTimestamp}</span></span>
            </div>
            ${systemEmbedHtml}
          `;
        }

        const timestamp = msg.timestamp
          ? (exportConfig?.dateFormat && exportConfig?.timeFormat
              ? formatMessageTimestamp(msg.timestamp, exportConfig.dateFormat, exportConfig.timeFormat)
              : format(new Date(msg.timestamp), 'MMM dd, yyyy HH:mm'))
          : '';
        const author = msg.author?.username || 'Unknown';
        const authorColor = cachedUserMap && msg.author?.id
          ? getUserRoleColor(msg.author.id, guildId || null, cachedUserMap, (formattingContext?.guildRoles || []) as any)
          : null;
        const authorIcon = cachedUserMap && msg.author?.id
          ? getUserRoleIcon(msg.author.id, guildId || null, cachedUserMap, (formattingContext?.guildRoles || []) as any)
          : null;
        // Resolve local role-icon path if downloaded (#171). Match the
        // canonical key shape mediaDownloadService writes to roleMap;
        // strip the entityName/ prefix so the value is relative to the
        // page (prefixRelativeMediaPaths reattaches "../" for nested
        // thread files).
        const authorRoleCdn = authorIcon?.type === 'image'
          ? `https://cdn.discordapp.com/role-icons/${authorIcon.roleId}/${authorIcon.hash}.webp?size=20`
          : null;
        const authorRoleLocal = authorRoleCdn ? mediaMaps?.roleMap?.[authorRoleCdn] : undefined;
        const authorRoleSrc = authorRoleLocal
          ? authorRoleLocal.replace(`${sanitizedName}/`, '')
          : authorRoleCdn;
        const authorIconHtml = authorIcon?.type === 'image'
          ? ` <img src="${authorRoleSrc}" style="width:16px;height:16px;vertical-align:middle;margin-left:2px">`
          : authorIcon?.type === 'emoji'
            ? ` <span style="font-size:14px;vertical-align:middle;margin-left:2px">${authorIcon.emoji}</span>`
            : '';

        // Message grouping: same author, within 7 min, both type 0, no reply.
        // `Math.abs` matters because exports sort newest-first, which makes
        // a signed (current - previous) delta negative and always under the
        // threshold — grouping every single message regardless of gap.
        const isGrouped = prevMsg
          && prevMsg.author?.id === msg.author?.id
          && msg.type === 0
          && prevMsg.type === 0
          && msg.timestamp && prevMsg.timestamp
          && Math.abs(
              new Date(msg.timestamp).getTime()
              - new Date(prevMsg.timestamp).getTime()
            ) < GROUPING_WINDOW_MS;

        // Resolve avatar path
        let avatarSrc = '';
        if (msg.author?.avatar) {
          const idAndAvatar = `${msg.author.id}/${msg.author.avatar}`;
          const localPath = mediaMaps?.avatarMap?.[idAndAvatar];

          if (localPath && sanitizedName) {
            const relativePath = localPath.replace(`${sanitizedName}/`, '');
            avatarSrc = relativePath;
          } else {
            avatarSrc = `https://cdn.discordapp.com/avatars/${idAndAvatar}.png`;
          }
        }

        // Format content with full Discord markdown and mentions.
        // #219: when the entire message is a bare image/GIF URL that Discord
        // unfurled into its embed, Discord's client hides the raw link text —
        // the media is the message. Mirror that here so exports don't stack a
        // blue link above the image.
        const actualContent = getMessageContent(msg);
        const contentIsBareEmbedUrl =
          !!actualContent &&
          msg.embeds?.length === 1 &&
          isBareMediaEmbed(msg.embeds[0]) &&
          msg.embeds[0].url === actualContent.trim();
        const rawContent = actualContent || '(no content)';
        const content = contentIsBareEmbedUrl
          ? ''
          : formattingContext
            ? formatContentAsHtml(rawContent, formattingContext)
            : this.escapeHtml(rawContent);

        // Edited indicator
        const editedHtml = msg.edited_timestamp
          ? ` <span class="edited-indicator" title="Edited: ${format(new Date(msg.edited_timestamp), `MMM dd, yyyy ${exportConfig?.timeFormat || 'HH:mm'}`)}">(edited)</span>`
          : '';

        // Resolve attachment paths with rich card-based design
        const attachmentsHtml = msg.attachments && msg.attachments.length > 0
          ? `<div class="attachments">
               ${msg.attachments.map((att) => {
                 const localPath = mediaMaps?.mediaMap?.[att.url];
                 const href = localPath ? localPath : att.url;
                 const isLocal = Boolean(localPath);
                 const ext = att.filename?.split('.').pop()?.toLowerCase() || '';
                 const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
                 const isVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
                 const isBrowserPlayable = ['mp4', 'webm'].includes(ext);
                 const fileIcon = this.getFileIcon(att.filename || 'file');

                 let previewHtml = '';
                 if (previewMedia && isImage) {
                   previewHtml = `<img class="attachment-preview attachment-preview-img" src="${href}" alt="${att.filename || 'Image'}" loading="lazy" data-action="open-lightbox" data-img-index="${imageIndex++}" style="cursor:pointer">`;
                 } else if (previewMedia && isVideo && isBrowserPlayable) {
                   previewHtml = `<video class="attachment-preview" controls src="${href}"></video>`;
                 } else if (previewMedia && isVideo && !isBrowserPlayable) {
                   previewHtml = `<div class="video-unsupported"><span class="video-unsupported-icon">${this.fileIconSvg('video')}</span><span class="video-unsupported-text">.${ext.toUpperCase()} preview not available · <a href="${href}" ${isLocal ? '' : 'target="_blank" rel="noopener noreferrer"'}>download to play</a></span></div>`;
                 }

                 return `
                   <div class="attachment-card">
                     ${previewHtml}
                     <div class="attachment-info">
                       <div class="attachment-header">
                         <span class="attachment-icon">${fileIcon}</span>
                         <a href="${href}" ${isLocal ? '' : 'target="_blank" rel="noopener noreferrer"'} class="attachment-name">
                           ${att.filename || 'Unknown'}
                         </a>
                       </div>
                       <div class="attachment-meta">
                         <span class="attachment-size">${this.formatBytes(att.size || 0)}</span>
                         <span class="attachment-badge ${isLocal ? 'local' : 'external'}">${isLocal ? 'Local' : 'External'}</span>
                       </div>
                     </div>
                   </div>
                 `;
               }).join('')}
             </div>`
          : '';

        const reactionsHtml = msg.reactions && msg.reactions.length > 0
          ? `<div class="reactions">
               ${msg.reactions.map(r => {
                 const emojiHtml = renderEmojiAsHtml(
                   r.emoji || { name: '?' },
                   mediaMaps?.emojiMap,
                   sanitizedName
                 );
                 const emojiKey = r.emoji?.id ? r.emoji.id : (r.emoji?.name || '?');
                 return `
                   <span class="reaction" data-action="show-reactions" data-message-id="${msg.id}" data-emoji-key="${emojiKey}">
                     ${emojiHtml}
                     <span class="reaction-count">${r.count}</span>
                   </span>
                 `;
               }).join('')}
             </div>`
          : '';

        // Render full embeds with complete structure
        const embedsHtml = msg.embeds && msg.embeds.length > 0
          ? `<div class="embeds">
               ${msg.embeds.map(embed => renderEmbedAsHtml(embed, {
                 includeImages: true,
                 includeVideos: true,
                 mediaMap: mediaMaps?.mediaMap,
               })).join('')}
             </div>`
          : '';

        // Stickers (#213). Raster stickers point at the downloaded local copy
        // (stickers/{id}.{ext}); Lottie (format_type 3) can't be an <img>, so it
        // degrades to a labeled placeholder.
        const stickerItems = msg.sticker_items;
        const stickersHtml = stickerItems && stickerItems.length > 0
          ? `<div class="stickers">
               ${stickerItems.map((s) => {
                 const name = this.escapeHtml(s.name || 'sticker');
                 if (s.format_type === 3) {
                   return `<div class="sticker-placeholder" title="${name}"><span class="sticker-placeholder-icon">${this.fileIconSvg('sticker')}</span><span class="sticker-placeholder-name">${name}</span></div>`;
                 }
                 const ext = s.format_type === 4 ? 'gif' : 'png';
                 return `<img class="sticker-img" src="stickers/${s.id}.${ext}" alt="${name}" title="${name}" loading="lazy">`;
               }).join('')}
             </div>`
          : '';

        // Poll card (#213). Vote bars/percentages only render when poll.results
        // is present (fetched/closed polls); otherwise plain options.
        // poll is typed on the lib Message as PollObject (#214 review cleanup).
        const poll = msg.poll;
        let pollHtml = '';
        if (poll) {
          const question = this.escapeHtml(poll.question?.text || 'Poll');
          const answers = poll.answers ?? [];
          const counts = poll.results?.answer_counts ?? null;
          const totalVotes = counts ? counts.reduce((sum, c) => sum + (c.count || 0), 0) : 0;
          const rows = answers.map((a) => {
            const count = counts?.find((c) => c.id === a.answer_id)?.count;
            const pct = totalVotes > 0 && count != null ? Math.round((count / totalVotes) * 100) : null;
            const text = this.escapeHtml(a.poll_media?.text || '');
            const pctLabel = pct != null ? `<span class="poll-pct">${pct}%</span>` : '';
            const bar = pct != null ? `<div class="poll-bar"><div class="poll-bar-fill" style="width:${pct}%"></div></div>` : '';
            return `<div class="poll-answer"><div class="poll-answer-row"><span class="poll-answer-text">${text}</span>${pctLabel}</div>${bar}</div>`;
          }).join('');
          const totalLabel = totalVotes > 0 ? `<div class="poll-total">${totalVotes} ${totalVotes === 1 ? 'vote' : 'votes'}</div>` : '';
          pollHtml = `<div class="poll"><div class="poll-question">${question}</div>${rows}${totalLabel}</div>`;
        }

        const userId = msg.author?.id || '';

        // Reply preview bar (for type 19 reply messages)
        let replyHtml = '';
        if (msg.type === 19 && (msg as any).message_reference) {
          const ref = msg.referenced_message;
          if (ref) {
            const refAuthor = ref.author?.username || 'Unknown';
            const refContent = (ref.content || '').slice(0, 100) + ((ref.content || '').length > 100 ? '...' : '');
            const refId = ref.id;
            replyHtml = `
              <div class="reply-bar" data-action="jump-to-reply" data-target-id="${refId}">
                <span class="reply-avatar-small">${ref.author?.avatar
                  ? `<img src="https://cdn.discordapp.com/avatars/${ref.author.id}/${ref.author.avatar}.png?size=32" class="reply-avatar-img">`
                  : '<span class="reply-avatar-placeholder-small"></span>'}</span>
                <span class="reply-author">${this.escapeHtml(refAuthor)}</span>
                <span class="reply-content">${this.escapeHtml(refContent) || '<em>Click to see attachment</em>'}</span>
              </div>`;
          } else {
            replyHtml = `
              <div class="reply-bar reply-bar-deleted">
                <span class="reply-content-deleted">Original message was deleted</span>
              </div>`;
          }
        }

        // Forwarded message block (#197): Discord's late-2024 Forward
        // feature attaches the original payload on message_snapshots[0].
        // The forwarding message's own content is typically empty, so
        // we surface the snapshot's content + attachments inline,
        // preceded by a small "Forwarded" header. Discord strips the
        // original author for privacy; nothing to attribute.
        let forwardHtml = '';
        const snapshot = Array.isArray((msg as any).message_snapshots) && (msg as any).message_snapshots.length > 0
          ? (msg as any).message_snapshots[0]?.message ?? null
          : null;
        if (snapshot) {
          const snapContent = formattingContext
            ? formatContentAsHtml(snapshot.content || '', formattingContext)
            : this.escapeHtml(snapshot.content || '');
          // #214: rewrite snapshot attachment URLs to the downloaded local
          // copy (mirrors the top-level attachment rewrite at ~:976) and
          // inline-preview images so forwarded media displays offline instead
          // of being a dead CDN link / blank.
          const snapAttachmentsHtml = Array.isArray(snapshot.attachments) && snapshot.attachments.length > 0
            ? `<div class="forward-attachments">${snapshot.attachments
                .map((att: any) => {
                  const filename = this.escapeHtml(att.filename || 'attachment');
                  const localPath = mediaMaps?.mediaMap?.[att.url];
                  const href = localPath || att.url || '';
                  const isLocal = Boolean(localPath);
                  const ext = (att.filename?.split('.').pop() || '').toLowerCase();
                  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
                  const preview = previewMedia && isImage && href
                    ? `<img class="attachment-preview attachment-preview-img" src="${href}" alt="${filename}" loading="lazy" data-action="open-lightbox" data-img-index="${imageIndex++}" style="cursor:pointer">`
                    : '';
                  return `${preview}<a class="forward-attachment" href="${href}" ${isLocal ? '' : 'target="_blank" rel="noopener noreferrer"'}>${filename}</a>`;
                })
                .join('')}</div>`
            : '';
          // #214: forwarded embeds (embedded images / link previews) live on
          // the snapshot too — render them through the shared embed emitter so
          // their media is resolved against the local media map.
          const snapEmbedsHtml = Array.isArray(snapshot.embeds) && snapshot.embeds.length > 0
            ? `<div class="embeds">${snapshot.embeds
                .map((embed: any) => renderEmbedAsHtml(embed, {
                  includeImages: true,
                  includeVideos: true,
                  mediaMap: mediaMaps?.mediaMap,
                }))
                .join('')}</div>`
            : '';
          forwardHtml = `
            <div class="forward-block" data-message-snapshot="true">
              <div class="forward-header">
                <span class="forward-icon" aria-hidden="true">&#x21AA;</span>
                <span class="forward-label">Forwarded</span>
              </div>
              <div class="forward-content">${snapContent}</div>
              ${snapAttachmentsHtml}
              ${snapEmbedsHtml}
            </div>`;
        }

        // Thread banner (for messages that spawned a thread) — only in main channel pages
        let threadBannerHtml = '';
        const thread = (msg as any).thread;
        if (thread?.name && !mediaPathPrefix) {
          // #175: thread file targets are now sanitized with the thread
          // id suffix to dedupe Needle-style collisions. The banner link
          // must match the on-disk filename or it points at a 404.
          const threadFilename = `threads/${this.sanitizeFilename(thread.name, thread.id)}.html`;
          threadBannerHtml = `
            <div class="thread-banner">
              <a href="${threadFilename}" class="thread-banner-link">
                <span class="thread-banner-icon">&#x1F9F5;</span>
                <span class="thread-banner-text">${this.escapeHtml(thread.name)}</span>
                <span class="thread-banner-arrow">&rarr;</span>
              </a>
            </div>`;
        }

        if (isGrouped) {
          // Compact grouped message — no avatar, no author, compact timestamp on hover
          return `${dateDividerHtml}
          <div class="message message-grouped" id="msg-${msg.id}" data-message-id="${msg.id}">
            <div class="message-left">
              <span class="grouped-timestamp">${timestamp}</span>
            </div>
            <div class="message-content">
              <div class="message-text">${content}${editedHtml}</div>
              ${forwardHtml}
              ${attachmentsHtml}
              ${embedsHtml}
              ${stickersHtml}
              ${pollHtml}
              ${reactionsHtml}
              ${threadBannerHtml}
            </div>
          </div>
        `;
        }

        return `${dateDividerHtml}
          <div class="message" id="msg-${msg.id}" data-message-id="${msg.id}">
            <div class="message-left">
              ${avatarSrc
                ? `<img src="${avatarSrc}" alt="${author}" class="avatar" data-action="show-user" data-user-id="${userId}" style="cursor:pointer">`
                : `<div class="avatar-placeholder" data-action="show-user" data-user-id="${userId}" style="cursor:pointer"></div>`}
            </div>
            <div class="message-content">
              ${replyHtml}
              <div class="message-header">
                <span class="author" data-action="show-user" data-user-id="${userId}" style="cursor:pointer${authorColor ? `;color:${authorColor}` : ''}">${author}${authorIconHtml}</span>
                <span class="timestamp">${timestamp}</span>
              </div>
              <div class="message-text">${content}${editedHtml}</div>
              ${forwardHtml}
              ${attachmentsHtml}
              ${embedsHtml}
              ${stickersHtml}
              ${pollHtml}
              ${reactionsHtml}
              ${threadBannerHtml}
            </div>
          </div>
        `;
        };

        try {
          return buildRow();
        } catch (error) {
          // Placeholder keeps the page structurally valid (balanced divs
          // for the #198 balance check) and carries the message ID so a
          // user report can identify the poison message for us.
          const safeId = this.escapeHtml(String(msg.id ?? 'unknown'));
          if (import.meta.env.DEV) {
            console.warn(`[Export] Failed to render message ${safeId}`, error);
          }
          if (onRowError) onRowError(String(msg.id ?? 'unknown'), error);
          return `${dateDividerHtml}
          <div class="message message-render-error" id="msg-${safeId}" data-message-id="${safeId}">
            <div class="message-left">
              <span class="render-error-icon">&#9888;&#65039;</span>
            </div>
            <div class="message-content">
              <div class="message-text render-error-text">This message could not be rendered and was skipped. Message ID: <code>${safeId}</code></div>
            </div>
          </div>
        `;
        }
      });

    const pageInfo = totalPages > 1 ? ` - Page ${pageNumber} of ${totalPages}` : '';

    // Slot E: bake the export-time theme set. :root carries the
    // default vars; the html classes make the default theme explicit
    // and apply light-base structural styles on first paint.
    const themeSet = this.exportThemeSet;
    const defaultTheme = themeSet.themes.find((t) => t.id === themeSet.defaultId) ?? themeSet.themes[0];
    const htmlClasses = `export-theme-${defaultTheme.id}${defaultTheme.base === 'light' ? ' light-theme' : ''}`;

    const headHtml = `
<!DOCTYPE html>
<html lang="en" class="${htmlClasses}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${channelName}${pageInfo}</title>
  <style>
    /* Highlight.js vs2015 theme (inlined for offline use) */
    pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}.hljs{background:#1e1e1e;color:#dcdcdc}.hljs-keyword,.hljs-literal,.hljs-name,.hljs-symbol{color:#569cd6}.hljs-link{color:#569cd6;text-decoration:underline}.hljs-built_in,.hljs-type{color:#4ec9b0}.hljs-class,.hljs-number{color:#b8d7a3}.hljs-meta .hljs-string,.hljs-string{color:#d69d85}.hljs-regexp,.hljs-template-tag{color:#9a5334}.hljs-formula,.hljs-function,.hljs-params,.hljs-subst,.hljs-title{color:#dcdcdc}.hljs-comment,.hljs-quote{color:#57a64a;font-style:italic}.hljs-doctag{color:#608b4e}.hljs-meta,.hljs-meta .hljs-keyword,.hljs-tag{color:#9b9b9b}.hljs-template-variable,.hljs-variable{color:#bd63c5}.hljs-attr,.hljs-attribute{color:#9cdcfe}.hljs-section{color:gold}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}.hljs-bullet,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-selector-pseudo,.hljs-selector-tag{color:#d7ba7d}.hljs-addition{background-color:#144212;display:inline-block;width:100%}.hljs-deletion{background-color:#600;display:inline-block;width:100%}

    /* ==== CSS CUSTOM PROPERTIES ==== */
    /* :root = the export-time default theme; .export-theme-<id> classes
       override it when the viewer switches. The .light-theme class only
       carries structural light-base adjustments now — its vars live in
       the per-theme classes. */
${buildContentThemeCSS(themeSet)}

    /* ==== BASE STYLES ==== */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 0;
      overflow-x: hidden;
    }

    /* Custom scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: var(--bg-tertiary);
    }
    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 8px;
      transition: background-color 200ms ease;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--accent);
    }

    /* ==== HEADER ==== */
    .header {
      background: var(--bg-secondary);
      border-bottom: 2px solid;
      border-image: linear-gradient(90deg, #7289da, var(--accent)) 1;
      padding: 20px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    }

    .header h1 {
      background: linear-gradient(135deg, #ffffff, #7289da);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .header .meta {
      color: var(--text-secondary);
      font-size: 14px;
    }

    /* ==== CONTAINER ==== */
    .container {
      max-width: ${exportConfig?.exportTemplate === 'discord' ? 'none' : '1200px'};
      margin: 0 auto;
      padding: 20px;
    }

    /* ==== MESSAGES ==== */
    .message {
      display: flex;
      padding: 16px;
      margin-bottom: 2px;
      position: relative;
      transition: background-color 200ms ease;
      border-radius: 4px;
    }

    .message:hover {
      background: var(--bg-hover);
    }

    /* #230: placeholder for a message whose rendering threw */
    .message-render-error {
      background: rgba(250, 166, 26, 0.08);
      border-left: 3px solid #faa61a;
    }

    .message-render-error .render-error-icon {
      display: block;
      font-size: 20px;
      text-align: center;
      padding-top: 2px;
    }

    .render-error-text {
      color: var(--text-muted);
      font-style: italic;
    }

    .render-error-text code {
      font-style: normal;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      padding: 1px 4px;
      border-radius: 3px;
    }

    .message-left {
      flex-shrink: 0;
      width: 60px;
      padding-right: 16px;
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: block;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      transition: transform 200ms ease;
    }

    .avatar:hover {
      transform: scale(1.05);
    }

    .avatar-placeholder {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7289da, #5865f2);
      box-shadow: 0 2px 8px rgba(114, 137, 218, 0.3);
    }

    .message-content {
      flex: 1;
      min-width: 0;
    }

    .message-header {
      display: flex;
      align-items: baseline;
      margin-bottom: 6px;
    }

    .author {
      font-weight: 600;
      color: #fff;
      margin-right: 8px;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .timestamp {
      color: var(--text-muted);
      font-size: 12px;
    }

    .message-text {
      color: var(--text-primary);
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    /* ==== TEXT FORMATTING ==== */
    strong {
      font-weight: 700;
      color: #fff;
    }

    em {
      font-style: italic;
      color: #f0f0f0;
    }

    u {
      text-decoration: underline;
    }

    del {
      text-decoration: line-through;
      opacity: 0.6;
    }

    /* User mentions */
    .user-mention {
      background: rgba(88, 101, 242, 0.3);
      color: #c9d1ff;
      padding: 0 4px;
      border-radius: 3px;
      font-weight: 500;
      cursor: default;
      transition: background 200ms ease;
    }

    .user-mention:hover {
      background: rgba(88, 101, 242, 0.5);
    }

    /* Channel mentions */
    .channel-mention {
      background: rgba(60, 66, 112, 0.5);
      color: #b5c7ff;
      padding: 0 4px;
      border-radius: 3px;
      font-weight: 500;
      cursor: pointer;
      transition: background 200ms ease;
    }

    .channel-mention:hover {
      background: rgba(60, 66, 112, 0.7);
    }

    /* Discord headings */
    .discord-heading {
      color: var(--text-primary);
      margin: 8px 0 4px;
      line-height: 1.3;
    }

    h1.discord-heading { font-size: 24px; font-weight: 700; }
    h2.discord-heading { font-size: 20px; font-weight: 700; }
    h3.discord-heading { font-size: 16px; font-weight: 700; }

    /* Inline code */
    .inline-code {
      background: var(--code-bg);
      color: #eb459e;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 85%;
    }

    /* Code blocks */
    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      margin: 8px 0;
      overflow-x: auto;
    }

    .code-block code {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-secondary);
    }

    /* Spoilers */
    .spoiler {
      background: #202225;
      color: transparent;
      border-radius: 3px;
      padding: 0 2px;
      cursor: pointer;
      transition: all 200ms ease;
      user-select: none;
    }

    .spoiler:hover {
      background: #292b2f;
    }

    .spoiler-revealed {
      background: rgba(88, 101, 242, 0.2);
      color: #dcddde !important;
    }

    /* Links */
    a {
      color: var(--text-link);
      text-decoration: none;
      transition: color 200ms ease;
    }

    a:hover {
      color: #00d4ff;
      text-decoration: underline;
    }

    /* ==== ATTACHMENTS ==== */
    .attachments {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 12px;
      margin-top: 12px;
      align-items: start;
    }

    .attachment-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
      transition: all 200ms ease;
    }

    .attachment-card:hover {
      background: rgba(47, 49, 54, 0.8);
      border-color: rgba(114, 137, 218, 0.4);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .attachment-preview {
      width: 100%;
      max-height: 200px;
      object-fit: cover;
      display: block;
    }

    /* Unsupported video format fallback */
    .video-unsupported {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      color: var(--text-secondary);
      font-size: 13px;
    }

    .video-unsupported-icon {
      display: inline-flex;
      flex-shrink: 0;
    }
    .video-unsupported-icon .file-icon { width: 24px; height: 24px; }

    .video-unsupported-text {
      line-height: 1.4;
    }

    .video-unsupported a {
      color: var(--text-link);
    }

    /* Image preview — fixed thumbnail, click for lightbox */
    .attachment-preview-img {
      max-height: 350px;
      max-width: 100%;
      cursor: pointer;
      border-radius: 4px;
    }

    .attachment-info {
      padding: 12px;
    }

    .attachment-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .attachment-icon {
      display: inline-flex;
      flex-shrink: 0;
      opacity: 0.85;
    }

    .attachment-name {
      color: #00b0f4;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .attachment-name:hover {
      text-decoration: underline;
    }

    .attachment-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #b9bbbe;
    }

    .attachment-size {
      color: #b9bbbe;
    }

    .attachment-badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .attachment-badge.local {
      background: rgba(88, 214, 141, 0.2);
      color: #58d68d;
    }

    .attachment-badge.external {
      background: rgba(250, 177, 64, 0.2);
      color: #faa140;
    }

    /* ==== EMOJIS ==== */
    .emoji {
      width: 22px;
      height: 22px;
      vertical-align: middle;
      display: inline-block;
      object-fit: contain;
    }

    .emoji-reaction {
      width: 18px;
      height: 18px;
      vertical-align: middle;
      object-fit: contain;
    }

    /* ==== REACTIONS ==== */
    .reactions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .reaction {
      background: rgba(47, 49, 54, 0.6);
      border: 2px solid rgba(114, 137, 218, 0.3);
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 13px;
      color: #b9bbbe;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 200ms ease;
      cursor: default;
    }

    .reaction:hover {
      background: rgba(114, 137, 218, 0.15);
      border-color: rgba(114, 137, 218, 0.5);
      transform: scale(1.05);
    }

    .reaction-count {
      color: #dcddde;
      font-weight: 600;
      font-size: 13px;
    }

    /* ==== EMBEDS ==== */
    .embeds {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Stickers (#213) */
    .stickers {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .sticker-img {
      width: 160px;
      height: 160px;
      object-fit: contain;
      border-radius: 8px;
    }
    .sticker-placeholder {
      width: 160px;
      height: 160px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px dashed rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      color: #b9bbbe;
      text-align: center;
      padding: 8px;
    }
    .sticker-placeholder-icon { display: inline-flex; }
    .sticker-placeholder-icon .file-icon { width: 28px; height: 28px; }
    .sticker-placeholder-name { font-size: 12px; word-break: break-word; }

    /* Poll card (#213) */
    .poll {
      margin-top: 8px;
      max-width: 400px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 12px;
    }
    .poll-question { font-weight: 600; margin-bottom: 8px; }
    .poll-answer { margin-bottom: 6px; }
    .poll-answer-row { display: flex; align-items: center; gap: 8px; }
    .poll-answer-text { flex-grow: 1; }
    .poll-pct { color: #b9bbbe; font-size: 12px; }
    .poll-bar {
      margin-top: 3px;
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.1);
      overflow: hidden;
    }
    .poll-bar-fill { height: 100%; background: #5865f2; }
    .poll-total { margin-top: 8px; color: #b9bbbe; font-size: 12px; }

    .embed {
      background: rgba(47, 49, 54, 0.4);
      border-radius: 4px;
      padding: 12px 16px;
      max-width: 520px;
      position: relative;
    }

    .embed-author {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .embed-author-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }

    .embed-author-name {
      font-weight: 600;
      font-size: 14px;
      color: #fff;
    }

    .embed-title {
      font-weight: 600;
      font-size: 16px;
      color: #fff;
      margin-bottom: 8px;
    }

    .embed-title a {
      color: #00b0f4;
    }

    .embed-description {
      color: #dcddde;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      margin-bottom: 8px;
    }

    .embed-fields {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 8px;
      margin-top: 8px;
    }

    .embed-field {
      grid-column: span 12;
    }

    .embed-field-inline {
      grid-column: span 4;
    }

    .embed-field-name {
      font-weight: 600;
      font-size: 14px;
      color: #fff;
      margin-bottom: 4px;
    }

    .embed-field-value {
      color: #dcddde;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .embed-thumbnail {
      float: right;
      max-width: 80px;
      max-height: 80px;
      border-radius: 4px;
      margin-left: 16px;
      margin-bottom: 8px;
    }

    .embed-image {
      max-width: 400px;
      width: 100%;
      height: auto;
      border-radius: 4px;
      margin-top: 12px;
      display: block;
    }

    /* Bare image/GIF unfurls (#219) render at natural size like Discord;
       the width attributes from the renderer carry the (capped) natural
       dimensions, so width:100% here would upscale small emotes. */
    .bare-embed-image {
      width: auto;
      max-width: min(100%, 400px);
      margin-top: 4px;
    }

    .embed-video {
      max-width: 400px;
      width: 100%;
      height: auto;
      border-radius: 4px;
      margin-top: 12px;
      display: block;
    }

    .embed-video-link {
      display: inline-block;
      margin-top: 8px;
      color: #00b0f4;
      text-decoration: none;
    }

    .embed-video-link:hover {
      text-decoration: underline;
    }

    .embed-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      font-size: 12px;
      color: #b9bbbe;
    }

    .embed-footer-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
    }

    .embed-footer-text::after {
      content: " • ";
      margin: 0 4px;
    }

    /* ==== EDITED INDICATOR ==== */
    .edited-indicator {
      color: #72767d;
      font-size: 10px;
      font-weight: 400;
      cursor: default;
      user-select: none;
    }

    .edited-indicator:hover {
      text-decoration: underline;
    }

    /* ==== MESSAGE GROUPING ==== */
    .message-grouped {
      padding-top: 2px;
      padding-bottom: 2px;
    }

    .message-grouped .message-left {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 16px;
    }

    .grouped-timestamp {
      font-size: 10px;
      color: transparent;
      transition: color 150ms ease;
    }

    .message-grouped:hover .grouped-timestamp {
      color: #72767d;
    }

    /* ==== IMAGE LIGHTBOX ==== */
    .lightbox-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      animation: lightbox-fade-in 200ms ease;
    }

    @keyframes lightbox-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .lightbox-img {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    .lightbox-close {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(47, 49, 54, 0.8);
      border: none;
      color: #dcddde;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 150ms ease;
      z-index: 2001;
    }

    .lightbox-close:hover {
      background: rgba(79, 84, 92, 0.9);
    }

    .lightbox-nav {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(47, 49, 54, 0.8);
      border: none;
      color: #dcddde;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 150ms ease;
      z-index: 2001;
    }

    .lightbox-nav:hover {
      background: rgba(79, 84, 92, 0.9);
    }

    .lightbox-nav-prev {
      left: 16px;
    }

    .lightbox-nav-next {
      right: 16px;
    }

    .lightbox-counter {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      color: #b9bbbe;
      font-size: 14px;
      background: rgba(47, 49, 54, 0.8);
      padding: 4px 12px;
      border-radius: 4px;
      z-index: 2001;
    }

    /* ==== MESSAGE HIGHLIGHT (jump-to-reply) ==== */
    .message-highlight {
      animation: highlight-fade 2s ease;
    }

    @keyframes highlight-fade {
      0% { background: rgba(88, 101, 242, 0.3); }
      100% { background: transparent; }
    }

    /* ==== REPLY BARS ==== */
    .reply-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin-bottom: 4px;
      border-left: 2px solid #4f545c;
      border-radius: 0 4px 4px 0;
      background: rgba(47, 49, 54, 0.3);
      cursor: pointer;
      transition: background 150ms ease;
      font-size: 13px;
    }

    .reply-bar:hover {
      background: rgba(47, 49, 54, 0.6);
    }

    .reply-avatar-small {
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .reply-avatar-img {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      object-fit: cover;
    }

    .reply-avatar-placeholder-small {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7289da, #5865f2);
      display: inline-block;
    }

    .reply-author {
      color: #fff;
      font-weight: 600;
      font-size: 12px;
      flex-shrink: 0;
    }

    .reply-content {
      color: #b9bbbe;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .reply-bar-deleted {
      border-left-color: #f04747;
      opacity: 0.6;
    }

    .reply-content-deleted {
      color: #72767d;
      font-size: 12px;
      font-style: italic;
    }

    /* ==== FORWARDED MESSAGES (#197) ==== */
    .forward-block {
      margin-top: 8px;
      padding: 8px 12px;
      border-left: 3px solid #4f545c;
      background: rgba(79, 84, 92, 0.1);
      border-radius: 0 4px 4px 0;
    }

    .forward-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .forward-icon {
      color: #b9bbbe;
      font-size: 12px;
    }

    .forward-label {
      color: #b9bbbe;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .forward-content {
      color: var(--text-primary);
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .forward-attachments {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .forward-attachment {
      color: var(--text-link);
      font-size: 13px;
      text-decoration: none;
    }

    .forward-attachment:hover {
      text-decoration: underline;
    }

    /* ==== THREAD BANNERS ==== */
    .thread-banner {
      margin-top: 8px;
      padding: 0;
    }

    .thread-banner-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(88, 101, 242, 0.1);
      border: 1px solid rgba(88, 101, 242, 0.3);
      border-radius: 4px;
      color: #c9d1ff;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: background 150ms ease, border-color 150ms ease;
    }

    .thread-banner-link:hover {
      background: rgba(88, 101, 242, 0.2);
      border-color: rgba(88, 101, 242, 0.5);
      color: #fff;
      text-decoration: none;
    }

    .thread-banner-icon {
      font-size: 14px;
    }

    .thread-banner-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .thread-banner-arrow {
      color: #72767d;
    }

    /* ==== THREAD BACK NAVIGATION ==== */
    .thread-back-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #b9bbbe;
      font-size: 13px;
      text-decoration: none;
      margin-bottom: 8px;
      transition: color 150ms ease;
    }

    .thread-back-link:hover {
      color: #fff;
      text-decoration: none;
    }

    /* ==== DATE DIVIDERS ==== */
    .date-divider {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 16px 0 8px;
      position: relative;
    }

    .date-divider::before,
    .date-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border-color);
    }

    .date-divider-text {
      padding: 0 16px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
    }

    /* ==== SYSTEM MESSAGES ==== */
    /* Structure mirrors .message so the icon sits where a regular
       avatar would and the text starts where regular message content
       starts. Icon column is 40px (= .avatar width), centered, with a
       right-margin to reach the full .message-left outer width (60 + 16
       = 76px). That lines text up at the same x-coordinate as .message-
       content's first character. */
    .system-message {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
      min-height: 36px;
    }

    .system-message-icon {
      flex-shrink: 0;
      width: 40px;
      margin-right: 36px;
      text-align: center;
      color: var(--text-muted);
      opacity: 0.7;
      /* The inline SVG uses fill=currentColor so it inherits this
         container's color and light/dark theme changes propagate. */
    }

    .system-message-icon svg {
      vertical-align: middle;
    }

    .system-message-text {
      flex: 1;
      min-width: 0;
    }

    /* Author (always the first <strong> in formatSystemMessage output)
       picks up its role color from the inline --system-author-color
       custom property when the guild member has a colored role. Later
       <strong> tokens (thread names, boost tier content) stay primary. */
    .system-message-text strong:first-of-type {
      color: var(--system-author-color, var(--text-primary));
      font-weight: 600;
    }
    .system-message-text strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .system-message-text .system-link {
      color: var(--link-color, #00b0f4);
      cursor: pointer;
      text-decoration: none;
    }
    .system-message-text .system-link:hover {
      text-decoration: underline;
    }

    .system-message-timestamp {
      font-size: 11px;
      color: var(--text-muted);
      opacity: 0.7;
      margin-left: 4px;
      white-space: nowrap;
    }

    .system-message-embed {
      /* Aligns embed under the text column of the system-message row. */
      padding: 4px 16px 8px 92px;
    }

    /* ==== SEARCH BAR ==== */
    .search-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }

    .search-input {
      flex: 1;
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-primary);
      padding: 8px 12px;
      font-size: 14px;
      outline: none;
      transition: border-color 200ms ease;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    .search-count {
      color: #72767d;
      font-size: 13px;
      white-space: nowrap;
    }

    .search-clear {
      background: transparent;
      border: none;
      color: #72767d;
      font-size: 18px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: color 150ms ease, background 150ms ease;
    }

    .search-clear:hover {
      color: #dcddde;
      background: rgba(79, 84, 92, 0.4);
    }

    /* Search result styling */
    .message.search-hidden {
      display: none;
    }

    /* Search author label injected into grouped messages during search */
    .search-author-label {
      margin-bottom: 4px;
    }

    .date-divider.search-hidden {
      display: none;
    }

    .search-highlight {
      background: rgba(250, 166, 26, 0.3);
      border-radius: 2px;
      padding: 0 1px;
    }

    /* ==== PAGE NAVIGATION ==== */
    .nav-btn {
      background: rgba(88, 101, 242, 0.2);
      color: #c9d1ff;
      border: 1px solid rgba(88, 101, 242, 0.3);
      border-radius: 4px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: background 200ms ease, border-color 200ms ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .nav-btn:hover {
      background: rgba(88, 101, 242, 0.35);
      border-color: rgba(88, 101, 242, 0.5);
      color: #fff;
      text-decoration: none;
    }

    .nav-btn[disabled], .nav-btn.disabled {
      opacity: 0.3;
      cursor: default;
      pointer-events: none;
    }

    .nav-page-info {
      color: #b9bbbe;
      font-size: 13px;
    }

    /* Bottom navigation bar */
    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(180deg, #282b30 0%, #1e2124 100%);
      border-top: 1px solid rgba(114, 137, 218, 0.2);
      padding: 8px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 99;
      box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.3);
    }

    .bottom-nav .nav-btn {
      padding: 4px 12px;
      font-size: 12px;
    }

    .bottom-nav .nav-page-info {
      font-size: 12px;
    }

    /* Jump to top button */
    .jump-top {
      position: fixed;
      bottom: 56px;
      right: 20px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #5865f2;
      color: #fff;
      border: none;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 200ms ease, transform 200ms ease, background 200ms ease;
      z-index: 98;
      pointer-events: none;
    }

    .jump-top.visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .jump-top:hover {
      background: #4752c4;
    }

    /* Add bottom padding to container so content isn't hidden behind bottom nav */
    .container {
      padding-bottom: 60px;
    }

    /* ==== THEME SWITCHER ==== */
    .theme-select {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      padding: 6px 10px;
      transition: background 150ms ease, color 150ms ease;
      flex-shrink: 0;
    }

    .theme-select:hover, .theme-select:focus {
      background: var(--bg-hover);
      color: var(--text-primary);
      outline: none;
    }

    /* Light theme overrides for elements using hardcoded colors */
    .light-theme .header h1 {
      background: linear-gradient(135deg, #2e3338, #5865f2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .light-theme .header {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .light-theme .author {
      color: #2e3338;
      text-shadow: none;
    }

    .light-theme strong {
      color: #2e3338;
    }

    .light-theme em {
      color: #4f5660;
    }

    .light-theme del {
      opacity: 0.5;
    }

    .light-theme .avatar {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .light-theme .avatar-placeholder {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    /* Mentions */
    .light-theme .user-mention {
      background: rgba(88, 101, 242, 0.15);
      color: #5865f2;
    }

    .light-theme .user-mention:hover {
      background: rgba(88, 101, 242, 0.25);
    }

    .light-theme .channel-mention {
      background: rgba(88, 101, 242, 0.1);
      color: #4752c4;
    }

    .light-theme .channel-mention:hover {
      background: rgba(88, 101, 242, 0.2);
    }

    /* Code */
    .light-theme .inline-code {
      background: #e8e8e8;
      color: #d63384;
    }

    .light-theme .code-block {
      background: #f2f3f5;
      border-color: #e3e5e8;
    }

    .light-theme .code-block code {
      color: #2e3338;
    }

    .light-theme .hljs {
      background: #f6f8fa;
      color: #24292e;
    }

    /* Spoilers */
    .light-theme .spoiler {
      background: #ccc;
    }

    .light-theme .spoiler:hover {
      background: #bbb;
    }

    .light-theme .spoiler-revealed {
      background: rgba(88, 101, 242, 0.1);
      color: #2e3338 !important;
    }

    /* Embeds */
    .light-theme .embed {
      background: rgba(0, 0, 0, 0.03);
      border-left-color: #e3e5e8;
    }

    .light-theme .embed-title {
      color: #2e3338;
    }

    .light-theme .embed-title a {
      color: #0067e0;
    }

    .light-theme .embed-description {
      color: #4f5660;
    }

    .light-theme .embed-field-name {
      color: #2e3338;
    }

    .light-theme .embed-field-value {
      color: #4f5660;
    }

    .light-theme .embed-author-name {
      color: #2e3338;
    }

    /* Reactions */
    .light-theme .reaction {
      background: rgba(0, 0, 0, 0.04);
      border-color: rgba(0, 0, 0, 0.08);
    }

    .light-theme .reaction:hover {
      background: rgba(88, 101, 242, 0.1);
      border-color: rgba(88, 101, 242, 0.3);
    }

    .light-theme .reaction-count {
      color: #4f5660;
    }

    /* Attachments */
    .light-theme .attachment-card {
      background: rgba(0, 0, 0, 0.02);
      border-color: #e3e5e8;
    }

    .light-theme .attachment-card:hover {
      background: rgba(0, 0, 0, 0.04);
      border-color: #c4c9ce;
    }

    .light-theme .attachment-name {
      color: #0067e0;
    }

    .light-theme .attachment-size {
      color: #747f8d;
    }

    .light-theme .attachment-badge.local {
      background: rgba(67, 181, 129, 0.1);
      color: #2d8b5e;
    }

    .light-theme .attachment-badge.external {
      background: rgba(250, 166, 26, 0.1);
      color: #b47615;
    }

    /* Reply bars */
    .light-theme .reply-bar {
      background: rgba(0, 0, 0, 0.03);
      border-left-color: #c4c9ce;
    }

    .light-theme .reply-bar:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    .light-theme .reply-author {
      color: #2e3338;
    }

    .light-theme .reply-content {
      color: #4f5660;
    }

    /* Thread banners */
    .light-theme .thread-banner-link {
      background: rgba(88, 101, 242, 0.06);
      border-color: rgba(88, 101, 242, 0.15);
      color: #4752c4;
    }

    .light-theme .thread-banner-link:hover {
      background: rgba(88, 101, 242, 0.12);
      color: #3c45a5;
    }

    /* Nav buttons */
    .light-theme .nav-btn {
      background: rgba(88, 101, 242, 0.08);
      color: #4752c4;
      border-color: rgba(88, 101, 242, 0.15);
    }

    .light-theme .nav-btn:hover {
      background: rgba(88, 101, 242, 0.15);
      color: #3c45a5;
    }

    /* Popups */
    .light-theme .discrub-popup {
      background: #fff;
      border-color: #e3e5e8;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }

    .light-theme .user-popup-banner {
      opacity: 0.8;
    }

    .light-theme .user-popup-name {
      color: #2e3338;
    }

    .light-theme .user-popup-username {
      color: #4f5660;
    }

    .light-theme .user-popup-divider {
      background: #e3e5e8;
    }

    .light-theme .user-popup-section-title {
      color: #747f8d;
    }

    .light-theme .user-popup-value {
      color: #2e3338;
    }

    .light-theme .user-popup-badge {
      background: #f2f3f5;
      border-color: #c4c9ce;
      color: #4f5660;
    }

    /* Reaction popup */
    .light-theme .reaction-tab {
      color: #747f8d;
    }

    .light-theme .reaction-tab:hover {
      color: #4f5660;
    }

    .light-theme .reaction-tab.active {
      color: #2e3338;
    }

    .light-theme .reaction-user-name {
      color: #2e3338;
    }

    .light-theme .reaction-user-row:hover {
      background: rgba(0, 0, 0, 0.04);
    }

    .light-theme .reaction-search-input {
      background: #f2f3f5;
      border-color: #e3e5e8;
      color: #2e3338;
    }

    /* Message toolbar */
    .light-theme .msg-toolbar {
      background: #fff;
      border-color: #e3e5e8;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .light-theme .msg-toolbar-btn {
      border-color: #e3e5e8;
      color: #747f8d;
    }

    .light-theme .msg-toolbar-btn:hover {
      background: rgba(0, 0, 0, 0.04);
      color: #2e3338;
    }

    /* Bottom nav */
    .light-theme .bottom-nav {
      background: var(--bg-secondary);
      border-color: var(--border-color);
      box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
    }

    /* Jump to top */
    .light-theme .jump-top {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    /* Edited indicator */
    .light-theme .edited-indicator {
      color: #747f8d;
    }

    /* Grouped timestamp */
    .light-theme .message-grouped:hover .grouped-timestamp {
      color: #747f8d;
    }

    /* Lightbox adjustments */
    .light-theme .lightbox-overlay {
      background: rgba(0, 0, 0, 0.7);
    }

    /* Lightbox controls */
    .light-theme .lightbox-close,
    .light-theme .lightbox-nav {
      background: rgba(255, 255, 255, 0.8);
      color: #2e3338;
    }

    .light-theme .lightbox-close:hover,
    .light-theme .lightbox-nav:hover {
      background: rgba(255, 255, 255, 0.95);
    }

    .light-theme .lightbox-counter {
      background: rgba(255, 255, 255, 0.8);
      color: #4f5660;
    }

    /* Reaction popup extras */
    .light-theme .reaction-popup-tabs {
      border-bottom-color: #e3e5e8;
    }

    .light-theme .reaction-show-more {
      background: rgba(88, 101, 242, 0.06);
      border-color: rgba(88, 101, 242, 0.15);
      color: #4752c4;
    }

    .light-theme .reaction-show-more:hover {
      background: rgba(88, 101, 242, 0.12);
    }

    .light-theme .reaction-count-only {
      color: #4f5660;
    }

    .light-theme .reaction-count-text {
      color: #4f5660;
    }

    /* Search extras */
    .light-theme .search-count {
      color: #747f8d;
    }

    .light-theme .search-clear {
      color: #747f8d;
    }

    .light-theme .search-clear:hover {
      color: #2e3338;
      background: rgba(0, 0, 0, 0.06);
    }

    .light-theme .search-highlight {
      background: rgba(250, 166, 26, 0.4);
    }

    /* Reply deleted */
    .light-theme .reply-bar-deleted {
      border-left-color: #f04747;
    }

    .light-theme .reply-content-deleted {
      color: #747f8d;
    }

    /* Thread back link */
    .light-theme .thread-back-link {
      color: #4f5660;
    }

    .light-theme .thread-back-link:hover {
      color: #2e3338;
    }

    /* Nav page info */
    .light-theme .nav-page-info {
      color: #4f5660;
    }

    /* Link hover */
    .light-theme a:hover {
      color: #004db3;
    }

    /* Embed footer */
    .light-theme .embed-footer {
      color: #747f8d;
    }

    /* Attachment hover */
    .light-theme .attachment-card:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    /* Jump to top */
    .light-theme .jump-top {
      background: #5865f2;
    }

    .light-theme .jump-top:hover {
      background: #4752c4;
    }

    /* ==== RESPONSIVE ==== */
    @media (max-width: 768px) {
      .header {
        padding: 12px 16px;
      }

      .header h1 {
        font-size: 22px;
      }

      .container {
        padding: 12px;
      }

      .message {
        padding: 12px 8px;
      }

      .avatar {
        width: 32px;
        height: 32px;
      }

      .message-left {
        width: 48px;
        padding-right: 12px;
      }

      .attachments {
        grid-template-columns: 1fr;
      }

      .embed {
        max-width: 100%;
      }

      .search-bar {
        flex-wrap: wrap;
      }

      .search-input {
        min-width: 0;
      }
    }

    @media (max-width: 480px) {
      .header h1 {
        font-size: 18px;
      }

      .message-left {
        width: 40px;
        padding-right: 8px;
      }

      .avatar {
        width: 28px;
        height: 28px;
      }

      .message {
        padding: 10px 6px;
      }

      .author {
        font-size: 13px;
      }

      .message-text {
        font-size: 14px;
      }

      .msg-toolbar {
        right: 4px;
      }

      .nav-btn {
        padding: 4px 8px;
        font-size: 12px;
      }

      .reaction {
        padding: 3px 6px;
        font-size: 12px;
      }
    }

    /* ==== EXPORT FOOTER ==== */
    .export-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      text-align: center;
      padding: 32px 20px 80px;
      border-top: 1px solid var(--border-color);
      margin-top: 24px;
    }

    .export-footer-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      flex-shrink: 0;
    }

    .export-footer-lines {
      text-align: left;
    }

    .export-footer-text {
      color: var(--text-muted);
      font-size: 13px;
      margin-bottom: 4px;
    }

    .export-footer-text strong {
      color: var(--accent);
      font-weight: 600;
    }

    .export-footer-meta {
      color: var(--text-muted);
      font-size: 11px;
      opacity: 0.7;
    }

    /* ==== REDUCED MOTION ==== */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }

    /* ==== PRINT STYLES ==== */
    @media print {
      .bottom-nav, .jump-top, .search-bar, .theme-select {
        display: none !important;
      }

      .container {
        padding-bottom: 0;
      }

      body, :root {
        --bg-primary: white;
        --bg-secondary: white;
        --text-primary: black;
        --text-secondary: #333;
        --text-muted: #666;
        --border-color: #ddd;
        --card-bg: #f9f9f9;
        background: white;
        color: black;
      }

      .header {
        background: white;
        color: black;
        border-bottom: 2px solid #ccc;
        box-shadow: none;
        position: static;
      }

      .header h1 {
        background: none;
        -webkit-background-clip: unset;
        -webkit-text-fill-color: black;
        color: black;
      }

      .message {
        page-break-inside: avoid;
        background: none !important;
        border-bottom: 1px solid #eee;
        transform: none !important;
      }

      .avatar {
        box-shadow: none;
        border: 1px solid #ccc;
      }

      .message-text, .embed-description, .embed-field-value {
        color: black;
      }

      .author, .embed-title, .embed-field-name {
        color: #333;
      }

      .timestamp, .embed-footer {
        color: #666;
      }

      .attachment, .reaction, .embed {
        background: #f9f9f9;
        border: 1px solid #ddd;
        box-shadow: none;
      }

      .code-block {
        background: #f5f5f5;
        border: 1px solid #ddd;
      }

      a {
        color: #0066cc;
        text-decoration: underline;
      }

      .embed-image, .embed-video {
        max-width: 100%;
        page-break-inside: avoid;
      }

      .attachment-preview-img {
        max-height: none;
      }
    }

    /* ==== POPUPS ==== */
    .discrub-popup {
      background: #18191c;
      border: 1px solid rgba(114, 137, 218, 0.3);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      min-width: 200px;
      max-width: 400px;
      max-height: 400px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: popup-fade-in 150ms ease;
    }

    @keyframes popup-fade-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .user-popup-card {
      overflow: hidden;
    }

    .user-popup-banner {
      height: 60px;
      width: 100%;
    }

    .user-popup-avatar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 16px;
      margin-top: -20px;
      margin-bottom: 8px;
    }

    .user-popup-avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 4px solid #18191c;
      object-fit: cover;
    }

    .user-popup-avatar-placeholder {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 4px solid #18191c;
      background: linear-gradient(135deg, #7289da, #5865f2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 20px;
      color: #fff;
    }

    .user-popup-bot-badge {
      background: #5865f2;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .user-popup-name {
      font-weight: 700;
      font-size: 18px;
      color: #fff;
      padding: 0 16px;
      margin-bottom: 2px;
    }

    .user-popup-username {
      font-size: 14px;
      color: #b9bbbe;
      padding: 0 16px;
      margin-bottom: 4px;
    }

    .user-popup-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
      margin: 8px 16px;
    }

    .user-popup-section {
      padding: 0 16px;
      margin-bottom: 8px;
    }

    .user-popup-section-title {
      font-size: 11px;
      font-weight: 700;
      color: #b9bbbe;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .user-popup-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 16px;
      font-size: 13px;
    }

    .user-popup-label {
      color: #72767d;
    }

    .user-popup-value {
      color: #dcddde;
      font-weight: 500;
    }

    .user-popup-mono {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
    }

    .user-popup-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .user-popup-badge {
      background: #2f3136;
      color: #dcddde;
      border: 1px solid #7289da;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .user-popup-count {
      font-size: 13px;
      color: #b9bbbe;
      padding: 4px 16px 12px;
    }

    /* ==== REACTION POPUP ==== */
    .reaction-popup-card {
      min-width: 280px;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      max-height: 100%;
    }

    .reaction-popup-tabs {
      display: flex;
      gap: 0;
      padding: 8px 8px 0;
      border-bottom: 1px solid #2f3136;
      overflow-x: auto;
      flex-shrink: 0;
    }

    .reaction-tab {
      background: transparent;
      border: none;
      color: #b9bbbe;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 150ms ease, border-color 150ms ease;
      white-space: nowrap;
    }

    .reaction-tab:hover {
      color: #dcddde;
    }

    .reaction-tab.active {
      color: #fff;
      border-bottom-color: #5865f2;
    }

    .reaction-popup-content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px;
    }

    .reaction-user-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .reaction-user-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      transition: background 100ms ease;
    }

    .reaction-user-row:hover {
      background: rgba(79, 84, 92, 0.4);
    }

    .reaction-user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }

    .reaction-user-avatar-placeholder {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7289da, #5865f2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      color: #fff;
      flex-shrink: 0;
    }

    .reaction-user-name {
      color: #dcddde;
      font-size: 14px;
      font-weight: 500;
      flex: 1;
    }

    .reaction-user-emoji {
      font-size: 16px;
    }

    .reaction-search-bar {
      padding: 8px 8px 4px;
      flex-shrink: 0;
    }

    .reaction-search-input {
      width: 100%;
      background: #1e1f22;
      border: 1px solid #40444b;
      border-radius: 4px;
      color: #dcddde;
      padding: 6px 10px;
      font-size: 13px;
      outline: none;
      transition: border-color 150ms ease;
    }

    .reaction-search-input:focus {
      border-color: #5865f2;
    }

    .reaction-search-input::placeholder {
      color: #72767d;
    }

    .reaction-show-more {
      width: 100%;
      background: rgba(88, 101, 242, 0.1);
      border: 1px solid rgba(88, 101, 242, 0.2);
      border-radius: 4px;
      color: #c9d1ff;
      padding: 8px;
      margin-top: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: background 150ms ease;
    }

    .reaction-show-more:hover {
      background: rgba(88, 101, 242, 0.2);
    }

    .reaction-count-only {
      padding: 16px;
      text-align: center;
      color: #b9bbbe;
      font-size: 14px;
    }

    .reaction-count-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
    }

    .reaction-count-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px;
    }

    .reaction-count-emoji {
      font-size: 20px;
    }

    .reaction-count-text {
      color: #b9bbbe;
      font-size: 14px;
    }

    /* ==== MESSAGE HOVER TOOLBAR ==== */
    .msg-toolbar {
      position: absolute;
      top: -16px;
      right: 16px;
      display: flex;
      gap: 0;
      background: #2f3136;
      border: 1px solid #202225;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      animation: popup-fade-in 80ms ease;
      z-index: 50;
    }

    .msg-toolbar-btn {
      background: transparent;
      border: none;
      border-right: 1px solid #202225;
      color: #b9bbbe;
      cursor: pointer;
      padding: 6px 10px;
      font-size: 16px;
      line-height: 1;
      transition: background 100ms ease, color 100ms ease;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .msg-toolbar-btn:last-child {
      border-right: none;
    }

    .msg-toolbar-btn:hover {
      background: rgba(79, 84, 92, 0.6);
      color: #dcddde;
    }

    .msg-toolbar-btn svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
      flex-shrink: 0;
    }

    .msg-toolbar-label {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="header" role="banner">${mediaPathPrefix ? `
    <a href="../${sanitizedName || channelName}-page-${backLinkPage || 1}.html" class="thread-back-link">&larr; Back to #${sanitizedName || channelName}</a>` : ''}
    <h1>#${channelName}</h1>
    <div class="meta">
      ${messages.length} messages${pageInfo}
      <span style="float: right;">Exported: ${format(new Date(), `MMM dd, yyyy ${exportConfig?.timeFormat || 'HH:mm'}`)}</span>
    </div>
    <div class="search-bar">
      <input class="search-input" id="search-input" type="text" placeholder="Search messages..." aria-label="Search messages" />
      <span class="search-count" id="search-count" aria-live="polite"></span>
      <button class="search-clear" id="search-clear" style="display:none" aria-label="Clear search">&times;</button>
      ${buildThemeSelectHtml(themeSet, 'theme-select', 'theme-select')}
    </div>
  </div>
  <main class="container" role="main">
    `;

    const footHtml = `
  </main>${totalPages > 1 ? `
  <nav class="bottom-nav" role="navigation" aria-label="Page navigation">
    ${pageNumber > 1
      ? `<a class="nav-btn" href="${sanitizedName || channelName}-page-${pageNumber - 1}.html">\u2190 Previous</a>`
      : '<span class="nav-btn disabled">\u2190 Previous</span>'}
    <span class="nav-page-info">Page ${pageNumber} of ${totalPages}</span>
    ${pageNumber < totalPages
      ? `<a class="nav-btn" href="${sanitizedName || channelName}-page-${pageNumber + 1}.html">Next \u2192</a>`
      : '<span class="nav-btn disabled">Next \u2192</span>'}
  </nav>` : ''}
${buildExportFooterHtml(this.exportFooterConfig, {
    dateText: format(new Date(), 'MMMM d, yyyy'),
    metaLine: `${(exportConfig as any)?.exportFormat || 'html'} &middot; ${messages.length} messages${totalPages > 1 ? ` &middot; Page ${pageNumber} of ${totalPages}` : ''}${(exportConfig?.previewMedia !== false) ? ' &middot; Media included' : ''}`,
  })}
  <button class="jump-top" id="jump-top" title="Scroll to top" aria-label="Scroll to top">\u2191</button>
  <script type="application/json" id="export-data">${JSON.stringify(buildExportPageData(messages, pageNumber, totalPages, sanitizedName || channelName, formattingContext, reactionMap, mediaMaps?.avatarMap, cachedUserMap, guildId, formattingContext?.guildRoles as any, mediaMaps?.emojiMap, mediaMaps?.roleMap))}</script>
  <script>${generateEmbeddedJs(themeSet)}</script>
</body>
</html>
    `;

    // Stitch head + per-message rows + foot as separate Blob parts so
    // `new Blob(parts)` (at the page-writing call sites) never has to
    // allocate one mega-string. Per-message HTML stays in scope as the
    // array entries; the head and foot are bounded constants. The cap
    // is per-part now, not per-page (#185 Bug B).
    let parts: string[] = [headHtml, ...messageRowParts, footHtml];

    // For thread files (nested in threads/ subdirectory), prefix relative
    // media paths on each part independently. Safe because every media
    // reference is fully contained within a single message-row part (no
    // src=/href= spans a part boundary).
    if (mediaPathPrefix) {
      parts = parts.map((p) => this.prefixRelativeMediaPaths(p, mediaPathPrefix));
    }

    // Defense-in-depth (#198): dev-mode HTML balance check. If a future
    // change to this file or to discrub-core's formatContentAsHtml introduces
    // a path that emits an unbalanced <div>, we want to know during local
    // testing — not from a user reporting that messages tile horizontally.
    // Silent in production. The Vitest suite at
    // exportService.htmlBalance.test.ts is the primary safety net; this is
    // the late-binding catch for anything that snuck past the fuzz cases.
    if (import.meta.env.DEV) {
      const balance = assertBalancedTags(parts.join(''));
      if (!balance.balanced) {
        console.warn(
          `[exportService] HTML balance check failed for "${channelName}" page ${pageNumber}/${totalPages}: <div> diff is ${balance.divDiff}. Possible #198 regression.`,
        );
      }
    }

    return parts;
  }

  /**
   * Prefix relative media paths in HTML content.
   * Used for thread files that live in a subdirectory and need adjusted paths.
   */
  private prefixRelativeMediaPaths(html: string, prefix: string): string {
    // Match src="..." and href="..." attributes containing relative media paths
    // Media directories: avatars/, media/, emojis/, roles/, stickers/
    return html.replace(
      /((?:src|href)=")(?=(?:avatars|media|emojis|roles|stickers)\/)/g,
      `$1${prefix}`
    );
  }

  /**
   * Sanitize filename for safe file system use.
   * Optionally appends an ID suffix to prevent collisions between
   * names that differ only in case or special characters.
   */
  sanitizeFilename(name: string, id?: string): string {
    const sanitized = name.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/_+/g, '_').replace(/^_|_$/g, '');
    return id ? `${sanitized}_${id}` : sanitized;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Escape CSV special characters
   */
  private escapeCSV(text: string): string {
    return text.replace(/"/g, '""');
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Map a filename to a file-type kind for the attachment icon.
   */
  private fileIconKind(filename: string): FileIconKind {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const kinds: Record<string, FileIconKind> = {
      jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
      mp4: 'video', webm: 'video', mov: 'video', avi: 'video', mkv: 'video',
      mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio',
      pdf: 'document', doc: 'document', docx: 'document', txt: 'document',
      zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
      js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', java: 'code',
      html: 'code', css: 'code', json: 'code', xml: 'code',
    };
    return kinds[ext] || 'file';
  }

  /**
   * Inline SVG icon for a file-type kind (24px viewBox, currentColor, no
   * emoji so the export reads the same on every platform and font).
   */
  private fileIconSvg(kind: FileIconKind): string {
    const paths: Record<FileIconKind, string> = {
      image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-6 6-2-2-5 5"/>',
      video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
      audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
      document: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
      archive: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M12 9v11M10 13h4"/>',
      code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
      sticker: '<path d="M4 4h12l4 4v12H4z"/><path d="M16 4v4h4M16 20v-4h4"/>',
      file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/>',
    };
    return `<svg class="file-icon file-icon-${kind}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
  }

  /**
   * Inline SVG icon for a filename's file type.
   */
  private getFileIcon(filename: string): string {
    return this.fileIconSvg(this.fileIconKind(filename));
  }
}

let exportServiceInstance: ExportService | null = null;

export const getExportService = (): ExportService => {
  if (!exportServiceInstance) {
    exportServiceInstance = new ExportService();
  }
  return exportServiceInstance;
};

/**
 * Check that the cumulative <div> open and close counts match in an HTML
 * string. Used as the dev-mode catch-net for the #198 cascade bug class:
 * if a future emitter forgets a close, every message after the broken one
 * cascades into the unclosed wrapper and tiles horizontally. The fuzz
 * suite in exportService.htmlBalance.test.ts is the primary guard; this
 * helper exists so the production code path can also flag a problem
 * during local dev export runs.
 *
 * Returns the diff so the caller can write a useful warning. A positive
 * diff means more opens than closes (the cascade-trigger shape).
 */
export const assertBalancedTags = (html: string): { balanced: boolean; divDiff: number } => {
  const divOpens = (html.match(/<div[\s>]/g) || []).length;
  const divCloses = (html.match(/<\/div>/g) || []).length;
  return { balanced: divOpens === divCloses, divDiff: divOpens - divCloses };
};
