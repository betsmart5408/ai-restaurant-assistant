# ============================================================
#  [OBSOLETO]  Le 3 interfacce ora stanno su CLOUDFLARE PAGES:
#  usa  deploy-cloudflare.ps1  (deploy illimitati, niente limite 100/giorno
#  di Vercel Hobby). Questo script resta solo per storico / emergenze.
#
#  AI Restaurant Assistant  ->  pubblicazione delle 3 interfacce su Vercel
#  L'API ora sta su RAILWAY (deploy automatico a ogni git push): qui non
#  serve piu' toccarla. Con -ConMalgradoApiVercel si ripubblica anche
#  la vecchia API serverless su Vercel (di norma NON serve).
#  Uso:
#  powershell -ExecutionPolicy Bypass -File "C:\Users\pippo\Desktop\AI Restaurant Assistant\deploy-tutto.ps1"
# ============================================================
param([switch]$ConMalgradoApiVercel)
$ErrorActionPreference = "Continue"
$root = "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Set-Location $root

# L'indirizzo dell'API su Railway: le interfacce puntano qui.
$apiUrl = "https://ai-restaurant-assistant-production-449f.up.railway.app"

function Write-Utf8($path, $text) {
    # UTF-8 SENZA BOM: il BOM manda in errore il parser JSON di Vercel
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-EnvMap {
    $map = @{}
    if (-not (Test-Path "$root\.env")) { return $map }
    foreach ($line in Get-Content "$root\.env") {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $name = $t.Substring(0, $i).Trim()
        $val  = $t.Substring($i + 1).Trim().Trim('"')
        if ($val -eq "" -or $val -like "*INSERISCI*" -or $val -eq "sk-ant-") { continue }
        $map[$name] = $val
    }
    return $map
}

function Deploy-Folder($folder, $projectName, $envMap) {
    Push-Location $folder
    Write-Host "   collego il progetto '$projectName'..." -ForegroundColor DarkGray
    vercel link --yes --project $projectName | Out-Null
    if ($envMap) {
        foreach ($k in $envMap.Keys) {
            Write-Host "   + variabile $k" -ForegroundColor DarkGray
            # rimuovo il vecchio valore (se c'e') e riscrivo: cosi' funziona
            # anche con versioni di Vercel CLI che non hanno --force su env add
            vercel env rm $k production --yes 2>$null | Out-Null
            $envMap[$k] | vercel env add $k production 2>$null | Out-Null
        }
    }
    Write-Host "   deploy in corso (puo' richiedere 1-2 minuti)..." -ForegroundColor DarkGray
    $out = & vercel --prod --yes 2>&1 | Out-String
    Write-Host $out
    # Preferisci l'indirizzo stabile della riga "Production:"; quello con il codice
    # casuale cambia a ogni deploy ed e' protetto da login.
    $m = [regex]::Match($out, 'Production:\s*(https://[a-zA-Z0-9\-\.]+\.vercel\.app)')
    if ($m.Success) {
        $url = $m.Groups[1].Value
    } else {
        $url = ([regex]::Matches($out, 'https://[a-zA-Z0-9\-\.]+\.vercel\.app') |
                ForEach-Object { $_.Value } | Select-Object -Last 1)
    }
    Pop-Location
    return $url
}

Write-Host ""
Write-Host "== 1/6  Vercel CLI ==" -ForegroundColor Cyan
$v = (vercel --version 2>$null)
if (-not $v) { npm install -g vercel } else { Write-Host "   gia' installata ($v)" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "== 2/6  Login Vercel (si apre il browser) ==" -ForegroundColor Cyan
vercel whoami 2>$null
if ($LASTEXITCODE -ne 0) { vercel login }

if ($ConMalgradoApiVercel) {

Write-Host ""
Write-Host "== 3/6  Compilo l'API ==" -ForegroundColor Cyan
npm install
npm run build --workspace=packages/api
if (-not (Test-Path "$root\packages\api\dist\index.js")) {
    Write-Host "ERRORE: la compilazione dell'API e' fallita. Mandami l'errore qui sopra." -ForegroundColor Red
    Read-Host "INVIO per chiudere"; exit 1
}

Write-Host ""
Write-Host "== 4/6  Preparo e pubblico l'API (Vercel, di solito NON serve) ==" -ForegroundColor Cyan
$apiDir = "$root\.deploy-api"
if (Test-Path $apiDir) { Remove-Item $apiDir -Recurse -Force }
New-Item -ItemType Directory -Path "$apiDir\api" -Force | Out-Null
Copy-Item "$root\packages\api\dist" "$apiDir\dist" -Recurse
Copy-Item "$root\packages\api\vercel-entry.js" "$apiDir\api\index.js"

$apiPkg = Get-Content "$root\packages\api\package.json" -Raw | ConvertFrom-Json
$deps = @{}
foreach ($p in $apiPkg.dependencies.PSObject.Properties) {
    if ($p.Name -ne "@restaurant/shared") { $deps[$p.Name] = $p.Value }
}
$newPkg = [ordered]@{
    name         = "restaurant-api"
    version      = "1.0.0"
    private      = $true
    dependencies = $deps
}
Write-Utf8 "$apiDir\package.json" ($newPkg | ConvertTo-Json -Depth 5)
$vercelJson = @'
{
  "functions": { "api/index.js": { "includeFiles": "dist/**" } },
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }]
}
'@
Write-Utf8 "$apiDir\vercel.json" $vercelJson

$envMap = Get-EnvMap
$envMap["NODE_ENV"] = "production"
Deploy-Folder $apiDir "restaurant-api" $envMap | Out-Null

}  # fine blocco -ConMalgradoApiVercel

Write-Host ""
Write-Host "API (su Railway): $apiUrl" -ForegroundColor Green

Write-Host ""
Write-Host "== 5/6  Pubblico le 3 interfacce ==" -ForegroundColor Cyan
$apps = @(
    @{ dir = "customer-chat";   name = "restaurant-chat" },
    @{ dir = "kitchen-display"; name = "restaurant-cucina" },
    @{ dir = "owner-dashboard"; name = "restaurant-dashboard" }
)
$results = @{}
foreach ($a in $apps) {
    Write-Host " -> $($a.dir)" -ForegroundColor Cyan
    $d = "$root\.deploy-$($a.dir)"
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Path $d -Force | Out-Null
    foreach ($item in @("src", "public", "index.html", "tsconfig.json", "vite.config.ts", "vercel.json")) {
        $src = "$root\apps\$($a.dir)\$item"
        if (Test-Path $src) { Copy-Item $src "$d\$item" -Recurse }
    }
    $pkg = Get-Content "$root\apps\$($a.dir)\package.json" -Raw | ConvertFrom-Json
    $d2 = @{}
    foreach ($p in $pkg.dependencies.PSObject.Properties) {
        if ($p.Name -ne "@restaurant/shared") { $d2[$p.Name] = $p.Value }
    }
    $dd = @{}
    foreach ($p in $pkg.devDependencies.PSObject.Properties) { $dd[$p.Name] = $p.Value }
    $np = [ordered]@{
        name            = $a.name
        version         = "1.0.0"
        private         = $true
        type            = "module"
        scripts         = @{ build = "vite build" }
        dependencies    = $d2
        devDependencies = $dd
    }
    Write-Utf8 "$d\package.json" ($np | ConvertTo-Json -Depth 5)

    # Variabili VITE_ del frontend. Le forziamo ANCHE come env di progetto su
    # Vercel (--force): se nelle impostazioni del progetto e' rimasto un vecchio
    # VITE_API_URL (es. la vecchia API su Vercel), quello vince sul file
    # .env.production al momento del build e il sito continua a chiamare l'API
    # morta. Forzandolo qui, ogni deploy riparte dall'URL di Railway.
    $envApp = [ordered]@{ "VITE_API_URL" = $apiUrl }
    $srcEnv = "$root\apps\$($a.dir)\.env.production"
    if (Test-Path $srcEnv) {
        foreach ($line in Get-Content $srcEnv) {
            $t = $line.Trim()
            if ($t -eq "" -or $t.StartsWith("#")) { continue }
            $i = $t.IndexOf("=")
            if ($i -lt 1) { continue }
            $n = $t.Substring(0, $i).Trim()
            $val = $t.Substring($i + 1).Trim().Trim('"')
            if ($n -eq "VITE_API_URL" -or $val -eq "") { continue }
            if ($n -like "VITE_*") { $envApp[$n] = $val }
        }
    }
    Write-Utf8 "$d\.env.production" (($envApp.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n")
    $u = Deploy-Folder $d $a.name $envApp
    # Indirizzo stabile del progetto (quello con il codice casuale resta bloccato
    # sulla versione di quel singolo deploy).
    $results[$a.dir] = "https://$($a.name)-gustobolsa.vercel.app"
    Write-Host "   $($a.dir): $u" -ForegroundColor Green
}

# APP_URL / DASHBOARD_URL dell'API stanno gia' impostati su Railway.
if ($ConMalgradoApiVercel -and $results["owner-dashboard"]) {
    Push-Location $apiDir
    $results["owner-dashboard"] | vercel env add APP_URL production --force 2>$null | Out-Null
    Pop-Location
}

Write-Host ""
Write-Host "================= FATTO =================" -ForegroundColor Yellow
Write-Host "API (motore):     $apiUrl"
Write-Host "Verifica salute:  $apiUrl/health"
Write-Host "Chat clienti:     $($results['customer-chat'])"
Write-Host "Monitor cucina:   $($results['kitchen-display'])"
Write-Host "Dashboard owner:  $($results['owner-dashboard'])"
Write-Host "=========================================" -ForegroundColor Yellow
Write-Host "Copiami questi indirizzi in chat e verifico che tutto risponda."
Read-Host "Premi INVIO per chiudere"
