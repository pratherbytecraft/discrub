import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getExportService } from './exportService';
import { resolveExportThemeSet, defaultExportThemeSet } from './exportThemes';
import { defaultExportFooterConfig } from './exportFooter';
import {
  EXPORT_MESSAGES,
  EXPORT_USER_MAP,
  EXPORT_GUILD_ID,
  DEFAULT_EXPORT_CONFIG,
  THREAD_MESSAGES,
  THREAD_CHANNEL,
} from '@/test/export-fixtures';
import {
  REPLY_MESSAGES,
  EDITED_MESSAGES,
  CODE_SPOILER_MESSAGES,
  GROUPED_MESSAGES,
  MEDIA_HEAVY_MESSAGES,
  DM_MESSAGES,
  COMPREHENSIVE_MESSAGES,
  AUTHOR_ALICE,
} from '@/test/export-html-fixtures';
import type { Message } from 'discrub-core/types/discord-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import type { ExportConfig } from '@features/export/exportTypes';

// ── Content-Capturing Mock ────────────────────────────────────────
// jsdom's Blob lacks .text(), so we read content via Response API
let capturedFiles: Map<string, string>;

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

vi.mock('./streamingZipService', () => ({
  StreamingZipService: vi.fn().mockImplementation(() => ({
    addFile: vi.fn(async (blob: Blob, path: string) => {
      const text = await readBlobAsText(blob);
      capturedFiles.set(path, text);
    }),
    finalize: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./mediaDownloadService', () => ({
  MediaDownloadService: vi.fn().mockImplementation(() => ({
    downloadAllMedia: vi.fn().mockResolvedValue({
      avatarMap: {},
      mediaMap: {},
      emojiMap: {},
      roleMap: {},
    }),
    downloadMediaOnly: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────

function getFileContent(path: string): string {
  const content = capturedFiles.get(path);
  if (content === undefined) {
    throw new Error(`No file at path: ${path}. Files: ${[...capturedFiles.keys()].join(', ')}`);
  }
  return content;
}

async function exportAndGetFile(
  format: 'html' | 'csv' | 'json',
  overrides?: {
    messages?: Message[];
    channelName?: string;
    messagesPerPage?: number;
    exportConfig?: ExportConfig;
    includeMedia?: boolean;
    guildId?: string | null;
    cachedUserMap?: ExportUserMap;
  },
): Promise<string> {
  const service = getExportService();
  const name = overrides?.channelName ?? 'test-channel';
  const sanitized = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

  await service.exportToZip(
    overrides?.messages ?? EXPORT_MESSAGES,
    name,
    format,
    overrides?.messagesPerPage ?? 100,
    overrides?.includeMedia ?? false,
    null, // guild
    overrides?.cachedUserMap ?? EXPORT_USER_MAP,
    overrides?.guildId !== undefined ? overrides.guildId : EXPORT_GUILD_ID,
    undefined, // onProgress
    undefined, // mediaConfig
    overrides?.exportConfig ?? DEFAULT_EXPORT_CONFIG,
  );

  const filePath = `${sanitized}/${sanitized}-page-1.${format}`;
  return Promise.resolve(getFileContent(filePath));
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  capturedFiles = new Map<string, string>();
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════
// CSV EXPORT
// ═════════════════════════════════════════════════════════════════

describe('CSV Export', () => {
  describe('Structure', () => {
    it('should have correct headers', async () => {
      const csv = await exportAndGetFile('csv');
      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'ID,Timestamp,Username,Display Name,Server Nickname,Content,Forwarded Content,Attachments,Embeds,Reactions',
      );
    });

    it('should have correct number of data rows', async () => {
      const csv = await exportAndGetFile('csv');
      const lines = csv.split('\n');
      expect(lines.length).toBe(EXPORT_MESSAGES.length + 1); // +1 for header
    });

    it('should have correct file path in ZIP', async () => {
      await exportAndGetFile('csv');
      expect(capturedFiles.has('test_channel/test_channel-page-1.csv')).toBe(true);
      expect(capturedFiles.has('test_channel/README.html')).toBe(true);
      expect(capturedFiles.size).toBe(2);
    });

    it('should quote text fields and not quote numeric fields', async () => {
      const csv = await exportAndGetFile('csv');
      const lines = csv.split('\n');
      // msg-4: 1 attachment, 0 embeds, 5 reactions — numeric fields unquoted
      const msg4Line = lines.find((l) => l.includes('"msg-4"'));
      expect(msg4Line).toBeDefined();
      expect(msg4Line).toMatch(/,1,0,5$/);
    });
  });

  describe('Timestamps', () => {
    it('should format with default config (MM/dd/yyyy h:mm aa)', async () => {
      const csv = await exportAndGetFile('csv');
      // msg-5 timestamp: 2026-06-15T14:30:00.000Z → 06/15/2026 2:30 PM (local time varies)
      // Use a known UTC-safe check: the date portion should be present
      expect(csv).toContain('06/15/2026');
    });

    it('should format with dd/MM/yyyy + HH:mm:ss', async () => {
      const config: ExportConfig = {
        ...DEFAULT_EXPORT_CONFIG,
        dateFormat: 'dd/MM/yyyy',
        timeFormat: 'HH:mm:ss',
      };
      const csv = await exportAndGetFile('csv', { exportConfig: config });
      // msg-1 timestamp: 2026-06-15T10:00:00.000Z → 15/06/2026
      expect(csv).toContain('15/06/2026');
    });

    it('should fall back to yyyy-MM-dd HH:mm:ss without exportConfig', async () => {
      // Pass exportConfig with no dateFormat/timeFormat to trigger fallback
      const service = getExportService();
      await service.exportToZip(
        EXPORT_MESSAGES, 'test-channel', 'csv', 100, false, null,
        EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
        undefined, // no exportConfig at all
      );
      const csv = getFileContent('test_channel/test_channel-page-1.csv');
      // Should use fallback format yyyy-MM-dd HH:mm:ss
      expect(csv).toContain('2026-06-15');
    });
  });

  describe('Sort Order', () => {
    it('should order rows oldest-first when ascending', async () => {
      const config: ExportConfig = { ...DEFAULT_EXPORT_CONFIG, sortOrder: 'ascending' };
      const csv = await exportAndGetFile('csv', { exportConfig: config });
      const lines = csv.split('\n');
      expect(lines[1]).toContain('"msg-1"'); // first data row = oldest
      expect(lines[lines.length - 1]).toContain('"msg-8"'); // last = newest
    });

    it('should order rows newest-first when descending', async () => {
      const csv = await exportAndGetFile('csv');
      const lines = csv.split('\n');
      expect(lines[1]).toContain('"msg-8"'); // first data row = newest
      expect(lines[lines.length - 1]).toContain('"msg-1"'); // last = oldest
    });
  });

  describe('Data Fidelity', () => {
    it('should resolve username/displayName/nickname from cachedUserMap', async () => {
      const csv = await exportAndGetFile('csv');
      // Alice is in cache with nick "AliceNick" for guild-1
      expect(csv).toContain('"alice"');
      expect(csv).toContain('"Alice Display"');
      expect(csv).toContain('"AliceNick"');
    });

    it('should fall back to author data on cache miss', async () => {
      const csv = await exportAndGetFile('csv', { cachedUserMap: {}, guildId: null });
      // No cache — falls back to msg.author.username
      expect(csv).toContain('"alice"');
      expect(csv).toContain('"bob"');
    });

    it('should show "Unknown" for missing author', async () => {
      const noAuthorMsg = {
        ...EXPORT_MESSAGES[0],
        id: 'msg-noauthor',
        author: undefined,
      } as unknown as Message;
      const csv = await exportAndGetFile('csv', { messages: [noAuthorMsg] });
      expect(csv).toContain('"Unknown"');
    });

    it('should count attachments, embeds, reactions correctly', async () => {
      const csv = await exportAndGetFile('csv');
      const lines = csv.split('\n');
      // msg-4: 1 attachment, 0 embeds, 5 reactions
      const msg4Line = lines.find((l) => l.includes('"msg-4"'));
      expect(msg4Line).toMatch(/,1,0,5$/);
      // msg-5: 0 attachments, 1 embed, 0 reactions
      const msg5Line = lines.find((l) => l.includes('"msg-5"'));
      expect(msg5Line).toMatch(/,0,1,0$/);
      // msg-6: 1 attachment, 0 embeds, 5 reactions (3+2)
      const msg6Line = lines.find((l) => l.includes('"msg-6"'));
      expect(msg6Line).toMatch(/,1,0,5$/);
    });

    it('should escape double quotes as "" in content', async () => {
      const csv = await exportAndGetFile('csv');
      // msg-5: Has "quotes" and commas, here
      expect(csv).toContain('Has ""quotes"" and commas, here');
    });
  });

  describe('Content Preservation', () => {
    it('should preserve raw mention syntax', async () => {
      const csv = await exportAndGetFile('csv');
      // msg-3: Check <@100000000000000002> and <#800000000000000099>
      expect(csv).toContain('<@100000000000000002>');
      expect(csv).toContain('<#800000000000000099>');
    });

    it('should preserve empty content as empty string', async () => {
      const csv = await exportAndGetFile('csv');
      const lines = csv.split('\n');
      // msg-6 has empty content — the content field should be ""
      const msg6Line = lines.find((l) => l.includes('"msg-6"'));
      expect(msg6Line).toBeDefined();
      // Content is the 6th field (index 5) — verify it's empty between the nickname and attachment count
      // Line format: "id","timestamp","username","displayName","nick","content",attachments,embeds,reactions
      expect(msg6Line).toContain('"","",1,0,5');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// JSON EXPORT
// ═════════════════════════════════════════════════════════════════

describe('JSON Export', () => {
  describe('Structure', () => {
    it('should produce valid parseable JSON', async () => {
      const json = await exportAndGetFile('json');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should be an array with correct message count', async () => {
      const json = await exportAndGetFile('json');
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(EXPORT_MESSAGES.length);
    });

    it('should have correct file path in ZIP', async () => {
      await exportAndGetFile('json');
      expect(capturedFiles.has('test_channel/test_channel-page-1.json')).toBe(true);
      expect(capturedFiles.has('test_channel/README.html')).toBe(true);
      expect(capturedFiles.size).toBe(2);
    });
  });

  describe('Data Fidelity', () => {
    it('should preserve all message fields exactly', async () => {
      const json = await exportAndGetFile('json');
      const parsed = JSON.parse(json);
      const msg5 = parsed.find((m: any) => m.id === 'msg-5');
      expect(msg5.content).toBe('Has "quotes" and commas, here');
      expect(msg5.author.username).toBe('alice');
      expect(msg5.embeds).toHaveLength(1);
      expect(msg5.embeds[0].title).toBe('Test Embed');
    });

    it('should preserve raw ISO timestamps (no formatting)', async () => {
      const json = await exportAndGetFile('json');
      const parsed = JSON.parse(json);
      const msg1 = parsed.find((m: any) => m.id === 'msg-1');
      expect(msg1.timestamp).toBe('2026-06-15T10:00:00.000Z');
    });

    it('should preserve empty content as empty string', async () => {
      const json = await exportAndGetFile('json');
      const parsed = JSON.parse(json);
      const msg6 = parsed.find((m: any) => m.id === 'msg-6');
      expect(msg6.content).toBe('');
    });

    it('should preserve raw mention syntax', async () => {
      const json = await exportAndGetFile('json');
      const parsed = JSON.parse(json);
      const msg3 = parsed.find((m: any) => m.id === 'msg-3');
      expect(msg3.content).toBe('Check <@100000000000000002> and <#800000000000000099>');
    });
  });

  describe('Sort Order', () => {
    it('should order ascending (oldest first)', async () => {
      const config: ExportConfig = { ...DEFAULT_EXPORT_CONFIG, sortOrder: 'ascending' };
      const json = await exportAndGetFile('json', { exportConfig: config });
      const parsed = JSON.parse(json);
      expect(parsed[0].id).toBe('msg-1');
      expect(parsed[parsed.length - 1].id).toBe('msg-8');
    });

    it('should order descending (newest first)', async () => {
      const json = await exportAndGetFile('json');
      const parsed = JSON.parse(json);
      expect(parsed[0].id).toBe('msg-8');
      expect(parsed[parsed.length - 1].id).toBe('msg-1');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// HTML EXPORT
// ═════════════════════════════════════════════════════════════════

describe('HTML Export', () => {
  describe('Document Structure', () => {
    it('should have DOCTYPE declaration', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should have channel name in title (unsanitized)', async () => {
      const html = await exportAndGetFile('html', { channelName: 'General Chat' });
      expect(html).toContain('<title>General Chat</title>');
    });

    it('should have #channelName in h1 header', async () => {
      const html = await exportAndGetFile('html', { channelName: 'General Chat' });
      expect(html).toContain('#General Chat</h1>');
    });

    it('should show message count in header meta', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toContain('8 messages');
    });

    it('should show "Exported:" timestamp in header', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toContain('Exported:');
    });

    it('should have correct file path in ZIP', async () => {
      await exportAndGetFile('html', { channelName: 'General Chat' });
      expect(capturedFiles.has('general_chat/general_chat-page-1.html')).toBe(true);
    });
  });

  describe('Message Rendering', () => {
    it('should wrap each message with data-message-id attribute', async () => {
      const html = await exportAndGetFile('html');
      EXPORT_MESSAGES.forEach((msg) => {
        expect(html).toContain(`data-message-id="${msg.id}"`);
      });
    });

    it('should render author username in .author span', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toMatch(/class="author"[^>]*>alice</);
      expect(html).toMatch(/class="author"[^>]*>bob</);
    });

    it('should render formatted timestamp in .timestamp span', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toContain('<span class="timestamp">');
      // Default config: MM/dd/yyyy h:mm aa
      expect(html).toContain('06/15/2026');
    });

    it('should render plain text content in .message-text div', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toContain('Hello world');
    });

    it('should render "(no content)" for empty messages', async () => {
      const html = await exportAndGetFile('html');
      // msg-6 has empty content
      expect(html).toContain('(no content)');
    });

    it('should resolve user mentions to .user-mention spans', async () => {
      const html = await exportAndGetFile('html');
      // msg-3: Check <@100000000000000002> — resolved via formatting context userMap
      expect(html).toContain('user-mention');
      // The formatted mention should contain the username from the userMap
      expect(html).toContain('bob');
    });
  });

  describe('Content Formatting', () => {
    it('should render bold and italic markdown as HTML', async () => {
      const html = await exportAndGetFile('html');
      // msg-2: **bold** and *italic*
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
    });

    it('should render channel mentions with channel-mention class', async () => {
      const html = await exportAndGetFile('html');
      // msg-3: <#800000000000000099> — resolved via formatting context
      expect(html).toContain('channel-mention');
    });
  });

  describe('Timestamps', () => {
    it('should format with custom config (dd/MM/yyyy HH:mm:ss)', async () => {
      const config: ExportConfig = {
        ...DEFAULT_EXPORT_CONFIG,
        dateFormat: 'dd/MM/yyyy',
        timeFormat: 'HH:mm:ss',
      };
      const html = await exportAndGetFile('html', { exportConfig: config });
      // msg-1: 2026-06-15T10:00:00.000Z → 15/06/2026
      expect(html).toContain('15/06/2026');
    });

    it('should fall back to MMM dd, yyyy HH:mm without exportConfig', async () => {
      const service = getExportService();
      await service.exportToZip(
        EXPORT_MESSAGES, 'test-channel', 'html', 100, false, null,
        EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
        undefined, // no exportConfig
      );
      const html = getFileContent('test_channel/test_channel-page-1.html');
      // Fallback format: Jun 15, 2026
      expect(html).toContain('Jun');
      expect(html).toContain('2026');
    });

    // Backlog #162 — "Exported:" footer + "(edited)" tooltip both used to
    // hardcode 24-hour `HH:mm`. They now read exportConfig.timeFormat so
    // 12-hour users see AM/PM and 24-hour users see no AM/PM, matching
    // the rest of the export.
    it('"Exported:" header timestamp uses exportConfig.timeFormat (12h shows AM/PM)', async () => {
      const config: ExportConfig = {
        ...DEFAULT_EXPORT_CONFIG,
        timeFormat: 'h:mm aa',
      };
      const html = await exportAndGetFile('html', { exportConfig: config });
      // Find the line containing "Exported:" and assert it carries an
      // AM/PM marker. Anchoring to the line keeps us from accidentally
      // matching AM/PM elsewhere in the document.
      const line = html.split('\n').find((l) => l.includes('Exported:'))!;
      expect(line).toMatch(/Exported:.*\b(AM|PM)\b/);
    });

    it('"Exported:" header timestamp drops AM/PM under 24-hour config', async () => {
      const config: ExportConfig = {
        ...DEFAULT_EXPORT_CONFIG,
        timeFormat: 'HH:mm',
      };
      const html = await exportAndGetFile('html', { exportConfig: config });
      const line = html.split('\n').find((l) => l.includes('Exported:'))!;
      expect(line).not.toMatch(/Exported:.*\b(AM|PM)\b/);
      // 24-hour clock pattern: two digits, colon, two digits.
      expect(line).toMatch(/Exported: [A-Z][a-z]{2} \d{2}, \d{4} \d{2}:\d{2}/);
    });

    it('edited-indicator tooltip uses exportConfig.timeFormat (12h shows AM/PM)', async () => {
      // msg-2 in the fixture set carries edited_timestamp.
      const editedMessages = EXPORT_MESSAGES.map((m, idx) =>
        idx === 1
          ? { ...m, edited_timestamp: '2026-06-15T15:30:00.000Z' }
          : m,
      );
      const service = getExportService();
      const html = service.generateHTMLPage(
        editedMessages as any, 'test', 1, 1, null, 'test', undefined,
        { ...DEFAULT_EXPORT_CONFIG, timeFormat: 'h:mm aa' },
      );
      // Locate the edited-indicator span and check its title attribute.
      const m = html.match(/<span class="edited-indicator" title="([^"]+)"/);
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(/\b(AM|PM)\b/);
    });

    it('edited-indicator tooltip drops AM/PM under 24-hour config', () => {
      const editedMessages = EXPORT_MESSAGES.map((m, idx) =>
        idx === 1
          ? { ...m, edited_timestamp: '2026-06-15T15:30:00.000Z' }
          : m,
      );
      const service = getExportService();
      const html = service.generateHTMLPage(
        editedMessages as any, 'test', 1, 1, null, 'test', undefined,
        { ...DEFAULT_EXPORT_CONFIG, timeFormat: 'HH:mm' },
      );
      const m = html.match(/<span class="edited-indicator" title="([^"]+)"/);
      expect(m).not.toBeNull();
      expect(m![1]).not.toMatch(/\b(AM|PM)\b/);
      expect(m![1]).toMatch(/Edited: [A-Z][a-z]{2} \d{2}, \d{4} \d{2}:\d{2}/);
    });
  });

  describe('Bare media embeds (#219)', () => {
    const bareImageMessage = {
      ...EXPORT_MESSAGES[0],
      id: 'msg-bare-embed',
      content: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp',
      attachments: [],
      embeds: [{
        type: 'image',
        url: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp',
        thumbnail: {
          url: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp',
          width: 128,
          height: 128,
        },
      }],
    };

    const renderPage = (messages: unknown[]) => {
      const service = getExportService();
      return service.generateHTMLPage(
        messages as any, 'test', 1, 1, null, 'test', undefined, DEFAULT_EXPORT_CONFIG,
      );
    };

    it('renders a bare image embed as the media alone, without card chrome', () => {
      const html = renderPage([bareImageMessage]);
      expect(html).toContain('class="embed-image bare-embed-image"');
      expect(html).toContain('src="https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp"');
      // No embed card for this message's embeds block.
      expect(html).not.toContain('class="embed" style');
    });

    it('carries natural dimensions so the export stylesheet cannot upscale it', () => {
      // The card class alone gets width:100%/max-width:400px, which blew a
      // 128px emote up to a blurry 400px; the bare class + attributes pin
      // it at natural size.
      const html = renderPage([bareImageMessage]);
      expect(html).toContain('width="128" height="128"');
      expect(html).toContain('.bare-embed-image');
    });

    it('hides the raw URL text when the content is exactly the bare embed URL', () => {
      const html = renderPage([bareImageMessage]);
      const textMatch = html.match(/<div class="message-text">(.*?)<\/div>/s);
      expect(textMatch).not.toBeNull();
      expect(textMatch![1]).not.toContain('cdn.7tv.app');
    });

    it('keeps the content text when the message has more than just the URL', () => {
      const html = renderPage([
        { ...bareImageMessage, content: 'look https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp' },
      ]);
      const textMatch = html.match(/<div class="message-text">(.*?)<\/div>/s);
      expect(textMatch![1]).toContain('look');
    });

    it('renders a gifv embed as a muted autoplay loop without the provider title', () => {
      const html = renderPage([{
        ...bareImageMessage,
        content: 'https://tenor.com/view/tackle-mascot-gif-10629045',
        embeds: [{
          type: 'gifv',
          url: 'https://tenor.com/view/tackle-mascot-gif-10629045',
          title: 'Tackle Mascot GIF - Discover & Share GIFs',
          provider: { name: 'Tenor' },
          thumbnail: { url: 'https://media1.tenor.com/m/x/tackle.gif', width: 444, height: 250 },
          video: { url: 'https://media.tenor.com/x/tackle.mp4', width: 444, height: 250 },
        }],
      }]);
      expect(html).toContain('autoplay loop muted playsinline');
      expect(html).not.toContain('Tackle Mascot GIF');
    });
  });

  describe('Attachment Rendering', () => {
    it('should render attachment card with filename and size', async () => {
      const html = await exportAndGetFile('html');
      // msg-4: photo.png, 102400 bytes
      expect(html).toContain('photo.png');
      expect(html).toContain('100 KB');
      expect(html).toContain('attachment-card');
    });

    it('should show image preview when previewMedia is true', async () => {
      const html = await exportAndGetFile('html');
      // msg-4 has image attachment, default previewMedia=true
      expect(html).toContain('class="attachment-preview attachment-preview-img"');
    });

    it('should show video preview when previewMedia is true', async () => {
      const html = await exportAndGetFile('html');
      // msg-6 has video attachment
      expect(html).toContain('<video class="attachment-preview"');
      expect(html).toContain('clip.mp4');
    });

    it('should show download fallback for unsupported video formats', async () => {
      // Create a message with a .mov attachment
      const movMessage = [{
        ...EXPORT_MESSAGES[0],
        id: 'msg-mov',
        attachments: [{
          id: 'att-mov',
          filename: 'video.mov',
          size: 5242880,
          url: 'https://cdn.discordapp.com/attachments/ch/att-mov/video.mov',
          content_type: 'video/quicktime',
        }],
      }];
      const service = getExportService();
      const html = service.generateHTMLPage(
        movMessage as any, 'test', 1, 1, null, 'test', undefined, DEFAULT_EXPORT_CONFIG,
      );
      expect(html).toContain('video-unsupported');
      expect(html).toContain('.MOV preview not available');
      expect(html).toContain('download to play');
      expect(html).not.toContain('<video class="attachment-preview"');
    });

    it('should use video tag for browser-playable formats (mp4, webm)', async () => {
      const html = await exportAndGetFile('html');
      // msg-6 has clip.mp4
      expect(html).toContain('<video class="attachment-preview"');
    });

    it('should hide previews when previewMedia is false but keep link', async () => {
      const config: ExportConfig = { ...DEFAULT_EXPORT_CONFIG, previewMedia: false };
      const html = await exportAndGetFile('html', { exportConfig: config });
      expect(html).not.toContain('class="attachment-preview');
      // But filenames still present as links
      expect(html).toContain('photo.png');
      expect(html).toContain('clip.mp4');
    });

  });

  describe('Embed Rendering', () => {
    it('should render embed with title and description', async () => {
      const html = await exportAndGetFile('html');
      // msg-5 has embed
      expect(html).toContain('class="embed"');
      expect(html).toContain('Test Embed');
      expect(html).toContain('test embed description');
    });
  });

  describe('Reaction Rendering', () => {
    it('should render reactions with emoji and count', async () => {
      const html = await exportAndGetFile('html');
      // msg-4: 👍 x5
      expect(html).toContain('class="reaction"');
      expect(html).toContain('👍');
      expect(html).toContain('>5</span>');
    });
  });

  describe('Sort Order', () => {
    it('should place oldest message first when ascending', async () => {
      const config: ExportConfig = { ...DEFAULT_EXPORT_CONFIG, sortOrder: 'ascending' };
      const html = await exportAndGetFile('html', { exportConfig: config });
      const firstIdx = html.indexOf('data-message-id="msg-1"');
      const lastIdx = html.indexOf('data-message-id="msg-8"');
      expect(firstIdx).toBeGreaterThan(-1);
      expect(lastIdx).toBeGreaterThan(-1);
      expect(firstIdx).toBeLessThan(lastIdx);
    });

    it('should place newest message first when descending', async () => {
      const html = await exportAndGetFile('html');
      const newestIdx = html.indexOf('data-message-id="msg-8"');
      const oldestIdx = html.indexOf('data-message-id="msg-1"');
      expect(newestIdx).toBeLessThan(oldestIdx);
    });
  });

  describe('Styles', () => {
    it('should include attachment-preview-img CSS class', async () => {
      const html = await exportAndGetFile('html');
      expect(html).toContain('.attachment-preview-img');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// MULTI-PAGE HTML
// ═════════════════════════════════════════════════════════════════

describe('Multi-Page HTML', () => {
  it('should split into correct number of pages', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES,
      'test-channel',
      'html',
      3, // 8 messages / 3 per page = 3 pages
      false,
      null,
      EXPORT_USER_MAP,
      EXPORT_GUILD_ID,
      undefined,
      undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    expect(capturedFiles.has('test_channel/test_channel-page-1.html')).toBe(true);
    expect(capturedFiles.has('test_channel/test_channel-page-2.html')).toBe(true);
    expect(capturedFiles.has('test_channel/test_channel-page-3.html')).toBe(true);
    expect(capturedFiles.has('test_channel/README.html')).toBe(true);
    expect(capturedFiles.size).toBe(4);
  });

  it('should always use page-1 suffix even for single page exports', async () => {
    await exportAndGetFile('html', { messagesPerPage: 100 });
    expect(capturedFiles.has('test_channel/test_channel-page-1.html')).toBe(true);
    expect(capturedFiles.has('test_channel/README.html')).toBe(true);
    // No non-paginated file should exist
    expect(capturedFiles.has('test_channel/test_channel.html')).toBe(false);
  });

  it('should use consistent page-1 naming across all formats', async () => {
    for (const format of ['html', 'csv', 'json'] as const) {
      capturedFiles = new Map();
      await exportAndGetFile(format);
      const expectedFile = `test_channel/test_channel-page-1.${format}`;
      expect(capturedFiles.has(expectedFile)).toBe(true);
      // No non-paginated file
      expect(capturedFiles.has(`test_channel/test_channel.${format}`)).toBe(false);
    }
  });

  it('should show page info in title and header', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES,
      'test-channel',
      'html',
      3,
      false,
      null,
      EXPORT_USER_MAP,
      EXPORT_GUILD_ID,
      undefined,
      undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    const page1 = getFileContent('test_channel/test_channel-page-1.html');
    expect(page1).toContain('Page 1 of 3');
    const page3 = getFileContent('test_channel/test_channel-page-3.html');
    expect(page3).toContain('Page 3 of 3');
  });

  it('should paginate CSV when messagesPerPage is set', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'csv', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    // 8 messages / 3 per page = 3 pages + README
    expect(capturedFiles.size).toBe(4);
    expect(capturedFiles.has('test_channel/test_channel-page-1.csv')).toBe(true);
    expect(capturedFiles.has('test_channel/test_channel-page-2.csv')).toBe(true);
    expect(capturedFiles.has('test_channel/test_channel-page-3.csv')).toBe(true);
  });

  it('should paginate JSON when messagesPerPage is set', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'json', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    expect(capturedFiles.size).toBe(4);
    expect(capturedFiles.has('test_channel/test_channel-page-1.json')).toBe(true);
    expect(capturedFiles.has('test_channel/test_channel-page-2.json')).toBe(true);
    expect(capturedFiles.has('test_channel/test_channel-page-3.json')).toBe(true);
  });

  it('should include CSV headers on all pages', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'csv', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    const page1 = getFileContent('test_channel/test_channel-page-1.csv');
    const page2 = getFileContent('test_channel/test_channel-page-2.csv');
    const page3 = getFileContent('test_channel/test_channel-page-3.csv');

    const headerRow = 'ID,Timestamp,Username,Display Name,Server Nickname,Content,Forwarded Content,Attachments,Embeds,Reactions';
    expect(page1.split('\n')[0]).toBe(headerRow);
    expect(page2.split('\n')[0]).toBe(headerRow);
    expect(page3.split('\n')[0]).toBe(headerRow);
  });

  it('should distribute correct message counts across CSV pages', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'csv', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    const page1 = getFileContent('test_channel/test_channel-page-1.csv');
    const page2 = getFileContent('test_channel/test_channel-page-2.csv');
    const page3 = getFileContent('test_channel/test_channel-page-3.csv');

    // All pages have header row + data rows (8 msgs: 3, 3, 2)
    expect(page1.split('\n').length).toBe(4); // header + 3 messages
    expect(page2.split('\n').length).toBe(4); // header + 3 messages
    expect(page3.split('\n').length).toBe(3); // header + 2 messages
  });

  it('should distribute correct message counts across JSON pages', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'json', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    const page1 = JSON.parse(getFileContent('test_channel/test_channel-page-1.json'));
    const page2 = JSON.parse(getFileContent('test_channel/test_channel-page-2.json'));
    const page3 = JSON.parse(getFileContent('test_channel/test_channel-page-3.json'));

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page3).toHaveLength(2);
  });

  it('should preserve sort order across JSON pages (descending)', async () => {
    const service = getExportService();
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'json', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      DEFAULT_EXPORT_CONFIG,
    );
    const page1 = JSON.parse(getFileContent('test_channel/test_channel-page-1.json'));
    const page2 = JSON.parse(getFileContent('test_channel/test_channel-page-2.json'));
    const page3 = JSON.parse(getFileContent('test_channel/test_channel-page-3.json'));

    // Descending: newest first → msg-8, msg-7, msg-6 | msg-5, msg-4, msg-3 | msg-2, msg-1
    expect(page1[0].id).toBe('msg-8');
    expect(page1[2].id).toBe('msg-6');
    expect(page2[0].id).toBe('msg-5');
    expect(page2[2].id).toBe('msg-3');
    expect(page3[0].id).toBe('msg-2');
    expect(page3[1].id).toBe('msg-1');
  });

  it('should preserve sort order across CSV pages (ascending)', async () => {
    const service = getExportService();
    const config: ExportConfig = { ...DEFAULT_EXPORT_CONFIG, sortOrder: 'ascending' };
    await service.exportToZip(
      EXPORT_MESSAGES, 'test-channel', 'csv', 3, false, null,
      EXPORT_USER_MAP, EXPORT_GUILD_ID, undefined, undefined,
      config,
    );
    const page1 = getFileContent('test_channel/test_channel-page-1.csv');
    const page2 = getFileContent('test_channel/test_channel-page-2.csv');
    const page3 = getFileContent('test_channel/test_channel-page-3.csv');

    const page1Lines = page1.split('\n');
    // Ascending: oldest first → msg-1, msg-2, msg-3 | msg-4, msg-5, msg-6 | msg-7, msg-8
    expect(page1Lines[1]).toContain('"msg-1"');
    expect(page1Lines[3]).toContain('"msg-3"');
    expect(page2.split('\n')[1]).toContain('"msg-4"');
    expect(page3.split('\n')[1]).toContain('"msg-7"');
    expect(page3.split('\n')[2]).toContain('"msg-8"');
  });

  it('should use no page suffix for single-page CSV', async () => {
    await exportAndGetFile('csv', { messagesPerPage: 100 });
    expect(capturedFiles.has('test_channel/test_channel-page-1.csv')).toBe(true);
    expect(capturedFiles.size).toBe(2);
  });

  it('should use no page suffix for single-page JSON', async () => {
    await exportAndGetFile('json', { messagesPerPage: 100 });
    expect(capturedFiles.has('test_channel/test_channel-page-1.json')).toBe(true);
    expect(capturedFiles.size).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════
// MEDIA PATH RESOLUTION
// ═════════════════════════════════════════════════════════════════

describe('Media Path Resolution', () => {
  const setupMediaMock = async () => {
    const { MediaDownloadService } = await import('./mediaDownloadService');
    (MediaDownloadService as any).mockImplementation(() => ({
      downloadAllMedia: vi.fn().mockResolvedValue({
        avatarMap: {
          '100000000000000001/alice_avatar_hash': 'test_channel/avatars/100000000000000001/alice_avatar_hash.png',
        },
        mediaMap: {
          'https://cdn.discordapp.com/attachments/channel-123/att-photo/photo.png':
            'media/attachments/0_1234567890.png',
        },
        emojiMap: {},
        roleMap: {},
      }),
      downloadMediaOnly: vi.fn().mockResolvedValue(undefined),
    }));
  };

  describe('Attachments', () => {
    it('should use local relative path from mediaMap', async () => {
      await setupMediaMock();
      const html = await exportAndGetFile('html', { includeMedia: true });
      expect(html).toContain('href="media/attachments/0_1234567890.png"');
    });

    it('should fall back to CDN URL without mediaMap', async () => {
      const html = await exportAndGetFile('html', { includeMedia: false });
      expect(html).toContain(
        'href="https://cdn.discordapp.com/attachments/channel-123/att-photo/photo.png"',
      );
    });

    it('should show Local/External badge accordingly', async () => {
      await setupMediaMock();
      const htmlLocal = await exportAndGetFile('html', { includeMedia: true });
      expect(htmlLocal).toContain('Local</span>');

      capturedFiles = new Map();
      const htmlExternal = await exportAndGetFile('html', { includeMedia: false });
      expect(htmlExternal).toContain('External</span>');
    });
  });

  describe('Avatars', () => {
    it('should use local path with prefix stripped', async () => {
      await setupMediaMock();
      const html = await exportAndGetFile('html', { includeMedia: true });
      // avatarMap stores: 'test_channel/avatars/100000000000000001/alice_avatar_hash.png'
      // HTML strips 'test_channel/' prefix → 'avatars/100000000000000001/alice_avatar_hash.png'
      expect(html).toContain('src="avatars/100000000000000001/alice_avatar_hash.png"');
    });

    it('should fall back to CDN avatar URL', async () => {
      const html = await exportAndGetFile('html', { includeMedia: false });
      expect(html).toContain(
        'src="https://cdn.discordapp.com/avatars/100000000000000001/alice_avatar_hash.png"',
      );
    });

    it('should show placeholder when no avatar', async () => {
      const html = await exportAndGetFile('html');
      // Bob has avatar: null → placeholder
      expect(html).toContain('class="avatar-placeholder"');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// THREAD STARTER (TYPE 21) MESSAGE CONTENT
// ═════════════════════════════════════════════════════════════════

describe('Thread Starter (Type 21) Content Resolution', () => {
  it('should render referenced_message.content in HTML for type 21', async () => {
    const html = await exportAndGetFile('html');
    // msg-8 is type 21 with empty content, referenced_message has "Thread starter original text"
    expect(html).toContain('Thread starter original text');
  });

  it('should not show "(no content)" for type 21 with referenced_message', async () => {
    const html = await exportAndGetFile('html');
    // Find the msg-8 block and ensure it doesn't contain "(no content)"
    const msg8Start = html.indexOf('data-message-id="msg-8"');
    const msg8Block = html.substring(msg8Start, msg8Start + 500);
    expect(msg8Block).not.toContain('(no content)');
  });

  it('should use referenced_message.content in CSV for type 21', async () => {
    const csv = await exportAndGetFile('csv');
    const msg8Line = csv.split('\n').find((l) => l.includes('"msg-8"'));
    expect(msg8Line).toBeDefined();
    expect(msg8Line).toContain('Thread starter original text');
  });

  it('should preserve referenced_message.content in JSON for type 21', async () => {
    const json = await exportAndGetFile('json');
    const parsed = JSON.parse(json);
    const msg8 = parsed.find((m: any) => m.id === 'msg-8');
    // JSON preserves raw data — content is still empty, referenced_message has the text
    expect(msg8.content).toBe('');
    expect(msg8.referenced_message.content).toBe('Thread starter original text');
  });
});

// ═════════════════════════════════════════════════════════════════
// SHARED ZIP SERVICE (BULK EXPORT)
// ═════════════════════════════════════════════════════════════════

describe('Shared ZIP Service (Bulk Export)', () => {
  it('should write multiple channels into a single shared zip', async () => {
    const { StreamingZipService } = await import('./streamingZipService');
    const sharedZip = new StreamingZipService('bulk-export');
    const service = getExportService();

    // Export channel 1 into the shared zip
    await service.exportToZip(
      [EXPORT_MESSAGES[0]], 'channel-alpha', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );

    // Export channel 2 into the same shared zip
    await service.exportToZip(
      [EXPORT_MESSAGES[1]], 'channel-beta', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );

    // Both channels' files should be in the same capturedFiles map
    expect(capturedFiles.has('channel_alpha/channel_alpha-page-1.csv')).toBe(true);
    expect(capturedFiles.has('channel_beta/channel_beta-page-1.json')).toBe(true);
    expect(capturedFiles.size).toBe(2);
  });

  it('should not finalize when using an external zip service', async () => {
    const { StreamingZipService } = await import('./streamingZipService');
    const sharedZip = new StreamingZipService('bulk-export');
    const service = getExportService();

    await service.exportToZip(
      [EXPORT_MESSAGES[0]], 'test-ch', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );

    // finalize should NOT have been called (we still own it)
    expect(sharedZip.finalize).not.toHaveBeenCalled();
  });

  it('should finalize when no external zip service is provided', async () => {
    const service = getExportService();

    await service.exportToZip(
      [EXPORT_MESSAGES[0]], 'solo-channel', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG,
    );

    // The internally-created zip should have been finalized
    expect(capturedFiles.has('solo_channel/solo_channel-page-1.csv')).toBe(true);
  });

  it('should support mixed formats in a single shared zip', async () => {
    const { StreamingZipService } = await import('./streamingZipService');
    const sharedZip = new StreamingZipService('bulk-export');
    const service = getExportService();

    await service.exportToZip(
      [EXPORT_MESSAGES[0]], 'general', 'html', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );
    await service.exportToZip(
      [EXPORT_MESSAGES[1]], 'random', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );
    await service.exportToZip(
      [EXPORT_MESSAGES[2]], 'announcements', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );

    expect(capturedFiles.has('general/general-page-1.html')).toBe(true);
    expect(capturedFiles.has('random/random-page-1.csv')).toBe(true);
    expect(capturedFiles.has('announcements/announcements-page-1.json')).toBe(true);
    expect(capturedFiles.size).toBe(3);
  });

  it('should not cancel external zip on error', async () => {
    const { StreamingZipService } = await import('./streamingZipService');
    const sharedZip = new StreamingZipService('bulk-export');

    // Mock addFile to throw on the second call
    const originalAddFile = sharedZip.addFile;
    let callCount = 0;
    sharedZip.addFile = vi.fn(async (blob: Blob, path: string) => {
      callCount++;
      if (callCount > 1) throw new Error('Simulated write failure');
      return originalAddFile.call(sharedZip, blob, path);
    });

    const service = getExportService();

    // First export succeeds
    await service.exportToZip(
      [EXPORT_MESSAGES[0]], 'good-channel', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    );

    // Second export fails — but cancel should NOT be called on the shared zip
    await expect(service.exportToZip(
      [EXPORT_MESSAGES[1]], 'bad-channel', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, sharedZip,
    )).rejects.toThrow('Simulated write failure');

    expect(sharedZip.cancel).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Thread Separation (separateThreads)
// ═══════════════════════════════════════════════════════════════════
describe('Thread Separation', () => {
  let service: ReturnType<typeof getExportService>;

  beforeEach(() => {
    capturedFiles = new Map();
    service = getExportService();
  });

  it('should create thread files in threads/ subdirectory when separateThreads is true (JSON)', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    // Should have main channel file and thread file
    const paths = Array.from(capturedFiles.keys());
    const mainFiles = paths.filter(p => !p.includes('/threads/'));
    const threadFiles = paths.filter(p => p.includes('/threads/'));

    expect(mainFiles.length).toBeGreaterThanOrEqual(1);
    expect(threadFiles.length).toBe(1);
    expect(threadFiles[0]).toContain('bug_discussion');
  });

  it('should exclude thread replies from main export but keep thread starters when separateThreads is true', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    // Find the main JSON file
    const mainPath = Array.from(capturedFiles.keys()).find(p => !p.includes('/threads/') && p.endsWith('.json'));
    expect(mainPath).toBeDefined();

    const mainContent = JSON.parse(capturedFiles.get(mainPath!)!);
    // Main should have msg-t1 (thread starter — stays in main for thread banner link)
    // and msg-t3 (regular message). msg-t2 (thread reply) is excluded.
    expect(mainContent).toHaveLength(2);
    const ids = mainContent.map((m: any) => m.id);
    expect(ids).toContain('msg-t1');
    expect(ids).toContain('msg-t3');
  });

  it('should include only thread replies in thread file', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const threadPath = Array.from(capturedFiles.keys()).find(p => p.includes('/threads/'));
    expect(threadPath).toBeDefined();

    const threadContent = JSON.parse(capturedFiles.get(threadPath!)!);
    // Thread should have only msg-t2 (reply with channel_id matching thread)
    // msg-t1 (starter) stays in main channel only
    expect(threadContent).toHaveLength(1);
    expect(threadContent[0].id).toBe('msg-t2');
  });

  it('should keep all messages together when separateThreads is false', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      false, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const threadFiles = paths.filter(p => p.includes('/threads/'));
    expect(threadFiles).toHaveLength(0);

    // Main file should have all 3 messages
    const mainPath = paths.find(p => p.endsWith('.json'));
    const mainContent = JSON.parse(capturedFiles.get(mainPath!)!);
    expect(mainContent).toHaveLength(3);
  });

  it('should separate threads for CSV format', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'csv', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const threadFiles = paths.filter(p => p.includes('/threads/') && p.endsWith('.csv'));
    expect(threadFiles).toHaveLength(1);

    const threadCsv = capturedFiles.get(threadFiles[0])!;
    // Thread CSV should contain only replies, not the starter
    expect(threadCsv).not.toContain('I found a bug');
    expect(threadCsv).toContain('Can you share more details?');
  });

  it('should separate threads for HTML format', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'html', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const threadFiles = paths.filter(p => p.includes('/threads/') && p.endsWith('.html'));
    expect(threadFiles).toHaveLength(1);

    const threadHtml = capturedFiles.get(threadFiles[0])!;
    // Thread file contains only replies, not the starter
    expect(threadHtml).not.toContain('I found a bug');
    expect(threadHtml).toContain('Can you share more details?');
  });

  it('should use ../ prefix for media paths in thread HTML files', async () => {
    // Mock media service to return local paths
    const { MediaDownloadService } = await import('./mediaDownloadService');
    (MediaDownloadService as any).mockImplementation(() => ({
      downloadAllMedia: vi.fn().mockResolvedValue({
        avatarMap: {
          '100000000000000001/alice_avatar_hash': 'test_channel/avatars/100000000000000001/alice_avatar_hash.png',
        },
        mediaMap: {},
        emojiMap: { '999': 'test_channel/emojis/999.webp' },
        roleMap: {},
      }),
      downloadMediaOnly: vi.fn().mockResolvedValue(undefined),
    }));

    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'html', 100, true,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    // Get main HTML and thread HTML
    const paths = Array.from(capturedFiles.keys());
    const mainPath = paths.find(p => !p.includes('/threads/') && p.endsWith('.html'));
    const threadPath = paths.find(p => p.includes('/threads/') && p.endsWith('.html'));
    expect(mainPath).toBeDefined();
    expect(threadPath).toBeDefined();

    const mainHtml = capturedFiles.get(mainPath!)!;
    const threadHtml = capturedFiles.get(threadPath!)!;

    // Main HTML: avatar path without prefix (Alice is thread starter in main)
    expect(mainHtml).toContain('src="avatars/100000000000000001/alice_avatar_hash.png"');
    // Thread HTML: back link uses ../ prefix for parent channel
    expect(threadHtml).toContain('href="../');
    // Thread HTML should not use un-prefixed local paths
    expect(threadHtml).not.toContain('src="avatars/');
  });

  it('should render thread starter in main HTML with thread banner link', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'html', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const mainPath = paths.find(p => !p.includes('/threads/') && p.endsWith('.html'));
    expect(mainPath).toBeDefined();

    const mainHtml = capturedFiles.get(mainPath!)!;
    // Thread starter message content should appear in main HTML
    expect(mainHtml).toContain('I found a bug');
    // Thread banner link should be present pointing to threads/ subdirectory
    expect(mainHtml).toContain('thread-banner');
    expect(mainHtml).toContain('threads/');
    expect(mainHtml).toContain('bug-discussion');
  });

  it('should not render thread reply content in main HTML when separateThreads is true', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'html', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const mainPath = paths.find(p => !p.includes('/threads/') && p.endsWith('.html'));
    expect(mainPath).toBeDefined();

    const mainHtml = capturedFiles.get(mainPath!)!;
    // Thread reply content should NOT appear in main HTML
    expect(mainHtml).not.toContain('Can you share more details?');
  });

  it('should not render thread banner link in thread HTML files', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'html', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const threadPath = paths.find(p => p.includes('/threads/') && p.endsWith('.html'));
    expect(threadPath).toBeDefined();

    const threadHtml = capturedFiles.get(threadPath!)!;
    // Thread banner element should NOT appear in thread files (would be self-referential)
    // CSS class definitions will still exist, so check for the actual banner HTML element
    expect(threadHtml).not.toContain('<div class="thread-banner">');
  });

  it('should keep thread starter in main only and replies in thread only', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'html', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
      true, [THREAD_CHANNEL]
    );

    const paths = Array.from(capturedFiles.keys());
    const mainPath = paths.find(p => !p.includes('/threads/') && p.endsWith('.html'));
    const threadPath = paths.find(p => p.includes('/threads/') && p.endsWith('.html'));
    expect(mainPath).toBeDefined();
    expect(threadPath).toBeDefined();

    const mainHtml = capturedFiles.get(mainPath!)!;
    const threadHtml = capturedFiles.get(threadPath!)!;
    // Thread starter appears in main only
    expect(mainHtml).toContain('I found a bug');
    expect(threadHtml).not.toContain('I found a bug');
    // Thread reply only in thread file
    expect(mainHtml).not.toContain('Can you share more details?');
    expect(threadHtml).toContain('Can you share more details?');
  });

  it('should not create thread files when no threads parameter provided', async () => {
    await service.exportToZip(
      THREAD_MESSAGES, 'test-channel', 'json', 100, false,
      null, EXPORT_USER_MAP, EXPORT_GUILD_ID,
      undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
    );

    const paths = Array.from(capturedFiles.keys());
    const threadFiles = paths.filter(p => p.includes('/threads/'));
    expect(threadFiles).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// HTML SCENARIO COVERAGE (Phase 0)
// ═════════════════════════════════════════════════════════════════

describe('HTML Scenario Coverage', () => {
  function generateHTML(
    messages: Message[],
    channelName = 'test-channel',
    opts: { pageNumber?: number; totalPages?: number; mediaPathPrefix?: string; backLinkPage?: number } = {},
  ): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages,
      channelName,
      opts.pageNumber ?? 1,
      opts.totalPages ?? 1,
      null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined,
      DEFAULT_EXPORT_CONFIG,
      opts.mediaPathPrefix,
      undefined,
      undefined,
      undefined,
      opts.backLinkPage,
    );
  }

  it('generates valid HTML for channel export', () => {
    const html = generateHTML(EXPORT_MESSAGES, 'general');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>general</title>');
    expect(html).toContain('8 messages');
    expect(html).toContain('Hello world');
  });

  it('generates valid HTML for DM export', () => {
    const html = generateHTML(DM_MESSAGES, 'alice, bob');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('alice, bob');
    expect(html).toContain('Hey, are you free this weekend?');
    expect(html).toContain('3 messages');
  });

  it('generates valid HTML for thread export with ../ media paths', () => {
    const threadMsgs = THREAD_MESSAGES.filter((m) => m.channel_id === 'thread-001');
    const html = generateHTML(threadMsgs, 'bug-discussion', { mediaPathPrefix: '../' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('bug-discussion');
  });

  it('generates valid HTML for media-heavy scenario', () => {
    const html = generateHTML(MEDIA_HEAVY_MESSAGES, 'media-showcase');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('screenshot1.png');
    expect(html).toContain('demo.mp4');
    expect(html).toContain('meeting-notes.mp3');
  });

  it('generates valid HTML for code and spoiler messages', () => {
    const html = generateHTML(CODE_SPOILER_MESSAGES, 'dev-chat');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('const x = 42');
    // Code blocks and spoilers are formatted by discrub-core
    expect(html).toContain('function hello()');
  });

  it('generates valid HTML for reply chain messages', () => {
    const html = generateHTML(REPLY_MESSAGES, 'discussion');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Has anyone tried the new build?');
    expect(html).toContain('Yes, it works great!');
    expect(html).toContain('I agree with what was said above');
  });

  it('generates valid HTML for edited messages', () => {
    const html = generateHTML(EDITED_MESSAGES, 'general');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('This message was edited to fix a typo');
    expect(html).toContain('This one was never edited');
  });

  it('generates valid HTML for message grouping scenario', () => {
    const html = generateHTML(GROUPED_MESSAGES, 'general');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Hey everyone');
    expect(html).toContain('I just pushed the fix');
    expect(html).toContain('Testing now...');
    expect(html).toContain('Any update?');
    expect(html).toContain('5 messages');
  });

  it('generates valid HTML for comprehensive scenario', () => {
    const html = generateHTML(COMPREHENSIVE_MESSAGES, 'general');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(`${COMPREHENSIVE_MESSAGES.length} messages`);
  });

  it('generates valid multi-page HTML with page indicators', () => {
    const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', {
      pageNumber: 2,
      totalPages: 3,
    });
    expect(html).toContain('Page 2 of 3');
    expect(html).toContain('3 messages');
  });

  it('all scenarios produce complete HTML documents', () => {
    const scenarios = [
      { msgs: EXPORT_MESSAGES, name: 'channel' },
      { msgs: DM_MESSAGES, name: 'dm' },
      { msgs: REPLY_MESSAGES, name: 'replies' },
      { msgs: EDITED_MESSAGES, name: 'edited' },
      { msgs: CODE_SPOILER_MESSAGES, name: 'code' },
      { msgs: GROUPED_MESSAGES, name: 'grouped' },
      { msgs: MEDIA_HEAVY_MESSAGES, name: 'media' },
      { msgs: COMPREHENSIVE_MESSAGES, name: 'comprehensive' },
    ];

    for (const { msgs, name } of scenarios) {
      const html = generateHTML(msgs, name);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('</head>');
      expect(html).toContain('<body>');
      expect(html).toContain('</body>');
    }
  });

  it('fixtures contain messages with reactions', () => {
    const withReactions = MEDIA_HEAVY_MESSAGES.filter((m) => m.reactions && m.reactions.length > 0);
    expect(withReactions.length).toBeGreaterThan(0);
    const html = generateHTML(MEDIA_HEAVY_MESSAGES, 'test');
    expect(html).toContain('🔥');
  });

  it('fixtures contain reply messages with referenced_message', () => {
    const replies = REPLY_MESSAGES.filter((m) => (m as any).message_reference);
    expect(replies.length).toBeGreaterThanOrEqual(2);
    // One with a valid reference, one with null (deleted)
    expect(REPLY_MESSAGES[1].referenced_message).not.toBeNull();
    expect(REPLY_MESSAGES[2].referenced_message).toBeNull();
  });

  it('fixtures contain edited messages with edited_timestamp', () => {
    const edited = EDITED_MESSAGES.filter((m) => m.edited_timestamp !== null);
    expect(edited.length).toBeGreaterThan(0);
    expect(edited[0].edited_timestamp).toBe('2026-06-15T10:05:30.000Z');
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 1: SMOOTH TRANSITIONS & FOUNDATION
// ═════════════════════════════════════════════════════════════════

describe('Phase 1: Smooth Transitions & Foundation', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Smooth hover animations', () => {
    it('avatar CSS includes transition property', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.avatar');
      expect(html).toMatch(/\.avatar\s*\{[^}]*transition:\s*transform\s+200ms\s+ease/);
    });

    it('avatar hover uses subtle scale(1.05) not scale(1.1)', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('scale(1.05)');
      expect(html).not.toContain('scale(1.1)');
    });

    it('message hover uses background-color transition not all', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/\.message\s*\{[^}]*transition:\s*background-color\s+200ms\s+ease/);
    });

    it('message hover does not use translateX shift', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).not.toContain('translateX(2px)');
    });

    it('attachment card CSS includes smooth transition', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/\.attachment-card\s*\{[^}]*transition:\s*all\s+200ms\s+ease/);
    });

    it('reaction badge CSS includes smooth transition', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/\.reaction\s*\{[^}]*transition:\s*all\s+200ms\s+ease/);
    });

    it('image preview uses fixed thumbnail size with no hover expansion', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/\.attachment-preview-img\s*\{[^}]*max-height:\s*350px/);
      expect(html).not.toContain('.attachment-preview-img:hover');
    });
  });

  describe('Inline Highlight.js CSS', () => {
    it('does not contain external CDN link tags', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).not.toContain('<link rel="stylesheet"');
      expect(html).not.toContain('cdnjs.cloudflare.com');
    });

    it('contains Highlight.js CSS inlined in style block', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.hljs{background:#1e1e1e');
      expect(html).toContain('.hljs-keyword');
      expect(html).toContain('.hljs-string');
      expect(html).toContain('.hljs-comment');
    });
  });

  describe('Message anchors', () => {
    it('each message div has id="msg-{messageId}" attribute', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      for (const msg of EXPORT_MESSAGES) {
        expect(html).toContain(`id="msg-${msg.id}"`);
      }
    });

    it('message anchor IDs are unique across all messages', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const idMatches = html.match(/\sid="msg-[^"]+"/g) || [];
      const uniqueIds = new Set(idMatches);
      expect(uniqueIds.size).toBe(EXPORT_MESSAGES.length);
    });

    it('message still has data-message-id attribute', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      for (const msg of EXPORT_MESSAGES) {
        expect(html).toContain(`data-message-id="${msg.id}"`);
      }
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 2: JAVASCRIPT FRAMEWORK
// ═════════════════════════════════════════════════════════════════

describe('Phase 2: JavaScript Framework', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Embedded data', () => {
    it('contains script type=application/json with id=export-data', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('<script type="application/json" id="export-data">');
    });

    it('export-data is valid parseable JSON', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      expect(match).not.toBeNull();
      const data = JSON.parse(match![1]);
      expect(data).toBeDefined();
      expect(data.page).toBeDefined();
      expect(data.users).toBeDefined();
    });

    it('export-data contains page metadata', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.page.current).toBe(1);
      expect(data.page.total).toBe(1);
      expect(data.page.baseFilename).toBe('test-channel');
    });

    it('export-data contains user data from message authors', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.users['100000000000000001']).toBeDefined();
      expect(data.users['100000000000000001'].username).toBe('alice');
    });
  });

  describe('Embedded script', () => {
    it('contains a script block with JavaScript', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      // Should have the IIFE script (not the JSON one)
      expect(html).toMatch(/<script>\s*\n\(function\(\)/);
    });

    it('page is still readable HTML structure', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<div class="message"');
      expect(html).toContain('Hello world');
    });
  });

  describe('Interactive attributes', () => {
    it('username spans have data-action="show-user" and data-user-id', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/class="author"[^>]*data-action="show-user"/);
      expect(html).toMatch(/class="author"[^>]*data-user-id="100000000000000001"/);
    });

    it('avatar elements have data-action="show-user" and data-user-id', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/class="avatar"[^>]*data-action="show-user"/);
      expect(html).toMatch(/class="avatar"[^>]*data-user-id="/);
    });

    it('avatar placeholders have data-action="show-user"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      // Bob has no avatar, gets a placeholder
      expect(html).toMatch(/class="avatar-placeholder"[^>]*data-action="show-user"/);
    });
  });

  describe('Page navigation excluded for single-page', () => {
    it('single-page export omits bottom-nav', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).not.toContain('class="bottom-nav"');
    });

    it('single-page export still has jump-to-top button', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('id="jump-top"');
    });
  });

  describe('Popup CSS', () => {
    it('contains popup styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.discrub-popup');
      expect(html).toContain('.user-popup-card');
      expect(html).toContain('.user-popup-name');
    });

    it('contains popup animation', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('popup-fade-in');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 3: PAGE NAVIGATION
// ═════════════════════════════════════════════════════════════════

describe('Phase 3: Page Navigation', () => {
  function generateHTML(
    messages: Message[],
    channelName = 'test-channel',
    opts: { pageNumber?: number; totalPages?: number } = {},
  ): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName,
      opts.pageNumber ?? 1,
      opts.totalPages ?? 1,
      null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Multi-page header nav', () => {
    it('includes bottom-nav for multi-page exports', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 2, totalPages: 3 });
      expect(html).toContain('class="bottom-nav"');
    });

    it('shows "Page X of Y" in bottom nav', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 2, totalPages: 3 });
      expect(html).toContain('Page 2 of 3');
    });

    it('first page has disabled Previous button', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 1, totalPages: 3 });
      expect(html).toMatch(/class="nav-btn disabled"[^>]*>.*Previous/s);
    });

    it('last page has disabled Next button', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 3, totalPages: 3 });
      expect(html).toMatch(/class="nav-btn disabled"[^>]*>.*Next/s);
    });

    it('middle page has both active Previous and Next links', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 2, totalPages: 3 });
      expect(html).toContain('href="general-page-1.html"');
      expect(html).toContain('href="general-page-3.html"');
    });

    it('Previous link points to correct page filename', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 3, totalPages: 5 });
      expect(html).toContain('href="general-page-2.html"');
    });

    it('Next link points to correct page filename', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 2, totalPages: 5 });
      expect(html).toContain('href="general-page-3.html"');
    });
  });

  describe('Bottom navigation bar', () => {
    it('includes bottom-nav for multi-page exports', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 1, totalPages: 3 });
      expect(html).toContain('class="bottom-nav"');
    });

    it('bottom-nav has matching page info', () => {
      const html = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 2, totalPages: 3 });
      // Both header and bottom should show page info
      const matches = html.match(/Page 2 of 3/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('omitted for single-page export', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).not.toContain('class="bottom-nav"');
    });
  });

  describe('Jump to top button', () => {
    it('includes jump-top button', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toContain('id="jump-top"');
      expect(html).toContain('class="jump-top"');
    });

    it('present in both single and multi-page exports', () => {
      const single = generateHTML(EXPORT_MESSAGES, 'general');
      const multi = generateHTML(EXPORT_MESSAGES.slice(0, 3), 'general', { pageNumber: 1, totalPages: 3 });
      expect(single).toContain('id="jump-top"');
      expect(multi).toContain('id="jump-top"');
    });
  });

  describe('Navigation CSS', () => {
    it('includes nav button styles', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toContain('.nav-btn');
      expect(html).toContain('.bottom-nav');
      expect(html).toContain('.jump-top');
    });

    it('print styles hide nav elements', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toMatch(/@media print[\s\S]*\.bottom-nav[\s\S]*display:\s*none/);
    });
  });

  describe('Navigation JS', () => {
    it('embedded JS includes jump-to-top scroll handler', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toContain('jump-top');
      expect(html).toContain('scrollTo');
    });

    it('embedded JS includes keyboard arrow navigation', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toContain('ArrowLeft');
      expect(html).toContain('ArrowRight');
    });

    it('keyboard nav skips when popup is open', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toContain('if (activePopup) return');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 4: USER INTERACTIVITY (Hover Cards + Toolbar)
// ═════════════════════════════════════════════════════════════════

describe('Phase 4: User Interactivity', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Message hover toolbar CSS', () => {
    it('includes toolbar styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.msg-toolbar');
      expect(html).toContain('.msg-toolbar-btn');
    });

    it('toolbar is positioned absolute at top-right of message', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/\.msg-toolbar[\s\S]*?position:\s*absolute/);
      expect(html).toMatch(/\.msg-toolbar[\s\S]*?top:\s*-16px/);
      expect(html).toMatch(/\.msg-toolbar[\s\S]*?right:\s*16px/);
    });
  });

  describe('User mention data attributes', () => {
    it('user-mention spans from discrub-core have data-user-id (via formatContentAsHtml)', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('user-mention');
    });
  });

  describe('Mentioned user data in export-data', () => {
    it('mentioned non-author users appear in export-data users map', () => {
      const service = getExportService();
      // Message that mentions a user who did NOT post any messages
      const msgWithMention = {
        id: 'msg-mention-test',
        channel_id: 'channel-123',
        author: { id: '100000000000000001', username: 'alice', discriminator: '0', avatar: 'alice_hash', global_name: 'Alice' },
        content: 'Hey <@999000000000000001> check this out',
        timestamp: '2026-06-15T12:00:00.000Z',
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [
          { id: '999000000000000001', username: 'silentuser', discriminator: '0', avatar: 'silent_hash', global_name: 'Silent User' },
        ],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      } as unknown as Message;

      const html = service.generateHTMLPage(
        [msgWithMention], 'test-channel', 1, 1, null,
        'test-channel', undefined, DEFAULT_EXPORT_CONFIG,
      );
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      // The mentioned user should appear in the users map even though they didn't post
      expect(data.users['999000000000000001']).toBeDefined();
      expect(data.users['999000000000000001'].username).toBe('silentuser');
      expect(data.users['999000000000000001'].displayName).toBe('Silent User');
      expect(data.users['999000000000000001'].avatarUrl).toContain('silent_hash');
    });

    it('mentioned user from message.mentions does not overwrite existing author data', () => {
      const service = getExportService();
      const msgWithSelfMention = {
        id: 'msg-self-mention',
        channel_id: 'channel-123',
        author: { id: '100000000000000001', username: 'alice', discriminator: '0', avatar: 'alice_full_hash', global_name: 'Alice Full' },
        content: 'I mentioned myself <@100000000000000001>',
        timestamp: '2026-06-15T12:00:00.000Z',
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [
          { id: '100000000000000001', username: 'alice', discriminator: '0', avatar: 'alice_full_hash', global_name: 'Alice Full' },
        ],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
      } as unknown as Message;

      const html = service.generateHTMLPage(
        [msgWithSelfMention], 'test-channel', 1, 1, null,
        'test-channel', undefined, DEFAULT_EXPORT_CONFIG,
      );
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      // Author data should take precedence (was set first, mentioned user check uses !seenAuthors.has)
      expect(data.users['100000000000000001']).toBeDefined();
      expect(data.users['100000000000000001'].username).toBe('alice');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 5: REACTION VIEWER
// ═════════════════════════════════════════════════════════════════

describe('Phase 5: Reaction Viewer', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Reaction badge attributes', () => {
    it('reaction badges have data-action="show-reactions"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('data-action="show-reactions"');
    });

    it('reaction badges have data-message-id', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      // msg-4 has a reaction
      expect(html).toMatch(/data-action="show-reactions"[^>]*data-message-id="msg-4"/);
    });

    it('reaction badges have data-emoji-key', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('data-emoji-key="👍"');
    });
  });

  describe('Reaction data in export-data', () => {
    it('export-data JSON contains reactions map', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions).toBeDefined();
    });

    it('reactions map has entries for messages with reactions', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      // msg-4 has 👍 reaction, msg-6 has 👍 and ❤️
      expect(data.reactions['msg-4']).toBeDefined();
      expect(data.reactions['msg-6']).toBeDefined();
    });

    it('reaction data contains emoji name and count', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].emoji).toBe('👍');
      expect(data.reactions['msg-4']['👍'].count).toBe(5);
    });

    it('reaction data has empty users array by default', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].users).toEqual([]);
    });

    it('reaction data includes user info from ExportReactionMap', () => {
      const service = getExportService();
      const reactionMap = {
        'msg-4': {
          '👍': [
            { id: 'user-reactor-1', burst: false, username: 'ReactorUser', avatar: 'abc123' },
            { id: 'user-111', burst: false, username: 'alice', avatar: 'alice_avatar_hash' },
          ],
        },
      };
      const html = service.generateHTMLPage(
        EXPORT_MESSAGES, 'test-channel', 1, 1, null,
        'test-channel', undefined, DEFAULT_EXPORT_CONFIG,
        undefined, reactionMap,
      );
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].users).toHaveLength(2);
      expect(data.reactions['msg-4']['👍'].users[0].username).toBe('ReactorUser');
      expect(data.reactions['msg-4']['👍'].users[0].avatarUrl).toContain('abc123');
      expect(data.reactions['msg-4']['👍'].users[1].username).toBe('alice');
    });

    it('custom emoji reactions use name:id key format matching discrub-core', () => {
      const service = getExportService();
      // Message with a custom emoji reaction
      const msgWithCustomEmoji = {
        ...EXPORT_MESSAGES[3], // msg-4
        reactions: [
          { count: 2, count_details: { burst: 0, normal: 2 }, me: false, me_burst: false, emoji: { id: '999888777', name: 'pepe' } },
        ],
      } as unknown as Message;
      // ReactionMap uses discrub-core's getEncodedEmoji format: "name:id"
      const reactionMap = {
        'msg-4': {
          'pepe:999888777': [
            { id: 'user-1', burst: false, username: 'PepeUser', avatar: 'def456' },
          ],
        },
      };
      const html = service.generateHTMLPage(
        [msgWithCustomEmoji], 'test-channel', 1, 1, null,
        'test-channel', undefined, DEFAULT_EXPORT_CONFIG,
        undefined, reactionMap,
      );
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      // Key in export data should match discrub-core's format
      expect(data.reactions['msg-4']['pepe:999888777']).toBeDefined();
      expect(data.reactions['msg-4']['pepe:999888777'].users).toHaveLength(1);
      expect(data.reactions['msg-4']['pepe:999888777'].users[0].username).toBe('PepeUser');
    });

    it('reactor who did not post a message shows username from ExportReaction', () => {
      const service = getExportService();
      const reactionMap = {
        'msg-4': {
          '👍': [
            { id: 'unknown-user-who-never-posted', burst: false, username: 'SilentReactor', avatar: null },
          ],
        },
      };
      const html = service.generateHTMLPage(
        EXPORT_MESSAGES, 'test-channel', 1, 1, null,
        'test-channel', undefined, DEFAULT_EXPORT_CONFIG,
        undefined, reactionMap,
      );
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].users[0].username).toBe('SilentReactor');
      expect(data.reactions['msg-4']['👍'].users[0].avatarUrl).toBe('');
    });
  });

  describe('Reaction popup CSS', () => {
    it('includes reaction popup styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.reaction-popup-card');
      expect(html).toContain('.reaction-popup-tabs');
      expect(html).toContain('.reaction-tab');
      expect(html).toContain('.reaction-user-list');
    });

    it('includes count-only mode styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.reaction-count-only');
      expect(html).toContain('.reaction-count-list');
    });
  });

  describe('Reaction popup JS', () => {
    it('embedded JS includes show-reactions action handler', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('show-reactions');
      expect(html).toContain('showReactionsPopup');
    });

    it('embedded JS includes tab switching logic', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('reaction-tab');
      expect(html).toContain('data-tab');
      expect(html).toContain('renderContent');
    });
  });

  describe('Reaction map wiring (end-to-end)', () => {
    it('generateHTMLPage with reactionMap populates user data in JSON', () => {
      const service = getExportService();
      const reactionMap = {
        'msg-4': {
          '👍': [
            { id: '100000000000000001', burst: false },
            { id: '100000000000000002', burst: false },
          ],
        },
      };
      const html = service.generateHTMLPage(
        EXPORT_MESSAGES, 'test', 1, 1, null, 'test', undefined, DEFAULT_EXPORT_CONFIG, undefined, reactionMap,
      );
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].users).toHaveLength(2);
      expect(data.reactions['msg-4']['👍'].users[0].id).toBe('100000000000000001');
    });

    it('exportToZip passes reactionMap through to HTML output', async () => {
      const reactionMap = {
        'msg-4': {
          '👍': [
            { id: '100000000000000001', burst: false },
          ],
        },
      };
      const service = getExportService();
      await service.exportToZip(
        EXPORT_MESSAGES, 'test-channel', 'html', 100, false, null,
        EXPORT_USER_MAP, EXPORT_GUILD_ID,
        undefined, undefined, DEFAULT_EXPORT_CONFIG, undefined, undefined,
        undefined, undefined, reactionMap,
      );
      const html = getFileContent('test_channel/test_channel-page-1.html');
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].users).toHaveLength(1);
      expect(data.reactions['msg-4']['👍'].users[0].id).toBe('100000000000000001');
    });

    it('exportToZip without reactionMap produces empty user arrays', async () => {
      const service = getExportService();
      await service.exportToZip(
        EXPORT_MESSAGES, 'test-channel', 'html', 100, false, null,
        EXPORT_USER_MAP, EXPORT_GUILD_ID,
        undefined, undefined, DEFAULT_EXPORT_CONFIG,
      );
      const html = getFileContent('test_channel/test_channel-page-1.html');
      const match = html.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/);
      const data = JSON.parse(match![1]);
      expect(data.reactions['msg-4']['👍'].users).toEqual([]);
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 6: REPLY CHAINS & THREAD NAVIGATION
// ═════════════════════════════════════════════════════════════════

describe('Phase 6: Reply Chains & Thread Navigation', () => {
  function generateHTML(
    messages: Message[],
    channelName = 'test-channel',
    opts: { mediaPathPrefix?: string; backLinkPage?: number } = {},
  ): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
      opts.mediaPathPrefix,
      undefined, undefined, undefined,
      opts.backLinkPage,
    );
  }

  describe('Reply preview bar', () => {
    it('renders reply bar for type 19 reply messages', () => {
      const html = generateHTML(REPLY_MESSAGES, 'discussion');
      expect(html).toContain('class="reply-bar"');
    });

    it('reply bar shows referenced author username', () => {
      const html = generateHTML(REPLY_MESSAGES, 'discussion');
      // msg-reply-2 replies to msg-reply-1 by alice
      expect(html).toContain('class="reply-author">alice</span>');
    });

    it('reply bar shows truncated referenced content', () => {
      const html = generateHTML(REPLY_MESSAGES, 'discussion');
      expect(html).toContain('Has anyone tried the new build?');
    });

    it('reply bar has data-action="jump-to-reply" and data-target-id', () => {
      const html = generateHTML(REPLY_MESSAGES, 'discussion');
      expect(html).toContain('data-action="jump-to-reply"');
      expect(html).toContain('data-target-id="msg-reply-1"');
    });

    it('reply bar shows small avatar image when referenced author has avatar', () => {
      const html = generateHTML(REPLY_MESSAGES, 'discussion');
      expect(html).toContain('class="reply-avatar-img"');
    });

    it('reply bar shows deleted message text when referenced_message is null', () => {
      const html = generateHTML(REPLY_MESSAGES, 'discussion');
      expect(html).toContain('reply-bar-deleted');
      expect(html).toContain('Original message was deleted');
    });

    it('does not render reply bar for non-reply messages', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).not.toContain('class="reply-bar"');
    });
  });

  describe('Thread banner', () => {
    it('renders thread banner for messages with thread field', () => {
      const html = generateHTML(THREAD_MESSAGES, 'general');
      expect(html).toContain('class="thread-banner"');
    });

    it('thread banner shows thread name', () => {
      const html = generateHTML(THREAD_MESSAGES, 'general');
      expect(html).toContain('bug-discussion');
    });

    it('thread banner links to thread HTML file', () => {
      const html = generateHTML(THREAD_MESSAGES, 'general');
      expect(html).toMatch(/href="threads\/[^"]+\.html"/);
      expect(html).toContain('threads/');
    });

    it('does not render thread banner for messages without thread', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).not.toContain('class="thread-banner"');
    });
  });

  describe('Thread back-navigation', () => {
    it('thread pages show back-navigation link when mediaPathPrefix is set', () => {
      const html = generateHTML(
        THREAD_MESSAGES.filter((m) => m.channel_id === 'thread-001'),
        'bug-discussion',
        { mediaPathPrefix: '../' },
      );
      expect(html).toContain('class="thread-back-link"');
      expect(html).toContain('Back to');
    });

    it('back-navigation links to parent channel HTML page 1 by default', () => {
      const html = generateHTML(
        THREAD_MESSAGES.filter((m) => m.channel_id === 'thread-001'),
        'bug-discussion',
        { mediaPathPrefix: '../' },
      );
      expect(html).toContain('href="../bug-discussion-page-1.html"');
    });

    it('back-navigation links to correct page when backLinkPage is provided', () => {
      const html = generateHTML(
        THREAD_MESSAGES.filter((m) => m.channel_id === 'thread-001'),
        'bug-discussion',
        { mediaPathPrefix: '../', backLinkPage: 3 },
      );
      expect(html).toContain('href="../bug-discussion-page-3.html"');
    });

    it('non-thread pages do not show back-navigation', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).not.toContain('class="thread-back-link"');
    });
  });

  describe('Reply bar content (2.2.7)', () => {
    const context = { userMap: { '1541': { displayName: 'Prather Bytecraft' } }, channelMap: { '345': { name: 'general' } } };
    const replyTo = (content: string) => [
      { ...REPLY_MESSAGES[0] },
      { ...REPLY_MESSAGES[1], referenced_message: { ...(REPLY_MESSAGES[1] as any).referenced_message, content } },
    ] as Message[];
    const generate = (content: string, ctx?: typeof context) => getExportService().generateHTMLPage(replyTo(content), 'general', 1, 1, null, 'general', ctx, DEFAULT_EXPORT_CONFIG);

    it('resolves mentions in the original message and keeps it on one line', () => {
      const html = generate('Ask <@1541> in <#345>\nsecond line', context);
      expect(html).toContain('<span class="reply-content">Ask <span class="user-mention" data-user-id="1541">@Prather Bytecraft</span> in <span class="channel-mention" data-channel-id="345"># general</span> second line</span>');
      expect(html).not.toContain('&lt;@1541&gt;');
    });

    it('escapes the original without a context, and never cuts inside a mention', () => {
      expect(generate('Ask <@1541> & <b>x</b>')).toContain('<span class="reply-content">Ask &lt;@1541&gt; &amp; &lt;b&gt;x&lt;/b&gt;</span>');
      const html = generate('a'.repeat(296) + ' <@1541> tail', context);
      expect(html).toContain('<span class="reply-content">' + 'a'.repeat(296) + '...</span>');
    });
  });

  describe('Reply & thread CSS', () => {
    it('includes reply bar styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.reply-bar');
      expect(html).toContain('.reply-author');
      expect(html).toContain('.reply-content');
    });

    it('includes thread banner styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.thread-banner');
      expect(html).toContain('.thread-banner-link');
    });

    it('includes thread back-navigation styles', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.thread-back-link');
    });

    it('includes message highlight animation for jump-to-reply', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.message-highlight');
      expect(html).toContain('highlight-fade');
    });
  });

  describe('Jump-to-reply JS', () => {
    it('embedded JS includes jump-to-reply action handler', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain("case 'jump-to-reply'");
      expect(html).toContain('jumpToReply');
    });

    it('jump-to-reply scrolls to target and adds highlight class', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('scrollIntoView');
      expect(html).toContain('message-highlight');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 7: CONTENT ENHANCEMENTS
// ═════════════════════════════════════════════════════════════════

describe('Phase 7: Content Enhancements', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Edited message indicator', () => {
    it('shows (edited) for messages with edited_timestamp', () => {
      const html = generateHTML(EDITED_MESSAGES);
      expect(html).toContain('class="edited-indicator"');
      expect(html).toContain('(edited)');
    });

    it('edited indicator has title with formatted timestamp', () => {
      const html = generateHTML(EDITED_MESSAGES);
      expect(html).toMatch(/title="Edited: [^"]+"/);
    });

    it('does not show (edited) for non-edited messages', () => {
      // msg-edited-2 has no edited_timestamp
      const html = generateHTML([EDITED_MESSAGES[1]]);
      expect(html).not.toContain('class="edited-indicator"');
    });

    it('edited indicator CSS is included', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.edited-indicator');
    });
  });

  describe('Image lightbox', () => {
    it('image attachments have data-action="open-lightbox"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      // msg-4 has photo.png
      expect(html).toContain('data-action="open-lightbox"');
    });

    it('images have sequential data-img-index attributes', () => {
      const html = generateHTML(MEDIA_HEAVY_MESSAGES);
      // 3 screenshots + no more images
      expect(html).toContain('data-img-index="0"');
      expect(html).toContain('data-img-index="1"');
      expect(html).toContain('data-img-index="2"');
    });

    it('lightbox CSS is included', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.lightbox-overlay');
      expect(html).toContain('.lightbox-img');
      expect(html).toContain('.lightbox-close');
      expect(html).toContain('.lightbox-nav');
    });

    it('embedded JS includes lightbox functions', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('openLightbox');
      expect(html).toContain('closeLightbox');
      expect(html).toContain('lightboxPrev');
      expect(html).toContain('lightboxNext');
    });

    it('Escape key closes lightbox before popup', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('lightboxOverlay');
    });
  });

  describe('Message grouping', () => {
    it('consecutive same-author messages within 7 min get message-grouped class', () => {
      const html = generateHTML(GROUPED_MESSAGES);
      expect(html).toContain('message-grouped');
    });

    it('grouped messages show compact timestamp (hidden until hover)', () => {
      const html = generateHTML(GROUPED_MESSAGES);
      expect(html).toContain('class="grouped-timestamp"');
    });

    it('first message in group has full avatar and header', () => {
      const html = generateHTML(GROUPED_MESSAGES);
      // msg-group-1 (alice, first) should have avatar
      expect(html).toContain('id="msg-msg-group-1"');
      // It should NOT have message-grouped class
      const firstMsgMatch = html.match(/id="msg-msg-group-1"[^>]*/);
      expect(firstMsgMatch?.[0]).not.toContain('message-grouped');
    });

    it('group breaks on different author', () => {
      const html = generateHTML(GROUPED_MESSAGES);
      // msg-group-4 is bob — should NOT be grouped
      const bobMsg = html.match(/<div class="message"[^>]*id="msg-msg-group-4"/);
      expect(bobMsg).not.toBeNull();
      // Should not have message-grouped
      expect(bobMsg?.[0]).not.toContain('message-grouped');
    });

    it('group breaks on >7 minute time gap', () => {
      const html = generateHTML(GROUPED_MESSAGES);
      // msg-group-5 is alice but 10 min after msg-group-4 — should NOT be grouped
      const gapMsg = html.match(/<div class="message"[^>]*id="msg-msg-group-5"/);
      expect(gapMsg).not.toBeNull();
      expect(gapMsg?.[0]).not.toContain('message-grouped');
    });

    it('grouping CSS is included', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.message-grouped');
      expect(html).toContain('.grouped-timestamp');
    });

    it('newest-first ordering still breaks groups on >7 min gaps', () => {
      // Regression: a signed (current - previous) delta is negative when
      // messages are sorted newest-first, which trivially passed the
      // "< GROUPING_WINDOW_MS" check and grouped every message even
      // across day-long gaps. A DM package export surfaces this because
      // it sorts newest-first and the CSV only contains one author.
      const nowFirst: Message[] = [
        {
          id: 'msg-new-1',
          channel_id: 'c1',
          author: AUTHOR_ALICE,
          content: 'Most recent',
          timestamp: '2023-07-27T15:04:09.416Z',
          edited_timestamp: null,
          tts: false,
          mention_everyone: false,
          mentions: [],
          attachments: [],
          embeds: [],
          reactions: [],
          pinned: false,
          type: 0,
        } as unknown as Message,
        {
          id: 'msg-new-2',
          channel_id: 'c1',
          author: AUTHOR_ALICE,
          content: 'Months earlier',
          timestamp: '2023-03-24T19:38:33.520Z',
          edited_timestamp: null,
          tts: false,
          mention_everyone: false,
          mentions: [],
          attachments: [],
          embeds: [],
          reactions: [],
          pinned: false,
          type: 0,
        } as unknown as Message,
      ];
      const html = generateHTML(nowFirst);
      // Second message is ~124 days earlier — grouping must NOT apply.
      const msg2 = html.match(/<div class="message[^"]*"[^>]*id="msg-msg-new-2"[^>]*/);
      expect(msg2).not.toBeNull();
      expect(msg2?.[0]).not.toContain('message-grouped');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 8: SEARCH & DATE NAVIGATION
// ═════════════════════════════════════════════════════════════════

describe('Phase 8: Search & Date Navigation', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Search bar', () => {
    it('includes search input in header', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('id="search-input"');
      expect(html).toContain('Search messages...');
    });

    it('includes search count display', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('id="search-count"');
    });

    it('includes search clear button', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('id="search-clear"');
    });

    it('search bar CSS is included', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.search-bar');
      expect(html).toContain('.search-input');
      expect(html).toContain('.search-count');
      expect(html).toContain('.search-hidden');
    });

    it('search is hidden in print', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/@media print[\s\S]*\.search-bar/);
    });
  });

  describe('Date dividers', () => {
    it('inserts date dividers between messages from different days', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('class="date-divider"');
      expect(html).toContain('class="date-divider-text"');
    });

    it('date divider shows formatted date', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      // All EXPORT_MESSAGES are on June 15, 2026
      expect(html).toContain('June 15, 2026');
    });

    it('date divider has anchor ID for jump-to-date', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('id="date-2026-06-15"');
    });

    it('only one divider for messages on the same day', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      const matches = html.match(/class="date-divider"/g);
      // All messages are on the same day, so only 1 divider
      expect(matches).toHaveLength(1);
    });

    it('date divider CSS is included', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.date-divider');
      expect(html).toContain('.date-divider-text');
    });
  });

  describe('Search JS', () => {
    it('embedded JS includes search functionality', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('performSearch');
      expect(html).toContain('clearSearch');
    });

    it('embedded JS includes Ctrl+F/Cmd+F interception', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('ctrlKey');
      expect(html).toContain('metaKey');
    });

    it('search hides non-matching messages', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('search-hidden');
    });

    it('search hides date dividers with no visible messages', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('date-divider');
      expect(html).toContain('hasVisible');
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 9: DARK/LIGHT MODE & RESPONSIVE
// ═════════════════════════════════════════════════════════════════

describe('Phase 9: Dark/Light Mode & Responsive', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('CSS custom properties', () => {
    it('defines CSS custom properties on :root', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain(':root');
      expect(html).toContain('--bg-primary');
      expect(html).toContain('--text-primary');
      expect(html).toContain('--accent');
    });

    it('body uses CSS custom properties', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/body[\s\S]*?var\(--bg-primary\)/);
      expect(html).toMatch(/body[\s\S]*?var\(--text-primary\)/);
    });

    it('defines light theme overrides', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.light-theme');
      expect(html).toContain('.light-theme .author');
    });
  });

  describe('Theme toggle', () => {
    it('includes the theme dropdown in header', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('id="theme-select"');
    });

    it('bakes the export-time theme set onto :root and <html> (slot E)', () => {
      const service = getExportService();
      service.setExportThemeSet(resolveExportThemeSet({ themeSetting: 'terminal', isSupporter: false }));
      try {
        const html = generateHTML(EXPORT_MESSAGES);
        expect(html).toContain('class="export-theme-terminal"');
        expect(html).toMatch(/:root \{[^}]*--bg-primary: #0a0f0a/);
        expect(html).toContain('<option value="terminal" selected>');
        expect(html).not.toContain('export-theme-synthwave');
      } finally {
        service.setExportThemeSet(defaultExportThemeSet());
      }
    });

    it('a light-base default also bakes the light-theme structural class', () => {
      const service = getExportService();
      service.setExportThemeSet(resolveExportThemeSet({ themeSetting: 'discord-light', isSupporter: false }));
      try {
        const html = generateHTML(EXPORT_MESSAGES);
        expect(html).toContain('class="export-theme-discord-light light-theme"');
      } finally {
        service.setExportThemeSet(defaultExportThemeSet());
      }
    });

    it('bakes a customized supporter footer and honors removal (slot F)', () => {
      const service = getExportService();
      service.setExportFooterConfig({
        removed: false,
        text: 'Archived by Aaron',
        iconDataUri: 'data:image/png;base64,abc123',
      });
      try {
        const html = generateHTML(EXPORT_MESSAGES);
        expect(html).toContain('Archived by Aaron on ');
        expect(html).toContain('src="data:image/png;base64,abc123"');
        expect(html).not.toContain('Exported with <strong>Discrub</strong>');

        service.setExportFooterConfig({ removed: true, text: '', iconDataUri: null });
        const removedHtml = generateHTML(EXPORT_MESSAGES);
        // The CSS rules remain; the element itself must be gone.
        expect(removedHtml).not.toContain('<footer class="export-footer">');
      } finally {
        service.setExportFooterConfig(defaultExportFooterConfig());
      }
    });

    it('default footer keeps the Discrub emphasis line', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('Exported with <strong>Discrub</strong> on ');
      expect(html).toContain('export-footer-meta');
    });

    it('a supporter set embeds all themes in the dropdown', () => {
      const service = getExportService();
      service.setExportThemeSet(resolveExportThemeSet({ themeSetting: 'synthwave', isSupporter: true }));
      try {
        const html = generateHTML(EXPORT_MESSAGES);
        expect(html).toContain('<option value="synthwave" selected>');
        expect(html).toContain('.export-theme-abyss {');
      } finally {
        service.setExportThemeSet(defaultExportThemeSet());
      }
    });

    it('theme dropdown is hidden in print', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/@media print[\s\S]*\.theme-select/);
    });

    it('embedded JS includes theme toggle logic', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('applyTheme');
      expect(html).toContain('light-theme');
      expect(html).toContain('discrub-export-theme');
    });

    it('theme persists via localStorage', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('localStorage.getItem');
      expect(html).toContain('localStorage.setItem');
    });
  });

  describe('Responsive styles', () => {
    it('includes tablet breakpoint (768px)', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('@media (max-width: 768px)');
    });

    it('includes mobile breakpoint (480px)', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('@media (max-width: 480px)');
    });

    it('tablet breakpoint reduces avatar size', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      // Inside the 768px media query, avatar should be 32px
      expect(html).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.avatar[\s\S]*?32px/);
    });

    it('attachments become single column on tablet', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.attachments[\s\S]*?1fr/);
    });
  });

  describe('Print styles', () => {
    it('print forces light theme variables', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/@media print[\s\S]*--bg-primary:\s*white/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// PHASE 10: FINAL POLISH
// ═════════════════════════════════════════════════════════════════

describe('Phase 10: Final Polish', () => {
  function generateHTML(messages: Message[], channelName = 'test-channel'): string {
    const service = getExportService();
    return service.generateHTMLPage(
      messages, channelName, 1, 1, null,
      channelName.replace(/[^a-z0-9-_]/gi, '-'),
      undefined, DEFAULT_EXPORT_CONFIG,
    );
  }

  describe('Export metadata footer', () => {
    it('includes export footer', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('class="export-footer"');
    });

    it('footer contains "Exported with Discrub"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('Exported with');
      expect(html).toContain('Discrub');
    });

    it('footer contains message count', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain(`${EXPORT_MESSAGES.length} messages`);
    });

    it('footer CSS is included', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('.export-footer');
      expect(html).toContain('.export-footer-text');
      expect(html).toContain('.export-footer-meta');
    });
  });

  describe('Accessibility', () => {
    it('header has role="banner"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('role="banner"');
    });

    it('container has role="main"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('role="main"');
    });

    it('search input has aria-label', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('aria-label="Search messages"');
    });

    it('search count has aria-live="polite"', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('aria-live="polite"');
    });

    it('theme dropdown has aria-label', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('aria-label="Theme"');
    });

    it('jump-to-top button has aria-label', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('aria-label="Scroll to top"');
    });

    it('search clear button has aria-label', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('aria-label="Clear search"');
    });

    it('heading hierarchy starts with h1 for channel name', () => {
      const html = generateHTML(EXPORT_MESSAGES, 'general');
      expect(html).toContain('<h1>#general</h1>');
    });

    it('images have loading="lazy" attribute', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('loading="lazy"');
    });
  });

  describe('Reduced motion', () => {
    it('includes prefers-reduced-motion media query', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toContain('prefers-reduced-motion: reduce');
    });

    it('reduced motion disables animations and transitions', () => {
      const html = generateHTML(EXPORT_MESSAGES);
      expect(html).toMatch(/prefers-reduced-motion[\s\S]*animation-duration:\s*0\.01ms/);
      expect(html).toMatch(/prefers-reduced-motion[\s\S]*transition-duration:\s*0\.01ms/);
    });
  });

  describe('Bottom nav accessibility', () => {
    it('bottom nav has role="navigation" for multi-page exports', () => {
      const service = getExportService();
      const html = service.generateHTMLPage(
        EXPORT_MESSAGES.slice(0, 3), 'test', 1, 3, null, 'test', undefined, DEFAULT_EXPORT_CONFIG,
      );
      expect(html).toContain('role="navigation"');
      expect(html).toContain('aria-label="Page navigation"');
    });
  });
});

describe('Stickers & Polls HTML export (#213)', () => {
  const baseMsg = (over: Record<string, unknown>): Message =>
    ({
      id: 'm1',
      type: 0,
      content: '',
      timestamp: '2026-06-15T12:00:00.000Z',
      author: { id: 'u1', username: 'alice' },
      attachments: [],
      embeds: [],
      reactions: [],
      ...over,
    } as unknown as Message);

  it('renders a PNG sticker as a local image', async () => {
    const html = await exportAndGetFile('html', {
      messages: [baseMsg({ sticker_items: [{ id: 's1', name: 'wave', format_type: 1 }] })],
    });
    expect(html).toContain('class="sticker-img"');
    expect(html).toContain('stickers/s1.png');
    expect(html).toContain('alt="wave"');
  });

  it('renders a Lottie sticker as a placeholder, not an image', async () => {
    const html = await exportAndGetFile('html', {
      messages: [baseMsg({ sticker_items: [{ id: 's2', name: 'sparkle', format_type: 3 }] })],
    });
    expect(html).toContain('sticker-placeholder');
    expect(html).toContain('sparkle');
    expect(html).not.toContain('stickers/s2');
  });

  it('renders a poll card with question + options', async () => {
    const html = await exportAndGetFile('html', {
      messages: [
        baseMsg({
          poll: {
            question: { text: 'Best?' },
            answers: [
              { answer_id: 1, poll_media: { text: 'Apples' } },
              { answer_id: 2, poll_media: { text: 'Oranges' } },
            ],
          },
        }),
      ],
    });
    expect(html).toContain('class="poll"');
    expect(html).toContain('Best?');
    expect(html).toContain('Apples');
    expect(html).toContain('Oranges');
  });

  it('renders poll vote bars + total when results are present', async () => {
    const html = await exportAndGetFile('html', {
      messages: [
        baseMsg({
          poll: {
            question: { text: 'Best?' },
            answers: [
              { answer_id: 1, poll_media: { text: 'Apples' } },
              { answer_id: 2, poll_media: { text: 'Oranges' } },
            ],
            results: { answer_counts: [{ id: 1, count: 3 }, { id: 2, count: 1 }] },
          },
        }),
      ],
    });
    expect(html).toContain('75%');
    expect(html).toContain('25%');
    expect(html).toContain('4 votes');
    expect(html).toContain('poll-bar-fill');
  });
});
