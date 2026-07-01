/**
 * Sync orchestrator — ties together scanning, parsing, Notion API calls.
 *
 * For each .md file in the target directory:
 *   1. Parse frontmatter → extract title, tags, etc.
 *   2. Check registry → has this file been synced? Is it changed?
 *   3. If unchanged → skip
 *   4. If new/changed → create or update Notion page
 *   5. Upload local images via Direct Upload
 *   6. Append content blocks
 *   7. Update registry
 */
const fs = require("fs");
const path = require("path");
const {
  getDatabaseSchema,
  createPage,
  updatePageProperties,
  appendBlocks,
  clearPage,
  queryDatabase,
} = require("./notion");
const { toBlocks, parseFrontmatter } = require("./markdown");
const { uploadImages } = require("./images");
const { readRegistry, writeRegistry, computeHash } = require("./registry");

const FREE_MAX_DIRS = 1;
const PRO_TARGETS = ["notion", "git"]; // Pro unlocks git sync etc.

/**
 * Sync a single directory to Notion.
 *
 * @param {string} targetDir - Absolute path to directory with .md files
 * @param {object} opts
 * @param {string} opts.notionToken
 * @param {string} opts.notionDatabase
 * @param {boolean} [opts.verbose]
 * @param {string} [opts.license] - "free" or "pro"
 * @returns {Promise<{synced: number, skipped: number, errors: number}>}
 */
async function syncDirectory(targetDir, opts) {
  const { notionToken, notionDatabase, verbose, license = "free" } = opts;

  // Discover markdown files
  const entries = findMarkdownFiles(targetDir);

  if (entries.length === 0) {
    console.log("No .md files found.");
    return { synced: 0, skipped: 0, errors: 0 };
  }

  // Free mode: only sync the first directory depth
  if (license === "free") {
    const topLevelFiles = entries.filter((e) => e.depth === 1);
    const nestedFiles = entries.filter((e) => e.depth > 1);
    if (nestedFiles.length > 0 && verbose) {
      console.log(`ℹ  Free mode: syncing ${topLevelFiles.length} top-level files (${nestedFiles.length} nested files skipped). Pro unlocks recursive sync.`);
    }
  }

  console.log(`Found ${entries.length} markdown file(s) in ${targetDir}`);

  // Validate Notion credentials
  if (!notionToken || !notionDatabase) {
    console.warn("⚠  Skipping Notion sync: missing NOTION_TOKEN or NOTION_DATABASE.");
    return { synced: 0, skipped: 0, errors: 0 };
  }

  // Fetch database schema once (to map property names)
  let schema;
  try {
    schema = await getDatabaseSchema(notionDatabase, notionToken);
    if (verbose) {
      const propNames = Object.keys(schema).join(", ");
      console.log(`📋 Database schema: ${propNames}`);
    }
  } catch (err) {
    console.error(`❌ Failed to read database schema: ${err.message}`);
    console.error(`   Check your NOTION_TOKEN and NOTION_DATABASE.`);
    return { synced: 0, skipped: 0, errors: entries.length };
  }

  // Read registry
  const registry = readRegistry(targetDir);
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    try {
      const result = await syncFile(entry, {
        targetDir,
        notionToken,
        notionDatabase,
        schema,
        registry,
        verbose,
        license,
      });

      if (result === "synced") synced++;
      else if (result === "skipped") skipped++;
      else if (result === "error") errors++;
    } catch (err) {
      errors++;
      console.error(`  ❌ ${entry.relativePath}: ${err.message}`);
    }
  }

  // Save updated registry
  writeRegistry(targetDir, registry);

  return { synced, skipped, errors };
}

/**
 * Sync a single markdown file to Notion.
 * @returns {"synced"|"skipped"|"error"}
 */
async function syncFile(entry, opts) {
  const { targetDir, notionToken, notionDatabase, schema, registry, verbose } = opts;
  const { absolutePath, relativePath, docDir } = entry;

  // Free mode limitation
  if (opts.license === "free" && entry.depth > 1) {
    if (verbose) console.log(`  ⏭  ${relativePath} (nested — Pro only)`);
    return "skipped";
  }

  // Read and parse the file
  const content = fs.readFileSync(absolutePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);

  // Change detection via hash
  const currentHash = computeHash(absolutePath);
  const existing = registry[relativePath];

  if (existing && existing.hash === currentHash && existing.pageId) {
    if (verbose) console.log(`  ⏭  ${relativePath} (unchanged)`);
    return "skipped";
  }

  const title = frontmatter.title || path.basename(entry.relativePath, ".md");
  console.log(`  📄 ${relativePath} → "${title}"`);

  // Build Notion properties from frontmatter
  const properties = buildProperties(title, frontmatter, schema);

  let pageId = existing?.pageId || null;

  if (pageId) {
    // UPDATE: properties only (content replaced below)
    await updatePageProperties(pageId, properties, notionToken);
    await clearPage(pageId, notionToken);
    if (verbose) console.log(`     ↻ Updated page ${pageId.slice(0, 12)}...`);
  } else {
    // CREATE
    // First check if a page with this title already exists in the database
    const titlePropName = Object.entries(schema).find(([, d]) => d.type === "title")?.[0] || "title";
    const existingPages = await queryDatabase(
      notionDatabase,
      {
        property: titlePropName,
        title: { equals: title },
      },
      notionToken
    );

    if (existingPages.length > 0) {
      // Found existing page — update it
      pageId = existingPages[0].id;
      await updatePageProperties(pageId, properties, notionToken);
      await clearPage(pageId, notionToken);
      if (verbose) console.log(`     ↻ Found existing page, updating: ${pageId.slice(0, 12)}...`);
    } else {
      const page = await createPage({
        databaseId: notionDatabase,
        properties,
        token: notionToken,
      });
      pageId = page.id;
      if (verbose) console.log(`     ✦ Created page ${pageId.slice(0, 12)}...`);
    }
  }

  // Convert markdown body to Notion blocks
  const blocks = toBlocks(body);

  // Upload images
  if (docDir) {
    const uploaded = await uploadImages(docDir, blocks, notionToken);
    if (uploaded > 0 && verbose) console.log(`     📷 ${uploaded} image(s) uploaded`);
  }

  // Append blocks
  await appendBlocks(pageId, blocks, notionToken);

  // Update registry
  registry[relativePath] = {
    hash: currentHash,
    pageId,
    title,
    lastSync: new Date().toISOString(),
  };

  return "synced";
}

/**
 * Discover all .md files in a directory tree.
 * Returns entries with depth info.
 */
function findMarkdownFiles(dir, baseDir = dir, depth = 0) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip dotfiles
    if (entry.name === "node_modules") continue;

    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(absolutePath, baseDir, depth + 1));
    } else if (entry.name.endsWith(".md") && !entry.name.endsWith(".md.md")) {
      const relativePath = path.relative(baseDir, absolutePath);
      // docDir is the parent directory (for images/ folder)
      const docDir = path.dirname(absolutePath);
      results.push({ absolutePath, relativePath, depth: depth + 1, docDir });
    }
  }

  return results;
}

/**
 * Build Notion page properties from frontmatter and database schema.
 * Maps known fields (title, source, category, url, date, tags)
 * to the corresponding properties in the database.
 */
function buildProperties(title, frontmatter, schema) {
  const properties = {};

  for (const [propName, propDef] of Object.entries(schema)) {
    switch (propDef.type) {
      case "title": {
        properties[propName] = {
          title: [{ type: "text", text: { content: title } }],
        };
        break;
      }
      case "select": {
        if (frontmatter.category && propName.toLowerCase() === "category") {
          properties[propName] = { select: { name: frontmatter.category } };
        } else if (frontmatter.source && propName.toLowerCase() === "source") {
          properties[propName] = { select: { name: frontmatter.source } };
        }
        break;
      }
      case "multi_select": {
        if (propName.toLowerCase() === "tags" && frontmatter.tags?.length > 0) {
          properties[propName] = {
            multi_select: frontmatter.tags.map((t) => ({ name: t })),
          };
        }
        break;
      }
      case "url": {
        if (frontmatter.url) {
          properties[propName] = { url: frontmatter.url };
        }
        break;
      }
      case "date": {
        if (frontmatter.date) {
          properties[propName] = { date: { start: frontmatter.date } };
        }
        break;
      }
      case "rich_text": {
        // Pass through any matching frontmatter field as rich text
        const fmKey = propName.toLowerCase().replace(/\s+/g, "_");
        if (frontmatter[fmKey]) {
          properties[propName] = {
            rich_text: [{ type: "text", text: { content: String(frontmatter[fmKey]) } }],
          };
        }
        break;
      }
    }
  }

  return properties;
}

module.exports = { syncDirectory, syncFile, findMarkdownFiles };
