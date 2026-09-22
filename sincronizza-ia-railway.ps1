# ============================================================
#  Copia su Railway le variabili dei fornitori IA scritte nel .env
#  (AI_PROVIDERS e tutte le CEREBRAS_*, GEMINI_*, MISTRAL_*, ...).
#
#  Uso (dalla cartella del progetto):
#     .\sincronizza-ia-railway.ps1
#
#  Serve la CLI di Railway gia' collegata al progetto (railway login + link).
#  Le chiavi non vengono stampate: si vede solo il nome della variabile.
#  Le righe con il valore vuoto si saltano (fornitore non ancora attivato).
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env_file = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $env_file)) { Write-Host "Non trovo il file .env" -ForegroundColor Red; exit 1 }

# Quali fornitori: quelli elencati in AI_PROVIDERS
$righe = Get-Content $env_file | Where-Object { $_ -match '^\s*[A-Z][A-Z0-9_]*=' -and $_ -notmatch '^\s*#' }
$mappa = @{}
foreach ($r in $righe) {
    $i = $r.IndexOf('=')
    $mappa[$r.Substring(0, $i).Trim()] = $r.Substring($i + 1).Trim()
}
if (-not $mappa.ContainsKey('AI_PROVIDERS') -or -not $mappa['AI_PROVIDERS']) {
    Write-Host "Nel .env manca AI_PROVIDERS" -ForegroundColor Red; exit 1
}
$prefissi = $mappa['AI_PROVIDERS'].Split(',') | ForEach-Object { $_.Trim().ToUpper() -replace '[^A-Z0-9]', '_' } | Where-Object { $_ }

$daMandare = @('AI_PROVIDERS')
foreach ($chiave in $mappa.Keys) {
    foreach ($p in $prefissi) {
        # Groq resta com'e' su Railway: la sua chiave c'e' gia'
        if ($p -ne 'GROQ' -and $chiave.StartsWith("$($p)_")) { $daMandare += $chiave }
    }
}

$argomenti = @()
foreach ($chiave in ($daMandare | Sort-Object -Unique)) {
    $valore = $mappa[$chiave]
    if ([string]::IsNullOrWhiteSpace($valore)) {
        Write-Host "  salto $chiave (vuota)" -ForegroundColor DarkGray
        continue
    }
    Write-Host "  mando $chiave" -ForegroundColor Cyan
    $argomenti += "--set"
    $argomenti += "$chiave=$valore"
}
if ($argomenti.Count -eq 0) { Write-Host "Niente da mandare." -ForegroundColor Yellow; exit 0 }

# Un solo comando: un solo riavvio del server su Railway
railway variables @argomenti | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Railway ha dato errore: controlla 'railway status'." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "Fatto: variabili aggiornate su Railway, il server si riavvia da solo (~1 minuto)." -ForegroundColor Green
