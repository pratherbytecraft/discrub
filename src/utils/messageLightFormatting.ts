import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import { renderTimestampHtml, renderSubtextHtml } from 'discrub-core/html-formatting-utils';

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Lightweight formatting for table display - handles mentions and emojis only
 * This is a simplified version that focuses on key readability improvements
 * without the overhead of full Discord HTML rendering.
 */
export const formatMessageContentLight = (
  content: string,
  context: HtmlFormattingContext,
  maxLength: number = 100
): string => {
  if (!content) return '(no content)';

  let formatted = content;

  // Replace user mentions: <@123456> or <@!123456> → <span class="user-mention">@Username</span>
  formatted = formatted.replace(/<@!?(\d+)>/g, (_match, userId) => {
    const user = context.userMap[userId];
    const displayName = escapeHtml(user?.displayName || user?.userName || 'Unknown User');
    return `<span class="user-mention" data-user-id="${userId}" style="cursor: pointer;">@${displayName}</span>`;
  });

  // Replace channel mentions: <#123456> → <span class="channel-mention">#channel-name</span>
  formatted = formatted.replace(/<#(\d+)>/g, (_match, channelId) => {
    const channel = context.channelMap?.[channelId];
    const channelName = escapeHtml(channel?.name || 'unknown-channel');
    return `<span class="channel-mention">#${channelName}</span>`;
  });

  // Replace role mentions: <@&123456> → <span class="role-mention">@RoleName</span>
  formatted = formatted.replace(/<@&(\d+)>/g, (_match, roleId) => {
    const role = Array.isArray(context.guildRoles)
      ? context.guildRoles.find((r) => r.id === roleId)
      : context.guildRoles?.[roleId];
    const roleName = escapeHtml(role?.name || 'Unknown Role');
    return `<span class="role-mention">@${roleName}</span>`;
  });

  // Replace @everyone and @here mentions → <span class="everyone-mention">@everyone</span>
  formatted = formatted.replace(/@(everyone|here)/g, (_match, mentionType) => {
    return `<span class="everyone-mention">@${mentionType}</span>`;
  });

  // Replace custom emojis: <:name:id> or <a:name:id> → actual emoji images from Discord CDN
  formatted = formatted.replace(/<(a)?:(\w+):(\d+)>/g, (_match, animated, name, id) => {
    const emojiName = escapeHtml(name);
    const extension = animated ? 'gif' : 'png';
    return `<img src="https://cdn.discordapp.com/emojis/${id}.${extension}?size=32" class="custom-emoji" alt=":${emojiName}:" title=":${emojiName}:" />`;
  });

  // Escape any remaining HTML in the content to prevent XSS
  // We need to be careful not to escape the HTML we just added
  // So we'll do this by escaping first, then doing replacements
  // Actually, we already handled the user content via escapeHtml above

  // Truncate if needed (plain text length, not HTML)
  // Strip HTML for length calculation
  const plainText = formatted.replace(/<[^>]*>/g, '');
  if (plainText.length > maxLength) {
    // Find a safe truncation point that doesn't break HTML tags
    // We'll use a simple approach: truncate based on plain text ratio
    const ratio = maxLength / plainText.length;
    const truncateAt = Math.floor(formatted.length * ratio);
    formatted = formatted.substring(0, truncateAt) + '...';
  }

  return formatted;
};

/**
 * Format embed text content (description, field values) with Discord markdown
 * and mention resolution. No truncation — embeds should display in full.
 */
export const formatEmbedContent = (
  content: string,
  context: HtmlFormattingContext,
): string => {
  if (!content) return '';

  // First escape HTML in the raw content
  let formatted = escapeHtml(content);

  // Discord markdown: bold, italic, underline, strikethrough, code
  // Order matters — process multi-char markers before single-char
  formatted = formatted.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // _italic_ too, but not an underscore inside a word (snake_case stays)
  formatted = formatted.replace(/(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/gm, '$1<em>$2</em>');
  formatted = formatted.replace(/__(.+?)__/g, '<u>$1</u>');
  formatted = formatted.replace(/~~(.+?)~~/g, '<s>$1</s>');
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Discord headings: # ## ###
  formatted = formatted.replace(/^### (.+)$/gm, '<strong style="font-size: 0.9em;">$1</strong>');
  formatted = formatted.replace(/^## (.+)$/gm, '<strong style="font-size: 1em;">$1</strong>');
  formatted = formatted.replace(/^# (.+)$/gm, '<strong style="font-size: 1.1em;">$1</strong>');

  // Masked links: [text](url)
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #00aff4;">$1</a>');

  // Auto-linked URLs: <https://...> → clean link (after HTML escape, < becomes &lt;)
  formatted = formatted.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #00aff4;">$1</a>');

  // Bare URLs
  formatted = formatted.replace(/(?<![">])(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #00aff4;">$1</a>');

  // User mentions: <@123456> or <@!123456>
  // After HTML escape these become &lt;@123456&gt; or &lt;@!123456&gt;
  formatted = formatted.replace(/&lt;@!?(\d+)&gt;/g, (_match, userId) => {
    const user = context.userMap[userId];
    const displayName = escapeHtml(user?.displayName || user?.userName || 'Unknown User');
    return `<span class="user-mention">@${displayName}</span>`;
  });

  // Channel mentions: <#123456>
  formatted = formatted.replace(/&lt;#(\d+)&gt;/g, (_match, channelId) => {
    const channel = context.channelMap?.[channelId];
    const channelName = escapeHtml(channel?.name || 'unknown-channel');
    return `<span class="channel-mention">#${channelName}</span>`;
  });

  // Role mentions: <@&123456>
  formatted = formatted.replace(/&lt;@&amp;(\d+)&gt;/g, (_match, roleId) => {
    const role = Array.isArray(context.guildRoles)
      ? context.guildRoles.find((r) => r.id === roleId)
      : context.guildRoles?.[roleId];
    const roleName = escapeHtml(role?.name || 'Unknown Role');
    return `<span class="role-mention">@${roleName}</span>`;
  });

  // @everyone and @here
  formatted = formatted.replace(/@(everyone|here)/g,
    '<span class="everyone-mention">@$1</span>');

  // Custom emojis: <:name:id> or <a:name:id>
  // After escape: &lt;:name:id&gt; or &lt;a:name:id&gt;
  formatted = formatted.replace(/&lt;(a)?:(\w+):(\d+)&gt;/g, (_match, animated, name, id) => {
    const emojiName = escapeHtml(name);
    const extension = animated ? 'gif' : 'png';
    return `<img src="https://cdn.discordapp.com/emojis/${id}.${extension}?size=32" class="custom-emoji" alt=":${emojiName}:" title=":${emojiName}:" />`;
  });

  // Discord timestamps <t:unix> and <t:unix:style>, same markup as the export
  // After escape: &lt;t:123:R&gt;
  formatted = formatted.replace(/&lt;t:(\d{1,13})(?::([tTdDfFR]))?&gt;/g, (_match, unix, style) =>
    renderTimestampHtml(Number(unix), style));

  // Subtext lines (-# text), small muted; the line's own newline goes with it
  // since the span is a block.
  formatted = formatted.replace(/^-#\s+(.+?)(\n|$)/gm, (_match, text) => renderSubtextHtml(text));

  // Newlines to <br>
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
};
