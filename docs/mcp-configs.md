# Honoka MCP 設定指南

honoka-publish 透過標準 MCP (Model Context Protocol) stdio 與 AI 工具整合。
以下為 Claude Desktop、Antigravity、Codex 的設定範例。

## 前置需求

- Node.js >= 18
- Notion Integration Token ([建立方式](https://developers.notion.com/docs/create-a-notion-integration))
- Notion Database ID（需將 integration 加入 database 的 Connections）

## 環境變數

| 變數 | 必要 | 說明 |
|------|------|------|
| `NOTION_TOKEN` | ✅ | Notion PAT（`ntn_...` 或 `secret_...`） |
| `NOTION_DATABASE` | ✅ | 目標 database ID（`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`） |
| `HONOKA_DIR` | ❌ | 文件儲存目錄（預設：`~/honoka-docs`） |
| `HONOKA_ANYTYPE_API_KEY` | ❌ | AnyType API key（選擇性） |
| `HONOKA_ANYTYPE_SPACE_ID` | ❌ | AnyType space ID（選擇性） |

---

## Claude Desktop

**設定檔路徑:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "honoka": {
      "command": "npx",
      "args": ["honoka-publish"],
      "env": {
        "NOTION_TOKEN": "<your-notion-pat>",
        "NOTION_DATABASE": "<your-database-id>",
        "HONOKA_DIR": "/home/user/honoka-docs"
      }
    }
  }
}
```

---

## Antigravity (全家桶: Chatbox / IDE / CLI)

**設定檔路徑:** `~/.gemini/config/mcp_config.json`

```json
{
  "mcpServers": {
    "honoka": {
      "command": "npx",
      "args": ["honoka-publish"],
      "env": {
        "NOTION_TOKEN": "<your-notion-pat>",
        "NOTION_DATABASE": "<your-database-id>",
        "HONOKA_DIR": "/home/user/honoka-docs"
      }
    }
  }
}
```

---

## Codex (OpenAI)

**設定檔路徑:**
- macOS: `~/.codex/config.json` 或 `~/Library/Application Support/Codex/config.json`
- Linux: `~/.codex/config.json`
- Windows: `%APPDATA%\Codex\config.json`

```json
{
  "mcpServers": {
    "honoka": {
      "command": "npx",
      "args": ["honoka-publish"],
      "env": {
        "NOTION_TOKEN": "<your-notion-pat>",
        "NOTION_DATABASE": "<your-database-id>",
        "HONOKA_DIR": "/home/user/honoka-docs"
      }
    }
  }
}
```

---

## 可用 MCP Tools

設定完成後，AI 工具可使用以下工具：

| Tool | 說明 |
|------|------|
| `read_doc` / `read-clip` | 讀取本地文件內容 |
| `save-clip` | 儲存 markdown 到本地 |
| `save_and_sync` / `save-and-push` | 儲存本地 + 同步到 Notion |
| `sync-clip` / `sync_to_notion` | 將已有文件推送至 Notion |
| `push-to-notion` | 直接推送 markdown 到 Notion |
| `sync-directory` | 同步整個目錄到 Notion |
| `list-docs` | 列出本地文件 |
| `sync_to_anytype` | 同步文件到 AnyType |
| `search_anytype` | 搜尋 AnyType 物件 |
| `read_anytype` | 讀取 AnyType 物件 |
| `delete_anytype` | 刪除 AnyType 物件 |

---

## 測試 MCP 是否正常運作

手動測試（在終端機）：

```bash
# 方式 1：直接啟動 MCP server，確認無錯誤
NOTION_TOKEN=ntn_xxx NOTION_DATABASE=xxx npx honoka-publish

# 方式 2：使用 mcp-inspector 測試
npx @anthropic-ai/mcp-inspector npx honoka-publish
```

---

## Future: Binary Distribution

當 honoka-publish 提供三平台 binary 時，command 可改為：

```json
{
  "command": "/usr/local/bin/honoka-publish",
  "args": [],
  "env": { ... }
}
```

無需安裝 Node.js。
