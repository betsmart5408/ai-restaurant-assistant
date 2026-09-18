# Costruisce una demo COMPLETA: crea il ristorante nel database, inserisce i
# piatti e carica le traduzioni gia' scritte. Nell'ordine giusto.
#
#   .\demo-completa.ps1 -Menu 3-wise-monkeys
#   .\demo-completa.ps1 -Menu 3-wise-monkeys -Rifai
#   .\demo-completa.ps1 -Tutte           tutte quelle che hanno le traduzioni pronte
#
param(
    [string]$Menu,
    [switch]$Rifai,
    [switch]$Tutte
)

Set-Location $PSScriptRoot

function Costruisci($nomeMenu) {
    $slug = "demo-$nomeMenu"
    Write-Host ""
    Write-Host "══ $nomeMenu ══" -ForegroundColor Cyan

    Write-Host "  1) creo il ristorante e i piatti..." -ForegroundColor DarkGray
    $argomenti = @($nomeMenu)
    if ($Rifai) { $argomenti += '--rifai' }
    node prospezione/crea-demo.mjs @argomenti
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  fermato: la creazione non e' riuscita." -ForegroundColor Red
        return
    }

    $quante = (Get-ChildItem "database\traduzioni\$slug.*.json" -ErrorAction SilentlyContinue).Count
    if ($quante -eq 0) {
        Write-Host "  2) nessuna traduzione pronta per ${slug}: la demo resta solo in inglese." -ForegroundColor Yellow
        return
    }

    Write-Host "  2) carico $quante lingue..." -ForegroundColor DarkGray
    npm run load-translations --workspace=packages/api -- $slug
}

if ($Tutte) {
    # Prende tutti i menu che hanno gia' i file di traduzione pronti.
    $pronti = Get-ChildItem "database\traduzioni\demo-*.json" |
        ForEach-Object { ($_.BaseName -split '\.')[0] -replace '^demo-', '' } |
        Sort-Object -Unique
    if (-not $pronti) { Write-Host "Nessuna traduzione pronta in database\traduzioni." -ForegroundColor Yellow; exit }
    Write-Host "Demo da costruire: $($pronti -join ', ')" -ForegroundColor Cyan
    foreach ($m in $pronti) { Costruisci $m }
} elseif ($Menu) {
    Costruisci $Menu
} else {
    Write-Host "Uso:  .\demo-completa.ps1 -Menu <nome-menu>   oppure   .\demo-completa.ps1 -Tutte" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Menu con traduzioni gia' pronte:" -ForegroundColor Cyan
    Get-ChildItem "database\traduzioni\demo-*.json" |
        ForEach-Object { ($_.BaseName -split '\.')[0] -replace '^demo-', '' } |
        Sort-Object -Unique | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "Fatto. Per vedere i link:  .\elenco-demo.ps1" -ForegroundColor Green
