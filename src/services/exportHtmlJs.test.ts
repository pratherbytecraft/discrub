import { createMockMessage } from '@/test/fixtures';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildExportPageData, generateEmbeddedJs } from './exportHtmlJs';
import { resolveExportThemeSet, buildThemeSelectHtml } from './exportThemes';
import { getExportService } from './exportService';
import {
  EXPORT_MESSAGES,
  THREAD_MESSAGES,
  AUTHOR_ALICE,
  AUTHOR_BOB,
} from '@/test/export-html-fixtures';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import type { Message, Channel } from 'discrub-core/types/discord-types';

const MOCK_CONTEXT: HtmlFormattingContext = {
  userMap: {
    [AUTHOR_ALICE.id]: { userName: 'alice', displayName: 'Alice Display' },
    [AUTHOR_BOB.id]: { userName: 'bob', displayName: 'Bob Display' },
  },
};

describe('buildExportPageData', () => {
  it('returns correct page metadata', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 2, 5, 'general', MOCK_CONTEXT);
    expect(data.page.current).toBe(2);
    expect(data.page.total).toBe(5);
    expect(data.page.baseFilename).toBe('general');
  });

  it('builds user map from formatting context', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    expect(data.users[AUTHOR_ALICE.id]).toBeDefined();
    expect(data.users[AUTHOR_ALICE.id].username).toBe('alice');
    expect(data.users[AUTHOR_ALICE.id].displayName).toBe('Alice Display');
  });

  it('counts messages per user', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    // Alice has msgs 1, 3, 5, 7 = 4 messages
    expect(data.users[AUTHOR_ALICE.id].messageCount).toBe(4);
    // Bob has msgs 2, 4, 6, 8 = 4 messages
    expect(data.users[AUTHOR_BOB.id].messageCount).toBe(4);
  });

  it('adds message authors not in formatting context', () => {
    // Empty formatting context — should still get users from message authors
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test');
    expect(data.users[AUTHOR_ALICE.id]).toBeDefined();
    expect(data.users[AUTHOR_ALICE.id].username).toBe('alice');
  });

  it('builds thread map from messages with thread field', () => {
    const data = buildExportPageData(THREAD_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    // msg-t1 has a thread field
    expect(data.threads['msg-t1']).toBeDefined();
    expect(data.threads['msg-t1']).toContain('threads/');
    expect(data.threads['msg-t1']).toContain('.html');
  });

  it('returns empty thread map when no threads', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    expect(Object.keys(data.threads)).toHaveLength(0);
  });

  it('produces valid JSON-serializable output', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    const json = JSON.stringify(data);
    const parsed = JSON.parse(json);
    expect(parsed.page.current).toBe(1);
    expect(parsed.users[AUTHOR_ALICE.id].username).toBe('alice');
  });

  // #175: the inline slug in exportHtmlJs builds the threadMap that the
  // embedded client JS uses to resolve thread filenames. ExportService
  // emits the actual files using sanitizeFilename(thread.name, thread.id).
  // If those two slugifiers ever drift, threadMap entries point at files
  // that don't exist. These tests pin them together across edge-case names.
  describe('#175: threadMap slug matches ExportService.sanitizeFilename', () => {
    function makeThreadMessage(threadName: string, threadId: string): Message {
      const thread: Channel = {
        id: threadId,
        name: threadName,
        type: 11,
      } as Channel;
      return {
        id: `msg-for-${threadId}`,
        channel_id: 'channel-123',
        author: AUTHOR_ALICE,
        content: 'starter',
        timestamp: '2026-06-15T10:00:00.000Z',
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
        thread,
      } as unknown as Message;
    }

    const cases: Array<[string, string, string]> = [
      ['simple ASCII', 'bug-discussion', 'thread-001'],
      ['uppercase', 'GT3 RS Build Log', 'thread-002'],
      ['punctuation', 'GT3 RS!', 'thread-003'],
      ['leading/trailing junk', '!!hello!!', 'thread-004'],
      ['runs of separators', 'foo   ---   bar', 'thread-005'],
      ['non-alphanumeric only', '###', 'thread-006'],
      ['mixed unicode + ascii', 'Café Talk', 'thread-007'],
    ];

    for (const [label, name, id] of cases) {
      it(`emits matching paths for ${label}: "${name}"`, () => {
        const service = getExportService();
        const msg = makeThreadMessage(name, id);
        const data = buildExportPageData([msg], 1, 1, 'test', MOCK_CONTEXT);

        const expectedFilename = `threads/${service.sanitizeFilename(name, id)}.html`;
        expect(data.threads[msg.id]).toBe(expectedFilename);
      });
    }

    it('collisions on cosmetic punctuation still resolve to distinct files', () => {
      const service = getExportService();
      // Two threads with names that slugify to the same base. The id
      // suffix is what disambiguates; both threadMap and sanitizeFilename
      // must agree on that.
      const a = makeThreadMessage('GT3 RS', '111');
      const b = makeThreadMessage('GT3 RS!', '222');
      const data = buildExportPageData([a, b], 1, 1, 'test', MOCK_CONTEXT);

      expect(data.threads[a.id]).toBe(`threads/${service.sanitizeFilename('GT3 RS', '111')}.html`);
      expect(data.threads[b.id]).toBe(`threads/${service.sanitizeFilename('GT3 RS!', '222')}.html`);
      expect(data.threads[a.id]).not.toBe(data.threads[b.id]);
    });
  });
});

// 2.2.9: a refused reactor lookup (core answers an empty list behind a count) is marked.
describe('buildExportPageData reaction availability', () => {
  const reacted = createMockMessage({
    id: 'r-1',
    reactions: [{ count: 2, count_details: { burst: 0, normal: 2 }, me: false, me_burst: false, burst_colors: [], emoji: { id: null, name: '👍' } }],
  });

  it('marks an empty reactor list behind a non-zero count as unavailable when a lookup was attempted', () => {
    const data = buildExportPageData([reacted], 1, 1, 'chan', undefined, { 'r-1': { '👍': [] } });
    expect(data.reactions['r-1']['👍'].unavailable).toBe(true);
    expect(data.reactions['r-1']['👍'].count).toBe(2);
  });

  it('leaves a list with names, and an export without lookups, unmarked', () => {
    const withNames = buildExportPageData([reacted], 1, 1, 'chan', undefined, { 'r-1': { '👍': [{ id: 'u1', username: 'one', avatar: null, burst: false }] } });
    expect(withNames.reactions['r-1']['👍'].unavailable).toBeUndefined();
    expect(withNames.reactions['r-1']['👍'].users).toHaveLength(1);
    const noLookup = buildExportPageData([reacted], 1, 1, 'chan', undefined, undefined);
    expect(noLookup.reactions['r-1']['👍'].unavailable).toBeUndefined();
  });

  it('ships the unavailable note in the viewer script', () => {
    expect(generateEmbeddedJs()).toContain('Reactor names unavailable');
  });
});

describe('generateEmbeddedJs', () => {
  it('returns a non-empty string', () => {
    const js = generateEmbeddedJs();
    expect(js.length).toBeGreaterThan(0);
  });

  it('is a self-executing IIFE', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('(function()');
    expect(js).toContain('})()');
  });

  it('reads from export-data JSON element', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain("getElementById('export-data')");
  });

  it('includes popup system functions', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('createPopup');
    expect(js).toContain('closePopup');
    expect(js).toContain('positionPopup');
  });

  it('includes event delegation on document.body', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain("document.body.addEventListener('click'");
  });

  it('handles Escape key to close popups', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain("e.key === 'Escape'");
    expect(js).toContain('closePopup');
  });

  it('includes show-user action handler', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain("case 'show-user'");
    expect(js).toContain('showUserPopup');
  });

  it('includes toggle-spoiler action handler', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain("case 'toggle-spoiler'");
    expect(js).toContain('toggleSpoiler');
  });

  it('exposes __discrubExport API on window', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('window.__discrubExport');
    expect(js).toContain('getData');
    expect(js).toContain('closePopup');
    expect(js).toContain('getActivePopup');
  });

  it('sets ARIA attributes on popups', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain("role', 'dialog'");
    expect(js).toContain("aria-modal', 'true'");
  });

  it('includes message hover toolbar', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('createToolbar');
    expect(js).toContain('removeToolbar');
    expect(js).toContain('msg-toolbar');
  });

  it('toolbar has copy text button', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('Copy Text');
    expect(js).toContain('clipboard.writeText');
  });

  it('toolbar has copy ID button', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('Copy ID');
  });

  it('clicking a user-mention opens the same user popup', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('user-mention');
    expect(js).toContain('showUserPopup');
  });

  it('toolbar removes on mouse leave from message', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('mouseout');
    expect(js).toContain('removeToolbar');
  });

  it('includes lightbox open/close/navigate functions', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('openLightbox');
    expect(js).toContain('closeLightbox');
    expect(js).toContain('lightboxPrev');
    expect(js).toContain('lightboxNext');
    expect(js).toContain("case 'open-lightbox'");
  });

  it('lightbox supports keyboard navigation', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('lightboxOverlay');
    expect(js).toContain('ArrowLeft');
    expect(js).toContain('ArrowRight');
  });

  it('includes search functionality', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('performSearch');
    expect(js).toContain('clearSearch');
    expect(js).toContain('search-input');
    expect(js).toContain('search-hidden');
  });

  it('search intercepts Ctrl+F / Cmd+F', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('ctrlKey');
    expect(js).toContain('metaKey');
  });

  it('search hides date dividers with no visible messages', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('date-divider');
    expect(js).toContain('hasVisible');
  });

  it('includes the theme switcher with localStorage persistence', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('theme-select');
    expect(js).toContain('applyTheme');
    expect(js).toContain('localStorage');
    expect(js).toContain('discrub-export-theme');
  });

  it('theme toggle adds/removes light-theme class on documentElement', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('light-theme');
    expect(js).toContain('documentElement');
  });

  it('includes reaction popup handler', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('showReactionsPopup');
    expect(js).toContain("case 'show-reactions'");
  });

  it('reaction popup builds tabs per emoji plus All tab', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('reaction-popup-tabs');
    expect(js).toContain('data-tab="all"');
    // 2.2.9: the label comes from the page's string table, in the export's language.
    expect(js).toContain('"all":"All"');
    expect(js).toContain('escapeHtml(L.all)');
  });

  it('reaction popup handles count-only mode when no user data', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('reaction-count-list');
    expect(js).toContain('hasUserData');
  });

  it('reaction popup renders user rows with progressive loading', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('reaction-user-row');
    expect(js).toContain('REACTION_PAGE_SIZE');
    expect(js).toContain('reaction-show-more');
  });

  it('reaction popup includes search input for user filtering', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('reaction-search-input');
    expect(js).toContain('Search users');
    expect(js).toContain('getFilteredItems');
  });
});

describe('buildExportPageData — reactions', () => {
  it('includes reaction data for messages with reactions', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    expect(data.reactions['msg-4']).toBeDefined();
    expect(data.reactions['msg-4']['👍'].count).toBe(5);
    expect(data.reactions['msg-4']['👍'].emoji).toBe('👍');
  });

  it('reaction users array is empty when no reactionMap provided', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    expect(data.reactions['msg-4']['👍'].users).toEqual([]);
  });

  it('messages without reactions have no entry', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    expect(data.reactions['msg-1']).toBeUndefined();
  });

  it('multiple reactions on same message create multiple entries', () => {
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT);
    expect(data.reactions['msg-6']['👍'].count).toBe(3);
    expect(data.reactions['msg-6']['❤️'].count).toBe(2);
  });

  it('populates reaction users from reactionMap when provided', () => {
    const reactionMap = {
      'msg-4': {
        '👍': [
          { id: AUTHOR_ALICE.id, burst: false },
          { id: AUTHOR_BOB.id, burst: false },
        ],
      },
    };
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, reactionMap);
    expect(data.reactions['msg-4']['👍'].users).toHaveLength(2);
    expect(data.reactions['msg-4']['👍'].users[0].id).toBe(AUTHOR_ALICE.id);
    expect(data.reactions['msg-4']['👍'].users[0].username).toBe('alice');
    expect(data.reactions['msg-4']['👍'].users[1].id).toBe(AUTHOR_BOB.id);
    expect(data.reactions['msg-4']['👍'].users[1].username).toBe('bob');
  });

  it('resolves usernames from formatting context for reactor users', () => {
    const reactionMap = {
      'msg-4': {
        '👍': [{ id: AUTHOR_ALICE.id, burst: false }],
      },
    };
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, reactionMap);
    // alice is in MOCK_CONTEXT.userMap, so username should resolve
    expect(data.reactions['msg-4']['👍'].users[0].username).toBe('alice');
  });

  it('falls back to Unknown for reactor users not in context or messages', () => {
    const reactionMap = {
      'msg-4': {
        '👍': [{ id: '999999999999999999', burst: false }],
      },
    };
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, reactionMap);
    expect(data.reactions['msg-4']['👍'].users[0].username).toBe('Unknown');
  });

  it('reaction users still empty for emoji keys not in reactionMap', () => {
    const reactionMap = {
      'msg-6': {
        '👍': [{ id: AUTHOR_ALICE.id, burst: false }],
        // ❤️ not in reactionMap
      },
    };
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, reactionMap);
    expect(data.reactions['msg-6']['👍'].users).toHaveLength(1);
    expect(data.reactions['msg-6']['❤️'].users).toEqual([]);
  });

  it('custom emoji in reaction data produces <img> tag', () => {
    const customEmojiMsg = [{
      id: 'msg-custom-emoji',
      channel_id: 'channel-123',
      author: AUTHOR_ALICE,
      content: 'custom emoji reaction test',
      timestamp: '2026-06-15T10:00:00.000Z',
      reactions: [
        { emoji: { id: '1234567890', name: 'pepe', animated: false }, count: 3 },
      ],
      mentions: [], attachments: [], embeds: [], pinned: false, type: 0,
    }] as any;

    const emojiMap = { '1234567890': 'test/emojis/1234567890.webp' };
    const data = buildExportPageData(customEmojiMsg, 1, 1, 'test', MOCK_CONTEXT, undefined, undefined, undefined, undefined, undefined, emojiMap);
    const emojiHtml = data.reactions['msg-custom-emoji']['pepe:1234567890'].emoji;
    expect(emojiHtml).toContain('<img');
    expect(emojiHtml).toContain('emojis/1234567890.webp');
    expect(emojiHtml).toContain(':pepe:');
  });

  it('custom emoji without emojiMap falls back to CDN URL', () => {
    const customEmojiMsg = [{
      id: 'msg-cdn-emoji',
      channel_id: 'channel-123',
      author: AUTHOR_ALICE,
      content: 'cdn fallback test',
      timestamp: '2026-06-15T10:00:00.000Z',
      reactions: [
        { emoji: { id: '9876543210', name: 'kekw', animated: false }, count: 1 },
      ],
      mentions: [], attachments: [], embeds: [], pinned: false, type: 0,
    }] as any;

    const data = buildExportPageData(customEmojiMsg, 1, 1, 'test', MOCK_CONTEXT);
    const emojiHtml = data.reactions['msg-cdn-emoji']['kekw:9876543210'].emoji;
    expect(emojiHtml).toContain('<img');
    expect(emojiHtml).toContain('cdn.discordapp.com/emojis/9876543210.webp');
  });

  it('reaction user avatar uses local path when available in avatarMap', () => {
    const reactionMap = {
      'msg-4': {
        '👍': [{ id: AUTHOR_ALICE.id, burst: false, avatar: 'alice_hash' }],
      },
    };
    const avatarMap = { [`${AUTHOR_ALICE.id}/alice_hash`]: 'test/avatars/alice_hash.png' };
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, reactionMap, avatarMap);
    expect(data.reactions['msg-4']['👍'].users[0].avatarUrl).toBe('avatars/alice_hash.png');
    expect(data.reactions['msg-4']['👍'].users[0].avatarUrl).not.toContain('cdn.discordapp.com');
  });

  it('reaction user avatar falls back to CDN when not in avatarMap', () => {
    const reactionMap = {
      'msg-4': {
        '👍': [{ id: AUTHOR_ALICE.id, burst: false, avatar: 'alice_hash' }],
      },
    };
    const data = buildExportPageData(EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, reactionMap);
    expect(data.reactions['msg-4']['👍'].users[0].avatarUrl).toContain('cdn.discordapp.com');
    expect(data.reactions['msg-4']['👍'].users[0].avatarUrl).toContain(AUTHOR_ALICE.id);
  });
});

describe('Role color data in export', () => {
  const GUILD_ID = 'guild-test';
  const GUILD_ROLES = [
    { id: 'role-everyone', name: '@everyone', color: 0, position: 0 },
    { id: 'role-mod', name: 'Moderator', color: 0x2ecc71, position: 5, unicode_emoji: '🛡️' },
    { id: 'role-admin', name: 'Admin', color: 0xe91e63, position: 10 },
  ];
  const USER_MAP_WITH_ROLES = {
    [AUTHOR_ALICE.id]: {
      userName: 'alice',
      displayName: 'Alice Display',
      avatar: 'alice_avatar_hash',
      guilds: {
        [GUILD_ID]: {
          roles: ['role-admin', 'role-mod'],
          nick: 'AliceNick',
          joinedAt: null,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
    },
    [AUTHOR_BOB.id]: {
      userName: 'bob',
      displayName: 'Bob Display',
      avatar: null,
      guilds: {
        [GUILD_ID]: {
          roles: ['role-everyone'],
          nick: null,
          joinedAt: null,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
    },
  };

  it('should include roleColor when guildRoles and cachedUserMap are provided', () => {
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, undefined, undefined,
      USER_MAP_WITH_ROLES, GUILD_ID, GUILD_ROLES,
    );
    const alice = data.users[AUTHOR_ALICE.id];
    expect(alice).toBeDefined();
    expect(alice.roleColor).toBe('#e91e63'); // Admin — highest position colored role
  });

  it('should not include roleColor for users without colored roles', () => {
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, undefined, undefined,
      USER_MAP_WITH_ROLES, GUILD_ID, GUILD_ROLES,
    );
    const bob = data.users[AUTHOR_BOB.id];
    expect(bob).toBeDefined();
    expect(bob.roleColor).toBeUndefined(); // Only has @everyone — no color
  });

  it('should include roles array with name, color, and icon', () => {
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, undefined, undefined,
      USER_MAP_WITH_ROLES, GUILD_ID, GUILD_ROLES,
    );
    const alice = data.users[AUTHOR_ALICE.id];
    expect(alice.roles).toBeDefined();
    expect(alice.roles!.length).toBe(2); // Admin + Moderator (not @everyone)
    expect(alice.roles![0].name).toBe('Admin'); // Highest position first
    expect(alice.roles![0].color).toBe('#e91e63');
    expect(alice.roles![1].name).toBe('Moderator');
    expect(alice.roles![1].unicodeEmoji).toBe('🛡️');
  });

  it('should not include roleColor when guildRoles is empty', () => {
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, undefined, undefined,
      USER_MAP_WITH_ROLES, GUILD_ID, [],
    );
    const alice = data.users[AUTHOR_ALICE.id];
    expect(alice.roleColor).toBeUndefined();
    // Empty roles array when no guild roles to match against
    expect(alice.roles).toHaveLength(0);
  });

  it('should not include roleColor when cachedUserMap is not provided', () => {
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'test', MOCK_CONTEXT, undefined, undefined,
      undefined, GUILD_ID, GUILD_ROLES,
    );
    const alice = data.users[AUTHOR_ALICE.id];
    expect(alice.roleColor).toBeUndefined();
  });
});

describe('Role-icon localization in export data (#171)', () => {
  // Pass roleMap into buildExportPageData and assert each user's roles
  // entries carry the locally-resolved iconLocalUrl when the icon was
  // downloaded; otherwise iconLocalUrl is undefined and the embedded JS
  // template falls through to the remote CDN URL.
  const GUILD_ID = 'guild-icon-test';
  const ROLE_ADMIN = { id: 'role-admin', name: 'Admin', color: 0xe91e63, position: 10, icon: 'admin_icon_hash' };
  const ROLE_MOD = { id: 'role-mod', name: 'Mod', color: 0x2ecc71, position: 5, icon: 'mod_icon_hash' };
  const ROLE_NOICON = { id: 'role-noicon', name: 'Member', color: 0, position: 1 };
  const GUILD_ROLES = [ROLE_ADMIN, ROLE_MOD, ROLE_NOICON];
  const USER_MAP = {
    [AUTHOR_ALICE.id]: {
      userName: 'alice',
      displayName: 'Alice',
      avatar: null,
      guilds: {
        [GUILD_ID]: {
          roles: ['role-admin', 'role-mod', 'role-noicon'],
          nick: null,
          joinedAt: null,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
    },
  };

  it('populates iconLocalUrl on roles whose icon is in the roleMap', () => {
    const roleMap = {
      'https://cdn.discordapp.com/role-icons/role-admin/admin_icon_hash.webp?size=20':
        'sanitized-channel/roles/Admin_role-admin.webp',
      'https://cdn.discordapp.com/role-icons/role-mod/mod_icon_hash.webp?size=20':
        'sanitized-channel/roles/Mod_role-mod.webp',
    };
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'sanitized-channel', MOCK_CONTEXT,
      undefined, undefined, USER_MAP, GUILD_ID, GUILD_ROLES, undefined, roleMap,
    );
    const alice = data.users[AUTHOR_ALICE.id];
    expect(alice.roles).toBeDefined();
    const admin = alice.roles!.find((r) => r.name === 'Admin');
    const mod = alice.roles!.find((r) => r.name === 'Mod');
    expect(admin?.iconLocalUrl).toBe('roles/Admin_role-admin.webp');
    expect(mod?.iconLocalUrl).toBe('roles/Mod_role-mod.webp');
  });

  it('leaves iconLocalUrl undefined when the role icon is not in the roleMap', () => {
    // Empty roleMap simulates a guild whose icons failed to download or
    // weren't downloaded (legacy export path that passes guild=null).
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'sanitized-channel', MOCK_CONTEXT,
      undefined, undefined, USER_MAP, GUILD_ID, GUILD_ROLES, undefined, {},
    );
    const alice = data.users[AUTHOR_ALICE.id];
    const admin = alice.roles!.find((r) => r.name === 'Admin');
    expect(admin?.iconLocalUrl).toBeUndefined();
    // The hash itself is still present so the template can build a remote
    // URL fallback. This is the live-mode parity path.
    expect(admin?.icon).toBe('admin_icon_hash');
  });

  it('omits iconLocalUrl entirely for roles without an icon', () => {
    const roleMap = {
      'https://cdn.discordapp.com/role-icons/role-admin/admin_icon_hash.webp?size=20':
        'sanitized-channel/roles/Admin_role-admin.webp',
    };
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'sanitized-channel', MOCK_CONTEXT,
      undefined, undefined, USER_MAP, GUILD_ID, GUILD_ROLES, undefined, roleMap,
    );
    const alice = data.users[AUTHOR_ALICE.id];
    const member = alice.roles!.find((r) => r.name === 'Member');
    expect(member?.icon).toBeNull();
    expect(member?.iconLocalUrl).toBeUndefined();
  });

  it('strips the entityName prefix so values are page-relative (matches avatarUrl behavior)', () => {
    // Same pattern as avatarUrl on line 119 — drop the "{sanitizedName}/"
    // prefix so the value is relative to the page; prefixRelativeMediaPaths
    // reattaches "../" for nested thread files.
    const roleMap = {
      'https://cdn.discordapp.com/role-icons/role-admin/admin_icon_hash.webp?size=20':
        'specific-channel-folder/roles/Admin_role-admin.webp',
    };
    const data = buildExportPageData(
      EXPORT_MESSAGES, 1, 1, 'specific-channel-folder', MOCK_CONTEXT,
      undefined, undefined, USER_MAP, GUILD_ID, GUILD_ROLES, undefined, roleMap,
    );
    const alice = data.users[AUTHOR_ALICE.id];
    const admin = alice.roles!.find((r) => r.name === 'Admin');
    expect(admin?.iconLocalUrl).toBe('roles/Admin_role-admin.webp');
    expect(admin?.iconLocalUrl).not.toContain('specific-channel-folder/');
  });
});

describe('Embedded JS role-icon rendering (#171)', () => {
  it('user-popup role badges prefer iconLocalUrl over remote CDN URL', () => {
    const js = generateEmbeddedJs();
    expect(js).toContain('r.iconLocalUrl');
    // The CDN fallback must remain so live-loaded data (or roles whose
    // icons weren't downloaded) still render.
    expect(js).toContain('cdn.discordapp.com/role-icons/');
  });
});

describe('theme switcher behavior (embedded JS executed in jsdom)', () => {
  const set = resolveExportThemeSet({ themeSetting: 'terminal', isSupporter: false });

  function bootPage() {
    document.documentElement.className = 'export-theme-terminal';
    document.body.innerHTML = `
      <script type="application/json" id="export-data">{}</script>
      ${buildThemeSelectHtml(set, 'theme-select', 'theme-select')}
    `;
    // The exported page runs this inline; jsdom won't execute injected
    // script tags, so run it directly.
    new Function(generateEmbeddedJs(set))();
  }

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('changing the select swaps the theme class and persists the choice', () => {
    bootPage();
    const select = document.getElementById('theme-select') as HTMLSelectElement;

    select.value = 'discord-light';
    select.dispatchEvent(new Event('change'));

    expect(document.documentElement.classList.contains('export-theme-discord-light')).toBe(true);
    expect(document.documentElement.classList.contains('export-theme-terminal')).toBe(false);
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
    expect(localStorage.getItem('discrub-export-theme')).toBe('discord-light');

    select.value = 'terminal';
    select.dispatchEvent(new Event('change'));
    expect(document.documentElement.classList.contains('export-theme-terminal')).toBe(true);
    expect(document.documentElement.classList.contains('light-theme')).toBe(false);
  });

  it('applies a saved theme id on load', () => {
    localStorage.setItem('discrub-export-theme', 'discord-light');
    bootPage();
    expect(document.documentElement.classList.contains('export-theme-discord-light')).toBe(true);
    expect((document.getElementById('theme-select') as HTMLSelectElement).value).toBe('discord-light');
  });

  it('maps a legacy stored value onto the matching Discord theme', () => {
    localStorage.setItem('discrub-export-theme', 'light');
    bootPage();
    expect(document.documentElement.classList.contains('export-theme-discord-light')).toBe(true);
  });

  it('ignores a stored id this export does not embed', () => {
    // e.g. a supporter theme saved by a supporter export, opened next
    // to a free export in the same browser profile.
    localStorage.setItem('discrub-export-theme', 'synthwave');
    bootPage();
    expect(document.documentElement.classList.contains('export-theme-terminal')).toBe(true);
  });

  it('follows a discrub-theme postMessage from the shell', () => {
    bootPage();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'discrub-theme', themeId: 'discord-light' },
      }),
    );
    expect(document.documentElement.classList.contains('export-theme-discord-light')).toBe(true);
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
  });
});

