import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaDownloadService } from './mediaDownloadService';
import { createMockMessage } from '@/test/fixtures';
import type { Message, Guild } from 'discrub-core/types/discord-types';
import type { StreamingZipService } from './streamingZipService';

// Mock dependencies
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(),
}));

vi.mock('filenamify', () => ({
  default: vi.fn((str: string) => str.replace(/[^a-zA-Z0-9._-]/g, '_')),
}));

vi.mock('@/extension/messaging', () => ({
  isExtensionMode: vi.fn(() => false),
}));

describe('mediaDownloadService', () => {
  let service: MediaDownloadService;
  let mockZipService: StreamingZipService;
  let mockDiscordService: any;
  let mockOnProgress: ReturnType<typeof vi.fn>;
  let mockWarn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // #232 transport seam: forward to the downloadFile stub lazily so the
    // orchestration tests keep their existing per-test stubs verbatim.
    // #234 warn seam: forward lazily for the same reason.
    service = new MediaDownloadService(
      (url: string) => mockDiscordService.downloadFile(url),
      (message: string) => mockWarn(message),
    );
    vi.clearAllMocks();
    mockWarn = vi.fn();

    // Mock zip service — addFile echoes the stored path like the real one (#224)
    mockZipService = {
      addFile: vi.fn().mockImplementation(async (_blob: Blob, filePath: string) => filePath),
    } as any;

    // Mock Discord service
    mockDiscordService = {
      downloadFile: vi.fn(),
    };

    const { getDiscordService } = await import('@services/discordService');
    vi.mocked(getDiscordService).mockReturnValue(mockDiscordService);

    // Mock progress callback
    mockOnProgress = vi.fn();
  });

  describe('downloadAllMedia', () => {
    it('should download all media types in sequence', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
          attachments: [{ id: 'att-1', url: 'https://cdn.discordapp.com/file.png', filename: 'file.png' }],
          content: 'Test <:emoji:123456>',
        } as any,
      ];

      const guild: Guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: [{ id: 'role-1', name: 'Admin', icon: 'icon123' }],
      } as any;

      // Mock successful downloads
      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: mockBlob,
      });

      const maps = await service.downloadAllMedia(
        messages,
        guild,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      // Verify all download types were called
      expect(mockOnProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'avatars' })
      );
      expect(mockOnProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'attachments' })
      );
      expect(mockOnProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'emojis' })
      );
      expect(mockOnProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'roles' })
      );

      // Verify maps were populated
      expect(maps.avatarMap).toBeDefined();
      expect(maps.mediaMap).toBeDefined();
      expect(maps.emojiMap).toBeDefined();
      expect(maps.roleMap).toBeDefined();
    });

    it('should skip role icons for DM exports (null guild)', async () => {
      const messages: Message[] = [createMockMessage()];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-dm',
        mockZipService,
        mockOnProgress
      );

      // Should not have role progress
      const roleCalls = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'roles'
      );
      expect(roleCalls.length).toBe(0);
    });

    it('should handle empty messages array', async () => {
      const maps = await service.downloadAllMedia(
        [],
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(maps.avatarMap).toEqual({});
      expect(maps.mediaMap).toEqual({});
      expect(maps.emojiMap).toEqual({});
    });
  });

  describe('downloadAvatars', () => {
    it('should download unique user avatars', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
        } as any,
        {
          ...createMockMessage(),
          author: {
            id: 'user-2',
            username: 'user2',
            discriminator: '0002',
            avatar: 'avatar456',
            global_name: null,
          },
        } as any,
      ];

      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: mockBlob,
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(Object.keys(maps.avatarMap)).toHaveLength(2);
      expect(maps.avatarMap['user-1/avatar123']).toContain('avatars/user-1/avatar123');
      expect(maps.avatarMap['user-2/avatar456']).toContain('avatars/user-2/avatar456');
    });

    it('should deduplicate same user avatar across messages', async () => {
      const author = {
        id: 'user-1',
        username: 'user1',
        discriminator: '0001',
        avatar: 'avatar123',
        global_name: null,
      };

      const messages: Message[] = [
        { ...createMockMessage(), author } as any,
        { ...createMockMessage(), author } as any,
        { ...createMockMessage(), author } as any,
      ];

      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: mockBlob,
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      // Should only download once
      const downloadCalls = mockDiscordService.downloadFile.mock.calls.filter((call: any[]) =>
        call[0].includes('avatars')
      );
      expect(downloadCalls).toHaveLength(1);
    });

    it('should handle avatar download failure gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
        } as any,
      ];

      mockDiscordService.downloadFile.mockRejectedValue(new Error('Network error'));

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download avatar')
      );

      const maps = service.getMaps();
      expect(maps.avatarMap['user-1/avatar123']).toBeUndefined();

      consoleWarnSpy.mockRestore();
    });

    it('should skip users without avatars', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: null,
            global_name: null,
          },
        } as any,
      ];

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).not.toHaveBeenCalled();
    });

    it('should report progress correctly', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: { id: 'user-1', username: 'user1', discriminator: '0001', avatar: 'avatar1', global_name: null },
        } as any,
        {
          ...createMockMessage(),
          author: { id: 'user-2', username: 'user2', discriminator: '0002', avatar: 'avatar2', global_name: null },
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const avatarProgressCalls = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'avatars'
      );

      expect(avatarProgressCalls[0][0]).toMatchObject({
        stage: 'avatars',
        current: 1,
        total: 2,
        message: 'Downloading avatar 1/2',
      });

      expect(avatarProgressCalls[1][0]).toMatchObject({
        stage: 'avatars',
        current: 2,
        total: 2,
        message: 'Downloading avatar 2/2',
      });
    });

    it('should skip the file when the transport reports failure (#232 stall abort)', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
        } as any,
      ];

      // The stall guard resolves { success: false } after aborting a dead
      // download — timeout mechanics live in the transport's own spec.
      mockDiscordService.downloadFile.mockResolvedValue({ success: false, data: null });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(maps.avatarMap['user-1/avatar123']).toBeUndefined();
    });

    it('should download reaction-user avatars when reactionMap is provided', async () => {
      // Message author has avatar
      const messages: Message[] = [
        {
          ...createMockMessage(),
          id: 'msg-1',
          author: { id: 'author-1', username: 'author', discriminator: '0', avatar: 'author_hash', global_name: null },
        } as any,
      ];

      // Reaction user with avatar (different user than author)
      const reactionMap = {
        'msg-1': {
          '👍': [{ id: 'reactor-1', burst: false, avatar: 'reactor_hash' }],
        },
      };

      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: mockBlob });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        undefined, undefined, undefined, reactionMap,
      );

      const maps = service.getMaps();
      // Both author and reactor avatars should be downloaded
      expect(Object.keys(maps.avatarMap)).toHaveLength(2);
      expect(maps.avatarMap['author-1/author_hash']).toBeDefined();
      expect(maps.avatarMap['reactor-1/reactor_hash']).toBeDefined();
      // 2 CDN fetches for avatars (no rate-limited API calls)
      const avatarCalls = mockDiscordService.downloadFile.mock.calls.filter(
        (call: any[]) => call[0].includes('avatars')
      );
      expect(avatarCalls).toHaveLength(2);
    });

    it('should deduplicate reactor avatars with message author avatars', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          id: 'msg-1',
          author: { id: 'user-1', username: 'user1', discriminator: '0', avatar: 'shared_hash', global_name: null },
        } as any,
      ];

      // Same user reacted — avatar already covered by message author
      const reactionMap = {
        'msg-1': {
          '👍': [{ id: 'user-1', burst: false, avatar: 'shared_hash' }],
        },
      };

      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: mockBlob });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        undefined, undefined, undefined, reactionMap,
      );

      // Only 1 download — deduplicated via Set
      const avatarCalls = mockDiscordService.downloadFile.mock.calls.filter(
        (call: any[]) => call[0].includes('avatars')
      );
      expect(avatarCalls).toHaveLength(1);
      expect(Object.keys(service.getMaps().avatarMap)).toHaveLength(1);
    });

    it('should skip reaction users without avatars', async () => {
      const messages: Message[] = [
        { ...createMockMessage(), id: 'msg-1' } as any,
      ];

      const reactionMap = {
        'msg-1': {
          '👍': [
            { id: 'reactor-no-avatar', burst: false },  // no avatar field
            { id: 'reactor-null-avatar', burst: false, avatar: null },
          ],
        },
      };

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        undefined, undefined, undefined, reactionMap,
      );

      // No avatar downloads (message author has no avatar, reactors have no avatar)
      expect(mockDiscordService.downloadFile).not.toHaveBeenCalled();
    });

    it('should include reaction-user avatars in progress count', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          id: 'msg-1',
          author: { id: 'author-1', username: 'a', discriminator: '0', avatar: 'hash_a', global_name: null },
        } as any,
      ];

      const reactionMap = {
        'msg-1': {
          '👍': [{ id: 'reactor-1', burst: false, avatar: 'hash_r' }],
        },
      };

      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: mockBlob });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        undefined, undefined, undefined, reactionMap,
      );

      const avatarProgress = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'avatars'
      );
      // Total should be 2 (1 author + 1 reactor)
      expect(avatarProgress).toHaveLength(2);
      expect(avatarProgress[0][0].total).toBe(2);
      expect(avatarProgress[1][0].total).toBe(2);
    });
  });

  describe('downloadAttachments', () => {
    it('should download message attachments using proxy_url when available', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file1.png', proxy_url: 'https://media.discordapp.net/file1.png', filename: 'file1.png' },
            { id: 'att-2', url: 'https://cdn.discordapp.com/file2.jpg', proxy_url: 'https://media.discordapp.net/file2.jpg', filename: 'file2.jpg' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledTimes(2);
      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://media.discordapp.net/file1.png'
      );
      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://media.discordapp.net/file2.jpg'
      );
    });

    it('gives same-message attachments unique zip paths even in the same millisecond (#224)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
      try {
        const messages: Message[] = [
          {
            ...createMockMessage(),
            attachments: [
              { id: 'att-1', url: 'https://cdn.discordapp.com/a.png', filename: 'a.png' },
              { id: 'att-2', url: 'https://cdn.discordapp.com/b.png', filename: 'b.png' },
            ],
          } as any,
        ];

        mockDiscordService.downloadFile.mockResolvedValue({
          success: true,
          data: new Blob(['data'], { type: 'image/png' }),
        });

        await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

        const attachmentPaths = (mockZipService.addFile as any).mock.calls
          .map((c: any[]) => c[1])
          .filter((p: string) => p.includes('/media/'));
        expect(attachmentPaths).toHaveLength(2);
        expect(new Set(attachmentPaths).size).toBe(2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('records the path the zip actually stored when a colliding entry was renamed (#224)', async () => {
      (mockZipService.addFile as any).mockImplementation(async (_blob: Blob, filePath: string) =>
        filePath.includes('/media/') ? filePath.replace(/(\.[^./]+)$/, '-2$1') : filePath
      );

      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/a.png', filename: 'a.png' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const { mediaMap } = service.getMaps();
      const recorded = Object.values(mediaMap);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatch(/^media\/attachments\/.*-2\.png$/);
    });

    it('should fall back to url when proxy_url is not available', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file.png', filename: 'file.png' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/file.png'
      );
    });

    it('should use url directly in extension mode', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);

      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file.png', proxy_url: 'https://media.discordapp.net/file.png', filename: 'file.png' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/file.png'
      );

      vi.mocked(isExtensionMode).mockReturnValue(false);
    });

    it('should download embed images', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              image: { url: 'https://cdn.discordapp.com/embed-image.png' },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      const embedImageUrl = 'https://cdn.discordapp.com/embed-image.png';
      expect(maps.mediaMap[embedImageUrl]).toContain('embed-images');
    });

    it('should download embed videos', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              video: { url: 'https://cdn.discordapp.com/embed-video.mp4' },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'video/mp4' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      const embedVideoUrl = 'https://cdn.discordapp.com/embed-video.mp4';
      expect(maps.mediaMap[embedVideoUrl]).toContain('embed-videos');
    });

    it('falls back to the direct URL when the proxy URL download fails (Tenor mp4 case)', async () => {
      const directUrl = 'https://media.tenor.com/abc/video.mp4';
      const proxyUrl = 'https://images-ext-1.discordapp.net/external/xyz/video.mp4';
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              video: { url: directUrl, proxy_url: proxyUrl },
            },
          ],
        } as any,
      ];

      // First call (proxy URL) returns nothing — mimics Discord's media proxy
      // failing for external video CDNs. Second call (direct URL) succeeds.
      mockDiscordService.downloadFile.mockImplementation((requestedUrl: string) => {
        if (requestedUrl === proxyUrl) {
          return Promise.resolve({ success: false, data: null });
        }
        return Promise.resolve({
          success: true,
          data: new Blob(['data'], { type: 'video/mp4' }),
        });
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(maps.mediaMap[directUrl]).toContain('embed-videos');
      // Both the proxy and direct URLs were attempted in order
      const calls = (mockDiscordService.downloadFile as any).mock.calls;
      expect(calls.some(([u]: [string]) => u === proxyUrl)).toBe(true);
      expect(calls.some(([u]: [string]) => u === directUrl)).toBe(true);
    });

    it('does not retry the direct URL when it equals the proxy URL', async () => {
      const url = 'https://cdn.discordapp.com/only-url.png';
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              image: { url },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: false,
        data: null,
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      // downloadFile is called exactly once because downloadUrl === url
      // (no proxy_url in the embed, so no second-attempt URL to fall back to)
      const calls = (mockDiscordService.downloadFile as any).mock.calls.filter(
        ([u]: [string]) => u === url,
      );
      expect(calls).toHaveLength(1);
    });

    it('falls back to the direct URL when the proxy 415s a webp in web mode (#234)', async () => {
      const directUrl = 'https://cdn.discordapp.com/attachments/1/2/image.webp';
      const proxyUrl = 'https://media.discordapp.net/attachments/1/2/image.webp';
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: directUrl, proxy_url: proxyUrl, filename: 'image.webp' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockImplementation((requestedUrl: string) => {
        if (requestedUrl === proxyUrl) {
          return Promise.resolve({ success: false, data: null, status: 415 });
        }
        return Promise.resolve({
          success: true,
          data: new Blob(['data'], { type: 'image/webp' }),
        });
      });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const maps = service.getMaps();
      expect(maps.mediaMap[directUrl]).toContain('attachments');
      const calls = (mockDiscordService.downloadFile as any).mock.calls.map(([u]: [string]) => u);
      expect(calls).toEqual([proxyUrl, directUrl]);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('falls back to the proxy URL in extension mode when the direct URL fails (#234)', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);

      const directUrl = 'https://some-external-cdn.com/image.png';
      const proxyUrl = 'https://images-ext-1.discordapp.net/external/xyz/image.png';
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              image: { url: directUrl, proxy_url: proxyUrl },
            },
          ],
        } as any,
      ];

      // Direct leg fails (third-party CDN unreachable); the Discord-proxy
      // copy IS fetchable under the extension's discordapp.net permissions.
      mockDiscordService.downloadFile.mockImplementation((requestedUrl: string) => {
        if (requestedUrl === directUrl) {
          return Promise.resolve({ success: false, data: null });
        }
        return Promise.resolve({
          success: true,
          data: new Blob(['data'], { type: 'image/png' }),
        });
      });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const maps = service.getMaps();
      expect(maps.mediaMap[directUrl]).toContain('embed-images');
      const calls = (mockDiscordService.downloadFile as any).mock.calls.map(([u]: [string]) => u);
      expect(calls).toEqual([directUrl, proxyUrl]);

      vi.mocked(isExtensionMode).mockReturnValue(false);
    });

    it('emits a status-log WARN with per-leg detail when all legs fail (#234)', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const directUrl = 'https://cdn.discordapp.com/attachments/1/2/image.webp';
      const proxyUrl = 'https://media.discordapp.net/attachments/1/2/image.webp';
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: directUrl, proxy_url: proxyUrl, filename: 'image.webp' },
          ],
        } as any,
      ];

      // Proxy leg 415s; direct leg throws (CORS-dead in web mode).
      mockDiscordService.downloadFile.mockImplementation((requestedUrl: string) => {
        if (requestedUrl === proxyUrl) {
          return Promise.resolve({ success: false, data: null, status: 415 });
        }
        return Promise.reject(new Error('CORS'));
      });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      expect(mockWarn).toHaveBeenCalledTimes(1);
      const warned = mockWarn.mock.calls[0][0];
      expect(warned).toContain('image.webp');
      expect(warned).toContain('proxy 415');
      expect(warned).toContain('direct CORS/network');
      expect(service.getMaps().mediaMap[directUrl]).toBeUndefined();

      consoleWarnSpy.mockRestore();
    });

    it('should download embed thumbnails', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              thumbnail: { url: 'https://cdn.discordapp.com/thumb.png' },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      const thumbUrl = 'https://cdn.discordapp.com/thumb.png';
      expect(maps.mediaMap[thumbUrl]).toContain('embed-thumbnails');
    });

    it('skips the thumbnail for a gifv embed whose video is downloaded (#219 residue)', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              type: 'gifv',
              video: { url: 'https://media.tenor.com/clip.mp4' },
              thumbnail: { url: 'https://media.tenor.com/clip-thumb.gif' },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'video/mp4' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      // The video downloaded; the never-referenced thumbnail .gif did not.
      expect(maps.mediaMap['https://media.tenor.com/clip.mp4']).toBeDefined();
      expect(maps.mediaMap['https://media.tenor.com/clip-thumb.gif']).toBeUndefined();
      const thumbCalls = mockDiscordService.downloadFile.mock.calls.filter(
        ([u]: [string]) => u.includes('clip-thumb'),
      );
      expect(thumbCalls).toHaveLength(0);
    });

    it('still downloads the thumbnail for a gifv embed with no video URL', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          embeds: [
            {
              type: 'gifv',
              thumbnail: { url: 'https://media.tenor.com/clip-thumb.gif' },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/gif' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(maps.mediaMap['https://media.tenor.com/clip-thumb.gif']).toBeDefined();
    });

    it('should handle attachment download failure', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [{ id: 'att-1', url: 'https://cdn.discordapp.com/file.png', filename: 'file.png' }],
        } as any,
      ];

      mockDiscordService.downloadFile.mockRejectedValue(new Error('Network error'));

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download attachment'),
        expect.objectContaining({
          original: 'https://cdn.discordapp.com/file.png',
        }),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should report progress for attachments', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file1.png', filename: 'file1.png' },
            { id: 'att-2', url: 'https://cdn.discordapp.com/file2.png', filename: 'file2.png' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const attachmentProgressCalls = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'attachments'
      );

      expect(attachmentProgressCalls[0][0]).toMatchObject({
        stage: 'attachments',
        current: 1,
        total: 2,
      });
    });

    // #214: forwarded messages carry their real media inside
    // message_snapshots[].message — those attachments/embeds must be
    // downloaded and URL-mapped exactly like top-level media.
    it('downloads attachments from a forwarded message snapshot', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          content: '',
          attachments: [],
          embeds: [],
          message_snapshots: [
            {
              message: {
                content: '',
                attachments: [
                  {
                    id: 'snap-att-1',
                    url: 'https://cdn.discordapp.com/snap-file.png',
                    proxy_url: 'https://media.discordapp.net/snap-file.png',
                    filename: 'snap-file.png',
                  },
                ],
                embeds: [],
              },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      const maps = await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://media.discordapp.net/snap-file.png'
      );
      // The original CDN URL becomes a key in the media map so the HTML
      // emitter can rewrite the forwarded link to the local copy.
      expect(maps.mediaMap['https://cdn.discordapp.com/snap-file.png']).toBeDefined();
    });

    it('downloads embed images from a forwarded message snapshot', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          content: '',
          attachments: [],
          embeds: [],
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
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      const maps = await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://media.discordapp.net/snap-embed.png'
      );
      expect(maps.mediaMap['https://cdn.discordapp.com/snap-embed.png']).toBeDefined();
    });
  });

  describe('downloadEmojis', () => {
    it('should extract and download custom emojis from content', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          content: 'Hello <:emoji1:123456> world <:emoji2:789012>',
        },
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/webp' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(maps.emojiMap['123456']).toContain('emojis/123456');
      expect(maps.emojiMap['789012']).toContain('emojis/789012');
    });

    it('should extract animated emojis', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          content: 'Animated <a:emoji:123456>',
        },
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/webp' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://media.discordapp.net/emojis/123456.webp?animated=true'
      );
    });

    it('should extract emojis from reactions', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          reactions: [
            { emoji: { id: '123456', name: 'emoji1' }, count: 5 },
            { emoji: { id: '789012', name: 'emoji2' }, count: 3 },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/webp' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(maps.emojiMap['123456']).toBeDefined();
      expect(maps.emojiMap['789012']).toBeDefined();
    });

    it('should deduplicate emojis across messages', async () => {
      const messages: Message[] = [
        { ...createMockMessage(), content: 'Test <:emoji:123456>' },
        { ...createMockMessage(), content: 'Another <:emoji:123456>' },
        { ...createMockMessage(), content: 'More <:emoji:123456>' },
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/webp' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const downloadCalls = mockDiscordService.downloadFile.mock.calls.filter((call: any[]) =>
        call[0].includes('emojis')
      );
      expect(downloadCalls).toHaveLength(1);
    });

    it('should handle emoji download failure', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const messages: Message[] = [
        {
          ...createMockMessage(),
          content: 'Test <:emoji:123456>',
        },
      ];

      mockDiscordService.downloadFile.mockRejectedValue(new Error('Network error'));

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download emoji')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle messages without emojis', async () => {
      const messages: Message[] = [
        { ...createMockMessage(), content: 'No emojis here' },
      ];

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const emojiProgressCalls = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'emojis'
      );
      // Should report empty progress (0/0) when no emojis found
      expect(emojiProgressCalls).toHaveLength(1);
      expect(emojiProgressCalls[0][0]).toMatchObject({
        stage: 'emojis',
        current: 0,
        total: 0,
      });
    });
  });

  describe('downloadRoleIcons', () => {
    it('should download role icons for guild exports', async () => {
      const guild: Guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: [
          { id: 'role-1', name: 'Admin', icon: 'icon123' },
          { id: 'role-2', name: 'Mod', icon: 'icon456' },
        ],
      } as any;

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        [],
        guild,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/role-icons/role-1/icon123.webp?size=20'
      );
      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/role-icons/role-2/icon456.webp?size=20'
      );
    });

    it('should skip roles without icons', async () => {
      const guild: Guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: [
          { id: 'role-1', name: 'Everyone' }, // No icon
          { id: 'role-2', name: 'Admin', icon: 'icon123' },
        ],
      } as any;

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        [],
        guild,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledTimes(1);
    });

    it('should handle role icon download failure', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const guild: Guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: [{ id: 'role-1', name: 'Admin', icon: 'icon123' }],
      } as any;

      mockDiscordService.downloadFile.mockRejectedValue(new Error('Network error'));

      await service.downloadAllMedia(
        [],
        guild,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download role icon')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('mediaConfig filtering', () => {
    const embedMessage = () => [
      {
        ...createMockMessage(),
        embeds: [
          {
            image: { url: 'https://cdn.discordapp.com/e-image.png' },
            video: { url: 'https://cdn.discordapp.com/e-video.mp4' },
            thumbnail: { url: 'https://cdn.discordapp.com/e-thumb.png' },
          },
        ],
      } as any,
    ] as Message[];
    const embedCalls = () =>
      mockDiscordService.downloadFile.mock.calls.map((c: any[]) => c[0]).filter((u: string) => u.includes('/e-'));

    it('leaves embed images and thumbnails out when Images is unticked', async () => {
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: new Blob(['data'], { type: 'video/mp4' }) });
      await service.downloadAllMedia(
        embedMessage(), null, 'test-channel', mockZipService, mockOnProgress,
        { images: false, videos: true, audio: true, other: true }
      );
      expect(embedCalls()).toEqual(['https://cdn.discordapp.com/e-video.mp4']);
    });

    it('leaves embed videos out when Videos is unticked', async () => {
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: new Blob(['data'], { type: 'image/png' }) });
      await service.downloadAllMedia(
        embedMessage(), null, 'test-channel', mockZipService, mockOnProgress,
        { images: true, videos: false, audio: true, other: true }
      );
      expect(embedCalls()).toEqual(['https://cdn.discordapp.com/e-image.png', 'https://cdn.discordapp.com/e-thumb.png']);
    });

    it('downloads no embed file from a forwarded message when Images and Videos are unticked', async () => {
      const [message] = embedMessage();
      const forwarded = [{ ...createMockMessage(), message_snapshots: [{ message: { embeds: message.embeds } }] } as any] as Message[];
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: new Blob(['data'], { type: 'image/png' }) });
      await service.downloadAllMedia(
        forwarded, null, 'test-channel', mockZipService, mockOnProgress,
        { images: false, videos: false, audio: true, other: true }
      );
      expect(embedCalls()).toEqual([]);
    });

    it('should skip image attachments when mediaConfig.images is false', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file.png', filename: 'file.png' },
            { id: 'att-2', url: 'https://cdn.discordapp.com/file.mp4', filename: 'file.mp4' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'video/mp4' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: false, videos: true, audio: true, other: true }
      );

      // Only video should be downloaded (not the png)
      const attachmentCalls = mockDiscordService.downloadFile.mock.calls.filter((c: any[]) =>
        c[0].includes('file')
      );
      expect(attachmentCalls).toHaveLength(1);
      expect(attachmentCalls[0][0]).toContain('file.mp4');
    });

    it('should skip video attachments when mediaConfig.videos is false', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file.mp4', filename: 'file.mp4' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'video/mp4' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: true, videos: false, audio: true, other: true }
      );

      const attachmentProgressCalls = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'attachments'
      );
      expect(attachmentProgressCalls[0][0].total).toBe(0);
    });

    it('should download everything when all types enabled', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file.png', filename: 'file.png' },
            { id: 'att-2', url: 'https://cdn.discordapp.com/file.mp4', filename: 'file.mp4' },
            { id: 'att-3', url: 'https://cdn.discordapp.com/file.mp3', filename: 'file.mp3' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: true, videos: true, audio: true, other: true }
      );

      const attachmentProgressCalls = mockOnProgress.mock.calls.filter(
        (call) => call[0].stage === 'attachments'
      );
      expect(attachmentProgressCalls[attachmentProgressCalls.length - 1][0].total).toBe(3);
    });
  });

  describe('artist mode', () => {
    it('should organize media by author username when artistMode is true', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: { id: 'u1', username: 'alice', discriminator: '0001', avatar: null, global_name: null },
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file1.png', filename: 'file1.png' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        undefined, true
      );

      const maps = service.getMaps();
      const mediaPath = maps.mediaMap['https://cdn.discordapp.com/file1.png'];
      expect(mediaPath).toContain('media/alice/');
    });

    it('should organize by type folder when artistMode is false', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: { id: 'u1', username: 'alice', discriminator: '0001', avatar: null, global_name: null },
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file1.png', filename: 'file1.png' },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        undefined, false
      );

      const maps = service.getMaps();
      const mediaPath = maps.mediaMap['https://cdn.discordapp.com/file1.png'];
      expect(mediaPath).toContain('media/attachments/');
    });
  });

  describe('getFileExtension', () => {
    it('should detect PNG', () => {
      const blob = new Blob(['data'], { type: 'image/png' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('png');
    });

    it('should detect JPEG', () => {
      const blob = new Blob(['data'], { type: 'image/jpeg' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('jpg');
    });

    it('should detect GIF', () => {
      const blob = new Blob(['data'], { type: 'image/gif' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('gif');
    });

    it('should detect WebP', () => {
      const blob = new Blob(['data'], { type: 'image/webp' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('webp');
    });

    it('should detect MP4', () => {
      const blob = new Blob(['data'], { type: 'video/mp4' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('mp4');
    });

    it('should detect MP3', () => {
      const blob = new Blob(['data'], { type: 'audio/mpeg' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('mp3');
    });

    it('should detect PDF', () => {
      const blob = new Blob(['data'], { type: 'application/pdf' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBe('pdf');
    });

    it('should return null for unknown MIME types', () => {
      const blob = new Blob(['data'], { type: 'application/unknown' });
      const ext = (service as any).getFileExtension(blob);
      expect(ext).toBeNull();
    });
  });

  describe('getExtensionFromFilename', () => {
    it('should extract extension from filename', () => {
      const ext = (service as any).getExtensionFromFilename('file.png');
      expect(ext).toBe('png');
    });

    it('should handle multiple dots', () => {
      const ext = (service as any).getExtensionFromFilename('my.file.name.jpg');
      expect(ext).toBe('jpg');
    });

    it('should return "bin" for files without extension', () => {
      const ext = (service as any).getExtensionFromFilename('filename');
      expect(ext).toBe('bin');
    });

    it('should handle empty string', () => {
      const ext = (service as any).getExtensionFromFilename('');
      expect(ext).toBe('bin');
    });
  });

  describe('downloadWithTimeout', () => {
    it('should return blob on successful download', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: { id: 'user-1', username: 'user1', discriminator: '0001', avatar: 'avatar123', global_name: null },
        } as any,
      ];

      const mockBlob = new Blob(['data'], { type: 'image/png' });
      mockDiscordService.downloadFile.mockResolvedValue({ success: true, data: mockBlob });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const maps = service.getMaps();
      expect(maps.avatarMap['user-1/avatar123']).toBeDefined();
      expect(mockZipService.addFile).toHaveBeenCalled();
    });

    it('should return null on download failure', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: { id: 'user-1', username: 'user1', discriminator: '0001', avatar: 'avatar123', global_name: null },
        } as any,
      ];

      mockDiscordService.downloadFile.mockRejectedValue(new Error('Network error'));

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const maps = service.getMaps();
      expect(maps.avatarMap['user-1/avatar123']).toBeUndefined();
      expect(mockZipService.addFile).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should return null when the transport gives up on a stalled download (#232)', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: { id: 'user-1', username: 'user1', discriminator: '0001', avatar: 'avatar123', global_name: null },
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({ success: false, data: null });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress
      );

      const maps = service.getMaps();
      expect(maps.avatarMap['user-1/avatar123']).toBeUndefined();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('non-media file downloads', () => {
    it('should download non-media files via CDN url in extension mode', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);

      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            {
              id: 'att-1',
              url: 'https://cdn.discordapp.com/attachments/123/456/report.pdf?ex=abc&hm=cdn_sig',
              proxy_url: 'https://media.discordapp.net/attachments/123/456/report.pdf?ex=abc&hm=proxy_sig',
              filename: 'report.pdf',
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['pdf-data'], { type: 'application/pdf' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: false, videos: false, audio: false, other: true }
      );

      expect(mockDiscordService.downloadFile).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/attachments/123/456/report.pdf?ex=abc&hm=cdn_sig'
      );
      expect(mockZipService.addFile).toHaveBeenCalled();

      vi.mocked(isExtensionMode).mockReturnValue(false);
    });

    it('should skip non-media files in web app mode even if other is true', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            {
              id: 'att-1',
              url: 'https://cdn.discordapp.com/attachments/123/456/report.pdf',
              proxy_url: 'https://media.discordapp.net/attachments/123/456/report.pdf',
              filename: 'report.pdf',
            },
          ],
        } as any,
      ];

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: true, videos: true, audio: true, other: true }
      );

      // Web app mode (default mock) — non-media files should be skipped entirely
      expect(mockDiscordService.downloadFile).not.toHaveBeenCalled();
    });

    it('should skip non-media files in extension mode when other is disabled', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);

      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/attachments/123/456/report.pdf', filename: 'report.pdf' },
          ],
        } as any,
      ];

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: true, videos: true, audio: true, other: false }
      );

      expect(mockDiscordService.downloadFile).not.toHaveBeenCalled();

      vi.mocked(isExtensionMode).mockReturnValue(false);
    });

    it('should use filename extension for unknown MIME types in extension mode', async () => {
      const { isExtensionMode } = await import('@/extension/messaging');
      vi.mocked(isExtensionMode).mockReturnValue(true);

      const messages: Message[] = [
        {
          ...createMockMessage(),
          attachments: [
            {
              id: 'att-1',
              url: 'https://cdn.discordapp.com/attachments/123/456/archive.zip',
              filename: 'archive.zip',
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['zip-data'], { type: 'application/octet-stream' }),
      });

      await service.downloadAllMedia(
        messages, null, 'test-channel', mockZipService, mockOnProgress,
        { images: false, videos: false, audio: false, other: true }
      );

      const maps = service.getMaps();
      const path = maps.mediaMap['https://cdn.discordapp.com/attachments/123/456/archive.zip'];
      expect(path).toContain('.zip');

      vi.mocked(isExtensionMode).mockReturnValue(false);
    });
  });

  describe('getMaps', () => {
    it('should return media maps', () => {
      const maps = service.getMaps();
      expect(maps).toHaveProperty('avatarMap');
      expect(maps).toHaveProperty('mediaMap');
      expect(maps).toHaveProperty('emojiMap');
      expect(maps).toHaveProperty('roleMap');
    });

    it('should return populated maps after downloads', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(
        messages,
        null,
        'test-channel',
        mockZipService,
        mockOnProgress
      );

      const maps = service.getMaps();
      expect(Object.keys(maps.avatarMap).length).toBeGreaterThan(0);
    });
  });

  describe('downloadStickers (#213)', () => {
    it('downloads raster stickers to stickers/{id}.{ext} and skips Lottie', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          sticker_items: [
            { id: 's-png', name: 'wave', format_type: 1 },
            { id: 's-gif', name: 'dance', format_type: 4 },
            { id: 's-lottie', name: 'sparkle', format_type: 3 },
          ],
        } as any,
      ];
      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const stickerPaths = (mockZipService.addFile as any).mock.calls
        .map((c: any[]) => c[1])
        .filter((p: string) => p.includes('/stickers/'));
      expect(stickerPaths).toContain('test-channel/stickers/s-png.png');
      expect(stickerPaths).toContain('test-channel/stickers/s-gif.gif');
      // Lottie is never downloaded (can't be rasterized).
      expect(stickerPaths.some((p: string) => p.includes('s-lottie'))).toBe(false);
    });
  });

  describe('zip modified dates (#235)', () => {
    it('passes the source message timestamp to addFile for attachments and embeds', async () => {
      const timestamp = '2024-03-15T10:30:00.000Z';
      const messages: Message[] = [
        {
          ...createMockMessage(),
          timestamp,
          attachments: [
            { id: 'att-1', url: 'https://cdn.discordapp.com/file.png', filename: 'file.png' },
          ],
          embeds: [
            {
              image: { url: 'https://cdn.discordapp.com/embed-image.png' },
            },
          ],
        } as any,
      ];

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(messages, null, 'test-channel', mockZipService, mockOnProgress);

      const mediaCalls = (mockZipService.addFile as any).mock.calls.filter(
        (c: any[]) => c[1].includes('/media/'),
      );
      expect(mediaCalls).toHaveLength(2);
      mediaCalls.forEach((c: any[]) => {
        expect(c[2]).toBeInstanceOf(Date);
        expect(c[2].getTime()).toBe(new Date(timestamp).getTime());
      });
    });

    it('leaves per-entity media (avatars, emojis, stickers, role icons) on the default date', async () => {
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
          content: 'Test <:emoji:123456>',
          sticker_items: [{ id: 's-png', name: 'wave', format_type: 1 }],
        } as any,
      ];

      const guild: Guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: [{ id: 'role-1', name: 'Admin', icon: 'icon123' }],
      } as any;

      mockDiscordService.downloadFile.mockResolvedValue({
        success: true,
        data: new Blob(['data'], { type: 'image/png' }),
      });

      await service.downloadAllMedia(messages, guild, 'test-channel', mockZipService, mockOnProgress);

      const calls = (mockZipService.addFile as any).mock.calls;
      expect(calls.length).toBe(4); // avatar + emoji + sticker + role icon
      calls.forEach((c: any[]) => {
        expect(c[2]).toBeUndefined();
      });
    });
  });

  describe('F26: Cancel reaches an in-flight download', () => {
    it('aborts the running transport via its signal and rethrows the gate error', async () => {
      vi.useFakeTimers();
      try {
        const cancelErr = new Error('Operation cancelled');
        let cancelled = false;
        const shouldContinue = vi.fn().mockImplementation(async () => {
          if (cancelled) throw cancelErr;
        });
        // Transport that never settles on its own — only the abort
        // signal (Cancel) can end it, like a trickling CDN download.
        const transport = vi.fn().mockImplementation(
          (_url: string, signal?: AbortSignal) =>
            new Promise((resolve) => {
              signal?.addEventListener(
                'abort',
                () => resolve({ success: false, data: null }),
                { once: true },
              );
            }),
        );
        const svc = new MediaDownloadService(transport, (m: string) => mockWarn(m));
        const messages: Message[] = [
          {
            ...createMockMessage(),
            attachments: [{ id: 'att-1', url: 'https://cdn.discordapp.com/big.png', filename: 'big.png' }],
          } as any,
        ];

        const outcome = svc
          .downloadMediaOnly(messages, 'chan', mockZipService, mockOnProgress, undefined, undefined, shouldContinue)
          .then(() => 'resolved', (e: unknown) => e);

        await vi.advanceTimersByTimeAsync(1_000); // download in flight, watcher polling
        cancelled = true;
        await vi.advanceTimersByTimeAsync(1_000); // next poll observes the cancel

        expect(await outcome).toBe(cancelErr);
        expect(transport).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('F9/F17: download-failure WARNs', () => {
    it('caps per-item WARNs and summarizes the real total (F9)', async () => {
      const transport = vi.fn().mockResolvedValue({ success: false, data: null, status: 404 });
      const svc = new MediaDownloadService(transport, (m: string) => mockWarn(m));
      const messages: Message[] = Array.from({ length: 15 }, (_, i) => ({
        ...createMockMessage(),
        id: `msg-${i}`,
        attachments: [{ id: `att-${i}`, url: `https://cdn.discordapp.com/f${i}.png`, filename: `f${i}.png` }],
      })) as any;

      await svc.downloadMediaOnly(messages, 'chan', mockZipService, mockOnProgress);

      // 10 per-item WARNs + 1 summary carrying the real total
      expect(mockWarn).toHaveBeenCalledTimes(11);
      const summary = mockWarn.mock.calls[10][0];
      expect(summary).toContain('15 media files');
      expect(summary).toContain('first 10');
    });

    it('WARNs with status detail when an avatar download fails (F17)', async () => {
      const transport = vi.fn().mockResolvedValue({ success: false, data: null, status: 403 });
      const svc = new MediaDownloadService(transport, (m: string) => mockWarn(m));
      const messages: Message[] = [
        {
          ...createMockMessage(),
          author: {
            id: 'user-1',
            username: 'user1',
            discriminator: '0001',
            avatar: 'avatar123',
            global_name: null,
          },
        } as any,
      ];

      await svc.downloadAllMedia(messages, null, 'chan', mockZipService, mockOnProgress);

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('avatar for user user-1'),
      );
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('403'));
    });

    it('WARNs when a role icon download fails (F17)', async () => {
      const transport = vi.fn().mockResolvedValue({ success: false, data: null });
      const svc = new MediaDownloadService(transport, (m: string) => mockWarn(m));
      const guild: Guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: [{ id: 'role-1', name: 'Admin', icon: 'icon123' }],
      } as any;

      await svc.downloadAllMedia([createMockMessage()] as Message[], guild, 'chan', mockZipService, mockOnProgress);

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('icon for role Admin'),
      );
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('CORS/network'));
    });
  });
});
