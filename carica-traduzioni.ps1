# Carica nel database le traduzioni gia' pronte (cartella database\traduzioni).
param([string]$Slug = "gusto-alcazabilla")
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"
Write-Host ""
Write-Host "Carico le traduzioni di '$Slug' nel database..." -ForegroundColor Cyan
npm run load-translations --workspace=packages/api -- $Slug
Write-Host ""
Write-Host "Fatto: le traduzioni sono gia' online." -ForegroundColor Green
Write-Host "Il menu le legge dal database, non serve pubblicare niente." -ForegroundColor Gray
Read-Host "Premi INVIO per chiudere"
