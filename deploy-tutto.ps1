# ============================================================
#  AI Restaurant Assistant  ->  pubblicazione su Vercel
#  API (serverless) + 3 interfacce
#  Uso:
#  powershell -ExecutionPolicy Bypass -File "C:\Users\pippo\Desktop\AI Restaurant Assistant\deploy-tutto.ps1"
# ============================================================
$ErrorActionPreference = "Continue"
$root = "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Set-Location $root

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
            $envMap[$k] | vercel env add $k production --force 2>$null | Out-Null
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

Write-Host ""
Write-Host "== 3/6  Compilo l'API ==" -ForegroundColor Cyan
npm install
npm run build --workspace=packages/api
if (-not (Test-Path "$root\packages\api\dist\index.js")) {
    Write-Host "ERRORE: la compilazione dell'API e' fallita. Mandami l'errore qui sopra." -ForegroundColor Red
    Read-Host "INVIO per chiudere"; exit 1
}

Write-Host ""
Write-Host "== 4/6  Preparo e pubblico l'API ==" -ForegroundColor Cyan
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
$deployed = Deploy-Folder $apiDir "restaurant-api" $envMap
# Indirizzo stabile del progetto: quello con il codice casuale cambia a ogni deploy.
# NB: Vercel ha assegnato a questo progetto l'alias "-psi", non "-gustobolsa".
$apiUrl = "https://restaurant-api-psi.vercel.app"
if (-not $deployed) {
    Write-Host "Non sono riuscito a leggere l'indirizzo dell'API. Copiami l'output qui sopra." -ForegroundColor Red
    Read-Host "INVIO per chiudere"; exit 1
}
Write-Host "API online: $apiUrl" -ForegroundColor Green

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
    Write-Utf8 "$d\.env.production" "VITE_API_URL=$apiUrl"
    $u = Deploy-Folder $d $a.name $null
    # Indirizzo stabile del progetto (quello con il codice casuale resta bloccato
    # sulla versione di quel singolo deploy).
    $results[$a.dir] = "https://$($a.name)-gustobolsa.vercel.app"
    Write-Host "   $($a.dir): $u" -ForegroundColor Green
}

Write-Host ""
Write-Host "== 6/6  Collego l'APP_URL alla dashboard ==" -ForegroundColor Cyan
if ($results["owner-dashboard"]) {
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
