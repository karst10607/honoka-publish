# Changelog

## v1.11.4

- **Full-page capture** (`src/integrations/capture.js`, ported from honoka-lite): headless Chromium full-page screenshot for article notes, uploaded to Joplin as a resource and embedded in the note body; browser closed after every capture
- **Site rules**: data-driven selectors / `window.dataLayer` mappings in `src/integrations/capture-rules.json` (591 price/ping/floor/layout/community); matched-rule data is appended to the note under "Captured data"; generic pages get title/heading/description
- **Graceful degradation**: missing Playwright package or Chromium binary yields `{ ok: false, reason }` — the pipeline silently saves a text-only note (install guidance in README)
- **Pipeline**: article path captures the page (bounded lazy-load scroll, networkidle tolerated-best-effort) and attaches the screenshot via `saveToJoplin` files
- **Tests**: 7 new tests (fake Playwright for generic + 591 rule + both degradation paths, real example.com Chromium capture that skips when unavailable) — 44/44 green locally

## v1.11.3

- **Telegram URL pipeline** (`src/integrations/url-pipeline.js`): links sent to the Telegram bot are classified — video platforms (YouTube, Bilibili, Twitter/X, Vimeo, TikTok, …) download via `yt-dlp --no-playlist` with throttled progress replies; everything else is extracted to markdown (Readability + jsdom + turndown, meta-tag fallback) — and both become Joplin notes
- **Resilience**: each step retries once; failures and Joplin outages queue the URL + reason into `<docs-dir>/Inbox/` and the bot replies with the queue path; videos over `videoMaxSizeMB` (default 500) are deleted and queued
- **Settings**: `videoDir` / `videoMaxSizeMB` via bridge settings API (validated); `/status` now reflects Telegram configuration; no-token startup log includes setup guidance
- **Telegram adapter**: `onUrl(url, { reply })` contract for interim + final replies; error replies redact `token=` values
- **Tests**: 22 new tests (pipeline 15, Telegram adapter 6 with stubbed bot, bridge settings/status 2) — 37/37 green; README gains the Telegram setup guide

## v1.11.2

- **New integration: Joplin** (`src/integrations/joplin.js`) — create notes in a configured notebook via the local Clipper REST API (probed against Joplin desktop 3.7.22), upload file attachments as resources (`data` multipart field) and link them in the note body, append source URL
- **Offline fallback**: when Joplin is unreachable, `saveToJoplin` writes a local inbox markdown (frontmatter records the redacted failure reason) instead of losing the clip; orphaned resources from partial failures are cleaned up
- **Settings**: `joplinApiUrl` / `joplinToken` / `joplinNotebookId` configurable via bridge settings API (token auto-masked in GET)
- **Tests**: 7 new tests — mock-HTTP unit tests plus a real-Joplin integration test (create note + resource, verify, permanent-delete) that skips automatically when no local Joplin is configured (CI-safe)

## v1.11.1

- **Security (bridge)**: all HTTP bridge routes now require a bearer token (auto-generated `bridgeToken` in `.honoka/bridge-settings.json`, mode 0600; `?token=` supported for navigation/SSE clients); unauthenticated requests return 401
- **Security (bridge)**: CORS `*` replaced with a `bridgeAllowedOrigins` allowlist (default: no cross-origin access); preflight only answered for allowed origins
- **Security (bridge)**: `GET /api/settings` systematically masks all secret-looking values; `bridgeToken` cannot be overwritten via the settings API; settings file enforced to 0600
- **Tests**: zero-dependency test suite (`node:test`, `npm test`) covering auth, redaction, CORS, and save/docs round-trip
- **CI**: new `ci.yml` — syntax check + tests on every PR and main push
- **Extension**: optional Doc Library bridge path sends the stored bridge token (`honokaSettings.bridgeToken`); manifest gains `http://127.0.0.1/*` host permission; without a token it degrades to local history as before
- **Deps**: package-lock synced with declared optionalDependencies (discord.js entry restored)

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
