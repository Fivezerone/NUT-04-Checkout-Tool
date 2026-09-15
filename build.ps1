$ErrorActionPreference = "Stop"

Write-Host "Cleaning dist/ folder..."
$dist = "dist"
If (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

# STEP 1: Compile db.ts -> src/extension/db.js BEFORE Vite runs.
# This ensures both the SW (importScripts db.js) and the Vite dashboard bundle
# are built from the same db.ts snapshot.
Write-Host "Bundling db.ts for Service Worker..."
npx esbuild src/ui/src/app/lib/db.ts --bundle --outfile=src/extension/db.js --format=iife --global-name=NutriScoreDB --platform=browser --target=chrome96 --log-level=info

# STEP 2: Build the React UI (popup + dashboard).
Write-Host "Building UI with Vite..."
npx vite build

# STEP 3: Copy all extension source files (including freshly-compiled db.js) into dist/.
Write-Host "Assembling extension in dist/ folder..."
Copy-Item "src\extension\*" -Destination $dist -Recurse -Force

Write-Host ""
Write-Host "Build complete! Load the 'dist' folder in Chrome."
Write-Host "  -> chrome://extensions  -->  click the Reload (refresh) button on NutriScore."
Write-Host "  -> Close and reopen any open Naivas / Carrefour tabs to pick up new content scripts."
