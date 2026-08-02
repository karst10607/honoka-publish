#!/usr/bin/env node
/**
 * honoka-setup — interactive MCP installer for Honoka.
 *
 * Usage:
 *   honoka-setup                Interactive walkthrough
 *   honoka-setup --check        Detect installed MCP hosts + honoka availability
 *   honoka-setup --token <pat> --database <id> [--anytype-key <k> --anytype-space <s>] [--dir <path>] [--hosts antigravity,codex,claude]
 *
 * Detects and writes the "honoka" MCP server entry into:
 *   - Antigravity    ~/.gemini/config/mcp_config.json
 *   - Claude Desktop ~/.config/Claude/claude_desktop_config.json (Linux)
 *                    ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
 *   - Codex          ~/.codex/config.json
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline/promises");

const HOSTS = {
  antigravity: {
    name: "Antigravity",
    configPath: path.join(os.homedir(), ".gemini", "config", "mcp_config.json"),
  },
  claude: {
    name: "Claude Desktop",
    configPath:
      process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json"),
  },
  codex: {
    name: "Codex",
    configPath: path.join(os.homedir(), ".codex", "config.json"),
  },
};

// ── Helpers ──

function detectCommand() {
  // Scan PATH directories for an installed honoka-publish binary
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const dir of paths) {
    try {
      const candidate = path.join(dir, "honoka-publish");
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { command: candidate };
      }
    } catch {}
  }
  return { command: "npx", args: ["-y", "honoka-publish"] };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak"); // backup before overwrite
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
}

function detectHosts() {
  return Object.entries(HOSTS).map(([key, h]) => {
    const exists = fs.existsSync(h.configPath);
    const hasHonoka = exists && !!(readJson(h.configPath)?.mcpServers?.honoka);
    return { key, ...h, exists, hasHonoka };
  });
}

// ── Interactive prompts ──

async function askCredentials(rl, args) {
  const creds = {};
  creds.notionToken = args.token || (await rl.question("Notion token (留空跳過): ")).trim();
  creds.notionDatabase = args.database || (await rl.question("Notion database ID (留空跳過): ")).trim();
  creds.honokaDir = args.dir || (await rl.question(`文件目錄 HONOKA_DIR (預設 ${path.join(os.homedir(), "honoka-docs")}): `)).trim() || path.join(os.homedir(), "honoka-docs");

  const wantAnytype = (await rl.question("要設定 AnyType 同步嗎？(y/N): ")).trim().toLowerCase();
  if (wantAnytype === "y" || args.anytypeKey || args.anytypeSpace) {
    creds.anytypeKey = args.anytypeKey || (await rl.question("AnyType API key: ")).trim();
    creds.anytypeSpace = args.anytypeSpace || (await rl.question("AnyType space ID: ")).trim();
  }
  return creds;
}

function buildEntry(creds, cmd) {
  const env = {};
  if (creds.notionToken) env.NOTION_TOKEN = creds.notionToken;
  if (creds.notionDatabase) env.NOTION_DATABASE = creds.notionDatabase;
  if (creds.honokaDir) env.HONOKA_DIR = creds.honokaDir;
  if (creds.anytypeKey) env.HONOKA_ANYTYPE_API_KEY = creds.anytypeKey;
  if (creds.anytypeSpace) env.HONOKA_ANYTYPE_SPACE_ID = creds.anytypeSpace;

  const entry = { command: cmd.command };
  if (cmd.args) entry.args = cmd.args;
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

// ── Main ──

async function main() {
  const args = {};
  process.argv.slice(2).forEach((a, i) => {
    if (a.startsWith("--") && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
      args[a.slice(2)] = process.argv[i + 1];
    }
  });

  const hosts = detectHosts();

  // ── --check mode ──
  if (args.check) {
    console.log("\n🔍 Honoka MCP setup 偵測結果\n");
    const cmd = detectCommand();
    console.log(`  honoka-publish: ${cmd.command} ${cmd.args ? cmd.args.join(" ") : ""} (${cmd.command === "npx" ? "未安裝，將用 npx" : "已安裝"})`);
    for (const h of hosts) {
      const status = h.exists ? (h.hasHonoka ? "✅ 已有 honoka" : "⚠️ 存在，無 honoka") : "❌ 未安裝";
      console.log(`  ${h.name.padEnd(16)} ${h.configPath}  ${status}`);
    }
    console.log("");
    return;
  }

  console.log("\n📦 Honoka MCP 安裝器\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const creds = await askCredentials(rl, args);
    const cmd = detectCommand();

    console.log("\n偵測到的 MCP hosts：");
    for (const h of hosts) {
      console.log(`  [${h.exists ? "✓" : " "}] ${h.name}${h.hasHonoka ? " (已含 honoka，將更新)" : ""}`);
    }

    const wantAll = (await rl.question("\n全部寫入？(Y/n): ")).trim().toLowerCase() !== "n";
    const targets = [];
    for (const h of hosts) {
      if (wantAll) {
        targets.push(h);
      } else if ((await rl.question(`寫入 ${h.name}？(y/N): `)).trim().toLowerCase() === "y") {
        targets.push(h);
      }
    }

    const entry = buildEntry(creds, cmd);
    let written = 0;

    for (const h of targets) {
      const cfg = readJson(h.configPath) || {};
      if (!cfg.mcpServers) cfg.mcpServers = {};
      cfg.mcpServers.honoka = entry;
      writeJson(h.configPath, cfg);
      console.log(`  ✓ ${h.name}: ${h.configPath}`);
      written++;
    }

    console.log(`\n✅ 完成！已寫入 ${written} 個 host。`);
    console.log("   請重新啟動你的 AI 助理（Antigravity / Claude Desktop / Codex）讓 MCP 生效。");
    console.log("   之後在對話中就能使用 honoka 工具（list-docs / save_and_sync / query-notion / sync_to_anytype 等）。\n");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
