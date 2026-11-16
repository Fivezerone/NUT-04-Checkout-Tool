import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { HEALTH_MODES } from '../src/shared/health-modes.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Generate CSS — Neutral chip tokens only; surface/header recolouring eliminated per Part C §4.2 / D-03
let css = '/* Generated from src/shared/health-modes.mjs - do not edit directly */\n'
css += '/* Surface and header recolouring removed per Part C §4.2 / D-03 */\n\n'

for (const [, mode] of Object.entries(HEALTH_MODES)) {
  css += `:root[data-health-condition="${mode.id}"] {\n`
  css += `  --condition-chip-color: ${mode.palette.primary};\n`
  css += `  --condition-chip-bg: ${mode.palette.accentBg};\n`
  css += `  --condition-chip-border: ${mode.palette.border};\n`
  css += `}\n\n`
}

const cssPath = path.join(__dirname, '../src/ui/src/styles/health-modes.generated.css')
fs.writeFileSync(cssPath, css)
console.log(`Generated ${cssPath}`)

// Generate JS for extension
const js = `/* Generated from src/shared/health-modes.mjs - do not edit directly */\nself.NutriHealthModes = ${JSON.stringify(HEALTH_MODES, null, 2)};\n`
const jsPath = path.join(__dirname, '../src/extension/health-modes.js')
fs.writeFileSync(jsPath, js)
console.log(`Generated ${jsPath}`)
