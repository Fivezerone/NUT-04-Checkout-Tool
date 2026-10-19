#!/usr/bin/env node
/**
 * scripts/check-manifest-globals.mjs  (D-13 build check)
 *
 * Parses src/extension/manifest.json content_scripts blocks and verifies that
 * every self.Nutri* / window.Nutri* global referenced in the js files is
 * defined by an earlier file in the same js list.
 *
 * Exit 0  → all globals satisfied
 * Exit 1  → at least one violation (prints details)
 */

import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const EXT_DIR   = join(REPO_ROOT, 'src', 'extension');
const MANIFEST  = join(EXT_DIR, 'manifest.json');

// Pattern: self.NutriXxx or window.NutriXxx (any occurrence including assignments)
const MENTION_RE = /(?:self|window)\.(Nutri\w+)/g;
// Pattern: self.NutriXxx or window.NutriXxx (assignment = definition)
const DEFINE_RE  = /(?:self|window)\.(Nutri\w+)\s*=/g;

function readFile(path) {
  try { return readFileSync(path, 'utf8'); }
  catch { return ''; }
}

function globalsDefinedIn(filePath) {
  const src = readFile(filePath);
  const defs = new Set();
  for (const m of src.matchAll(DEFINE_RE)) defs.add(m[1]);
  return defs;
}

function globalsUsedIn(filePath) {
  const src = readFile(filePath);
  const selfDefs = globalsDefinedIn(filePath);
  const uses = new Set();
  // Collect every Nutri* mention, then subtract what this file itself defines
  for (const m of src.matchAll(MENTION_RE)) {
    const name = m[1];
    if (!selfDefs.has(name)) uses.add(name);
  }
  return uses;
}

const manifest = JSON.parse(readFile(MANIFEST));
const contentScripts = manifest.content_scripts || [];

let violations = 0;

for (let csIdx = 0; csIdx < contentScripts.length; csIdx++) {
  const cs = contentScripts[csIdx];
  const jsList = cs.js || [];

  // Accumulate what globals have been defined by files processed so far
  const defined = new Set();

  for (let i = 0; i < jsList.length; i++) {
    const relPath = jsList[i];
    const absPath = join(EXT_DIR, relPath);

    // Check: any globals this file uses that are NOT yet defined
    const used = globalsUsedIn(absPath);
    for (const g of used) {
      if (!defined.has(g)) {
        console.error(
          `[check-manifest-globals] VIOLATION in content_scripts[${csIdx}]: ` +
          `"${relPath}" references self.${g} but it is not defined by any earlier file in js[].`
        );
        violations++;
      }
    }

    // Add what this file defines for subsequent files
    for (const d of globalsDefinedIn(absPath)) defined.add(d);
  }
}

if (violations === 0) {
  console.log('[check-manifest-globals] OK — all Nutri* globals are properly ordered.');
  process.exit(0);
} else {
  console.error(`[check-manifest-globals] FAILED — ${violations} violation(s) found.`);
  process.exit(1);
}
