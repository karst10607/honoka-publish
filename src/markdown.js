/**
 * Markdown to Notion block converter.
 *
 * Parses CommonMark-style markdown into Notion block objects.
 * Based on the Markdown specification (CommonMark) and Notion block API:
 *   https://developers.notion.com/reference/block
 *
 * Supports: h1-h3, paragraphs, bullet lists, numbered lists,
 *           code blocks, images, dividers, inline formatting.
 */

/**
 * Convert a Markdown string into an array of Notion block objects.
 * @param {string} md - Raw markdown content
 * @returns {object[]}
 */
function toBlocks(md) {
  const lines = md.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const language = line.slice(3).trim() || "plain text";
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(buildBlock("code", {
        language,
        rich_text: [plainText(codeLines.join("\n"))],
      }));
      continue;
    }

    // Heading 1
    if (/^#\s/.test(line) && !/^##/.test(line)) {
      blocks.push(buildBlock("heading_1", { rich_text: parseInline(line.replace(/^#\s+/, "")) }));
      i++;
      continue;
    }

    // Heading 2
    if (/^##\s/.test(line) && !/^###/.test(line)) {
      blocks.push(buildBlock("heading_2", { rich_text: parseInline(line.replace(/^##\s+/, "")) }));
      i++;
      continue;
    }

    // Heading 3
    if (/^###\s/.test(line)) {
      blocks.push(buildBlock("heading_3", { rich_text: parseInline(line.replace(/^###\s+/, "")) }));
      i++;
      continue;
    }

    // Divider
    if (/^-{3,}\s*$/.test(line)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }

    // Image
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const src = imgMatch[2];
      blocks.push({
        object: "block",
        type: "image",
        image: { type: "external", external: { url: src } },
      });
      i++;
      continue;
    }

    // Bullet list (collect consecutive items)
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i++;
      }
      for (const item of items) {
        blocks.push(buildBlock("bulleted_list_item", { rich_text: parseInline(item) }));
      }
      continue;
    }

    // Numbered list
    if (/^\d+[.)]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      for (const item of items) {
        blocks.push(buildBlock("numbered_list_item", { rich_text: parseInline(item) }));
      }
      continue;
    }

    // Blank line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Default: paragraph
    blocks.push(buildBlock("paragraph", { rich_text: parseInline(line) }));
    i++;
  }

  return blocks;
}

// ── Inline formatting ──────────────────────────────────────────

/**
 * Parse inline formatting: **bold**, *italic*, `code`, [links](url).
 * Returns an array of Notion rich_text objects.
 */
function parseInline(text) {
  const fragments = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Find earliest formatting marker
    const patterns = [
      { type: "bold", re: /\*\*(.+?)\*\*/, annotate: { bold: true } },
      { type: "italic", re: /\*(.+?)\*/, annotate: { italic: true } },
      { type: "code", re: /`([^`]+)`/, annotate: { code: true } },
      { type: "link", re: /\[([^\]]+)\]\(([^)]+)\)/, isLink: true },
    ];

    let best = null;
    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && (!best || m.index < best.match.index)) {
        best = { match: m, ...p };
      }
    }

    if (!best) {
      fragments.push(plainText(remaining));
      break;
    }

    const { match, annotate, isLink } = best;

    // Text before marker
    if (match.index > 0) {
      fragments.push(plainText(remaining.slice(0, match.index)));
    }

    if (isLink) {
      fragments.push({
        type: "text",
        text: { content: match[1], link: { url: match[2] } },
      });
    } else {
      fragments.push({
        type: "text",
        text: { content: match[1] },
        annotations: annotate,
      });
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return fragments.length > 0 ? fragments : [plainText(text || "")];
}

// ── Frontmatter parser ─────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a Markdown string.
 * Only supports simple key: "value" pairs.
 *
 * @param {string} md
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(md) {
  const result = { title: "", tags: [], source: "clip", url: "", date: "" };
  if (!md.startsWith("---")) return { frontmatter: result, body: md };

  const end = md.indexOf("---", 3);
  if (end === -1) return { frontmatter: result, body: md };

  const raw = md.slice(3, end).trim();
  const body = md.slice(end + 3).trim();

  for (const line of raw.split("\n")) {
    // Try JSON-style values first (arrays, quoted strings)
    const jsonMatch = line.match(/^(\w+):\s*(\[.*\]|".*"|\d+)\s*$/);
    if (jsonMatch) {
      const key = jsonMatch[1];
      try {
        const value = JSON.parse(jsonMatch[2]);
        if (key === "title") result.title = value;
        else if (key === "tags") result.tags = Array.isArray(value) ? value : [value];
        else if (key === "source") result.source = value;
        else if (key === "url") result.url = value;
        else if (key === "date") result.date = value;
        else result[key] = value;
      } catch { /* fall through */ }
      continue;
    }

    // Fallback: simple key: value (unquoted)
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) {
      const key = kv[1];
      let value = kv[2].trim();
      if (key === "title") result.title = value.replace(/^"|"$/g, "");
      else if (key === "source") result.source = value;
      else if (key === "url") result.url = value;
      else if (key === "date") result.date = value;
      else if (key === "tags") {
        result.tags = value.split(",").map((t) => t.trim().replace(/^"|"$/g, ""));
      } else {
        result[key] = value;
      }
    }
  }

  return { frontmatter: result, body };
}

// ── Helpers ────────────────────────────────────────────────────

function plainText(content) {
  return { type: "text", text: { content } };
}

function buildBlock(type, content) {
  return {
    object: "block",
    type,
    [type]: content,
  };
}

module.exports = { toBlocks, parseInline, parseFrontmatter };
