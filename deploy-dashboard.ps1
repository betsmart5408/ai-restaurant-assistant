# ============================================================
#  Pubblica SOLO la dashboard (app.lingofork.com) su Cloudflare Pages.
#  A differenza di deploy-cloudflare.ps1 non tocca la chat clienti.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy-dashboard.ps1
# ============================================================
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false
$root = $PSScriptRoot
Set-Location (Join-Path $root "apps\owner-dashboard")

if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
$env:VITE_API_URL = "https://ai-restaurant-assistant-production-449f.up.railway.app"
$env:VITE_RESTAURANT_ID = "385da86d-9bca-47e5-b6ab-64670a072903"

Write-Host "== build dashboard ==" -ForegroundColor Cyan
& (Join-Path $root "node_modules\.bin\vite.cmd") build 2>&1 | ForEach-Object { "   $_" }
if (-not (Test-Path "dist\index.html")) {
    Write-Host "ERRORE: build fallita, non pubblico niente." -ForegroundColor Red
    exit 1
}

# fallback SPA: ogni rotta sconosciuta -> index.html
"/*    /index.html   200" | Out-File -FilePath "dist\_redirects" -Encoding ascii -NoNewline

Write-Host "== deploy su Cloudflare Pages ==" -ForegroundColor Cyan
npx --yes wrangler pages deploy dist --project-name gustobolsa-dashboard --branch main --commit-dirty=true 2>&1 |
    ForEach-Object { "   $_" }
