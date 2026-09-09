# ============================================================
#  Pubblica la landing page (apps/landing) su Cloudflare Pages
#  progetto: gustobolsa-site  ->  lingofork.com
#
#  Prima volta: npx wrangler login  (vedi deploy-cloudflare.ps1)
#  Uso:  & "C:\Users\pippo\Desktop\AI Restaurant Assistant\deploy-site.ps1"
# ============================================================
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false
$root = "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Set-Location $root

$who = (npx --yes wrangler whoami 2>&1 | Out-String)
if ($who -notmatch "logged in") {
    Write-Host "Non sei loggato su Cloudflare. Esegui:  npx wrangler login" -ForegroundColor Yellow
    exit 1
}

$esistenti = (npx --yes wrangler pages project list 2>&1 | Out-String)
if ($esistenti -notmatch "gustobolsa-site") {
    npx --yes wrangler pages project create gustobolsa-site --production-branch main --force 2>&1 | Out-Null
}

npx --yes wrangler pages deploy "$root\apps\landing" --project-name gustobolsa-site --branch main --commit-dirty=true

Write-Host ""
Write-Host "Fatto. Produzione: https://lingofork.com  (fallback: https://gustobolsa-site.pages.dev)" -ForegroundColor Green
