/**
 * Generates the embedded JavaScript for exported HTML pages.
 *
 * This is a self-contained vanilla JS IIFE that provides:
 * - Event delegation (click/mouseover on document.body)
 * - Popup/modal system (position, close-on-outside-click, escape key)
 * - Data access from embedded JSON block
 *
 * The JS is designed for progressive enhancement — the page is
 * fully readable without it.
 */

import type { Message } from 'discrub-core/types/discord-types';
import type { ExportReactionMap, ExportUserMap } from 'discrub-core/types/discrub-types';
import { renderEmojiAsHtml } from 'discrub-core/export-utils';
import { getUserRoleColor } from '@/utils/roleColorUtils';
import type { HtmlFormattingContext } from 'discrub-core/types/html-formatting-types';
import {
  type ExportThemeSet,
  defaultExportThemeSet,
  buildThemeOptionsJson,
} from './exportThemes';
import { scriptJson, viewerStrings } from './exportStrings';
import { exportSlug } from '@/utils/exportFileName';
import { t as translate } from '@/i18n';

export interface ExportUserData {
  username: string;
  discriminator?: string;
  displayName?: string;
  serverNickname?: string;
  avatar?: string | null;
  avatarUrl?: string;
  bot?: boolean;
  flags?: number;
  accentColor?: number | null;
  banner?: string | null;
  messageCount: number;
  roleColor?: string;
  roles?: Array<{ name: string; color: string | null; icon: string | null; iconLocalUrl?: string; roleId: string; unicodeEmoji: string | null }>;
}

export interface ReactionUserInfo {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface ReactionEmojiData {
  emoji: string; // rendered emoji text or name
  count: number;
  users: ReactionUserInfo[];
  /** 2.2.9: the reactor lookup was attempted and refused (message deleted or no longer readable), so the list is empty while the count is not. */
  unavailable?: boolean;
}

// messageId -> { emojiKey -> ReactionEmojiData }
export type ReactionDataMap = Record<string, Record<string, ReactionEmojiData>>;

export interface ExportPageData {
  page: {
    current: number;
    total: number;
    baseFilename: string;
  };
  users: Record<string, ExportUserData>;
  threads: Record<string, string>; // messageId -> threadFilename
  reactions: ReactionDataMap;
}

/**
 * Build the export page data object from available context.
 */
export function buildExportPageData(
  messages: Message[],
  pageNumber: number,
  totalPages: number,
  sanitizedName: string,
  formattingContext?: HtmlFormattingContext,
  reactionMap?: ExportReactionMap,
  avatarMap?: Record<string, string>,
  cachedUserMap?: ExportUserMap,
  guildId?: string | null,
  guildRoles?: { id: string; color: number; position: number }[],
  emojiMap?: Record<string, string>,
  roleMap?: Record<string, string>,
): ExportPageData {
  // Count messages per user
  const userMessageCounts: Record<string, number> = {};
  const threadMap: Record<string, string> = {};

  for (const msg of messages) {
    if (msg.author?.id) {
      userMessageCounts[msg.author.id] = (userMessageCounts[msg.author.id] || 0) + 1;
    }
    // Build thread map from messages that spawned threads.
    // #175: keep this filename in sync with ExportService.sanitizeFilename
    // (lowercase + `_` collapse + thread.id suffix) so the embedded
    // client JS resolves to the actual on-disk thread file. Pre-#175
    // this used a different slug shape and broke for any thread whose
    // name had uppercase or non-alphanumeric chars.
    const thread = (msg as any).thread;
    if (thread?.id && thread?.name) {
      const slug = exportSlug(thread.name as string);
      const threadFilename = `threads/${slug}_${thread.id}.html`;
      threadMap[msg.id] = threadFilename;
    }
  }

  // Build user data from message authors (richest source of User object fields)
  const users: ExportPageData['users'] = {};
  const seenAuthors = new Map<string, any>();

  // Collect author objects and mentioned user objects from messages
  for (const msg of messages) {
    if (msg.author?.id && !seenAuthors.has(msg.author.id)) {
      seenAuthors.set(msg.author.id, msg.author);
    }
    // Discord provides full User objects for mentioned users
    if (msg.mentions) {
      for (const mentioned of msg.mentions) {
        if (mentioned.id && !seenAuthors.has(mentioned.id)) {
          seenAuthors.set(mentioned.id, mentioned);
        }
      }
    }
  }

  // Build user entries from message authors + formatting context
  for (const [userId, author] of seenAuthors) {
    const contextUser = formattingContext?.userMap?.[userId];
    const avatarHash = author.avatar;
    const avatarMapKey = avatarHash ? `${userId}/${avatarHash}` : '';
    const localAvatar = avatarMapKey ? avatarMap?.[avatarMapKey] : undefined;
    const avatarUrl = localAvatar
      ? localAvatar.replace(`${sanitizedName}/`, '')
      : avatarHash
        ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${avatarHash.startsWith('a_') ? 'gif' : 'png'}?size=256`
        : '';

    users[userId] = {
      username: contextUser?.userName || author.username || translate('export.unknownUser'),
      discriminator: author.discriminator || '0',
      displayName: contextUser?.displayName || author.global_name || undefined,
      avatar: avatarHash,
      avatarUrl,
      bot: author.bot || false,
      flags: author.public_flags || author.flags || undefined,
      accentColor: author.accent_color || undefined,
      banner: author.banner || undefined,
      messageCount: userMessageCounts[userId] || 0,
      roleColor: cachedUserMap && guildRoles
        ? getUserRoleColor(userId, guildId || null, cachedUserMap, guildRoles) || undefined
        : undefined,
      roles: (() => {
        if (!cachedUserMap || !guildRoles || !guildId) return undefined;
        const userData = cachedUserMap[userId];
        const userRoleIds = userData?.guilds?.[guildId]?.roles;
        if (!userRoleIds?.length) return undefined;
        const roleIdSet = new Set(userRoleIds);
        return guildRoles
          .filter((r: any) => roleIdSet.has(r.id) && r.name !== '@everyone')
          .sort((a: any, b: any) => b.position - a.position)
          .map((r: any) => {
            // Resolve local role-icon path if downloaded (#171). roleMap
            // keys are the full canonical CDN URL the live JS template
            // also constructs, so the lookup is direct. Strip the
            // entityName/ prefix the same way avatarUrl does so the
            // value is relative to the page (and is patched again by
            // prefixRelativeMediaPaths for nested thread files).
            const roleCdn = r.icon
              ? `https://cdn.discordapp.com/role-icons/${r.id}/${r.icon}.webp?size=20`
              : null;
            const local = roleCdn ? roleMap?.[roleCdn] : undefined;
            const iconLocalUrl = local
              ? local.replace(`${sanitizedName}/`, '')
              : undefined;
            return {
              name: r.name,
              color: r.color !== 0 ? '#' + r.color.toString(16).padStart(6, '0') : null,
              icon: r.icon || null,
              iconLocalUrl,
              roleId: r.id,
              unicodeEmoji: r.unicode_emoji || null,
            };
          });
      })(),
    };
  }

  // Add users from formatting context that didn't appear as message authors
  if (formattingContext?.userMap) {
    for (const [userId, userData] of Object.entries(formattingContext.userMap)) {
      if (!users[userId]) {
        users[userId] = {
          username: userData.userName || translate('export.unknownUser'),
          displayName: userData.displayName,
          messageCount: userMessageCounts[userId] || 0,
        };
      }
    }
  }

  // Build reaction data from messages, enriched with reactor user data if available
  const reactions: ReactionDataMap = {};
  for (const msg of messages) {
    if (msg.reactions && msg.reactions.length > 0) {
      reactions[msg.id] = {};
      for (const r of msg.reactions) {
        // Match discrub-core's getEncodedEmoji format: "name:id" for custom, "name" for standard
        const emojiKey = r.emoji?.id ? `${r.emoji.name}:${r.emoji.id}` : (r.emoji?.name || '?');
        // Look up reactor user data from the reaction map (if provided)
        const exportReactions = reactionMap?.[msg.id]?.[emojiKey] || [];
        const reactionUsers: ReactionUserInfo[] = exportReactions.map((er) => {
          // Prefer user data from the reaction API response (stored on ExportReaction)
          const avatarHash = er.avatar || seenAuthors.get(er.id)?.avatar;
          const username = er.username || formattingContext?.userMap?.[er.id]?.userName || seenAuthors.get(er.id)?.username || translate('export.unknownUser');
          // Check avatarMap for locally downloaded avatar, fall back to CDN
          const avatarMapKey = avatarHash ? `${er.id}/${avatarHash}` : '';
          const localAvatar = avatarMapKey ? avatarMap?.[avatarMapKey] : undefined;
          return {
            id: er.id,
            username,
            avatarUrl: localAvatar
              ? localAvatar.replace(`${sanitizedName}/`, '')
              : avatarHash
                ? `https://cdn.discordapp.com/avatars/${er.id}/${avatarHash}.${avatarHash.startsWith('a_') ? 'gif' : 'png'}?size=64`
                : '',
          };
        });

        // 2.2.9: core answers a refused lookup with an empty list (reactionMap holds
        // the key), so an empty list behind a non-zero count means "unavailable".
        const attempted = !!reactionMap?.[msg.id]?.[emojiKey];
        const unavailable = attempted && reactionUsers.length === 0 && (r.count || 0) > 0;
        reactions[msg.id][emojiKey] = {
          emoji: renderEmojiAsHtml(r.emoji || { name: '?' }, emojiMap, sanitizedName),
          count: r.count,
          users: reactionUsers,
          ...(unavailable ? { unavailable: true } : {}),
        };
      }
    }
  }

  return {
    page: {
      current: pageNumber,
      total: totalPages,
      baseFilename: sanitizedName,
    },
    users,
    threads: threadMap,
    reactions,
  };
}

/**
 * Generate the embedded JavaScript string for the exported HTML page.
 * This is a self-contained IIFE with no external dependencies.
 */
export function generateEmbeddedJs(themeSet?: ExportThemeSet): string {
  const resolvedThemeSet = themeSet ?? defaultExportThemeSet();
  // The JS is written as a template string that will be embedded in a <script> tag.
  // It reads data from <script type="application/json" id="export-data">.
  return `
(function() {
  'use strict';

  // ── Data Access ──────────────────────────────────────────────
  var dataEl = document.getElementById('export-data');
  var DATA = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};

  // 2.2.9: the page's own wording, in the language the export ran in.
  var L = ${scriptJson(viewerStrings())};
  function fill(s, o) { for (var k in o) { s = s.split('{' + k + '}').join(o[k]); } return s; }

  // ── Popup System ─────────────────────────────────────────────
  var activePopup = null;

  function createPopup(html, anchorEl) {
    closePopup();

    var popup = document.createElement('div');
    popup.className = 'discrub-popup';
    popup.innerHTML = html;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    document.body.appendChild(popup);

    // Position near anchor
    positionPopup(popup, anchorEl);

    activePopup = popup;

    // Close on click outside (defer to avoid immediate close)
    setTimeout(function() {
      document.addEventListener('click', onOutsideClick);
    }, 0);

    return popup;
  }

  function positionPopup(popup, anchor) {
    var rect = anchor.getBoundingClientRect();

    var top = rect.bottom + 8;
    var left = rect.left;

    // Use fixed positioning so popup is out of document flow entirely
    popup.style.position = 'fixed';
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.zIndex = '1000';

    // After render, check if it overflows viewport
    requestAnimationFrame(function() {
      var popupRect = popup.getBoundingClientRect();

      // Flip horizontally if overflowing right
      if (popupRect.right > window.innerWidth - 16) {
        popup.style.left = Math.max(16, window.innerWidth - popupRect.width - 16) + 'px';
      }

      // Flip vertically if overflowing bottom
      if (popupRect.bottom > window.innerHeight - 16) {
        popup.style.top = Math.max(16, rect.top - popupRect.height - 8) + 'px';
      }
    });
  }

  function closePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
      document.removeEventListener('click', onOutsideClick);
    }
  }

  function onOutsideClick(e) {
    if (activePopup && !activePopup.contains(e.target)) {
      closePopup();
    }
  }

  // ── Keyboard Handler ─────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (lightboxOverlay) {
        closeLightbox();
        e.preventDefault();
        return;
      }
      if (activePopup) {
        closePopup();
        e.preventDefault();
        return;
      }
    }

    // Lightbox arrow navigation
    if (lightboxOverlay) {
      if (e.key === 'ArrowLeft') { lightboxPrev(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { lightboxNext(); e.preventDefault(); }
      return;
    }
  });

  // ── Event Delegation ─────────────────────────────────────────
  document.body.addEventListener('click', function(e) {
    var target = e.target;

    // Walk up to find element with data-action
    while (target && target !== document.body) {
      var action = target.getAttribute('data-action');
      if (action) {
        handleAction(action, target, e);
        return;
      }
      target = target.parentElement;
    }
  });

  function handleAction(action, el, e) {
    switch (action) {
      case 'show-user':
        showUserPopup(el);
        e.preventDefault();
        break;
      case 'show-reactions':
        showReactionsPopup(el);
        e.preventDefault();
        e.stopPropagation();
        break;
      case 'jump-to-reply':
        jumpToReply(el);
        e.preventDefault();
        break;
      case 'toggle-spoiler':
        toggleSpoiler(el);
        e.preventDefault();
        break;
      case 'open-lightbox':
        openLightbox(el);
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  // Also handle clicks on .user-mention spans (generated by discrub-core with data-user-id)
  document.body.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target !== document.body) {
      if (target.classList && target.classList.contains('user-mention') && target.getAttribute('data-user-id')) {
        showUserPopup(target);
        e.preventDefault();
        return;
      }
      target = target.parentElement;
    }
  });

  // ── Action Handlers ──────────────────────────────────────────

  // ── User Flag Labels ───────────────────────────────────────────
  var FLAG_LABELS = {
    1: 'Discord Staff', 2: 'Partnered Server Owner', 4: 'HypeSquad Events',
    8: 'Bug Hunter Level 1', 64: 'HypeSquad Bravery', 128: 'HypeSquad Brilliance',
    256: 'HypeSquad Balance', 512: 'Early Supporter', 16384: 'Bug Hunter Level 2',
    65536: 'Verified Bot', 131072: 'Early Verified Bot Developer',
    262144: 'Moderator Programs Alumni', 4194304: 'Active Developer'
  };

  function getFlagBadges(flags) {
    if (!flags) return '';
    var badges = [];
    for (var bit in FLAG_LABELS) {
      if (flags & parseInt(bit)) {
        badges.push('<span class="user-popup-badge">' + FLAG_LABELS[bit] + '</span>');
      }
    }
    return badges.length > 0
      ? '<div class="user-popup-section"><div class="user-popup-section-title">' + escapeHtml(L.badges) + '</div><div class="user-popup-badges">' + badges.join('') + '</div></div>'
      : '';
  }

  function showUserPopup(el) {
    var userId = el.getAttribute('data-user-id');
    if (!userId || !DATA.users) return;

    var user = DATA.users[userId];
    if (!user) return;

    var accentHex = user.accentColor ? '#' + ('000000' + user.accentColor.toString(16)).slice(-6) : '#5865f2';
    var primaryName = user.displayName || user.username;

    var html = '<div class="user-popup-card">'
      // Banner / accent strip
      + '<div class="user-popup-banner" style="background:' + (user.banner ? 'linear-gradient(135deg, ' + accentHex + ', ' + accentHex + 'dd)' : 'linear-gradient(135deg, ' + accentHex + ', ' + accentHex + 'bb)') + '"></div>'
      // Avatar
      + '<div class="user-popup-avatar-row">'
      + (user.avatarUrl
        ? '<img src="' + user.avatarUrl + '" class="user-popup-avatar" alt="' + escapeHtml(user.username) + '">'
        : '<div class="user-popup-avatar-placeholder">' + escapeHtml((user.username || '?')[0].toUpperCase()) + '</div>')
      + (user.bot ? '<span class="user-popup-bot-badge">' + escapeHtml(L.bot) + '</span>' : '')
      + '</div>'
      // Primary name
      + '<div class="user-popup-name"' + (user.roleColor ? ' style="color:' + user.roleColor + '"' : '') + '>' + escapeHtml(primaryName) + '</div>'
      // Username#discriminator
      + '<div class="user-popup-username">' + escapeHtml(user.username) + (user.discriminator && user.discriminator !== '0' ? '#' + user.discriminator : '') + '</div>'
      // Divider
      + '<div class="user-popup-divider"></div>'
      // Names section (if display name differs from username)
      + (user.serverNickname
        ? '<div class="user-popup-row"><span class="user-popup-label">' + escapeHtml(L.serverNickname) + '</span><span class="user-popup-value">' + escapeHtml(user.serverNickname) + '</span></div>'
        : '')
      + (user.displayName && user.displayName !== user.username
        ? '<div class="user-popup-row"><span class="user-popup-label">' + escapeHtml(L.displayName) + '</span><span class="user-popup-value">' + escapeHtml(user.displayName) + '</span></div>'
        : '')
      // Account details
      + '<div class="user-popup-section"><div class="user-popup-section-title">' + escapeHtml(L.accountDetails) + '</div>'
      + '<div class="user-popup-row"><span class="user-popup-label">' + escapeHtml(L.userId) + '</span><span class="user-popup-value user-popup-mono">' + escapeHtml(userId) + '</span></div>'
      + '</div>'
      // Badges
      + getFlagBadges(user.flags)
      // Roles
      + (user.roles && user.roles.length > 0
        ? '<div class="user-popup-section"><div class="user-popup-section-title">' + escapeHtml(L.roles) + '</div><div class="user-popup-badges">'
          + user.roles.map(function(r) {
              var style = r.color ? 'background:' + r.color + '22;color:' + r.color + ';border-color:' + r.color + '66' : '';
              var iconSrc = r.iconLocalUrl
                ? r.iconLocalUrl
                : r.icon
                  ? 'https://cdn.discordapp.com/role-icons/' + r.roleId + '/' + r.icon + '.webp?size=20'
                  : null;
              var iconHtml = iconSrc
                ? '<img src="' + iconSrc + '" style="width:12px;height:12px;vertical-align:middle;margin-right:4px">'
                : r.unicodeEmoji
                  ? '<span style="font-size:12px;margin-right:4px;vertical-align:middle">' + r.unicodeEmoji + '</span>'
                  : r.color
                    ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + r.color + ';margin-right:4px;vertical-align:middle"></span>'
                    : '';
              return '<span class="user-popup-badge" style="' + style + '">' + iconHtml + escapeHtml(r.name) + '</span>';
            }).join('')
          + '</div></div>'
        : '')
      // Message count
      + '<div class="user-popup-divider"></div>'
      + '<div class="user-popup-count">' + escapeHtml(fill(user.messageCount === 1 ? L.messagesOne : L.messagesOther, { count: user.messageCount })) + '</div>'
      + '</div>';

    createPopup(html, el);
  }

  // ── Reaction Popup ────────────────────────────────────────────

  var REACTION_PAGE_SIZE = 20;

  function showReactionsPopup(el) {
    var msgId = el.getAttribute('data-message-id');
    var clickedKey = el.getAttribute('data-emoji-key');
    if (!msgId || !DATA.reactions || !DATA.reactions[msgId]) return;

    var msgReactions = DATA.reactions[msgId];
    var emojiKeys = Object.keys(msgReactions);
    if (emojiKeys.length === 0) return;

    // Collect all user items per tab (data only, not DOM)
    var tabData = {};
    var allItems = [];
    for (var j = 0; j < emojiKeys.length; j++) {
      var rk = emojiKeys[j];
      var rData = msgReactions[rk];
      var items = [];
      if (rData.users && rData.users.length > 0) {
        for (var u = 0; u < rData.users.length; u++) {
          var item = { user: rData.users[u], emoji: rData.emoji };
          items.push(item);
          allItems.push(item);
        }
      }
      tabData[rk] = { items: items, emoji: rData.emoji, count: rData.count, unavailable: !!rData.unavailable };
    }
    // 2.2.9: a refused lookup leaves an empty list behind a count; say so instead of showing nothing.
    var anyUnavailable = false;
    for (var q = 0; q < emojiKeys.length; q++) { if (msgReactions[emojiKeys[q]].unavailable) anyUnavailable = true; }
    tabData['all'] = { items: allItems, emoji: '', count: allItems.length, unavailable: allItems.length === 0 && anyUnavailable };

    var hasUserData = allItems.length > 0;

    // Build tabs
    var tabsHtml = '<div class="reaction-popup-tabs">';
    tabsHtml += '<button class="reaction-tab active" data-tab="all">' + escapeHtml(L.all) + '</button>';
    for (var i = 0; i < emojiKeys.length; i++) {
      var key = emojiKeys[i];
      var rd = msgReactions[key];
      tabsHtml += '<button class="reaction-tab" data-tab="' + key + '">' + rd.emoji + ' ' + rd.count + '</button>';
    }
    tabsHtml += '</div>';

    // Search bar (only if user data exists)
    var searchHtml = hasUserData
      ? '<div class="reaction-search-bar"><input class="reaction-search-input" type="text" placeholder="' + escapeHtml(L.searchUsers) + '" /></div>'
      : '';

    // Content container (will be populated dynamically)
    var contentHtml = '<div class="reaction-popup-content"></div>';

    var popup = createPopup(
      '<div class="reaction-popup-card">' + tabsHtml + searchHtml + contentHtml + '</div>',
      el
    );

    // State for the popup
    var currentTab = clickedKey && msgReactions[clickedKey] ? clickedKey : 'all';
    var currentSearch = '';
    var loadedCount = 0;

    function getFilteredItems() {
      var items = tabData[currentTab] ? tabData[currentTab].items : [];
      if (!currentSearch) return items;
      var q = currentSearch.toLowerCase();
      return items.filter(function(item) {
        return item.user.username.toLowerCase().indexOf(q) !== -1;
      });
    }

    function renderContent() {
      var contentEl = popup.querySelector('.reaction-popup-content');
      if (!contentEl) return;

      var filtered = getFilteredItems();

      if (!hasUserData) {
        // Count-only mode
        var countHtml = '<div class="reaction-count-list">';
        for (var i = 0; i < emojiKeys.length; i++) {
          var rd = msgReactions[emojiKeys[i]];
          countHtml += '<div class="reaction-count-row">'
            + '<span class="reaction-count-emoji">' + rd.emoji + '</span>'
            + '<span class="reaction-count-text">' + rd.count + ' user' + (rd.count !== 1 ? 's' : '') + '</span>'
            + '</div>';
        }
        countHtml += '</div>';
        contentEl.innerHTML = countHtml;
        return;
      }

      var showEmoji = currentTab === 'all';
      var toShow = filtered.slice(0, loadedCount + REACTION_PAGE_SIZE);
      loadedCount = toShow.length;
      var remaining = filtered.length - toShow.length;

      var html = '<div class="reaction-user-list">';
      for (var k = 0; k < toShow.length; k++) {
        var item = toShow[k];
        html += '<div class="reaction-user-row">';
        html += item.user.avatarUrl
          ? '<img src="' + item.user.avatarUrl + '" class="reaction-user-avatar">'
          : '<div class="reaction-user-avatar-placeholder">' + escapeHtml((item.user.username || '?')[0].toUpperCase()) + '</div>';
        html += '<span class="reaction-user-name">' + escapeHtml(item.user.username) + '</span>';
        if (showEmoji) {
          html += '<span class="reaction-user-emoji">' + item.emoji + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';

      if (remaining > 0) {
        html += '<button class="reaction-show-more">' + escapeHtml(fill(L.showMore, { count: remaining })) + '</button>';
      }

      if (filtered.length === 0 && currentSearch) {
        html = '<div class="reaction-count-only">' + escapeHtml(fill(L.noUsersMatching, { query: currentSearch })) + '</div>';
      } else if (filtered.length === 0 && tabData[currentTab] && tabData[currentTab].unavailable) {
        html = '<div class="reaction-count-only reaction-unavailable">' + escapeHtml(L.reactorsUnavailable) + '</div>';
      }

      contentEl.innerHTML = html;
    }

    // Initial render
    if (clickedKey && msgReactions[clickedKey]) {
      // Activate the clicked tab
      var tabs = popup.querySelectorAll('.reaction-tab');
      for (var t = 0; t < tabs.length; t++) {
        tabs[t].classList.toggle('active', tabs[t].getAttribute('data-tab') === currentTab);
      }
    }
    renderContent();

    // Wire events
    popup.addEventListener('click', function(e) {
      var target = e.target;

      // Tab click
      if (target.classList && target.classList.contains('reaction-tab')) {
        currentTab = target.getAttribute('data-tab');
        loadedCount = 0;
        var allTabs = popup.querySelectorAll('.reaction-tab');
        for (var i = 0; i < allTabs.length; i++) {
          allTabs[i].classList.toggle('active', allTabs[i].getAttribute('data-tab') === currentTab);
        }
        renderContent();
      }

      // Show more click
      if (target.classList && target.classList.contains('reaction-show-more')) {
        e.stopPropagation();
        renderContent();
      }
    });

    // Search input
    var searchInput = popup.querySelector('.reaction-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        currentSearch = searchInput.value;
        loadedCount = 0;
        renderContent();
      });
      // Prevent popup close when clicking search
      searchInput.addEventListener('click', function(e) {
        e.stopPropagation();
      });
    }
  }

  function toggleSpoiler(el) {
    el.classList.toggle('spoiler-revealed');
  }

  // ── Image Lightbox ────────────────────────────────────────────

  var lightboxOverlay = null;
  var lightboxImages = [];
  var lightboxIndex = 0;

  function collectLightboxImages() {
    lightboxImages = [];
    var imgs = document.querySelectorAll('[data-action="open-lightbox"]');
    for (var i = 0; i < imgs.length; i++) {
      lightboxImages.push(imgs[i].getAttribute('src'));
    }
  }

  function openLightbox(el) {
    collectLightboxImages();
    // Index by the element's DOM position, not its data-img-index attribute:
    // some blocks (e.g. forwarded snapshots, #214) are emitted in a different
    // source order than their DOM placement, so the attribute can diverge from
    // the DOM-ordered lightboxImages array and open the wrong image.
    var imgs = document.querySelectorAll('[data-action="open-lightbox"]');
    var idx = Array.prototype.indexOf.call(imgs, el);
    lightboxIndex = idx >= 0 ? idx : parseInt(el.getAttribute('data-img-index') || '0', 10);
    showLightboxImage();
  }

  function showLightboxImage() {
    closeLightbox();

    if (lightboxImages.length === 0) return;
    var src = lightboxImages[lightboxIndex];

    var overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';

    var img = document.createElement('img');
    img.className = 'lightbox-img';
    img.src = src;

    var closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function(e) { e.stopPropagation(); closeLightbox(); });

    overlay.appendChild(img);
    overlay.appendChild(closeBtn);

    // Navigation arrows (only if multiple images)
    if (lightboxImages.length > 1) {
      var prevBtn = document.createElement('button');
      prevBtn.className = 'lightbox-nav lightbox-nav-prev';
      prevBtn.innerHTML = '&#8249;';
      prevBtn.addEventListener('click', function(e) { e.stopPropagation(); lightboxPrev(); });

      var nextBtn = document.createElement('button');
      nextBtn.className = 'lightbox-nav lightbox-nav-next';
      nextBtn.innerHTML = '&#8250;';
      nextBtn.addEventListener('click', function(e) { e.stopPropagation(); lightboxNext(); });

      var counter = document.createElement('div');
      counter.className = 'lightbox-counter';
      counter.textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length;

      overlay.appendChild(prevBtn);
      overlay.appendChild(nextBtn);
      overlay.appendChild(counter);
    }

    // Close on backdrop click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeLightbox();
    });

    document.body.appendChild(overlay);
    lightboxOverlay = overlay;
  }

  function closeLightbox() {
    if (lightboxOverlay) {
      lightboxOverlay.remove();
      lightboxOverlay = null;
    }
  }

  function lightboxPrev() {
    lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
    showLightboxImage();
  }

  function lightboxNext() {
    lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
    showLightboxImage();
  }

  // ── Jump to Reply ────────────────────────────────────────────

  function jumpToReply(el) {
    var targetId = el.getAttribute('data-target-id');
    if (!targetId) return;

    var targetEl = document.getElementById('msg-' + targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight
      targetEl.classList.add('message-highlight');
      setTimeout(function() {
        targetEl.classList.remove('message-highlight');
      }, 2000);
    }
  }

  // ── Message Hover Toolbar ────────────────────────────────────
  var activeToolbar = null;

  function createToolbar(messageEl) {
    removeToolbar();

    var msgId = messageEl.getAttribute('data-message-id');
    if (!msgId) return;

    // SVG icons (Discord-style, minimal)
    var ICON_COPY = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    var ICON_ID = '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v7h7v9H6z"/></svg>';

    var toolbar = document.createElement('div');
    toolbar.className = 'msg-toolbar';

    function addBtn(icon, label, handler) {
      var btn = document.createElement('button');
      btn.className = 'msg-toolbar-btn';
      btn.innerHTML = icon + '<span class="msg-toolbar-label">' + escapeHtml(label) + '</span>';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handler();
      });
      toolbar.appendChild(btn);
    }

    // Copy text
    addBtn(ICON_COPY, L.copyText, function() {
      var textEl = messageEl.querySelector('.message-text');
      if (textEl) navigator.clipboard.writeText(textEl.textContent || '');
    });

    // Copy message ID
    addBtn(ICON_ID, L.copyId, function() {
      navigator.clipboard.writeText(msgId);
    });

    messageEl.appendChild(toolbar);
    activeToolbar = toolbar;
  }

  function removeToolbar() {
    if (activeToolbar) {
      activeToolbar.remove();
      activeToolbar = null;
    }
  }

  document.body.addEventListener('mouseover', function(e) {
    var target = e.target;
    while (target && target !== document.body) {
      if (target.classList && target.classList.contains('message') && target.getAttribute('data-message-id')) {
        if (!activeToolbar || activeToolbar.parentElement !== target) {
          createToolbar(target);
        }
        return;
      }
      target = target.parentElement;
    }
  });

  document.body.addEventListener('mouseout', function(e) {
    var target = e.target;
    var related = e.relatedTarget;
    // Only remove if we're leaving the message entirely
    while (target && target !== document.body) {
      if (target.classList && target.classList.contains('message')) {
        if (!target.contains(related)) {
          removeToolbar();
        }
        return;
      }
      target = target.parentElement;
    }
  });

  // ── Utilities ────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Theme Switcher ────────────────────────────────────────────
  // The export-time default is baked onto <html> (export-theme-<id>
  // class + :root vars); switching swaps the class. The light-theme
  // class carries structural light-base adjustments and follows the
  // active theme's base. localStorage persistence is best-effort.

  var themeSelect = document.getElementById('theme-select');
  var THEME_KEY = 'discrub-export-theme';
  var isEmbeddedInShell = window.parent !== window;
  var themes = ${buildThemeOptionsJson(resolvedThemeSet)};
  var defaultThemeId = ${JSON.stringify(resolvedThemeSet.defaultId)};

  function findTheme(id) {
    for (var i = 0; i < themes.length; i++) {
      if (themes[i].id === id) return themes[i];
    }
    return null;
  }

  // Legacy stored 'light'/'dark' values map onto the Discord themes;
  // unknown ids (a theme this export doesn't embed) are ignored.
  function normalizeThemeId(id) {
    if (id === 'light') id = 'discord-light';
    if (id === 'dark') id = 'discord-dark';
    return findTheme(id) ? id : null;
  }

  function applyTheme(themeId) {
    var theme = findTheme(themeId) || findTheme(defaultThemeId) || themes[0];
    var htmlEl = document.documentElement;
    htmlEl.className = htmlEl.className.replace(/\\bexport-theme-[\\w-]+/g, '').trim();
    htmlEl.classList.add('export-theme-' + theme.id);
    htmlEl.classList.toggle('light-theme', theme.base === 'light');
    if (themeSelect) themeSelect.value = theme.id;
    return theme.id;
  }

  // Hide own theme switcher when embedded in Discord shell (shell has its own)
  if (isEmbeddedInShell && themeSelect) {
    themeSelect.style.display = 'none';
  }

  // Load saved preference (only when standalone, not embedded)
  if (!isEmbeddedInShell) {
    try {
      var saved = normalizeThemeId(localStorage.getItem(THEME_KEY));
      if (saved && saved !== defaultThemeId) applyTheme(saved);
    } catch(e) {}
  }

  if (themeSelect) {
    themeSelect.addEventListener('change', function() {
      var applied = applyTheme(themeSelect.value);
      try { localStorage.setItem(THEME_KEY, applied); } catch(e) {}
      // Notify parent shell if embedded (switcher is hidden there, but
      // keep the sync path symmetric)
      if (isEmbeddedInShell) {
        try { window.parent.postMessage({ type: 'discrub-theme', themeId: applied }, '*'); } catch(e) {}
      }
    });
  }

  // Listen for theme changes from parent shell
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'discrub-theme' && typeof e.data.themeId === 'string') {
      applyTheme(e.data.themeId);
    }
  });

  // ── Search ────────────────────────────────────────────────────

  var searchInput = document.getElementById('search-input');
  var searchCount = document.getElementById('search-count');
  var searchClear = document.getElementById('search-clear');
  var searchActive = false;

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      performSearch(searchInput.value);
    });

    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        clearSearch();
        searchInput.blur();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', function(e) {
      e.stopPropagation();
      clearSearch();
    });
  }

  function performSearch(query) {
    var messages = document.querySelectorAll('.message');
    var dividers = document.querySelectorAll('.date-divider');

    if (!query || query.trim() === '') {
      clearSearch();
      return;
    }

    searchActive = true;
    var q = query.toLowerCase();
    var matchCount = 0;

    // Remove any previously injected search author labels
    var oldLabels = document.querySelectorAll('.search-author-label');
    for (var ol = 0; ol < oldLabels.length; ol++) oldLabels[ol].remove();

    // Build author map: for each message, find its group's author
    var lastAuthor = '';
    var lastTimestamp = '';
    var authorMap = {};
    for (var m = 0; m < messages.length; m++) {
      var authorEl = messages[m].querySelector('.author');
      var tsEl = messages[m].querySelector('.timestamp');
      if (authorEl) {
        lastAuthor = authorEl.textContent || '';
        lastTimestamp = tsEl ? tsEl.textContent || '' : '';
      }
      var msgId = messages[m].getAttribute('data-message-id');
      if (msgId) authorMap[msgId] = { author: lastAuthor, timestamp: lastTimestamp };
    }

    // Show/hide messages based on search
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var textEl = msg.querySelector('.message-text');
      var searchAuthor = msg.querySelector('.author');
      var text = (textEl ? textEl.textContent : '') + ' ' + (searchAuthor ? searchAuthor.textContent : '');

      // For grouped messages, also search the group's author name
      if (msg.classList.contains('message-grouped')) {
        var mid = msg.getAttribute('data-message-id');
        if (mid && authorMap[mid]) text += ' ' + authorMap[mid].author;
      }

      // Also search attachment filenames
      var attachNames = msg.querySelectorAll('.attachment-name');
      for (var a = 0; a < attachNames.length; a++) {
        text += ' ' + attachNames[a].textContent;
      }

      if (text.toLowerCase().indexOf(q) !== -1) {
        msg.classList.remove('search-hidden');
        matchCount++;

        // For grouped messages, inject a temporary author label so the result has context
        if (msg.classList.contains('message-grouped')) {
          var gmid = msg.getAttribute('data-message-id');
          if (gmid && authorMap[gmid]) {
            var label = document.createElement('div');
            label.className = 'search-author-label';
            label.innerHTML = '<span class="author" style="font-size:13px">' + authorMap[gmid].author + '</span> <span class="timestamp" style="font-size:11px">' + authorMap[gmid].timestamp + '</span>';
            var contentEl = msg.querySelector('.message-content');
            if (contentEl) contentEl.insertBefore(label, contentEl.firstChild);
          }
        }
      } else {
        msg.classList.add('search-hidden');
      }
    }

    // Hide date dividers that have no visible messages after them
    for (var d = 0; d < dividers.length; d++) {
      var divider = dividers[d];
      var nextEl = divider.nextElementSibling;
      var hasVisible = false;
      while (nextEl && !nextEl.classList.contains('date-divider')) {
        if (nextEl.classList.contains('message') && !nextEl.classList.contains('search-hidden')) {
          hasVisible = true;
          break;
        }
        nextEl = nextEl.nextElementSibling;
      }
      divider.classList.toggle('search-hidden', !hasVisible);
    }

    // Update count display
    var total = messages.length;
    if (searchCount) searchCount.textContent = fill(L.searchCount, { count: matchCount, total: total });
    if (searchClear) searchClear.style.display = '';
  }

  function clearSearch() {
    searchActive = false;
    var messages = document.querySelectorAll('.message');
    var dividers = document.querySelectorAll('.date-divider');
    for (var i = 0; i < messages.length; i++) {
      messages[i].classList.remove('search-hidden');
    }
    for (var d = 0; d < dividers.length; d++) {
      dividers[d].classList.remove('search-hidden');
    }
    // Remove injected search author labels from grouped messages
    var labels = document.querySelectorAll('.search-author-label');
    for (var l = 0; l < labels.length; l++) labels[l].remove();
    if (searchInput) searchInput.value = '';
    if (searchCount) searchCount.textContent = '';
    if (searchClear) searchClear.style.display = 'none';
  }

  // Ctrl+F / Cmd+F to focus search instead of browser find
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // ── Jump to Top ───────────────────────────────────────────────
  var jumpTopBtn = document.getElementById('jump-top');
  if (jumpTopBtn) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 500) {
        jumpTopBtn.classList.add('visible');
      } else {
        jumpTopBtn.classList.remove('visible');
      }
    });

    jumpTopBtn.addEventListener('click', function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ── Keyboard Navigation ──────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    // Skip if popup/lightbox/search is open, or user is typing in an input
    if (activePopup) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    var page = DATA.page;
    if (!page || page.total <= 1) return;

    if (e.key === 'ArrowLeft' && page.current > 1) {
      window.location.href = page.baseFilename + '-page-' + (page.current - 1) + '.html';
    } else if (e.key === 'ArrowRight' && page.current < page.total) {
      window.location.href = page.baseFilename + '-page-' + (page.current + 1) + '.html';
    }
  });

  // ── Public API (for testing/extension) ───────────────────────
  window.__discrubExport = {
    getData: function() { return DATA; },
    closePopup: closePopup,
    getActivePopup: function() { return activePopup; },
  };

})();
`;
}
