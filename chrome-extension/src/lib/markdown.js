/**
 * Lightweight HTML-to-Markdown converter — clean-room implementation.
 * Converts sanitized HTML (from extracted page content) to Markdown.
 */

/** Convert HTML string to Markdown. */
export function htmlToMarkdown(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return convertNode(doc.body);
}

/** Convert a DOM node to Markdown. */
function convertNode(node, depth = 0) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdown(node.textContent);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = Array.from(node.childNodes);

  switch (tag) {
    // Headings
    case 'h1': return `\n${'#'.repeat(1)} ${convertInline(children)}\n\n`;
    case 'h2': return `\n${'#'.repeat(2)} ${convertInline(children)}\n\n`;
    case 'h3': return `\n${'#'.repeat(3)} ${convertInline(children)}\n\n`;
    case 'h4': return `\n${'#'.repeat(4)} ${convertInline(children)}\n\n`;
    case 'h5': return `\n${'#'.repeat(5)} ${convertInline(children)}\n\n`;
    case 'h6': return `\n${'#'.repeat(6)} ${convertInline(children)}\n\n`;

    // Paragraphs
    case 'p': return `${convertInline(children)}\n\n`;

    // Links
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = convertInline(children);
      if (!href || text === href) return text;
      return `[${text}](${href})`;
    }

    // Images
    case 'img': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }

    // Bold / Strong
    case 'strong':
    case 'b': return `**${convertInline(children)}**`;

    // Italic / Emphasis
    case 'em':
    case 'i': return `*${convertInline(children)}*`;

    // Inline code
    case 'code': return `\`${convertInline(children)}\``;

    // Line break
    case 'br': return '\n';

    // Horizontal rule
    case 'hr': return `\n---\n\n`;

    // Lists
    case 'ul': {
      let result = '\n';
      for (const child of children) {
        if (child.tagName === 'LI') {
          result += `- ${convertNode(child, depth + 1).trim()}\n`;
        }
      }
      return `${result}\n`;
    }

    case 'ol': {
      let result = '\n';
      let count = 1;
      for (const child of children) {
        if (child.tagName === 'LI') {
          result += `${count++}. ${convertNode(child, depth + 1).trim()}\n`;
        }
      }
      return `${result}\n`;
    }

    case 'li': {
      return convertInline(children);
    }

    // Blockquote
    case 'blockquote': {
      const inner = convertNode(node.firstElementChild || node, depth);
      const lines = inner.trim().split('\n');
      return lines.map(l => `> ${l}`).join('\n') + '\n\n';
    }

    // Pre / Code blocks
    case 'pre': {
      const codeEl = node.querySelector('code');
      const codeText = codeEl ? codeEl.textContent : node.textContent;
      const lang = codeEl?.getAttribute('class')?.replace(/^language-/, '') || '';
      const cleanCode = codeText.replace(/\n$/, '');
      return '```' + lang + '\n' + cleanCode + '\n```\n\n';
    }

    // Divider / thematic break
    case 'div': return `${convertInline(children)}\n`;

    // Tables — simplified: just text per cell
    case 'table': return convertTable(node) + '\n';

    // Span, section, header, footer, nav, main, article, aside
    case 'span':
    case 'section':
    case 'header':
    case 'footer':
    case 'nav':
    case 'main':
    case 'article':
    case 'aside':
      return convertInline(children);

    default:
      return convertInline(children);
  }
}

/** Convert children nodes to inline text (no block-level wrapping). */
function convertInline(children) {
  let result = '';
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += escapeMarkdown(child.textContent);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      result += convertNode(child);
    }
  }
  return result;
}

/** Escape special Markdown characters. */
function escapeMarkdown(text) {
  return text
    .replace(/\\([\\`*_{}[\]()#+\-!|])/g, '$1') // unescape
    .replace(/([\\`*_{}[\]()#+\-!|])/g, '\\$1') // escape
    .replace(/\\\\([\\`*_{}[\]()#+\-!|])/g, '\\\\$1'); // double-escape
}

/** Convert a table to simplified Markdown. */
function convertTable(table) {
  const rows = table.querySelectorAll('tr');
  if (rows.length === 0) return '';
  const mdRows = [];
  let headerSeparator = '';

  rows.forEach((row, rowIdx) => {
    const cells = row.querySelectorAll('td, th');
    const cellTexts = Array.from(cells).map(c => convertInline(Array.from(c.childNodes)).trim());
    mdRows.push(`| ${cellTexts.join(' | ')} |`);
    if (rowIdx === 0) {
      headerSeparator = `| ${cellTexts.map(() => '---').join(' | ')} |`;
    }
  });

  // Insert header separator after first row
  if (mdRows.length > 0) {
    mdRows.splice(1, 0, headerSeparator);
  }
  return mdRows.join('\n');
}
