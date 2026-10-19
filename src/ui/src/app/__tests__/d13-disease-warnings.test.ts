/**
 * D-13 — Disease warnings: manifest + guard test
 *
 * Verifies the D-13 fix using only Node.js APIs (no DOM/jsdom required):
 *
 *  1. Manifest ordering:  health-modes.js must be js[0] in EVERY content_scripts block.
 *  2. NutriHealthModes shape: the file exports a non-empty object with a
 *     "general" key and at least one disease key (diabetes, hypertension, etc.)
 *  3. Guard log: the console.error guard in shared-ui.js references the exact
 *     sentinel string '[NutriScore] NutriHealthModes missing in content world'
 *     so the fix is auditable.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// __dirname = …/src/ui/src/app/__tests__
// 5 levels up: __tests__ → app → src → src/ui → NUT-04 Checkout Tool
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const EXT_DIR   = join(REPO_ROOT, 'src', 'extension');

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

function readManifest() {
  return JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D-13 — disease warnings: manifest fix', () => {
  test('health-modes.js is js[0] in ALL content_scripts blocks', () => {
    const m = readManifest();
    const blocks = m.content_scripts ?? [];
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      const jsList: string[] = block.js ?? [];
      expect(jsList[0]).toBe('health-modes.js');
    }
  });

  test('health-modes.js appears in manifest before shared-ui.js in every block', () => {
    const m = readManifest();
    for (const block of m.content_scripts ?? []) {
      const jsList: string[] = block.js ?? [];
      const hIdx   = jsList.indexOf('health-modes.js');
      const uiIdx  = jsList.indexOf('adapters/shared-ui.js');
      expect(hIdx).not.toBe(-1);
      expect(uiIdx).not.toBe(-1);
      expect(hIdx).toBeLessThan(uiIdx);
    }
  });
});

describe('D-13 — disease warnings: NutriHealthModes shape', () => {
  test('health-modes.js populates self.NutriHealthModes with disease keys', () => {
    // Execute health-modes.js in a mini-context
    const src = readFileSync(join(EXT_DIR, 'health-modes.js'), 'utf8');
    const ctx: Record<string, unknown> = {};
    const fn = new Function('self', src);
    fn(ctx);

    const modes = ctx.NutriHealthModes as Record<string, unknown> | undefined;
    expect(modes).toBeDefined();
    expect(typeof modes).toBe('object');

    // Must have 'general' (base case)
    expect(modes!).toHaveProperty('general');

    // Must have at least one disease key
    const diseaseKeys = Object.keys(modes!).filter(k => k !== 'general');
    expect(diseaseKeys.length).toBeGreaterThan(0);
  });

  test('each disease mode has palette and chipPrefix', () => {
    const src = readFileSync(join(EXT_DIR, 'health-modes.js'), 'utf8');
    const ctx: Record<string, unknown> = {};
    new Function('self', src)(ctx);

    const modes = ctx.NutriHealthModes as Record<string, any>;
    const diseaseKeys = Object.keys(modes).filter(k => k !== 'general');

    for (const key of diseaseKeys) {
      const m = modes[key];
      expect(m).toHaveProperty('palette');
      expect(m.palette).toHaveProperty('primary');
      expect(m.palette).toHaveProperty('accentBg');
      expect(m).toHaveProperty('chipPrefix');
    }
  });
});

describe('D-13 — disease warnings: shared-ui guard', () => {
  test('shared-ui.js contains the NutriHealthModes missing sentinel log', () => {
    const src = readFileSync(join(EXT_DIR, 'adapters', 'shared-ui.js'), 'utf8');
    expect(src).toContain('[NutriScore] NutriHealthModes missing in content world');
  });

  test('shared-ui.js references self.NutriHealthModes (not undefined after health-modes.js loaded)', () => {
    const src = readFileSync(join(EXT_DIR, 'adapters', 'shared-ui.js'), 'utf8');
    expect(src).toContain('self.NutriHealthModes');
  });
});
