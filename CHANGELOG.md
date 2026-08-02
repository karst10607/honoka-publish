# Changelog

## v1.11.0

- **MCP-only architecture**: Bridge daemon removed — Chrome Extension no longer depends on HTTP bridge; sync happens via AI assistants (Antigravity / Codex / Claude Desktop) using MCP stdio
- **New MCP tool**: `query-notion` — list / title-search pages in a Notion database
- **MCP tool aliases**: `read_doc` (→ read-clip), `save_and_sync` (→ save-and-push) snake_case variants
- **AnyType full CRUD via MCP**: `sync_to_anytype` / `search_anytype` / `read_anytype` / `delete_anytype` (creds via env or args)
- **New CLI**: `honoka-setup` — interactive MCP installer; detects Antigravity / Codex / Claude Desktop configs and writes the honoka entry (with backup)
- **Extension simplified**: removed clipper + Bridge polling; pure frontend (page tracking + token budget)
- **Popup**: shows own-feature status (tracking on/off, tracked count, Notion page detection) instead of Bridge status
- **Options page**: MCP Setup guide (3 steps + copy-paste AI prompt); removed Bridge URL / Notion PAT / auto-push settings and Sync button
- **Manifest**: permissions reduced to `storage` + `history`; host permissions to notion.so / notion.site
- **Fix**: list-docs / findClipBySlug directory depth limits (3/4 → 8)
- **Fix**: Notion URL construction dropped `/v1` prefix → 400 errors (now `new URL(base + path)`)
- **Docs**: `docs/mcp-configs.md` — MCP config examples for Antigravity / Claude Desktop / Codex

## v1.10.2

- Multi-source web tracking: auto-record visits to GitHub, Jira, Confluence, Google Drive
- Generic web tracker injected on matched domains via content_scripts
- URL-based dedup: SHA-256 hash of normalized URL as stable storage key
- Source-aware sidebar: History view shows all tracked entries
- Source icons (🐙 🔧 📋 📁 ✈️ 💬 🔵 🌐) shown inline in doc list title and source column
- Colored source badges in Source column for at-a-glance classification
- Bridge: new `/api/tracking/entries` endpoint for extension to poll
- Bridge: Telegram and Discord bot adapters record URL tracking entries
- Bridge: lightweight URL title fetcher (og:title / <title>) for bot-processed links
- Extension: auto-poll Bridge tracking entries via chrome.alarms (every 2 min)
- Manual "🔄 Sync" button on options page to pull Bridge tracking entries
- Bridge: telegramBotToken / discordBotToken configurable via API settings or env vars
- Discord bot adapter (discord.js) following same pattern as Telegram

## v1.10.0

- Auto-track Notion page visits (content script auto-injects on Notion pages)
- New History view in Doc Library sidebar showing tracked Notion pages
- Local tracking persists in chrome.storage, visible even when Bridge is offline
- Tracked pages open original Notion URL on click
- Storage queue prevents race conditions when multiple Notion tabs open
- History limit (200 entries) with automatic cleanup of oldest entries

## v1.9.0

- iTunes-style Doc Library options page with sidebar, sortable doc table, and metadata
- 4 themes: Dark, Light, Midnight, Sakura (persisted in chrome.storage)
- Search, filter, and export docs as JSON/CSV
- Bridge: recursive directory walk for date-nested Clips folder
- Bridge: source URL extraction from frontmatter in /api/docs
- MCP server mode for AI tool integration (default)
- Bridge HTTP server mode for Chrome Extension
- Dual-mode CLI: `honoka-publish` (MCP) / `honoka-publish bridge` (HTTP)
- Options page renamed to Doc Library; popup link updated

## v1.0.0

- Initial release: clip web pages to Markdown with Notion push
- Standalone mode (no Bridge required)
- Optional Bridge integration for disk saving
- Bridge status detection in popup
- Context menu: clip page, clip + push to Notion
- Options page for Notion PAT and Bridge URL config
