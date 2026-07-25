#!/usr/bin/env node
// `node --check` på all egen JS. Fångar syntaxfel innan de deployas –
// Cloudflare bygger inte, så en trasig fil upptäcks annars först i webbläsaren.

import { readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'tmp']);
const EXTENSIONS = new Set(['.js', '.mjs']);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield full;
    }
  }
}

const failed = [];
let checked = 0;

for await (const file of walk(root)) {
  // Allt i projektet är ESM (package.json: "type": "module").
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  checked += 1;
  if (result.status !== 0) {
    failed.push({ file: relative(root, file), message: (result.stderr || '').trim() });
  }
}

if (failed.length) {
  console.error(`\nSyntaxfel i ${failed.length} av ${checked} filer:\n`);
  for (const { file, message } of failed) console.error(`✗ ${file}\n${message}\n`);
  process.exit(1);
}

console.log(`✓ node --check OK på ${checked} filer.`);
