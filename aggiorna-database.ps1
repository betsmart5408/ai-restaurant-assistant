# Applica al database le modifiche non ancora eseguite (tabelle nuove, colonne nuove).
# Si puo' rilanciare quando si vuole: applica solo cio' che manca.
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Write-Host ""
Write-Host "Aggiorno il database..." -ForegroundColor Cyan
npm run migrate:all --workspace=packages/api
Write-Host ""
Write-Host "Fatto. Ora lancia .\deploy-tutto.ps1" -ForegroundColor Yellow
Read-Host "Premi INVIO per chiudere"
