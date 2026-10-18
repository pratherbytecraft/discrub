import { describe, it, expect } from 'vitest';
import { formatMessageContentLight, formatEmbedContent } from './messageLightFormatting';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';

describe('messageLightFormatting', () => {
  const mockContext = {
    userMap: {
      '123456': { userName: 'testuser', displayName: 'Test User' },
      '789012': { userName: 'anotheruser', displayName: 'Another User' },
      '111111': { userName: 'onlyusername' }, // No display name
    },
    channelMap: {
      '555555': { name: 'general' },
      '666666': { name: 'announcements' },
    },
    guildRoles: [
      { id: '777777', name: 'Admin' },
      { id: '888888', name: 'Moderator' },
    ],
  } as HtmlFormattingContext;

  describe('empty or no content', () => {
    it('should return "(no content)" for empty string', () => {
      const result = formatMessageContentLight('', mockContext);
      expect(result).toBe('(no content)');
    });

    it('should return "(no content)" for null', () => {
      const result = formatMessageContentLight(null as any, mockContext);
      expect(result).toBe('(no content)');
    });

    it('should return "(no content)" for undefined', () => {
      const result = formatMessageContentLight(undefined as any, mockContext);
      expect(result).toBe('(no content)');
    });
  });

  describe('user mentions', () => {
    it('should format user mention with display name', () => {
      const result = formatMessageContentLight('Hello <@123456>!', mockContext);
      expect(result).toContain('@Test User');
      expect(result).toContain('class="user-mention"');
      expect(result).toContain('data-user-id="123456"');
      expect(result).toContain('style="cursor: pointer;"');
    });

    it('should format user mention with ! prefix', () => {
      const result = formatMessageContentLight('Hello <@!123456>!', mockContext);
      expect(result).toContain('@Test User');
      expect(result).toContain('data-user-id="123456"');
    });

    it('should use userName when displayName not available', () => {
      const result = formatMessageContentLight('Hi <@111111>', mockContext);
      expect(result).toContain('@onlyusername');
    });

    it('should use "Unknown User" for missing users', () => {
      const result = formatMessageContentLight('Hello <@999999>!', mockContext);
      expect(result).toContain('@Unknown User');
      expect(result).toContain('data-user-id="999999"');
    });

    it('should format multiple user mentions', () => {
      const result = formatMessageContentLight(
        '<@123456> and <@789012> are here',
        mockContext
      );
      expect(result).toContain('@Test User');
      expect(result).toContain('@Another User');
    });

    it('should escape HTML in user names', () => {
      const contextWithHtml = {
        ...mockContext,
        userMap: {
          '123456': { userName: 'user<script>', displayName: 'Name<b>Bold</b>' },
        },
      } as unknown as HtmlFormattingContext;
      const result = formatMessageContentLight('Hello <@123456>!', contextWithHtml);
      expect(result).toContain('&lt;b&gt;');
      expect(result).not.toContain('<b>');
    });
  });

  describe('channel mentions', () => {
    it('should format channel mention', () => {
      const result = formatMessageContentLight('Check out <#555555>', mockContext);
      expect(result).toContain('#general');
      expect(result).toContain('class="channel-mention"');
    });

    it('should format multiple channel mentions', () => {
      const result = formatMessageContentLight(
        '<#555555> and <#666666>',
        mockContext
      );
      expect(result).toContain('#general');
      expect(result).toContain('#announcements');
    });

    it('should use "unknown-channel" for missing channels', () => {
      const result = formatMessageContentLight('Go to <#999999>', mockContext);
      expect(result).toContain('#unknown-channel');
    });

    it('should escape HTML in channel names', () => {
      const contextWithHtml = {
        ...mockContext,
        channelMap: {
          '555555': { name: 'channel<script>' },
        },
      } as unknown as HtmlFormattingContext;
      const result = formatMessageContentLight('Check <#555555>', contextWithHtml);
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });
  });

  describe('role mentions', () => {
    it('should format role mention', () => {
      const result = formatMessageContentLight('Hello <@&777777>!', mockContext);
      expect(result).toContain('@Admin');
      expect(result).toContain('class="role-mention"');
    });

    it('should format multiple role mentions', () => {
      const result = formatMessageContentLight(
        '<@&777777> and <@&888888>',
        mockContext
      );
      expect(result).toContain('@Admin');
      expect(result).toContain('@Moderator');
    });

    it('should use "Unknown Role" for missing roles', () => {
      const result = formatMessageContentLight('Ping <@&999999>', mockContext);
      expect(result).toContain('@Unknown Role');
    });

    it('should handle missing guildRoles in context', () => {
      const contextNoRoles = {
        ...mockContext,
        guildRoles: undefined,
      } as unknown as HtmlFormattingContext;
      const result = formatMessageContentLight('Ping <@&777777>', contextNoRoles);
      expect(result).toContain('@Unknown Role');
    });

    it('should escape HTML in role names', () => {
      const contextWithHtml = {
        ...mockContext,
        guildRoles: [
          { id: '777777', name: 'Admin<img>' },
        ],
      } as HtmlFormattingContext;
      const result = formatMessageContentLight('Hello <@&777777>!', contextWithHtml);
      expect(result).toContain('&lt;img&gt;');
      expect(result).not.toContain('<img>');
    });
  });

  describe('@everyone and @here mentions', () => {
    it('should format @everyone mention', () => {
      const result = formatMessageContentLight('Hello @everyone!', mockContext);
      expect(result).toContain('@everyone');
      expect(result).toContain('class="everyone-mention"');
    });

    it('should format @here mention', () => {
      const result = formatMessageContentLight('Hello @here!', mockContext);
      expect(result).toContain('@here');
      expect(result).toContain('class="everyone-mention"');
    });

    it('should format both @everyone and @here', () => {
      const result = formatMessageContentLight(
        '@everyone and @here',
        mockContext
      );
      const everyoneMatches = result.match(/class="everyone-mention"/g);
      expect(everyoneMatches).toHaveLength(2);
    });
  });

  describe('custom emojis', () => {
    it('should format static custom emoji', () => {
      const result = formatMessageContentLight(
        'Hello <:emoji:123456>',
        mockContext
      );
      expect(result).toContain('https://cdn.discordapp.com/emojis/123456.png?size=32');
      expect(result).toContain('class="custom-emoji"');
      expect(result).toContain('alt=":emoji:"');
      expect(result).toContain('title=":emoji:"');
    });

    it('should format animated custom emoji', () => {
      const result = formatMessageContentLight(
        'Hello <a:emoji:789012>',
        mockContext
      );
      expect(result).toContain('https://cdn.discordapp.com/emojis/789012.gif?size=32');
      expect(result).toContain('class="custom-emoji"');
    });

    it('should format multiple emojis', () => {
      const result = formatMessageContentLight(
        '<:emoji1:111> and <a:emoji2:222>',
        mockContext
      );
      expect(result).toContain('111.png');
      expect(result).toContain('222.gif');
    });

    it('should not match emojis with invalid characters in name', () => {
      // Emoji names with special chars like < > won't match the regex \w+
      const result = formatMessageContentLight(
        '<:emoji<script>:123456>',
        mockContext
      );
      // This won't be matched as a valid emoji due to < > in the name
      expect(result).toBe('<:emoji<script>:123456>');
    });
  });

  describe('mixed formatting', () => {
    it('should handle all mention types together', () => {
      const result = formatMessageContentLight(
        '<@123456> check <#555555> for <@&777777> @everyone',
        mockContext
      );
      expect(result).toContain('@Test User');
      expect(result).toContain('#general');
      expect(result).toContain('@Admin');
      expect(result).toContain('@everyone');
    });

    it('should handle mentions and emojis together', () => {
      const result = formatMessageContentLight(
        '<@123456> <:emoji:123> hello',
        mockContext
      );
      expect(result).toContain('@Test User');
      expect(result).toContain('emojis/123.png');
    });

    it('should handle complex mixed content', () => {
      const result = formatMessageContentLight(
        'Hey <@123456> and <@789012>, check <#555555> and <#666666>! <:emoji:123> <a:gif:456> @everyone @here <@&777777>',
        mockContext
      );
      expect(result).toContain('@Test User');
      expect(result).toContain('@Another User');
      expect(result).toContain('#general');
      expect(result).toContain('#announcements');
      expect(result).toContain('123.png');
      expect(result).toContain('456.gif');
      expect(result).toContain('@everyone');
      expect(result).toContain('@here');
      expect(result).toContain('@Admin');
    });
  });

  describe('truncation', () => {
    it('should not truncate short content', () => {
      const result = formatMessageContentLight('Short message', mockContext, 100);
      expect(result).toBe('Short message');
      expect(result).not.toContain('...');
    });

    it('should truncate long plain text content', () => {
      const longText = 'a'.repeat(150);
      const result = formatMessageContentLight(longText, mockContext, 100);
      expect(result).toContain('...');
      expect(result.length).toBeLessThan(longText.length);
    });

    it('should truncate based on plain text length, not HTML length', () => {
      const content = '<@123456> ' + 'a'.repeat(150);
      const result = formatMessageContentLight(content, mockContext, 100);
      expect(result).toContain('...');
    });

    it('should respect custom maxLength parameter', () => {
      const longText = 'a'.repeat(100);
      const result = formatMessageContentLight(longText, mockContext, 50);
      expect(result).toContain('...');
    });

    it('should handle truncation with mentions', () => {
      const content = '<@123456> ' + 'a'.repeat(150);
      const result = formatMessageContentLight(content, mockContext, 50);
      expect(result).toContain('...');
    });

    it('should handle default maxLength of 100', () => {
      const longText = 'a'.repeat(150);
      const result = formatMessageContentLight(longText, mockContext);
      expect(result).toContain('...');
    });
  });

  describe('edge cases', () => {
    it('should handle content with only whitespace', () => {
      const result = formatMessageContentLight('   \n\t  ', mockContext);
      expect(result).toBe('   \n\t  ');
    });

    it('should handle malformed mention syntax', () => {
      const result = formatMessageContentLight('<@>', mockContext);
      expect(result).toBe('<@>');
    });

    it('should handle incomplete mentions', () => {
      const result = formatMessageContentLight('<@123', mockContext);
      expect(result).toBe('<@123');
    });

    it('should handle special characters in content', () => {
      const result = formatMessageContentLight(
        'Test & < > " \' characters',
        mockContext
      );
      // The content itself should be preserved, mentions/emojis would be replaced
      expect(result).toContain('Test');
    });

    it('should handle very long user IDs', () => {
      const result = formatMessageContentLight(
        '<@123456789012345678>',
        mockContext
      );
      expect(result).toContain('data-user-id="123456789012345678"');
    });

    it('should handle empty context maps', () => {
      const emptyContext = {
        userMap: {},
        channelMap: {},
        guildRoles: [],
      } as HtmlFormattingContext;
      const result = formatMessageContentLight(
        '<@123> <#456> <@&789>',
        emptyContext
      );
      expect(result).toContain('@Unknown User');
      expect(result).toContain('#unknown-channel');
      expect(result).toContain('@Unknown Role');
    });

    it('should handle newlines and tabs', () => {
      const result = formatMessageContentLight(
        'Line 1\nLine 2\tTabbed',
        mockContext
      );
      expect(result).toContain('Line 1\nLine 2\tTabbed');
    });

    it('should handle adjacent mentions without spaces', () => {
      const result = formatMessageContentLight(
        '<@123456><@789012>',
        mockContext
      );
      expect(result).toContain('@Test User');
      expect(result).toContain('@Another User');
    });

    it('should handle mentions at start and end', () => {
      const result = formatMessageContentLight(
        '<@123456> middle content <#555555>',
        mockContext
      );
      expect(result.startsWith('<span')).toBe(true);
      expect(result).toContain('middle content');
      expect(result).toContain('#general');
    });
  });

  describe('XSS prevention', () => {
    it('should escape HTML special characters in display names', () => {
      const xssContext = {
        userMap: {
          '123': { userName: 'safe', displayName: '<script>alert("xss")</script>' },
        },
        channelMap: {},
        guildRoles: [],
      } as HtmlFormattingContext;
      const result = formatMessageContentLight('<@123>', xssContext);
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>alert');
    });

    it('should escape HTML in channel names', () => {
      const xssContext = {
        userMap: {},
        channelMap: {
          '123': { name: '<img src=x onerror=alert(1)>' },
        },
        guildRoles: [],
      } as HtmlFormattingContext;
      const result = formatMessageContentLight('<#123>', xssContext);
      expect(result).toContain('&lt;img');
      expect(result).not.toContain('<img src=');
    });

    it('should escape HTML in role names', () => {
      const xssContext = {
        userMap: {},
        channelMap: {},
        guildRoles: [
          { id: '123', name: '<iframe src="evil.com"></iframe>' },
        ],
      } as HtmlFormattingContext;
      const result = formatMessageContentLight('<@&123>', xssContext);
      expect(result).toContain('&lt;iframe');
      expect(result).not.toContain('<iframe');
    });

    it('should not match emojis with HTML in names', () => {
      // Emoji names with HTML won't match the regex \w+ (only alphanumeric and _)
      const result = formatMessageContentLight(
        '<:name<b>bold</b>:123>',
        mockContext
      );
      // Won't be matched as a valid emoji
      expect(result).toBe('<:name<b>bold</b>:123>');
    });
  });
});

describe('formatEmbedContent', () => {
  const ctx = {
    userMap: {
      '123456': { userName: 'testuser', displayName: 'Test User' },
    },
    channelMap: {
      '555555': { name: 'general' },
    },
    guildRoles: [
      { id: '777777', name: 'Admin' },
    ],
  } as HtmlFormattingContext;

  describe('Discord markdown', () => {
    it('renders bold text', () => {
      expect(formatEmbedContent('**hello**', ctx)).toContain('<strong>hello</strong>');
    });

    it('renders italic text', () => {
      expect(formatEmbedContent('*hello*', ctx)).toContain('<em>hello</em>');
    });

    it('renders bold italic text', () => {
      expect(formatEmbedContent('***hello***', ctx)).toContain('<strong><em>hello</em></strong>');
    });

    it('renders underline text', () => {
      expect(formatEmbedContent('__hello__', ctx)).toContain('<u>hello</u>');
    });

    it('renders strikethrough text', () => {
      expect(formatEmbedContent('~~hello~~', ctx)).toContain('<s>hello</s>');
    });

    it('renders inline code', () => {
      expect(formatEmbedContent('`code`', ctx)).toContain('<code>code</code>');
    });

    it('renders headings', () => {
      expect(formatEmbedContent('# Big heading', ctx)).toContain('<strong style="font-size: 1.1em;">Big heading</strong>');
      expect(formatEmbedContent('## Medium heading', ctx)).toContain('<strong style="font-size: 1em;">Medium heading</strong>');
      expect(formatEmbedContent('### Small heading', ctx)).toContain('<strong style="font-size: 0.9em;">Small heading</strong>');
    });
  });

  describe('links', () => {
    it('renders masked links [text](url)', () => {
      const result = formatEmbedContent('[Click here](https://example.com)', ctx);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('Click here');
    });

    it('renders auto-linked URLs <https://...>', () => {
      const result = formatEmbedContent('<https://example.com>', ctx);
      expect(result).toContain('href="https://example.com"');
    });

    it('renders bare URLs', () => {
      const result = formatEmbedContent('Visit https://example.com today', ctx);
      expect(result).toContain('href="https://example.com"');
    });
  });

  describe('mentions', () => {
    it('resolves user mentions', () => {
      const result = formatEmbedContent('<@123456>', ctx);
      expect(result).toContain('@Test User');
      expect(result).toContain('user-mention');
    });

    it('resolves channel mentions', () => {
      const result = formatEmbedContent('<#555555>', ctx);
      expect(result).toContain('#general');
      expect(result).toContain('channel-mention');
    });

    it('resolves role mentions', () => {
      const result = formatEmbedContent('<@&777777>', ctx);
      expect(result).toContain('@Admin');
      expect(result).toContain('role-mention');
    });

    it('formats @everyone mentions', () => {
      const result = formatEmbedContent('@everyone', ctx);
      expect(result).toContain('everyone-mention');
    });
  });

  describe('custom emojis', () => {
    it('renders custom emoji as image', () => {
      const result = formatEmbedContent('<:smile:12345>', ctx);
      expect(result).toContain('cdn.discordapp.com/emojis/12345.png');
      expect(result).toContain('alt=":smile:"');
    });

    it('renders animated emoji as gif', () => {
      const result = formatEmbedContent('<a:wave:67890>', ctx);
      expect(result).toContain('cdn.discordapp.com/emojis/67890.gif');
    });
  });

  describe('newlines', () => {
    it('converts newlines to <br>', () => {
      const result = formatEmbedContent('line 1\nline 2', ctx);
      expect(result).toContain('line 1<br>line 2');
    });
  });

  describe('XSS prevention', () => {
    it('escapes HTML in content before processing', () => {
      const result = formatEmbedContent('<script>alert("xss")</script>', ctx);
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });
  });

  describe('empty content', () => {
    it('returns empty string for empty input', () => {
      expect(formatEmbedContent('', ctx)).toBe('');
    });

    it('returns empty string for null-ish input', () => {
      expect(formatEmbedContent(null as any, ctx)).toBe('');
    });
  });
});

describe('formatEmbedContent subtext and timestamps', () => {
  const ctx = { userMap: { '1541': { displayName: 'Prather Bytecraft' } }, channelMap: { '345': { name: 'general' } } };

  it('renders a subtext line as a block span and drops its newline', () => {
    const html = formatEmbedContent('**Top**\n-# <#345> · by <@1541>\nnext', ctx);
    expect(html).toContain('<strong>Top</strong><br><span class="subtext"><span class="channel-mention">#general</span> · by <span class="user-mention">@Prather Bytecraft</span></span>next');
    expect(html).not.toContain('-#');
  });

  it('renders a Discord timestamp as an absolute date with the full date in the title', () => {
    const html = formatEmbedContent('-# 🎉 2 · <t:1788287560:R>', ctx);
    const date = new Date(1788287560 * 1000);
    const text = date.toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    expect(html).toContain(`class="timestamp-mention" data-unix="1788287560"`);
    expect(html).toContain(`>${text}</span>`);
    expect(html).not.toContain('&lt;t:');
  });
});

describe('formatEmbedContent underscore italics', () => {
  const ctx = { userMap: {} };
  it('renders _text_ as italic and leaves snake_case alone', () => {
    expect(formatEmbedContent('_Counted from the links._', ctx)).toBe('<em>Counted from the links.</em>');
    expect(formatEmbedContent('see my_var_name here', ctx)).toBe('see my_var_name here');
    expect(formatEmbedContent('a _b_ c', ctx)).toBe('a <em>b</em> c');
  });
});
