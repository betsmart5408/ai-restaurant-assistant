# Traduce i NOMI DELLE SEZIONI del menu ("Charcoal Grill", "To Share")
# nelle lingue di ogni ristorante. I piatti erano gia' tradotti: mancavano
# le intestazioni, che restavano in inglese anche per il turista cinese.
#
#   .\traduci-categorie.ps1                  tutte le demo
#   .\traduci-categorie.ps1 -Slug al-aseel   una sola
#   .\traduci-categorie.ps1 -Prova           mostra cosa farebbe, senza scrivere
#
param(
    [string]$Slug = "",
    [switch]$Prova
)
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

$argomenti = @()
if ($Slug)  { $argomenti += @("--slug", $Slug) }
if ($Prova) { $argomenti += "--prova" }

Write-Host ""
Write-Host "Traduco le sezioni del menu..." -ForegroundColor Cyan
node prospezione/traduci-categorie.mjs @argomenti

Write-Host ""
Write-Host "Fatto. Ora lancia .\deploy-tutto.ps1 se non l'hai gia' fatto." -ForegroundColor Yellow
Read-Host "Premi INVIO per chiudere"
