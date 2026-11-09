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
- **Telegram** — Receive URLs via Telegram bot and auto-sync
- **Video download** — Download videos via yt-dlp

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
