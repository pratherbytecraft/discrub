Discrub is a Discord data management tool. It runs as a browser extension on Discord. It exports messages, searches and filters conversations, purges messages and reactions, works with offline data packages, and analyzes your message history.

Discord Data Package
- Drop the official Discord ZIP (Privacy & Safety, Request All My Data) directly into Discrub
- Handles large packages (multi-gigabyte, tens of thousands of entries) and packages from any Discord locale
- Browse every server, channel, and DM in your archive without touching the Discord API
- Renders markdown, mentions, custom emojis, reply quotes, and embed previews
- Multi-attachment messages render every attachment, not just the first
- Optional rehydration fetches reactions, edits, and replies from Discord, cached so the API cost is paid once
- Bulk delete or bulk edit straight from the package
- Export package channels to HTML for portable archives
- Mention analytics across an entire package

Export
- Formats: HTML, CSV, JSON, plain text, media-only
- 10 built-in presets plus custom preset creation
- Downloads avatars, attachments, emojis, and media for offline viewing
- Thread messages exported as separate files
- HTML exports include search, image lightbox, system message rendering, and dark/light theme toggle
- Bulk export across multiple channels with filter support
- Streaming downloads stay flat in memory regardless of file size

Message Feed
- Discord-style chunked feed with role colors, role icons, reply indicators, and inline system messages (pins, joins, boosts, thread-created)
- Forwarded messages render their full content (text, attachments, embeds), in the feed and in exports
- Voice and Stage channel chat browsable alongside text channels
- Virtualized feed for large channels
- Click-to-jump on reply bars, pinned-message notices, and thread-created notices
- Find threads even when their starter message has been deleted, via the Load Thread modal
- Focused view hides the sidebar and status panel for full-width reading

Search and Filter
- Search hits Discord's API: filter by content, author, mentions, has-types (image, video, link, file, embed, sound, sticker, snapshot, poll, forward), date range with time-of-day precision, pinned status, author type
- Lazy pagination: results stream in as you scroll, with optional Load All
- Refine narrows already-loaded messages client-side, with no API calls; show only or hide a chosen system-message type

Purge
- Search-based message deletion with per-user targeting, with an optional opt-in to also delete chosen system-message categories (pins, joins, boosts)
- Attachments-only mode strips attachments while keeping text
- Reactions mode removes specific users' reactions
- Multi-channel bulk purge with filter support
- A final pass over each channel's newest messages catches what Discord's search index had not indexed yet
- Archived threads auto-unarchive during purge and re-archive when done

Reactions
- View who reacted, with avatars
- Remove individual reactions or batch-remove across selected messages
- Admin bulk removal of all reactions or all of a specific emoji

Analytics
- Mention counts across loaded messages
- CSV export of analytics data

Privacy
- Discord token stays in the browser
- All processing is local
- Your Discord data is never sent to any server of ours
- One optional exception. If you apply a supporter key, the extension checks in with api.pratherbytecraft.com about once a day to keep that key current. Only the key itself is sent, never an email address or any Discord data, and removing your key stops this entirely.

Supporter themes
- Every feature is free and stays free. Supporters unlock a pack of extra cosmetic themes.

Additional
- Interface in English or German, auto-detected on first run and switchable in Settings
- Theme picker with live preview, from Discord-style dark and light to terminal, high contrast, and more
- Forum channel support showing both active and archived posts
- Guided tour and contextual help icons
- Pause, resume, and cancel for long operations
- Status log with live operation feedback
- Configurable operation delays and automatic rest breaks on long runs
- Discrub Classic (v1) built in for legacy users

Click the Discrub icon while using Discord in your browser to start.
