# Changelog

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
