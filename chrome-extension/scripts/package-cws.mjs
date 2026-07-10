#!/usr/bin/env node
/**
 * Package extension for CWS submission.
 * Strips dev-only entries (key, <all_urls>) from manifest before zipping.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(__dirname, '..');
const BUILD_DIR = resolve(EXT_DIR, 'build');

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
  const manifestPath = resolve(EXT_DIR, 'manifest.json');

  // Strip dev-only entries from manifest (key + <all_urls>)
  let raw = readFileSync(manifestPath, 'utf8');
  const m = JSON.parse(raw);
  let changed = false;
  if (m.key) { delete m.key; changed = true; }
  const allUrlsIdx = m.host_permissions?.indexOf('<all_urls>');
  if (allUrlsIdx !== -1) {
    m.host_permissions.splice(allUrlsIdx, 1);
    changed = true;
  }
  if (changed) {
    writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf8');
    console.log('  Stripped dev-only entries from manifest.json');
  }

  // Build ZIP
  if (!existsSync(BUILD_DIR)) mkdirSync(BUILD_DIR, { recursive: true });

  const version = m.version;
  const zipName = `honoka-lite-cws-v${version}.zip`;
  const zipPath = resolve(BUILD_DIR, zipName);

  for (const file of INCLUDE) {
    if (!existsSync(resolve(EXT_DIR, file))) {
      console.error(`  Missing: ${file}`);
      if (changed) writeFileSync(manifestPath, raw, 'utf8');
      process.exit(1);
    }
  }

  console.log('Packaging ' + zipName + '...');
  const fileArgs = INCLUDE.map(f => '"' + f + '"').join(' ');
  execSync('cd "' + EXT_DIR + '" && zip -9 "' + zipPath + '" ' + fileArgs, { stdio: 'inherit', shell: true });

  const size = existsSync(zipPath) ? statSync(zipPath).size : 0;
  console.log('\nDone: ' + zipName + ' (' + (size / 1024).toFixed(1) + ' KB, ' + INCLUDE.length + ' files)');

  // Restore manifest
  if (changed) {
    writeFileSync(manifestPath, raw, 'utf8');
    console.log('  Restored manifest.json');
  }
}

main().catch(err => {
  console.error('Packaging failed:', err.message);
  process.exit(1);
});
