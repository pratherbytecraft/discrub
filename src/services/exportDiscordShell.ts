/**
 * Discord Shell Layout Generator (Phase 11 — Experimental)
 *
 * Generates an HTML wrapper that mimics Discord's UI layout:
 * - Server icon sidebar (72px)
 * - Channel/DM sidebar (240px)
 * - Top bar with channel name and search
 * - Main content area (standard export HTML embedded or loaded via iframe)
 *
 * Completely isolated from the standard template — does not modify generateHTMLPage.
 */

import { t as translate } from '@/i18n';
import { EXPORT_FONT_STACK, exportLangTag } from './exportStrings';
import {
  type ExportThemeSet,
  defaultExportThemeSet,
  buildShellThemeCSS,
  buildThemeOptionsJson,
  buildThemeSelectHtml,
} from './exportThemes';

export interface DiscordShellChannel {
  id: string;
  name: string;
  filename: string;
  type?: 'text' | 'voice' | 'thread';
  category?: string;
}

export interface DiscordShellOptions {
  serverName: string;
  serverIcon?: string;
  channels: DiscordShellChannel[];
  activeChannelId: string;
  isDM: boolean;
  dmRecipients?: { name: string; avatar?: string }[];
  exportDate: string;
  /** IDs of channels that were actually exported (others are shown as disabled) */
  exportedChannelIds?: string[];
  /**
   * Themes embedded in the export (slot E). Defaults to the free set
   * with Discord Dark baked, matching pre-theming behavior; callers
   * pass the resolved set (active app theme default, supporter themes
   * included only with a valid key at export time).
   */
  themeSet?: ExportThemeSet;
}

/**
 * Generate a Discord shell wrapper for single-channel exports.
 * Embeds the content HTML directly in the main area (no iframe).
 */
export function generateDiscordShellSingle(
  contentHtml: string,
  options: DiscordShellOptions,
): string {
  const activeChannel = options.channels.find((c) => c.id === options.activeChannelId);
  const channelName = activeChannel?.name || 'channel';
  const themeSet = options.themeSet ?? defaultExportThemeSet();

  return `<!DOCTYPE html>
<html lang="${exportLangTag()}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.serverName} · #${channelName}</title>
  <style>${getShellCSS(themeSet)}</style>
</head>
<body>
  <div class="discord-shell">
    ${renderServerSidebar(options)}
    ${renderChannelSidebar(options)}
    <div class="shell-main">
      ${renderTopBar(channelName, options, themeSet)}
      <div class="shell-content shell-content-iframe">
        <iframe
          id="channel-frame"
          srcdoc="${contentHtml.replace(/"/g, '&quot;')}"
          class="shell-iframe"
          title="${translate('export.page.channelContent')}"
        ></iframe>
      </div>
    </div>
  </div>
  <script>${getShellJS(options, themeSet)}</script>
</body>
</html>`;
}

/**
 * Generate a Discord shell wrapper for bulk exports.
 * Loads channel HTML files in an iframe via the sidebar navigation.
 */
export function generateDiscordShellBulk(
  options: DiscordShellOptions,
): string {
  const activeChannel = options.channels.find((c) => c.id === options.activeChannelId) || options.channels[0];
  const channelName = activeChannel?.name || 'channel';
  const themeSet = options.themeSet ?? defaultExportThemeSet();

  return `<!DOCTYPE html>
<html lang="${exportLangTag()}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.serverName} · Bulk Export</title>
  <style>${getShellCSS(themeSet)}</style>
</head>
<body>
  <div class="discord-shell">
    ${renderServerSidebar(options)}
    ${renderChannelSidebar(options)}
    <div class="shell-main">
      ${renderTopBar(channelName, options, themeSet)}
      <div class="shell-content shell-content-iframe">
        <iframe
          id="channel-frame"
          src="${activeChannel?.filename || ''}"
          class="shell-iframe"
          title="${translate('export.page.channelContent')}"
        ></iframe>
      </div>
    </div>
  </div>
  <script>${getShellJS(options, themeSet)}</script>
</body>
</html>`;
}

// ── Render Helpers ───────────────────────────────────────────────

function renderServerSidebar(options: DiscordShellOptions): string {
  const iconContent = options.serverIcon
    ? `<img src="${options.serverIcon}" alt="${options.serverName}" class="server-icon-img">`
    : `<div class="server-icon-placeholder">${(options.serverName || 'S')[0].toUpperCase()}</div>`;

  return `
    <div class="server-sidebar">
      <div class="server-icon-home" title="${translate('export.page.home')}">
        <svg width="28" height="20" viewBox="0 0 28 20"><path fill="currentColor" d="M23.0212 1.67671C21.3107 0.879656 19.5079 0.318797 17.6584 0C17.4062 0.461742 17.1749 0.934541 16.9708 1.4184C15.003 1.12145 12.9974 1.12145 11.0292 1.4184C10.8251 0.934541 10.5765 0.461742 10.3416 0C8.49079 0.318797 6.68533 0.8824 4.9788 1.67933C1.00996 7.92987 -0.0602092 14.0315 0.488283 20.0515C2.72065 21.7527 4.92398 22.7769 7.0925 23.4557C7.5691 22.8175 7.99568 22.1394 8.36294 21.4266C7.6823 21.1579 7.02723 20.8332 6.40461 20.4568C6.56213 20.3417 6.71698 20.2236 6.8672 20.1043C12.1765 22.5752 17.9553 22.5752 23.1939 20.1043C23.3454 20.2236 23.5003 20.3417 23.6553 20.4568C23.03 20.8345 22.3736 21.1592 21.6943 21.4266C22.0616 22.1394 22.4869 22.8175 22.9648 23.4557C25.1346 22.7769 27.3393 21.7527 29.5765 20.0515C30.2075 13.0568 28.5579 6.99907 23.0212 1.67671Z"/></svg>
      </div>
      <div class="server-separator"></div>
      <div class="server-icon" title="${options.serverName}">
        ${iconContent}
      </div>
    </div>`;
}

function renderChannelSidebar(options: DiscordShellOptions): string {
  const headerName = options.isDM ? translate('export.page.directMessages') : options.serverName;

  let channelListHtml = '';

  if (options.isDM && options.dmRecipients) {
    const exportedIds = options.exportedChannelIds
      ? new Set(options.exportedChannelIds)
      : new Set(options.channels.map((c) => c.id));

    channelListHtml = options.dmRecipients.map((r) => {
      const matchingChannel = options.channels.find((c) => c.name === r.name);
      const isActive = matchingChannel?.id === options.activeChannelId;
      const isExported = matchingChannel ? exportedIds.has(matchingChannel.id) : false;
      const classes = ['channel-item', 'dm-item'];
      if (isActive) classes.push('active');
      if (!isExported) classes.push('disabled');
      return `
        <div class="${classes.join(' ')}" data-channel-id="${matchingChannel?.id || r.name}">
          ${r.avatar
            ? `<img src="${r.avatar}" class="dm-avatar" alt="${r.name}">`
            : `<div class="dm-avatar-placeholder">${r.name[0].toUpperCase()}</div>`}
          <span class="channel-name">${escapeHtml(r.name)}</span>
        </div>`;
    }).join('');
  } else {
    // Group channels by category
    const categories = new Map<string, DiscordShellChannel[]>();
    const uncategorized: DiscordShellChannel[] = [];

    for (const ch of options.channels) {
      if (ch.category) {
        if (!categories.has(ch.category)) categories.set(ch.category, []);
        categories.get(ch.category)!.push(ch);
      } else {
        uncategorized.push(ch);
      }
    }

    // If exportedChannelIds is provided, only those channels are clickable
    const exportedIds = options.exportedChannelIds
      ? new Set(options.exportedChannelIds)
      : new Set(options.channels.map((c) => c.id)); // default: all exported

    const renderChannel = (ch: DiscordShellChannel) => {
      const isActive = ch.id === options.activeChannelId;
      const isExported = exportedIds.has(ch.id);
      const classes = ['channel-item'];
      if (isActive) classes.push('active');
      if (!isExported) classes.push('disabled');
      return `
        <div class="${classes.join(' ')}" data-channel-id="${ch.id}" data-filename="${ch.filename}">
          <span class="channel-hash">#</span>
          <span class="channel-name">${escapeHtml(ch.name)}</span>
        </div>`;
    };

    if (uncategorized.length > 0) {
      channelListHtml += uncategorized.map(renderChannel).join('');
    }

    for (const [category, channels] of categories) {
      channelListHtml += `
        <div class="channel-category">
          <span class="category-arrow">▾</span>
          <span class="category-name">${escapeHtml(category.toUpperCase())}</span>
        </div>`;
      channelListHtml += channels.map(renderChannel).join('');
    }
  }

  return `
    <div class="channel-sidebar">
      <div class="channel-sidebar-header">
        <span class="server-header-name">${escapeHtml(headerName)}</span>
      </div>
      <div class="channel-list">
        ${channelListHtml}
      </div>
      <div class="user-status-bar">
        <div class="user-status-avatar"></div>
        <div class="user-status-info">
          <span class="user-status-name">${translate('export.page.exportedStatus')}</span>
          <span class="user-status-detail">${options.exportDate}</span>
        </div>
      </div>
    </div>`;
}

function renderTopBar(
  channelName: string,
  options: DiscordShellOptions,
  themeSet: ExportThemeSet,
): string {
  const prefix = options.isDM ? '@' : '#';
  return `
    <div class="shell-topbar">
      <div class="topbar-left">
        <span class="topbar-channel-icon">${prefix}</span>
        <span class="topbar-channel-name" id="topbar-channel-name">${escapeHtml(channelName)}</span>
      </div>
      <div class="topbar-right">
        ${buildThemeSelectHtml(themeSet, 'shell-theme-select', 'shell-theme-select')}
      </div>
    </div>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Shell CSS ────────────────────────────────────────────────────

function getShellCSS(themeSet: ExportThemeSet): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

${buildShellThemeCSS(themeSet)}

    html, body { height: 100%; overflow: hidden; font-family: ${EXPORT_FONT_STACK}; background: var(--shell-bg); }

    .discord-shell {
      display: grid;
      grid-template-columns: 72px 240px 1fr;
      height: 100vh;
      background: var(--shell-bg);
    }

    /* ── Server Sidebar ── */
    .server-sidebar {
      background: var(--server-bg);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 12px;
      gap: 8px;
      overflow-y: auto;
    }

    .server-sidebar::-webkit-scrollbar { width: 0; }

    .server-icon-home {
      width: 48px;
      height: 48px;
      border-radius: 16px;
      background: var(--channel-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      cursor: pointer;
      transition: border-radius 200ms ease, background 200ms ease;
    }

    .server-icon-home:hover {
      border-radius: 12px;
      background: #5865f2;
      color: #fff;
    }

    .server-separator {
      width: 32px;
      height: 2px;
      background: var(--separator);
      border-radius: 1px;
    }

    .server-icon {
      width: 48px;
      height: 48px;
      border-radius: 24px;
      overflow: hidden;
      cursor: pointer;
      transition: border-radius 200ms ease;
    }

    .server-icon:hover { border-radius: 16px; }

    .server-icon-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .server-icon-placeholder {
      width: 100%;
      height: 100%;
      background: var(--channel-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 18px;
      color: var(--text-primary);
    }

    .server-icon:hover .server-icon-placeholder { background: #5865f2; color: #fff; }

    /* ── Channel Sidebar ── */
    .channel-sidebar {
      background: var(--channel-bg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .channel-sidebar-header {
      height: 48px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }

    .server-header-name {
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .channel-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .channel-list::-webkit-scrollbar { width: 4px; }
    .channel-list::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 4px; }
    .channel-list::-webkit-scrollbar-track { background: transparent; }

    .channel-category {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 16px 8px 4px 16px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-channels);
      text-transform: uppercase;
      letter-spacing: 0.02em;
      cursor: default;
    }

    .category-arrow { font-size: 10px; }

    .channel-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      margin: 1px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-channels);
      font-size: 15px;
      transition: background 100ms ease, color 100ms ease;
    }

    .channel-item:hover {
      background: var(--channel-hover);
      color: var(--text-secondary);
    }

    .channel-item.active {
      background: var(--channel-active);
      color: var(--text-primary);
    }

    .channel-item.disabled {
      opacity: 0.4;
      cursor: default;
      pointer-events: none;
    }

    .channel-hash {
      font-size: 18px;
      font-weight: 400;
      opacity: 0.5;
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }

    .channel-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* DM items */
    .dm-item { gap: 10px; padding: 8px; }

    .dm-avatar, .dm-avatar-placeholder {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      object-fit: cover;
    }

    .dm-avatar-placeholder {
      background: var(--channel-active);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
      color: #fff;
    }

    /* User status bar */
    .user-status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }

    .user-status-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #5865f2, #7289da);
      flex-shrink: 0;
    }

    .user-status-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      display: block;
    }

    .user-status-detail {
      font-size: 11px;
      color: var(--text-muted);
      display: block;
    }

    /* ── Top Bar ── */
    .shell-topbar {
      height: 48px;
      background: var(--topbar-bg);
      border-bottom: 1px solid rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      flex-shrink: 0;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .topbar-channel-icon {
      font-size: 20px;
      color: var(--text-muted);
      font-weight: 500;
    }

    .topbar-channel-name {
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary);
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .shell-theme-select {
      background: var(--channel-bg);
      border: 1px solid var(--separator);
      color: var(--text-secondary);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: color 150ms ease, background 150ms ease;
    }

    .shell-theme-select:hover, .shell-theme-select:focus {
      color: var(--text-primary);
      background: var(--channel-hover);
      outline: none;
    }

    /* ── Main Content ── */
    .shell-main {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--main-bg);
    }

    .shell-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }


    .shell-content-iframe {
      overflow: hidden;
      padding: 0;
    }


    .shell-iframe {
      width: 100%;
      height: 100%;
      border: none;
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .discord-shell {
        grid-template-columns: 1fr;
      }
      .server-sidebar, .channel-sidebar {
        display: none;
      }
    }

    /* ── Print ── */
    @media print {
      .server-sidebar, .channel-sidebar, .shell-topbar { display: none !important; }
      .discord-shell { display: block; }
      .shell-content { overflow: visible; }
    }

    /* ── Reduced motion ── */
    @media (prefers-reduced-motion: reduce) {
      * { transition-duration: 0.01ms !important; }
    }
  `;
}

// ── Shell JavaScript ─────────────────────────────────────────────

function getShellJS(options: DiscordShellOptions, themeSet: ExportThemeSet): string {
  const channelsJson = JSON.stringify(options.channels.map((c) => ({
    id: c.id,
    name: c.name,
    filename: c.filename,
  })));

  return `
(function() {
  'use strict';

  var channels = ${channelsJson};
  var isBulk = ${options.channels.length > 1 ? 'true' : 'false'};

  // ── Theme switcher ──
  // The baked default lives on :root; picking a theme adds a
  // shell-theme-<id> class that overrides it. localStorage persistence
  // is a best-effort nicety (works on file:// in normal windows, fails
  // silently in private ones) — the baked default is the guarantee.
  var themeSelect = document.getElementById('shell-theme-select');
  var THEME_KEY = 'discrub-shell-theme';
  var themes = ${buildThemeOptionsJson(themeSet)};
  var defaultThemeId = ${JSON.stringify(themeSet.defaultId)};

  function findTheme(id) {
    for (var i = 0; i < themes.length; i++) {
      if (themes[i].id === id) return themes[i];
    }
    return null;
  }

  // Legacy stored values from two-theme exports map onto the Discord
  // themes; unknown ids (e.g. a supporter theme this export doesn't
  // embed) fall back to the baked default.
  function normalizeThemeId(id) {
    if (id === 'light') id = 'discord-light';
    if (id === 'dark') id = 'discord-dark';
    return findTheme(id) ? id : null;
  }

  function applyTheme(themeId) {
    var theme = findTheme(themeId) || findTheme(defaultThemeId) || themes[0];
    var htmlEl = document.documentElement;
    htmlEl.className = htmlEl.className.replace(/\\bshell-theme-[\\w-]+/g, '').trim();
    htmlEl.classList.add('shell-theme-' + theme.id);
    if (themeSelect) themeSelect.value = theme.id;

    // Sync theme to content iframe via postMessage (works cross-origin and sandboxed)
    var frame = document.getElementById('channel-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'discrub-theme', themeId: theme.id }, '*');
    }
    return theme.id;
  }

  try {
    var saved = normalizeThemeId(localStorage.getItem(THEME_KEY));
    if (saved && saved !== defaultThemeId) applyTheme(saved);
  } catch(e) {}

  if (themeSelect) {
    themeSelect.addEventListener('change', function() {
      var applied = applyTheme(themeSelect.value);
      try { localStorage.setItem(THEME_KEY, applied); } catch(e) {}
    });
  }

  // Sync theme to iframe when it loads (re-send current theme)
  var frame = document.getElementById('channel-frame');
  if (frame) {
    frame.addEventListener('load', function() {
      var current = themeSelect ? themeSelect.value : defaultThemeId;
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'discrub-theme', themeId: current }, '*');
      }
    });
  }

  // Listen for theme changes from iframe content (when content's own switcher is used)
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'discrub-theme' && typeof e.data.themeId === 'string') {
      var normalized = normalizeThemeId(e.data.themeId);
      if (!normalized) return;
      var theme = findTheme(normalized);
      var htmlEl = document.documentElement;
      htmlEl.className = htmlEl.className.replace(/\\bshell-theme-[\\w-]+/g, '').trim();
      htmlEl.classList.add('shell-theme-' + theme.id);
      if (themeSelect) themeSelect.value = theme.id;
      try { localStorage.setItem(THEME_KEY, theme.id); } catch(e) {}
    }
  });

  // Channel navigation (bulk mode only)
  if (isBulk) {
    var channelItems = document.querySelectorAll('.channel-item');
    var iframe = document.getElementById('channel-frame');
    var topbarName = document.getElementById('topbar-channel-name');

    function activateChannel(channelId) {
      var channel = channels.find(function(c) { return c.id === channelId; });
      if (!channel || !iframe) return;

      iframe.src = channel.filename;
      if (topbarName) topbarName.textContent = channel.name;

      channelItems.forEach(function(item) {
        item.classList.toggle('active', item.getAttribute('data-channel-id') === channelId);
      });

      try { location.hash = 'channel-' + channelId; } catch(e) {}
    }

    channelItems.forEach(function(item) {
      item.addEventListener('click', function() {
        var id = item.getAttribute('data-channel-id');
        if (id) activateChannel(id);
      });
    });

    // Load channel from hash on page load
    var hash = location.hash.replace('#channel-', '');
    if (hash && channels.some(function(c) { return c.id === hash; })) {
      activateChannel(hash);
    }
  }
})();
`;
}
