# Genera i link "Attiva la tua demo" da mandare ai ristoratori.
#
#   .\link-attiva.ps1                     tutte le demo
#   .\link-attiva.ps1 -Slug al-aseel      una sola
#   .\link-attiva.ps1 -Rifai             rigenera anche i token già fatti
#   .\link-attiva.ps1 -Url https://tua-dashboard.vercel.app
#
# Ogni link porta il ristoratore a scegliere email e password: la demo
# diventa il suo account e parte il trial di 14 giorni. Serve la migrazione
# 015 (.\aggiorna-database.ps1).
param(
    [string]$Slug = "",
    [switch]$Rifai,
    [string]$Url = ""
)
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

$argomenti = @()
if ($Slug)  { $argomenti += @('--slug', $Slug) }
if ($Rifai) { $argomenti += '--rifai' }
if ($Url)   { $argomenti += @('--url', $Url) }

node prospezione/link-attiva.mjs @argomenti
