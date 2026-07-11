# honoka-publish 架構與三種運行模式

## 概述

`honoka-publish` 支援三種運行模式，分別服務不同的客戶端場景。三者共享同一套核心邏輯（Notion 同步、文件管理、Clipping），但通訊協議和使用方式完全不同。

```
┌─────────────────────────────────────────────────┐
│              honoka-publish                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  CLI    │  │  Bridge  │  │  MCP Server    │  │
│  │ (直接執行)│  │ (HTTP)   │  │ (stdio/JSON-RPC)│  │
│  └────┬────┘  └────┬─────┘  └───────┬────────┘  │
│       │            │                │            │
│    ┌──┴────────────┴────────────────┴──┐         │
│    │       Core Engine                 │         │
│    │  (sync, notion, markdown, image)  │         │
│    └───────────────────────────────────┘         │
└─────────────────────────────────────────────────┘
```

---

## 模式一：CLI（命令列工具）

### 啟動方式

```bash
npx honoka-publish <directory>
```

或安裝後：

```bash
npm install -g honoka-publish
honoka-publish ./docs
```

### 特色

| 特性 | 說明 |
|------|------|
| **零 daemon** | 執行完就結束，不需要背景進程、不佔端口 |
| **適合 CI/CD** | 可以放在 git hook、GitHub Actions、cron job 中 |
| **單次同步** | `honoka-publish ./my-docs` → 掃描 .md → 推上 Notion |
| **Watch 模式** | `--watch` 監聽檔案變動，自動同步 |
| **無須網路監聽** | 不開端口，不影響防火牆或資安規範 |
| **可 script 化** | 適用於人類腳本、快速測試、批次作業 |

### 使用場景

- 你寫了一篇 Markdown，手動執行送進 Notion
- CI/CD 管線在 git push 後自動同步 docs 目錄
- 不想開 daemon、不想裝 IDE 外掛

### 指令一覽

```bash
honoka-publish                          # 啟動 MCP server（預設模式）
honoka-publish ./docs                   # 單次同步
honoka-publish --watch ./docs           # 監聽模式
honoka-publish bridge                   # 啟動 HTTP Bridge（給 Extension）
honoka-publish bridge --port 44125      # 自訂端口
honoka-publish --init                   # 產生設定檔
honoka-publish --version                # 版本
```

---

## 模式二：Bridge（HTTP Server）

### 啟動方式

```bash
honoka-publish bridge
# 或自訂端口
honoka-publish bridge --port 44125
```

### 特色

| 特性 | 說明 |
|------|------|
| **HTTP 端口監聽** | 預設 `127.0.0.1:44124` |
| **唯一客戶端：Chrome Extension** | Extension 只能透過 HTTP 通訊 |
| **完全相容舊版** | 端點與舊 `honoka-bridge` 完全相同 |
| **雙進程風險** | 同端口只能跑一個實例 |

### API 端點

| 端點 | 方法 | 用途 |
|------|------|------|
| `/status` | GET | 健康檢查 + 設定狀態 |
| `/api/save` | POST | 儲存 clipping |
| `/api/save-and-notion` | POST | 儲存 + 推送 Notion |
| `/api/docs` | GET | 文件列表 |
| `/api/notion/push` | POST | 推送至 Notion |

### 使用場景

- Chrome Extension 連線（**唯一剛需**）
- 舊版工具或自訂腳本仍依賴 HTTP 端點

---

## 模式三：MCP Server（AI IDE 專用）

### 啟動方式

```bash
honoka-publish
# 無任何參數時，預設即為 MCP 模式
```

在 AI IDE（Qoder、Cursor、Claude Code Desktop）中設定 MCP 伺服器指向此指令即可。

### 特色

| 特性 | 說明 |
|------|------|
| **stdio 協議** | 不佔端口、不需網路、不需 daemon |
| **AI IDE 原生整合** | Qoder、Cursor、CC Desktop 都支援 MCP |
| **零配置** | 安裝後直接連、不須手動啟動 |
| **企業合規** | 無網路監聽、不經過第三方伺服器 |
| **工具集合** | 以 JSON-RPC tool 形式提供功能 |

### 可用工具

| 工具名稱 | 用途 |
|----------|------|
| `save-clip` | 儲存網頁 clipping |
| `push-to-notion` | 推送內容到 Notion |
| `sync-directory` | 同步目錄 |
| `list-docs` | 列出已儲存文件 |

### 使用場景

- AI 助理需要直接讀寫 Notion / 本地文件
- 不想離開 IDE 開終端機
- 企業環境要求不得開啟 HTTP 端口

---

## 模式選擇對照表

| 你想做什麼？ | 用哪個模式 | 為什麼 |
|------------|-----------|--------|
| Chrome Extension 連線 | **Bridge (HTTP)** | 唯一選擇，Extension 不吃 MCP |
| AI IDE 裡叫 AI 幫你發布 | **MCP** | 原生整合、零配置、零端口 |
| 手動跑一次同步到 Notion | **CLI** | `honoka-publish ./docs` 一行搞定 |
| CI/CD 自動同步 | **CLI** | 無 daemon、無端口、可 script |
| 寫批次腳本大量整理文件 | **CLI** | 執行完就結束，乾淨俐落 |
| 不想裝任何東西，試試看功能 | **CLI via npx** | `npx honoka-publish --help` |

---

## 關於 npm 名稱

| 名稱 | 狀態 | 說明 |
|------|------|------|
| `honoka-bridge` | 已下架（npm 上仍存在 v1.9.2） | 只含 HTTP Bridge，功能單一 |
| `honoka-publish` | ✅ 當前專案名稱 | CLI + Bridge + MCP 三合一 |

`honoka-publish` 已經涵蓋了 `honoka-bridge` 的全部功能，且多出 CLI 和 MCP。名稱已固定，不需要回頭改。

---

## 建議工作流程

```
日常寫作
  ├── 在 IDE 中寫 Markdown → AI 透過 MCP 自動發布到 Notion
  ├── 手動執行 honoka-publish ./docs → CLI 單次同步
  └── Chrome 瀏覽網頁 → 點選 Extension → HTTP Bridge 接收處理

發布到 CWS
  └── Extension 永遠搭配 Bridge (HTTP) 模式
```
