/**
 * Notion API client — clean-room implementation.
 * Handles page creation, block appending, and Direct Upload for images.
 */
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export class NotionClient {
  constructor(pat) {
    this.pat = pat;
  }

  headers() {
    return {
      'Authorization': `Bearer ${this.pat}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    };
  }

  async request(method, path, body) {
    const url = path.startsWith('http') ? path : `${NOTION_API}${path}`;
    const opts = { method, headers: this.headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${data.message || JSON.stringify(data)}`);
    return data;
  }

  /** Create a page in a database. */
  async createPage(databaseId, title, properties = {}) {
    const body = {
      parent: { database_id: databaseId },
      properties: {
        title: { title: [{ type: 'text', text: { content: title } }] },
        ...properties,
      },
    };
    return this.request('POST', '/pages', body);
  }

  /** Append children blocks to a parent block or page. */
  async appendBlocks(blockId, blocks) {
    return this.request('PATCH', `/blocks/${blockId}/children`, { children: blocks });
  }

  /** Direct Upload: request an upload URL from Notion. */
  async requestUploadUrl(fileName, fileSize, mimeType) {
    return this.request('POST', '/files', {
      name: fileName,
      size: fileSize,
      content_type: mimeType,
    });
  }

  /** Direct Upload: upload file content to the provided URL. */
  async uploadFileContent(url, data) {
    const res = await fetch(url, { method: 'PUT', body: data });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res;
  }

  /** Query a database by property value. */
  async queryDatabase(databaseId, filter) {
    return this.request('POST', `/databases/${databaseId}/query`, { filter });
  }
}

/** Convert Markdown content to Notion block objects. */
export function markdownToBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') { i++; continue; }

    // Code block (```)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: lang || 'plain text',
        },
      });
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2];
      const headingType = `heading_${level}`;
      blocks.push({
        type: headingType,
        [headingType]: {
          rich_text: parseInlineMarkdown(text),
        },
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({
        type: 'quote',
        quote: {
          rich_text: [{ type: 'text', text: { content: quoteLines.join('\n') } }],
        },
      });
      continue;
    }

    // Bullet list
    if (line.match(/^[-*+]\s+/)) {
      const listItems = [];
      while (i < lines.length && lines[i].match(/^[-*+]\s+/)) {
        listItems.push(lines[i].replace(/^[-*+]\s+/, ''));
        i++;
      }
      for (const item of listItems) {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: parseInlineMarkdown(item),
          },
        });
      }
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s+/)) {
      const listItems = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        listItems.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      for (const item of listItems) {
        blocks.push({
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: parseInlineMarkdown(item),
          },
        });
      }
      continue;
    }

    // Image
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      blocks.push({
        type: 'image',
        image: {
          type: 'external',
          external: { url: imgMatch[2] },
          caption: imgMatch[1] ? [{ type: 'text', text: { content: imgMatch[1] } }] : [],
        },
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+/)) {
      blocks.push({ type: 'divider', divider: {} });
      i++;
      continue;
    }

    // Paragraph (default)
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].startsWith('#') && !lines[i].startsWith('```') &&
           !lines[i].startsWith('> ') && !lines[i].match(/^[-*+]\s+/) &&
           !lines[i].match(/^\d+\.\s+/) && !lines[i].startsWith('---')) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: parseInlineMarkdown(paraLines.join('\n')),
        },
      });
    } else {
      i++;
    }
  }

  return blocks;
}

/** Parse inline Markdown (bold, italic, code, links) into Notion rich_text array. */
function parseInlineMarkdown(text) {
  const segments = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold **text** or __text__
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const boldMatch2 = remaining.match(/__(.+?)__/);
    // Italic *text* or _text_
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    const italicMatch2 = remaining.match(/_(.+?)_/);
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Link [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    // Find earliest match
    const candidates = [];
    if (boldMatch) candidates.push({ index: boldMatch.index, type: 'bold', match: boldMatch });
    if (italicMatch) candidates.push({ index: italicMatch.index, type: 'italic', match: italicMatch });
    if (codeMatch) candidates.push({ index: codeMatch.index, type: 'code', match: codeMatch });
    if (linkMatch) candidates.push({ index: linkMatch.index, type: 'link', match: linkMatch });

    if (candidates.length === 0) {
      segments.push({ type: 'text', text: { content: remaining } });
      break;
    }

    candidates.sort((a, b) => a.index - b.index);
    const first = candidates[0];
    const { type, match } = first;

    // Text before match
    if (match.index > 0) {
      segments.push({ type: 'text', text: { content: remaining.slice(0, match.index) } });
    }

    if (type === 'bold') {
      segments.push({ type: 'text', text: { content: match[1] }, annotations: { bold: true } });
      remaining = remaining.slice(match.index + match[0].length);
    } else if (type === 'italic') {
      segments.push({ type: 'text', text: { content: match[1] }, annotations: { italic: true } });
      remaining = remaining.slice(match.index + match[0].length);
    } else if (type === 'code') {
      segments.push({ type: 'text', text: { content: match[1] }, annotations: { code: true } });
      remaining = remaining.slice(match.index + match[0].length);
    } else if (type === 'link') {
      segments.push({ type: 'text', text: { content: match[1] }, href: match[2] });
      remaining = remaining.slice(match.index + match[0].length);
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: { content: text || '' } }];
}
