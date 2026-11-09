/**
 * URL pipeline — classify a URL, download video (yt-dlp) or extract an
 * article (Readability + turndown), then save a Joplin note. Failures retry
 * once and finally land in the local inbox queue so nothing is lost.
 *
 * Video files stay on disk (videoDir setting) and are referenced by local
 * path in the note; size is capped by videoMaxSizeMB.
 */
const fs = require("fs");
const path = require("path");
const { downloadVideo } = require("./video");
const { saveToJoplin, writeInboxFallback, redactUrl } = require("./joplin");
const { capturePage } = require("./capture");

const VIDEO_HOSTS = [
  "youtube.com", "youtu.be", "bilibili.com", "b23.tv",
  "twitter.com", "x.com", "vimeo.com", "tiktok.com",
  "dailymotion.com", "facebook.com", "fb.watch", "instagram.com", "twitch.tv",
];

const DEFAULT_VIDEO_MAX_MB = 500;
const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function safeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Classify a URL as video (yt-dlp supported platform) or article. */
function classifyUrl(url) {
  const host = safeHost(url);
  const isVideo = VIDEO_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  return { kind: isVideo ? "video" : "article", host };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HonokaBot/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching article`);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("article HTML exceeds 2 MB limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function metaContent(html, attr, name) {
  const re = new RegExp(`<meta\\s+[^>]*${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const alt = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${name}["']`, "i");
  return (html.match(re) || html.match(alt) || [])[1] || "";
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

/** Regex-only fallback when Readability is unavailable or finds no article. */
function extractFallback(html, url) {
  const ogTitle = metaContent(html, "property", "og:title");
  const titleTag = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || "";
  const description = metaContent(html, "property", "og:description") || metaContent(html, "name", "description");
  const title = decodeEntities(ogTitle || titleTag).trim() || url;
  const markdown = description ? decodeEntities(description).trim() : `Source: ${url}`;
  return { title, markdown };
}

/**
 * Fetch an article and convert it to { title, markdown }.
 * Uses Readability + jsdom + turndown when installed (optional deps),
 * otherwise falls back to og:title / meta description extraction.
 */
async function extractArticle(url) {
  const html = await fetchHtml(url);
  try {
    const { JSDOM } = require("jsdom");
    const { Readability } = require("@mozilla/readability");
    const TurndownService = require("turndown");
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article && article.content) {
      const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      const markdown = turndown.turndown(article.content).trim();
      if (markdown) {
        return { title: (article.title || extractFallback(html, url).title).trim(), markdown };
      }
    }
  } catch { /* optional deps missing or parse failed → fallback */ }
  return extractFallback(html, url);
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (firstError) {
    try {
      return await fn();
    } catch {
      throw firstError;
    }
  }
}

/** Throttle yt-dlp progress notifications to one message per 10% step. */
function makeProgressNotifier(notify) {
  let lastStep = -1;
  return (pctString) => {
    const pct = parseFloat(pctString);
    if (!Number.isFinite(pct)) return;
    const step = Math.floor(pct / 10);
    if (step <= lastStep) return;
    lastStep = step;
    Promise.resolve(notify(`⏳ Downloading… ${Math.min(pct, 100)}%`)).catch(() => {});
  };
}

function videoTitleFromFilename(filename) {
  return filename
    .replace(/^video-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || filename;
}

/**
 * Process one URL end to end.
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.honokaDir - data root (Videos/ and Inbox/ live under it)
 * @param {object} [opts.settings] - bridge settings (videoDir, videoMaxSizeMB, joplin*)
 * @param {function} [opts.notify] - async progress reply, e.g. Telegram sendMessage
 * @param {object} [opts.deps] - injectable { downloadVideo } for tests
 * @returns {Promise<{ok, kind, title?, noteId?, videoPath?, fallback?, inboxPath?, error?, stage?}>}
 */
async function processUrl(url, { honokaDir, settings = {}, notify = async () => {}, deps = {}, forceKind } = {}) {
  const download = deps.downloadVideo || downloadVideo;
  const inboxDir = path.join(honokaDir, "Inbox");
  const { kind, host } = forceKind ? { kind: forceKind, host: safeHost(url) } : classifyUrl(url);
  const joplinConfig = {
    apiUrl: settings.joplinApiUrl,
    token: settings.joplinToken,
    notebookId: settings.joplinNotebookId,
  };

  try {
    if (kind === "video") {
      await notify(`🎬 Video detected (${host}) — downloading…`);
      const videoDir = settings.videoDir || path.join(honokaDir, "Videos");
      const maxBytes = (Number(settings.videoMaxSizeMB) > 0 ? Number(settings.videoMaxSizeMB) : DEFAULT_VIDEO_MAX_MB) * 1024 * 1024;
      const { filename } = await withRetry(() =>
        download(url, { outputDir: videoDir, onProgress: makeProgressNotifier(notify) })
      );
      const videoPath = path.join(videoDir, filename);
      const size = fs.statSync(videoPath).size;
      if (size > maxBytes) {
        fs.unlinkSync(videoPath);
        throw new Error(`video exceeds size limit (${(size / 1048576).toFixed(1)} MB > ${maxBytes / 1048576} MB)`);
      }
      const title = videoTitleFromFilename(filename);
      const markdown = [
        "Video downloaded via Telegram.",
        "",
        `File: ${videoPath}`,
        `Size: ${(size / 1048576).toFixed(1)} MB`,
      ].join("\n");
      const saved = await saveToJoplin({ title, markdown, sourceUrl: url }, joplinConfig, { inboxDir });
      return { ...saved, kind, title, videoPath, stage: "joplin" };
    }

    await notify("📄 Extracting article…");
    const { title, markdown } = await withRetry(() => extractArticle(url));
    // Full-page capture is best-effort: missing Playwright/Chromium degrades to text-only.
    const capture = process.env.HONOKA_DISABLE_CAPTURE === "1" || deps.capturePage === null
      ? null
      : (deps.capturePage || capturePage);
    const shot = capture
      ? await capture(url, { outputDir: path.join(honokaDir, "Screenshots") }).catch(() => null)
      : null;
    const files = shot && shot.ok && shot.pngPath ? [shot.pngPath] : [];
    let body = markdown;
    if (shot && shot.ok && shot.ruleId && shot.data && Object.keys(shot.data).length > 0) {
      body += "\n\n---\n\n## Captured data\n" + Object.entries(shot.data)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
    }
    const saved = await saveToJoplin({ title, markdown: body, sourceUrl: url, files }, joplinConfig, { inboxDir });
    return { ...saved, kind, title, screenshotPath: files[0], stage: "joplin" };
  } catch (err) {
    const error = redactUrl(err.message);
    const inboxPath = writeInboxFallback(
      { title: url, markdown: `URL processing failed (${kind}).\n\nSource: ${url}`, sourceUrl: url, error },
      inboxDir
    );
    return { ok: false, kind, stage: kind === "video" ? "download" : "extract", inboxPath, error };
  }
}

/** Human-readable Telegram reply for a pipeline result. */
function formatReply(result) {
  if (result.ok) {
    const lines = [`✅ Saved to Joplin: "${result.title}" (note: ${result.noteId})`];
    if (result.videoPath) lines.push(`📁 ${result.videoPath}`);
    return lines.join("\n");
  }
  if (result.fallback === "inbox") {
    return `⚠️ Joplin unreachable — queued in inbox: ${result.inboxPath}\nReason: ${result.error}`;
  }
  return `❌ Failed after retry (${result.stage}): ${result.error}\nQueued in inbox: ${result.inboxPath}`;
}

module.exports = { classifyUrl, extractArticle, processUrl, formatReply, VIDEO_HOSTS };