# ============================================================
#  AI Restaurant Assistant  ->  pubblica le 3 interfacce su
#  CLOUDFLARE PAGES (deploy diretti ILLIMITATI, gratis).
#  L'API resta su Railway.
#
#  PRIMA VOLTA (una sola volta):
#   1. Crea un account gratuito su https://dash.cloudflare.com
#   2. Esegui:  npx wrangler login   (si apre il browser, dai "Allow")
#
#  POI, ogni volta che vuoi ripubblicare:
#   & "C:\Users\pippo\Desktop\AI Restaurant Assistant\deploy-cloudflare.ps1"
# ============================================================
param(
    [string]$ApiUrl = "https://ai-restaurant-assistant-production-449f.up.railway.app"
)
# I comandi nativi (vite, wrangler) scrivono avvisi su stderr: NON deve fermare lo script.
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false
$root = "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Set-Location $root

$RID = "385da86d-9bca-47e5-b6ab-64670a072903"   # VITE_RESTAURANT_ID (dashboard + cucina)
$vite = Join-Path $root "node_modules\.bin\vite.cmd"

$apps = @(
    @{ dir = "customer-chat";   name = "gustobolsa-chat";      rid = $false },
    @{ dir = "kitchen-display"; name = "gustobolsa-cucina";    rid = $true  },
    @{ dir = "owner-dashboard"; name = "gustobolsa-dashboard"; rid = $true  }
)

Write-Host ""
Write-Host "== Controllo login Cloudflare ==" -ForegroundColor Cyan
$who = (npx --yes wrangler whoami 2>&1 | Out-String)
if ($who -notmatch "logged in") {
    Write-Host $who
    Write-Host "NON sei loggato su Cloudflare. Esegui prima:  npx wrangler login" -ForegroundColor Yellow
    exit 1
}
Write-Host "   ok, loggato." -ForegroundColor DarkGray

# progetti Pages gia' esistenti (per non ricrearli)
$esistenti = (npx --yes wrangler pages project list 2>&1 | Out-String)

$results = @{}
foreach ($a in $apps) {
    $appdir = Join-Path $root "apps\$($a.dir)"
    Write-Host ""
    Write-Host "== $($a.dir)  ->  $($a.name).pages.dev ==" -ForegroundColor Cyan
    Push-Location $appdir

    if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }

    $env:VITE_API_URL = $ApiUrl
    if ($a.rid) { $env:VITE_RESTAURANT_ID = $RID }
    else { if (Test-Path env:VITE_RESTAURANT_ID) { Remove-Item env:VITE_RESTAURANT_ID } }

    Write-Host "   build (vite)..." -ForegroundColor DarkGray
    & $vite build 2>&1 | ForEach-Object { "     $_" }
    if (-not (Test-Path "dist\index.html")) {
        Pop-Location
        Write-Host "ERRORE: build fallita per $($a.dir). Guarda i messaggi qui sopra." -ForegroundColor Red
        exit 1
    }

    # fallback SPA: ogni rotta sconosciuta -> index.html
    "/*    /index.html   200" | Out-File -FilePath "dist\_redirects" -Encoding ascii -NoNewline

    # crea il progetto Pages SOLO se non esiste. --force = crea davvero un
    # progetto Pages, senza la "delega a Workers" che modificherebbe i sorgenti.
    if ($esistenti -notmatch [regex]::Escape($a.name)) {
        Write-Host "   creo il progetto Pages $($a.name)..." -ForegroundColor DarkGray
        npx --yes wrangler pages project create $a.name --production-branch main --force 2>&1 | Out-Null
    }

    Write-Host "   deploy su Cloudflare Pages..." -ForegroundColor DarkGray
    npx --yes wrangler pages deploy dist --project-name $a.name --branch main --commit-dirty=true 2>&1 |
        ForEach-Object { "     $_" }

    if (Test-Path env:VITE_API_URL) { Remove-Item env:VITE_API_URL }
    if (Test-Path env:VITE_RESTAURANT_ID) { Remove-Item env:VITE_RESTAURANT_ID }
    Pop-Location
    $results[$a.dir] = "https://$($a.name).pages.dev"
}

Write-Host ""
Write-Host "================= FATTO =================" -ForegroundColor Yellow
Write-Host "API (Railway):    $ApiUrl"
Write-Host "Chat clienti:     $($results['customer-chat'])"
Write-Host "Monitor cucina:   $($results['kitchen-display'])"
Write-Host "Dashboard owner:  $($results['owner-dashboard'])"
Write-Host "========================================" -ForegroundColor Yellow
