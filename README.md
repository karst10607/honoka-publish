# honoka-publish

CLI tool to publish local Markdown files to Notion with incremental sync, Direct Upload for images, and file watching.

```bash
npx honoka-publish ./docs
npx honoka-publish --watch ./docs
```

## Features

- **Markdown to Notion** — Converts headings, lists, code blocks, images, and inline formatting to Notion blocks
- **Incremental sync** — Only syncs new or changed files (content-hash based)
- **Image upload** — Uses Notion's Direct Upload API for permanent image hosting
- **Frontmatter-aware** — Reads `title`, `tags`, `source`, `category`, `url`, `date` from frontmatter
- **File watcher** — `--watch` mode auto-syncs on save
- **CLI native** — No daemon, no HTTP server, no config UI. Just a terminal command.

## Quick start

```bash
# Set your Notion credentials
export NOTION_TOKEN=ntn_xxxxx...
export NOTION_DATABASE=your_database_id

# Sync a directory
npx honoka-publish ./my-docs

# Watch for changes
npx honoka-publish --watch ./my-docs

# Initialize config in a project
cd my-project
npx honoka-publish --init
```

## How it works

1. Scans the directory for `.md` files
2. Parses frontmatter (title, tags, category, etc.)
3. Compares content hash with `.honoka/registry.json` — skips unchanged files
4. Creates or updates Notion pages in the specified database
5. Uploads local images (`./images/*`) via Notion Direct Upload API
6. Appends content blocks to the page
7. Updates the registry for future incremental runs

## Integrations

- **Anytype** — Auto-publish to Anytype collections alongside Notion
- **Joplin** — Save notes (with file attachments) to a local Joplin notebook via the Clipper REST API; falls back to a local inbox markdown when Joplin is offline. Configure `joplinApiUrl` / `joplinToken` / `joplinNotebookId` in `.honoka/bridge-settings.json`
- **Telegram URL pipeline** — Send a link to the bot; videos are downloaded with yt-dlp, articles are extracted to markdown, and both become Joplin notes (see below)
- **Video download** — Download videos via yt-dlp
- **MCP tools** — The stdio MCP server exposes `save_url` / `download_video`
  (background tickets + `get_job_status`), `search_notes` (Joplin), and
  `list_inbox` alongside the Notion/AnyType tools

## Telegram URL pipeline

Send any URL to the Telegram bot while the bridge is running:

- **Video platforms** (YouTube, Bilibili, Twitter/X, Vimeo, TikTok, …) →
  downloaded with `yt-dlp --no-playlist` into `videoDir` (default
  `<docs-dir>/Videos`), with download progress reported back to the chat.
  The Joplin note references the local file path. Files larger than
  `videoMaxSizeMB` (default 500) are deleted and queued to the inbox.
- **Everything else** → article extraction (Readability + turndown when
  installed, meta-tag fallback otherwise) → Joplin note with the markdown body.
  When Chromium is available the note also gets a **full-page screenshot**
  attachment (see below), plus site-rule data for matching sites (e.g. 591).
- **Failure handling** — each step retries once; if it still fails (or Joplin
  is offline) the URL and reason are written to `<docs-dir>/Inbox/` and the bot
  replies with the queue path, so nothing is silently lost.

Setup (bot token from [@BotFather](https://t.me/BotFather); `yt-dlp` on PATH):

```bash
# With the bridge running, configure via the settings API:
curl -X POST http://127.0.0.1:44124/api/settings \
  -H "Authorization: Bearer <bridgeToken>" -H "Content-Type: application/json" \
  -d '{"telegramBotToken":"<bot token>","telegramAllowedUser":"<your Telegram user id>",
       "joplinApiUrl":"http://127.0.0.1:41184","joplinToken":"<joplin token>",
       "joplinNotebookId":"<notebook id>","videoMaxSizeMB":500}'
```

`telegramAllowedUser` restricts the bot to a single user id (strongly
recommended). Env vars `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USER` work too.
Settings live in `.honoka/bridge-settings.json` (mode `0600`); secrets are
masked in `GET /api/settings` and redacted from error replies.

## Full-page capture

Article notes include a full-page PNG screenshot of the page when Playwright
and a Chromium binary are available:

```bash
npm install playwright
npx playwright install chromium
```

- Captures land in `<docs-dir>/Screenshots/` and are uploaded to Joplin as a
  resource (`![...](:/id)` in the note body); the browser closes after each capture.
- Site-specific extraction lives in
  [src/integrations/capture-rules.json](src/integrations/capture-rules.json) —
  data-driven selectors / `window.dataLayer` mappings (currently 591); other
  pages get generic title / heading / description extraction.
- Without Playwright or the browser binary the pipeline silently degrades to a
  text-only note — no error, nothing blocks the URL. Set
  `HONOKA_DISABLE_CAPTURE=1` to skip capture entirely (headless servers, CI).

## MCP tools

The default mode is a stdio MCP server. URL tools are asynchronous — they
return `{ ticketId, status: "running" }` immediately (MCP tool calls have
client timeouts) and clients poll `get_job_status`:

| Tool | Purpose |
| --- | --- |
| `save_url` | Classify + ingest a URL into Joplin (video → yt-dlp, else article + screenshot) |
| `download_video` | Force the yt-dlp path for any URL |
| `search_notes` | Search Joplin notes (`query`, `limit` 1-100) |
| `list_inbox` | List queued inbox markdown (failed pipeline/Joplin runs) |
| `get_job_status` | Poll a background ticket (`running` / `done` / `error`) |

Joplin tools read credentials from `.honoka/bridge-settings.json`. Shared JSON
state (notion registry, tracking, settings) is written atomically and
read-modify-write sequences take an advisory cross-process lock, so several
MCP clients can run concurrently.

## Event stream (SSE)

`GET /events` streams pipeline events as Server-Sent Events, using the same
bridge token (`EventSource` passes `?token=`). Event types: `url_received`,
`download_progress`, `note_saved`, `error` — payloads carry only URL / title /
status (note bodies never, `token=` values scrubbed).

```bash
curl -N "http://127.0.0.1:44124/events?token=<bridgeToken>"
```

Frames carry an `id`; reconnecting with `Last-Event-ID` replays buffered events
(ring of 100) so short disconnects lose nothing. The AuraPet daemon subscribes
here and turns events into desktop-pet bubbles (mabi #53).

## Bridge security

The optional HTTP bridge (`--bridge`, port 44124) requires authentication:

- A random `bridgeToken` is generated on first start into
  `<docs-dir>/.honoka/bridge-settings.json` (file mode `0600`). The startup log
  prints the file path, never the token itself.
- Every request must carry `Authorization: Bearer <token>` (or `?token=<token>`
  for navigations / SSE clients). Unauthenticated requests get `401`.
- Cross-origin browser requests are only served for origins listed in the
  `bridgeAllowedOrigins` setting (array of strings); by default no
  `Access-Control-Allow-Origin` header is sent.
- `GET /api/settings` masks every secret-looking value (`••••` + last 4 chars);
  the bridge token cannot be changed through the settings API.
- Chrome Extension: the optional Doc Library bridge path reads
  `honokaSettings.bridgeToken` from extension storage; without it the extension
  falls back to local tracking history (MCP-only architecture is unaffected).

## License

MIT
