$ErrorActionPreference = "Stop"

Write-Host "Cleaning dist/ folder..."
$dist = "dist"
If (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

Write-Host "Building UI with Vite..."
npx vite build

Write-Host "Bundling db.ts for Service Worker..."
npx esbuild src/ui/src/app/lib/db.ts --bundle --outfile=src/extension/db.js --format=iife --global-name=NutriScoreDB --target=es2020

Write-Host "Assembling extension in dist/ folder..."
Copy-Item "src\extension\*" -Destination $dist -Recurse -Force

Write-Host "Build complete! Load the 'dist' folder in Chrome."
