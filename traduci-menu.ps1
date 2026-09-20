# ============================================================
#  Traduce il menu di un ristorante UNA VOLTA SOLA e salva
#  le traduzioni nel database. Da rilanciare solo quando
#  aggiungi o cambi dei piatti.
#
#  Uso:
#    .\traduci-menu.ps1                       -> gusto-alcazabilla, tutte le lingue
#    .\traduci-menu.ps1 altro-ristorante      -> un altro ristorante
#    .\traduci-menu.ps1 gusto-alcazabilla es "it,en,de"   -> solo alcune lingue
# ============================================================
param(
    [string]$Slug = "gusto-alcazabilla",
    [string]$LinguaOriginale = "es",
    [string]$Lingue = ""
)

$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

Write-Host ""
Write-Host "Traduco il menu di '$Slug' (originale: $LinguaOriginale)" -ForegroundColor Cyan
Write-Host "Si puo' rilanciare quando vuoi: salta cio' che e' gia' tradotto." -ForegroundColor DarkGray
Write-Host ""

npm run translate --workspace=packages/api -- $Slug $LinguaOriginale $Lingue

Write-Host ""
Write-Host "Fatto: le traduzioni sono gia' online." -ForegroundColor Green
Write-Host "Il menu le legge dal database, non serve pubblicare niente." -ForegroundColor Gray
Read-Host "Premi INVIO per chiudere"
