import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HEALTH_MODES } from '../src/shared/health-modes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate CSS
let css = '/* Generated from src/shared/health-modes.mjs - do not edit directly */\n\n';
for (const [key, mode] of Object.entries(HEALTH_MODES)) {
  css += `:root[data-health-condition="${mode.id}"] {\n`;
  css += `  --theme-primary: ${mode.palette.primary};\n`;
  css += `  --theme-accent-bg: ${mode.palette.accentBg};\n`;
  css += `  --theme-border: ${mode.palette.border};\n`;
  css += `  --theme-header-bg: ${mode.palette.headerBg};\n`;
  css += `  --theme-header-text: ${mode.palette.headerText};\n`;
  css += `  --theme-header-sub: ${mode.palette.headerSub};\n`;
  css += `}\n\n`;
}

const cssPath = path.join(__dirname, '../src/ui/src/styles/health-modes.generated.css');
fs.writeFileSync(cssPath, css);
console.log(`Generated ${cssPath}`);

// Generate JS for extension
const js = `/* Generated from src/shared/health-modes.mjs - do not edit directly */\nself.NutriHealthModes = ${JSON.stringify(HEALTH_MODES, null, 2)};\n`;
const jsPath = path.join(__dirname, '../src/extension/health-modes.js');
fs.writeFileSync(jsPath, js);
console.log(`Generated ${jsPath}`);
