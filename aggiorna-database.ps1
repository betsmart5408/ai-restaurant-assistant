# Applica al database le modifiche non ancora eseguite (tabelle nuove, colonne nuove).
# Si puo' rilanciare quando si vuole: applica solo cio' che manca.
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Write-Host ""
Write-Host "Aggiorno il database..." -ForegroundColor Cyan
npm run migrate:all --workspace=packages/api
Write-Host ""
Write-Host "Fatto: il database e' aggiornato." -ForegroundColor Green
Write-Host ""
Write-Host "Di solito qui non serve altro." -ForegroundColor Gray
Write-Host "  - L'API sta su Railway e si ripubblica da sola a ogni 'git push'." -ForegroundColor Gray
Write-Host "  - Se hai cambiato le INTERFACCE (chat cliente o dashboard):  .\deploy-cloudflare.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "(deploy-tutto.ps1 e' il vecchio deploy su Vercel: non si usa piu'.)" -ForegroundColor DarkGray
Read-Host "Premi INVIO per chiudere"
