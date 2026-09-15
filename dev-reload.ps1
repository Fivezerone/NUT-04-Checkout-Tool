# dev-reload.ps1 — NUT-04 Hot-Reload Script
# Performs a clean rebuild and prints instructions + a DevTools snippet to
# force-reload the Service Worker without leaving the browser.
#
# Usage: .\dev-reload.ps1
#        .\dev-reload.ps1 -SkipClean   (skips dist/ wipe — faster, for adapter-only changes)

param(
  [switch]$SkipClean
)

$ErrorActionPreference = "Stop"
$ErrorActionPreference = "Stop"

# ── 1. Compile db.ts (always first) ───────────────────────────────────────────
Write-Host "[1/4] Compiling db.ts -> src/extension/db.js ..."
npx esbuild src/ui/src/app/lib/db.ts `
  --bundle `
  --outfile=src/extension/db.js `
  --format=iife `
  --global-name=NutriScoreDB `
  --platform=browser `
  --target=chrome96 `
  --log-level=warning

# ── 2. Vite UI build ──────────────────────────────────────────────────────────
Write-Host "[2/4] Building UI with Vite ..."
npx vite build

# ── 3. Assemble extension ─────────────────────────────────────────────────────
if (-not $SkipClean) {
  Write-Host "[3/4] Assembling dist/ (full copy) ..."
  if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
  New-Item -ItemType Directory -Path "dist" | Out-Null
} else {
  Write-Host "[3/4] Assembling dist/ (incremental — skipping clean) ..."
}
Copy-Item "src\extension\*" -Destination "dist" -Recurse -Force

# ── 4. Stamp & instruct ────────────────────────────────────────────────────────
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Set-Content -Path "dist\.build-stamp" -Value $stamp

Write-Host ""
Write-Host "========================================================"
Write-Host "  Build complete at $stamp"
Write-Host "========================================================"
Write-Host ""
Write-Host "NEXT STEPS (do in order):"
Write-Host "  1. Open chrome://extensions"
Write-Host "  2. Click the [Reload] (refresh icon) on NutriScore Checkout Tool"
Write-Host "     OR paste this in the Chrome DevTools (Extensions SW console):"
Write-Host ""
Write-Host "     chrome.runtime.reload();"
Write-Host ""
Write-Host "  3. Close ALL open Naivas / Carrefour tabs."
Write-Host "  4. Reopen a retailer page — content scripts will inject fresh."
Write-Host ""
Write-Host "TIP: To verify SW loaded correctly, open:"
Write-Host "  chrome://extensions -> NutriScore -> 'Service Worker' link -> Console"
Write-Host "  You should see: [NutriScore SW] Component Architecture v2.0 active."
Write-Host ""
