import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getExportService, generatePlainTextReadme } from './exportService';
import { createMockMessages } from '@/test/fixtures';
import type { Message } from 'discrub-core/types/discord-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';

// Mock dependencies
vi.mock('./streamingZipService', () => ({
  StreamingZipService: vi.fn().mockImplementation(() => ({
    addFile: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./mediaDownloadService', () => ({
  MediaDownloadService: vi.fn().mockImplementation(() => ({
    downloadAllMedia: vi.fn().mockResolvedValue({
      avatarMap: {},
      attachmentMap: {},
      emojiMap: {},
    }),
  })),
}));

vi.mock('discrub-core/export-data-service', () => ({
  prepareExportData: vi.fn().mockReturnValue({
    mainPages: [{ messages: [], pageNumber: 1, filePath: '' }],
    threadExports: [],
    totalPages: 1,
  }),
}));

describe('exportService', () => {
  let service: ReturnType<typeof getExportService>;
  const mockMessages: Message[] = createMockMessages(5);
  const mockUserMap: ExportUserMap = {
    'user-123': {
      userName: 'testuser',
      displayName: 'Test User',
      avatar: null,
      guilds: {
        'guild-1': {
          roles: [],
          nick: 'TestNick',
          joinedAt: null,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
    },
  };

  beforeEach(() => {
    service = getExportService();
    vi.clearAllMocks();
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = getExportService();
      const instance2 = getExportService();
      expect(instance1).toBe(instance2);
    });
  });

  describe('sanitizeFilename', () => {
    it('should replace special characters with underscores and collapse them', () => {
      const sanitize = (service as any).sanitizeFilename.bind(service);
      expect(sanitize('Hello World!')).toBe('hello_world');
      expect(sanitize('test@#$%channel')).toBe('test_channel');
      expect(sanitize('General-Chat')).toBe('general_chat');
    });

    it('should convert to lowercase', () => {
      const sanitize = (service as any).sanitizeFilename.bind(service);
      expect(sanitize('UPPERCASE')).toBe('uppercase');
      expect(sanitize('MixedCase')).toBe('mixedcase');
    });

    it('should handle empty string', () => {
      const sanitize = (service as any).sanitizeFilename.bind(service);
      expect(sanitize('')).toBe('');
    });

    it('should preserve alphanumeric characters', () => {
      const sanitize = (service as any).sanitizeFilename.bind(service);
      expect(sanitize('channel123')).toBe('channel123');
      expect(sanitize('test123ABC')).toBe('test123abc');
    });

    it('should handle unicode characters', () => {
      const sanitize = (service as any).sanitizeFilename.bind(service);
      expect(sanitize('test-émoji-🎉')).toBe('test_moji');
    });

    it('should append ID suffix when provided', () => {
      const sanitize = (service as any).sanitizeFilename.bind(service);
      expect(sanitize('general', '12345')).toBe('general_12345');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      const escape = (service as any).escapeHtml.bind(service);
      expect(escape('<script>alert("xss")</script>')).toContain('&lt;');
      expect(escape('Test & <tag>')).toContain('&amp;');
    });

    it('should handle quotes', () => {
      const escape = (service as any).escapeHtml.bind(service);
      const result = escape('Say "hello"');
      expect(result).toContain('hello');
    });

    it('should handle empty string', () => {
      const escape = (service as any).escapeHtml.bind(service);
      expect(escape('')).toBe('');
    });

    it('should handle plain text', () => {
      const escape = (service as any).escapeHtml.bind(service);
      expect(escape('plain text')).toBe('plain text');
    });
  });

  describe('escapeCSV', () => {
    it('should escape double quotes', () => {
      const escape = (service as any).escapeCSV.bind(service);
      expect(escape('Say "hello"')).toBe('Say ""hello""');
      expect(escape('"quoted"')).toBe('""quoted""');
    });

    it('should handle text without quotes', () => {
      const escape = (service as any).escapeCSV.bind(service);
      expect(escape('plain text')).toBe('plain text');
    });

    it('should handle empty string', () => {
      const escape = (service as any).escapeCSV.bind(service);
      expect(escape('')).toBe('');
    });

    it('should handle multiple quotes', () => {
      const escape = (service as any).escapeCSV.bind(service);
      expect(escape('He said "hello" and "goodbye"')).toBe('He said ""hello"" and ""goodbye""');
    });
  });

  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      const format = (service as any).formatBytes.bind(service);
      expect(format(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      const format = (service as any).formatBytes.bind(service);
      expect(format(500)).toBe('500 Bytes');
    });

    it('should format kilobytes', () => {
      const format = (service as any).formatBytes.bind(service);
      const result = format(1024);
      expect(result).toContain('KB');
      expect(result).toContain('1');
    });

    it('should format megabytes', () => {
      const format = (service as any).formatBytes.bind(service);
      const result = format(1024 * 1024);
      expect(result).toContain('MB');
    });

    it('should format gigabytes', () => {
      const format = (service as any).formatBytes.bind(service);
      const result = format(1024 * 1024 * 1024);
      expect(result).toContain('GB');
    });

    it('should round to 2 decimal places', () => {
      const format = (service as any).formatBytes.bind(service);
      const result = format(1536); // 1.5 KB
      expect(result).toMatch(/1\.5 KB/);
    });
  });

  describe('getFileIcon (inline SVG, no emoji)', () => {
    const kindOf = (name: string) => {
      const svg = (service as any).getFileIcon.call(service, name) as string;
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      return svg.match(/file-icon-(\w+)/)?.[1];
    };

    it('maps images', () => {
      expect(kindOf('photo.jpg')).toBe('image');
      expect(kindOf('image.png')).toBe('image');
      expect(kindOf('animation.gif')).toBe('image');
    });

    it('maps videos', () => {
      expect(kindOf('video.mp4')).toBe('video');
      expect(kindOf('movie.webm')).toBe('video');
      expect(kindOf('clip.mov')).toBe('video');
    });

    it('maps audio', () => {
      expect(kindOf('song.mp3')).toBe('audio');
      expect(kindOf('audio.wav')).toBe('audio');
    });

    it('maps documents', () => {
      expect(kindOf('document.pdf')).toBe('document');
      expect(kindOf('text.txt')).toBe('document');
    });

    it('maps archives', () => {
      expect(kindOf('archive.zip')).toBe('archive');
      expect(kindOf('compressed.rar')).toBe('archive');
    });

    it('maps code', () => {
      expect(kindOf('script.js')).toBe('code');
      expect(kindOf('component.tsx')).toBe('code');
      expect(kindOf('data.json')).toBe('code');
    });

    it('falls back to a plain file for unknown extensions', () => {
      expect(kindOf('file.unknown')).toBe('file');
      expect(kindOf('noextension')).toBe('file');
    });

    it('is case insensitive', () => {
      expect(kindOf('IMAGE.PNG')).toBe('image');
      expect(kindOf('VIDEO.MP4')).toBe('video');
    });

    it('never emits an emoji', () => {
      const svg = (service as any).getFileIcon.call(service, 'x.zip') as string;
      expect(/[\u{1F300}-\u{1FAFF}]/u.test(svg)).toBe(false);
    });
  });

  describe('generateCSV', () => {
    it('should generate CSV with headers', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const result = generateCSV([], {}, null);

      expect(result).toContain('ID,Timestamp,Username,Display Name,Server Nickname');
    });

    it('should include message data in CSV', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: 'Test message',
        author: {
          id: 'user-123',
          username: 'testuser',
          discriminator: '0001',
        },
        attachments: [],
        embeds: [],
        reactions: [],
      } as unknown as Message];

      const result = generateCSV(messages, mockUserMap, null);

      expect(result).toContain('msg-1');
      expect(result).toContain('testuser');
      expect(result).toContain('Test message');
    });

    it('should escape CSV special characters in content', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: 'Message with "quotes"',
        author: {
          id: 'user-123',
          username: 'testuser',
          discriminator: '0001',
        },
        attachments: [],
        embeds: [],
      } as unknown as Message];

      const result = generateCSV(messages, {}, null);

      expect(result).toContain('""quotes""');
    });

    it('should handle messages with attachments and embeds', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: 'Test',
        author: {
          id: 'user-123',
          username: 'testuser',
          discriminator: '0001',
        },
        attachments: [{ id: 'att-1', filename: 'test.png' }],
        embeds: [{ title: 'Embed' }],
        reactions: [{ emoji: { name: '👍' }, count: 5 }],
      } as any];

      const result = generateCSV(messages, {}, null);

      expect(result).toContain(',1,'); // 1 attachment
      expect(result).toContain(',1,'); // 1 embed
      expect(result).toContain(',5'); // 5 reactions
    });

    it('should use cached user data when available', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: 'Test',
        author: {
          id: 'user-123',
          username: 'original',
          discriminator: '0001',
        },
        attachments: [],
        embeds: [],
      } as unknown as Message];

      const result = generateCSV(messages, mockUserMap, 'guild-1');

      expect(result).toContain('testuser'); // From cache
      expect(result).toContain('Test User'); // Display name from cache
      expect(result).toContain('TestNick'); // Nickname from cache
    });

    it('should handle missing author data', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: 'Test',
        attachments: [],
        embeds: [],
      } as any];

      const result = generateCSV(messages, {}, null);

      expect(result).toContain('Unknown');
    });

    // #197 — forwarded message snapshot handling.
    it('includes a Forwarded Content column header', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const result = generateCSV([], {}, null);
      expect(result).toContain('Content,Forwarded Content,Attachments,Embeds,Reactions');
    });

    it('surfaces the snapshot text in the Forwarded Content column for a forward', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'fwd-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: '', // forwards have no body of their own
        author: { id: 'user-123', username: 'testuser', discriminator: '0001' },
        attachments: [],
        embeds: [],
        reactions: [],
        message_snapshots: [
          { message: { content: 'the original forwarded text', attachments: [], embeds: [] } },
        ],
      } as unknown as Message];

      const result = generateCSV(messages, {}, null);
      const dataRow = result.split('\n')[1];
      // Content empty, Forwarded Content carries the snapshot text.
      expect(dataRow).toContain('"","the original forwarded text"');
    });

    it('folds the snapshot attachment/embed counts into the totals for a forward', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'fwd-2',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: '',
        author: { id: 'user-123', username: 'testuser', discriminator: '0001' },
        attachments: [],
        embeds: [],
        reactions: [],
        message_snapshots: [
          {
            message: {
              content: 'forwarded with media',
              attachments: [{ id: 'a1' }, { id: 'a2' }],
              embeds: [{ title: 'e1' }],
            },
          },
        ],
      } as unknown as Message];

      const result = generateCSV(messages, {}, null);
      const dataRow = result.split('\n')[1];
      // ...,"forwarded with media",2,1,0  (2 attachments + 1 embed from the snapshot)
      expect(dataRow).toContain('"forwarded with media",2,1,0');
    });

    it('leaves Forwarded Content empty for a normal (non-forward) message', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'normal-1',
        timestamp: '2026-02-24T00:00:00.000Z',
        content: 'just a normal message',
        author: { id: 'user-123', username: 'testuser', discriminator: '0001' },
        attachments: [],
        embeds: [],
        reactions: [],
      } as unknown as Message];

      const result = generateCSV(messages, {}, null);
      const dataRow = result.split('\n')[1];
      expect(dataRow).toContain('"just a normal message","",0,0,0');
    });
  });

  describe('exportToZip', () => {
    it('should call StreamingZipService', async () => {
      const { StreamingZipService } = await import('./streamingZipService');

      await service.exportToZip(
        mockMessages,
        'test-channel',
        'json',
        100,
        false,
        null,
        {},
        null
      );

      expect(StreamingZipService).toHaveBeenCalled();
    });

    it('should download media when includeMedia is true', async () => {
      const { MediaDownloadService } = await import('./mediaDownloadService');

      await service.exportToZip(
        mockMessages,
        'test-channel',
        'json',
        100,
        true,
        null,
        {},
        null
      );

      expect(MediaDownloadService).toHaveBeenCalled();
    });

    it('should not download media when includeMedia is false', async () => {
      const { MediaDownloadService } = await import('./mediaDownloadService');
      vi.clearAllMocks();

      await service.exportToZip(
        mockMessages,
        'test-channel',
        'json',
        100,
        false,
        null,
        {},
        null
      );

      expect(MediaDownloadService).not.toHaveBeenCalled();
    });

    it('should call onProgress callback', async () => {
      const onProgress = vi.fn();

      await service.exportToZip(
        mockMessages,
        'test-channel',
        'json',
        100,
        false,
        null,
        {},
        null,
        onProgress
      );

      expect(onProgress).toHaveBeenCalled();
    });

    it('should sanitize channel name', async () => {
      const { StreamingZipService } = await import('./streamingZipService');

      await service.exportToZip(
        mockMessages,
        'Test Channel!',
        'json',
        100,
        false,
        null,
        {},
        null
      );

      expect(StreamingZipService).toHaveBeenCalledWith('test_channel', undefined);
    });

    it('should finalize zip on success', async () => {
      const { StreamingZipService } = await import('./streamingZipService');
      const mockFinalize = vi.fn().mockResolvedValue(undefined);
      (StreamingZipService as any).mockImplementation(() => ({
        addFile: vi.fn().mockResolvedValue(undefined),
        finalize: mockFinalize,
        cancel: vi.fn(),
      }));

      await service.exportToZip(
        mockMessages,
        'test-channel',
        'json',
        100,
        false,
        null,
        {},
        null
      );

      expect(mockFinalize).toHaveBeenCalled();
    });

    it('should cancel zip on error', async () => {
      const { StreamingZipService } = await import('./streamingZipService');
      const mockCancel = vi.fn();
      const mockAddFile = vi.fn().mockRejectedValue(new Error('Test error'));

      (StreamingZipService as any).mockImplementation(() => ({
        addFile: mockAddFile,
        finalize: vi.fn(),
        cancel: mockCancel,
      }));

      await expect(
        service.exportToZip(
          mockMessages,
          'test-channel',
          'json',
          100,
          false,
          null,
          {},
          null
        )
      ).rejects.toThrow();

      expect(mockCancel).toHaveBeenCalled();
    });

    // ── #184: 'text' format integration ────────────────────────────

    describe('text format (#184)', () => {
      it('writes a .txt page file for each prepareExportData page', async () => {
        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'test-channel',
          'text',
          100,
          false,
          null,
          {},
          null,
        );

        const filenames = mockAddFile.mock.calls.map((c: any[]) => c[1] as string);
        const pageFiles = filenames.filter((p) => p.endsWith('.txt') && !p.includes('README'));
        expect(pageFiles.length).toBeGreaterThanOrEqual(1);
        // Page name follows the same pattern as HTML/CSV/JSON.
        expect(pageFiles[0]).toMatch(/test_channel\/test_channel-page-\d+\.txt$/);
      });

      it('writes a plain-text README.txt instead of README.html for text exports', async () => {
        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'test-channel',
          'text',
          100,
          false,
          null,
          {},
          null,
        );

        const filenames = mockAddFile.mock.calls.map((c: any[]) => c[1] as string);
        expect(filenames).toContain('test_channel/README.txt');
        expect(filenames).not.toContain('test_channel/README.html');
      });

      it('uses the text/plain MIME type for page blobs', async () => {
        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'test-channel',
          'text',
          100,
          false,
          null,
          {},
          null,
        );

        const pageCall = mockAddFile.mock.calls.find((c: any[]) => /-page-\d+\.txt$/.test(c[1] as string));
        expect(pageCall).toBeDefined();
        const blob = pageCall![0] as Blob;
        expect(blob.type).toMatch(/^text\/plain/);
      });

      it('emits .txt thread files when prepareExportData returns thread exports', async () => {
        const exportDataMod = await import('discrub-core/export-data-service');
        vi.mocked(exportDataMod.prepareExportData).mockReturnValueOnce({
          mainPages: [{ messages: [], pageNumber: 1, filePath: '' }],
          threadExports: [
            {
              thread: { id: 't-1', name: 'My Thread' },
              pages: [{ messages: [], pageNumber: 1, filePath: '' }],
              threadNumber: 1,
              totalThreads: 1,
            },
          ],
          totalPages: 1,
        } as any);

        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'test-channel',
          'text',
          100,
          false,
          null,
          {},
          null,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        );

        const filenames = mockAddFile.mock.calls.map((c: any[]) => c[1] as string);
        const threadFiles = filenames.filter((p) => p.includes('/threads/') && p.endsWith('.txt'));
        expect(threadFiles.length).toBeGreaterThanOrEqual(1);
        // #175: thread filenames now carry an `_<id>` dedupe suffix.
        expect(threadFiles[0]).toMatch(/threads\/my_thread_t-1\.txt$/);
      });

      // #175: two thread names that sanitize to the same slug must
      // land in the ZIP under distinct paths. Pre-fix this threw JSZip
      // "File already exists" mid-export and aborted the whole channel.
      it('produces distinct ZIP paths when thread names collide on sanitization (#175)', async () => {
        const exportDataMod = await import('discrub-core/export-data-service');
        vi.mocked(exportDataMod.prepareExportData).mockReturnValueOnce({
          mainPages: [{ messages: [], pageNumber: 1, filePath: '' }],
          threadExports: [
            {
              thread: { id: 'thread-1', name: 'GT3 RS' },
              pages: [{ messages: [], pageNumber: 1, filePath: '' }],
              threadNumber: 1,
              totalThreads: 2,
            },
            {
              thread: { id: 'thread-2', name: 'GT3 RS!' },
              pages: [{ messages: [], pageNumber: 1, filePath: '' }],
              threadNumber: 2,
              totalThreads: 2,
            },
          ],
          totalPages: 1,
        } as any);

        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'rate-my-ride-gta',
          'json',
          100,
          false,
          null,
          {},
          null,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        );

        const filenames = mockAddFile.mock.calls.map((c: any[]) => c[1] as string);
        const threadFiles = filenames.filter((p) => p.includes('/threads/'));
        // Both threads land under distinct paths.
        expect(threadFiles).toHaveLength(2);
        const unique = new Set(threadFiles);
        expect(unique.size).toBe(2);
        // Each path is the slug + id suffix.
        expect(threadFiles.some((p) => p.includes('gt3_rs_thread-1'))).toBe(true);
        expect(threadFiles.some((p) => p.includes('gt3_rs_thread-2'))).toBe(true);
      });

      it('Needle-style channel with many same-name threads keeps every thread file (#175)', async () => {
        // Simulate the user's scenario: Needle promotes every message
        // into its own thread, and many users post variations of the
        // same name ("GT3 RS", "gt3 rs", "GT3 RS!", "GT3 RS?", "GT3 RS!!").
        const exportDataMod = await import('discrub-core/export-data-service');
        const collidingNames = ['GT3 RS', 'gt3 rs', 'GT3 RS!', 'GT3 RS?', 'GT3 RS!!'];
        vi.mocked(exportDataMod.prepareExportData).mockReturnValueOnce({
          mainPages: [{ messages: [], pageNumber: 1, filePath: '' }],
          threadExports: collidingNames.map((name, i) => ({
            thread: { id: `t-${i + 1}`, name },
            pages: [{ messages: [], pageNumber: 1, filePath: '' }],
            threadNumber: i + 1,
            totalThreads: collidingNames.length,
          })),
          totalPages: 1,
        } as any);

        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'rate-my-ride-gta',
          'json',
          100,
          false,
          null,
          {},
          null,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        );

        const filenames = mockAddFile.mock.calls.map((c: any[]) => c[1] as string);
        const threadFiles = filenames.filter((p) => p.includes('/threads/'));
        expect(threadFiles).toHaveLength(collidingNames.length);
        // Every path is unique.
        expect(new Set(threadFiles).size).toBe(collidingNames.length);
      });

      it('does not emit a Discord shell wrapper for text format', async () => {
        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'test-channel',
          'text',
          100,
          false,
          null,
          {},
          null,
          undefined,
          undefined,
          { artistMode: false, sortOrder: 'descending', previewMedia: false, dateFormat: 'yyyy-MM-dd', timeFormat: 'HH:mm:ss', exportTemplate: 'discord' },
        );

        const filenames = mockAddFile.mock.calls.map((c: any[]) => c[1] as string);
        expect(filenames.some((p) => p.endsWith('shell.html'))).toBe(false);
      });

      // #222: an exported thread's page exists, so its shell sidebar entry must
      // be clickable — not the greyed-out `disabled` state (opacity 0.4,
      // pointer-events:none). Pre-fix the caller passed exportedChannelIds with
      // only the main channel, disabling every thread link.
      it('marks exported threads as clickable (not disabled) in the Discord shell (#222)', async () => {
        const exportDataMod = await import('discrub-core/export-data-service');
        vi.mocked(exportDataMod.prepareExportData).mockReturnValueOnce({
          mainPages: [{ messages: mockMessages, pageNumber: 1, filePath: '' }],
          threadExports: [
            {
              thread: { id: 't-1', name: 'My Thread' },
              pages: [{ messages: [], pageNumber: 1, filePath: '' }],
              threadNumber: 1,
              totalThreads: 1,
            },
          ],
          totalPages: 1,
        } as any);

        const { StreamingZipService } = await import('./streamingZipService');
        const mockAddFile = vi.fn().mockResolvedValue(undefined);
        (StreamingZipService as any).mockImplementation(() => ({
          addFile: mockAddFile,
          finalize: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        }));

        await service.exportToZip(
          mockMessages,
          'test-channel',
          'html',
          100,
          false,
          null,
          {},
          null,
          undefined,
          undefined,
          { artistMode: false, sortOrder: 'descending', previewMedia: false, dateFormat: 'yyyy-MM-dd', timeFormat: 'HH:mm:ss', exportTemplate: 'discord' },
        );

        const shellCall = mockAddFile.mock.calls.find((c: any[]) => String(c[1]).endsWith('shell.html'));
        expect(shellCall).toBeDefined();
        // jsdom's Blob lacks .text(); read via FileReader like the other export tests.
        const shellHtml: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsText(shellCall![0] as Blob);
        });

        // The thread is present in the sidebar...
        expect(shellHtml).toContain('data-channel-id="my_thread_t-1"');
        // ...and it is NOT disabled (its page was exported).
        expect(shellHtml).not.toContain('class="channel-item disabled" data-channel-id="my_thread_t-1"');
      });
    });
  });

  describe('generateCSV with ExportConfig', () => {
    it('should use configured date/time format when ExportConfig provided', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'Test',
        author: { id: 'u1', username: 'user1', discriminator: '0001' },
        attachments: [],
        embeds: [],
      } as unknown as Message];

      const result = generateCSV(messages, {}, null, {
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: true,
        dateFormat: 'yyyy-MM-dd',
        timeFormat: 'HH:mm',
      });

      // Should use formatMessageTimestamp with configured format
      expect(result).toContain('2026-06-15');
    });

    it('should fall back to default format when no ExportConfig provided', () => {
      const generateCSV = (service as any).generateCSV.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'Test',
        author: { id: 'u1', username: 'user1', discriminator: '0001' },
        attachments: [],
        embeds: [],
      } as unknown as Message];

      const result = generateCSV(messages, {}, null);

      // Should use default 'yyyy-MM-dd HH:mm:ss' format
      expect(result).toContain('2026-06-15');
    });
  });

  describe('generateHTMLPage with ExportConfig', () => {
    it('should use configured date/time format in timestamps', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'Hello world',
        author: { id: 'u1', username: 'testuser', discriminator: '0001' },
        attachments: [],
        embeds: [],
        reactions: [],
      } as unknown as Message];

      const html = generateHTML(messages, 'test-channel', 1, 1, null, 'test_channel', undefined, {
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: true,
        dateFormat: 'dd/MM/yyyy',
        timeFormat: 'HH:mm:ss',
      });

      expect(html).toContain('15/06/2026');
    });

    it('should add attachment-preview-img CSS class to attachment previews', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'Photo',
        author: { id: 'u1', username: 'testuser', discriminator: '0001' },
        attachments: [{ id: 'att-1', url: 'https://cdn.discordapp.com/test.png', filename: 'test.png', size: 1024 }],
        embeds: [],
        reactions: [],
      } as any];

      const html = generateHTML(messages, 'test-channel', 1, 1, null, 'test_channel', undefined, {
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: true,
        dateFormat: 'MM/dd/yyyy',
        timeFormat: 'h:mm aa',
      });

      expect(html).toContain('attachment-preview-img');
    });

    it('should not render image/video previews when previewMedia is false', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'Photo',
        author: { id: 'u1', username: 'testuser', discriminator: '0001' },
        attachments: [{ id: 'att-1', url: 'https://cdn.discordapp.com/test.png', filename: 'test.png', size: 1024 }],
        embeds: [],
        reactions: [],
      } as any];

      const html = generateHTML(messages, 'test-channel', 1, 1, null, 'test_channel', undefined, {
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: false,
        dateFormat: 'MM/dd/yyyy',
        timeFormat: 'h:mm aa',
      });

      // Should not contain img tag with attachment-preview class in message content
      expect(html).not.toContain('<img class="attachment-preview');
      expect(html).not.toContain('<video class="attachment-preview');
      // But should still have the download link
      expect(html).toContain('test.png');
    });

    it('should include attachment-preview-img CSS class in styles', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const html = generateHTML([], 'test-channel', 1, 1, null, 'test_channel');

      expect(html).toContain('.attachment-preview-img');
    });

    // #214: forwarded media must be downloaded AND its link rewritten to the
    // local copy, otherwise the export shows a dead CDN link offline.
    it('rewrites a forwarded snapshot attachment to its local media path', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'u1', username: 'testuser', discriminator: '0001' },
        attachments: [],
        embeds: [],
        reactions: [],
        message_snapshots: [
          {
            message: {
              content: '',
              attachments: [
                { id: 'snap-att-1', url: 'https://cdn.discordapp.com/snap.png', filename: 'snap.png', size: 1024 },
              ],
              embeds: [],
            },
          },
        ],
      } as any];

      const mediaMaps = {
        avatarMap: {},
        mediaMap: { 'https://cdn.discordapp.com/snap.png': 'media/attachments/0_local.png' },
        emojiMap: {},
        roleMap: {},
      };

      const html = generateHTML(messages, 'test-channel', 1, 1, mediaMaps, 'test_channel', undefined, {
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: true,
        dateFormat: 'MM/dd/yyyy',
        timeFormat: 'h:mm aa',
      });

      // The forwarded link points at the downloaded local copy, not the CDN.
      expect(html).toContain('href="media/attachments/0_local.png"');
      // And an image preview is emitted for the forwarded image.
      expect(html).toContain('src="media/attachments/0_local.png"');
    });

    // #214: a forwarded snapshot's EMBED image (not a direct attachment) must
    // also resolve to the downloaded local copy. The snapshot embeds run
    // through the shared renderEmbedAsHtml with mediaMap (exportService.ts:1149),
    // and mediaMap is keyed by image.url. Without the rewrite, offline exports
    // of forwarded embedded images show a dead CDN link.
    it('rewrites a forwarded snapshot embed image to its local media path', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const messages: Message[] = [{
        id: 'msg-1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'u1', username: 'testuser', discriminator: '0001' },
        attachments: [],
        embeds: [],
        reactions: [],
        message_snapshots: [
          {
            message: {
              content: '',
              attachments: [],
              embeds: [
                {
                  image: {
                    url: 'https://cdn.discordapp.com/snap-embed.png',
                    proxy_url: 'https://media.discordapp.net/snap-embed.png',
                  },
                },
              ],
            },
          },
        ],
      } as any];

      const mediaMaps = {
        avatarMap: {},
        mediaMap: { 'https://cdn.discordapp.com/snap-embed.png': 'media/embed-images/0_local.png' },
        emojiMap: {},
        roleMap: {},
      };

      const html = generateHTML(messages, 'test-channel', 1, 1, mediaMaps, 'test_channel', undefined, {
        artistMode: false,
        sortOrder: 'descending',
        previewMedia: true,
        dateFormat: 'MM/dd/yyyy',
        timeFormat: 'h:mm aa',
      });

      // The local path only exists in mediaMap, so its presence proves the
      // snapshot embed image was resolved against the local copy...
      expect(html).toContain('media/embed-images/0_local.png');
      // ...and it lives inside the forwarded-content block.
      expect(html).toContain('data-message-snapshot="true"');
    });
  });

  describe('system message rendering in HTML export', () => {
    const runRender = (msg: any, guildName?: string) => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const formattingContext: any = {
        userMap: {},
        channelMap: {},
        guildRoles: [],
        sanitizedName: 'test_channel',
        guildName,
      };
      return generateHTML(
        [msg],
        'test-channel',
        1,
        1,
        null,
        'test_channel',
        formattingContext,
      );
    };

    it('renders a CHANNEL_PINNED_MESSAGE (type 6) as a system-message row', () => {
      const msg = {
        id: 'sys-pin',
        type: 6,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'u1', username: 'alice', global_name: 'Alice' },
        attachments: [],
        embeds: [],
        reactions: [],
      };
      const html = runRender(msg);
      expect(html).toContain('class="system-message"');
      expect(html).toContain('data-system-kind="pin"');
      expect(html).toContain('pinned a message to this channel');
      // Normal-message container must NOT appear for a system message.
      expect(html).not.toContain('<div class="message"');
    });

    it('renders a USER_JOIN (type 7) using one of the 13 variants', () => {
      const msg = {
        id: 'sys-join',
        type: 7,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'u1', username: 'alice', global_name: 'Alice' },
        attachments: [],
        embeds: [],
        reactions: [],
      };
      const html = runRender(msg);
      expect(html).toContain('data-system-kind="join"');
      expect(html).toContain('Alice');
    });

    it('renders GUILD_BOOST_TIER_2 (type 10) with the guild name', () => {
      const msg = {
        id: 'sys-boost',
        type: 10,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'u1', username: 'alice', global_name: 'Alice' },
        attachments: [],
        embeds: [],
        reactions: [],
      };
      const html = runRender(msg, 'Aquarium');
      expect(html).toContain('data-system-kind="boost"');
      expect(html).toContain('Aquarium');
      expect(html).toContain('Level 2');
    });

    it('renders a THREAD_CREATED (type 18) with the thread name', () => {
      const msg = {
        id: 'sys-thread',
        type: 18,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'u1', username: 'alice', global_name: 'Alice' },
        attachments: [],
        embeds: [],
        reactions: [],
        thread: { name: 'Project planning' },
      };
      const html = runRender(msg);
      expect(html).toContain('data-system-kind="thread"');
      expect(html).toContain('Project planning');
    });

    it('renders an AUTO_MODERATION_ACTION (type 24) with its embed beneath the notice', () => {
      const msg = {
        id: 'sys-automod',
        type: 24,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: '',
        author: { id: 'automod', username: 'AutoMod' },
        attachments: [],
        embeds: [{ type: 'rich', title: 'Blocked message', description: 'spam' }],
        reactions: [],
      };
      const html = runRender(msg);
      expect(html).toContain('data-system-kind="autoMod"');
      expect(html).toContain('class="system-message-embed"');
      expect(html).toContain('Blocked message');
    });

    it('does NOT render a default (type 0) message as a system message', () => {
      const msg = {
        id: 'normal',
        type: 0,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'hello',
        author: { id: 'u1', username: 'alice', global_name: 'Alice' },
        attachments: [],
        embeds: [],
        reactions: [],
      };
      const html = runRender(msg);
      expect(html).not.toContain('class="system-message"');
      expect(html).toContain('hello');
    });

    it('does NOT render a reply (type 19) as a system message', () => {
      const msg = {
        id: 'reply',
        type: 19,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'hi',
        author: { id: 'u1', username: 'alice', global_name: 'Alice' },
        attachments: [],
        embeds: [],
        reactions: [],
      };
      const html = runRender(msg);
      expect(html).not.toContain('class="system-message"');
    });

    it('includes .system-message CSS in the generated stylesheet', () => {
      const generateHTML = (service as any).generateHTMLPage.bind(service);
      const html = generateHTML([], 'test-channel', 1, 1, null, 'test_channel');
      expect(html).toContain('.system-message');
      expect(html).toContain('.system-message-icon');
      expect(html).toContain('.system-message-text');
    });
  });

  describe('#185 Bug B: generateHTMLPageParts (stream-friendly emission)', () => {
    // Pages 1-300 of testaccounta_1's "znone" export emitted fine, then
    // crashed with `RangeError: Invalid string length`. The crash surfaced
    // as "Failed on znone — Invalid string length" at exportSlice.ts:386.
    // generateHTMLPageParts keeps per-message HTML rows as separate Blob
    // parts so `new Blob(parts)` never materializes one mega-string.
    const baseMessages: Message[] = [
      {
        id: 'm1',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'first',
        author: { id: 'u1', username: 'alice' },
        attachments: [], embeds: [], reactions: [],
      } as unknown as Message,
      {
        id: 'm2',
        timestamp: '2026-06-15T14:31:00.000Z',
        content: 'second',
        author: { id: 'u2', username: 'bob' },
        attachments: [], embeds: [], reactions: [],
      } as unknown as Message,
      {
        id: 'm3',
        timestamp: '2026-06-15T14:32:00.000Z',
        content: 'third',
        author: { id: 'u1', username: 'alice' },
        attachments: [], embeds: [], reactions: [],
      } as unknown as Message,
    ];

    it('caps the plain template at 1200px but lets the Discord shell fill the pane', () => {
      const plain = service.generateHTMLPage(baseMessages, 'general', 1, 1, null, 'general');
      expect(plain).toContain('max-width: 1200px;');
      expect(plain).not.toContain('.container {\n      max-width: none;');
      const shell = service.generateHTMLPage(
        baseMessages, 'general', 1, 1, null, 'general', undefined,
        { exportTemplate: 'discord' } as unknown as Parameters<typeof service.generateHTMLPage>[7],
      );
      expect(shell).toContain('.container {\n      max-width: none;');
      expect(shell).not.toContain('max-width: 1200px;');
    });

    it('returns parts whose join equals the original generateHTMLPage output', () => {
      const partsArr = service.generateHTMLPageParts(
        baseMessages, 'general', 1, 1, null, 'general',
      );
      const joined = partsArr.join('');
      const wrapperOutput = service.generateHTMLPage(
        baseMessages, 'general', 1, 1, null, 'general',
      );
      expect(joined).toBe(wrapperOutput);
    });

    it('emits one part for the head, one per message row, and one for the foot', () => {
      const parts = service.generateHTMLPageParts(
        baseMessages, 'general', 1, 1, null, 'general',
      );
      // Head + 3 rows + foot = 5 parts. Head must include <!DOCTYPE,
      // foot must include the closing </html> and the export-data script.
      expect(parts).toHaveLength(2 + baseMessages.length);
      expect(parts[0]).toContain('<!DOCTYPE html>');
      expect(parts[0]).toContain('<main class="container"');
      const foot = parts[parts.length - 1];
      expect(foot).toContain('</main>');
      expect(foot).toContain('export-data');
      expect(foot).toContain('</html>');
    });

    it('no part exceeds the size of the joined output (cap-per-part guarantee)', () => {
      const parts = service.generateHTMLPageParts(
        baseMessages, 'general', 1, 1, null, 'general',
      );
      const joinedLen = parts.join('').length;
      for (const p of parts) {
        expect(p.length).toBeLessThan(joinedLen);
      }
    });

    it('scales linearly: 500 messages produce 502 parts (head + N rows + foot) and a valid Blob composes them', () => {
      // The whole point of Bug B is that no single string ever exceeds V8's
      // ~512MB cap. Verifying the scaling property here protects the parts
      // strategy from a future refactor that quietly re-concatenates rows.
      const many: Message[] = Array.from({ length: 500 }, (_, i) => ({
        id: `m${i}`,
        timestamp: '2026-06-15T14:30:00.000Z',
        content: `msg-${i}`,
        author: { id: 'u1', username: 'alice' },
        attachments: [], embeds: [], reactions: [],
      } as unknown as Message));

      const parts = service.generateHTMLPageParts(many, 'general', 1, 1, null, 'general');
      expect(parts.length).toBe(many.length + 2);

      // Each row part is bounded — none approaches the joined total.
      const joinedLen = parts.join('').length;
      for (const p of parts) {
        expect(p.length).toBeLessThan(joinedLen / 2);
      }

      // Composing into a Blob matches what exportService does at runtime; the
      // resulting blob must contain the same bytes as the joined output.
      const blob = new Blob(parts, { type: 'text/html' });
      const joinedBytes = new TextEncoder().encode(parts.join('')).length;
      expect(blob.size).toBe(joinedBytes);
    });

    it('applies mediaPathPrefix to each part independently for thread files', () => {
      // Build a message with an avatar reference so the regex has something
      // to match. The avatarMap entry routes through the local path.
      const withAvatar: Message[] = [{
        id: 'm-thread',
        timestamp: '2026-06-15T14:30:00.000Z',
        content: 'thread reply',
        author: { id: 'u-thread', username: 'carol', avatar: 'avatarhash' },
        attachments: [], embeds: [], reactions: [],
      } as unknown as Message];

      const mediaMaps = {
        avatarMap: { 'u-thread/avatarhash': 'general/avatars/u-thread.png' },
        mediaMap: {},
        emojiMap: {},
        roleMap: {},
      } as any;

      const parts = service.generateHTMLPageParts(
        withAvatar, 'general', 1, 1, mediaMaps, 'general',
        undefined, undefined, '../',
      );
      const joined = parts.join('');
      // mediaPathPrefix='../' means every src="avatars/..." gets prefixed.
      expect(joined).toContain('src="../avatars/');
      expect(joined).not.toContain('src="avatars/');
    });
  });

  describe('#184 generatePlainTextReadme', () => {
    it('emits a single-channel README that names the first page file', () => {
      const txt = generatePlainTextReadme({ isBulk: false, channelName: 'general' });
      expect(txt).toContain('Discrub Export');
      expect(txt).toContain('Format: PLAIN TEXT');
      expect(txt).toContain('Open general-page-1.txt in a text editor.');
      // No HTML, no bulk wording.
      expect(txt).not.toContain('<');
      expect(txt).not.toContain('Each channel has its own folder');
    });

    it('emits a bulk README that references per-channel folders', () => {
      const txt = generatePlainTextReadme({ isBulk: true });
      expect(txt).toContain('Format: PLAIN TEXT');
      expect(txt).toContain('Each channel has its own folder');
      // Bulk README does not name a single page file.
      expect(txt).not.toMatch(/page-1\.txt/);
    });

    it('falls back to a generic open-the-files line when channelName is missing in single mode', () => {
      const txt = generatePlainTextReadme({ isBulk: false });
      expect(txt).toContain('Open the .txt file(s) in a text editor.');
      expect(txt).not.toContain('Open undefined-page-1.txt');
    });

    it('keeps the readme plain ASCII and ends without a trailing blank line beyond one', () => {
      const txt = generatePlainTextReadme({ isBulk: false, channelName: 'general' });
      // No CRLF, no Windows-only artifacts.
      expect(txt).not.toContain('\r');
      // Sections are separated by single blank lines.
      expect(txt).toMatch(/Getting Started\n-+\n/);
      expect(txt).toMatch(/File Structure\n-+\n/);
    });
  });

  describe('exportToZip with ExportConfig sort order', () => {
    it('should sort messages before export based on sortOrder', async () => {
      // Reset StreamingZipService mock to avoid leakage from prior tests
      const { StreamingZipService } = await import('./streamingZipService');
      (StreamingZipService as any).mockImplementation(() => ({
        addFile: vi.fn().mockResolvedValue(undefined),
        finalize: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
      }));

      const { prepareExportData } = await import('discrub-core/export-data-service');
      vi.mocked(prepareExportData).mockReturnValue({
        mainPages: [{ messages: [], pageNumber: 1, filePath: '' }],
        threadExports: [],
        totalPages: 1,
      } as any);

      const messages: Message[] = [
        { id: '1', timestamp: '2026-06-15T14:00:00.000Z', content: 'First' } as any,
        { id: '2', timestamp: '2026-06-15T12:00:00.000Z', content: 'Second' } as any,
        { id: '3', timestamp: '2026-06-15T16:00:00.000Z', content: 'Third' } as any,
      ];

      await service.exportToZip(
        messages, 'test', 'json', 100, false, null, {}, null,
        undefined, undefined,
        { artistMode: false, sortOrder: 'ascending', previewMedia: true, dateFormat: 'MM/dd/yyyy', timeFormat: 'h:mm aa' }
      );

      // Verify prepareExportData received sorted messages
      const callArgs = vi.mocked(prepareExportData).mock.calls[0][0];
      const sortedMessages = callArgs.messages;
      expect(new Date(sortedMessages[0].timestamp!).getTime()).toBeLessThan(
        new Date(sortedMessages[1].timestamp!).getTime()
      );
      expect(new Date(sortedMessages[1].timestamp!).getTime()).toBeLessThan(
        new Date(sortedMessages[2].timestamp!).getTime()
      );
    });
  });

  describe('exportMediaOnly', () => {
    it('should call MediaDownloadService.downloadMediaOnly', async () => {
      const { MediaDownloadService } = await import('./mediaDownloadService');
      const mockDownloadMediaOnly = vi.fn().mockResolvedValue(undefined);
      (MediaDownloadService as any).mockImplementation(() => ({
        downloadMediaOnly: mockDownloadMediaOnly,
      }));

      await service.exportMediaOnly(mockMessages, 'test-channel');

      expect(mockDownloadMediaOnly).toHaveBeenCalled();
    });

    it('should pass artistMode to mediaDownloadService', async () => {
      const { MediaDownloadService } = await import('./mediaDownloadService');
      const mockDownloadMediaOnly = vi.fn().mockResolvedValue(undefined);
      (MediaDownloadService as any).mockImplementation(() => ({
        downloadMediaOnly: mockDownloadMediaOnly,
      }));

      await service.exportMediaOnly(mockMessages, 'test-channel', undefined, undefined, {
        artistMode: true,
        sortOrder: 'descending',
        previewMedia: true,
        dateFormat: 'MM/dd/yyyy',
        timeFormat: 'h:mm aa',
      });

      // artistMode should be passed to downloadMediaOnly
      expect(mockDownloadMediaOnly).toHaveBeenCalledWith(
        mockMessages,
        expect.any(String),
        expect.anything(),
        expect.any(Function),
        undefined,
        true,
        undefined
      );
    });
  });

  describe('prepareExportData', () => {
    it('should expose prepareExportData from discrub-core', () => {
      expect(service.prepareExportData).toBeDefined();
      expect(typeof service.prepareExportData).toBe('function');
    });
  });
});
