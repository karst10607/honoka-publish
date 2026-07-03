#!/usr/bin/env node
/**
 * Package extension for CWS submission.
 * Creates a ZIP file with only the files needed for Chrome Web Store.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

// Use zlib for ZIP
import { createDeflateRaw } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(__dirname, '..');
const BUILD_DIR = resolve(EXT_DIR, 'build');

// Files/dirs to include in the package
const INCLUDE = [
  'manifest.json',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'src/background.js',
  'src/content/clipper.js',
  'src/lib/notion.js',
  'src/lib/bridge.js',
  'src/lib/markdown.js',
  'src/popup/popup.html',
  'src/popup/popup.js',
  'src/popup/popup.css',
  'src/options/options.html',
  'src/options/options.js',
  'src/options/options.css',
];

async function main() {
  console.log('Packaging Honoka Publish extension for CWS...\n');

  if (!existsSync(BUILD_DIR)) {
    mkdirSync(BUILD_DIR, { recursive: true });
  }

  const manifest = JSON.parse(readFileSync(resolve(EXT_DIR, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  const zipName = `honoka-publish-v${version}.zip`;
  const zipPath = resolve(BUILD_DIR, zipName);

  // Build file list
  const files = [];
  for (const relPath of INCLUDE) {
    const fullPath = resolve(EXT_DIR, relPath);
    if (!existsSync(fullPath)) {
      console.error(`  ⚠  Missing: ${relPath}`);
      continue;
    }
    files.push({ relPath, fullPath });
    console.log(`  ✓ ${relPath}`);
  }

  // Create ZIP using Node.js built-in zlib + streaming
  // For simplicity, we'll use a zip library approach or shell zip command
  // Let's use the system zip command if available
  const { execSync } = await import('child_process');

  try {
    // Check if zip is available
    execSync('which zip', { stdio: 'ignore' });

    // Build zip command with exact file list
    const fileArgs = files.map(f => relative(EXT_DIR, f.fullPath)).join(' ');
    // Remove existing zip if present
    try { execSync(`rm -f "${zipPath}"`); } catch {}

    const cmd = `cd "${EXT_DIR}" && zip -r "${zipPath}" ${fileArgs}`;
    execSync(cmd, { stdio: 'inherit' });

    const stats = readFileSync(zipPath);
    console.log(`\n✅ Created: ${zipName}`);
    console.log(`   Size: ${(Buffer.byteLength(stats) / 1024).toFixed(1)} KB`);
    console.log(`   Location: ${zipPath}`);
  } catch {
    // Fallback: use a simple JS-based zip (limited)
    console.error('\n❌ zip command not available. Install zip or create manually.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Packaging failed:', err.message);
  process.exit(1);
});
